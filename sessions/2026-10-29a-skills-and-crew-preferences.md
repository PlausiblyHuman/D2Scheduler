# 2026-10-29a: skills and crew preferences, built end to end

**Session goal:** design, plan and build item 2 of the 28 October list (skills and crew preferences), with the planner as the one place crews, skills and ratings are kept, subagent-driven with a reviewer per task and a whole-branch review at the end.

**Time:** 08:16–17:41 local, 7.50 h billable (D2)

**Files touched:**
- `docs/specs/2026-10-29-skills-and-crew-preferences-design.md`, `docs/superpowers/plans/2026-10-29-skills-and-crew-preferences.md` (spec and 15-task plan)
- `sharepoint/provision-preferences.js`, `sharepoint/stamp-preferences.js`, `sharepoint/gate-template-lists.js` (`--lists`), `tools/sp-proxy.js` (Preference and Members columns, backfill, the Trades/Crews/Crew-Trades gate)
- `flows/scripts/crew_sync.py` + test, `flows/exports/D2-Crew-Sync-2026-10-29.json` (flow 16, new)
- `flows/scripts/crew_trade_check_preferences.py` + test + `2026-10-29-crew-trade-check-preferences.py`, `flows/exports/D2-Crew-Trade-Check-2026-10-29.json`, `flows/exports/backups/D2-Crew-Trade-Check-pre-preferences.json` (flow 14 honours ratings)
- `web/graph-to-planner.js`, `web/writeback-core.js`, `web/graph-writeback.js`, `web/index.html` (read crews/skills/ratings; Crews tab editor; Save pushes crew changes; Auto-Schedule by rating with the Your call list; pickers grouped by rating; Schedule Check reasons; the failed-read guard)
- `fixtures/planner/crews-editor.js` (Parts A to F) and its three mutation files, `rules.js` + `rules.ratings-mutations.json`, `graph-read.js` + two mutation files, `escaping.js` (repaired and registered), `roundtrip.js`, `determinism.js`, re-anchored `inline-edit`, `board-controls`, `rejections`, `template-check` mutation files, `fixtures/planner/live-payloads-graph*.json` (crews and ct), `fixtures/planner/crew-capture.json`, `package.json`, `fixtures/planner/README.md`
- `tools/planner-shakedown.js` (Crews tab pass), `CLAUDE.md` (new section, anchored corrections)

**Commits:** 26ba45e spec and plan; 2fe55b5, 8d69555, a5dd493, 4bc364c, a0fd509, 7ecc054, 6b0d569 (Session 1: columns, fixture, gate, write-shape capture, Crew Sync); a9d93b8, 591b359, 3303766, cf516fe, cb89522, c0669f6 (mapper, core, Graph writer, planner read, Crews tab, Save); bbaedef (Auto-Schedule by rating); f6cdd86 (pickers and Schedule Check); 651bfc7, baf51bc (Crew Trade Check); ec83cc6, 92ec22a (shakedown and docs); 4086bd4, d3d1c76, 88744c5, ce8774d, 470ca86, 09ed751, 6978c98 (final review fix wave); bdc01d6 (live verification record)

**Verification:** `npm test` exit 0 (1,408 PASS, the known oracle line only); shakedown 56 PASS / 0 FAIL, console clean, schedule check on the demo data 0 errors / 86 warnings; every mutation file swept red (crews-editor 75 against index.html, core 14, Graph 11, rules ratings 7, rules 6, graph-read crews 14 and html 1, inline-edit 18, board-controls 31, rejections 33, template-check 12). Live: `D2 - Crew Sync` added a new crew code to the Assignments column within a minute; `D2 - Crew Trade Check` flagged exactly the three throwaway rows for a rating of Never per trade and kept them flagged for Never overall; the clear path was not re-verified (see below). Tenant read back at its baseline afterwards (38 projects, 1,746 assignments, 11,116 tasks, 14 crews, 26 trades, 51 Crew-Trades rows, column at 14 codes).

**Decisions made:**
- Earliest date wins; rating breaks the tie on the day; Auto-Schedule never waits for a better crew and lists where it settled.
- The Crews tab adds crews and never deletes; a crew is retired with an overall rating of Never.
- Click-to-cycle chips for ratings; 3 is first choice, 0 is never; only an overall 0 overrides scheduling.
- The Assignments crew dropdown and its validation formula are maintained by `D2 - Crew Sync` (union of existing choices and the Crews list; never removes a code), not by the planner.
- The planner is deployed once, after the whole-branch review and its fix wave.

**Open questions / blocked on:**
- The Static Web App deploy of 6978c98 (plus bdc01d6) is Shane's to run; then the tag `deploy/2026-10-29`, the wall checks, the served-file hashes and the hosted Crews tab checks (`+ Skill`, `+ Crew`, Save, Refresh, overall Never), and the two CLAUDE.md fill-ins.
- Every D2 flow is throttled for about 24 hours from 20:30 UTC today: four whole-list runs of `D2 - Crew Trade Check` exhausted D2 Bot's daily action allowance. Tonight's nightly runs will be slow. Verify whole-list flows on a disarmed copy filtered to the throwaway project from now on.
- The clear path of Crew Trade Check (a flagged row whose crew is qualified again) was not re-verified today; the mechanism is unchanged from 2026-09-11.
- Follow-ups recorded in the review: Crew Sync's bad-code guard is narrower than the spec's `[a-z0-9]` and its terminate message still says "shrunken"; duplicate Crew-Trades pairs and decimal ratings split the planner and the flow; inactive crews are qualified in the planner but not in the flow; an unassignable crew is selectable on a no-trade row; empty crew name or long Members are refused by Graph (HTTP 400) rather than locally; a failed post-Save reload leaves the crew baseline stale; a Part E scenario for a failed Save-time Crew-Trades read; five pre-branch stale mutation anchors (build-type 1, complete 3, graph-read.g2p 1); the guide needs a Crews tab section for the next major version.

**Next action:**
Shane runs the deploy block (CLAUDE.md, "THE HOSTED PLANNER WAS REDEPLOYED"); then tag, wall checks, served hashes, the hosted Crews tab checks with a throwaway skill and crew, the CLAUDE.md fill-ins, and delete the plan workspace.
