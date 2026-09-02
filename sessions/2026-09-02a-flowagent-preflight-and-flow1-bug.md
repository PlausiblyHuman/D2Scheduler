# 2026-09-02a — FlowAgent live on D2; draft-row mechanism solved; Flow 3 one Save from done

## Session goal

Execute last session's next action: stand up FlowAgent and import Flow 3 (Event-Driven
Reconciliation) into the D2 Automation stub.

Outcome: FlowAgent is authenticated and working against D2 Automation. Flow 3's full
definition is **written into the flow's unpublished draft row** and validates clean. It is
blocked one step short of published, on per-operation connection-reference binding, which the
PA designer resolves on Save. Along the way the **root cause of last session's entire REST
wall was identified** — it was never silent failure. Also found and documented a real
production bug in Flow 1.

## What landed

**FlowAgent authenticated to D2 Automation.** Env `2710a01b-6cfa-e820-b338-2286f2649300`.
Both required connections present and Connected: `shared-sharepointonl-20b83f29-…` and
`shared-office365-0bc14d33-…`.

**The `az` cached-tenant trap, and how it hides.** `az` was signed in as
`stalbot@stratirus.com` on the Tennetech tenant. In that state FlowAgent's `doctor` reports
**all checks passing** and `list_environments` returns exactly one environment, "Tennetech LLC
(default)". D2 Automation is simply invisible — no error anywhere. Same class as the
documented `Add-PowerAppsAccount` trap.

Two further gotchas on the way in:

- Plain `az login --tenant <d2>` in a browser silently reuses the signed-in Tennetech session
  and does not switch. `--use-device-code` forces explicit account selection and worked.
- After `az` switches, **FlowAgent still holds a stale token** and `doctor` reports
  `identity-match: fail`. `reconnect` clears the cache and re-acquires. Required, not optional.

**Flow 3 definition validates clean.** `validate_flow` initially failed with three
`extra-authentication` errors; fixed by stripping `authentication` from the five action
`inputs` blocks (trigger's left in place). `preflight_flow` then returned `overall: ready`,
2/2 connections Connected, no solution wrap.

The subtlety: the **live** Flow 1 and Flow 2 exports carry that key on every
`OpenApiConnection` action, because the service writes it back after creation. Correct at
runtime, invalid at authoring time.

**ROOT CAUSE FOUND — the draft-row mechanism. This resolves 2026-09-01b.** Solution-aware
flows have two rows, published and unpublished-draft. Definition writes through *any* PPAPI
surface — last session's REST `PATCH` and FlowAgent's `update_flow` alike — land in the
**draft**. `get_flow` reads the **published** row. So the write returns 200, bumps
`lastModifiedTime`, and looks like it did nothing.

It wasn't being ignored. It was landing somewhere we weren't looking. Last session's
"200-OK-but-silently-ignored" conclusion was wrong in its diagnosis, right in its symptom.

Proven three ways:
1. A deliberately tiny probe definition also failed to appear in `get_flow` — ruling out the
   suspected ~5KB payload cap.
2. `preview_update` correctly diffed the proposed change against live (`actions: +1`), proving
   FlowAgent reads live state accurately and the earlier write genuinely had not published.
3. Applying with the `previewToken` surfaced the real Xrm error naming the pending draft.

**The error that cracked it:**

```
XrmApiServerError 0x80040203: You are attempting to do a published update of publishable
component in an unmodified active context when there exists an unpublished active row.
Component Type: 29  Object Id: 2764968c-…  CurrentState=ActiveUnpublished
```

**Tooling semantics corrected.** `publish_flow` is enable/start only — it does **not** publish
the definition. Called on the unpromoted flow it started it while the published row was still
the placeholder `Compose`; the flow was stopped again immediately, so nothing was left running.
The real promote is Dataverse `PublishXml` against the `workflowEntityId`.

**Two IDs, both correct.** `523d99c0-bc2e-7819-5d96-6faab60734f1` is the ProcessSimple resource
ID (FlowAgent's `flow` argument). `2764968c-4aa6-f111-b8dd-6045bd0196b3` is the
`workflowEntityId` (Dataverse row, what `PublishXml` wants). Last session recorded the latter;
it was never wrong, just a different identifier.

**Flow 3 field names verified against production.** Cross-checked the `$filter` against the
live Flow 1 export, which queries the same Assignments list: `ScheduledStart`,
`ScheduledFinish`, `NotApplicable ne 1`, `Unlimited ne 1` all confirmed. `Crew` is a **Text**
column (no `CrewId`), so Flow 3's plain-string handling and `Crew eq '<name>'` OData are right.
`Job` is a Lookup and Flow 3 already coalesces the naming variants.

**OPEN BUG FOUND — Flow 1 sends empty dispatch tables.** Both `Filter_array` and
`Filter_array_2` in the live Daily Dispatch flow use:

```
@equals(item()?['Crew']?['Value'], items('Apply_to_each')?['Title'])
```

`Assignments.Crew` is Text. On a string, `?['Value']` is null, so the comparison never matches,
every filter returns zero rows, and each crew's dispatch email ships with an **empty assignment
table**. The flow reports success and the mail arrives — which is exactly why the 2026-09-01
"verified in prod" pass missed it. Delivery was checked; content was not.

Fix is one token in each of two actions: `item()?['Crew']`. Not applied — it needs the same
publish path Flow 3 is blocked on.

**In-session false alarm, corrected.** I flagged mojibake in the Flow 3 email strings. Wrong —
self-inflicted, from `json.load(open(...))` without `encoding='utf-8'`, which defaults to cp1252
on Windows. The file has always held correct UTF-8 (`⚠`, `→`, `–`). Recorded because the same
trap will fire on any future script reading these files on Windows without pinning the codec.

## Design decisions locked

- **Strip `authentication` from actions at authoring time**, keep the trigger's, let the Flow
  API write it back. Do not "fix" the exports to match.
- **`preview_update` + `previewToken` is the diagnostic path.** Plain `update_flow` hides real
  errors behind a successful draft write.
- **Do not use PAC solution ALM casually here.** Both flows are in `Active Solution` — the
  default solution, which cannot be exported. PAC would require creating a custom solution and
  moving the flow into it: a structural ALM change, deferred as Shane's call.
- **Flow 1's crew-filter fix rides with Flow 3's publish** — same blocker, same sitting.

## Files touched

- `CLAUDE.md` — Flow 1 crew-filter bug; the `az login` cached-tenant trap; FlowAgent's
  `authentication` rule and four-argument shape; and the new draft-row section covering the
  two-row model, `preview_update` as diagnostic, `publish_flow` ≠ publish, the `PublishXml`
  command, the two-IDs distinction, the open connection-reference blocker, and the
  default-solution constraint on PAC
- `flows/README.md` — rewritten for the FlowAgent path; REST scripts relabelled archaeology
  with individual failure modes; envelope→argument mapping table; tenant-pinned login;
  write-vs-publish section; current blocker and unblock path; PAC caveat
- `flows/definitions/D2-Event-Driven-Reconciliation.json` — removed `authentication` from the
  five action `inputs` blocks (5-line minimal diff, trigger untouched); validates clean
- `D2-Week-2-Automations-Runbook.md` — corrected 3 occurrences of the stale
  `item()?['Crew']?['Value']` lookup shape to `item()?['Crew']` (L74, L80, and L344 in the
  Flow 4 Select projection, which would have reproduced the same bug). Left
  `?['Job']?['Value']` alone — `Job` genuinely is a Lookup.
- `sessions/2026-08-26a-daily-dispatch-handoff.md` — deliberately **not** edited. Session logs
  are historical record, not instructions; the correction is captured in CLAUDE.md.

## State of the environment at close

- Flow 3 (`523d99c0-…`): **Stopped**, published row still the placeholder `Compose`, draft row
  holds the full 11-action Flow 3 definition. Returned to Stopped after the `publish_flow`
  experiment — nothing left running.
- Flow 1 and Flow 2: untouched, still Started.
- `az` default profile now holds the **D2** tenant, replacing Tennetech. Re-auth to Tennetech
  with a plain `az login` when the estimator work needs it.

## Open questions / blocked on

- **`PublishXml` blocks on per-operation connection-reference binding:**
  `The API connection reference 'new_sharedsharepointonline_beb06' could not be found for the
  operation 'Get_touched_assignment'.` The record exists and Flow 1 uses that exact logical name
  from the same solution, so this is binding, not a missing record. Fails identically whether
  the logical name is passed explicitly or left to the server.
- **`AZURE_CONFIG_DIR` tenant isolation** was chosen but could not be applied: FlowAgent runs as
  an already-started MCP server, so the variable must be set *before* Claude Code launches. Do
  it at the start of a fresh session if both tenants need to coexist.
- **Whether `stratirus@d2pools.com` has write on the Dataverse `workflow` entity** — answered
  yes, implicitly. Writes and `PublishXml` both reached validation rather than 403.

## Next action

1. **Open Flow 3 in the PA designer** (D2 Automation → the flow, or by ID `523d99c0-…`). The
   draft already contains all 11 actions. Confirm the SharePoint and Office 365 connections when
   prompted, then **Save**. That creates the per-operation connection-reference bindings and
   publishes in one move.
2. Verify with FlowAgent `get_flow` that `properties.definitionSummary.actions` now lists the
   full action set, not a lone `Compose`.
3. Start it, then run the Flow 3 exit-gate tests from `D2-Week-2-Automations-Runbook.md`.
4. **Same sitting:** fix Flow 1's two `Filter_array` expressions to `item()?['Crew']`, publish
   the same way, and re-verify a dispatch email actually contains rows this time.
5. Re-export both flows to `flows/exports/` once green.

If the designer Save also stalls, the remaining option is the custom-solution + PAC ALM route —
but that is an ALM posture decision, not a workaround.

Fallback for Flow 3 remains `flows/manual-build/Flow3-checklist.md` (~40 min), though the draft
being pre-populated should make that unnecessary.
