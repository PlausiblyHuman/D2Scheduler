/* D4: Auto-Schedule must not be anchored by a stale Jobs.StartDate.
 *
 * `D2 - Reschedule Pool` rewrites Assignments dates and never writes Jobs.StartDate
 * back, so the field drifts and stays drifted -- Whitfield reads 2026-09-21 on the
 * Jobs list while its first sub-phase started 2026-06-15. autoSchedule() uses that
 * field to ORDER the pools and to SEED each pool's cursor, so a drifted value
 * anchors a whole pool months late.
 *
 * The flow gap is still open. This pins the planner against it.
 *
 * Fix round 1: the original single-job scenario below only ever exercised
 * jobStart() directly. With exactly one pool, autoSchedule()'s sort comparator
 * has nothing to compare against, and the two leading sections are both LOCKED,
 * so the cursor seed is discarded by the locked-row branch (`cursor=adv(s.start)`)
 * before it can ever reach an unlocked row. Two isolated scenarios were added so
 * a revert of EITHER autoSchedule call site, independently, fails a test:
 *   - "cursor seed" -- a single pool whose FIRST row is unlocked, so the seeded
 *     cursor value lands directly on it.
 *   - "pool order" -- two single-section pools contending for the same
 *     two-candidate skill (finishgrade: guillermo, saul -- tied load, no
 *     unlimited crew to confound the tie-break). Whichever pool autoSchedule()
 *     visits first wins the lower-id tie-break.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.autoSchedule=autoSchedule;
    window.jobStart=jobStart;window.nextWork=nextWork;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.confirm = () => true; win.alert = () => {};

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = win.S;

  // ---- Scenario 1: locked early work resumes correctly. Kept from the original
  // brief -- it pins real behaviour -- even though the reviewer showed it alone
  // cannot fail on a reversion of either call site. ----
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

  // ---- Scenario 2: cursor seed, isolated. The pool's FIRST row is unlocked, so
  // nothing discards the seeded cursor before it lands. Dies if the cursor-seed
  // call site (`let cursor=nextWork(...)`) alone is reverted. ----
  const mkSec = (o) => Object.assign({ sid: 'x', num: 'x', name: 'x', skill: null, days: 2,
    crewId: null, start: null, skip: false, locked: false, inst: false, pm: false, tasks: [] }, o);
  const mkJob = (o) => Object.assign({ id: 'j' + Math.random().toString(36).slice(2, 8), jobno: 'TEST',
    name: 'Test Pool', addr: '', city: '', state: '', zip: '', start: null, status: null,
    groups: [{ tid: 'g', num: '0', name: 'G', inst: false, pm: false, sections: [] }] }, o);

  const jCursor = mkJob({ start: '2026-09-21' });
  // This section already carries a real, unlocked start from a prior run -- the
  // same shape as a drifted Jobs.StartDate: the field says September, a
  // sub-phase's own row says January, and nothing has locked it down.
  jCursor.groups[0].sections.push(mkSec({ num: '0.0', start: '2026-01-06', skill: null, locked: false }));
  S.jobs = [jCursor];

  const expectCursorSeed = win.nextWork(win.jobStart(jCursor));
  win.autoSchedule();
  const cursorSec = jCursor.groups[0].sections[0];
  ok('cursor seed uses the earliest real work when the first row is unlocked',
     cursorSec.start === expectCursorSeed, cursorSec.start + ' (expected ' + expectCursorSeed + ')');
  ok('...and not the drifted Jobs.StartDate',
     cursorSec.start < '2026-09-01', cursorSec.start);

  // ---- Scenario 3: pool ORDER, isolated. Two single-section pools contend for a
  // two-candidate skill. Dies if the sort call site
  // (`[...S.jobs].sort((a,b)=>...)`) alone is reverted, because reverting it
  // visits Q before P. ----
  const jP = mkJob({ jobno: 'ORDER-P', start: '2026-09-25' });
  // P's real earliest work is January -- far earlier than its own drifted field,
  // and earlier than Q's.
  jP.groups[0].sections.push(mkSec({ num: '0.0', start: '2026-01-05', skill: null, locked: false }));
  jP.groups[0].sections.push(mkSec({ num: '0.1', skill: 'finishgrade', locked: false }));
  const jQ = mkJob({ jobno: 'ORDER-Q', start: '2026-01-10' });
  jQ.groups[0].sections.push(mkSec({ num: '0.0', skill: 'finishgrade', locked: false }));
  S.jobs = [jP, jQ];

  ok('setup: P\'s real earliest work precedes Q\'s',
     win.jobStart(jP) < win.jobStart(jQ), win.jobStart(jP) + ' < ' + win.jobStart(jQ));
  ok('setup: P\'s own drifted field is LATER than Q\'s -- a raw-field sort would visit Q first',
     jP.start > jQ.start, jP.start + ' > ' + jQ.start);

  win.autoSchedule();
  const pCrew = jP.groups[0].sections[1].crewId;
  const qCrew = jQ.groups[0].sections[0].crewId;
  ok('the pool with the earlier REAL start is visited first and wins the tie-broken crew',
     pCrew === 'guillermo' && qCrew === 'saul',
     'P=' + pCrew + ' Q=' + qCrew);

  process.exit(fail);
})();
