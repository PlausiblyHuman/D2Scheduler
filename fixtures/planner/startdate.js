/* D4: Auto-Schedule must not be anchored by a stale Jobs.StartDate.
 *
 * `D2 - Reschedule Pool` rewrites Assignments dates and never writes Jobs.StartDate
 * back, so the field drifts and stays drifted -- Whitfield reads 2026-09-21 on the
 * Jobs list while its first sub-phase started 2026-06-15. autoSchedule() uses that
 * field to ORDER the pools and to SEED each pool's cursor, so a drifted value
 * anchors a whole pool months late.
 *
 * The flow gap is still open. This pins the planner against it.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.autoSchedule=autoSchedule;
    window.jobStart=jobStart;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.confirm = () => true; win.alert = () => {};

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = win.S;

  win.document.getElementById('addJobBtn').click();
  await new Promise(r => setTimeout(r, 100));
  const j = S.jobs[0];

  // Exactly the Whitfield shape: the Jobs row says September, the work started in June
  // and the early sub-phases are locked because they are signed off.
  j.start = '2026-09-21';
  const secs = win.allSecs(j).map(x => x.s);
  secs[0].start = '2026-06-15'; secs[0].days = 2; secs[0].locked = true; secs[0].crewId = 'devon';
  secs[1].start = '2026-06-17'; secs[1].days = 2; secs[1].locked = true; secs[1].crewId = 'devon';

  ok('jobStart uses the earliest real work, not the drifted field',
     win.jobStart(j) === '2026-06-15', win.jobStart(j));

  win.autoSchedule();
  const after = win.allSecs(j).map(x => x.s);
  ok('locked early work was not moved', after[0].start === '2026-06-15' && after[1].start === '2026-06-17',
     after[0].start + ', ' + after[1].start);
  ok('unlocked work follows the locked work, not the drifted field',
     after[2].start < '2026-09-21', after[2].start);

  process.exit(fail);
})();
