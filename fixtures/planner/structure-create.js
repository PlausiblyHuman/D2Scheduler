/* Structure creates: adding template sub-phases (an Assignments row plus its
 * Tasks rows) to one live project over Graph.
 *
 * planStructureCreates (web/writeback-core.js) decides the bodies and where
 * each new row sits in Sequence; applyStructureCreates (web/graph-writeback.js)
 * POSTs them, Assignment first, then its tasks. The expected request bodies
 * are fixtures/planner/structure-capture.json, derived from the stored shapes
 * in live-payloads-graph.json until the live create capture replaces it.
 *
 * Every assertion was watched failing under structure-create.mutations.json
 * (writeback-core.js) and structure-create.gw-mutations.json
 * (graph-writeback.js); see mutate.py.
 */
const path = require('path');
const C = require(path.resolve(__dirname, '../../web/writeback-core.js'));
const G = require(path.resolve(__dirname, '../../web/graph-writeback.js'));
const F = require(path.resolve(__dirname, '../../web/features-core.js'));
const CAP = require(path.resolve(__dirname, 'structure-capture.json'));

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; process.exitCode = fail; };
const same = (a, b) => { try { require('assert').deepStrictEqual(a, b); return true; } catch (e) { return false; } };

const NOW = Date.parse(CAP.input.nowMs);
const rows46 = () => Array.from({ length: 46 }, (_, i) => ({ id: 4001 + i, seq: i + 1, templateItemId: 101 + i }));
const plan = (o) => C.planStructureCreates(Object.assign({
  job: CAP.input.job, rows: rows46(), tplSecs: [], offFeatureKeys: [], nowMs: NOW,
  keyOf: F.featureKey, reasonFor: F.autoReason
}, o));
const tsec = (o) => Object.assign({ id: 900, seq: 50, optional: false, feature: null, tradeId: null,
  num: '9.0', name: 'Line', phase: 'Phase', skill: null, days: 2, tasks: [], taskSeq: [], taskFeature: [] }, o);

/* A stub Graph. `script` maps a call index to a response; anything else is a
   201 carrying the next id for that list. */
function stubGraph(script) {
  const calls = [], slept = [];
  let asgN = 5000, taskN = 7000;
  const fetchImpl = async (url, init) => {
    const i = calls.length;
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    const s = script && script[i];
    if (s) return { ok: s.status < 300, status: s.status,
      headers: { get: (h) => (s.headers || {})[h.toLowerCase()] || null },
      json: async () => s.json || {}, text: async () => s.text || '' };
    const isAsg = url.indexOf('/lists/ASG/') !== -1;
    const id = String(isAsg ? ++asgN : ++taskN);
    return { ok: true, status: 201, headers: { get: () => null },
      json: async () => ({ id, fields: {} }), text: async () => '' };
  };
  const ctx = { token: 'TOK', siteId: 'SITE', asgListId: 'ASG', tasksListId: 'TSK', fetchImpl,
    sleep: async (ms) => { slept.push(ms); } };
  return { calls, slept, ctx };
}

(async () => {
  // ---- 1. Bodies equal the expected request bodies, field for field ----
  const p = plan({ tplSecs: CAP.input.tplSecs, offFeatureKeys: CAP.input.offFeatureKeys });
  ok('two creates, no refusals', p.creates.length === 2 && p.refusals.length === 0, JSON.stringify(p.refusals));
  ok('each create names its template line', p.creates[0].tplId === 812 && p.creates[1].tplId === 813);
  const g = stubGraph();
  const res = await G.applyStructureCreates(p, g.ctx);
  const sent = g.calls.map(c => ({ list: c.url.indexOf('/lists/ASG/') !== -1 ? 'Assignments' : 'Tasks', body: c.body }));
  ok('five POSTs in order: asg, its tasks, asg, its task', same(sent.map(s => s.list), CAP.requests.map(r => r.list)), sent.map(s => s.list).join(','));
  CAP.requests.forEach((want, i) => {
    const got = sent[i] && sent[i].body;
    ok('request ' + (i + 1) + ' (' + want.list + ') equals the expected body', same(got, want.body),
      JSON.stringify(got));
  });
  // Field types agree with how Graph stores each column (lookups are strings, not numbers).
  CAP.requests.forEach((want, i) => {
    const shapes = CAP.storedShapes[want.list];
    const got = (sent[i] && sent[i].body.fields) || {};
    const bad = Object.keys(got).filter(k => !shapes[k] || typeof got[k] !== shapes[k].type);
    ok('request ' + (i + 1) + ' sends only known columns in their stored type', bad.length === 0, bad.join(','));
  });
  ok('every call is a POST to the list items endpoint with the token',
    g.calls.every(c => c.method === 'POST' && /\/sites\/SITE\/lists\/(ASG|TSK)\/items$/.test(c.url)
      && c.headers.Authorization === 'Bearer TOK'));
  ok('created reports the asg and task ids', same(res.created, [
    { tplId: 812, asgId: '5001', taskIds: ['7001', '7002'] }, { tplId: 813, asgId: '5002', taskIds: ['7003'] }]),
  JSON.stringify(res.created));
  ok('nothing failed', res.failed.length === 0);
  ok('Assignments POSTs carry SuppressReconcileUntil +10 min',
    g.calls.filter(c => c.url.indexOf('/ASG/') !== -1).every(c => c.body.fields.SuppressReconcileUntil === '2026-10-22T15:10:00.000Z'));
  ok('Tasks POSTs never carry SuppressReconcileUntil',
    g.calls.filter(c => c.url.indexOf('/TSK/') !== -1).every(c => !('SuppressReconcileUntil' in c.body.fields)));

  // ---- 2. Body details that the two fixture lines do not reach ----
  const opt = plan({ tplSecs: [tsec({ id: 900, optional: true, feature: null, name: 'Fire Pit ' })] }).creates[0];
  ok('an optional line with no Feature tag is named by its title', opt.asg.Feature === 'Fire Pit', opt.asg.Feature);
  const noPhase = plan({ tplSecs: [tsec({ id: 900, phase: null, skill: null })] }).creates[0];
  ok('a line with no phase or skill sends empty text, as D2 - New Pool does', noPhase.asg.PhaseName === '' && noPhase.asg.Skill === '');
  const tagNoOpt =plan({ tplSecs: [tsec({ id: 900, optional: false, feature: 'Stray' })] }).creates[0];
  ok('a plain line sends no Feature', !('Feature' in tagNoOpt.asg));
  const noSeq = plan({ tplSecs: [tsec({ id: 900, tasks: ['A', 'B'], taskSeq: [null, null] })] }).creates[0];
  ok('a task with no template Sequence takes its position', noSeq.tasks[0].Sequence === 1 && noSeq.tasks[1].Sequence === 2);
  const offCase = plan({ tplSecs: [tsec({ id: 900, tasks: ['A'], taskSeq: [1], taskFeature: [' Auto Cover '] })], offFeatureKeys: ['AUTO COVER'] }).creates[0];
  ok('off-feature match ignores case and spacing on both sides', offCase.tasks[0].NotApplicable === true
    && offCase.tasks[0].Note === 'Auto Cover not on this project', JSON.stringify(offCase.tasks[0]));
  const onCase = plan({ tplSecs: [tsec({ id: 900, tasks: ['A'], taskSeq: [1], taskFeature: ['Gate'] })], offFeatureKeys: ['auto cover'] }).creates[0];
  ok('a task tagged with a feature that is on is applicable with no Note', onCase.tasks[0].NotApplicable === false
    && !('Note' in onCase.tasks[0]) && onCase.tasks[0].Feature === 'Gate');
  ok('every create is applicable and unassigned', p.creates.every(c => c.asg.NotApplicable === false && c.asg.Crew === 'unassigned'));
  ok('a plan never carries dates (the reflow sets them)', p.creates.every(c => !('ScheduledStart' in c.asg) && !('ScheduledFinish' in c.asg)));

  // ---- 3. Refusals ----
  const ref = plan({ tplSecs: [tsec({ id: 120, seq: 20 }), tsec({ id: 900, seq: 21.5 }), tsec({ id: 900, seq: 21.5 })] });
  ok('a line already on the project is refused already-present',
    ref.refusals.some(r => r.tplId === 120 && r.reason === 'already-present'), JSON.stringify(ref.refusals));
  ok('the same line twice is created once', ref.creates.length === 1 && ref.creates[0].tplId === 900
    && ref.refusals.filter(r => r.tplId === 900).length === 1);

  // ---- 4. Sequence placement (Review Focus 3) ----
  const seqs = (secs, rows) => plan({ tplSecs: secs, rows: rows || rows46() }).creates.map(c => [c.tplId, c.asg.Sequence]);
  ok('one line between rows 21 and 22 gets the midpoint', same(seqs([tsec({ id: 900, seq: 21.5 })]), [[900, 21.5]]));
  const two = seqs([tsec({ id: 902, seq: 21.6 }), tsec({ id: 901, seq: 21.3 })]);
  ok('two lines in one gap split it evenly, in template order',
    same(two.map(x => x[0]), [901, 902]) && Math.abs(two[0][1] - (21 + 1 / 3)) < 1e-9 && Math.abs(two[1][1] - (21 + 2 / 3)) < 1e-9,
    JSON.stringify(two));
  ok('both sit strictly between their neighbours, increasing', two[0][1] > 21 && two[0][1] < two[1][1] && two[1][1] < 22);
  const end = seqs([tsec({ id: 911, seq: 60 }), tsec({ id: 910, seq: 50 })]);
  ok('lines past the last row get last + 1, last + 2', same(end, [[910, 47], [911, 48]]), JSON.stringify(end));
  const first = seqs([tsec({ id: 920, seq: 0.5 })]);
  ok('a line before the first row sits below it', first[0][1] < 1 && first[0][1] > 0, JSON.stringify(first));
  const empty = seqs([tsec({ id: 930, seq: 3 }), tsec({ id: 931, seq: 4 })], []);
  ok('a project with no rows numbers from 1', same(empty, [[930, 1], [931, 2]]), JSON.stringify(empty));
  // A hand-added row (no template id) is never a place key, but is a neighbour.
  const hand = [{ id: 1, seq: 10, templateItemId: 110 }, { id: 2, seq: 10.5, templateItemId: null }, { id: 3, seq: 11, templateItemId: 111 }];
  const h = seqs([tsec({ id: 940, seq: 10.7 })], hand);
  ok('a hand-added row is the upper neighbour, not a place key', same(h, [[940, 10.25]]), JSON.stringify(h));
  // Rows unsorted on input.
  const shuffled = rows46().reverse();
  ok('rows in any order place the same', same(seqs([tsec({ id: 900, seq: 21.5 })], shuffled), [[900, 21.5]]));
  // A renumbered template: rows carry their template line's current Sequence as tplSeq.
  // By own seq the line (template 22) would follow row 1; by tplSeq row 2 (21.8) is below it.
  const renum = [{ id: 1, seq: 21, templateItemId: 121, tplSeq: 21 }, { id: 2, seq: 22, templateItemId: 122, tplSeq: 21.8 }];
  const rn = seqs([tsec({ id: 950, seq: 22 })], renum);
  ok('place is by template Sequence (tplSeq) when the caller supplies it', same(rn, [[950, 23]]), JSON.stringify(rn));
  // By own seq row 1 (21) is below 21.5; by tplSeq (25) nothing is, so the line goes first.
  const rn2 = seqs([tsec({ id: 951, seq: 21.5 })], [{ id: 1, seq: 21, templateItemId: 121, tplSeq: 25 }, { id: 2, seq: 22, templateItemId: 122, tplSeq: 22 }]);
  ok('tplSeq, not the project Sequence, picks prev', same(rn2, [[951, 20.5]]), JSON.stringify(rn2));
  // Gaps are independent: one line in each of two gaps gets each gap's midpoint.
  const sep = seqs([tsec({ id: 960, seq: 5.5 }), tsec({ id: 961, seq: 30.5 })]);
  ok('lines in different gaps do not share a gap', same(sep, [[960, 5.5], [961, 30.5]]), JSON.stringify(sep));

  // ---- 5. Apply: retries and partial failure ----
  const one = plan({ tplSecs: [tsec({ id: 900, tasks: ['T1', 'T2', 'T3'], taskSeq: [1, 2, 3] })] });
  let s = stubGraph({ 0: { status: 429, headers: { 'retry-after': '3' } } });
  let r = await G.applyStructureCreates(one, s.ctx);
  ok('a 429 then 201 creates the assignment with 2 calls', s.calls.filter(c => c.url.indexOf('/ASG/') !== -1).length === 2
    && r.created.length === 1 && r.created[0].asgId === '5001');
  ok('the retry waits Retry-After seconds', same(s.slept, [3000]), JSON.stringify(s.slept));
  s = stubGraph({ 0: { status: 503 } });
  r = await G.applyStructureCreates(one, s.ctx);
  ok('a 503 with no Retry-After waits 2 seconds', same(s.slept, [2000]) && r.created.length === 1, JSON.stringify(s.slept));
  s = stubGraph({ 0: { status: 429 }, 1: { status: 429 }, 2: { status: 429 } });
  r = await G.applyStructureCreates(one, s.ctx);
  ok('three 429s give up after two retries', s.calls.length === 3 && s.slept.length === 2
    && same(r.failed, [{ tplId: 900, stage: 'asg', status: 429 }]) && r.created.length === 0, JSON.stringify(r.failed));
  s = stubGraph({ 2: { status: 500, text: 'boom' } });
  r = await G.applyStructureCreates(one, s.ctx);
  ok('a task 500 is reported by title', same(r.failed, [{ tplId: 900, stage: 'task', title: 'T2', status: 500 }]), JSON.stringify(r.failed));
  ok('later tasks still post', s.calls.length === 4 && s.calls[3].body.fields.Title === 'T3');
  ok('the created row lists only the tasks that landed', same(r.created, [{ tplId: 900, asgId: '5001', taskIds: ['7001', '7002'] }]), JSON.stringify(r.created));
  ok('a 500 on a task is not retried', s.slept.length === 0);
  const twoLines = plan({ tplSecs: [tsec({ id: 900, seq: 21.5, tasks: ['A1'], taskSeq: [1] }), tsec({ id: 901, seq: 30.5, tasks: ['B1'], taskSeq: [1] })] });
  s = stubGraph({ 0: { status: 500 } });
  r = await G.applyStructureCreates(twoLines, s.ctx);
  ok('an assignment 500 posts none of its tasks', !s.calls.some(c => c.body.fields.Title === 'A1'));
  ok('and the next line still posts', s.calls.length === 3 && s.calls[1].url.indexOf('/ASG/') !== -1 && s.calls[2].body.fields.Title === 'B1');
  ok('the failure is recorded at the asg stage', same(r.failed, [{ tplId: 900, stage: 'asg', status: 500 }]), JSON.stringify(r.failed));
  s = stubGraph({ 0: { status: 201, json: { fields: {} } } });
  r = await G.applyStructureCreates(one, s.ctx);
  ok('a create that returns no id posts no tasks', s.calls.length === 1 && r.failed.length === 1
    && r.failed[0].stage === 'asg' && r.created.length === 0, JSON.stringify(r.failed));
  // A plan task carrying the stamp by mistake still never sends it to Tasks.
  const hostile = plan({ tplSecs: [tsec({ id: 900, tasks: ['X'], taskSeq: [1] })] });
  hostile.creates[0].tasks[0].SuppressReconcileUntil = '2026-10-22T15:10:00.000Z';
  s = stubGraph();
  await G.applyStructureCreates(hostile, s.ctx);
  ok('a stamp on a plan task is stripped before the Tasks POST', !('SuppressReconcileUntil' in s.calls[1].body.fields));
  ok('the task is linked to the created assignment as a string id', s.calls[1].body.fields.AssignmentLookupId === '5001');
  s = stubGraph();
  s.ctx.fetchImpl = async () => { throw new Error('offline'); };
  r = await G.applyStructureCreates(one, s.ctx);
  ok('a network error is a failure, not a throw', r.failed.length === 1 && r.failed[0].stage === 'asg' && r.failed[0].status === 0);

  // ---- A template line with no SharePoint id (an old per-browser copy) is never created ----
  const stale = plan({ tplSecs: [tsec({ id: 's0_0' }), tsec({ id: null, num: '9.1' }), tsec({ id: '', num: '9.2' }), tsec({ id: 901, num: '9.3' })] });
  ok('a line whose id is not a number is refused as no-template-id', same(stale.refusals, [
    { tplId: 's0_0', reason: 'no-template-id' }, { tplId: null, reason: 'no-template-id' }, { tplId: '', reason: 'no-template-id' }]), JSON.stringify(stale.refusals));
  ok('and only the line with a real id is created', stale.creates.length === 1 && stale.creates[0].asg.TemplateItemId === 901);
  ok('a numeric string id is accepted', plan({ tplSecs: [tsec({ id: '902' })] }).creates.map(c => c.asg.TemplateItemId).join() === '902');

  console.log(fail ? '\nFAILED' : '\nALL PASS');
})().catch(e => { console.log('FAIL · harness crashed: ' + (e && e.stack || e)); process.exitCode = 1; });
