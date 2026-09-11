# SDD ledger — plan: docs/superpowers/plans/2026-09-11-phase-h-stage1-parity-and-brand.md

Spec: docs/superpowers/specs/2026-09-11-planner-as-primary-surface-design.md (read, reachable)
Branch: canvas-app-handoff  ·  Start HEAD: 51c1d5c
Baseline (measured before any change): determinism STABLE · roundtrip 16/16 · empty clean ·
live-export 17/17 · oracle-test 14/16 · D7 defect = 2 of 138 spans wrong (ids 360, 410, Columbus Day)

Ruling: work in-place on `canvas-app-handoff` rather than a new worktree — it is already a feature
branch off master, it is where all Phase H work belongs, and Tasks 1 and 7 touch the live tenant via
az/FlowAgent which a worktree does not isolate anyway. Cost if wrong: none material; the branch is
not master and nothing is pushed.

---

## Pre-flight conflict scan

### Task-pair rows (tasks sharing a file or an interface)

| Pair | Produces → consumes | Finding |
|---|---|---|
| T1 → T2 | `live-payloads.json.cal`, `tasks[].NotApplicable` → `run-export.js` pick(), export `$select` | clean |
| T2 → T3 | `run-export.js::runExport`, payload `nonWork` → workcalendar.js, `syncNonWork` | clean |
| T2 → T4 | payload `sections[].tasks[].na` → task model `na` | clean |
| T2 → T6 | payload `status` — already exported before T2 | clean, T6 independent of T2 |
| T2/T4/T6 | all append assertions to `fixtures/planner/live-export.js` | clean, sequential appends |
| T3 → T8 | `S.settings` guaranteed an object → `S.settings.loadedAt` written beside `nonWork` | clean, same insertion point |
| T4 → T8 | `toggleNA` must exist before T8 adds `touch()` to it | clean, T4 precedes T8 |
| T6 → T8 | `jobBadge(j)` defined → extended with the edited chip | clean, T6 precedes T8 |
| T6 → T9 | `.chip.jb.*` literal colours → T9 palette sweep (`#fafafa/#0f766e/#0b1220/#1c2434/#c9d2e3`) | clean, no overlap in the sweep list |
| T8 → T9 | `.chip.jb.edited` `#fff7ed` → same sweep | clean, not in the sweep list |
| T3/T4/T5/T6/T7/T8/T9 | all modify `pool-scheduler.html` | clean, strictly sequential |
| T3/T5/T7/T8 → T10 | four new harnesses → T10 rewrites every planner path | clean, T10 is last |

### Per-task self-consistency rows

| Task | Own text agrees with itself? | Finding |
|---|---|---|
| T1 | capture → verify → document → commit | clean |
| T2 | extract → prove unchanged → red → implement → green | clean; Step 4's red is `nonWork` undefined, correct |
| T3 | test → red → implement → green | **DEFECT — see Finding 1** |
| T4 | test → red → implement → green | nit — see Ruling 2 |
| T5 | test → red → implement → green | nit — see Ruling 3 |
| T6 | assertion → red → implement → green | clean; line-614 hit correctly excluded as an `<input>` |
| T7 | test → red → implement → green + human gate | clean; red is a thrown TypeError, stated as such |
| T8 | test → red → implement → green | clean; `#freshness` lives in static `<header>`, survives `render()` |
| T9 | repaint → jsdom parse check → **real browser** check | clean; correctly says jsdom does not paint |
| T10 | find refs → git mv → rewrite → verify | clean |

### Global Constraints vs task text

| Constraint | Finding |
|---|---|
| No new planner dependencies except a Google Fonts link | T9 adds exactly that, nothing else |
| Nothing writes to SharePoint except Task 7 | holds; T7 Step 7 is an explicit human gate |
| Dates are bare `yyyy-MM-dd` | holds; T2 reuses the existing `day()` helper |
| Planner never writes back | holds in this plan — see Requirement R1 below, which changes the plan's FUTURE, not its scope |

### Findings and rulings

**Finding 1 (real defect in the plan, T3 Step 4).** `load()` has an **early return**:
`try{const raw=localStorage.getItem(KEY);if(raw){S=JSON.parse(raw);return;}}catch(e){}`. The plan
says to add `syncNonWork()` "after both branches have set `S`", which lands it after that return —
so a returning user (the only user who HAS a stored calendar) would never rebuild `NONWORK`, and
holidays would silently stop applying on every visit after the first. That is the exact
silent-wrong-render failure class this project keeps hitting.
**Ruling:** amend T3 Step 4 to name both paths explicitly — `syncNonWork()` immediately before the
early `return`, and again at the end of the function. Cost if wrong: none; it is idempotent.

**Ruling 2 (T4 Step 5).** The drawer label as written calls `secCounts(s)` three times inside one
template literal. Hoist it to a `const c=secCounts(s);` above the template. Reason: a reviewer would
correctly flag the triple call and cost a fix round for a nit the plan itself created. Cost if
wrong: none.

**Ruling 3 (T5 Step 1).** The test calls `win.autoSchedule()` and then overwrites every section's
dates, so the call has no effect on anything asserted. Remove it. Reason: a test doing work that
cannot affect its assertions is a review finding the plan mandated. Cost if wrong: none.

**Requirement R1 — batch write-back (Shane, mid-session 2026-09-11).**
*"we also will need to make some sort of batch write-back. <when finished press save to batch write
back>"*. This is spec Stage 2 and is NOT added to this plan's scope. It does change two things here,
because both are one line now and a retrofit later:
- **T2 must also export the SharePoint row ids** (`id: a.Id` per section, `id: j.Id` per job). The
  export carries none today, so nothing downstream can address a row to write to it.
- **T8 must snapshot the SharePoint-owned fields at import**, so divergence is known per sub-phase
  rather than only per pool. That snapshot is exactly the change-set a batch write-back sends.
**Ruling:** fold both into T2 and T8 now; spec the write-back itself separately after this plan.
Cost if wrong: two unused fields and a small per-pool snapshot in localStorage.

---

## Task log

Task 1: complete (commits 20a3fb2..0d5a714, review clean)
  cal 210 rows (175 Sundays + 35 holidays, 2026-08-30..2029-12-30), 2026-10-12 present.
  tasks 885, all carrying NotApplicable, 2 marked true — so Task 4's N/A assertion is NOT vacuous.
  Throwaway probe flow deleted and confirmed gone. Reviewer corroborated against raw HTTP bodies.

Task 2: complete (commits 0d5a714..85407d8, review clean)
  live-export.js 23/23. runExport extracted to fixtures/planner/run-export.js (exactly one
  definition). Payload gains nonWork (210 days, deduped+sorted), jobs[].id, sections[].id,
  tasks[].na. No task id, deliberate. Read-only preserved.
  Task 2: minor (deferred): run-export.js header names workcalendar.js as a consumer before it
  exists — resolves in Task 3. Non-issue flagged and dismissed: literal space in
  GetByTitle('Work Calendar') matches existing repo precedent.
  Note: the plan's Step 3 PROSE said "four new assertions / 21 total" while its code block held six
  (I added two row-id assertions later without updating the prose). Implementer followed the code,
  which was right. No action.

Task 3: D7 FIXED — 2 of 138 wrong spans -> 0. oracle-test 14/16 -> 15/16.
  Reviewer independently reverted the isWork line and confirmed workcalendar.js goes red naming the
  same two rows, so the fix is load-bearing rather than cosmetic.
  Ruling: the reviewer's Important finding stands and gets fixed, even though the plan supplied that
  test verbatim. It proved workcalendar.js's headline assertion can pass VACUOUSLY — breaking the
  bySec join makes every row skip, `checked` stays 0, `wrong` stays empty, and the suite reports
  PASS [0 spans checked], exit 0. That is the exact "succeeds and does nothing" signature this
  project loses the most time to, and the sibling harness live-export.js already guards it
  (`secs === live.asg.length`). One line to close. Cost if wrong: negligible.
  Task 3: minor (deferred): nextWork()'s bounded guard (raised 10->30) still returns silently if
  exhausted. Inherited pattern, also in workSpan's g++<4000. Longest real non-work run today is 2
  (Sunday + adjacent Monday holiday), so not reachable; noted, not fixed.
  Task 3: fix round 1/5 (1 addressed, 0 open — workcalendar.js vacuous-pass guard; commits
    e775caf..2c6c399). Guard independently verified by the controller AND the re-reviewer:
    broken join -> FAIL [0 of 138]; restored -> PASS [138 of 138].
Task 3: complete (commits 85407d8..2c6c399, review clean after 1 fix round)

Task 4: D8 done — N/A is a third task state. live-export 'N/A ticks landed' 0 of 2 -> 2 of 2.
  Reviewer independently confirmed the 'all-resolved reads 100%' assertion is NOT vacuous (2 real
  sub-phases qualify: D2-1044 1.3, D2-1043 2.4), and that 0 of 885 live tasks hold Complete AND
  NotApplicable together. Traced every counting call site; CSV header/row both 22 columns, aligned.
  Ruling: fix BOTH the Important and the second Minor in one round, though neither was required by
  the brief. (a) importFromD2 sets t.done and t.na independently with no normalisation, so a row
  arriving with both true would render checked AND offer the N/A toggle. It cannot happen today,
  but guarding an impossible state at the boundary is this project's house style precisely because
  the platform surprises us, and it is one line. (b) vSignoff's whole-job bar still computes
  dn/tot (done only) while every per-sub-phase bar now shows resolved, so a job whose sub-phases
  all read 100% can read under 100% in aggregate — the same complaint D8 exists to fix, one level
  up. That inconsistency came from my own Step 5 snippet, so the implementer was right to follow it.
  Cost if wrong: two lines touching display only.
  Task 4: minor (deferred): roundtrip.js is cited as "16/16" in CLAUDE.md, the plan and the brief
  but contains 15 ok() calls. Pre-existing label drift, file untouched by this work.
  Task 4: fix round 1/5 (2 addressed, 0 open — import normalisation + whole-job bar; commits
    b8d47ba..c373700). Covering test shown failing without the guard. Label correctly left done-only.
Task 4: complete (commits 2c6c399..c373700, review clean after 1 fix round)

Batching Tasks 5 and 6 into ONE dispatch: both are small, independent, single-file planner edits
with their own tests, and they touch disjoint functions (conflicts() vs importFromD2/newJob/
jobBadge). One dispatch, one review, per the skill's batch-small-same-shape-work rule.
Task 5: complete (commit f674e21, review clean, no findings)
  Reviewer reverted conflicts() to prove schedulecheck.js discriminates: pre-fix it goes
  FAIL [46 found] / FAIL [0 found]. PM checkboxes, roll-up, counts and CSV column all survive.
Task 6: complete (commit e5bba10, review clean, no findings)
  Grepped every .status reference: nothing filters, hides or skips a pool. Planned/On Hold are
  badged and STILL raise conflicts, which is the intended behaviour. esc() applied before
  interpolation. Three badge sites; the vJobs <input> trap correctly avoided.
  Note: my dispatch said the grep returns four hits; it returns three. The implementer caught it
  and did the right thing. No impact.

Task 7: code landed (c5bb1d4), Step 7 live-tenant write correctly NOT performed. Review found TWO
  test-adequacy defects, neither in the implementer's work — both were in test code my plan supplied.
  Ruling: fix both.
  (a) CRITICAL — startdate.js cannot fail. Reviewer reverted BOTH autoSchedule call sites and all 3
      assertions still passed. Cause: the test creates ONE job so the sort comparator never runs,
      and the cursor seed is discarded by the first locked row before it can place anything. Only
      assertion 1 exercises jobStart() at all.
  (b) IMPORTANT, PRE-EXISTING — determinism.js is VACUOUS and has been since a02db78, when the
      planner stopped seeding demo pools. It reports "assignments compared : 0" and then declares
      STABLE. I cited it as a gate repeatedly this session, including in the recorded baseline where
      that line was visible in my own output. CLAUDE.md still describes it as pinning "4 of 138 crew
      picks drifted per re-run before, 0 after", which was true when the planner shipped pools and
      is not true now. Same class as the flows/definitions and patched-tool drift already recorded
      in CLAUDE.md: a committed artifact quietly stops meaning what its description says.
      oracle-test.js already solves this by seeding 2 pools itself; determinism.js must do the same.
  Cost if wrong: test-only changes; no production code moves.
  Task 7: fix round 1/5 (2 addressed, 0 open; commits c5bb1d4..599eac2). startdate.js now dies on
    each independent revert (sort alone, cursor alone, both) — controller verified the sort-alone
    case directly. determinism.js seeds 3 pools via addJobBtn, the same pattern oracle-test.js uses:
    assignments compared 0 -> 138, still STABLE. Reviewer judged the seeding genuinely adequate
    rather than decorative: all 138 sections unlocked and contended, several skills carrying 3-5
    qualified candidates, which is the same contention shape that produced the original 4/138
    oscillation. pool-scheduler.html untouched this round.
  GOOD NEWS from that: Auto-Schedule is genuinely idempotent on real data. We now have proof
  instead of a vacuous pass.
Task 7: complete (commits e5bba10..599eac2, review clean after 1 fix round)
  OUTSTANDING HUMAN GATE: Task 7 Step 7, sharepoint/fix-job-startdates.js against the live tenant.
  Deliberately not run. Now cosmetic rather than load-bearing, because the planner-side guard means
  Auto-Schedule no longer depends on Jobs.StartDate being correct.

Task 8: code landed (4e0964a). s.base scope correct (id/crewId/start/days/locked/skip only — no
  sign-off, no ticks). No write path. Reorder of two assertion blocks CLEARED by the reviewer:
  it reproduced the bug from my literal brief fixture (autoSchedule legitimately diverges all 46
  before the isolated checks could run), diffed the ok() lines to confirm nothing but position
  changed, and mutation-tested both divergence assertions red in two independent ways.
  Ruling: fix the reviewer's Important finding. delCrew() sets s.crewId=null and s.locked=false on
  every section of that crew without calling touch(), so deleting a crew can gut an imported pool
  (divergedSecs = 46) while j.touchedAt stays undefined and the header reports nothing. A freshness
  indicator that under-reports is worse than none, because it asserts a freshness that is false —
  which is the exact failure the brief warned about. Ask for a SWEEP of all mutating paths rather
  than a delCrew-only patch; the brief's enumerated four sites were evidently not exhaustive.
  Cost if wrong: an over-eager badge, which is the safe direction to err.
  Task 8: fix round 1/5 (1 addressed, 0 open; commits 4e0964a..7c8538b). delCrew now touches
    conditionally on `hit`, so only pools it actually changed are marked. Covering test shown
    failing without the guard. Reviewer ran the sweep INDEPENDENTLY and produced its own 9-site
    table agreeing with the report's "1 additional site", including two candidates a naive grep
    would miss (sign()'s dynamic s[k]=val, setJob()'s dynamic [k]=v). setAllDays and applyTemplate
    are transitively covered because both call autoSchedule() immediately after.
Task 8: complete (commits 599eac2..7c8538b, review clean after 1 fix round)
  Task 8: minor (deferred): autoSchedule's per-job touch() is unconditional, so a no-op recompute
  flags every pool as edited. Brief-mandated, errs toward over-reporting, which is the safe
  direction for a freshness indicator. Self-flagged by the implementer both rounds.

Batching Tasks 9 and 10 into ONE dispatch, two commits, 9 before 10: both are mechanical, and 10
rewrites the planner path in every harness so it must come last. Task 9's visual check cannot be
delegated (jsdom does not paint), so it is being split: the implementer proves the tokens and the
absence of stale hex codes, and a human eyeball stays outstanding.

VISUAL VERIFICATION CLOSED by the controller, not deferred. Playwright refused (profile locked, the
documented failure), so headless Chrome with an isolated profile was driven against a local static
server. Renders correctly: navy #082544 header, cream #F6F3ED ground, green primary, crew bars still
mutually distinguishable, today marker still legible, and Task 8's freshness stamp visible in a real
browser ("Not loaded from D2"). Screenshots: planner-repaint.png and planner-prev.png.
The header's Reset button wrapping to a second row is PRE-EXISTING, proven by rendering the
pre-repaint build at the same viewport. Not a repaint regression.
Task 9: complete (commit 166c0dd)
  Ruling on the reviewer's Important finding: KEEP the --ok change, no fix round. My plan's PROSE
  said only --warn moves while my plan's CODE BLOCK set --ok:#0B594B; the implementer followed the
  code block, which is the same call they made correctly on Task 2's assertion count. The code was
  the deliberate half: unifying "ok" with the brand green improves contrast on white from ~5.0:1 to
  ~8.3:1 and the reviewer judged it visually harmless. Accepted cost: "success" green and "primary
  action" green are now the same colour, so a signed-off label reads the same as a primary button.
  Defensible as brand consistency. Cost if wrong: one token, trivially reverted.
Task 10: complete (commit 01d1279, review clean)
  git mv confirmed by git log --follow: 100% similarity rename, history intact back to migration.
  All 9 harnesses updated and independently re-run. live-export.js output READ, not exit-code
  trusted: 14 real assertions, SKIP branch not hit. build-navigation.js and sessions/* untouched.
  staticwebapp.config.json valid, no auth/routes block. Reviewer endorsed the out-of-brief edit to
  the nested README, which told a reader to open a file that had moved.

ALL 10 TASKS COMPLETE. Proceeding to the final whole-branch review.

FINAL WHOLE-BRANCH REVIEW (opus): ready to merge, 3 Important + 6 Minor. Ran ten mutations against
production code. Rulings on each:
  FIX - empty.js cannot fail. No assertion, no non-zero exit. Proven: breaking the planner at boot
    prints "THREW" and still exits 0, while sitting in eight && chains and the exit-criteria table.
  FIX - s.base field scope is unpinned, and this is the most valuable finding in the review. Adding
    inst/pm to the baseline left ALL NINE harnesses green. That is exactly the widening CLAUDE.md
    forbids, because it would overwrite InstallerSignOffBy with a bare boolean, and it is the
    invariant the batch write-back Shane asked for turns on. One assertion closes it.
  FIX - docs/planner-vs-sharepoint-parity.md and CLAUDE.md still describe D7/D2/D8/D9/D4/D11 as
    open. CLAUDE.md sends every session to that map before touching either side. This is the same
    drift class CLAUDE.md itself records three times (flows/definitions, patched-tool, stale
    exports) and it would be the fourth.
  FIX - base.locked snapshots the planner's DERIVED lock (is.locked||is.inst), so a write-back
    cannot tell a PM's deliberate pin from a sign-off-derived one. Cheap now, expensive later.
  FIX - freshness stamp shows a time with no date; "Live as of 09:14" reads the same today as
    yesterday, and distinguishing stale from fresh is the whole point of the feature.
  FIX - live-export.js SKIP branch exits 0. Second silent-green path, same class as empty.js.
  PARK - oracle invariant 9 is a string grep, so reverting isWork keeps it at 15/16. Documented in
    the plan; workcalendar.js is the real D7 gate. Cost if wrong: none, it is belt-and-braces.
  PARK - Google Fonts makes the planner non-network-free, contradicting CLAUDE.md's download.aspx
    entry ("no network of any kind"). Plan-permitted with a real fallback stack, and that
    distribution route is being retired by the hosting phase anyway. Note it at session close.
  FLAG TO SHANE, not a code fix - sharepoint/fix-job-startdates.js has DRY_RUN=false COMMITTED at
    line 37, while the hand-off instruction is to run with true first. Pre-existing, outside this
    plan, but it turns a "look before you leap" into a live write on paste.
