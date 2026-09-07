/* Apply a pool plan produced by tools/add_pool.py to SharePoint.
 *
 * This is the missing half of the pool pipeline. add_pool.py plans a complete
 * pool -- one Job, 46 sub-phase Assignments, ~295 Tasks, all four business rules
 * enforced -- and writes NOTHING. Its docstring told the reader to "apply it
 * with tools/write-pool.js", and that file did not exist until now, so there was
 * no way at all to get a planned pool into SharePoint.
 *
 * That matters more than it sounds. There is no browser-tool -> Lists sync
 * (Phase G, descoped from the pilot 2026-09-05), so this script is how EVERY
 * pool reaches SharePoint, real or test. It is not test scaffolding.
 *
 * It is still not self-service. A PM cannot run this. Making "new pool" a thing
 * D2 can do unaided is a separate, larger piece of work.
 *
 * -------------------------------------------------------------------- usage
 *   1. python tools/add_pool.py --job D2-1002 --name "..." --address "..." \
 *          --city "..." --percent-done 0
 *   2. Upload tools/pool-plan.json to the site's Site Assets library
 *      (drag and drop into /SiteAssets is fine).
 *   3. STOP Flows 3 and 4. Every Assignment insert fires the reconciliation
 *      flow, so 46 inserts burn 46 runs and can raise spurious alerts.
 *   4. Run this file in the browser console on the site, signed in as
 *      stratirus@d2pools.com. Re-run until it reports remaining: 0.
 *   5. RESTART Flows 3 and 4.
 *
 * Resumable and idempotent. It writes in bounded chunks and returns progress,
 * because a single CDP/console call is cut off around 45 seconds and a full pool
 * is ~342 row creates. Re-running skips everything already present, matching
 * Jobs on JobNumber, Assignments on Title, and Tasks on parent + Sequence.
 *
 * --------------------------------------------------------------- known traps
 * DATES are written as bare 'yyyy-MM-dd' strings, never '...T00:00:00Z'. The
 * site is UTC-06:00 Central; an explicit midnight-UTC value is read back by the
 * SharePoint connector as the PREVIOUS day. Phase A seeding did that and
 * silently inverted the work week -- Flow 1 would have dispatched on Sundays and
 * terminated on Saturdays.
 *
 * FOUR REQUIRED BOOLEANS/NUMBER on Assignments -- Locked, NotApplicable,
 * PMSignOff, DurationDays -- are set explicitly on every row. REST creation
 * bypasses required-field validation but the list FORM does not, so a row
 * created without them cannot afterwards be edited in the UI at all.
 *
 * JOIN KEYS ARE CODES, NEVER DISPLAY LABELS. Crew is the short code ('devon'),
 * matching Crews.CrewID -- Crews.Title carries a '+N' headcount suffix and has
 * broken every join that used it. Trade is resolved through Trades.TradeCode
 * ('shotcrete'), not Trades.Title ('Shotcrete / Gunite'). Lookups are written
 * as JobId / AssignmentId / TradeId, which is the REST spelling; note the
 * connector's OUTPUT spells them differently again.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const PLAN_URL = site + '/SiteAssets/pool-plan.json';
  const CHUNK = 8;              // parallel creates; field creates must be serial, item creates need not be
  const BUDGET_MS = 32000;      // stop well inside the ~45s console/CDP cutoff

  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };
  const g = async u => (await fetch(u, { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json();
  const started = Date.now();
  const outOfTime = () => Date.now() - started > BUDGET_MS;

  const create = async (list, type, body) => {
    const r = await fetch(site + "/_api/web/lists/GetByTitle('" + list + "')/items", {
      method: 'POST', credentials: 'include', headers: HD,
      body: JSON.stringify({ __metadata: { type }, ...body }) });
    if (!r.ok) return { ok: false, status: r.status, err: (await r.text()).slice(0, 200) };
    return { ok: true, item: (await r.json()).d };
  };

  // ---- plan --------------------------------------------------------------
  const res = await fetch(PLAN_URL, { credentials: 'include' });
  if (!res.ok) return { error: 'plan not found at ' + PLAN_URL + ' (status ' + res.status + ') -- upload pool-plan.json to Site Assets first' };
  const raw = await res.json();
  // accept the full plan or the minified variant
  const plan = raw.job ? raw : {
    job: raw.j,
    assignments: (raw.a || []).map(a => ({ num: a.n, name: a.m, skill: a.skill, crew: a.c,
      start: a.s, finish: a.f, days: a.d, tasks: a.t, tasksTotal: (a.t || []).length,
      tasksComplete: a.tc, installerSignOff: a.so }))
  };
  if (!plan.job || !plan.assignments) return { error: 'unrecognised plan shape' };

  const report = { job: plan.job.jobNumber, created: { jobs: 0, assignments: 0, tasks: 0 }, errors: [] };

  // ---- lookup maps -------------------------------------------------------
  const trades = await g(site + "/_api/web/lists/GetByTitle('Trades')/items?$select=Id,TradeCode&$top=200");
  const tradeByCode = Object.fromEntries(trades.value.filter(t => t.TradeCode).map(t => [t.TradeCode, t.Id]));

  // ---- Job ---------------------------------------------------------------
  const jq = await g(site + "/_api/web/lists/GetByTitle('Jobs')/items?$select=Id,JobNumber&$top=500"
    + "&$filter=JobNumber eq '" + plan.job.jobNumber.replace(/'/g, "''") + "'");
  let jobId = jq.value.length ? jq.value[0].Id : null;
  if (!jobId) {
    const r = await create('Jobs', 'SP.Data.JobsListItem', {
      Title: plan.job.title, JobNumber: plan.job.jobNumber,
      Address: plan.job.address || '', City: plan.job.city || '',
      StartDate: plan.job.startDate,                 // bare yyyy-MM-dd, deliberately
      Status: plan.job.status || 'Active' });
    if (!r.ok) { report.errors.push({ where: 'Job', ...r }); return report; }
    jobId = r.item.Id; report.created.jobs = 1;
  }
  report.jobId = jobId;

  // ---- Assignments -------------------------------------------------------
  const title = a => plan.job.jobNumber + ' · ' + a.num + ' ' + a.name;
  const existingA = await g(site + "/_api/web/lists/GetByTitle('Assignments')/items"
    + '?$select=Id,Title&$top=5000&$filter=JobId eq ' + jobId);
  const aIdByTitle = Object.fromEntries(existingA.value.map(x => [x.Title, x.Id]));

  const missingA = plan.assignments.filter(a => !aIdByTitle[title(a)]);
  for (let i = 0; i < missingA.length && !outOfTime(); i += CHUNK) {
    const slice = missingA.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map((a, k) => {
      const seq = plan.assignments.indexOf(a) + 1;
      const body = {
        Title: title(a), JobId: jobId,
        SubPhaseNumber: a.num, SubPhaseName: a.name,
        Crew: a.crew || 'unassigned',                 // short code, matches Crews.CrewID
        Sequence: seq,
        ScheduledStart: a.start, ScheduledFinish: a.finish,
        DurationDays: a.days,                         // WORK days, not the calendar span
        TasksTotal: a.tasksTotal != null ? a.tasksTotal : (a.tasks || []).length,
        TasksComplete: a.tasksComplete || 0,
        InstallerSignOff: !!a.installerSignOff,
        Locked: false, NotApplicable: false, PMSignOff: false
      };
      if (a.skill && tradeByCode[a.skill]) body.TradeId = tradeByCode[a.skill];
      return create('Assignments', 'SP.Data.AssignmentsListItem', body)
        .then(r => ({ r, t: title(a) }));
    }));
    for (const { r, t } of results) {
      if (r.ok) { aIdByTitle[t] = r.item.Id; report.created.assignments++; }
      else report.errors.push({ where: 'Assignment ' + t, ...r });
    }
  }

  // ---- Tasks -------------------------------------------------------------
  const aIds = Object.values(aIdByTitle);
  const existingT = {};
  for (let i = 0; i < aIds.length; i += 20) {
    const f = aIds.slice(i, i + 20).map(id => 'AssignmentId eq ' + id).join(' or ');
    const t = await g(site + "/_api/web/lists/GetByTitle('Tasks')/items"
      + '?$select=Id,Sequence,AssignmentId&$top=5000&$filter=' + encodeURIComponent(f));
    for (const row of t.value) (existingT[row.AssignmentId] ||= new Set()).add(row.Sequence);
  }

  let remaining = 0;
  outer:
  for (const a of plan.assignments) {
    const aid = aIdByTitle[title(a)];
    if (!aid) { remaining += (a.tasks || []).length; continue; }
    const have = existingT[aid] || new Set();
    const todo = (a.tasks || []).map((name, idx) => ({ name, seq: idx + 1 }))
      .filter(t => !have.has(t.seq));
    for (let i = 0; i < todo.length; i += CHUNK) {
      if (outOfTime()) { remaining += todo.length - i; break outer; }
      const slice = todo.slice(i, i + CHUNK);
      const results = await Promise.all(slice.map(t => create('Tasks', 'SP.Data.TasksListItem', {
        Title: t.name, AssignmentId: aid, Sequence: t.seq,
        // tasksComplete counts from the FRONT of the list, matching add_pool.py's
        // notion of a part-finished sub-phase
        Complete: t.seq <= (a.tasksComplete || 0)
      })));
      for (const r of results) {
        if (r.ok) report.created.tasks++;
        else report.errors.push({ where: 'Task ' + a.num, ...r });
      }
    }
  }

  // ---- progress ----------------------------------------------------------
  const nowA = await g(site + "/_api/web/lists/GetByTitle('Assignments')/items?$select=Id&$top=5000&$filter=JobId eq " + jobId);
  report.totals = {
    assignmentsWanted: plan.assignments.length, assignmentsPresent: nowA.value.length,
    tasksWanted: plan.assignments.reduce((n, a) => n + (a.tasks || []).length, 0)
  };
  report.remaining = report.totals.assignmentsWanted - report.totals.assignmentsPresent > 0
    ? 'assignments still missing -- re-run' : (remaining > 0 ? remaining + ' tasks -- re-run' : 0);
  report.tradesMapped = Object.keys(tradeByCode).length;
  report.errors = report.errors.slice(0, 10);
  return report;
})();
