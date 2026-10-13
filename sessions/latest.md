# 2026-10-11a — Stuck Reject fix; Don's template sheets reviewed

*Written 2026-10-13 from git, CLAUDE.md, the mail thread and the time log; the session closed without a log.*

**Session goal:** fix the "Save first" block Don reported on 2026-10-10 (no project would activate),
reply to him, and size the new requests in his email.

**Time:** 09:18 to 12:49 local. Hooks 1.81 h, billable 2.50 h (5 blocks); four gaps (10:30-10:48,
10:58-11:32, 11:53-12:26, 12:32-12:49) not yet reviewed, so billable is not final. Not posted.
Tokens: 284 in / 57,305,902 cached / 462,710 cache-write / 107,134 out, 140 messages, claude-opus-5-5, no subagents.

**Files touched:**
- `web/index.html` — Reject is offered only on a sign-off SharePoint holds; `hasUnsaved` no longer counts the comment queue; Mark complete still stops for an entry queued on its own project; the guard names project, sub-phase and start date
- `fixtures/planner/save-first.js` + mutations (new, 9 mutations red); `complete.mutations.json` and `rejections.mutations.json` re-anchored; `fixtures/planner/README.md`; `package.json` test script
- `CLAUDE.md` — "One stuck Reject blocked every Activate" section, Guide v9 deferral, the list of Don's new asks
- `sessions/2026-10-03a-…`, `sessions/2026-10-05a-…` — the two preceding sessions' logs, written retroactively
- `docs/2026-10-11-don-template-sheets-review.md` — new: the four workbooks against the 46-sub-phase template, problems to resolve, rough sizes

**Commits:**
- `24e943c` Save first no longer blocks on the comment queue; Reject only on a saved sign-off
- `21e2fd9` Review of Don's four build-phase sheets against the current template

**Shipped:** `deploy/2026-10-11`. Reply to Don sent 11:58 Central: the activate problem is fixed and
live, how to remove his stuck entry, and a request to rank the new items.

**Decisions made:**
- Guide v9 deferred to the next big release (Shane).
- The reply asks Don to rank the new items rather than committing to them; October had about 7 h
  left in the D2 bucket.
- Don's stuck entry stays in his browser until he removes it (sub-phase 7.0, Comments, remove); it no
  longer blocks anything.

**Open questions / blocked on:**
- Don's ranking of the new requests.
- The template work is bound by the review's open questions: numbering clashes, rows that are not
  tasks, no trade or crew on any row, missing durations, and whether the Gunite revision applies to
  new projects only.

**Next action:**
Don's ranking came back on 2026-10-13: working on, and swapping between, Gunite and Fiberglass
projects is his top priority. Design that first; the review doc holds the sheet analysis.
