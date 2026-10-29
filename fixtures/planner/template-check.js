// fixtures/planner/template-check.js   Run: node fixtures/planner/template-check.js
// The template check on the Build phases tab: the pure rules (web/template-check-core.js), the Graph
// mapping that feeds them (web/graph-to-planner.js), and the card in the real page.
// Sweeps: template-check.mutations.json (core), template-check.g2p-mutations.json (mapper),
// template-check.html-mutations.json (page). Every assertion was watched failing under mutate.py.
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const WEB = path.join(__dirname, '..', '..', 'web');
const T = require(path.join(WEB, 'template-check-core.js'));
const M = require(path.join(WEB, 'graph-to-planner.js'));
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-payloads-graph.json'), 'utf8'));
const HOST = 'https://mango-sky-0d6904310.5.azurestaticapps.net';
let fails = 0;
const ok = (l, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) { fails++; process.exitCode = 1; } };

// ---------------- Part A: the rules
const CREWS = 'antonio armondo brothers campos cirilo devon george guillermo harrison office saul stl subcon unassigned'.split(' ');
const sp = o => Object.assign({ id: '1', buildType: 'Gunite', num: '1.1', name: 'Layout', phase: 'Site', seq: 10, crew: 'devon', tradeId: '5',
  skill: null, days: 2, optional: false, feature: null }, o);
const tk = o => Object.assign({ id: '1', buildType: 'Gunite', title: 'Mark corners', subId: '1', seq: 1, feature: null }, o);
const TR = [{ id: '5', code: 'dig' }];
const run = (spt, tpt, extra) => T.check(Object.assign({ spt, tpt: tpt || [], crews: CREWS, trades: TR }, extra || {}));
const kinds = r => r.issues.map(i => i.kind).sort().join();
const has = (r, k) => r.issues.filter(i => i.kind === k);

const good = [sp({ id: '1', num: '1.1', seq: 10 }), sp({ id: '2', num: '1.2', name: 'Dig', seq: 20 })];
ok('a clean template raises nothing', run(good, [tk({ subId: '1' })]).issues.length === 0, kinds(run(good)));
ok('missing input arrays never throw', T.check().issues.length === 0 && T.check({}).errors === 0);

// crew-unknown
let r = run([sp({ crew: 'devin' })]);
ok('unknown crew code is an error', has(r, 'crew-unknown').length === 1 && r.errors === 1 && /devin/.test(r.issues[0].msg));
ok('crew match ignores case and spaces', run([sp({ crew: ' Devon ' })]).issues.length === 0);
ok('blank crew is not an issue (Unassigned)', run([sp({ crew: '', tradeId: '5' })]).issues.length === 0);
ok('no crews list means the crew rule stays quiet', T.check({ spt: [sp({ crew: 'devin' })], crews: [], trades: TR }).issues.length === 0);
// seq
r = run([sp({ seq: null })]);
ok('blank Sequence is an error', has(r, 'seq-blank').length === 1);
ok('a non-numeric Sequence is an error', has(run([sp({ seq: 'x' })]), 'seq-blank').length === 1);
r = run([sp({ id: '1', seq: 10 }), sp({ id: '2', num: '1.2', seq: 10 }), sp({ id: '3', num: '1.3', seq: 30 })]);
ok('shared Sequence is one error naming both rows', has(r, 'seq-dup').length === 1 && /1\.1/.test(has(r, 'seq-dup')[0].msg) && /1\.2/.test(has(r, 'seq-dup')[0].msg));
ok('Sequence clash is per build type', run([sp({ seq: 10 }), sp({ id: '2', buildType: 'Fiberglass', seq: 10 })]).issues.length === 0);
ok('decimal Sequence compares as a number', has(run([sp({ seq: 21.5 }), sp({ id: '2', num: '1.2', seq: '21.5' })]), 'seq-dup').length === 1);
// num / name
ok('blank number is an error', has(run([sp({ num: '' })]), 'num-blank').length === 1);
ok('repeated number is an error', has(run([sp({ id: '1', seq: 10 }), sp({ id: '2', seq: 20 })]), 'num-dup').length === 1);
ok('the same number in the other build type is fine', run([sp({}), sp({ id: '2', buildType: 'Fiberglass' })]).issues.length === 0);
ok('blank name is an error', has(run([sp({ name: '' })]), 'name-blank').length === 1);
// trade
ok('unknown trade is an error', has(run([sp({ tradeId: '99' })]), 'trade-unknown').length === 1);
ok('a known trade passes', has(run([sp({ tradeId: '5' })]), 'trade-unknown').length === 0);
// skill-blank
r = run([sp({ tradeId: null, crew: 'devon', skill: null })]);
ok('no trade, a field crew and no skill warns', has(r, 'skill-blank').length === 1 && r.warnings === 1 && r.errors === 0);
ok('no trade but a pseudo crew is fine', ['office', 'subcon', 'Unassigned'].every(c => run([sp({ tradeId: null, crew: c })]).issues.length === 0));
ok('no trade but a skill is fine', has(run([sp({ tradeId: null, skill: 'dig' })]), 'skill-blank').length === 0);
ok('a blank crew with no trade and no skill warns', has(run([sp({ tradeId: null, crew: '' })]), 'skill-blank').length === 1);
// days
ok('blank days warns', has(run([sp({ days: null })]), 'days-bad').length === 1);
ok('0 days is a warning, not an error', run([sp({ days: 0 })]).errors === 0 && has(run([sp({ days: 0 })]), 'days-bad').length === 1);
ok('1 day is fine', has(run([sp({ days: 1 })]), 'days-bad').length === 0);
// phase names
r = run([sp({ id: '1', num: '3.1', seq: 1, phase: 'Plumbing' }), sp({ id: '2', num: '3.2', seq: 2, phase: 'Plumbng' }), sp({ id: '3', num: '4.1', seq: 3, phase: 'Steel' })]);
ok('phase spelled two ways warns once, naming both', has(r, 'phase-name-disagree').length === 1 && /Plumbing/.test(r.issues[0].msg) && /Plumbng/.test(r.issues[0].msg));
ok('a blank PhaseName does not disagree', has(run([sp({ id: '1', num: '3.1', seq: 1, phase: 'Plumbing' }), sp({ id: '2', num: '3.2', seq: 2, phase: '' })]), 'phase-name-disagree').length === 0);
// features
r = run([sp({ id: '1', optional: true, feature: 'Auto Cover', num: '6.4', seq: 4 }), sp({ id: '2', optional: true, feature: 'Autocover', num: '6.5', seq: 5 })]);
ok('Auto Cover and Autocover are near duplicates', has(r, 'feature-near-dup').length === 1 && /Auto Cover/.test(r.issues[0].msg) && /Autocover/.test(r.issues[0].msg));
ok('a task tag counts toward near duplicates', has(run([sp({ optional: true, feature: 'Auto Cover' })], [tk({ feature: 'auto-cover' })]), 'feature-near-dup').length === 1);
ok('case and spacing alone are one feature, not a near duplicate', has(run([sp({ optional: true, feature: 'Auto Cover' })], [tk({ feature: ' auto cover ' })]), 'feature-near-dup').length === 0);
ok('an Optional row with a blank Feature uses its title and is not an issue', run([sp({ optional: true, feature: null })]).issues.length === 0);
ok('a plain row with a Feature value is not a feature', has(run([sp({ optional: false, feature: 'Auto Cover' }), sp({ id: '2', num: '1.2', seq: 20, optional: true, feature: 'Autocover' })]), 'feature-near-dup').length === 0);
ok('a task tag with no Optional sub-phase is not an issue', run(good, [tk({ feature: 'Spa' })]).issues.length === 0);
ok('an Optional row with a blank Feature is a feature under its own title (near duplicate by title)', has(run([sp({ id: '1', optional: true, feature: null, name: 'Auto Cover', num: '6.4', seq: 4 }), sp({ id: '2', optional: true, feature: 'Autocover', num: '6.5', seq: 5 })]), 'feature-near-dup').length === 1);
// order
ok('rows listed out of Sequence order are judged in Sequence order', has(run([sp({ id: '2', num: '3.2', seq: 2 }), sp({ id: '1', num: '3.1', seq: 1 })]), 'seq-order').length === 0);
r = run([sp({ id: '1', num: '3.9', seq: 1 }), sp({ id: '2', num: '3.10', seq: 2 }), sp({ id: '3', num: '3.11', seq: 3 })]);
ok('3.10 after 3.9 is in order', has(r, 'seq-order').length === 0);
r = run([sp({ id: '1', num: '3.2', seq: 1 }), sp({ id: '2', num: '3.1', seq: 2 }), sp({ id: '3', num: '2.9', seq: 3 })]);
ok('numbers going backwards warn once, at the first pair', has(r, 'seq-order').length === 1 && /3\.2/.test(r.issues[0].msg) && /3\.1/.test(r.issues[0].msg));
ok('cmpNum compares segments numerically', T.cmpNum('3.10', '3.9') > 0 && T.cmpNum('3.9', '3.10') < 0 && T.cmpNum('3.1', '3.1') === 0);
// tasks
r = run(good, [tk({ subId: '999' })]);
ok('a task under no sub-phase is an error', has(r, 'task-orphan').length === 1 && /Mark corners/.test(r.issues[0].ref));
ok('a task with a blank sub-phase is an orphan', has(run(good, [tk({ subId: null })]), 'task-orphan').length === 1);
r = run(good.concat([sp({ id: '9', buildType: 'Fiberglass', num: '1.1', seq: 10 })]), [tk({ buildType: 'Gunite', subId: '9' })]);
ok('a task of one type under the other type is an error', has(r, 'task-type-mismatch').length === 1);
// ordering and counts
r = run([sp({ id: '1', num: '1.1', days: 0, seq: 1 }), sp({ id: '2', num: '1.6', crew: 'devin', seq: 6 }), sp({ id: '3', num: '1.9', buildType: 'Fiberglass', crew: 'zzz', seq: 9 }), sp({ id: '4', num: '1.2', crew: 'qqq', seq: 2 })]);
ok('errors sort before warnings, then build type, then Sequence',
  r.issues.map(i => i.level[0] + i.buildType[0] + (i.ref.match(/1\.\d/) || [''])[0]).join() === 'eF1.9,eG1.2,eG1.6,wG1.1', r.issues.map(i => i.level + ':' + i.ref).join());
ok('counts add up', r.errors === 3 && r.warnings === 1 && r.errors + r.warnings === r.issues.length);
ok('every issue carries the plain-text fields', r.issues.every(i => i.level && i.kind && i.buildType && i.ref && i.msg && i.fix && !('_seq' in i)));

// ---------------- Part A2: the Graph mapping
const R = M.templateRowsFrom(G.spt, G.tpt, G.trades);
ok('mapper yields 91 sub-phase rows, 543 task rows, 26 trades', R.spt.length === 91 && R.tpt.length === 543 && R.trades.length === 26, [R.spt.length, R.tpt.length, R.trades.length].join('/'));
const g1 = { fields: { id: 7, BuildType: 'Fiberglass', SubPhaseNumber: '2.3', Title: 'X', PhaseName: 'P', Sequence: '4', DefaultCrew: ' devin ', TradeLookupId: '5', Skill: ' dig ', DurationDays: '3', Optional: true, Feature: ' Spa ' } };
const m1 = M.templateRowsFrom([g1], [{ fields: { id: 8, BuildType: 'Fiberglass', Title: 'T', SubPhaseLookupId: 7, Sequence: 2, Feature: '' } }], [{ fields: { id: 5, TradeCode: 'dig' } }]);
ok('a Graph spt row maps to the check shape', JSON.stringify(m1.spt[0]) === JSON.stringify({ id: '7', buildType: 'Fiberglass', num: '2.3', name: 'X', phase: 'P', seq: 4, crew: 'devin', tradeId: '5', skill: 'dig', days: 3, optional: true, feature: 'Spa' }), JSON.stringify(m1.spt[0]));
ok('a Graph tpt row maps, its lookup keyed as a string', JSON.stringify(m1.tpt[0]) === JSON.stringify({ id: '8', buildType: 'Fiberglass', title: 'T', subId: '7', seq: 2, feature: null }), JSON.stringify(m1.tpt[0]));
ok('trades map to id and code', JSON.stringify(m1.trades) === JSON.stringify([{ id: '5', code: 'dig' }]));
const m2 = M.templateRowsFrom([{ fields: { id: 1 } }], [{ fields: {} }], [{ fields: {} }]);
ok('a bare row maps without throwing, blanks stay null', m2.spt[0].seq === null && m2.spt[0].days === null && m2.tpt[0].subId === null);
ok('missing arrays map to empty', M.templateRowsFrom().spt.length === 0 && M.crewCodesFrom().length === 0);
ok('crew codes are trimmed and blanks dropped', M.crewCodesFrom([{ fields: { CrewID: ' devon ' } }, { fields: { CrewID: '' } }, { fields: {} }, { fields: { CrewID: 'stl' } }]).join() === 'devon,stl');
const pl = M.toPlannerPayload({ jobs: [], spt: G.spt, tpt: G.tpt, trades: G.trades, crews: [{ fields: { CrewID: 'devon' } }] });
ok('the payload carries templateRows, trades and crews, and still carries templates', pl.templateRows.spt.length === 91 && pl.templateRows.trades.length === 26 && pl.crews.join() === 'devon' && pl.templates.Gunite.length > 0);
ok('a payload with no crews list carries []', M.toPlannerPayload({ jobs: [] }).crews.length === 0);

// The live capture
const live = T.check({ spt: R.spt, tpt: R.tpt, trades: R.trades, crews: CREWS });
console.log('live fixture: ' + live.errors + ' errors, ' + live.warnings + ' warnings'); live.issues.forEach(i => console.log('  ' + i.level + ' ' + i.kind + ' · ' + i.ref + ' · ' + i.msg));
ok('the live capture of both templates checks out', live.issues.length === 0, live.issues.length + ' issues');
const liveBadCrew = T.check({ spt: R.spt, tpt: R.tpt, trades: R.trades, crews: CREWS.filter(c => c !== 'harrison') });
ok('the live capture is not vacuous: dropping one crew from the list raises errors', liveBadCrew.errors > 0, String(liveBadCrew.errors));

// ---------------- Part B: the card in the page
const UIL = [{ id: '14', Title: 'Cody Campbell', Name: 'i:0#.f|membership|cody@d2pools.com', EMail: 'cody@d2pools.com' }].map(f => ({ id: f.id, fields: f }));
const MSAL_STUB = `<script>window.msal={PublicClientApplication:class{constructor(){} getActiveAccount(){return {username:'cody@d2pools.com'};} setActiveAccount(){} getAllAccounts(){return [{username:'cody@d2pools.com'}];} acquireTokenSilent(){return Promise.resolve({accessToken:'t'});} loginPopup(){return Promise.resolve({accessToken:'t',account:{username:'cody@d2pools.com'}});}}};</script>`;
let FAILCREWS = false;
const DATA = { spt: G.spt, tpt: G.tpt, crews: CREWS.map((c, i) => ({ id: String(i + 1), fields: { id: String(i + 1), CrewID: c } })) };
function boot(opts) {
  opts = opts || {};
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL_STUB)
    .replace('<script src="features-core.js"></script>', inline('features-core.js'))
    .replace('<script src="template-check-core.js"></script>', opts.noCheck ? '' : inline('template-check-core.js'))
    .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
    .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
    .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
    .replace('</body>', `<script>window.__x=()=>{Object.defineProperty(window,'S',{get:()=>S,configurable:true});window.getUI=()=>UI;window.D2_GRAPH=D2_GRAPH;
      window.render=render;window.refreshLive=refreshLive;window.setTab=t=>{TAB=t;};};</script><script>__x();</script></body>`);
  const errs = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u) => {
        u = String(u);
        const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
        if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
        if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: G.siteId, webUrl: G.site });
        if (u.includes('User Information List')) return json(200, { value: UIL });
        const L = w.D2_GRAPH && w.D2_GRAPH.lists;
        if (L) for (const k of Object.keys(L)) if (u.includes('/lists/' + L[k] + '/items')) return k === 'crews' && FAILCREWS ? json(500, {}) : json(200, { value: DATA[k] || G[k] || [] });
        if (/\/lists\/[^/]+\/items/.test(u)) return json(200, { value: [] });
        return json(404, {});
      };
    } });
  const w = dom.window; w.alert = () => {}; w.confirm = () => true;
  return { w, errs };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let { w, errs } = boot(); await wait(1200);
  const main = () => w.document.getElementById('main').innerHTML;
  const text = () => w.document.getElementById('main').textContent;
  w.setTab('phases'); w.render();
  ok('before any Refresh the tab shows no check card', !/Template check/.test(text()));
  ok('the Crews list GUID is read on Refresh', w.D2_GRAPH.lists.crews === '45e9ff1f-bf36-4ab5-929d-25ab9a80d460');
  await w.refreshLive(true); await wait(900); w.setTab('phases'); w.render();
  ok('Refresh stores the template rows and the crew codes', w.S.templateRows && w.S.templateRows.spt.length === 91 && w.S.crewCodes.length === 14);
  ok('the clean fixture shows "Templates check out"', /Templates check out: 91 sub-phases and 543 tasks across both build types, nothing to fix/.test(text()), text().slice(0, 200));
  ok('the card sits above the Build phases card', main().indexOf('Template check') > -1 && main().indexOf('Template check') < main().indexOf('Build phases'));
  // a bad crew code (with markup) and an orphan task
  const bi = G.spt.findIndex(r => r.fields.TradeLookupId != null && r.fields.BuildType === 'Gunite');
  const bad = JSON.parse(JSON.stringify(G.spt[bi])); bad.fields.DefaultCrew = 'devin<svg id="xss-probe">';
  const spt2 = G.spt.slice(); spt2[bi] = bad;
  const tpt2 = G.tpt.slice(); const orphan = JSON.parse(JSON.stringify(G.tpt[0])); orphan.fields.SubPhaseLookupId = '99999'; orphan.fields.Title = 'Contract review<i id="xss-ref">'; tpt2[0] = orphan;
  DATA.spt = spt2; DATA.tpt = tpt2;
  await w.refreshLive(true); await wait(900); w.getUI().tplChkOpen = true; w.setTab('phases'); w.render();
  ok('the summary counts the issues', /2 issues to fix/.test(text()) && /2 errors/.test(text()) && /0 warnings/.test(text()), text().slice(0, 300));
  ok('the bad crew code appears as text', /devin<svg id="xss-probe">/.test(text()));
  ok('and as escaped markup, never an element, in the message and in the ref', w.document.getElementById('xss-probe') === null && w.document.getElementById('xss-ref') === null && /Contract review<i id="xss-ref">/.test(text()));
  ok('the card opens when UI.tplChkOpen is set', /<details class="chk" open/.test(main().slice(0, main().indexOf('Build phases'))));
  ok('each line shows the ref in bold and a fix', /<b>Gunite[^<]*<\/b>/.test(main()) && /class="fix"/.test(main()));
  ok('the orphan task is named', /Contract review/.test(text()) && /not under any sub-phase/.test(text()));
  // absent without rows
  delete w.S.templateRows; w.render();
  ok('without template rows the card is absent and the tab still renders', !/Template check/.test(text()) && /Build phases/.test(text()));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  // absent without the module
  DATA.spt = G.spt; DATA.tpt = G.tpt;
  const b = boot({ noCheck: true }); await wait(1200);
  await b.w.refreshLive(true); await wait(900); b.w.setTab('phases'); b.w.render();
  ok('without the check module the tab renders as before, no card, no throw', !/Template check/.test(b.w.document.getElementById('main').textContent) && /Build phases/.test(b.w.document.getElementById('main').textContent) && b.errs.length === 0, b.errs.join('|'));
  // an unreadable Crews list costs the check, never the Refresh
  FAILCREWS = true;
  const c2 = boot(); await wait(1200);
  await c2.w.refreshLive(true); await wait(900); c2.w.setTab('phases'); c2.w.render();
  ok('an unreadable Crews list still lets the Refresh load the schedule and templates', c2.w.S.templateRows && c2.w.S.templateRows.spt.length === 91 && c2.w.S.templatesFrom, String(c2.w.S.templateRows));
  const c2text = c2.w.document.getElementById('main').textContent;
  ok('and the card says the crew codes were not checked, rather than reading as clean', /crew codes not checked/.test(c2text) && /Crews list could not be read/.test(c2text), c2text.slice(0, 240));
  FAILCREWS = false;
  // an old payload without the new keys leaves stored values alone
  w.S.templateRows = { spt: [], tpt: [], trades: [] }; w.S.crewCodes = ['x'];
  const old = { kind: 'd2-sharepoint-export', jobs: [], templates: {} };
  w.eval('importFromD2Payload').call(w, old, true);
  ok('an older payload leaves the stored rows and crew codes alone', w.S.crewCodes.join() === 'x' && w.S.templateRows.spt.length === 0);
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
})();
