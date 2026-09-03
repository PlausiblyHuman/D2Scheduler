/* Remove the TEST-9001 / TEST-9002 seed data.
 *
 * Run in the browser console on https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler
 * while signed in. STOP Flow 3 and Flow 4 first, or each delete fires a reconciliation run.
 *
 * Idempotent: deletes only rows whose Title starts with TEST-, and only Jobs whose
 * JobNumber starts with TEST-. Safe to re-run; reports what it found.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=verbose' };
  const get = async u => (await fetch(u, { headers: H, credentials: 'include' })).json();
  const dg = await (await fetch(site + '/_api/contextinfo',
    { method: 'POST', headers: H, credentials: 'include' })).json();
  const digest = dg.d.GetContextWebInformation.FormDigestValue;

  const del = (list, id) => fetch(`${site}/_api/web/lists/GetByTitle('${list}')/items(${id})`, {
    method: 'POST', credentials: 'include',
    headers: { ...H, 'X-RequestDigest': digest, 'IF-MATCH': '*', 'X-HTTP-Method': 'DELETE' }
  }).then(r => ({ list, id, status: r.status }));

  const a = await get(`${site}/_api/web/lists/GetByTitle('Assignments')/items?$select=ID,Title&$top=500`);
  const doomedA = a.d.results.filter(r => String(r.Title || '').startsWith('TEST-'));
  const j = await get(`${site}/_api/web/lists/GetByTitle('Jobs')/items?$select=ID,JobNumber&$top=100`);
  const doomedJ = j.d.results.filter(r => String(r.JobNumber || '').startsWith('TEST-'));

  const res = [];
  for (let i = 0; i < doomedA.length; i += 8) {
    res.push(...await Promise.all(doomedA.slice(i, i + 8).map(r => del('Assignments', r.ID))));
  }
  for (const r of doomedJ) res.push(await del('Jobs', r.ID));

  const a2 = await get(`${site}/_api/web/lists/GetByTitle('Assignments')/items?$select=ID,Title&$top=500`);
  const j2 = await get(`${site}/_api/web/lists/GetByTitle('Jobs')/items?$select=ID,JobNumber&$top=100`);
  const out = {
    deletedAssignments: doomedA.length,
    deletedJobs: doomedJ.length,
    failures: res.filter(x => x.status !== 200 && x.status !== 204),
    remainingAssignments: a2.d.results.map(r => r.ID),
    remainingJobs: j2.d.results.map(r => r.JobNumber),
    expected: 'assignments [1,2,3,4,5], jobs ["D2-1001"]'
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
})();
