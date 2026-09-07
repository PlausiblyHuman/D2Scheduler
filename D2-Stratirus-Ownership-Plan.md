# D2 Build Scheduler — Stratirus ownership, development, and deployment plan

**Owner:** Shane Talbot, Stratirus
**Status:** Stratirus taking full delivery ownership. Tennetech handoff assumed passive — proceeding without waiting on Ryan.
**Working scope:** Option A (Microsoft Lists), Rev C baseline with Rev D adjustments from Ryan-Claude review, 5 weeks + pre-build verification.

> **CORRECTION 2026-09-04 — the `~$14k build` figure previously stated here does not apply to this project.** That SOW covered a **Copilot setup and GoDaddy migration**, a separate engagement. It was conflated with this build in the original draft of this plan. The commercial basis for the D2 Build Scheduler is **not recorded in this repo** — do not quote $14k, the derived "$4k saving" for the Forms fallback, or the "$14k vs $36k Dataverse" comparison as if they describe this work. The $0/mo incremental *platform* claim also needs qualifying: see the crew-lead licensing note in CLAUDE.md.
**Date:** August 19, 2026

---

## Phase 0 — Ownership transition (this week)

Non-technical setup so we can build with authority, not permission.

| Item | Owner | Est. time | Blocks |
|---|---|---|---|
| Close the loop with Ryan — one-line "we've got it from here, thanks for the passthrough" | Shane | 5 min | Nothing (courtesy) |
| Absorb the D2-Build-Scheduler repo into a Stratirus-owned location (SharePoint / OneDrive / Git — pick one) | Shane | 15 min | Rev D delivery |
| Confirm Ken's SOW template reflects Option A scope, not the original Dataverse plan | Shane + Ken | 30 min | SOW send to D2 |
| Send SOW to David + Don for signature | Shane | 10 min | Formal work start |
| Rotate any admin grants in D2's tenant to Stratirus service accounts (you have them; verify they're the ones being used, not Ryan's personal ones) | Shane | 20 min | Phase A build |
| Post the current Rev C spec, cost model, and patched browser tool to a Stratirus-side project workspace | Shane | 10 min | Internal reference |

**Total Phase 0: ~90 minutes over 1–2 days.**

---

## Phase 1 — Pre-build verification (this week or next)

Three technical checks that must land before Phase A build starts. All are cheap; all are load-bearing.

| Check | Method | Owner | Est. time | If it fails |
|---|---|---|---|---|
| D2's M365 SKU includes Power Apps for M365 seeded rights | Sign in to admin.microsoft.com with service account → Billing → Licenses | Shane | 5 min | Fall back to Microsoft Forms + SharePoint list view (uglier UX, drops canvas app from scope, saves ~30 build hrs) |
| Power Automate SharePoint trigger polling interval on seeded rights | Test flow on a scratch list, measure trigger latency across 10 edits. Or check Microsoft Learn's current published minimum for seeded connectors | Shane / me | 15 min | Reframe Rev D's detection window as "polling-interval-dependent, expect 5-min worst case." Not fatal — still much better than nightly-only — but the sales narrative changes |
| Power Apps sharing enabled at tenant level in Power Platform Admin Center | admin.powerplatform.microsoft.com → Environments → Security | Shane | 5 min | Enable it (30 seconds, admin-only) |

**Total Phase 1: ~30 minutes.** Everything else in the plan assumes green on all three.

---

## Phase 2 — Rev D spec (adopt the good stuff from Ryan-Claude)

Rev D of the Option A spec, folding in the legitimate technical corrections from Ryan's Claude review. Not asking Ryan for approval — this is our internal build spec.

Changes to bake in:

1. **§04 data model — revert Change 9b.** Trade goes back to a proper lookup list (`d2_trades`) with a crew-trade intersect list (`d2_crew_trades`, ~51 rows). Preserves the "which crews hold trade X" query and preserves the honest upgrade path. Net: 6 lists, not 5. Adds ~5 hrs to build.

2. **§04 data model — add `WorkDate` column to Sub-phase Assignments.** Distinct from the sign-off timestamp. Canvas app defaults to today but user can adjust for late sign-off (crew signs off Wednesday morning for Tuesday's work). Fixes the QC/regulatory audit trail defect Ryan's Claude caught.

3. **§06 automations — add trigger conditions to Event-Driven Reconciliation.** Skip trigger when the only columns that changed are sign-off fields (`InstallerSignOff`, `InstallerSignOffBy`, `InstallerSignOffOn`, `PMSignOff`, etc.). Prevents self-firing after every sign-off. Uses SharePoint trigger's built-in `Trigger Conditions` — no premium.

4. **§07 double-booking language — reframe "functionally equivalent" as "acceptable degradation."** Honest positioning: Dataverse rejects the second write; Lists accepts both and posts an alert. Different failure modes. At D2's scale (2 concurrent PMs max, ~40 pools/yr) the trade-off is fine but say so plainly.

5. **§07 — update detection window to reflect Phase 1's polling-interval finding.** "60 seconds" becomes actual measured latency.

6. **§08 security — clarify that Read-only-for-crew-leads is a view-filter + Contribute-blocked pattern, not item-level permissions.** Item-level permissions on 5,000+ rows have real SharePoint scaling problems. View filter + no-write permission achieves the same thing at scale.

7. **§14 extension paths — reframe Dataverse migration as "either-or, not a ladder."** Reference data ports; flows, security, canvas UI are a full rebuild. Honest math: ~~$14k Lists + $36k eventual Dataverse rebuild~~ **(figures void — see the correction at the top of this file; they came from an unrelated SOW)**. The *structural* point stands and is the part that matters: reference data ports, but flows, security and canvas UI are a full rebuild. Rev C oversold this.

8. **§14 — add Ryan's load-reset diagnosis to the note about applying the same fix in the Power Automate flow.** The "reset baseline; count only locked work" framing is cleaner than the "add tie-break" framing. Both fixes in the shipped patch, but the diagnosis language should match reality.

9. **§10 deployment — for Change 5 (drop Test env), move the "duplicate Crew Day insert fails" test to Dev with an explicit "verify before Prod import" gate.** Ryan's suggestion. Preserves the one test that matters.

10. **§05 applications — clarify that keeping the browser tool as the planner is permanent, not transitional.** Removes ambiguity from Rev C. The browser tool handles what Dataverse's Power BI Gantt would have handled in the original plan.

**Owner:** me. **Est. time:** 90 minutes to rebuild + verify.

---

## Phase 3 — Build

> **Two numbering schemes are in play — do not conflate them.**
> The **Phase 0–4** headings in this document are *engagement stages* (ownership transition,
> verification, spec, build, post-deployment). The **Phase A–G** letters are the *build
> breakdown* and match the AzDo Epics. This section, engagement Phase 3, contains build phases
> A through G. Week numbering was retired on 2026-09-07 — see the phase table in `CLAUDE.md`.

Standard Rev C weekly cadence with Rev D adjustments folded in. Each week has an exit gate we don't cross without.

### Phase A — Foundation (Aug 25 – Aug 29 target)
- SharePoint site provisioning
- 6 lists with all columns (added d2_crew_trades back per Rev D #1)
- Choice columns, indexed columns, uniqueness enforcement on JobNumber and CrewID
- Permission groups: Office Admins, Project Managers, Crew Leads, Owners
- Seed data: Trades (26), Crews (14, with subcontractor Unlimited=Yes for the four), Work Calendar
- **Exit gate:** PM opens Assignments list, sees all columns, JobNumber uniqueness enforced. Test insert into `d2_crew_day` equivalent (once we have the composite key emulation flow — actually not a Lists thing; skip this Dataverse-era gate for now).
- **Bounded by:** effort. *Actual: completed 2026-08-25 in a single session against this 25 hr / 5 day estimate.*

### Phase B — Automations core (Sep 1 – Sep 5)
- Daily Dispatch + Reminders flow (6 AM Mon–Sat)
- Event-Driven Reconciliation flow with trigger conditions (per Rev D #3)
- Nightly Reconciliation flow (11 PM safety net)
- Weekly + Daily PDF Summary flows
- **Exit gate:** Test edit that creates a double-book posts to Ops channel within the measured polling window; dispatch email lands at 6 AM the next morning
- **Bounded by:** discovery. *Actual: ~11 sessions over 10 days. The time went to auth dead ends and bug discovery, not authoring.*

### Phase C — Canvas app + intake (Sep 8 – Sep 12)
- Power Apps canvas app for crew-lead sign-off + task-tick
- WorkDate field with today-default and manual override (per Rev D #2)
- Sign-off Intake flow triggered by canvas app
- Browser-tool export flow (nightly JSON → Lists upsert)
- Mobile device testing on real crew-lead phones (need 2–3 handsets for a real test)
- **Exit gate:** crew lead ticks 6 tasks + signs off from phone in under 60 seconds; work-date defaults correctly and is overridable
- **Bounded by:** effort + discovery. The only remaining phase where compression is possible, so all slack must be taken here.

### Phase E — Pilot (Sep 15 – Sep 19)
- Pick one live pool. Run through Lists in parallel with browser tool. PM commits schedule in browser tool → nightly export → Lists is the source of truth for execution. Crew lead uses canvas app for sign-off.
- Daily standup: any divergence between browser tool and Lists? Any conflict alert we didn't expect? Any crew-lead friction?
- Log every issue. Fix in-week or defer to Phase F.
- **Exit gate:** one full week with zero divergence between browser tool and Lists; crew lead reports canvas app is usable
- **Bounded by:** CALENDAR. Needs a real work week of real pools to elapse. Cannot be compressed.

### Phase F — Cutover + training (Sep 22 – Sep 26)
- Group training session for 5 office users (~1 hour)
- Short session per crew lead or group (~30 min)
- Handoff documentation for D2's own reference
- Cutover: browser tool becomes planner-only (still used by PM, no longer master data)
- Go-live support: on-call for first 3 business days
- **Exit gate:** all active pools running in Lists; browser tool is planning-only; no P0 issues open
- **Bounded by:** CALENDAR + human availability. Training needs people in rooms; go-live support needs business days.

> ### Estimates restructured 2026-09-04 — read this before quoting any number above
>
> **The hour figures were written for human developers and do not describe this build.** Observed pace with
> Claude Code assisting: Phase A's 25 hr / 5 day estimate completed in **one session**; Phase B's 22 hr estimate
> took **~11 sessions over 10 days**, but almost none of that was authoring — it was PnP/m365 auth dead ends,
> the `api.flow.microsoft.com` REST wall, the draft-row mechanism, the `az rest` encoding trap, and three
> production bugs found by verification.
>
> Authoring collapsed. Discovery did not. So work is now classified by what actually bounds it:
>
> | Bound | Behaviour | Examples here |
> |---|---|---|
> | **Effort** | compresses hard; estimate as "a session or two" | schema, flow definitions, scripts, docs |
> | **Discovery** | does **not** compress; buffer, don't estimate | auth walls, undocumented platform behaviour, wrong assumptions in the spec |
> | **Human-gated** | moves at client speed | Don's trade mapping, 7 crew-lead accounts, Teams channels, licensing |
> | **Calendar** | **irreducible** | the pilot week, training sessions, go-live business days |
>
> Practical consequence: **compression helps Phase C and nothing after it.** Phases E and F cost what they cost.
>
> **The `~$14,700 at $140/hr` total previously stated here is void** — it derived from a SOW covering a Copilot
> setup and GoDaddy migration, a separate engagement. This project's commercial basis is not recorded in this
> repo; ask rather than infer.
>
> Week numbering is superseded by phases (A–F) — see the AzDo Epics. **Phase D — Real-data readiness** was added
> because it had no home in the week structure: every flow verified so far has run against the browser
> prototype's demo job and generated test rows, never an actual D2 pool.

---

## Phase 4 — Post-deployment (weeks 6+)

Fold into the standard Stratirus 3-year retainer.

| Item | Cadence | Owner |
|---|---|---|
| Weekly check-in with David/Don for first 4 weeks post-go-live | Weekly | Shane |
| Monthly business review with Don | Monthly | Shane |
| Retainer hours drawdown for change requests, adds, bug fixes | Standard 3-yr | Stratirus team |
| Actual-vs-planned duration data review (this is what backs the eventual 46-duration cleanup — see Rev D §14) | Month 3, Month 6 | Shane |
| PM-crew-bucket and unmapped-trades decisions from Don locked in the template | Whenever Don answers | Shane |
| Extension-path review (BI dashboards, Dataverse migration, etc.) | Annual | Shane + Ken |

---

## Critical path

```
Phase 0 (ownership) → Phase 1 (verifications) → Phase 2 (Rev D spec) → Phase A build
        ~90 min              ~30 min              ~90 min             ~25 hrs
```

**Best case:** ownership + verifications this week, Rev D by end of week, Phase A build starts Monday Aug 25, go-live Sep 26.

**Blockers that could slip this:**
- Don doesn't answer the trades + PM-bucket questions → Phase A can still start, but §04 data model migration for real pools waits
- D2 M365 SKU verification fails → Phase 2 has to accept Forms fallback, spec changes materially
- Polling interval verification comes back at 5 minutes → §07 language changes but nothing else stops

---

## Immediate next actions (tonight or tomorrow morning)

1. Verify D2 M365 SKU (5 min in admin center)
2. Verify Power Apps sharing setting (5 min in Power Platform admin)
3. Test SharePoint polling floor with a scratch flow (~15 min, could be your morning coffee task)
4. One-line note to Ryan closing the loop (5 min)
5. Confirm with Ken that the SOW reflects Option A / Rev D scope (30 min)
6. Give me the go-ahead and I'll produce Rev D (90 min)

Once #1-3 clear and Rev D is done, we're in a position to send the SOW to D2 with a real Monday start date.
