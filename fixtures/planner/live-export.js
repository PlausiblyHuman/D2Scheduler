/* End-to-end: real SharePoint payloads -> the real export script -> the real planner.
 *
 * This is the test that proves `sharepoint/export-to-planner.js` actually works,
 * rather than that its assumptions look reasonable. It runs the script's own code
 * with `fetch` stubbed to serve payloads captured from the live tenant, takes the
 * file it would have downloaded, and imports that into the real planner HTML in
 * jsdom.
 *
 * The fixture is a capture, so it needs no credentials and no browser. Recapture
 * it with the throwaway-probe-flow recipe in CLAUDE.md ("HEADLESS SHAREPOINT
 * READS WITHOUT A BROWSER") if the schema ever changes.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const PLANNER = path.join(ROOT, 'D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html');
const SCRIPT = path.join(ROOT, 'sharepoint/export-to-planner.js');
const FIXTURE = path.join(__dirname, 'live-payloads.json');

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

if (!fs.existsSync(FIXTURE)) {
  console.log('SKIP: no live-payloads.json fixture. See the header comment.');
  process.exit(0);
}
const live = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/* ---- 1. run the real export script with fetch stubbed ---------------- */
function runExport() {
  return new Promise((resolve, reject) => {
    let captured = null;
    const pick = url =>
      /GetByTitle\('Jobs'\)/.test(url) ? live.jobs :
      /GetByTitle\('Assignments'\)/.test(url) ? live.asg :
      /GetByTitle\('Tasks'\)/.test(url) ? live.tasks : null;

    const sandbox = {
      console: { log: () => {}, warn: () => {} },
      Date,
      Promise,
      Blob: class { constructor(parts) { this.parts = parts; } },
      URL: { createObjectURL: b => { captured = b.parts.join(''); return 'blob:stub'; } },
      document: {
        createElement: () => ({ set href(v) {}, download: '', click() {} })
      },
      fetch: async url => {
        const rows = pick(url);
        if (!rows) throw new Error('unexpected URL: ' + url);
        return { ok: true, status: 200, json: async () => ({ value: rows }) };
      }
    };
    sandbox.globalThis = sandbox;
    const vm = require('vm');
    vm.createContext(sandbox);
    const src = fs.readFileSync(SCRIPT, 'utf8');
    try {
      const p = vm.runInContext(src, sandbox);
      Promise.resolve(p).then(() => {
        // the anchor click happens synchronously before the summary
        setTimeout(() => captured ? resolve(JSON.parse(captured)) : reject(new Error('nothing downloaded')), 10);
      }, reject);
    } catch (e) { reject(e); }
  });
}

(async () => {
  let payload;
  try { payload = await runExport(); }
  catch (e) { console.log('FAIL · export script threw: ' + e.message); process.exit(1); }

  ok('export produced a payload', !!payload);
  ok('payload is tagged for the importer', payload.kind === 'd2-sharepoint-export', payload.kind);
  ok('all 3 live pools exported', payload.jobs.length === 3, payload.jobs.map(j => j.jobno).join(','));
  const secs = payload.jobs.reduce((n, j) => n + j.sections.length, 0);
  const tks = payload.jobs.reduce((n, j) => n + j.sections.reduce((m, s) => m + s.tasks.length, 0), 0);
  ok('every assignment mapped to a section', secs === live.asg.length, secs + ' of ' + live.asg.length);
  ok('every task mapped', tks === live.tasks.length, tks + ' of ' + live.tasks.length);
  ok('no section lost its crew code', payload.jobs.every(j => j.sections.every(s => s.crewId)),
     'distinct: ' + [...new Set(payload.jobs.flatMap(j => j.sections.map(s => s.crewId)))].length);
  ok('dates are bare yyyy-mm-dd (no timezone shift)',
     payload.jobs.every(j => j.sections.every(s => !s.start || /^\d{4}-\d{2}-\d{2}$/.test(s.start))),
     payload.jobs[0].sections[0].start);
  const signed = payload.jobs.reduce((n, j) => n + j.sections.filter(s => s.inst).length, 0);
  const liveSigned = live.asg.filter(a => a.InstallerSignOff).length;
  ok('sign-off count preserved', signed === liveSigned, signed + ' of ' + liveSigned);
  const done = payload.jobs.reduce((n, j) => n + j.sections.reduce((m, s) => m + s.tasks.filter(t => t.done).length, 0), 0);
  const liveDone = live.tasks.filter(t => t.Complete).length;
  ok('ticked-task count preserved', done === liveDone, done + ' of ' + liveDone);

  /* ---- 2. import it into the real planner --------------------------- */
  let html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
    `<script>window.__x=()=>{window.S=S;window.importFromD2=importFromD2;window.allSecs=allSecs;window.autoSchedule=autoSchedule;};</script><script>__x();</script></body>`);
  const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const win = dom.window;
  win.confirm = () => true;
  const alerts = []; win.alert = m => alerts.push(m);
  await new Promise(r => setTimeout(r, 600));

  win.importFromD2(new win.File([JSON.stringify(payload)], 'live.json', { type: 'application/json' }));
  await new Promise(r => setTimeout(r, 500));

  const S = win.S;
  ok('planner accepted the live export', alerts.some(a => /Loaded from D2/.test(a)));
  ok('no sub-phase failed to match the template', !alerts.some(a => /matched nothing/.test(a)),
     alerts.join(' | ').slice(0, 120));
  ok('3 pools in the planner', S.jobs.length === 3, S.jobs.map(j => j.jobno).join(','));
  const all = S.jobs.flatMap(j => win.allSecs(j).map(x => x.s));
  ok('138 sub-phases landed', all.length === live.asg.length, all.length + '');
  ok('sign-offs landed', all.filter(s => s.inst).length === liveSigned, all.filter(s => s.inst).length + '');
  ok('signed work is locked', all.filter(s => s.inst).every(s => s.locked));
  ok('ticks landed', all.reduce((n, s) => n + s.tasks.filter(t => t.done).length, 0) === liveDone);

  // the trap: Auto-Schedule must not move completed work
  const before = all.map(s => s.crewId + '|' + s.start + '|' + s.inst);
  win.autoSchedule();
  const after = S.jobs.flatMap(j => win.allSecs(j).map(x => x.s));
  const movedSigned = after.filter((s, i) => s.inst && (s.crewId + '|' + s.start + '|' + s.inst) !== before[i]).length;
  ok('Auto-Schedule left signed work alone', movedSigned === 0, movedSigned + ' moved');

  console.log('\n' + (fail ? 'FAILURES ABOVE' : 'Live export round-trip clean: '
    + live.asg.length + ' assignments, ' + live.tasks.length + ' tasks, '
    + liveSigned + ' sign-offs, ' + liveDone + ' ticks.'));
  process.exit(fail);
})();
