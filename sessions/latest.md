# 2026-09-25a: the 24 September meeting turned into a proposal, then batch 1, backups and edit in place

**Session goal:** ingest the 24 September status meeting, propose a build for its scheduler items, and
build what Shane approved. Shipped in one day: batch 1 (seven changes), WP8 backups with a live
restore rehearsal, WP3-B edit in place, and the deletion of the four demo pools.

**Time:** 09:12–14:23 local, 2.75 h billable by the hook clock (D2 bucket, 15-min idle rule); the wall
clock was 5.2 h with no break, so the idle rule trimmed long tool waits. Shane picks the figure.

## What shipped

| Commit | Change |
|---|---|
| `960f870` | Meeting review list and the build proposal (`docs/superpowers/specs/2026-09-25-scheduler-build-proposal-design.md`) |
| `a3013fc` | Batch 1: board keeps vertical scroll, Crews tab chips, Building guard, Back to planning, project picker and Open schedule link, Live / Planned / Both filter, Day / Week / Month zoom, reset from a new start with `Jobs.StartDate` written back. Tag `deploy/2026-09-25` |
| `e54bf5d` | CLAUDE.md record of the meeting decisions and batch 1 |
| `9e70790` | WP8: `D2 - Snapshot` (03:00 Central, all 13 lists to Documents/Backups), `sharepoint/restore-project.js` (27 assertions, 13 mutations red), `D2BuildSchedulerFlows` solution exported, schema capture, `docs/restore-runbook.md` |
| `cb23d09` | WP8 close-out: live rehearsal record, flow exports regenerated with the snapshot flow |
| `aceaea0` | WP3-B: crew, days and start controls on every editable Board row, always visible (32 assertions, 11 mutations red); crew names escaped in eight places. Tag `deploy/2026-09-25b` |
| `762a02e` | Records |

Two deploys to the Static Web App, the wall re-checked after each. `npm test` 391 passes with the
documented oracle failure only; shakedown 44 passes, console clean.

**Tenant changes, all read back:** the four demo pools (`D2-1042` to `D2-1045`) deleted through
Delete Pool Requests and their 184 calendar events cleared over Graph; the tenant holds Don's two
projects (`26- 2055` Active, `26-2065` Planned, raised during the meeting), 92 assignments, 590 tasks,
46 calendar events. A throwaway `TEST-9600` was built, snapshotted, damaged in fifteen fields,
restored by the real script through the session proxy, and deleted; its request rows were removed.
The session proxy flow was deleted at the end.

## Decisions made

- Meeting outcomes as recorded in the proposal: "project" is the word (applied opportunistically);
  STL stays; Harrison and Campos come off; zero-day sub-phases approved on the fold-or-allow
  recommendation; B4 is a filtered Job Board, not a calendar tool; WP3-B controls always visible;
  the Backups folder is plain in the Documents library; backups before edit-in-place, test pools
  deleted first.
- WP5 answers, given by Shane on Don's behalf: an unreleased phase holds everything back, double
  bookings involving it are shown on screen and never emailed, release is by major phase only, a
  release-everything button stays. WP5 is Option B and now has what its spec needs.
- `26-2065 Brandon - Cross` was kept as a real job; the request rows for the deleted pools were left
  as history.
- The flows got their own solution rather than joining the canvas app's, because `deploy.py`
  re-imports that one on every app deploy.
- Dataverse: the solution container is free and done; moving the data is the Rev D migration at
  about $20 a user a month and is not warranted at 5 projects. Three cheaper scale steps named.

## Found

- Graph transcript access is disabled in the Tennetech tenant and the Loop notes file cannot be
  read headlessly; the Facilitator chat notes give the outline and Shane pasted the rundown (saved
  as a memory).
- The Gantt table is auto-layout: bar labels set column minimums, and hidden header rows must be
  `visibility:collapse`, not `display:none`, or the columns lose the cells that hold them open.
- FlowAgent `invoke_operation` reaches only dynamic resolvers; the proxy flow remains the headless
  SharePoint route. `az rest --body` with inline JSON is mangled through a Windows subprocess shell.
- Crew names were painted raw in eight places, including the drawer's own option lists.
- Entra's sign-in log for the 24th shows only Don, both sign-ins successful: the "sign-in bug"
  follow-up had nothing behind it.

## Open questions / blocked on

- The two new live writes from batch 1 and the inline controls have run against stubbed Graph and a
  local browser, not through a signed-in session on the hosted site.
- The client guide (Version 8) describes none of today's changes.
- Don's phase list (WP6), the six-trade coverage, the job numbering format, the fiberglass and
  construction phase lists, Amy's inspection list.
- Delete Pool does not snapshot before it deletes; the nightly snapshot and the recycle bin cover it.

## Next action

WP6 zero-day rows when Don's phase list arrives, then the WP5 spec from the answers in the proposal,
then the Delete Pool snapshot; before any of them, a signed-in pass over Back to planning, the
`StartDate` write and the inline controls on the hosted planner, and the client guide update.
