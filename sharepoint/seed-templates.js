/* Seed Sub-phase Template and Task Template for ONE build type per run, from
 * SiteAssets/<window.D2_SEED_FILE, default template-seed.json> (the file's
 * buildType says which type; seed files are produced by tools/).
 *
 * Idempotent and resumable. Sub-phases match on BuildType + SubPhaseNumber
 * (1.1 exists in every type), tasks on parent + Sequence. Both lists get
 * BuildType; sub-phases also get PhaseName. Re-run until it reports remaining: 0.
 *
 * Optional: set window.D2_SEED_UPLOAD = '<seed json string>' first and the
 * script uploads it to SiteAssets under D2_SEED_FILE, so no hand upload is needed.
 *
 * A single CDP/console call is cut off around 45 seconds, so this works to a
 * time budget and returns progress rather than trying to finish in one call.
 *
 * ENTITY TYPE NAMES ARE NOT HAND-WRITTEN. Hyphenated and spaced list titles get
 * sanitised (Sub-phase Template -> SP.Data.Subphase_x0020_TemplateListItem --
 * note the hyphen is DROPPED, not encoded as _x002d_, which is why an
 * illustrative guess earlier in this project's history got it wrong). The two
 * constants below were read off the live list metadata and independently
 * re-confirmed; do not re-derive or "correct" them.
 *
 * Run in the browser console (or via chrome-devtools evaluate_script) on
 * https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler while signed
 * in as stratirus@d2pools.com.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const TYPE_SUB  = 'SP.Data.Subphase_x0020_TemplateListItem';
  const TYPE_TASK = 'SP.Data.Task_x0020_TemplateListItem';
  const CHUNK = 8, BUDGET_MS = 32000;
  const W = typeof window !== 'undefined' ? window : {};
  const FILE = W.D2_SEED_FILE || 'template-seed.json';

  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };
  const g = async u => (await fetch(site + u, { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json();
  const t0 = Date.now(), outOfTime = () => Date.now() - t0 > BUDGET_MS;
  const create = async (list, type, body) => {
    const r = await fetch(site + `/_api/web/lists/GetByTitle('${encodeURIComponent(list)}')/items`, { method: 'POST', credentials: 'include', headers: HD, body: JSON.stringify({ __metadata: { type }, ...body }) });
    if (!r.ok) return { ok: false, status: r.status, err: (await r.text()).slice(0, 200) };
    return { ok: true, item: (await r.json()).d };
  };
  // Optional: upload the seed file first, so nothing is dragged into SiteAssets by hand.
  if (W.D2_SEED_UPLOAD) {
    const up = await fetch(site + `/_api/web/GetFolderByServerRelativeUrl('SiteAssets')/Files/add(url='${FILE}',overwrite=true)`, { method: 'POST', credentials: 'include', headers: HD, body: W.D2_SEED_UPLOAD });
    if (!up.ok) return { error: 'upload ' + up.status + ' ' + (await up.text()).slice(0, 200) };
  }
  const plan = await (await fetch(site + '/SiteAssets/' + FILE, { credentials: 'include' })).json();
  const TYPE = plan.buildType || 'Gunite';
  const out = { buildType: TYPE, subCreated: 0, taskCreated: 0, errors: [], remaining: 0 };

  // ---- sub-phases (sequential: tasks need their ids). Match on BuildType + SubPhaseNumber: 1.1 exists in both types.
  const have = (await g("/_api/web/lists/GetByTitle('Sub-phase%20Template')/items?$select=Id,SubPhaseNumber,BuildType&$top=500")).value;
  const byNum = Object.fromEntries(have.filter(r => (r.BuildType || 'Gunite') === TYPE).map(r => [r.SubPhaseNumber, r.Id]));
  const trades = (await g("/_api/web/lists/GetByTitle('Trades')/items?$select=Id,TradeCode&$top=200")).value;
  const tradeId = Object.fromEntries(trades.map(t => [t.TradeCode, t.Id]));
  for (const s of plan.subphases) {
    if (byNum[s.num]) continue;
    if (outOfTime()) { out.remaining = plan.subphases.filter(x => !byNum[x.num]).length; return out; }
    const body = { Title: s.name, SubPhaseNumber: s.num, Sequence: s.seq, DefaultCrew: s.defaultCrew, DurationDays: s.days, BuildType: TYPE, PhaseName: s.phaseName || '' };
    if (s.tradeCode && tradeId[s.tradeCode]) body.TradeId = tradeId[s.tradeCode];
    const r = await create('Sub-phase Template', TYPE_SUB, body);
    if (!r.ok) { out.errors.push(s.num + ': ' + r.err); continue; }
    byNum[s.num] = r.item.Id; out.subCreated++;
  }
  // ---- tasks (parallel in chunks). Parent id + Sequence is already type-specific through the parent.
  const haveTasks = (await g("/_api/web/lists/GetByTitle('Task%20Template')/items?$select=Id,SubPhaseId,Sequence&$top=2000")).value;
  const seen = new Set(haveTasks.map(r => r.SubPhaseId + ':' + r.Sequence));
  const todo = [];
  for (const s of plan.subphases) {
    const pid = byNum[s.num]; if (!pid) continue;
    s.tasks.forEach((name, i) => { if (!seen.has(pid + ':' + (i + 1))) todo.push({ Title: name, SubPhaseId: pid, Sequence: i + 1, BuildType: TYPE }); });
  }
  for (let i = 0; i < todo.length; i += CHUNK) {
    if (outOfTime()) { out.remaining = todo.length - i; return out; }
    const rs = await Promise.all(todo.slice(i, i + CHUNK).map(b => create('Task Template', TYPE_TASK, b)));
    rs.forEach((r, k) => r.ok ? out.taskCreated++ : out.errors.push(todo[i + k].Title + ': ' + r.err));
  }
  return out;
})();
