# 2026-08-24 · Migration from Cowork scratchpad

## What happened

Multi-day Cowork session (Aug 13 → Aug 24) produced the D2 Build Scheduler design + week-by-week build runbooks + patched browser tool + seed data + a live PowerShell attempt at SharePoint provisioning. Stratirus git-based multi-session workflow got set up today, so the whole session's output was migrated from the Cowork outputs scratchpad into this new AzDO repo (`D2Scheduler`).

## Files migrated

Robocopied from the Cowork outputs folder into `C:\src\D2Scheduler\`. Approximate contents:

- Top-level Markdown deliverables — Rev D spec (Word), 5 week-by-week runbooks, Phase 1 verifications, ownership plan, meeting brief, Ryan handoff email, subcontractor patch, provisioning script + log
- `patched-tool/` — browser scheduler with 2-line Auto-Schedule determinism fix + diff + README + oracle test harness
- `seed-data/` — Trades / Crews / Crew-Trades / Work Calendar CSVs with the subcontractor patch already applied, plus a README explaining SharePoint Grid-paste
- `memo/` — Decisions memo (Word) + refreshed license model (Excel)
- `alt-stack/` — Supabase-vs-Power-Platform comparison workbook (why we did NOT recommend GCP-style alternatives)
- `D2-Build-Scheduler/` — the original browser tool package Ryan Meyer built (pre-migration reference)
- `option-a/` — Rev C and Rev D drafts of the deployment plan, Ryan-Claude review response, Claude Code prompt file
- `option-b/`-equivalent artifacts — none; alternative paths lived in `alt-stack/`

Then scaffold docs were added on top: `.gitignore`, `.editorconfig`, `sessions/README.md`, `fixtures/README.md`. Real `CLAUDE.md` and `README.md` were written from actual session context (not the scaffold placeholders).

## Decisions locked in during the migration

- **Rev D §16 traceability** — every Rev C→D change is documented with source (Ryan-Claude review pass). Future edits should extend that table, not silently overwrite.
- **Browser tool is a permanent PM planner**, not a transitional retire-in-Week-5 artifact. This is now spelled out clearly in Rev D.
- **Data model is six lists, not five** — Trades restored as a proper lookup with the Crew-Trades intersect, per Ryan-Claude's push-back on the Choice-column collapse.
- **WorkDate field on Assignments** distinct from InstallerSignOffOn timestamp — regulatory/QC audit requirement.
- **Event-Driven Reconciliation flow needs a trigger condition** that skips sign-off-only edits, or it re-fires from Sign-off Intake writes.

## Open items — surface these before next session picks up

1. **SharePoint list provisioning is blocked on PnP.PowerShell auth.** Four attempts documented in `CLAUDE.md` → Known bugs. Next session needs to pick a resolution path:
   - Register a custom Entra app in D2 tenant, use `-ClientId` with `-Interactive`
   - Fall back to SharePoint UI clicks (~30 min guided, no auth mess)
   - Try m365 CLI (different auth model, may just work)
   - Try Microsoft Graph SDK PowerShell

2. **Two data-model decisions still with Don.**
   - Where do the 10 unmapped trades belong? Blocks George Crew scheduling entirely.
   - Should the 11 Unassigned field-supervision sub-phases go into a shared PM bucket, or specific-person ownership?

3. **Phase 1 verifications partially complete.**
   - ✅ M365 SKU check — Business Premium (2) + Business Standard (7) + Copilot Business (4) = enough Power Apps for M365 seeded rights for the office team. Crew leads need Business Basic added ($60/mo × 10) if canvas app is in scope.
   - ✅ D2 Automation Power Platform env exists, coexists with an estimator engine
   - ⏳ Power Automate polling floor test — not run. Deferred until PnP auth resolves.
   - ⏳ Power Apps sharing tenant setting — not confirmed.

4. **Ghost licensing on disabled subscriptions.** M365 admin shows Exchange Online Essentials, Business Basic, and one Business Standard as `Disabled` with users still "assigned." Suggests a CSP transition or lapsed renewal. Not blocking, but worth confirming those users aren't currently locked out of email.

5. **The old Cowork outputs folder is now duplicative.** Once this migration commit lands and someone pulls the repo on a fresh machine, the outputs scratchpad should be considered stale. Per RUNBOOK, rename to `_ARCHIVED_...` after next session confirms the git repo has everything.

## Next action

Resolve the SharePoint auth block. My call: try `m365 cli` first (fresh auth model, may sidestep PnP's threading bug) — if that also fails within one attempt, fall back to guided SharePoint UI clicks and skip the script.

## Files touched this session

Migration only — no code edits. Filled `CLAUDE.md`, `README.md`, this session log, and copied scaffold placeholders (.gitignore, .editorconfig, sessions/README.md, fixtures/README.md). Everything else was robocopied from the Cowork outputs folder untouched.
