# 2026-09-14a — the planner is hosted, the write-back is proven, and a pool was born the right way

**Session goal:** stand the planner up on Azure, verify it signed in rather than by pipeline status,
then exercise the write-back and `+ Job` against the tenant for the first time. All of it done.
Continues `2026-09-13b`, which covered the overnight security review, the naming pass and the
Static Web Apps config.

---

## What shipped

**1. The planner is hosted.** `https://mango-sky-0d6904310.5.azurestaticapps.net` — Free tier,
`swa-d2-build-scheduler` in `rg-d2-build-scheduler`, D2's own subscription. Deployed with a
deployment token pulled on demand, so **no workflow file in this repo and no stored secret**.
`Microsoft.Web` had to be registered first (~60s).

**The wall was verified anonymously before anyone signed in.** Every path including a nonsense one
302s to `/.auth/login/aad`; the GitHub provider 404s; all seven security headers are live. The
`navigationFallback` bypass I flagged as most likely to fail did not happen.

**2. Verified signed in, against live data.** Both libraries load, `graphModeAvailable()` is true,
console clean at every level, and Refresh pulled 3 pools / 138 sub-phases / 47 sign-offs with the
Work Calendar arriving as a 210-entry Set. **The second sign-in is silent** — the wall establishes
an Entra session and MSAL completes with no prompt. The two first-time consent dialogs are a
**one-time admin event**; both grants read `AllPrincipals`, so the four PMs will see nothing.

**3. The write-back has run against the tenant.** All five safety properties demonstrated, including
the refusal path nobody had watched: on one row, `Crew` was written while `DurationDays` was refused
(`loaded 2, nowLive 4, wanted 3`). Compare-before-write is genuinely per **field**.
`SuppressReconcileUntil` proven by reading the flow's action list — `Terminate_suppressed`
succeeded, `Send_email_alert` skipped. The row was restored to its exact pre-test values.

**4. `D2-1045 Navarro Residence` — the first pool created the supported way**, end to end with no
REST hand-loading. 23 of 46 finished, 21 signed, 174/295 tasks, assigned to **David Taylor**, so all
four people with access now have a pool. Tenant now 4 jobs / 184 assignments / 1180 tasks.

## Decisions

- **Deployment token over an Azure DevOps pipeline**, for the first stand-up. The pipeline wants to
  commit a workflow file into this repo; the token route changes nothing here and stores no secret.
  The pipeline can be wired now that hosting is proven.
- **Hosting stayed on SWA Free**, per 09-13b. Nothing in the live verification changed that.
- **Navarro was created at its real start date** rather than created-then-reflowed, so it carries no
  `Jobs.StartDate` drift. Cheaper and cleaner for staging future pools.
- **The double-booking fix went through the write-back**, not a hand MERGE — it is the supported path
  and it carries the suppression window.

## Findings

- **`D2 - New Pool` can create business-rule-2 violations, and did.** It assigns the template
  `DefaultCrew` with no awareness of existing bookings; Navarro arrived with three cross-pool
  double-bookings of `harrison`. Consistent with the documented "detect, never prevent" grammar, but
  the first time it has been seen from the *supported creation path*. **Expect every new pool to
  arrive with conflicts.**
- **Only two crews hold `plumbing`** — `harrison` and `stl`. With harrison booked, the sole
  qualified alternative was the capacity-exempt subcontractor. A trade with one field crew plus one
  subcontractor has no slack; this belongs in Don's trade-mapping conversation.
- **Runtime was 16.5 minutes, not 9**, including a **six-minute stall** with counts frozen mid-run.
  The PM guide's "allow 10-15 minutes" understates it, and a stall must not trigger a re-raise.
- **A cry-wolf warning found only by running on live data:** the roster uses `'?'` for unknown crew
  members, and the shared-member check excluded `'+2'` but not `'?'`, reporting *"?, ? is on both
  Campos +2 and Harrison +2"*. Fixed; live warnings 41 -> 40.
- **The assertion pinning that fix was vacuous on the first attempt** and passed with the bug still
  in, because the scenario never put two crews on the same day. Rebuilt with the overlap plus a
  guard that the scenario is reached.
- **A third instance of a rename scoped by a grep:** the applier still printed *"Use Load from D2"*
  because the pass covered `web/` only. Found by reading live output, not code.

## Files touched

`web/index.html` · `web/staticwebapp.config.json` · `web/fonts.css` + `web/fonts/` (new) ·
`web/robots.txt` (new) · `fixtures/planner/escaping.js` (new) · `fixtures/planner/schedulecheck.js` ·
`fixtures/planner/{roundtrip,empty,graph-read,live-export}.js` + README ·
`sharepoint/{apply-planner-changes,export-to-planner}.js` · `CLAUDE.md`

## Commits

`c5c1758 · 6a2f0fe · ee6eb56 · bec6522 · e6c2f77 · 94d236c · 30dd059 · 64f1b7f · fcc05c9`
on `canvas-app-handoff`, all pushed. Gate: **12/12 harnesses**, `oracle-test.js` **15/16**.

## Open

- **The PM guide needs reissuing** — it understates the New Pool runtime, doesn't warn about the
  stall, and still describes the SharePoint surface that Phase H replaces.
- **Wire the Azure DevOps pipeline** now that hosting is proven, if the token route is not wanted
  long term.
- **Phase F Day 2 office training** still documents the SharePoint views.
- **A permission gate** still blocks the validated `D2 - Reschedule Pool` cursor fix in
  `flows/pending/`, the `TradeMismatch` view, and the dispatch filter.
- **Don:** trade mapping, the 11 field-supervision sub-phases, `@sub`, subcontractor emails — now
  with the plumbing-capacity finding as extra evidence.

## Next action

Reissue the PM guide against the hosted planner, correcting the New Pool runtime and adding the
stall warning, then decide whether Phase E pilots on this surface.
