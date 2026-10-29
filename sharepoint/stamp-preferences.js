/* Backfill for skills and crew preferences (run after sharepoint/provision-preferences.js).
 *   Crew-Trades: Preference = 3 where null. Duplicate (Crew, Trade) pairs are reported, not changed.
 *   Crews:       Preference = 3 where null; Members set for the seven field crews where blank.
 * A null already reads as 3 downstream, so this only makes the data explicit.
 * Idempotent. Dry by default; window.D2_WRITE = true writes (tools/sp-proxy.js --write sets it).
 * Run in the console on the D2BuildScheduler site, signed in as stratirus@d2pools.com. */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const WRITE = typeof window !== 'undefined' && window.D2_WRITE === true;
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const NM = { Accept: 'application/json;odata=nometadata' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d ? dg.d.GetContextWebInformation.FormDigestValue : dg.FormDigestValue, 'Content-Type': 'application/json;odata=nometadata', 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' };
  const list = l => site + "/_api/web/lists/GetByTitle('" + encodeURIComponent(l) + "')";
  const g = async u => { const r = await fetch(u, { headers: NM, credentials: 'include' }); if (!r.ok) throw new Error(u.replace(site, '') + ' -> ' + r.status); return r.json(); };
  const all = async u => { let out = [], next = u; while (next) { const d = await g(next); out = out.concat(d.value || []); next = d['odata.nextLink'] || null; } return out; };
  // Before provision-preferences.js has run the column does not exist and $select 500s: read without it (dry run only).
  const allPref = async (l, sel, newCols) => { try { return await all(list(l) + '/items?$select=' + sel + (newCols ? ',' + newCols : '') + ',Preference&$top=500'); } catch (e) { if (WRITE) throw e; report.preColumns = (report.preColumns || []).concat(l); return all(list(l) + '/items?$select=' + sel + '&$top=500'); } };
  const inChunks = async (jobs, n) => { for (let i = 0; i < jobs.length; i += n) await Promise.all(jobs.slice(i, i + n).map(f => f())); };
  const report = { write: WRITE, ct: { total: 0, stamped: 0, alreadySet: 0 }, crews: { total: 0, stamped: 0, membersSet: 0, alreadySet: 0 }, duplicates: [], errors: [] };

  const ROSTER = { devon:'Devon, Martin, Ocoundo, Eric', guillermo:'Guillermo, Sergio R, Valentine', cirilo:'Cirilo, Yair, Marbin',
    saul:'Saul, Sergio E, Miguel', antonio:'Antonio, brother', campos:'Campos, ?, ?', harrison:'Harrison, Ian, ?' };

  const merge = async (l, id, body) => {
    if (!WRITE) return true;
    const r = await fetch(list(l) + '/items(' + id + ')', { method: 'POST', credentials: 'include', headers: HD, body: JSON.stringify(body) });
    if (!r.ok) { report.errors.push(l + '/' + id + ': ' + r.status + ' ' + (await r.text()).slice(0, 160)); return false; }
    return true;
  };

  // Crew-Trades
  const ct = await allPref('Crew-Trades', 'Id,CrewId,TradeId');
  report.ct.total = ct.length;
  const seen = new Map();
  for (const r of ct) { const k = r.CrewId + ':' + r.TradeId; seen.set(k, (seen.get(k) || []).concat(r.Id)); }
  for (const [k, ids] of seen) if (ids.length > 1) report.duplicates.push({ pair: k, ids });
  const ctJobs = [];
  for (const r of ct) {
    if (r.Preference != null) { report.ct.alreadySet++; continue; }
    ctJobs.push(async () => { if (await merge('Crew-Trades', r.Id, { Preference: 3 })) report.ct.stamped++; });
  }
  await inChunks(ctJobs, 8);

  // Crews
  const crews = await allPref('Crews', 'Id,CrewID', 'Members');
  report.crews.total = crews.length;
  const crJobs = [];
  for (const r of crews) {
    const body = {};
    if (r.Preference == null) body.Preference = 3;
    const roster = ROSTER[String(r.CrewID || '').trim().toLowerCase()];
    if (roster && !(r.Members && String(r.Members).trim())) body.Members = roster;
    if (!Object.keys(body).length) { report.crews.alreadySet++; continue; }
    crJobs.push(async () => {
      if (await merge('Crews', r.Id, body)) {
        if ('Preference' in body) report.crews.stamped++;
        if ('Members' in body) report.crews.membersSet++;
      }
    });
  }
  await inChunks(crJobs, 8);

  if (WRITE) {
    const ct2 = await all(list('Crew-Trades') + '/items?$select=Id,Preference&$top=500');
    const cr2 = await all(list('Crews') + '/items?$select=Id,Preference&$top=500');
    const nullCt = ct2.filter(r => r.Preference == null).length, nullCr = cr2.filter(r => r.Preference == null).length;
    report.readBack = { crewTradesNull: nullCt, crewsNull: nullCr };
    if (nullCt || nullCr) report.errors.push('Preference still null after write: Crew-Trades ' + nullCt + ', Crews ' + nullCr);
  }
  return report;
})();
