# 2026-09-15b — the permission gate was stale, and the planner was telling users three untrue things

**Session goal:** pick up the 2026-09-15a next action. Test whether the `flows/pending/` permission
gate was still real, then rewrite the PM guide against the hosted planner. The gate turned out not to
exist, which cleared three carried items in about ten minutes and turned the session into the work
behind them.

**CHECKPOINT, written mid-session.** Shane went unattended with an approved plan for the rest, and is
demoing the planner in the morning. See "Next action" for what is running.

---

## What shipped

**1. The permission gate does not exist.** Four session logs carried "blocked on a permission gate"
from 2026-09-12 to 09-14. `edit_flow` applied first time. The signal that it had gone stale was
already in the record: two live flows were edited and published on 2026-09-15a with no gate, and
nobody connected the two. A block carried forward is a claim, not evidence.

| Carried item | Outcome |
|---|---|
| `D2 - Reschedule Pool` cursor fix | applied, published, verified both directions |
| `TradeMismatch` view | built as `Trade Mismatch`, verified both directions |
| "the dispatch filter change" | never specified anywhere; recorded closed |

**2. The reflow cursor fix is live.** `Set_cursor_pinned` took a pinned row's end unconditionally, so
a row pinned earlier than the rows before it dragged the cursor backwards and the next unlocked row
landed on top of work already placed. It now takes the later of the pin end and the running cursor.

Verified on a throwaway `Planned` pool owned by D2 Bot, because a reflow with no out-of-order pin
passes either way: the follower landed **2026-11-19** with the fix and **2026-11-12** with the one
expression reverted and everything else identical, then 11-19 again once re-applied. A client-visible
pool was deliberately not used, because the flow emails `Jobs.ProjectManager` and all four demo pools
now have real client PMs. Tenant audited back to baseline afterwards.

**3. `Trade Mismatch` view.** Business rule 1 was enforced nightly and then read by nobody. Verified
by stamping a synthetic flag and clearing it, with an inverted control, since the view is empty in the
normal case and an empty view proves nothing.

**4. Three planner controls described behaviour the code does not have.** Found by reading the planner
as a PM while writing the guide against it. The Save tooltip told every hosted user to run
`sharepoint/apply-planner-changes.js`; Delete offered to delete a pool it can only hide; Refresh
overwrote unsaved edits silently. All three fixed, each verified in a real browser over CDP.

**5. A planner-first PM guide draft**, private and separate from the live client guide, plus
`tools/capture-planner-screens.js` so its figures regenerate offline with no tenant access.

## Decisions

- **Test the gate rather than plan around it.** Ten minutes, and it cleared three items.
- **Never reflow-test on a client-visible pool.** `D2 - Reschedule Pool` emails the PM on completion,
  failure and conflict alike, and Reyes, Salcedo, Whitfield and Navarro all carry real client PMs now.
- **The guide is a hybrid because the system is.** Planner for reading the day, durations, Save,
  `+ Job` and Commit. SharePoint keeps rescheduling and pool removal. Phone app keeps sign-off.
- **Delete-from-planner is deferred past the pilot.** The two-key confirmation on a separate site is
  the safety mechanism; moving it into the planner would undo it exactly as real pool data arrives.
- **Order approved for the unattended run:** planner fixes, duplicate guard, guide, then exercise the
  planner on demo data. Guide sharing deliberately not chased, since nothing goes to the client yet.

## Findings

- **A Note column cannot appear in an OData `$filter` at all** (`400 ... cannot be used in the query
  filter expression`), so a CAML view is the only practical way to list `TradeMismatch` rows.
- **A Request-triggered flow is a generic SharePoint REST proxy**, and is better than the documented
  Recurrence-plus-`outputsLink` recipe because it needs no flow edit per query. `listCallbackUrl`
  returns the URL under `response.value`, not `value`. Delete the flow when done: while it exists it
  runs arbitrary REST as `stratirus@d2pools.com` behind a SAS URL.
- **The live PM guide's shared link serves a PINNED EARLIER VERSION**, so republishing it does not by
  itself change what the four client users see.
- **`/json/new` on the CDP HTTP endpoint must be called with PUT.** A GET returns a deprecation notice
  as plain text that then fails to parse as JSON, with a misleading error.
- **`D2 - New Pool` is measured at 16m 33s with a six-minute stall mid-run**, so the guide says 10 to
  20 minutes and says plainly not to re-raise the request.

## Files touched

`CLAUDE.md` · `sharepoint/{provision-views,build-home-page}.js` · `web/index.html` ·
`flows/exports/D2-Reschedule-Pool-2026-09-15.json` (new) · `flows/pending/` (deleted, applied) ·
`tools/capture-planner-screens.js` (new)

## Commits

`2ba295b · e68f4f9 · 74447ed · bde07e1 · 2371dae` on `canvas-app-handoff`, all pushed.
Gate: 15 harnesses green, `oracle-test.js` 15/16 (the documented data gap).

## Open

- **The live guide's shared version is pinned.** Not chased this session, since nothing goes to the
  client yet.
- **Don:** trade mapping, the 11 field-supervision sub-phases, `@sub`, subcontractor emails.
- **Subcontractor double-booking** still needs a per-crew capacity from Don. `Crews.Size` exists and
  is unused for it.
- **Crew-lead accounts and Business Basic seats** unbought, so `Crews.LeadEmail` is blank and every
  dispatch still lands on Shane.

## Next action

Running unattended, in this order, with the morning demo as the priority:

1. Two planner fixes: the Jobs tab showing the real first date rather than `Jobs.StartDate`, and a
   "reflow from here" action so editing a duration is not a two-step trap.
2. A duplicate guard in `D2 - New Pool`, so re-raising a request cannot build a pool twice.
3. Exercise the planner on the demo pools and fix what that turns up.
4. Bring the guide draft in line with the planner as it then behaves.
