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
      columns: function (listId) { return site + '/lists/' + listId + '/columns'; },
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

  /* The comments list carries no SuppressReconcileUntil column. Sending a
     column a list does not have fails the write outright, which is how the
     Tasks list taught this. Four fields, nothing else. */
  function commentBody(post) {
    return { fields: {
      Title: post.Title,
      AssignmentLookupId: String(post.AssignmentLookupId),
      Kind: post.Kind,
      Body: post.Body == null ? '' : post.Body
    } };
  }

  function createBody(create, projectManagerLookupId) {
    if (!projectManagerLookupId) {
      throw new Error('Refusing to create a pool request with no project manager. '
        + 'A blank Person column is accepted on write and then fails inside '
        + 'D2 - New Pool about sixteen minutes later, which reads as the tool '
        + 'hanging rather than as a rejected request.');
    }
    var body = {
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
      AssignDefaultCrews: !!create.assignDefaultCrews,
      // Required Choice, default Gunite on the list; sent explicitly for the same reason AssignDefaultCrews is.
      BuildType: create.buildType === 'Fiberglass' ? 'Fiberglass' : 'Gunite'
      /* Status and Result are deliberately absent. Both are flow-owned, both
         are hidden from the New form, and Status defaults to Requested. */
    };
    // Optional features, names joined by a semicolon; absent when none were picked.
    if (create.features && create.features.length) body.Features = create.features.join(';');
    return body;
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

  /* PATCH the assignment, then POST the comment, and POST only if the PATCH
     succeeded. A comment row saying "rejected, because X" beside an
     assignment that was never reopened is a record of something that did not
     happen -- worse than no record at all. If the PATCH lands and the POST
     then fails, the failure is reported at the 'post' stage with
     `patched: true`, so the caller can say plainly that the row WAS changed
     even though the comment was not recorded.

     One op failing must not stop the next: each op is independent, and a
     batch of a few rejections and comments should land as many as it can.
     Sequential on purpose -- these are few, and PATCH-before-POST ordering
     is the point, not throughput. */
  async function applyRejectionOps(ctx, ops) {
    var f = ctx.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('No fetch implementation available.');
    var U = urls(ctx.siteId);
    var done = [], failed = [];
    for (var i = 0; i < (ops || []).length; i++) {
      var op = ops[i];
      if (op.patch) {
        var pr = await f(U.fields(ctx.asgListId, op.patch.id), {
          method: 'PATCH', headers: headers(ctx.token), body: JSON.stringify(patchBody(op.patch))
        });
        if (!pr.ok) {
          failed.push({ localId: op.localId, kind: op.kind, id: op.id, stage: 'patch',
                        status: pr.status, message: await pr.text() });
          continue;
        }
      }
      var cr = await f(U.items(ctx.commentsListId), {
        method: 'POST', headers: headers(ctx.token), body: JSON.stringify(commentBody(op.post))
      });
      if (!cr.ok) {
        failed.push({ localId: op.localId, kind: op.kind, id: op.id, stage: 'post',
                      status: cr.status, message: await cr.text(), patched: !!op.patch });
        continue;
      }
      var row = await cr.json();
      done.push({ localId: op.localId, kind: op.kind, id: op.id,
                  commentId: row && row.id == null ? null : String(row.id) });
    }
    return { done: done, failed: failed };
  }

  /* A Tasks create linked to the Assignments row just made. The Tasks list has
     no SuppressReconcileUntil column, and sending a column a list does not
     have fails the write outright, so it is stripped even if a plan carries it. */
  function structureTaskBody(task, asgId) {
    var b = {};
    Object.keys(task).forEach(function (k) { if (k !== 'SuppressReconcileUntil') b[k] = task[k]; });
    b.AssignmentLookupId = String(asgId);
    return { fields: b };
  }

  /* POST with up to two retries on a 429 or 503, waiting Retry-After seconds
     (2 when absent or not a number). Any other status, and a network error
     (status 0), is returned at once. */
  async function postRetrying(f, sleep, url, token, body) {
    for (var attempt = 0; ; attempt++) {
      var r;
      try {
        r = await f(url, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
      } catch (e) {
        return { ok: false, status: 0 };
      }
      if ((r.status === 429 || r.status === 503) && attempt < 2) {
        var raw = r.headers && r.headers.get ? r.headers.get('Retry-After') : null;
        var ra = raw == null || String(raw).trim() === '' ? NaN : Number(raw); // Number(null) is 0, not absent
        await sleep((isFinite(ra) && ra >= 0 ? ra : 2) * 1000);
        continue;
      }
      return r;
    }
  }

  /* Create the rows planStructureCreates (writeback-core.js) planned: each
     Assignment, then its tasks in order. A failed Assignment posts none of its
     tasks, because a task with no parent is an orphan nothing reads. A failed
     task is recorded by title and the rest continue, so one bad row never
     discards the others. Sequential on purpose: each task needs its parent's
     id, and these are few. */
  async function applyStructureCreates(plan, ctx) {
    var f = ctx.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('No fetch implementation available.');
    var sleep = ctx.sleep || function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
    var U = urls(ctx.siteId);
    var created = [], failed = [];
    var list = (plan && plan.creates) || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var ar = await postRetrying(f, sleep, U.items(ctx.asgListId), ctx.token, { fields: c.asg });
      var row = null;
      if (ar.ok) { try { row = await ar.json(); } catch (e) { row = null; } }
      if (!ar.ok || !row || row.id == null) {
        failed.push({ tplId: c.tplId, stage: 'asg', status: ar.status });
        continue;
      }
      var asgId = String(row.id), taskIds = [];
      for (var t = 0; t < (c.tasks || []).length; t++) {
        var task = c.tasks[t];
        var tr = await postRetrying(f, sleep, U.items(ctx.tasksListId), ctx.token, structureTaskBody(task, asgId));
        var trow = null;
        if (tr.ok) { try { trow = await tr.json(); } catch (e) { trow = null; } }
        if (!tr.ok || !trow || trow.id == null) {
          failed.push({ tplId: c.tplId, stage: 'task', title: task.Title, status: tr.status });
          continue;
        }
        taskIds.push(String(trow.id));
      }
      created.push({ tplId: c.tplId, asgId: asgId, taskIds: taskIds });
    }
    return { created: created, failed: failed };
  }

  /* ---- Trades, Crews and Crew-Trades writes (applyCrewOps) ----
   * EVERY SHAPE BELOW WAS CAPTURED LIVE ON 2026-10-29 and is pinned in
   * fixtures/planner/crew-capture.json (the harness compares each body with it):
   *   Trades POST       {fields:{Title, TradeCode, SortOrder}}
   *   Crews POST        {fields:{Title, CrewID, Size, Unlimited, Active, Members, Notes, Preference}}
   *   Crew-Trades POST  {fields:{Title:'<crew>-<trade>', CrewLookupId:'<str>', TradeLookupId:'<str>', Preference:<n>}}
   *   PATCH             /items/{id}/fields with just the changed fields (Preference is a number)
   *   DELETE            /items/{id}, no body, 204
   * Lookup ids are STRINGS on the wire. Ops come from planCrewEdits in
   * web/writeback-core.js. */
  function tradeBody(op) {
    return { fields: { Title: op.label, TradeCode: op.code, SortOrder: op.sort } };
  }
  function crewBody(op) { return { fields: op.fields }; }
  function ctBody(op, crewSpId, tradeSpId) {
    return { fields: {
      Title: (String(op.crewCode) + '-' + String(op.tradeCode)).toLowerCase(),
      CrewLookupId: String(crewSpId),
      TradeLookupId: String(tradeSpId),
      Preference: op.rating
    } };
  }
  function ctPatchBody(op) { return { Preference: op.rating }; }

  /* Apply the ops in the order given. A failure is recorded and the loop
     carries on; only a ct-create whose crew or skill row does not exist (and
     was not created earlier in this batch) is skipped, since it has nothing to
     point at. ctx = {token, siteId, lists:{crews, ct, trades}, crewSpIdByCode,
     tradeSpIdByCode, fetchImpl, sleep}. */
  async function applyCrewOps(ctx, ops) {
    var f = ctx.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('No fetch implementation available.');
    var sleep = ctx.sleep || function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
    var U = urls(ctx.siteId);
    var done = [], failed = [], skipped = [];
    var crewIds = {}, tradeIds = {};
    Object.keys(ctx.crewSpIdByCode || {}).forEach(function (k) { crewIds[k] = String(ctx.crewSpIdByCode[k]); });
    Object.keys(ctx.tradeSpIdByCode || {}).forEach(function (k) { tradeIds[k] = String(ctx.tradeSpIdByCode[k]); });

    async function fail(op, r) {
      var detail = null;
      try { detail = await r.json(); } catch (e) { /* a non-JSON error body is still a failure */ }
      failed.push({ op: op, status: r.status, detail: detail });
    }
    async function create(op, listId, body) {
      var r = await postRetrying(f, sleep, U.items(listId), ctx.token, body);
      var row = null;
      if (r.ok) { try { row = await r.json(); } catch (e) { row = null; } }
      if (!r.ok || !row || row.id == null) { await fail(op, r.ok ? { status: r.status, json: async function () { return null; } } : r); return null; }
      done.push({ op: op, id: String(row.id) });
      return String(row.id);
    }
    async function patch(op, listId, body) {
      var r = await f(U.fields(listId, op.spId), { method: 'PATCH', headers: headers(ctx.token), body: JSON.stringify(body) });
      if (r.ok) done.push({ op: op, id: String(op.spId) }); else await fail(op, r);
    }

    for (var i = 0; i < (ops || []).length; i++) {
      var op = ops[i];
      if (op.kind === 'trade-create') {
        var tid = await create(op, ctx.lists.trades, tradeBody(op));
        if (tid) tradeIds[op.code] = tid;
      } else if (op.kind === 'crew-create') {
        var cid = await create(op, ctx.lists.crews, crewBody(op));
        if (cid) crewIds[op.id] = cid;
      } else if (op.kind === 'crew-patch') {
        await patch(op, ctx.lists.crews, op.fields);
      } else if (op.kind === 'ct-create') {
        var cs = crewIds[op.crewCode], ts = tradeIds[op.tradeCode];
        if (!cs || !ts) { skipped.push({ op: op, reason: 'depends-on-failed' }); continue; }
        await create(op, ctx.lists.ct, ctBody(op, cs, ts));
      } else if (op.kind === 'ct-patch') {
        await patch(op, ctx.lists.ct, ctPatchBody(op));
      } else if (op.kind === 'ct-delete') {
        var dr = await f(U.item(ctx.lists.ct, op.spId), { method: 'DELETE', headers: headers(ctx.token) });
        if (dr.ok) done.push({ op: op, id: String(op.spId) }); else await fail(op, dr);
      }
    }
    return { done: done, failed: failed, skipped: skipped };
  }

  return {
    tradeBody: tradeBody, crewBody: crewBody, ctBody: ctBody, ctPatchBody: ctPatchBody, applyCrewOps: applyCrewOps,
    structureTaskBody: structureTaskBody, applyStructureCreates: applyStructureCreates,
    urls: urls, headers: headers, resolveSiteUserId: resolveSiteUserId,
    patchBody: patchBody, createBody: createBody, statusBody: statusBody,
    applyWrites: applyWrites, commentBody: commentBody, applyRejectionOps: applyRejectionOps
  };
});
