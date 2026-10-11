# Don's build-phase sheets, reviewed 2026-10-11

Source: Don Borgeson's email "Scheduler", 2026-10-10 15:51 Central, to Shane, with four workbooks
attached (also in D2's SharePoint, "Process standardization and AI Docs - Build Phases"). Read from
the email attachments; compared with the current template in
`D2-Build-Scheduler/D2-Build-Scheduler/data/sub-phase-template.csv` (46 sub-phases, 295 tasks).
That CSV is the 2026-09-07 seed source; the live `Sub-phase Template` list was not re-read for this.
The inline `image.png` attachment is the D2 logo from his signature, not a screenshot.

## The four sheets

| File | Sheet inside | Sub-phases | What it is |
|---|---|---|---|
| `Gunite Build Phase_Rev3_091726 (2).xlsx` | `Gunite Build Phase_Rev2_081426` | ~60 (46 today) | Revision of the current template |
| `Fiberglass Build Phase_Rev1_091726 (2).xlsx` | `Fiberglass Build Phase_Rev1` | 45 | New build type: shell order, crane set, base prep, backfill with water fill, collar and coping |
| `Open Structures Build Phase_Rev1_091826.xlsx` | `Pavilion Build Phase_Rev1` | 31 | Not a pool: foundation, framing, roofing, electrical, carpentry. Phases 0-9 |
| `Enclosed Structures Build Phase_Rev1_091826.xlsx` | `Pool House Build Phase_Rev1` | 41 | Not a pool: adds plumbing, HVAC, drywall, cabinetry. Phases 0-11 |

Columns in all four: Task Name, Phase, Section, Row Type (Phase / Section / Task / Inspection /
YES/NO selection), Predecessors, Duration, Start/End, Assigned To, Status, % Complete, Notes. Only
Task Name, Phase, Section and Row Type are filled with any consistency.

## Gunite revision against today's template

- **New sub-phases:** 0.1 Procurement Planning (pump, filter, heater, chlorinator, automation, valves,
  lights, transformer, J-box, autofill, finishes; several marked "yes or no"), 1.3 Order/Procure Site
  Materials, 5.3 Auto Cover Rough-In, 5.6 Underground Infrastructure ("Gas Line Installed", added-feature
  conduit), 7.5 Trim Out, a new Phase 8 Site Restoration & Final Grade (8.1 Cleanup, 8.2 Backfill,
  8.3 Rough Grade, 8.4 Final Grade, 8.5 Seed and Straw, 8.6 Landscaping, 8.7 Final Site Walk-Through)
  and Phase 9 (9.0 Client Orientation, 9.1 Warranty & 30-Day Follow-Up).
- **Inspections become their own rows** (Row Type `Inspection`): 2.5 Steel QC/Municipal, 3.4 Plumbing
  head test, 4.5 Bonding, 4.6 Conduit.
- **Renumbered:** most existing sub-phases move. Excavation shifts by one (1.3 Pool Layout becomes 1.4,
  and so on), electrical rough-in moves from 3.4-3.7 to 4.1-4.4, equipment 6.1/6.2 swap (Plumbing first),
  and today's 6.4-7.0 (interior finish, startup, chemistry, orientation, closeout, warranty) move into
  Phases 7 and 9.
- **Fence Pool Safety Barrier** and **Pool, Door and Window Alarms** appear as tasks under 8.6.
- **Punch list:** 8.7 carries "Creation of Punch List Items / Ability to add multiple single line items
  to the schedule"; 9.0 "Punch-list completion" carries the note "need to manually add and dates".
- **Comment on the sheet** (Don, 08/14/26): water truck and plaster to be ordered at the start of coping.

## Not in any sheet yet

- **6.4 Equipment Gas Hook-up** (asked for in the email). Gunite Phase 6 stops at 6.3; the only gas
  item is "Gas Line Installed" in 5.6.
- **Phase 10 Specialty Structures** (diving boards, grottos, slides), asked for in the email.

## Problems to resolve before loading anything

1. **Numbering clashes.** Gunite has two Phase 4s (Electrical Rough-In and Gunite and Shotcrete) and two
   Phase 8s (an unnumbered plaster/start-up block and Site Restoration). Fiberglass has two Phase 7s
   (Equipment Installation and Startup and Trim Out). The Phase and Section columns often keep the old
   numbers while the Task Name carries the new one.
2. **Rows that are not tasks.** YES/NO selections (Auto Cover, heater, automation, J-box, transformer,
   autofill, Auto Cover vault) and untyped rows, notably the plaster/start-up block in Gunite.
3. **No trade or crew on any row.** `D2 - New Pool` assigns `Sub-phase Template.DefaultCrew` from a
   trade; every new sub-phase needs one. This extends Don's open trade-mapping decision.
4. **Durations missing.** A few tasks carry "1d"; no sub-phase has a duration, so new ones would start
   at the 2-day placeholder. Gunite lists predecessors on some rows; the scheduler only runs
   sub-phases in sequence today.
5. **Questions for Don:** are Pavilion and Pool House separate projects, or added to a pool project?
   Does the Gunite revision apply to new projects only? Restructuring the 34 live projects would be
   a separate piece of work.

## Rough sizes, for prioritising (estimates, not quotes)

| Item | Size |
|---|---|
| Clean up duplicate and mistyped projects for Don | Small, under 1 h |
| Fencing as a trade (Trades, Crew-Trades, planner crews) | Small, about 1 h |
| Notes on checklist items (`Tasks.Note` already holds the N/A reason) | Medium, 3-5 h |
| Admin delete (request list exists) / rename (job number is in every Assignments title, which the write-back's row-identity check matches) | Medium: 2-3 h / 4-6 h |
| Fence type and other yes/no options per project (N/A per sub-phase exists today) | Medium, 4-6 h |
| Punch-list items added by hand (no path creates a Tasks row from the planner today) | Medium-large, 5-8 h |
| Gunite revision only | Large, 6-10 h, plus Don's trades and durations |
| Templates by build type (all four) | Large, 20 h or more, bound by the open questions above |

Shane, 2026-10-11: October has about 7 hours left in the D2 bucket, and the reply to Don asks him to
rank the new items rather than committing to them.
