# 2026-09-06a — Week 2 closed, canvas app unblocked, headless build loop proven

Spans 2026-09-05 into 09-06. Opened as "close out Week 2", became "Week 3 is buildable and
here is the loop". Five commits, `12e8e99` through `21e7680`.

## What landed

**Week 2 closed.** Reviewed the rendered summary output rather than run status, which is how
three defects surfaced in flows that had been green since they were built:

- **Weekly compliance counted work that had not finished yet.** A Friday 15:00 run with a
  Saturday `weekEnd` scored Friday and Saturday work as outstanding. It named
  `D2-1001 · 2.2 Steel Installation` as oldest outstanding while it was still two days from
  finishing. Same data now reports a true **33%**, not a false 22%.
- Neither summary set `$orderby`, so tables came out in list-ID order.
- The daily footer overstated its own compliance window by a day.

Fixed headless, published, verified by manual runs with the rendered HTML pulled back into
`flows/testdata/`. All six flows re-exported.

**M365 F1 does not include Power Apps or Power Automate.** CLAUDE.md had it as the ~$190/yr
frontline option with "seeded Power Apps + Teams". A crew lead on F1 could not open the app.
Business Basic is the verified floor, not a preference. Caught the day before the licensing
conversation with Don.

**Canvas app prerequisites cleared.** `Crews.LeadEmail` placeholders removed (all seven field
crews held the same unmatchable external UPN, which made the app look correct while showing
everyone Saul's work). 252 Tasks rows backfilled from the browser tool's template — the seed
had created **zero**, so 38 of 43 assignments had nothing to tick and the app's core screen
could not have been built. Now 282 tasks across all 43, counts matching their counters.

**Headless canvas build loop proven end to end.** A Today screen authored entirely in YAML,
deployed by CLI, rendering live SharePoint data. `python canvas-app/deploy.py` runs it:
pack → solution export → swap the `.msapp` in the zip → solution import → Studio publish.
Connections survive because they live in the `.msapr` residual, not the YAML.

**Week 3 formula review** — nine findings in `canvas-app/formula-review.md`, two of them
design gaps rather than formula bugs.

## Decisions made

- **Ryan is off the build; the canvas app stays with Stratirus.** The handoff contract becomes
  internal build guidance, and its §6a production-safety rules now bind us.
- **Build headless in YAML**, accepting that Microsoft documents it as unsupported. The
  fallback is cheap: the Power Fx is identical either way, so a break costs only time.
  Git Integration remains the supported alternative and is worth evaluating.
- **Business Basic, ~7 seats.** Lead with *identities*, not SKUs — no crew-lead account exists
  in the tenant at all, and that has lead time upstream of Week 4.
- **The nightly browser-tool → Lists sync is descoped from the pilot**, on the record. It does
  not exist, was in no runbook, and nothing was tracking it. Week 4 loads one pool by REST.
- **Teams deferred to post-pilot.** Its one material use case evaporated when F1 turned out
  not to include Power Apps.
- **TEST-900x stays** until just before the pilot; it is the only realistic test volume.
- **`cleanup.js` now removes Harrison `D2-1001` too**, which is no more real than the TEST
  rows. That disposes of three tracked defects at once.
- **`DurationDays` means work days**, not the inclusive calendar span.
- Flow 3 **stopped** for the build.

## Open / blocked on

- **Flow 2 never writes `InstallerSignOffBy`, so every sign-off is anonymous.** The staging
  contract claimed otherwise. Needs a sixth trigger parameter and a site-user lookup, since a
  Person column cannot be set by email. **Blocked on `az login`** — the `pac` sign-in revoked
  the token tenant-wide.
- **The spec has no PM-proxy path**, and `LeadEmail` is empty by design, so every user is a
  proxy today. Permanently required for the four `Unlimited` subcontractor crews.
- **Delegation**: `Tasks` is at 282 rows against a 500 default. One real pool is 295. Once
  breached, tasks vanish silently from the sign-off screen.
- **Wednesday with Don**: seven identities, Business Basic, PM on the first real pool, the 11
  Unassigned sub-phases and the 10 unmapped trades.
- Flow 3 gating still unresolved; needed before the app writes at volume.
- Commercial basis for this project is still recorded nowhere.

## Next action

Build the Tasks screen (282 real rows now exist), then the sign-off screen, then the proxy
picker. Fix Flow 2's `InstallerSignOffBy` first if `az login` is available, because it is
broken independently of the app.

**Rule to adopt before the app can write:** deploying untested Power Fx into the live client
tenant is acceptable only while the app is read-only. Write-path changes get tested against a
`TEST-900x` row, never Harrison.
