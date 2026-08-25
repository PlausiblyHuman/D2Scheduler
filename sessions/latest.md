# 2026-08-25 · Week 2 — Sign-off Intake flow END-TO-END WORKING

## Session goal

Start Week 2 automations. Sign-off Intake first (smaller walking-skeleton per prior recommendation) via Claude Chrome UI-driving in Power Automate.

## What landed — end-to-end verified

**Flow saved AND tested with a live SharePoint write:**

- Name: `D2 - Sign-off Intake`
- Flow ID: `3e619659-850d-1b98-d552-93a63148e50d`
- URL: `https://make.powerautomate.com/environments/2710a01b-6cfa-e820-b338-2286f2649300/flows/3e619659-850d-1b98-d552-93a63148e50d?v3=true`
- Status: Saved with 1 non-blocking warning (Respond doesn't reference flow data — expected for shell).

**Structure:**
1. **Trigger** — When Power Apps calls a flow (V2), 5 inputs (AssignmentID, WorkDate, Notes, TasksTotal, TasksComplete). Internal keys via Code view: `number, date, text, number_1, number_2`.
2. **Get item** — SharePoint. Site: D2 Build Scheduler. List: Assignments. Id: dynamic AssignmentID.
3. **Send an HTTP request to SharePoint** — POST `_api/web/lists/GetByTitle('Assignments')/items(@{triggerBody()?['number']})` with `X-HTTP-Method: MERGE` + `If-Match: *` + odata=verbose headers. Body contains only the sign-off fields (no need to preserve required fields).
4. **Respond to a Power App or flow** — Text output `Status = "Success"`.

**Test run:** manual invocation with AssignmentID=1, WorkDate=2026-08-31, Notes="Chrome-driven test", TasksTotal=6, TasksComplete=6.

**Verified via SharePoint REST re-read:**

| Field | Result |
|---|---|
| InstallerSignOff | **true** |
| InstallerSignOffOn | 2026-08-25T20:46:52Z (matches run time) |
| WorkDate | 2026-08-31 |
| SignOffNotes | "Chrome-driven test" |
| TasksTotal | 6 |
| TasksComplete | 6 |
| Title | preserved — partial update worked cleanly |

## The winning pattern (documented for future flows)

**For write-back flows against SharePoint from Power Automate: use "Send an HTTP request to SharePoint" with SP MERGE, not the "Update item" action.**

Why: PA's Update item requires binding EVERY required field on the target list, even fields not being changed. Assignments has 7 required fields — that's 14+ dynamic-content bindings per Update item action, each 5-10 clicks. Send-HTTP-to-SP takes one URI + one headers JSON + one body JSON — total ~5 fields to configure — and MERGE only touches the fields in the body, leaving everything else alone.

**Body template (adapt field names per list):**

```json
{
  "__metadata": {"type": "SP.Data.AssignmentsListItem"},
  "InstallerSignOff": true,
  "InstallerSignOffOn": "@{utcNow()}",
  "WorkDate": "@{triggerBody()?['date']}",
  "SignOffNotes": "@{triggerBody()?['text']}",
  "TasksTotal": @{triggerBody()?['number_1']},
  "TasksComplete": @{triggerBody()?['number_2']}
}
```

Notes:
- Strings quoted, expressions inline via `@{...}`. Numbers unquoted.
- `SP.Data.<ListName>ListItem` for the __metadata type. Hyphenated lists sanitize to `_x002d_`; spaces to `_x0020_`. Read from `ListItemEntityTypeFullName` for anything non-trivial.
- Headers as a single-object JSON via the toggle icon next to the headers field: `{"X-HTTP-Method":"MERGE","If-Match":"*","Content-Type":"application/json;odata=verbose","Accept":"application/json;odata=verbose"}`.
- The v3 designer parses that headers JSON into 4 individual rows on save.

## Failed approaches (kept for archaeology)

1. **Update item with all-fields preserved** — too many clicks; abandoned mid-config in the earlier session iteration.
2. **Paste flow definition JSON via Code view** — Code view is READ-ONLY in v3 designer. Rejected.
3. **PATCH the flow definition via the PA management API** — CORS blocked from the tenant's SP page. Even if attempted from the PA portal, would need a bearer token acquisition path that hit the auto-mode classifier. Not pursued.
4. **Cookie-auth to `api.flow.microsoft.com`** — CORS blocked.

## Gotchas discovered

- **PA v3 designer Code view is READ-ONLY.** Can't paste JSON into an action's Code view. Only the Parameters tab accepts edits. Big surprise — Code view LOOKS editable.
- **Headers field has a hidden toggle** (icon next to the Headers section) that switches between key-value pair mode and JSON mode. JSON mode accepts a single-object paste with all headers at once — much faster than adding rows one by one.
- **URI dynamic content: `/` triggers the picker even mid-URL.** Type `_api/web/lists/GetByTitle('Assignments')/items(` then `/` and the popup opens. Insert the dynamic pill, then type `)`. Works cleanly.
- **The "browser has blocked popup" warning on connection creation is misleading** (confirmed in earlier session). The connection often lands anyway — check the "Connected to SharePoint" indicator at the bottom of the panel.
- **First tab in an MCP session survives; new tab groups need a fresh sign-in.** Cookie context is per-tab-group.

## Decisions made

- **Send-HTTP-to-SP is the canonical write-back pattern for D2 flows.** Faster to author, cleaner semantics (partial update), no schema-required-field tax. Update every applicable Week 2 flow that writes to SP to use this pattern.
- **UI-drive economics threshold refined:** Update item's 14 clicks/field was the anti-pattern. Send-HTTP-to-SP is ~15 clicks total for a full write. Big win.
- **Flow saved with 1 warning is fine** for shell flows. The "Respond doesn't reference flow data" warning is informational — canvas app still gets its `Status: Success` ack.

## Open items / next actions

- **Export the flow** to `flows/exports/D2-SignoffIntake.zip` — Portal → My flows → D2 - Sign-off Intake → Export → Package (.zip). Save to `C:\src\D2Scheduler\flows\exports\`.
- **Build Daily Dispatch (Flow 1)** next. Needs `Crews.LeadEmail` populated on the 10 field crews before it can send targeted mail. Add a data-entry task before or during this flow build.
- **Build Event-Driven Reconciliation (Flow 3)** with trigger condition per Rev D §06. Send-HTTP-to-SP is not needed here — trigger is SharePoint item-modified, not a write action.
- **Build Nightly Reconciliation (Flow 4).**
- **Build Daily + Weekly PDF Summary (Flow 5).**

## Files touched

- `sessions/2026-08-25-week2-flow-start.md` (updated — this file replaces the earlier "handoff" version)
- `sessions/latest.md` (copy)
- No code files. Flow lives in Power Automate cloud until exported to `flows/exports/`.
