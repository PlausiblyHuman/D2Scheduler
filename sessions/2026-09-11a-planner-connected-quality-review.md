# 2026-09-11a — The planner gets connected, and an overnight quality review

**Session goal:** Shane asked where to host `pool-scheduler.html` so the PM guide could link to it.
Checking the file first turned that into a different question: *"this is a bigger fox that just got
missed. if the html isn't up to date what's the point?"* It wasn't up to date, in three separate
ways. The session became: connect the planner to SharePoint, then review the whole solution.

## The finding that reframed the night

The browser planner had **no connection to SharePoint at all**. Zero `fetch`, `localStorage` only,
manual Backup/Restore. It seeded three fictional California pools of its own (Harrison, Vasquez,
Bell Canyon) that match nothing in the tenant. It had sat untouched since **2026-08-13** while every
design decision in this project happened around it.

Worse, **two patches the repo said were applied were not.** CLAUDE.md described
`patched-tool/pool-scheduler.html` carrying an Auto-Schedule determinism fix, with a README and a
diff beside it. `git log --diff-filter=D` shows **that directory never existed** — described in the
original handoff, never migrated. Same for `seed-data/`. So the only copy of the planner had
neither patch, and CLAUDE.md had been telling every session otherwise for three weeks.

Hosting was the wrong question. A URL would have published a stale tool.

## What shipped

**1. Both missing patches applied, and measured.**

- Determinism: the load table was seeded from `crewLoad()`, which counts *every* assignment, so run
  2 inherited run 1's own tiebreaks. Now seeded from **locked** assignments only, matching how
  `busy` is seeded, plus `|| a.id.localeCompare(b.id)` as a stable secondary sort key.
  **4 of 138 crew picks drifted per re-run before; 0 after.**
- Subcontractors: `unlimited:true` on george, armondo, stl, brothers, so they are capacity-exempt
  per business rule 2. The diff had been sitting unapplied in `Subcontractor-Crew-Patch.md`.

**2. `sharepoint/export-to-planner.js`** — reads Jobs + Assignments + Tasks from the site and
downloads the live schedule. Read-only. Field names read off the write bodies in
`flows/exports/D2-New-Pool-*.json`, then **verified against live rows**.

**3. The planner gained "Load from D2", which MERGES by job number.** `Restore` swaps the whole
state and would destroy a pool a PM had sketched locally; this leaves local-only pools alone.
Structure always comes from the local phase template, so only what SharePoint owns is overlaid:
crew, dates, duration, flags, task ticks. **Signed-off and locked sub-phases import as `locked`**,
so a later Auto-Schedule cannot move completed work — the same rule `D2 - Reschedule Pool` applies
server-side.

**4. The three phantom demo pools are gone.** A first run now opens empty and points at Load from D2.

**5. Tests, where there were none.** `oracle-test.js` **could not run at all**: it required jsdom
from `/tmp/node_modules` and read the planner from a build-sandbox path. Repaired, and it now seeds
its own two pools, because with the demo pools removed most of its invariants passed **vacuously**
over zero assignments. `fixtures/planner/` adds four harnesses. `npm test` runs all five: **46
passing, 2 failing**, both failures the long-documented data gaps.

Scores on the same harness: **committed file 13/16 with idempotency FAILING, patched file 14/16.**
14/16 is exactly what CLAUDE.md always claimed for the phantom `patched-tool/`.

**6. End-to-end proof against real data.** `fixtures/planner/live-export.js` runs the real export
script with `fetch` stubbed to serve live payloads, then imports the result into the real planner.
**138 assignments, 885 tasks, 47 sign-offs, 398 ticks, nothing dropped.**

## Quality review

Read headlessly via a throwaway probe flow (created, used, **deleted** — the environment is back to
14 D2 flows plus `Generate estimate`, all Started).

**Repaired:** ten Assignments rows carried `ConflictWith` text describing dates the rows no longer
had, e.g. a row scheduled `2026-06-29 -> 06-30` flagged *"harrison also on D2-1042, 2 day(s) from
2026-10-05"*. Conflict Flag is nightly at 05:00 and the pools were reflowed at 14:33, so the flags
had been wrong and visible in the Conflicts view for ~16 hours. Ran Conflict Flag: **10 -> 0**,
verified by re-reading the rows.

**Corrected:** *"The Office 365 Groups connector has no list-events operation, so Calendar Sync
cannot self-heal"* was half right, and the wrong half closed off the better fix. There is no list
*operation*, but the connector exposes **`HttpRequestV2`**, a Graph passthrough, and
`GET /groups/{id}/events` through it **succeeded in 124 ms** with paging. So the Delete Pool
ghost-events gap can be closed inside Calendar Sync by enumerating the calendar, which heals
orphans from any cause. Deliberately not implemented: enumeration means a sweep no longer needs a
row to find an event, so a wrong "what should exist" set could delete the whole calendar.

**Everything else green:** row counts exact; demo staging matches; 0 signed-off sub-phases
scheduled into the future; 0 required-but-null; 0 counter drift; 0 unknown crew codes; 0
double-books; calendar 138 events / 138 event ids / 138 distinct, no orphans; **all 14 flow exports
match live by content**, all Started; one failure in 48h, from that flow's own build session.

## Files touched

- `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html` — both patches, Load from D2, seed removed
- `sharepoint/export-to-planner.js` — new
- `fixtures/planner/` — new: 4 harnesses, a 148 KB live capture, README
- `oracle-test.js` — repaired so it can run, and self-seeds
- `CLAUDE.md` — the phantom directories, the Groups correction, the reflow findings, the audit
- `README.md`, `package.json`, `.gitignore`

## Commits

`a02db78`, `deb3906`, `201e680`, `a4fa58a`

## Decisions

- **Merge by job number, not replace.** Safe whether the planner is a viewer or still a planning
  surface, so it did not need Shane awake to decide.
- **Carry progress, not just dates**, so a Gantt bar reads done / in flight / not started.
- **One way only.** The planner has no sign-off model (bare `inst`/`pm` booleans, no attribution),
  so writing back would overwrite attested work with a flag. The nightly sync stays descoped.
- **Structure from the local template, never the file**, so a partial payload cannot corrupt it.
- **No test pool created.** Verifying the Delete Pool fix end to end needs a create/delete cycle,
  and the cleanup would leave rows in client-facing request lists that cannot be removed without
  browser access.
- **The guide was not republished.** The planner paragraph is still accurate, and improving it is
  tied to the hosting decision.

## Open / needs Shane

1. **Hosting.** Still Azure Static Web Apps free tier at an unguessable URL, now worth doing because
   the tool is current. Open question: wide open, or behind Entra restricted to the D2 tenant.
2. **`D2 - Reschedule Pool` never writes `Jobs.StartDate`**, so it drifts permanently. Whitfield
   reads `2026-09-21` on the Jobs list while its first assignment starts `2026-06-15` and the pool
   finishes `2026-09-30`. Likely fix: write it only when `FromSequence` is 1. That is a product
   call.
3. **`ConflictWith` staleness window** between a reflow and the next 05:00 sweep. Cheap fix: the
   reflow calls Conflict Flag, or nulls `ConflictWith` on rows it moves.
4. **Calendar Sync self-healing sweep** now unblocked. Needs the guards written down in CLAUDE.md.
5. **This morning, before anything else:** add David, Don, Emon and Cody to the group, and repoint
   the summary emails. Deliberately still undone — access must not land before the introduction
   email.
6. **First unattended hourly Calendar Sync fires 04:30 Central today.** Had not run at wrap
   (00:54 CT). Worth a glance.

## Next action

Decide hosting, then publish the planner and add the link to the guide. Grant the four their access
in the morning.
