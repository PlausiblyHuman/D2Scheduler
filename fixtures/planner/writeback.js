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
      window.SEED_TEMPLATE=SEED_TEMPLATE;window.render=render;};</script><script>__x();</script></body>`);
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
  // Checked BEFORE the addJobBtn scenario below: adding a job runs a full
  // autoSchedule() reflow of every pool (not just the new one), which would
  // itself diverge D2-1042 and make this assertion measure the wrong thing. ----
  win.render();
  ok('Save is disabled with nothing to push on the loaded pool', win.document.getElementById('saveBtn').disabled === true);
  const secs2 = win.allSecs(j).map(x => x.s);
  secs2[0].days = 5;
  win.render();
  ok('Save is enabled once a loaded pool diverges', win.document.getElementById('saveBtn').disabled === false);
  secs2[0].days = 2; // revert -- back to baseline before the next scenario

  // ---- a local-only sketch has no baseline and is never in the change-set,
  // even if every field on it is "edited" ----
  win.document.getElementById('addJobBtn').click();
  await new Promise(r => setTimeout(r, 100));
  const local = S.jobs.find(x => !x.status);
  ok('a freshly sketched job has no baseline', !win.poolHasBaseline(local));
  win.allSecs(local).forEach(({ s }) => { s.crewId = 'harrison'; s.days = 9; s.locked = true; });
  {
    const cs = win.buildChangeSet();
    ok('the local-only pool never appears in the change-set',
       !cs.some(p => p.jobno === local.jobno), cs.map(p => p.jobno).join(','));
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
const baseRow = id => ({ Id: id, Crew: 'devon', ScheduledStart: '2026-09-08T05:00:00Z',
  DurationDays: 2, Locked: false, NotApplicable: false });

function runApply(src, cs, store) {
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
        const id = +m[1], row = store.find(r => r.Id === id), body = JSON.parse(opts.body);
        if (row) Object.keys(body).forEach(k => { if (k !== '__metadata') row[k] = body[k]; });
        return { ok: true, status: 204, text: async () => '' };
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
      Promise.resolve(p).then(out => resolve({ out, calls, store }), reject);
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
    const store = makeStore([baseRow(1), baseRow(2)]);
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
    ok('SuppressReconcileUntil is a few minutes in the future',
       (new Date(m1.SuppressReconcileUntil) - Date.now()) > 0 && (new Date(m1.SuppressReconcileUntil) - Date.now()) < 20 * 60000,
       m1.SuppressReconcileUntil);
    const m2 = JSON.parse(merges.find(c => /items\(2\)$/.test(c.url)).body);
    ok('row 2 carries exactly DurationDays', Object.keys(m2).sort().join(',') === ['__metadata', 'DurationDays', 'SuppressReconcileUntil'].sort().join(','),
       Object.keys(m2).join(','));
    ok('the hostile field was rejected before ever reaching a live read, and reported',
       out.fieldsRejected === 1, JSON.stringify(out));
  }

  // ---- compare-before-write: one field drifted under the PM, the other lands ----
  {
    const store = makeStore([baseRow(10)]);
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
    const store = makeStore([baseRow(20)]);
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
}

(async () => {
  await partA();
  await partB();
  console.log('\n' + (fail ? 'FAILURES ABOVE'
    : 'Write-back Route A verified: change-set generation (planner) and the apply script (console) both hold to the allowlist and to compare-before-write.'));
  process.exit(fail);
})();
