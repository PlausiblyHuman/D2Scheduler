# 2026-09-02a — FlowAgent preflight; Flow 3 validates clean; Flow 1 crew-filter bug found

## Session goal

Opened as: execute last session's next action — stand up FlowAgent and import Flow 3
(Event-Driven Reconciliation) into the D2 Automation stub.

Actual outcome: FlowAgent is installed and working, but authenticated to the **wrong
tenant**, and the D2 login is interactive so it could not be completed from a background
session. Everything that could be done without a D2 token was done instead: the Flow 3
definition now validates clean against FlowAgent's rules, and a real production bug in
Flow 1 was found and documented. Flow 3 is still not imported.

## What landed

**FlowAgent stack confirmed working.** The `power-automate` plugin's MCP server is live in
Claude Code. `doctor` returns all-pass on Azure CLI, login, config dir, cloud resolution,
token acquisition, and identity match.

**Blocker: wrong tenant.** `az` is signed in as `stalbot@stratirus.com` in tenant
`20f64e0e-3117-4d74-a0e1-8cfd0fe6cba8` (Tennetech LLC). `list_environments` returns exactly
one environment — "Tennetech LLC (default)". D2 Automation is invisible. Critically,
`doctor` reports **all checks passing** in this state; the only warning is "no current
environment set". This is the same class of trap CLAUDE.md already documents for
`Add-PowerAppsAccount`, now repeating for `az`. Written up in CLAUDE.md.

**Flow 3 definition now validates clean.** `validate_flow` initially failed with three
`extra-authentication` errors. Fixed by stripping `"authentication":
"@parameters('$authentication')"` from all five action `inputs` blocks (the trigger's copy
is not flagged and was left in place). Re-validated: `{"valid": true}`.

The subtlety worth remembering: the **live** Flow 1 and Flow 2 exports carry that exact key
on every `OpenApiConnection` action. It is correct at runtime — the service writes it back
after creation — and invalid at authoring time. Stripping it and letting FlowAgent
auto-inject produces the same end state.

**Definition shape mismatch documented.** Our `flows/definitions/*.json` use the REST
envelope with everything under `properties`. FlowAgent's `create_flow`/`update_flow` want
`name`, `state`, `definition`, `connectionRefs` as four separate arguments. Mapping table
added to `flows/README.md`.

**Flow 3 field names verified offline against production.** Cross-checked the `$filter`
against the live Flow 1 export, which queries the same Assignments list (GUID
`49ef7006-…`): `ScheduledStart`, `ScheduledFinish`, `NotApplicable ne 1` and `Unlimited ne 1`
are all confirmed working in production. `Crew` is a **Text** column, so Flow 3's use of
`triggerOutputs()?['body/Crew']` as a plain string and `Crew eq '<name>'` in OData is
correct. `Job` is a Lookup and Flow 3 already coalesces the naming variants.

**OPEN BUG FOUND — Flow 1 sends empty dispatch tables.** Both `Filter_array` and
`Filter_array_2` in the live Daily Dispatch flow use:

```
@equals(item()?['Crew']?['Value'], items('Apply_to_each')?['Title'])
```

`Assignments.Crew` is Text, not a Lookup. On a string, `?['Value']` is null, so the
comparison never matches, every filter returns zero rows, and each crew's dispatch email
ships with an **empty assignment table**. The flow reports success and the mail arrives,
which is exactly why the 2026-09-01 "verified in prod" pass missed it — delivery was
checked, content was not.

Fix is one token in each of two actions: `item()?['Crew']`, no `?['Value']`. Not applied —
needs the same D2 tenant session as the Flow 3 import.

**Corrected an in-session false alarm.** Mid-session I flagged mojibake (`â` garbage) in the
Flow 3 email strings. That was wrong — the artifact was self-inflicted, from reading the
file with `json.load(open(...))` without `encoding='utf-8'`, which on Windows defaults to
cp1252. The file has always held correct UTF-8 (`⚠`, `→`, `–`). No such bug exists. Worth
recording because the same trap will fire on any future script that reads these files on
Windows without pinning the codec.

## Design decisions locked

- **Strip `authentication` from actions at authoring time**, keep it on the trigger, and let
  the Flow API write it back. Do not "fix" the exports to match.
- **Keep the REST-envelope shape** in `flows/definitions/*.json` and split on import. The
  envelope matches what `Get-AdminFlow` returns, which keeps definitions and exports
  comparable.
- **Flow 1's crew-filter fix rides along** with the Flow 3 FlowAgent session — same auth,
  same tool, one sitting.

## Files touched

- `CLAUDE.md` — three new Known-bugs entries: the Flow 1 crew-filter bug (with the stale
  docs that need fixing alongside it, and the wrong `$orderby` diagnosis it invalidates);
  the `az login` cached-tenant trap; the FlowAgent `authentication` / argument-shape rules
- `flows/README.md` — rewritten for the FlowAgent path; the REST scripts are relabelled
  archaeology with their individual failure modes; adds the envelope→argument mapping table,
  the tenant-pinned login step, and the validation notes
- `flows/definitions/D2-Event-Driven-Reconciliation.json` — removed `authentication` from
  the five action `inputs` blocks (5 lines, minimal diff, trigger untouched). Now validates
  clean.

## Open questions / blocked on

- **Flow 3 still not imported.** Definition is import-ready and validates clean; only the
  tenant token is missing.
- **`az login --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4` as `stratirus@d2pools.com`** is
  interactive and cannot be driven from a background session.
- **Whether `stratirus@d2pools.com` has write on the Dataverse `workflow` entity** — still
  unanswered, and still the next thing that could block. Will be revealed by the first
  `create_flow` / `update_flow`.
- **Teams v1.1** unchanged from last session: `shared_teams` connection still needs wiring
  to the env, and the team + channels may not exist yet.

## Next action

1. `az login --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4` — sign in as
   **stratirus@d2pools.com**.
2. FlowAgent `whoami` → confirm `tokenIdentity.tenantId` is `f24d9b39-…`, then
   `list_environments` → `set_current_env` on D2 Automation.
3. `preflight_flow` with the split definition, then `create_flow` (or `update_flow` against
   the existing stub `2764968c-4aa6-f111-b8dd-6045bd0196b3`), then `publish_flow`.
4. Run the Flow 3 exit-gate tests from `D2-Week-2-Automations-Runbook.md`.
5. **Same sitting:** fix Flow 1's two `Filter_array` expressions to `item()?['Crew']`,
   republish, and re-verify a dispatch email actually contains rows. Then correct the stale
   lookup-shape text in `D2-Week-2-Automations-Runbook.md` and the 08-26a session note.
6. Re-export both flows to `flows/exports/` once green.

Fallback if FlowAgent stalls: `flows/manual-build/Flow3-checklist.md` (~40 min in the
designer).
