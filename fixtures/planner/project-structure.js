// fixtures/planner/project-structure.js   Run: node fixtures/planner/project-structure.js
// A SharePoint project is laid out from its OWN rows, never matched to the template by number
// (docs/specs/2026-10-21-projects-own-structure-design.md, part B).
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const WEB = path.join(__dirname, '..', '..', 'web');
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-payloads-graph.json'), 'utf8'));
let fails = 0;
const ok = (l, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) { fails++; process.exitCode = 1; } };

function boot() {
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', '')
    .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
    .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
    .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
    .replace('</body>', `<script>Object.defineProperty(window,'S',{get:()=>S,configurable:true});window.importFromD2Payload=importFromD2Payload;
      window.allSecs=allSecs;window.readyToComplete=readyToComplete;window.mkTemplate=mkTemplate;window.divergedSecs=divergedSecs;</script></body>`);
  const errs = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost:8787/', virtualConsole: vc });
  const w = dom.window, alerts = []; w.alert = m => alerts.push(String(m)); w.confirm = () => true;
  return { w, errs, alerts };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const row = (id, num, name, extra) => Object.assign({ id, seq: id, num, name, crewId: null, start: null, finish: null, days: 2,
  skip: false, locked: false, inst: false, pm: false, tasks: [] }, extra);
const payload = (sections, extra) => ({ app: 'D2 Pool Build Scheduler', kind: 'd2-sharepoint-export', exported: '2026-10-21', site: 'x', nonWork: [],
  jobs: [Object.assign({ id: 77, jobno: 'D2-7000', name: 'Structure Test', addr: '', city: '', start: '2026-11-02', status: 'Active',
    buildType: 'Gunite', pm: '', sections }, extra)] });

(async () => {
  const { w, errs, alerts } = boot(); await wait(500);
  const job = () => w.S.jobs.find(j => j.jobno === 'D2-7000');
  const secs = () => w.allSecs(job()).map(x => x.s);

  // ---- 1. A project whose rows differ from the template, and a renumbered template ----
  /* The template here is renumbered the way Don's gas phases would renumber it: 3.4 becomes
     Gas Rough-In. The project's own 3.4 is still Electrical Rough-In. Before 2026-10-21 the
     row attached to the template's 3.4 and showed as Gas, with an edit there writing to the
     electrical row. */
  const T = w.mkTemplate();
  const p3 = T.find(p => p.num === '3');
  const s34 = p3.sections.find(s => s.num === '3.4');
  s34.name = 'Gas Rough-In'; s34.skill = 'gas';
  p3.name = 'Site Prep (renamed in the template)';   // the row's own phase name must win
  w.S.templates = { Gunite: T };
  w.importFromD2Payload(payload([
    row(1, '0.0', 'Sales to Production Handoff', { phase: 'Pre Construction/Sales', skill: '@office',
      tasks: [{ id: 501, seq: 1, title: 'Contract review', done: true, na: false, note: '' },
              { id: 502, seq: 2, title: 'Signed (added on this job)', done: false, na: true, note: 'not needed' }] }),
    row(2, '3.2', 'Underground Plumbing Installation', { phase: 'Site Prep', skill: 'plumbing', crewId: 'harrison' }),
    row(3, '3.25', 'Gas Line Rough-In', { phase: 'Site Prep', skill: 'gas', crewId: 'saul' }),
    row(4, '3.4', 'Electrical Rough-In', { phase: 'Site Prep', skill: '@sub' }),
    row(5, '7.0', 'Warranty & 30-Day Follow-Up', { phase: 'Post Constuction Completion Phase', skill: '@office' })
  ]), true);
  let ss = secs();
  ok('the project has exactly its own rows: no template lines, no dropped rows',
     ss.map(s => s.num).join(',') === '0.0,3.2,3.25,3.4,7.0', ss.map(s => s.num).join(','));
  ok('every line is a SharePoint row with a baseline', ss.every(s => s.base && s.base.id != null));
  ok('a row the template does not have is kept (3.25 Gas Line Rough-In)',
     ss[2].name === 'Gas Line Rough-In' && ss[2].crewId === 'saul' && ss[2].skill === 'gas');
  ok('a renumbered template cannot relabel a row: 3.4 is still Electrical Rough-In with its own skill',
     ss[3].name === 'Electrical Rough-In' && ss[3].skill === '@sub' && ss[3].base.id === 4, ss[3].name + ' ' + ss[3].skill);
  ok('rows are grouped into phases by number, named from the row',
     job().groups.map(g => g.num + ':' + g.name).join('|') === '0:Pre Construction/Sales|3:Site Prep|7:Post Constuction Completion Phase',
     job().groups.map(g => g.num + ':' + g.name).join('|'));
  ok('the checklist is the row\'s own tasks, text and ids',
     ss[0].tasks.length === 2 && ss[0].tasks[1].t === 'Signed (added on this job)' && ss[0].tasks[1].spId === 502 && ss[0].tasks[0].spId === 501);
  ok('task state arrives with it', ss[0].tasks[0].done === true && ss[0].tasks[1].na === true && ss[0].tasks[1].note === 'not needed');
  ok('no unmatched alert', !alerts.some(a => /matched nothing/.test(a)), alerts.join(' | '));
  ok('no line needed the template', ss.every(s => s.fb === false));
  ok('nothing is diverged straight after a load', w.divergedSecs(job()).length === 0, String(w.divergedSecs(job()).length));

  // ---- 2. Rows from before the backfill: phase and skill come from the template by number ----
  w.S.templates = { Gunite: w.mkTemplate() };
  w.importFromD2Payload(payload([row(1, '0.0', 'Sales to Production Handoff'), row(2, '3.2', 'Underground Plumbing Installation', { skill: 'plumbing' })]), true);
  ss = secs();
  ok('a row with no phase or skill borrows them from the template by number',
     job().groups[0].name === 'Pre Construction/Sales' && ss[0].skill === '@office' && ss[0].fb === true,
     job().groups[0].name + ' ' + ss[0].skill + ' ' + ss[0].fb);
  ok('a row carrying its own skill keeps it and is flagged only for the borrowed phase name',
     ss[1].skill === 'plumbing' && ss[1].fb === true && job().groups[1].name === 'Site Prep');
  ok('a row neither side knows gets no phase name and no skill, and is not dropped', (() => {
    w.importFromD2Payload(payload([row(9, '9.9', 'Something new')]), true);
    const s = secs();
    return s.length === 1 && s[0].name === 'Something new' && s[0].skill === null && s[0].fb === false && job().groups[0].name === '';
  })());

  w.importFromD2Payload(payload([row(1, '9.1', 'no name here'), row(2, '9.2', 'second', { phase: 'Specialty Structures', skill: '@office' })]), true);
  ok('a phase whose first row carries no name takes it from a later row',
     job().groups.length === 1 && job().groups[0].name === 'Specialty Structures', job().groups.map(g => g.name).join('|'));

  // ---- 3. Re-import replaces the layout: a row removed in SharePoint goes ----
  w.importFromD2Payload(payload([row(1, '0.0', 'A', { phase: 'P0', skill: '@office' }), row(2, '0.1', 'B', { phase: 'P0', skill: '@office' })]), true);
  ok('two rows load', secs().length === 2);
  w.importFromD2Payload(payload([row(1, '0.0', 'A', { phase: 'P0', skill: '@office' })]), true);
  ok('a row deleted in SharePoint disappears on the next Refresh', secs().length === 1 && secs()[0].base.id === 1);

  // ---- 4. Phases are consecutive runs, so an out-of-order row does not merge two runs ----
  w.importFromD2Payload(payload([row(1, '3.1', 'a', { phase: 'Three', skill: '@office' }), row(2, '4.1', 'b', { phase: 'Four', skill: '@office' }),
                                 row(3, '3.2', 'c', { phase: 'Three', skill: '@office' })]), true);
  ok('rows stay in Sequence order, phases split where the number changes',
     job().groups.map(g => g.num).join(',') === '3,4,3' && secs().map(s => s.num).join(',') === '3.1,4.1,3.2');

  // ---- 5. Completion counts only the project's own rows ----
  w.importFromD2Payload(payload([row(1, '0.0', 'A', { phase: 'P0', skill: '@office', inst: true }),
                                 row(2, '0.1', 'B', { phase: 'P0', skill: '@office', skip: true })]), true);
  ok('a project whose own rows are all signed or N/A is ready to complete, whatever the template holds',
     w.readyToComplete(job()) === true);

  // ---- 6. The Graph mapper carries the four columns ----
  {
    const asg = JSON.parse(JSON.stringify(G.asg)).slice(0, 46);
    asg.forEach((a, i) => { a.fields.PhaseName = 'Phase ' + i; a.fields.Skill = 'sk' + i; a.fields.TemplateItemId = String(100 + i); a.fields.Feature = i === 3 ? 'Fire feature' : undefined; });
    const p = w.D2GraphToPlanner.toPlannerPayload(Object.assign({}, G, { asg }));
    const all = [].concat(...p.jobs.map(j => j.sections));
    const s0 = all.find(s => s.id === Number(asg[0].fields.id));
    const s3 = all.find(s => s.id === Number(asg[3].fields.id));
    ok('PhaseName, Skill, TemplateItemId reach the payload', s0 && s0.phase === 'Phase 0' && s0.skill === 'sk0' && s0.templateItemId === 100,
       JSON.stringify(s0 && { p: s0.phase, s: s0.skill, t: s0.templateItemId }));
    ok('Feature reaches the payload, and is null where blank', s3 && s3.feature === 'Fire feature' && s0.feature === null);
    const raw = w.D2GraphToPlanner.toPlannerPayload(G);
    const r0 = [].concat(...raw.jobs.map(j => j.sections))[0];
    ok('a row without the columns maps them to null, not undefined', r0.phase === null && r0.skill === null && r0.templateItemId === null && r0.feature === null);
  }

  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(fails ? '\nFAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
