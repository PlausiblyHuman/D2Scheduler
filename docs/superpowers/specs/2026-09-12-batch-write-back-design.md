# Batch write-back from the planner to SharePoint

Design spec, 2026-09-12. Author: Claude, for Shane Talbot.

**Status: draft, not approved.** This is Stage 2 of
`docs/superpowers/specs/2026-09-11-planner-as-primary-surface-design.md`. Stage 1's local half
landed 2026-09-11d; the hosting half has not.

**The ask, verbatim:** *"we also will need to make some sort of batch write-back. <when finished
press save to batch write back>"*.

---

## What this is

A **Save** button in the planner that pushes everything the user changed since the last
**Load from D2** back into SharePoint, in one reviewed batch, and reports what landed.

Today the planner is read-only. A PM can reassign a crew, drag a date or run Auto-Schedule across
every pool, and none of it reaches the tenant. That was correct while the planner was a scratchpad
and is the single biggest gap now that it is the office surface.

## Why this is now safe to build, and was not before

The standing objection to a write-back, recorded in `export-to-planner.js`'s own header and in
CLAUDE.md, was that **the planner's schedule was wrong**. Its entire work-calendar model was
`isWork = d => d.getDay() !== 0`, so any span crossing one of the 35 holidays was computed a day
short. Pushing that back would have written wrong dates over correct ones.

That is closed. As of 2026-09-11d the planner carries the tenant's Work Calendar and
`fixtures/planner/workcalendar.js` pins **138 of 138 live spans agreeing with SharePoint**. The
planner's date arithmetic is now the same arithmetic the flows use.

The *other* objection stands and always will: **the planner has no sign-off model.** Its
`inst`/`pm` are bare booleans with no attribution, no timestamp and no notes, while SharePoint
holds `InstallerSignOffBy`, `InstallerSignOffOn` and `SignOffNotes`. That is not a gap to close —
it is the reason sign-off is permanently excluded from the payload.

---

## The field scope, which is already settled and must not widen

The write-back sends exactly what `s.base` tracks, because `s.base` was built for this:

| Field | SharePoint column | Why it is in scope |
|---|---|---|
| `crewId` | `Crew` (Choice, plain string over REST) | the planner is where crew sequencing is decided |
| `start` | `ScheduledStart` | |
| `days` | `DurationDays` | work days, never an inclusive calendar span |
| `locked` | `Locked` | a PM pinning a booked inspection |
| `skip` | `NotApplicable` | sub-phase excluded on this pool |

**`ScheduledFinish` is derived, never sent.** The planner computes it as
`workSpan(start, days).pop()`. Sending both a duration and a finish invites them to disagree; the
flows already derive it the same way.

**Never sent, under any circumstance:** `InstallerSignOff`, `InstallerSignOffBy`,
`InstallerSignOffOn`, `SignOffNotes`, `PMSignOff`, and every field on the `Tasks` list including
task ticks and `NotApplicable`. Task ticking belongs to the field app, where `ensureuser` resolves
a real site user. `fixtures/planner/freshness.js` already asserts the exact key set of `s.base` and
fails if anyone widens it — **that assertion is this rule's enforcement and must not be relaxed.**

**One field needs adding to `s.base`:** `seq` (the row's `Sequence`). The payload has it; the
baseline does not. A reflow needs it to order writes, and a conflict report needs it to name a row
the way a PM reads it ("2.1", not item 342).

---

## Routing: what goes direct, what goes through a flow

The parent spec proposed direct Assignments writes for row edits and request-list rows for
structural changes. That holds, with one correction.

| Action | Route | Why |
|---|---|---|
| Reassign a crew, move a date, change a duration, lock, mark N/A | **direct MERGE on `Assignments`** | the planner owns these fields and its arithmetic now matches the flows' |
| Create a pool | `New Pool Requests` row | `D2 - New Pool` owns template expansion, 46 assignments and 295 tasks |
| Delete a pool | `Delete Pool Requests` row | `D2 - Delete Pool` owns cascade deletion |
| Reflow a whole pool | **direct MERGE, batched** — NOT a `Reschedule Requests` row | see below |

### The correction: Auto-Schedule cannot be expressed as a Reschedule request

The obvious design is to let `D2 - Reschedule Pool` own reflows, since it already walks working
days, honours holidays, and skips locked and signed-off rows. It cannot carry this.

**`D2 - Reschedule Pool` moves dates and never picks a crew.** The parity map records this
explicitly as a section-C wall. Auto-Schedule's output is a *crew assignment plus a date* per
sub-phase, chosen by a candidate search with load balancing and a stable tiebreak. Raising a
reschedule request would discard every crew decision the PM just made and recompute dates the
planner already computed identically.

So a reflow is just a large row-edit batch. The flow stays the right tool for the case it was
built for — a PM absorbing a slip on a live pool from a given sequence forward, done entirely in
SharePoint — and the planner does not route through it.

### Create and delete are two-phase, and the UI must say so

`D2 - New Pool` generates a pool from the **template**. It does not accept a planner-authored
schedule. So creating a pool from the planner is:

1. raise the `New Pool Requests` row
2. wait — **measured at 9m 03s**, and the request sits at `Building` the whole time
3. re-import
4. push the crew and date edits as a normal row-edit batch

That is genuinely two operations and the UI must not pretend otherwise. `D2 - Delete Pool` takes
about 6 minutes and **requires `Title` to equal `ConfirmJobNumber` exactly** — a deliberate
two-key confirmation that is unguessable from the form, so the planner must fill both itself.

This also closes D10's second half: today the planner and `D2 - New Pool` each generate job
numbers independently with no uniqueness check. Once creation routes through the request list,
SharePoint is the only generator and the planner's `nextJobNo()` becomes a local-sketch
placeholder that is replaced on re-import.

---

## Concurrency: compare-before-write, not ETags

The parent spec assumed `If-Match` with ETags. **That does not work here, for two independent
reasons, and the second is the interesting one.**

**First, the ETag is not in the payload.** `export-to-planner.js` sends
`Accept: application/json;odata=nometadata`, which suppresses `odata.etag` entirely — verified
against `fixtures/planner/live-payloads.json`, where no assignment row carries an etag key.
Getting one back means moving to `odata=minimalmetadata`, which changes the response shape on a
surface this project has already lost six cycles to. Not worth it.

**Second, and this is the real objection: a row-level ETag would produce constant false
conflicts.** Five flows write to `Assignments` on a schedule that has nothing to do with the PM:
`D2 - Calendar Sync` (hourly, writes `CalendarEventId`), `D2 - Counter Reconciliation` (nightly,
`TasksTotal`/`TasksComplete`), `D2 - Conflict Flag` (nightly, `ConflictWith`), `D2 - Crew Trade
Check` (nightly, `TradeMismatch`), and Event-Driven Reconciliation. Every one of those bumps the
row's ETag. A PM who loads at 09:00 and saves at 16:00 would have their entire batch rejected
because a nightly flow annotated the rows overnight — a conflict on fields nobody contested.

**The design instead: compare the five owned fields.** At push time, re-read the rows being
written and compare each owned field against `s.base`. Write only where the live value still
matches what was loaded. Where it differs, refuse that field and report it.

This is precise rather than conservative: it detects exactly the collision that matters — someone
else changed a field this PM is also changing — and is completely immune to unrelated machine
writes. It costs one extra GET per batch, not per row.

**Accepted limitation:** the compare and the write are not atomic. A change landing in the
milliseconds between them is lost. Given the actual contention here — at most a handful of humans,
editing a pool each, on a system whose own conflict detection is already post-hoc by design — that
is consistent with the rest of the architecture rather than a new compromise.

---

## The reconciliation storm, and how to avoid it

Event-Driven Reconciliation triggers on every `Assignments` update and its version-history gate
proceeds when `Crew`, `ScheduledStart` or `ScheduledFinish` changed. A 46-row reflow is 46 runs
that all do real work.

The mechanism to prevent this already exists and is already proven: **`SuppressReconcileUntil`**.
`D2 - Reschedule Pool` sets it a few minutes ahead on every row it writes, in the same MERGE as the
dates, and Event-Driven Reconciliation terminates early while the timestamp is in the future. It is
a timestamp rather than a boolean deliberately — a boolean needs a second write to clear, and a
failed clear leaves the row permanently invisible to conflict detection.

The write-back does the same: set `SuppressReconcileUntil` in the same MERGE, on every row it
writes.

**What that costs, stated plainly.** Suppressed rows get no real-time conflict check. Three things
cover the gap: the planner runs `conflicts()` locally and shows Schedule Check *before* the PM
presses Save, so a double-book is visible at the moment it is created; `D2 - Conflict Flag` sweeps
nightly at 05:00 and annotates `ConflictWith`; and Nightly Reconciliation does a full sweep. This
is the same post-hoc grammar business rule 2 already uses, not a new weakening.

**Note `SuppressReconcileUntil` is not in `s.base` and must not be** — it is machine state, not a
field the planner owns or diffs.

---

## Auth: two routes, and the interim one works today

**Route A — the console script, available now.** A companion to `export-to-planner.js`, pasted into
the browser console on the SharePoint site, reading a change-set JSON the planner downloads. It is
the exact inverse of today's export and needs no hosting, no Entra registration and no new
permission. The PM flow is: press Save, get a file, paste the script, pick the file.

Clumsy, and it is how the export already works, so it is a known quantity rather than a new
ceremony. It also means the write-back can be built and tested before the Azure work lands.

**Route B — MSAL and Graph from the hosted app.** The real answer, and it arrives with Stage 1's
hosting half. Save becomes one button with no file and no paste.

**Build A first.** The change-set computation, the compare-before-write, the batching, the
suppression and the result reporting are identical either way. Only the transport differs, and
isolating it behind one function means B is a swap rather than a rewrite — the same shape
`fixtures/planner/run-export.js` already established for the read side.

**Graph note for Route B, non-negotiable:** capture a real Graph payload into
`fixtures/planner/live-payloads-graph.json` before writing a line of Graph mapping. Graph is a
third field-shape surface alongside raw REST and the connector. A REST fixture does not validate a
Graph expression, exactly as a REST probe did not validate a connector expression when that cost
66 wrongly-flagged rows.

---

## What Save actually does

1. **Compute the change-set.** `divergedSecs(j)` across every pool with a baseline. Pools with no
   baseline are local sketches and are offered as *create*, not as edits.
2. **Show a preview and require confirmation.** Grouped by pool, one line per sub-phase, naming the
   field, the loaded value and the new value. A PM must be able to see they are about to move 46
   rows before they do it. This is the step that makes a batch write safe.
3. **Re-read and compare.** Refuse any field whose live value no longer matches `s.base`.
4. **Write**, in batches, each MERGE carrying only changed fields plus `SuppressReconcileUntil`.
5. **Report**: written, refused-as-conflicted, failed. Refusals name the sub-phase and the field.
6. **Re-import automatically**, so `s.base` and `touchedAt` reset to the truth rather than to what
   was intended. A push that half-succeeded must not leave the planner believing it fully did.

**Save must be disabled when there is nothing to push**, and the header already reports the
divergence count that drives it.

---

## What retires once this lands

**Raised by Shane, 2026-09-12: "features like backup and load are useless if it's all plugged
in."** Correct. Three controls in the header exist only because the planner had no connection:

| Control | What it does today | After |
|---|---|---|
| **Backup** | downloads the whole `localStorage` state as JSON | retire |
| **Restore** | uploads that JSON and replaces everything | retire |
| **Load from D2** | opens a *file picker* for the export script's download | keep the button, drop the file picker — it reads live |

**Sequencing, and it is the whole point of this section: they retire WITH the live connection,
not before.** Until the app reads SharePoint on open, Backup and Restore are the only recovery
from a cleared `localStorage`, a different browser, or a second machine. Removing them first
would take away the safety net before the thing that replaces it exists.

So the order is: Route B lands (the app loads live on open) → *then* Backup, Restore and the file
picker come out in the same change. Retiring them under Route A would be premature, because Route
A still passes a file by hand.

**`restore()` also goes**, and with it a whole-state replace path that has always been the one
route capable of destroying a local sketch — it swaps `S` wholesale, which is precisely why
`importFromD2` was written to merge instead. Removing it shrinks the app's blast radius.

**What replaces them:** nothing, for backup. SharePoint is the durable store and it has versioning
on `Assignments`; the browser stops being a place where anything only exists. That is the actual
point of plugging it in.

---

## Editing the planner

**Shane, 2026-09-12: "you can edit the html, just keep a master copy. it's not scripture."**

This lifts the parent spec's non-goal ("not a rewrite of the planner. It stays vanilla JS in one
file until something forces otherwise"). Restructuring is allowed where it earns its place.

**The master copy is the git tag `planner-stage1-verified`, not a second file.** Recover it with
`git show planner-stage1-verified:web/index.html`. A duplicate file is specifically the wrong form
here: this repo spent weeks with CLAUDE.md describing a `patched-tool/pool-scheduler.html` that
had never existed, while the single real planner silently carried neither of the two patches it
was credited with. One copy is the rule.

Two constraints survive, and neither is style preference:

- **The eight jsdom harnesses must stay green**, and any restructuring that makes them harder to
  run is a bad trade. They are what caught four vacuous tests and three real defects.
- **Structure still comes from the local phase template, never from the payload.** That is what
  makes a partial or malformed response unable to corrupt the template, and it is why
  `importFromD2` matches on `SubPhaseNumber` rather than trusting the file's own shape.

---

## Testing

The existing harnesses run the real HTML in jsdom against captured payloads and need no
credentials. The write-back gets the same treatment, plus one new obligation.

- **A `fetch` stub that records writes rather than performing them.** The test asserts the exact
  MERGE bodies: which rows, which fields, `SuppressReconcileUntil` present, sign-off fields absent.
- **The exclusion rule needs a test that fails loudly**, not merely the absence of a field. Tick a
  task, sign off a sub-phase, change a crew, push — assert the body carries the crew and *nothing
  else*. This is the assertion that stops a future session widening the payload.
- **Compare-before-write:** mutate the simulated live row between load and push; assert that field
  is refused and the others still land.
- **Every test must be proven to fail.** Four harnesses in this repo were found passing while
  proving nothing on 2026-09-11 — one had been vacuous for weeks while the docs described it as
  catching a real scheduling oscillation. Mutate the production code, watch it go red, restore.

---

## Risks

**The planner becomes able to damage live data.** Today its worst failure is a wrong picture. This
changes that, and it is the reason for the preview step, the field allowlist, the compare-before-
write and the automatic re-import. The mitigation is not any one of those; it is that a write must
pass all four.

**A partial batch is the state to design for, not an edge case.** Some rows written, some refused,
some failed. Step 6 handles it by re-importing rather than by assuming success.

**Suppression plus a failed re-import could hide a conflict** for up to a day. The window is
bounded by the timestamp and the nightly sweeps, and it is the same trade `D2 - Reschedule Pool`
already accepted.

**Auto-Schedule across all pools is a very large change-set** — potentially every unlocked row in
the tenant. The preview makes it visible. Worth considering whether Save should refuse a batch
above some size without a second confirmation.

---

## Open questions for Shane

1. **Should Save be able to push more than one pool at once?** Scoping it to the current pool is a
   smaller blast radius and probably matches how a PM thinks. Pushing everything matches what
   Auto-Schedule does.
2. **Should a local-only sketch be offered as a create at all in v1**, given the 9-minute two-phase
   flow, or should creation stay in SharePoint until hosting lands?
3. **Is a size cap wanted** above which Save demands a second confirmation?

## Non-goals

- Not sign-off, not task ticks, not notes. Permanently.
- Not a replacement for `D2 - Reschedule Pool`, which stays the right tool for a SharePoint-side
  slip absorption.
- Not real-time or collaborative editing. This is a batch push with a preview.
- Not a change to any flow, any list schema, or any business rule. The only schema-adjacent change
  is adding `seq` to the planner's in-browser baseline, which touches no SharePoint column.
