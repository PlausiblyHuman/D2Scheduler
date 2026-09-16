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
    window.buildChangeSet=buildChangeSet;window.buildSignoffSet=buildSignoffSet;
    window.applyTemplate=applyTemplate;window.setAllDays=setAllDays;};</script><script>__x();</script></body>`);
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

  // ------------------------------------------- rebuild from template (unlinks)
  let prompt = '';
  win.confirm = m => { prompt = m; return true; };
  win.applyTemplate();
  j = S.jobs.find(x => x.jobno === 'D2-1042');
  ok('rebuild: the dialog says Save sends nothing for rebuilt pools', /Save sends nothing for them/.test(prompt), prompt.replace(/\s+/g, ' ').slice(0, 160));
  ok('rebuild: the dialog no longer claims the cleared crews go with a Save', !/cleared crews go with it/.test(prompt));
  ok('rebuild claim holds: the pool has lost its baseline', win.poolHasBaseline(j) === false);
  ok('rebuild claim holds: Save would send no scheduling change', win.buildChangeSet().length === 0);
  ok('rebuild claim holds: Save would reopen no sign-off', win.buildSignoffSet().length === 0);

  t = titles(win.sgHTML(j.id, 0, 0, { inst: false, pm: false }));
  ok('hosted, unlinked pool: the tooltip says a tick is not saved', /not in SharePoint yet/.test(t.inst), t.inst);

  j = await load();
  ok('rebuild dialog: Refresh does link the pool again', win.poolHasBaseline(j) === true);
  ok('...with sign-offs back as SharePoint holds them', win.allSecs(j).filter(x => x.s.inst).length === 3);

  // ------------------------------------ set all durations (stays linked, sends)
  let asked = '';
  win.prompt = m => { asked = m; return '5'; };
  win.setAllDays();
  ok('set-all-durations: the prompt says Save sends the new durations', /Save afterwards sends the new durations/.test(asked), asked.replace(/\s+/g, ' ').slice(0, 200));
  ok('set-all-durations: the prompt names Refresh as the way back', /Refresh/.test(asked));
  const cs = win.buildChangeSet();
  ok('set-all-durations claim holds: Save would send DurationDays',
     cs.length === 1 && cs[0].sections.some(s => s.fields.DurationDays && s.fields.DurationDays.to === 5),
     cs.length + ' pool(s)');

  win.graphModeAvailable = realMode;
  console.log(fail ? '\nFAILED' : '\nall passed');
  process.exit(fail);
})();
