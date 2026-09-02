# flows/ — Flow 3 ready to import via FlowAgent

**Current pattern:** author the definition JSON offline (using the Flow 1 & 2 exports as
templates), then import it with **FlowAgent** — the MCP server from Microsoft's
`microsoft/power-platform-skills` plugin, running inside Claude Code.

**Superseded pattern (do not retry):** `PUT`/`PATCH` against
`api.flow.microsoft.com/.../flows/{id}`. That is the *runtime management* surface, not the
definition-mutation surface for solution-aware Dataverse flows. All three verbs fail
deterministically — see the "Flow authoring pattern" callout in `CLAUDE.md` for the exact
failure modes. The scripts under `scripts/` that use it are kept as archaeology only.

## Layout

```
flows/
├── README.md                        ← you are here
├── exports/                         ← Get-AdminFlow dumps of live flows (VC + backup)
│   ├── D2-—-Daily-Dispatch-+-Reminders-2026-09-01.json
│   └── D2---Sign-off-Intake-2026-09-01.json
├── definitions/                     ← authored-here, imported-there flow bodies
│   └── D2-Event-Driven-Reconciliation.json      ← Flow 3, validates clean
├── scripts/                         ← ARCHAEOLOGY: the failed REST path. Do not run.
│   ├── Import-Flow.ps1              ← PUT attempt   → 404 (route doesn't exist)
│   ├── Patch-Flow.ps1               ← PATCH attempt → lands in draft, unpublishable
│   ├── Publish-Flow.ps1             ← POST /publish → 404 (endpoint isn't real)
│   ├── Validate-Flow-Json.ps1       ← still useful: JSON + shape sanity check
│   ├── Test-Syntax.ps1              ← still useful: PS parser check
│   └── Check-AuthModules.ps1        ← still useful: what's installed
└── manual-build/                    ← fallback when FlowAgent stalls
    └── Flow3-checklist.md           ← copy-paste for the PA designer (~40 min)
```

## Definition file shape vs. what FlowAgent wants

The definition files here use the REST envelope — everything nested under `properties`:

```jsonc
{ "properties": { "displayName": …, "state": …, "definition": {…}, "connectionReferences": {…} } }
```

FlowAgent's `create_flow` / `update_flow` take those as **four separate arguments**. Map them:

| File path                            | FlowAgent argument |
| ------------------------------------ | ------------------ |
| `properties.displayName`             | `name`             |
| `properties.state`                   | `state`            |
| `properties.definition`              | `definition`       |
| `properties.connectionReferences`    | `connectionRefs`   |

## Import it (Flow 3)

### 1. Authenticate to the **D2** tenant

This is the step that bites. `az login` with no `--tenant` picks up whichever tenant was
used last (Tennetech, in Shane's case), and FlowAgent then reports exactly one
environment — "Tennetech LLC (default)" — with no error. D2 Automation is simply invisible.

```powershell
az login --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4
```

Sign in as **stratirus@d2pools.com** (the PP Admin identity in the D2 tenant).

Verify before going further — `whoami` must show tenant `f24d9b39-…`, and
`list_environments` must show **D2 Automation**:

```
flowagent: doctor          → all checks pass
flowagent: whoami          → tenantId f24d9b39-6a71-4f4e-a376-03b6f61c97e4
flowagent: list_environments
flowagent: set_current_env <D2 Automation env GUID>
```

### 2. Preflight, then create

```
flowagent: preflight_flow  (definition + connectionReferences from the table above)
flowagent: create_flow     name="D2 - Event-Driven Reconciliation" state=Stopped
flowagent: publish_flow
```

`preflight_flow` catches the three common blockers before anything is written: missing
`$authentication`, a broken connection reference, and solution-wrap
(`CannotStartUnpublishedSolutionFlow`).

### 3. If payloads get truncated

FlowAgent has a ~5KB practical payload ceiling on large edits. Fall back to PAC solution ALM:
`pac solution export` → `unpack` → edit `workflow.json`'s `clientdata` → `pack` → `import`.

## Validation notes (2026-09-02)

`validate_flow` on the Flow 3 body returns **`valid: true`** after one correction:

- **`authentication` must not appear in action `inputs`.** FlowAgent's rule
  `extra-authentication` rejects it — the Flow API injects it automatically on create.
  Note the live exports *do* carry `"authentication": "@parameters('$authentication')"` on
  every `OpenApiConnection` action, because the service writes it back after creation. So it
  is correct at runtime and wrong at authoring time. Strip it from actions before importing;
  the **trigger's** copy is not flagged and is left in place.

Field names in the Flow 3 `$filter` are cross-checked against the live Flow 1 export, which
queries the same Assignments list in production: `ScheduledStart`, `ScheduledFinish`,
`NotApplicable ne 1` and `Unlimited ne 1` are all confirmed working.

`Crew` on Assignments is a **Text** column (not a Lookup — there is no `CrewId`), so
`triggerOutputs()?['body/Crew']` is a plain string and `Crew eq '<name>'` is valid OData.
The join to the Crews list is `Title` string equality. See the schema callout in
`D2-Week-2-Automations-Runbook.md`.
