/* Backfill for "projects own their structure" (docs/specs/2026-10-21-projects-own-structure-design.md).
 *   Sub-phase Template: Skill, where blank, derived exactly as the planner derives it today
 *     (Trade's TradeCode, else the pseudo-trade from DefaultCrew: office/subcon/unassigned).
 *   Assignments: PhaseName, Skill, TemplateItemId, where any is blank, from the project's build-type
 *     template row with the same SubPhaseNumber. ONLY VALID AGAINST TODAY'S TEMPLATES: run it before
 *     anyone renumbers a template. Each MERGE carries SuppressReconcileUntil (+15 min); stop
 *     D2 - Event-Driven Reconciliation for the run anyway.
 * A row whose SubPhaseName differs from the template row's Title is reported and NOT stamped.
 * Idempotent; 32 s budget per call, re-run until remaining is 0.
 * window.D2_DRY = true reports without writing.
 * Run in the console on the D2BuildScheduler site, signed in as stratirus@d2pools.com. */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const DRY = !!(typeof window !== 'undefined' && window.D2_DRY);
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const NM = { Accept: 'application/json;odata=nometadata' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue, 'Content-Type': 'application/json;odata=nometadata', 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' };
  const list = l => site + "/_api/web/lists/GetByTitle('" + encodeURIComponent(l) + "')";
  const g = async u => { const r = await fetch(u, { headers: NM, credentials: 'include' }); if (!r.ok) throw new Error(u.replace(site, '') + ' -> ' + r.status); return r.json(); };
  const all = async u => { let out = [], next = u; while (next) { const d = await g(next); out = out.concat(d.value || []); next = d['odata.nextLink'] || null; } return out; };
  const t0 = Date.now(), outOfTime = () => Date.now() - t0 > 32000;
  const norm = v => String(v == null ? '' : v).trim().toLowerCase();
  const type = v => norm(v) === 'fiberglass' ? 'Fiberglass' : 'Gunite';
  const PSEUDO_BY_CREW = { office: '@office', subcon: '@sub', unassigned: '@unassigned' };
  const report = { template: { stamped: 0, blankAfter: null }, asg: { total: 0, alreadyDone: 0, stamped: 0, remaining: 0, unmatched: [], nameMismatch: [], blankAfter: null }, samples: [], errors: [] };
  const until = new Date(Date.now() + 15 * 60000).toISOString();

  const merge = async (l, id, body) => {
    if (DRY) return true;
    const r = await fetch(list(l) + '/items(' + id + ')', { method: 'POST', credentials: 'include', headers: HD, body: JSON.stringify(body) });
    if (!r.ok) { report.errors.push(l + '/' + id + ': ' + r.status + ' ' + (await r.text()).slice(0, 160)); return false; }
    return true;
  };
  const inChunks = async (jobs, n) => { for (let i = 0; i < jobs.length; i += n) { if (outOfTime()) return jobs.length - i; await Promise.all(jobs.slice(i, i + n).map(f => f())); } return 0; };

  // 1. Template Skill.
  const trades = await all(list('Trades') + '/items?$select=Id,TradeCode&$top=500');
  const codeById = new Map(trades.map(t => [t.Id, t.TradeCode || null]));
  const sptSel = 'Id,Title,SubPhaseNumber,BuildType,PhaseName,TradeId,DefaultCrew,Skill';
  let spt = await all(list('Sub-phase Template') + '/items?$select=' + sptSel + '&$top=2000');
  const skillOf = r => r.TradeId != null ? (codeById.get(r.TradeId) || null) : (PSEUDO_BY_CREW[norm(r.DefaultCrew)] || null);
  const tplJobs = spt.filter(r => !r.Skill && skillOf(r)).map(r => async () => { if (await merge('Sub-phase Template', r.Id, { Skill: skillOf(r) })) report.template.stamped++; });
  await inChunks(tplJobs, 8);
  if (!DRY) spt = await all(list('Sub-phase Template') + '/items?$select=' + sptSel + '&$top=2000');
  report.template.blankAfter = spt.filter(r => !(r.Skill || skillOf(r))).length;

  // 2. Assignments.
  const byKey = new Map(spt.map(r => [type(r.BuildType) + '|' + String(r.SubPhaseNumber).trim(), r]));
  const jobs = await all(list('Jobs') + '/items?$select=Id,JobNumber,BuildType&$top=2000');
  const jobById = new Map(jobs.map(j => [j.Id, j]));
  const asgSel = 'Id,JobId,SubPhaseNumber,SubPhaseName,PhaseName,Skill,TemplateItemId';
  const asg = await all(list('Assignments') + '/items?$select=' + asgSel + '&$top=2000');
  report.asg.total = asg.length;
  const work = [];
  for (const a of asg) {
    if (a.PhaseName && a.Skill && a.TemplateItemId != null) { report.asg.alreadyDone++; continue; }
    const j = jobById.get(a.JobId);
    const t = j && byKey.get(type(j.BuildType) + '|' + String(a.SubPhaseNumber).trim());
    if (!t) { report.asg.unmatched.push({ id: a.Id, job: j ? j.JobNumber : a.JobId, num: a.SubPhaseNumber }); continue; }
    if (norm(t.Title) !== norm(a.SubPhaseName)) { report.asg.nameMismatch.push({ id: a.Id, job: j.JobNumber, num: a.SubPhaseNumber, row: a.SubPhaseName, template: t.Title }); continue; }
    const body = { PhaseName: a.PhaseName || t.PhaseName || null, Skill: a.Skill || t.Skill || skillOf(t), TemplateItemId: a.TemplateItemId != null ? a.TemplateItemId : t.Id, SuppressReconcileUntil: until };
    if (report.samples.length < 3) report.samples.push({ id: a.Id, job: j.JobNumber, num: a.SubPhaseNumber, body });
    work.push(async () => { if (await merge('Assignments', a.Id, body)) report.asg.stamped++; });
  }
  report.asg.remaining = await inChunks(work, 8);
  if (!DRY) {
    const after = await all(list('Assignments') + '/items?$select=' + asgSel + '&$top=2000');
    report.asg.blankAfter = after.filter(a => !(a.PhaseName && a.Skill && a.TemplateItemId != null)).length;
  }
  report.seconds = Math.round((Date.now() - t0) / 1000);
  return report;
})();
