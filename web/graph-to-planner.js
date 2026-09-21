/* Map a Microsoft Graph read of Jobs/Assignments/Tasks/Work Calendar into the
 * exact payload shape `sharepoint/export-to-planner.js` already produces --
 * {app, kind:'d2-sharepoint-export', exported, site, nonWork, jobs:[...]}.
 *
 * WHY THE SAME SHAPE: `importFromD2` in web/index.html knows nothing about
 * Graph, REST or the connector -- it only knows this shape. Matching it here
 * means the planner needs no change at all to read live from Graph, and every
 * existing merge/lock/local-template test keeps working unaltered. Do not add
 * fields to the output beyond what export-to-planner.js emits.
 *
 * WHY THIS FILE IS SEPARATE FROM export-to-planner.js, not a second code path
 * inside it: Graph and REST are read from different runtimes (a hosted app
 * with a bearer token vs. a console paste on the SharePoint origin with
 * cookies), and CLAUDE.md records six separate cycles lost to assuming one
 * surface's field shape carries over to another. Keeping the mapping in its
 * own file, written and tested against a captured Graph payload only, is the
 * discipline that prevents a seventh.
 *
 * THE SHAPES, read off fixtures/planner/live-payloads-graph.json, not
 * assumed. Every join field is renamed AND retyped from the REST shape:
 *
 *   REST                          Graph
 *   JobId            (number)     fields.JobLookupId          (string)
 *   AssignmentId     (number)     fields.AssignmentLookupId   (string)
 *   Id               (number)     fields.id                   (string)
 *   InstallerSignOffById          fields.InstallerSignOffByLookupId (string,
 *                                   not read here -- the planner has no use
 *                                   for the numeric site-user id, only for
 *                                   InstallerSignOff itself)
 *
 * `Crew`, `Sequence`, `DurationDays`, `TasksTotal`, `Locked`, `NotApplicable`,
 * `InstallerSignOff`, `Complete` and every date field are the SAME name and
 * shape on both surfaces -- see the table in CLAUDE.md. Every row here is
 * `{ id, eTag, fields: {...} }`; the columns that matter are under `fields`.
 *
 * THE STRING-VS-NUMBER TRAP IS THE WHOLE RISK. `fields.JobLookupId` is the
 * string `"20"`; a job's own `fields.id` is also a string, `"20"` -- but nothing
 * guarantees a caller compares them as the same type, and a naive `===` between
 * a string and a number matches nothing while raising no error, exactly the
 * silent-empty-join class that once wrote TradeMismatch on 66 correctly-qualified
 * rows. Every join here goes through `key()`, which normalises with String()
 * before comparing, on both sides, always.
 *
 * DATES: SharePoint DateOnly columns come back at site-local midnight
 * (T05:00:00Z under CDT, T06:00:00Z under CST), so the first 10 characters are
 * already the intended day. `.slice(0, 10)` only -- never `new Date()`, which
 * reintroduces the 2026-09-03 off-by-one this project already paid for once.
 *
 * `ProjectManagerLookupId` is an id with no display name -- Graph did not
 * `$expand` the lookup the way the REST export's `$expand=ProjectManager`
 * does. The name comes from `graph.users`, the site's User Information List,
 * read ONCE per Refresh by the caller (not once per job). Since 2026-09-21 the
 * Jobs tab shows and filters by PM, so the name is no longer unused. With no
 * `users` it stays '' as before, which is also what the fixtures without a
 * user list exercise.
 *
 * `people` is the same list reduced to real sign-ins, for the + Job PM
 * picker. That list ALSO holds SharePoint groups, the M365 group claim and
 * system principals; an earlier resolver matched the "Owners" group on an
 * empty field and looked confident. Only a `i:0#.f|membership|` claim is a
 * person, and a `#ext#` guest is left out because this tenant carries guest
 * duplicates of real staff.
 *
 * Read-only. This module never calls fetch, never writes anything -- it only
 * transforms arrays already read by the caller (the planner's own MSAL/Graph
 * calls, or a test fixture).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.D2GraphToPlanner = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SITE_DEFAULT = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';

  // SharePoint DateOnly columns land at site-local midnight -- the date part
  // of the ISO string is already the intended day. Never new Date() this.
  function day(v) { return v ? String(v).slice(0, 10) : null; }

  // Every join in this file goes through here so a string never silently
  // fails to match a number of the same value.
  function key(v) { return v == null ? null : String(v); }

  function toPlannerPayload(graph) {
    graph = graph || {};
    const jobs = graph.jobs || [];
    const asg = graph.asg || [];
    const tasks = graph.tasks || [];
    const cal = graph.cal || [];

    const tasksByAsg = new Map();
    tasks.forEach(t => {
      const k = key(t.fields.AssignmentLookupId);
      if (!tasksByAsg.has(k)) tasksByAsg.set(k, []);
      tasksByAsg.get(k).push(t);
    });

    const asgByJob = new Map();
    asg.forEach(a => {
      const k = key(a.fields.JobLookupId);
      if (!asgByJob.has(k)) asgByJob.set(k, []);
      asgByJob.get(k).push(a);
    });

    // Guard the joins against the empty set, per CLAUDE.md: a broken join
    // does not error, it silently yields nothing. Every row on the tenant
    // today carries a parent, so these should be zero; a future null/blank
    // lookup should be visible rather than swallowed.
    const orphanAsg = asg.filter(a => !jobs.some(j => key(j.fields.id) === key(a.fields.JobLookupId))).length;
    const orphanTask = tasks.filter(t => !asg.some(a => key(a.fields.id) === key(t.fields.AssignmentLookupId))).length;
    if (typeof console !== 'undefined' && console.warn) {
      if (orphanAsg) console.warn('graph-to-planner: ' + orphanAsg + ' assignment(s) joined to no job');
      if (orphanTask) console.warn('graph-to-planner: ' + orphanTask + ' task(s) joined to no assignment');
    }

    const MEMBER = 'i:0#.f|membership|';
    const people = [];
    const nameById = new Map();
    (graph.users || []).forEach(u => {
      const f = u.fields || u;
      nameById.set(key(f.id), f.Title || '');
      const claim = String(f.Name || '').toLowerCase();
      if (claim.indexOf(MEMBER) !== 0 || claim.indexOf('#ext#') !== -1) return;
      people.push({ id: key(f.id), name: f.Title || '', upn: claim.slice(MEMBER.length) });
    });
    people.sort((a, b) => a.name.localeCompare(b.name));

    const payload = {
      app: 'D2 Pool Build Scheduler',
      kind: 'd2-sharepoint-export',
      exported: new Date().toISOString().slice(0, 10),
      site: graph.site || SITE_DEFAULT,
      nonWork: [...new Set(cal.map(c => day(c.fields.Date)).filter(Boolean))].sort(),
      jobs: jobs.map(j => {
        const jf = j.fields;
        const jobId = key(jf.id);
        return {
          id: Number(jf.id),
          jobno: jf.JobNumber,
          name: jf.Title,
          addr: jf.Address || '',
          city: jf.City || '',
          start: day(jf.StartDate),
          status: jf.Status || '',
          // See the file header: Graph returns only ProjectManagerLookupId;
          // the name comes from graph.users when the caller read it.
          pm: nameById.get(key(jf.ProjectManagerLookupId)) || '',
          pmId: jf.ProjectManagerLookupId == null ? null : key(jf.ProjectManagerLookupId),
          sections: (asgByJob.get(jobId) || [])
            .slice()
            .sort((a, b) => (a.fields.Sequence || 0) - (b.fields.Sequence || 0))
            .map(a => {
              const af = a.fields;
              const asgId = key(af.id);
              return {
                id: Number(af.id),
                seq: af.Sequence || null,
                num: af.SubPhaseNumber,
                name: af.SubPhaseName,
                crewId: af.Crew || null,
                start: day(af.ScheduledStart),
                finish: day(af.ScheduledFinish),
                days: af.DurationDays || null,
                skip: !!af.NotApplicable,
                locked: !!af.Locked,
                inst: !!af.InstallerSignOff,
                pm: !!af.PMSignOff,
                tasks: (tasksByAsg.get(asgId) || [])
                  .slice()
                  .sort((x, y) => (x.fields.Sequence || 0) - (y.fields.Sequence || 0))
                  .map(t => ({
                    // Graph returns every id as a STRING; the REST export gives a
                    // number. Normalised here so the planner and the write layer
                    // never have to care which surface the payload came from.
                    id: t.fields.id != null ? Number(t.fields.id) : (t.id != null ? Number(t.id) : null),
                    seq: t.fields.Sequence,
                    title: t.fields.Title,
                    done: !!t.fields.Complete,
                    na: !!t.fields.NotApplicable,
                    // The N/A reason. Graph omits an empty column entirely, so
                    // absent means no reason, never an error.
                    note: t.fields.Note == null ? '' : String(t.fields.Note)
                  }))
              };
            })
        };
      })
    };
    if (people.length) payload.people = people;

    return payload;
  }

  return { toPlannerPayload };
});
