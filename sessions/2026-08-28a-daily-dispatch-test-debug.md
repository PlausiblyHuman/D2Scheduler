# 2026-08-28a — Daily Dispatch test-run debug + refactor decision

## Session goal

Test-run the Daily Dispatch flow built in 2026-08-26c. Find and fix errors
until it runs green.

## Test runs (all failed, each surfaced a distinct root cause)

**Run 1 — Get_items failed:** `The expression "ScheduledStart le
'@{formatDateTime(convertFromUtc(utcNow(),'Central Standard Time'),'yyyy-MM-dd')}'..." is not valid.`

Root cause: I authored the Init variable Value fields by TYPING
`@{formatDateTime(...)}` into the value box. In String-typed variable
fields PA stores that as a literal template STRING, not as an evaluable
expression. At runtime `variables('today')` returned the raw template text,
which SP OData rejected.

Fix: clear Value, use the picker's **Expression tab**, type bare
`formatDateTime(convertFromUtc(utcNow(),'Central Standard Time'),'yyyy-MM-dd')`,
click OK. Chip converts and PA stores as expression. Same for `yesterday`.

**Run 2 — Get_items failed:** `The query is not valid.` (BadRequest from SP).

Root cause: `$orderby: Crew/Title asc` — SP OData can't order by an
expanded lookup field (`Crew/Title`) without `$expand=Crew`, which the PA
SharePoint connector does not send. The filter query with lookup fields
works (SP filter engine handles it), but orderby doesn't.

Fix: remove the Order By entirely from Get items (the today Assignments
one). We don't strictly need ordered results — Apply-to-each iterates in
whatever order.

**Run 3 — Condition_2 failed:** `The template language function 'greater'
expects two parameter of matching types. The function was invoked with
values of type 'String' and 'Integer' that do not match.`

Root cause: Compose 2's Inputs used `@{length(body('Get_items_4')?['value'])}`
— template form returns a STRING ("0" or "3"). The Condition then compares
that string against integer `0` — type mismatch.

Fix (in progress at session close): open Compose 2, clear Inputs, use
Expression tab to type bare `length(body('Get_items_4')?['value'])` — that
returns integer. Condition comparison works.

## Chrome UI-driving refactor decision

Shane called out the token burn. Analysis: Chrome click loops ~600-800K,
wall-discovery cost ~200-400K, disconnect/reconnect ~100-200K per session.

**Decision:** finish Daily Dispatch test-fix via Chrome (only Compose 2
edit + one retest remain), then **switch to solution-ZIP authoring for
Flows 3-5** (Event-Driven Reconciliation, Nightly Reconciliation, Daily
PDF, Weekly PDF). Author the flow definition JSON in the repo, commit,
Shane imports as ZIP via PA portal. ~5-10x cheaper per flow than UI-driving,
and handles all the expression-authoring problems this build hit
(`@`-escape, no Expression tab in compact pickers, Compose expansion bugs).

Update CLAUDE.md next session to reflect this — the current "Build via
Claude Chrome UI-driving (not solution ZIP)" rule was written before we
knew the click cost.

## Key Chrome-in-PA gotchas discovered

- **Variable Value fields need bare expression via Expression tab.**
  Typing `@{expression}` stores as literal string in String-typed value
  fields. Chip conversion is the tell — if the field shows a `formatDateTim...`
  pink chip after save, it's an expression; if it shows the raw
  `@{formatDateTime(...)}` text, it's a literal string.
- **SP `$orderby` on lookup expansions fails** without `$expand`. Use
  `Title asc` (item's own title) or omit orderby; use Filter Query for
  lookup constraints (that works fine without expand).
- **Compose Inputs same rule as Variable Value:** `@{expression}` returns
  string, Expression tab returns typed value. For number-returning
  functions (`length`, `int`, `float`) always use Expression tab so
  downstream Conditions compare like-to-like.

## Decisions made

- **Solution-ZIP for Flows 3-5.** Overrides the CLAUDE.md "no ZIP" rule.
  Chrome UI-driving is the wrong tool for expression-heavy PA flows.
- **Don't fix Compose 2 in-session** — Shane close-out. Fix is one edit
  (clear Inputs, Expression tab, `length(body('Get_items_4')?['value'])`,
  OK, save). Retest expected green.

## Open items / blocked on

- **Compose 2 fix + retest** — takes 3 minutes, next session opener.
- **CLAUDE.md update** — remove "not solution ZIP" from the Chrome-first
  rule; document the Chrome-driving gotchas as a "when using Chrome"
  guardrail rather than the primary pattern.
- Task #11 — Teams team creation still pending.
- Task #5 — Export flow ZIP after test goes green.
- Task #7 — Real LeadEmails from Shane.
- Task #8 — Assignments.EditFingerprint column (Flow 3 prereq).

## Next action

Open flow → click Compose 2 → clear Inputs → Expression tab → paste
`length(body('Get_items_4')?['value'])` → OK → save → Test → Manually → Run.
Expect green with 7 emails to stalbot@stratirus.com. Then export ZIP.

Then update CLAUDE.md with the refactor decision and start Flow 3
authoring in JSON.

## Files touched

- `sessions/2026-08-28a-daily-dispatch-test-debug.md` (this file, new)
- `sessions/latest.md` (copy)
- PA flow (portal, not repo): Init variables fixed to Expression form,
  Get items Order By cleared. Compose 2 still needs the same fix.
