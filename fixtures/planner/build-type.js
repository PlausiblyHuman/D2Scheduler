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
    .replace('</body>', `<script>window.__x=()=>{Object.defineProperty(window,'S',{get:()=>S,configurable:true});window.getUI=()=>UI;window.D2_GRAPH=D2_GRAPH;window.addJob=addJob;
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
  // ---- the copy with templates loaded (tplCounts non-null branch)
  const copyOf = id => (w.document.getElementById(id) || { textContent: '' }).textContent;
  w.S.templates = { Gunite: w.mkTemplate(), Fiberglass: [{ num: '0', name: 'x', sections: [{ num: '0.0', name: 'a', skill: null, days: 2, tasks: ['t1', 't2'] }] }] };
  w.addJob();
  ok('with templates loaded the Gunite copy carries 46 sub-phases and 295 tasks', /46 sub-phases and 295 tasks/.test(copyOf('ncTypeCopy')), copyOf('ncTypeCopy'));
  const fr = w.document.querySelectorAll('input[name=ncType]')[1]; fr.checked = true; fr.dispatchEvent(new w.Event('change'));
  ok('switching to Fiberglass shows the template counts', /1 sub-phases and 2 tasks/.test(copyOf('ncTypeCopy')) && /Fiberglass/.test(copyOf('ncTypeCopy')), copyOf('ncTypeCopy'));
  ok('the unassigned copy follows the choice', /Unchecked leaves all 1 sub-phases/.test(copyOf('ncUnassignedCopy')), copyOf('ncUnassignedCopy'));
  delete w.S.templates;
  // ---- + Job carries the type
  w.addJob();
  const radios = [...w.document.querySelectorAll('input[name=ncType]')];
  ok('+ Job offers Gunite and Fiberglass, Gunite preselected', radios.map(r => r.value).join() === 'Gunite,Fiberglass' && radios[0].checked);
  ok('the form copy no longer hard-codes 46 and 295', !/46 sub-phases|295 tasks/.test(w.document.getElementById('dBody').textContent));
  ok('the copy before the change names Gunite, not Fiberglass', /Gunite/.test(copyOf('ncTypeCopy')) && !/Fiberglass/.test(copyOf('ncTypeCopy')), copyOf('ncTypeCopy'));
  radios[1].checked = true; radios[1].dispatchEvent(new w.Event('change'));
  ok('the copy follows the choice', /Fiberglass/.test(copyOf('ncTypeCopy')), copyOf('ncTypeCopy'));
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

  // ---- templates from SharePoint, layout by type, chip, migration, fallback
  {
    const { w, alerts, errs } = boot(); await wait(600);
    ok('a never-refreshed browser has the built-in Gunite template and nothing else', w.templateFor('Gunite').length > 0 && w.templateFor('Fiberglass').length === 0 && !w.S.template);
    await w.refreshLive(true); await wait(300);
    ok('Refresh stores both templates and the time', w.S.templates && w.S.templates.Gunite && w.S.templates.Fiberglass && typeof w.S.templatesFrom === 'string');
    ok('live jobs carry buildType Gunite', w.S.jobs.length > 0 && w.S.jobs.every(j => j.buildType === 'Gunite'));
    const F = w.S.templates.Fiberglass;
    const fsecs = F.flatMap(p => p.sections);
    const fibJob = { id: 999, jobno: 'TEST-9901', name: 'Fibre', addr: '', city: '', start: '2026-11-02', status: 'Planned', buildType: 'Fiberglass', pm: '', pmId: null,
      sections: fsecs.map((s, i) => ({ id: 5000 + i, seq: i + 1, num: s.num, name: s.name, crewId: null, start: null, finish: null, days: 2, skip: false, locked: false, inst: false, pm: false, tasks: s.tasks.map((t, k) => ({ id: 9000 + i * 20 + k, seq: k + 1, title: t, done: false, na: false, note: '' })) })) };
    const base = w.D2GraphToPlanner.toPlannerPayload(Object.assign({}, G, { users: [] }));
    alerts.length = 0;
    w.importFromD2Payload(Object.assign({}, base, { jobs: base.jobs.concat([fibJob]) }), true);
    const fj = w.S.jobs.find(j => j.jobno === 'TEST-9901');
    ok('the Fiberglass project exists with its type', fj && fj.buildType === 'Fiberglass');
    ok('it is laid out from the Fiberglass template: 45 sub-phases including 2.3', fj && fj.groups.flatMap(g => g.sections).length === 45 && fj.groups.flatMap(g => g.sections).some(s => s.num === '2.3'));
    ok('no unmatched alert for it', !alerts.some(a => /matched nothing/.test(a)), alerts.join(' | '));
    ok('a Gunite job is still 46', w.S.jobs.find(j => j.buildType === 'Gunite').groups.flatMap(g => g.sections).length === 46);
    ok('jobBadge draws a Fiberglass chip only for Fiberglass', /Fiberglass/.test(w.jobBadge(fj)) && !/Fiberglass/.test(w.jobBadge(w.S.jobs.find(j => j.buildType === 'Gunite'))));
    w.document.querySelector('#tabs button[data-t="crews"]').click();
    ok('Skill Coverage lists sub-phases from both templates, labelled', /Gunite:.*Fiberglass:/s.test(w.document.getElementById('main').textContent));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  }
  {
    const { w, alerts, errs } = boot(); await wait(600);
    const old = { kind: 'd2-sharepoint-export', exported: '2026-10-01', jobs: [{ jobno: 'TEST-9901', name: 'Fibre', start: '2026-11-02', status: 'Planned', buildType: 'Fiberglass', sections: [{ num: '2.3', name: 'Crane Set and Shell Placement', crewId: null, start: null, days: 2, tasks: [] }] }] };
    alerts.length = 0; let threw = null;
    try { w.importFromD2Payload(old, true); } catch (e) { threw = e; }
    ok('an export without templates does not throw', !threw, threw && threw.message);
    const fj = w.S.jobs.find(j => j.jobno === 'TEST-9901');
    ok('the Fiberglass job has no Gunite layout and its section is reported unmatched', fj && fj.groups.length === 0 && alerts.some(a => /matched nothing/.test(a)));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  }
  {
    const { w } = boot(); await wait(600);
    const T = w.mkTemplate(); T[0].name = 'Edited locally';
    w.localStorage.setItem('poolsched.v6', JSON.stringify({ crews: [], template: T, jobs: [], settings: {}, pendingCreates: [], pendingComments: [] }));
    w.load();
    ok('a stored S.template becomes S.templates.Gunite and S.template is gone', w.S.templates && w.S.templates.Gunite && w.S.templates.Gunite[0].name === 'Edited locally' && !('template' in w.S));
  }
  process.exit(fails ? 1 : 0);
})();
