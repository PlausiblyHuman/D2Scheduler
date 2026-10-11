/* The "Save first" guard on Activate, Back to planning, Mark complete and Reopen.
 *
 * WHY THIS EXISTS: on 2026-10-10 Don could not activate any project. Every attempt said
 * "Save first ... (25-2004 Oden - Nitch)", and Save and Refresh did not clear it. The
 * sequence, reproduced here against the real page:
 *
 *   1. Installer ticked on screen on 7.0, not yet saved.
 *   2. "Reject sign-off" was offered on that unsaved tick, and pressed with a note.
 *   3. At Save the rejection went first and SharePoint refused it ("no longer signed
 *      off"): the row had never been signed. The queued reject also held back the
 *      sign-off itself, so every retry was refused the same way.
 *   4. A refused entry stays queued on purpose, the queue survives Refresh, and the
 *      guard counted it, on every project. One entry blocked every Activate.
 *
 * Pinned: Reject is offered only on a sign-off SharePoint holds; the queue never blocks
 * Activate, Back to planning or Reopen (it survives the reload those do, so nothing on
 * it is at risk); Mark complete still stops for a queued entry on THAT project, because
 * completing it would drop the entry; and the guard names the sub-phase, not only the
 * project.
 */
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const WEB = path.resolve(__dirname, '../../web');
const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
  .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
  .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
  .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'));
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
const alerts = [];
win.alert = m => alerts.push(m); win.confirm = () => true;
const E = s => win.eval(s);
const body = () => win.document.getElementById('dBody').textContent.replace(/\s+/g, ' ');
const foot = () => win.document.getElementById('dFoot').textContent;

const N2004 = '25-2004 Oden - Nitch', N2048 = '26-2048', N2010 = '25-2010';
const sec = (num, id, inst, start) => ({ num, id, seq: 1, crewId: 'office', start: start || '2025-08-21', days: 2,
  inst, pm: inst, locked: false, skip: false, tasks: [] });
const payload = () => ({ app: 'D2 Pool Build Scheduler', kind: 'd2-sharepoint-export', exported: '2026-10-10', site: 'x', nonWork: [],
  jobs: [
    { id: 55, jobno: N2004, name: 'Nitch', start: '2025-05-08', status: 'Planned',
      sections: [sec('6.3', 2250, true), sec('7.0', 2251, false)] },
    { id: 60, jobno: N2048, name: 'Other', start: '2026-10-12', status: 'Planned',
      sections: [sec('1.1', 3000, false, '2026-10-12')] },
    // Active and fully signed, so Mark complete is offered.
    { id: 70, jobno: N2010, name: 'Done Pool', start: '2025-03-02', status: 'Active',
      sections: [sec('1.1', 4000, true, '2025-03-03'), sec('7.0', 4001, true, '2025-07-01')] }
  ] });

(async () => {
  await new Promise(r => setTimeout(r, 600));
  E('graphModeAvailable=()=>true');
  E('importFromD2Payload')(payload(), true);
  const S = E('S'), allSecs = E('allSecs'), hasUnsaved = E('hasUnsaved');
  const job = no => S.jobs.find(x => x.jobno === no);
  const hit = (no, num) => allSecs(job(no)).find(x => x.s.num === num);
  const open = (no, num) => { const h = hit(no, num); E('editSec')(job(no).id, h.gi, h.si); };
  const panel = () => win.document.getElementById('dBody').innerHTML;
  /* Every dialog check starts from an empty drawer, so a stale body from the previous
     dialog can never satisfy (or fail) an assertion about this one. */
  const blank = () => { win.document.getElementById('dBody').innerHTML = ''; win.document.getElementById('dFoot').innerHTML = ''; };
  const act = (fn, arg) => { blank(); E(fn)(arg); };

  ok('a clean load has nothing unsaved', S.jobs.filter(hasUnsaved).length === 0);

  // ---- Fix 1: Reject only on a sign-off SharePoint holds -------------------------------
  const s70 = hit(N2004, '7.0').s;
  s70.inst = true;                       // ticked here, not saved
  open(N2004, '7.0');
  ok('an unsaved Installer tick is NOT offered Reject sign-off', !/Reject sign-off/.test(panel()));
  ok('Add comment is still offered there', /Add comment/.test(panel()));
  win.document.getElementById('fComment').value = 'pump not working, warranty claim open';
  E('queueReject')();                    // the control is gone; the function must refuse too
  ok('queueReject on an unsaved tick queues nothing', S.pendingComments.length === 0, String(S.pendingComments.length));
  ok('and leaves the on-screen tick alone', s70.inst === true);
  s70.inst = false;

  open(N2004, '6.3');
  ok('a sign-off SharePoint holds is still offered Reject sign-off', /Reject sign-off/.test(panel()));

  // ---- Fix 2: the queue never blocks Activate / Back to planning -----------------------
  // Don's stuck entry, as the old planner left it in his browser.
  S.pendingComments.push({ localId: 'cdon1', jobno: N2004, num: '7.0', secId: '2251', kind: 'reject',
    body: 'pump not working, warranty claim open', at: '2026-10-10T19:40:00Z' });
  ok('a queued entry is not an unsaved change', !hasUnsaved(job(N2004)));
  act('activatePool', job(N2048).id);
  ok('Activate on another project is offered despite the queued entry',
     /Activate pool/.test(foot()) && !/Save first/.test(body()), body().slice(0, 120));
  E('closeDrawer')();
  act('activatePool', job(N2004).id);
  ok('Activate on the project holding the entry is offered too (the queue survives the reload)',
     /Activate pool/.test(foot()), body().slice(0, 120));
  E('closeDrawer')();
  act('planPool', job(N2010).id);
  ok('Back to planning is offered despite the queued entry', /Back to planning/.test(foot()), body().slice(0, 120));
  E('closeDrawer')();

  // Refresh does not resurrect the block.
  E('importFromD2Payload')(payload(), true);
  ok('after Refresh the queued entry is still there', S.pendingComments.length === 1);
  ok('and still blocks nothing', S.jobs.filter(hasUnsaved).length === 0);

  // ---- Mark complete still stops for an entry queued on THAT project --------------------
  /* The pool is built from the 46-row template and the payload carries two rows, so the
     other 44 are marked not applicable here (they carry no baseline, so this is not an
     unsaved change) to make the project ready to complete. */
  allSecs(job(N2010)).forEach(({ s }) => { if (!s.base) s.skip = true; });
  ok('the test project is ready to complete', E('readyToComplete')(job(N2010)));
  S.pendingComments.push({ localId: 'c2010', jobno: N2010, num: '7.0', secId: '4001', kind: 'comment',
    body: 'final walk-through notes', at: '2026-10-10T19:41:00Z' });
  act('completeProject', job(N2010).id);
  ok('Mark complete stops for a comment queued on the same project',
     /Save first/.test(body()) && !/Mark complete/.test(foot()), body().slice(0, 160));
  ok('and names the sub-phase it is on', /7\.0/.test(body()), body());
  E('closeDrawer')();
  S.pendingComments = S.pendingComments.filter(e => e.localId !== 'c2010');
  act('completeProject', job(N2010).id);
  ok('an entry on another project does not stop Mark complete', /Mark complete/.test(foot()), body().slice(0, 160));
  E('closeDrawer')();

  // ---- Fix 3: the guard names the sub-phase --------------------------------------------
  const s11 = hit(N2048, '1.1').s;
  s11.crewId = 'devon'; E('touch')(job(N2048));
  act('activatePool', job(N2004).id);
  ok('a real unsaved change still stops Activate', /Save first/.test(body()) && !/Activate pool/.test(foot()));
  ok('and names the project', body().includes(N2048), body());
  ok('and names the sub-phase', /26-2048[^)]*1\.1/.test(body()), body());
  E('closeDrawer')();
  s11.crewId = s11.base.crewId;

  const sStart = job(N2048); sStart.start = '2026-10-19';
  act('activatePool', job(N2004).id);
  ok('an unsaved start date is named as such', /start date/i.test(body()), body());
  E('closeDrawer')();
  sStart.start = sStart.baseStart;

  console.log(fail ? '\nFAILED' : '\nsave-first assertions passed.');
  process.exit(fail);
})().catch(e => { console.log('FAIL · threw  [' + e.stack + ']'); process.exit(1); });
