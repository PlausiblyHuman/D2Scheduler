# 2026-09-04a — Canvas app handoff prep, licensing decision, phase restructure

> **RECONSTRUCTED 2026-09-05.** This session ended without a log being written; `latest.md`
> stayed on 2026-09-03a. Everything below is taken from commit `dc46931` and the documents it
> created, not from a transcript. Decisions are recorded because the artifacts state them
> explicitly. **The "Open questions" section is inferred and may be incomplete.**

**Session goal:** prepare the Week 3 canvas app to be handed to Ryan Meyer, settle the
crew-lead licensing question, and restructure the remaining phases.

**Commit:** `dc46931` — Canvas app handoff prep; licensing decision; phase restructure

## Files touched

- `D2-Canvas-App-Handoff-Contract.md` — **new**, 355 lines. The invariants the app must
  honour, including the §6a production-safety rules for working in a live client tenant.
- `canvas-app/mirror-provision.js` — **new**, 277 lines. Live-schema capture, retained as the
  authoritative record of the list schema (more accurate than the obsolete
  `D2-Provision-Lists.ps1`). Not needed for the build itself.
- `D2-Week-3-Canvas-App-Spec.md` — corrected against the live schema.
- `CLAUDE.md` — licensing, the Forms ruling, the canvas-app schema traps, the phase restructure.
- `D2-Phase-1-Verifications.md`, `D2-Stratirus-Ownership-Plan.md` — commercial corrections.

## Decisions made

- **Canvas app, not Microsoft Forms.** Shane's call: "MS Forms will not cut it." Forms cannot
  render a per-respondent question set at runtime, so the cheap variant drops Don's task-level
  tick requirement and the faithful variant needs 46 forms. Anonymous forms would also degrade
  `InstallerSignOffBy` from a verified user to a typed name on a forwardable link.
- **Crew leads need paid seats,** so "zero incremental licensing" is not accurate and must not
  be repeated to the client.
- **Build in D2 production**, no mirror environment, signed in as D2 Bot. Saves roughly a day
  of port-and-re-point from the only week with slack.
- **Ryan picks up Week 3.** *(Reversed 2026-09-05 — the canvas app stayed with Stratirus.)*
- **The `~$14k` build figure is void** — it came from a separate Copilot/GoDaddy SOW that was
  conflated with this project. Everything derived from it is void too.

## Schema traps found and fixed in the spec

- The lists are `Assignments` and `Tasks`, not `Sub-phase Assignments` / `Sub-phase Tasks`
  (wrong in 11 places; Power Apps binds by list Title, so every reference would have failed).
- `Jobs` has no `State` and no `ZIP` column.
- `Assignments.Job` is a Lookup with `ShowField='Title'`, so `Job.Value` returns
  `Harrison Residence`, not `D2-1001` — the third instance of joining on a display label.
- Join identity is `userPrincipalName`, never `mail`.

## Open questions / blocked on

*(Inferred from the artifacts, not recorded at the time.)*

- Crew-lead seats not purchased; no crew-lead identities exist in the tenant at all.
- `Crews.LeadEmail` holds an unmatchable placeholder on all seven field crews.
- Flow 3's trigger condition still a proven no-op.

## Next action

Hand the contract to Ryan and start Week 3.
*(Superseded 2026-09-05: Ryan is off the build; Stratirus builds the canvas app.)*
