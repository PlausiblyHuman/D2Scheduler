/* Renumber the Fiberglass template's last three phases, and the matching rows on every Fiberglass
   project, 2026-10-23.

   Don's sheet split Electrical out of Plumbing into its own phase, and the bump that followed stopped
   at Equipment Installation, leaving two Phase 7s and the last three phases one short. The 10-13 load
   merged the two 7s. This finishes the bump instead:

     7.1-7.3 Equipment Installation           numbers kept, phase name fixed
     7.4-7.7 -> 8.1-8.4 Startup and Trim Out
     8.1-8.6 -> 9.1-9.6 Site Restoration and Final Grade
     9.0-9.1 -> 10.0-10.1 Post Construction Completion Phase

   Changes SubPhaseNumber and PhaseName on the template, and SubPhaseNumber, Title and PhaseName on
   each project's Assignments. Nothing else: no sign-off, tick, date or crew. Rows are matched by id,
   and each is re-read just before its write and skipped if it changed since the plan.

   HOW TO RUN: open the hosted planner, sign in and press Refresh once (that signs Graph in). Press F12,
   Console, paste this whole file, Enter. It prints the plan and writes NOTHING. To write, run
       window.RENUMBER_WRITE = true
   then paste the file again. It prints what it wrote, then reads every row back. */
(async () => {
  const WRITE = window.RENUMBER_WRITE === true;
  const MAP = { '7.4': '8.1', '7.5': '8.2', '7.6': '8.3', '7.7': '8.4',
                '8.1': '9.1', '8.2': '9.2', '8.3': '9.3', '8.4': '9.4', '8.5': '9.5', '8.6': '9.6',
                '9.0': '10.0', '9.1': '10.1' };
  const PH = { '7': 'Equipment Installation', '8': 'Startup and Trim Out',
               '9': 'Site Restoration and Final Grade', '10': 'Post Construction Completion Phase' };
  const phaseOf = n => PH[n.split('.')[0]];
  const inScope = n => /^(7|8|9)\./.test(n || '');

  const tok = await graphToken();
  const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json',
              Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' };
  const site = (await (await fetch('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:/sites/D2BuildScheduler?$select=id', { headers: H })).json()).id;
  const base = `https://graph.microsoft.com/v1.0/sites/${site}/lists/`;
  const TL = encodeURIComponent('Sub-phase Template');
  const all = async u => { const out = []; while (u) { const j = await (await fetch(u, { headers: H })).json();
    if (j.error) throw new Error(j.error.message); out.push(...j.value); u = j['@odata.nextLink']; } return out; };

  // ---- plan ----
  const plan = { template: [], asg: [] };
  const spt = (await all(base + `${TL}/items?$expand=fields&$top=999`)).filter(x => x.fields.BuildType === 'Fiberglass');
  spt.forEach(x => { const f = x.fields, old = f.SubPhaseNumber; if (!inScope(old)) return;
    const nn = MAP[old] || old, np = phaseOf(nn), set = {};
    if (nn !== old) set.SubPhaseNumber = nn;
    if (np && f.PhaseName !== np) set.PhaseName = np;
    if (Object.keys(set).length) plan.template.push({ id: x.id, from: { num: old, phase: f.PhaseName ?? null }, set }); });

  const jobs = (await all(base + 'Jobs/items?$expand=fields($select=JobNumber,BuildType)&$top=999'))
    .filter(x => x.fields.BuildType === 'Fiberglass');
  for (const job of jobs) {
    const rows = await all(base + `Assignments/items?$expand=fields&$filter=fields/JobLookupId eq '${job.id}'&$top=999`);
    rows.forEach(x => { const f = x.fields, old = f.SubPhaseNumber; if (!inScope(old)) return;
      const nn = MAP[old] || old, np = phaseOf(nn), prefix = f.Title.split(' · ')[0], set = {};
      if (f.Title !== prefix + ' · ' + old + ' ' + f.SubPhaseName) throw new Error('Unexpected title, stopping: ' + f.Title);
      if (nn !== old) { set.SubPhaseNumber = nn; set.Title = prefix + ' · ' + nn + ' ' + f.SubPhaseName; }
      if (np && f.PhaseName != null && f.PhaseName !== np) set.PhaseName = np;
      if (Object.keys(set).length) plan.asg.push({ id: x.id, job: job.fields.JobNumber,
        from: { num: old, title: f.Title, phase: f.PhaseName ?? null }, set }); });
  }
  console.log(`Plan: ${plan.template.length} template rows, ${plan.asg.length} project rows across ${jobs.map(j => j.fields.JobNumber).join(', ')}`);
  console.table(plan.template.map(p => ({ id: p.id, from: p.from.num, to: p.set.SubPhaseNumber || p.from.num, phase: p.set.PhaseName || '(same)' })));
  console.table(plan.asg.map(p => ({ id: p.id, job: p.job, from: p.from.title, to: p.set.Title || '(same)', phase: p.set.PhaseName || '(same)' })));
  if (!WRITE) { console.log('DRY RUN: nothing written. Set window.RENUMBER_WRITE = true and paste again to write.'); return; }

  // ---- write, compare-before-write ----
  const res = { template: { ok: 0, skipped: [], failed: [] }, asg: { ok: 0, skipped: [], failed: [] } };
  const supp = new Date(Date.now() + 10 * 60000).toISOString();
  for (const p of plan.template) {
    const cur = await (await fetch(base + `${TL}/items/${p.id}/fields`, { headers: H })).json();
    if (cur.SubPhaseNumber !== p.from.num || (cur.PhaseName ?? null) !== p.from.phase) { res.template.skipped.push(p.id); continue; }
    const r = await fetch(base + `${TL}/items/${p.id}/fields`, { method: 'PATCH', headers: H, body: JSON.stringify(p.set) });
    r.ok ? res.template.ok++ : res.template.failed.push({ id: p.id, status: r.status, msg: (await r.text()).slice(0, 200) });
  }
  for (const p of plan.asg) {
    const cur = await (await fetch(base + `Assignments/items/${p.id}/fields`, { headers: H })).json();
    if (cur.SubPhaseNumber !== p.from.num || cur.Title !== p.from.title || (cur.PhaseName ?? null) !== p.from.phase) { res.asg.skipped.push(p.id); continue; }
    const r = await fetch(base + `Assignments/items/${p.id}/fields`, { method: 'PATCH', headers: H,
      body: JSON.stringify(Object.assign({}, p.set, { SuppressReconcileUntil: supp })) });
    r.ok ? res.asg.ok++ : res.asg.failed.push({ id: p.id, status: r.status, msg: (await r.text()).slice(0, 200) });
  }
  console.log('WRITTEN', JSON.stringify(res));

  // ---- read back ----
  const bad = [];
  for (const p of plan.template) { const f = await (await fetch(base + `${TL}/items/${p.id}/fields`, { headers: H })).json();
    for (const k in p.set) if (f[k] !== p.set[k]) bad.push(`template ${p.id} ${k}: ${f[k]}`); }
  for (const p of plan.asg) { const f = await (await fetch(base + `Assignments/items/${p.id}/fields`, { headers: H })).json();
    for (const k in p.set) if (f[k] !== p.set[k]) bad.push(`assignment ${p.id} ${k}: ${f[k]}`); }
  console.log(bad.length ? 'READ-BACK MISMATCHES:\n' + bad.join('\n') : `READ-BACK OK: ${plan.template.length + plan.asg.length} rows as planned. Press Refresh.`);
})().catch(e => console.error('STOPPED:', e.message));
