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

/* ---- sign-off comments and the three rejection columns (Task 2) ----
 * Synthetic comment rows, because the captured fixture predates the
 * `Sign-off Comments` list. Shaped exactly as Graph returns an item:
 * createdBy/createdDateTime at the ROOT, fields alongside. The REST fixture
 * carries no comments and no rejection columns at all -- by design, since
 * that capture predates this feature -- so the REST-vs-Graph equivalence
 * checks above deliberately never compare thread/rejected/rejectedOn/
 * rejectedReason; this block is the only coverage for those fields. */
{
  const asgId = graphLive.asg[0].fields.id; // a real assignment from the capture
  const mkComment = (id, kind, body, who, at, lookup) => ({
    id: String(id),
    createdBy: { user: { displayName: who, email: 'x@d2pools.com' } },
    createdDateTime: at,
    fields: {
      id: String(id), Kind: kind, Body: body,
      AssignmentLookupId: lookup == null ? String(asgId) : lookup
    }
  });

  const withComments = Object.assign({}, graphLive, {
    comments: [
      mkComment(3, 'Comment', 'third', 'Cody Campbell', '2026-09-20T15:00:00Z'),
      mkComment(1, 'Rejected', 'tile line is short', 'Don Borgeson', '2026-09-18T12:00:00Z'),
      mkComment(2, 'Resolved', '', 'Don Borgeson', '2026-09-19T09:30:00Z'),
      // A lookup id as a NUMBER, which is what a hand-built row or a REST
      // source gives. String(...) on both sides must still match it.
      mkComment(4, 'Comment', 'numeric lookup', 'Emon Alexander', '2026-09-21T08:00:00Z', Number(asgId)),
      // An orphan: points at no assignment. Must be dropped, not crash.
      mkComment(5, 'Comment', 'orphan', 'Nobody', '2026-09-21T09:00:00Z', '99999999')
    ]
  });

  const p2 = toPlannerPayload(withComments);
  const sec = p2.jobs.flatMap(j => j.sections).find(s => String(s.id) === String(asgId));
  ok('the assignment carrying comments is in the payload', !!sec);
  ok('four comments land, the orphan is dropped', sec && sec.thread.length === 4,
     'got ' + (sec && sec.thread.length));
  ok('thread is oldest first by createdDateTime', sec && sec.thread.map(t => t.id).join(',') === '1,2,3,4',
     'got ' + (sec && sec.thread.map(t => t.id).join(',')));
  ok('author from createdBy.user.displayName, not fields.createdBy',
     sec && sec.thread[0].by === 'Don Borgeson', 'got ' + (sec && sec.thread[0].by));
  ok('raw UTC timestamp preserved', sec && sec.thread[0].at === '2026-09-18T12:00:00Z');
  ok('kind carried through', sec && sec.thread[0].kind === 'Rejected');
  ok('a NUMERIC lookup id still joins', sec && sec.thread[3].body === 'numeric lookup');

  // The three Assignments columns. Absent on every row in the capture, which
  // is the normal state, so absent must read as not-rejected rather than
  // undefined.
  const anySec = p2.jobs[0].sections[0];
  ok('a row with no Rejected field reads false', anySec.rejected === false, 'got ' + anySec.rejected);
  ok('absent reason reads null', anySec.rejectedReason === null);

  const rejGraph = JSON.parse(JSON.stringify(graphLive));
  rejGraph.asg[0].fields.Rejected = true;
  rejGraph.asg[0].fields.RejectedOn = '2026-09-20T14:05:00Z';
  rejGraph.asg[0].fields.RejectedReason = 'coping joints uneven';
  const p3 = toPlannerPayload(rejGraph);
  const r = p3.jobs.flatMap(j => j.sections).find(s => String(s.id) === String(asgId));
  ok('Rejected maps true', r && r.rejected === true);
  ok('reason maps through', r && r.rejectedReason === 'coping joints uneven');
  ok('RejectedOn maps through', r && r.rejectedOn === '2026-09-20T14:05:00Z');

  // No comments key at all is the state on every load until Task 1 is
  // deployed, and the state forever if the list read fails. It must not throw.
  let p4, threw = null;
  try { p4 = toPlannerPayload(Object.assign({}, graphLive, { comments: undefined })); }
  catch (e) { threw = e; }
  ok('a missing comments list does not throw', !threw, threw && threw.message);
  ok('no comments list yields empty threads, not a crash', !threw && p4.jobs[0].sections[0].thread.length === 0);
}

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
  {
    // The N/A reason lives in Tasks.Note. Graph omits an empty column, so only
    // the rows that carry one are checked, against the capture itself.
    const withNote = graphLive.tasks.filter(r => r.fields.Note);
    const mapped = graphPayload.jobs.flatMap(j => j.sections.flatMap(s => s.tasks)).filter(t => t.note);
    ok('N/A reasons come through from Graph', withNote.length > 0 && mapped.length === withNote.length
       && withNote.every(r => mapped.some(t => t.id === Number(r.fields.id) && t.note === r.fields.Note && t.na)),
       withNote.length + ' in capture, ' + mapped.length + ' mapped');
  }
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

  ok('planner accepted the Graph-derived export', alerts.some(a => /Schedule loaded/.test(a)));
  ok('no sub-phase failed to match the template', !alerts.some(a => /matched nothing/.test(a)),
     alerts.join(' | ').slice(0, 120));
  ok('3 pools landed', S.jobs.length === 3, S.jobs.map(j => j.jobno).join(','));
  const all = S.jobs.flatMap(j => win.allSecs(j).map(x => x.s));
  ok('138 sub-phases landed', all.length === graphLive.asg.length, all.length + '');
  ok('sign-offs landed and match the tenant', all.filter(s => s.inst).length === liveSigned,
     all.filter(s => s.inst).length + ' of ' + liveSigned);
  ok('signed work imported as locked', all.filter(s => s.inst).every(s => s.locked));
  {
    // Every checklist line must carry the id of the SharePoint row with the SAME
    // name. Matching by name is what keeps a tick off the wrong row after a
    // reorder; on the real capture it must still attach every id.
    const byId = new Map(graphLive.tasks.map(r => [Number(r.fields.id), r.fields.Title]));
    const lines = all.flatMap(s => s.tasks);
    const withId = lines.filter(t => t.spId != null);
    ok('every task line got its SharePoint row id', withId.length === graphLive.tasks.length,
       withId.length + ' of ' + graphLive.tasks.length);
    ok('...and every id belongs to a row with the same task name',
       withId.every(t => String(byId.get(Number(t.spId))).trim() === String(t.t).trim()));
  }
  ok('ticks landed and match the tenant',
     all.reduce((n, s) => n + s.tasks.filter(t => t.done).length, 0) === liveDone);

  // the same trap live-export.js guards: Auto-Schedule must not move completed work
  const before = all.map(s => s.crewId + '|' + s.start + '|' + s.inst);
  win.autoSchedule();
  const after = S.jobs.flatMap(j => win.allSecs(j).map(x => x.s));
  const movedSigned = after.filter((s, i) => s.inst && (s.crewId + '|' + s.start + '|' + s.inst) !== before[i]).length;
  ok('Auto-Schedule left signed work alone (Graph path)', movedSigned === 0, movedSigned + ' moved');

  /* ---- templates and build type (2026-10-13) ---- */
  {
    const T = graphPayload.templates;
    ok('Graph payload carries templates for both types', T && Array.isArray(T.Gunite) && Array.isArray(T.Fiberglass));
    const gs = T.Gunite.flatMap(p => p.sections), fsx = T.Fiberglass.flatMap(p => p.sections);
    ok('Gunite template is the live 46 with 295 tasks', gs.length === 46 && gs.reduce((n, s) => n + s.tasks.length, 0) === 295);
    ok('Fiberglass template is 45 with 248 tasks', fsx.length === 45 && fsx.reduce((n, s) => n + s.tasks.length, 0) === 248);
    ok('phases are grouped by the integer part of the number, in order', T.Fiberglass.map(p => p.num).join() === '0,1,2,3,4,5,6,7,8,9');
    ok('phase names come from PhaseName', T.Fiberglass[2].name === 'Base Preparation and Shell Set');
    ok('sections are in Sequence order', fsx.map(s => s.num).slice(0, 3).join() === '0.0,0.1,1.0');
    ok('skill is the TradeCode through the Trade lookup', gs.find(s => s.num === '1.2').skill === 'demolition');
    ok('a row with no trade and DefaultCrew office is @office', gs.find(s => s.num === '0.0').skill === '@office');
    ok('subcon -> @sub, unassigned -> @unassigned', gs.find(s => s.num === '2.4').skill === '@sub' && gs.find(s => s.num === '1.4').skill === '@unassigned');
    ok('days come from DurationDays', gs.every(s => s.days >= 1));
    ok('every live job carries buildType Gunite', graphPayload.jobs.every(j => j.buildType === 'Gunite'));
    const M = require(path.join(ROOT, 'web/graph-to-planner.js'));
    ok('normType folds case and space, defaults to Gunite', M.normType(' fiberglass ') === 'Fiberglass' && M.normType('GUNITE') === 'Gunite' && M.normType(undefined) === 'Gunite' && M.normType('Carbon') === 'Gunite');
    ok('a template read with no rows yields no key, not an empty array', !('Carbon' in T));
    /* feature data (step 4): synthetic rows, since the live capture predates the columns */
    {
      const sp = (id, seq, title, extra) => ({ id: String(id), fields: Object.assign({ id: String(id), Sequence: seq, Title: title, SubPhaseNumber: '3.' + seq, BuildType: 'Gunite', DefaultCrew: 'x', DurationDays: 2 }, extra) });
      const tp = (id, sub, seq, title, extra) => ({ id: String(id), fields: Object.assign({ id: String(id), SubPhaseLookupId: String(sub), Sequence: seq, Title: title, BuildType: 'Gunite' }, extra) });
      const spt = [sp(10, 1, 'Plain', {}), sp(11, 2, 'Auto Cover', { Optional: true }), sp(12, 3, 'Spa Shell', { Optional: true, Feature: ' Spa ', TradeLookupId: '5' })];
      const tpt = [tp(20, 12, 2, 'Second'), tp(21, 12, 1, 'First', { Feature: 'Spa' }), tp(22, 10, 1, 'Only')];
      const t = M.templatesFrom(spt, tpt, []).Gunite[0].sections;
      ok('template section carries id, seq, optional', t[1].id === 11 && t[1].seq === 2 && t[1].optional === true && t[0].optional === false);
      ok('feature is null on a plain row, the title on a bare optional row, the trimmed Feature when set', t[0].feature === null && t[1].feature === 'Auto Cover' && t[2].feature === 'Spa');
      ok('tradeId is a string or null', t[2].tradeId === '5' && t[0].tradeId === null);
      ok('tasks stay plain strings in Sequence order', t[2].tasks.join() === 'First,Second' && typeof t[2].tasks[0] === 'string');
      ok('taskSeq and taskFeature align with tasks', t[2].taskSeq.join() === '1,2' && t[2].taskFeature[0] === 'Spa' && t[2].taskFeature[1] === null && t[0].taskFeature.length === 1);
      const gp = M.toPlannerPayload({ jobs: [{ id: '1', fields: { id: '1', Title: 'J', JobNumber: 'F-1', Status: 'Active', BuildType: 'Gunite' } }],
        asg: [{ id: '2', fields: { id: '2', JobLookupId: '1', Sequence: 1, SubPhaseNumber: '1.0', SubPhaseName: 'A' } }],
        tasks: [{ id: '3', fields: { id: '3', AssignmentLookupId: '2', Sequence: 1, Title: 'a', Feature: 'Spa' } }, { id: '4', fields: { id: '4', AssignmentLookupId: '2', Sequence: 2, Title: 'b' } }], cal: [] });
      const pt = gp.jobs[0].sections[0].tasks;
      ok('project task carries feature, null when blank', pt[0].feature === 'Spa' && pt[1].feature === null);
    }
    ok('REST payload carries the same templates and types', JSON.stringify(restPayload.templates) === JSON.stringify(T) && restPayload.jobs.every(j => j.buildType === 'Gunite'));
  }

  console.log('\n' + (fail ? 'FAILURES ABOVE' : 'REST and Graph agree: ' + restPayload.jobs.length +
    ' pools, ' + totalTasks(restPayload) + ' tasks, ' + totalDone(restPayload) + ' ticks, ' +
    restPayload.nonWork.length + ' non-work days -- and the Graph payload imports identically.'));
  process.exit(fail);
})();
