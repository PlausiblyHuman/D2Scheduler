/* The feature model: pure functions over a template and a project's groups.
 * Fixture shapes follow web/features-core.js. Every assertion was watched
 * failing under features-core.mutations.json (see mutate.py).
 */
const path = require('path');
const F = require(path.resolve(__dirname, '../../web/features-core.js'));

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; process.exitCode = fail; };

const sec = (o) => Object.assign({ id: 0, seq: 0, optional: false, feature: null, num: '', name: '', skill: null, days: 2, tasks: [], taskSeq: [], taskFeature: [] }, o);
const tpl = [
  { id: 1, num: '1', name: 'Site', sections: [
    sec({ id: 14, seq: 4, num: '1.4', name: 'Layout', tasks: ['Mark corners', 'Auto Cover Layout'], taskSeq: [1, 2], taskFeature: [null, 'Auto Cover '] })
  ] },
  { id: 6, num: '6', name: 'Equipment', sections: [
    sec({ id: 64, seq: 40, num: '6.4', name: 'Auto Cover Rough In', optional: true, feature: 'Auto Cover' }),
    sec({ id: 66, seq: 42, num: '6.6', name: 'Water Feature and Veneers', optional: true, feature: '' })
  ] },
  { id: 7, num: '7', name: 'Start', sections: [ sec({ id: 900, seq: 50, num: '7.4', name: 'Gas Line' }) ] }
];

const t = F.templateFeatures(tpl);
ok('templateFeatures finds 2 features', t.length === 2, t.map(f => f.name).join('|'));
const ac = t.find(f => f.key === 'auto cover');
ok('Auto Cover has 1 sec and 1 task', ac && ac.secs.length === 1 && ac.tasks.length === 1);
ok('display name is first spelling met, trimmed', ac && ac.name === 'Auto Cover', ac && ac.name);
ok('sec ref shape', ac && JSON.stringify(ac.secs[0]) === JSON.stringify({ tplId: 64, num: '6.4', name: 'Auto Cover Rough In', seq: 40 }));
ok('task ref shape', ac && JSON.stringify(ac.tasks[0]) === JSON.stringify({ tplSecId: 14, secNum: '1.4', title: 'Auto Cover Layout', seq: 2 }));
const wf = t.find(f => f.key === 'water feature and veneers');
ok('blank Feature uses the section title', wf && wf.name === 'Water Feature and Veneers' && wf.secs.length === 1 && wf.tasks.length === 0);
ok('sorted by name', t[0].name === 'Auto Cover' && t[1].name === 'Water Feature and Veneers');

ok('featureKey trims', F.featureKey('  Auto Cover ') === 'auto cover');
ok('featureKey lowercases', F.featureKey('AUTO COVER') === 'auto cover');
ok('featureKey blank is empty string', F.featureKey(null) === '' && F.featureKey('  ') === '');
ok('autoReason exact', F.autoReason('Auto Cover') === 'Auto Cover not on this project');
ok('secFeatureName: tag wins', F.secFeatureName({ optional: true, feature: 'X', name: 'N' }) === 'X');
ok('secFeatureName: optional falls back to name', F.secFeatureName({ optional: true, feature: ' ', name: 'N' }) === 'N');
ok('secFeatureName: plain is null', F.secFeatureName({ optional: false, feature: null, name: 'N' }) === null);

const task = (title, o) => Object.assign({ t: title, done: false, na: false, note: '', feature: null }, o);
const s = (o) => Object.assign({ num: '', name: '', skip: false, templateItemId: null, feature: null, inst: false, tasks: [] }, o);
const groups = (secs1, secs2) => [{ num: '1', name: 'Site', sections: secs1 }, { num: '6', name: 'Equipment', sections: secs2 || [] }];
const find = (pf, k) => pf.find(f => f.key === k);

{
  const g = groups([s({ templateItemId: 14, tasks: [task('Mark corners'), task('Auto Cover Layout', { feature: 'Auto Cover' })] })],
    [s({ templateItemId: 64, feature: 'Auto Cover' }), s({ templateItemId: 66, feature: 'Water Feature and Veneers' })]);
  const pf = F.projectFeatures(g, tpl);
  ok('all applicable is on', find(pf, 'auto cover').state === 'on');
  ok('rows and taskRefs located', JSON.stringify(find(pf, 'auto cover').rows) === '[{"gi":1,"si":0}]' && JSON.stringify(find(pf, 'auto cover').taskRefs) === '[{"gi":0,"si":0,"ti":1}]');
  ok('untagged task not counted', find(pf, 'auto cover').taskRefs.length === 1);
}
{
  const g = groups([s({ tasks: [task('Auto Cover Layout', { feature: 'Auto Cover', na: true })] })], [s({ feature: 'Auto Cover', skip: true })]);
  ok('all N/A is off', find(F.projectFeatures(g, tpl), 'auto cover').state === 'off');
}
{
  const g = groups([s({ tasks: [task('Auto Cover Layout', { feature: 'Auto Cover', na: true })] })], [s({ feature: 'Auto Cover', skip: false })]);
  ok('mixed row/task is partly', find(F.projectFeatures(g, tpl), 'auto cover').state === 'partly');
}
{
  const g = groups([s({ tasks: [task('Mark corners')] })]);
  const pf = F.projectFeatures(g, tpl);
  ok('none present is absent', find(pf, 'auto cover').state === 'absent' && find(pf, 'water feature and veneers').state === 'absent');
  ok('absent keeps template secs', find(pf, 'auto cover').secs.length === 1);
}
{
  const g = groups([s()], [s({ feature: 'Fire Pit', skip: false })]);
  const fp = find(F.projectFeatures(g, tpl), 'fire pit');
  ok('feature not in template is listed', fp && fp.secs.length === 0 && fp.tasks.length === 0 && fp.state === 'on' && fp.name === 'Fire Pit');
  const g2 = groups([s()], [s({ feature: 'Fire Pit', skip: true })]);
  ok('its state comes from its row', find(F.projectFeatures(g2, tpl), 'fire pit').state === 'off');
}
{
  const g = groups([s({ templateItemId: 14 })], [s({ templateItemId: 64, feature: 'Auto Cover' })]);
  const m = F.missingTemplateLines(g, tpl);
  ok('missing returns the plain line the project lacks', m.length === 1 && JSON.stringify(m[0]) === JSON.stringify({ tplId: 900, num: '7.4', name: 'Gas Line', seq: 50 }), JSON.stringify(m));
  ok('optional lines never missing', !m.some(x => x.tplId === 64 || x.tplId === 66));
  const g2 = groups([s({ templateItemId: 14 })], [s({ templateItemId: 900 })]);
  ok('nothing missing when all present', F.missingTemplateLines(g2, tpl).length === 0);
}
{
  const rev = tpl.slice(1).map(p => Object.assign({}, p, { sections: p.sections.slice().reverse() }));
  ok('sorted by name regardless of template order', F.templateFeatures(rev).map(f => f.name).join('|') === 'Auto Cover|Water Feature and Veneers'
    && F.projectFeatures(groups([s()]), rev).map(f => f.name).join('|') === 'Auto Cover|Water Feature and Veneers');
}
