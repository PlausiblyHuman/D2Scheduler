/* D7: the planner's work calendar must agree with the one the flows use.
 *
 * The planner recomputes every end date as workSpan(start, days) rather than
 * reading the exported `finish`, so any sub-phase whose real span stepped over a
 * holiday renders a day short -- and that shortened span then feeds conflicts(),
 * where it can miss a real overlap and invent a sequence error.
 *
 * Measured before the fix: 2 of 138 live assignments were wrong, both crossing
 * Columbus Day 2026-10-12. This pins that at 0.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { runExport } = require('./run-export');

const PLANNER = path.resolve(__dirname, '../../D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html');
const FIXTURE = path.join(__dirname, 'live-payloads.json');

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const live = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

(async () => {
  const payload = await runExport(live);

  ok('export carries a work calendar', Array.isArray(payload.nonWork) && payload.nonWork.length > 200,
     (payload.nonWork || []).length + ' days');

  // --- load the real planner and import ---
  const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
    `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.importFromD2=importFromD2;
      window.workSpan=workSpan;window.isWork=isWork;window.parseD=parseD;};</script><script>__x();</script></body>`);
  const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const win = dom.window;
  win.confirm = () => true; win.alert = () => {};
  await new Promise(r => setTimeout(r, 600));

  win.importFromD2(new win.File([JSON.stringify(payload)], 'd2.json', { type: 'application/json' }));
  await new Promise(r => setTimeout(r, 500));

  ok('planner stored the calendar',
     win.S.settings && Array.isArray(win.S.settings.nonWork) && win.S.settings.nonWork.length > 200,
     ((win.S.settings || {}).nonWork || []).length + ' days in state');

  ok('a known holiday is not a work day', win.isWork(win.parseD('2026-10-12')) === false);
  ok('an ordinary Monday is still a work day', win.isWork(win.parseD('2026-10-19')) === true);
  ok('Sunday is still not a work day', win.isWork(win.parseD('2026-10-18')) === false);

  // --- the real assertion: computed finish == the finish SharePoint stored ---
  const wrong = [];
  let checked = 0;
  payload.jobs.forEach(inj => {
    const j = win.S.jobs.find(x => String(x.jobno) === String(inj.jobno));
    if (!j) return;
    const bySec = {};
    win.allSecs(j).forEach(({ s }) => { bySec[s.num] = s; });
    inj.sections.forEach(is => {
      const s = bySec[is.num];
      if (!s || !is.start || !is.finish || !is.days) return;
      checked++;
      const computed = win.workSpan(s.start, s.days).pop();
      if (computed !== is.finish) wrong.push(inj.jobno + ' ' + is.num + ': SharePoint ' + is.finish + ', planner ' + computed);
    });
  });
  // Guard against a broken join reporting a vacuous pass: `checked` must reach
  // every checkable section in the payload, not just whatever happened to match.
  // Same convention as live-export.js's "every assignment mapped to a section".
  const expected = payload.jobs.reduce((n, j) =>
    n + j.sections.filter(is => is.start && is.finish && is.days).length, 0);
  ok('checked every checkable span', checked === expected && expected > 0,
     checked + ' of ' + expected);

  ok('every span agrees with SharePoint', wrong.length === 0,
     wrong.length ? wrong.slice(0, 5).join(' | ') : checked + ' spans checked');

  process.exit(fail);
})();
