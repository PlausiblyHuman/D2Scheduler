# Reject a sign-off, with comments

**Status:** design approved section by section by Shane, 2026-09-21. Spec awaiting his review.
**Priorities page item:** 12 (https://claude.ai/artifact/7zqKjJ29r1s5xLfenwq6rQ).
**Asked for at:** the 2026-09-17 session, 1:34:26 to 1:36:35 in the recording: a PM rejecting an installer's
sign-off, a comment thread with names and dates, and rejected items collecting in one "hot list".

## Decisions (Shane, 2026-09-21)

| Question | Answer |
|---|---|
| What does rejecting do to the installer sign-off? | **Reopen it**: clear the sign-off, record who rejected and why, flag the sub-phase Rejected |
| When does a rejection or comment reach SharePoint? | **On Save**, like every other planner change, with the Save preview |
| What takes a sub-phase off the rejected list? | **A PM marks it resolved**, even after the installer signs off again |
| Email? | **Planner, plus an "Open rejections" section in the 04:30 Daily Summary** |
| Where do comments live? | **A new `Sign-off Comments` list** plus three columns on Assignments |
| Who can comment, reject, resolve? | Anyone signed in to the planner; every entry is attributed |

## 1. SharePoint changes

### New list: `Sign-off Comments`

| Column | Type | Notes |
|---|---|---|
| `Title` | Text (built in) | `"<JobNumber> <SubPhaseNumber>"`, e.g. `D2-1042 2.1`, so the list reads sensibly when opened directly |
| `Assignment` | Lookup to Assignments | **SchemaXml copied from the live `Tasks.Assignment` lookup**, which works, rather than hand-written |
| `Kind` | Choice: `Comment`, `Rejected`, `Resolved` | Required |
| `Body` | Multiple lines, plain text | **Not required on the list** (SharePoint cannot require a column for some `Kind`s only). The planner refuses an empty `Comment` or `Rejected`; `Resolved` may be empty |

Author and time come from the built-in `Created By` / `Created`. They are stamped by SharePoint from the
delegated sign-in and cannot be supplied by the planner. Graph returns them as `createdBy.user.displayName`
and `createdDateTime` (UTC) on every item, verified in `fixtures/planner/live-payloads-graph.json`.

**List setting `WriteSecurity = 2`** ("create items and edit items that were created by the user"), so a
member cannot edit or delete someone else's comment. Owners are unaffected and can correct mistakes.

### Three new columns on Assignments

| Column | Type | Default |
|---|---|---|
| `Rejected` | Yes/No | No |
| `RejectedOn` | Date and time | empty |
| `RejectedReason` | Multiple lines, plain text | empty |

These duplicate the latest rejection onto the assignment so the Daily Summary flow and a SharePoint view
read one list. The history stays in `Sign-off Comments`. None of them is required, so existing rows and
the list form are unaffected.

**New view on Assignments: `Rejected`**, filter `Rejected = Yes`, grouped by Job, in
`sharepoint/provision-views.js` beside `Conflicts` and `Trade Mismatch`, linked from the home page.

**No flow is triggered by these columns.** Event-Driven Reconciliation's version-history gate watches only
`Crew`, `ScheduledStart` and `ScheduledFinish`. The field app sees a rejected sub-phase as not signed off,
which is correct, and shows no comments (out of scope).

### Provisioning

A committed script, `sharepoint/provision-signoff-comments.js`, run through the authenticated route
recorded in CLAUDE.md. It creates the list, reads `Tasks.Assignment`'s SchemaXml and adapts it, creates the
three Assignments columns, sets `WriteSecurity`, and **reads every piece back** (schema, the lookup's
target list GUID, `WriteSecurity`) rather than trusting status codes. The new list's GUID goes into
`D2_GRAPH.lists.comments`.

## 2. Planner behaviour

### The sub-phase panel

- **Comments section**: the thread oldest first, each entry with author, Central date and time, and a
  label on `Rejected` and `Resolved` entries. Below it, a text box and **Add comment**.
- **Reject sign-off** appears while the installer box is ticked. It needs a reason (the text box); with the
  box empty it says a reason is required and does nothing.
- **Mark resolved** appears while the sub-phase is rejected, with an optional note.
- **Queued entries** show in the thread as "Not saved yet", each removable until saved.
- **Rejecting un-ticks INST on screen immediately**, so the checklist unlocks for the fix.

### Save

- The Save button's count includes queued comments, rejections and resolutions.
- The Save preview lists them in their own section, in words ("reject 2.1 Engineering Review: <reason>").
- Results report each one: saved, refused (with why), or failed.

### The Sign-Offs tab

An **"Open rejections"** card at the top lists every unresolved rejection: job, sub-phase, who rejected it
and when, and the reason. Clicking an entry opens its panel. When the installer has signed off again, the
entry reads **"Signed again, ready to review"**. The card follows the job picker.

### The Job Board

A rejected sub-phase carries a small "Rejected" label on its row.

### Refresh

Reads `Sign-off Comments` alongside the other lists and maps entries to sub-phases by `AssignmentLookupId`,
**normalised with `String()` on both sides** (Graph returns lookup ids as strings; the silent empty join is
this project's most repeated defect). A missing or unreadable comments list costs only the comments:
Refresh must not fail because of it, the same rule as the user list.

### A downloaded copy (file://)

Cannot write comments, like sign-off. The comment and reject controls are not offered there; the panel says
this copy cannot save comments.

## 3. What Save writes

### Reject (one PATCH on the assignment, then one POST)

1. PATCH the assignment, in one body:
   - clear `InstallerSignOff`, `InstallerSignOffByLookupId`, `InstallerSignOffOn` (as a reopen does today)
   - append to `SignOffNotes`: `REJECTED <Central time> by <name> (was signed by <name>): <reason>`, with the
     same `  |  ` separator the reopen line uses
   - `Rejected = true`, `RejectedOn = <now>`, `RejectedReason = <reason>`
   - `SuppressReconcileUntil` (+10 min), as every Assignments write from the planner carries
2. Only if the PATCH succeeded, POST a `Sign-off Comments` row: `Kind = Rejected`, `Body = <reason>`.

### Resolve

1. PATCH `Rejected = false`, `RejectedReason` cleared (`RejectedOn` kept as history), plus the suppression stamp.
2. Only if that succeeded, POST `Kind = Resolved` with the optional note.

### Comment

POST `Kind = Comment`. Nothing else.

### Compare before write

The assignment rows are re-read immediately before writing, as the rest of Save does:

- **Reject is refused** if SharePoint no longer shows the sub-phase signed off, or already shows it rejected.
- **Resolve is refused** if SharePoint already shows it not rejected.
- A refusal writes nothing for that item and is reported with the reason.

### Interaction with the existing sign-off rules

- **A rejection counts as a reopen** for the rule that task writes are refused on a sub-phase SharePoint
  holds as signed unless the same Save reopens it. Without this, a PM who rejects and ticks tasks in one
  Save has the ticks refused.
- A rejection in the same Save as an un-tick of INST is one reopen, not two; the notes get the `REJECTED`
  line only.
- Marking resolved does not sign anything off.

### Failure between the two writes

If the PATCH lands and the POST fails, the results say so. The reason is not lost: it is in
`RejectedReason` and `SignOffNotes`.

## 4. Daily Summary

- New section **"Open rejections"**: each `Rejected = Yes` assignment on an `Active` job (the existing
  `Get_active_jobs` idiom): job, sub-phase, rejected on, reason.
- **Omitted entirely when there are none.**
- Invoke the `power-automate-flow-mechanics` skill before writing any expression: the connector returns
  `Rejected` as a boolean and a `$filter` compares it as `Rejected eq 1`; read the shapes off a real run.
- **Never test on the live flow**, which emails Don, David, Cody and Emon. Copy it, point the copy's `To`
  at `stratirus@d2pools.com` only, run it with at least one open rejection present, and read the body it
  actually sent (`Send_summary`'s `inputsLink`). Then apply the identical edit to the real flow, verify the
  published definition by content, and delete the copy. The real flow picks the change up at 04:30.

## 5. Testing

- **`fixtures/planner/rejections.js`** (jsdom, real page, MSAL and `fetch` stubbed): queueing, the "not
  saved" state and removal, the Save count and preview, the exact PATCH and POST bodies, PATCH-before-POST
  ordering, each refusal case, the reopen interaction with task ticks, the thread rendering, the Open
  rejections card including "signed again", resolve, the board label, the file:// case, the missing-list
  case, and escaping of comment text (probe starting `</option></select>`, per 2026-09-21).
- **`graph-to-planner.js`** mapping of comments and the three columns, including the string/number join.
- **Mutation sweep** of every new behaviour, each watched red.
- **`tools/planner-shakedown.js`** clean in a real browser.
- **Live**, on a throwaway `Planned` pool owned by D2 Bot, never a demo pool (a rejection leaves a
  permanent line in `SignOffNotes` and in version history): sign off, reject, provoke a refused reject,
  comment, sign again, resolve; read every row back. Then remove the pool through `Delete Pool Requests`
  and delete both request rows.

## Out of scope

- Comments in the crew field app.
- Editing or deleting a comment from the planner.
- Email at the moment of rejection.
- Restricting who may reject (the same open question as who may reopen).

## Rollback

Remove the comments read and controls from the planner (one commit), delete the list, and delete the three
columns. The Daily Summary edit is one `If` around one table and reverts by republishing the prior export.
