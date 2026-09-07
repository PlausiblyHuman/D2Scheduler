# D2 Phase D runbook — readiness

**Goal:** everything that must be true before real people use this system with real data.

**Exit gate:** a crew lead who has never seen the app can be handed a phone, sign in as
themselves, see only their own work, and complete a sign-off — against a real D2 pool, with no
`TEST-900x` rows anywhere and no Stratirus person in the loop.

---

## Why this phase exists

It was added because two whole workstreams had no home in the old week structure, and both were
lost as a result:

- **The office surface.** Seven SharePoint views were specified inside the Phase A checklist and
  its exit gate was ticked claiming "all views show correct filters". None of them existed. It
  went unnoticed until 2026-09-07, and the Phase F training session walks Don, both PMs and Amy
  through views that would not have been there.
- **Client prerequisites.** Crew-lead identities and licences keep resurfacing as "the longest
  pole" precisely because they were never anyone's deliverable. "Pilot week" quietly assumed the
  accounts would exist.

**Phase D is not sequential.** It runs alongside A–C and **gates E**. Most of it is human-gated,
so it moves at client speed no matter how fast the build goes — which is exactly why it needs to
be tracked separately from work that compresses.

---

## D1 — Office surface

**DONE 2026-09-07.** Eight views built by REST and each verified by *rendering* it, not by
trusting the `201` on create — a view accepts invalid CAML at creation and only fails when a user
opens it.

| List | View | Purpose |
|---|---|---|
| Assignments | All Assignments | grouped by Job |
| Assignments | Today by Crew | **Don's daily question** — grouped by Crew, with site address |
| Assignments | This Week by Crew | the PM's Monday view |
| Assignments | Unassigned | also matches `Crew = 'unassigned'`, the browser tool's pseudo-crew |
| Assignments | Sign-off Overdue | grouped by Crew |
| Assignments | Late-Starting Jobs | grouped by Job |
| Tasks | All Tasks (by Assignment) | |
| Tasks | Incomplete Tasks | see note |

Two deliberate deviations from the Phase A spec: `Unassigned` also matches the `unassigned`
pseudo-crew, because filtering on blank alone would miss the real unassigned work; and
"Incomplete for Today" ships as **Incomplete Tasks**, because CAML cannot filter a view on a
lookup's *other* columns without a join, so it cannot reach the parent assignment's dates.

Supporting columns added to Assignments: `JobAddress` and `JobCity`, dependent lookups on the
`Job` field.

## D2 — Ownership visibility

**DONE.** Daily summary 06:30 Mon–Sat, weekly Friday 15:00, both HTML email. The daily now leads
with **"Where crews are today"**, ordered by crew, including the site address — Don's stated
requirement.

**OUTSTANDING: recipients are still internal.** Pointing them at Don is a one-token edit in each
`Send_summary` action. Do it only once `TEST-900x` is gone (D4), or his first impression of the
system is ~90% fiction.

## D3 — Client prerequisites — HUMAN-GATED, the critical path

Nothing here can be built. All of it moves at D2 Pools' speed, and **E cannot start until the
first three are done.**

| Item | Needed for | Owner |
|---|---|---|
| **~7 crew-lead identities created** (none exist in the tenant at all) | crew leads signing in | David / Don |
| **~7 Business Basic seats** (~$6/user/mo) assigned to them | Power Apps + a real mailbox for dispatch | David / Don |
| **`Crews.LeadEmail` seeded with their UPNs** — not `mail` | the app showing a crew lead their own work | Stratirus, once identities exist |
| Real PM on `Jobs.ProjectManager` | double-booking alerts reaching a human | Don |
| 10 unmapped trades | George Crew is scheduled zero days until this lands | Don |
| 11 field-supervision sub-phases sitting in Unassigned | shared PM bucket, or named owner? | Don |

**The dependency is create identities → licence → install and sign in per handset, not merely
"buy 7 seats".** That lead time sits entirely upstream of E.

Until `LeadEmail` is populated, every user is a proxy and the app shows the office view. That is
correct behaviour, not a bug — the PM-proxy path is mandatory anyway, because the four
`Unlimited` subcontractor crews have no M365 seat by design and can never sign off for
themselves.

## D4 — Real data, and removing the fake

| Item | Notes |
|---|---|
| First real pool loaded | by REST, by us. There is **no browser-tool sync** — descoped deliberately, see G. |
| `TEST-900x` removed | 2 Jobs, 38 Assignments, 252 Tasks. Run `flows/testdata/cleanup.js`. |
| Harrison `D2-1001` removed | the browser prototype's demo job. `DROP_DEMO_JOB = true`. |
| Summary recipients flipped to Don | only after the above |

**Stop Flows E-D-R and Nightly Reconciliation before any bulk write** — the Event-Driven
Reconciliation trigger condition is a proven no-op, so every Assignments write burns a run.

Expected end state after cleanup: `assignments []`, `jobs []`, `tasks 0`.

## D5 — Known defects to resolve or accept

| Defect | Decision needed |
|---|---|
| **Event-Driven Reconciliation trigger condition is a no-op** — `GetOnUpdatedItems` emits no `@odata.oldValue`, so every edit fires it | It is currently **STOPPED**. Decide before restarting: flag column, in-row comparison, cheap in-flow gate, or accept the run cost. |
| 46 sub-phase durations still at a 2-day placeholder | Accept for go-live; replace from real actuals after the first few pools. |

---

## Phase D exit gate

- ✅ All eight views exist and render
- ✅ Daily summary answers "where are my crews today" with addresses
- ⬜ ~7 crew-lead identities exist, licensed, signed in on their own handsets
- ⬜ `Crews.LeadEmail` seeded with real UPNs, and a crew lead sees only their own work
- ⬜ One real D2 pool in Lists, with a real PM assigned
- ⬜ Zero `TEST-900x` rows, zero Harrison rows
- ⬜ Summary recipients pointed at Don
- ⬜ A decision recorded on the Event-Driven Reconciliation trigger

**Do not start Phase E until the crew-lead handsets are working.** The pilot is calendar-bound
and irreducible — it needs a real work week. Discovering a licensing or sign-in problem during it
would cost the whole week, and E and F are the two phases that cannot be compressed.
