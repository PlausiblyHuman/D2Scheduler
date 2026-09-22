/* Recreate the eight office SharePoint views on Assignments and Tasks.
 *
 * These views ARE the office surface. The canvas app is the field surface, the
 * summary emails are the ownership surface, and the browser tool is the planner;
 * day-to-day office work happens in the list views below. The Phase D site
 * launchpad links straight at them.
 *
 * Why this file exists: the views were originally created on 2026-09-07 by REST
 * fired from a browser console in-session, and nothing was committed. They lived
 * only in the tenant. Phase A's exit gate had already once claimed "all views
 * show correct filters" when not one of them existed, which is exactly the
 * failure a committed artifact prevents -- a script is either in the repo or it
 * is not. Definitions below were captured from the live site, not re-authored,
 * so they cannot drift from what was verified.
 *
 * Run in the browser console on https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler
 * while signed in as stratirus@d2pools.com.
 *
 * Idempotent: a view that already exists is left alone and reported as "kept".
 * Pass RECREATE = true to delete and rebuild them, which is what you want after
 * editing a definition here.
 *
 * WEEK WINDOW: "This Week by Crew" filters on the calculated column
 * Assignments.WeekMonday, NOT on ScheduledStart directly. CAML has no
 * start-of-week primitive -- the documented children of <Value> are
 * ListProperty, Month, Now, Today, UserID and XML, and there is no <Week/> --
 * so "Monday to Saturday of the current week" cannot be written as a static
 * filter on a date column at all. It was originally ScheduledStart within
 * [Today]..[Today]+7, which is a rolling seven days, so on a Thursday the view
 * showed Thursday to next Thursday under the name "This Week". That disagreed
 * with the weekly summary flow, which scores Mon-Sat.
 *
 * WeekMonday = ScheduledStart - WEEKDAY(ScheduledStart,2) + 1, the Monday of the
 * row's own week, derived from the row alone and never from [Today] -- a
 * calculated column referencing [Today] only recalculates when the item is
 * edited, which is the standard SharePoint stale-value trap.
 *
 * The filter WeekMonday <= [Today] AND WeekMonday >= [Today]-6 then selects
 * exactly the current Mon-Sun week. With Today = M + d for d in 0..6:
 *   current week  (WM = M)    M <= M+d and M >= M+d-6      both hold for all d
 *   previous week (WM = M-7)  needs d <= -1                never holds
 *   next week     (WM = M+7)  needs d >= 7                 never holds
 * No work starts on a Sunday (business rule 4), so in practice this is Mon-Sat.
 *
 * PAGING: every view is Paged=true. They were originally stored RowLimit=100 with
 * Paged=FALSE, which in SharePoint means "return 100 and stop" rather than "100 per
 * page". Measured on the live list: Incomplete Tasks returned 100 rows with NO next
 * link against a true count of 184, and All Tasks (by Assignment) capped at 100 of
 * 282. Nothing indicated rows were missing -- the list simply appeared to end. The
 * Assignments views were under the cap at 43 rows but share the setting and would
 * have started truncating at roughly three pools.
 *
 * NOTE a view can be created with invalid CAML and fail only when a human opens
 * it, so a 201 on create proves nothing. This script renders every view through
 * RenderListDataAsStream afterwards and reports the row count, which is the real
 * test. A view that 201s and then throws on render is reported as BROKEN.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo',
    { method: 'POST', headers: H, credentials: 'include' })).json();
  const digest = dg.d.GetContextWebInformation.FormDigestValue;
  const HD = { ...H, 'X-RequestDigest': digest };
  const get = async u => (await fetch(u, { headers: H, credentials: 'include' })).json();
  const q = s => s.replace(/'/g, "''");

  // Existing views are RECONCILED IN PLACE rather than dropped and rebuilt.
  // Recreating would mint a new view GUID, and the Phase D site launchpad links
  // at these views, so in-place keeps those links valid. It also means this
  // script is a "make it so" reconciler: edit a definition above, re-run, done.

  const VIEWS = [
      {
          "list": "Assignments",
          "title": "All Assignments",
          "viewFields": [
              "LinkTitle",
              "SubPhaseNumber",
              "SubPhaseName",
              "Crew",
              "ScheduledStart",
              "ScheduledFinish",
              "InstallerSignOff",
              "TasksComplete",
              "TasksTotal"
          ],
          "rowLimit": 100,
          "paged": true,
          "query": "<GroupBy Collapse=\"FALSE\"><FieldRef Name=\"Job\" /></GroupBy><OrderBy><FieldRef Name=\"ScheduledStart\" Ascending=\"TRUE\" /></OrderBy>"
      },
      {
          "list": "Assignments",
          "title": "This Week by Crew",
          "viewFields": [
              "LinkTitle",
              "SubPhaseNumber",
              "SubPhaseName",
              "ScheduledStart",
              "ScheduledFinish",
              "InstallerSignOff",
              "TasksComplete",
              "TasksTotal"
          ],
          "rowLimit": 100,
          "paged": true,
          "query": "<Where><And><Leq><FieldRef Name=\"WeekMonday\" /><Value Type=\"DateTime\"><Today /></Value></Leq><Geq><FieldRef Name=\"WeekMonday\" /><Value Type=\"DateTime\"><Today OffsetDays=\"-6\" /></Value></Geq></And></Where><GroupBy Collapse=\"FALSE\"><FieldRef Name=\"Crew\" /></GroupBy><OrderBy><FieldRef Name=\"ScheduledStart\" Ascending=\"TRUE\" /></OrderBy>"
      },
      {
          // ADDED 2026-09-09: the office's by-pool lens for the current week, replacing
          // "Today by Crew" as the home page hero once six pools were loaded (see
          // build-home-page.js). Filter is copied VERBATIM from "This Week by Crew" above --
          // same WeekMonday <= Today AND WeekMonday >= Today-6 window, same reasoning (CAML
          // has no start-of-week primitive). Only the GroupBy changes, Job instead of Crew,
          // and Crew is added back as a viewFields column (mirroring "All Assignments", which
          // also groups by Job and shows Crew) since grouping by Job makes Crew the thing a
          // reader needs restated per row.
          "list": "Assignments",
          "title": "This Week by Job",
          "viewFields": [
              "LinkTitle",
              "SubPhaseNumber",
              "SubPhaseName",
              "Crew",
              "ScheduledStart",
              "ScheduledFinish",
              "InstallerSignOff",
              "TasksComplete",
              "TasksTotal"
          ],
          "rowLimit": 100,
          "paged": true,
          "query": "<Where><And><Leq><FieldRef Name=\"WeekMonday\" /><Value Type=\"DateTime\"><Today /></Value></Leq><Geq><FieldRef Name=\"WeekMonday\" /><Value Type=\"DateTime\"><Today OffsetDays=\"-6\" /></Value></Geq></And></Where><GroupBy Collapse=\"FALSE\"><FieldRef Name=\"Job\" /></GroupBy><OrderBy><FieldRef Name=\"ScheduledStart\" Ascending=\"TRUE\" /></OrderBy>"
      },
      {
          "list": "Assignments",
          "title": "Unassigned",
          "viewFields": [
              "LinkTitle",
              "SubPhaseNumber",
              "SubPhaseName",
              "Trade",
              "ScheduledStart",
              "ScheduledFinish",
              "Crew"
          ],
          "rowLimit": 100,
          "paged": true,
          "query": "<Where><And><Or><Or><IsNull><FieldRef Name=\"Crew\" /></IsNull><Eq><FieldRef Name=\"Crew\" /><Value Type=\"Text\" /></Eq></Or><Eq><FieldRef Name=\"Crew\" /><Value Type=\"Text\">unassigned</Value></Eq></Or><IsNotNull><FieldRef Name=\"Trade\" /></IsNotNull></And></Where><OrderBy><FieldRef Name=\"ScheduledStart\" Ascending=\"TRUE\" /></OrderBy>"
      },
      {
          "list": "Assignments",
          "title": "Sign-off Overdue",
          "viewFields": [
              "LinkTitle",
              "SubPhaseNumber",
              "SubPhaseName",
              "ScheduledFinish",
              "TasksComplete",
              "TasksTotal",
              "InstallerSignOff"
          ],
          "rowLimit": 100,
          "paged": true,
          "query": "<Where><And><Lt><FieldRef Name=\"ScheduledFinish\" /><Value Type=\"DateTime\"><Today /></Value></Lt><Eq><FieldRef Name=\"InstallerSignOff\" /><Value Type=\"Integer\">0</Value></Eq></And></Where><GroupBy Collapse=\"FALSE\"><FieldRef Name=\"Crew\" /></GroupBy><OrderBy><FieldRef Name=\"ScheduledFinish\" Ascending=\"TRUE\" /></OrderBy>"
      },
      {
          "list": "Assignments",
          "title": "Late-Starting Jobs",
          "viewFields": [
              "LinkTitle",
              "SubPhaseNumber",
              "SubPhaseName",
              "Crew",
              "ScheduledStart",
              "ScheduledFinish",
              "InstallerSignOff"
          ],
          "rowLimit": 100,
          "paged": true,
          "query": "<Where><And><Lt><FieldRef Name=\"ScheduledStart\" /><Value Type=\"DateTime\"><Today /></Value></Lt><Eq><FieldRef Name=\"InstallerSignOff\" /><Value Type=\"Integer\">0</Value></Eq></And></Where><GroupBy Collapse=\"FALSE\"><FieldRef Name=\"Job\" /></GroupBy><OrderBy><FieldRef Name=\"ScheduledStart\" Ascending=\"TRUE\" /></OrderBy>"
      },
      {
          // ADDED 2026-09-09: crew conflicts made visible in SharePoint, not just
          // email. `ConflictWith` is stamped nightly by `D2 - Conflict Flag`,
          // which is the only place the same-crew/overlapping-dates/different-job
          // self-join can be computed -- CAML cannot express it, so this view is
          // a pure filter on a column a flow already wrote, not a query that
          // detects anything itself.
          //
          // IsNotNull, not Neq against an empty string: this list's clear-write
          // sets ConflictWith to "", and SharePoint stores that as NULL
          // internally for a Note field, so IsNotNull is the only filter that
          // returns just the 10 flagged rows -- Neq "" matched all 181.
          // Confirmed by rendering both against live data before committing to
          // this one.
          "list": "Assignments",
          "title": "Conflicts",
          "viewFields": [
              "LinkTitle",
              "Job",
              "SubPhaseNumber",
              "SubPhaseName",
              "ScheduledStart",
              "ScheduledFinish",
              "ConflictWith"
          ],
          "rowLimit": 100,
          "paged": true,
          "query": "<Where><IsNotNull><FieldRef Name=\"ConflictWith\" /></IsNotNull></Where><GroupBy Collapse=\"FALSE\"><FieldRef Name=\"Crew\" /></GroupBy><OrderBy><FieldRef Name=\"ScheduledStart\" Ascending=\"TRUE\" /></OrderBy>"
      },
      {
          // ADDED 2026-09-15: business rule 1 made visible. `TradeMismatch` is
          // stamped nightly at 05:15 Central by `D2 - Crew Trade Check`, which
          // joins Assignments.Crew -> Crews.CrewID -> Crew-Trades -> the row's
          // own Trade. Until this view existed the flag was written and then
          // read by nobody -- the enforcement was invisible unless someone
          // happened to open an individual row, which is the same as not having
          // it. Like Conflicts, this is a pure filter on a column a flow already
          // wrote; CAML cannot traverse a lookup into a second list, so the view
          // detects nothing itself.
          //
          // IsNotNull for the same reason as Conflicts: the clear-write sets
          // TradeMismatch to "", which SharePoint stores as NULL for a Note
          // field. Note also that a Note column CANNOT appear in an OData
          // $filter at all ("cannot be used in the query filter expression"),
          // so this view is the only practical way to list flagged rows.
          //
          // Expect it to be EMPTY most days, and that is the intended state --
          // 0 mismatches across 66 trade-checkable rows at the time of writing.
          // An empty view here is a pass, not a broken filter. The 72 rows whose
          // Trade is null are pseudo-trade rows (@office, @sub, @unassigned) and
          // are a deliberate PASS, so they never appear.
          "list": "Assignments",
          "title": "Trade Mismatch",
          "viewFields": [
              "LinkTitle",
              "Job",
              "SubPhaseNumber",
              "SubPhaseName",
              "Trade",
              "ScheduledStart",
              "TradeMismatch"
          ],
          "rowLimit": 100,
          "paged": true,
          "query": "<Where><IsNotNull><FieldRef Name=\"TradeMismatch\" /></IsNotNull></Where><GroupBy Collapse=\"FALSE\"><FieldRef Name=\"Crew\" /></GroupBy><OrderBy><FieldRef Name=\"ScheduledStart\" Ascending=\"TRUE\" /></OrderBy>"
      },
      {
          // ADDED 2026-09-22: a PM's sign-off rejection made visible. `Rejected`,
          // `RejectedOn` and `RejectedReason` are stamped by the planner's
          // reject-with-comments write path (see writeback-core.js), which also
          // logs the reason to the Sign-off Comments list -- this view is the
          // SharePoint-side counterpart, mirroring Conflicts and Trade Mismatch:
          // a pure filter on columns something else already wrote, not a query
          // that detects anything itself.
          //
          // Grouped by Job, not Crew. Conflicts and Trade Mismatch group by Crew
          // because both describe a crew-level problem; a rejected sign-off is
          // job-level work for the project manager who owns it, which is also how
          // the planner's own rejection list is scoped. Crew stays as a column.
          //
          // Rejected is Boolean, not Note, so unlike Conflicts/Trade Mismatch
          // there is no NULL-vs-empty-string ambiguity to route around -- a
          // plain Eq against 1 is correct on its own, and Eq against 0 is a
          // true inverse (proven when this view was provisioned; see the
          // session record for the render-based check).
          //
          // Expect it to be EMPTY most days, same as Trade Mismatch -- a
          // rejection is meant to be rare enough that a PM chases every one.
          "list": "Assignments",
          "title": "Rejected",
          "viewFields": [
              "LinkTitle",
              "Job",
              "SubPhaseNumber",
              "SubPhaseName",
              "Crew",
              "ScheduledStart",
              "RejectedOn",
              "RejectedReason"
          ],
          "rowLimit": 100,
          "paged": true,
          "query": "<Where><Eq><FieldRef Name=\"Rejected\" /><Value Type=\"Integer\">1</Value></Eq></Where><GroupBy Collapse=\"FALSE\"><FieldRef Name=\"Job\" /></GroupBy><OrderBy><FieldRef Name=\"ScheduledStart\" Ascending=\"TRUE\" /></OrderBy>"
      },
      {
          "list": "Assignments",
          "title": "Today by Crew",
          "viewFields": [
              "LinkTitle",
              "JobAddress",
              "JobCity",
              "ScheduledStart",
              "ScheduledFinish",
              "TasksComplete",
              "TasksTotal",
              "InstallerSignOff"
          ],
          "rowLimit": 200,
          "paged": true,
          "query": "<Where><And><Leq><FieldRef Name=\"ScheduledStart\" /><Value Type=\"DateTime\"><Today /></Value></Leq><Geq><FieldRef Name=\"ScheduledFinish\" /><Value Type=\"DateTime\"><Today /></Value></Geq></And></Where><GroupBy Collapse=\"FALSE\"><FieldRef Name=\"Crew\" /></GroupBy><OrderBy><FieldRef Name=\"Title\" Ascending=\"TRUE\" /></OrderBy>"
      },
      {
          "list": "Tasks",
          "title": "All Tasks (by Assignment)",
          "viewFields": [
              "LinkTitle",
              "Sequence",
              "Complete",
              "CompletedBy",
              "CompletedOn"
          ],
          "rowLimit": 100,
          "paged": true,
          "query": "<GroupBy Collapse=\"TRUE\"><FieldRef Name=\"Assignment\" /></GroupBy><OrderBy><FieldRef Name=\"Sequence\" Ascending=\"TRUE\" /></OrderBy>"
      },
      {
          "list": "Tasks",
          "title": "Incomplete Tasks",
          "viewFields": [
              "LinkTitle",
              "Sequence",
              "Complete",
              "CompletedBy",
              "CompletedOn"
          ],
          "rowLimit": 100,
          "paged": true,
          "query": "<Where><Eq><FieldRef Name=\"Complete\" /><Value Type=\"Integer\">0</Value></Eq></Where><GroupBy Collapse=\"TRUE\"><FieldRef Name=\"Assignment\" /></GroupBy><OrderBy><FieldRef Name=\"Sequence\" Ascending=\"TRUE\" /></OrderBy>"
      }
  ];

  // PREREQUISITE: the calculated column "This Week by Crew" filters on. Created
  // here rather than assumed, because a fresh list without it would leave that
  // view rendering empty with no error -- the exact silent-failure mode this
  // whole file exists to stop.
  const results = [];
  {
    const abase = `${site}/_api/web/lists/GetByTitle('Assignments')`;
    const have = await get(abase + "/fields?$select=InternalName&$filter=InternalName eq 'WeekMonday'");
    if (have.d.results.length) {
      results.push({ list: 'Assignments', view: '(field) WeekMonday', action: 'already correct' });
    } else {
      const schema = '<Field Type="Calculated" DisplayName="WeekMonday" Name="WeekMonday" '
        + 'ResultType="DateTime" Format="DateOnly" Hidden="FALSE" Required="FALSE">'
        + '<Formula>=[ScheduledStart]-WEEKDAY([ScheduledStart],2)+1</Formula>'
        + '<FieldRefs><FieldRef Name="ScheduledStart"/></FieldRefs></Field>';
      const fr = await fetch(abase + '/fields/CreateFieldAsXml', {
        method: 'POST', credentials: 'include', headers: HD,
        body: JSON.stringify({ parameters: {
          __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' },
          SchemaXml: schema,
          Options: 8            // AddFieldInternalNameHint; deliberately NOT added to any view
        } }) });
      results.push({ list: 'Assignments', view: '(field) WeekMonday',
                     action: fr.ok ? 'created' : 'CREATE FAILED ' + fr.status });
    }
  }

  for (const v of VIEWS) {
    const base = `${site}/_api/web/lists/GetByTitle('${q(v.list)}')`;
    const existing = await get(`${base}/views?$select=Title,Id`);
    const hit = (existing.d.results || []).find(x => x.Title === v.title);

    if (hit) {
      const cur = await get(`${base}/views('${hit.Id}')?$select=ViewQuery,RowLimit,Paged`);
      const drift = [];
      if (cur.d.ViewQuery !== v.query) drift.push('ViewQuery');
      if (cur.d.RowLimit !== v.rowLimit) drift.push('RowLimit');
      if (cur.d.Paged !== v.paged) drift.push('Paged');

      const curFields = await get(`${base}/views('${hit.Id}')/viewfields`);
      const have = curFields.d.Items.results;
      const fieldsDrift = JSON.stringify(have) !== JSON.stringify(v.viewFields);
      if (fieldsDrift) drift.push('ViewFields');

      if (!drift.length) {
        results.push({ list: v.list, view: v.title, action: 'already correct', id: hit.Id });
        continue;
      }
      const upd = await fetch(`${base}/views('${hit.Id}')`, {
        method: 'POST', credentials: 'include',
        headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
        body: JSON.stringify({ __metadata: { type: 'SP.View' },
                               ViewQuery: v.query, RowLimit: v.rowLimit, Paged: v.paged }) });
      if (fieldsDrift) {
        await fetch(`${base}/views('${hit.Id}')/viewfields/removeallviewfields`,
          { method: 'POST', credentials: 'include', headers: HD });
        for (const f of v.viewFields) {
          await fetch(`${base}/views('${hit.Id}')/viewfields/addviewfield('${q(f)}')`,
            { method: 'POST', credentials: 'include', headers: HD });
        }
      }
      results.push({ list: v.list, view: v.title, action: 'updated ' + drift.join('+'),
                     status: upd.status, id: hit.Id });
      continue;
    }

    // ViewFields cannot be set in the create payload -- the view is created first,
    // then fields are added one at a time via viewfields/addviewfield.
    const create = await fetch(`${base}/views`, {
      method: 'POST', credentials: 'include', headers: HD,
      body: JSON.stringify({
        __metadata: { type: 'SP.View' },
        Title: v.title,
        ViewQuery: v.query,
        RowLimit: v.rowLimit,
        Paged: v.paged,
        PersonalView: false
      })
    });
    if (!create.ok) {
      results.push({ list: v.list, view: v.title, action: 'CREATE FAILED ' + create.status,
                     detail: (await create.text()).slice(0, 300) });
      continue;
    }
    const made = (await create.json()).d;

    // Default views arrive carrying every field; clear before adding ours so the
    // column order is exactly what is defined above.
    await fetch(`${base}/views('${made.Id}')/viewfields/removeallviewfields`,
      { method: 'POST', credentials: 'include', headers: HD });
    for (const f of v.viewFields) {
      await fetch(`${base}/views('${made.Id}')/viewfields/addviewfield('${q(f)}')`,
        { method: 'POST', credentials: 'include', headers: HD });
    }
    results.push({ list: v.list, view: v.title, action: 'created', id: made.Id });
  }

  // Render every view. This is the actual verification -- invalid CAML survives
  // creation and only throws here.
  for (const r of results) {
    const v = VIEWS.find(x => x.list === r.list && x.title === r.view);
    if (!v) continue;                      // the WeekMonday field row, nothing to render
    try {
      const res = await fetch(
        `${site}/_api/web/lists/GetByTitle('${q(v.list)}')/RenderListDataAsStream`,
        { method: 'POST', credentials: 'include',
          headers: { ...HD, Accept: 'application/json;odata=nometadata' },
          body: JSON.stringify({ parameters: { ViewXml: `<View><Query>${v.query}</Query><RowLimit>${v.rowLimit}</RowLimit></View>` } }) });
      const body = await res.json();
      r.renders = res.ok ? (body.Row ? body.Row.length + ' rows' : '0 rows') : 'BROKEN ' + res.status;
    } catch (e) {
      r.renders = 'BROKEN ' + e.message;
    }
  }

  console.table(results);
  return results;
})();
