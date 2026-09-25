# Restore runbook

How to get the D2 Build Scheduler back after a bad change, layer by layer. Written 2026-09-25 with
WP8 of the 24 September build; keep it current when a backup mechanism changes.

Two kinds of damage need two kinds of backup. A bad Save, Auto-Schedule, reflow or flow run damages
**data on live projects**. A bad edit to the planner, a flow, a list or a view damages **the
solution**. The sections below say where each backup lives, how to check it exists, and how to put
things back. Every restore starts with a read of what is there now, and every restore here has a
dry run.

## Layer 1: projects in motion

### What exists

| Backup | Where | Made by | Covers |
|---|---|---|---|
| Item version history | every list, 50 versions per row | SharePoint, always on (verified on all 13 lists 2026-09-25) | one row at a time, any field, any time in the last 50 changes |
| Nightly snapshot | Documents library, folder `Backups`, files `<yyyy-MM-dd HHmm> <List>.json` | `D2 - Snapshot`, 03:00 Central | every row of all 13 lists, as SharePoint REST returns them |
| Recycle bin | site recycle bin, 93 days | SharePoint | deleted rows and files |

The snapshot is thirteen JSON files a night, about 1.2 MB in total at today's size. The flow emails
`stratirus@d2pools.com` only when it fails; a quiet morning means it ran. Retention is manual for
now: the folder grows by a set a day, and old sets can be deleted from the library.

### Check the snapshot ran

Open Documents > Backups on the site and look for today's stamp. Or from a signed-in console:

```
fetch("/sites/D2BuildScheduler/_api/web/GetFolderByServerRelativeUrl('/sites/D2BuildScheduler/Shared Documents/Backups')/Files?$select=Name,Length&$orderby=TimeCreated desc&$top=13",
  {headers:{Accept:'application/json;odata=nometadata'}}).then(r=>r.json()).then(j=>console.table(j.value))
```

Thirteen files with today's stamp, and `Tasks.json` the largest, is a good run. A missing list or a
2-byte file for a list that has rows is not.

### Restore one project to a snapshot

`sharepoint/restore-project.js`. It puts one project's Jobs row, Assignments rows and Tasks rows back
the way a snapshot holds them, writing only the fields that differ: crew, dates, duration, lock, N/A,
the sign-off with its person and time, the reopen notes, the task counters, the rejection state, and
every task tick and N/A reason. Machine-owned columns (calendar event ids, conflict flags, trade
flags) are left for the nightly flows to recompute.

1. Open the site in a browser signed in as a site Owner. DevTools > Sources > Snippets, paste the
   script.
2. Set `SNAPSHOT` to the stamp of the set to restore from (the part of the file name before the list
   name, for example `2026-09-25 0300`) and `JOB_NUMBER` to the project.
3. Run it with `DRY_RUN` true (the default). It prints every field it would change with the live
   value beside the snapshot value. Nothing is written.
4. Read the plan. Then set `DRY_RUN` to false and run it again.
5. It re-reads every row afterwards and prints anything that still differs.

It refuses the whole restore, and writes nothing, when the project has changed shape since the
snapshot: a sub-phase or task row that no longer exists, a row that was added, or a project deleted
and created again under the same job number (a different row with different ids). Those cases need
a person to decide, not a script.

Assignments writes carry `SuppressReconcileUntil` ten minutes ahead, so a 46-row restore does not
fire Event-Driven Reconciliation once per row.

**Rehearsed:** see the record at the end of this file.

### Restore one row from its version history

For a single row, SharePoint's own version history is quicker than a snapshot. Open the row on the
site, `...` > Version history, pick the version, Restore. That restores every field on the row, which
is usually what is wanted for one row and not for forty-six.

### A deleted project

`D2 - Delete Pool` removes the Tasks, the Assignments and the Job, in that order. The rows sit in
the site recycle bin for 93 days and can be restored from there, Tasks and Assignments included,
with their ids intact. Restore the Job row first, then the Assignments, then the Tasks, so the
lookups resolve. The calendar events are separate: `D2 - Calendar Sync` recreates them on its next
run for an Active project.

The snapshot also holds the rows, but the restore script does not create rows, so for a deleted
project the recycle bin is the route.

## Layer 2: the solution

### What exists

| Piece | Backup | How to check it is current |
|---|---|---|
| The planner (`web/`) | git on Azure DevOps; a `deploy/yyyy-mm-dd` tag on every Static Web App deploy | `git tag -l 'deploy/*'` names the deployed commits |
| The flows | `flows/exports/*.json`, one content-verified export per flow; and `flows/solution/D2BuildSchedulerFlows-<date>.zip`, an export of the `D2BuildSchedulerFlows` solution holding all 16 flows and their 3 connection references | `python flows/scripts/export-flows.py` after any flow change; `pac solution export --name D2BuildSchedulerFlows --path flows/solution/D2BuildSchedulerFlows-<date>.zip --managed false` weekly |
| The canvas app | `canvas-app/src` in git; `canvas-app/solution-D2BuildScheduler.zip` | the deploy loop in `canvas-app/deploy.py` re-exports it |
| List schema, views, form formatters | `sharepoint/schema-live/lists-<date>.json` | re-capture with the read in the session log of 2026-09-25 (fields, views with CAML and formatters, content-type form formatters for all 13 lists) |
| Reference data (crews, trades, calendar, templates) | in every nightly snapshot | same check as the snapshot |
| The Entra app, the Static Web App, the group settings | ids and settings recorded in `CLAUDE.md` | recreating them is an hour of work from that record, not a restore |

The flows sit in **two** solutions on purpose. `D2BuildScheduler` holds the canvas app and is what
`canvas-app/deploy.py` exports, swaps and re-imports on every app deploy; putting the flows in it
would push sixteen flow definitions through every canvas deploy. `D2BuildSchedulerFlows` holds the
flows and nothing else.

### Roll back the planner

```
git checkout deploy/<date>
az account set --subscription cbcbe68b-bbaa-4926-bd9a-d33f0a9bd312
TOKEN=$(az staticwebapp secrets list --name swa-d2-build-scheduler --resource-group rg-d2-build-scheduler --query "properties.apiKey" -o tsv)
npx -y @azure/static-web-apps-cli deploy ./web --deployment-token "$TOKEN" --env production
```

Then the wall checks: every path 302 to `/.auth/login/aad`, `/auth-redirect.html` 200,
`/.auth/login/github` 404.

### Restore one flow from its export

Read the newest `flows/exports/<Flow>-<date>.json`. Its `definition` and `connectionReferences` go
back through FlowAgent: `update_flow` for the existing flow (the definition lands in the draft), then
`PublishXml` against the flow's `workflowEntityId` from the same file, then confirm with `get_flow`
that the published definition matches. Omit `authentication` inside action inputs; the service
injects it. The full mechanics are in `flows/README.md` and the draft-row section of `CLAUDE.md`.

### Restore every flow at once

Import `flows/solution/D2BuildSchedulerFlows-<date>.zip` as an unmanaged solution
(`pac solution import --path <zip>`). It carries the connection references, which bind to the existing
connections in D2 Automation. Flows import in their exported state; check each is Started
afterwards. This is the route for a fresh environment as well as for a rollback.

### Rebuild a list, a view or a form

`sharepoint/schema-live/lists-<date>.json` holds every list's fields (with validation formulas and
choices), every view's CAML and JSON formatter, and each content type's form formatter. The
provisioning scripts under `sharepoint/` recreate most of it from scratch; for a single view or
formatter, the capture is the thing to paste back.

## Not covered, on purpose

- The M365 group calendar. `D2 - Calendar Sync` rebuilds it on its 04:30 full sweep for every Active
  project.
- Power Platform connections. Re-created by consenting once as `stratirus@d2pools.com`.
- Emails already sent.

## Rehearsal record

| Date | What | Result |
|---|---|---|
| 2026-09-25 | `D2 - Snapshot` first run, and a second after the demo pools were deleted | 13 files each; Jobs 2, Assignments 92, Tasks 590 matched the live counts row for row |
| 2026-09-25 | Solution export | 16 workflow definitions and 3 connection references in the zip |
| 2026-09-25 | `restore-project.js` against a throwaway Planned pool (`TEST-9600`, 46 sub-phases, 295 tasks): fifteen fields damaged across the Jobs row, three sub-phases and two tasks (start date, crew, duration, a full installer sign-off with person and time, notes, counters, lock, N/A, a task tick with person and time, a task N/A with reason), then restored from the snapshot taken before the damage. The real script ran under Node with only the transport swapped for the session proxy | dry run listed exactly the 15 fields and wrote nothing; live run wrote 6 rows, 0 failed; the script's verify pass and an independent read-back both showed every field back as the snapshot held it, cleared person and date fields included |
