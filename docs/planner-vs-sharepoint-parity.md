# Planner vs SharePoint: capability parity map

Audited 2026-09-11 against `web/index.html` (moved 2026-09-11 from the doubled
`D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`; 910 lines, single file,
no network calls, `localStorage` key `poolsched.v6`, at the time of this audit). Line
numbers are to that file **as it stood at the audit**, before the fixes below landed;
the file has since grown past 1000 lines and moved within `web/index.html`, so treat
every line number here as historical rather than current.

**Six of the eleven divergences below are now CLOSED, fixed the same day in the same
branch that repainted the planner and moved it out of the doubled directory: D7, D2,
D8, D9, D4 and D11.** Each closed section says what the divergence was, that it is
closed, and what closed it — the reasoning is kept because the map is what makes the
next divergence easy to spot, not because the bug is still live. D1, D3, D5, D6 and
D10 are unchanged and still open.

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

### D7. Work Calendar — the planner knew about Sundays and nothing else — CLOSED

**What it was:** `isWork = d => d.getDay() !== 0` (L219) was the entire work-calendar model. It
fed `nextWork`, `workSpan`, `axis`, `shiftDay` and `saveSec`. No holiday, weather-day or
per-crew-shutdown concept. `S.settings` was initialised empty (L257) and never written.

Against that, `D2 - New Pool` and `D2 - Reschedule Pool` both compute Sunday **and** test a
`nonWork` set read from Work Calendar (35 holidays, 2026-08-30 to 2029-12-30).

**This was the only divergence that made the planner produce a wrong plan rather than an
incomplete picture.** Four consequences, quietest first:

1. **`importFromD2` never read `is.finish`** (L866-872 overlaid `crewId`, `start`, `days`
   and flags only). Every end date was recomputed as `workSpan(start, days)` over Sundays
   alone, so **any sub-phase whose SharePoint span stepped over a holiday rendered a day
   short.** The bar was wrong and nothing said so.
2. `conflicts()` computed double-booking (L388) and the rule-3 chain (L383) off that
   shortened span, so it could **miss a real overlap** and **invent a sequence error**.
3. Auto-Schedule would put crews on Thanksgiving and Christmas, silently.
4. Daily Dispatch would show a full crew board on a holiday.

The asymmetry ran both ways: the planner's Sunday rule was **computed and therefore correct
forever**, while SharePoint's holiday set **expires 2029-12-30** with nothing maintaining it.
That second half of the asymmetry is unchanged by the fix below — it is a SharePoint-side gap,
not a planner one — and is tracked separately in CLAUDE.md's Phase G backlog.

**What closed it, 2026-09-11:** `export-to-planner.js` now emits a `nonWork: []` array (every
Work Calendar date, bare `yyyy-mm-dd`), `importFromD2` stores it on `S.settings.nonWork` and
calls `syncNonWork()`, and `isWork` is now `d => d.getDay() !== 0 && !NONWORK.has(fmt(d))`. The
planner still computes Sunday itself and additionally checks the imported set, mirroring
`D2 - New Pool`'s own two-part test. `fixtures/planner/workcalendar.js` pins this end to end:
every one of the 138 live spans is checked against the same SharePoint calendar the flows use,
not just against a synthetic holiday. A first-run browser with nothing loaded yet still falls
back to Sundays-only, which is the correct degraded behaviour, not a bug — the same fallback
`D2 - New Pool` has if its own calendar read ever comes back empty.

### D2. PM sign-off exists on both sides, was wired up on neither — CLOSED

**What it was:** the planner has a real two-tier model: `inst` and `pm` per sub-phase, a
phase-level tri-state roll-up (L350), a bulk phase toggle (L354), per-pool counts (L582), and a
`conflicts()` warning when a finished sub-phase is missing **either** (L386).

On the SharePoint side `PMSignOff`, `PMSignOffBy` and `PMSignOffOn` exist, are written
`false` once by `D2 - New Pool`, are hidden from the forms, and appear in **no other flow,
no view, and nowhere in the canvas app**. That half is unchanged — this was never a data
problem, it was a planner check running against a field nothing on the SharePoint side ever
sets.

`export-to-planner.js:115` faithfully exported `pm: !!a.PMSignOff`, which was **always false**.
So the first Load from D2 filled Schedule Check with *"missing PM sign-off"* on **every
finished sub-phase, forever** — 51 rows on current demo data. A panel permanently full of
unclearable warnings is a panel people stop reading, which cost the seven checks that are
real, two of which exist nowhere else in the system.

**What closed it, 2026-09-11:** the `conflicts()` warning no longer checks the PM half of
sign-off — a finished sub-phase now warns only on a missing **installer** sign-off, the one
side of this that a real workflow actually sets. `fixtures/planner/schedulecheck.js` pins
both halves of this: zero PM-sign-off warnings on live data, and installer sign-off still
flagged when it is genuinely missing (46 found on the current demo pools). If `PMSignOff`
ever becomes a real workflow on the SharePoint side, the PM half of this check should come
back with it — the comment at the call site (`web/index.html` ~L466) says so directly, so a
future session does not have to rediscover why it was dropped.

### D9. `Jobs.Status` was exported and then discarded — CLOSED

**What it was:** `export-to-planner.js:101` emits `status`. `importFromD2` (L851-861) never
read it and the planner had no pool-state field. So a `Planned` pool appeared on the Gantt,
the Crew Board, Daily Dispatch and the CSV, and raised double-book errors, exactly like a live
one. That inverted the 2026-09-09 `Planned` decision on the one surface a PM uses *while
choosing dates*.

Arguably the planner's behaviour was the **right** one — the reflow's own conflict sweep is
deliberately tenant-wide for exactly this reason. The problem was that it was accidental and
gave a PM no way to tell the two apart. The fix badges them rather than hiding them, which is
the option this section already recommended.

**What closed it, 2026-09-11:** `importFromD2` now stores `status` on the job, and `jobBadge()`
(`web/index.html` ~L285) renders a status chip everywhere a pool's name appears — the board, the
Crew Board, the Jobs list. `Active` gets no chip (the common case should not be noisy); `Planned`
and `On Hold` each get a visibly distinct one. Nothing was hidden and nothing stops a PM from
still seeing a `Planned` pool's conflicts while choosing dates — that behaviour was correct all
along, per the reflow's own tenant-wide sweep — it is now a labelled choice instead of an
accidental one.

### D8. N/A had no third state, so excluded work read as incomplete — CLOSED

**What it was:** **`Tasks.NotApplicable` was not exported** (`export-to-planner.js:69` selected
`Id, AssignmentId, Sequence, Title, Complete`). An N/A task imported as *not done*, so a
sub-phase legitimately signed off at 5 of 6 rendered permanently incomplete. The planner had
no third task state to put it in.

The bulk-tick half of this finding is a separate, still-open concern: the drawer's `all` / `none`
links (L705) call `allTasks()` (L716), setting `done` on all ~6 tasks in one click, with an INST
checkbox next to it that has no precondition. The 2026-09-07 decision — no sign-off while any task
is unresolved, with N/A carrying a mandatory reason precisely so a bare block does not produce
false ticks — is the most deliberated rule in CLAUDE.md, and the planner still offers a one-click
route around it. This fix wave did not touch that; it only closed the N/A-state half.

**What closed it, 2026-09-11:** `export-to-planner.js` now selects and exports
`Tasks.NotApplicable` as `na`, and the planner has a real third state alongside `done`. A task
cannot be both `done` and `na` — `importFromD2` normalizes on the way in (done wins, mirroring
`tick()` already clearing `na` when a task is ticked), so a live row that somehow claimed both
resolves to exactly one state rather than double-counting. Progress and the whole-job bar now
read *resolved* (`done + na`) rather than merely `done`, so a sub-phase with one N/A and five
done reads as finished, matching `Assignments.TasksComplete`'s own "genuinely-done-only" count
underneath. `fixtures/planner/live-export.js` pins the normalization case directly: a task
claiming both flags resolves to done-only, and `secCounts` never double-counts it.

### D4. `Jobs.StartDate` drift corrupted Auto-Schedule, not just a display field — CLOSED (planner side)

**What it was:** the 2026-09-11 session log recorded `Jobs.StartDate` as "display-only: nothing
reads the field after creation". **That was no longer true.** `export-to-planner.js:100` exports
it, `importFromD2` (L860) writes it to `j.start`, and `autoSchedule` (L309-310) used it twice: to
**order the pools** and to **seed each pool's cursor**.

Whitfield read `2026-09-21` on Jobs while its first assignment started `2026-06-15`. Auto-Schedule
on that import produced a plan anchored three months late.

**What closed it, 2026-09-11, on the planner side:** a new `jobStart(j)` helper walks a pool's
own sub-phases for the earliest real, non-skipped `start` and falls back to `j.start` only when
none exists; `autoSchedule` now sorts pools and seeds each pool's cursor from `jobStart(j)`
instead of the raw `j.start` field. `fixtures/planner/startdate.js` pins this with the exact
Whitfield shape (locked early work, a drifted `j.start` months later) plus two isolated
regression scenarios for the two call sites independently — a revert of either one fails a test
on its own, because the original single-job scenario alone could not distinguish them.

**Still open, deliberately not touched here:** the underlying SharePoint-side gap. `D2 -
Reschedule Pool` still never writes `Jobs.StartDate` back after a reflow, so the field stays
drifted on the SharePoint side regardless of what the planner now does with it on import.
`sharepoint/fix-job-startdates.js` is the one-off fix for the three demo rows; the flow gap
behind it is unchanged and is not part of this fix wave.

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

### D11. Nothing marked a pool as diverged after an import — CLOSED

**What it was:** four actions rewrite every unlocked row in every pool: Auto-Schedule (L898),
`+ Job` (L744), Set all durations (L766), Apply template (L768). Only sign-off-locked rows
survived (`importFromD2` L872 set `locked = is.locked || is.inst`, which is the right rule and
mirrors `D2 - Reschedule Pool`). There was no dirty flag, no last-loaded stamp, no diff view. A
PM could not tell by looking whether the Gantt was the live schedule or something they reflowed
twenty minutes ago.

**What closed it, 2026-09-11:** every import now stamps `S.settings.loadedAt` and
`S.settings.exportedOn`, and the header renders "Live as of `<time>`" (a bare time for a load
from today, a compact date-and-time otherwise — see the freshness-stamp fix below) plus the
export date. A per-sub-phase `s.base` snapshot is taken at import time holding exactly the
fields SharePoint owns (`id, crewId, start, days, locked, skip`, plus `spLocked` — see below);
`divergedSecs(j)` diffs the live section against that snapshot, and `touch(j)` stamps
`j.touchedAt` on every action that can move a row, `delCrew` included, which was found and fixed
in the same pass (a crew deletion mutates sections directly, with no `autoSchedule()` call to
fall back on, so it has to call `touch()` itself or it guts a pool's assignments in total
silence). The header shows both how many pools were edited here and how many sub-phases
diverged. `fixtures/planner/freshness.js` pins the whole chain: import stamps, a baseline exists
on every imported section, a crew change is divergence, a task tick is deliberately not, and
`delCrew`'s divergence count agrees with its own `touchedAt` stamp.

**Two things worth calling out because they are easy to get backwards if this is extended
later.** First, sign-off and task ticks are deliberately kept OUT of `s.base`, on purpose,
pinned by its own assertion in `freshness.js`: `s.base` is what a future batch write-back would
diff against to decide what to push to SharePoint, and the planner's `inst`/`pm` are bare
booleans with no attribution, timestamp or notes, while SharePoint holds
`InstallerSignOffBy`/`On` and `SignOffNotes` — widening the baseline to include them would let a
future write-back overwrite an attested sign-off with a flag. Second, `s.base.locked` holds the
same *derived* lock Auto-Schedule already respects (SharePoint's `Locked` OR sign-off); a
separate `spLocked` field on the baseline holds the raw SharePoint `Locked` value on its own, so
a future write-back can still tell a PM's deliberate pin apart from a lock this planner inferred
from sign-off — the two look identical through `locked` alone.

The import still drops: **`Trade`** (so sub-phase trades always come from the local
`SEED_TEMPLATE` — if Don's mapping changes `Sub-phase Template.Trade`, the planner keeps
offering the old qualified-crew set and never knows), `TasksTotal`/`TasksComplete`,
`ConflictWith`, `Sequence`, and `InstallerSignOffBy`/`On`/`SignOffNotes` (deliberately, per the
attribution point above) and the `Crews` list. **The Work Calendar is no longer in this list —
see D7, now closed — it is imported and acted on.**

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

## The three to fix first (1 and 3 done 2026-09-11; 2 still stands)

1. ~~**Carry the Work Calendar into the planner (D7).**~~ **DONE.** See D7 above.
   `oracle-test.js` invariant #9, which this section originally cited as "the test is
   waiting," stayed a string grep rather than becoming a real gate — that was a deliberate
   call in the implementation plan, because `fixtures/planner/workcalendar.js` is the harness
   that actually exercises D7 against live data, and it did not exist when this
   recommendation was first written.

2. **Give rule 1 a detector on the SharePoint side (D1).** Still stands as written here. A
   nightly flow shaped like `D2 - Conflict Flag`: join `Assignments.Crew` → `Crews.CrewID` →
   `Crew-Trades` → `Assignments.Trade`, stamp a mismatch column, add a view. Also finally gives
   `Crew-Trades` a reason to exist and gives Don's trade-mapping decision somewhere to land. A
   null `Trade` must be a **pass**, or it fires on 11 rows per pool from the first run. (See
   CLAUDE.md for `D2 - Crew Trade Check`, a SharePoint-side flow that does exactly this —
   whether it fully closes D1's planner-side inconsistencies too, or only the missing detector,
   is outside this fix wave and was not re-audited here.)

3. ~~**Stop Schedule Check crying wolf (D2, D8, D9).**~~ **DONE.** All three export changes
   landed: the PM half of the finished-but-unsigned check is dropped until `PMSignOff` is a
   real workflow (D2), `Tasks.NotApplicable` is carried and the planner has a third task state
   (D8), and `Jobs.Status` is carried so `Planned`/`On Hold` pools are badged rather than
   indistinguishable from `Active` (D9). See each section above for what closed it.
