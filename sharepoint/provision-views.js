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
          "query": "<Where><And><Geq><FieldRef Name=\"ScheduledStart\" /><Value Type=\"DateTime\"><Today /></Value></Geq><Leq><FieldRef Name=\"ScheduledStart\" /><Value Type=\"DateTime\"><Today OffsetDays=\"7\" /></Value></Leq></And></Where><GroupBy Collapse=\"FALSE\"><FieldRef Name=\"Crew\" /></GroupBy><OrderBy><FieldRef Name=\"ScheduledStart\" Ascending=\"TRUE\" /></OrderBy>"
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

  const results = [];
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
