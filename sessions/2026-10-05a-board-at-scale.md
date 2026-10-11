# 2026-10-05a — Board at Don's scale, Spec A verified live

*Written 2026-10-11 from git, CLAUDE.md and the time log; the session closed without a log.*

**Session goal:** finish Spec A (Task 11 live check) and make the Job Board usable on Don's 34 projects.

**Time:** 09:26–16:50 local. Hooks 1.83 h; three gaps (09:37–12:27, 12:38–12:54, 14:16–16:43) not yet
reviewed, so billable is not final. Not posted.
Tokens: 458 in / 89,859,303 cached / 1,378,125 cache-write / 175,461 out, 227 messages, claude-opus-5-5, no subagents.

**Files touched:**
- `web/index.html` — rows draw crew, days and start as buttons and open live controls on click; the Board axis spans only the projects shown; Schedule Check collapsed and grouped by root cause; three crew-name escaping gaps closed
- `fixtures/planner/inline-edit.js` + mutations, new `fixtures/planner/check-groups.js` + mutations
- `tools/planner-shakedown.js`, `tools/capture-planner-drawers.js` — new figures
- `CLAUDE.md` — Board speed, the Playwright MCP 25x timing trap, stale mutation anchors, Task 11

**Commits:**
- `77444eb` Job Board: inline edit opens on click, timeline spans the projects shown
- `1ce387f` Schedule Check: collapsed by default, one line per root cause with a fix
- `1678554` Capture tool: Schedule Check, inline edit, ready banner, Completed projects, read-only figures
- `acbfd62` CLAUDE.md: Board speed at Don's scale, grouped Schedule Check, MCP browser timing trap, stale mutation anchors
- `7376fae` CLAUDE.md: Spec A Task 11 verified live on TEST-9900

**Shipped:** `deploy/2026-10-05`. Board redraw 2.9 s to 0.52 s on 34 projects; Schedule Check 1,679
findings to 37 lines.

**Tenant:** `TEST-9900` built, taken through sign-off, Activate, Mark complete, Open, Reopen and
Mark complete again, then deleted; tenant read back at 34 / 1,564 / 10,030.

**Decisions made:**
- Shane sent Don the "all 34 jobs are sorted" note (12:36).

**Open questions / blocked on:**
- Guide v9 started at the end of the session, then deferred on 2026-10-11 to the next big release.
- The five commits were not pushed until 2026-10-11.

**Next action:**
Guide v9 (since deferred).
