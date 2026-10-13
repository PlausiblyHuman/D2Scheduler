// fixtures/planner/build-type-scripts.js   Run: node fixtures/planner/build-type-scripts.js
// Runs the two console scripts under Node with a recording fetch, the way restore.js runs restore-project.js.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fails = 0;
const ok = (l, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) { fails++; process.exitCode = 1; } };
const SITE = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';

function stub(state) {
  const calls = [];
  const fetch = async (u, o = {}) => {
    u = String(u); const m = o.method || 'GET'; const h = o.headers || {};
    calls.push({ u: u.replace(SITE, ''), m, h, body: o.body ? JSON.parse(o.body) : null });
    const json = b => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.endsWith('/_api/contextinfo')) return json({ d: { GetContextWebInformation: { FormDigestValue: 'dg' } } });
    if (/\/fields\?\$select=InternalName/.test(u)) { const l = decodeURIComponent(u.match(/GetByTitle\('([^']+)'\)/)[1]); return json({ value: (state.fields[l] || []).map(i => ({ InternalName: i })) }); }
    if (/\/fields\/CreateFieldAsXml/.test(u)) { const l = decodeURIComponent(u.match(/GetByTitle\('([^']+)'\)/)[1]); (state.fields[l] = state.fields[l] || []).push(JSON.parse(o.body).parameters.SchemaXml.match(/Name='([^']+)'/)[1]); return json({ d: {} }); }
    if (/getByInternalNameOrTitle\('BuildType'\)\?\$select=SchemaXml/.test(u)) return json({ SchemaXml: "<Field Type=\"Choice\" Name=\"BuildType\"><CHOICES><CHOICE>Gunite</CHOICE></CHOICES></Field>" });
    if (/\/views\?\$select=Title,Id/.test(u)) return json({ d: { results: state.views || [] } });
    if (/\/views$/.test(u) && m === 'POST') return json({ d: { Id: 'v1' } });
    if (/\/items\?\$select=Id,BuildType/.test(u) || /\/items\?\$select=Id,SubPhaseNumber,BuildType,PhaseName/.test(u)) return json({ value: state.rows });
    if (/\/items\(\d+\)$/.test(u) && m === 'POST') return json({});
    if (/SiteAssets\/template-seed\.json/.test(u)) return json(state.seed);
    if (/\/SiteAssets\/[^/?]+\.json/.test(u)) return json(state.seed);
    if (/Sub-phase%20Template'\)\/items\?\$select=Id,SubPhaseNumber,BuildType/.test(u)) return json({ value: state.sub || [] });
    if (/Task%20Template'\)\/items\?\$select=Id,SubPhaseId,Sequence/.test(u)) return json({ value: state.tasks || [] });
    if (/Trades'\)\/items/.test(u)) return json({ value: [{ Id: 7, TradeCode: 'demolition' }] });
    if (m === 'POST' && /\/items$/.test(u)) return json({ d: { Id: 100 + state.n++ } });
    return json({ value: [] });
  };
  return { fetch, calls };
}
async function runScript(file, state) {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'sharepoint', file), 'utf8');
  const s = stub(state);
  const ctx = vm.createContext({ fetch: s.fetch, console, window: { D2_DRY: !!state.dry, D2_SEED_FILE: state.seedFile }, URLSearchParams, encodeURIComponent, decodeURIComponent });
  const report = await vm.runInContext(src, ctx);
  return { report, calls: s.calls };
}
// CreateFieldAsXml bodies are JSON; the schema text lives in parameters.SchemaXml.
const xmlOf = c => c.body && c.body.parameters ? c.body.parameters.SchemaXml : '';
(async () => {
  // ---- provision: four BuildType columns, one PhaseName, hidden on Jobs, two views per template list
  let r = await runScript('provision-build-type.js', { fields: {}, views: [] });
  const creates = r.calls.filter(c => /CreateFieldAsXml/.test(c.u));
  ok('BuildType created on four lists', creates.filter(c => /Name='BuildType'/.test(xmlOf(c))).length === 4);
  ok('PhaseName created on Sub-phase Template only', creates.filter(c => /Name='PhaseName'/.test(xmlOf(c))).map(c => c.u).join().includes("Sub-phase%20Template") && creates.filter(c => /Name='PhaseName'/.test(xmlOf(c))).length === 1);
  const bt = xmlOf(creates.find(c => /Name='BuildType'/.test(xmlOf(c))));
  ok('BuildType is a required dropdown Choice defaulting to Gunite', /Type='Choice'/.test(bt) && /Required='TRUE'/.test(bt) && /<CHOICE>Gunite<\/CHOICE><CHOICE>Fiberglass<\/CHOICE>/.test(bt) && /<Default>Gunite<\/Default>/.test(bt));
  ok('field creates are sequential (each POST follows the previous response)', r.report.failures.length === 0);
  ok('BuildType hidden on the Jobs New form by SchemaXml insert', r.calls.some(c => /Jobs.*BuildType/.test(c.u) && c.h['X-HTTP-Method'] === 'MERGE' && /ShowInNewForm="FALSE"/.test(c.body.SchemaXml) && c.body.__metadata && c.body.__metadata.type === 'SP.FieldChoice'));
  ok('two views per template list', r.calls.filter(c => /\/views$/.test(c.u) && c.m === 'POST').length === 4);
  ok('view query filters by BuildType and orders by Sequence', r.calls.filter(c => /\/views$/.test(c.u) && c.m === 'POST').every(c => /BuildType/.test(c.body.ViewQuery) && /Sequence/.test(c.body.ViewQuery)));
  // ---- idempotent
  r = await runScript('provision-build-type.js', { fields: { Jobs: ['BuildType'], 'New Pool Requests': ['BuildType'], 'Sub-phase Template': ['BuildType', 'PhaseName'], 'Task Template': ['BuildType'] }, views: [{ Title: 'Gunite', Id: 'a' }, { Title: 'Fiberglass', Id: 'b' }] });
  ok('second run creates nothing', !r.calls.some(c => /CreateFieldAsXml/.test(c.u)) && r.report.fields.kept.length === 5);
  // ---- dry run
  r = await runScript('provision-build-type.js', { fields: {}, views: [], dry: true });
  ok('dry run writes nothing', !r.calls.some(c => c.m === 'POST' && !/contextinfo/.test(c.u)));
  // ---- stamp
  const seed = { subphases: [{ num: '0.0', phaseName: 'Pre Construction/Sales' }, { num: '1.2', phaseName: 'Preconstruction Back Office Admin' }] };
  r = await runScript('stamp-build-type.js', { rows: [{ Id: 1, BuildType: null, SubPhaseNumber: '0.0', PhaseName: null }, { Id: 2, BuildType: 'Gunite', SubPhaseNumber: '1.2', PhaseName: 'x' }, { Id: 3, BuildType: 'Fiberglass', SubPhaseNumber: '0.0', PhaseName: null }], seed });
  const merges = r.calls.filter(c => c.h['X-HTTP-Method'] === 'MERGE');
  ok('only blank rows are stamped', merges.length > 0 && merges.every(c => /items\(1\)$/.test(c.u)));
  ok('the stamp body sets Gunite', merges.some(c => c.body.BuildType === 'Gunite'));
  ok('PhaseName comes from the seed by SubPhaseNumber', merges.some(c => c.body.PhaseName === 'Pre Construction/Sales'));
  ok('a Fiberglass row is never given a Gunite PhaseName', !merges.some(c => /items\(3\)$/.test(c.u)));
  ok('report counts blanks remaining after the pass', r.report && r.report.blanks && typeof r.report.blanks.Jobs === 'number');
  // ---- seed by build type
  const fib = { buildType: 'Fiberglass', subphases: [
    { num: '1.2', name: 'Site Preparation', phaseName: 'Preconstruction Back Office Admin', tradeCode: 'demolition', defaultCrew: 'campos', days: 2, seq: 1, tasks: ['A', 'B'] },
    { num: '2.3', name: 'Crane Set and Shell Placement', phaseName: 'Base Preparation and Shell Set', tradeCode: null, defaultCrew: 'unassigned', days: 2, seq: 2, tasks: ['C'] } ] };
  r = await runScript('seed-templates.js', { seed: fib, sub: [{ Id: 5, SubPhaseNumber: '1.2', BuildType: 'Gunite' }], tasks: [], n: 0, seedFile: 'template-seed-fiberglass.json' });
  const subPosts = r.calls.filter(c => c.m === 'POST' && /Sub-phase%20Template'\)\/items$/.test(c.u));
  ok('a Gunite 1.2 does not satisfy a Fiberglass 1.2: both Fiberglass sub-phases are created', subPosts.length === 2);
  ok('sub-phase bodies carry BuildType and PhaseName', subPosts.every(c => c.body.BuildType === 'Fiberglass' && c.body.PhaseName));
  ok('TradeId resolved by TradeCode, absent when there is no trade', subPosts[0].body.TradeId === 7 && !('TradeId' in subPosts[1].body));
  const taskPosts = r.calls.filter(c => c.m === 'POST' && /Task%20Template'\)\/items$/.test(c.u));
  ok('three tasks created, each with BuildType and its parent id', taskPosts.length === 3 && taskPosts.every(c => c.body.BuildType === 'Fiberglass' && c.body.SubPhaseId >= 100));
  ok('report says remaining 0', r.report.remaining === 0 && r.report.subCreated === 2 && r.report.taskCreated === 3);
  r = await runScript('seed-templates.js', { seed: fib, sub: [{ Id: 5, SubPhaseNumber: '1.2', BuildType: 'Fiberglass' }, { Id: 6, SubPhaseNumber: '2.3', BuildType: 'Fiberglass' }], tasks: [{ Id: 1, SubPhaseId: 5, Sequence: 1 }, { Id: 2, SubPhaseId: 5, Sequence: 2 }, { Id: 3, SubPhaseId: 6, Sequence: 1 }], n: 0, seedFile: 'template-seed-fiberglass.json' });
  ok('second run creates nothing', !r.calls.some(c => c.m === 'POST' && /\/items$/.test(c.u)));
  ok('the seed file name is taken from window.D2_SEED_FILE', r.calls.some(c => /SiteAssets\/template-seed-fiberglass\.json/.test(c.u)));
  process.exit(fails ? 1 : 0);
})();
