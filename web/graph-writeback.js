/* Graph-shaped I/O for the planner write-back. THE ONLY file that knows what a
 * Graph URL or request body looks like.
 *
 * WHY SEPARATE FROM web/writeback-core.js: the core decides what may be
 * written and whether it has diverged, which is true regardless of transport.
 * This file decides what the bytes look like, which is emphatically not. Graph
 * is a THIRD field-shape surface alongside raw REST and the Power Automate
 * connector, and this project has lost six separate cycles to carrying one
 * surface's shape over to another. Keeping the surface mapping in its own file,
 * tested against shapes captured from the live tenant, is the discipline that
 * stops a seventh. It is the same split as graph-to-planner.js versus
 * export-to-planner.js on the read side.
 *
 * EVERY SHAPE BELOW WAS READ OFF THE LIVE TENANT ON 2026-09-15, NOT ASSUMED:
 *
 *   PATCH /sites/{siteId}/lists/{listId}/items/{id}/fields  -> 200
 *   Choice   (Crew)            plain string, e.g. "subcon"
 *   DateOnly (ScheduledStart)  bare "yyyy-MM-dd", stored at site-local
 *                              midnight (T05:00:00Z under CDT) EXACTLY as raw
 *                              REST stores it. A probe wrote 2026-09-22 back
 *                              and the row still read 2026-09-22T05:00:00Z, so
 *                              the 2026-09-03 off-by-one does not recur here.
 *   Number, Boolean            pass through unchanged
 *   DateTime (SuppressReconcileUntil)  ISO 8601 string, stored to the second
 *   Person   (ProjectManager)  set as {Field}LookupId, a site-user id string
 *
 * New Pool Requests column names were read off that list's /columns endpoint:
 * Title holds the POOL NAME and JobNumber holds the job number. There is no
 * PoolName column, and Status and Result are flow-owned.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.D2GraphWriteback = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 'https://graph.microsoft.com/v1.0';

  function urls(siteId) {
    var site = BASE + '/sites/' + siteId;
    return {
      items: function (listId) { return site + '/lists/' + listId + '/items'; },
      item: function (listId, id) { return site + '/lists/' + listId + '/items/' + id; },
      fields: function (listId, id) { return site + '/lists/' + listId + '/items/' + id + '/fields'; },
      // Hidden system list, but readable over Graph by name on this site.
      userInfo: site + '/lists/User Information List/items'
        + '?$expand=fields($select=id,Title,Name,EMail)&$top=500'
    };
  }

  function headers(token) {
    return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  }

  /* Resolve a UPN to a SharePoint site-user id.
   *
   * MATCH ON `Name`, NEVER ON `EMail`. `Name` is the claims string
   * `i:0#.f|membership|<upn>`, which is the actual sign-in identity. The
   * service account is the proof that this matters: D2 Bot's EMail is
   * d2bot@d2pools.com while its UPN is stratirus@d2pools.com, so an EMail
   * match works for all four PMs and fails for exactly one user. This is the
   * standing "join on userPrincipalName, never mail" rule appearing on a new
   * surface.
   *
   * AND NEVER MATCH ON EMPTY. The list holds SharePoint groups and system
   * principals as well as people, and groups carry no EMail, so a naive
   * `'' === ''` silently resolves to a group and looks confident. The first
   * version of this resolver returned site-user id 3, "D2 Build Scheduler
   * Owners". That is the same silent-empty-join that once wrote TradeMismatch
   * on 66 correctly-qualified rows.
   *
   * Ambiguity is a refusal, not a tie-break. The tenant is known to hold
   * duplicate accounts for two of these people. */
  function resolveSiteUserId(rows, upn) {
    var want = String(upn == null ? '' : upn).trim().toLowerCase();
    if (!want) return { id: null, matches: [], ambiguous: false };
    var suffix = '|' + want;
    var hits = (rows || []).filter(function (f) {
      var name = String(f && f.Name || '').trim().toLowerCase();
      if (name.length <= suffix.length) return false;
      return name.lastIndexOf(suffix) === name.length - suffix.length;
    });
    return {
      id: hits.length === 1 ? String(hits[0].id) : null,
      matches: hits.map(function (h) { return { id: String(h.id), title: h.Title }; }),
      ambiguous: hits.length > 1
    };
  }

  /* The suppression stamp rides in the SAME body as the data, exactly as
     D2 - Reschedule Pool does it. A second write to set it would re-trigger
     the very flow it exists to suppress. */
  /* Conditional, because this now serves two lists. An Assignments write wants
     the suppression stamp so a 46-row batch does not burn an Event-Driven
     Reconciliation run per row. The Tasks list has no such column, and sending
     it there fails the PATCH outright. */
  function patchBody(write) {
    var b = {};
    Object.keys(write.fields).forEach(function (k) { b[k] = write.fields[k]; });
    if (write.suppressUntil) b.SuppressReconcileUntil = write.suppressUntil;
    return b;
  }

  function createBody(create, projectManagerLookupId) {
    if (!projectManagerLookupId) {
      throw new Error('Refusing to create a pool request with no project manager. '
        + 'A blank Person column is accepted on write and then fails inside '
        + 'D2 - New Pool about sixteen minutes later, which reads as the tool '
        + 'hanging rather than as a rejected request.');
    }
    return {
      Title: create.name,                    // the POOL NAME, per every live row
      JobNumber: create.jobno,
      Address: create.addr || '',
      City: create.city || '',
      StartDate: create.start,               // bare yyyy-MM-dd, read in site-local time
      ProjectManagerLookupId: String(projectManagerLookupId),
      /* Boolean, Required, list default 1. Sent EXPLICITLY because a Graph
         create is not the list form and is not proven to supply list defaults;
         REST item-creation on this tenant is already known to bypass
         required-field validation. If this arrives falsy, all 46 sub-phases
         land `unassigned` and the tool looks broken rather than configured. */
      AssignDefaultCrews: !!create.assignDefaultCrews
      /* Status and Result are deliberately absent. Both are flow-owned, both
         are hidden from the New form, and Status defaults to Requested. */
    };
  }

  function statusBody(status) { return { Status: status }; }

  /* One PATCH per row. A failing row is recorded and the batch CONTINUES: a
     single row's failure must never silently discard the rest of a PM's work,
     and the results dialog needs to name which rows landed and which did not. */
  async function applyWrites(ctx, writes) {
    var f = ctx.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('No fetch implementation available.');
    var U = urls(ctx.siteId);
    var written = [], failed = [];
    for (var i = 0; i < (writes || []).length; i++) {
      var w = writes[i];
      var r = await f(U.fields(ctx.listId, w.id), {
        method: 'PATCH', headers: headers(ctx.token), body: JSON.stringify(patchBody(w))
      });
      if (r.ok) {
        written.push({ id: w.id, jobno: w.jobno, num: w.num, fields: Object.keys(w.fields) });
      } else {
        var detail = null;
        try { detail = await r.json(); } catch (e) { /* a non-JSON error body is still a failure */ }
        failed.push({ id: w.id, jobno: w.jobno, num: w.num, status: r.status, detail: detail });
      }
    }
    return { written: written, failed: failed };
  }

  return {
    urls: urls, headers: headers, resolveSiteUserId: resolveSiteUserId,
    patchBody: patchBody, createBody: createBody, statusBody: statusBody,
    applyWrites: applyWrites
  };
});
