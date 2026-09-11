/* D11: the planner must say whether what is on screen is the live schedule.
 *
 * Auto-Schedule, the drawer save, sign-off and bulk tick all rewrite state with
 * no record that they did, so a PM cannot tell a fresh import from something they
 * reflowed twenty minutes ago.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.importFromD2=importFromD2;
    window.autoSchedule=autoSchedule;window.SEED_TEMPLATE=SEED_TEMPLATE;
    window.divergedSecs=divergedSecs;window.delCrew=delCrew;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.confirm = () => true; win.alert = () => {};

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = win.S;

  const T = win.SEED_TEMPLATE;
  const secDefs = T.flatMap(g => g.sections.map(s => ({ num: s.num, name: s.name, tasks: s.tasks })));
  const payload = {
    app: 'D2 Pool Build Scheduler', kind: 'd2-sharepoint-export', exported: '2026-09-11',
    site: 'https://example', nonWork: ['2026-10-12'],
    jobs: [{
      id: 19, jobno: 'D2-1042', name: 'Reyes Residence', addr: '', city: '', start: '2026-09-08',
      status: 'Active', pm: 'Cody Campbell',
      sections: secDefs.map((s, i) => ({
        id: 1000 + i, num: s.num, name: s.name, crewId: 'devon',
        start: '2026-09-08', finish: '2026-09-09',
        days: 2, skip: false, locked: false, inst: false, pm: false,
        tasks: s.tasks.map((t, k) => ({ seq: k + 1, title: t, done: false, na: false }))
      }))
    }]
  };

  win.importFromD2(new win.File([JSON.stringify(payload)], 'd2.json', { type: 'application/json' }));
  await new Promise(r => setTimeout(r, 400));

  ok('import stamps when it loaded', !!(S.settings && S.settings.loadedAt), String((S.settings || {}).loadedAt));
  ok('import records the export date', (S.settings || {}).exportedOn === '2026-09-11', String((S.settings || {}).exportedOn));

  const j = S.jobs.find(x => x.jobno === 'D2-1042');
  ok('a freshly imported pool is not marked edited', !j.touchedAt, String(j.touchedAt));

  // --- the baseline, which the batch write-back will diff against (spec Stage 2) ---
  // Checked BEFORE Auto-Schedule runs. Auto-Schedule legitimately rewrites crew
  // and dates for the whole pool -- this fixture's sections all share one crew
  // and one start date, which is not a valid schedule, so a full recompute moves
  // nearly every row. That bulk rewrite is exactly what "Auto-Schedule marks the
  // pool edited" below is testing. The isolated per-field divergence checks have
  // to run on the freshly-imported state, ahead of that bulk rewrite, or they
  // would be measuring Auto-Schedule's own changes instead of the one field this
  // block edits by hand.
  const j2 = S.jobs.find(x => x.jobno === 'D2-1042');
  ok('every imported sub-phase carries a baseline',
     win.allSecs(j2).every(({ s }) => s.base && 'crewId' in s.base),
     win.allSecs(j2).filter(({ s }) => s.base).length + ' of ' + win.allSecs(j2).length);
  ok('the baseline holds the SharePoint row id',
     win.allSecs(j2).every(({ s }) => s.base.id !== undefined));

  // A crew change is divergence; a task tick is not -- the planner is not the
  // authority on sign-off or ticks and must never write them back.
  win.allSecs(j2)[0].s.crewId = 'antonio';
  ok('a crew change shows as divergence', win.divergedSecs(j2).length === 1,
     win.divergedSecs(j2).length + ' diverged');
  win.allSecs(j2)[1].s.tasks[0].done = true;
  ok('a task tick is NOT divergence', win.divergedSecs(j2).length === 1,
     win.divergedSecs(j2).length + ' diverged');

  // Fix round 1 (2026-09-11): delCrew mutates crewId/locked directly on every
  // section on the deleted crew, across every pool, with no autoSchedule() call
  // to fall back on. It must call touch() itself, or a crew deletion guts a
  // pool's assignments while touchedAt -- and therefore the header and the
  // "edited here" badge -- stays silent. divergedSecs and touchedAt must agree:
  // sections diverging with no touchedAt is exactly the false-freshness failure.
  ok('before delCrew, still not marked edited', !j2.touchedAt, String(j2.touchedAt));
  win.delCrew('devon');
  const afterDelCrew = win.divergedSecs(j2).length;
  ok('delCrew marks the pool edited', !!j2.touchedAt, String(j2.touchedAt));
  ok('delCrew divergence agrees with touchedAt', afterDelCrew > 0 && !!j2.touchedAt,
     afterDelCrew + ' diverged, touchedAt=' + String(j2.touchedAt));

  win.autoSchedule();
  ok('Auto-Schedule marks the pool edited', !!S.jobs.find(x => x.jobno === 'D2-1042').touchedAt,
     String(S.jobs.find(x => x.jobno === 'D2-1042').touchedAt));

  const header = win.document.querySelector('header').textContent;
  ok('the header says how fresh the data is', /Live as of/i.test(header), header.slice(0, 120));

  process.exit(fail);
})();
