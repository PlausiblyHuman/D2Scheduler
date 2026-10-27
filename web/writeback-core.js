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
     ScheduledFinish is derived from start plus duration, so it is never taken
     from a change-set; planEdits computes it and sends it alongside a start or
     duration that lands (see finishFor below).
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

        /* The finish travels with the start and the duration. Every flow
           reads ScheduledFinish, so leaving it behind put the finish before
           the start on every row a reflow moved. It is derived, never taken
           from the change-set, and computed from what LANDS: when the
           duration was refused, the live duration still stands. The caller
           supplies finishFor because only it holds the work calendar. */
        if (opts.finishFor && ('ScheduledStart' in fields || 'DurationDays' in fields)) {
          var st = 'ScheduledStart' in fields ? fields.ScheduledStart : FIELD_DEFS.ScheduledStart.read(liveRow);
          var dd = 'DurationDays' in fields ? fields.DurationDays : FIELD_DEFS.DurationDays.read(liveRow);
          if (st && dd > 0) fields.ScheduledFinish = opts.finishFor(st, dd);
        }

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
        assignDefaultCrews: !!c.assignDefaultCrews,
        // Choice columns validate nothing on a REST write; normalise here.
        buildType: c.buildType === 'Fiberglass' ? 'Fiberglass' : 'Gunite',
        // The PM picked on + Job, as a site-user id. Null means "whoever is
        // signed in when Save runs", resolved by the caller.
        pmId: c.pmId == null || c.pmId === '' ? null : String(c.pmId)
      });
    });
    return { creates: out, refusals: refusals };
  }


  /* ==================== sign-off and task ticks ==============================
     A SEPARATE path from planEdits, deliberately.

     planEdits handles plain fields: read the live value, compare, PATCH. Sign-off
     is not a plain field. Setting it writes a Person column and a timestamp;
     CLEARING it is a Reopen, which this project requires to leave a trace of who
     reopened and when. Routing either through FIELD_DEFS would have meant losing
     the attribution or bending the plain-field path into something it is not.

     WHY THIS EXISTS AT ALL, since the repo said for months that it must not:
     the objection was never sign-off, it was that the planner held sign-off as a
     bare boolean with no attribution, so writing it back would replace an
     attested sign-off with a flag. The planner now signs the user in and can
     resolve them to a site-user id, so it writes WHO and WHEN. Decided by Shane
     2026-09-16, when the pilot became planner-only with no field crews on the
     canvas app: sign-off has to be recordable here or it is recordable nowhere.

     PM sign-off carries NO attribution column. There is no PMSignOffBy on this
     list -- only InstallerSignOff has By/On. That is the existing schema, read
     off a live payload, not an omission here. */

  function planSignoffs(pools, liveById, opts) {
    opts = opts || {};
    var userId = opts.userLookupId == null ? null : String(opts.userLookupId);
    var userName = opts.userName || 'the planner';
    var nowIso = opts.nowIso
      || new Date(opts.nowMs == null ? Date.now() : opts.nowMs).toISOString();
    var writes = [], refusals = [], errors = [];

    (pools || []).forEach(function (p) {
      (p.sections || []).forEach(function (sec) {
        var id = String(sec.id);
        var where = { id: id, jobno: p.jobno, num: sec.num };
        var live = liveById && liveById[id];
        if (!live) { errors.push(Object.assign({}, where, { reason: 'row-missing' })); return; }
        if (!titleMatches(live.Title, p.jobno, sec.num)) {
          errors.push(Object.assign({}, where,
            { reason: 'identity-mismatch', liveTitle: live.Title }));
          return;
        }

        var fields = {}, kinds = [];

        if (sec.inst && !!sec.inst.from !== !!sec.inst.to) {
          if (!!live.InstallerSignOff !== !!sec.inst.from) {
            refusals.push(Object.assign({}, where, {
              col: 'InstallerSignOff', reason: 'diverged',
              loaded: !!sec.inst.from, nowLive: !!live.InstallerSignOff, wanted: !!sec.inst.to
            }));
          } else if (sec.inst.to && !userId) {
            /* Refuse rather than write an unattributed sign-off. A flag with no
               name on it is the exact thing this path exists to avoid. */
            refusals.push(Object.assign({}, where, {
              col: 'InstallerSignOff', reason: 'no-user',
              loaded: false, nowLive: !!live.InstallerSignOff, wanted: true
            }));
          } else if (sec.inst.to) {
            fields.InstallerSignOff = true;
            fields.InstallerSignOffByLookupId = userId;
            fields.InstallerSignOffOn = nowIso;
            kinds.push('signed');
          } else {
            /* Reopen. Clear the flag, the attribution AND the timestamp, and
               append a line saying who undid it and who had signed, so a
               correction is deliberate and traceable rather than a silent edit
               under a completed sign-off. This matches D2 - Reopen Sign-off,
               the field app's route to the same record, field for field: two
               surfaces writing one audit trail must not write it two ways. */
            var names = opts.userNamesById || {};
            var signerId = live.InstallerSignOffByLookupId;
            var wasSignedBy = signerId == null ? null
              : (names[String(signerId)] || 'unknown');
            fields.InstallerSignOff = false;
            fields.InstallerSignOffByLookupId = null;
            fields.InstallerSignOffOn = null;
            fields.SignOffNotes = appendReopen(live.SignOffNotes, userName, nowIso, wasSignedBy);
            kinds.push('reopened');
          }
        }

        if (sec.pm && !!sec.pm.from !== !!sec.pm.to) {
          if (!!live.PMSignOff !== !!sec.pm.from) {
            refusals.push(Object.assign({}, where, {
              col: 'PMSignOff', reason: 'diverged',
              loaded: !!sec.pm.from, nowLive: !!live.PMSignOff, wanted: !!sec.pm.to
            }));
          } else {
            fields.PMSignOff = !!sec.pm.to;
            kinds.push(sec.pm.to ? 'pm-signed' : 'pm-cleared');
          }
        }

        /* Counters ride along on the same row when tasks changed, so Don's
           morning compliance figures are right without waiting for the nightly
           Counter Reconciliation sweep to repair them. */
        if (sec.counters && (sec.counters.done != null)) {
          fields.TasksComplete = sec.counters.done;
          if (sec.counters.total != null) fields.TasksTotal = sec.counters.total;
          if (!kinds.length) kinds.push('counters');
        }

        if (Object.keys(fields).length) {
          writes.push({
            id: id, jobno: p.jobno, num: sec.num, title: live.Title,
            fields: fields, kinds: kinds
          });
        }
      });
    });
    return { writes: writes, refusals: refusals, errors: errors };
  }

  /* Rejections, resolutions and plain comments.
     A SEPARATE path from planSignoffs and planEdits, for the same reason
     planSignoffs is separate: the write is not a field diff. A rejection is an
     action a PM takes once, with a reason attached, and it produces TWO writes
     on two lists that must land in order. Routing it through FIELD_DEFS would
     have meant inventing a from/to for something that has neither.

     Compare-before-write is against the live ROW STATE, not against a loaded
     baseline, so rejection state never enters s.base. */
  function planRejections(pools, liveById, opts) {
    opts = opts || {};
    var userName = opts.userName || 'the planner';
    var names = opts.userNamesById || {};
    var nowIso = opts.nowIso
      || new Date(opts.nowMs == null ? Date.now() : opts.nowMs).toISOString();
    var stamp = suppressUntil(opts.nowMs == null ? Date.parse(nowIso) : opts.nowMs,
                              opts.suppressMinutes == null ? 10 : opts.suppressMinutes);
    var ops = [], refusals = [], errors = [];

    (pools || []).forEach(function (p) {
      (p.sections || []).forEach(function (sec) {
        var id = String(sec.id);
        var live = liveById && liveById[id];

        (sec.actions || []).forEach(function (a) {
          var where = { localId: a.localId, kind: a.kind, id: id,
                        jobno: p.jobno, num: sec.num, name: sec.name };
          if (!live) { errors.push(Object.assign({}, where, { reason: 'row-missing' })); return; }
          if (!titleMatches(live.Title, p.jobno, sec.num)) {
            errors.push(Object.assign({}, where,
              { reason: 'identity-mismatch', liveTitle: live.Title }));
            return;
          }

          var body = a.body == null ? '' : String(a.body).trim();
          var post = { Title: p.jobno + ' ' + sec.num, AssignmentLookupId: id,
                       Kind: null, Body: body };
          var fields = null;

          if (a.kind === 'reject') {
            if (!body) { refusals.push(Object.assign({}, where, { reason: 'reason-required' })); return; }
            /* Rejected is checked BEFORE InstallerSignOff, deliberately: a
               reject clears InstallerSignOff as part of the same write, so an
               already-rejected row always reads not-signed too. Checking
               sign-off first would make already-rejected unreachable and
               report the less specific reason for the exact case it exists to
               name. */
            if (live.Rejected) {
              refusals.push(Object.assign({}, where,
                { reason: 'already-rejected', liveReason: live.RejectedReason || null })); return;
            }
            if (!live.InstallerSignOff) {
              refusals.push(Object.assign({}, where, { reason: 'not-signed' })); return;
            }
            var signerId = live.InstallerSignOffByLookupId;
            var wasSignedBy = signerId == null ? null : (names[String(signerId)] || 'unknown');
            fields = {
              InstallerSignOff: false,
              InstallerSignOffByLookupId: null,
              InstallerSignOffOn: null,
              SignOffNotes: appendRejected(live.SignOffNotes, userName, nowIso, wasSignedBy, body),
              Rejected: true,
              RejectedOn: nowIso,
              RejectedReason: body
            };
            post.Kind = 'Rejected';

          } else if (a.kind === 'resolve') {
            if (!live.Rejected) {
              refusals.push(Object.assign({}, where, { reason: 'not-rejected' })); return;
            }
            /* RejectedOn is deliberately left in place. It is when the problem
               was raised, which stays true after it is fixed. */
            fields = { Rejected: false, RejectedReason: null };
            post.Kind = 'Resolved';

          } else if (a.kind === 'comment') {
            if (!body) { refusals.push(Object.assign({}, where, { reason: 'body-required' })); return; }
            post.Kind = 'Comment';

          } else {
            errors.push(Object.assign({}, where, { reason: 'unknown-kind' })); return;
          }

          ops.push({
            localId: a.localId, kind: a.kind, id: id, jobno: p.jobno, num: sec.num,
            name: sec.name, title: live.Title,
            patch: fields ? { id: id, fields: fields, suppressUntil: stamp } : null,
            post: post
          });
        });
      });
    });
    return { ops: ops, refusals: refusals, errors: errors };
  }

  /* Same shape as D2 - Reopen Sign-off writes:
       <previous notes>  |  REOPENED yyyy-MM-dd HH:mm by <who> (was signed by <name>)
     in CENTRAL time, which is what the flow's convertTimeZone produces and what
     everyone reading the notes is on. A bare UTC stamp reads five or six hours
     wrong to a PM in the office, with nothing on the line to say so. */
  function centralStamp(iso) {
    var d = new Date(iso);
    try {
      var parts = {};
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
      return parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute;
    } catch (e) {
      // No time zone data: say it is UTC rather than pass it off as local.
      return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    }
  }

  function appendReopen(existing, who, nowIso, wasSignedBy) {
    var line = 'REOPENED ' + centralStamp(nowIso) + ' by ' + who
      + (wasSignedBy ? ' (was signed by ' + wasSignedBy + ')' : '')
      + ' (from the planner)';
    var prev = existing == null ? '' : String(existing);
    return prev ? prev + '  |  ' + line : line;
  }

  /* Same shape and separator as appendReopen, because both land in the same
     SignOffNotes column and are read by the same person. A rejection IS a
     reopen with a reason on it, so it says who rejected, who had signed, and
     why, in Central time. */
  function appendRejected(existing, who, nowIso, wasSignedBy, reason) {
    var line = 'REJECTED ' + centralStamp(nowIso) + ' by ' + who
      + (wasSignedBy ? ' (was signed by ' + wasSignedBy + ')' : '')
      + ': ' + reason;
    var prev = existing == null ? '' : String(existing);
    return prev ? prev + '  |  ' + line : line;
  }

  /* Task counters must describe the rows as they ARE after the save, not as
     this screen believed they would be. planSignoffs takes the counters from
     the planner's own count, which is wrong the moment any tick on that
     sub-phase is refused or fails, or somebody else ticked a different task
     since the last Refresh. So once the task writes have been applied, recount
     from the live rows with only the writes that actually LANDED laid on top.

       writes        -- planSignoffs writes (mutated in place and returned)
       sectionsById  -- the sign-off set's sections, keyed by assignment id
       liveRowsByAsg -- every live Tasks row for that assignment
       landedIds     -- ids of task writes that returned OK

     With no live rows for an assignment the planner's count is left alone:
     guessing zero would be worse than a number the nightly sweep repairs. */
  function settleCounters(writes, sectionsById, liveRowsByAsg, landedIds) {
    var landed = {};
    (landedIds || []).forEach(function (id) { landed[String(id)] = true; });
    (writes || []).forEach(function (w) {
      if (!('TasksComplete' in w.fields)) return;
      var rows = (liveRowsByAsg || {})[String(w.id)] || [];
      if (!rows.length) return;
      var sec = (sectionsById || {})[String(w.id)] || {};
      var to = {};
      (sec.tasks || []).forEach(function (t) {
        if (t.id != null && landed[String(t.id)]) to[String(t.id)] = !!t.to.done;
      });
      var done = rows.filter(function (r) {
        var id = String(r.id);
        return Object.prototype.hasOwnProperty.call(to, id) ? to[id] : !!r.Complete;
      }).length;
      w.fields.TasksComplete = done;
      w.fields.TasksTotal = rows.length;
    });
    return writes;
  }

  /* The one change a checklist takes under a standing sign-off (Shane,
     2026-10-23): a plain tick, to do -> Done, on a task that is not N/A. Don
     signs finished projects whole and then wants their checklists to read
     done; making him reopen 45 sub-phases to tick them produced the stuck
     state of 2026-10-23. Unticking, and setting or clearing N/A, still need a
     reopen: the lock exists to stop a silent untick under an attestation, and
     an N/A changes what the attestation covers. The planner's drawer and its
     "Save first" guard use this same test. */
  function isPlainTick(t) {
    return !t.from.done && !!t.to.done && !t.from.na && !t.to.na;
  }

  /* One write per task row whose state actually changed. Compare-before-write
     per task, same as every other path here: a tick somebody else made after
     this planner loaded is refused, not overwritten. */
  function planTaskTicks(pools, liveTaskById, opts) {
    opts = opts || {};
    var userId = opts.userLookupId == null ? null : String(opts.userLookupId);
    var nowIso = opts.nowIso
      || new Date(opts.nowMs == null ? Date.now() : opts.nowMs).toISOString();
    var writes = [], refusals = [], errors = [];

    /* Sign-off locks the checklist (decided 2026-09-06). A task change on a
       sub-phase SharePoint holds as signed is refused unless this same save
       reopens it -- otherwise the attestation says "signed, 5 of 6" while the
       rows underneath say something else. A plain tick is the exception (see
       isPlainTick). Only enforced when the caller passes the live assignment
       rows. */
    var liveAsg = opts.liveAsgById || null;

    (pools || []).forEach(function (p) {
      (p.sections || []).forEach(function (sec) {
        var liveRow = liveAsg && sec.id != null ? liveAsg[String(sec.id)] : null;
        /* A rejection reopens the sub-phase, so it satisfies this the same way
           an explicit INST un-tick does. Without it a PM who rejects and ticks
           the fix in one Save has every tick refused. */
        var lockedBySignoff = !!(liveRow && liveRow.InstallerSignOff)
          && !(sec.inst && sec.inst.to === false)
          && !sec.rejecting;
        (sec.tasks || []).forEach(function (t) {
          var where = { id: t.id == null ? null : String(t.id),
                        jobno: p.jobno, num: sec.num, task: t.title };
          if (t.id == null) {
            /* No row id means this task was never matched to SharePoint, which
               happens for a pool that only exists in this browser. Reported so
               it cannot be mistaken for a successful write. */
            errors.push(Object.assign({}, where, { reason: 'no-row-id' }));
            return;
          }
          var live = liveTaskById && liveTaskById[String(t.id)];
          if (!live) { errors.push(Object.assign({}, where, { reason: 'row-missing' })); return; }

          var doneChanged = !!t.from.done !== !!t.to.done;
          var naChanged = !!t.from.na !== !!t.to.na;
          if (!doneChanged && !naChanged) return;

          if (lockedBySignoff && !isPlainTick(t)) {
            refusals.push(Object.assign({}, where, { col: 'Complete', reason: 'signed-off' }));
            return;
          }

          /* An N/A must carry its reason (Tasks.Note), the same rule the field
             app enforces. Without one, "mark it all N/A and sign off" is a
             second rubber-stamp route and the sign-off gate means nothing.
             Refused before the compare, so it can never be written. */
          var reason = String(t.to.note == null ? '' : t.to.note).trim();
          if (t.to.na && naChanged && !reason) {
            errors.push(Object.assign({}, where, { reason: 'na-no-reason' }));
            return;
          }

          if (!!live.Complete !== !!t.from.done || !!live.NotApplicable !== !!t.from.na) {
            refusals.push(Object.assign({}, where, {
              col: 'Complete', reason: 'diverged',
              loaded: { done: !!t.from.done, na: !!t.from.na },
              nowLive: { done: !!live.Complete, na: !!live.NotApplicable },
              wanted: { done: !!t.to.done, na: !!t.to.na }
            }));
            return;
          }

          var fields = { Complete: !!t.to.done, NotApplicable: !!t.to.na };
          // Setting N/A writes the reason; clearing it clears the reason, as the
          // field app does. A done tick on a task that was never N/A leaves Note alone.
          if (naChanged) fields.Note = t.to.na ? reason : '';
          if (t.to.done) {
            fields.CompletedOn = nowIso;
            /* CompletedBy is free to populate and the timestamps are what expose
               rubber-stamping, so it is written when known. It is not required:
               the attestation that matters is the sub-phase sign-off. */
            if (userId) fields.CompletedByLookupId = userId;
          } else {
            fields.CompletedOn = null;
            fields.CompletedByLookupId = null;
          }
          writes.push({ id: String(t.id), jobno: p.jobno, num: sec.num,
                        task: t.title, fields: fields });
        });
      });
    });
    return { writes: writes, refusals: refusals, errors: errors };
  }

  return {
    ALLOWLIST: ALLOWLIST, FIELD_DEFS: FIELD_DEFS, titleMatches: titleMatches,
    jobKey: jobKey, suppressUntil: suppressUntil, planEdits: planEdits,
    planCreates: planCreates, day: day,
    planSignoffs: planSignoffs, planTaskTicks: planTaskTicks, isPlainTick: isPlainTick,
    appendReopen: appendReopen, centralStamp: centralStamp, settleCounters: settleCounters,
    planRejections: planRejections, appendRejected: appendRejected
  };
});
