/* D2: a pool name typed in SharePoint must never reach the DOM as markup.
 *
 * Job names, numbers and addresses are free text a PM types into SharePoint and
 * the planner imports. Two renderers interpolated `j.name` raw into innerHTML:
 * conflicts() built its `ref` unescaped (that string becomes x.msg, painted by
 * flagsCard()), and vDispatch() pushed `${j.name} - ...` into its office-work
 * line. Both paint on every render, so a name carrying markup fired on load.
 *
 * The consequence is larger than a broken render. Once the planner is served
 * from a real origin it holds a delegated Sites.ReadWrite.All token, so script
 * executing in that origin can read and write every SharePoint site the signed-in
 * user can reach. Microsoft states the division of responsibility plainly in the
 * MSAL v4 notes: cache hardening is "not to provide additional security ... It's
 * your responsibility to ensure your application isn't vulnerable to XSS."
 *
 * The probe is an <svg id="xss-probe"> in the pool name. If the name is escaped
 * the element can never exist; if it is interpolated raw, jsdom parses it into
 * the document and getElementById finds it. Deterministic either way -- it does
 * not depend on a script actually executing.
 *
 * Note x.msg deliberately CONTAINS markup (<b>, <u>), so this cannot be fixed at
 * the sink by escaping msg. It has to be escaped where ref is built.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../web/index.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const PROBE = '<svg id="xss-probe"></svg>';

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.newJob=newJob;window.render=render;window.conflicts=conflicts;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.confirm = () => true; win.alert = () => {};

const tab = t => win.document.querySelector(`#tabs button[data-t="${t}"]`).click();

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = win.S;

  // A pool whose name carries markup, exactly as an import would deliver it.
  S.jobs.push(win.newJob('Reyes ' + PROBE, '', '', '', '', '2026-09-08'));
  const j = S.jobs[0];
  j.name = 'Reyes ' + PROBE;

  // --- sink 1: conflicts() -> x.msg -> flagsCard(), on the board tab.
  // Sub-phases start unscheduled, so every one raises a "not scheduled" message
  // built from `ref`, which is where the raw name was interpolated.
  win.allSecs(j).forEach(({ s }) => { s.start = null; s.skip = false; });
  tab('board');
  win.render();

  const msgs = win.conflicts().map(c => c.msg);
  ok('conflicts() carries the pool name into its messages',
     msgs.some(m => m.includes('Reyes')), msgs.length + ' messages');
  ok('Schedule Check does not inject the pool name as markup',
     win.document.getElementById('xss-probe') === null,
     win.document.getElementById('xss-probe') ? 'PROBE ELEMENT IN DOM' : 'escaped');

  // --- sink 2: vDispatch()'s office/subcontractor line.
  // Needs an unskipped, crewless sub-phase whose span covers the dispatch date.
  tab('dispatch');
  win.render();
  const dateInput = win.document.querySelector('#main input[type="date"]');
  const ddate = dateInput && dateInput.value;
  ok('dispatch view exposes its date', !!ddate, String(ddate));

  const first = win.allSecs(j)[0].s;
  first.start = ddate; first.days = 1; first.crewId = ''; first.skip = false;
  win.render();

  const officeLine = win.document.getElementById('main').textContent;
  ok('dispatch lists the crewless sub-phase under the pool name',
     officeLine.includes('Reyes'), 'office/subcontractor line rendered');
  ok('Daily Dispatch does not inject the pool name as markup',
     win.document.getElementById('xss-probe') === null,
     win.document.getElementById('xss-probe') ? 'PROBE ELEMENT IN DOM' : 'escaped');

  // --- every other renderer, so this is an invariant rather than two fixes.
  // Grepping for `${j.name}` found the two sinks above; this catches a third
  // that a future edit adds, or one the grep pattern missed.
  const tabs = [...win.document.querySelectorAll('#tabs button')].map(b => b.dataset.t);
  const leaked = [];
  for (const t of tabs) {
    tab(t); win.render();
    if (win.document.getElementById('xss-probe')) leaked.push(t);
  }
  ok('no tab injects the pool name as markup', leaked.length === 0,
     leaked.length ? 'LEAKS: ' + leaked.join(', ') : tabs.length + ' tabs swept: ' + tabs.join(', '));

  console.log(fail ? '\nFAIL — a pool name reached the DOM as markup.'
                   : '\nPool names are escaped in every renderer.');
  process.exit(fail);
})();
