# The planner becomes the primary surface: write path design

**Date:** 2026-09-15
**Status:** approved in principle, not yet built
**Decision owner:** Shane Talbot
**Supersedes the "Route B" half of** `2026-09-12-batch-write-back-design.md`, which specced the
console-applier route and explicitly deferred the in-page connection until hosting existed.
Hosting now exists, so the deferred half is what this document covers.

---

## 1. The decision

D2's users work in the planner. SharePoint stays the database and all fourteen flows stay the
engine, but the planner is the surface people are trained on and open every day.

That is not true today. **The planner is read-only in practice for anyone who is not us.** Save
downloads a change-set file which a human then pastes into `sharepoint/apply-planner-changes.js`
on the SharePoint origin. That is a workable delivery tool. It is not a platform, and a PM cannot
run it.

**Scope for this spec is A, B and C:**

| | Gap | Closed by |
|---|---|---|
| **A** | Save writes nothing | push the change-set over Graph from the page |
| **B** | `+ Job` creates nothing | POST a New Pool Requests row over Graph |
| **C** | No way to commit a pool | PATCH `Jobs.Status` from Planned to Active |

**Deliberately out of scope**, and PMs continue to use SharePoint for them: deleting a pool
(`Delete Pool Requests`), raising a reflow (`Reschedule Requests`), and anything to do with
sign-off or task ticks. Sign-off in particular must never become writable from here, for the
reason recorded in `importFromD2`: the planner's `inst`/`pm` are bare booleans with no
attribution, timestamp or notes, while SharePoint holds `InstallerSignOffBy`/`On` and
`SignOffNotes`. Writing them back would replace an attested sign-off with a flag.

## 2. The structural constraint

From the hosted origin, **Graph is the only write route.** SharePoint REST does not serve CORS to
arbitrary origins, which is precisely why `apply-planner-changes.js` has to be a console paste on
the SharePoint origin. The Entra SPA app already holds delegated `Sites.ReadWrite.All`, consented
tenant wide, so the authorisation exists and needs nothing from anyone.

Delegated is the important word. The token carries the signed-in user's own SharePoint
permissions, so the planner can never reach anything that person could not already open. A PM in
the Members group gets Edit. The app grants nothing on its own.

## 3. What the probes established, 2026-09-15

Graph is a third field-shape surface alongside raw REST and the Power Automate connector, and this
project has lost six separate cycles to assuming one surface's shape carries to another. So the
write shapes were read off the live tenant before any code was written, on row 384
(`D2-1044 - 3.5 Bonding Grid Completion`, crew `subcon`, scheduled a week out).

**The probe was designed to be non-destructive**: every allowlist field was written back at its
current value, so a correct result changes no business data. Only `SuppressReconcileUntil` moved.
It came back `changedFields: ["SuppressReconcileUntil"]`, which is the whole result in one line.

`PATCH /sites/{siteId}/lists/{listId}/items/{id}/fields` returned 200.

| Column | Type | Sent | Stored |
|---|---|---|---|
| `Crew` | Choice | plain string `"subcon"` | unchanged |
| `ScheduledStart` | DateOnly | bare `"2026-09-22"` | `2026-09-22T05:00:00Z` |
| `DurationDays` | Number | `2` | unchanged |
| `Locked`, `NotApplicable` | Boolean | `false` | unchanged |
| `SuppressReconcileUntil` | DateTime | ISO string | stored, truncated to seconds |

**The headline is the DateOnly row.** A bare `yyyy-MM-dd` is interpreted in site-local time over
Graph exactly as it is over REST, storing local midnight. Had Graph read it as UTC midnight,
every write would have landed a day early and reprised the 2026-09-03 off-by-one that had to be
fixed across every list once already. It does not. This is the single most important fact in this
document and it is why `FIELD_DEFS`'s existing normalisation carries over unchanged rather than
needing a Graph variant.

### 3a. The Person column, which was the real unknown

`New Pool Requests.ProjectManager` is a Person column. Over REST the applier resolves it from
`/_api/web/currentuser` and sends a numeric site-user id, and it throws before the create loop
rather than send a blank, because a blank one lands 201 and then wastes sixteen minutes failing
inside `D2 - New Pool`.

Two findings:

- **`/me` is not available.** The token is scoped to `Sites.ReadWrite.All` alone, which cannot
  call `/me`. Identity must come from the **MSAL account object**, which already carries the UPN
  and costs no request and no extra scope.
- **The User Information List is readable over Graph** at
  `/sites/{siteId}/lists/User Information List/items`, 16 rows on this site, and it carries the
  mapping from claims identity to site-user id.

**Match on `Name`, never on `EMail`.** `Name` is the claims string `i:0#.f|membership|<upn>`. The
service account proves why this matters: D2 Bot's `EMail` is `d2bot@d2pools.com` while its UPN is
`stratirus@d2pools.com`. An `EMail` match works for all four PMs and fails for exactly one user,
which is the worst kind of bug. This is CLAUDE.md's standing "join on userPrincipalName, never
mail" rule appearing on a new surface.

**And the matcher must refuse to match on an empty value.** The first attempt at this resolver
returned site-user id 3, *"D2 Build Scheduler Owners"*, a SharePoint group. The list holds groups
and system principals as well as people, groups carry no `EMail`, and `'' === ''` is true, so the
first group won and the result looked confident. That is the same silent-empty-join that once
wrote `TradeMismatch` on 66 correctly-qualified rows. Resolution must yield **exactly one** match
or refuse outright.

Live values for reference: D2 Bot 7, David 13, Cody 14, Emon 15, Don 16.

## 4. Architecture

Three files, split on one question: **is this a decision about data, or about a surface?**

### `web/writeback-core.js` (new, UMD)

The surface-independent decisions, and the only place they live:

- `FIELD_DEFS` for the five allowlist columns (read accessor, equality, write normaliser)
- `titleMatches(title, jobno, num)`, token-anchored
- `jobKey(v)`, trimmed and lower-cased
- `suppressUntil(minutes)`
- `planEdits(changeSet, liveRowsById)` returning `{writes, refusals, errors}`
- `planCreates(creates, liveJobNumbers, pendingRequestNumbers)` returning `{creates, refusals}`

Pure functions, no I/O, no `fetch`. The harnesses test it directly, which is what makes the five
safety properties testable without a tenant.

### `web/graph-writeback.js` (new)

Graph-shaped I/O only: read assignments, PATCH an item's fields, POST a request row, PATCH a job's
status, and `resolveSiteUserId`. Separate from the core for the same reason `graph-to-planner.js`
is separate from `export-to-planner.js`: Graph and REST are read and written from different
runtimes, and keeping the surface mapping in its own file tested against a captured payload is the
discipline that stops a seventh shape trap.

### `web/index.html`

- **Save** keeps its existing preview, which is itself a safety property: the PM sees loaded value
  beside new value, per field, and a bare count is never enough. Its confirm button becomes
  **Push** when Graph mode is available and falls back to **Download change-set** when it is not,
  so the file route survives for `file://` and as a fallback.
- **A results dialog** after a push: written, refused and failed, per field, with the refusal
  reason in the form `{loaded, nowLive, wanted}`. A refusal nobody sees is silent data loss.
- **Commit** on Planned pools, on the Jobs tab.
- **Auto-refresh after a successful push**, which resets the baselines and picks up flow-side
  changes in the same step.

### The console applier is frozen, not retired

`sharepoint/apply-planner-changes.js` keeps working and keeps its own copies. It is a pasted file
and cannot `require` anything, so sharing code with it needs a build step that inlines the core,
which is not worth doing on the day we go live and would put the one verified write path under the
knife. Instead, **`fixtures/planner/writeback-parity.js` asserts the allowlist agrees across all
three places it now lives**: the planner's `WRITEBACK_FIELDS`, the core's `FIELD_DEFS`, and the
applier's `FIELD_DEFS`. That catches the drift that actually matters. Migrating or retiring the
applier is a later decision.

## 5. The five safety properties, and where each lives

Unchanged from the console applier. What changes is that they become testable in isolation.

1. **An allowlist of exactly five columns**: `Crew`, `ScheduledStart`, `DurationDays`, `Locked`,
   `NotApplicable`. `ScheduledFinish` is derived and never sent. Nothing on the Tasks list and no
   sign-off column is reachable from any path. In-page the allowlist is enforced twice: at
   construction, because `buildChangeSet` is already built from `WRITEBACK_FIELDS`, and again in
   `planEdits`.
2. **Compare-before-write, per field and not per row.** A row with two changed fields can have one
   refused and the other land. Deliberately not ETags: five flows write to `Assignments` on
   schedules unrelated to the PM (Calendar Sync hourly, Counter Reconciliation, Conflict Flag, Crew
   Trade Check, Event-Driven Reconciliation), so a row-level ETag would reject a whole batch
   because a nightly flow annotated the rows overnight.
3. **Row-identity check.** The live `Title` is verified against the change-set's `jobno` and `num`
   before any write, token-anchored, because a substring test once let a `2.1` edit land on a
   `2.10` row.
4. **`SuppressReconcileUntil` at +10 minutes in the same PATCH as the data**, exactly as
   `D2 - Reschedule Pool` does. A second write would re-trigger the flow it is suppressing.
5. **Refuse rather than guess.** Exactly one site-user match or abort before any create. A
   duplicate job number, checked against live `Jobs` **and** pending `New Pool Requests` rows with
   `Status` of `Requested` or `Building`, refuses the create.

## 6. Concurrency

Raised by Shane, and it splits into two halves.

**The half already solved:** two PMs editing the same pool collide only if they touch the *same
field* of the same row, because compare-before-write is per field. Everything else lands.

**The half that is not:** a PM who loaded at 09:00 and pushes at 16:00 is diffing against a stale
baseline, so their push generates refusals that look like failures rather than like staleness.
Mitigations, in order of value:

- **Auto-refresh after every successful push**, so the common case self-corrects.
- **A staleness warning in the Save preview** when the baseline was loaded **more than 4 hours ago
  or on an earlier calendar day**, naming the load time and offering to refresh first. Better than
  silently generating refusals. The threshold is deliberately generous: loading in the morning and
  pushing after lunch is normal PM behaviour and must not nag, while a baseline from yesterday is
  genuinely worth stopping for.
- **Refusals are surfaced, never swallowed**, with both values shown so the PM can see what
  somebody else did.

Not proposed: locking, or last-writer-wins. Locking needs a presence mechanism the static app
does not have, and last-writer-wins is precisely the behaviour compare-before-write exists to
prevent.

## 7. Testing

Offline, against fixtures, in the existing jsdom and node harnesses:

- `fixtures/planner/writeback-core.js` covering the five safety properties as pure functions.
- `fixtures/planner/graph-write.js` asserting the exact PATCH and POST bodies and URLs produced
  from a change-set plus the captured Graph payload. The equivalent of the read side's
  equivalence test.
- `fixtures/planner/writeback-parity.js` for allowlist agreement across the three copies.

**Every new assertion must be watched failing before it is trusted.** This repo has recorded four
vacuous harnesses and one vacuous assertion added as recently as yesterday. A mutation sweep of
`writeback.js` once found 4 of 6 mutations surviving at 29 assertions. Test count is not coverage.

What cannot be tested offline is whether Graph *accepts* the bodies, which is what section 3
settled by probe, and what a live push will confirm again.

## 8. Rollout

1. Build the core and its tests, then the Graph layer and its tests.
2. Wire Push behind the existing preview. Exercise it on a demo pool with a single field change,
   then deliberately provoke a refusal by changing a row in SharePoint after loading.
3. Wire Commit. It shows the pool's conflict count from the planner's own checker before
   committing, which is something SharePoint cannot do: `D2 - New Pool` assigns template default
   crews with no awareness of other pools, so **every new pool should be expected to arrive with
   conflicts**, and committing one without looking is how they reach crews.
4. Wire `+ Job` last, and **do not probe its create against the tenant**: a real POST sets
   `D2 - New Pool` running for about sixteen minutes and produces a real pool. Build it, exercise
   the dry-run and duplicate-refusal paths, and leave the first live create for when a fifth pool
   is actually wanted.

## 9. Known gaps this does not close

- **A duration write leaves `ScheduledFinish` stale**, because the allowlist excludes it as
  derived. Unchanged from the console applier. Related to the standing Phase G item about a
  duration edit reflowing the pool by itself.
- **`Jobs.StartDate` drift** is untouched. A reflow never writes it back.
- **Deleting a pool and raising a reflow** stay in SharePoint.
- **The PM guide** still documents the SharePoint surface and will be wrong the moment this lands.
