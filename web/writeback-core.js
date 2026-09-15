/* Surface-independent decisions for the planner write-back.
 *
 * WHY THIS IS SEPARATE FROM web/graph-writeback.js: everything here is a
 * decision about DATA -- may this field be written, has it diverged since we
 * loaded, is this the row we think it is -- and none of it depends on whether
 * the bytes travel over Microsoft Graph, over SharePoint REST, or through the
 * Power Automate connector. The surface-shaped half lives next door and is
 * tested against a captured payload, because Graph is a THIRD field-shape
 * surface alongside the other two and this project has lost six separate
 * cycles to assuming one surface's shape carries over to another.
 *
 * Pure functions only. Nothing here calls fetch, touches the DOM, or knows
 * what a site id is. That is what makes the five safety properties testable
 * without a tenant, in fixtures/planner/writeback-core.js.
 *
 * THE FIVE SAFETY PROPERTIES, and where each one lives:
 *   1. allowlist                -> ALLOWLIST, checked in planEdits
 *   2. compare-before-write     -> FIELD_DEFS[col].eq, per FIELD in planEdits
 *   3. row identity             -> titleMatches
 *   4. suppression in one write -> suppressUntil, stamped onto every write
 *   5. refuse rather than guess -> planCreates, and the caller's PM resolution
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.D2WritebackCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* SharePoint DateOnly columns land at site-local midnight (T05:00:00Z under
     CDT, T06:00:00Z under CST), so the first ten characters are already the
     intended day. Never new Date() this: that reintroduces the 2026-09-03
     off-by-one that had to be fixed across every list in the tenant once. */
  function day(v) { return v ? String(v).slice(0, 10) : null; }

  /* Comparison key for a job number ONLY. SharePoint's own $filter on a Text
     column is case-insensitive while a JS object key is not, so without this a
     lower-cased duplicate sails past our uniqueness check and is refused by
     D2 - New Pool ten minutes later: a safe direction, but a wasted round trip
     on the exact check that exists to avoid one. Never used for the value
     actually written. */
  function jobKey(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

  /* THE ALLOWLIST. The only Assignments columns this system will ever write.
     ScheduledFinish is derived from start plus duration and is never sent.
     Nothing on the Tasks list and no sign-off column appears here, and adding
     one would also have to get past fixtures/planner/writeback-parity.js. */
  var ALLOWLIST = ['Crew', 'ScheduledStart', 'DurationDays', 'Locked', 'NotApplicable'];

  /* `write` normalises a change-set value on its way into a request body and
     defaults to identity. ScheduledStart is the one field that needs it: the
     read side slices a live DateOnly down to a bare date, so the write side
     must do the same or the two halves disagree about what the column holds.
     Asymmetry between a read path and a write path is exactly how the
     original date bug came back the first time. */
  var FIELD_DEFS = {
    Crew: {
      read: function (r) { return r.Crew || null; },
      eq: function (a, b) { return (a || null) === (b || null); }
    },
    ScheduledStart: {
      read: function (r) { return day(r.ScheduledStart); },
      eq: function (a, b) { return (a || null) === (b || null); },
      write: day
    },
    DurationDays: {
      read: function (r) { return r.DurationDays == null ? null : r.DurationDays; },
      eq: function (a, b) { return (a == null ? null : a) === (b == null ? null : b); }
    },
    Locked: {
      read: function (r) { return !!r.Locked; },
      eq: function (a, b) { return !!a === !!b; }
    },
    NotApplicable: {
      read: function (r) { return !!r.NotApplicable; },
      eq: function (a, b) { return !!a === !!b; }
    }
  };

  function writeVal(col, v) {
    return FIELD_DEFS[col].write ? FIELD_DEFS[col].write(v) : v;
  }

  /* Row identity. TOKEN-ANCHORED, not a substring test: a plain indexOf lets a
     "2.1" edit land on a "2.10" row. That is dormant only because the current
     template tops out at 7.0, and it was proven by exploit test rather than
     reasoned about. */
  function titleMatches(title, jobno, num) {
    var t = String(title == null ? '' : title);
    if (jobKey(t).indexOf(jobKey(jobno)) !== 0) return false;
    var toks = t.split(/[^0-9.]+/).filter(Boolean);
    return toks.indexOf(String(num)) !== -1;
  }

  function suppressUntil(nowMs, minutes) {
    return new Date(nowMs + minutes * 60000).toISOString();
  }

  /* Turn a change-set plus the live rows into what may actually be written.
   *
   * Compare-before-write is per FIELD, never per row: a row with two changed
   * fields can have one refused and the other land. That is deliberate and is
   * why row-level ETags were rejected -- five flows write to Assignments on
   * schedules unrelated to the PM (Calendar Sync hourly, Counter
   * Reconciliation, Conflict Flag, Crew Trade Check, Event-Driven
   * Reconciliation), so a row-level precondition would reject a whole batch
   * because a nightly flow annotated the rows overnight.
   *
   * pools     : the change-set, [{jobno, name, sections:[{id, num, fields:{col:{from,to}}}]}]
   * liveById  : {String(id): liveFieldsObject} read immediately before writing
   * opts      : {nowMs, suppressMinutes}
   * returns   : {writes, refusals, errors}
   */
  function planEdits(pools, liveById, opts) {
    opts = opts || {};
    var nowMs = opts.nowMs == null ? Date.now() : opts.nowMs;
    var mins = opts.suppressMinutes == null ? 10 : opts.suppressMinutes;
    var stamp = suppressUntil(nowMs, mins);
    var writes = [], refusals = [], errors = [];

    (pools || []).forEach(function (p) {
      (p.sections || []).forEach(function (sec) {
        var id = String(sec.id);
        var where = { id: id, jobno: p.jobno, num: sec.num };
        var liveRow = liveById && liveById[id];

        if (!liveRow) {
          errors.push(Object.assign({}, where, { reason: 'row-missing' }));
          return;
        }
        /* Verify SharePoint's own account of the row before touching it,
           rather than trusting the id the change-set carries. */
        if (!titleMatches(liveRow.Title, p.jobno, sec.num)) {
          errors.push(Object.assign({}, where,
            { reason: 'identity-mismatch', liveTitle: liveRow.Title }));
          return;
        }

        var fields = {};
        Object.keys(sec.fields || {}).forEach(function (col) {
          var d = sec.fields[col] || {};
          /* The `!FIELD_DEFS[col]` half is not redundant with the allowlist
             check beside it: it catches ALLOWLIST and FIELD_DEFS drifting
             apart, which would otherwise throw a TypeError partway through a
             push and abandon the batch in an unknown state. Refusing is always
             the safe direction here. */
          if (ALLOWLIST.indexOf(col) === -1 || !FIELD_DEFS[col]) {
            refusals.push(Object.assign({}, where, {
              col: col, reason: 'not-allowlisted',
              loaded: d.from, nowLive: null, wanted: d.to
            }));
            return;
          }
          var def = FIELD_DEFS[col];
          var nowLive = def.read(liveRow);
          if (!def.eq(nowLive, d.from)) {
            refusals.push(Object.assign({}, where, {
              col: col, reason: 'diverged',
              loaded: d.from, nowLive: nowLive, wanted: d.to
            }));
            return;
          }
          fields[col] = writeVal(col, d.to);
        });

        if (Object.keys(fields).length) {
          writes.push({
            id: id, jobno: p.jobno, num: sec.num, title: liveRow.Title,
            fields: fields, suppressUntil: stamp
          });
        }
      });
    });
    return { writes: writes, refusals: refusals, errors: errors };
  }

  var REQUIRED_CREATE = ['jobno', 'name', 'start'];

  /* A create is never a partial update of arbitrary fields, so there is no
     FIELD_DEFS equivalent here.
     The uniqueness check spans live Jobs AND requests still Requested or
     Building, and guards duplicates within a single batch too. The documented
     run instructions actively train a re-run, because a request sits at
     "Building" for about sixteen minutes and looks stuck; two requests landing
     in one trigger batch yields 92 assignments and 590 tasks. */
  function planCreates(creates, liveJobNumbers, pendingJobNumbers) {
    var taken = {};
    (liveJobNumbers || []).concat(pendingJobNumbers || []).forEach(function (n) {
      taken[jobKey(n)] = true;
    });
    var out = [], refusals = [];

    (creates || []).forEach(function (c) {
      c = c || {};
      var missing = REQUIRED_CREATE.filter(function (k) {
        return !String(c[k] == null ? '' : c[k]).trim();
      });
      if (missing.length) {
        refusals.push({ jobno: c.jobno, reason: 'missing-required', missing: missing });
        return;
      }
      if (taken[jobKey(c.jobno)]) {
        refusals.push({ jobno: c.jobno, reason: 'duplicate-job-number' });
        return;
      }
      taken[jobKey(c.jobno)] = true;
      out.push({
        jobno: String(c.jobno).trim(), name: c.name, addr: c.addr || '',
        city: c.city || '', start: day(c.start),
        assignDefaultCrews: !!c.assignDefaultCrews
      });
    });
    return { creates: out, refusals: refusals };
  }

  return {
    ALLOWLIST: ALLOWLIST, FIELD_DEFS: FIELD_DEFS, titleMatches: titleMatches,
    jobKey: jobKey, suppressUntil: suppressUntil, planEdits: planEdits,
    planCreates: planCreates, day: day
  };
});
