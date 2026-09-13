/* Equivalence test: the Graph read path and the REST read path must produce
 * the SAME planner payload from the SAME underlying tenant data.
 *
 * This is a stronger check than asserting field names on one surface alone.
 * It runs the real `sharepoint/export-to-planner.js` against the captured
 * REST fixture (via run-export.js, exactly as live-export.js does), runs the
 * real `web/graph-to-planner.js` against the captured Graph fixture,
 * and asserts the two payloads agree pool-for-pool, sub-phase-for-sub-phase.
 * If the Graph mapping's join is wrong anywhere -- wrong field name, wrong
 * type, a `===` between a string and a number -- this is what catches it,
 * because a broken join does not produce an error, it produces an empty or
 * mismatched result that this comparison is built to notice.
 *
 * The two fixtures were captured on different days (2026-09-11 REST,
 * 2026-09-13 Graph) against the same three fictional demo pools, which do
 * not change on their own between captures -- so an exact match is the
 * correct expectation, not a coincidence to explain away.
 *
 * Then the Graph-derived payload is imported into the real planner in jsdom,
 * the same way live-export.js proves the REST payload lands correctly.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { runExport } = require('./run-export');
const { toPlannerPayload } = require('../../web/graph-to-planner.js');

const ROOT = path.resolve(__dirname, '../..');
const PLANNER = path.join(ROOT, 'web/index.html');
const REST_FIXTURE = path.join(__dirname, 'live-payloads.json');
const GRAPH_FIXTURE = path.join(__dirname, 'live-payloads-graph.json');

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

for (const f of [REST_FIXTURE, GRAPH_FIXTURE]) {
  if (!fs.existsSync(f)) {
    // A missing committed fixture is a broken checkout, not "not applicable" --
    // see the same reasoning in live-export.js. Exiting 0 here would be a
    // second silent-green path.
    console.log('FAIL · ' + path.basename(f) + ' is missing. It is committed to the repo.');
    process.exit(1);
  }
}
const restLive = JSON.parse(fs.readFileSync(REST_FIXTURE, 'utf8'));
const graphLive = JSON.parse(fs.readFileSync(GRAPH_FIXTURE, 'utf8'));

const totalTasks = p => p.jobs.reduce((n, j) => n + j.sections.reduce((m, s) => m + s.tasks.length, 0), 0);
const totalDone = p => p.jobs.reduce((n, j) => n + j.sections.reduce((m, s) => m + s.tasks.filter(t => t.done).length, 0), 0);
const totalNa = p => p.jobs.reduce((n, j) => n + j.sections.reduce((m, s) => m + s.tasks.filter(t => t.na).length, 0), 0);

(async () => {
  let restPayload;
  try { restPayload = await runExport(restLive); }
  catch (e) { console.log('FAIL · REST export script threw: ' + e.message); process.exit(1); }

  let graphPayload;
  try { graphPayload = toPlannerPayload(graphLive); }
  catch (e) { console.log('FAIL · graph-to-planner threw: ' + e.message); process.exit(1); }

  ok('REST payload produced', !!restPayload && restPayload.kind === 'd2-sharepoint-export');
  ok('Graph payload produced', !!graphPayload && graphPayload.kind === 'd2-sharepoint-export');
  ok('Graph payload uses the SAME shape the importer expects (no second payload kind)',
     graphPayload.kind === restPayload.kind && Array.isArray(graphPayload.jobs));

  /* ---- ids are the exact string-vs-number risk this file exists to catch --- */
  ok('every Graph job id is a real SharePoint row id (numeric), not the raw string',
     graphPayload.jobs.every(j => Number.isInteger(j.id)),
     graphPayload.jobs.map(j => j.jobno + '#' + j.id).join(' '));
  ok('every Graph sub-phase id is a real SharePoint row id (numeric)',
     graphPayload.jobs.every(j => j.sections.every(s => Number.isInteger(s.id))));

  /* ---- 1. equivalence: REST-mapped vs Graph-mapped, same tenant data ---- */
  const restByJobno = new Map(restPayload.jobs.map(j => [String(j.jobno), j]));
  const graphByJobno = new Map(graphPayload.jobs.map(j => [String(j.jobno), j]));

  ok('same pool count', restPayload.jobs.length === graphPayload.jobs.length,
     restPayload.jobs.length + ' vs ' + graphPayload.jobs.length);
  const restNums = [...restByJobno.keys()].sort();
  const graphNums = [...graphByJobno.keys()].sort();
  ok('same job numbers', JSON.stringify(restNums) === JSON.stringify(graphNums),
     'REST=' + restNums.join(',') + '  Graph=' + graphNums.join(','));

  const secCountMismatch = [], crewMismatch = [], dateMismatch = [], durationMismatch = [],
        flagMismatch = [], taskCountMismatch = [], tickMismatch = [], titleMismatch = [];

  for (const [jobno, rj] of restByJobno) {
    const gj = graphByJobno.get(jobno);
    if (!gj) continue; // already reported by the job-numbers check above

    if (rj.sections.length !== gj.sections.length) {
      secCountMismatch.push(jobno + ': REST ' + rj.sections.length + ' vs Graph ' + gj.sections.length);
      continue;
    }
    const rBynum = new Map(rj.sections.map(s => [s.num, s]));
    const gBynum = new Map(gj.sections.map(s => [s.num, s]));
    for (const [num, rs] of rBynum) {
      const gs = gBynum.get(num);
      if (!gs) { secCountMismatch.push(jobno + ' ' + num + ': present in REST, missing in Graph'); continue; }

      if (rs.crewId !== gs.crewId) crewMismatch.push(jobno + ' ' + num + ': ' + rs.crewId + ' vs ' + gs.crewId);
      if (rs.start !== gs.start || rs.finish !== gs.finish)
        dateMismatch.push(jobno + ' ' + num + ': ' + rs.start + '..' + rs.finish + ' vs ' + gs.start + '..' + gs.finish);
      if (rs.days !== gs.days) durationMismatch.push(jobno + ' ' + num + ': ' + rs.days + ' vs ' + gs.days);
      if (rs.skip !== gs.skip || rs.locked !== gs.locked || rs.inst !== gs.inst || rs.pm !== gs.pm)
        flagMismatch.push(jobno + ' ' + num + ': REST ' +
          JSON.stringify({ skip: rs.skip, locked: rs.locked, inst: rs.inst, pm: rs.pm }) + ' vs Graph ' +
          JSON.stringify({ skip: gs.skip, locked: gs.locked, inst: gs.inst, pm: gs.pm }));
      if (rs.tasks.length !== gs.tasks.length)
        taskCountMismatch.push(jobno + ' ' + num + ': ' + rs.tasks.length + ' vs ' + gs.tasks.length);
      const rDone = rs.tasks.filter(t => t.done).length, gDone = gs.tasks.filter(t => t.done).length;
      const rNa = rs.tasks.filter(t => t.na).length, gNa = gs.tasks.filter(t => t.na).length;
      if (rDone !== gDone || rNa !== gNa)
        tickMismatch.push(jobno + ' ' + num + ': done ' + rDone + '/' + gDone + ' na ' + rNa + '/' + gNa);
      const rTitles = rs.tasks.map(t => t.title).join('|');
      const gTitles = gs.tasks.map(t => t.title).join('|');
      if (rTitles !== gTitles) titleMismatch.push(jobno + ' ' + num);
    }
  }

  ok('same section count per pool', secCountMismatch.length === 0, secCountMismatch.slice(0, 5).join(' | '));
  ok('same crew code per sub-phase', crewMismatch.length === 0, crewMismatch.slice(0, 5).join(' | '));
  ok('same dates per sub-phase', dateMismatch.length === 0, dateMismatch.slice(0, 5).join(' | '));
  ok('same duration per sub-phase', durationMismatch.length === 0, durationMismatch.slice(0, 5).join(' | '));
  ok('same flags (skip/locked/inst/pm) per sub-phase', flagMismatch.length === 0, flagMismatch.slice(0, 5).join(' | '));
  ok('same task count per sub-phase', taskCountMismatch.length === 0, taskCountMismatch.slice(0, 5).join(' | '));
  ok('same done/N-A tick counts per sub-phase', tickMismatch.length === 0, tickMismatch.slice(0, 5).join(' | '));
  ok('same task text per sub-phase', titleMismatch.length === 0, titleMismatch.slice(0, 5).join(' | '));

  const restCrews = [...new Set(restPayload.jobs.flatMap(j => j.sections.map(s => s.crewId)))].sort();
  const graphCrews = [...new Set(graphPayload.jobs.flatMap(j => j.sections.map(s => s.crewId)))].sort();
  ok('same set of crew codes across the tenant', JSON.stringify(restCrews) === JSON.stringify(graphCrews),
     'REST=' + restCrews.join(',') + '  Graph=' + graphCrews.join(','));

  ok('same total task count', totalTasks(restPayload) === totalTasks(graphPayload),
     totalTasks(restPayload) + ' vs ' + totalTasks(graphPayload));
  ok('same total ticked count', totalDone(restPayload) === totalDone(graphPayload),
     totalDone(restPayload) + ' vs ' + totalDone(graphPayload));
  ok('same total N/A count', totalNa(restPayload) === totalNa(graphPayload),
     totalNa(restPayload) + ' vs ' + totalNa(graphPayload));

  ok('same nonWork length', restPayload.nonWork.length === graphPayload.nonWork.length,
     restPayload.nonWork.length + ' vs ' + graphPayload.nonWork.length);
  ok('same nonWork set', JSON.stringify([...restPayload.nonWork].sort()) === JSON.stringify([...graphPayload.nonWork].sort()));

  /* ---- 2. import the Graph-derived payload into the real planner ---- */
  let html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
    `<script>window.__x=()=>{window.S=S;window.importFromD2=importFromD2;window.allSecs=allSecs;window.autoSchedule=autoSchedule;};</script><script>__x();</script></body>`);
  const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const win = dom.window;
  win.confirm = () => true;
  const alerts = []; win.alert = m => alerts.push(m);
  await new Promise(r => setTimeout(r, 600));

  win.importFromD2(new win.File([JSON.stringify(graphPayload)], 'graph.json', { type: 'application/json' }));
  await new Promise(r => setTimeout(r, 500));

  const S = win.S;
  const liveSigned = graphLive.asg.filter(a => a.fields.InstallerSignOff).length;
  const liveDone = graphLive.tasks.filter(t => t.fields.Complete).length;

  ok('planner accepted the Graph-derived export', alerts.some(a => /Loaded from D2/.test(a)));
  ok('no sub-phase failed to match the template', !alerts.some(a => /matched nothing/.test(a)),
     alerts.join(' | ').slice(0, 120));
  ok('3 pools landed', S.jobs.length === 3, S.jobs.map(j => j.jobno).join(','));
  const all = S.jobs.flatMap(j => win.allSecs(j).map(x => x.s));
  ok('138 sub-phases landed', all.length === graphLive.asg.length, all.length + '');
  ok('sign-offs landed and match the tenant', all.filter(s => s.inst).length === liveSigned,
     all.filter(s => s.inst).length + ' of ' + liveSigned);
  ok('signed work imported as locked', all.filter(s => s.inst).every(s => s.locked));
  ok('ticks landed and match the tenant',
     all.reduce((n, s) => n + s.tasks.filter(t => t.done).length, 0) === liveDone);

  // the same trap live-export.js guards: Auto-Schedule must not move completed work
  const before = all.map(s => s.crewId + '|' + s.start + '|' + s.inst);
  win.autoSchedule();
  const after = S.jobs.flatMap(j => win.allSecs(j).map(x => x.s));
  const movedSigned = after.filter((s, i) => s.inst && (s.crewId + '|' + s.start + '|' + s.inst) !== before[i]).length;
  ok('Auto-Schedule left signed work alone (Graph path)', movedSigned === 0, movedSigned + ' moved');

  console.log('\n' + (fail ? 'FAILURES ABOVE' : 'REST and Graph agree: ' + restPayload.jobs.length +
    ' pools, ' + totalTasks(restPayload) + ' tasks, ' + totalDone(restPayload) + ' ticks, ' +
    restPayload.nonWork.length + ' non-work days -- and the Graph payload imports identically.'));
  process.exit(fail);
})();
