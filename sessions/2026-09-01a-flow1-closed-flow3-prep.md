# 2026-09-01a — Flow 1 closed in production, Flow 3 prepped

## Session goal

Opened as: verify Daily Dispatch on the fresh 6 AM run, export the flow ZIP,
update CLAUDE.md with last session's syntax gotchas. Scope expanded once ZIP
export via the PA UI turned out to be gone — pivoted to a PowerShell export
path, then rolled into Flow 3 (Event-Driven Reconciliation) prep.

## What landed

**Daily Dispatch verified in production.** Sep 1 05:59 AM scheduled run
Succeeded (20s), Apply-to-each ran 7 iterations, all 7 dispatch emails landed
in Shane's inbox (independent visual confirmation). Compose 2 fix from
2026-08-28b confirmed correct. Flow 1 fully closed.

**Both D2 flow definitions exported to `flows/exports/`.** PA UI Package(.zip)
button is gone as of 2026 — replaced with a Get-AdminFlow PowerShell pattern
that dumps `Internal.properties.definition` (full trigger + actions JSON).
Two files: `D2---Daily-Dispatch-+-Reminders-2026-09-01.json` (38.5 KB) and
`D2---Sign-off-Intake-2026-09-01.json` (21.8 KB). Version-control artifact,
not import-ready ZIP; if a flow gets nuked, rebuild from JSON.

**Auth gotchas resolved and documented:**
- `Add-PowerAppsAccount` silently picks cached tenant. First attempt landed
  in Tennetech LLC (Ryan's brand), `Get-AdminFlow` returned zero. Fix: pin
  `-TenantID f24d9b39-6a71-4f4e-a376-03b6f61c97e4` (D2 tenant).
- Sign-in account matters. `D2PAdmin` popup returned zero flows too;
  `stratirus@d2pools.com` works. Unclear whether D2PAdmin lacks PP Admin
  role or was a stale-cache side effect.
- Purge `%LOCALAPPDATA%\.IdentityService` at the start of the run to
  guarantee a fresh device-code request (per m365-interactive-auth skill).

**Jobs.ProjectManager column added** via SP REST from Chrome (stratirus@d2pools.com
session on netorgft15040037 tenant). Type User, Group D2, field ID
`90ec6a24-4631-4c6f-bc78-43549dc1c37d`. Verified by re-read per tenant-guard.
Rev D §04 called for it; original provisioning missed it.

**Schema divergence caught before Flow 3 build.** `Assignments` list has
`Crew` as **Text** not Lookup; there is no `CrewId`. Runbook's trigger
condition and collision-query filters both needed rewriting to use `body/Crew`.
Documented as a "Schema corrections" callout at the top of Flow 3 section
of D2-Week-2-Automations-Runbook.md.

## Design decisions locked for Flow 3

- **Trigger condition strategy:** field-diff (`Crew`, `ScheduledStart`,
  `DurationDays` — fire if any changed vs its `@odata.oldValue`, or if the
  row is new). Chose this over the EditFingerprint column approach to
  avoid schema churn.
- **Alert routing:** post to existing `Field Dispatch` Teams channel + DM
  the touched Job's ProjectManager.

## Files touched

- `CLAUDE.md` — added PA Expression syntax rules (bare vs `@{}` template),
  ZIP-export-is-gone / Get-AdminFlow pattern, and two auth gotchas
- `D2-Week-2-Automations-Runbook.md` — schema-corrections callout at top of
  Flow 3 section
- `flows/exports/D2---Daily-Dispatch-+-Reminders-2026-09-01.json` — new
- `flows/exports/D2---Sign-off-Intake-2026-09-01.json` — new

## Commits

Rolling this session into one commit at close; last commit before today was
`cd68c41` (Compose 2 fix, 2026-08-28b).

## Open questions / blocked on

- **Harrison Residence D2-1001 needs a PM value seeded** in Jobs.ProjectManager
  before Flow 3's DM step can resolve. Who is it — Amy Stevens, or someone
  else from the office team?
- Whether stratirus@d2pools.com or D2PAdmin holds PP Admin on D2 tenant.
  stratirus@d2pools.com demonstrably works for Get-AdminFlow; D2PAdmin's
  scope is unverified. Not blocking Flow 3 build but worth clarifying with
  David/Don if we ever want to hand off exports to another operator.

## Next action

Build Flow 3 (Event-Driven Reconciliation) in PA designer per the corrected
runbook section. Roughly 60–90 minutes of Chrome pixel-driving for ~10
actions (init vars, get item on Crews, condition on Unlimited, get items
overlap query, condition on length>0, get item on Jobs, Teams channel post,
Teams DM). Trigger condition and all field names already resolved.

Then test both branches per the runbook's exit gate:
1. Manually edit an Assignment's ScheduledStart → flow fires, reconciliation
   runs
2. Trigger a canvas-app sign-off (or Grid-view flip `InstallerSignOff = Yes`)
   → flow does NOT fire. Watch flow-run count to confirm no loop.
