/* Export the live schedule out of SharePoint and into the browser planner.
 *
 * WHY THIS EXISTS: Shane, 2026-09-11 -- "if the html isn't up to date what's
 * the point?" The browser planner (`D2-Build-Scheduler/.../pool-scheduler.html`)
 * is the only Gantt in this system and the only place a PM can sequence crews by
 * eye, but it had no connection to SharePoint at all. It seeded three fictional
 * pools of its own, stored everything in localStorage, and nothing a PM did there
 * ever reached the system. Linking it from the PM guide would have sent people to
 * a tool showing pools that do not exist.
 *
 * This closes the SharePoint -> planner direction only. It is deliberately NOT
 * the never-built nightly sync (see CLAUDE.md, "THE NIGHTLY SYNC FLOW DOES NOT
 * EXIST"): nothing here writes back. The planner stays a planning surface and
 * SharePoint stays the source of truth for execution state.
 *
 * WHY NOT WRITE BACK: the planner has no sign-off model. Its `inst`/`pm` are bare
 * booleans with no attribution, no timestamp and no notes, while SharePoint holds
 * InstallerSignOffBy/On and SignOffNotes. Pushing the planner's version over a
 * live row would overwrite attested work with a flag. That is why the sync was
 * descoped on 2026-09-05 and it is a worse trade now than it was then.
 *
 * HOW TO RUN
 *   1. Open https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler
 *      signed in as any member (read-only is enough -- this only ever GETs).
 *   2. Paste this into the browser console. DevTools > Sources > Snippets avoids
 *      Chrome's paste guard entirely; in the Console you must first type the
 *      words `allow pasting`.
 *   3. It downloads `d2-live-schedule-<date>.json`.
 *   4. Open the planner and click "Load from D2", pick that file.
 *
 * FIELD NAMES ARE READ OFF A REAL PAYLOAD, not guessed -- they come from the
 * write bodies in flows/exports/D2-New-Pool-*.json, which is what actually
 * creates these rows. Two that are easy to get wrong:
 *   - `Crew` is a CHOICE column. Raw REST with odata=nometadata returns it as a
 *     PLAIN STRING (the short code, e.g. "devon"), which is exactly what the
 *     planner's crewId wants. The SharePoint *connector* would return
 *     {Id, Value} instead. See CLAUDE.md on Choice column shapes.
 *   - The Tasks lookup is `AssignmentId` in REST/OData. (`Assignment` +
 *     `Assignment#Id` is the *connector* shape -- not what we get here.)
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=nometadata' };

  // Page through a list rather than trusting a single $top. Tasks is 885 rows
  // today and grows by 295 per pool, so this WILL exceed a default page.
  async function all(path) {
    let url = site + path, out = [];
    while (url) {
      const r = await fetch(url, { headers: H, credentials: 'include' });
      if (!r.ok) throw new Error(r.status + ' on ' + url.slice(0, 120));
      const d = await r.json();
      out = out.concat(d.value || []);
      url = d['odata.nextLink'] || null;
    }
    return out;
  }

  const T0 = Date.now();
  const [jobs, asg, tasks] = await Promise.all([
    all("/_api/web/lists/GetByTitle('Jobs')/items"
      + "?$select=Id,Title,JobNumber,Address,City,StartDate,Status,ProjectManager/Title"
      + "&$expand=ProjectManager&$top=500"),
    all("/_api/web/lists/GetByTitle('Assignments')/items"
      + "?$select=Id,JobId,SubPhaseNumber,SubPhaseName,Sequence,Crew,ScheduledStart,"
      + "ScheduledFinish,DurationDays,Locked,NotApplicable,InstallerSignOff,PMSignOff"
      + "&$top=2000&$orderby=Id"),
    all("/_api/web/lists/GetByTitle('Tasks')/items"
      + "?$select=Id,AssignmentId,Sequence,Title,Complete&$top=5000&$orderby=Id")
  ]);

  // SharePoint stores these DateOnly columns at site-local midnight, so the date
  // part of the ISO string is already the intended day. Never new Date() them --
  // that reintroduces the off-by-one this project fixed on 2026-09-03.
  const day = v => (v ? String(v).slice(0, 10) : null);

  const tasksByAsg = new Map();
  tasks.forEach(t => {
    const k = t.AssignmentId;
    if (!tasksByAsg.has(k)) tasksByAsg.set(k, []);
    tasksByAsg.get(k).push(t);
  });

  const asgByJob = new Map();
  asg.forEach(a => {
    if (!asgByJob.has(a.JobId)) asgByJob.set(a.JobId, []);
    asgByJob.get(a.JobId).push(a);
  });

  const payload = {
    app: 'D2 Pool Build Scheduler',
    kind: 'd2-sharepoint-export',
    exported: new Date().toISOString().slice(0, 10),
    site,
    jobs: jobs.map(j => ({
      jobno: j.JobNumber,
      name: j.Title,
      addr: j.Address || '',
      city: j.City || '',
      start: day(j.StartDate),
      status: j.Status || '',
      pm: (j.ProjectManager && j.ProjectManager.Title) || '',
      sections: (asgByJob.get(j.Id) || [])
        .sort((a, b) => (a.Sequence || 0) - (b.Sequence || 0))
        .map(a => ({
          num: a.SubPhaseNumber,
          name: a.SubPhaseName,
          crewId: a.Crew || null,
          start: day(a.ScheduledStart),
          finish: day(a.ScheduledFinish),
          days: a.DurationDays || null,
          skip: !!a.NotApplicable,
          locked: !!a.Locked,
          inst: !!a.InstallerSignOff,
          pm: !!a.PMSignOff,
          tasks: (tasksByAsg.get(a.Id) || [])
            .sort((x, y) => (x.Sequence || 0) - (y.Sequence || 0))
            .map(t => ({ seq: t.Sequence, title: t.Title, done: !!t.Complete }))
        }))
    }))
  };

  const stamp = payload.exported;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 1)],
    { type: 'application/json' }));
  a.download = 'd2-live-schedule-' + stamp + '.json';
  a.click();

  // Summary only. Returning the payload itself floods the console.
  const secs = payload.jobs.reduce((n, j) => n + j.sections.length, 0);
  const tks  = payload.jobs.reduce((n, j) =>
    n + j.sections.reduce((m, s) => m + s.tasks.length, 0), 0);
  const orphanAsg  = asg.filter(a => !jobs.some(j => j.Id === a.JobId)).length;
  const orphanTask = tasks.filter(t => !asg.some(a => a.Id === t.AssignmentId)).length;
  const out = {
    file: a.download,
    pools: payload.jobs.length,
    subPhases: secs, tasks: tks,
    signedOff: payload.jobs.reduce((n, j) => n + j.sections.filter(s => s.inst).length, 0),
    ticked: payload.jobs.reduce((n, j) =>
      n + j.sections.reduce((m, s) => m + s.tasks.filter(t => t.done).length, 0), 0),
    byPool: payload.jobs.map(j => j.jobno + ' ' + j.name + ' [' + j.status + '] '
      + j.sections.length + ' sub-phases'),
    // Non-zero here means rows exist that the planner will never see.
    orphanAssignments: orphanAsg, orphanTasks: orphanTask,
    droppedSubPhases: secs === asg.length - orphanAsg ? 0 : (asg.length - orphanAsg - secs),
    ms: Date.now() - T0
  };
  console.log(JSON.stringify(out, null, 2));
  if (orphanAsg || orphanTask) console.warn('Orphan rows found -- see counts above.');
  return out;
})();
