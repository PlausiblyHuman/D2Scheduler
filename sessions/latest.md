# 2026-10-01a: Spec A shipped; Don's 32-project load hit the scale limits

**Session goal:** work the 2026-09-28 queue (04:30 Calendar Sync check, guide v9, Spec A). The
morning check found Don had loaded 32 real projects at once the evening before, which moved Spec A
to the front and turned the afternoon into handling what that load broke.

**Time:** 08:39 to 19:10 local, 8.00 h billable (D2 bucket): 4.44 h hook clock + 3.50 h reviewed
gap (gaps 1-6 worked; 30 min of the 15:53-18:58 gap worked, the rest away). Not posted.
Tokens: 694 in / 148,210,993 cached / 2,680,516 cache-write / 312,435 out, 342 messages,
claude-opus-5-5, subagents 4 (7,166,815).

## What was found

- **Don raised 32 New Pool Requests in ten seconds** (2026-09-30 19:56 Central). The builds ran
  concurrently, throttled on D2 Bot's one request allowance, and were still running 20 hours later
  (1 done, 1 failed, 30 running at 15:00).
- **Counter Reconciliation failed at 03:30 with `ReadAtCap`** (Tasks read hit 5,000): the
  scale-piece-1 guard working, three months before the forecast.
- **The 04:30 Calendar Sync full sweep removed all 46 events, correctly**: Don had set `26- 2055`
  back to Planned, so nothing was Active.
- **New Pool's work-day loop timed out under the throttling** (`PT1H`; one iteration ran 5.6 h),
  and the flow then failed complete builds and emailed Don "URGENT: Pool build INCOMPLETE ... delete
  and re-enter". `25-2020 Occhipinti` failed; 11 more running builds had already flagged a short
  sub-phase and will fail the same way. Every sub-phase exists in those projects; one to three end a
  day short.
- **`26-2055` and `26- 2055` share an address** (1587 Glenellen Way): almost certainly one job
  entered twice.
- `az` had lost the D2 account; one interactive `az login` restored it for the whole day.

## What shipped

| Commit | Change |
|---|---|
| `4bea1cb`..`65687eb` | **Counter Reconciliation reads per live project** (Jobs `Status ne 'Complete'`, then per job its Assignments and an `or` chain of its Tasks). Disarmed copy over 34 projects, then verified both ways on throwaway rows; independent review, one Important fix (summary kept on a capped night). Live 14:48 and 15:01 |
| `f1a161b` | **Crew Trade Check, Conflict Flag and Reschedule Pool skip Complete projects**, each verified by a live run (34 projects, 991 assignments, none outside the live set) |
| `77a9173` | **Projects list in job-number order by default** (Don's request), Start date as an option on the Board and Jobs tab. Deployed `deploy/2026-10-01` |
| `296bba4` | Graph filtered-read capture (redacted): `$filter` on lookup ids works with no `Prefer` header; per-project Refresh 7.1 s vs 16.3 s |
| `8b97677`..`436fd94` | **Spec A planner work**: per-project Refresh and Save, Mark complete / Ready to complete / Completed projects / Open read-only / Reopen. Independent review: 2 Critical and 5 Important found and fixed. Activate and Back to planning now also stop with "Save first". Deployed `deploy/2026-10-01b` |
| `e09cf49` | **New Pool**: loop timeout `PT1H` to `P1D`; the short-span message and subject now say the project was built in full and to correct dates, not delete it. Applies to new requests only |
| `61a77f5` | Tabled "wait your turn" New Pool gate recorded in the Phase G backlog |

Emails sent from Shane's mailbox to Don: the `26-2055` duplicate question, and a heads-up to ignore
the "Pool build INCOMPLETE" emails and not delete or re-enter anything.

## Decisions made

- Spec A ahead of guide v9; the Counter Reconciliation rewrite shipped first, alone.
- Job-number order is the default on the Board, Jobs tab, Sign-Offs, pickers and dialogs; Crew
  Board, Dispatch, Schedule Check and Auto-Schedule keep their own order.
- Activate and Back to planning get the same "Save first" guard as Mark complete and Reopen.
- Trigger concurrency control on New Pool is not used (irreversible; a burst can drop requests).
- The "wait your turn" gate is tabled: Don's batch is a one-time event, but other clients need it
  before this solution is offered to them.
- Wait for the batch to clear overnight, then repair the failed projects in the morning.

## Open questions / blocked on

- 30 New Pool builds still running; about 12 will end Failed with a short sub-phase.
- Don's answer on `26-2055` / `26- 2055`.
- Spec A Task 11 live check (throwaway project) waits for New Pool to have capacity.
- Guide v9 still unpublished; the guide does not yet cover Mark complete, Completed projects or
  job-number order.
- Minor review findings deferred (in the plan ledger): Open makes "Live as of" look fresher;
  Rebuild-from-template and Set-all-durations still touch a read-only project locally; Jobs-tab
  inputs on a read-only project not visibly disabled; duplicate completed numbers act on the first.

## Next action

Check the batch finished and the 03:30 Counter Reconciliation run, then repair each failed
project (planner reset-from-start + Save, request set to Done) and draft Don a "sorted" note.
