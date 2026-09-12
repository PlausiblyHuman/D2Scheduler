# Pending flow edit — `D2 - Reschedule Pool`, cursor must never move backwards

**Status: validated by dry run, NOT applied.** The apply step was blocked by a tooling permission
gate. Everything below is verified against the live definition and ready to run as-is.

**Flow:** `D2 - Reschedule Pool`
**ProcessSimple flow id:** `2f2cde97-e0fd-5c5c-934a-02f09a1d83a5`
**Dataverse workflowEntityId:** `210f1d70-e2ab-f111-aaab-6045bd0196b3`
**Environment:** D2 Automation, `2710a01b-6cfa-e820-b338-2286f2649300`

---

## The defect

`Set_cursor_pinned` advances the reflow cursor past a pinned row **unconditionally**:

```
@{formatDateTime(addDays(item()?['ScheduledFinish'], 1), 'yyyy-MM-dd')}
```

The walk moves through a job's assignments in `Sequence` order carrying a `cursor`. When it meets a
row that is `Locked` or already signed off, it does not move that row — it just advances the cursor
to the row's end. But it *assigns* rather than *advances*: if the pinned row finishes **earlier**
than work already placed, the cursor jumps backwards and the next unlocked row is scheduled on top
of a span that is already occupied. That violates business rule 3, which says sub-phases run in
order and one cannot start before the one before it ends.

**Reachability:** it needs a PM to pin a row to a date earlier than the preceding sub-phase ends.
That is already a mistake on the PM's part, but the flow compounds it into overlapping work rather
than containing it. Not urgent; real.

**The identical defect existed in the browser planner and was fixed there on 2026-09-12**
(`web/index.html`, `if(nc>cursor)cursor=nc`), pinned by `fixtures/planner/rules.js`. Until this
lands, the two halves disagree: the planner will tell you, the flow will not.

## The fix

Two new `Compose` actions plus a changed expression. Composes are **siblings**, so container depth
is unchanged at 6 — the ceiling is 8 and this flow has hit it before.

**Why a Compose instead of just reading the variable:** a `SetVariable` whose value expression
references the variable it writes fails save-time validation, and the error names an unrelated
action and complains about a missing connection reference. Routing the read through a `Compose` is
the documented way round it.

Path prefix (verified to resolve against the live definition):

```
actions/Scope_reflow/actions/Condition_job_found/else/actions/Condition_sequence_exists/else/actions/Apply_to_each_row/actions/Condition_skip_row/actions/Condition_is_pinned/actions
```

| Action | runAfter | Value |
|---|---|---|
| `Compose_pin_end` *(new)* | `Condition_past_pinned` | `@{formatDateTime(addDays(item()?['ScheduledFinish'], 1), 'yyyy-MM-dd')}` |
| `Compose_cursor_now` *(new)* | `Compose_pin_end` | `@{variables('cursor')}` |
| `Set_cursor_pinned` *(changed)* | `Compose_cursor_now` | `@{if(greater(outputs('Compose_pin_end'), outputs('Compose_cursor_now')), outputs('Compose_pin_end'), outputs('Compose_cursor_now'))}` |

`Compose_skipped_pinned` already runs after `Set_cursor_pinned` and is unaffected.

`greater()` compares `yyyy-MM-dd` strings ordinally, which is correct chronological ordering. On the
first pinned row `cursor` is always populated — `Set_cursor` runs before the loop — and even if it
were empty, `greater(pinEnd, '')` is true, so the pin wins. Safe either way.

## To apply

The dry run returned `applied: 5 operations`, `actions: ~1 (16 unchanged)`, trigger unchanged, and
every path resolved into the existing structure rather than creating a literal key. Re-run the same
five operations through `edit_flow` and then **promote with `PublishXml`** — `publish_flow` is
enable/start only and does not publish a definition:

```bash
az rest --method post \
  --url "https://org4ed2f722.crm.dynamics.com/api/data/v9.2/PublishXml" \
  --resource "https://org4ed2f722.crm.dynamics.com/" \
  --headers "Content-Type=application/json" \
  --body '{"ParameterXml":"<importexportxml><workflows><workflow>{210f1d70-e2ab-f111-aaab-6045bd0196b3}</workflow></workflows></importexportxml>"}'
```

## How to verify it, because a clean run proves nothing

A reflow that happens not to contain an out-of-order pin will pass either way. Both directions have
to be shown:

1. On a demo pool, pin a row (`Locked = true`) to a date **earlier** than the preceding sub-phase
   ends. Raise a `Reschedule Requests` row from a sequence before it.
2. **Before the fix** the rows after the pin land on or inside the preceding span. **After it** they
   land after the later of the two.
3. Revert the pin and re-run; confirm the schedule returns to normal and nothing else moved.

Use a demo pool, never a real one.

## Auth note that cost time finding

FlowAgent keeps **its own token cache**, separate from the Azure CLI. It was authenticated as
`stalbot@stratirus.com` in **Tennetech's** tenant (`20f64e0e-…`) while `az` was on D2 — and both
reported success. `az account list` showed the Tennetech subscription as **default**, with D2's
tenant-level account present but not selected. Fix:

```bash
az account set --subscription f24d9b39-6a71-4f4e-a376-03b6f61c97e4
```

then FlowAgent `reconnect`, then confirm `whoami` reports tenant `f24d9b39-…` and
`list_environments` shows **D2 Automation**. If it shows only "Tennetech LLC (default)", the flows
you are about to edit are the wrong company's.
