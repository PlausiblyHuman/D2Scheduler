/* Realign Jobs.StartDate with each pool's first scheduled sub-phase.
 *
 * WHY: found 2026-09-11 auditing live data. `D2 - Reschedule Pool` rewrites the
 * Assignments dates but never writes `Jobs.StartDate` back, so after any reflow
 * the field drifts and stays drifted. On the three demo pools it is weeks to
 * months out:
 *
 *     D2-1044 Salcedo    Jobs.StartDate 2026-09-28   first assignment 2026-08-10
 *     D2-1042 Reyes      Jobs.StartDate 2026-09-14   first assignment 2026-09-08
 *     D2-1043 Whitfield  Jobs.StartDate 2026-09-21   first assignment 2026-06-15
 *
 * Whitfield reads as starting in ten days on the Jobs list while it has been
 * running since June and finishes 2026-09-30. `Jobs` is the list PMs are sent to
 * in order to commit a pool, so this is on a screen people use.
 *
 * SAFE TO RUN, and that was checked rather than assumed:
 *   - Nothing READS Jobs.StartDate after creation. `D2 - New Pool` writes it from
 *     the request; `D2 - Reschedule Pool` reads `NewStartDate` off its own
 *     TRIGGER, not off the Jobs row. Every flow export was grepped.
 *   - No flow TRIGGERS on the Jobs list. Triggers are: Assignments (Flow 3), the
 *     three request lists, Recurrence, and PowerApps. Jobs' GUID appears in none.
 *   - `Late-Starting Jobs` filters `Assignments.ScheduledStart`, not this field.
 *   So this is display-only. It changes what a PM reads and nothing else.
 *
 * DATES ARE WRITTEN AS BARE 'yyyy-MM-dd'. Never an explicit ...T00:00:00Z --
 * that is the Phase A off-by-one this project already fixed once. SharePoint
 * interprets a bare date in site-local time and stores local midnight.
 *
 * This treats the SYMPTOM. The flow gap is still open: decide whether a reflow
 * should move the job's own start date (a reflow from sequence 5 clearly should
 * not, so the likely answer is "only when FromSequence is 1").
 *
 * Run in the browser console on the site, signed in as stratirus@d2pools.com.
 * Idempotent: a second run reports 0 changed. Set DRY_RUN to see the plan first.
 */
(async () => {
  const DRY_RUN = false;

  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=nometadata' };
  const get = async p => (await (await fetch(site + p, { headers: H, credentials: 'include' })).json());

  const dg = await (await fetch(site + '/_api/contextinfo', {
    method: 'POST', credentials: 'include',
    headers: { Accept: 'application/json;odata=verbose' }
  })).json();
  const digest = dg.d.GetContextWebInformation.FormDigestValue;

  const jobs = (await get("/_api/web/lists/GetByTitle('Jobs')/items"
    + "?$select=Id,JobNumber,Title,StartDate&$top=500")).value;

  // Earliest ScheduledStart per job. Paged, because Assignments grows by 46 a pool.
  let url = site + "/_api/web/lists/GetByTitle('Assignments')/items"
    + "?$select=JobId,ScheduledStart&$top=2000";
  const asg = [];
  while (url) {
    const d = await (await fetch(url, { headers: H, credentials: 'include' })).json();
    asg.push(...(d.value || []));
    url = d['odata.nextLink'] || null;
  }
  const earliest = new Map();
  asg.forEach(a => {
    if (!a.ScheduledStart) return;
    const d = a.ScheduledStart.slice(0, 10);
    const cur = earliest.get(a.JobId);
    if (!cur || d < cur) earliest.set(a.JobId, d);
  });

  const plan = [];
  jobs.forEach(j => {
    const want = earliest.get(j.Id);
    const have = j.StartDate ? String(j.StartDate).slice(0, 10) : null;
    if (want && want !== have) plan.push({ id: j.Id, job: j.JobNumber, title: j.Title, from: have, to: want });
  });

  console.table(plan);
  if (DRY_RUN) { console.log('DRY_RUN - nothing written. ' + plan.length + ' row(s) would change.'); return plan; }
  if (!plan.length) { console.log('Nothing to do; every Jobs.StartDate already matches.'); return plan; }

  const failures = [];
  for (const p of plan) {
    const r = await fetch(site + "/_api/web/lists/GetByTitle('Jobs')/items(" + p.id + ")", {
      method: 'POST', credentials: 'include',
      headers: {
        Accept: 'application/json;odata=verbose',
        'Content-Type': 'application/json;odata=verbose',
        'X-RequestDigest': digest,
        'X-HTTP-Method': 'MERGE',
        'IF-MATCH': '*'
      },
      body: JSON.stringify({ __metadata: { type: 'SP.Data.JobsListItem' }, StartDate: p.to })
    });
    if (!r.ok) failures.push({ id: p.id, status: r.status, body: (await r.text()).slice(0, 200) });
  }

  // Verify by reading back, never by the status code.
  const after = (await get("/_api/web/lists/GetByTitle('Jobs')/items?$select=Id,JobNumber,StartDate&$top=500")).value;
  const stillWrong = after.filter(j => {
    const want = earliest.get(j.Id);
    return want && String(j.StartDate).slice(0, 10) !== want;
  }).map(j => j.JobNumber);

  const out = { attempted: plan.length, failures, stillWrong };
  console.log(JSON.stringify(out, null, 2));
  console.table(after.map(j => ({ job: j.JobNumber, StartDate: String(j.StartDate).slice(0, 10) })));
  return out;
})();
