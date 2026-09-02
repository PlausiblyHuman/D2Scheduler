# 2026-09-02a — Flow 3 PUBLISHED and running; draft-row mechanism solved; Flow 1 fix staged

## Session goal

Execute last session's next action: stand up FlowAgent and import Flow 3 (Event-Driven
Reconciliation) into the D2 Automation stub.

**Flow 3 is live.** Published, Started, definition verified in the published row. The root
cause of last session's entire REST wall was identified and is no longer a mystery. A real
defect in the hand-authored definition (`splitOn`) was caught before it reached dispatch. A
separate production bug in Flow 1 was found, fixed, preview-verified — and blocked at the
final write by the permission classifier, so it is staged rather than applied.

## What landed

**Flow 3 is published and Started.** Flow ID `523d99c0-bc2e-7819-5d96-6faab60734f1`, env
`2710a01b-6cfa-e820-b338-2286f2649300`. Published row verified to contain all 11 actions, the
trigger condition, and `splitOn`.

**ROOT CAUSE FOUND — the draft-row mechanism. This resolves 2026-09-01b.** Solution-aware flows
have two rows, published and unpublished-draft. Definition writes through *any* PPAPI surface —
last session's REST `PATCH` and FlowAgent's `update_flow` alike — land in the **draft**.
`get_flow` reads the **published** row. So the write returns 200, bumps `lastModifiedTime`, and
looks like it did nothing.

It was never being ignored. It was landing somewhere we weren't looking. Last session's
"200-OK-but-silently-ignored" was right about the symptom and wrong about the cause.

Proven three ways:
1. A deliberately tiny probe definition also failed to appear in `get_flow` — ruling out the
   suspected ~5KB payload cap.
2. `preview_update` correctly diffed the proposal against live (`actions: +1`), proving
   FlowAgent reads live state accurately and the earlier write genuinely had not published.
3. Applying with `previewToken` surfaced the real Xrm error naming the pending draft:
   `0x80040203 … Component Type: 29, Object Id: 2764968c-…, CurrentState=ActiveUnpublished`.

**The publish path, end to end.** `PublishXml` initially failed on per-operation
connection-reference binding (`'new_sharedsharepointonline_beb06' could not be found for the
operation 'Get_touched_assignment'`). Shane opened the flow in the designer — the draft already
contained all 11 actions — confirmed the connections, saved, and published.

**That designer Save then unblocked the fully programmatic path.** A subsequent
`update_flow` + `PublishXml` round trip succeeded with no UI at all. The bindings only need to
be created once; after that the loop is scriptable. **This is the repeatable pattern for Flows
4 and 5.**

**BUG CAUGHT — missing `splitOn`.** The hand-authored definition omitted the trigger's
`splitOn`. `GetOnUpdatedItems` returns `{value:[...]}`, so without it every `body/*` field is
null. Confirmed empirically: the single run that fired during a brief Started window failed at
`Initialize_startDate` with

> `The template language function 'formatDateTime' expects its first parameter to be of type
> string. The provided value is of type 'Null'.`

`Initialize_touchedId` and `Initialize_touchedCrew` both reported **Succeeded** and masked it —
a null integer initialises fine, and `touchedCrew` used `coalesce(..., '')`. Only the third
variable, which calls `formatDateTime` on a raw value, surfaced it. Worth remembering: in a
chain of variable initialisations, the first action to *fail* is not necessarily the first
action to be *wrong*.

`splitOn` added to the definition file and published; verified present in the published row
alongside the trigger condition.

**Tooling semantics corrected.**
- `publish_flow` is **enable/start only** — it does not publish a definition. Called on the
  unpromoted flow it started it while the published row was still the placeholder.
- Dataverse `PublishXml` against the **`workflowEntityId`** is the real promote.
- `preview_update` + `previewToken` is the **diagnostic path**; plain `update_flow` hides real
  errors behind a successful draft write.
- `update_flow` will not accept `connectionRefs` without `definition` (500 `ArgumentNullException`).

**Two IDs, both correct.** `523d99c0-…` is the ProcessSimple resource ID (FlowAgent's `flow`
argument); `2764968c-…` is the `workflowEntityId` (Dataverse row, what `PublishXml` wants). Last
session recorded the latter — never wrong, just a different identifier.

**Auth: the `az` cached-tenant trap.** `az` was signed in on the Tennetech tenant. In that state
FlowAgent's `doctor` reports **all checks passing** and `list_environments` returns exactly one
environment, "Tennetech LLC (default)". D2 Automation is invisible with no error. Further:
plain `az login --tenant <d2>` silently reused the signed-in browser session and did not switch;
`--use-device-code` forced account selection and worked. After `az` switches, FlowAgent still
holds a stale token and needs `reconnect`.

**Headless SharePoint auth still unsolved — now confirmed for `az` too.** An Azure CLI token for
the SharePoint resource is rejected by SP REST with `401 invalid_request`. Exit-gate list edits
still require the browser path.

**Flow 1 crew-filter bug — found, fixed, staged, NOT applied.** Both `Filter_array` and
`Filter_array_2` use `item()?['Crew']?['Value']` against a **Text** column. `?['Value']` on a
string is null, so every filter returns zero rows and each crew's dispatch email ships an
**empty assignment table**. The flow reports success and mail arrives — which is exactly why the
2026-09-01 "verified in prod" pass missed it. Delivery was checked; content was not.

Fix prepared and `preview_update`-verified as a minimal diff: **1 changed action** (`Condition_2`'s
`else`, which contains both filters), 7 unchanged, trigger unchanged, connection refs unchanged.
The apply was **blocked by the auto-mode permission classifier** — a live production flow write
that had not been explicitly approved. Not routed around. Staged as
`flows/definitions/D2-Daily-Dispatch-crewfilter-fix.json`.

**In-session false alarm, corrected.** I flagged mojibake in the Flow 3 email strings. Wrong —
self-inflicted, from `json.load(open(...))` without `encoding='utf-8'`, which defaults to cp1252
on Windows. The file always held correct UTF-8 (`⚠`, `→`, `–`), confirmed in the published row.
Recorded because the same trap will fire on any future script reading these files on Windows
without pinning the codec.

## Design decisions locked

- **`preview_update` + `previewToken` is the diagnostic path.** Plain `update_flow` hides real
  errors behind a successful draft write.
- **First designer Save per flow is a one-time cost**, to create connection-reference bindings.
  After that, `update_flow` + `PublishXml` is fully scriptable.
- **Strip `authentication` from actions when authoring new flows**; keep it when patching an
  existing live flow, to keep the diff minimal.
- **Do not use PAC solution ALM casually here.** Both flows are in `Active Solution` — the
  default solution, which cannot be exported. PAC would require creating a custom solution and
  moving the flow into it: a structural ALM change, deferred as Shane's call.

## Files touched

- `CLAUDE.md` — Flow 1 crew-filter bug; the `az login` cached-tenant trap; FlowAgent's
  `authentication` rule and four-argument shape; and the draft-row section covering the two-row
  model, `preview_update` as diagnostic, `publish_flow` ≠ publish, the `PublishXml` command, the
  two-IDs distinction, and the default-solution constraint on PAC
- `flows/README.md` — rewritten for the FlowAgent path; REST scripts relabelled archaeology;
  envelope→argument mapping table; tenant-pinned login; write-vs-publish section; PAC caveat
- `flows/definitions/D2-Event-Driven-Reconciliation.json` — stripped `authentication` from the
  five action `inputs` blocks; **added the missing trigger `splitOn`**. Matches what is published.
- `flows/definitions/D2-Daily-Dispatch-crewfilter-fix.json` — **new.** Flow 1 with both
  `Filter_array` expressions corrected to `item()?['Crew']`. Preview-verified, ready to apply.
- `D2-Week-2-Automations-Runbook.md` — corrected 3 stale `item()?['Crew']?['Value']` occurrences
  (L74, L80, and the Flow 4 Select projection at L344, which would have reproduced the same bug);
  rewrote the "Common gotchas" entry that claimed `Crew` filters need `CrewId eq 3` — backwards
  for this schema
- `sessions/2026-08-26a-daily-dispatch-handoff.md` — deliberately **not** edited. Session logs
  are historical record, not instructions; the correction lives in CLAUDE.md.

## State of the environment at close

| Flow | State | Notes |
|---|---|---|
| Flow 3 — Event-Driven Reconciliation | **Started** | Published, all 11 actions + trigger condition + `splitOn` verified |
| Flow 1 — Daily Dispatch + Reminders | Started | **Still carries the crew-filter bug.** Fix staged, not applied |
| Flow 2 — Sign-off Intake | Started | Untouched |
| Generate estimate | Started | Untouched, unrelated workload |

`az` default profile now holds the **D2** tenant, replacing Tennetech — plain `az login`
restores Tennetech when the estimator work needs it. FlowAgent wrote a `.flowagent/backups/`
folder at the repo root (untracked); Flow 3's pre-mutation snapshots are in it.

## Open questions / blocked on

- **Flow 3 exit-gate tests not yet run.** Both require real Assignments edits, which cannot be
  driven from here (SP REST rejects the CLI token). The runbook itself notes this flow can't be
  tested by manual trigger.
- **Flow 1 fix needs approval to apply**, or a 2-minute designer edit.
- **`AZURE_CONFIG_DIR` tenant isolation** was chosen but could not be applied: FlowAgent runs as
  an already-started MCP server, so the variable must be set *before* Claude Code launches.
- **Teams v1.1 is closer than expected** — the `shared_teams` connection is already wired to
  D2 Automation and Connected (`shared-teams-bf2bac67-…`), which was an open question. Still
  needs the team + `Field Dispatch`/`Ownership` channels to exist.

## Next action

1. **Run the two Flow 3 exit-gate tests** (both need list edits in the browser):
   - Create a double-book — set a second Assignment to the same Crew over overlapping dates.
     Expect a high-importance alert email within ~1 min. PM is unset on Harrison D2-1001, so it
     coalesces to `stratirus@d2pools.com`.
   - Edit **only** sign-off fields on an Assignment. Expect **no** run — this is the
     trigger-condition check that protects quota.
   - Verify with FlowAgent `get_run_history` / `get_run_actions` either way.
2. **Apply the Flow 1 fix** — either approve the blocked `update_flow` + `PublishXml`, or change
   `item()?['Crew']?['Value']` → `item()?['Crew']` in both `Filter_array` actions in the designer.
   Then confirm a dispatch email actually contains rows.
3. Re-export both flows to `flows/exports/` once green.
4. Flows 4 and 5 — same FlowAgent pattern, no API-surface re-discovery needed. Expect one
   designer Save each to create connection bindings, then fully scripted.
