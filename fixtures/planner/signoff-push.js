/* The sign-off Save, end to end in the real page, against a stubbed Graph.
 *
 * WHY THIS EXISTS: the sign-off write path shipped on 2026-09-16 with fifteen
 * browser assertions that lived in a scratchpad and were never committed, so
 * the PATCH bodies pushSignoffs actually sends were pinned by nothing in the
 * repo. The first live run then found three things those assertions had not
 * looked for:
 *
 *  1. Counters were taken from the planner's own count, so a refused or failed
 *     tick left TasksComplete disagreeing with the rows until the nightly sweep.
 *  2. A Reopen wrote a UTC stamp with no zone on it, kept InstallerSignOffOn,
 *     and did not say who had signed -- three ways it differed from
 *     D2 - Reopen Sign-off writing the same record from the field app.
 *  3. The Save button read "Save 0 edits to SharePoint" over eight sign-off
 *     changes, and the results said "Nothing needed saving." under five saved
 *     ones.
 *
 * Only fetch is stubbed. The planner, writeback-core.js and graph-writeback.js
 * all run for real, inlined because jsdom does not fetch <script src>.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const WEB = path.resolve(__dirname, '../../web');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
  .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
  .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
  // Loaded as the real page loads it: Save builds its per-project reads with it (Spec A).
  .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
  .replace('</body>', `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.D2_GRAPH=D2_GRAPH;
     window.importFromD2Payload=importFromD2Payload;window.sign=sign;window.openSavePreview=openSavePreview;
     window.confirmSaveByPush=confirmSaveByPush;window.editSec=editSec;window.toggleNA=toggleNA;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.alert = () => {}; win.confirm = () => true;

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = win.S, L = win.D2_GRAPH.lists;
  ok('the inlined write scripts loaded', !!win.D2WritebackCore && !!win.D2GraphWriteback);

  // ---- three sub-phases on one pool, as SharePoint holds them at load ----
  const payload = {
    app: 'D2 Pool Build Scheduler', kind: 'd2-sharepoint-export', exported: '2026-09-16', site: 'x', nonWork: [],
    jobs: [{ id: 19, jobno: 'D2-1042', name: 'Reyes Residence', addr: '', city: '', start: '2026-09-08', status: 'Active', pm: '',
      sections: [] }]
  };
  const T = win.eval('SEED_TEMPLATE');
  const defs = T.flatMap(g => g.sections.map(s => ({ num: s.num, name: s.name, tasks: s.tasks })));
  payload.jobs[0].sections = defs.map((s, i) => ({
    id: 1000 + i, num: s.num, name: s.name, crewId: 'devon', start: '2026-09-08', finish: '2026-09-09', days: 2,
    skip: false, locked: false, inst: i === 1 || i === 3, pm: false,
    tasks: s.tasks.map((t, k) => (i === 0 && k === 5
      ? { id: 5000 + i * 100 + k, seq: k + 1, title: t, done: false, na: true, note: 'Inspection pending' }
      : i === 4 && k === 0 ? { id: 5000 + i * 100 + k, seq: 2, title: t, done: false, na: false }      // moved to 2nd
      : i === 4 && k === 1 ? { id: 5000 + i * 100 + k, seq: 1, title: t, done: false, na: false }      // moved to 1st
      : i === 4 && k === 2 ? { id: 5000 + i * 100 + k, seq: 3, title: t + ' (reworded)', done: false, na: false }
      : i === 5 && k === 0 ? { id: 5000 + i * 100 + k, seq: 2, title: t + ' (reworded)', done: false, na: false } // moved AND renamed
      : i === 5 && k === 1 ? { id: 5000 + i * 100 + k, seq: 1, title: t, done: false, na: false }
      : i === 6 && k === 0 ? { id: 5000 + i * 100 + k, seq: 2, title: t + ' (reworded)', done: false, na: false } // moved AND renamed
      : i === 6 && k === 1 ? { id: 5000 + i * 100 + k, seq: 1, title: t, done: false, na: false }
      : i === 6 && k === 2 ? { id: 5000 + i * 100 + k, seq: 3, title: t + ' (renamed)', done: false, na: false }  // renamed in place
      : { id: 5000 + i * 100 + k, seq: k + 1, title: t, done: false, na: false }))
  }));
  win.importFromD2Payload(payload, true);
  const j = S.jobs.find(x => x.jobno === 'D2-1042');
  const secs = win.allSecs(j);
  const A = secs[0].s, B = secs[1].s, C = secs[2].s, D = secs[3].s;   // D is signed and stays signed
  const E = secs[4].s;                                                // reordered and reworded in SharePoint
  ok('a checklist reordered in SharePoint still gives each line the row with its own name',
     E.tasks[0].spId === 5400 && E.tasks[1].spId === 5401, E.tasks[0].spId + ',' + E.tasks[1].spId);
  ok('a task renamed in place keeps its row id: the leftovers line up exactly', E.tasks[2].spId === 5402, String(E.tasks[2].spId));
  /* Since 2026-10-21 the checklist is built from the row's own Tasks, so a task moved or
     reworded in SharePoint is shown as SharePoint has it and keeps its own row: there is no
     matching left that could aim a tick at the wrong row. */
  const F = secs[5].s;                                                // one task both moved and renamed
  ok('a task both moved and renamed shows SharePoint\'s wording and keeps its own row',
     F.tasks[0].spId === 5500 && /\(reworded\)$/.test(F.tasks[0].t) && F.tasks[1].spId === 5501,
     F.tasks[0].spId + ',' + F.tasks[0].t + ',' + F.tasks[1].spId);
  const H = secs[6].s;
  ok('every line keeps its own row id, whatever was reordered or renamed',
     H.tasks[0].spId === 5600 && H.tasks[1].spId === 5601 && H.tasks[2].spId === 5602,
     [H.tasks[0].spId, H.tasks[1].spId, H.tasks[2].spId].join(','));
  ok('the checklist shows SharePoint\'s own task text, not the template\'s',
     /\(renamed\)$/.test(H.tasks[2].t), H.tasks[2].t);
  const nA = A.tasks.length, nC = C.tasks.length;
  ok('scenario has room for the checks (C needs four tasks)', nC >= 4, 'A=' + nA + ' C=' + nC);
  ok('an N/A reason is imported from SharePoint', A.tasks[5].na === true && A.tasks[5].note === 'Inspection pending',
     JSON.stringify(A.tasks[5]));

  // ---- what is live at Save time ----
  // JobLookupId as Graph returns it: Save reads a project's rows by it (Spec A).
  const asgRow = (s, extra) => Object.assign({ id: String(s.base.id), JobLookupId: '19', Title: 'D2-1042 · ' + s.num + ' ' + s.name,
    Crew: 'devon', ScheduledStart: '2026-09-08T05:00:00Z', DurationDays: 2, Locked: false, NotApplicable: false,
    InstallerSignOff: false, PMSignOff: false }, extra);
  const live = {
    asg: [asgRow(A), asgRow(B, { InstallerSignOff: true, InstallerSignOffByLookupId: '15', SignOffNotes: 'earlier' }), asgRow(C),
          asgRow(D, { InstallerSignOff: true, InstallerSignOffByLookupId: '15' }), asgRow(E), asgRow(F)],
    tasks: [], uil: [
      { id: '14', Title: 'Cody Campbell', Name: 'i:0#.f|membership|cody@d2pools.com' },
      { id: '15', Title: 'Emon Alexander', Name: 'i:0#.f|membership|emon@d2pools.com' },
      { id: '3', Title: 'D2 Build Scheduler Owners' }]
  };
  [A, B, C, D, E, F].forEach(s => s.tasks.forEach((t, k) => live.tasks.push({ id: String(t.spId), AssignmentLookupId: String(s.base.id),
    Complete: false, NotApplicable: false })));
  const liveTask = (s, k) => live.tasks.find(r => r.id === String(s.tasks[k].spId));
  liveTask(A, 5).NotApplicable = true; liveTask(A, 5).Note = 'Inspection pending';
  // Since load, somebody marked C's task 2 N/A and ticked C's tasks 3 and 4.
  liveTask(C, 1).NotApplicable = true;
  liveTask(C, 2).Complete = true;
  liveTask(C, 3).Complete = true;

  // ---- the planner's edits ----
  A.tasks[0].done = true; A.tasks[1].done = true;            // two ticks on A, the second will FAIL at Graph
  C.tasks[0].done = true; C.tasks[1].done = true;            // two ticks on C, the second will be REFUSED
  // N/A through the real drawer control. A blank reason changes nothing; a real one sticks.
  win.editSec(j.id, 0, 0);
  const naLink = k => win.document.querySelectorAll('#tasks .tk')[k].querySelector('a.natog');
  ok('the imported reason is shown on the task', /Inspection pending/.test(naLink(5).getAttribute('title'))
     && /Inspection pending/.test(win.document.querySelectorAll('#tasks .tk')[5].textContent), naLink(5).getAttribute('title'));
  let alerted = '';
  win.alert = m => { alerted = m; };
  win.prompt = () => '   ';
  win.toggleNA(3);
  ok('N/A with a blank reason is refused in the UI and changes nothing', A.tasks[3].na === false && /reason/.test(alerted), alerted);
  win.prompt = () => null;
  win.toggleNA(3);
  ok('cancelling the reason prompt changes nothing', A.tasks[3].na === false);
  win.prompt = () => '  Owner supplying this  ';
  win.toggleNA(2);
  ok('N/A with a reason is recorded, trimmed', A.tasks[2].na === true && A.tasks[2].note === 'Owner supplying this', JSON.stringify(A.tasks[2]));
  win.alert = () => {};

  // D is signed: its checklist is locked in the UI...
  win.editSec(j.id, secs[3].gi, secs[3].si);
  const dBoxes = [...win.document.querySelectorAll('#tasks .tk input[type=checkbox]')];
  ok('a signed-off checklist renders locked', dBoxes.length > 0 && dBoxes.every(b => b.disabled)
     && !win.document.querySelector('#tasks a.natog') && !!win.document.getElementById('tasksLocked'));
  win.eval('tick(0,true)'); win.eval('allTasks(true)');
  ok('...and its handlers refuse too', D.tasks.every(t => !t.done));
  // ...and if a change reaches the change set anyway, the save refuses it.
  D.tasks[0].done = true;
  // E: tick the first line (matched by name) and the renamed third (matched by position).
  // F: tick the line that was both moved and renamed (its own row, 5500).
  E.tasks[0].done = true; E.tasks[2].done = true; F.tasks[0].done = true;

  win.sign(j.id, 0, 0, 'inst', true);                         // sign A
  win.sign(j.id, secs[1].gi, secs[1].si, 'inst', false);       // reopen B
  win.sign(j.id, secs[2].gi, secs[2].si, 'inst', true);        // sign C

  // ---- the stubbed Graph ----
  const patches = [];
  const failTaskId = String(A.tasks[1].spId);
  win.graphModeAvailable = () => true;
  win.graphToken = async () => 'TOK';
  win.graphPca = () => ({ getActiveAccount: () => ({ username: 'cody@d2pools.com', name: 'Cody Campbell' }), getAllAccounts: () => [] });
  win.loadFromD2ViaGraph = async () => {};
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body });
  win.fetch = async (url, init) => {
    init = init || {};
    if (init.method === 'PATCH') {
      const m = url.match(/lists\/([^/]+)\/items\/([^/]+)\/fields/);
      patches.push({ list: m[1], id: m[2], body: JSON.parse(init.body) });
      return m[1] === L.tasks && m[2] === failTaskId ? res(500, { error: 'boom' }) : res(200, {});
    }
    if (/\/sites\/[^/]+:\/sites/.test(url)) return res(200, { id: 'SITE' });
    const wrap = rows => res(200, { value: rows.map(f => ({ id: f.id, fields: f })) });
    if (url.includes('User Information List')) return wrap(live.uil);
    if (url.includes('/lists/' + L.asg + '/')) return wrap(live.asg);
    if (url.includes('/lists/' + L.tasks + '/')) return wrap(live.tasks);
    return res(404, {});
  };

  // ---- preview label ----
  win.openSavePreview();
  const label = win.document.querySelector('#dFoot button.p').textContent.trim();
  ok('the Save button counts sign-off and checklist changes', /Save 12 sign-off and checklist changes to SharePoint/.test(label), label);
  ok('...and never says "0 edits"', !/\b0 edits?\b/.test(label), label);

  await win.confirmSaveByPush();
  await new Promise(r => setTimeout(r, 50));

  const asgP = patches.filter(p => p.list === L.asg), taskP = patches.filter(p => p.list === L.tasks);
  const body = s => (asgP.find(p => p.id === String(s.base.id)) || {}).body || {};

  ok('every task write happens BEFORE any assignment write',
     patches.length > 0 && patches.findIndex(p => p.list === L.asg) > patches.map(p => p.list).lastIndexOf(L.tasks),
     patches.map(p => (p.list === L.asg ? 'A' : 'T') + p.id).join(' '));

  // A: two ticks attempted, one failed at Graph -> counter reflects the one that landed.
  ok('A is signed with the person and the time', body(A).InstallerSignOff === true
     && body(A).InstallerSignOffByLookupId === '14' && /^\d{4}-\d\d-\d\dT/.test(body(A).InstallerSignOffOn), JSON.stringify(body(A)));
  ok('A counts only the tick that LANDED, not the one that failed', body(A).TasksComplete === 1 && body(A).TasksTotal === nA,
     body(A).TasksComplete + '/' + body(A).TasksTotal);
  ok('assignment writes carry the suppression stamp', !!body(A).SuppressReconcileUntil);
  ok('task writes never do (the Tasks list has no such column)', taskP.every(p => !('SuppressReconcileUntil' in p.body)));

  {
    const na = taskP.find(p => p.id === String(A.tasks[2].spId));
    ok('the N/A is written with its reason in Note', !!na && na.body.NotApplicable === true
       && na.body.Note === 'Owner supplying this' && na.body.Complete === false, JSON.stringify(na && na.body));
    ok('the untouched imported N/A is not rewritten', !taskP.some(p => p.id === String(A.tasks[5].spId)));
  }

  ok('a task change under a standing sign-off is never written', !taskP.some(p => p.id === String(D.tasks[0].spId)));
  ok('a tick on a reordered line is written to the row with its name',
     taskP.some(p => p.id === '5400' && p.body.Complete === true) && !taskP.some(p => p.id === '5401'));
  ok('a tick on a renamed-in-place line is written to its own row', taskP.some(p => p.id === '5402' && p.body.Complete === true));
  ok('a tick on a moved-and-renamed line is written to its own row and no other',
     taskP.some(p => p.id === '5500' && p.body.Complete === true) && !taskP.some(p => p.id === '5501'));

  // B: reopen matches D2 - Reopen Sign-off field for field.
  const notes = body(B).SignOffNotes || '';
  ok('a Reopen clears the flag, the person AND the timestamp', body(B).InstallerSignOff === false
     && body(B).InstallerSignOffByLookupId === null && body(B).InstallerSignOffOn === null, JSON.stringify(body(B)));
  ok('the Reopen note keeps what was there, joined the way the flow joins it',
     notes.startsWith('earlier  |  REOPENED '), notes);
  ok('the Reopen note says who reopened AND who had signed',
     / by Cody Campbell \(was signed by Emon Alexander\) \(from the planner\)$/.test(notes), notes);
  {
    const stamp = (notes.match(/REOPENED (\d{4}-\d\d-\d\d \d\d:\d\d)/) || [])[1];
    const central = win.D2WritebackCore.centralStamp(new Date().toISOString());
    const utc = new Date().toISOString().slice(0, 16).replace('T', ' ');
    ok('the Reopen stamp is Central time, not UTC', stamp === central && stamp !== utc, stamp + ' vs utc ' + utc);
  }

  // C: one tick landed, one refused, two ticked by somebody else since load.
  ok("C's refused tick is not written", !taskP.some(p => p.id === String(C.tasks[1].spId)));
  ok('C counts the rows as they now are: its own landed tick plus the two made elsewhere',
     body(C).TasksComplete === 3 && body(C).TasksTotal === nC, body(C).TasksComplete + '/' + body(C).TasksTotal);

  const out = win.document.getElementById('dBody').innerText || win.document.getElementById('dBody').textContent;
  ok('the results name what was saved', /Sign-off and checklist saved/i.test(out));
  ok('the results name what was NOT saved', /NOT saved/.test(out));
  ok('...and say a signed checklist needs reopening', /signed off, so reopen it/.test(out));
  ok('...and no line is reported unmatched: every line came from its own row', !/could not be matched to its SharePoint row/.test(out));
  ok('the results use words, not column names', !/InstallerSignOffByLookupId|TasksComplete|SignOffNotes/.test(out)
     && /installer sign-off/.test(out) && /reopen noted/.test(out), out.replace(/\s+/g, ' ').slice(0, 300));
  ok('the results never say "Nothing needed saving." over saved sign-offs', !/Nothing needed saving/.test(out));

  console.log(fail ? '\nFAILED' : '\nall passed');
  process.exit(fail);
})().catch(e => { console.error('ERR', e && e.stack || e); process.exit(1); });
