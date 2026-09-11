# Planner vs SharePoint: capability parity map

Audited 2026-09-11 against `web/index.html` (moved 2026-09-11 from the doubled
`D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`; 910 lines, single file,
no network calls, `localStorage` key `poolsched.v6`, at the time of this audit). Line
numbers are to that file.

Raised by Shane: *"we never matched crew capabilities / technical expertise to their
functions in the sharepoint site."* Correct, and it turned out to be one of eleven
divergences rather than an isolated miss.

Buckets: **A** already matched · **B** easily matched · **C** hard, hits a named wall ·
**D** gap or the two systems disagree.

---

## D. The gaps that matter

### D1. Business rule 1 is enforced ONLY in the planner

See the fuller treatment in CLAUDE.md's business-rules section. Summary of the planner
side, which is the half CLAUDE.md did not describe:

- `SKILLS` (L141-168) declares 26 trade codes. **All 26 match `Trades.TradeCode` exactly.**
- `SEED_CREWS` (L175-208) gives each of 14 crews a `skills: []`.
- `FIXED` (L211) maps three pseudo-trades (`@office`, `@sub`, `@unassigned`) straight to a
  bucket crew, bypassing trade matching.
- One trade per sub-phase on the template (`SEED_TEMPLATE[].sections[].skill`, L137). 46
  sub-phases use 19 codes: 16 real trades plus the 3 pseudo.

**Seven enforcement points, all warn, none block:** `autoSchedule` only considers
`qualified()` (L316); the drawer dropdown splits Qualified / ⚠ Not qualified but still
lets you pick (L693); `conflicts()` raises an error (L381); the board draws a red inset
outline (L500); the CSV stamps `NEEDS ATTENTION` (L775); the availability panel builds from
`qualified()` (L721); Skill Coverage shows red `none` (L640).

**Two internal inconsistencies in the planner itself**, worth fixing if it is kept:

1. **`qualified()` and `isQualified()` disagree on `FIXED` codes.** For `@office`,
   `qualified()` offers only Main Office, but `isQualified()` (L213) accepts *any*
   `unlimited` crew. So picking STL Shotcrete for an `@office` sub-phase produces **no error
   at all** — the warning and the check use different predicates.
2. **`autoSchedule`'s `busy` map does not exempt `unlimited` crews** (L296-301) while
   `busyMap()` does (L288). On a mixed candidate set (`dig` = harrison, guillermo, saul,
   **stl**) `stl` can be skipped as "busy", contradicting rule 2's capacity exemption.

**Mitigating fact, verified:** all 14 crews' `SEED_CREWS.skills` match the live `Crew-Trades`
join exactly today, because `Crew-Trades` was seeded *from* `SEED_CREWS`. Nothing keeps them
aligned and nothing would notice them drifting.

### D7. Work Calendar — the planner knows about Sundays and nothing else

`isWork = d => d.getDay() !== 0` (L219) is the entire work-calendar model. It feeds
`nextWork`, `workSpan`, `axis`, `shiftDay` and `saveSec`. No holiday, weather-day or
per-crew-shutdown concept. `S.settings` is initialised empty (L257) and never written.

Against that, `D2 - New Pool` and `D2 - Reschedule Pool` both compute Sunday **and** test a
`nonWork` set read from Work Calendar (35 holidays, 2026-08-30 to 2029-12-30).

**This is the only divergence that makes the planner produce a wrong plan rather than an
incomplete picture.** Four consequences, quietest first:

1. **`importFromD2` never reads `is.finish`** (L866-872 overlays `crewId`, `start`, `days`
   and flags only). Every end date is recomputed as `workSpan(start, days)` over Sundays
   alone, so **any sub-phase whose SharePoint span stepped over a holiday renders a day
   short.** The bar is wrong and nothing says so.
2. `conflicts()` computes double-booking (L388) and the rule-3 chain (L383) off that
   shortened span, so it can **miss a real overlap** and **invent a sequence error**.
3. Auto-Schedule will put crews on Thanksgiving and Christmas, silently.
4. Daily Dispatch shows a full crew board on a holiday.

The asymmetry runs both ways: the planner's Sunday rule is **computed and therefore correct
forever**, while SharePoint's holiday set **expires 2029-12-30** with nothing maintaining it.

### D2. PM sign-off exists on both sides, is wired up on neither

The planner has a real two-tier model: `inst` and `pm` per sub-phase, a phase-level
tri-state roll-up (L350), a bulk phase toggle (L354), per-pool counts (L582), and a
`conflicts()` warning when a finished sub-phase is missing **either** (L386).

On the SharePoint side `PMSignOff`, `PMSignOffBy` and `PMSignOffOn` exist, are written
`false` once by `D2 - New Pool`, are hidden from the forms, and appear in **no other flow,
no view, and nowhere in the canvas app**.

`export-to-planner.js:115` faithfully exports `pm: !!a.PMSignOff`, which is **always false**.
So the first Load from D2 fills Schedule Check with *"missing PM sign-off"* on **every
finished sub-phase, forever** — 51 rows on current demo data. A panel permanently full of
unclearable warnings is a panel people stop reading, which costs the seven checks that are
real, two of which exist nowhere else in the system.

### D9. `Jobs.Status` is exported and then discarded

`export-to-planner.js:101` emits `status`. `importFromD2` (L851-861) never reads it and the
planner has no pool-state field. So a `Planned` pool appears on the Gantt, the Crew Board,
Daily Dispatch and the CSV, and raises double-book errors, exactly like a live one. That
inverts the 2026-09-09 `Planned` decision on the one surface a PM uses *while choosing dates*.

Arguably the planner's behaviour is the **right** one — the reflow's own conflict sweep is
deliberately tenant-wide for exactly this reason. The problem is that it is accidental and
gives a PM no way to tell the two apart. Badge them rather than hide them.

### D8. Bulk tick contradicts the sign-off gate

The drawer offers `all` / `none` links (L705) calling `allTasks()` (L716), setting `done` on
all ~6 tasks in one click, with an INST checkbox next to it that has no precondition. The
2026-09-07 decision — no sign-off while any task is unresolved, with N/A carrying a mandatory
reason precisely so a bare block does not produce false ticks — is the most deliberated rule
in CLAUDE.md, and the planner offers a one-click route around it.

Compounding it: **`Tasks.NotApplicable` is not exported** (`export-to-planner.js:69` selects
`Id, AssignmentId, Sequence, Title, Complete`). An N/A task imports as *not done*, so a
sub-phase legitimately signed off at 5 of 6 renders permanently incomplete. The planner has
no third task state to put it in.

### D4. `Jobs.StartDate` drift corrupts Auto-Schedule, not just a display field

The 2026-09-11 session log recorded `Jobs.StartDate` as "display-only: nothing reads the
field after creation". **That is no longer true.** `export-to-planner.js:100` exports it,
`importFromD2` (L860) writes it to `j.start`, and `autoSchedule` (L309-310) uses it twice:
to **order the pools** and to **seed each pool's cursor**.

Whitfield currently reads `2026-09-21` on Jobs while its first assignment starts
`2026-06-15`. Auto-Schedule on that import produces a plan anchored three months late.
`sharepoint/fix-job-startdates.js` fixes the three demo rows; the flow gap behind it is open.

### D5. Crew roster, sizes and caveats exist only in the planner

`Crews` is `Title, CrewID, Size, Unlimited, LeadEmail, Active`. No members column, no notes
column.

The planner carries a named roster per crew (15 `members` arrays) and per-crew caveats that
exist nowhere else in this repo:

- *"Finish Grade assumed — not stated on the crew list"* (saul, guillermo)
- *"Hardscape only if supervised"* (antonio)
- *"Light grading only — no finish grade"* (cirilo)
- *"Other 2 members unidentified"* (campos), *"Third member unidentified"* (harrison)

These are real operational qualifications on rule 1. They are committed to git, so they are
not at risk of loss, but they are **invisible to anyone working in SharePoint**.

`conflicts()` (L400-407) also runs a check with no possible server-side analogue: if the same
named person appears on two crews working the same day, it warns *"Confirm these are
different people."*

### D6. Rule 3 (sequence) is enforced at generation and detected nowhere

Both `D2 - New Pool` and `D2 - Reschedule Pool` build sequential spans from a cursor, so a
generated or reflowed pool satisfies rule 3 by construction. But a PM editing
`ScheduledStart` on the edit form — what that form was redesigned for on 2026-09-10 — can put
3.2 before 3.1 with nothing to catch it. No flow checks it (Nightly Reconciliation, Conflict
Flag and Event-Driven Reconciliation all check crew overlap only), CAML cannot express it,
and the canvas app does not look. The planner catches it at L383.

**A shared defect rather than a divergence:** in `autoSchedule` (L314) a locked row sets
`cursor = adv(s.start)` **unconditionally**, so a locked row whose start precedes the
preceding rows pulls the cursor backwards and produces an overlap. `D2 - Reschedule Pool`
does the identical thing — `Set_cursor_pinned` = `addDays(ScheduledFinish, 1)` with no
`max()` against the running cursor. The difference is the planner will tell you; the flow
will not.

### D3. Skill Coverage is the only surface for Don's trade-mapping decision

`vCrews` (L640-646) renders, per trade, which crews hold it (red `none`) and which sub-phases
require it (red *"not mapped to any sub-phase yet"*). 16 of 26 trades are used by the 46
sub-phases; `cmu`, `form`, `grade`, `landscaping`, `masonry`, `materials`, `pavers`, `veneer`,
`walls`, `waterline` are not.

`Trades` has 26 rows and **no view**. `Crew-Trades` has 51 rows and **no view**. The decision
Don owes is visible in exactly one place: a browser tool not linked from anywhere.

### D10. Create and delete in the planner are local-only, silently

`addJob` (L744) assigns a number from `nextJobNo()` (max trailing integer + 1) and
immediately re-runs `autoSchedule()` across every pool. `delJob` (L746) removes it from the
array. Neither touches the tenant. So a pool sketched in the planner never reaches
SharePoint, a pool deleted there returns on the next import, and **two independent job-number
generators exist with no uniqueness check between them.**

### D11. Nothing marks a pool as diverged after an import

Four actions rewrite every unlocked row in every pool: Auto-Schedule (L898), `+ Job` (L744),
Set all durations (L766), Apply template (L768). Only sign-off-locked rows survive
(`importFromD2` L872 sets `locked = is.locked || is.inst`, which is the right rule and mirrors
`D2 - Reschedule Pool`). There is no dirty flag, no last-loaded stamp, no diff view. A PM
cannot tell by looking whether the Gantt is the live schedule or something they reflowed
twenty minutes ago.

The import also drops: **`Trade`** (so sub-phase trades always come from the local
`SEED_TEMPLATE` — if Don's mapping changes `Sub-phase Template.Trade`, the planner keeps
offering the old qualified-crew set and never knows), `TasksTotal`/`TasksComplete`,
`ConflictWith`, `Sequence`, `InstallerSignOffBy`/`On`/`SignOffNotes`, the `Crews` list, and
the Work Calendar.

---

## C. Hard to match, with the wall named

| Capability | Wall |
|---|---|
| The Gantt itself (3-level bars, compressed Mon-Sat axis) | Gantt view type is not Modern-compatible; a real one needs SPFx, which needs an app catalog. Partially answered by the 28-day timeline lane in `format-views.js`, which is one flat row per assignment. |
| Crew Board (crew x day swimlanes, DOUBLE-BOOKED bands) | A crew x date pivot is not a CAML view; Power Fx is a poor fit for timelines. Same SPFx wall. |
| Live availability panel (green/red per candidate, recomputed per keystroke) | A list form cannot run a cross-row query. Form JSON supplies layout and visibility only. Needs a canvas screen. |
| Auto-Schedule | `D2 - Reschedule Pool` moves dates and never picks a crew. Porting the candidate search into a flow is a real build, and Rev D §14 already flagged that the determinism fix must move with it. |
| Restore as rollback; Apply-template-to-all-pools | SharePoint has per-item versioning, not point-in-time list restore. Reapplying a template means delete + regenerate, destroying sign-offs. |

---

## B. Easily matched

Print (Export to Excel exists) · collapse/expand (`<GroupBy Collapse="TRUE">`, already used on
Tasks views) · bar labels (add `Crew`/`Locked` to `viewFields`) · unscheduled rows (one view,
`IsNull ScheduledStart`) · crew load chart (group by `Crew`, Sum on `DurationDays`) · dispatch
by arbitrary date (partial: CAML cannot parameterise a date) · "day N of M" (one calculated
column) · office/sub footer on dispatch (one more block in Flow 1) · phase roll-up (calculated
phase column + grouped view) · add/delete crew · **toggle trades on a crew (build a grouped
view on `Crew-Trades`, which has 51 rows and zero views)** · bulk durations (quick-edit paste
over 46 rows) · Sunday snapping on `ScheduledStart` (column validation) · backup (scheduled
flow).

---

## A. Already matched

Task ticking · installer sign-off with real attribution · reopen with an audit trail (better
than the planner, which just unticks a box) · lock semantics · not-applicable at sub-phase
level · double-booking with `unlimited` exemption · crew-code validity · daily dispatch ·
today's work by crew · finished-but-unsigned · pool creation and deletion · date reflow ·
spans, progress counters, addresses, CSV-equivalent export.

Plus two things the planner has no answer to: the **M365 group calendar** and **counter
reconciliation**.

**One matched in name only:** the `Unassigned` view. Its CAML is
`(Crew IsNull OR Crew='' OR Crew='unassigned') AND Trade IsNotNull`
(`provision-views.js:149`). The 11 field-supervision sub-phases it exists to find are the
`@unassigned` ones, and `@unassigned` is a pseudo-trade resolving to **no `Trade` lookup at
all**. So the `IsNotNull Trade` clause excludes precisely the rows the view is for. The
planner shows all 11 as warnings; the view shows zero.

---

## The three to fix first

1. **Carry the Work Calendar into the planner (D7).** One field added to
   `export-to-planner.js` (a `nonWork: []` array), one array in state, and `isWork` becomes
   `d.getDay() !== 0 && !nonWork.has(fmt(d))`. About thirty lines. It is the only divergence
   that makes the designated planning surface produce a *wrong plan*, and `oracle-test.js`
   invariant #9 already fails on it, so the test is waiting.

2. **Give rule 1 a detector on the SharePoint side (D1).** A nightly flow shaped like
   `D2 - Conflict Flag`: join `Assignments.Crew` → `Crews.CrewID` → `Crew-Trades` →
   `Assignments.Trade`, stamp a mismatch column, add a view. Also finally gives `Crew-Trades`
   a reason to exist and gives Don's trade-mapping decision somewhere to land. A null `Trade`
   must be a **pass**, or it fires on 11 rows per pool from the first run.

3. **Stop Schedule Check crying wolf (D2, D8, D9).** Three small export changes decide
   whether the planner's best feature is usable: drop the PM half of the finished-but-unsigned
   check until `PMSignOff` is a real workflow, carry `Tasks.NotApplicable` and give the planner
   a third task state, and carry `Jobs.Status` so `Planned` pools are badged rather than
   indistinguishable.
