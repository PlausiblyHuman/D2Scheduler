/* Apply a planner change-set to SharePoint: field edits on Assignments, and
 * new-pool requests on New Pool Requests.
 *
 * The exact inverse of `export-to-planner.js`: that script reads the live
 * schedule out of SharePoint and into the planner; this one reads the
 * change-set the planner's Save button downloaded and pushes it back.
 *
 * TWO INDEPENDENT PATHS, ONE FILE. `cs.pools` (field edits) and `cs.creates`
 * (new-pool requests) are unrelated in every way that matters: different
 * list, different write shape (MERGE on an existing row vs POST of a new
 * one), different safety property (compare-before-write vs a uniqueness
 * check), and creates never touch a single field on the edit allowlist.
 * They are reported through separate counters (`fieldsWritten` vs
 * `createsRequested`, etc.) so a batch that does both never conflates them.
 * See docs/superpowers/specs/2026-09-12-batch-write-back-design.md, "Create
 * and delete are two-phase, and the UI must say so".
 *
 * DRY_RUN DEFAULTS TRUE. This writes to a live client tenant. It still does
 * the full compare-before-write pass AND the creates uniqueness check, and
 * prints the plan for both with DRY_RUN true -- read that before flipping the
 * flag below and running it again. Nothing is created and nothing is merged
 * while DRY_RUN is true, including the digest fetch itself.
 *
 * WHY COMPARE-BEFORE-WRITE, NOT ETAGS, FOR EDITS. Several flows write to
 * Assignments on schedules that have nothing to do with a PM -- Calendar Sync
 * (hourly), Counter Reconciliation, Conflict Flag and Crew Trade Check
 * (nightly), and Event-Driven Reconciliation on any edit. Every one of those
 * bumps the row's version, so a row-level ETag would reject a PM's whole
 * batch because a nightly flow annotated the row overnight, over fields
 * nobody contested. Instead this re-reads the five owned fields on every row
 * in the change-set and compares each one against the BASELINE the file
 * carries (the value the planner loaded last). A field is written only if the
 * live value still matches that baseline; otherwise it is refused and
 * reported by sub-phase and field name. This is one paged read for the whole
 * batch, not one per row.
 *
 * WHY A UNIQUENESS CHECK, NOT ETAGS, FOR CREATES. A create has no baseline to
 * compare against -- the row does not exist yet. The only thing that can go
 * wrong is the SAME job number already being in use, which the planner and
 * `D2 - New Pool` have never checked against each other (D10 in
 * docs/planner-vs-sharepoint-parity.md: two independent job-number
 * generators, no check between them). So this re-reads live Jobs once for
 * the whole batch and refuses any create whose job number already exists.
 * REFUSED, NEVER SILENTLY RENAMED -- a PM picked that number for a reason.
 *
 * THE ALLOWLIST IS THE SAFETY PROPERTY OF THE EDIT PATH, enforced in code,
 * not assumed from what a file happens to contain. FIELD_DEFS below is the
 * only set of Assignments columns this script will ever read or write. A
 * change-set field outside that set is rejected before any network call and
 * reported, never silently dropped or silently kept. InstallerSignOff,
 * InstallerSignOffBy, InstallerSignOffOn, SignOffNotes, PMSignOff and every
 * Tasks-list field are never candidates: the planner has no attribution model
 * for a sign-off and must never be its authority. ScheduledFinish is derived
 * on the planner side (`workSpan(start,days).pop()`, the same arithmetic the
 * flows use) and is never sent either. The create path has no allowlist of
 * this kind because it writes exactly five fixed fields on a brand-new row --
 * see step 4b below -- never anything the caller supplies a column name for.
 *
 * SuppressReconcileUntil is set a few minutes ahead in the same MERGE as
 * every EDIT write, exactly as `D2 - Reschedule Pool` does, so a batch does
 * not burn one Event-Driven Reconciliation run per row. It is a timestamp,
 * never a boolean, because a boolean needs a second write to clear and a
 * failed clear would leave the row permanently invisible to conflict
 * detection. What this costs: a suppressed row gets no real-time conflict
 * check for that window. `D2 - Conflict Flag`'s nightly sweep and Nightly
 * Reconciliation both still cover it, and the planner's own Schedule Check
 * already ran locally before Save was pressed. A CREATE never needs this --
 * `D2 - New Pool` inserts the 46 Assignments rows itself and already accepts
 * the 92-run reconciliation cost of doing so (see CLAUDE.md, "New Pool's
 * accepted reconciliation cost").
 *
 * HOW TO RUN
 *   1. In the planner, press Save. Confirm the preview, download the
 *      change-set file.
 *   2. Open https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler
 *      signed in as a member with Edit rights.
 *   3. Paste this into the browser console (DevTools > Sources > Snippets
 *      avoids Chrome's paste guard; in the Console, type `allow pasting`
 *      first).
 *   4. Pick the change-set file when the picker opens.
 *   5. Read the plan -- it runs the full compare-before-write pass and the
 *      creates uniqueness check, and prints what WOULD happen even with
 *      DRY_RUN true, with nothing written or created yet.
 *   6. Set DRY_RUN to false below and run it again to actually write.
 *   7. If any pools were requested, WAIT. D2 - New Pool takes about 9 minutes
 *      measured -- allow 10-15. The request sits at "Building" the whole
 *      time in New Pool Requests and looks stuck, but is not. Use Load from
 *      D2 in the planner once it finishes to pull the pool in.
 *
 * ROW IDENTITY IS VERIFIED, NOT TRUSTED, for EDITS. A change-set names an
 * edit row by its SharePoint id alone. Before any field on that row is
 * compared or written, the row's live `Title` (e.g. "D2-1042 · 2.1
 * Engineering Review by PM") is checked against the change-set's own jobno
 * and sub-phase number, TOKEN-anchored on the spaces the format always
 * carries around each part -- deliberately not an exact-format match on the
 * whole string, since the separator is a non-ASCII middle dot and this
 * project has already lost time once assuming an exact rendered shape
 * instead of reading it. A plain substring test is not enough: "2.1" is a
 * substring of "2.10", and once any phase group gains a tenth sub-phase that
 * would silently write a "2.1" edit onto a "2.10" row. See `titleMatches`
 * for the exact anchoring. A mismatch refuses the whole row and reports it;
 * nothing about a mismatched row is ever compared or written. The live Title
 * is also what the dry-run plan prints, so a human reviewing it is reading
 * SharePoint's own account of the row, not the change-set file's. A CREATE
 * has no analogous check to make -- there is no existing row to be mistaken
 * for another one; the uniqueness check (step 4b) is its equivalent safety
 * property.
 *
 * FIELD SHAPES -- read off the same real payloads export-to-planner.js uses,
 * not guessed:
 *   - `Crew` is a Choice column. Raw REST with odata=nometadata reads and
 *     writes it as a PLAIN STRING (the short code, e.g. "devon") -- exactly
 *     what the planner's crewId already is and exactly what the change-set
 *     carries. Never the connector's {Id, Value} shape.
 *   - `ScheduledStart` (edits) and `StartDate` (creates) are both DateOnly
 *     columns. Both are written as a bare 'yyyy-MM-dd' string, which
 *     SharePoint stores at site-local midnight. An explicit ...T00:00:00Z is
 *     the off-by-one this project already fixed once on this exact class of
 *     column -- never write one, on either list.
 *   - `New Pool Requests.ProjectManager` is a required User column. A User
 *     column CANNOT be set from an email string over plain REST -- it needs
 *     the numeric site-user id, written as `ProjectManagerId`. `D2 - New
 *     Pool` resolves this the same way for a different reason (turning the
 *     connector trigger's `Claims` into an id via `ensureuser`, because the
 *     row already carries a Person value set through the SharePoint form).
 *     This script has no form in front of it, so it resolves the CURRENT
 *     signed-in user via `/_api/web/currentuser` instead -- a PM raising
 *     their own pool is the normal case, and `currentuser` needs no lookup
 *     of anyone else's identity.
 *   - A MERGE needs X-HTTP-Method: MERGE, IF-MATCH: *, a fresh
 *     X-RequestDigest from /_api/contextinfo, and the list's
 *     ListItemEntityTypeFullName read off the list metadata rather than
 *     hand-written -- hyphenated or spaced list names sanitize unpredictably,
 *     and this reads it for both Assignments and New Pool Requests rather
 *     than assume either. A plain POST (creates) needs the digest and the
 *     entity type but neither X-HTTP-Method nor IF-MATCH -- those are only
 *     for updating an existing item.
 */
(async () => {
  const DRY_RUN = true; // SAFE DEFAULT. Read the printed plan before setting this false.

  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=nometadata' };
  const day = v => (v ? String(v).slice(0, 10) : null);
  const CHUNK = 8; // item writes may run in parallel; field CREATES on the same list must be sequential (see CLAUDE.md) -- not relevant here, this script never creates fields.

  const WAIT_WARNING = 'D2 - New Pool takes about 9 minutes measured -- allow 10-15 minutes. '
    + 'Each request sits at "Building" the whole time in New Pool Requests and looks stuck, but is not. '
    + 'Use Load from D2 in the planner once it finishes to pull the pool in.';

  // ---- 1. THE ALLOWLIST for EDITS -- the only Assignments columns this
  // script will ever touch. `write` normalizes a change-set value before it
  // goes in a MERGE body; it defaults to identity. ScheduledStart is the one
  // field that needs it: the read side already slices a live DateOnly value
  // to a bare 'yyyy-MM-dd' via day(), and the write side must do the same to
  // whatever the change-set carries, or the two sides of this script disagree
  // about what the column holds. The planner cannot currently emit anything
  // but a bare date, so this is defensive rather than fixing an observed bad
  // write -- but this project has already fixed a date off-by-one across
  // every list once, on this exact class of column, and asymmetry between a
  // read and a write path is exactly how that kind of thing comes back. ----
  const FIELD_DEFS = {
    Crew:           { read: r => r.Crew || null,           eq: (a, b) => (a || null) === (b || null) },
    ScheduledStart: { read: r => day(r.ScheduledStart),    eq: (a, b) => (a || null) === (b || null), write: day },
    DurationDays:   { read: r => (r.DurationDays ?? null), eq: (a, b) => (a ?? null) === (b ?? null) },
    Locked:         { read: r => !!r.Locked,               eq: (a, b) => !!a === !!b },
    NotApplicable:  { read: r => !!r.NotApplicable,        eq: (a, b) => !!a === !!b }
  };
  const writeVal = (col, v) => (FIELD_DEFS[col].write ? FIELD_DEFS[col].write(v) : v);

  // The five fields a CREATE writes on a brand-new New Pool Requests row.
  // Fixed, never caller-supplied column names -- there is no equivalent of
  // FIELD_DEFS here because a create is never a partial update of arbitrary
  // fields. Status and Result are flow-owned, default to Requested, and are
  // hidden from the New form -- this script must never set either (see
  // sharepoint/configure-request-lists.js and CLAUDE.md).
  const REQUIRED_CREATE = ['jobno', 'name', 'start'];

  // ---- 2. paged read helper. Defined early because both the edit compare
  // pass and the create uniqueness check need it, and both must be immune to
  // list size the same way -- one read for the whole batch, not one per row
  // or one per create. ----
  async function all(path) {
    let url = site + path, out = [];
    while (url) {
      const r = await fetch(url, { headers: H, credentials: 'include' });
      if (!r.ok) throw new Error(r.status + ' on ' + url.slice(0, 120));
      const d = await r.json();
      out = out.concat(d.value || []);
      url = d['odata.nextLink'] || null;
    }
    return out;
  }

  // ---- 3. pick the change-set the planner's Save button downloaded ----
  const file = await new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = () => resolve(inp.files && inp.files[0]);
    inp.click();
  });
  if (!file) { console.log('No file chosen.'); return; }

  let cs;
  try { cs = JSON.parse(await file.text()); }
  catch (e) { console.error('That file is not valid JSON.'); return; }
  // A valid change-set carries at least one of pools/creates as an array --
  // the planner always emits both (empty arrays when there is nothing of
  // that kind), but this tolerates a hand-edited or older file missing one.
  if (!cs || cs.kind !== 'd2-planner-changeset' || (!Array.isArray(cs.pools) && !Array.isArray(cs.creates))) {
    console.error('That is not a D2 planner change-set (kind=' + (cs && cs.kind) +
      '). Use the Save button in the planner -- not Backup, and not a Load-from-D2 export.');
    return;
  }
  const poolsIn = Array.isArray(cs.pools) ? cs.pools : [];

  // ---- 4. flatten EDITS to one entry per SharePoint row, enforcing the
  // allowlist BEFORE any network call. A field outside FIELD_DEFS is rejected
  // here and never reaches a live read or a write, no matter how the file got
  // built. `Object.hasOwn`, not `!FIELD_DEFS[col]` -- a plain truthiness
  // check on an object lets an inherited key (`constructor`, `toString`,
  // `valueOf`, even `__proto__`) through as if it were an allowed column, and
  // it would then throw inside `def.read(...)` rather than being reported as
  // a rejection. That throw happens before any network call too, so nothing
  // is written -- but it surfaces as a crash instead of a clean, reported
  // refusal.
  //
  // A row id repeated within one change-set is dropped entirely, both
  // occurrences, and reported -- never last-write-wins. A legitimate
  // change-set never repeats a row id (each sub-phase appears once per pool),
  // so a repeat means the file is malformed or was tampered with, and this is
  // not the place to guess which copy was meant. ----
  const rejected = [];
  const rows = new Map(); // Assignments row id -> {jobno, name, num, secName, fields:{col:{from,to}}}
  const seenIds = new Set();
  poolsIn.forEach(p => {
    (p.sections || []).forEach(sec => {
      if (sec.id == null) { rejected.push({ jobno: p.jobno, num: sec.num, reason: 'no SharePoint row id' }); return; }
      if (seenIds.has(sec.id)) {
        rejected.push({ jobno: p.jobno, num: sec.num, id: sec.id, reason: 'duplicate row id in change-set -- row dropped entirely' });
        rows.delete(sec.id);
        return;
      }
      seenIds.add(sec.id);
      const fields = {};
      Object.entries(sec.fields || {}).forEach(([col, v]) => {
        if (!Object.hasOwn(FIELD_DEFS, col)) { rejected.push({ jobno: p.jobno, num: sec.num, field: col, reason: 'not in the write-back allowlist' }); return; }
        fields[col] = v;
      });
      if (Object.keys(fields).length) {
        rows.set(sec.id, { jobno: p.jobno, name: p.name, num: sec.num, secName: sec.name, fields });
      }
    });
  });
  if (rejected.length) {
    console.warn(rejected.length + ' field(s) rejected before any read -- never in scope for this script.');
    console.table(rejected);
  }

  // ---- 4b. flatten CREATES, enforcing required fields and de-duplicating by
  // job number BEFORE any network call -- the same discipline as step 4, on
  // a wholly different list. A create missing jobno/name/start cannot be
  // raised at all (New Pool Requests itself requires JobNumber, StartDate and
  // Title); a job number repeated within one change-set is dropped entirely,
  // both occurrences, never last-write-wins, for the same reason a repeated
  // row id is dropped above. ----
  const rejectedCreates = [];
  const createsByJobno = new Map();
  (Array.isArray(cs.creates) ? cs.creates : []).forEach(c => {
    const jobno = c && c.jobno != null ? String(c.jobno).trim() : '';
    const missing = REQUIRED_CREATE.filter(k => !(c && String(c[k] == null ? '' : c[k]).trim()));
    if (!jobno || missing.length) {
      rejectedCreates.push({ jobno: jobno || '(blank)', reason: 'missing required field(s): ' + (missing.join(', ') || 'jobno') });
      return;
    }
    if (createsByJobno.has(jobno)) {
      rejectedCreates.push({ jobno, reason: 'duplicate job number in this change-set -- request dropped entirely' });
      createsByJobno.delete(jobno);
      return;
    }
    createsByJobno.set(jobno, {
      jobno, name: String(c.name).trim(),
      addr: c.addr ? String(c.addr) : '', city: c.city ? String(c.city) : '',
      start: day(c.start)
    });
  });
  const creates = [...createsByJobno.values()];
  if (rejectedCreates.length) {
    console.warn(rejectedCreates.length + ' new-pool request(s) rejected before any read -- malformed or duplicated in this change-set.');
    console.table(rejectedCreates);
  }

  if (!rows.size && !creates.length) {
    console.log('Nothing to push.');
    return {
      dryRun: DRY_RUN, rowsWritten: 0, fieldsWritten: 0, fieldsRefused: 0,
      rowsMissing: 0, rowsMismatched: 0, fieldsRejected: rejected.length,
      createsRequested: 0, createsBlocked: 0, createsRejected: rejectedCreates.length, createsFailed: [],
      failed: [], verifyMismatch: [], createVerifyMismatch: []
    };
  }

  // ---- 5. re-read the live Assignments rows for EDITS. ONE paged read for
  // the whole batch, not one per row, so this is immune to unrelated writes
  // elsewhere in the list and costs the same whether the batch is one row or
  // a whole pool. Title rides along for identity verification -- see the
  // header comment. Skipped entirely when there is nothing to compare, so a
  // change-set carrying only creates never reads Assignments at all. ----
  const SELECT = "?$select=Id,Title,Crew,ScheduledStart,DurationDays,Locked,NotApplicable&$top=2000&$orderby=Id";
  let liveById = new Map();
  if (rows.size) {
    const live = await all("/_api/web/lists/GetByTitle('Assignments')/items" + SELECT);
    liveById = new Map(live.map(r => [r.Id, r]));
  }

  // Token-anchored, deliberately not an exact-format match -- see the header
  // comment ("ROW IDENTITY IS VERIFIED, NOT TRUSTED"). A plain substring test
  // on `num` alone matched "2.1" inside "2.10" -- a real row could silently
  // take another sub-phase's write once a phase group reaches a tenth
  // sub-phase. `jobno` had the same hole: "D2-104" matched "D2-1042". Anchor
  // both on the spaces the format always carries around them (jobno is
  // always followed by a space before the middle dot; num is always preceded
  // by a space and, since a name always follows it in this project's
  // template, followed by one too -- `endsWith` covers the case where it
  // does not). Do not anchor on the middle dot itself; it is non-ASCII and
  // this project has already lost time once assuming an exact rendered shape
  // instead of reading it.
  function titleMatches(title, jobno, num) {
    if (typeof title !== 'string' || !title) return false;
    const j = String(jobno), n = String(num);
    if (!title.startsWith(j + ' ')) return false;
    return title.includes(' ' + n + ' ') || title.endsWith(' ' + n);
  }

  // ---- 6. compare-before-write, per FIELD, not per row. A row with two
  // changed fields can have one refused and the other still land. A row whose
  // live Title does not name this pool/sub-phase is refused WHOLESALE, before
  // any field on it is compared -- see the header comment. A no-op (empty
  // `rows`) simply produces empty results here. ----
  const planned = [], refused = [], missing = [], mismatched = [];
  const toWrite = [];
  rows.forEach((row, id) => {
    const liveRow = liveById.get(id);
    if (!liveRow) { missing.push({ jobno: row.jobno, num: row.num, id }); return; }
    if (!titleMatches(liveRow.Title, row.jobno, row.num)) {
      mismatched.push({ jobno: row.jobno, num: row.num, id, liveTitle: liveRow.Title || '(blank)' });
      return;
    }
    const body = {};
    Object.entries(row.fields).forEach(([col, { from, to }]) => {
      const def = FIELD_DEFS[col];
      const liveVal = def.read(liveRow);
      if (def.eq(liveVal, from)) {
        body[col] = writeVal(col, to);
        planned.push({ jobno: row.jobno, num: row.num, name: row.secName, id, field: col, from, to: body[col], liveTitle: liveRow.Title });
      } else {
        refused.push({ jobno: row.jobno, num: row.num, name: row.secName, id, field: col, loaded: from, live: liveVal, wanted: to });
      }
    });
    if (Object.keys(body).length) toWrite.push({ id, body, jobno: row.jobno, num: row.num });
  });

  console.log(toWrite.length + ' row(s), ' + planned.length + ' field write(s) planned. '
    + refused.length + ' field(s) refused (changed in SharePoint since this was loaded). '
    + missing.length + ' row(s) no longer exist. '
    + mismatched.length + ' row(s) refused -- live Title does not name this pool/sub-phase.');
  if (planned.length) console.table(planned.map(p => ({ pool: p.jobno, subPhase: p.num, field: p.field, from: p.from, to: p.to, liveTitle: p.liveTitle })));
  if (refused.length) console.table(refused.map(r => ({ pool: r.jobno, subPhase: r.num, field: r.field, loaded: r.loaded, nowLive: r.live, wanted: r.wanted })));
  if (missing.length) console.table(missing);
  if (mismatched.length) console.table(mismatched);

  // ---- 6b. THE UNIQUENESS CHECK for CREATES. One read of live Jobs for the
  // whole batch, exactly like the compare-before-write read above. A create
  // whose job number is already live is refused, never silently renamed --
  // a PM picked that number for a reason, and this is the check that has
  // never existed (D10). Skipped entirely when there is nothing to create. ----
  let createsPlanned = [], createsBlocked = [];
  if (creates.length) {
    const liveJobs = await all("/_api/web/lists/GetByTitle('Jobs')/items?$select=JobNumber&$top=5000");
    const liveJobNumbers = new Set(liveJobs.map(r => String(r.JobNumber)));
    creates.forEach(c => {
      if (liveJobNumbers.has(c.jobno)) {
        createsBlocked.push({ jobno: c.jobno, name: c.name, reason: 'a Jobs row with this job number already exists live -- refusing to create a duplicate pool' });
      } else {
        createsPlanned.push(c);
      }
    });
    console.log(createsPlanned.length + ' new pool request(s) planned. '
      + createsBlocked.length + ' refused -- job number already exists live.');
    if (createsPlanned.length) console.table(createsPlanned);
    if (createsBlocked.length) console.table(createsBlocked);
    if (createsPlanned.length) console.log(WAIT_WARNING);
  }

  if (DRY_RUN) {
    console.log('DRY_RUN -- nothing written or created. Set DRY_RUN to false at the top of this script and run it again to push '
      + toWrite.length + ' row(s) and raise ' + createsPlanned.length + ' new pool request(s).');
    return {
      dryRun: true, rowsWritten: 0, wouldWriteRows: toWrite.length,
      fieldsWritten: 0, fieldsPlanned: planned.length, fieldsRefused: refused.length,
      rowsMissing: missing.length, rowsMismatched: mismatched.length, fieldsRejected: rejected.length,
      failed: [], verifyMismatch: [],
      planned, refused, missing, mismatched, rejected,
      createsRequested: 0, wouldCreatePools: createsPlanned.length, createsBlocked: createsBlocked.length,
      createsRejected: rejectedCreates.length, createsFailed: [], createVerifyMismatch: [],
      plannedCreates: createsPlanned, blockedCreates: createsBlocked, rejectedCreates
    };
  }
  if (!toWrite.length && !createsPlanned.length) {
    console.log('Nothing left to write after compare-before-write and the uniqueness check.');
    return {
      dryRun: false, rowsWritten: 0, fieldsWritten: 0, fieldsRefused: refused.length,
      rowsMissing: missing.length, rowsMismatched: mismatched.length, fieldsRejected: rejected.length,
      failed: [], verifyMismatch: [],
      createsRequested: 0, createsBlocked: createsBlocked.length, createsRejected: rejectedCreates.length,
      createsFailed: [], createVerifyMismatch: []
    };
  }

  // ---- 7. digest, shared by both paths -- it is site-wide, not list-
  // specific, so one fetch covers a MERGE on Assignments and a POST on New
  // Pool Requests alike. ----
  const dg = await (await fetch(site + '/_api/contextinfo', {
    method: 'POST', credentials: 'include', headers: { Accept: 'application/json;odata=verbose' }
  })).json();
  const digest = dg.d.GetContextWebInformation.FormDigestValue;

  // ---- 8. write EDITS, in chunks of 8. Item writes may run in parallel; it
  // is field CREATES on the same list that must be sequential (see
  // CLAUDE.md) -- not applicable here, this script only creates ITEMS. ----
  const failed = [];
  if (toWrite.length) {
    const meta = await (await fetch(site + "/_api/web/lists/GetByTitle('Assignments')?$select=ListItemEntityTypeFullName",
      { headers: H, credentials: 'include' })).json();
    const entityType = meta.ListItemEntityTypeFullName;

    async function mergeRow(id, body) {
      const r = await fetch(site + "/_api/web/lists/GetByTitle('Assignments')/items(" + id + ")", {
        method: 'POST', credentials: 'include',
        headers: {
          Accept: 'application/json;odata=verbose',
          'Content-Type': 'application/json;odata=verbose',
          'X-RequestDigest': digest,
          'X-HTTP-Method': 'MERGE',
          'IF-MATCH': '*'
        },
        body: JSON.stringify({ __metadata: { type: entityType }, ...body })
      });
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 300));
    }
    for (let i = 0; i < toWrite.length; i += CHUNK) {
      const chunk = toWrite.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async row => {
        const body = { ...row.body, SuppressReconcileUntil: new Date(Date.now() + 10 * 60000).toISOString() };
        try { await mergeRow(row.id, body); }
        catch (e) { failed.push({ jobno: row.jobno, num: row.num, id: row.id, error: String(e.message || e) }); }
      }));
    }
  }

  // ---- 8b. create the New Pool Requests rows. ProjectManager is resolved
  // ONCE, to the current signed-in user -- see the header comment for why
  // that identity and not the change-set's own name/notes fields. Status and
  // Result are never set: both are flow-owned, default to Requested, and are
  // hidden from the New form (sharepoint/configure-request-lists.js). ----
  const createdOk = [], createFailed = [];
  if (createsPlanned.length) {
    const cu = await (await fetch(site + '/_api/web/currentuser', { headers: H, credentials: 'include' })).json();
    const pmId = cu.Id;
    const cMeta = await (await fetch(site + "/_api/web/lists/GetByTitle('New Pool Requests')?$select=ListItemEntityTypeFullName",
      { headers: H, credentials: 'include' })).json();
    const createEntityType = cMeta.ListItemEntityTypeFullName;

    async function createRequest(c) {
      const r = await fetch(site + "/_api/web/lists/GetByTitle('New Pool Requests')/items", {
        method: 'POST', credentials: 'include',
        headers: {
          Accept: 'application/json;odata=verbose',
          'Content-Type': 'application/json;odata=verbose',
          'X-RequestDigest': digest
        },
        body: JSON.stringify({
          __metadata: { type: createEntityType },
          Title: c.name, JobNumber: c.jobno,
          Address: c.addr || '', City: c.city || '',
          StartDate: c.start, ProjectManagerId: pmId
        })
      });
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 300));
    }
    for (let i = 0; i < createsPlanned.length; i += CHUNK) {
      const chunk = createsPlanned.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async c => {
        try { await createRequest(c); createdOk.push(c); }
        catch (e) { createFailed.push({ jobno: c.jobno, error: String(e.message || e) }); }
      }));
    }
  }

  // ---- 9. verify EDITS by reading back, never by the status code ----
  const failedIds = new Set(failed.map(f => f.id));
  const writtenPlan = planned.filter(p => !failedIds.has(p.id));
  let verifyMismatch = [];
  if (toWrite.length) {
    const after = await all("/_api/web/lists/GetByTitle('Assignments')/items" + SELECT);
    const afterById = new Map(after.map(r => [r.Id, r]));
    verifyMismatch = writtenPlan.filter(p => {
      const r = afterById.get(p.id); if (!r) return true;
      return !FIELD_DEFS[p.field].eq(FIELD_DEFS[p.field].read(r), p.to);
    });
  }

  // ---- 9b. verify CREATES the same way -- by reading New Pool Requests
  // back, never by the 201 status code. Catches exactly the "write returns
  // success and does nothing" signature this whole project watches for. ----
  let createVerifyMismatch = [];
  if (createdOk.length) {
    const afterRequests = await all("/_api/web/lists/GetByTitle('New Pool Requests')/items?$select=Id,Title,JobNumber,StartDate&$top=2000");
    const byJobno = new Map(afterRequests.map(r => [String(r.JobNumber), r]));
    createVerifyMismatch = createdOk.filter(c => {
      const r = byJobno.get(c.jobno);
      return !r || r.Title !== c.name || day(r.StartDate) !== c.start;
    });
  }

  const out = {
    dryRun: false,
    rowsWritten: toWrite.length - failed.length,
    fieldsWritten: writtenPlan.length,
    fieldsRefused: refused.length,
    rowsMissing: missing.length,
    rowsMismatched: mismatched.length,
    fieldsRejected: rejected.length,
    failed,
    verifyMismatch,
    createsRequested: createdOk.length,
    createsBlocked: createsBlocked.length,
    createsRejected: rejectedCreates.length,
    createsFailed: createFailed,
    createVerifyMismatch
  };
  console.log(JSON.stringify(out, null, 2));
  if (failed.length) console.table(failed);
  if (verifyMismatch.length) console.warn('Verify found ' + verifyMismatch.length + ' field(s) that did not read back as written -- see verifyMismatch.');
  if (createFailed.length) console.table(createFailed);
  if (createVerifyMismatch.length) console.warn('Verify found ' + createVerifyMismatch.length + ' new-pool request(s) that did not read back as written -- see createVerifyMismatch.');
  if (createdOk.length) console.log(WAIT_WARNING);
  return out;
})();
