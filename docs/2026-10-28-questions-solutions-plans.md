# After the 28 October meeting: questions, solutions, plans

2026-10-28. Built from the meeting record (`docs/2026-10-28-status-meeting-notes.md`), the 27
October scope note (`docs/2026-10-27-don-asks-scope.md`) and the current build. Sizes are working
sessions of effort-bound build on this project's measured pace, not quotes. Where a design needs an
answer from D2 before it can be built, the question is listed with a default, so work can start on
the default and be corrected rather than wait.

## 1. The questions

Grouped by who answers. Each carries the default that will be built if no answer comes.

### Don

1. **Draws.** What makes a draw due: a named sub-phase being signed off, a calendar date, or both?
   Who marks it received, and should the 04:30 summary carry the outstanding draws?
   *Default:* a sub-phase sign-off triggers it, David or Amy marks it received, the summary lists
   outstanding draws.
2. **Crew preference scale.** 0 means never, and three levels above that. Is 1 the best or 3?
   *Ruled by Shane 2026-10-28:* **3 is first choice**, 1 is last resort, 0 never. Confirm with Don
   only if he objects.
3. **Preference ties.** When two crews hold the same preference for a trade, Auto-Schedule picks
   the less loaded one, as now. Fine? *Default:* yes.
4. **Subcontractors.** Do the four subcontractors get preferences too, or stay as they are (always
   available, never double-booked)? *Ruled 2026-10-28:* they get preferences like any crew, and
   stay capacity-exempt.
5. **Job numbers.** The next number continues the existing sequence (2004 to 2065 so far) rather
   than starting a 3000 series, and the year is the contract year, typed in at + Job with this
   year preselected. Fine? *Ruled 2026-10-28:* build it as decided in the meeting; the tool
   generates the number. Don's confirmation on the 3000 series is still worth a line in the message.
6. **The reset.** Which projects are the keepers when the beta data is cleared? The Fiberglass jobs
   that were loaded as Gunite can be rebuilt as Fiberglass in the same pass, keeping their number,
   name, manager and start date. *Ruled 2026-10-28:* **Don's keeper list decides**, whatever a
   project's history; still not before the features and Rev4 are in.
7. **Mark complete override.** Don and David only, with a recorded note? PMs still need every
   sub-phase signed or N/A. *Ruled 2026-10-28:* yes, **and** a `Closeout` status comes in a later
   session (see 2.4).
8. **Punch items, notes per task, delete and rename, Phase 10 structures, Pavilion and Pool
   House:** the five questions in the 27 October scope note still stand.

### David

9. Draws, as above, since David is the one who will mark them received.
10. The Copilot one-pager: Outlook and Teams first, or the whole suite? *Default:* a single page
    on mail, meetings and documents, for all four office staff.

### Amy

11. The seven Rev4 questions in Shane's 22 October email, and the Fiberglass and two structures
    files. Don's answer on the call covers question 1 (optional features: auto cover, water
    feature, fire feature, spa, diving board, grotto, slide) and part of question 3 (Gunite closes
    out with trim out, site restoration and final grade, cleanup, seed and straw, which Rev4
    carries as phases 8 to 11).

## 2. Solutions

### 2.1 Features: why the drawer was empty, and what Don needs

**What happened on the call.** The Features drawer opened with nothing to click. That is the
built behaviour with no Optional template rows and a project that already carries every Gunite
row, or the "Press Refresh first" state if the templates had not been loaded. Either way the
control was right and had nothing to offer.

**Solution, mostly done today.** Guide Version 9 (28 October) gains an Optional features section:
how to switch a feature on and off, how to add a template sub-phase to an older project, and the
half page on adding a feature to the templates (the fields a Sub-phase Template and a Task
Template row need, including Skill and Sequence decimals). The help table gains the three empty
states and "reload after a release".

**Two follow-ups, BOTH DONE 2026-10-28 (afternoon).**

- **Template permissions gate** (decided 2026-09-21): applied live. Don and David edit the two
  template lists as named users, members read, owners keep Full Control so `D2 - New Pool` and
  Stratirus still work. `sharepoint/gate-template-lists.js`, verified with SharePoint's own
  effective-permission check.
- **A template check** on the Build phases tab, built and pinned, awaiting deploy with the next
  release: a collapsed card that flags a crew code not on the Crews list, Sequence and number
  clashes, orphan and wrong-type tasks, an unknown trade, a missing skill, bad days, phase names
  spelled two ways, near-duplicate feature names and numbers out of Sequence order, each with the
  fix in Don's words. The live templates checked out clean (0 errors, 0 warnings).

### 2.2 Skills and crew preferences

**Today.** The planner's skill list is fixed in code (26 trades). Crew skills on the Crews tab are
per browser; Trades and Crew-Trades in SharePoint feed only the nightly `D2 - Crew Trade Check`.
Auto-Schedule picks the least loaded qualified crew. Two copies that disagree, and the one Don
edits is the one nobody else sees.

**Design.** Make SharePoint the one copy and let the planner edit it.

- `Trades` becomes the master skill list. Refresh reads it (it already does, for labels) and the
  planner's fixed list goes. Adding a skill is a new Trades row from the Crews tab, with a check
  that the name does not match an existing trade ignoring case and spaces.
- `Crew-Trades` gains `Preference` (Number, 0 to 3). **3 is first choice, 1 is last resort**
  (Shane, 2026-10-28). A row with 0 means "holds the trade on paper, never use"; no row means does
  not hold it. `Crews` gains `Preference` (0 to 3) as the overall rating. **Only a 0 overrides**
  (Shane, 2026-10-28): a crew at overall 0 is never offered for anything and keeps its row, as Don
  asked; an overall of 1 to 3 is recorded and shown but changes no scheduling decision, so the
  per-skill ratings stay meaningful. If Don later wants the overall to rank crews, the cap rule
  (effective rating is the worse of overall and per-skill) is the one to build.
- The Crews tab becomes an editor: tick a trade, set its preference, set the overall preference,
  written over Graph on Save like everything else. Gate it to Don and David through permissions on
  the three lists, with the planner reading the result and showing the tab read-only to anyone
  else.
- **Scheduling rule.** Qualified means holds the trade with a preference above 0 and an overall
  preference above 0. Auto-Schedule picks the best preference tier first, then the least loaded
  crew within it; the drawer's Qualified list is grouped by tier. `D2 - Crew Trade Check` treats a
  0 as not qualified so the nightly flag agrees with the planner.
- **Reassignment does not happen on its own.** Changing a preference never moves work already
  assigned; Schedule Check's "not qualified" group already lists sub-phases whose crew no longer
  qualifies, and the Auto-Schedule preview shows what a re-run would move. This is the answer to
  "why is that crew still on base prep".

**Size.** Two to three sessions: columns and backfill (half), planner read and editor (one),
Auto-Schedule and the drawer (one), flow change and harness (half). The trade mapping Don owes is
data on top of this, not a prerequisite for building it.

**Why this and not a quick fix.** A per-browser rating would be invisible to David on the day Don
is out, which is the case David raised.

### 2.3 Generated job numbers and feature tags

**Design.** `+ Job` stops asking for a number. It asks for the contract year (this year
preselected) and shows "number assigned when the project is built". `D2 - New Pool`, which already
refuses a concurrent duplicate by the lower-ID rule, takes the next number as `YY-NNNN` where NNNN
is one more than the highest existing number across all years, writes it on the Job and back on the
request row, and names it in the result email. The planner's duplicate guard stays for numbers
typed by Stratirus tooling.

**Tags.** The request row already carries the chosen features. New Pool writes them on the Job as
`Features`; the Features drawer keeps that field current when a feature is switched; the planner
shows chips on the Jobs tab and the Board bar label: build type plus each feature. This is what
makes an auto cover visible from day one.

**Size.** One session for the number (flow, `+ Job`, harness, a live throwaway build), half a
session for the chips once Features is on the Job. The existing odd numbers (`26- 2055`,
`25=2029 White Heart`) are the one-off clean-up script in the scope note, run before this goes in.

### 2.4 Mark complete with an admin override

**Design.** When a project is not ready to complete, the Jobs tab offers **Mark complete anyway**
to Don and David only (matched on the signed-in account's UPN against a short list the planner
reads from the site, the same two the template gate names). It writes `Status = Complete` and a
comment on the project's first unsigned sub-phase: "Completed by <name> on <date> with N sub-phases
unsigned", so the record says it was an override. PMs keep the current rule.

**Honest limit.** SharePoint cannot enforce who sets `Jobs.Status`; the gate is in the planner.
Fine for the office, worth saying.

**Size.** Half a session.

**And a `Closeout` status, later (Shane, 2026-10-28: "both").** Don keeps a project on his list
until the money is in, 90 days on commercial work. Today that project stays Active, so it counts
against compliance and raises conflict alerts for nothing. `Closeout` sits between Active and
Complete: off dispatch, alerts, the calendar and the compliance denominator, still on the Jobs list
and the Board (greyed), still open to the draw rows. Every flow that filters `Status eq 'Active'`
already excludes it; the live-read flows (`Status ne 'Complete'`) keep reading it, which is right.
Needs the choice on `Jobs.Status`, a Jobs tab action and a chip, and the two summary flows' wording.
One session, after the override, and only once Don has seen the override and still wants it.

### 2.5 Payment draws as a soft gate

**What was asked.** David wants to see in the planner that a draw is due when a phase starts,
without ringing anyone. Don wants a flag, never a block. Hard stops come later with accounting.

**Two shapes.**

- **A. Draws as template rows.** A zero-day sub-phase such as "Submit invoice for draw 2" placed
  after the hardscape sign-off, crew `office`, with two tasks: invoice sent, payment received.
  Shows on the Board, dispatches to nobody, and goes red when it is past its date and unsigned.
  Cheap to show, but it needs zero-day sub-phases (approved on 2026-09-25, not built; the Board
  refuses days below 1 today), it puts money steps into the construction record, and every job
  gets the template's draw points whether or not its contract matches.
- **B. A Draws list.** One SharePoint list: project, draw name, amount if wanted, the sub-phase
  whose sign-off triggers it, due date, received date, received by. The planner reads it on
  Refresh and shows a red chip on the project ("Draw 2 outstanding since 14 Nov") on the Jobs tab
  and the Board, and a Draws card on the project with a **Received** button for David and Amy.
  The daily summary lists outstanding draws. Per-job schedules, no fake sub-phases, and the
  construction record stays clean.

**Recommendation was B. Shane ruled A on 2026-10-28: draws are template rows.** The reasons
for B stand as recorded, and the ruling is the ruling. What A needs, in order:

- **Zero-day sub-phases**, approved 2026-09-25 (WP6) and not built. The Board refuses days below
  1, `reflowFrom` and `D2 - Reschedule Pool` walk a span of at least one day, and `D2 - New Pool`
  counts work days per row. A zero-day row needs a date (the working day after the row before it)
  and no span, so the cursor does not move, and Daily Dispatch must not send it to a crew. About
  one session across planner, two flows and the harness.
- **Draw rows in the templates**, added by Don or by us: `Submit invoice for draw N` after the
  sub-phase whose sign-off triggers it, crew `office`, `DurationDays` 0, two tasks (invoice sent,
  payment received). Optional rows under a `Draws` feature if a contract has none.
- **The red flag**: a zero-day `office` row past its date and unsigned already shows as past-due on
  the Board and in Schedule Check; the daily summary's "finished and unsigned" count picks it up
  for free. A dedicated chip is a later nicety.

Size: one session for zero-day support, then data work on the template. Don's hard stop later is a
rule in the planner's Activate or Mark complete on an unsigned draw row.

### 2.6 "If I pull this crew off, where are my gaps"

A Crew Board action: pick a crew, see every sub-phase it holds with the dates, and for each the
other crews qualified for that trade in preference order. Nothing moves until the PM changes a
row. Half a session once preferences exist; it is a view over data the planner already has.

### 2.7 The programmatic reset

A script, run by Stratirus overnight, that keeps a named list of projects and removes the rest
through Delete Pool Requests (each takes about 15 minutes under load, so thirty projects is a
night). Projects that are Fiberglass but were built on the Gunite template are deleted and
re-raised as Fiberglass with the same number, name, manager and start date; their sign-offs do not
carry over, which is the cost of the rebuild. Do it after the optional features and Rev4 are in,
so the keepers are on the final templates. Half a session plus the overnight run.

### 2.8 Rev4 and the Gunite close-out

Don's phases 8, 9 and 10 for Gunite are Rev4's phases 8 to 11. Once Amy answers, load Rev4 by
editing the existing Gunite rows in place (so `TemplateItemId` keeps matching) and adding the new
ones, with the feature-specific lines marked Optional under the feature names Don gave. Existing
Gunite projects then gain the close-out phases through New in the template. Two sessions of data
work plus the mapping already in `docs/2026-10-22-gunite-rev4-mapping.md`.

### 2.9 Punch list, notes per task, delete and rename

Unchanged from the 27 October scope note. Punch items fit the features model: each item is a
created sub-phase on that project through the same create path the drawer uses.

### 2.10 The Copilot one-pager

Not scheduler work. A single page for David, Don, Carolyn and Amy: ten things Copilot does in
Outlook, Teams and Word that save office time, with the exact words to type. One to two hours,
then a 30-minute call if David wants it. Bill it under D2 LLC AI services, not the scheduler.

### 2.11 Parked: the AI layer

Don and Shane both described it: ask "what is going on in my projects", crew performance against
planned durations, reopen counts, draw reminders. The data for the first two already exists in
Assignments (planned finish, actual sign-off date, reopen lines in SignOffNotes). Months out; note
it so the data is kept.

## 3. Plans

### Order (revised to Shane's rulings, 2026-10-28 afternoon)

1. **Template permissions gate** and the **template check** (2.1). One session. Lets Don build
   features without a safety net being Stratirus reading the lists.
2. **Skills and preferences** (2.2): 3 is best, 0 never, overall only matters at 0, subcontractors
   rated, editor before the mapping. Two to three sessions. The largest ask and the one David tied
   to covering for Don.
3. **Job numbers and tags** (2.3), generated at + Job as decided. One and a half sessions.
4. **Zero-day sub-phases, then draws as template rows** (2.5). One session of build, then template
   data.
5. **Mark complete override** (2.4). Half a session; slots in anywhere.
6. **"Wait your turn" gate in `D2 - New Pool`** (Phase G item, pulled forward by Shane). One
   session. Retires the "warn me before 2 or 3 projects a day" rule.
7. **Rev4 load** (2.8) when Amy answers. Two sessions of data.
8. **Reset** (2.7) after 1 and 7, on Don's keeper list.
9. **`Closeout` status** (2.4), once Don has used the override.
10. **Guide, next major version**, covering everything above. Version 9 stays on the private copy
    until then (Shane, 2026-10-28: finish the next major version before updating or publishing).
11. Punch list, notes per task, delete and rename, per the scope note.

Items 1 to 6 total roughly eight sessions. At the measured pace that is more than November's 20
contract hours before Rev4, the reset or the guide, so 1 to 3 are November and 4 to 6 spill into
December unless the hours change. Say so to Don and David before the month starts.

### Design rule for all of it (Shane, 2026-10-28)

Build in this repo for D2 now, and design the data model so Plumbline lifts it with D2 as the first
tenant: preferences on Crew-Trades and Crews, generated numbers in the create flow, draws as
template rows, features as template rows. Nothing D2-specific baked into a column name or a rule
that a second client would have to undo.

### What Don can do now, with no build

- Add the first optional feature to the templates (auto cover is the one he named as the most
  forgotten), following the how-to in the guide, and switch it on for a live project.
- Give the keeper list for the reset.
- Answer the draw question with David.

### Commercial

October is past the contract hours; Shane told them so on the call and committed to no surprise
bill. Everything above is November work. Don is talking to Ryan about where the scheduler goes and
the resale potential; David asked to be included in that call.

## 4. Draft message to Don and David

Shane edits this before it goes (ruled 2026-10-28). Two lines now need changing against the
rulings: item 1 (the guide is held for the next major version, so no attachment yet) and item 2
(3 is first choice, not 1).

Subject: Scheduler: what you'll see next, and five quick answers I need

Don, David,

Thanks for this morning. Here's where the pieces landed and what I need from you.

1. The guide
The updated guide is attached. It has a new section on optional features, including the half page on adding a feature to the templates. The Features button was doing the right thing this morning: it only lists features once a template row is marked Optional, and your projects already had every standard sub-phase, so it had nothing to offer. Auto cover is the one to try first.

2. Skills and crew preferences
I'm building this the way we discussed: you add skills yourself, each crew gets a preference per skill and an overall preference, 0 means never use and the crew stays on the list. One question: is 1 the best or 3? I'll assume 1 is first choice unless you say otherwise.

3. Job numbers
The tool will assign them, continuing your current sequence, with the contract year typed in at + Job. Shout if you'd rather start a 3000 series.

4. Draws
Before I build the flag, tell me what makes a draw due (a sub-phase being signed off, a date, or both), who marks it received, and whether the morning email should list outstanding draws. I'll assume sign-off triggers it and David or Amy marks it received.

5. The reset
When you're ready, send me the list of projects to keep. The Fiberglass jobs that were loaded as Gunite can be rebuilt as Fiberglass in the same pass.

The shared calendar stays paused, and please give me a heads-up before adding or removing more than two or three projects in a day.

Shane
