# 2026-10-03a — New Pool missing sub-phases, repaired

*Written 2026-10-11 from git, CLAUDE.md and the time log; the session closed without a log.*

**Session goal:** check that Don's 32-project batch had finished, repair the projects that failed, and
stop `D2 - New Pool` failing that way again.

**Time:** 09:44–10:35 local, 1.00 h billable (D2): 0.86 h hooks, no gaps. Posted.
Tokens: 264 in / 43,248,651 cached / 396,480 cache-write / 94,551 out, 130 messages, claude-opus-5-5, no subagents.

**What was found:** all 32 builds finished by 10-02 17:38 UTC, 16 Done and 16 Failed. The 10-01 reading
(complete builds, a few sub-phases a day short) was wrong: on a short span New Pool skipped the
sub-phase outright, so **28 sub-phases and 144 tasks had never been created**. Found by measuring a
planned planner-side fix against live data first (0 drifted rows in 1,536), which disproved it.

**Files touched:**
- `flows/scripts/new_pool_always_create.py`, `2026-10-03-new-pool-always-create.py`, `test_new_pool_always_create.py` — the flow change, its applier and its test
- `flows/exports/D2-New-Pool-2026-10-03.json` — export after the change
- `CLAUDE.md` — "28 SUB-PHASES WERE NEVER CREATED", and the live test

**Commits:**
- `cf8eba0` New Pool always creates every sub-phase; record the 28 missing sub-phases and their repair
- `876692c` Record the live New Pool test after the always-create change

**Tenant:** 28 Assignments and 144 Tasks inserted through a temporary proxy flow (deleted after), each
body cross-checked against a project that built correctly; 16 projects reflowed and saved (373
sub-phases, 0 refused); 16 request rows set to Done; `TEST-9800` built and removed. Read-back: 34
projects, 1,564 assignments, 10,030 tasks, 0 orphans.

**Decisions made:**
- The planner-side stale-finish change was discarded once live data showed it would correct nothing.

**Open questions / blocked on:**
- Note to Don that the projects are sorted (sent 2026-10-05).

**Next action:**
Spec A Task 11 live check on a throwaway project.
