# 2026-09-12a — Overnight: write-back specced, three rule bugs closed

**Session goal:** continuation of 2026-09-11d. Shane asked what could be done overnight without
him, chose "spec + the three bug fixes", and authorised me to rule on conflicts and log them
rather than stopping. Everything below is offline, reversible, and touched no client tenant.

---

## What shipped

**1. The batch write-back is specced** —
`docs/superpowers/specs/2026-09-12-batch-write-back-design.md`. Draft, not approved. Two findings
overturn assumptions in the parent spec:

- **ETags will not work.** `odata=nometadata` suppresses `odata.etag` entirely, verified against
  the captured fixture. The stronger objection is that a row-level ETag would produce **constant
  false conflicts**: five flows write to `Assignments` on schedules unrelated to the PM, so a load
  at 09:00 and a save at 16:00 would be rejected wholesale because a nightly flow annotated the
  rows overnight. The design compares the five owned fields instead.
- **Auto-Schedule cannot be expressed as a `Reschedule Requests` row**, because
  `D2 - Reschedule Pool` moves dates and never picks a crew. Routing a reflow through it would
  discard every crew decision the PM just made.

**2. Three planner rule-enforcement bugs fixed**, each with a test proven to fail first:

| | Defect | Effect |
|---|---|---|
| Rule 1 | `qualified()` and `isQualified()` used different predicates on the three `FIXED` pseudo-trades | STL Shotcrete on an `@office` sub-phase raised **no error at all**, while the same UI flagged it under "⚠ Not qualified" |
| Rule 2 | `autoSchedule`'s busy map did not exempt `unlimited` crews, though `busyMap()` did | a capacity-exempt subcontractor could be skipped as "busy" on a day it was free |
| Rule 3 | a locked row advanced the cursor **unconditionally** | a locked row starting earlier than preceding rows dragged the cursor backwards and the next unlocked row landed on top of placed work |

**3. `planner-stage1-verified` tag** marks the last known-good planner, per Shane's "keep a master
copy" — as a tag rather than a second file, because this repo already lost weeks to a described-
but-nonexistent `patched-tool/` copy.

## Files touched

- `docs/superpowers/specs/2026-09-12-batch-write-back-design.md` — new
- `web/index.html` — three rule fixes
- `fixtures/planner/rules.js` — new, 11 assertions
- `fixtures/planner/README.md`, `CLAUDE.md`

## Commits

`8bcfb72` spec · `ddca578` rule 1 · `55794e4` rule 2 · `3e631a0` rule 3, plus this checkpoint.

---

## Decisions

- **Rule 1 fixed by making `isQualified` strict**, not by loosening `qualified()`. The `FIXED` map
  names which bucket a pseudo-trade routes to; accepting any capacity-exempt crew ignored it.
  Loosening the other way would have revalidated crew IDs the dropdown never offers, recreating the
  same UI-vs-validation split in the other direction.
- **Safety-checked before committing rule 1**, because a stricter predicate can flag existing data:
  all 72 pseudo-trade rows on the three demo pools already carry their own bucket crew
  (`office:24, subcon:15, unassigned:33`), so nothing live is newly flagged. The reviewer
  reproduced that independently with its own script.
- **Backup, Restore and the file picker retire WITH the live connection, not before.** Until the
  app reads on open they are the only recovery from a cleared `localStorage`.
- **Master copy is a git tag, not a duplicate file.**
- **The server-side half of the rule-3 cursor defect was left alone** — `Set_cursor_pinned` in
  `D2 - Reschedule Pool` has the identical bug, and fixing it needs the live tenant.

## Open

- **A product question for Don, surfaced by the rule-1 fix:** should `@sub` admit the four *named*
  subcontractors (`george`, `armondo`, `stl`, `brothers`) rather than only the `subcon` bucket
  crew? Arguably a subcontractor genuinely is one. Deliberately not decided as a side effect of a
  bug fix. Widening it means changing both predicates together.
- **`D2 - Reschedule Pool`'s cursor can still move backwards.** Same defect as rule 3, needs the
  tenant.
- Unchanged and still human-gated: the Azure subscription, the Entra SPA registration, any tenant
  write (`fix-job-startdates.js` has `DRY_RUN = false` committed at line 37), the Graph payload
  capture, and a human eye on the repaint.

## Next action

Register the Entra SPA app — it needs no Azure subscription and is the real unblock — then capture
a real Graph payload into `fixtures/planner/live-payloads-graph.json` before writing any mapping
code. Review the write-back spec, which has three open questions at the bottom.
