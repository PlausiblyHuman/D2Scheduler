# 2026-09-16a — planner polish, and sign-off recorded from the planner

**Written after the fact, in 2026-09-16b.** This session ended in an unexpected machine reboot before
a log was written. Everything below is reconstructed from its commits, which were all pushed, and from
the CLAUDE.md entries it wrote. Decisions are those the commit messages attribute to Shane; nothing
here is inferred beyond that.

**Session goal:** get the planner ready for the pilot, which Shane decided runs on the planner alone
with no field crews on the canvas app.

## What shipped

| Commit | Change |
|---|---|
| `285c810` | Job Board: dates on every row, sub-phase names open the editor, Auto-Schedule reports what it moved and offers Undo |
| `ce06f93` | Auto-Schedule documented in the PM guide and demo run sheet; drawer screenshots unclipped |
| `9930feb` | The timeline opens on today, and keeps the user's scroll across re-renders |
| `852d497` | Phase Template tab: confirmations on the three actions that reach every pool; the planner prints |
| `a807fff` | Schedule Check offers "Push from here" on a late sub-phase; signing off with open tasks is warned |
| `5eacb09` | Task rows carry their SharePoint id; `planSignoffs` / `planTaskTicks` in the core |
| `a920d30` | Sign-off and task ticks recorded through Save, with who and when; Reopen appends a trace |
| `87652a4` | The Activate dialog says it writes immediately, unlike everything else |

## Decisions (from the commit messages)

- **Sign-off is recordable from the planner.** The pilot has no field crews on the canvas app, so it is
  recordable here or nowhere. The old objection was a bare boolean with no attribution; the planner now
  writes the signed-in user and the time.
- **Signing off with unresolved tasks is warned, not blocked**, for the pilot.

## Left open at the reboot

- The INST/PM tooltip added at 09:12 ("not saved back; the record is the field app") became false at
  10:02 and was still live. Closed in 2026-09-16b.
- The 15 browser assertions cited for the sign-off write path were never committed, and the write had
  never touched the tenant. Both closed in 2026-09-16b.
