// fixtures/planner/build-type.js   Run: node fixtures/planner/build-type.js
// Build type on + Job, through Save, into the New Pool Requests body; the chosen PM reaches the body too.
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const WEB = path.join(__dirname, '..', '..', 'web');
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-payloads-graph.json'), 'utf8'));
const HOST = 'https://mango-sky-0d6904310.5.azurestaticapps.net';
let fails = 0;
const ok = (l, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) { fails++; process.exitCode = 1; } };
const UIL = [{ id: '14', Title: 'Cody Campbell', Name: 'i:0#.f|membership|cody@d2pools.com', EMail: 'cody@d2pools.com' },
             { id: '16', Title: 'Don Borgeson', Name: 'i:0#.f|membership|don@d2pools.com', EMail: 'don@d2pools.com' }].map(f => ({ id: f.id, fields: f }));
const MSAL_STUB = `<script>window.msal={PublicClientApplication:class{constructor(){} getActiveAccount(){return {username:'cody@d2pools.com'};} setActiveAccount(){} getAllAccounts(){return [{username:'cody@d2pools.com'}];} acquireTokenSilent(){return Promise.resolve({accessToken:'t'});} loginPopup(){return Promise.resolve({accessToken:'t',account:{username:'cody@d2pools.com'}});}}};</script>`;
function boot() {
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL_STUB)
    .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
    .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
    .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
    .replace('</body>', `<script>window.__x=()=>{window.S=S;window.getUI=()=>UI;window.D2_GRAPH=D2_GRAPH;window.addJob=addJob;
      window.confirmNewPoolRequest=confirmNewPoolRequest;window.buildPendingCreates=buildPendingCreates;window.pushCreates=pushCreates;
      window.render=render;window.refreshLive=refreshLive;window.importFromD2Payload=importFromD2Payload;window.save=save;window.load=load;
      window.templateFor=typeof templateFor==='function'?templateFor:null;window.jobBadge=jobBadge;window.mkTemplate=mkTemplate;};</script><script>__x();</script></body>`);
  const errs = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const net = { posts: [] };
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, opts) => {
        u = String(u);
        const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
        if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
        if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: G.siteId, webUrl: G.site });
        if (u.includes('User Information List')) return json(200, { value: UIL });
        if (opts && opts.method === 'POST') { net.posts.push({ url: u, body: JSON.parse(opts.body) }); return json(201, { fields: { id: '900' } }); }
        const L = w.D2_GRAPH && w.D2_GRAPH.lists;
        if (L) for (const k of Object.keys(L)) if (u.includes('/lists/' + L[k] + '/items')) return json(200, { value: G[k] || [] });
        if (/\/lists\/[^/]+\/items/.test(u)) return json(200, { value: [] });
        return json(404, {});
      };
    } });
  const w = dom.window; const alerts = []; w.alert = m => alerts.push(String(m)); w.confirm = () => true;
  return { w, errs, net, alerts };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const { w, errs, net } = boot(); await wait(600);
  await w.refreshLive(true); await wait(300);
  // ---- + Job carries the type
  w.addJob();
  const radios = [...w.document.querySelectorAll('input[name=ncType]')];
  ok('+ Job offers Gunite and Fiberglass, Gunite preselected', radios.map(r => r.value).join() === 'Gunite,Fiberglass' && radios[0].checked);
  ok('the form copy no longer hard-codes 46 and 295', !/46 sub-phases|295 tasks/.test(w.document.getElementById('dBody').textContent));
  radios[1].checked = true; radios[1].dispatchEvent(new w.Event('change'));
  ok('the copy follows the choice', /Fiberglass/.test(w.document.getElementById('dBody').textContent));
  w.document.getElementById('ncJobNo').value = 'TEST-9950'; w.document.getElementById('ncName').value = 'Fibre Test';
  const pm = w.document.getElementById('ncPm'); if (pm) pm.value = '16';
  w.confirmNewPoolRequest();
  const pc = w.S.pendingCreates.find(c => c.jobno === 'TEST-9950');
  ok('the pending entry carries Fiberglass', pc && pc.buildType === 'Fiberglass');
  ok('the pending card shows the type', /Fiberglass/.test(w.document.getElementById('main').textContent));
  const built = w.buildPendingCreates().find(c => c.jobno === 'TEST-9950');
  ok('buildPendingCreates keeps buildType', built && built.buildType === 'Fiberglass');
  ok('buildPendingCreates keeps the chosen PM (fixed in passing)', built && built.pmId === '16' && built.pmName === 'Don Borgeson');
  // ---- through the core and the Graph body
  const C = require(path.join(WEB, 'writeback-core.js')), GW = require(path.join(WEB, 'graph-writeback.js'));
  const planned = C.planCreates([built, { jobno: 'TEST-9951', name: 'Old build', start: '2026-11-02' }], [], []).creates;
  ok('planCreates keeps Fiberglass and defaults a missing type to Gunite', planned[0].buildType === 'Fiberglass' && planned[1].buildType === 'Gunite');
  ok('planCreates normalises an unknown type to Gunite', C.planCreates([{ jobno: 'X', name: 'X', start: '2026-11-02', buildType: 'Carbon' }], [], []).creates[0].buildType === 'Gunite');
  ok('createBody sends BuildType', GW.createBody(planned[0], '16').BuildType === 'Fiberglass' && GW.createBody(planned[1], '16').BuildType === 'Gunite');
  await w.pushCreates(G.siteId, 't', w.buildPendingCreates());
  const post = net.posts.find(p => p.body && p.body.fields && p.body.fields.JobNumber === 'TEST-9950');
  ok('the New Pool Requests POST carries BuildType and the chosen PM', post && post.body.fields.BuildType === 'Fiberglass' && post.body.fields.ProjectManagerLookupId === '16');
  ok('no page errors', errs.length === 0, errs.join(' | '));
  process.exit(fails ? 1 : 0);
})();
