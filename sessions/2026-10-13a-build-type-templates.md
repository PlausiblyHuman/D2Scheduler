# 2026-10-13a — Gunite and Fiberglass build types

**Session goal:** Don's top priority from his ranking: PMs pick Gunite or Fiberglass when creating a
project, each project lays out from its own template, and the Phase Template tab can show either.
Projects in flight keep their type; changing a project's type after creation is out of scope. Also
closed the 2026-10-11 housekeeping (retroactive session log, `latest.md`, `master` fast-forwarded).

**Time:** 08:50 to 20:50 local, 7.00 h billable (D2, 6 blocks): 5.95 h Claude + 0.36 h reviewed gap + 0.00 h manual; three gaps reviewed as away; 2.75 h written off as Plumbline work logged under this cwd, 4.25 h to post. Tokens: 10,428 in / 262,192,873 cached / 7,287,508 cache-write / 817,522 out, 842 messages, fable-5-1 orchestrating with sonnet-5-5 / opus-5-5 / haiku-5-5 subagents (39 subagents, 54,136,658 tokens).

**What shipped (branch `canvas-app-handoff`, 29 commits `d8a360b`..`f26c3b3`, 61 files):**
- Spec `docs/specs/2026-10-13-build-type-templates-design.md`, plan `docs/plans/2026-10-13-build-type-templates.md` (15 tasks, all complete, subagent-driven, reviewed per task and whole-branch).
- Fiberglass template from Don's sheet: `tools/fiberglass-template.py` -> `data/fiberglass-template.json` (45 sub-phases, 248 tasks); seed generator takes a template and a build type; seed, provision and stamp scripts under `sharepoint/`.
- Tenant: `BuildType` Choice on Jobs, New Pool Requests, Sub-phase Template, Task Template; `PhaseName` on Sub-phase Template; per-type views; existing rows stamped Gunite; Fiberglass seeded (templates now 91 sub-phases / 543 tasks).
- `D2 - New Pool`: reads the request's build type, filters both template reads, task cap 1000 with a read-at-cap guard, writes `BuildType` on the Job; second push escapes quotes and backslashes in the three create bodies (a pre-existing defect the Fiberglass data surfaced). Exports `D2-New-Pool-2026-10-13.json` and `-2026-10-13b.json`, backups under `flows/exports/backups/`.
- Planner: `+ Job` radio, per-project `buildType`, both templates read from SharePoint on Refresh (`S.templates`, `S.templatesFrom`), layout from `templateFor(type)` with no Gunite fallback, Fiberglass chip, read-only Build phases tab with a type switch (nine edit functions and two rebuild buttons removed), re-layout when a project's type changes, stored per-browser template discarded on load. PM now reaches Save from `+ Job` (was dropped).
- Read paths: `web/graph-to-planner.js` and `sharepoint/export-to-planner.js` carry build type and templates; fixtures gained `spt`/`tpt`/`trades` via `capture-graph.js --merge`.
- Tests: `fixtures/planner/build-type.js` (52 assertions) and mutations, `build-type-scripts.js`, `merge-capture.test.js`, `graph-read.g2p-mutations.json`; the four New Pool structural tests now compare against the first export carrying their own change.

**Verified live:** TEST-9902 (old flow) 46/295; TEST-9903 and TEST-9904 (new flow, Gunite) 46/295; TEST-9901 Fiberglass failed on the `12-18"` title, partial pool deleted, escaping fix pushed, rebuilt: request 65 Done, 45 sub-phases, 248 tasks, Job `BuildType` Fiberglass, title stored verbatim. HEAD `web/` served locally and read live over Graph: 38 projects, templates 46/295 and 45/248, the Fiberglass project linked with 45 sections and the chip, Build phases tab read-only at 55/56 rows. Flow 3 stopped around the rebuild and restarted. All four throwaways deleted through Delete Pool Requests at the end; request rows removed.

**Decisions made (rulings from the SDD ledger, Shane's where noted):**
- Shane: option 1 for Fiberglass crews and trades (name-match to Gunite, 2-day durations); approach A; keep the current Gunite template (Rev3 later); subagents build, this session orchestrates.
- The two Phase 7s in Don's sheet merge into 7.1 to 7.7 (Startup renumbered 7.4 to 7.7); phase names from heading rows; punch-list note row dropped; text verbatim. 20 of 45 Fiberglass sub-phases are Unassigned (14 Fiberglass-only, 6 whose Gunite match is Unassigned).
- A stored per-browser `S.template` is discarded on load, not migrated (spec 5.2 said migrate): it was never authoritative and Refresh reloads both.
- Live template `Sequence` is the position 1..n; the CSV phase-hundreds scheme was never seeded.
- Backups go to `flows/exports/backups/`, outside the export glob, never overwritten.
- No-drift tests target the first export carrying their change, not the newest.
- TEST-9902 kept rather than deleted and rebuilt; all throwaways deleted together at the end.
- Deferred: `JobNumber` unescaped in New Pool (before the pilot); failure emails naming the type; a zero-row guard until a third type; tab/newline escaping.

**Deployed:** Shane ran the SWA deploy at about 20:45; wall checks pass anonymously (every path 302 to `/.auth/login/aad`, GitHub provider 404, `/auth-redirect.html` 200, all seven headers), the hosted page carries the new build (`templateFor` present, the template editors gone, Build phases copy) with a clean console; tag `deploy/2026-10-13` on `550617a` (`web/` identical to the reviewed `547db90`).

**Open questions / blocked on:**
- Don to hear: the Startup sub-phases renumbered to 7.4 to 7.7, and 20 Unassigned Fiberglass sub-phases need crews.
- Guide v9 still deferred (now also carries the build-type radio and the read-only Build phases tab).

**Next action:**
Brief Don on the Fiberglass template (7.4 to 7.7 renumbered, 20 sub-phases with no crew), then pick the next item from his ranking; escape `JobNumber` in New Pool before the pilot.
