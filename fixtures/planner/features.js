// fixtures/planner/features.js   Run: node fixtures/planner/features.js
// Step 4 features: single-project refresh (Task 9) and the Features drawer (Task 10).
// Stubbed Graph with a mutable store that also takes the drawer's creates (POST).
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
function boot(data, stored) {
  const d = data || G;
  const store = { jobs: clone(d.jobs), asg: clone(d.asg), tasks: clone(d.tasks), spt: clone(d.spt || []), tpt: clone(d.tpt || []), trades: clone(d.trades || []),
    comments: [], req: [], failTasks: false, log: [], posts: [], nextId: 7000,
    failAsg: false, asgBadBody: false, failTaskTitles: [], failReadsAfterPost: false };
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL_STUB)
    .replace('<script src="features-core.js"></script>', inline('features-core.js'))
    .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
    .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
    .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
    .replace('</body>', `<script>window.__x=()=>{Object.defineProperty(window,'S',{get:()=>S,configurable:true});window.D2_GRAPH=D2_GRAPH;
      window.refreshLive=refreshLive;window.refreshOneProject=refreshOneProject;window.allSecs=allSecs;window.__todayStr=todayStr;window.closeDrawer=closeDrawer;
      Object.defineProperty(window,'UI',{get:()=>UI,configurable:true});};</script><script>__x();</script></body>`);
  const errs = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
    beforeParse(w) {
      if (stored) w.localStorage.setItem('poolsched.v6', stored);
      w.fetch = (u, opts) => {
        u = String(u); store.log.push(u);
        const json = (status, body) => Promise.resolve({ ok: status < 300, status, headers: { get: () => null }, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
        if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
        if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: G.siteId, webUrl: G.site });
        if (u.includes('User Information List')) return json(200, { value: UIL });
        const L = w.D2_GRAPH.lists, dec = decodeURIComponent(u);
        if (opts && opts.method === 'POST') {
          const b = JSON.parse(opts.body); store.posts.push({ u, body: b });
          if (u.includes('/lists/' + L.asg + '/items')) {
            if (store.failAsg) return json(500, {});
            const id = String(store.nextId++); store.asg.push({ id, fields: Object.assign({}, b.fields, { id }) });
            if (store.asgBadBody) return Promise.resolve({ ok: true, status: 201, headers: { get: () => null }, json: () => Promise.reject(new Error('unreadable')) });
            return json(201, { id, fields: Object.assign({}, b.fields, { id }) });
          }
          if (u.includes('/lists/' + L.tasks + '/items')) {
            if (store.failTaskTitles.includes(b.fields.Title)) return json(500, {});
            const id = String(store.nextId++); store.tasks.push({ id, fields: Object.assign({}, b.fields, { id }) });
            return json(201, { id, fields: Object.assign({}, b.fields, { id }) });
          }
          return json(404, {});
        }
        const one = u.match(new RegExp('/lists/' + L.jobs + '/items/([^/?]+)\\?'));
        if (one) { const r = store.jobs.find(j => j.fields.id === one[1]); return r ? json(200, r) : json(404, {}); }
        if (u.includes('/lists/' + L.asg + '/items')) {
          const m = dec.match(/JobLookupId eq '(\d+)'/);
          return json(200, { value: store.asg.filter(a => !m || a.fields.JobLookupId === m[1]) });
        }
        if (u.includes('/lists/' + L.tasks + '/items')) {
          if (store.failTasks || (store.failReadsAfterPost && store.posts.length)) return json(500, {});
          const ids = [...dec.matchAll(/AssignmentLookupId eq '(\d+)'/g)].map(x => x[1]);
          return json(200, { value: store.tasks.filter(t => !ids.length || ids.includes(t.fields.AssignmentLookupId)) });
        }
        if (u.includes('/lists/' + w.D2_GRAPH.commentsList + '/items')) return json(200, { value: store.comments });
        if (u.includes('/lists/' + L.jobs + '/items')) return json(200, { value: store.jobs });
        if (u.includes('/lists/' + L.cal + '/items')) return json(200, { value: G.cal });
        if (u.includes('/lists/' + L.req + '/items')) return json(200, { value: store.req });
        for (const k of ['spt', 'tpt', 'trades']) if (u.includes('/lists/' + L[k] + '/items')) return json(200, { value: store[k] });
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
  await drawerTests();
  console.log(fails ? fails + ' failed' : 'all passed');
})();

/* ---------------- The Features drawer (Task 10) ----------------
   A small synthetic Gunite project and template, so every row's place, feature and date is known.
   Dates are built from today with the planner's own work-day functions after a first Refresh has
   loaded the work calendar, because the feature reflow floors at the next working day. */
const REASON = 'Auto Cover not on this project';
const fspt = (id, num, title, seq, phase, x) => ({ id: String(id), fields: Object.assign({ id: String(id), Title: title, SubPhaseNumber: num, Sequence: seq,
  DefaultCrew: 'office', DurationDays: 2, BuildType: 'Gunite', PhaseName: phase }, x || {}) });
const ftpt = (id, sub, title, seq, feature) => ({ id: String(id), fields: Object.assign({ id: String(id), Title: title, SubPhaseLookupId: String(sub), Sequence: seq, BuildType: 'Gunite' }, feature ? { Feature: feature } : {}) });
const SYN = {
  jobs: [], asg: [], tasks: [], trades: [],
  spt: [fspt(10, '1.0', 'Permit', 10, 'Site'), fspt(1, '1.1', 'Layout', 20, 'Site'), fspt(2, '1.2', 'Dig', 30, 'Site'),
    fspt(3, '6.4', 'Auto Cover Rough In', 40, 'Equipment', { Optional: true, Feature: 'Auto Cover', DurationDays: 3 }),
    fspt(4, '6.5', 'Fire Bowl', 50, 'Equipment', { Optional: true }),
    fspt(6, '6.7', '<i id="xf">Spa</i>', 55, 'Equipment', { Optional: true }),
    fspt(900, '6.6', 'Gas Line', 60, 'Equipment'), fspt(5, '7.0', 'Warranty', 70, 'Start', { DurationDays: 1 })],
  tpt: [ftpt(101, 10, 'Permit filed', 1), ftpt(102, 10, 'Auto Cover permit', 2, 'Auto Cover'),
    ftpt(111, 1, 'Mark corners', 1), ftpt(112, 1, 'Auto Cover Layout', 2, 'Auto Cover'), ftpt(121, 2, 'Dig', 1),
    ftpt(131, 3, 'Rough in', 1), ftpt(132, 3, 'Auto Cover check', 2, 'Auto Cover'), ftpt(141, 4, 'Set bowl', 1), ftpt(142, 4, 'Fire Bowl igniter', 2, 'Fire Bowl'),
    ftpt(191, 900, 'Run gas', 1), ftpt(192, 900, 'Gas to the fire bowl', 2, 'Fire Bowl'), ftpt(151, 5, 'Walk', 1)]
};
/* The project: 1.0 signed in the past, 1.1 already started, 1.2 and 6.4 ahead and back to back,
   7.0 after a gap of five working days (so only an exact undo, not a reflow, puts it back). Its
   Sequence values are 1..7 while the template's are 10..70, as after a renumbered template, so a
   create placed by the project's own Sequence instead of its template Sequence lands at the end.
   pastOff: 1.2 finished, 6.4 switched off in SharePoint with an old date, 7.0 already started. */
function fillProject(w, store, variant) {
  const T = w.__todayStr(), nw = w.nextWork, add = w.addCal, adv = (st, n) => nw(add(w.workSpan(st, n).pop(), 1));
  const past = variant === 'pastOff' || variant === 'pastOffNa' || variant === 'mixedCase';
  const d1 = nw(add(T, -40)), d2 = nw(add(T, -7)), d3 = past ? nw(add(T, -20)) : nw(add(T, 10)),
    d4 = past ? nw(add(T, -15)) : adv(d3, 2), d6 = past ? nw(add(T, -3)) : adv(adv(d4, 3), 5);
  const at = d => d + 'T05:00:00Z';
  store.jobs = [{ id: '50', fields: { id: '50', Title: 'Feature Test', JobNumber: 'TEST-9950', Status: 'Planned', BuildType: 'Gunite', StartDate: at(d1), ProjectManagerLookupId: '14' } }];
  const asg = (id, tpl, num, name, phase, seq, start, days, x) => ({ id: String(id), fields: Object.assign({ id: String(id), Title: 'TEST-9950 · ' + num + ' ' + name, JobLookupId: '50',
    SubPhaseNumber: num, SubPhaseName: name, PhaseName: phase, TemplateItemId: tpl, Crew: 'office', Sequence: seq, ScheduledStart: at(start), DurationDays: days,
    InstallerSignOff: false, PMSignOff: false, Locked: false, NotApplicable: false }, x || {}) });
  store.asg = [asg(501, 10, '1.0', 'Permit', 'Site', 1, d1, 2, { InstallerSignOff: variant !== 'unsigned' }), asg(502, 1, '1.1', 'Layout', 'Site', 2, d2, 2),
    asg(503, 2, '1.2', 'Dig', 'Site', 3, d3, 2),
    asg(504, 3, '6.4', 'Auto Cover Rough In', 'Equipment', 4, d4, 3, Object.assign({ Feature: 'Auto Cover' }, past ? { NotApplicable: true } : {})),
    asg(506, 5, '7.0', 'Warranty', 'Start', 7, d6, 1)];
  const task = (id, a, title, seq, x) => ({ id: String(id), fields: Object.assign({ id: String(id), Title: title, AssignmentLookupId: String(a), Sequence: seq, Complete: false, NotApplicable: false }, x || {}) });
  /* mixedCase: the tasks carry the feature as 'Auto cover' while the sub-phase says 'Auto Cover', and
     their notes are the automatic reason in the tasks' own spelling, as D2 - New Pool writes it. */
  const ac = { Feature: variant === 'mixedCase' || variant === 'mixedOn' ? 'Auto cover' : 'Auto Cover' }, rs = variant === 'mixedCase' ? 'Auto cover not on this project' : REASON;
  store.tasks = [task(5011, 501, 'Permit filed', 1, { Complete: true }), task(5012, 501, 'Auto Cover permit', 2, ac),
    task(5021, 502, 'Mark corners', 1), task(5022, 502, 'Auto Cover Layout', 2, ac), task(5031, 503, 'Dig', 1),
    task(5041, 504, 'Rough in', 1), task(5042, 504, 'Auto Cover check', 2, Object.assign({}, ac, past ? { NotApplicable: true, Note: rs } : {})),
    task(5061, 506, 'Walk', 1)];
  if (variant === 'mixedCase') Object.assign(store.tasks.find(t => t.id === '5022').fields, { NotApplicable: true, Note: rs });
  if (variant === 'pastOffNa') {
    Object.assign(store.tasks.find(t => t.id === '5022').fields, { NotApplicable: true, Note: REASON });
    store.tasks.push(task(5032, 503, 'Auto Cover conduit', 2, Object.assign({ NotApplicable: true, Note: REASON }, ac)),
      task(5062, 506, 'Auto Cover remote', 2, Object.assign({ NotApplicable: true, Note: REASON }, ac)));
  }
}
async function fresh(variant) {
  const b = boot(SYN); await wait(600);
  await b.w.refreshLive(true); await wait(100);
  fillProject(b.w, b.store, variant);
  await b.w.refreshLive(true); await wait(100);
  b.j = b.w.S.jobs.find(x => x.jobno === 'TEST-9950');
  return b;
}
const secOf = (w, j, id) => w.allSecs(j).map(x => x.s).find(s => s.base && String(s.base.id) === String(id));
const taskOf = (w, j, sid, tid) => { const s = secOf(w, j, sid); return s && s.tasks.find(t => String(t.spId) === String(tid)); };
const dBody = w => w.document.getElementById('dBody');
const stateOf = (w, key) => { const r = dBody(w).querySelector('tr[data-feature="' + key + '"]'); const c = r && r.querySelector('[data-state]'); return c ? c.dataset.state : null; };
const starts = (w, j) => w.allSecs(j).map(x => (x.s.base ? x.s.base.id : '?') + '=' + x.s.start).join(' ');
const mine = w => (w.S.pendingComments || []).filter(e => e.jobno === 'TEST-9950');
const asgPosts = b => b.store.posts.filter(p => p.u.includes('/lists/' + b.w.D2_GRAPH.lists.asg + '/'));
const taskPosts = b => b.store.posts.filter(p => p.u.includes('/lists/' + b.w.D2_GRAPH.lists.tasks + '/'));
const floorOf = w => w.nextWork(w.addCal(w.__todayStr(), 1));

async function drawerTests() {
  /* ---- Off, then reopened and switched back On before Save ---- */
  {
    const b = await fresh('base'), { w, j } = b;
    ok('drawer: synthetic project loaded with 5 sub-phases', !!j && w.allSecs(j).length === 5, j && starts(w, j));
    ok('drawer: Features button on the Jobs row', w.vJobs().includes("openFeatures('" + j.id + "')"));
    const s0 = starts(w, j);
    w.openFeatures(j.id);
    ok('drawer opens', w.document.getElementById('drawer').classList.contains('open'));
    ok('drawer: Auto Cover listed On', stateOf(w, 'auto cover') === 'on');
    ok('drawer: Fire Bowl listed as not on this project yet', stateOf(w, 'fire bowl') === 'absent' && /Not on this project yet/.test(dBody(w).textContent));
    ok('drawer: New in the template lists 6.6 Gas Line only', [...dBody(w).querySelectorAll('input[data-add-tpl]')].map(e => e.dataset.addTpl).join() === '900'
      && /6\.6 Gas Line/.test(dBody(w).textContent));
    ok('drawer: a feature name is painted as text', !w.document.getElementById('xf') && dBody(w).textContent.includes('<i id="xf">Spa</i>'));
    const spaKey = [...dBody(w).querySelectorAll('tr[data-feature]')].map(r => r.dataset.feature).find(k => k.includes('spa'));
    w.featureConfirm(j.id, spaKey, true);
    ok('confirm: a feature name in the create list is painted as text', !w.document.getElementById('xf') && dBody(w).textContent.includes('<i id="xf">Spa</i>'));
    w.featureConfirm(j.id, 'auto cover', false);
    const boxes = k => [...dBody(w).querySelectorAll('input[data-fs="' + k + '"]')];
    ok('confirm: the row and both open tasks are listed, all ticked', boxes('sec').length === 1 && boxes('task').length === 2 && [...boxes('sec'), ...boxes('task')].every(e => e.checked),
      boxes('sec').length + '/' + boxes('task').length);
    ok('confirm: the signed sub-phase is named with its reason', /1\.0 Permit is signed off/.test(dBody(w).textContent));
    await w.applyFeatureSwitch(j.id, 'auto cover', false);
    const s504 = secOf(w, j, 504);
    ok('Off: 6.4 is not applicable', s504.skip === true);
    ok('Off: both tasks N/A with the automatic reason', [taskOf(w, j, 502, 5022), taskOf(w, j, 504, 5042)].every(t => t.na && t.note === REASON));
    ok('Off: the task under the signed sub-phase is untouched', !taskOf(w, j, 501, 5012).na && !taskOf(w, j, 501, 5012).note);
    ok('Off: divergedSecs carries NotApplicable for 6.4', w.divergedSecs(j).includes(s504) && w.secFieldDiffs(s504).some(d => d.col === 'NotApplicable' && d.to === true));
    const so = w.buildSignoffSet().find(p => p.jobno === 'TEST-9950'), sot = so ? so.sections.flatMap(x => x.tasks) : [];
    ok('Off: buildSignoffSet sends the two task N/As with the note', sot.length === 2 && sot.every(t => t.to.na && t.to.note === REASON), JSON.stringify(sot));
    const pc = mine(w);
    ok('Off: one change-order comment per touched section', pc.length === 2 && pc.every(e => e.kind === 'comment' && e.body === 'Change order: Auto Cover removed')
      && pc.map(e => e.secId).sort().join() === '502,504', JSON.stringify(pc));
    const was = Object.fromEntries(s0.split(' ').map(x => x.split('=')));
    ok('Off: 7.0 moves up to where 6.4 started', secOf(w, j, 506).start === was['504'], starts(w, j));
    ok('Off: rows before the change and started work stay put', ['501', '502', '503'].every(id => secOf(w, j, id).start === was[id]));
    ok('Off: the result says to press Save', /press Save/i.test(dBody(w).textContent));
    ok('Off: the result names what was left and why', /1\.0 Permit is signed off/.test(dBody(w).textContent));
    ok('Off: nothing was written to SharePoint', b.store.posts.length === 0);
    ok('Off: the project is marked edited', !!j.touchedAt);
    w.openFeatures(j.id);
    ok('reopened before Save, Auto Cover shows the pending change (partly on: the signed sub-phase kept its task)', stateOf(w, 'auto cover') === 'partly' && /Partly on/.test(dBody(w).textContent));
    w.featureConfirm(j.id, 'auto cover', true);
    await w.applyFeatureSwitch(j.id, 'auto cover', true);
    ok('switched back On, every date is as it was', starts(w, j) === s0, starts(w, j) + ' vs ' + s0);
    ok('switched back On, divergedSecs sends nothing', w.divergedSecs(j).length === 0);
    ok('switched back On, buildSignoffSet sends nothing', !w.buildSignoffSet().some(p => p.jobno === 'TEST-9950'));
    ok('switched back On, the pending change-order comments are withdrawn', mine(w).length === 0, JSON.stringify(mine(w)));
    ok('drawer: no page errors', b.errs.length === 0, b.errs.join(' | '));
  }
  /* ---- with nothing signed, a pending Off reopens as Off ---- */
  {
    const b = await fresh('unsigned'), { w, j } = b;
    // Driven through the drawer's own buttons, so the inline handlers are exercised too.
    w.openFeatures(j.id);
    [...dBody(w).querySelectorAll('tr[data-feature="auto cover"] button')].find(x => x.textContent === 'Turn off').click();
    [...w.document.getElementById('dFoot').querySelectorAll('button')].find(x => x.textContent === 'Apply').click();
    await wait(100);
    ok('buttons: Turn off then Apply switches the feature', secOf(w, j, 504).skip === true && /press Save/i.test(dBody(w).textContent));
    [...w.document.getElementById('dFoot').querySelectorAll('button')].find(x => x.textContent === 'Back to features').click();
    ok('reopened before Save, Auto Cover shows Off', stateOf(w, 'auto cover') === 'off' && taskOf(w, j, 501, 5012).na);
  }
  /* ---- unticking an item leaves it as it was ---- */
  {
    const b = await fresh('base'), { w, j } = b, s0 = starts(w, j);
    w.featureConfirm(j.id, 'auto cover', false);
    const box = [...dBody(w).querySelectorAll('input[data-fs="task"]')].find(e => /1\.1 Auto Cover Layout/.test(e.parentNode.textContent));
    const sbox = dBody(w).querySelector('input[data-fs="sec"]');
    box.checked = false; sbox.checked = false;
    await w.applyFeatureSwitch(j.id, 'auto cover', false);
    ok('untick: the unticked task is unchanged', !taskOf(w, j, 502, 5022).na);
    ok('untick: the ticked task changed', taskOf(w, j, 504, 5042).na && taskOf(w, j, 504, 5042).note === REASON);
    ok('untick: the unticked sub-phase is unchanged and nothing moved', secOf(w, j, 504).skip === false && starts(w, j) === s0);
    ok('untick: only the touched section gets a comment', mine(w).length === 1 && mine(w)[0].secId === '504');
    ok('untick: a tasks-only change still marks the project edited', !!j.touchedAt);
  }
  /* ---- On for a feature the project does not have: creates, refresh, reflow ---- */
  {
    const b = await fresh('base'), { w, j } = b;
    const pre = w.queueEntryFor(j, secOf(w, j, 503), 'comment', 'Change order: Spa removed');
    ok('queueEntryFor queues an entry for any section', !!pre && mine(w).length === 1 && pre.secId === '503');
    const was = { 501: secOf(w, j, 501).start, 502: secOf(w, j, 502).start, 504: secOf(w, j, 504).start };
    w.featureConfirm(j.id, 'fire bowl', true);
    ok('On absent: the queued comment does not stop the create', !/Save first/.test(dBody(w).textContent) && /6\.5 Fire Bowl/.test(dBody(w).textContent));
    await w.applyFeatureSwitch(j.id, 'fire bowl', true);
    const ap = asgPosts(b), tp = taskPosts(b);
    ok('On absent: one Assignments POST and its two Tasks POSTs', ap.length === 1 && tp.length === 2, ap.length + '/' + tp.length);
    ok('On absent: a task of the feature being switched on is created applicable', tp.some(p => p.body.fields.Title === 'Fire Bowl igniter' && p.body.fields.NotApplicable === false));
    const ab = ap[0] && ap[0].body.fields;
    ok('On absent: the row sits between 6.4 and 7.0 and carries the suppression stamp', ab && ab.Sequence === 5.5 && ab.TemplateItemId === 4 && ab.Feature === 'Fire Bowl'
      && Date.parse(ab.SuppressReconcileUntil) > Date.now(), JSON.stringify(ab));
    ok('On absent: the task has no suppression stamp', tp[0] && !('SuppressReconcileUntil' in tp[0].body.fields) && tp[0].body.fields.Title === 'Set bowl');
    const order = w.allSecs(j).map(x => x.s.num).join(' ');
    const ns = w.allSecs(j).map(x => x.s).find(s => s.templateItemId === 4);
    ok('On absent: the new sub-phase is on screen, applicable, with its row ids', !!ns && ns.skip === false && ns.base && ns.base.id != null && ns.tasks.length === 2 && ns.tasks.every(t => t.spId != null && !t.na));
    ok('On absent: placed by Sequence', order === '1.0 1.1 1.2 6.4 6.5 7.0', order);
    const adv = (st, n) => w.nextWork(w.addCal(w.workSpan(st, n).pop(), 1));
    ok('On absent: it follows 6.4, no earlier than tomorrow', !!ns && ns.start === adv(was[504], 3) && ns.start >= floorOf(w), ns && ns.start);
    ok('On absent: 7.0 follows it', !!ns && secOf(w, j, 506).start === adv(ns.start, 2), secOf(w, j, 506).start);
    ok('On absent: started and earlier rows did not move', ['501', '502', '504'].every(id => secOf(w, j, id).start === was[id]));
    const pc = mine(w);
    ok('On absent: a change-order comment is queued on the new row', !!ns && pc.some(e => e.secId === String(ns.base.id) && e.body === 'Change order: Fire Bowl added'), JSON.stringify(pc));
    ok('On absent: the comment queued before the create is still queued and its row is still here', pc.some(e => e.localId === pre.localId) && !!secOf(w, j, 503));
    ok('On absent: the result says to press Save', /press Save/i.test(dBody(w).textContent));
    ok('On absent: the new row dates wait for Save', !!ns && w.divergedSecs(j).includes(ns));
    w.openFeatures(j.id);
    ok('On absent: reopened, Fire Bowl shows On', stateOf(w, 'fire bowl') === 'on');
  }
  /* ---- a row switched Off in SharePoint with an old date lands at the floor ---- */
  {
    const b = await fresh('pastOff'), { w, j } = b, old = secOf(w, j, 504).start;
    w.featureConfirm(j.id, 'auto cover', true);
    await w.applyFeatureSwitch(j.id, 'auto cover', true);
    ok('On past: the re-enabled row lands at the next working day', secOf(w, j, 504).start === floorOf(w) && secOf(w, j, 504).start !== old, old + ' -> ' + secOf(w, j, 504).start);
    ok('On past: its automatic N/A task is back to do', !taskOf(w, j, 504, 5042).na && taskOf(w, j, 504, 5042).note === '');
    ok('On past: work already started after it is not restacked', secOf(w, j, 506).start === b.store.asg.find(a => a.id === '506').fields.ScheduledStart.slice(0, 10));
  }
  /* ---- On with a create that lands before an existing row, after SharePoint reordered a checklist ---- */
  {
    const b = await fresh('pastOff'), { w, j } = b;
    b.store.spt.push(fspt(7, '6.3', 'Auto Cover Track', 35, 'Equipment', { Optional: true, Feature: 'Auto Cover' }));
    await w.refreshLive(true); await wait(50);
    w.featureConfirm(j.id, 'auto cover', true);
    ok('On+create: the confirm lists the change and the create', dBody(w).querySelectorAll('input[data-fs]').length === 2 && /6\.3 Auto Cover Track/.test(dBody(w).textContent));
    b.store.tasks.find(t => t.id === '5041').fields.Sequence = 3;     // reordered on the site meanwhile
    await w.applyFeatureSwitch(j.id, 'auto cover', true);
    const order = w.allSecs(j).map(x => x.s.num).join(' '), tr = w.allSecs(j).map(x => x.s).find(s => s.templateItemId === 7);
    ok('On+create: the new row sits before 6.4 by template Sequence', order === '1.0 1.1 1.2 6.3 6.4 7.0', order);
    ok('On+create: 6.4 itself is applicable again after the re-read', secOf(w, j, 504).skip === false && !!tr && tr.skip === false);
    ok('On+create: the right task is cleared, by row id not position', !taskOf(w, j, 504, 5042).na && taskOf(w, j, 504, 5042).note === '' && w.allSecs(j).length === 6);
    const adv = (st, n) => w.nextWork(w.addCal(w.workSpan(st, n).pop(), 1));
    ok('On+create: the reflow starts at the earlier of the two, at the floor', !!tr && tr.start === floorOf(w) && secOf(w, j, 504).start === adv(tr.start, 2), tr && tr.start + ' / ' + secOf(w, j, 504).start);
    ok('On+create: one added comment each on the new row and 6.4', mine(w).length === 2 && mine(w).every(e => e.body === 'Change order: Auto Cover added')
      && mine(w).map(e => e.secId).sort().join() === [String(tr && tr.base.id), '504'].sort().join(), JSON.stringify(mine(w)));
  }
  /* ---- a create re-reads the project, and the switch is re-planned against what SharePoint holds now ---- */
  {
    const b = await fresh('pastOffNa'), { w, j } = b;
    b.store.spt.push(fspt(7, '6.3', 'Auto Cover Track', 35, 'Equipment', { Optional: true, Feature: 'Auto Cover' }));
    await w.refreshLive(true); await wait(50);
    w.featureConfirm(j.id, 'auto cover', true);
    const box = re => [...dBody(w).querySelectorAll('input[data-fs]')].find(e => re.test(e.parentNode.textContent));
    ok('re-plan: the confirm lists 6.4 and four tasks', dBody(w).querySelectorAll('input[data-fs="sec"]').length === 1 && dBody(w).querySelectorAll('input[data-fs="task"]').length === 4);
    box(/6\.4 Auto Cover Rough In becomes/).checked = false;        // the PM keeps 6.4 off
    box(/1\.2 Auto Cover conduit/).checked = false;                 // and this task N/A
    // Meanwhile on the site: 1.1 is signed, 6.4's automatic reason is replaced, 7.0's N/A is cleared.
    b.store.asg.find(a => a.id === '502').fields.InstallerSignOff = true;
    b.store.tasks.find(t => t.id === '5042').fields.Note = 'Customer declined';
    Object.assign(b.store.tasks.find(t => t.id === '5062').fields, { NotApplicable: false, Note: undefined });
    await w.applyFeatureSwitch(j.id, 'auto cover', true);
    const t = dBody(w).textContent;
    ok('re-plan: the task under the newly signed sub-phase is unchanged', taskOf(w, j, 502, 5022).na && taskOf(w, j, 502, 5022).note === REASON);
    ok('re-plan: the PM reason now on the site is kept', taskOf(w, j, 504, 5042).na && taskOf(w, j, 504, 5042).note === 'Customer declined');
    ok('re-plan: both are reported with their reason, the kept task by name', /1\.1 Layout is signed off/.test(t) && /6\.4 Auto Cover Rough In has a task, Auto Cover check, marked not applicable for another reason/.test(t), t);
    ok('re-plan: an item that changed on the site is reported', /7\.0 Auto Cover remote changed in SharePoint since the last Refresh/.test(t), t);
    ok('re-plan: unticked items stay as they were', secOf(w, j, 504).skip === true && taskOf(w, j, 503, 5032).na);
    ok('re-plan: no comment on the signed sub-phase, none on unchanged rows', !mine(w).some(e => ['502', '503', '504', '506'].includes(e.secId)) && mine(w).length === 1, JSON.stringify(mine(w)));
  }
  /* ---- Update from template ---- */
  {
    const b = await fresh('base'), { w, j } = b;
    w.openFeatures(j.id);
    dBody(w).querySelector('input[data-add-tpl="900"]').checked = true;
    await w.addTemplateLines(j.id);
    const ap = asgPosts(b), tp = taskPosts(b);
    ok('template: one Assignments POST and its two tasks', ap.length === 1 && tp.length === 2 && ap[0].body.fields.TemplateItemId === 900 && !('Feature' in ap[0].body.fields), ap.length + '/' + tp.length);
    const gt = tp.find(p => p.body.fields.Title === 'Gas to the fire bowl');
    ok('template: a task of a feature the project does not have is created N/A with its reason', !!gt && gt.body.fields.NotApplicable === true && gt.body.fields.Note === 'Fire Bowl not on this project', gt && JSON.stringify(gt.body.fields));
    const ns = w.allSecs(j).map(x => x.s).find(s => s.templateItemId === 900);
    ok('template: the line is on the project, after 6.4, no earlier than tomorrow', !!ns && w.allSecs(j).map(x => x.s.num).join(' ') === '1.0 1.1 1.2 6.4 6.6 7.0' && ns.start >= floorOf(w));
    ok('template: the result says to press Save', /press Save/i.test(dBody(w).textContent));
    ok('template: no change-order comment', mine(w).length === 0);
    w.openFeatures(j.id);
    ok('template: the line is no longer listed', !dBody(w).querySelector('input[data-add-tpl="900"]') && !/6\.6 Gas Line/.test(dBody(w).textContent));
    await w.addTemplateLines(j.id);
    ok('template: nothing ticked writes nothing', asgPosts(b).length === 1);
  }
  /* ---- a create while the project has an unsaved date edit stops and applies nothing ---- */
  {
    const b = await fresh('base'), { w, j } = b;
    w.featureConfirm(j.id, 'fire bowl', true);               // confirm shown while nothing is unsaved
    const s3 = secOf(w, j, 503); s3.start = w.nextWork(w.addCal(s3.start, 3));
    const snap = JSON.stringify(j.groups), q = JSON.stringify(w.S.pendingComments);
    await w.applyFeatureSwitch(j.id, 'fire bowl', true);
    ok('unsaved: the switch stops with Save first', /Save first/.test(dBody(w).textContent));
    ok('unsaved: nothing posted, nothing changed on screen, nothing queued', b.store.posts.length === 0 && JSON.stringify(j.groups) === snap && JSON.stringify(w.S.pendingComments) === q);
    w.closeDrawer(); w.featureConfirm(j.id, 'fire bowl', true);
    ok('unsaved: the confirm itself stops too', /Save first/.test(dBody(w).textContent) && !dBody(w).querySelector('input[data-fs]'));
    w.openFeatures(j.id);
    ok('unsaved: the drawer still opens', stateOf(w, 'auto cover') === 'on');
    dBody(w).querySelector('input[data-add-tpl="900"]').checked = true;
    await w.addTemplateLines(j.id);
    ok('unsaved: Add from the template stops too, nothing written or changed', /Save first/.test(dBody(w).textContent) && b.store.posts.length === 0 && JSON.stringify(j.groups) === snap);
    w.closeDrawer(); w.featureConfirm(j.id, 'auto cover', false);
    ok('unsaved: a switch with no creates is not stopped', !/Save first/.test(dBody(w).textContent) && dBody(w).querySelectorAll('input[data-fs]').length === 3);
  }
  /* ---- create failures are named, from what came back ---- */
  {
    const b = await fresh('base'), { w, j } = b;
    b.store.failTaskTitles = ['Set bowl'];
    w.featureConfirm(j.id, 'fire bowl', true); await w.applyFeatureSwitch(j.id, 'fire bowl', true);
    const t = dBody(w).textContent;
    ok('fail task: named, with add them on the SharePoint site', /Set bowl/.test(t) && /add them on the SharePoint site/i.test(t), t);
    ok('fail task: the row itself is on screen', !!w.allSecs(j).map(x => x.s).find(s => s.templateItemId === 4));
  }
  {
    const b = await fresh('base'), { w, j } = b;
    b.store.asgBadBody = true;
    w.featureConfirm(j.id, 'fire bowl', true); await w.applyFeatureSwitch(j.id, 'fire bowl', true);
    const t = dBody(w).textContent;
    ok('unreadable reply: a row that came back is not reported as not created', !/not created/.test(t) && !!w.allSecs(j).map(x => x.s).find(s => s.templateItemId === 4), t);
    ok('unreadable reply: its tasks are reported for the SharePoint site', /6\.5 Fire Bowl/.test(t) && /add them on the SharePoint site/i.test(t), t);
  }
  {
    const b = await fresh('base'), { w, j } = b;
    b.store.failAsg = true;
    w.featureConfirm(j.id, 'fire bowl', true); await w.applyFeatureSwitch(j.id, 'fire bowl', true);
    const t = dBody(w).textContent;
    ok('fail row: named as not created', /6\.5 Fire Bowl was not created/.test(t), t);
    ok('fail row: no comment for a row that does not exist', mine(w).length === 0);
  }
  {
    const b = await fresh('base'), { w, j } = b, snap = JSON.stringify(j.groups);
    b.store.failReadsAfterPost = true;
    w.featureConfirm(j.id, 'fire bowl', true); await w.applyFeatureSwitch(j.id, 'fire bowl', true);
    ok('refresh fails: the cause is shown', /a84a18/.test(dBody(w).innerHTML) && /Graph 500/.test(dBody(w).textContent), dBody(w).textContent);
    ok('refresh fails: nothing else is applied on screen', JSON.stringify(j.groups) === snap && mine(w).length === 0);
    const n = b.store.posts.length;
    w.featureConfirm(j.id, 'fire bowl', true);
    ok('refresh fails: a second Turn on is refused until a Refresh', /Refresh first/.test(dBody(w).textContent) && !dBody(w).querySelector('input[data-fs]') && b.store.posts.length === n);
    w.UI.fs = { jobId: j.id, key: 'fire bowl', name: 'Fire Bowl', on: true, plan: w.D2FeaturesCore.planSwitch(j.groups, w.templateFor(j.buildType), 'fire bowl', true) };
    await w.applyFeatureSwitch(j.id, 'fire bowl', true);
    ok('refresh fails: and so is its Apply', /Refresh first/.test(dBody(w).textContent) && b.store.posts.length === n);
    w.openFeatures(j.id); dBody(w).querySelector('input[data-add-tpl="900"]').checked = true;
    await w.addTemplateLines(j.id);
    ok('refresh fails: and so is Add from the template', /Refresh first/.test(dBody(w).textContent) && b.store.posts.length === n);
    b.store.failReadsAfterPost = false;
    ok('after a successful re-read, creates are allowed again', (await w.refreshOneProject(j)) === true && !j.needsRefresh);
    w.openFeatures(j.id); dBody(w).querySelector('input[data-add-tpl="900"]').checked = true;
    await w.addTemplateLines(j.id);
    ok('and Add from the template posts again', b.store.posts.length > n && !!w.allSecs(j).map(x => x.s).find(s => s.templateItemId === 900));
  }
  /* ---- the confirm list fails closed: an item with no checkbox on screen is not applied ---- */
  {
    const b = await fresh('base'), { w, j } = b, snap = JSON.stringify(j.groups);
    w.featureConfirm(j.id, 'auto cover', false);
    dBody(w).innerHTML = '';
    await w.applyFeatureSwitch(j.id, 'auto cover', false);
    ok('fail closed: nothing applied without its ticked checkbox', JSON.stringify(j.groups) === snap && mine(w).length === 0);
  }
  /* ---- where the button is not offered ---- */
  {
    const b = await fresh('base'), { w, j } = b, has = () => w.vJobs().includes("openFeatures('" + j.id + "')");
    const m = w.msal; w.msal = undefined;
    ok('no Features button when the planner cannot reach Graph', !has());
    ok('queueEntryFor queues nothing when comments cannot be saved', w.queueEntryFor(j, secOf(w, j, 503), 'comment', 'x') === null && mine(w).length === 0);
    w.msal = m; j.building = true;
    ok('no Features button while the project is building', !has());
    w.closeDrawer(); w.openFeatures(j.id);
    ok('and the drawer does not open for it', !w.document.getElementById('drawer').classList.contains('open'));
    j.building = false; j.readOnly = true;
    ok('no Features button on a read-only project', !has());
    j.readOnly = false;
    w.S.jobs.push({ id: 'jlocal', jobno: 'D2-7777', name: 'Sketch', spId: '999', groups: [{ num: '1', name: 'x', sections: [{ num: '1.1', name: 'a', days: 2, tasks: [] }] }] });
    ok('no Features button on a local sketch', !w.vJobs().includes("openFeatures('jlocal')"));
  }
  /* ---- review fix 2: a flow-written automatic reason in the tasks' own spelling is cleared by On ---- */
  {
    const b = await fresh('mixedCase'), { w, j } = b;
    w.featureConfirm(j.id, 'auto cover', true);
    ok('mixed case: the confirm lists 6.4 and both automatic N/A tasks', dBody(w).querySelectorAll('input[data-fs="sec"]').length === 1
      && dBody(w).querySelectorAll('input[data-fs="task"]').length === 2 && !/another reason/.test(dBody(w).textContent), dBody(w).textContent);
    await w.applyFeatureSwitch(j.id, 'auto cover', true);
    ok('mixed case: On clears both notes', [taskOf(w, j, 502, 5022), taskOf(w, j, 504, 5042)].every(t => !t.na && t.note === ''),
      JSON.stringify([taskOf(w, j, 502, 5022), taskOf(w, j, 504, 5042)]));
  }
  {
    const b = await fresh('mixedOn'), { w, j } = b;
    w.featureConfirm(j.id, 'auto cover', false);
    await w.applyFeatureSwitch(j.id, 'auto cover', false);
    ok('mixed case: Off writes the reason in the tasks own spelling', [taskOf(w, j, 502, 5022), taskOf(w, j, 504, 5042)].every(t => t.na && t.note === 'Auto cover not on this project'));
  }
  /* ---- review fix 4c: a reflow with no dated row before it keeps a future project where it starts ---- */
  {
    const b = boot(SYN); await wait(600); await b.w.refreshLive(true); await wait(100);
    const w = b.w, T = w.__todayStr(), nw = w.nextWork, add = w.addCal;
    const FUT = T < '2027-01-15' ? '2027-03-01' : nw(add(T, 130));
    const at = d => d + 'T06:00:00Z';
    const row = (id, tpl, num, name, phase, seq, start, days, x) => ({ id: String(id), fields: Object.assign({ id: String(id), Title: 'TEST-9951 · ' + num + ' ' + name,
      JobLookupId: '51', SubPhaseNumber: num, SubPhaseName: name, PhaseName: phase, TemplateItemId: tpl, Crew: 'office', Sequence: seq, ScheduledStart: start ? at(start) : null,
      DurationDays: days, InstallerSignOff: false, PMSignOff: false, Locked: false, NotApplicable: false }, x || {}) });
    b.store.jobs = [{ id: '51', fields: { id: '51', Title: 'Future', JobNumber: 'TEST-9951', Status: 'Planned', BuildType: 'Gunite', StartDate: at(FUT), ProjectManagerLookupId: '14' } }];
    b.store.asg = [row(511, 3, '6.4', 'Auto Cover Rough In', 'Equipment', 1, FUT, 3, { Feature: 'Auto Cover', NotApplicable: true }),
      row(512, 5, '7.0', 'Warranty', 'Start', 2, nw(add(FUT, 7)), 1)];
    b.store.tasks = [];
    await w.refreshLive(true); await wait(100);
    const j = w.S.jobs.find(x => x.jobno === 'TEST-9951');
    w.featureConfirm(j.id, 'auto cover', true);
    await w.applyFeatureSwitch(j.id, 'auto cover', true);
    const s1 = secOf(w, j, 511), s2 = secOf(w, j, 512), adv = (st, n) => nw(add(w.workSpan(st, n).pop(), 1));
    ok('future project: its first sub-phase switched on stays at the project start', !!s1 && s1.start === nw(FUT) && s1.start.slice(0, 7) === FUT.slice(0, 7), s1 && s1.start);
    ok('future project: the next row follows it', !!s2 && s2.start === adv(s1.start, 3), s2 && s2.start);
    const opts = { floor: floorOf(w), pinStarted: true, fromPrev: true };
    s1.start = nw(add(FUT, 14)); w.reflowFrom(j.id, 0, 0, null, opts);
    ok('reflow: a row starting after the project start keeps its own start', s1.start === nw(add(FUT, 14)), s1.start);
    j.start = nw(add(FUT, 21)); w.reflowFrom(j.id, 0, 0, null, opts);
    ok('reflow: the project start wins when it is later', s1.start === nw(add(FUT, 21)), s1.start);
    j.start = add(T, -30); s1.start = null; w.reflowFrom(j.id, 0, 0, null, opts);
    ok('reflow: a past project start falls to the floor', s1.start === floorOf(w), s1.start);
  }
  /* ---- review fix 3: a create in flight closes the project, and a second click posts nothing ---- */
  {
    const b = await fresh('base'), { w, j } = b;
    w.openFeatures(j.id); dBody(w).querySelector('input[data-add-tpl="900"]').checked = true;
    const p1 = w.addTemplateLines(j.id);
    const ctl = [...dBody(w).querySelectorAll('input,button')];
    ok('in flight: the project is frozen while sub-phases are added', j.creating === true && w.frozen(j) === true);
    ok('in flight: the drawer controls are disabled', ctl.length >= 2 && ctl.every(e => e.disabled), ctl.length + ' ' + ctl.filter(e => !e.disabled).length);
    ok('in flight: no Features button and no inline editing', !w.vJobs().includes("openFeatures('" + j.id + "')") && !w.inlineEditable(j, secOf(w, j, 503)));
    const p2 = w.addTemplateLines(j.id);
    await Promise.all([p1, p2]); await wait(50);
    ok('two rapid Adds post one set', asgPosts(b).length === 1 && taskPosts(b).length === 2, asgPosts(b).length + '/' + taskPosts(b).length);
    ok('after the create the project is open again', j.creating === undefined && !w.frozen(j) && w.featuresAllowed(j));
  }
  {
    // A switch whose confirm list has checkboxes and a create (6.3 is new in the template).
    const b = await fresh('pastOff'), { w, j } = b;
    b.store.spt.push(fspt(7, '6.3', 'Auto Cover Track', 35, 'Equipment', { Optional: true, Feature: 'Auto Cover' }));
    await w.refreshLive(true); await wait(50);
    w.featureConfirm(j.id, 'auto cover', true);
    const p1 = w.applyFeatureSwitch(j.id, 'auto cover', true);
    const ctl = [...dBody(w).querySelectorAll('input,button')];
    ok('in flight: a switch disables its confirm list', ctl.length >= 2 && ctl.every(e => e.disabled), ctl.length + ' ' + ctl.filter(e => !e.disabled).length);
    w.editSec(j.id, 2, 0);
    ok('in flight: a sub-phase panel says sub-phases are being added', /being added/.test(dBody(w).textContent) && !/still being built/.test(dBody(w).textContent), dBody(w).textContent);
    w.featureConfirm(j.id, 'auto cover', true);
    const p2 = w.applyFeatureSwitch(j.id, 'auto cover', true);
    await Promise.all([p1, p2]); await wait(50);
    ok('a second Turn on during a create posts nothing more', asgPosts(b).length === 1, String(asgPosts(b).length));
    ok('and the row is on the project once', w.allSecs(j).filter(x => x.s.templateItemId === 7).length === 1);
  }
  /* ---- review fix 1: a template or project from before this release cannot reach a create ---- */
  {
    const b = await fresh('base'), { w, j } = b;
    const opens = () => { w.closeDrawer(); w.openFeatures(j.id); return !!dBody(w).querySelector('tr[data-feature]'); };
    const stale = () => /Press Refresh first/.test(dBody(w).textContent) && !dBody(w).querySelector('tr[data-feature],input[data-add-tpl]');
    ok('current: the drawer opens with its features', opens());
    const from = w.S.templatesFrom; delete w.S.templatesFrom;
    ok('stale: a template not read from SharePoint stops the drawer', !opens() && stale());
    w.S.templatesFrom = from;
    const sec0 = w.S.templates.Gunite[0].sections[0], id0 = sec0.id; sec0.id = 's0_0';
    ok('stale: a template line with an old id stops the drawer', !opens() && stale());
    sec0.id = id0;
    const keep = w.allSecs(j).map(x => x.s.templateItemId);
    w.allSecs(j).forEach(x => { x.s.templateItemId = null; });
    ok('stale: a project whose rows carry no template id stops the drawer', !opens() && stale());
    w.allSecs(j).forEach((x, i) => { x.s.templateItemId = i === 1 ? keep[i] : null; });
    ok('one row with a template id is enough', opens());
    w.allSecs(j).forEach((x, i) => { x.s.templateItemId = keep[i]; });
    ok('no posts from any of it', b.store.posts.length === 0);
  }
  {
    /* A browser holding state saved before step 2: the template copy has the old 's0_0' ids and the
       project's rows carry no template id. Nothing is Refreshed on load. */
    const b0 = await fresh('base'), st = JSON.parse(JSON.stringify(b0.w.S));
    st.templates.Gunite.forEach((ph, i) => ph.sections.forEach((s, k) => { s.id = 's' + i + '_' + k; }));
    const sj = st.jobs.find(x => x.jobno === 'TEST-9950');
    sj.groups.forEach(g => g.sections.forEach(s => { delete s.templateItemId; delete s.feature; }));
    sj.creating = true;   // left over from a page closed mid-create
    const b = boot(SYN, JSON.stringify(st)); await wait(600);
    const w = b.w, j = w.S.jobs.find(x => x.jobno === 'TEST-9950');
    ok('stored: a create flag left in storage is dropped on load', !!j && j.creating === undefined && w.featuresAllowed(j));
    w.openFeatures(j.id);
    ok('stored: the drawer says Press Refresh first and offers nothing', w.document.getElementById('drawer').classList.contains('open')
      && /Press Refresh first/.test(dBody(w).textContent) && !dBody(w).querySelector('tr[data-feature],input[data-add-tpl],input[data-fs]'), dBody(w).textContent);
    w.featureConfirm(j.id, 'fire bowl', true);
    ok('stored: Turn on is refused the same way', /Press Refresh first/.test(dBody(w).textContent) && !dBody(w).querySelector('input[data-fs]'));
    w.UI.fs = { jobId: j.id, key: 'fire bowl', name: 'Fire Bowl', on: true, plan: { secs: [], tasks: [], creates: [{ tplId: 's0_4', num: '6.5', name: 'Fire Bowl' }], left: [], firstSec: null } };
    await w.applyFeatureSwitch(j.id, 'fire bowl', true);
    ok('stored: and so is its Apply', /Press Refresh first/.test(dBody(w).textContent) && b.store.posts.length === 0);
    dBody(w).innerHTML = '<input type="checkbox" data-add-tpl="s0_6" checked>';
    await w.addTemplateLines(j.id);
    ok('stored: and so is Add from the template', /Press Refresh first/.test(dBody(w).textContent) && b.store.posts.length === 0);
    w.addJob();
    const nf = w.document.getElementById('ncFeatures');
    ok('stored: + Job asks for a Refresh instead of listing features', !!nf && /Press Refresh to load the optional features/.test(nf.textContent)
      && !nf.querySelector('input') && !/No optional features/.test(nf.textContent), nf && nf.textContent);
    w.closeDrawer();
    fillProject(w, b.store, 'base');
    await w.refreshLive(true); await wait(100);
    const j2 = w.S.jobs.find(x => x.jobno === 'TEST-9950');
    w.openFeatures(j2.id);
    ok('stored: after a Refresh the drawer works', !!dBody(w).querySelector('tr[data-feature]') && !/Press Refresh first/.test(dBody(w).textContent));
    ok('stored: nothing was ever posted', b.store.posts.length === 0);
    ok('stored: no page errors', b.errs.length === 0, b.errs.join(' | '));
  }
}
