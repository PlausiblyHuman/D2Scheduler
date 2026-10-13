/* Copy that describes what a control does must match what the control does.
 *
 * Two defects of this kind reached the hosted planner on 2026-09-16:
 *
 * 1. The INST and PM tooltips said "Ticking here is not saved back; the record is
 *    the field app" after the planner had started recording sign-off through
 *    Save. True at 09:12, false at 10:02, still on screen that afternoon.
 * 2. Rebuild-from-template warned that saving afterwards would send the cleared
 *    crews to SharePoint. It cannot: the rebuilt pools lose their baseline, so
 *    Save sends nothing for them. Set-all-durations is the opposite case -- the
 *    pools stay linked and Save DOES send the new durations -- and its prompt
 *    did not say so.
 *
 * The template tab no longer edits anything (2026-10-13), so the two rebuild dialogs are gone.
 *
 * Each assertion here pairs the claim with the behaviour it describes, so a
 * change to either one goes red.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../web/index.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.importFromD2=importFromD2;
    window.SEED_TEMPLATE=SEED_TEMPLATE;window.sgHTML=sgHTML;window.poolHasBaseline=poolHasBaseline;
    window.buildChangeSet=buildChangeSet;window.buildSignoffSet=buildSignoffSet;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.alert = () => {};
win.confirm = () => true;   // the Refresh dialog

const titles = markup => {
  const d = win.document.createElement('div'); d.innerHTML = markup;
  const [inst, pm] = [...d.querySelectorAll('label')].map(l => l.title);
  return { inst, pm };
};

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = win.S;
  const T = win.SEED_TEMPLATE;
  const secDefs = T.flatMap(g => g.sections.map(s => ({ num: s.num, name: s.name, tasks: s.tasks })));
  const payload = {
    app: 'D2 Pool Build Scheduler', kind: 'd2-sharepoint-export', exported: '2026-09-16',
    site: 'https://example', nonWork: [],
    jobs: [{
      id: 19, jobno: 'D2-1042', name: 'Reyes Residence', addr: '', city: '', start: '2026-09-08',
      status: 'Active', pm: 'Cody Campbell',
      sections: secDefs.map((s, i) => ({
        id: 1000 + i, num: s.num, name: s.name, crewId: 'devon', start: '2026-09-08', finish: '2026-09-09',
        days: 2, skip: false, locked: false, inst: i < 3, pm: false,
        tasks: s.tasks.map((t, k) => ({ id: 5000 + i * 10 + k, seq: k + 1, title: t, done: i < 3, na: false }))
      }))
    }]
  };
  const load = async () => {
    win.importFromD2(new win.File([JSON.stringify(payload)], 'd2.json', { type: 'application/json' }));
    await new Promise(r => setTimeout(r, 400));
    return S.jobs.find(x => x.jobno === 'D2-1042');
  };

  // ---------------------------------------------------------------- tooltips
  let j = await load();
  const realMode = win.graphModeAvailable;

  win.graphModeAvailable = () => false;
  let t = titles(win.sgHTML(j.id, 0, 0, { inst: true, pm: false }));
  ok('downloaded copy: INST says a tick is not saved', /cannot save sign-off/.test(t.inst), t.inst);
  ok('downloaded copy: PM says the same', /cannot save sign-off/.test(t.pm), t.pm);

  win.graphModeAvailable = () => true;
  t = titles(win.sgHTML(j.id, 0, 0, { inst: true, pm: false }));
  ok('hosted: INST says Save records it under your name', /Press Save to record it in SharePoint under your name/.test(t.inst), t.inst);
  ok('hosted: INST says un-ticking reopens', /reopens it/.test(t.inst));
  ok('hosted: PM says Save records it', /Press Save to record it in SharePoint/.test(t.pm), t.pm);
  ok('hosted: PM does not promise a name (there is no PMSignOffBy column)', !/your name/.test(t.pm));
  ok('no tooltip still points at the field app', ![t.inst, t.pm].some(x => /field app/i.test(x)));

  // ...and the hosted claim is true: a tick on a linked pool reaches the sign-off set.
  const sec = win.allSecs(j).find(x => !x.s.inst).s;
  sec.inst = true;
  ok('hosted claim holds: an INST tick on a linked pool is in the sign-off set',
     win.buildSignoffSet().some(p => p.sections.some(s => s.inst && s.inst.to === true)));
  sec.inst = false;

  // ------------------------------- delete a crew (stays linked, sends) -------
  j = await load();
  let crewAsk = '';
  win.confirm = m => { crewAsk = m; return true; };
  win.eval("delCrew('devon')");
  ok('delete-crew: the dialog says Save sends the cleared crews', /pressing Save afterwards sends that to SharePoint/.test(crewAsk),
     crewAsk.replace(/\s+/g, ' ').slice(0, 200));
  ok('delete-crew: the dialog counts the sub-phases it clears', /taken off \d+ sub-phases/.test(crewAsk));
  const csCrew = win.buildChangeSet();
  ok('delete-crew claim holds: Save would send Crew for the cleared rows',
     csCrew.length === 1 && csCrew[0].sections.some(s => s.fields.Crew && s.fields.Crew.from === 'devon'), csCrew.length + ' pool(s)');

  win.graphModeAvailable = realMode;
  console.log(fail ? '\nFAILED' : '\nall passed');
  process.exit(fail);
})();
