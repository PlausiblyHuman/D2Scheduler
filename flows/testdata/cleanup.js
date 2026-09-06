/* Remove ALL non-production data: the TEST-9001 / TEST-9002 seed AND the Harrison
 * Residence D2-1001 demo job.
 *
 * D2-1001 is NOT a real pool. It is the browser prototype's hardcoded demo job
 * (pool-scheduler.html L258), carried into SharePoint during Week 1 seeding, and
 * Assignments 1-5 hang off it. Leaving it means going live with demo data in a
 * client tenant. Deleting it also disposes of three known seed defects: Assignment 1's
 * stale "Chrome-driven test" sign-off, Assignment 4's Sunday start (2026-09-06), and
 * the D2 Bot placeholder in Jobs.ProjectManager.
 *
 * Run in the browser console on https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler
 * while signed in. STOP Flow 3 and Flow 4 first, or each delete fires a reconciliation run.
 *
 * PRE-PILOT GATE: after this runs clean, the tenant holds no demo data and the first
 * real pool can be loaded. Set DROP_DEMO_JOB = false to remove only the TEST rows and
 * keep Harrison alive (use this while the canvas app is still being built against it).
 *
 * Idempotent. Deletes Assignments by Title prefix and by parent Job, and Jobs by
 * JobNumber. Safe to re-run; reports what it found and what remains.
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

  const DROP_DEMO_JOB = true;              // false = keep Harrison D2-1001 for app testing
  const DEMO_JOB = 'D2-1001';
  const doomed = n => String(n || '').startsWith('TEST-') || (DROP_DEMO_JOB && n === DEMO_JOB);

  const j = await get(`${site}/_api/web/lists/GetByTitle('Jobs')/items?$select=ID,JobNumber&$top=100`);
  const doomedJ = j.d.results.filter(r => doomed(r.JobNumber));
  const doomedJobIds = new Set(doomedJ.map(r => r.ID));

  // Assignments are matched two ways: by Title prefix (TEST- rows) and by parent Job
  // lookup id (Harrison's 1-5, whose Titles carry no marker at all).
  const a = await get(`${site}/_api/web/lists/GetByTitle('Assignments')`
    + `/items?$select=ID,Title,JobId&$top=500`);
  const doomedA = a.d.results.filter(r =>
    String(r.Title || '').startsWith('TEST-') || doomedJobIds.has(r.JobId));

  // Tasks hang off Assignments and must go first, or they are orphaned.
  const t = await get(`${site}/_api/web/lists/GetByTitle('Tasks')`
    + `/items?$select=ID,AssignmentId&$top=1000`);
  const doomedAIds = new Set(doomedA.map(r => r.ID));
  const doomedT = t.d.results.filter(r => doomedAIds.has(r.AssignmentId));

  const res = [];
  for (let i = 0; i < doomedT.length; i += 8) {
    res.push(...await Promise.all(doomedT.slice(i, i + 8).map(r => del('Tasks', r.ID))));
  }
  for (let i = 0; i < doomedA.length; i += 8) {
    res.push(...await Promise.all(doomedA.slice(i, i + 8).map(r => del('Assignments', r.ID))));
  }
  for (const r of doomedJ) res.push(await del('Jobs', r.ID));

  const a2 = await get(`${site}/_api/web/lists/GetByTitle('Assignments')/items?$select=ID,Title&$top=500`);
  const j2 = await get(`${site}/_api/web/lists/GetByTitle('Jobs')/items?$select=ID,JobNumber&$top=100`);
  const t2 = await get(`${site}/_api/web/lists/GetByTitle('Tasks')/items?$select=ID&$top=1000`);
  const out = {
    dropDemoJob: DROP_DEMO_JOB,
    deletedTasks: doomedT.length,
    deletedAssignments: doomedA.length,
    deletedJobs: doomedJ.length,
    failures: res.filter(x => x.status !== 200 && x.status !== 204),
    remainingAssignments: a2.d.results.map(r => r.ID),
    remainingJobs: j2.d.results.map(r => r.JobNumber),
    remainingTasks: t2.d.results.length,
    expected: DROP_DEMO_JOB
      ? 'assignments [], jobs [], tasks 0  -- tenant clean, ready for the first real pool'
      : 'assignments [1,2,3,4,5], jobs ["D2-1001"], tasks 30'
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
})();
