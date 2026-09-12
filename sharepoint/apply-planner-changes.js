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
 * generators, no check between them). So this re-reads live Jobs AND live
 * New Pool Requests once each for the whole batch and refuses any create
 * whose job number already appears in either. REFUSED, NEVER SILENTLY
 * RENAMED -- a PM picked that number for a reason.
 *
 * BOTH LISTS, NOT JUST JOBS -- a fix, not a nicety. `D2 - New Pool` does not
 * create the Jobs row until minutes into its own run (Building), so a PM who
 * runs this script twice against the SAME downloaded change-set -- plausible,
 * since the HOW TO RUN below trains a re-run and the request sits at
 * Building looking stuck for 9-15 minutes -- would sail past a Jobs-only
 * check both times and raise two New Pool Requests rows for one job number.
 * Two pools racing to build is expensive to undo (`D2 - Delete Pool` is
 * ~6 minutes each) for a trigger that is a PM doing something entirely
 * reasonable. So the block set is live Jobs UNIONED with New Pool Requests
 * rows whose Status is still `Requested` or `Building` -- a request that has
 * already reached `Done` or `Failed` no longer blocks its own job number
 * (Done means the Jobs row exists and the plain Jobs check already covers
 * it; Failed means the number never actually got used).
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
 * this kind because it writes exactly six fixed fields on a brand-new row --
 * Title, JobNumber, Address, City, StartDate, AssignDefaultCrews, plus the
 * resolved ProjectManagerId -- see step 4b and step 8b below -- never
 * anything the caller supplies a column name for.
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
  // Comparison key for a job number, used ONLY for equality/membership checks
  // -- trimmed and lower-cased, because SharePoint's own `$filter=JobNumber
  // eq '...'` is case-insensitive on a Text column while a plain JS Set is
  // not. Without this, "d2-1042" sails past this script's uniqueness check
  // and is then refused by `D2 - New Pool` ten minutes later -- safe
  // direction, but a wasted round trip on exactly the check that exists to
  // avoid one. The DISPLAYED/WRITTEN job number is never altered by this --
  // only ever used as a map/set key.
  const jobKey = v => String(v == null ? '' : v).trim().toLowerCase();

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
  // Title); a job number repeated within one change-set (case- and
  // whitespace-insensitively, via jobKey -- see above) is dropped entirely,
  // BOTH occurrences, never last-write-wins, for the same reason a repeated
  // row id is dropped above: this is not the place to guess which copy was
  // meant, and it is the only thing standing between one change-set and two
  // New Pool Requests rows racing to build the same pool twice. ----
  const rejectedCreates = [];
  const createsByJobno = new Map(); // jobKey(jobno) -> the create entry
  (Array.isArray(cs.creates) ? cs.creates : []).forEach(c => {
    const jobno = c && c.jobno != null ? String(c.jobno).trim() : '';
    const key = jobKey(jobno);
    const missing = REQUIRED_CREATE.filter(k => !(c && String(c[k] == null ? '' : c[k]).trim()));
    if (!jobno || missing.length) {
      rejectedCreates.push({ jobno: jobno || '(blank)', reason: 'missing required field(s): ' + (missing.join(', ') || 'jobno') });
      return;
    }
    if (createsByJobno.has(key)) {
      rejectedCreates.push({ jobno, reason: 'duplicate job number in this change-set -- request dropped entirely' });
      createsByJobno.delete(key);
      return;
    }
    createsByJobno.set(key, {
      jobno, name: String(c.name).trim(),
      addr: c.addr ? String(c.addr) : '', city: c.city ? String(c.city) : '',
      start: day(c.start),
      // Defaults true (matches the list's own schema default and how every
      // real pool has been built so far) when a change-set omits the field
      // entirely -- an older planner build that predates this checkbox still
      // produces a valid create. Only an explicit `false` turns it off.
      assignDefaultCrews: c.assignDefaultCrews === false ? false : true
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

  // ---- 6b. THE UNIQUENESS CHECK for CREATES. One read of live Jobs plus one
  // read of live New Pool Requests for the whole batch, exactly like the
  // compare-before-write read above. A create whose job number is already
  // live -- as a Jobs row, OR as a New Pool Requests row still Requested or
  // Building -- is refused, never silently renamed. See the header comment
  // ("BOTH LISTS, NOT JUST JOBS") for why the second list is not optional.
  // Skipped entirely when there is nothing to create. ----
  let createsPlanned = [], createsBlocked = [];
  if (creates.length) {
    const PENDING_STATUSES = new Set(['Requested', 'Building']);
    const liveJobs = await all("/_api/web/lists/GetByTitle('Jobs')/items?$select=JobNumber&$top=5000");
    const pendingRequests = await all("/_api/web/lists/GetByTitle('New Pool Requests')/items?$select=JobNumber,Status&$top=5000");
    const inUse = new Map(); // jobKey(jobno) -> why it is blocked
    liveJobs.forEach(r => inUse.set(jobKey(r.JobNumber), 'a Jobs row with this job number already exists live'));
    pendingRequests.forEach(r => {
      if (!PENDING_STATUSES.has(r.Status)) return;
      const k = jobKey(r.JobNumber);
      if (!inUse.has(k)) inUse.set(k, 'a New Pool Requests row with this job number is still ' + r.Status);
    });
    creates.forEach(c => {
      const why = inUse.get(jobKey(c.jobno));
      if (why) {
        createsBlocked.push({ jobno: c.jobno, name: c.name, reason: 'refusing to create a duplicate pool -- ' + why });
      } else {
        createsPlanned.push(c);
      }
    });
    console.log(createsPlanned.length + ' new pool request(s) planned. '
      + createsBlocked.length + ' refused -- job number already in use live.');
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
      plannedCreates: createsPlanned, blockedCreates: createsBlocked, rejectedCreates,
      aborted: false, abortedError: null
    };
  }
  if (!toWrite.length && !createsPlanned.length) {
    console.log('Nothing left to write after compare-before-write and the uniqueness check.');
    return {
      dryRun: false, rowsWritten: 0, fieldsWritten: 0, fieldsRefused: refused.length,
      rowsMissing: missing.length, rowsMismatched: mismatched.length, fieldsRejected: rejected.length,
      failed: [], verifyMismatch: [],
      createsRequested: 0, createsBlocked: createsBlocked.length, createsRejected: rejectedCreates.length,
      createsFailed: [], createVerifyMismatch: [],
      aborted: false, abortedError: null
    };
  }

  // ---- 7 THROUGH 9b: THE WRITE PHASE, wrapped in one try/catch. Every
  // network call in here used to be unwrapped, so a throw ANYWHERE -- the
  // digest fetch, either metadata read, `currentuser` -- aborted with a bare
  // stack trace and printed no summary at all, even when field edits from
  // step 8 had already landed for real. A single row's MERGE failure or a
  // single create's POST failure never reaches this catch: both already have
  // their OWN per-item try/catch below, which is what lets one bad row/create
  // fail without stopping the rest of the batch. This outer catch is only for
  // the surrounding machinery, which had no guard of any kind before this
  // fix. failed/createdOk/createFailed/verifyMismatch/createVerifyMismatch
  // are declared OUTSIDE the try so the catch block, and the summary built
  // after it, can still see whatever was populated before an abort. ----
  const failed = [];
  const createdOk = [], createFailed = [];
  let verifyMismatch = [], createVerifyMismatch = [];
  let abortedError = null;

  try {
    // ---- 7. digest, shared by both paths -- it is site-wide, not list-
    // specific, so one fetch covers a MERGE on Assignments and a POST on New
    // Pool Requests alike. ----
    const dg = await (await fetch(site + '/_api/contextinfo', {
      method: 'POST', credentials: 'include', headers: { Accept: 'application/json;odata=verbose' }
    })).json();
    const digest = dg.d.GetContextWebInformation.FormDigestValue;

    // ---- 8. write EDITS, in chunks of 8. Item writes may run in parallel;
    // it is field CREATES on the same list that must be sequential (see
    // CLAUDE.md) -- not applicable here, this script only creates ITEMS. ----
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
    // that identity and not the change-set's own name/notes fields. Status
    // and Result are never set: both are flow-owned, default to Requested,
    // and are hidden from the New form
    // (sharepoint/configure-request-lists.js).
    //
    // `currentuser` is checked for `r.ok` and for a resolvable numeric `Id`
    // BEFORE the create loop starts, and either failure THROWS rather than
    // proceeding. Without this, a lapsed session or an error body from
    // `currentuser` still parses as JSON, `cu.Id` comes back `undefined`,
    // `JSON.stringify` silently drops the key from the POST body, and the
    // row lands 201 with a blank ProjectManager -- REST item-creation on
    // this tenant bypasses required-field validation, so nothing else stops
    // that write. The PM then waits the full 10-15 minutes only for
    // `D2 - New Pool`'s `Condition_missing_pm` to fail the request. Throwing
    // here means no create is ever attempted without a real ProjectManagerId;
    // the throw is caught by the try/catch around this whole phase, so the
    // summary still prints and any edits already merged above are still
    // reported accurately. ----
    let pmId = null;
    if (createsPlanned.length) {
      const cuResp = await fetch(site + '/_api/web/currentuser', { headers: H, credentials: 'include' });
      if (!cuResp.ok) throw new Error(cuResp.status + ' resolving the current user for ProjectManagerId -- aborting before any create is attempted.');
      const cu = await cuResp.json();
      pmId = cu && cu.Id;
      if (pmId == null) throw new Error('Could not resolve a numeric site-user id from /_api/web/currentuser (got ' + JSON.stringify(cu) + ') -- aborting before any create is attempted. A create must never be sent with a blank ProjectManager.');

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
            StartDate: c.start, ProjectManagerId: pmId,
            // Required on the list (sharepoint/provision-pool-lists.js), with
            // a schema default of true -- but SET EXPLICITLY rather than
            // relying on that default. The only thing proven about
            // SharePoint applying a column default to an omitted required
            // field on this tenant is the New-FORM case (Status hidden,
            // still defaults to Requested). Nothing here proves the same for
            // a plain REST create, and if it does not, `D2 - New Pool` reads
            // a missing/falsy value as "leave everything unassigned" -- all
            // 46 sub-phases land `unassigned` with no error anywhere, which
            // reads as the tool being broken, not as a setting. Sending it
            // explicitly means the question never comes up.
            AssignDefaultCrews: !!c.assignDefaultCrews
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
    if (toWrite.length) {
      const after = await all("/_api/web/lists/GetByTitle('Assignments')/items" + SELECT);
      const afterById = new Map(after.map(r => [r.Id, r]));
      const failedIds = new Set(failed.map(f => f.id));
      verifyMismatch = planned.filter(p => !failedIds.has(p.id)).filter(p => {
        const r = afterById.get(p.id); if (!r) return true;
        return !FIELD_DEFS[p.field].eq(FIELD_DEFS[p.field].read(r), p.to);
      });
    }

    // ---- 9b. verify CREATES the same way -- by reading New Pool Requests
    // back, never by the 201 status code. Catches exactly the "write returns
    // success and does nothing" signature this whole project watches for.
    // Compares ProjectManagerId and AssignDefaultCrews too, not just Title
    // and StartDate -- a create that landed with the right name and date but
    // a blank ProjectManager used to verify as clean. ----
    if (createdOk.length) {
      const afterRequests = await all("/_api/web/lists/GetByTitle('New Pool Requests')/items?$select=Id,Title,JobNumber,StartDate,ProjectManagerId,AssignDefaultCrews&$top=2000");
      const byJobno = new Map(afterRequests.map(r => [String(r.JobNumber), r]));
      createVerifyMismatch = createdOk.filter(c => {
        const r = byJobno.get(c.jobno);
        if (!r) return true;
        return r.Title !== c.name || day(r.StartDate) !== c.start ||
          r.ProjectManagerId !== pmId || !!r.AssignDefaultCrews !== !!c.assignDefaultCrews;
      });
    }
  } catch (e) {
    // Field edits merged in step 8 before an abort here are real writes,
    // already reflected in `failed`/`planned` below -- a re-run correctly
    // sees them as already-applied (refused by compare-before-write, since
    // the live value now matches what was just written), which is expected,
    // not a bug.
    abortedError = String((e && e.message) || e);
    console.error('Aborted mid-write: ' + abortedError);
    console.error('Reporting what happened before the abort -- see the summary below. '
      + 'Field edits already merged above are real writes and do not need re-applying.');
  }

  const failedIds = new Set(failed.map(f => f.id));
  const writtenPlan = planned.filter(p => !failedIds.has(p.id));
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
    createVerifyMismatch,
    aborted: !!abortedError,
    abortedError
  };
  console.log(JSON.stringify(out, null, 2));
  if (failed.length) console.table(failed);
  if (verifyMismatch.length) console.warn('Verify found ' + verifyMismatch.length + ' field(s) that did not read back as written -- see verifyMismatch.');
  if (createFailed.length) console.table(createFailed);
  if (createVerifyMismatch.length) console.warn('Verify found ' + createVerifyMismatch.length + ' new-pool request(s) that did not read back as written -- see createVerifyMismatch.');
  if (createdOk.length) console.log(WAIT_WARNING);
  return out;
})();
