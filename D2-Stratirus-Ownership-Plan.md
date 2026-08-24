# D2 Build Scheduler — Stratirus ownership, development, and deployment plan

**Owner:** Shane Talbot, Stratirus
**Status:** Stratirus taking full delivery ownership. Tennetech handoff assumed passive — proceeding without waiting on Ryan.
**Working scope:** Option A (Microsoft Lists), Rev C baseline with Rev D adjustments from Ryan-Claude review, $0/mo incremental, ~$14k build, 5 weeks + pre-build verification.
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
| Rotate any admin grants in D2's tenant to Stratirus service accounts (you have them; verify they're the ones being used, not Ryan's personal ones) | Shane | 20 min | Week 1 build |
| Post the current Rev C spec, cost model, and patched browser tool to a Stratirus-side project workspace | Shane | 10 min | Internal reference |

**Total Phase 0: ~90 minutes over 1–2 days.**

---

## Phase 1 — Pre-build verification (this week or next)

Three technical checks that must land before Week 1 build starts. All are cheap; all are load-bearing.

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

7. **§14 extension paths — reframe Dataverse migration as "either-or, not a ladder."** Reference data ports; flows, security, canvas UI are a full rebuild. Honest math: $14k Lists + $36k eventual Dataverse rebuild if D2 outgrows Lists. Rev C oversold this.

8. **§14 — add Ryan's load-reset diagnosis to the note about applying the same fix in the Power Automate flow.** The "reset baseline; count only locked work" framing is cleaner than the "add tie-break" framing. Both fixes in the shipped patch, but the diagnosis language should match reality.

9. **§10 deployment — for Change 5 (drop Test env), move the "duplicate Crew Day insert fails" test to Dev with an explicit "verify before Prod import" gate.** Ryan's suggestion. Preserves the one test that matters.

10. **§05 applications — clarify that keeping the browser tool as the planner is permanent, not transitional.** Removes ambiguity from Rev C. The browser tool handles what Dataverse's Power BI Gantt would have handled in the original plan.

**Owner:** me. **Est. time:** 90 minutes to rebuild + verify.

---

## Phase 3 — Build (5 weeks)

Standard Rev C weekly cadence with Rev D adjustments folded in. Each week has an exit gate we don't cross without.

### Week 1 — Foundation (Aug 25 – Aug 29 target)
- SharePoint site provisioning
- 6 lists with all columns (added d2_crew_trades back per Rev D #1)
- Choice columns, indexed columns, uniqueness enforcement on JobNumber and CrewID
- Permission groups: Office Admins, Project Managers, Crew Leads, Owners
- Seed data: Trades (26), Crews (14, with subcontractor Unlimited=Yes for the four), Work Calendar
- **Exit gate:** PM opens Assignments list, sees all columns, JobNumber uniqueness enforced. Test insert into `d2_crew_day` equivalent (once we have the composite key emulation flow — actually not a Lists thing; skip this Dataverse-era gate for now).
- **Estimate:** 25 hrs (was 20 in Rev C; +5 for the extra crew_trades list)

### Week 2 — Automations core (Sep 1 – Sep 5)
- Daily Dispatch + Reminders flow (6 AM Mon–Sat)
- Event-Driven Reconciliation flow with trigger conditions (per Rev D #3)
- Nightly Reconciliation flow (11 PM safety net)
- Weekly + Daily PDF Summary flows
- **Exit gate:** Test edit that creates a double-book posts to Ops channel within the measured polling window; dispatch email lands at 6 AM the next morning
- **Estimate:** 22 hrs

### Week 3 — Canvas app + intake (Sep 8 – Sep 12)
- Power Apps canvas app for crew-lead sign-off + task-tick
- WorkDate field with today-default and manual override (per Rev D #2)
- Sign-off Intake flow triggered by canvas app
- Browser-tool export flow (nightly JSON → Lists upsert)
- Mobile device testing on real crew-lead phones (need 2–3 handsets for a real test)
- **Exit gate:** crew lead ticks 6 tasks + signs off from phone in under 60 seconds; work-date defaults correctly and is overridable
- **Estimate:** 28 hrs

### Week 4 — Pilot (Sep 15 – Sep 19)
- Pick one live pool. Run through Lists in parallel with browser tool. PM commits schedule in browser tool → nightly export → Lists is the source of truth for execution. Crew lead uses canvas app for sign-off.
- Daily standup: any divergence between browser tool and Lists? Any conflict alert we didn't expect? Any crew-lead friction?
- Log every issue. Fix in-week or defer to Week 5.
- **Exit gate:** one full week with zero divergence between browser tool and Lists; crew lead reports canvas app is usable
- **Estimate:** 15 hrs pilot support + issue fixes

### Week 5 — Cutover + training (Sep 22 – Sep 26)
- Group training session for 5 office users (~1 hour)
- Short session per crew lead or group (~30 min)
- Handoff documentation for D2's own reference
- Cutover: browser tool becomes planner-only (still used by PM, no longer master data)
- Go-live support: on-call for first 3 business days
- **Exit gate:** all active pools running in Lists; browser tool is planning-only; no P0 issues open
- **Estimate:** 15 hrs

**Total build phase: ~105 hrs → ~$14,700 at $140/hr.** Slightly up from Rev C's $14,000 because of Rev D #1 (crew_trades list restored).

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
Phase 0 (ownership) → Phase 1 (verifications) → Phase 2 (Rev D spec) → Week 1 build
        ~90 min              ~30 min              ~90 min             ~25 hrs
```

**Best case:** ownership + verifications this week, Rev D by end of week, Week 1 build starts Monday Aug 25, go-live Sep 26.

**Blockers that could slip this:**
- Don doesn't answer the trades + PM-bucket questions → Week 1 can still start, but §04 data model migration for real pools waits
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
