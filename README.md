# D2 Build Scheduler

Pool construction scheduling and field sign-off for **D2 Pools**, delivered by **Stratirus**.

SharePoint Lists + Power Automate + Power Apps canvas on D2's existing Microsoft 365 stack. Zero incremental licensing. Owned end-to-end by Stratirus under the standard 3-year retainer.

## What it does

- Holds the master schedule of active pools and their sub-phases
- Emails a daily morning dispatch to each crew lead
- Captures per-task sign-off from the field via a Power Apps canvas app (WorkDate distinct from submission timestamp for QC audit)
- Detects double-booked crews within one polling interval; posts to Teams
- Emails weekly and daily PDF summaries to ownership

## Where to start

- **`CLAUDE.md`** — durable orientation for any Claude session working in this repo. Read first.
- **`D2-Option-A-Lists-Deployment-Plan-RevD.docx`** — authoritative design spec
- **`D2-Phase-A-Foundation-Runbook.md`** through **`D2-Phase-F-Cutover-Runbook.md`** — build week by week
- **`web/index.html`** — the browser scheduler (permanent PM planner role). Moved here
  2026-09-11 from the doubled `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`
  ahead of Azure Static Web Apps hosting; that directory no longer holds the planner.
  Determinism fix and subcontractor patch applied 2026-09-11; fed from SharePoint by
  `sharepoint/export-to-planner.js` via its "Load from D2" button. Tests: `oracle-test.js`
  and `fixtures/planner/`. There is no `patched-tool/` directory and there never was one.
- **`D2-Build-Scheduler/D2-Build-Scheduler/data/*.csv`** — trades, crews, crew-trades and the phase/sub-phase/task templates (this is where the seed CSVs actually live; there is no `seed-data/`)
- **`sessions/`** — dated session logs

## Stack

| Component | Purpose |
|---|---|
| SharePoint site + 6 lists | Data model |
| Power Automate (5 flows, standard connectors) | Dispatch, sign-off intake, reconciliation, PDF summaries |
| Power Apps canvas app (standard rights) | Crew-lead sign-off UI |
| Teams channels | Field Dispatch + Ownership |
| Browser scheduler (permanent) | PM planning tool |

## Related repos

- **Scaffold** — Stratirus project template + helper scripts
- (D2 has a separate Power Platform "D2 Automation" environment used by an estimator engine, which coexists with this project's flows.)
