/* D11: the planner must say whether what is on screen is the live schedule.
 *
 * Auto-Schedule, the drawer save, sign-off and bulk tick all rewrite state with
 * no record that they did, so a PM cannot tell a fresh import from something they
 * reflowed twenty minutes ago.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../web/index.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.importFromD2=importFromD2;
    window.autoSchedule=autoSchedule;window.SEED_TEMPLATE=SEED_TEMPLATE;
    window.divergedSecs=divergedSecs;window.delCrew=delCrew;window.render=render;window.setZoom=setZoom;window.save=save;};</script><script>__x();</script></body>`);
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

  // Fix round 2 (final whole-branch review, finding 2 -- the highest-value fix
  // in the wave): pin s.base's field scope directly, rather than trusting that
  // nothing ever widens it. Proven by the reviewer: adding inst:!!s.inst,
  // pm:!!s.pm to the baseline plus matching clauses in divergedSecs left every
  // harness in this suite green. s.base is what a future batch write-back will
  // diff against to decide what to push to SharePoint, and inst/pm are the
  // planner's bare sign-off booleans -- no attribution, no timestamp, no notes --
  // while SharePoint holds InstallerSignOffBy/On and SignOffNotes. Widening the
  // baseline to include them would let a future change-set overwrite an attested
  // sign-off with a flag, which this project forbids outright. This assertion
  // must be updated, deliberately, if a key is ever legitimately added to
  // s.base -- it is a scope fence, not a frozen schema.
  //
  // `seq` was added 2026-09-12 for the batch write-back (Stage 2): the row's
  // SharePoint Sequence, carried so a change-set can order writes and name a
  // row by sub-phase. It is never diffed and never written -- see
  // fixtures/planner/writeback.js, which pins that a change-set never carries
  // it as a writable field.
  // REVERSED, DELIBERATELY, 2026-09-16 (Shane): `inst` and `pm` are now in the
  // baseline. The fence above is doing its job and this is the "updated
  // deliberately" case it describes, not a breach of it.
  //
  // Read the objection above closely: it is not that sign-off must never be
  // written, it is that the planner held sign-off as a BARE BOOLEAN -- no
  // attribution, no timestamp, no notes -- so a write-back would replace an
  // ATTESTED sign-off with a flag. That precondition is now gone. The planner
  // signs the user in through MSAL and web/graph-writeback.js resolves them to a
  // site-user id, so it writes InstallerSignOffById and InstallerSignOffOn
  // alongside the flag. The precondition is satisfied rather than overridden.
  //
  // What changed outside the code: the pilot runs on the planner alone, with no
  // field crews on the canvas app, so sign-off has to be recordable here or it
  // is recordable nowhere.
  //
  // NOTE the scheduling write path is deliberately untouched: WRITEBACK_FIELDS
  // still holds only crew, start, days, locked, skip, so secFieldDiffs and
  // divergedSecs behave exactly as before. Sign-off is carried in the baseline
  // for a SEPARATE diff with its own write shape (Person column, timestamp,
  // reopen note), because it cannot share the plain-field PATCH path.
  const EXPECTED_BASE_KEYS = 'crewId,days,id,inst,locked,pm,seq,skip,spLocked,start';
  ok('the baseline holds exactly the fields the planner may write -- no more',
     win.allSecs(j2).every(({ s }) => Object.keys(s.base).sort().join(',') === EXPECTED_BASE_KEYS),
     Object.keys(win.allSecs(j2)[0].s.base).sort().join(','));

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

  // --- a full localStorage must not freeze the screen ---
  // Past the browser's quota (about 5 MB) setItem throws. render() saves last, so
  // the throw used to escape every handler and the screen stopped following edits.
  const realSet = win.Storage.prototype.setItem;
  win.Storage.prototype.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  const fzText = () => win.document.getElementById('freshness').textContent;
  let threw = null;
  try { win.render(); } catch (e) { threw = e; }
  ok('a full localStorage does not throw out of render', !threw, threw && threw.name);
  ok('the header says this browser is not keeping a copy', /not keeping a copy/i.test(fzText()), fzText().slice(-140));
  threw = null;
  try { win.setZoom('week'); } catch (e) { threw = e; }
  ok('a handler that saves before rendering still renders', !threw && /zoom-week/.test(win.document.getElementById('main').innerHTML),
     threw ? threw.name : 'zoom-week drawn: ' + /zoom-week/.test(win.document.getElementById('main').innerHTML));
  win.render();
  ok('the warning is shown once, not stacked on each render', (fzText().match(/not keeping a copy/gi) || []).length === 1, fzText().slice(-200));
  // A task tick saves without rendering, so the header is NOT rewritten in between:
  // save() itself has to avoid stacking the note and has to take it down.
  win.save(); win.save();
  ok('saves with no render in between show the warning once', (fzText().match(/not keeping a copy/gi) || []).length === 1, fzText().slice(-200));
  win.Storage.prototype.setItem = realSet;
  win.save();
  ok('a save that works takes the warning down without a render', !/not keeping a copy/i.test(fzText()), fzText().slice(-140));
  win.render();
  ok('the warning clears once the browser can store again', !/not keeping a copy/i.test(fzText()), fzText().slice(-140));

  process.exit(fail);
})();
