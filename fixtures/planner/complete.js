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
            const want = ids(/JobLookupId eq '?(\d+)'?/g);
            return json(200, { value: state.ignoreFilters || !want.length ? G.asg : G.asg.filter(a => want.includes(String(a.fields.JobLookupId))) });
          }
          if (u.includes('/lists/' + L.tasks + '/items')) {
            const want = ids(/AssignmentLookupId eq '?(\d+)'?/g);
            return json(200, { value: state.ignoreFilters || !want.length ? G.tasks : G.tasks.filter(t => want.includes(String(t.fields.AssignmentLookupId))) });
          }
          if (u.includes('/lists/' + L.cal + '/items')) return json(200, { value: G.cal });
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

  process.exit(fail);
})().catch(e => { console.log('FAIL · harness threw: ' + (e && e.stack || e)); process.exit(1); });
