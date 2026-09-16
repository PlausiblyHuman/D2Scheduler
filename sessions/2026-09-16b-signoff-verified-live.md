# 2026-09-16b — sign-off verified live, five gaps closed, guide brought into line

**Session goal:** resume after an unexpected reboot. Planned as three steps: fix a stale sign-off
tooltip, verify the planner's sign-off write against the real tenant, and write the morning's missing
log. Ran mostly unattended while Shane was remote. The live verification turned into the session: it
found four defects, and writing the guide against the fixed planner found a fifth.

## What shipped

| Commit | Change |
|---|---|
| `4c9513b` | INST/PM tooltips say what Save does in each mode (they still said "not saved back; the record is the field app"); Rebuild-from-template and Set-all-durations dialogs made truthful; `fixtures/planner/honest-copy.js` |
| `6c40607` | Counters recounted from what actually landed; planner Reopen now writes the same record as `D2 - Reopen Sign-off`; Save button and results stop saying "0 edits" / "Nothing needed saving" over real saves; `fixtures/planner/signoff-push.js` |
| `309e5da` | N/A asks for a reason, refuses a blank one, reads and writes `Tasks.Note` |
| `12ab5d2` | Sign-off locks the checklist (UI and core); results use words, not column names |

All four deployed to the hosted planner, with the auth wall re-checked after every deploy.

## Verified live, by reading rows back

Two throwaway `Planned` pools owned by D2 Bot, created through `+ Job` over Graph (its first live run)
and removed through `Delete Pool Requests`:

- **TEST-9401** (built 8m12s): sign-off with person and time, PM sign-off, ticks with attribution,
  N/A, two behind-the-back refusals, the open-task warning, Reopen, and 295/295 task ids matching the
  right SharePoint rows. Then the counter and Reopen fixes re-tested on the new build: `3/10` where the
  old code wrote `2`, and a Central-time reopen note naming who had signed.
- **TEST-9402** (built 9m45s): N/A reason refused blank, stored in `Note`, round-tripped on Refresh,
  cleared on un-N/A.
- Checklist lock checked read-only on a signed Whitfield sub-phase: 17 of 17 boxes disabled.

Tenant audited back to baseline: 4 jobs, 184 assignments, 1180 tasks, 4 real `New Pool Requests`
rows, 0 `Delete Pool Requests` rows.

## Also done

- **PM guide** (Version 9): Phase Template buttons, N/A reasons, checklist lock, reopen as a trace not
  an undo, the counted Save button, a "someone else got there first" trap.
- **Demo run sheet** (Version 7): un-ticking a saved sign-off is a reopen, not an undo; the sign-off
  talking point no longer claims open tasks block sign-off.
- `sessions/2026-09-16a-*` reconstructed from the morning's commits.
- `.playwright-mcp/` gitignored, since its snapshots capture live tenant data.

## Decisions

- **Live sign-off tests run on a throwaway `Planned` pool, never a demo pool.** A reopen leaves a
  permanent note and version history on a pool a client PM owns.
- **"The training document" was taken to be the planner-first PM guide** (`UoeNwV4i4EQQaQgSuJCqiJ`),
  not the older client guide `a84a2e1a`, which stays untouched per CLAUDE.md.
- **The checklist lock and N/A reason were built rather than documented as gaps**, because both are
  decided business rules, the guide already promised them, and the pilot runs on the planner.

## Findings worth keeping

- The Playwright MCP profile still held a D2 session, so both sign-ins completed unattended. The
  morning's "needs an interactive sign-in" limit was not real. Check that profile first.
- `D2 - New Pool` ran in 8-10 minutes both times today, against 16m33s on 2026-09-14.
- The `Edit` tool rewrites `web/index.html` as CRLF in the working copy, and a bash heredoc eats
  backslashes. Both are in CLAUDE.md now.

## Open

- **The client guide `a84a2e1a`** still describes the SharePoint surface and serves a pinned version.
  Reissuing it is Shane's call.
- **Don:** trade mapping, the 11 field-supervision sub-phases, `@sub`, subcontractor emails and
  capacities.
- **Crew-lead accounts and Business Basic seats** unbought.

## Next action

Read the updated PM guide, then decide whether it replaces the client guide before the pilot.
