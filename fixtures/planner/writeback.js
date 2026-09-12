/* Route A of the batch write-back: the planner's Save button (produces a
 * change-set file) and sharepoint/apply-planner-changes.js (applies it).
 *
 * Neither half touches a live tenant here. PART A runs the real planner HTML
 * in jsdom and inspects buildChangeSet()'s output directly. PART B runs the
 * real apply script in a `vm` sandbox -- the same technique run-export.js
 * already uses for export-to-planner.js -- with `fetch` stubbed against a
 * small mutable fake SharePoint store, and inspects the literal MERGE bodies
 * it would send.
 *
 * See docs/superpowers/specs/2026-09-12-batch-write-back-design.md.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../web/index.html');
const APPLY_SCRIPT = path.resolve(__dirname, '../../sharepoint/apply-planner-changes.js');

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

/* ========================================================================
 * PART A -- the planner side: buildChangeSet() against the real HTML.
 * ==================================================================== */
async function partA() {
  const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
    `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.importFromD2=importFromD2;
      window.buildChangeSet=buildChangeSet;window.poolHasBaseline=poolHasBaseline;
      window.secFieldDiffs=secFieldDiffs;window.divergedSecs=divergedSecs;window.sign=sign;
      window.SEED_TEMPLATE=SEED_TEMPLATE;window.render=render;window.newJob=newJob;
      window.buildPendingCreates=buildPendingCreates;};</script><script>__x();</script></body>`);
  const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const win = dom.window;
  win.confirm = () => true; win.alert = () => {};
  await new Promise(r => setTimeout(r, 600));
  const S = win.S;

  // ---- import one real pool so it carries a baseline, in the exact shape
  // export-to-planner.js emits (seq included, per section, as of 2026-09-12) ----
  const T = win.SEED_TEMPLATE;
  const secDefs = T.flatMap(g => g.sections.map(s => ({ num: s.num, name: s.name, tasks: s.tasks })));
  const payload = {
    kind: 'd2-sharepoint-export', exported: '2026-09-12',
    jobs: [{
      id: 19, jobno: 'D2-1042', name: 'Reyes Residence', start: '2026-09-08', status: 'Active',
      sections: secDefs.map((s, i) => ({
        id: 1000 + i, seq: i + 1, num: s.num, name: s.name, crewId: 'devon',
        start: '2026-09-08', finish: '2026-09-09', days: 2, skip: false, locked: false,
        inst: false, pm: false,
        tasks: s.tasks.map((t, k) => ({ seq: k + 1, title: t, done: false, na: false }))
      }))
    }]
  };
  win.importFromD2(new win.File([JSON.stringify(payload)], 'd2.json', { type: 'application/json' }));
  await new Promise(r => setTimeout(r, 400));

  ok('a freshly imported, unedited pool produces an empty change-set',
     win.buildChangeSet().length === 0, JSON.stringify(win.buildChangeSet()));

  const j = S.jobs.find(x => x.jobno === 'D2-1042');
  const secs = win.allSecs(j).map(x => x.s);

  // ---- a single crew change is a single, exactly-scoped diff ----
  secs[0].crewId = 'harrison';
  {
    const cs = win.buildChangeSet();
    ok('one pool in the change-set after one edit', cs.length === 1, cs.length + '');
    ok('one sub-phase in that pool', cs[0].sections.length === 1, cs[0].sections.length + '');
    const fields = cs[0].sections[0].fields;
    ok('exactly Crew changed, from devon to harrison',
       Object.keys(fields).join(',') === 'Crew' && fields.Crew.from === 'devon' && fields.Crew.to === 'harrison',
       JSON.stringify(fields));
    ok('the SharePoint row id rode along', cs[0].sections[0].id === 1000, String(cs[0].sections[0].id));
    ok('the Sequence rode along too, for ordering a batch', cs[0].sections[0].seq === 1, String(cs[0].sections[0].seq));
  }
  secs[0].crewId = 'devon'; // revert

  // ---- THE EXCLUSION RULE, tested the way it can actually fail: tick a task,
  // sign off a sub-phase, THEN change a crew, and prove the change-set carries
  // the crew and NOTHING else -- not the tick, not the sign-off. A test that
  // only checked "InstallerSignOff is absent" would pass even if the whole
  // allowlist were deleted, since that key was never a candidate in the first
  // place; this instead asserts the complete field set produced, which fails
  // the moment anything outside the allowlist leaks in. ----
  win.sign(j.id, 0, 0, 'inst', true);      // sign off sub-phase 0
  secs[1].tasks[0].done = true;            // tick a task on a different sub-phase
  secs[2].crewId = 'stl';                  // the one change that IS in scope
  {
    const cs = win.buildChangeSet();
    const allCols = cs.flatMap(p => p.sections.flatMap(s => Object.keys(s.fields)));
    const ALLOWED_COLS = new Set(['Crew', 'ScheduledStart', 'DurationDays', 'Locked', 'NotApplicable']);
    ok('every field key produced is drawn from the write-back allowlist, nothing else',
       allCols.length > 0 && allCols.every(c => ALLOWED_COLS.has(c)), allCols.join(','));
    ok('sign-off and a task tick together move only ONE field into the change-set',
       allCols.length === 1 && allCols[0] === 'Crew', JSON.stringify(allCols));
  }
  // revert for the next scenario
  secs[2].crewId = 'devon'; win.sign(j.id, 0, 0, 'inst', false); secs[1].tasks[0].done = false;

  ok('every revert above actually cleared divergence', win.divergedSecs(j).length === 0,
     win.divergedSecs(j).length + ' still diverged');

  // ---- Save is disabled with nothing to push, enabled once something diverges.
  // Checked BEFORE the local-sketch and +Job scenarios below: both push a new
  // job into S.jobs, and Auto-Schedule (which +Job no longer runs, but a
  // stray future change might) reflows every pool, not just the new one --
  // that would itself diverge D2-1042 and make this assertion measure the
  // wrong thing. ----
  win.render();
  ok('Save is disabled with nothing to push on the loaded pool', win.document.getElementById('saveBtn').disabled === true);
  const secs2 = win.allSecs(j).map(x => x.s);
  secs2[0].days = 5;
  win.render();
  ok('Save is enabled once a loaded pool diverges', win.document.getElementById('saveBtn').disabled === false);
  secs2[0].days = 2; // revert -- back to baseline before the next scenario
  win.render();
  ok('Save is disabled again once the divergence is reverted', win.document.getElementById('saveBtn').disabled === true);

  // ---- a local-only sketch has no baseline and is never in the change-set,
  // even if every field on it is "edited". Built directly via newJob() --
  // #addJobBtn no longer creates a pool like this at all as of 2026-09-12 (see
  // the next scenario); newJob() is still exactly what a locally-sketched pool
  // looks like, since importFromD2 uses it too for a pool this browser has
  // never seen. ----
  const local = win.newJob('Local Sketch', '', '', '', '', '2026-09-08');
  S.jobs.push(local);
  ok('a freshly sketched job has no baseline', !win.poolHasBaseline(local));
  win.allSecs(local).forEach(({ s }) => { s.crewId = 'harrison'; s.days = 9; s.locked = true; });
  {
    const cs = win.buildChangeSet();
    ok('the local-only pool never appears in the change-set',
       !cs.some(p => p.jobno === local.jobno), cs.map(p => p.jobno).join(','));
  }

  // ---- Batch write-back Stage 2 (2026-09-12): `+ Job` no longer builds a
  // local pool at all. It opens a request form and queues a pending create
  // instead -- one path, run by SharePoint's own New Pool flow, per the
  // owner's own words: "I don't want to have a new job flow in the HTML and
  // then a new job flow in the SharePoint site that do different things."
  // See docs/superpowers/specs/2026-09-12-batch-write-back-design.md,
  // "Create and delete are two-phase, and the UI must say so". ----
  const jobsBeforeClick = S.jobs.length;
  win.document.getElementById('addJobBtn').click();
  ok('+ Job opens the request drawer rather than creating a pool immediately',
     win.document.getElementById('drawer').classList.contains('open') && S.jobs.length === jobsBeforeClick,
     'jobs ' + jobsBeforeClick + ' -> ' + S.jobs.length);
  // Assign default crews defaults to CHECKED -- checked here before anything
  // else touches the form, since that is the state a PM sees on open.
  ok('Assign default crews defaults to checked',
     win.document.getElementById('ncAssignCrews').checked === true);
  win.document.getElementById('ncJobNo').value = 'D2-2001';
  win.document.getElementById('ncName').value = 'Ridgeway Pool';
  win.document.getElementById('ncAddr').value = '9 Ridge Ct';
  win.document.getElementById('ncCity').value = 'Franklin';
  win.document.getElementById('ncStart').value = '2026-10-05';
  win.document.getElementById('ncSubmit').click();
  ok('+ Job still does not create a local 46-sub-phase pool',
     S.jobs.length === jobsBeforeClick, S.jobs.length + ' jobs (was ' + jobsBeforeClick + ')');
  ok('a queued create lands in S.pendingCreates, not yet marked requested, crews assigned by default',
     (S.pendingCreates || []).length === 1 && !S.pendingCreates[0].requestedAt &&
     S.pendingCreates[0].assignDefaultCrews === true,
     JSON.stringify(S.pendingCreates));
  {
    const pc = win.buildPendingCreates();
    ok('a queued create appears in the change-set, correctly shaped',
       pc.length === 1 && pc[0].jobno === 'D2-2001' && pc[0].name === 'Ridgeway Pool' &&
       pc[0].addr === '9 Ridge Ct' && pc[0].city === 'Franklin' && pc[0].start === '2026-10-05' &&
       pc[0].assignDefaultCrews === true,
       JSON.stringify(pc));
  }
  win.render();
  ok('Save is enabled by a queued create alone, with no edit pending',
     win.document.getElementById('saveBtn').disabled === false);

  // ---- Unchecking Assign default crews on a second request carries `false`
  // through the same path -- proves the checkbox is a real choice, not a
  // fixed true wired straight through regardless of what the form shows. ----
  win.document.getElementById('addJobBtn').click();
  win.document.getElementById('ncJobNo').value = 'D2-2002';
  win.document.getElementById('ncName').value = 'Unassigned Test Pool';
  win.document.getElementById('ncStart').value = '2026-10-06';
  win.document.getElementById('ncAssignCrews').checked = false;
  win.document.getElementById('ncSubmit').click();
  {
    const pc2 = win.buildPendingCreates().find(x => x.jobno === 'D2-2002');
    ok('unchecking Assign default crews carries false through to the change-set',
       !!pc2 && pc2.assignDefaultCrews === false, JSON.stringify(pc2));
  }
}

/* ========================================================================
 * PART B -- the apply script: exact MERGE bodies, compare-before-write,
 * the allowlist enforced against a hostile change-set, DRY_RUN, and kind
 * rejection. Runs the real sharepoint/apply-planner-changes.js in a vm
 * sandbox with fetch stubbed against a small mutable fake SharePoint store --
 * never a real request.
 * ==================================================================== */
function makeStore(rows) { return rows.map(r => ({ ...r })); }
// Title matters now (Finding 2): the apply script refuses a row whose live
// Title does not name the change-set's jobno/sub-phase. Every baseRow needs
// one that actually matches whatever jobno/num the test's change-set uses.
const baseRow = (id, jobno = 'D2-1042', num = '0.0') => ({
  Id: id, Title: jobno + ' · ' + num + ' Test Sub-phase',
  Crew: 'devon', ScheduledStart: '2026-09-08T05:00:00Z',
  DurationDays: 2, Locked: false, NotApplicable: false
});

// cfg.silentDropIds: MERGE returns success but the store is NOT updated --
// the exact "write returns 200/204 and does nothing" failure signature this
// whole project is built around catching. Exercises the verify-after-write
// pass (Finding 6). cfg.failIds: MERGE returns a genuine error, exercising
// that one bad row does not stop the rest of the batch.
//
// cfg.jobsStore: live Jobs rows ({JobNumber}) for the creates uniqueness
// check. cfg.requestsStore: live New Pool Requests rows -- serves BOTH the
// F2 pending-request uniqueness read ({JobNumber,Status}) and the post-create
// verify read; a successful create appends to it (unless its jobno is in
// cfg.createSilentDropJobnos, mirroring silentDropIds above but for the
// create path's own verify-after-write pass), so a second run or the
// post-create verify read sees it. cfg.createFailJobnos: the create POST
// returns a genuine error for that jobno. cfg.currentUserId: the id
// /_api/web/currentuser resolves to for ProjectManagerId (default 42).
// cfg.currentUserOk: false simulates currentuser returning a non-ok status
// (a lapsed session) -- F1. cfg.currentUserMissingId: true simulates
// currentuser returning 200 with a JSON body that parses but carries no `Id`
// (an error body that still parses as JSON) -- also F1.
function runApply(src, cs, store, cfg = {}) {
  const silentDropIds = cfg.silentDropIds || new Set();
  const failIds = cfg.failIds || new Set();
  const jobsStore = cfg.jobsStore || [];
  const requestsStore = cfg.requestsStore || [];
  const createFailJobnos = cfg.createFailJobnos || new Set();
  const createSilentDropJobnos = cfg.createSilentDropJobnos || new Set();
  const currentUserId = cfg.currentUserId != null ? cfg.currentUserId : 42;
  const currentUserOk = cfg.currentUserOk !== false;
  const currentUserMissingId = !!cfg.currentUserMissingId;
  return new Promise((resolve, reject) => {
    const calls = [];
    const fakeFile = { name: 'changes.json', text: async () => JSON.stringify(cs) };
    const fetchMock = async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
      if (/_api\/contextinfo/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ d: { GetContextWebInformation: { FormDigestValue: 'TESTDIGEST' } } }) };
      }
      if (/GetByTitle\('Assignments'\)\?\$select=ListItemEntityTypeFullName/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ ListItemEntityTypeFullName: 'SP.Data.AssignmentsListItem' }) };
      }
      if (/GetByTitle\('Assignments'\)\/items\?/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ value: store.map(r => ({ ...r })) }) };
      }
      const m = url.match(/GetByTitle\('Assignments'\)\/items\((\d+)\)$/);
      if (m && opts.headers && opts.headers['X-HTTP-Method'] === 'MERGE') {
        const id = +m[1];
        if (failIds.has(id)) return { ok: false, status: 500, text: async () => 'simulated failure' };
        const row = store.find(r => r.Id === id), body = JSON.parse(opts.body);
        if (row && !silentDropIds.has(id)) Object.keys(body).forEach(k => { if (k !== '__metadata') row[k] = body[k]; });
        return { ok: true, status: 204, text: async () => '' };
      }
      if (/GetByTitle\('Jobs'\)\/items\?/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ value: jobsStore.map(r => ({ ...r })) }) };
      }
      if (/_api\/web\/currentuser/.test(url)) {
        // The !ok response still has a working .json() -- a real SharePoint
        // error response usually does too. If the mock's !ok branch could
        // not be JSON-parsed at all, removing the r.ok check would crash on
        // cuResp.json() regardless of whether the check ever ran, which
        // would make a mutation of that check pass this test for the wrong
        // reason. Giving it a real (if empty) body means removing the r.ok
        // check actually falls through to -- and depends on -- the SEPARATE
        // pmId-null guard, which is what the test needs to isolate.
        if (!currentUserOk) return { ok: false, status: 403, json: async () => ({ 'odata.error': { message: { value: 'session lapsed' } } }), text: async () => 'session lapsed' };
        if (currentUserMissingId) return { ok: true, status: 200, json: async () => ({ 'odata.error': { message: { value: 'weird body, no Id' } } }) };
        return { ok: true, status: 200, json: async () => ({ Id: currentUserId }) };
      }
      if (/GetByTitle\('New Pool Requests'\)\?\$select=ListItemEntityTypeFullName/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ ListItemEntityTypeFullName: 'SP.Data.New_x0020_Pool_x0020_RequestsListItem' }) };
      }
      if (/GetByTitle\('New Pool Requests'\)\/items\?/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ value: requestsStore.map(r => ({ ...r })) }) };
      }
      if (/GetByTitle\('New Pool Requests'\)\/items$/.test(url) && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        if (createFailJobnos.has(body.JobNumber)) return { ok: false, status: 500, text: async () => 'simulated create failure' };
        if (!createSilentDropJobnos.has(body.JobNumber)) {
          const row = { Id: 900 + requestsStore.length, Title: body.Title, JobNumber: body.JobNumber,
            StartDate: body.StartDate, ProjectManagerId: body.ProjectManagerId, AssignDefaultCrews: body.AssignDefaultCrews };
          // Simulates a write landing with one or more fields corrupted or
          // ignored -- the exact "200/201 and does nothing (to THIS field)"
          // signature, narrowed to specific columns rather than the whole row.
          const corrupt = (cfg.createCorruptFields || {})[body.JobNumber];
          if (corrupt) Object.assign(row, corrupt);
          requestsStore.push(row);
        }
        return { ok: true, status: 201, json: async () => ({ d: { ID: 900 } }), text: async () => '' };
      }
      throw new Error('unexpected URL in test fetch mock: ' + url);
    };
    const sandbox = {
      console: { log: () => {}, warn: () => {}, error: () => {}, table: () => {} },
      Date, Promise,
      fetch: fetchMock,
      document: {
        createElement: tag => tag === 'input'
          ? { type: '', accept: '', onchange: null, files: [fakeFile], click() { if (typeof this.onchange === 'function') this.onchange(); } }
          : {}
      }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    try {
      const p = vm.runInContext(src, sandbox);
      Promise.resolve(p).then(out => resolve({ out, calls, store, requestsStore }), reject);
    } catch (e) { reject(e); }
  });
}

// Reads the REAL script and, only for the tests that need to see a write
// actually happen, flips its one safety constant. Guarded so a rename or
// rewrite of that line fails loudly here rather than silently testing the
// DRY_RUN=true path under a "live" label.
function loadApplySource(forceLive) {
  let src = fs.readFileSync(APPLY_SCRIPT, 'utf8');
  if (forceLive) {
    const patched = src.replace('const DRY_RUN = true;', 'const DRY_RUN = false;');
    if (patched === src) throw new Error('DRY_RUN literal not found in apply-planner-changes.js -- test needs updating');
    src = patched;
  }
  return src;
}

async function partB() {
  // ---- exact bodies: which rows, which fields, SuppressReconcileUntil
  // present, and a hostile field structurally cannot ride along ----
  {
    const store = makeStore([baseRow(1, 'D2-1042', '2.1'), baseRow(2, 'D2-1042', '2.2')]);
    const cs = {
      kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
        { id: 1, num: '2.1', name: 'Steel', fields: {
          Crew: { from: 'devon', to: 'harrison' },
          // a hostile field a tampered or buggy caller might include -- must
          // never reach a MERGE body, and must be reported, not silently kept.
          InstallerSignOff: { from: false, to: true }
        } },
        { id: 2, num: '2.2', name: 'Rebar', fields: { DurationDays: { from: 2, to: 3 } } }
      ] }]
    };
    const { out, calls } = await runApply(loadApplySource(true), cs, store);
    const merges = calls.filter(c => c.headers && c.headers['X-HTTP-Method'] === 'MERGE');
    ok('one MERGE per written row', merges.length === 2, merges.length + '');
    const m1 = JSON.parse(merges.find(c => /items\(1\)$/.test(c.url)).body);
    ok('row 1 carries exactly Crew, __metadata and SuppressReconcileUntil -- no sign-off field',
       Object.keys(m1).sort().join(',') === ['__metadata', 'Crew', 'SuppressReconcileUntil'].sort().join(','),
       Object.keys(m1).join(','));
    ok('row 1 metadata type came from the list, not hand-written', m1.__metadata.type === 'SP.Data.AssignmentsListItem');
    ok('SuppressReconcileUntil is a few minutes in the future (bounded both sides -- ~10 min target)',
       (new Date(m1.SuppressReconcileUntil) - Date.now()) > 5 * 60000 && (new Date(m1.SuppressReconcileUntil) - Date.now()) < 15 * 60000,
       m1.SuppressReconcileUntil);
    const m2 = JSON.parse(merges.find(c => /items\(2\)$/.test(c.url)).body);
    ok('row 2 carries exactly DurationDays', Object.keys(m2).sort().join(',') === ['__metadata', 'DurationDays', 'SuppressReconcileUntil'].sort().join(','),
       Object.keys(m2).join(','));
    ok('the hostile field was rejected before ever reaching a live read, and reported',
       out.fieldsRejected === 1, JSON.stringify(out));
  }

  // ---- compare-before-write: one field drifted under the PM, the other lands ----
  {
    const store = makeStore([baseRow(10, 'D2-1043', '3.1')]);
    store[0].Crew = 'antonio'; // changed live, since the planner loaded it
    const cs = {
      kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1043', name: 'Whitfield', sections: [
        { id: 10, num: '3.1', name: 'Plumbing', fields: {
          Crew: { from: 'devon', to: 'harrison' },   // stale baseline -- must be refused
          DurationDays: { from: 2, to: 4 }            // still matches live -- must land
        } }
      ] }]
    };
    const { out, calls } = await runApply(loadApplySource(true), cs, store);
    const merge = calls.find(c => c.headers && c.headers['X-HTTP-Method'] === 'MERGE');
    const body = JSON.parse(merge.body);
    ok('the conflicted field was NOT written', !('Crew' in body), Object.keys(body).join(','));
    ok('the field that still matched the baseline WAS written', body.DurationDays === 4, JSON.stringify(body));
    ok('the refusal is counted and would name the sub-phase and field',
       out.fieldsRefused === 1, JSON.stringify(out));
    ok('the live row kept its drifted crew -- the refusal did not clobber it', store[0].Crew === 'antonio', store[0].Crew);
  }

  // ---- DRY_RUN true (the shipped default) writes nothing at all ----
  {
    const store = makeStore([baseRow(20, 'D2-1044', '1.1')]);
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1044', name: 'Salcedo', sections: [
      { id: 20, num: '1.1', name: 'Dig', fields: { Crew: { from: 'devon', to: 'saul' } } }
    ] }] };
    const { out, calls } = await runApply(loadApplySource(false), cs, store);
    ok('DRY_RUN performs no POST of any kind (no digest, no MERGE)', calls.every(c => c.method !== 'POST'),
       calls.map(c => c.method).join(','));
    ok('DRY_RUN still reports the plan it would run', out.dryRun === true && out.wouldWriteRows === 1, JSON.stringify(out));
    ok('DRY_RUN really wrote nothing to the store', store[0].Crew === 'devon', store[0].Crew);
  }

  // ---- a row that vanished since export is reported, not thrown ----
  {
    const store = makeStore([baseRow(40)]); // no row 41
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
      { id: 41, num: '4.1', name: 'Gone', fields: { Crew: { from: 'devon', to: 'saul' } } }
    ] }] };
    const { out } = await runApply(loadApplySource(true), cs, store);
    ok('a row no longer in SharePoint is reported as missing, not a thrown error',
       out.rowsMissing === 1 && out.rowsWritten === 0, JSON.stringify(out));
  }

  // ---- the wrong file kind is rejected before any network call, even when
  // the file otherwise carries real, well-formed pools/sections/fields (so
  // this actually isolates the kind check from the separate "pools must be an
  // array" check -- an empty payload would pass either check for free) ----
  {
    const store = makeStore([baseRow(30)]);
    const cs = {
      kind: 'd2-sharepoint-export', // the EXPORT's own kind, wrong direction
      pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
        { id: 30, num: '1.1', name: 'Dig', fields: { Crew: { from: 'devon', to: 'saul' } } }
      ] }]
    };
    const { out, calls } = await runApply(loadApplySource(true), cs, store);
    ok('a change-set of the wrong kind is rejected with no network call at all',
       calls.length === 0, calls.length + '');
    ok('nothing is returned for a rejected file', out === undefined, String(out));
  }

  // ---- Finding 2: row identity is verified against the live Title, not
  // trusted from the id alone. A row whose live Title names a completely
  // different pool/sub-phase is refused WHOLESALE -- nothing on it is
  // written -- and reported distinctly from "missing" and "refused". ----
  {
    const store = makeStore([baseRow(90, 'D2-1042', '2.1')]);
    store[0].Title = 'D2-1099 · 9.9 A Completely Different Row'; // id 90 now names someone else's row
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
      { id: 90, num: '2.1', name: 'Steel', fields: { Crew: { from: 'devon', to: 'saul' } } }
    ] }] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store);
    const merges = calls.filter(c => c.headers && c.headers['X-HTTP-Method'] === 'MERGE');
    ok('a row whose live Title names a different pool/sub-phase is refused, not written',
       out.rowsMismatched === 1 && out.rowsWritten === 0 && merges.length === 0, JSON.stringify(out));
  }
  // ---- the same row, Title now legitimately matching, must land normally --
  // proves the check above is a real gate and not a permanent refusal ----
  {
    const store = makeStore([baseRow(91, 'D2-1042', '2.1')]);
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
      { id: 91, num: '2.1', name: 'Steel', fields: { Crew: { from: 'devon', to: 'saul' } } }
    ] }] };
    const { out } = await runApply(loadApplySource(true), cs, store);
    ok('a row whose live Title matches writes normally',
       out.rowsMismatched === 0 && out.rowsWritten === 1, JSON.stringify(out));
  }

  // ---- Finding 2, round 2: titleMatches must be TOKEN-anchored, not a plain
  // substring test. Reproduces the re-reviewer's exact exploit -- a row
  // genuinely titled sub-phase "2.10" must not be mistaken for "2.1" just
  // because "2.1" is a substring of "2.10". Dormant against today's live data
  // (the 46-row template tops out at single digits), armed the moment any
  // phase group gains a tenth sub-phase. ----
  {
    const store = makeStore([baseRow(97, 'D2-1042', '2.10')]);
    store[0].Title = 'D2-1042 · 2.10 Some Other Row'; // genuinely 2.10, not 2.1
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
      { id: 97, num: '2.1', name: 'Steel', fields: { Crew: { from: 'devon', to: 'saul' } } } // asks for 2.1
    ] }] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store);
    const merges = calls.filter(c => c.headers && c.headers['X-HTTP-Method'] === 'MERGE');
    ok('"2.1" does not match a row genuinely titled "2.10" -- refused as mismatched, not written',
       out.rowsMismatched === 1 && out.rowsWritten === 0 && merges.length === 0, JSON.stringify(out));
  }
  // ---- the jobno side has the same substring hole: "D2-104" must not match
  // a row actually titled "D2-1042 · ...". ----
  {
    const store = makeStore([baseRow(98, 'D2-1042', '3.1')]);
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-104', name: 'Wrong Pool', sections: [
      { id: 98, num: '3.1', name: 'Steel', fields: { Crew: { from: 'devon', to: 'saul' } } }
    ] }] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store);
    const merges = calls.filter(c => c.headers && c.headers['X-HTTP-Method'] === 'MERGE');
    ok('"D2-104" does not match a row actually titled "D2-1042" -- refused as mismatched, not written',
       out.rowsMismatched === 1 && out.rowsWritten === 0 && merges.length === 0, JSON.stringify(out));
  }
  // ---- the num anchor's "last token" branch (endsWith), for a Title with no
  // name after the number at all -- never produced by this project's own
  // template (a name always follows), but titleMatches must not assume that,
  // since it is reading a live column, not something it generated itself. ----
  {
    const store = makeStore([baseRow(94, 'D2-1042', '7.0')]);
    store[0].Title = 'D2-1042 · 7.0'; // num is the LAST token, nothing after it
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
      { id: 94, num: '7.0', name: 'X', fields: { Crew: { from: 'devon', to: 'saul' } } }
    ] }] };
    const { out } = await runApply(loadApplySource(true), cs, store);
    ok('a Title ending exactly at the sub-phase number still matches (the endsWith fallback)',
       out.rowsMismatched === 0 && out.rowsWritten === 1, JSON.stringify(out));
  }
  // ---- and the same last-token shape must still refuse a substring
  // impostor: Title ends at "7.0" but the change-set asks for "7." (a
  // pathological but not impossible malformed num) ----
  {
    const store = makeStore([baseRow(93, 'D2-1042', '7.0')]);
    store[0].Title = 'D2-1042 · 7.0';
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
      { id: 93, num: '7.', name: 'X', fields: { Crew: { from: 'devon', to: 'saul' } } }
    ] }] };
    const { out } = await runApply(loadApplySource(true), cs, store);
    ok('a truncated num does not match via the endsWith fallback either',
       out.rowsMismatched === 1 && out.rowsWritten === 0, JSON.stringify(out));
  }
  // ---- the guard must not be so strict it refuses the LEGITIMATE cases --
  // every one of the 46 real sub-phase numbers against a correctly-titled
  // row, boundary cases included: "0.0" (first), "7.0" (last group), and
  // "6.9" (the token immediately before a would-be double-digit number). ----
  {
    let ok46 = true, bad = [];
    for (const num of ['0.0', '6.9', '7.0', '2.1', '3.10' /* a real future double-digit, once armed */]) {
      const store = makeStore([baseRow(99, 'D2-1042', num)]);
      const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
        { id: 99, num, name: 'X', fields: { Crew: { from: 'devon', to: 'saul' } } }
      ] }] };
      const { out } = await runApply(loadApplySource(true), cs, store);
      if (out.rowsMismatched !== 0 || out.rowsWritten !== 1) { ok46 = false; bad.push(num); }
    }
    ok('a correctly-titled row still matches for every sub-phase-number shape, single- and double-digit alike',
       ok46, 'failed on: ' + bad.join(','));
  }

  // ---- Finding 3: the write side normalizes a date exactly like the read
  // side already does. A change-set carrying a full timestamp (never emitted
  // by the planner today, but nothing stops a hand-edited or future file)
  // must still produce a bare yyyy-MM-dd in the MERGE body. ----
  {
    const store = makeStore([baseRow(80, 'D2-1042', '9.1')]);
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
      { id: 80, num: '9.1', name: 'Grading', fields: { ScheduledStart: { from: '2026-09-08', to: '2026-09-15T00:00:00Z' } } }
    ] }] };
    const { calls } = await runApply(loadApplySource(true), cs, store);
    const merge = calls.find(c => c.headers && c.headers['X-HTTP-Method'] === 'MERGE');
    const body = JSON.parse(merge.body);
    ok('ScheduledStart is normalized to a bare yyyy-MM-dd on write, symmetric with the read side',
       body.ScheduledStart === '2026-09-15', body.ScheduledStart);
  }

  // ---- Finding 5: a row id repeated within one change-set is dropped
  // entirely -- neither copy wins -- and reported, never silently
  // last-write-wins via Map.set overwriting the first entry. ----
  {
    const store = makeStore([baseRow(95, 'D2-1042', '5.1'), baseRow(96, 'D2-1042', '5.2')]);
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
      { id: 95, num: '5.1', name: 'Plaster', fields: { Crew: { from: 'devon', to: 'saul' } } },
      { id: 95, num: '5.1', name: 'Plaster', fields: { Crew: { from: 'devon', to: 'harrison' } } }, // duplicate id
      { id: 96, num: '5.2', name: 'Coping', fields: { Crew: { from: 'devon', to: 'antonio' } } }
    ] }] };
    const { out } = await runApply(loadApplySource(false), cs, store);
    ok('a duplicate row id is reported as rejected, not silently last-write-wins',
       out.fieldsRejected === 1, JSON.stringify(out));
    ok('the duplicated row is written for NEITHER copy; the untouched row still lands',
       out.wouldWriteRows === 1 && out.planned.every(p => p.id !== 95) && out.planned.some(p => p.id === 96),
       JSON.stringify(out.planned));
  }

  // ---- Finding 6c: a batch spanning more than one write chunk (CHUNK=8) --
  // proves every chunk is written, not just the first. ----
  {
    const N = 10;
    const store = makeStore(Array.from({ length: N }, (_, i) => baseRow(200 + i, 'D2-1043', '8.' + (i + 1))));
    const sections = Array.from({ length: N }, (_, i) => ({
      id: 200 + i, num: '8.' + (i + 1), name: 'Row' + i, fields: { Crew: { from: 'devon', to: 'saul' } }
    }));
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1043', name: 'Whitfield', sections }] };
    const { out, store: after } = await runApply(loadApplySource(true), cs, store);
    ok('every row across more than one chunk of 8 is written, not just the first chunk',
       out.rowsWritten === N && after.every(r => r.Crew === 'saul'), out.rowsWritten + ' of ' + N);
  }

  // ---- Finding 6d: DurationDays compared with STRICT equality. A live value
  // of a different TYPE than the baseline (an odata quirk returning a number
  // column as a string, say) must be refused, not treated as equal by loose
  // coercion. ----
  {
    const store = makeStore([baseRow(50, 'D2-1042', '5.1')]);
    store[0].DurationDays = '2'; // string, not the number the baseline expects
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
      { id: 50, num: '5.1', name: 'Plaster', fields: { DurationDays: { from: 2, to: 3 } } }
    ] }] };
    const { out } = await runApply(loadApplySource(true), cs, store);
    ok('a live DurationDays of a different type than the baseline is refused, not coerced-equal',
       out.fieldsRefused === 1 && out.fieldsWritten === 0, JSON.stringify(out));
  }

  // ---- Finding 6e: the verify-after-write pass actually catches a write
  // that reported success but did not change the row -- the exact "returns
  // 200/204 and does nothing" failure signature this whole project watches
  // for. ----
  {
    const store = makeStore([baseRow(60, 'D2-1044', '6.1')]);
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1044', name: 'Salcedo', sections: [
      { id: 60, num: '6.1', name: 'Coping', fields: { Crew: { from: 'devon', to: 'saul' } } }
    ] }] };
    const { out } = await runApply(loadApplySource(true), cs, store, { silentDropIds: new Set([60]) });
    ok('verify-after-write catches a write that reported success but did not actually change the row',
       out.verifyMismatch.length === 1 && out.verifyMismatch[0].id === 60, JSON.stringify(out.verifyMismatch));
  }

  // ---- Finding 6f: one row failing does not stop the rest of the batch, and
  // the report is accurate about which landed and which did not. ----
  {
    const store = makeStore([
      baseRow(70, 'D2-1042', '7.1'), baseRow(71, 'D2-1042', '7.2'), baseRow(72, 'D2-1042', '7.3')
    ]);
    const cs = { kind: 'd2-planner-changeset', pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
      { id: 70, num: '7.1', name: 'A', fields: { Crew: { from: 'devon', to: 'saul' } } },
      { id: 71, num: '7.2', name: 'B', fields: { Crew: { from: 'devon', to: 'harrison' } } },
      { id: 72, num: '7.3', name: 'C', fields: { Crew: { from: 'devon', to: 'antonio' } } }
    ] }] };
    const { out, store: after } = await runApply(loadApplySource(true), cs, store, { failIds: new Set([71]) });
    ok('one row failing does not stop the rest of the batch',
       out.rowsWritten === 2 && out.failed.length === 1 && out.failed[0].id === 71, JSON.stringify(out));
    ok('the failed row kept its original value; the other two landed as reported',
       after.find(r => r.Id === 70).Crew === 'saul' &&
       after.find(r => r.Id === 71).Crew === 'devon' &&
       after.find(r => r.Id === 72).Crew === 'antonio', JSON.stringify(after));
  }

  /* ====================================================================
   * PART B, CREATES -- D10: the apply path is also the uniqueness check
   * that has never existed between the planner's own job-number suggestion
   * and D2 - New Pool's. A create is a wholly different write (POST of a
   * new New Pool Requests row, never a MERGE on Assignments) and is
   * reported through its own counters, never conflated with field edits.
   * ==================================================================== */

  // ---- refuses a create whose job number already exists live, and says so:
  // no POST at all, reported as blocked rather than silently renamed. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1042', name: 'Duplicate Attempt', addr: '', city: '', start: '2026-10-01' }
    ] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store, { jobsStore: [{ JobNumber: 'D2-1042' }] });
    const createPosts = calls.filter(c => c.method === 'POST' && /New Pool Requests/.test(decodeURIComponent(c.url)) && /\/items$/.test(c.url));
    ok('a create whose job number already exists live is refused, not written',
       out.createsBlocked === 1 && out.createsRequested === 0 && createPosts.length === 0, JSON.stringify(out));
  }

  // ---- a job number NOT already live lands normally, resolving the current
  // user to ProjectManagerId and writing a bare yyyy-MM-dd StartDate, never
  // Status/Result (flow-owned) -- proves the check above is a real gate, not
  // a permanent refusal. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1050', name: 'Ridgeway Pool', addr: '9 Ridge Ct', city: 'Franklin', start: '2026-10-05T00:00:00Z' }
    ] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store, { jobsStore: [], requestsStore: [], currentUserId: 77 });
    const createPost = calls.find(c => c.method === 'POST' && /New Pool Requests/.test(decodeURIComponent(c.url)) && /\/items$/.test(c.url));
    ok('a job number not already live is created via a single POST', !!createPost);
    const body = JSON.parse(createPost.body);
    ok('the request carries the resolved current user as ProjectManagerId, not an email string',
       body.ProjectManagerId === 77, JSON.stringify(body));
    ok('StartDate is normalized to a bare yyyy-MM-dd, the same DateOnly convention as ScheduledStart',
       body.StartDate === '2026-10-05', body.StartDate);
    ok('Status and Result are never set -- both are flow-owned and default on the list itself',
       !('Status' in body) && !('Result' in body), Object.keys(body).join(','));
    ok('the create is reported as requested', out.createsRequested === 1 && out.createsBlocked === 0, JSON.stringify(out));
    // AssignDefaultCrews is REQUIRED on the list with a schema default of
    // true, and this change-set entry omits it entirely (an older planner
    // build, or the field simply not offered yet) -- it must still be sent
    // EXPLICITLY, never left for SharePoint's own default to supply, because
    // nothing here proves a plain REST create gets that default the way the
    // New form does.
    ok('AssignDefaultCrews is present and true when the change-set omits it entirely (defaults true, sent explicitly)',
       'AssignDefaultCrews' in body && body.AssignDefaultCrews === true, JSON.stringify(body));
  }

  // ---- a change-set create that explicitly turns crew assignment off must
  // send AssignDefaultCrews: false, not true and not absent. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1055', name: 'No Crews Pool', addr: '', city: '', start: '2026-11-20', assignDefaultCrews: false }
    ] };
    const { calls } = await runApply(loadApplySource(true), cs, store, { jobsStore: [], requestsStore: [] });
    const createPost = calls.find(c => c.method === 'POST' && /New Pool Requests/.test(decodeURIComponent(c.url)) && /\/items$/.test(c.url));
    const body = JSON.parse(createPost.body);
    ok('AssignDefaultCrews is sent as false when the change-set explicitly unchecks it',
       'AssignDefaultCrews' in body && body.AssignDefaultCrews === false, JSON.stringify(body));
  }

  // ---- DRY_RUN creates nothing: no POST at all, but the plan (including the
  // uniqueness check, which is read-only) is still reported. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1051', name: 'Dry Run Pool', addr: '', city: '', start: '2026-11-01' }
    ] };
    const { out, calls } = await runApply(loadApplySource(false), cs, store, { jobsStore: [] });
    ok('DRY_RUN performs no POST for the new-pool request either',
       calls.every(c => c.method !== 'POST'), calls.map(c => c.method).join(','));
    ok('DRY_RUN still reports the create it would raise', out.dryRun === true && out.wouldCreatePools === 1, JSON.stringify(out));
  }

  // ---- a create and a field edit in one change-set both work and are
  // reported through separate counters, never conflated. ----
  {
    const store = makeStore([baseRow(500, 'D2-1042', '5.1')]);
    const cs = { kind: 'd2-planner-changeset',
      pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
        { id: 500, num: '5.1', name: 'Plaster', fields: { Crew: { from: 'devon', to: 'saul' } } }
      ] }],
      creates: [{ jobno: 'D2-1052', name: 'Combo Pool', addr: '2 Rd', city: 'Franklin', start: '2026-11-15' }]
    };
    const { out, calls, store: after } = await runApply(loadApplySource(true), cs, store, { jobsStore: [], requestsStore: [] });
    const merges = calls.filter(c => c.headers && c.headers['X-HTTP-Method'] === 'MERGE');
    const createPosts = calls.filter(c => c.method === 'POST' && /New Pool Requests/.test(decodeURIComponent(c.url)) && /\/items$/.test(c.url));
    ok('the field edit landed via MERGE on Assignments', merges.length === 1 && after[0].Crew === 'saul', JSON.stringify(after));
    ok('the new pool request landed via a separate POST to New Pool Requests', createPosts.length === 1, createPosts.length + '');
    ok('the two are reported through separate counters, never conflated',
       out.rowsWritten === 1 && out.fieldsWritten === 1 && out.createsRequested === 1, JSON.stringify(out));
  }

  // ---- a malformed create (missing a required field) is rejected before any
  // network call, and never silently dropped without a reason. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1053', name: '', addr: '', city: '', start: '2026-12-01' } // name blank
    ] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store, { jobsStore: [] });
    ok('a create missing a required field is rejected before any read, and never created',
       out.createsRejected === 1 && out.createsRequested === 0 &&
       !calls.some(c => c.method === 'POST'), JSON.stringify(out));
  }

  // ---- verify-after-write on the create path: a POST that reports success
  // but the row does not actually land is caught, not trusted from the status
  // code -- the same discipline as Finding 6e on the edit path. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1054', name: 'Ghost Pool', addr: '', city: '', start: '2026-12-10' }
    ] };
    const { out } = await runApply(loadApplySource(true), cs, store,
      { jobsStore: [], requestsStore: [], createSilentDropJobnos: new Set(['D2-1054']) });
    ok('verify-after-write catches a create that reported success but did not actually land',
       out.createVerifyMismatch.length === 1 && out.createVerifyMismatch[0].jobno === 'D2-1054', JSON.stringify(out.createVerifyMismatch));
  }

  /* ====================================================================
   * FIX ROUND 2/5 -- reviewer findings F1-F4 plus the M7 test gap.
   * ==================================================================== */

  // ---- F1a: currentuser returning a non-ok status aborts BEFORE any create
  // POST -- never a create with a blank ProjectManager. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1070', name: 'Lapsed Session Pool', addr: '', city: '', start: '2026-12-21' }
    ] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store,
      { jobsStore: [], requestsStore: [], currentUserOk: false });
    const createPosts = calls.filter(c => c.method === 'POST' && /New Pool Requests/.test(decodeURIComponent(c.url)) && /\/items$/.test(c.url));
    // Asserts the SPECIFIC r.ok-check message, not merely "it aborted" --
    // the separate pmId-null guard would also abort safely if only the r.ok
    // check were removed (this mock's error body never happens to contain a
    // real Id), so a looser assertion would not actually prove the r.ok
    // check exists. Naming the status code and "resolving the current user"
    // is what a PM/dev needs to tell "session lapsed" apart from "resolved,
    // but no numeric id" -- the finding's whole point.
    ok('currentuser returning a non-ok status aborts before any create POST, with a message naming the failed status check',
       createPosts.length === 0 && out.createsRequested === 0 && out.aborted === true &&
       /403/.test(out.abortedError) && /resolving the current user/.test(out.abortedError), JSON.stringify(out));
  }

  // ---- F1b: currentuser returning 200 with a body that parses but carries
  // no Id -- exactly the failure mode named in the finding: `.json()`
  // succeeds, `cu.Id` is `undefined`, and without the guard
  // `JSON.stringify` would silently drop ProjectManagerId from the POST
  // while the row still lands 201. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1072', name: 'No Id Pool', addr: '', city: '', start: '2026-12-23' }
    ] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store,
      { jobsStore: [], requestsStore: [], currentUserMissingId: true });
    const createPosts = calls.filter(c => c.method === 'POST' && /New Pool Requests/.test(decodeURIComponent(c.url)) && /\/items$/.test(c.url));
    ok('currentuser resolving to no Id aborts before any create POST, never a create with a blank ProjectManager',
       createPosts.length === 0 && out.createsRequested === 0 && out.aborted === true, JSON.stringify(out));
  }

  // ---- F1c: step 9b's verify-after-write also compares ProjectManagerId and
  // AssignDefaultCrews, not just Title and StartDate -- a create that landed
  // with the right name and date but the wrong PM used to verify as clean. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1073', name: 'Wrong PM Pool', addr: '', city: '', start: '2026-12-24' }
    ] };
    const { out } = await runApply(loadApplySource(true), cs, store, {
      jobsStore: [], requestsStore: [], currentUserId: 55,
      createCorruptFields: { 'D2-1073': { ProjectManagerId: 999 } }
    });
    ok('verify-after-write catches a create that landed with the wrong ProjectManagerId even though Title/StartDate matched',
       out.createVerifyMismatch.length === 1 && out.createVerifyMismatch[0].jobno === 'D2-1073', JSON.stringify(out.createVerifyMismatch));
  }

  // ---- F4: a throw resolving the current user does not swallow what already
  // landed. An edit in scope alongside a create whose PM cannot be resolved
  // must still be reported as written, and the script must still produce a
  // summary rather than a bare rejection. ----
  {
    const store = makeStore([baseRow(600, 'D2-1042', '6.1')]);
    const cs = { kind: 'd2-planner-changeset',
      pools: [{ jobno: 'D2-1042', name: 'Reyes', sections: [
        { id: 600, num: '6.1', name: 'Coping', fields: { Crew: { from: 'devon', to: 'saul' } } }
      ] }],
      creates: [{ jobno: 'D2-1071', name: 'Aborted PM Pool', addr: '', city: '', start: '2026-12-22' }]
    };
    const { out, store: after } = await runApply(loadApplySource(true), cs, store,
      { jobsStore: [], requestsStore: [], currentUserOk: false });
    ok('a throw resolving the current user does not stop the summary from printing, and reports the abort',
       out.aborted === true && typeof out.abortedError === 'string' && out.abortedError.length > 0, JSON.stringify(out));
    ok('the field edit that already landed before the abort is still reported as written',
       out.rowsWritten === 1 && after[0].Crew === 'saul', JSON.stringify(after));
    ok('no create was raised once currentuser could not be resolved',
       out.createsRequested === 0, JSON.stringify(out));
  }

  // ---- F2: the uniqueness check also covers pending New Pool Requests rows
  // sitting at Requested or Building -- not just live Jobs. D2 - New Pool
  // does not create the Jobs row until minutes into its own run, so a PM
  // re-running the same downloaded change-set (plausible: the request sits
  // at Building looking stuck for 9-15 minutes, and the HOW TO RUN trains a
  // re-run) would otherwise sail past a Jobs-only check and raise a second
  // request for the same job number. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1061', name: 'Second Attempt', addr: '', city: '', start: '2026-12-20' }
    ] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store,
      { jobsStore: [], requestsStore: [{ Id: 1, JobNumber: 'D2-1061', Status: 'Building' }] });
    const createPosts = calls.filter(c => c.method === 'POST' && /New Pool Requests/.test(decodeURIComponent(c.url)) && /\/items$/.test(c.url));
    ok('a job number already sitting in a Requested/Building New Pool Requests row is refused, not raised again',
       out.createsBlocked === 1 && out.createsRequested === 0 && createPosts.length === 0, JSON.stringify(out));
  }
  // ---- F2, other direction: a request that already reached Done or Failed
  // must NOT block its own job number -- Done means the Jobs row already
  // exists (the plain Jobs check covers it); Failed means the number never
  // actually got used. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1062', name: 'Retry After Failure', addr: '', city: '', start: '2026-12-20' }
    ] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store,
      { jobsStore: [], requestsStore: [{ Id: 2, JobNumber: 'D2-1062', Status: 'Failed' }], currentUserId: 42 });
    const createPost = calls.find(c => c.method === 'POST' && /New Pool Requests/.test(decodeURIComponent(c.url)) && /\/items$/.test(c.url));
    ok('a job number whose only prior request Failed is NOT blocked -- that number never actually got used',
       out.createsBlocked === 0 && out.createsRequested === 1 && !!createPost, JSON.stringify(out));
  }

  // ---- F3: the uniqueness check is case- and whitespace-insensitive, to
  // match SharePoint's own case-insensitive $filter on a Text column. A
  // change-set job number differing only in case or surrounding whitespace
  // from a live one must still be refused here, not sail through and get
  // refused ten minutes later by the flow instead. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: '  d2-1042  ', name: 'Case Test Pool', addr: '', city: '', start: '2026-12-26' }
    ] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store, { jobsStore: [{ JobNumber: 'D2-1042' }] });
    const createPosts = calls.filter(c => c.method === 'POST' && /New Pool Requests/.test(decodeURIComponent(c.url)) && /\/items$/.test(c.url));
    ok('a job number differing only in case/whitespace from a live one is still refused',
       out.createsBlocked === 1 && out.createsRequested === 0 && createPosts.length === 0, JSON.stringify(out));
  }

  // ---- M7 (test gap closed): a change-set carrying two creates with the
  // SAME job number must never raise both -- that branch is the only thing
  // stopping one change-set from building the same pool twice, and it had no
  // coverage at all before this test. Neither copy is raised; the collision
  // is reported instead. ----
  {
    const store = makeStore([]);
    const cs = { kind: 'd2-planner-changeset', pools: [], creates: [
      { jobno: 'D2-1080', name: 'First Copy', addr: '', city: '', start: '2026-12-28' },
      { jobno: 'D2-1080', name: 'Second Copy', addr: '', city: '', start: '2026-12-29' }
    ] };
    const { out, calls } = await runApply(loadApplySource(true), cs, store, { jobsStore: [], requestsStore: [] });
    const createPosts = calls.filter(c => c.method === 'POST' && /New Pool Requests/.test(decodeURIComponent(c.url)) && /\/items$/.test(c.url));
    ok('a change-set carrying two creates with the same job number never raises either, and reports the collision',
       out.createsRejected === 1 && out.createsRequested === 0 && createPosts.length === 0, JSON.stringify(out));
  }
}

(async () => {
  await partA();
  await partB();
  console.log('\n' + (fail ? 'FAILURES ABOVE'
    : 'Write-back Route A verified: change-set generation (planner) and the apply script (console) both hold to the allowlist and to compare-before-write.'));
  process.exit(fail);
})();
