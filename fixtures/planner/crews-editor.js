/* Crews editor: skills, crews and per-crew ratings.
 *
 * Part A: pure core (web/writeback-core.js planCrewEdits and helpers).
 * Later parts append below, each under its own marked section.
 */
const C = require('../../web/writeback-core.js');
const G = require('../../web/graph-to-planner.js');

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };
const J = JSON.stringify;
const clone = o => JSON.parse(J(o));

// ---------------------------------------------------------------- Part A: core
const fixture = () => {
  const live = {
    trades: [{ spId: '1', code: 'plumbing', label: 'Plumbing' }, { spId: '2', code: 'dig', label: 'Dig / Excavation' }],
    crews: [
      { spId: '10', id: 'harrison', name: 'Harrison', size: 3, unlimited: false, members: ['A', 'B'], note: '', overall: 3 },
      { spId: '11', id: 'devon', name: 'Devon', size: 4, unlimited: false, members: ['C'], note: '', overall: 3 }
    ],
    ct: [{ spId: '100', crewSpId: '10', tradeSpId: '1', rating: 3 }, { spId: '101', crewSpId: '11', tradeSpId: '2', rating: 2 }]
  };
  const mk = (spId, id, name, size, members, ratings, ctIds) => ({
    id, spId, isNew: false, name, size, unlimited: false, members, note: '', overall: 3, ratings, ctIds,
    base: { name, size, unlimited: false, members: members.slice(), note: '', overall: 3, ratings: clone(ratings) }
  });
  const local = {
    trades: [{ code: 'plumbing', label: 'Plumbing', sort: 1, spId: '1', isNew: false }, { code: 'dig', label: 'Dig / Excavation', sort: 2, spId: '2', isNew: false }],
    crews: [mk('10', 'harrison', 'Harrison', 3, ['A', 'B'], { plumbing: 3 }, { plumbing: '100' }),
            mk('11', 'devon', 'Devon', 4, ['C'], { dig: 2 }, { dig: '101' })]
  };
  return { local, live };
};
const plan = (mut, liveMut) => {
  const f = fixture();
  if (mut) mut(f.local, f.live);
  if (liveMut) liveMut(f.live);
  return C.planCrewEdits(f.local, f.live, {});
};
const harrison = l => l.crews[0];
const newCrew = (id, extra) => Object.assign({ id, spId: null, isNew: true, name: id, size: 2, unlimited: false, members: [], note: '', overall: 3,
  ratings: {}, ctIds: {}, base: { name: '', size: null, unlimited: false, members: [], note: '', overall: 3, ratings: {} } }, extra || {});

ok('rating words', C.ratingWord(3) === 'First choice' && C.ratingWord(2) === 'Second choice' && C.ratingWord(1) === 'Last resort' && C.ratingWord(0) === 'Never');
ok('rating word of null is empty', C.ratingWord(null) === '' && C.ratingWord(undefined) === '');
ok('skillKey ignores case, spaces and punctuation', C.skillKey('Dig / Excavation') === 'digexcavation' && C.skillKey(' gas-line ') === 'gasline');
ok('slugCode suffixes a collision and refuses an empty key', C.slugCode('Dig', ['dig']) === 'dig2' && C.slugCode('***', []) === null);
ok('slugCode keeps counting past a second collision', C.slugCode('Dig', ['dig', 'dig2']) === 'dig3' && C.slugCode('Dig', []) === 'dig');
{
  const probe = [null, undefined, '', 'x', 7, -1, '2', 2.6];
  ok('normRating agrees with the mapper copy', J(probe.map(C.normRating)) === J(probe.map(G.normRating)) && J(probe.map(C.normRating)) === J([3, 3, 3, 3, 3, 0, 2, 3]),
    J(probe.map(C.normRating)));
}

{
  const r = plan();
  ok('an unchanged crew produces no ops and no refusals', J(r) === J({ ops: [], refusals: [] }), J(r));
}
{
  const r = plan(l => { harrison(l).ratings.plumbing = 2; });
  ok('a one-rating change 3 -> 2 is exactly one ct-patch',
    J(r.ops) === '[{"kind":"ct-patch","spId":"100","crewCode":"harrison","tradeCode":"plumbing","rating":2}]' && r.refusals.length === 0, J(r));
}
{
  const r = plan(l => { delete harrison(l).ratings.plumbing; });
  ok('a chip turned off is one ct-delete',
    J(r.ops) === '[{"kind":"ct-delete","spId":"100","crewCode":"harrison","tradeCode":"plumbing"}]' && r.refusals.length === 0, J(r));
}
{
  const r = plan(l => { harrison(l).ratings.dig = 3; });
  ok('a chip turned on is one ct-create at rating 3',
    J(r.ops) === '[{"kind":"ct-create","crewCode":"harrison","tradeCode":"dig","rating":3}]' && r.refusals.length === 0, J(r));
}
{
  const r = plan(l => {
    l.trades.push({ code: 'gas', label: 'Gas', sort: 30, spId: null, isNew: true });
    harrison(l).ratings.gas = 3;
  });
  ok('a new skill is created before the ct-create that points at it',
    J(r.ops) === '[{"kind":"trade-create","label":"Gas","code":"gas","sort":30},{"kind":"ct-create","crewCode":"harrison","tradeCode":"gas","rating":3}]', J(r));
}
{
  const r = plan(l => { l.crews.push(newCrew('newco', { name: 'New Co', members: ['X'], note: 'n', ratings: { plumbing: 2 } })); });
  ok('a new crew is created Active at Preference 3, its ct-creates after it',
    J(r.ops) === '[{"kind":"crew-create","id":"newco","fields":{"Title":"New Co","CrewID":"newco","Size":2,"Unlimited":false,"Active":true,"Members":"X","Notes":"n","Preference":3}},{"kind":"ct-create","crewCode":"newco","tradeCode":"plumbing","rating":2}]', J(r));
}
{
  const r = plan(l => { harrison(l).ratings.plumbing = 2; harrison(l).size = 4; }, lv => { lv.ct[0].rating = 1; });
  ok('a rating that moved since load refuses the ct-patch and still lands the sibling crew-patch',
    J(r.ops) === '[{"kind":"crew-patch","spId":"10","id":"harrison","fields":{"Size":4}}]'
    && J(r.refusals) === '[{"kind":"ct-patch","crew":"harrison","trade":"plumbing","reason":"diverged","loaded":3,"nowLive":1,"wanted":2}]', J(r));
}
{
  const r = plan(l => { harrison(l).size = 5; harrison(l).note = 'x'; }, lv => { lv.crews[0].size = 9; });
  ok('a crew field that moved since load is refused per field, a sibling field still lands',
    J(r.ops) === '[{"kind":"crew-patch","spId":"10","id":"harrison","fields":{"Notes":"x"}}]'
    && J(r.refusals) === '[{"kind":"crew-patch","crew":"harrison","trade":null,"reason":"diverged","loaded":3,"nowLive":9,"wanted":5,"field":"Size"}]', J(r));
}
{
  const r = plan(l => { harrison(l).members = ['Devon', '', 'Martin ']; });
  ok('Members is trimmed, blanks dropped and joined with a comma',
    J(r.ops) === '[{"kind":"crew-patch","spId":"10","id":"harrison","fields":{"Members":"Devon, Martin"}}]', J(r));
  const s = plan(l => { harrison(l).members = 'Devon, , Martin '; });
  ok('Members given as one string is read the same way', J(s.ops) === J(r.ops), J(s));
}
{
  const r = plan(l => { l.trades.push({ code: 'dig2', label: 'Dig/Excavation', sort: 9, spId: null, isNew: true }); harrison(l).ratings.dig2 = 3; });
  ok('a new skill whose key matches a live label is refused duplicate-skill, and its chips are not sent',
    J(r.ops) === '[]'
    && J(r.refusals.filter(x => x.kind === 'trade-create')) === '[{"kind":"trade-create","crew":null,"trade":"dig2","reason":"duplicate-skill","loaded":null,"nowLive":"Dig / Excavation","wanted":"Dig/Excavation"}]'
    && r.refusals.some(x => x.kind === 'ct-create' && x.reason === 'skill-refused'), J(r));
  const s = plan(l => { l.trades.push({ code: 'xx', label: 'DIG', sort: 9, spId: null, isNew: true }); });
  ok('a new skill whose key matches a live CODE is refused too (a label-only check would miss it)',
    s.refusals.length === 1 && s.refusals[0].reason === 'duplicate-skill' && s.ops.length === 0, J(s));
}
{
  const r = plan(l => { harrison(l).overall = 0; });
  ok('overall 0 is one crew-patch of {Preference:0}; Active is never touched',
    J(r.ops) === '[{"kind":"crew-patch","spId":"10","id":"harrison","fields":{"Preference":0}}]' && J(r).indexOf('Active') === -1, J(r));
}
{
  const r = plan(l => { delete harrison(l).ratings.plumbing; }, lv => { lv.ct[0].rating = 1; });
  ok('a ct-delete is refused when the live rating moved',
    J(r.ops) === '[]' && J(r.refusals) === '[{"kind":"ct-delete","crew":"harrison","trade":"plumbing","reason":"diverged","loaded":3,"nowLive":1,"wanted":null}]', J(r));
}
{
  const r = plan(l => { harrison(l).ratings.dig = 3; }, lv => { lv.ct.push({ spId: '102', crewSpId: '10', tradeSpId: '2', rating: 1 }); });
  ok('a ct-create is refused already-exists when a live row holds the pair',
    J(r.ops) === '[]' && J(r.refusals) === '[{"kind":"ct-create","crew":"harrison","trade":"dig","reason":"already-exists","loaded":null,"nowLive":1,"wanted":3}]', J(r));
}
{
  const r = plan(l => { l.crews.push(newCrew('devon', { ratings: { dig: 3 } })); });
  ok('a new crew whose code is live is refused code-exists, and its chips are not sent',
    J(r.ops) === '[]' && r.refusals.length === 2 && r.refusals[0].kind === 'crew-create' && r.refusals[0].reason === 'code-exists' && r.refusals[0].crew === 'devon'
    && r.refusals[1].kind === 'ct-create' && r.refusals[1].reason === 'crew-refused', J(r));
}
{
  const r = plan(l => { harrison(l).size = 5; }, lv => { lv.crews = lv.crews.slice(1); });
  ok('a crew deleted in SharePoint is refused row-missing',
    J(r.ops) === '[]' && r.refusals.length === 1 && r.refusals[0].reason === 'row-missing', J(r));
}
{
  const r = plan(l => {
    l.trades.push({ code: 'gas', label: 'Gas', sort: 30, spId: null, isNew: true });
    harrison(l).ratings.plumbing = 2;          // ct-patch
    harrison(l).ratings.gas = 3;               // ct-create (pointing at the new skill)
    harrison(l).size = 4;                      // crew-patch
    delete l.crews[1].ratings.dig;             // ct-delete
    l.crews.push(newCrew('newco'));            // crew-create
  });
  ok('ops come out in the fixed kind order, whatever order the crews were edited in',
    J(r.ops.map(o => o.kind)) === '["trade-create","crew-create","crew-patch","ct-create","ct-patch","ct-delete"]' && r.refusals.length === 0, J(r.ops.map(o => o.kind)));
}

// ---------------------------------------------------------------- Part B: Graph write
// Every body is compared with a request body captured live on 2026-10-29
// (fixtures/planner/crew-capture.json), never retyped here.
(async () => {
  const GW = require('../../web/graph-writeback.js');
  const CAP = require('./crew-capture.json');
  const cap = name => CAP.requests.find(r => r.op === name);
  const L = { trades: CAP.lists.trades, crews: CAP.lists.crews, ct: CAP.lists.ct };
  const mkCtx = (script, extra) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      const call = { method: init.method, url: url.replace(/^.*\/sites\/SITE/, ''), body: init.body == null ? undefined : JSON.parse(init.body) };
      calls.push(call);
      const s = script(call) || {};
      const status = s.status || (call.method === 'POST' ? 201 : call.method === 'DELETE' ? 204 : 200);
      return { ok: status < 300, status, json: async () => (s.json !== undefined ? s.json : (call.method === 'POST' ? { id: s.id || '1' } : {})) };
    };
    return { calls, ctx: Object.assign({ token: 'T', siteId: 'SITE', lists: L, crewSpIdByCode: {}, tradeSpIdByCode: {}, fetchImpl, sleep: async () => {} }, extra || {}) };
  };
  const idByList = c => (c.url.includes(L.trades) ? '27' : c.url.includes(L.crews) ? '15' : '53');
  const ops = [
    { kind: 'trade-create', label: 'ZZ Capture Skill', code: 'zzcapture', sort: 999 },
    { kind: 'crew-create', id: 'zzcapture', fields: cap('crew-create').body.fields },
    { kind: 'ct-create', crewCode: 'zzcapture', tradeCode: 'zzcapture', rating: 2 },
    { kind: 'ct-patch', spId: '53', crewCode: 'zzcapture', tradeCode: 'zzcapture', rating: 1 },
    { kind: 'crew-patch', spId: '15', id: 'zzcapture', fields: { Members: 'A, B, C' } },
    { kind: 'ct-delete', spId: '53', crewCode: 'zzcapture', tradeCode: 'zzcapture' }
  ];

  ok('applyCrewOps and the body builders are exported', typeof GW.applyCrewOps === 'function' && typeof GW.ctBody === 'function'
    && typeof GW.tradeBody === 'function' && typeof GW.crewBody === 'function' && typeof GW.ctPatchBody === 'function');
  if (typeof GW.applyCrewOps !== 'function') { console.log('\nFAILED'); process.exit(1); }

  // pure bodies against the capture
  ok('tradeBody equals the captured Trades POST body', J(GW.tradeBody(ops[0])) === J(cap('trade-create').body), J(GW.tradeBody(ops[0])));
  ok('crewBody equals the captured Crews POST body', J(GW.crewBody(ops[1])) === J(cap('crew-create').body), J(GW.crewBody(ops[1])));
  ok('ctBody equals the captured Crew-Trades POST body (lookup ids are strings)', J(GW.ctBody(ops[2], 15, 27)) === J(cap('ct-create').body), J(GW.ctBody(ops[2], 15, 27)));
  ok('ctBody Title is lower case crew-trade', GW.ctBody({ crewCode: 'Devon', tradeCode: 'HardScape', rating: 3 }, '1', '2').fields.Title === 'devon-hardscape');
  ok('ctPatchBody equals the captured PATCH body', J(GW.ctPatchBody(ops[3])) === J(cap('ct-patch').body), J(GW.ctPatchBody(ops[3])));

  // a full happy run
  {
    const { calls, ctx } = mkCtx(c => ({ id: idByList(c) }));
    const r = await GW.applyCrewOps(ctx, ops);
    ok('happy run: six calls in op order', J(calls.map(c => c.method)) === '["POST","POST","POST","PATCH","PATCH","DELETE"]', J(calls.map(c => c.method)));
    ok('happy run: every captured body matches, field for field',
      J(calls[0].body) === J(cap('trade-create').body) && J(calls[1].body) === J(cap('crew-create').body)
      && J(calls[2].body) === J(cap('ct-create').body) && J(calls[3].body) === J(cap('ct-patch').body)
      && J(calls[4].body) === J(cap('crew-patch').body), J(calls.map(c => c.body)));
    ok('happy run: URLs match the captured paths',
      calls[0].url === cap('trade-create').url && calls[1].url === cap('crew-create').url && calls[2].url === cap('ct-create').url
      && calls[3].url === cap('ct-patch').url && calls[4].url === cap('crew-patch').url, J(calls.map(c => c.url)));
    ok('ct-create used the ids the same batch just created (strings)', calls[2].body.fields.CrewLookupId === '15' && calls[2].body.fields.TradeLookupId === '27'
      && typeof calls[2].body.fields.CrewLookupId === 'string');
    ok('DELETE goes to /items/{id}, not /fields, with no body',
      calls[5].url === cap('ct-delete').url && !/\/fields$/.test(calls[5].url) && calls[5].body === undefined, J(calls[5]));
    ok('a 204 DELETE counts as done', r.done.length === 6 && r.failed.length === 0 && r.skipped.length === 0
      && r.done[5].op === ops[5] && r.done[5].id === '53', J(r));
    ok('creates report the new row id, patches the spId', r.done[0].id === '27' && r.done[1].id === '15' && r.done[2].id === '53' && r.done[3].id === '53' && r.done[4].id === '15');
  }

  // ct-create against rows that already exist (ids from the live read)
  {
    const { calls, ctx } = mkCtx(() => ({ id: '90' }), { crewSpIdByCode: { devon: '11' }, tradeSpIdByCode: { dig: '2' } });
    const r = await GW.applyCrewOps(ctx, [{ kind: 'ct-create', crewCode: 'devon', tradeCode: 'dig', rating: 3 }]);
    ok('ct-create resolves ids from the live maps', r.done.length === 1 && calls[0].body.fields.CrewLookupId === '11' && calls[0].body.fields.TradeLookupId === '2'
      && calls[0].body.fields.Preference === 3, J(calls));
  }

  // the Crews POST fails: dependent ct-create skipped, later ct-patch still runs
  {
    const { calls, ctx } = mkCtx(c => (c.method === 'POST' && c.url.includes(L.crews) ? { status: 403, json: { error: { code: 'accessDenied' } } } : { id: idByList(c) }));
    const r = await GW.applyCrewOps(ctx, ops.slice(0, 4));
    ok('403 on Crews POST is a failure with status and parsed detail', r.failed.length === 1 && r.failed[0].op === ops[1] && r.failed[0].status === 403
      && r.failed[0].detail && r.failed[0].detail.error.code === 'accessDenied', J(r.failed));
    ok('its dependent ct-create is skipped depends-on-failed, with no call made',
      r.skipped.length === 1 && r.skipped[0].op === ops[2] && r.skipped[0].reason === 'depends-on-failed' && calls.length === 3, J(r.skipped));
    ok('a later ct-patch still runs and lands in done', r.done.some(d => d.op === ops[3]) && calls[2].method === 'PATCH');
    ok('the trade create before the failure is still done', r.done.some(d => d.op === ops[0] && d.id === '27'));
  }

  // a ct-create with no id anywhere is skipped, not sent
  {
    const { calls, ctx } = mkCtx(() => ({}));
    const r = await GW.applyCrewOps(ctx, [{ kind: 'ct-create', crewCode: 'ghost', tradeCode: 'dig', rating: 2 }]);
    ok('a ct-create with an unknown crew is skipped without a call', r.skipped.length === 1 && calls.length === 0 && r.done.length === 0);
  }

  // a failed DELETE is a failure; the loop goes on
  {
    const { calls, ctx } = mkCtx(c => (c.method === 'DELETE' ? { status: 404, json: { error: 'gone' } } : {}));
    const r = await GW.applyCrewOps(ctx, [ops[5], ops[4]]);
    ok('a failed DELETE is recorded and the next op still runs', r.failed.length === 1 && r.failed[0].status === 404 && r.done.length === 1 && calls.length === 2);
  }

  // POST goes through the 429 retry
  {
    let n = 0;
    const waits = [];
    const { calls, ctx } = mkCtx(() => (++n === 1 ? { status: 429 } : { id: '27' }));
    ctx.sleep = async ms => { waits.push(ms); };
    const r = await GW.applyCrewOps(ctx, [ops[0]]);
    ok('a 429 on a POST is retried', r.done.length === 1 && calls.length === 2 && waits.length === 1, J({ calls: calls.length, waits }));
  }

  // ---------------------------------------------------------------- Part C: planner read
  {
    const fs = require('fs'), path = require('path');
    const { JSDOM, VirtualConsole } = require('jsdom');
    const WEB = path.join(__dirname, '..', '..', 'web');
    const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-payloads-graph.json'), 'utf8'));
    const HOST = 'https://mango-sky-0d6904310.5.azurestaticapps.net';
    const CODES = FX.crews.map(r => r.fields.CrewID).filter(c => c !== 'campos');
    const MSAL = `<script>window.msal={PublicClientApplication:class{constructor(){} getActiveAccount(){return {username:'cody@d2pools.com'};} setActiveAccount(){} getAllAccounts(){return [{username:'cody@d2pools.com'}];} acquireTokenSilent(){return Promise.resolve({accessToken:'t'});} loginPopup(){return Promise.resolve({accessToken:'t',account:{username:'cody@d2pools.com'}});}}};</script>`;
    const bootC = stored => {
      const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
      const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
        .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL)
        .replace('<script src="features-core.js"></script>', inline('features-core.js'))
        .replace('<script src="template-check-core.js"></script>', inline('template-check-core.js'))
        .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
        .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
        .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
        .replace('</body>', `<script>Object.defineProperty(window,'S',{get:()=>S,configurable:true});window.crew=crew;window.ratingFor=ratingFor;window.qualified=qualified;window.isQualified=isQualified;window.assignable=assignable;window.skillLabel=skillLabel;window.skillList=skillList;window.importFromD2Payload=importFromD2Payload;window.refreshLive=refreshLive;window.D2_GRAPH=D2_GRAPH;</script></body>`);
      const vc = new VirtualConsole();
      const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
        beforeParse(w) {
          if (stored) w.localStorage.setItem('poolsched.v6', JSON.stringify(stored));
          w.fetch = u => {
            u = String(u);
            const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
            if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
            if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: FX.siteId, webUrl: FX.site });
            if (u.includes('User Information List')) return json(200, { value: [] });
            if (/\/lists\/[^/]+\/columns/.test(u)) return json(200, { value: [{ name: 'Title' }, { name: 'Crew', choice: { choices: CODES } }] });
            const L = w.D2_GRAPH && w.D2_GRAPH.lists;
            if (L) for (const k of Object.keys(L)) if (u.includes('/lists/' + L[k] + '/items')) return json(200, { value: FX[k] || [] });
            if (/\/lists\/[^/]+\/items/.test(u)) return json(200, { value: [] });
            return json(404, {});
          };
        } });
      const w = dom.window; w.alert = () => {}; w.confirm = () => true;
      return w;
    };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const win = bootC(); await wait(1200);
    await win.refreshLive(true); await wait(900);
    const S = win.S;
    ok('S.crews comes from SharePoint after Refresh', S.crews.length === 14 && S.crews.every(c => c.spId));
    ok('harrison plumbing rating 3, base recorded', win.ratingFor(win.crew('harrison'), 'plumbing') === 3 && win.crew('harrison').base.ratings.plumbing === 3);
    ok('S.trades has 26 skills and skillLabel reads them', S.trades.length === 26 && win.skillLabel('plumbing') === 'Plumbing');
    ok('skillLabel and skillList follow the Trades list', (() => { const t = S.trades.find(x => x.code === 'dig'); t.label = 'Dig Renamed'; return win.skillLabel('dig') === 'Dig Renamed' && win.skillList().length === 26 && win.skillList().some(x => x.id === 'dig' && x.label === 'Dig Renamed'); })());
    ok('a crew rated 0 for a trade is not qualified for it', (() => { win.crew('harrison').ratings.plumbing = 0; return !win.qualified('plumbing').some(c => c.id === 'harrison') && !win.isQualified(win.crew('harrison'), 'plumbing'); })());
    ok('a crew at overall 0 is qualified for nothing', (() => { const c = win.crew('stl'); c.overall = 0; return !win.qualified('shotcrete').some(x => x.id === 'stl') && !win.isQualified(c, 'shotcrete'); })());
    ok('overall 1 changes nothing', (() => { const c = win.crew('stl'); c.overall = 1; return win.qualified('shotcrete').some(x => x.id === 'stl'); })());
    ok('a code not in the Assignments dropdown is not assignable and not offered', !win.assignable(win.crew('campos')) && !win.qualified('demolition').some(c => c.id === 'campos'));
    ok('FIXED codes still map to their bucket crew only', win.qualified('@office').length === 1 && win.qualified('@office')[0].id === 'office');
    ok('bucket crews keep their colour', win.crew('office').color === '#334155');
    ok('an empty Crews read keeps the previous crews', (() => { const n = S.crews.length; win.importFromD2Payload({ kind: 'd2-sharepoint-export', jobs: [], crewRows: null }, true); return S.crews.length === n; })());
    ok('unreadable columns make every crew assignable', (() => { win.importFromD2Payload({ kind: 'd2-sharepoint-export', jobs: [], assignableCodes: null }, true); return S.assignableCodes === null && win.assignable(win.crew('campos')); })());
    const win2 = bootC({ crews: [{ id: 'devon', name: 'Devon Crew +3', members: [], size: 4, skills: ['dig'] }], jobs: [], settings: {}, templates: {}, pendingCreates: [], pendingComments: [] });
    await wait(600);
    ok('a stored legacy crew with a skills array migrates to ratings of 3', (() => {
      const c = win2.crew('devon'); return !!c && c.ratings && c.ratings.dig === 3 && c.overall === 3 && c.skills === undefined; })());
    win.close(); win2.close();
  }

  // ---------------------------------------------------------------- Part D: Crews tab editor
  {
    const fs = require('fs'), path = require('path');
    const { JSDOM, VirtualConsole } = require('jsdom');
    const WEB = path.join(__dirname, '..', '..', 'web');
    const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-payloads-graph.json'), 'utf8'));
    const HOST = 'https://mango-sky-0d6904310.5.azurestaticapps.net';
    const CODES = FX.crews.map(r => r.fields.CrewID).filter(c => c !== 'campos');
    const MSAL = `<script>window.msal={PublicClientApplication:class{constructor(){} getActiveAccount(){return {username:'cody@d2pools.com'};} setActiveAccount(){} getAllAccounts(){return [{username:'cody@d2pools.com'}];} acquireTokenSilent(){return Promise.resolve({accessToken:'t'});} loginPopup(){return Promise.resolve({accessToken:'t',account:{username:'cody@d2pools.com'}});}}};</script>`;
    const bootD = () => {
      const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
      const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
        .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL)
        .replace('<script src="features-core.js"></script>', inline('features-core.js'))
        .replace('<script src="template-check-core.js"></script>', inline('template-check-core.js'))
        .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
        .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
        .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
        .replace('</body>', `<script>Object.defineProperty(window,'S',{get:()=>S,configurable:true});window.crew=crew;window.ratingFor=ratingFor;window.qualified=qualified;window.D2_GRAPH=D2_GRAPH;window.importFromD2Payload=importFromD2Payload;window.refreshLive=refreshLive;window.setTab=t=>{TAB=t;render();};</script></body>`);
      const vc = new VirtualConsole();
      const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
        beforeParse(w) {
          w.fetch = u => {
            u = String(u);
            const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
            if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
            if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: FX.siteId, webUrl: FX.site });
            if (u.includes('User Information List')) return json(200, { value: [] });
            if (/\/lists\/[^/]+\/columns/.test(u)) return json(200, { value: [{ name: 'Title' }, { name: 'Crew', choice: { choices: CODES } }] });
            const L = w.D2_GRAPH && w.D2_GRAPH.lists;
            if (L) for (const k of Object.keys(L)) if (u.includes('/lists/' + L[k] + '/items')) return json(200, { value: FX[k] || [] });
            if (/\/lists\/[^/]+\/items/.test(u)) return json(200, { value: [] });
            return json(404, {});
          };
        } });
      const w = dom.window; w.alert = () => {}; w.confirm = () => true;
      return w;
    };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const win = bootD();
    for (let t = 0; t < 150 && typeof win.refreshLive !== 'function'; t++) await wait(100);
    await wait(1500);
    await win.refreshLive(true);
    for (let t = 0; t < 150 && !(win.S.crews.length === 14 && win.S.crews.every(c => c.spId) && win.S.trades && win.S.trades.length === 26); t++) await wait(100);
    await wait(500);
    win.setTab('crews');
    const S = win.S;
    const main = () => win.document.getElementById('main').textContent;
    const chipFor = (crewId, code) => win.document.querySelector(`.chip[data-crew="${crewId}"][data-skill="${code}"]`);
    const payloadWithOneJob = { kind: 'd2-sharepoint-export', exported: '2026-10-29', nonWork: [], jobs: [{ id: 1, jobno: 'T-1', name: 'T one', addr: '', city: '', start: '2026-11-02', status: 'Planned', pm: 'x', sections: [] }] };

    ok('D: no delete control anywhere on the Crews tab', !/delCrew|✕/.test(win.document.getElementById('main').innerHTML));
    ok('D: a held chip shows its word', !!chipFor('harrison', 'plumbing') && /First choice/.test(chipFor('harrison', 'plumbing').textContent));
    ok('D: clicking cycles 3,2,1,0,off', (() => { const seq = []; for (let i = 0; i < 5; i++) { chipFor('harrison', 'plumbing').click(); seq.push(win.ratingFor(win.crew('harrison'), 'plumbing')); } return seq.join(',') === '2,1,0,,3'; })());
    ok('D: an off chip starts at First choice when clicked', (() => { const c = win.crew('harrison'); delete c.ratings.gas; win.render(); chipFor('harrison', 'gas').click(); return win.ratingFor(c, 'gas') === 3; })());
    ok('D: overall control writes c.overall and the crew stays on the list', (() => { const n = S.crews.length; win.setOverall('stl', 0); return win.crew('stl').overall === 0 && S.crews.length === n && win.crew('stl').active !== false; })());
    ok('D: buckets have no chips or overall control', !chipFor('office', 'dig') && !win.document.getElementById('main').innerHTML.includes("setOverall('office'"));
    ok('D: Skill Coverage omits a crew rated Never for the skill', (() => {
      win.crew('stl').ratings.shotcrete = 0; win.render();
      const rows = [...win.document.querySelectorAll('tr')].filter(r => r.firstElementChild && r.firstElementChild.textContent.trim() === 'Shotcrete / Gunite');
      return rows.length === 1 && !/STL Shotcrete/.test(rows[0].textContent); })());
    ok('D: Skill Coverage suffixes the rating word', (() => {
      win.crew('harrison').ratings.plumbing = 2; win.render();
      const rows = [...win.document.querySelectorAll('tr')].filter(r => r.firstElementChild && r.firstElementChild.textContent.trim() === 'Plumbing');
      return rows.length === 1 && /Harrison \+2 · Second choice/.test(rows[0].textContent); })());
    ok('D: a Subcontractor tick on an existing crew asks first and Cancel changes nothing', (() => { let q = ''; win.confirm = m => { q = m; return false; }; win.setCrew('devon', 'unlimited', true); return win.crew('devon').unlimited === false && /no longer count as busy/.test(q); })());
    ok('D: a confirmed Subcontractor tick lands and unticking asks too', (() => { win.confirm = () => true; win.setCrew('devon', 'unlimited', true); const r = win.crew('devon').unlimited === true; let q = ''; win.confirm = m => { q = m; return true; }; win.setCrew('devon', 'unlimited', false); return r && win.crew('devon').unlimited === false && /count as busy again/.test(q); })());
    ok('D: + Skill refuses a duplicate ignoring case, spaces and punctuation', (() => { win.prompt = () => 'DIG /  excavation'; let msg = ''; win.alert = m => msg = m; win.addSkill(); return /already on the list/.test(msg) && S.trades.length === 26; })());
    ok('D: + Skill adds a trade with a code and the next sort', (() => { win.prompt = () => 'Electrical'; win.addSkill(); const t = S.trades.find(x => x.label === 'Electrical'); return t && t.code === 'electrical' && t.isNew && t.sort === 27; })());
    ok('D: + Crew refuses a taken code', (() => { const answers = ['Devon Two', 'devon']; win.prompt = () => answers.shift(); let msg = ''; win.alert = m => msg = m; const n = S.crews.length; win.addCrew(); return /already taken/.test(msg) && S.crews.length === n; })());
    ok('D: + Crew adds a local crew at overall 3 with no skills', (() => { const answers = ['Lopez +2', 'lopez', '3', 'Lopez, Ana, Raul']; win.prompt = () => answers.shift(); win.confirm = () => false; win.addCrew(); const c = win.crew('lopez'); return c && c.spId === null && c.isNew && c.overall === 3 && Object.keys(c.ratings).length === 0 && c.unlimited === false && c.size === 3 && c.members.length === 3; })());
    ok('D: Save is enabled by a crew change alone', (() => { win.render(); return !win.document.getElementById('saveBtn').disabled; })());
    ok('D: buildCrewChanges words the changes', (() => {
      const b = win.buildCrewChanges();
      return b.count === b.lines.length && b.lines.includes('Harrison +2, Plumbing: First choice to Second choice') && b.lines.includes('STL Shotcrete: overall Never') && b.lines.includes('New skill: Electrical') && b.lines.includes('New crew: Lopez +2, code lopez'); })());
    ok('D: buildCrewChanges local shape feeds planCrewEdits', (() => {
      const b = win.buildCrewChanges();
      return b.local.trades.length === 1 && b.local.trades[0].code === 'electrical' && b.local.crews.some(c => c.id === 'lopez' && c.isNew) && b.local.crews.some(c => c.id === 'stl' && c.overall === 0 && c.base.overall === 3) && !b.local.crews.some(c => c.id === 'office'); })());
    ok('D: stopForUnsaved names the Crews tab', (() => { win.stopForUnsaved('Activate', 'Activating'); const t = win.document.getElementById('dBody').textContent; return /Crews tab/.test(t) && /Activating reloads the crew list/.test(t); })());
    ok('D: the Refresh warning counts crew changes', (() => { let text = ''; win.confirm = t => { text = t; return false; }; win.importFromD2Payload(payloadWithOneJob, false); return /changes? on the Crews tab/.test(text); })());
    ok('D: on a downloaded copy the controls are disabled and nothing counts', (() => {
      const real = win.graphModeAvailable; win.graphModeAvailable = () => false; win.render();
      const m = win.document.getElementById('main');
      const r = m.textContent.includes('Crew changes are not saved from a downloaded copy. Use the hosted planner.') && win.crewChangeCount() === 0 && !chipFor('harrison', 'plumbing').hasAttribute('onclick') && [...m.querySelectorAll('select,button,input')].every(e => e.disabled);
      win.graphModeAvailable = real; win.render(); return r; })());
    ok('D: the retire hint is on the card', /A crew that should not be used any more is set to Never overall\. It stays on the list\./.test(main()));
    ok('D: crew and skill names are escaped on the Crews tab', (() => { S.crews[0].name = 'Devon "><svg id="xss-probe"></svg>'; S.trades[0].label = 'Dig <svg id="xss-probe"></svg>'; win.render(); return win.document.getElementById('xss-probe') === null; })());
    win.close();
  }

  if (fail) { console.log('\nFAILED'); process.exit(1); }
  console.log('\nall passed');
})();
