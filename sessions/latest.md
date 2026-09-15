# 2026-09-15a — the planner became the write surface, and the morning email noise stopped

**Session goal:** Shane's call at the outset — *"User-facing platform will be the planner.
SharePoint will support it on the back end, but all users will use the planner primarily. We need
to prepare for this to be fully live today."* Scoped to A+B+C: Save writes, `+ Job` creates,
Commit lands. All three built and the first two verified against the live tenant.

The session opened on a different plan (PM guide, blocked flow work) and pivoted twice: once on
Shane's platform decision, and once mid-triage when he found two flows spamming his inbox.

---

## What shipped

**1. Two live flows stopped emailing when they have nothing to say.** Triaged first, because a
noisy client-facing system on go-live week outranks a feature.

| Flow | Was | Now |
|---|---|---|
| `D2 - Calendar Sync` | 14/day, `Send_report` unconditional after `For_each_orphan` | `Condition_should_report` — the 04:30 full sweep, or a real change |
| `D2 — Daily Dispatch` | 7/day, five saying "No sub-phase scheduled today" | `Condition_has_content` — work today, or something outstanding |

~21 emails a morning carrying about two facts, now about three. **Neither reached the client**;
both go to `stratirus@d2pools.com` alone. Dispatch itself was never broken — `[no lead email]` is
designed behaviour while `Crews.LeadEmail` is blank.

**2. The planner writes to SharePoint over Graph.** Three new files: `web/writeback-core.js` (the
decisions — allowlist, per-field compare, row identity, suppression, create refusal; pure
functions), `web/graph-writeback.js` (Graph shapes only), and the planner wiring for Push, Commit
and `+ Job`. The console applier is **frozen, not retired**, guarded by an allowlist parity test.

**3. Verified live, reading rows back rather than trusting status codes.** A date push moved
`2026-09-22 → 2026-09-24` at site-local midnight. The refusal path fired per **field**:
`DurationDays` refused (`loaded 2, now 4, wanted 3`) while `Locked` landed on the same row in the
same pass. Flow 3 reached `Terminate_suppressed` with `Send_email_alert` skipped. Row 384 restored
exactly; tenant audited clean afterwards (4 jobs, 184 assignments, 0 drift).

**4. Chrome driven without the MCP.** The `chrome-devtools` server failed because Chrome was
already running and held the profile lock — second time that has cost a session. Worked around
with a second Chrome on a throwaway profile plus a zero-dependency CDP driver on Node 24's global
`WebSocket`.

## Decisions

- **The planner is the user-facing platform.** SharePoint stays the database and all fourteen
  flows stay the engine.
- **Phase E pilots on the planner surface**, confirmed at close.
- **Scope held to A+B+C.** Deleting a pool and raising a reflow stay in SharePoint; sign-off and
  task ticks must never become writable from the planner.
- **Email fixes before the feature**, on the reasoning that a noisy system on go-live week costs
  more than a day's delay on a feature.
- **Dispatch skips empty emails entirely**, rather than only while crews are unaddressed.
- **Probe the Graph write shapes before building on them**, rather than build-then-discover.

## Findings

- **Graph writes behave like raw REST for every column type we use.** Crucially a DateOnly column
  takes a bare `yyyy-MM-dd` and stores site-local midnight, so the 2026-09-03 off-by-one does not
  recur. This is why `FIELD_DEFS` carried over unchanged.
- **A Person column resolves through the User Information List, matched on the claims `Name`,
  never `EMail`.** D2 Bot's mail differs from its UPN, so an `EMail` match works for all four PMs
  and fails for exactly one user. `/me` is unavailable on a `Sites.ReadWrite.All` token, so the UPN
  comes from the MSAL account.
- **The first version of that resolver returned a SharePoint group**, because groups carry no
  `EMail` and `'' === ''` is true. Same silent-empty-join that once wrote `TradeMismatch` on 66
  correct rows.
- **`New Pool Requests.Title` holds the pool NAME, not the job number, and there is no `PoolName`
  column.** The plan had both wrong; reading the live columns caught it before any create.
- **A mojibake "bug" in the dispatch subject did not exist** — `python -m json.tool` decoded UTF-8
  as cp1252. Byte check showed a clean `0x2014`. Nearly reported as a live defect.
- **My own mutation sweep gave a confident wrong answer**, reporting a TypeError as "still
  passing" because it only looked for a FAIL line. A crash now counts as red.
- **A staleness assertion landed inside `runApply` instead of `partA`** and was unreachable dead
  code that passed silently — caught only because it printed nothing.
- **`get_run_history` was stale again**, showing no Flow 3 runs for ten minutes after two had
  demonstrably fired.

## Files touched

`web/{writeback-core,graph-writeback}.js` (new) · `web/index.html` ·
`fixtures/planner/{writeback-core,graph-write,writeback-parity}.js` (new) ·
`fixtures/planner/{mutate.py,writeback.js,README.md}` · `flows/scripts/export-flows.py` (new) ·
`flows/exports/{D2-Calendar-Sync,D2-Daily-Dispatch-Reminders}-2026-09-15.json` (new) ·
`docs/superpowers/specs/2026-09-15-planner-as-primary-write-path-design.md` (new) ·
`docs/superpowers/plans/2026-09-15-planner-primary-write-path.md` (new) · `CLAUDE.md`

## Commits

`e1c407e · dece434 · e8d4bb9 · 7538d25 · ae4c66a · c2a13b9 · 871c5ce · 867881c · 6232ea7 · a92aa7d`
on `canvas-app-handoff`, all pushed. Gate: **14 harnesses green**, `oracle-test.js` **15/16** (the
documented data gap). Every new assertion was watched failing against a deliberate mutation.

## Open

- **`+ Job` has never created a real pool**, deliberately — one live POST costs ~16 minutes and
  produces a fifth pool. Refusal and duplicate paths are proven.
- **The PM guide needs rewriting** against the hosted planner: it documents the SharePoint
  surface, understates New Pool at 10–15 minutes against a measured 16.5 with a six-minute stall,
  and knows nothing about Save, Commit or refusals.
- **The four PMs can reach a surface that now writes** and have not been told it exists. Whether to
  share the URL before the guide is reissued is unresolved.
- **A duration-only write leaves `ScheduledFinish` stale** — excluded from the allowlist as
  derived. Visible in the live test as a finish date before its own start.
- **The `flows/pending/` permission gate is probably stale.** Two live flows were edited and
  published today with no gate, so the Reschedule cursor fix, the `TradeMismatch` view and the
  dispatch filter are likely unblocked. Untested.
- **Daily email deep links** should ideally point at the planner, but it has no URL routing, so a
  link can only open it at the top rather than at a pool.
- **Phase F Day 2 training** still documents the SharePoint views.
- **Don:** trade mapping, the 11 field-supervision sub-phases, `@sub`, subcontractor emails — now
  with the plumbing-capacity finding as evidence, since only `harrison` and `stl` hold that trade.
- **Crew-lead accounts and Business Basic seats** unbought, which is why `Crews.LeadEmail` is blank
  and every dispatch lands on Shane.

## Next action

Test whether the `flows/pending/` permission gate is still real (ten minutes, likely clears three
carried items), then rewrite the PM guide against the hosted planner and hold it for Shane's
review before anything reaches the client.
