/* D2: PM sign-off is not a wired-up workflow, so Schedule Check must not warn about it.
 *
 * Assignments.PMSignOff is written false once by `D2 - New Pool` and read by no
 * other flow, no view and not by the canvas app. The export carries it honestly,
 * which filled Schedule Check with one unclearable warning per finished sub-phase
 * -- 51 on the demo pools. Installer sign-off IS real and is still checked.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../web/index.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.conflicts=conflicts;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.confirm = () => true; win.alert = () => {};

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = win.S;

  // One pool, everything finished in the past, installer signed, PM never signed --
  // which is the state every real pool is in, because nothing sets PMSignOff.
  win.document.getElementById('addJobBtn').click();
  await new Promise(r => setTimeout(r, 100));
  const j = S.jobs[0];
  j.start = '2026-01-05';
  win.allSecs(j).forEach(({ s }) => { s.start = '2026-01-05'; s.days = 1; s.inst = true; s.pm = false; s.skip = false; });

  const msgs = win.conflicts().map(c => c.msg);
  ok('no PM sign-off warnings', !msgs.some(m => /PM sign-off/i.test(m)),
     msgs.filter(m => /PM sign-off/i.test(m)).length + ' found');

  // Installer sign-off is real and must still be checked.
  win.allSecs(j).forEach(({ s }) => { s.inst = false; });
  const msgs2 = win.conflicts().map(c => c.msg);
  ok('installer sign-off is still checked', msgs2.some(m => /Installer sign-off/i.test(m)),
     msgs2.filter(m => /Installer sign-off/i.test(m)).length + ' found');

  process.exit(fail);
})();
