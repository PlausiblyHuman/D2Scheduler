# D2 Week 5 build runbook — cutover, training, and go-live

**Purpose:** Load every remaining active pool into Lists, train 5 office users + 10 crew leads, retire the browser tool as system of record, and stand up on-call for the first 3 business days.
**Prereq:** Week 4 pilot exit gate green. All divergences from pilot classified and resolved or explicitly accepted.
**Time budget:** ~15 hours across the week, front-loaded (Day 1–3 do the heavy work).
**Cutover framing:** Not a Big Bang. Browser tool stays live, in a demoted role — it becomes the planner-only tool the PM uses to lay out schedules; Lists becomes the source of truth for execution.

---

## Day 1 — Pilot debt + full pool load (~4 hrs)

### Step 1 — Close out any deferred pilot fixes

Every divergence from Week 4 with resolution "Deferred to Week 5" gets addressed today. If any is a canvas-app formula fix or a flow logic tune, ship it before proceeding.

Post-fix, re-verify the pilot pool for one more morning check. If clean, proceed.

### Step 2 — Inventory all active pools

Get the full list of currently-active pools from David or from the browser tool's Jobs tab. Filter to Status in {Planned, Active}. Note the count — this is how many jobs you're loading today.

Realistic count for D2 at any given time: 8-15 active pools.

### Step 3 — Migrate remaining pools

Two paths, same as Week 4 Day 0:

**Preferred — browser-tool export flow (if it works):**
1. Run the export flow, no filter this time — pulls all active pools
2. Verify row counts: each pool = 46 sub-phase assignments + 295 tasks. Total should be N × 341.
3. Spot-check 2-3 pools' data against the browser tool

**Manual fallback:**
1. Export browser tool state (Backup button) → JSON
2. Convert JSON to CSV rows using a helper script (Python one-liner or Power Automate flow)
3. Grid-paste each list per the Week 1 seed-data runbook, but scoped to new pools only

Estimate: 90 min via export flow, 3-4 hrs manual.

### Step 4 — Sanity check the full load

Open the `All Assignments` view grouped by Job. Confirm:
- Every active pool has 46 sub-phases (or fewer if some are marked NotApplicable)
- No orphan Assignments pointing to non-existent Jobs
- The `Unassigned` view surfaces the same 11 field-supervision sub-phases per pool that the browser tool shows (or none if Don closed the PM-bucket question and we've assigned them)
- Total task rows ≈ (active pools) × 295

Log any anomalies in the divergence log as "cutover-day-1."

---

## Day 2 — Office user training + soft launch (~3 hrs)

### Step 5 — Assemble the office training materials

Two short docs to hand out (or share as SharePoint pages on the d2-scheduler site):

**"D2 Scheduler — Office Quick Reference" (one page):**

```
Where do I go?
  All schedules: [SharePoint site] > Sub-phase Assignments
  This week's dispatch: Field Dispatch Teams channel
  Ownership dashboard: Ownership Teams channel + daily PDF in Don's email

How do I …
  See what my crews are doing this week?
    Views drop-down > "This Week by Crew"
  Reassign a sub-phase to a different crew?
    Open the sub-phase row, click the Crew field, pick a new crew, save.
    You'll see a conflict alert in the Ops channel within a minute if the new crew is already booked.
  See what's late or unassigned?
    Views: "Sign-off Overdue" and "Unassigned"
  Change a job's dates?
    Open Jobs list > click the job > edit StartDate. Ripple through Sub-phase Assignments manually or run the browser tool's Auto-Schedule and re-export.

When something's weird
  Text Shane at [phone]. Don't fix it yourself if you're not sure what broke.
```

**"D2 Scheduler — PM Workflow" (one page):**

```
Every Monday morning
  1. Check the "Late-Starting Jobs" view — anything slipping?
  2. Check the "Unassigned" view — any sub-phases without a crew?
  3. Skim the Field Dispatch Teams channel — did dispatch go out this morning?

Every time you plan or re-plan
  1. Do the planning in the browser tool (pool-scheduler.html) — this is unchanged
  2. When schedule is committed, the nightly export pushes to Lists at 11 PM
  3. Verify Tuesday morning that Lists reflects your Monday changes

Every time a customer or crew calls with a change
  1. Update the browser tool first (source of truth for planning)
  2. Or, for small tweaks (a date shift, a crew swap), update Lists directly — but note it and update the browser tool by end of week

Conflict alerts in Ops channel
  Someone (probably you or the other PM) just created a double-book.
  Fix it in the same list that fired the alert. The alert tells you which
  two Assignments overlap.
```

### Step 6 — Office training session

Group session, 60 minutes, on Teams or in person if the office is on-site.

**Attendees:** Don, both PMs, any office admin who might touch the system (Amy).

**Agenda:**

1. **What changed and why (10 min):** two-slide framing — "we moved the source of truth for execution from your browser to SharePoint; planning stays where it is; dispatch and sign-off is now automatic; the browser tool didn't go away, it got demoted to planner-only."
2. **Live walk-through of the SharePoint views (15 min):** open All Assignments, This Week by Crew, Unassigned, Sign-off Overdue. Group by, filter, drill into one sub-phase.
3. **Live edit demo (10 min):** reassign a sub-phase to a different crew in Lists, watch the Ops channel alert appear within a minute if it collides.
4. **The PM's weekly rhythm (10 min):** walk through the PM workflow doc.
5. **When to text Shane vs when to fix themselves (5 min):** any structural change (columns, permissions, new pools) is Stratirus. Anything that's "wrong data in a row" is fair game to fix.
6. **Q&A (10 min).**

**Record the session.** Post to the D2 Scheduler SharePoint site as a reference for anyone joining later or wanting a refresher.

### Step 7 — Soft launch — office users go live in Lists today

The office starts using Lists as the primary UI for schedule visibility today. Browser tool remains fully functional for planning. Any office user's day-to-day view questions go to Lists first.

Log any confusion or bug reports in the divergence log. Fix or escalate same-day.

---

## Day 3 — Crew lead training + app deployment (~4 hrs)

### Step 8 — Assemble the crew-lead one-pager

**"D2 Sign-Off App — Get Started" (one page, printable):**

```
1. On your phone, open the App Store (iPhone) or Play Store (Android).
2. Search "Power Apps" — it's from Microsoft. Install it.
3. Open Power Apps. Sign in with your D2 email and password.
4. You'll see a list of apps. Tap "D2 Sign-Off".
5. Tap the ⋮ menu next to the app name, then "Pin to home screen."
   The D2 Sign-Off app now lives on your phone's home screen.

Every workday morning:
  You'll get a dispatch email with today's job and sub-phase.
  When your work is done for the day, open the D2 Sign-Off app.
  Tick each task you completed. Set the work date if it's not today.
  Add notes if there's anything the PM should know.
  Hit "Sign off" — you're done. Takes about a minute.

Something wrong?
  Text Shane at [phone] any time. Don't stop your work over the app.
```

Print 15 copies. Cover for the 10 crew leads + spares.

### Step 9 — Crew lead onboarding

Options depending on D2's schedule:

**Preferred — group session:**
1. Convene at the D2 yard early morning before crews head out (7 AM Tuesday works for most crew leads)
2. 30 min total
3. Walk everyone through the install + sign-in + first sign-off together
4. Have Shane there or on video for real-time troubleshooting

**Fallback — 1:1 phone walkthrough:**
1. Call each crew lead individually
2. 10 min per lead
3. Screen-share via Teams if they can, or verbal walk-through
4. Have the one-pager in front of them

Either way: don't leave anyone without a successful test sign-off. If a crew lead can't complete a test sign-off, don't turn on their real usage until you've resolved the blocker (usually: signed into the wrong M365 account, or app not showing up in their Apps list because the security group membership hasn't propagated).

### Step 10 — Verify all crew leads are set up

Confirmation checklist:

- ✅ All 10 crew leads have Power Apps installed
- ✅ All 10 signed in with their D2 M365 account
- ✅ All 10 can see D2 Sign-Off in their Apps list
- ✅ All 10 have submitted a test sign-off (against a scratch sub-phase you set up)
- ✅ All 10 have the one-pager, digitally or physically

Log any lead that isn't set up. Do NOT proceed to cutover with anyone unresolved.

---

## Day 4 — Cutover (~2 hrs)

### Step 11 — Communicate the cutover

Short note to everyone (office + crew leads + Don):

```
Team,

Starting tomorrow morning, D2 Sign-Off in Lists is our system of
record for execution. The paper daily-dispatch printout is being
retired — dispatch comes to your email and Teams instead.

Nothing changes for how you do the work. Sign off using the app on
your phone, same way you've been doing this week.

Office team: SharePoint Lists is where you look for schedule state.
Browser tool stays live for planning — that's still where the PM
lays out schedules.

Any weirdness, text Shane. He's on-call through Friday.

Shane
```

### Step 12 — Retire the browser tool as source of truth

Concretely:

1. Take a final backup of the browser tool state — save as `pre-cutover-final-[date].json`
2. Rename the browser tool's HTML file locally to `pool-scheduler-PLANNER-ONLY.html` and update any pinned shortcut. Optional: add a banner at the top of the file: "PLANNING ONLY — execution state lives in SharePoint Lists".
3. Confirm the nightly export flow is scheduled correctly — this is now what keeps Lists in sync with the browser tool's planning changes
4. Document the demotion in the divergence log as `Day 4 cutover: browser tool → planner-only role`

### Step 13 — Verify go-live state

Before end of day Thursday:

- ✅ All active pools loaded into Lists (from Day 1)
- ✅ Office team can navigate Lists views (from Day 2)
- ✅ All crew leads have the app pinned and completed a test sign-off (from Day 3)
- ✅ Browser tool is renamed / banner-added / demoted (Step 12)
- ✅ Cutover comms sent (Step 11)
- ✅ Daily Dispatch flow scheduled and last-tested green
- ✅ Sign-off Intake, Event + Nightly Reconciliation, PDF Summary flows all green in run history
- ✅ Ops Teams channel has no unresolved false-positive alerts
- ✅ Rollback plan (below) is documented and reachable

---

## Day 5 — Go-live + on-call (~2 hrs active, plus standby)

### Step 14 — Friday morning: live day 1

Real crews, real dispatches, real sign-offs. Everything runs the same as pilot week except now every pool is in the system, not just one.

**Your standby role:**

- 6:00 AM: check that Daily Dispatch fired for all active crews. Verify one dispatch email in your inbox (you should be on the recipient list for monitoring).
- 8:00 AM: 15 min sanity sweep. Open Lists views. Any anomalies?
- 4:30 PM: check that sign-offs are landing. Compare crew count of "signed off today" to number of crews that had work today.

**Text/Teams response SLA:** within 30 minutes during business hours (8 AM – 6 PM Pacific) for the first 3 business days post-cutover.

### Step 15 — Log real go-live issues

New SharePoint list on the d2-scheduler site:

**Name:** `Go-Live Issues`

Same columns as Pilot Divergence Log, plus `PriorityP0-P3`.

Track everything. P0 = system down or someone can't sign off. P1 = data wrong but system functional. P2 = UX friction. P3 = cosmetic.

Aim to resolve P0/P1 same-day. P2/P3 get folded into the standard retainer's monthly review.

---

## Rollback plan (only if a P0 emerges)

If something breaks badly Friday-through-Monday post-cutover, the rollback is fast:

### Full rollback (unlikely but documented)

1. Rename `pool-scheduler-PLANNER-ONLY.html` back to `pool-scheduler.html`
2. Restore the pre-cutover backup: `Restore` button → pick `pre-cutover-final-[date].json`
3. Post note in Field Teams channel: "Temporarily reverting to browser tool for schedule of record while we fix an issue. Continue signing off using paper forms as before. More by [time]."
4. Text Don + David: heads-up call
5. Diagnose in Lists side without pressure

**Time to full rollback: ~15 minutes.** Every crew lead who had already used the app that day is fine — their sign-off is captured in Lists and preserved even during rollback. The rollback only affects which system is authoritative going forward.

### Partial rollback (more likely)

Individual issues rarely need full rollback. Common partial:

- **Canvas app has a bug:** roll back to previous app version via Power Apps portal → Version history → Restore. 30-second operation.
- **A flow is misfiring:** turn off just that flow. Reconciliation flows can be off for a day without losing data.
- **A crew lead's account is broken:** they submit paper form for the day, we fix identity Monday.

---

## Week 5 exit gate

Verify all before handing off to the standard retainer:

- ✅ All active pools live in Lists
- ✅ All crew leads used the app at least once for real (not test) sign-off during Days 4-5
- ✅ Office team using Lists as primary schedule view
- ✅ Browser tool renamed/demoted to planner-only
- ✅ Cutover comms sent to entire team
- ✅ On-call SLA met — every issue reported within business hours got a response within 30 min
- ✅ Zero unresolved P0 issues in the Go-Live Issues list
- ✅ Post-launch cadence set: weekly check-in with David/Don for the next 4 weeks

**If exit gate is green, project moves to the standard Stratirus 3-year retainer.**

---

## Handoff to the standard retainer

Post-Week-5, the project becomes ongoing operations. What that means concretely:

**Weekly for 4 weeks post-cutover:**
- 15-min check-in with David/Don Friday afternoon
- Review the Go-Live Issues list, close what's done, escalate what's stuck
- Confirm no new P0 or P1 issues in the previous week

**Monthly ongoing:**
- Business review with Don (30 min)
- Retainer hours drawdown report — how many hours used, on what
- One "system health" quick review: any list nearing size limits? Any flow throwing errors? Any adopting friction?

**Quarterly ongoing:**
- Extension-path review — has anything hit a Rev D §14 trigger? Add BI? Migrate to Dataverse? Add a second PM concurrent-editor safeguard?
- Actual-vs-planned duration data review (feeds §09 gap #5 eventually — the 46 placeholder durations)

**Annual:**
- Full architecture review — is Option A still the right shape? Any new Microsoft capability that would improve it?
- Renewal conversation for the retainer

---

## Common gotchas

- **Someone tries to run Auto-Schedule in the browser tool on Day 4-5.** This is fine — it's still doing its planning job — but if the export flow runs immediately after, it may push conflicting Assignments to Lists that a crew lead is mid-signing-off on. Coordinate: no Auto-Schedule runs during business hours in the first week post-cutover unless coordinated with Shane.
- **Crew lead installed Power Apps on the wrong account.** Common if they have a personal M365 account and a work one. Sign them out of everything, sign back in with D2 email only, force-close and reopen Power Apps.
- **Someone forwards a dispatch email to a crew lead who isn't licensed for Power Apps.** They'll get a "you don't have access" page on the sign-off link. Not fixable in the app — need to license them properly. Rare but happens.
- **First real conflict alert fires on a real double-book.** This is a good sign — the system caught what the browser tool would have missed. Don't panic. Fix in Lists, log, move on.
- **The 11 Unassigned field-supervision sub-phases** — if Don hasn't answered the PM-bucket question by cutover, these sit in Unassigned indefinitely. Not a blocker for anyone's daily work; blocker for reporting completeness. Follow up post-cutover.

---

## What next month looks like

Week 6 is the first week of "just working." No new features, no new flows, no new lists. Just: dispatches go out, sign-offs come in, PDFs land in Don's email, and the occasional conflict alert fires when someone edits into a collision.

Success looks like: nobody notices the system. Boring is the goal.
