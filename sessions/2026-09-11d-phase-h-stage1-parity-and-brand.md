# 2026-09-11d — Phase H Stage 1: parity divergences, brand, and the repo move

**Session goal:** kick off Phase H development. Became the whole local half of Stage 1 — five
parity divergences closed against live data, divergence-state tracking added, the planner
repainted into the D2 palette and moved to `web/index.html`. Executed as a written plan via
subagent-driven development: 10 tasks, 6 fix rounds, a whole-branch review and a fix wave.

---

## What shipped

**Six of the eleven parity divergences are closed**, each verified against the captured live
payload rather than asserted:

| | Before | After |
|---|---|---|
| D7 work calendar | 2 of 138 live spans drawn a day short (both crossing Columbus Day) | **0**, all 138 agree with SharePoint |
| D2 PM sign-off | 51 unclearable "missing PM sign-off" warnings | installer-only; PM concept survives everywhere else |
| D8 N/A | an N/A task imported as not-done, so 5-of-6 read incomplete forever | third state; label stays done-only, bar measures resolved |
| D9 `Jobs.Status` | exported then discarded, `Planned` looked live | badged, and still raises conflicts by design |
| D4 `Jobs.StartDate` | Auto-Schedule anchored on a field months adrift | anchored on earliest real work |
| D11 freshness | no way to tell live data from a local reflow | header stamp, per-sub-phase baseline, `divergedSecs()` |

Plus: repainted to the measured D2 palette (navy `#082544`, green `#0B594B`, cream `#F6F3ED`,
Poppins + Source Sans 3) and `git mv`'d the planner to `web/index.html` with
`staticwebapp.config.json` beside it. `oracle-test.js` 14/16 → 15/16.

**Write-back groundwork, not the write-back.** Shane asked for a batch write-back mid-session. It
stays out of scope and needs its own spec, but two things were folded in because they were one
line each now and a retrofit later: the export carries SharePoint row ids (it carried none), and
the import records `s.base` per sub-phase so divergence is a diff rather than a flag.

---

## Files touched

- `web/index.html` — moved from `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`;
  work calendar, N/A state, status badge, `jobStart()`, freshness/divergence, repaint
- `web/staticwebapp.config.json` — new; SPA fallback, deliberately no `auth`/`routes` block
- `sharepoint/export-to-planner.js` — carries `nonWork`, `tasks[].na`, and row ids
- `fixtures/planner/` — `run-export.js` extracted; `workcalendar.js`, `schedulecheck.js`,
  `startdate.js`, `freshness.js` added; `determinism.js`, `empty.js`, `live-export.js` repaired;
  `live-payloads.json` gained 210 Work Calendar rows and `NotApplicable` on 885 tasks
- `docs/planner-vs-sharepoint-parity.md` — six sections rewritten as closed; all 41 line
  citations re-resolved; D1 corrected
- `CLAUDE.md` — rule 1 contradiction fixed, Phase H row, new NEXT SESSION section
- `docs/superpowers/plans/` — the plan and its execution ledger

## Commits

20 on `canvas-app-handoff`, `cd830ae..3efafea`.

---

## Decisions

- **Divergence fixes before hosting.** Hosting a planner that draws wrong spans would mean
  patching it in place afterwards.
- **Batch write-back is Stage 2**, but its two cheap prerequisites land now. Field scope settled:
  crew, dates, duration, locked, skip — **never sign-off, never task ticks**, because the
  planner's `inst`/`pm` are bare booleans and SharePoint holds the attribution.
- **`Planned` pools are badged, not hidden.** A PM choosing dates wants to see the collision; the
  reflow's own sweep is tenant-wide for the same reason.
- **The N/A label and progress bar disagree on purpose.** The label must agree with
  `Assignments.TasksComplete`, which counts genuinely-done only; the bar must reach 100% when
  everything is resolved.
- **D4 got a planner-side guard beyond the spec**, because the flow gap behind it is still open
  and would re-drift the field.
- **Hosting and billing deferred**, at Shane's call.

## Traps found

- **A test harness can go vacuous and nothing notices — four in one session.**
  `workcalendar.js` passed on a broken join (`0 spans checked`); `startdate.js` passed against a
  fully reverted fix; `empty.js` had no assertion and no non-zero exit, so a boot-time break
  passed the entire suite; and **`determinism.js` had reported `assignments compared : 0` ever
  since the planner stopped seeding demo pools**, while the repo described it as catching a real
  4-of-138 oscillation. All four fixed and each proven by mutating production code and watching
  the harness go red. Same drift class as `flows/definitions/`, the phantom `patched-tool/`, and
  the stale New Pool export.
- **CLAUDE.md contradicted itself on business rule 1** — "NOT ENFORCED ANYWHERE ON THE SHAREPOINT
  SIDE" in the business-rules section, against "the first thing in this system to enforce
  business rule 1" in the flow table 1400 lines later. Both written the same day. Rule 1 is
  detected nightly and never prevented.
- **The parity map's 41 line citations were ~17 lines stale** and the file had moved, while
  CLAUDE.md tells every session to read that map first.
- **Nothing pinned the `s.base` field scope.** Adding `inst`/`pm` to the baseline left all nine
  harnesses green — the exact widening that would let a write-back overwrite an attested
  sign-off. Now asserted.

## Open

- **Azure subscription does not exist.** Not client-gated (Shane has admin rights), but needs a
  payment method, and whose card decides who owns it.
- **Entra SPA registration** — does NOT need the subscription, and is the real unblock.
- **Capture a Graph payload before any mapping code.** Graph is a third field-shape surface.
- **`sharepoint/fix-job-startdates.js` not run** — human gate. It has `DRY_RUN = false`
  committed at line 37, so a paste is a live write; set it to `true` first.
- **The repaint has not been eyeballed by a human.** Verified by headless screenshot against a
  local server; screenshots sent.
- `TradeMismatch` still has no view. Crew-lead seats unbought. Phase F Day 2 training and the PM
  guide both still describe the surface H replaces.

## Next action

Register the Entra SPA app (no subscription needed), create the Azure subscription, then capture
a real Graph payload into `fixtures/planner/live-payloads-graph.json` before writing any mapping
code. Spec the batch write-back separately.
