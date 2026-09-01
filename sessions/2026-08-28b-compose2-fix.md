# 2026-08-28b — Compose 2 fixed (bare-expression syntax discovered)

## Session goal

Finish the Compose 2 fix documented in 2026-08-28a. Then close out for
Shane to start a fresh session.

## What happened

**Fixed Compose 2 Inputs.** Opened via classic designer, cleared the
`@{length(body('Get_items_4')?['value'])}` template, clicked Expression
tab, tried bare `length(body('Get_items_4')?['value'])`. **PA rejected as
"expression is invalid".**

Root cause: inside the Expression editor (bare expression context), the
`body('X')?['value']` shorthand is not valid. That shorthand only resolves
inside `@{...}` templates. In bare expressions you must use the full
`outputs('X')?['body/value']` path.

Corrected expression that landed:
```
length(outputs('Get_items_4')?['body/value'])
```

Chip converted, flow saved cleanly ("D2 — Daily Dispatch + Reminders •
Saved" with green banner).

## Not tested this session

Chrome extension dropped before I could kick off the test run. Compose 2
is fixed and saved. Next session opens with: Test → Manually → Run flow →
verify 7 emails.

## Key finding (add to next runbook)

**Two different reference syntaxes exist in PA and they are not
interchangeable:**

- **Inside `@{...}` template strings:** `body('X')?['value']` shorthand
  works. PA rewrites it during template evaluation.
- **In bare Expression tab:** must use full `outputs('X')?['body/value']`
  path. The shorthand is rejected.

Same distinction applies for other connector outputs — always use
`outputs('X')?['body/<path>']` in Expression tab, never `body('X')?[...]`.

## Files touched

- `sessions/2026-08-28b-compose2-fix.md` (this file, new)
- `sessions/latest.md` (copy)
- PA flow (portal): Compose 2 Inputs fixed to bare-expression form.
  Everything else unchanged from 2026-08-28a.

## Next action

Fresh session: open flow → Test → Manually → Run flow. Expect green.
Then export ZIP (task #5). Then update CLAUDE.md with the two
finalized gotchas (Init var Expression tab; outputs() shorthand in bare
expressions) and pivot to ZIP for Flows 3-5.
