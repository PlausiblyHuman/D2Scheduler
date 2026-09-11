# D2 Pool Build Scheduler

A crew-scheduling tool for pool construction, plus the plan for moving it onto
Microsoft Power Platform, plus the source documents and clean data extracts
everything was built from.

Packaged 2026-08-13.

---

## Start here

**The tool itself moved on 2026-09-11** to `web/index.html` at the repo root,
ahead of Azure Static Web Apps hosting. This folder's `app/` subdirectory is
now empty; the data extracts, source documents and deployment plan below are
still here. Open **`web/index.html`** (two levels up from this README) in any
browser. No install, no server, no internet. Double-click it.

---

## What's in the box

```
web/index.html ................ the tool itself, moved here 2026-09-11
                                 (repo root, not this folder)
docs/
  D2-Power-Platform-Deployment-Plan.html
                              . 13-week plan to move this onto Dataverse
data/
  trades.csv .................. 26 trades
  crews.csv ................... 14 crews
  crew-members.csv ............ 21 named members
  crew-trades.csv ............. 51 crew-to-trade qualifications
  phase-template.csv .......... 8 parent phases
  sub-phase-template.csv ...... 46 sub-phases with trade + duration
  task-template.csv ........... 295 checklist tasks
  phase-template.json ......... the same phase data, nested
  crews-and-trades.json ....... the same crew data, nested
source/
  MASTER TO COPY FROM D2 Gunite Build Phases.xlsx
  D2 Pools Crews.pdf
```

The `data/` files are generated directly from the app, so they cannot drift out
of sync with it. They are also the migration payload for the deployment plan —
load them in the order listed above and foreign keys resolve.

---

## The tool

### What it guarantees

- A crew is only assigned to a sub-phase whose required trade it actually holds.
- A field crew is never on two pools the same day.
- Sub-phases run in order — one cannot start before the one before it ends.
- Mon–Sat are work days. Sunday is not.

Anything that breaks these rules turns up in **Schedule Check** at the top of
the Job Board.

### Tabs

| Tab | For |
|---|---|
| **Job Board** | Gantt by job. Parent phases collapse; click a bar to reassign, move, lock, or open its checklist. |
| **Crew Board** | Same timeline flipped to crews — this is where double-booking would show up in red. |
| **Daily Dispatch** | Pick a day: each crew's job, address, sub-phase, and "day 2 of 2". The morning printout. |
| **Sign-Offs** | Installer and PM sign-off progress per job. |
| **Jobs** | Job ID, name, street/city/state/ZIP, start date. |
| **Crews** | Crews, members, sizes, and click-to-toggle trades. Plus skill coverage. |
| **Phase Template** | The 8 phases / 46 sub-phases / 295 tasks. Edit here, then "Apply to all jobs". |

### Buttons

- **Auto-Schedule** — replans every job: earliest qualified crew with the
  lightest load that is free for the whole block.
- **Backup / Restore** — see the warning below.
- **CSV** — full schedule export, one row per sub-phase.
- **Reset** — back to seeded crews, template, and three demo jobs.

### ⚠ Your data lives in the browser, not in the file

The tool saves to the browser's local storage. **Copying the HTML file to
another machine does not carry your jobs with it** — you'll get the seed data.

To move real work between machines or browsers:

1. **Backup** on the old machine → saves `d2-scheduler-backup-YYYY-MM-DD.json`
2. Open the tool on the new machine
3. **Restore** → pick that file

Same applies to browsers on one machine — Chrome and Safari do not share
storage. Take a Backup before anything irreversible; Reset is not undoable.

---

## Known gaps in the data

Carried forward deliberately rather than papered over. All five are decisions
for D2, not bugs in the tool.

1. **Four crews have no size or member list** — George, Armondo,
   STL Shotcrete, Brothers.
2. **Ten trades map to no sub-phase**: Forms, Grading, Water Line Install,
   Pavers, Retaining Walls, CMU Block, Brick/Masonry, Veneer/Stone,
   Landscaping, Material Runs. George Crew is scheduled zero days as a result.
3. **Finish Grade on Saul and Guillermo is an inference**, not from the crew
   list. Cirilo is the only crew explicitly excluded from it, which implies the
   others do it. Untick it on the Crews tab if that's wrong.
4. **Eleven sub-phases sit in Unassigned** — the field supervision and QC items.
   They need an owner, or a PM crew needs to exist.
5. **All 46 durations are a 2-day placeholder.** Fine for testing the system.
   Not fine for quoting a customer a finish date.

---

## The deployment plan

`docs/D2-Power-Platform-Deployment-Plan.html` covers moving this to Dataverse:
13 tables, a low-code scheduling flow in Power Automate, a model-driven app for
the office, an offline mobile app for crew leads, Power BI for ownership,
roughly $400/month for 21 users, 13 weeks.

Its central idea: a `Crew Day` table with a **Dataverse alternate key on
Crew + Date** makes double-booking impossible at the database level, without
writing any C#.

The plan treats this browser tool as the test oracle — feed both systems the
same pools and any divergence is a bug you can localize.
