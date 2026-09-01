# 2026-09-01b — Flow 3 REST-import wall; FlowAgent picked as forward path

## Session goal

Opened as: continue Flow 3 (Event-Driven Reconciliation) dev. Session pivoted
once the JSON-first authoring pattern collided with the wall that
`api.flow.microsoft.com` PATCH/PUT/publish is the wrong API surface for
solution-aware Dataverse flows. Rewrites goal to: prove out the wrong-path,
research the right-path, pick and document the forward tool. Flow 3 itself
still not running at close.

## What landed

**JSON-first authoring validated as a pattern.** `flows/definitions/D2-Event-Driven-Reconciliation.json`
authored offline using Flow 1 & 2 exports as templates. 11 actions,
correct env GUID, correct connection references (SP + Office 365 Outlook),
correct list GUIDs, trigger condition, coalesce on Job lookup ID naming.
JSON parses clean, PowerShell `ConvertFrom-Json -Depth 40` round-trips it.
This artifact is verbatim-reusable with FlowAgent next session.

**Three REST-import scripts + their failure modes documented.**
Import-Flow.ps1 (PUT), Patch-Flow.ps1 (PATCH), Publish-Flow.ps1 (POST /publish).
Each auth path works cleanly (`Add-PowerAppsAccount` + `Get-JwtToken` for
flow audience, JWT `tid` tenant-guard). Each definition-mutation endpoint
fails deterministically. Kept the scripts as archaeology for what NOT to try.

**Callback Registration workaround discovered but incomplete.** Fresh stubs
in Dataverse envs throw XrmApiRequestFailed on PATCH until enabled at least
once (Publish writes the Callback Registration rows XRM routes through).
Once enabled, PATCH returns 200 — but the change lands in the DRAFT slot
only, and the `/publish` endpoint doesn't exist to promote it. Cited
workaround for the first error class, not the second.

**FlowAgent is the forward pick.** `microsoft/power-platform-skills` on
GitHub, published Microsoft first-party, contains a `power-automate`
plugin whose MCP server (FlowAgent) exposes tools for reading, editing,
validating, publishing, and reading run history + per-action outputs. Runs
in Claude Code (not Cowork). MVP validated the design against Mariano
Gomez Bent's community.dynamics.com writeup shipping three production BC↔CE
integrations through it.

**PAC solution ALM held as fallback** for FlowAgent's ~5KB payload
truncation on big edits: `pac solution export/unpack/pack/import` + local
edit of `workflow.json`'s `clientdata`.

**Runbook + repo updated.** `D2-Week-2-Automations-Runbook.md` got a
build-path-shift callout at the top of Flow 3 section. `flows/README.md`
was written as the one-page ready-to-run before the wall was hit — will
need a follow-up rewrite next session to reflect the FlowAgent path.

**CLAUDE.md updated.** New "Flow authoring pattern — FlowAgent, not
api.flow.microsoft.com REST" callout under Known bugs and gotchas covering
all three failure modes verbatim, the three correct-path options ranked,
and the "solution-aware flows don't show in standard list" scope discipline.

**Stub flow in D2 Automation:** `2764968c-4aa6-f111-b8dd-6045bd0196b3`.
Currently in original state (trigger + one Compose placeholder) after Shane
accidentally discarded the PATCH draft during the new-designer stuck-toggle
episode. Reproducible in 30 sec once FlowAgent is up.

## Design decisions locked

- **REST-import pattern rejected.** api.flow.microsoft.com is runtime
  management, not definition mutation. Do not re-attempt from another angle.
- **FlowAgent chosen** for the tight iteration loop (agent reads real run
  outputs, self-diagnoses, patches, republishes).
- **Flow 3 alerts stay email-only for MVP** — Send Email V2 to the touched
  Job's PM, coalesced fallback to stratirus@d2pools.com. Teams native post +
  DM added as v1.1 once the shared_teams connection is wired to the env and
  the D2 Build Scheduler team + Field Dispatch/Ownership channels exist.
- **JSON authoring stays**, delivery mechanism changes. The definition JSON
  round-trips verbatim through FlowAgent.

## Files touched

- `CLAUDE.md` — added Flow authoring pattern callout with all three failure
  modes, three correct-path options, and scope discipline note
- `D2-Week-2-Automations-Runbook.md` — build-path-shift callout at top of
  Flow 3 section pointing at flows/definitions + flows/scripts + README; MVP
  scoping note on email-only alerts
- `flows/README.md` — new, one-page ready-to-run (references the failed
  path — will need FlowAgent rewrite next session)
- `flows/definitions/D2-Event-Driven-Reconciliation.json` — new, Flow 3
  body, 11 actions, JSON-valid
- `flows/scripts/Import-Flow.ps1` — new, PUT attempt (archaeology)
- `flows/scripts/Patch-Flow.ps1` — new, PATCH attempt (archaeology,
  landed the draft that got discarded)
- `flows/scripts/Publish-Flow.ps1` — new, POST /publish attempt (archaeology,
  endpoint doesn't exist)
- `flows/scripts/Validate-Flow-Json.ps1` — new, reusable JSON shape check
- `flows/scripts/Test-Syntax.ps1` — new, reusable PS syntax check
- `flows/scripts/Check-AuthModules.ps1` — new, prereq module check
- `flows/scripts/Check-JwtToken.ps1` — new, verifies Get-JwtToken export in
  Microsoft.PowerApps.Administration.PowerShell v2.0.217
- `flows/scripts/Grep-PluginSearch.ps1` — new, checked Cowork plugin registry
  for power-automate (miss — confirms plugin lives in Claude Code marketplace,
  not Cowork's)
- `flows/manual-build/Flow3-checklist.md` — new, fallback copy-paste for
  the designer if FlowAgent path stalls

## Commits

Rolling this session into one commit at close; last commit before today was
`0f06069` (yesterday's PM-seed fix).

## Open questions / blocked on

- **Flow 3 not yet running.** Stub exists with placeholder body.
- **Whether stratirus@d2pools.com has prvWrite/prvReadWrite on the Dataverse
  `workflow` entity.** The 403 on the connections-list preflight hints at
  scope gaps. Will be answered when FlowAgent's PATCH runs — if it also 403s,
  we need to grant workflow-entity permissions via a security role change,
  or use D2PAdmin.
- **Whether the `D2 Build Scheduler` Team + `Field Dispatch`/`Ownership`
  channels exist yet.** Shane can build them tomorrow if not.
- **shared_teams connection needs wiring to D2 Automation env** before Flow 3
  v1.1 (native Teams post/DM) can layer in. One-time from Connections UI as
  stratirus@d2pools.com.

## Next action

Fresh sit-down (Claude Code, not Cowork). Install the FlowAgent stack in
order: Node.js LTS → Azure CLI → Power Platform CLI → Claude Code CLI (via
VS Code extension; verify binary on PATH is the current one, not an older
standalone) → `claude plugin marketplace add microsoft/power-platform-skills`
→ `claude plugin install power-automate@power-platform-skills` → restart
Claude Code → run the plugin's setup skill → `az login --tenant
f24d9b39-6a71-4f4e-a376-03b6f61c97e4` as stratirus@d2pools.com. Then point
FlowAgent at `flows/definitions/D2-Event-Driven-Reconciliation.json` and
import into the existing stub (FlowId 2764968c-4aa6-f111-b8dd-6045bd0196b3).
Publish and run the exit-gate tests from the runbook.

After Flow 3 v1.0 lands, layer in Teams v1.1: verify/create the team +
channels, wire shared_teams connection to env, extend the definition JSON
with two Teams actions + a shared_teams connectionReference, FlowAgent-import.

Fallback path if FlowAgent stalls at any step: manual-build Flow 3 via
`flows/manual-build/Flow3-checklist.md` (~40 min in the designer using the
existing stub as scaffold).

Flow 4/5 come next after Flow 3 is live — same FlowAgent pattern, no
API-surface re-discovery.
