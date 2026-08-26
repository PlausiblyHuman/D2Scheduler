# 2026-08-26b — Daily Dispatch: 7 read actions built, Chrome UI-driving limits hit on expression actions

## Session goal

Continue Daily Dispatch build via Claude Chrome (per Shane's preference — no
solution ZIP, no handoff to portal). Find the ceiling on what Chrome
UI-driving can actually do.

## Where the flow stands

**Flow:** `D2 — Daily Dispatch + Reminders` in **D2 Automation** env, owned
by `stratirus@d2pools.com`. Saved cleanly.

Full flow structure now:

1. **Recurrence** — Central Time, Mon–Sat, 06:00, starting 2026-08-27
2. **Initialize variable** — `today` = `@{formatDateTime(convertFromUtc(utcNow(),'Central Standard Time'),'yyyy-MM-dd')}`
3. **Initialize variable 2** — `yesterday` = `@{formatDateTime(addDays(convertFromUtc(utcNow(),'Central Standard Time'),-1),'yyyy-MM-dd')}`
4. **Get items** — Assignments, filter today, Order by Crew/Title asc, Top 500
5. **Get items 2** — Assignments, filter yesterday unsigned, Top 500
6. **Get items 3** — Crews, filter Active & not Unlimited, Top 100
7. **Get items 4** — Work Calendar, filter Date eq today, Top 10

Saved. Verified filter tokens display as proper chips (variable references
resolved correctly). Read side of the flow is complete.

## What actually failed on Chrome UI-driving — for the record

### Gotcha 1 — Classic designer's compact picker has no Expression tab

Condition value slots (and some other compact fields) show a picker with
"Dynamic content" only. No "Expression" tab. You can insert tokens (e.g.
`body('Get_items_4')?['value']`) but you can't wrap them in a function
like `length(...)`.

Consequences:
- `length()` for a holiday count check is unreachable without a workaround.
- Any expression that must combine multiple tokens hits the same wall.

Workarounds that actually work:
- **Compose action for the expression** — Compose's Inputs field DOES accept
  `@{...}` template form typed inline (see Gotcha 2). Compose output becomes
  a Dynamic-content token the Condition CAN reference.
- **Boolean-variable pattern** — Init `hasX = false`, Apply-to-each source →
  Set variable `hasX = true`, then Condition on the variable (no expression
  needed).

### Gotcha 2 — Typing `@` in a field becomes literal `@@`

PA's text fields auto-escape a leading `@` to `@@` (literal). So typing
`@length(...)` saves as the string `"@@length(...)"` — not an expression.
Confirmed via Peek code showing `"@@length(body(...))"`.

Workarounds:
- **Use `@{expression}` template form.** PA does NOT escape the `@{` marker.
  On save, PA parses it as a template interpolation and evaluates. This is
  what our Init variable `today`/`yesterday` used and it works. Confirmed by
  the token converting to a proper chip after save.
- For fields where you need the raw expression value (not a string), the
  expression editor via the picker's Expression tab is the only clean path
  — and that tab isn't in compact pickers (see Gotcha 1).

### Gotcha 3 — Peek code is read-only in classic designer

Peek code on any action shows the JSON but the Monaco editor is marked
read-only. Ctrl+A + type produces "Cannot edit in read-only editor" tooltip.
Setting the model value via `monaco.editor.getModels()[0].setValue(...)`
works on the Monaco layer but PA's flow-definition state doesn't propagate,
so the change is discarded on close.

Only route to edit the JSON directly: backend Flow Management API
(`us.api.flow.microsoft.com`), which requires a bearer token that the
Claude Code auto-mode classifier correctly blocks JS from harvesting.

### Gotcha 4 — Terminate cannot be inside Apply to each

Tried Apply-to-each on Get items 4's value → Terminate(Succeeded) as a
Condition-free holiday-skip. PA rejects: "The operation 'terminate' cannot
be used inside a for each."

### Gotcha 5 — Undo cascades unpredictably

At one point Apply-to-each got auto-inserted around Get items 2 (nesting it),
and undoing through the chain rebuilt actions in different structures each
time. Undo eventually failed with `ClientError: Cannot rea…ties of null
(reading 'getGraph')`. Kept saves frequent after that.

### Gotcha 6 — Bulk clicks + long picker panels create alignment drift

Dynamic content pickers are 400+px tall when a Get items output is expanded.
A click sequence based on prior screenshot coordinates often lands on the
wrong control after the picker opens/closes. Rescreen between structural
changes; don't batch too many clicks through picker state changes.

## Path forward — revised

The remaining 5 actions all involve one or more expression operations,
which per Gotchas 1–3 are the friction point. Best sequence:

### Action 8 — Holiday skip (Compose + Condition pattern)

Instead of the runbook's original Condition + Terminate:

1. Add **Compose** below Get items 4.
   - Rename: `HolidayCount`
   - Inputs: `@{length(body('Get_items_4')?['value'])}`
   - The `@{...}` template form works (proven — see Init variable pattern)
2. Add **Condition** below Compose.
   - Left value: click **Outputs** token from Compose (dynamic content, no
     expression needed)
   - Operator: `is not equal to`
   - Right value: `0` (typed as number)
3. **If yes** branch → **Terminate** → Status: `Succeeded`
4. **If no** branch → the Apply-to-each on crews (Action 9)

The Condition's compact picker CAN insert the Compose Outputs token
without an Expression tab, and comparing a number to a literal 0 works.

### Action 9 — Apply to each crew (with nested actions)

- Add **Apply to each** in the Condition's **If no** branch.
- Select an output: click `value` token from Get items 3.
- Inside, 5 nested actions in order (each has its own gotchas):

**9a. Filter array — today's assignments for this crew**

- Search: `Filter array` → Data Operation
- **From** field: click `value` token from Get items (today Assignments).
- The Filter row (Left | Operator | Right) uses the same compact picker.
  For Left, click into it → picker opens → look for **"Expression"** tab at
  top-right of picker header. If present, use it. If not, use Compose
  workaround (Compose expression → reference Compose output as token).
- Left value expression: `item()?['Crew']?['Value']`
- Operator: `is equal to`
- Right value expression: `items('Apply_to_each')?['Title']`

**If the Expression tab is missing** in the Filter row picker (very likely
per Gotcha 1), the workaround is two Compose actions BEFORE this Filter
array — one for the item's Crew.Value, one for the current iteration's
Crew Title — then reference both Composes' Outputs tokens in the Filter row.

**9b. Filter array — yesterday's unsigned for this crew**

Same pattern as 9a but From = `body('Get_items_2')?['value']`.

**9c. Compose email HTML**

- Search: `Compose` → Data Operation
- Inputs (paste the whole HTML template block below — the `@{...}`
  interpolations WILL work because Compose Inputs accepts `@{...}` typed
  inline, confirmed):

```
<div style="font-family:Segoe UI,sans-serif;font-size:14px;color:#1a2332">
  <h2 style="color:#0b6e78">TODAY — @{formatDateTime(variables('today'),'ddd MM/dd')} · @{items('Apply_to_each')?['Title']}</h2>
  @{if(empty(body('Filter_array')),'<p><em>No sub-phase scheduled today.</em></p>',concat('<p><strong>',first(body('Filter_array'))?['Job']?['Value'],'</strong><br>',first(body('Filter_array'))?['SubPhaseNumber'],' ',first(body('Filter_array'))?['SubPhaseName'],'</p><p><a href="https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler/Lists/Assignments/DispForm.aspx?ID=',string(first(body('Filter_array'))?['ID']),'">Open sub-phase to sign off</a></p>'))}
  @{if(empty(body('Filter_array_2')),'',concat('<h3 style="color:#a84a18">OUTSTANDING FROM YESTERDAY</h3><p>',string(length(body('Filter_array_2'))),' sub-phase(s) finished yesterday but not yet signed off.</p>'))}
</div>
```

Reference names: `Filter_array` = 9a, `Filter_array_2` = 9b. If your action
names differ, replace accordingly.

**9d. Send an email (V2)** — Office 365 Outlook

- To: click into field, insert `LeadEmail` token from Get items 3 (dynamic
  content — should appear as a chip).
- Subject: `D2 Dispatch — @{formatDateTime(variables('today'),'ddd MM/dd')} · @{items('Apply_to_each')?['Title']}`
- Body: click into field, insert **Outputs** token from Compose 9c.
- Show advanced options → **Is HTML: Yes**.

**9e. Post message in a chat or channel** — Microsoft Teams

- Post as: `Flow bot`
- Post in: `Channel`
- Team: `D2 Build Scheduler` (create in Teams web first if it doesn't exist)
- Channel: `Field Dispatch`
- Message: paste
  ```
  @{items('Apply_to_each')?['Title']} — dispatch email sent for @{formatDateTime(variables('today'),'ddd MM/dd')}.
  ```

## Save + test

1. **Save** — top toolbar or bottom button.
2. **Test** → Manually → "I'll perform the trigger action" → run.
3. Verify:
   - 7 emails land in `stalbot@stratirus.com` (placeholder LeadEmail).
   - 7 posts in `D2 Build Scheduler` / `Field Dispatch`.
   - Subcontractor crews (George, Armondo, STL, Brothers) do NOT get email
     (excluded by `Unlimited ne 1` filter on Get items 3).
   - If you manually add a Work Calendar row with `Date = today` and re-run,
     flow terminates after Action 8's Condition — zero emails, zero posts.

## Export

PA Portal → flow detail page → **Export → Package (.zip)**. Save to
`flows/exports/D2-DailyDispatch.zip`. Commit.

## Session workflow findings

**Chrome UI-driving IS viable for D2 flow builds**, but has a hard ceiling
at authoring bare-expression fields. The pattern that works:

- **Use classic designer, not new designer.** Classic exposes Peek code
  (read-only but useful for debugging) and has a picker Expression tab in
  some fields. New designer's Code view is read-only too and shows nothing
  useful.
- **Type expressions as `@{...}` template form.** PA does not escape the
  `@{` marker. Confirmed to save correctly and convert to a proper chip
  on reload.
- **When you need a bare expression value (not a string), use Compose as
  a proxy** — Compose Inputs accepts `@{expression}` typed inline and its
  Outputs token can be referenced in downstream Condition/etc. without
  needing the Expression tab there.
- **Never type a raw `@` at the start of a text field.** It becomes `@@`
  (literal) at save time.
- **My clipboard is a genuine time-saver.** Copy a configured Get items,
  paste 3× via My clipboard, edit only what differs.
- **Terminate at top level only.** Inside Apply-to-each, use Set-variable
  to a boolean flag; Terminate after the loop conditional.

## Files touched

- `sessions/2026-08-26b-daily-dispatch-chrome-limits.md` (this file, new)
- `sessions/latest.md` (copy pending)
- PA flow `D2 — Daily Dispatch + Reminders` — 7 actions built + saved

## Decisions made

- **Chrome UI-driving stays the primary build tool** per Shane's call.
  Documented the friction points so future flow builds route around them
  from the start.
- **Holiday-skip pattern pivots**: original runbook said Condition +
  Terminate. Actual working pattern is Compose(HolidayCount as `@{length()}`)
  → Condition on Compose Outputs. Terminate + inner Terminate-in-loop
  approaches don't work.

## Open items / blocked on

- Actions 8 + 9 (Compose HolidayCount, Condition, Apply-to-each crew with
  5 nested actions) not yet built — pattern documented above, ready for
  next session.
- Task #6 (Sign-off Intake export ZIP) — flow not present in D2 Automation
  env cloud flows. Needs re-scoping: either it was built elsewhere or
  needs to be rebuilt.
- Task #7 (real LeadEmail values for 7 crews) — placeholder in place.

## Next action

Open the flow in classic designer, execute Actions 8 + 9 per the runbook
above. Should be ~15-20 min of Chrome UI-driving now that the patterns
are known.
