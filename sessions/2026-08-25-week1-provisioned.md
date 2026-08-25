# 2026-08-25 · Week 1 complete — all 7 SharePoint lists provisioned

## Session goal

Resolve the PnP auth block from last session and provision the SharePoint lists. Stretch: extend to full Week 1 schema, not just the 3-list MVP.

## What worked

**New provisioning pattern: Claude Chrome + SharePoint REST from the authenticated page context.** Skips PnP.PowerShell and m365 CLI entirely. Pattern documented in `CLAUDE.md` → Known bugs.

**Deployed on `netorgft15040037.sharepoint.com/sites/D2BuildScheduler`:**

| List | Fields | Rows | Notes |
|---|---|---|---|
| Jobs | 6 | 1 | JobNumber unique+indexed; Harrison Residence D2-1001 seeded |
| Assignments | 22 | 5 | Full Week 1 schema incl Trade lookup, DurationDays, Locked, NotApplicable, PMSignOff/By/On, SignOffNotes, TasksTotal, TasksComplete |
| Tasks | 6 | 30 | Assignment lookup indexed |
| Trades | 3 | 26 | TradeCode + Title both unique |
| Crews | 7 | 14 | Subcontractor patch applied — George/Armondo/STL/Brothers = Unlimited=Yes. LeadEmail column present per Week 1 runbook workaround. |
| Crew-Trades | 4 | 51 | Two-lookup intersect resolved from crew-trades.csv |
| Work Calendar | 4 | 62 | 52 Sundays (Aug 30 2026 → Aug 22 2027) + 10 US federal holidays |

**Total ~180 REST calls executed cleanly in ~3-4 minutes wall time.**

## Auth attempts before landing on the winning pattern

1. `git pull` from Cowork sandbox — 403 (sandbox proxy blocks AzDO). Ran via Desktop Commander PowerShell instead — clean.
2. m365 CLI install — needed Node first, `winget install OpenJS.NodeJS.LTS` OK, then `npm i -g @pnp/cli-microsoft365` OK.
3. m365 CLI login — v11 requires BYO Entra `appId` at first login. Same chicken-and-egg as PnP. **Deterministic hit — stopped after one attempt.**
4. Pivoted to Claude Chrome REST-from-page. Worked first try.

## Gotchas discovered mid-run (all now documented in CLAUDE.md)

- **Fresh MCP tab groups need fresh sign-in** — cookie isolation is per tab-group. Only the first tab in a session survives.
- **CDP calls time out at ~45s** — split scripts.
- **Parallel field creates on same list contend and 500** with schema-lock error ("requires a newer version"). Field creates must be sequential; item seeds can be parallel in chunks of 8.
- **Hyphenated/spaced list names** have sanitized entity-type strings (`SP.Data.Crew_x002d_TradesListItem`, `SP.Data.Work_x0020_CalendarListItem`). Read `ListItemEntityTypeFullName` off the list metadata; don't hand-write.
- **Browser profile hop** — `switch_browser` prompt has to land in the RIGHT browser profile. Hit this twice; both times fix is re-invoke `switch_browser`.
- **Claude Chrome click-through can't happen from the extension's isolated context if the wrong browser is selected** — visible symptom is empty 404 JSON from `/_api/contextinfo`.

## Decisions made

- **Auth path for D2:** Claude Chrome REST-from-page is now the canonical provisioning approach for this tenant. `D2-Provision-Lists.ps1` marked obsolete but kept for archaeology.
- **Week 2 flow build path:** Claude Chrome UI-driving (not solution-ZIP JSON). Rationale — 5 flows, one tenant, one-time build; the versioning benefit doesn't pay for the ~10 hrs of authoring/import-loop tax. Middle path: after each flow works in UI, Export → Package (.zip) and drop into `flows/exports/` for backup + one-way path to solution-ZIP later.
- **Full Week 1 schema, not just MVP-3.** Adding the reference lists + extended Assignments fields now saves rework when the flows reference `NotApplicable`, `DurationDays`, `Crews.Unlimited`, etc.

## Open questions / blocked on

- Don still owes: (a) mapping for the 10 unmapped trades — Retaining Walls, Veneer/Stone, CMU, Brick/Masonry, Landscaping, Pavers, Forms, Water Line Install, Material Runs, Grading. (b) The 11 Unassigned field-supervision sub-phases — shared PM bucket or specific owner?
- Ghost licensing on disabled subscriptions still not investigated (Exchange Online Essentials + Business Basic + one Business Standard show as Disabled).
- Crew LeadEmail column is present but empty on all 14 crews. Needs to be populated before Daily Dispatch flow (Flow 1) can send targeted emails.
- Assignments views (All Assignments, This Week by Crew, Unassigned, Sign-off Overdue, Late-Starting Jobs) per Week 1 Day 3 Step 9 — not built. Can be added via REST or in the SP UI later; not blocking for Week 2.
- List permissions per Week 1 Day 4 Step 12 — not set. Currently everyone inherits site permissions. Needs the four SP groups (Office Admins, Project Managers, Crew Leads, Owners) + list-level inheritance broken. Not blocking Week 2 but needed before pilot.

## Next action

Start Week 2 flow build via Claude Chrome UI-driving. Flow order per runbook: Daily Dispatch → Sign-off Intake shell → Event-Driven Reconciliation → Nightly Reconciliation → Daily/Weekly PDF. My call is Sign-off Intake first (smaller, walking-skeleton, easier to test end-to-end when the canvas app arrives in Week 3), then Daily Dispatch once LeadEmail is populated.

## Files touched

- `CLAUDE.md` — replaced Known bugs section (PnP block RESOLVED via REST-from-page); replaced How to run it section with the current deployed state table and Week 2 as the immediate next action.
- `sessions/2026-08-25-week1-provisioned.md` (this file) + `sessions/latest.md` (copy).
- No code files touched — all provisioning happened on the tenant via REST.
