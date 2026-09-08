# D2 Phase E pilot runbook — parallel run

**Purpose:** Prove the Lists system produces the same operational output as the browser tool for one real pool over one full workweek. Exit gate: zero unexplained divergence.
**Prereq:** Phases A–C complete. All six lists, five flows, and the canvas app are live. Phase 1 verifications green.
**Time budget:** ~15 hours across the week — most of it is watching, not building.
**Framing:** This is validation, not development. If we're writing new flows or fixing broken schemas, we regressed and need to go back to Phase B or 3.

---

## Pre-pilot — pool selection (do this before the week starts)

### Criteria for the pilot pool

Pick one active pool that meets all four:

1. **Currently in an active sub-phase this week** — not in pre-construction admin, not in a hold. We need real crew work happening every day.
2. **Assigned to a well-known crew lead** — someone who returns texts, isn't overly grumpy about a new app, and has a phone that isn't a museum piece. Cirilo or Guillermo are natural first picks based on the crew list.
3. **No exceptional complexity** — not a remodel, not an add-on, not a client with unusual demands. Something whose sub-phases match the standard template cleanly.
4. **Trades used this week are all mapped** — check the 10-unmapped-trades list. If the pool needs Retaining Walls or Veneer this week and Don hasn't answered the mapping question, pick a different pool.

Recommendation: coordinate with David on selection Monday morning of Phase E — he knows the current job board.

### Prep artifacts

Before Day 0, have on hand:
- The pilot pool's job number, address, PM, and current sub-phase from the browser tool
- The crew lead's email and phone number
- A shared divergence log (SharePoint list on the d2-scheduler site, or a shared OneNote — see Day 0 Step 3)
- A time slot every morning at 8 AM for the ~15 min comparison check

---

## Day 0 — Initial sync (Sunday or early Monday morning, ~2 hrs)

### Step 1 — Snapshot the browser tool

1. Open pool-scheduler.html on the PM's machine
2. Click **Backup** — downloads a JSON snapshot
3. Save the backup to a well-named file: `pilot-day0-[jobnumber].json` in a Stratirus-owned OneDrive folder
4. Note the browser-tool's current state for the pilot pool: crew assignments per sub-phase, dates, sign-off state, task completions

### Step 2 — Load the pilot pool into Lists

**There is no browser-tool export flow.** It was never built, it was descoped from the pilot
deliberately on 2026-09-05, and it is not coming before go-live. Earlier drafts of this step
offered it as the "correct" path. Ignore that. Use `D2 - New Pool`.

**1. Generate the pool.** Add one row to **New Pool Requests**: job number, name, address, start
date, project manager. All five are required. That produces 1 Job, 46 Assignments and about 295
Tasks, dated forward across work days only, in roughly 7 minutes.

**2. Reconcile it to the pilot pool's actual state.** This is the part that matters, and it is
the whole point of a pilot. `D2 - New Pool` generates a standard schedule from the template, so
it knows nothing about how this specific pool has actually been run. Against the browser tool's
current state for the pilot pool:

1. Correct `Crew`, `ScheduledStart` and `ScheduledFinish` on every sub-phase that differs.
2. Set `Locked` / `NotApplicable` to match what the browser tool shows.
3. Set `InstallerSignOff = Yes` on any sub-phase the browser tool already shows signed off, and
   tick the corresponding Tasks rows.

Getting step 2 wrong does not just cost setup time, it manufactures divergence that the whole
pilot then spends the week chasing. Do it carefully and log anything ambiguous before Monday
rather than discovering it mid-week.

**If the pool comes out wrong, delete and redo.** Add a row to **Delete Pool Requests** and raise
the New Pool request again, rather than hand-repairing 341 rows.

### Step 3 — Set up the divergence log

Create a SharePoint list on the d2-scheduler site:

**Name:** `Pilot Divergence Log`

| Column | Type |
|---|---|
| Title | Text (short summary of the divergence) |
| ObservedDate | Date |
| SubPhase | Text (e.g. "Harrison 2.2") |
| BrowserToolState | Multi-line text |
| ListsState | Multi-line text |
| RootCause | Choice: Unknown / Timing / Bug in flow / Bug in canvas app / User error / Data model mismatch |
| Resolution | Choice: Fixed in-week / Deferred to Phase F / Accepted variance |
| Notes | Multi-line text |

Only Shane and the pilot PM write to this list. Everyone can read.

### Step 4 — Brief the pilot crew lead

Text or short call:

> "Starting today we're piloting a new sign-off app on your phone for [pool name]. You'll get a dispatch email each morning as usual, but now there's a link at the bottom to a Power Apps sign-off. Tick each task, hit Sign Off. Takes about a minute. You still do the paper form the way you always have — the app is running in parallel. Any weirdness, text me and don't worry about it, I'll unwind on my side."

Two things to emphasize:
- Paper form doesn't stop — this is a parallel run
- If anything's weird, they text you, no consequences

---

## Days 1–5 — Daily rhythm

Every workday morning, ~15 min. This is the actual pilot.

### The 8 AM comparison check

1. **Open the browser tool.** Look at the pilot pool. Note today's scheduled sub-phase, crew, whether yesterday was signed off.
2. **Open the Lists Sub-phase Assignments view** filtered to the pilot pool. Same data points.
3. **Compare.** For each of these fields, does Lists match the browser tool?
   - Today's active sub-phase and its number/name
   - Assigned crew
   - Scheduled start and finish dates
   - Yesterday's InstallerSignOff state (Yes/No)
   - Task completion counts for yesterday's sub-phase
4. **Log any divergence** in the divergence log with as much detail as you have.
5. **Do not "fix" divergences in real-time.** First understand root cause. Rushed fixes create Frankenstein state that makes later divergences harder to attribute.

### During the day

**Watch for:**
- Double-booking alert emails from the Event-Driven Reconciliation flow (they go to the job's PM) — any false positives? Any real collisions that fired correctly?
- Sign-off compliance in the 6:30 AM daily summary email
- Any texts from the crew lead about app friction

**Don't touch:**
- Do not edit Assignments in Lists directly during the day, except to fix a divergence with a documented root cause. Every edit is a variable.
- Do not raise another New Pool request for the pilot pool mid-week. It would create a second, duplicate set of 46 Assignments rather than update the existing ones, which both masks divergences and doubles every count you are checking against.

### End of day

Around 5 PM, quick sanity check:
- Did the crew lead submit sign-off through the app?
- Did the Sign-off Intake flow fire and update the Assignment?
- Did the Event-Driven Reconciliation flow correctly NOT re-fire?

Log any anomalies.

---

## Divergence types — common patterns and remediation

### Type A — Timing (usually not a real divergence)

Browser tool updated at 8:15 AM by the PM and never reaches Lists at all — there is no export. The morning check catches the delta; the fix is to make the same edit in Lists.

**Diagnosis:** Verify with a second check at 8:45 AM. If the Lists state now matches, it was timing.

**Resolution:** Log as timing, accept. There is no export flow of any cadence, so if this happens 3+ times in a week the answer is a process one: agree a cut-off after which the day's changes are made in SharePoint directly rather than in the browser tool.

### Type B — Sign-off not propagating

Crew lead signed off in the app, but Assignments still shows `InstallerSignOff = No`.

**Diagnosis path:**
1. Check Sign-off Intake flow run history in Power Automate portal
2. If flow ran: check its output for the Update Item action's response
3. If flow didn't run: canvas app call failed. Check canvas app's monitor log
4. If flow ran but Update Item failed: SharePoint permissions on the service account, or a field-name mismatch

**Resolution:** Almost always a canvas app formula bug or a SharePoint column-name mismatch. Fix the formula/name, republish app, re-test.

### Type C — Double-book alert but no double-book exists

A double-booking alert email arrived, but reviewing the two Assignments shows they don't actually overlap.

**Diagnosis:**
1. Read the alert's payload — which two Assignment IDs did it flag?
2. Check the trigger condition on the Event-Driven Reconciliation flow — is it firing on non-schedule edits?
3. Check the date-range logic — are we handling single-day sub-phases correctly (start = finish)?

**Resolution:** Most common cause is off-by-one in the date filter. `ScheduledStart le end and ScheduledFinish ge start` handles the fenceposts correctly; anything less inclusive misses cases.

### Type D — Task-tick count mismatch

Browser tool shows sub-phase 90% complete, Lists shows 100% or 0%.

**Diagnosis:**
1. Open the canvas app on the crew lead's device, navigate to that sub-phase's tasks
2. Count what's ticked vs what's ticked in Lists
3. Refresh the app — do the counts converge?

**Resolution:**
- If the app shows different counts from Lists: the local gallery cache is stale. Add a refresh call after each Patch.
- If Lists is authoritative and browser tool is stale: expected. Browser tool doesn't know about task-level completion — sign-off state is at sub-phase level there. Log as "accepted variance."

### Type E — Wrong crew assigned

Browser tool shows Cirilo on 2.2, Lists shows Devon.

**Diagnosis path:**
1. Was the browser tool re-run of Auto-Schedule performed after Lists was seeded? If so, the determinism fix (Week 0 patch) should have kept assignments stable — check that the patched version is what's live
2. Was there a manual reassignment in one system that didn't propagate to the other?

**Resolution:** Real divergence. Trace back to the source of truth for that decision. If PM meant Cirilo, fix Lists. If PM meant Devon, fix browser tool. Log root cause.

### Type F — Sub-phase missing from Lists

Browser tool shows 46 sub-phases for the pilot pool, Lists shows 44.

**Diagnosis:** Migration incomplete. Two rows didn't land.

**Resolution:** Backfill the missing rows manually. Root cause is in Day 0 sync — improve for cutover.

### Type G — Sub-phase in Lists doesn't exist in browser tool

Rare but possible if someone added a sub-phase to Lists manually mid-week.

**Diagnosis:** Look at the created-by and created-on on the Lists row.

**Resolution:** Delete from Lists if unintended. Log the human root cause.

---

## Escalation

If any of these happen during the pilot, stop and huddle before continuing:

- Same divergence type occurs 3+ times in a week
- Any Type B (sign-off not propagating) — this is the core of the whole system
- Any P0 canvas app bug that requires a re-publish
- More than 5 false-positive collision alert emails (indicates trigger condition or filter logic is broken)
- Crew lead refuses to keep using the app

None of these are Phase F blockers by default, but they need explicit "here's the plan" resolution before cutover.

---

## Phase E exit gate

Verify all before proceeding to Phase F:

- ✅ Full workweek completed with the pilot pool in parallel
- ✅ Divergence log has entries but all are classified with root cause
- ✅ Zero unresolved Type B (sign-off not propagating) divergences
- ✅ Zero unresolved Type E (wrong crew) divergences that weren't traceable to a documented PM decision
- ✅ Crew lead successfully used the app on at least 3 different days
- ✅ Event-Driven Reconciliation flow: any alerts posted were correctly attributable to real double-books or documented false positives with root cause identified
- ✅ Daily PDF Summary landed in Don's inbox every workday
- ✅ No P0 canvas app or flow bugs remain open

**If the exit gate is green, we cut over in Phase F.** If not, extend the pilot for a second week with the same pool or add a second pool to shake out the specific failure mode.

**A failed pilot is not a failed project.** It's Phase E doing its job. Escalate to David + Don with a specific "here's what we found, here's the fix, here's when we go live" note — not a "the plan is broken" note.

---

## Common gotchas

- **PM edits Lists directly to "help" during the pilot.** Discourage. Every direct edit undermines the parallel-run comparison. If the PM sees a Lists error and wants to fix it, log it first.
- **Weekend gap.** Days 1–5 run Mon–Fri. Saturday is a normal work day for D2 crews but the pilot check cadence should still hit Saturday morning. Sunday is genuine skip.
- **Timezone confusion.** Verify all comparison points use **Central**, not Pacific. This runbook said Pacific and that was wrong: the site's regional setting is (UTC-06:00) Central, and the summary flows are scheduled in Central. The browser tool uses local device time. Date-only fields are stored at local midnight, so a value written as midnight UTC reads back one day early. A 1-day-off divergence is almost always this, not a real scheduling error. See the DateTime storage convention in CLAUDE.md.
- **Sample size of one pool.** A clean pilot doesn't prove the system handles all edge cases. Cutover in Phase F puts more pools in and will surface things the pilot didn't. Plan for that in Phase F's on-call schedule.
- **The browser tool's Auto-Schedule can drift, and nothing reconciles it.** There is no export, so a mid-week Auto-Schedule run silently diverges the browser tool from Lists for good. Coordinate: the PM does not re-run Auto-Schedule during the pilot week without notifying you first.

---

## What Phase F starts with

A validated system on one pool. Phase F is scaling up — every other active pool loaded, all crew leads trained, browser tool moves to planner-only role. If the pilot found any surface defects (canvas app polish, flow tuning, permission adjustments), Phase F Day 1 is when those land, before the go-live traffic hits.
