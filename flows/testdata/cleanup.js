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
 *
 * COVERS SIX LISTS: Tasks, Assignments, Jobs, New Pool Requests, Delete Pool
 * Requests, Reschedule Requests. The three request lists were added after this
 * script was first written -- New Pool / Delete Pool Requests on 2026-09-08b,
 * Reschedule Requests on 2026-09-09 -- and each time the script predated the
 * list and silently ignored it, so the pre-pilot gate did not actually clear it.
 * All three request lists are treated more cautiously than Tasks/Assignments/
 * Jobs: see the comment on REQUEST_LISTS below.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=verbose' };
  const get = async u => (await fetch(u, { headers: H, credentials: 'include' })).json();
  const dg = await (await fetch(site + '/_api/contextinfo',
    { method: 'POST', headers: H, credentials: 'include' })).json();
  const digest = dg.d.GetContextWebInformation.FormDigestValue;

  // DRY_RUN reports exactly what WOULD go without deleting anything. Rehearse the
  // pre-pilot gate with this on: it is the only way to see the blast radius before
  // committing to it, and the gate is otherwise a one-shot destructive step run
  // under time pressure on a live client tenant.
  const DRY_RUN = false;

  const del = (list, id) => DRY_RUN
    ? Promise.resolve({ list, id, status: 204, dryRun: true })
    : fetch(`${site}/_api/web/lists/GetByTitle('${list}')/items(${id})`, {
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

  // ---- request lists ------------------------------------------------------
  // New Pool Requests, Delete Pool Requests and Reschedule Requests are all
  // CLIENT-FACING operational logs, not scratch space -- a PM opens them and
  // sees a history of real requests. So this deletes only rows it can PROVE
  // are ours (a TEST- job number, or the demo job) and merely REPORTS anything
  // else. A blanket wipe here would destroy a PM's real request history the
  // first time someone ran this script after go-live, which is precisely when
  // it looks harmless.
  //
  // All three flows trigger on item CREATION, so deleting rows fires nothing.
  //
  // Note these rows are only the REQUEST records. Deleting a New Pool Request
  // does not remove the pool it created, and deleting a Reschedule Request
  // does not undo the reflow it already ran; the Jobs/Assignments/Tasks passes
  // above are what actually clear pool data, and they run first.
  const REQUEST_LISTS = [
    ['New Pool Requests', 'JobNumber'],
    ['Delete Pool Requests', 'ConfirmJobNumber'],  // field names differ, read off the live lists
    ['Reschedule Requests', 'JobNumber']
  ];
  const requests = {};
  for (const [list, jobField] of REQUEST_LISTS) {
    const rows = (await get(`${site}/_api/web/lists/GetByTitle('${list}')`
      + `/items?$select=ID,Title,${jobField},Status&$top=500`)).d.results;
    const mine = rows.filter(r => doomed(r[jobField]));
    const other = rows.filter(r => !doomed(r[jobField]));
    for (let i = 0; i < mine.length; i += 8) {
      res.push(...await Promise.all(mine.slice(i, i + 8).map(r => del(list, r.ID))));
    }
    requests[list] = {
      deleted: mine.length,
      leftForReview: other.map(r =>
        ({ id: r.ID, title: r.Title, job: r[jobField] || '(blank)', status: r.Status }))
    };
  }

  const a2 = await get(`${site}/_api/web/lists/GetByTitle('Assignments')/items?$select=ID,Title&$top=500`);
  const j2 = await get(`${site}/_api/web/lists/GetByTitle('Jobs')/items?$select=ID,JobNumber&$top=100`);
  const t2 = await get(`${site}/_api/web/lists/GetByTitle('Tasks')/items?$select=ID&$top=1000`);
  const out = {
    dryRun: DRY_RUN,
    dropDemoJob: DROP_DEMO_JOB,
    deletedTasks: doomedT.length,
    deletedAssignments: doomedA.length,
    deletedJobs: doomedJ.length,
    failures: res.filter(x => x.status !== 200 && x.status !== 204),
    remainingAssignments: a2.d.results.map(r => r.ID),
    remainingJobs: j2.d.results.map(r => r.JobNumber),
    remainingTasks: t2.d.results.length,
    requests,
    expected: DRY_RUN
      ? 'DRY RUN -- nothing was deleted. The deleted* counts are what WOULD go.'
      : (DROP_DEMO_JOB
          ? 'assignments [], jobs [], tasks 0  -- tenant clean, ready for the first real pool'
          : 'assignments [1,2,3,4,5], jobs ["D2-1001"], tasks 30')
  };

  // Rows this script refused to delete. Before the pilot the request lists should
  // be EMPTY, so anything here is either a build-time row whose name carries no
  // TEST- marker, or a real request. Deleting it is a human decision.
  const review = Object.entries(requests).flatMap(([list, r]) =>
    r.leftForReview.map(x => ({ list, ...x })));
  if (review.length) {
    console.warn(`${review.length} request row(s) NOT deleted -- review by hand before the pilot:`);
    console.table(review);
  }
  console.log(JSON.stringify(out, null, 2));
  return out;
})();
