# 2026-09-15b — the permission gate was stale, and the planner was telling users five untrue things

**Session goal:** pick up the 2026-09-15a next action. Test whether the `flows/pending/` permission
gate was still real, then rewrite the PM guide against the hosted planner. The gate turned out not to
exist, which cleared three carried items in about ten minutes. Writing the guide against the planner
then turned into the session's real find: reading it as a PM would surfaced five controls whose copy
described behaviour the code does not have.

Second half ran unattended on an approved plan, with a **morning demo** as the priority.

---

## What shipped

**1. The permission gate does not exist.** Four session logs carried "blocked on a permission gate"
from 2026-09-12 to 09-14. `edit_flow` applied first time. The signal that it had gone stale was
already in the record: two live flows were edited and published on 2026-09-15a with no gate, and
nobody connected the two. **A block carried forward is a claim, not evidence.**

| Carried item | Outcome |
|---|---|
| `D2 - Reschedule Pool` cursor fix | applied, published, verified both directions |
| `TradeMismatch` view | built as `Trade Mismatch`, verified both directions |
| "the dispatch filter change" | never specified anywhere; recorded closed |

**2. The reflow cursor fix is live.** A pinned row could drag the reflow cursor backwards, landing the
next unlocked row on top of work already placed. Verified on a throwaway `Planned` pool owned by D2
Bot, because a reflow with no out-of-order pin passes either way: the follower landed **2026-11-19**
with the fix and **2026-11-12** with the one expression reverted and everything else identical, then
11-19 again once re-applied.

**3. `Trade Mismatch` view.** Business rule 1 was enforced nightly and then read by nobody. Verified
by stamping a synthetic flag and clearing it, with an inverted control, since the view is empty in the
normal case.

**4. Five planner controls were corrected.** Three found while writing the guide, two closed on
Shane's approval because the guide is downstream of the planner: fix the behaviour and the trap entry
disappears rather than needing explaining.

| Control | Said | Actually did |
|---|---|---|
| `Save` tooltip | run `sharepoint/apply-planner-changes.js` | writes to SharePoint over Graph |
| `Delete` on Jobs | "Delete this job and its schedule?" | hides it locally; Refresh brings it back |
| `Refresh` dialog | "N pool(s) will be updated" | also discarded every unsaved edit, silently |
| `Start` on Jobs | an editable, inert `Jobs.StartDate` | disagreed with the span beside it |
| `+ Job` wait | "about 9 minutes, allow 10-15" | measured 16m 33s with a six-minute stall |

Plus the new **`Save + reflow`**, so editing a duration moves the rest of the pool instead of being a
two-step trap.

**5. `D2 - New Pool` refuses a concurrent duplicate.** The existing guard checks the Jobs list, which
covers a PM re-raising after the wait. It did not cover two requests in one trigger batch, where
`splitOn` makes concurrent runs that both check before either creates a Job. Now an **id tie-break**,
which has no race in it.

**6. Two reusable tools**, both needing no tenant access and no sign-in:
`tools/planner-shakedown.js` (real-browser smoke test, run before a demo) and
`tools/capture-planner-screens.js` (regenerates the guide figures).

**7. The hosted planner was redeployed** and the auth wall re-verified.

## Decisions

- **Test the gate rather than plan around it.** Ten minutes, three items cleared.
- **Never reflow-test on a client-visible pool.** `D2 - Reschedule Pool` emails
  `Jobs.ProjectManager` on completion, failure and conflict alike, and all four demo pools carry real
  client PMs. Test pools are `Planned` and owned by D2 Bot: invisible to dispatch, the summaries and
  Calendar Sync, so they strand no calendar events and raise no alerts.
- **Fix the planner before finalising the guide**, because three gotchas existed only as guide text.
- **Delete-from-planner deferred past the pilot.** Typing the job number twice on a separate site is
  the safety mechanism; moving it into the planner would undo it as real pool data arrives.
- **Guide sharing not chased**, since nothing goes to the client yet.

## Findings

- **A Note column cannot appear in an OData `$filter` at all**, so a CAML view is the only practical
  way to list `TradeMismatch` rows.
- **A Request-triggered flow is a generic SharePoint REST proxy**, better than the documented
  Recurrence-plus-`outputsLink` recipe because it needs no flow edit per query. `listCallbackUrl`
  returns the URL under `response.value`, not `value`.
- **The live PM guide's shared link serves a PINNED EARLIER VERSION**, so republishing it does not by
  itself change what the four client users see.
- **`/json/new` must be called with PUT**; a GET returns a deprecation notice as plain text that then
  fails to parse as JSON.
- **A `$filter` fails at RUN time, not save time**, and an over-tight one silently matches nothing, so
  every clause was proven live first: `ID lt 17` excludes row 17 itself, `Status ne 'Done'` drops the
  row the same query returns without it.
- **Deploying is part of fixing.** Six planner changes sat undeployed while the hosted site served the
  pre-fix build.
- **A bash heredoc eats a backslash level**, which broke `web/index.html` twice via `\n` in a JS
  string. Use a Python raw string, or build the newline another way.

## Files touched

`CLAUDE.md` · `web/index.html` · `fixtures/planner/rules.js` ·
`sharepoint/{provision-views,build-home-page}.js` ·
`tools/{planner-shakedown,capture-planner-screens}.js` (new) ·
`flows/exports/{D2-Reschedule-Pool,D2-New-Pool}-2026-09-15.json` · `flows/pending/` (deleted, applied)

## Commits

`2ba295b · e68f4f9 · 74447ed · bde07e1 · 2371dae · 15eed70 · 99189bb · 400811f · 5f6e38f` on
`canvas-app-handoff`. Gate: **15 harnesses green** (rules.js now 19 assertions),
`oracle-test.js` **15/16** (the documented data gap), **shakedown clean**, tenant audited back to
baseline (4 jobs, 184 assignments, 1180 tasks, no test litter in the request lists).

## Open

- **The hosted build is unverified behind the wall.** Anonymous requests never get past the 302, so
  "the new build is live" rests on the deploy CLI plus local verification. One sign-in settles it.
- **All four demo pools are `Active`, so the Commit button is not visible on any of them.** If the
  demo should show committing a pool, one needs setting back to `Planned` first.
- **The live guide's shared version is pinned.** Not chased, since nothing goes to the client yet.
- **Don:** trade mapping, the 11 field-supervision sub-phases, `@sub`, subcontractor emails. Until the
  first two land, Schedule Check shows 43 warnings on the demo data.
- **Subcontractor double-booking** still needs a per-crew capacity from Don. `Crews.Size` is unused.
- **Crew-lead accounts and Business Basic seats** unbought, so `Crews.LeadEmail` is blank.

## Next action

Sign in to the hosted planner and confirm the new build is serving, which is a minute and is the only
thing this session could not verify itself. Then, if the demo should include committing a pool, set
one demo pool back to `Planned`. Afterwards: exercise the planner against real use, and take the
deferred items (delete-from-planner, New Pool progress reporting) once the pilot shape is settled.
