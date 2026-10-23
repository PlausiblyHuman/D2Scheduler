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
function boot(opts) {
  opts = opts || {};
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', opts.noMsal ? '' : MSAL_STUB)
    .replace('<script src="features-core.js"></script>', opts.noFeatures ? '' : inline('features-core.js'))
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
    // re-layout: a Gunite-laid Fiberglass project is rebuilt on the next import
    {
      const j2 = w.S.jobs.find(j => j.jobno === 'TEST-9901');
      j2.groups = w.mkJobGroups(w.templateFor('Gunite')); j2.buildType = 'Gunite';
      alerts.length = 0;
      w.importFromD2Payload(Object.assign({}, base, { jobs: base.jobs.concat([fibJob]) }), true);
      const rj = w.S.jobs.find(j => j.jobno === 'TEST-9901');
      ok('a Fiberglass project laid out from Gunite is rebuilt: 45 sub-phases including 2.3', rj.buildType === 'Fiberglass' && rj.groups.flatMap(g => g.sections).length === 45 && rj.groups.flatMap(g => g.sections).some(s => s.num === '2.3'));
      ok('no unmatched alert after the re-layout', !alerts.some(a => /matched nothing/.test(a)), alerts.join(' | '));
      rj.groups = [];
      alerts.length = 0;
      w.importFromD2Payload(Object.assign({}, base, { jobs: base.jobs.concat([fibJob]) }), true);
      const ej = w.S.jobs.find(j => j.jobno === 'TEST-9901');
      ok('a Fiberglass project with an empty layout gets 45 sub-phases', ej.groups.flatMap(g => g.sections).length === 45);
    }
    ok('no page errors', errs.length === 0, errs.join(' | '));
  }
  {
    const { w, alerts, errs } = boot(); await wait(600);
    const old = { kind: 'd2-sharepoint-export', exported: '2026-10-01', jobs: [{ jobno: 'TEST-9901', name: 'Fibre', start: '2026-11-02', status: 'Planned', buildType: 'Fiberglass', sections: [{ num: '2.3', name: 'Crane Set and Shell Placement', crewId: null, start: null, days: 2, tasks: [] }] }] };
    alerts.length = 0; let threw = null;
    try { w.importFromD2Payload(old, true); } catch (e) { threw = e; }
    ok('an export without templates does not throw', !threw, threw && threw.message);
    const fj = w.S.jobs.find(j => j.jobno === 'TEST-9901');
    // Since 2026-10-21 a project lays out from its own rows: no template needed, nothing unmatched.
    const fs = fj ? fj.groups.flatMap(g => g.sections) : [];
    ok('the Fiberglass job lays out from its own row, not the Gunite template', fs.length === 1 && fs[0].num === '2.3' && fs[0].name === 'Crane Set and Shell Placement', fs.map(s => s.num).join(','));
    ok('and raises no unmatched alert', !alerts.some(a => /matched nothing/.test(a)), alerts.join(' | '));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  }
  {
    const { w } = boot(); await wait(600);
    const T = w.mkTemplate(); T[0].name = 'Edited locally';
    w.localStorage.setItem('poolsched.v6', JSON.stringify({ crews: [], template: T, jobs: [], settings: {}, pendingCreates: [], pendingComments: [] }));
    w.load();
    ok('a stored S.template is discarded, not migrated', !('template' in w.S) && !(w.S.templates && w.S.templates.Gunite));
    ok('templateFor(Gunite) is the built-in after the discard', w.templateFor('Gunite')[0].name === w.mkTemplate()[0].name && w.templateFor('Gunite')[0].name !== 'Edited locally');
    w.document.querySelector('#tabs button[data-t="phases"]').click();
    const txt = w.document.getElementById('main').textContent;
    ok('the phases tab says Built-in copy and never Invalid Date', /Built-in copy/.test(txt) && !/Invalid Date/.test(txt));
    w.S.templates = { Gunite: w.mkTemplate() }; delete w.S.templatesFrom; w.render();
    const txt2 = w.document.getElementById('main').textContent;
    ok('a template without a timestamp is not labelled as from SharePoint', /Built-in copy/.test(txt2) && !/From SharePoint/.test(txt2));
  }
  // ---- Phase Template tab: read-only, switch, hints
  {
    const { w, errs } = boot(); await wait(600);
    const phases = () => { w.document.querySelector('#tabs button[data-t="phases"]').click(); return w.document.getElementById('main'); };
    let m = phases();
    ok('before any Refresh the tab shows the built-in Gunite copy and says so', /Built-in copy of the Gunite template/.test(m.textContent) && m.querySelectorAll('tbody tr').length === 46 + 8);
    ok('the tab has no inputs, selects or edit buttons', m.querySelectorAll('input,select').length === 0 && !/Set all durations|Apply template|\+ Phase|\+ Sub/.test(m.textContent));
    for (const fn of ['setGrp','setSec','moveSec','delSec','delGrp','addSection','addPhase','setAllDays','applyTemplate']) ok(fn + ' is gone', typeof w[fn] === 'undefined' && !new RegExp('function ' + fn + '\\(').test(fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')));
    await w.refreshLive(true); await wait(300);
    m = phases();
    ok('after Refresh the hint says from SharePoint and when', /From SharePoint, as of/.test(m.textContent));
    const btn = [...m.querySelectorAll('button')].find(b => b.textContent.trim() === 'Fiberglass');
    ok('a Fiberglass switch exists', !!btn);
    btn.click(); m = w.document.getElementById('main');
    ok('switching shows the 45 Fiberglass sub-phases under 10 phases', m.querySelectorAll('tbody tr').length === 45 + 10 && /Crane Set and Shell Placement/.test(m.textContent));
    ok('the switch is remembered until reload', w.getUI().tplType === 'Fiberglass');
    ok('no page errors', errs.length === 0, errs.join(' | '));
  }
  // ---- optional features on + Job (Task 8)
  {
    const mk = (id, num, name, extra) => Object.assign({ id, num, name, skill: null, days: 2, tasks: ['t'], optional: false, feature: null, taskFeature: [null], seq: id, taskSeq: [1] }, extra || {});
    const FEATS = () => ({
      Gunite: [{ num: '1', name: 'p', sections: [
        mk(1, '1.1', 'Plain'),
        mk(2, '1.2', 'Cover install', { optional: true, feature: 'Auto Cover', tasks: ['a', 'b'], taskFeature: [null, 'Auto Cover'] }),
        mk(3, '1.3', 'Spa A', { optional: true, feature: 'Spa <i>"Falls"</i>' }),
        mk(4, '1.4', 'Spa B', { optional: true, feature: 'spa <i>"falls"</i>' })] }],
      Fiberglass: [{ num: '1', name: 'p', sections: [mk(10, '1.1', 'Plain')] }] });
    const { w, errs, net } = boot(); await wait(600);
    await w.refreshLive(true); await wait(300);
    w.S.templates = FEATS();
    w.addJob();
    const fs8 = () => w.document.getElementById('ncFeatures');
    const boxes = () => [...w.document.querySelectorAll('#ncFeatures input[type=checkbox]')];
    ok('+ Job renders a features fieldset with one unticked box per feature', fs8() && boxes().length === 2 && boxes().every(b => !b.checked), boxes().length);
    const txt = fs8().textContent;
    ok('each box is labelled with its name and coverage', /Auto Cover.*1 sub-phase, 1 task/s.test(txt) && /Spa <i>.*2 sub-phases/s.test(txt) && !/2 sub-phases, 0/.test(txt), txt);
    ok('a feature name is escaped when painted', fs8().querySelector('i') === null && boxes().some(b => b.value === 'Spa <i>"Falls"</i>'));
    const fr8 = w.document.querySelectorAll('input[name=ncType]')[1]; fr8.checked = true; fr8.dispatchEvent(new w.Event('change'));
    ok('Fiberglass without features says so', /No optional features in the Fiberglass template yet/.test(fs8().textContent) && boxes().length === 0, fs8().textContent);
    const gn = w.document.querySelectorAll('input[name=ncType]')[0]; gn.checked = true; gn.dispatchEvent(new w.Event('change'));
    ok('switching back shows the Gunite features again', boxes().length === 2);
    const ac = boxes().find(b => /Auto Cover/.test(b.parentNode.textContent)); ac.checked = true;
    w.document.getElementById('ncJobNo').value = 'TEST-9960'; w.document.getElementById('ncName').value = 'Feat Test';
    w.document.getElementById('ncPm').value = '16';
    w.confirmNewPoolRequest();
    const pcf = w.S.pendingCreates.find(c => c.jobno === 'TEST-9960');
    ok('the pending create carries the picked features', pcf && JSON.stringify(pcf.features) === '["Auto Cover"]', pcf && JSON.stringify(pcf.features));
    ok('the pending card shows the picked features', /Auto Cover/.test(w.document.getElementById('main').textContent));
    const bf = w.buildPendingCreates().find(c => c.jobno === 'TEST-9960');
    ok('buildPendingCreates carries features', bf && JSON.stringify(bf.features) === '["Auto Cover"]');
    const C8 = require(path.join(WEB, 'writeback-core.js')), GW8 = require(path.join(WEB, 'graph-writeback.js'));
    const pl = C8.planCreates([bf, Object.assign({}, bf, { jobno: 'TEST-9961', features: [' Auto Cover ', 'auto cover', '', 'Spa'] }), { jobno: 'TEST-9962', name: 'n', start: '2026-11-02' }], [], []).creates;
    ok('planCreates carries features', JSON.stringify(pl[0].features) === '["Auto Cover"]', JSON.stringify(pl[0].features));
    ok('planCreates trims, drops blanks and de-duplicates by feature key', JSON.stringify(pl[1].features) === '["Auto Cover","Spa"]', JSON.stringify(pl[1].features));
    ok('planCreates gives a missing list as empty', JSON.stringify(pl[2].features) === '[]');
    ok('createBody sends Features joined by a semicolon', GW8.createBody(pl[1], '16').Features === 'Auto Cover;Spa');
    ok('createBody omits Features when none are picked', !('Features' in GW8.createBody(pl[2], '16')));
    await w.pushCreates(G.siteId, 't', w.buildPendingCreates());
    const post8 = net.posts.find(p => p.body && p.body.fields && p.body.fields.JobNumber === 'TEST-9960');
    ok('the New Pool Requests POST carries Features', post8 && post8.body.fields.Features === 'Auto Cover', post8 && JSON.stringify(post8.body.fields));
    w.addJob(); w.document.getElementById('ncJobNo').value = 'TEST-9963'; w.document.getElementById('ncName').value = 'No Feat';
    w.confirmNewPoolRequest();
    await w.pushCreates(G.siteId, 't', w.buildPendingCreates().filter(c => c.jobno === 'TEST-9963'));
    const post9 = net.posts.find(p => p.body && p.body.fields && p.body.fields.JobNumber === 'TEST-9963');
    ok('no picks sends no Features key', post9 && !('Features' in post9.body.fields));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  }
  {
    const { w, errs } = boot({ noMsal: true }); await wait(600);
    w.S.templates = { Gunite: [{ num: '1', name: 'p', sections: [{ id: 2, num: '1.2', name: 'C', optional: true, feature: 'Auto Cover', tasks: [], taskFeature: [] }] }] };
    w.addJob();
    const el = w.document.getElementById('ncFeatures');
    ok('file mode shows only the hosted-planner sentence', el && /Features can be picked in the hosted planner/.test(el.textContent) && el.querySelectorAll('input').length === 0, el && el.textContent);
    w.document.getElementById('ncJobNo').value = 'TEST-9964'; w.document.getElementById('ncName').value = 'File';
    w.confirmNewPoolRequest();
    const pf = w.S.pendingCreates.find(c => c.jobno === 'TEST-9964');
    ok('file mode queues features: []', pf && Array.isArray(pf.features) && pf.features.length === 0);
    ok('no page errors', errs.length === 0, errs.join(' | '));
  }
  {
    // features-core.js failed to load: + Job still works, with no features fieldset.
    const { w, errs } = boot({ noFeatures: true }); await wait(600);
    await w.refreshLive(true); await wait(300);
    let threw = null;
    try {
      w.addJob();
      const fr = w.document.querySelectorAll('input[name=ncType]')[1]; fr.checked = true; fr.dispatchEvent(new w.Event('change'));
      w.document.getElementById('ncJobNo').value = 'TEST-9965'; w.document.getElementById('ncName').value = 'No module';
      w.confirmNewPoolRequest();
    } catch (e) { threw = e; }
    ok('without the features module + Job opens and queues', !threw && !!w.S.pendingCreates.find(c => c.jobno === 'TEST-9965'), threw && threw.message);
    ok('and shows no features fieldset', !w.document.getElementById('ncFeatures'));
    const pc = w.S.pendingCreates.find(c => c.jobno === 'TEST-9965');
    ok('and queues no features', !!pc && Array.isArray(pc.features) && pc.features.length === 0);
    ok('no page errors', errs.length === 0, errs.join(' | '));
  }
  process.exit(fails ? 1 : 0);
})();
