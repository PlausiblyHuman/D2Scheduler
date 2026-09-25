/* sharepoint/restore-project.js, run for real under Node with only fetch, document
 * and console stubbed, the same way writeback.js runs the console applier.
 *
 * WHAT IT PINS. A restore puts one project back to the way a nightly snapshot
 * holds it: the Jobs row, its Assignments rows and their Tasks rows, field by
 * field, writing only what differs. The safety properties, each watched red
 * under mutate.py:
 *
 *   1. DRY_RUN defaults true and performs no POST of any kind.
 *   2. Only fields that differ are written, and only on rows that differ.
 *   3. Identity: the snapshot job's Id must be the live Id for that job number
 *      (a re-created project with the same number is a different row), and
 *      every snapshot Assignments and Tasks row must still exist live, or the
 *      whole restore is refused. Nothing partial.
 *   4. Assignments MERGEs carry SuppressReconcileUntil; Tasks and Jobs do not
 *      (those lists have no such column; sending it fails the PATCH).
 *   5. Sign-off state is restored with its person id and timestamp, and a
 *      task's N/A reason with it.
 *   6. After writing it re-reads and reports anything that still differs.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.resolve(__dirname, '../../sharepoint/restore-project.js');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };
const STAMP = '2026-09-25 1329';

// REST-shaped rows, as the snapshot flow writes them and as the site returns them.
const job = (o) => Object.assign({ Id: 27, Title: 'Gunite/Trailov', JobNumber: '26- 2055', Address: '1587 Glenellen Way', City: 'Brentwood',
  StartDate: '2026-07-20T05:00:00Z', Status: 'Active', ProjectManagerId: 16 }, o);
const asg = (id, num, o) => Object.assign({ Id: id, Title: '26- 2055 · ' + num + ' Thing', JobId: 27, SubPhaseNumber: num, Sequence: id,
  Crew: 'harrison', ScheduledStart: '2026-08-24T05:00:00Z', ScheduledFinish: '2026-08-25T05:00:00Z', DurationDays: 2,
  Locked: false, NotApplicable: false, InstallerSignOff: false, InstallerSignOffById: null, InstallerSignOffOn: null,
  PMSignOff: false, SignOffNotes: null, WorkDate: null, TasksTotal: 2, TasksComplete: 0, Rejected: null, RejectedOn: null, RejectedReason: null,
  SuppressReconcileUntil: null, CalendarEventId: 'ev' + id, ConflictWith: null }, o);
const task = (id, aid, o) => Object.assign({ Id: id, Title: 'Task ' + id, AssignmentId: aid, Complete: false, CompletedOn: null, CompletedById: null,
  NotApplicable: false, Note: null }, o);

function scenario(cfg) {
  const snap = { jobs: cfg.snapJobs, asg: cfg.snapAsg, tasks: cfg.snapTasks };
  const live = { jobs: cfg.liveJobs.map(r => ({ ...r })), asg: cfg.liveAsg.map(r => ({ ...r })), tasks: cfg.liveTasks.map(r => ({ ...r })) };
  const calls = [];
  const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetchMock = async (url, opts) => {
    opts = opts || {}; const method = opts.method || 'GET';
    calls.push({ url, method, headers: opts.headers || {}, body: opts.body });
    let m;
    if ((m = /Backups\/(.+?)'\)\/\$value$/.exec(decodeURIComponent(url)))) {
      const name = m[1];
      if (name === STAMP + ' Jobs.json') return json(snap.jobs);
      if (name === STAMP + ' Assignments.json') return json(snap.asg);
      if (name === STAMP + ' Tasks.json') return json(snap.tasks);
      return json({ 'odata.error': { message: { value: 'File Not Found.' } } }, 404);
    }
    if (/contextinfo/.test(url)) return json({ FormDigestValue: 'digest-1' });
    if (/GetByTitle\('Jobs'\)\/items\?/.test(url)) {
      const q = /JobNumber eq '([^']*)'/.exec(decodeURIComponent(url));
      return json({ value: live.jobs.filter(r => !q || r.JobNumber.toLowerCase() === q[1].toLowerCase()) });
    }
    if (/GetByTitle\('Assignments'\)\/items\?/.test(url)) {
      const q = /JobId eq (\d+)/.exec(decodeURIComponent(url));
      return json({ value: live.asg.filter(r => !q || r.JobId === +q[1]) });
    }
    if (/GetByTitle\('Tasks'\)\/items\?/.test(url)) {
      const q = /AssignmentId eq (\d+)/.exec(decodeURIComponent(url));
      return json({ value: live.tasks.filter(r => !q || r.AssignmentId === +q[1]) });
    }
    if ((m = /GetByTitle\('(Jobs|Assignments|Tasks)'\)\/items\((\d+)\)$/.exec(url)) && method === 'POST') {
      if (opts.headers['X-HTTP-Method'] !== 'MERGE') return json({}, 400);
      const list = { Jobs: live.jobs, Assignments: live.asg, Tasks: live.tasks }[m[1]];
      const row = list.find(r => r.Id === +m[2]);
      if (!row) return json({}, 404);
      if (cfg.failMergeIds && cfg.failMergeIds.includes(+m[2])) return json({ 'odata.error': { message: { value: 'simulated' } } }, 500);
      Object.assign(row, JSON.parse(opts.body));
      return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
    }
    throw new Error('unexpected URL in restore test fetch mock: ' + method + ' ' + url);
  };
  return { calls, live, fetchMock };
}

function loadSource(o) {
  let src = fs.readFileSync(SCRIPT, 'utf8');
  const rep = (a, b) => { const p = src.replace(a, b); if (p === src) throw new Error('literal not found in restore-project.js: ' + a); src = p; };
  if (o.live) rep("const DRY_RUN = true;", "const DRY_RUN = false;");
  rep("const SNAPSHOT = '';", "const SNAPSHOT = '" + STAMP + "';");
  rep("const JOB_NUMBER = '';", "const JOB_NUMBER = '" + (o.jobno || '26- 2055') + "';");
  return src;
}

function run(src, sc) {
  return new Promise((resolve, reject) => {
    const sandbox = { console: { log: () => {}, warn: () => {}, error: () => {}, table: () => {} }, Date, Promise, fetch: sc.fetchMock,
      encodeURIComponent, decodeURIComponent };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    try { Promise.resolve(vm.runInContext(src, sandbox)).then(resolve, reject); } catch (e) { reject(e); }
  });
}
const merges = (calls, list) => calls.filter(c => c.method === 'POST' && c.headers['X-HTTP-Method'] === 'MERGE' && c.url.includes("GetByTitle('" + list + "')"));

(async () => {
  ok('the restore script exists', fs.existsSync(SCRIPT));
  if (!fs.existsSync(SCRIPT)) { process.exit(1); }

  // A base where the live tenant has drifted from the snapshot in a few known places.
  const base = () => ({
    snapJobs: [job()],
    snapAsg: [asg(1, '2.1', { Crew: 'harrison', InstallerSignOff: true, InstallerSignOffById: 16, InstallerSignOffOn: '2026-08-25T21:03:00Z', SignOffNotes: 'signed on site', TasksComplete: 2 }),
              asg(2, '2.2', { Crew: 'devon' }),
              asg(3, '2.3', { Crew: 'stl', ScheduledStart: '2026-09-01T05:00:00Z', ScheduledFinish: '2026-09-02T05:00:00Z' })],
    snapTasks: [task(11, 1, { Complete: true, CompletedOn: '2026-08-25T20:00:00Z', CompletedById: 16 }), task(12, 1, { Complete: true, CompletedOn: '2026-08-25T20:01:00Z', CompletedById: 16 }),
                task(21, 2, { NotApplicable: true, Note: 'no coping on this one' }), task(31, 3)],
    liveJobs: [job({ Status: 'Planned' })],                              // Status drifted
    liveAsg: [asg(1, '2.1', { Crew: 'harrison', InstallerSignOff: false, InstallerSignOffById: null, InstallerSignOffOn: null, SignOffNotes: 'signed on site  |  REOPENED by someone', TasksComplete: 0 }),  // sign-off lost
              asg(2, '2.2', { Crew: 'antonio', DurationDays: 4 }),            // crew and duration drifted
              asg(3, '2.3', { Crew: 'stl', ScheduledStart: '2026-09-01T05:00:00Z', ScheduledFinish: '2026-09-02T05:00:00Z' })],   // unchanged
    liveTasks: [task(11, 1), task(12, 1, { Complete: true, CompletedOn: '2026-08-25T20:01:00Z', CompletedById: 16 }),   // 11 un-ticked live
                task(21, 2, { NotApplicable: false, Note: null }), task(31, 3)]                                          // N/A lost
  });

  // ---------- 1. DRY_RUN: the full plan, no POST ----------
  {
    const sc = scenario(base());
    const out = await run(loadSource({}), sc);
    ok('DRY_RUN performs no POST at all (no digest, no MERGE)', sc.calls.every(c => c.method !== 'POST'), sc.calls.filter(c => c.method === 'POST').length + ' posts');
    ok('it reports the plan: 1 job field, 2 assignment rows, 2 task rows',
       out && out.dryRun === true && out.plan && out.plan.jobFields === 1 && out.plan.assignmentRows === 2 && out.plan.taskRows === 2, JSON.stringify(out && out.plan));
    ok('the plan names the sign-off fields on 2.1', out && out.plan.fields.some(f => f.list === 'Assignments' && f.num === '2.1' && f.field === 'InstallerSignOffById' && f.to === 16),
       JSON.stringify(out && out.plan.fields.filter(f => f.num === '2.1').map(f => f.field)));
    ok('the unchanged row 2.3 is not in the plan', out && !out.plan.fields.some(f => f.num === '2.3'));
    ok('the live rows are untouched', sc.live.asg[1].Crew === 'antonio' && sc.live.jobs[0].Status === 'Planned');
  }

  // ---------- 2. live run: exact bodies, and the verify pass ----------
  {
    const sc = scenario(base());
    const out = await run(loadSource({ live: true }), sc);
    const am = merges(sc.calls, 'Assignments'), tm = merges(sc.calls, 'Tasks'), jm = merges(sc.calls, 'Jobs');
    ok('one MERGE per differing assignment row, none for the unchanged one', am.length === 2 && !am.some(c => /items\(3\)$/.test(c.url)), am.length + '');
    const b1 = JSON.parse(am.find(c => /items\(1\)$/.test(c.url)).body);
    ok('2.1 gets its sign-off back: flag, person, time, notes, counter', b1.InstallerSignOff === true && b1.InstallerSignOffById === 16
       && b1.InstallerSignOffOn === '2026-08-25T21:03:00Z' && b1.SignOffNotes === 'signed on site' && b1.TasksComplete === 2, JSON.stringify(b1));
    ok('2.1 body carries only the differing fields plus the suppression stamp',
       Object.keys(b1).sort().join(',') === ['InstallerSignOff', 'InstallerSignOffById', 'InstallerSignOffOn', 'SignOffNotes', 'SuppressReconcileUntil', 'TasksComplete'].join(','), Object.keys(b1).sort().join(','));
    const b2 = JSON.parse(am.find(c => /items\(2\)$/.test(c.url)).body);
    ok('2.2 gets crew and duration back and nothing else', b2.Crew === 'devon' && b2.DurationDays === 2
       && Object.keys(b2).sort().join(',') === ['Crew', 'DurationDays', 'SuppressReconcileUntil'].join(','), JSON.stringify(b2));
    const ahead = new Date(b2.SuppressReconcileUntil) - Date.now();
    ok('the suppression stamp is about ten minutes ahead', ahead > 5 * 60000 && ahead < 15 * 60000, b2.SuppressReconcileUntil);
    ok('Tasks MERGEs carry no suppression stamp', tm.length === 2 && tm.every(c => !('SuppressReconcileUntil' in JSON.parse(c.body))), tm.length + '');
    const t11 = JSON.parse(tm.find(c => /items\(11\)$/.test(c.url)).body), t21 = JSON.parse(tm.find(c => /items\(21\)$/.test(c.url)).body);
    ok('a task tick is restored with its person and time', t11.Complete === true && t11.CompletedById === 16 && t11.CompletedOn === '2026-08-25T20:00:00Z', JSON.stringify(t11));
    ok('a task N/A is restored with its reason', t21.NotApplicable === true && t21.Note === 'no coping on this one', JSON.stringify(t21));
    ok('the Jobs row gets its Status back, with no suppression stamp', jm.length === 1 && JSON.parse(jm[0].body).Status === 'Active' && !('SuppressReconcileUntil' in JSON.parse(jm[0].body)), jm.length + '');
    ok('every MERGE went out with the digest and IF-MATCH *', [...am, ...tm, ...jm].every(c => c.headers['X-RequestDigest'] === 'digest-1' && c.headers['IF-MATCH'] === '*'));
    ok('the summary counts what landed', out.rowsWritten === 5 && out.failed.length === 0, JSON.stringify({ rowsWritten: out.rowsWritten, failed: out.failed }));
    ok('the verify pass re-read the rows and found nothing left to restore', out.verifyMismatch.length === 0, JSON.stringify(out.verifyMismatch));
    ok('the live store now matches the snapshot', sc.live.asg[0].InstallerSignOff === true && sc.live.asg[1].Crew === 'devon' && sc.live.jobs[0].Status === 'Active' && sc.live.tasks[2].NotApplicable === true);
  }

  // ---------- 3. a snapshot row that no longer exists live refuses the whole restore ----------
  {
    const cfg = base(); cfg.liveAsg = cfg.liveAsg.filter(r => r.Id !== 3);
    const sc = scenario(cfg);
    const out = await run(loadSource({ live: true }), sc);
    ok('a missing assignment row refuses the whole restore: no MERGE anywhere', sc.calls.every(c => c.method !== 'POST'), sc.calls.filter(c => c.method === 'POST').length + ' posts');
    ok('and the refusal names the missing row', out.refused && /2\.3|Id 3\b/.test(JSON.stringify(out.refused)), JSON.stringify(out.refused));
  }
  {
    const cfg = base(); cfg.liveTasks = cfg.liveTasks.filter(r => r.Id !== 31);
    const sc = scenario(cfg);
    const out = await run(loadSource({ live: true }), sc);
    ok('a missing task row refuses the whole restore too', sc.calls.every(c => c.method !== 'POST') && !!out.refused);
  }

  // ---------- 4. the job number resolves to a different live row: refused ----------
  {
    const cfg = base(); cfg.liveJobs = [job({ Id: 99, Status: 'Planned' })]; cfg.liveAsg.forEach(r => { r.JobId = 99; });
    const sc = scenario(cfg);
    const out = await run(loadSource({ live: true }), sc);
    ok('a re-created project with the same job number is a different row and is refused', sc.calls.every(c => c.method !== 'POST') && !!out.refused && /Id/.test(JSON.stringify(out.refused)), JSON.stringify(out.refused));
  }

  // ---------- 5. job number not in the snapshot ----------
  {
    const sc = scenario(base());
    const out = await run(loadSource({ live: true, jobno: 'D2-9999' }), sc);
    ok('a job number the snapshot does not hold is refused before any live read', sc.calls.every(c => c.method !== 'POST') && !sc.calls.some(c => /GetByTitle\('Assignments'\)/.test(c.url)) && !!out.refused);
  }

  // ---------- 6. nothing differs ----------
  {
    const cfg = base(); cfg.liveJobs = cfg.snapJobs.map(r => ({ ...r })); cfg.liveAsg = cfg.snapAsg.map(r => ({ ...r })); cfg.liveTasks = cfg.snapTasks.map(r => ({ ...r }));
    const sc = scenario(cfg);
    const out = await run(loadSource({ live: true }), sc);
    ok('when nothing differs nothing is written and the summary says so', sc.calls.every(c => c.method !== 'POST') && out.rowsWritten === 0 && out.plan.fields.length === 0);
  }

  // ---------- 7. a failed MERGE is reported, not hidden, and the rest still land ----------
  {
    const cfg = base(); cfg.failMergeIds = [2];
    const sc = scenario(cfg);
    const out = await run(loadSource({ live: true }), sc);
    ok('one failed row is named and the others still landed', out.failed.length === 1 && String(out.failed[0].id) === '2' && out.rowsWritten === 4, JSON.stringify({ failed: out.failed, rowsWritten: out.rowsWritten }));
    ok('the verify pass names the row that did not come back', out.verifyMismatch.some(v => String(v.id) === '2'), JSON.stringify(out.verifyMismatch));
  }

  process.exit(fail);
})().catch(e => { console.log('FAIL · harness threw: ' + (e && e.stack || e)); process.exit(1); });
