# flows/ — Flow 3 ready to import via FlowAgent

**`definitions/` is HISTORICAL as of 2026-09-09, do not restore or reuse it.** It documents the
original authoring approach (write the definition offline, import with FlowAgent) but nothing
keeps it in sync with the flows as they change in the tenant, and the final whole-branch review
of the `Planned`-suppression / `D2 - Reschedule Pool` work found five of its files silently
missing every action a later session added. See the "`flows/definitions/` is HISTORICAL" entry
in `CLAUDE.md` for what was found and why. **`exports/` is the content-verified artifact.** To
restore or inspect any flow's real current shape, read the newest `exports/<Flow-Name>-*.json`
and verify it against a fresh `get_flow`, never `definitions/`.

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
├── definitions/                     ← HISTORICAL, do not restore from here (see above)
│   └── D2-Event-Driven-Reconciliation.json      ← Flow 3, validates clean at time of authoring
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

### 2. Preflight

```
flowagent: preflight_flow  (definition + connectionReferences from the table above)
```

Catches missing `$authentication`, broken connection refs, and solution-wrap before any write.
Flow 3 currently returns `overall: ready`, 2/2 connections Connected.

### 3. Write, then actually publish — these are two different things

**`update_flow` writes to the unpublished draft row, not the published one.** It returns 200
and bumps `lastModifiedTime`; `get_flow` reads the *published* row and shows no change. That
is expected, not a failure. See the draft-row callout in `CLAUDE.md`.

**`publish_flow` does not publish the definition** — it is enable/start only. Calling it on an
unpromoted flow gets you a *running* flow still executing the old published definition.

To promote the draft, use Dataverse `PublishXml` against the **`workflowEntityId`** (not the
flow resource ID):

```bash
az rest --method post \
  --url "https://org4ed2f722.crm.dynamics.com/api/data/v9.2/PublishXml" \
  --resource "https://org4ed2f722.crm.dynamics.com/" \
  --headers "Content-Type=application/json" \
  --body '{"ParameterXml":"<importexportxml><workflows><workflow>{2764968c-4aa6-f111-b8dd-6045bd0196b3}</workflow></workflows></importexportxml>"}'
```

To see the *real* error instead of a silent draft write, go through
`preview_update` → `update_flow` with the returned `previewToken`. That path attempts a
published update and surfaces the underlying Xrm error.

### 4. Current blocker

`PublishXml` rejects the promote with:

```
The API connection reference 'new_sharedsharepointonline_beb06' could not be found
for the operation 'Get_touched_assignment'.
```

Per-operation connection-reference binding, which the PA designer creates on Save. **Unblock
path:** open the flow in the designer — the draft already contains all 11 actions — confirm
the SharePoint and Office 365 connections, and Save. That both binds the references and
publishes. Then re-verify with `get_flow` and start it.

### 5. PAC solution ALM fallback — read this before reaching for it

Both D2 flows live in `Active Solution`, the **default** solution, which cannot be exported.
Using `pac solution export/unpack/pack/import` therefore requires first creating a custom
solution and adding the flow to it — a structural ALM change, not a drop-in workaround. Don't
do it without deciding that's the ALM posture you want.

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
