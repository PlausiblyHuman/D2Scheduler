# flows/ — Flow 3 ready to import

**Pattern shift this session:** stop hand-building flows in the PA designer. Author the
definition JSON offline (using Flow 1 & 2 exports as templates), then PUT it via the
Power Automate management REST API. What used to be 60–90 min of Chrome pixel-driving
becomes one PowerShell command.

## Layout

```
flows/
├── README.md                        ← you are here
├── exports/                         ← Get-AdminFlow dumps of live flows (VC + backup)
│   ├── D2-—-Daily-Dispatch-+-Reminders-2026-09-01.json
│   └── D2---Sign-off-Intake-2026-09-01.json
├── definitions/                     ← authored-here, imported-there flow bodies
│   └── D2-Event-Driven-Reconciliation.json      ← Flow 3, ready
├── scripts/
│   ├── Import-Flow.ps1              ← main: PUT a definition to an env
│   ├── Validate-Flow-Json.ps1       ← JSON + shape sanity check
│   ├── Test-Syntax.ps1              ← PS parser sanity check for the import script
│   └── Check-AuthModules.ps1        ← what's installed
└── manual-build/                    ← fallback when REST import doesn't work
    └── Flow3-checklist.md           ← copy-paste for the PA designer
```

## Run it (Flow 3)

Open a real interactive **pwsh** window (not from an agent-piped shell — see
CLAUDE.md and m365-interactive-auth) and:

```powershell
cd C:\src\D2Scheduler\flows\scripts
.\Import-Flow.ps1 -DefinitionPath ..\definitions\D2-Event-Driven-Reconciliation.json
```

Sign-in popup will land — pick **stratirus@d2pools.com** (per CLAUDE.md's PP Admin note).

Env, tenant, and connection-refs are hard-coded to the D2 Automation defaults in the
script; override with `-EnvId` / `-TenantId` if you ever repoint.

## What it does, in order

1. Preflight: `Microsoft.PowerApps.Administration.PowerShell` installed? Definition
   file parses? — abort if either fails.
2. `Add-PowerAppsAccount -TenantID f24d9b39...` — pinned per CLAUDE.md's cached-tenant
   gotcha.
3. `Get-JwtToken -Audience 'https://service.flow.microsoft.com/'` — grab the flow token.
4. Tenant guard: decode the JWT, verify `tid` matches D2's tenant — throw if not.
5. GET the target env — confirm it's D2 Automation and we have scope.
6. GET the env's connection list — warn (not fail) if any `connectionReference` in the
   definition isn't present yet.
7. PUT the definition to `api.flow.microsoft.com/.../flows/{new-GUID}?api-version=2016-11-01`.
8. Re-read the flow and echo back displayName + state + action count.
9. Print the make.powerautomate.com portal URL.

The flow imports **Stopped**. Turn it on in the portal after eyeballing trigger + connections.

## Expected happy path

Terminal prints (paraphrased):

```
Tenant OK: tid=f24d9b39-... as stratirus@d2pools.com
Env OK: D2 Automation (2710a01b-...)
  connection shared-sharepointonl-20b83f29... present
  connection shared-office365-0bc14d33... present
Definition OK: 'D2 - Event-Driven Reconciliation', connectionRefs = shared_sharepointonline, shared_office365
PUT flow <new-GUID> as 'D2 - Event-Driven Reconciliation' to env 2710a01b-...
PUT OK. Flow name (id): <new-GUID>
VERIFY:
  displayName: D2 - Event-Driven Reconciliation
  state:       Stopped
  actions:     11 (Initialize_touchedId, ..., Condition_conflict)
Portal URL:
  https://make.powerautomate.com/environments/2710a01b-.../flows/<new-GUID>/details
```

Then in the portal: open the flow, sanity-check the trigger (list should be
`Assignments`), sanity-check the trigger condition text, turn **On**, run the
Flow 3 exit-gate tests in `../D2-Week-2-Automations-Runbook.md`.

## If PUT fails

The PA management REST surface is undocumented in places. Likely failure modes:

| Symptom | Meaning | Fix |
|---|---|---|
| 400 `InvalidTrigger` / `UnknownOperationId` | `GetOnUpdatedItems` isn't the right trigger op | Try `OnUpdatedItems`; if still 400, use manual-build/Flow3-checklist.md |
| 400 on `connectionReferences` | Minimal ref shape (connectionName + id + tier) missing something the API requires | Copy the full ref block from `exports/D2---Sign-off-Intake-2026-09-01.json` |
| 403 Forbidden | Signed-in as an account without Environment Maker on D2 Automation | Sign in as stratirus@d2pools.com (per CLAUDE.md, D2PAdmin has returned 0 for Get-AdminFlow before) |
| 404 on env GET | EnvId typo, or account can't see D2 Automation from this tenant | Purge `%LOCALAPPDATA%\.IdentityService` and re-auth |

**Deterministic failure discipline (CLAUDE.md):** the PUT gets ONE attempt. If it
fails deterministically, hand off to the manual-build path — don't reach for a
variant script and call it a new attempt.

## After Flow 3 lands

- Export the newly-imported flow with `Get-AdminFlow` and save as
  `exports/D2---Event-Driven-Reconciliation-YYYY-MM-DD.json` for the version-control
  loop.
- Apply the same pattern to Flow 4 (Nightly Reconciliation) — draft a
  `definitions/D2-Nightly-Reconciliation.json`, run the same `Import-Flow.ps1` against it.
- Flow 5 (PDF Summary) will need a **new** connection reference for the OneDrive
  Convert-file action; note in the definition that Shane may need to create the
  OneDrive connection in the env first (empty error otherwise, per PA gotchas).

## Scoping decision documented here

**No native Teams post in Flow 3 MVP.** Daily Dispatch never wired a Teams
connection to the env — it's email-only. Flow 3 mirrors that: alert is a
Send Email V2 to the touched Job's PM (falling back to stratirus@d2pools.com if the
PM field is null). Native Teams channel + DM comes as a v1.1 add once we wire the
Teams connection to the env — costs zero to add to the definition JSON when we do.
