# Ryan handoff — email + checklist

## Email

**To:** `ryan@tennetech.com`
**Cc:** `Kmcdonald@stratirus.com`
**Subject:** `D2 Scheduler — Stratirus takeover, findings, and what we need from you`

```
Ryan,

Confirming we're picking this up on the Stratirus side going forward — one throat, standard 3-yr retainer, no split-brand billing. Findings and recommendations from our review below, plus a short list of what we need from you to close the loop.

Highlights:

1. One-line fix in the browser tool (turned out to be two) — Auto-Schedule wasn't deterministic on tie-broken crew picks. Patched, verified with an oracle harness, PR-ready. Files: patched-tool/pool-scheduler.html + determinism-fix.diff.

2. Licensing rewrite for §10 — Microsoft retired the Power Apps per-app SKU in January. Monthly total still $402 for different reasons than the plan describes.

3. Reshaping the deployment as Microsoft Lists path (Option A) instead of Dataverse. D2's answers to David and Don unlocked this — no offline required (David), weekly/daily PDFs OK for owners (Don), 5 office users not 8, four subcontractor crews go to unlimited buckets. $0/mo incremental, 5-week build, $14k one-time. Full Rev C spec attached.

4. Two open items with Don via a separate note: (a) where the 10 unmapped trades belong, (b) whether the 11 Unassigned field-supervision sub-phases go into a shared PM bucket.

Since you built the original with a bunch of D2 context in your head, the Claude Code prompt below is worth 20 minutes on your end before we take the keys. It walks through each recommendation, pressure-tests the three Option A claims most likely to be wrong, and asks you to flag anything the Stratirus review missed. Read-only pass — no file edits.

What we need from you to close out the Tennetech side of this:

  - Any Power Platform environments you provisioned in D2's tenant (Dev/Test/Prod). If you spun them up, we'll adopt; if not, we'll create clean under Stratirus's admin creds.
  - Admin/access grants you're currently holding in D2's tenant (Entra roles, SharePoint site-collection admin, etc.) — worth transferring to a Stratirus service account.
  - Any verbal commitments to David, Don, or Amy that aren't in writing yet. Especially date promises.
  - Your Claude Code session notes from the original build, if any are worth preserving. Even a paste of the last transcript would help.
  - Anything in-progress or half-built that's not in the D2-Build-Scheduler repo yet.

Nothing formal — a text or a Teams DM covers it.

Happy to grab 20 minutes tomorrow to walk through Rev C and the takeover in person if useful.

Shane

---

Paste the block below into Claude Code from your D2-Build-Scheduler/ repo root. Self-contained; no file setup needed.

=== STRATIRUS TECHNICAL REVIEW — D2 BUILD SCHEDULER ===

Stratirus reviewed this repo and produced nine recommendations plus a shift to a Microsoft Lists deployment path. The full write-up is embedded below. This is a review pass only — no file edits, no commits, no writes of any kind. If you find you're about to write to a file, stop and ask.

The repo you're standing in contains:
  - app/pool-scheduler.html — a self-contained browser-based scheduler
  - docs/D2-Power-Platform-Deployment-Plan.html — the original Dataverse plan
  - data/*.csv and data/*.json — reference data

Read those before you begin, so your review is grounded in the actual implementation.

--- CHANGE 1: Auto-Schedule non-determinism ---
app/pool-scheduler.html, around line 313. Running Auto-Schedule twice from a settled state reassigns ~5 of 138 crew picks (dates hold, crew IDs oscillate). Root cause: two things — the load table was seeded from crewLoad() which counted all assignments (so Run 2's tiebreak inputs were biased by Run 1), AND the candidate sort had no stable secondary key. Fix: initialize load only from locked assignments (matching how busy is initialized), and add || a.id.localeCompare(b.id) as secondary sort key. Verified with 14 of 16 oracle tests passing (two remaining fails are known data gaps). Patch bundled in the delivery.

--- CHANGE 2: Licensing section (§10 of the deployment plan) ---
Per-app SKU retired Jan 2, 2026. Power BI Pro is $14 (Apr 2025). Managed Environments included with Premium. Dataverse storage doubled Dec 2025. $402/mo total holds but the §10 reasoning needs a rewrite.

--- CHANGE 3: Right-size office headcount ---
Don confirmed 3 (his side) + 2 PMs = 5 total. Was 8 in the plan.

--- CHANGE 4: Skip Power BI entirely ---
Don confirmed weekly/daily PDFs by email are acceptable. Drop the 3 Pro seats.

--- CHANGE 5: Two environments not three ---
Dev + Prod. Skip Test.

--- CHANGE 6: Keep the 295 tasks ---
Don wants each step ticked. My earlier recommendation to consolidate to 46 sub-phase checkboxes is off the table.

--- CHANGE 7: Shift primary path to Microsoft Lists (Option A) ---
David confirmed no offline required (all mobile/laptop use is online). That was the one architectural weakness of the Lists path. With it removed:

  DIMENSION              | DATAVERSE (confirmed scope) | LISTS
  Monthly software       | $100                        | $0 incremental
  One-time build         | ~$36k                       | ~$14k
  3-year TCO             | ~$40k                       | ~$14k
  Duration               | 13 weeks                    | 5 weeks
  Double-book prevention | DB-level preventive         | Event detection 60s
  Reporting              | (would need BI add-back)    | Weekly PDF to Teams

Loses vs Dataverse: preventive protection, model-driven UI polish.
Gains: ~$26k over 3 years, 8 weeks off timeline.

--- CHANGE 8: Event-driven reconciliation (Option A) ---
SharePoint "item created or modified" trigger on Sub-phase Assignments. Scoped to touched row's Crew + date range. 30-60s detection. Nightly full sweep stays as safety net.

--- CHANGE 9: Consolidate lists and flows in Option A ---
5 lists (added a Tasks list back because of Change 6), 5 flows. Choice column for Trades instead of a separate list. Sign-off fields collapsed onto Assignments (no separate Sign-Offs list).

=== OPTION A ARCHITECTURE SUMMARY ===

Platform: SharePoint Lists + Power Automate + Teams + Microsoft Forms + a small Power Apps canvas app for the crew-lead task-tick UI. All standard connectors. Zero incremental licensing.

Five lists: Jobs (unique JobNumber), Sub-phase Assignments, Sub-phase Tasks (indexed on Assignment lookup, filtered views to stay under 5000/view threshold), Crews (Unlimited=Yes flags George/Armondo/STL/Brothers as subcontractor buckets), Work Calendar.

Five flows: Daily Dispatch + Reminders, Event-Driven Reconciliation, Sign-off Intake (fires from canvas app), Nightly Reconciliation, Daily + Weekly PDF Summary.

Security: Crew Leads Read-only on Assignments (filtered to their crew). All writes via the Intake flow running as service account. No direct list writes possible for crew leads.

Double-booking without composite key: SharePoint Lists can't enforce composite uniqueness. Compensating design catches within 60 seconds via event trigger + nightly sweep. Claim: functionally equivalent to preventive at D2's scale (~40 pools/yr, 2 PMs concurrent max).

Upgrade path preserved: Data model deliberately shaped like Dataverse plan's. Lists to Dataverse later is CSV import per §09, not a rebuild.

=== YOUR TASK ===

Part 1 — For each of the nine recommendations:
  1. Does the diagnosis match what you see in the actual code and plan? Cite line numbers.
  2. Files/sections that would change if we accepted.
  3. Concerns the Stratirus memo missed — technical, architectural, scope.
  4. Confidence and any open questions.

Part 2 — Pressure-test Option A specifically. Race conditions in the event-driven flow. Assumptions about migrating Lists to Dataverse later. The 24-hour lag claim on sign-off (moot now since David confirmed no offline needed, but sanity-check that reasoning).

Part 3 — Anything you know about D2's context (verbal commitments, expectations, prior conversations) that isn't captured in the repo and would change how Stratirus should approach this.

When done, stop. Do not commit, edit, or push.
```

---

## Handoff checklist — what Stratirus needs from Tennetech

Short list. Not a formal handoff — Ryan owns both entities, so it's really artifact transfer, not IP transfer.

| Item | Owner | Status | Notes |
|---|---|---|---|
| D2-Build-Scheduler repo (browser tool, plan doc, data CSVs) | Ryan → Shane | Have it (uploaded Aug 13) | No action |
| Any Power Platform environments provisioned in D2's tenant | Ryan → Shane | Ask | If exists, adopt with Stratirus admin; if not, we create clean |
| Admin/access grants Ryan holds in D2's tenant | Ryan → Shane | Ask | Entra roles, SP site-collection admin, PPAC access — transfer to Stratirus service account |
| Claude Code session context / notes from the original build | Ryan → Shane | Nice-to-have | Even a last-transcript paste captures decisions log |
| Verbal commitments to David / Don / Amy | Ryan → Shane | Ask | Especially date promises or scope commitments |
| Half-built work not in the repo | Ryan → Shane | Ask | Anything in-progress that would surprise us |
| CSP / partner license paperwork if any Dataverse SKUs got quoted | Ryan → Ken | Ask | Ken handles the CSP side |
| D2's existing M365 tenant baseline (Business Standard? E3?) | Ryan → Shane | Ask | Confirms Power Apps standard rights are seeded for the canvas app |

## Once received

- Confirm Power Apps standard rights on D2's M365 SKU (blocking for the canvas app in Rev C)
- Rotate any Ryan-personal admin grants in D2's tenant to a Stratirus service account
- Move Ryan's original Claude Code transcripts (if any) into Stratirus's project knowledge base so context isn't lost
- Post-Don-response, finalize Rev C's §15 items and lock scope for the SOW
