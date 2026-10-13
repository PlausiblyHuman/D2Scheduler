/* Stamp BuildType = Gunite on every existing row of Jobs, New Pool Requests, Sub-phase Template and
 * Task Template that has none, and PhaseName on the Gunite sub-phases from SiteAssets/template-seed.json
 * (tools/gen-template-seed.py, Gunite run). Idempotent; 32 s budget per call, re-run until remaining is 0.
 * window.D2_DRY = true reports without writing. window.D2_SEED_FILE overrides the seed file name.
 * Run in the console on the D2BuildScheduler site, signed in as stratirus@d2pools.com. */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const DRY = !!(typeof window !== 'undefined' && window.D2_DRY);
  const SEED = (typeof window !== 'undefined' && window.D2_SEED_FILE) || 'template-seed.json';
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const NM = { Accept: 'application/json;odata=nometadata' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' };
  const list = l => site + "/_api/web/lists/GetByTitle('" + encodeURIComponent(l) + "')";
  const g = async u => (await fetch(u, { headers: NM, credentials: 'include' })).json();
  const all = async u => { let out = [], next = u; while (next) { const d = await g(next); out = out.concat(d.value || []); next = d['odata.nextLink'] || null; } return out; };
  const t0 = Date.now(), outOfTime = () => Date.now() - t0 > 32000;
  const seed = await (await fetch(site + '/SiteAssets/' + SEED, { credentials: 'include' })).json();
  const phaseByNum = Object.fromEntries((seed.subphases || []).map(s => [s.num, s.phaseName]));
  const report = { stamped: {}, phaseNamed: 0, remaining: {}, blanks: {}, errors: [] };
  const merge = async (l, id, body) => {
    if (DRY) return true;
    const r = await fetch(list(l) + '/items(' + id + ')', { method: 'POST', credentials: 'include', headers: HD, body: JSON.stringify(body) });
    if (!r.ok) { report.errors.push(l + '/' + id + ': ' + r.status); return false; }
    return true;
  };
  for (const l of ['Jobs', 'New Pool Requests', 'Sub-phase Template', 'Task Template']) {
    const sel = l === 'Sub-phase Template' ? 'Id,SubPhaseNumber,BuildType,PhaseName' : 'Id,BuildType';
    const rows = await all(list(l) + '/items?$select=' + sel + '&$top=2000');
    report.stamped[l] = 0; report.remaining[l] = 0;
    for (const r of rows) {
      const body = {};
      if (!r.BuildType) body.BuildType = 'Gunite';
      if (l === 'Sub-phase Template' && !r.PhaseName && phaseByNum[r.SubPhaseNumber]) body.PhaseName = phaseByNum[r.SubPhaseNumber];
      if (!Object.keys(body).length) continue;
      if (outOfTime()) { report.remaining[l]++; continue; }
      if (await merge(l, r.Id, body)) { if (body.BuildType) report.stamped[l]++; if (body.PhaseName) report.phaseNamed++; }
    }
    const after = DRY ? rows : await all(list(l) + '/items?$select=' + sel + '&$top=2000');
    report.blanks[l] = after.filter(r => !r.BuildType).length;
  }
  return report;
})();
