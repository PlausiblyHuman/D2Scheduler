# 2026-09-12b — Write-back Route A, header cleanup, and one pool-creation path

**Session goal:** continued from the overnight session. Registered the Entra app, built the batch
write-back Shane asked for, stripped the planner's vestigial controls, and collapsed pool creation
to a single path. Nothing was run against the live tenant.

---

## What shipped

**1. Entra app registration — created and consented tenant-wide.** `D2 Build Scheduler (planner)`,
client id `1aa00e61-e5e7-42bd-95b4-fd58863e5b54`, **SPA** platform (PKCE, no client secret exists),
delegated `Sites.ReadWrite.All`, `AllPrincipals`. Needs no Azure subscription. Delegated means the
app grants nothing itself — access is always the signed-in user's own SharePoint permission.

**2. Batch write-back, Route A.** A `Save` button produces a change-set file; the new
`sharepoint/apply-planner-changes.js` applies it from the console. Five safety properties, each
enforced in code and pinned by a test proven to fail: `DRY_RUN` defaults true; a five-column
allowlist; compare-before-write per field; a token-anchored row-identity check; and
`SuppressReconcileUntil` in the same MERGE.

**3. Header: eight buttons to four.** `⚡ Auto-Schedule · + Job · Save · Load from D2`. CSV, Backup,
Restore and Reset removed on Shane's call.

**4. One pool-creation path.** `+ Job` no longer builds a pool in the browser. It raises a
`New Pool Requests` row so `D2 - New Pool` does the building. Closes parity **D10** and the two
independent job-number generators.

## Files touched

`web/index.html` · `sharepoint/apply-planner-changes.js` (new) ·
`fixtures/planner/writeback.js` (new) · `docs/superpowers/specs/2026-09-12-batch-write-back-design.md` (new) ·
`flows/pending/reschedule-pool-cursor-fix.md` (new) · `CLAUDE.md` · four existing harnesses

## Commits

19 on `canvas-app-handoff`, `5c26e4a..c41947f`. Gate green throughout: 10 harnesses plus
`oracle-test.js` at 15/16, `determinism.js` at 138/STABLE.

---

## Decisions

- **Write-back is Route A first** (console paste), because the transport is the only part Route B
  changes. Isolating it makes B a swap rather than a rewrite.
- **Compare-before-write, not ETags.** `odata=nometadata` suppresses `odata.etag`, and more
  importantly five flows write to `Assignments` on schedules unrelated to the PM, so a row-level
  ETag would reject a whole batch because a nightly flow annotated the rows overnight.
- **Auto-Schedule cannot route through `Reschedule Requests`** — that flow moves dates and never
  picks a crew, so it would discard every crew decision the PM just made.
- **Backup and Restore pulled now rather than with Route B**, Shane's call, with the consequence
  stated: a pool sketched with `+ Job` and never pushed is unrecoverable if `localStorage` clears.
- **`AssignDefaultCrews` sent explicitly**, never defaulted.
- **Subcontractor sign-off stays PM-proxy.** Emailing external subcontractors is trivial; letting
  them sign off is not, and an anonymous link would degrade `InstallerSignOffBy` from a verified
  user to a typed name — the same reason MS Forms was ruled out.

## Traps found

- **FlowAgent keeps its own token cache and was pointed at the WRONG TENANT.** It reported
  `stalbot@stratirus.com` in Tennetech's tenant while `az` was on D2, both reporting success, with
  Tennetech's subscription as the az default. Editing from there would have modified another
  company's flows. Caught only because the flow-mechanics skill opens with an identity check.
- **A blank required field lands 201 over REST.** `ProjectManagerId` resolved from `currentuser`
  with no `r.ok` guard would have been silently dropped, and the PM would wait nine minutes for the
  flow to fail.
- **The row-identity guard didn't guard.** A substring match let a `2.1` edit land on a `2.10` row,
  proven by exploit test. Dormant only because the template tops out at `7.0`.
- **A test count is not coverage.** `writeback.js` opened at 29 assertions and a mutation sweep
  found 4 of 6 survived — the allowlist and the comparison were pinned, the write-side date
  handling, suppression lower bound, chunk loop and verify pass were not.

## Open

- **Blocked on a permission gate:** applying the `D2 - Reschedule Pool` cursor fix (validated by dry
  run, preserved in `flows/pending/`), the `TradeMismatch` view, and the dispatch filter change.
- **Blocked on ~1 minute:** whether D2's M365 billing is a Microsoft Customer Agreement, which
  decides if the Azure subscription needs a new card at all.
- **Blocked on ~30 seconds:** one MSAL sign-in to capture a Graph payload, which unblocks the read
  layer and lets Backup/Restore's replacement exist.
- **Blocked on Don, Monday:** trade mapping, the 11 field-supervision sub-phases, `@sub`, and the
  four subcontractor email addresses.
- **Deferred minor:** the `Jobs` and `New Pool Requests` reads sit outside the new try/catch, so a
  network failure there exits without a summary. Pre-existing shape, no writes have happened, no
  data lost.
- **Nothing in the write-back or the creation path has ever run against the tenant.**

## Next action

Resolve the permission question for live-tenant writes — either grant it or take console-paste
scripts. Then the Graph capture, which is the gate on everything hosting-related.
