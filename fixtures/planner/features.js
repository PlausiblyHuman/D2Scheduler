// fixtures/planner/features.js   Run: node fixtures/planner/features.js
// Step 4 features: single-project refresh (Task 9). Stubbed Graph with a mutable store.
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const WEB = path.join(__dirname, '..', '..', 'web');
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-payloads-graph.json'), 'utf8'));
const HOST = 'https://mango-sky-0d6904310.5.azurestaticapps.net';
let fails = 0;
const ok = (l, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) { fails++; process.exitCode = 1; } };
const UIL = [{ id: '14', Title: 'Cody Campbell', Name: 'i:0#.f|membership|cody@d2pools.com', EMail: 'cody@d2pools.com' }].map(f => ({ id: f.id, fields: f }));
const MSAL_STUB = `<script>window.msal={PublicClientApplication:class{constructor(){} getActiveAccount(){return {username:'cody@d2pools.com'};} setActiveAccount(){} getAllAccounts(){return [{username:'cody@d2pools.com'}];} acquireTokenSilent(){return Promise.resolve({accessToken:'t'});} loginPopup(){return Promise.resolve({accessToken:'t',account:{username:'cody@d2pools.com'}});}}};</script>`;
const clone = o => JSON.parse(JSON.stringify(o));
function boot() {
  const store = { jobs: clone(G.jobs), asg: clone(G.asg), tasks: clone(G.tasks), comments: [], req: [], failTasks: false, log: [] };
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL_STUB)
    .replace('<script src="features-core.js"></script>', inline('features-core.js'))
    .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
    .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
    .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
    .replace('</body>', `<script>window.__x=()=>{Object.defineProperty(window,'S',{get:()=>S,configurable:true});window.D2_GRAPH=D2_GRAPH;
      window.refreshLive=refreshLive;window.refreshOneProject=refreshOneProject;window.allSecs=allSecs;};</script><script>__x();</script></body>`);
  const errs = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, opts) => {
        u = String(u); store.log.push(u);
        const json = (status, body) => Promise.resolve({ ok: status < 300, status, headers: { get: () => null }, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
        if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
        if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: G.siteId, webUrl: G.site });
        if (u.includes('User Information List')) return json(200, { value: UIL });
        const L = w.D2_GRAPH.lists, dec = decodeURIComponent(u);
        const one = u.match(new RegExp('/lists/' + L.jobs + '/items/([^/?]+)\\?'));
        if (one) { const r = store.jobs.find(j => j.fields.id === one[1]); return r ? json(200, r) : json(404, {}); }
        if (u.includes('/lists/' + L.asg + '/items')) {
          const m = dec.match(/JobLookupId eq '(\d+)'/);
          return json(200, { value: store.asg.filter(a => !m || a.fields.JobLookupId === m[1]) });
        }
        if (u.includes('/lists/' + L.tasks + '/items')) {
          if (store.failTasks) return json(500, {});
          const ids = [...dec.matchAll(/AssignmentLookupId eq '(\d+)'/g)].map(x => x[1]);
          return json(200, { value: store.tasks.filter(t => !ids.length || ids.includes(t.fields.AssignmentLookupId)) });
        }
        if (u.includes('/lists/' + w.D2_GRAPH.commentsList + '/items')) return json(200, { value: store.comments });
        if (u.includes('/lists/' + L.jobs + '/items')) return json(200, { value: store.jobs });
        if (u.includes('/lists/' + L.cal + '/items')) return json(200, { value: G.cal });
        if (u.includes('/lists/' + L.req + '/items')) return json(200, { value: store.req });
        for (const k of ['spt', 'tpt', 'trades']) if (u.includes('/lists/' + L[k] + '/items')) return json(200, { value: G[k] || [] });
        return json(404, {});
      };
    } });
  const w = dom.window; let confirms = 0; w.alert = () => {}; w.confirm = () => { confirms++; return true; };
  return { w, errs, store, confirms: () => confirms };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const { w, errs, store, confirms } = boot(); await wait(600);
  await w.refreshLive(true); await wait(300);
  const A = w.S.jobs.find(j => j.spId === '20'), B = w.S.jobs.find(j => j.spId === '21');
  ok('two projects loaded with their SharePoint ids', !!A && !!B && A !== B);
  const nA = w.allSecs(A).length, snap = { B, Bgroups: B.groups, tpl: w.S.templates, loadedAt: w.S.settings.loadedAt, nonWork: w.S.settings.nonWork };
  const Bjson = JSON.stringify(B);
  // SharePoint gains a sub-phase, a task and a comment for A.
  const tmpl = store.asg.find(a => a.fields.JobLookupId === '20');
  const na = clone(tmpl); Object.assign(na.fields, { id: '9001', Title: 'D2-1042 · 9.9 Added', SubPhaseNumber: '9.9', SubPhaseName: 'Added', Sequence: 999, InstallerSignOff: false, PMSignOff: false, TasksTotal: 1, TasksComplete: 0 });
  store.asg.push(na);
  const nt = clone(store.tasks[0]); Object.assign(nt.fields, { id: '9101', Title: 'Added task', AssignmentLookupId: '9001', Sequence: 1, Complete: false, NotApplicable: false });
  store.tasks.push(nt);
  store.comments.push({ id: 'c1', createdDateTime: '2026-10-22T10:00:00Z', createdBy: { user: { displayName: 'Cody' } }, fields: { id: 'c1', AssignmentLookupId: tmpl.fields.id, Kind: 'Comment', Body: 'keep me' } });
  A.touchedAt = 'x'; const c0 = confirms(), r = await w.refreshOneProject(A);
  ok('refreshOneProject returns true', r === true);
  const added = w.allSecs(A).map(x => x.s).find(s => (s.tasks || []).some(t => String(t.spId) === '9101'));
  ok('the new sub-phase appears with its task row id', !!added && w.allSecs(A).length === nA + 1, 'sections ' + w.allSecs(A).length);
  ok('the new sub-phase carries its own SharePoint row id', !!added && added.base && String(added.base.id) === '9001');
  const thr = w.allSecs(A).map(x => x.s).find(s => (s.thread || []).some(t => t.body === 'keep me'));
  ok('comment threads survive the single-project read', !!thr);
  ok('project B is untouched (same object, same content)', w.S.jobs.includes(B) && B === snap.B && B.groups === snap.Bgroups && JSON.stringify(B) === Bjson);
  ok('templates are the same object', w.S.templates === snap.tpl);
  ok('the header refresh stamp and work calendar are untouched', w.S.settings.loadedAt === snap.loadedAt && w.S.settings.nonWork === snap.nonWork);
  ok('the unsaved-edit mark on the project is cleared by the re-read', A.touchedAt === undefined);
  ok('no confirm was shown', confirms() === c0);
  ok('A kept its identity in the list', w.S.jobs.filter(j => j.spId === '20').length === 1 && w.S.jobs.includes(A));
  // building flag follows New Pool Requests
  store.req.push({ id: 'r1', fields: { id: '1', JobNumber: ' ' + A.jobno.toUpperCase(), Status: 'Building' } });
  await w.refreshOneProject(A);
  ok('the building flag follows New Pool Requests', A.building === true);
  store.req.length = 0; await w.refreshOneProject(A);
  ok('and clears when the request is done', A.building === false);
  // failure leaves A as it was
  const before = JSON.stringify(A), nBefore = w.allSecs(A).length;
  const na2 = clone(na); na2.fields.id = '9002'; na2.fields.SubPhaseNumber = '9.8'; store.asg.push(na2);
  store.failTasks = true;
  const rf = await w.refreshOneProject(A);
  ok('a failed Tasks read returns false', rf === false);
  ok('and lastError is an Error carrying the status', w.refreshOneProject.lastError instanceof w.Error && w.refreshOneProject.lastError.status === 500, String(w.refreshOneProject.lastError));
  ok('and leaves the project exactly as it was', JSON.stringify(A) === before && w.allSecs(A).length === nBefore);
  store.failTasks = false; const keepJobs = store.jobs; store.jobs = [];
  ok('a missing Jobs row returns false', (await w.refreshOneProject(A)) === false);
  ok('and says the project is no longer in SharePoint', /no longer in SharePoint/.test(String(w.refreshOneProject.lastError && w.refreshOneProject.lastError.message)), String(w.refreshOneProject.lastError));
  store.jobs = keepJobs;
  ok('a success clears lastError', (await w.refreshOneProject(A)) === true && w.refreshOneProject.lastError === null);
  ok('a project with no SharePoint id returns false', (await w.refreshOneProject({ jobno: 'X' })) === false);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  console.log(fails ? fails + ' failed' : 'all passed');
})();
