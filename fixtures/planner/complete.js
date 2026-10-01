/* Spec A, Part 3: completing projects and reading only live ones.
 * docs/superpowers/specs/2026-09-28-complete-projects-and-live-reads-design.md
 * docs/superpowers/plans/2026-10-01-spec-a-complete-projects-live-reads.md (Tasks 5-10)
 *
 * Run: node fixtures/planner/complete.js
 * The mapper runs under Node; the planner runs in jsdom with MSAL and fetch stubbed, and the
 * fetch stub answers the per-project $filter URLs the way Graph did in the 2026-10-01 capture
 * (fixtures/planner/live-payloads-graph-filtered.json).
 */
const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '../../web');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-payloads-graph.json'), 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { JSDOM, VirtualConsole } = require('jsdom');
const HOST = 'https://mango-sky-0d6904310.5.azurestaticapps.net';

const MSAL_STUB = `<script>
window.msal={PublicClientApplication:class{
  constructor(){} getActiveAccount(){return {username:'cody@d2pools.com',name:'Cody Campbell'};}
  setActiveAccount(){} getAllAccounts(){return [];}
  acquireTokenSilent(){return Promise.resolve({accessToken:'t'});}
  loginPopup(){return Promise.resolve({accessToken:'t',account:{username:'cody@d2pools.com'}});}
}};
</script>`;
const UIL = [
  { id: '7', Title: 'D2 Bot', Name: 'i:0#.f|membership|stratirus@d2pools.com', EMail: 'd2bot@d2pools.com' },
  { id: '14', Title: 'Cody Campbell', Name: 'i:0#.f|membership|cody@d2pools.com', EMail: 'cody@d2pools.com' }
].map(f => ({ id: f.id, fields: f }));

/* Answers Graph the way the 2026-10-01 capture showed it does: a $filter on fields/JobLookupId
   or an `or` chain on fields/AssignmentLookupId returns only the matching rows. Every URL is
   recorded. state.jobs overrides the Jobs rows; state.ignoreFilters makes the stub return whole
   lists, as a Graph that ignored the filter would. */
function boot(state) {
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL_STUB)
    .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
    .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
    .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
    .replace('</body>', `<script>window.__x=()=>{window.S=S;window.render=render;window.D2_GRAPH=D2_GRAPH;
      window.allSecs=allSecs;window.divergedSecs=divergedSecs;window.buildChangeSet=buildChangeSet;
      window.buildSignoffSet=buildSignoffSet;window.buildRejectionSet=buildRejectionSet;window.touch=touch;
      window.confirmSaveByPush=confirmSaveByPush;window.autoSchedule=autoSchedule;window.conflicts=conflicts;
      window.sign=sign;window.editSec=editSec;window.closeDrawer=closeDrawer;
      window.fn=n=>eval(n);};</script><script>__x();</script></body>`);
  const errs = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const net = { gets: [], posts: [], patches: [] };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, opts) => {
        u = String(u);
        const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status,
          json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
        if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
        if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: G.siteId, webUrl: G.site });
        if (u.includes('User Information List')) return json(200, { value: UIL });
        if (opts && opts.method === 'POST') { net.posts.push({ url: u, body: JSON.parse(opts.body) }); return json(201, {}); }
        if (opts && opts.method === 'PATCH') { net.patches.push({ url: u, body: JSON.parse(opts.body) }); return json(200, {}); }
        net.gets.push(u);
        // state.throttleOnce: the first read matching it answers 429 Retry-After 0, as Graph does under load.
        if (state.throttleOnce && u.includes(state.throttleOnce) && !state.throttled) {
          state.throttled = true;
          return Promise.resolve({ ok: false, status: 429, headers: { get: h => /retry-after/i.test(h) ? '0' : null },
            json: () => Promise.resolve({}), text: () => Promise.resolve('throttled') });
        }
        const L = w.D2_GRAPH && w.D2_GRAPH.lists;
        const flt = decodeURIComponent((u.match(/[?&]\$filter=([^&]*)/) || [])[1] || '');
        const ids = re => [...flt.matchAll(re)].map(m => m[1]);
        if (L) {
          if (u.includes('/lists/' + L.jobs + '/items')) {
            const rows = state.jobs || G.jobs;
            const byId = flt.match(/^id eq '?(\d+)'?$/);
            return json(200, { value: byId ? rows.filter(r => String(r.fields.id) === byId[1]) : rows });
          }
          if (u.includes('/lists/' + L.asg + '/items')) {
            const want = ids(/JobLookupId eq '?(\d+)'?/g), ASG = state.asg || G.asg;
            return json(200, { value: state.ignoreFilters || !want.length ? ASG : ASG.filter(a => want.includes(String(a.fields.JobLookupId))) });
          }
          if (u.includes('/lists/' + L.tasks + '/items')) {
            const want = ids(/AssignmentLookupId eq '?(\d+)'?/g);
            return json(200, { value: state.ignoreFilters || !want.length ? G.tasks : G.tasks.filter(t => want.includes(String(t.fields.AssignmentLookupId))) });
          }
          if (u.includes('/lists/' + L.cal + '/items')) return json(200, { value: G.cal });
          if (u.includes('/lists/' + L.req + '/items')) return json(200, { value: state.req || [] });
        }
        if (/\/lists\/[^/]+\/items/.test(u)) return json(200, { value: [] });
        return json(404, {});
      };
    }
  });
  const w = dom.window;
  w.alert = m => { (w.__alerts = w.__alerts || []).push(String(m)); };
  w.confirm = m => { (w.__confirms = w.__confirms || []).push(String(m)); return state.confirm !== false; };
  return { w, errs, net };
}
const refresh = async w => { w.document.getElementById('d2Btn').click(); await sleep(900); };
const tab = (w, t) => w.document.querySelector(`#tabs button[data-t="${t}"]`).click();
const main = w => w.document.getElementById('main');
const listOf = (w, u) => { const L = w.D2_GRAPH.lists; return Object.keys(L).find(k => u.includes('/lists/' + L[k] + '/items')); };
const jobsWith = (id, status, modified) => G.jobs.map(j => String(j.fields.id) === String(id)
  ? { ...j, fields: { ...j.fields, Status: status, Modified: modified || j.fields.Modified } } : j);

(async () => {
  // ---------- Task 5: the mapper splits live and completed projects ----------
  {
    const M = require(path.join(WEB, 'graph-to-planner.js'));
    const G2 = clone(G);
    // The OLDER completion is first in list order, so only a real sort puts the newer one first.
    const done = G2.jobs[1]; done.fields.Status = 'Complete'; done.fields.Modified = '2026-10-02T15:00:00Z';
    const older = G2.jobs[0]; older.fields.Status = 'Complete'; older.fields.Modified = '2026-09-01T15:00:00Z';
    const p = M.toPlannerPayload(G2);
    const nos = p.jobs.map(j => String(j.jobno));
    ok('complete projects are left out of jobs', !nos.includes(done.fields.JobNumber) && !nos.includes(older.fields.JobNumber), nos.join(' | '));
    ok('live projects still mapped', p.jobs.length === G2.jobs.length - 2);
    ok('completed projects listed, newest first',
      Array.isArray(p.completedJobs) && p.completedJobs.length === 2 && p.completedJobs[0].jobno === done.fields.JobNumber
      && p.completedJobs[0].completedOn === '2026-10-02T15:00:00Z', JSON.stringify(p.completedJobs));
    ok('a completed project carries its SharePoint id, name and PM field',
      p.completedJobs[0].id === Number(done.fields.id) && p.completedJobs[0].name === done.fields.Title && 'pm' in p.completedJobs[0]);
    ok('completed job numbers carried for the import', Array.isArray(p.completedJobNumbers)
      && p.completedJobNumbers.includes(done.fields.JobNumber) && p.completedJobNumbers.includes(older.fields.JobNumber));
    ok('includeComplete keeps a completed project in jobs',
      M.toPlannerPayload(G2, { includeComplete: true }).jobs.some(j => j.jobno === done.fields.JobNumber));
    const none = M.toPlannerPayload(clone(G));
    ok('with nothing complete, both lists are empty and every project is mapped',
      none.completedJobs.length === 0 && none.completedJobNumbers.length === 0 && none.jobs.length === G.jobs.length);
  }

  // ---------- Task 6: Refresh reads per live project ----------
  {
    const M = require(path.join(WEB, 'graph-to-planner.js'));
    const u = 'https://g/lists/T/items';
    ok('no assignments means no tasks query (never an empty or-chain)', Array.isArray(M.taskUrls(u, [], Infinity)) && M.taskUrls(u, [], Infinity).length === 0);
    const one = M.taskUrls(u, [1, '2'], Infinity);
    ok('ids become one quoted or-chain', one.length === 1
      && decodeURIComponent(one[0]).includes("fields/AssignmentLookupId eq '1' or fields/AssignmentLookupId eq '2'"), one[0]);
    ok('chunked when asked: 46 ids in 15s make 4 queries', M.taskUrls(u, Array.from({ length: 46 }, (_, i) => i + 1), 15).length === 4);
    ok('assignment query filters on the quoted job lookup id',
      decodeURIComponent(M.asgUrl(u, 27)).includes("$filter=fields/JobLookupId eq '27'"));

    // A Graph that ignored the filter would hand every project every row. readLive keeps only
    // the rows that belong to the project it asked about.
    const r = await M.readLive({ jobs: [G.jobs[0]], asgItems: 'A', taskItems: 'T', pageAll: async url => url.startsWith('A') ? G.asg : G.tasks });
    const j0 = String(G.jobs[0].fields.id);
    ok('rows from another project are dropped even if the filter is ignored',
      r.asg.length === G.asg.filter(a => String(a.fields.JobLookupId) === j0).length && r.asg.every(a => String(a.fields.JobLookupId) === j0));
    const mine = new Set(r.asg.map(a => String(a.fields.id)));
    ok('tasks kept are only that project\'s', r.tasks.length > 0 && r.tasks.every(t => mine.has(String(t.fields.AssignmentLookupId))));

    const doneId = String(G.jobs[0].fields.id), doneNo = G.jobs[0].fields.JobNumber;
    const { w, errs, net } = boot({ jobs: jobsWith(doneId, 'Complete', '2026-10-02T15:00:00Z') });
    await sleep(300); await refresh(w);
    const reads = net.gets.filter(x => ['asg', 'tasks'].includes(listOf(w, x)));
    ok('Refresh reads Assignments and Tasks only through a filter', reads.length > 0 && reads.every(x => /\$filter=/.test(x)), reads.filter(x => !/\$filter=/.test(x)).join(' '));
    const asgReads = reads.filter(x => listOf(w, x) === 'asg').map(decodeURIComponent);
    ok('one Assignments read per live project', asgReads.length === G.jobs.length - 1, asgReads.length + ' reads');
    ok('the completed project is never read', !asgReads.some(x => x.includes("JobLookupId eq '" + doneId + "'")));
    const liveAsgIds = new Set(G.asg.filter(a => String(a.fields.JobLookupId) !== doneId).map(a => String(a.fields.id)));
    const taskIds = reads.filter(x => listOf(w, x) === 'tasks').flatMap(x => [...decodeURIComponent(x).matchAll(/AssignmentLookupId eq '(\d+)'/g)].map(m => m[1]));
    ok('Tasks are read only for live projects\' assignments', taskIds.length === liveAsgIds.size && taskIds.every(id => liveAsgIds.has(id)), taskIds.length + ' ids');
    ok('the planner holds the live projects and not the completed one',
      w.S.jobs.length === G.jobs.length - 1 && !w.S.jobs.some(j => j.jobno === doneNo));
    ok('every live project arrives with all its sub-phases and tasks',
      w.S.jobs.every(j => w.allSecs(j).filter(x => x.s.base).length === 46));
    ok('Refresh raised no script error', errs.length === 0, errs.join(' / '));
  }

  // ---------- Task 7: the import drops newly completed projects, keeps local sketches ----------
  {
    // Two projects whose numbers differ only by a space, as 26-2055 and 26- 2055 do live.
    const [a, b, c] = G.jobs;
    const base = [{ ...a, fields: { ...a.fields, JobNumber: '26-2055' } }, { ...b, fields: { ...b.fields, JobNumber: '26- 2055' } }, c];
    const state = { jobs: base };
    const { w, errs } = boot(state);
    await sleep(300); await refresh(w);
    ok('both look-alike numbers load', w.S.jobs.some(j => j.jobno === '26-2055') && w.S.jobs.some(j => j.jobno === '26- 2055'));

    // A sketch made here and never saved, carrying the same number as the project about to be
    // completed. It has no SharePoint baseline, so it is not that project and must survive.
    const real = w.S.jobs.find(j => j.jobno === '26- 2055');
    const sketch = JSON.parse(JSON.stringify(real));
    sketch.id = 'sketch-1'; delete sketch.status;
    sketch.groups.forEach(g => g.sections.forEach(s => { delete s.base; delete s.id; }));
    w.S.jobs.push(sketch);

    state.jobs = base.map(j => j.fields.JobNumber === '26- 2055' ? { ...j, fields: { ...j.fields, Status: 'Complete', Modified: '2026-10-02T15:00:00Z' } } : j);
    w.__confirms = [];
    await refresh(w);
    const nos = w.S.jobs.map(j => j.jobno);
    ok('a project completed since the last Refresh leaves the planner', !w.S.jobs.some(j => j.jobno === '26- 2055' && j.id !== 'sketch-1'), nos.join(' | '));
    ok('a local sketch with the same number is kept', w.S.jobs.some(j => j.id === 'sketch-1'));
    ok('the look-alike number stays', nos.includes('26-2055'));
    ok('the completed project is listed for the Jobs tab', (w.S.completedJobs || []).length === 1 && w.S.completedJobs[0].jobno === '26- 2055');
    ok('the Refresh dialog says a completed project will leave', (w.__confirms[0] || '').includes('1 completed project will leave the planner'), w.__confirms[0]);
    ok('the Refresh dialog says projects, not pools', !/pool\(s\)/.test(w.__confirms[0] || ''));
    ok('import raised no script error', errs.length === 0, errs.join(' / '));
  }

  // ---------- Task 8: Save reads only the projects it writes ----------
  {
    const { w, errs, net } = boot({});
    await sleep(300); await refresh(w);
    const [A, B] = w.S.jobs;
    ok('each project keeps its SharePoint id', w.S.jobs.every(j => j.spId && G.jobs.some(g => String(g.fields.id) === j.spId)));
    // A crew change on A, and on B a ticked task (which makes Save read B's Tasks).
    const secA = w.allSecs(A).find(x => x.s.base && !x.s.inst && !x.s.locked);
    secA.s.crewId = secA.s.crewId === 'devon' ? 'saul' : 'devon'; w.touch(A);
    const hitB = w.allSecs(B).find(x => x.s.base && !x.s.inst && !x.s.locked && x.s.tasks.some(t => !t.done && !t.na && t.spId));
    w.editSec(B.id, hitB.gi, hitB.si);
    w.fn('tick')(hitB.s.tasks.findIndex(t => !t.done && !t.na && t.spId), true);
    w.closeDrawer();
    net.gets.length = 0;
    w.fn('openSavePreview')(); await sleep(50);
    await w.confirmSaveByPush(); await sleep(300);
    // The Save's own reads are the ones before the post-save Refresh begins (that Refresh reads every live project).
    const firstRefresh = net.gets.findIndex(u => listOf(w, u) === 'cal');
    const own = net.gets.slice(0, firstRefresh === -1 ? net.gets.length : firstRefresh).filter(u => ['asg', 'tasks'].includes(listOf(w, u))).map(decodeURIComponent);
    ok('Save reads nothing whole', own.length > 0 && own.every(u => u.includes('$filter=')), own.filter(u => !u.includes('$filter=')).join(' '));
    const asgJobs = own.filter(u => listOf(w, u) === 'asg').map(u => (u.match(/JobLookupId eq '(\d+)'/) || [])[1]);
    ok('Save reads Assignments for exactly the projects it writes', JSON.stringify([...new Set(asgJobs)].sort()) === JSON.stringify([A.spId, B.spId].sort()), asgJobs.join(','));
    const tIds = own.filter(u => listOf(w, u) === 'tasks').flatMap(u => [...u.matchAll(/AssignmentLookupId eq '(\d+)'/g)].map(m => m[1]));
    ok('Save reads Tasks only for the ticked sub-phase', tIds.length > 0 && tIds.every(id => id === String(hitB.s.base.id)), tIds.join(','));
    ok('the crew change was written', net.patches.some(p => p.url.includes('/items/' + secA.s.base.id + '/') && p.body.Crew));
    ok('the tick was written', net.patches.some(p => p.url.includes('/lists/' + w.D2_GRAPH.lists.tasks + '/') && p.body.Complete === true));
    ok('Save raised no script error', errs.length === 0, errs.join(' / '));
  }

  // A project held from before this change has no spId until the next Refresh. Save falls back
  // to the whole-list read rather than refusing the write for want of an id.
  {
    const { w, net } = boot({});
    await sleep(300); await refresh(w);
    const A = w.S.jobs[0]; delete A.spId;
    const secA = w.allSecs(A).find(x => x.s.base && !x.s.inst && !x.s.locked);
    secA.s.crewId = secA.s.crewId === 'devon' ? 'saul' : 'devon'; w.touch(A);
    net.gets.length = 0;
    w.fn('openSavePreview')(); await sleep(50);
    await w.confirmSaveByPush(); await sleep(300);
    ok('without an id, Save falls back and still writes', net.patches.some(p => p.url.includes('/items/' + secA.s.base.id + '/') && p.body.Crew));
  }

  // ---------- Task 9: Ready to complete, Mark complete, Completed projects, Reopen ----------
  {
    const [X, Y, Z] = G.jobs.map(j => String(j.fields.id));
    const jobNo = id => G.jobs.find(j => String(j.fields.id) === id).fields.JobNumber;
    // X: every sub-phase signed, one of them N/A instead. Y: one sub-phase left unsigned.
    // Z: all signed but Planned, so never offered.
    const asgFor = (signAll, opts = {}) => G.asg.map(a => {
      const f = { ...a.fields }, jid = String(f.JobLookupId);
      if (signAll.includes(jid)) { f.InstallerSignOff = true; f.NotApplicable = false; }
      return { ...a, fields: f };
    }).map((a, i, arr) => {
      const f = a.fields, mine = arr.filter(b => String(b.fields.JobLookupId) === String(f.JobLookupId));
      if (opts.naFirst && opts.naFirst.includes(String(f.JobLookupId)) && mine[0] === a) { f.InstallerSignOff = false; f.NotApplicable = true; }
      if (opts.leaveOne && opts.leaveOne.includes(String(f.JobLookupId)) && mine[1] === a) { f.InstallerSignOff = false; }
      return a;
    });
    const state = {
      jobs: G.jobs.map(j => String(j.fields.id) === Z ? { ...j, fields: { ...j.fields, Status: 'Planned' } } : j),
      asg: asgFor([X, Y, Z], { naFirst: [X], leaveOne: [Y] })
    };
    const { w, errs, net } = boot(state);
    await sleep(300); await refresh(w);
    tab(w, 'jobs'); await sleep(50);
    const rowOf = no => [...main(w).querySelectorAll('tbody tr')].find(tr => { const i = tr.querySelector('td input'); return i && i.value === no; });
    const has = (no, re) => re.test(rowOf(no).textContent);
    ok('a fully signed Active project is Ready to complete, N/A counting as done', has(jobNo(X), /Ready to complete/) && has(jobNo(X), /Mark complete/));
    ok('one unsigned sub-phase keeps a project off the list', !has(jobNo(Y), /Ready to complete|Mark complete/));
    ok('a Planned project is never offered', !has(jobNo(Z), /Ready to complete|Mark complete/));
    const banner = () => (main(w).querySelector('[data-ready-banner]') || {}).textContent || '';
    ok('the banner names the one ready project', banner().includes('1 project is ready to complete: ' + jobNo(X) + '.'), banner());

    // Review Focus 1: Y's last sub-phase ticked here but not saved. It now reads as ready, but
    // Mark complete must refuse: completing would discard the tick and close a project
    // SharePoint still holds unsigned.
    const jy = w.S.jobs.find(j => j.jobno === jobNo(Y));
    const open = w.allSecs(jy).find(x => !x.s.inst && !x.s.skip);
    w.sign(jy.id, open.gi, open.si, 'inst', true); await sleep(20);
    tab(w, 'jobs'); await sleep(50);
    ok('with that tick, the banner names both', banner().includes('2 projects are ready to complete: '), banner());
    net.patches.length = 0;
    w.fn('completeProject')(jy.id); await sleep(50);
    ok('Mark complete with an unsaved change asks to Save first', /Save first/.test(w.document.getElementById('dBody').textContent));
    ok('...and offers no way to go ahead', !/Mark complete/.test(w.document.getElementById('dFoot').textContent));
    ok('...and writes nothing', net.patches.length === 0);
    w.closeDrawer();
    // Undo Y's unsaved tick: since the review fix, ANY unsaved change on screen blocks Mark complete.
    w.sign(jy.id, open.gi, open.si, 'inst', false); await sleep(20);

    // Mark complete on X: one PATCH, Status Complete, then a Refresh that drops it.
    const jx = w.S.jobs.find(j => j.jobno === jobNo(X));
    w.fn('completeProject')(jx.id); await sleep(50);
    const body = w.document.getElementById('dBody').textContent;
    ok('the dialog says where the project goes and that it can be reopened',
      /Job Board/.test(body) && /calendar/.test(body) && /04:30/.test(body) && /Completed projects/.test(body), body.slice(0, 160));
    const go = [...w.document.querySelectorAll('#dFoot button')].find(b => /Mark complete/.test(b.textContent));
    // SharePoint completes it as the PATCH lands, which is what the next Refresh will see.
    const realFetch = w.fetch;
    w.fetch = (u, o) => { if (o && o.method === 'PATCH') state.jobs = state.jobs.map(j => String(j.fields.id) === X ? { ...j, fields: { ...j.fields, Status: 'Complete', Modified: '2026-10-02T15:00:00Z' } } : j); return realFetch(u, o); };
    go.click(); await sleep(900);
    w.fetch = realFetch;
    const jp = net.patches.filter(p => p.url.includes('/lists/' + w.D2_GRAPH.lists.jobs + '/'));
    ok('Mark complete sends one PATCH, Status Complete, to that Jobs row',
      jp.length === 1 && jp[0].body.Status === 'Complete' && jp[0].url.includes('/items/' + X + '/'), JSON.stringify(jp));
    ok('...and the project leaves the planner', !w.S.jobs.some(j => j.jobno === jobNo(X)));
    tab(w, 'jobs'); await sleep(50);
    const done = main(w).querySelector('[data-completed]');
    ok('Completed projects lists it', done && done.textContent.includes(jobNo(X)) && /Completed projects \(1\)/.test(done.textContent), done && done.textContent.slice(0, 120));

    // A live mismatch: Y is put On Hold in SharePoint after loading. Nothing is written.
    state.jobs = state.jobs.map(j => String(j.fields.id) === Y ? { ...j, fields: { ...j.fields, Status: 'On Hold' } } : j);
    net.patches.length = 0;
    const jy2 = w.S.jobs.find(j => j.jobno === jobNo(Y));
    w.fn('doSetPoolStatus')(jy2.id, 'Active', 'Complete'); await sleep(300);
    ok('a project no longer Active in SharePoint is not completed', net.patches.length === 0
      && /already On Hold/.test(w.document.getElementById('dBody').textContent));
    w.closeDrawer();

    // Reopen from Completed projects: one PATCH back to Active.
    net.patches.length = 0;
    w.fn('reopenProject')(jobNo(X)); await sleep(50);
    ok('Reopen asks first', /Reopen/.test(w.document.getElementById('dTitle').textContent));
    const re = [...w.document.querySelectorAll('#dFoot button')].find(b => /^Reopen/.test(b.textContent.trim()));
    re.click(); await sleep(900);
    const rp = net.patches.filter(p => p.url.includes('/lists/' + w.D2_GRAPH.lists.jobs + '/'));
    ok('Reopen sends one PATCH, Status Active, to that Jobs row', rp.length === 1 && rp[0].body.Status === 'Active' && rp[0].url.includes('/items/' + X + '/'), JSON.stringify(rp));
    ok('Mark complete and Reopen raised no script error', errs.length === 0, errs.join(' / '));
  }

  // ---------- Task 10: a completed project opened read-only ----------
  {
    const X = String(G.jobs[0].fields.id), noX = G.jobs[0].fields.JobNumber;
    const state = { jobs: jobsWith(X, 'Complete', '2026-10-02T15:00:00Z') };
    const { w, errs, net } = boot(state);
    await sleep(300); await refresh(w);
    ok('a completed project starts out of the planner', !w.S.jobs.some(j => j.jobno === noX));
    tab(w, 'jobs'); await sleep(50);
    const openBtn = [...main(w).querySelectorAll('[data-completed] button')].find(b => /^Open/.test(b.textContent.trim()));
    ok('Completed projects offers Open', !!openBtn);
    net.gets.length = 0;
    openBtn.click(); await sleep(900);
    const jx = w.S.jobs.find(j => j.jobno === noX);
    ok('Open loads that one project, read-only', jx && jx.readOnly === true && w.allSecs(jx).length === 46);
    ok('Open reads only that project\'s rows', net.gets.filter(u => listOf(w, u) === 'asg').every(u => decodeURIComponent(u).includes("JobLookupId eq '" + X + "'")));
    const m = main(w).textContent;
    ok('the Board says so', /Completed project, read only/.test(m));
    ok('no inline controls on it', w.allSecs(jx).every(x => !w.fn('inlineEditable')(jx, x.s)));
    const boxes = [...main(w).querySelectorAll('.sg input[type=checkbox]')].filter(b => (b.getAttribute('onchange') || '').includes("'" + jx.id + "'"));
    ok('its sign-off boxes are disabled', boxes.length > 0 && boxes.every(b => b.disabled), boxes.filter(b => !b.disabled).length + ' enabled of ' + boxes.length);
    const s0 = w.allSecs(jx)[1];
    const before = JSON.stringify({ inst: s0.s.inst, pm: s0.s.pm });
    w.sign(jx.id, s0.gi, s0.si, 'pm', !s0.s.pm); w.sign(jx.id, s0.gi, null, 'inst', !s0.s.inst);
    ok('sign() changes nothing on it', JSON.stringify({ inst: s0.s.inst, pm: s0.s.pm }) === before);
    w.editSec(jx.id, s0.gi, s0.si);
    ok('its sub-phase panel is read-only', /Completed project, read only/.test(w.document.getElementById('dBody').textContent)
      && !/Save/.test(w.document.getElementById('dFoot').textContent));
    w.closeDrawer();
    const snap = JSON.stringify(w.allSecs(jx).map(x => [x.s.crewId, x.s.start]));
    w.autoSchedule();
    ok('Auto-Schedule moves none of its rows', JSON.stringify(w.allSecs(jx).map(x => [x.s.crewId, x.s.start])) === snap);
    ok('it is in no change set, sign-off set or rejection set',
      !w.buildChangeSet().some(p => p.jobno === noX) && !w.buildSignoffSet().some(p => p.jobno === noX) && !w.buildRejectionSet().some(p => p.jobno === noX));
    ok('Schedule Check raises nothing for it', !w.conflicts().some(c => (c.jobs || []).includes(noX)));
    w.fn('setJob')(jx.id, 'name', 'Renamed');
    ok('its Jobs-tab fields cannot be edited', jx.name !== 'Renamed');
    await refresh(w);
    ok('the next Refresh puts it away again', !w.S.jobs.some(j => j.jobno === noX));
    ok('Open raised no script error', errs.length === 0, errs.join(' / '));
  }

  // ---------- Final-review fixes ----------
  // R1: Open, then Reopen. The reopened project must come back editable, not stay frozen.
  {
    const X = String(G.jobs[0].fields.id), noX = G.jobs[0].fields.JobNumber;
    const state = { jobs: jobsWith(X, 'Complete', '2026-10-02T15:00:00Z') };
    const { w } = boot(state);
    await sleep(300); await refresh(w);
    await w.fn('openCompleted')(noX); await sleep(600);
    ok('R1 setup: opened read-only', (w.S.jobs.find(j => j.jobno === noX) || {}).readOnly === true);
    const realFetch = w.fetch;
    w.fetch = (u, o) => { if (o && o.method === 'PATCH') state.jobs = jobsWith(X, 'Active'); return realFetch(u, o); };
    w.fn('reopenProject')(noX); await sleep(50);
    [...w.document.querySelectorAll('#dFoot button')].find(b => /^Reopen/.test(b.textContent.trim())).click(); await sleep(900);
    w.fetch = realFetch;
    const jx = w.S.jobs.find(j => j.jobno === noX);
    ok('R1: a reopened project comes back editable', jx && !jx.readOnly && w.allSecs(jx).some(x => w.fn('inlineEditable')(jx, x.s)));
  }

  // R2: Open with no Refresh since the page loaded must not silently overwrite unsaved edits.
  {
    const X = String(G.jobs[0].fields.id), noX = G.jobs[0].fields.JobNumber;
    const { w, net } = boot({ jobs: jobsWith(X, 'Complete', '2026-10-02T15:00:00Z') });
    await sleep(300); await refresh(w);
    const B = w.S.jobs[0];
    const sB = w.allSecs(B).find(x => x.s.base && !x.s.inst && !x.s.locked);
    sB.s.crewId = sB.s.crewId === 'devon' ? 'saul' : 'devon'; w.touch(B);
    w.fn('LAST_GRAPH=null');                       // as after a page reload
    net.gets.length = 0;
    await w.fn('openCompleted')(noX); await sleep(600);
    ok('R2: an unsaved edit elsewhere survives Open', w.divergedSecs(w.S.jobs.find(j => j.jobno === B.jobno)).length === 1);
    ok('R2: Open read only the opened project\'s Assignments',
      net.gets.filter(u => listOf(w, u) === 'asg').every(u => decodeURIComponent(u).includes("JobLookupId eq '" + X + "'")));
    ok('R2: and still opened it', (w.S.jobs.find(j => j.jobno === noX) || {}).readOnly === true);
  }

  // R3: a live project and a completed one sharing a job number.
  {
    const [a, b] = G.jobs;
    const twin = { ...b, fields: { ...b.fields, JobNumber: a.fields.JobNumber, Status: 'Complete', Modified: '2026-10-02T15:00:00Z' } };
    const { w } = boot({ jobs: [a, twin, G.jobs[2]] });
    await sleep(300); await refresh(w); await refresh(w);
    ok('R3: the live project with that number stays through Refresh', w.S.jobs.some(j => j.jobno === a.fields.JobNumber && !j.readOnly));
    await w.fn('openCompleted')(a.fields.JobNumber); await sleep(600);
    ok('R3: Open refuses rather than overlay the live project', !w.S.jobs.some(j => j.readOnly)
      && /already/.test(w.document.getElementById('dBody').textContent));
  }

  // R4: a sign-off rejected elsewhere after this browser loaded. Mark complete must re-check.
  // R5: unsaved edits on ANOTHER project also block it, since the Refresh after reloads everything.
  {
    const X = String(G.jobs[0].fields.id), noX = G.jobs[0].fields.JobNumber;
    const signed = G.asg.map(r => String(r.fields.JobLookupId) === X ? { ...r, fields: { ...r.fields, InstallerSignOff: true, NotApplicable: false } } : r);
    const state = { asg: signed };
    const { w, net } = boot(state);
    await sleep(300); await refresh(w);
    const jx = w.S.jobs.find(j => j.jobno === noX);
    const other = w.S.jobs.find(j => j.jobno !== noX);
    const so = w.allSecs(other).find(x => x.s.base && !x.s.inst && !x.s.locked);
    so.s.crewId = so.s.crewId === 'devon' ? 'saul' : 'devon'; w.touch(other);
    net.patches.length = 0;
    w.fn('completeProject')(jx.id); await sleep(50);
    ok('R5: an unsaved change on another project asks to Save first', /Save first/.test(w.document.getElementById('dBody').textContent) && net.patches.length === 0);
    w.closeDrawer();
    so.s.crewId = so.s.base.crewId; delete other.touchedAt;
    // Now SharePoint unsigns one of X's sub-phases (a rejection elsewhere).
    state.asg = signed.map((r, i) => String(r.fields.JobLookupId) === X && r === signed.find(q => String(q.fields.JobLookupId) === X) ? { ...r, fields: { ...r.fields, InstallerSignOff: false } } : r);
    w.fn('completeProject')(jx.id); await sleep(50);
    [...w.document.querySelectorAll('#dFoot button')].find(b => /Mark complete/.test(b.textContent)).click(); await sleep(600);
    ok('R4: a sub-phase unsigned in SharePoint since loading stops Mark complete', net.patches.length === 0
      && /not signed off/.test(w.document.getElementById('dBody').textContent), w.document.getElementById('dBody').textContent.slice(0, 160));
  }

  // R6: the Tasks or-chain never exceeds the 46 terms proven against Graph.
  {
    const M = require(path.join(WEB, 'graph-to-planner.js'));
    ok('R6: the proven chain length is exported', M.TASK_CHAIN_MAX === 46);
    const asg = Array.from({ length: 60 }, (_, i) => ({ fields: { id: String(9000 + i), JobLookupId: '1' } }));
    const urls = [];
    await M.readLive({ jobs: [{ id: '1' }], asgItems: 'A', taskItems: 'T', pageAll: async u => { urls.push(u); return u.startsWith('A') ? asg : []; } });
    const chains = urls.filter(u => u.startsWith('T')).map(u => (decodeURIComponent(u).match(/AssignmentLookupId/g) || []).length);
    ok('R6: 60 assignments are read in chains of at most 46', chains.length === 2 && Math.max(...chains) <= 46, chains.join(','));
  }

  // R7: one throttled read is retried, not fatal to the whole Refresh.
  {
    const { w, errs } = boot({ throttleOnce: '/lists/' + '49ef7006-d3fe-40a7-a52f-c4c18545bd35' + '/items' });
    await sleep(300); await refresh(w); await sleep(300);
    ok('R7: a 429 on one read is retried and the Refresh completes', w.S.jobs.length === G.jobs.length
      && w.S.jobs.every(j => w.allSecs(j).filter(x => x.s.base).length === 46), w.S.jobs.length + ' projects');
    ok('R7: no error left behind', errs.length === 0 && !/couldn|failed/i.test((w.document.getElementById('dBody') || {}).textContent || ''));
  }

  process.exit(fail);
})().catch(e => { console.log('FAIL · harness threw: ' + (e && e.stack || e)); process.exit(1); });
