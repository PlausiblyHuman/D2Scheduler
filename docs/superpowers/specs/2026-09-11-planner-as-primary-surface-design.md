# Promoting the browser planner to the primary surface

Design spec, 2026-09-11. Author: Claude, for Shane Talbot.

**Status: approved and sequenced as Phase H, 2026-09-11c.** This is the build phase inside the
client-facing **Phase 2**. Two numbering schemes are in play deliberately: D2 hears "Phase 2",
the repo says "Phase H", and H continues the A-G lettering that matches the AzDo epics.

**RESEQUENCED: H RUNS AHEAD OF PHASES E AND F.** Shane's call on 2026-09-11c, as an immediate
need. An earlier note here said the opposite; that reasoning rested on the Azure subscription
being client-gated, which turned out to be false, and the remainder of it now argues for going
first. The office gets trained **once**, on the surface it keeps, rather than on SharePoint views
in Phase F and again afterwards.

Consequences, carried in full under Risks below: Phase F's Day 2 training material has to be
rewritten, the PM guide already sent to the client needs reissuing, and the five parity
divergences move onto the critical path.

---

## What this is

Host `pool-scheduler.html` on Azure Static Web Apps in D2's own Azure tenant, connect it to
live SharePoint data through Microsoft Graph, repaint it into D2's brand, and let it become
the office surface. SharePoint Lists stays the database. The fourteen Power Automate flows
stay the engine. The schema, the business rules and the canvas app are untouched in Stage 1.

Delivered in three stages. Stage 1 is read-only and independently shippable.

## Why

Ryan raised that the presentation layer looks cookie-cutter. The client has seen
`pool-scheduler.html` and is expecting that level of finish.

The planner already carries seven tabs, Job Board, Crew Board, Daily Dispatch, Sign-Offs,
Jobs, Crews and Phase Template, which is close to the whole office surface the SharePoint
views are attempting. `docs/planner-vs-sharepoint-parity.md` section C lists five planner
capabilities that are hard to match in SharePoint, and four of the five walls it names are
SharePoint walls specifically: the Gantt view type is not Modern-compatible, a crew-by-date
pivot is not a CAML view, a list form cannot run a cross-row query, and SharePoint has no
point-in-time restore. None of those constraints exist off SharePoint.

So the cheapest route to what the client wants is to host the thing they already approved,
rather than build a rival to it.

## Verified facts

These were checked against the live tenant on 2026-09-11, not assumed.

- **D2 has no Azure subscription.** Authenticated as `stratirus@d2pools.com` against tenant
  `f24d9b39-6a71-4f4e-a376-03b6f61c97e4`, `az account list` returns
  `N/A(tenant level account)` and the ARM subscriptions call returns empty. The only
  subscription on this machine is `INTERNAL_BILL`, in Tennetech's tenant.
- The planner is a single file, 910 lines, zero dependencies, zero `fetch` calls, state in
  `localStorage` under `poolsched.v6`.
- `sharepoint/export-to-planner.js` reads Jobs, Assignments and Tasks over SharePoint REST
  with `credentials: 'include'`, which works only because it runs on the SharePoint origin.
- A real SharePoint REST payload is already captured at
  `fixtures/planner/live-payloads.json`, 151 KB.
- `fixtures/planner/roundtrip.js` runs the real HTML in jsdom and pins 16 behaviours.

## Open assumptions

Stated here rather than buried, because each one could change the build.

- Azure Static Web Apps Free tier is assumed sufficient (custom domain, managed Entra auth,
  100 GB bandwidth per month). Confirm against Microsoft's published tiers at signup.
  Free has no SLA, which is the reason to revisit Standard later.
- The delegated Graph scope is assumed to be `Sites.Read.All` for Stage 1 and
  `Sites.ReadWrite.All` for Stage 2. Delegated scopes never exceed the signed-in user's own
  permissions, so the effective access is the user's, not the app's. `Sites.Selected` is the
  tighter alternative if D2's admin objects to the broader name. Decide at registration.
- Graph list-item field shapes are **not** assumed. See the capture rule below.

---

## Architecture

```
Browser (Azure Static Web Apps, D2 tenant)
  pool-scheduler.html + MSAL.js
        |  delegated Graph token, user's own permissions
        v
  Microsoft Graph  /sites/{siteId}/lists/{listId}/items?$expand=fields
        |
        v
  SharePoint Lists  (unchanged)
        ^
        |  unchanged
  14 Power Automate flows
```

No backend, no server code, no secrets anywhere, no service principal holding standing
access to client data. The app is static files plus a browser-side token. Every read and
write carries the signed-in user's identity, so SharePoint permissions apply as they already
do.

### Why Graph and not SharePoint REST

The existing export script calls `/_api/web/lists/...` with cookies. From a different origin
that fails: SharePoint REST does not serve CORS to arbitrary origins and the cookies will not
travel. Graph is CORS-enabled and takes a bearer token, so the read layer has to move.

### The capture rule, which is not optional here

This project has lost six separate cycles to assuming a column's shape instead of reading it.
Graph is a **third** surface alongside SharePoint REST and the Power Automate connector. The
`Crew` Choice column, the `Job` lookup on Assignments and the `Assignment` lookup on Tasks all
come back differently depending on which surface asked.

Before any mapping code is written, capture a real Graph payload for all three lists into
`fixtures/planner/live-payloads-graph.json`, mirroring the REST fixture that already exists.
Write the mapping from that file. A REST probe does not validate a Graph expression.

---

## Stage 1: hosted, branded, read-only

The demo. This is what goes in front of the client.

### 1.1 Hosting

An Azure subscription is created in D2's tenant. Shane has admin rights and does this
himself, so it is not a client-gated step. Creating a subscription is free and the Static Web
Apps Free tier is free, so nothing is ever charged, but a pay-as-you-go signup still asks for a
**payment method on file**.

**Use D2's billing details, not Stratirus's.** The card decides who owns the subscription, and
D2 owning it is the whole reason this design chose Azure over Netlify. Signing up on Stratirus
billing would make Stratirus the owner of infrastructure D2 depends on, which is the continuity
problem the hosting comparison below rules out.

Deploy through Azure DevOps Pipelines, which this repo already uses. Static Web Apps supports
Azure DevOps as a deployment source, so no new toolchain and no GitHub dependency.

**Hosting options considered.** Raised by Shane, recorded so it is not re-litigated.

| Option | In D2's tenant | Cost here | Verdict |
|---|---|---|---|
| Static Web Apps | Yes | $0 | Chosen |
| App Service | Yes | Free F1 has no custom domain and cold starts; B1 about $13/mo | Paying for compute that runs no code |
| Netlify | No | $0 | Better tooling, wrong owner |

App Service satisfies the hosting requirement and its Easy Auth is nicer than wiring MSAL by
hand, but there is no server in this design and Stage 2 does not add one, because writes go
from the browser to Graph.

Netlify would never see D2 data, since it serves static files while the Graph calls go browser
to Microsoft directly. The objection is ownership and continuity: D2 would need their own
Netlify account for D2 to be the host, which is a new vendor relationship for an all-Microsoft
shop and another login for whoever inherits this.

Static Web Apps also forecloses the least. It includes managed Azure Functions, so if Stage 3
needs a confidential client for on-behalf-of, or server-side caching of the 885-row Tasks
read, that is a folder in the same app rather than a migration.

**Fallback, if the Azure signup stalls.** Deploy to Netlify on a Stratirus account to unblock a
client demo before the pilot, and move it once D2's subscription exists. The app is static
files and MSAL auth is unaffected by where they are served from, so the move costs an
afternoon. Use this rather than letting a billing form block the demo.

### 1.2 Repo layout

Move `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html` to `web/index.html`.
Move, not copy. This repo has already been burned by a described-but-nonexistent
`patched-tool/` directory and by `flows/definitions/` drifting behind live, so one copy is the
rule. Add `web/staticwebapp.config.json` for the auth route and SPA fallback.

No bundler, no framework, no build step. The file has zero dependencies today and the only
addition is an MSAL script tag.

### 1.3 Auth

One Entra app registration in D2's tenant, SPA platform, redirect URI set to the Static Web
App URL. MSAL.js acquires a delegated Graph token in the browser. One admin consent click,
once, by a Global Admin.

Static Web Apps' own built-in auth is not used for identity. It can stay on as a coarse gate
so the site is not anonymously reachable, but the token that reads SharePoint comes from MSAL.

### 1.4 Read layer

Replace the console-paste export with an in-app load. The "Load from D2" button stops asking
for a file and calls Graph directly. Page through Assignments (138 rows today, 46 per pool)
and Tasks (885 rows today, 295 per pool), both of which will exceed a default page.

Keep the existing merge semantics. `importFromD2` merges by job number, leaves local-only
pools alone, and takes structure from the local phase template rather than from the payload.
That design is deliberate and tested, and it means a partial or malformed response cannot
corrupt the template. Do not replace it with a wholesale state swap.

### 1.5 The five divergences that must close before this is primary

The parity map lists eleven. Six can wait. These five produce visibly wrong output the moment
the planner is the surface people look at, and they are the real work in Stage 1.

**D7, Work Calendar.** `isWork = d => d.getDay() !== 0` is the planner's entire work-calendar
model. `D2 - New Pool` and `D2 - Reschedule Pool` both test a `nonWork` set of 35 holidays.
Every sub-phase whose SharePoint span steps over a holiday renders a day short, and the wrong
span then feeds `conflicts()`, so it can miss a real overlap and invent a sequence error. Fix
is roughly thirty lines: carry a `nonWork` array in the payload, add it to state, and extend
`isWork`. The parity map ranks this first and `oracle-test.js` invariant 9 already fails on
it, so the test is waiting.

This lifts the hold Shane placed on the Work Calendar fix. That hold was correct while the
planner was a scratchpad. It does not survive the planner becoming primary.

**D2, PM sign-off crying wolf.** `PMSignOff` is written `false` once by `D2 - New Pool` and
read by nothing else in the system. The export faithfully carries it, so Schedule Check fills
with "missing PM sign-off" on every finished sub-phase, 51 rows on current demo data, with no
way to clear any of them. Drop the PM half of the finished-but-unsigned check until PM
sign-off is a real workflow. Schedule Check is the planner's best feature and it is unusable
on day one otherwise.

**D8, `Tasks.NotApplicable` is not exported.** An N/A task imports as not done, so a sub-phase
legitimately signed off at 5 of 6 renders permanently incomplete. Carry the field and give the
planner a third task state. The N/A rule is the most deliberated decision in CLAUDE.md and the
planner currently cannot represent it.

**D9, `Jobs.Status` is exported and discarded.** A `Planned` pool appears on the Gantt, the
Crew Board and Daily Dispatch exactly like a live one, and raises double-book errors, which
inverts the 2026-09-09 decision on the one surface a PM uses while choosing dates. Badge them
rather than hide them: the reflow's own conflict sweep is deliberately tenant-wide for the
same reason, so showing them is right, and only the absence of a label is wrong.

**D4, `Jobs.StartDate` drift.** The field is no longer display-only. `autoSchedule` uses it
twice, to order pools and to seed each pool's cursor. Whitfield reads `2026-09-21` on Jobs
while its first assignment starts `2026-06-15`, so Auto-Schedule on that import produces a
plan anchored three months late. `sharepoint/fix-job-startdates.js` corrects the three demo
rows; the flow gap behind it stays open and is tracked separately.

### 1.6 Divergence state, which the planner has no concept of today

D11: four actions rewrite every unlocked row in every pool, and there is no dirty flag, no
last-loaded stamp and no diff view. A PM cannot tell whether the Gantt is the live schedule or
something they reflowed twenty minutes ago. That is tolerable in a local scratchpad and not
tolerable in a live-data app.

Add a freshness stamp in the header ("Live as of 14:32") and a per-pool modified marker. Small
change, and it is what makes a live app trustworthy to the person using it.

### 1.7 Brand

The planner is teal `#0f766e` on `#0b1220` with a system font stack, which matches nothing
else in this system. The site theme, the list-view cards, the canvas app and the summary
emails already share the measured D2 palette read from d2pools.com: navy `#082544`, green
`#0B594B`, cream `#F6F3ED`.

Repaint to those three. Load Poppins and Source Sans Pro from Google Fonts, which SharePoint
refuses to do and our own hosting has no trouble with. Leave `crewColor()` alone, since crew
bars need to stay mutually distinguishable and are not brand surfaces.

### 1.8 What retires

**Already done at the go-live cut:** the `Planner (download)` nav link was pulled on
2026-09-11c by `sharepoint/pull-planner-link.js`, because the planner was discoverable in the
nav while absent from the PM guide, and untrained use of it produces a wrong plan rather than
an incomplete one. `build-navigation.js` carries the same link commented out with the reasoning.

Phase H restores it in the same position under Pools, pointing at the Static Web App instead of
`download.aspx`. Delete `Shared Documents/pool-scheduler.html` at that point so there is one
planner and not two. It was deliberately left in the library at go-live, since Phase H wants it.

The PM guide artifact had its planner section removed at Shane's request. It goes back in,
pointing at a URL this time.

The SharePoint views stay exactly as they are. They stop being the surface anyone is sent to
and become the admin and data-correction surface, which is what they are good at.

---

## Stage 2: writes, through the flows that already exist

No new business logic in the browser. Every structural write goes through a flow that already
owns the rule.

| Action | Route | Exists |
|---|---|---|
| Create a pool | Create a `New Pool Requests` row over Graph | `D2 - New Pool` |
| Delete a pool | Create a `Delete Pool Requests` row | `D2 - Delete Pool` |
| Reflow a schedule | Create a `Reschedule Requests` row | `D2 - Reschedule Pool` |
| Reassign a crew, move a date | Write `Assignments` directly over Graph | Event-Driven Reconciliation picks it up |

The three request-list flows trigger on item creation, which a browser app can do over Graph
as the signed-in user. No flow signature changes, no HTTP-triggered flows, and therefore no
premium connector. The zero-premium constraint holds.

Two things this stage has to handle that Stage 1 does not:

**Concurrency.** The planner is single-user local state and last-write-wins. That is invisible
while nothing writes back. Two PMs both loading, editing and pushing becomes a real collision
in Stage 2. Direct row edits use SharePoint ETags with `If-Match`. Structural changes go
through request lists, which serialise naturally.

**Run latency.** `D2 - New Pool` measured 9m 03s and `D2 - Delete Pool` about 6m on a
three-pool tenant. The UI has to show request status and say so, the same callout the PM guide
already carries, or it will look hung.

D10 closes here: create and delete stop being silently local, and the two independent
job-number generators collapse to one.

---

## Stage 3: the field surface, post-pilot

Out of scope for the pilot. Field sign-off works, is verified end to end, and swapping it
costs Phase E calendar that does not exist.

Afterwards the canvas app is the odd surface out, and the question is whether the field
becomes a mobile route on this same app. If it does, sign-off needs a path that does not exist
yet: `Sign-off Intake`, `D2 - Task Tick Batch` and `D2 - Reopen Sign-off` all use PowerApps V2
triggers, which only Power Apps can call. Converting them to HTTP triggers means a premium
connector. The standard-tier answer is a fourth request list following the pattern of the
other three, keeping attribution inside the flow where `ensureuser` already resolves the real
site user.

That decision is deferred. It is recorded here so Stage 2 does not accidentally design it out.

---

## Testing

- `fixtures/planner/roundtrip.js` runs the real HTML in jsdom and pins 16 behaviours. It must
  still pass after the repaint and the five divergence fixes.
- `oracle-test.js` currently scores 14 of 16, with the two known failures being the work
  calendar and Don's unmapped trades. The D7 fix should flip invariant 9 to pass. That is the
  verification gate for the work-calendar change.
- Capture the Graph payload fixture before writing mapping code, and add a fixture test that
  the mapping produces the same planner state as the REST fixture does.
- Verify the deployed app by loading it, not by the pipeline status. This codebase's dominant
  failure signature is a write that returns success and renders nothing.

## Risks and gates

**The Azure subscription is NOT a client gate. Corrected 2026-09-11c.** Shane holds admin rights
to create it himself, so this moves at our speed and Phase H has no client-gated dependency at all.
The earlier framing here, that it would move at D2's speed and should be budgeted accordingly, was
wrong.

Two decisions remain, neither of them a delay. A pay-as-you-go signup asks for a **payment method**
even though the Free tier is never charged. And **whose card decides who owns the subscription**:
D2's card keeps ownership where "D2 hosts it" puts it, while Stratirus billing would make Stratirus
the owner of infrastructure D2 depends on, reintroducing the continuity problem this design chose
Azure to avoid.

**Graph shape assumptions.** Mitigated by the capture rule above, which is the only mitigation
that has ever worked on this project.

**The planner's own bugs get exercised harder.** Two are recorded and neither is a Stage 1
blocker: `qualified()` and `isQualified()` disagree on the `FIXED` pseudo-trade codes, so
picking STL Shotcrete for an `@office` sub-phase raises no error at all; and `autoSchedule`'s
busy map does not exempt `unlimited` crews while `busyMap()` does, so a subcontractor can be
skipped as busy in violation of rule 2's capacity exemption. Fix both in Stage 2.

**Training once, now that H goes first.** Phase F trains the office on whatever the office
surface is when it runs, so with H ahead of it that is the hosted planner and there is no
retraining. **But Phase F's Day 2 material currently documents the SharePoint views** and has to
be rewritten before Phase F runs. That is a tracked task, not an afterthought.

**Piloting on a new interface is the risk this sequencing buys.** Phase E exists to test the
system under real work. If the UI is also new, interface bugs and system bugs surface together
and are hard to tell apart, which is exactly the failure mode recorded for the canvas app, where
three simultaneous faults produced a confident wrong conclusion. Mitigate by exercising the
planner against the three demo pools before Phase E, so the pilot is not its first real use.

**The client has already seen the planner and is expecting that finish.** They get the
SharePoint surface first. Someone needs to tell David and Don explicitly that the UI is Phase 2,
or pilot feedback comes back as comments on the interface rather than on whether the system
works. This is a positioning task, not an engineering one, and it belongs to Shane.

## Cost

Microsoft list pricing, which is the only cost basis this repo treats as sound.

- Azure subscription: free to create, pay-as-you-go.
- Static Web Apps Free tier: $0. Standard is $9 per month if an SLA or more bandwidth is
  wanted later.
- Entra app registration: $0.
- Custom domain on `d2pools.com`: $0, needs one DNS record.

Expected steady state is $0 per month. Build effort is the cost, and the five divergence fixes
are the bulk of it rather than the hosting.

## Non-goals

- Not a rewrite of the planner. It stays vanilla JS in one file until something forces
  otherwise.
- Not a change to the schema, the flows or the business rules in Stage 1.
- Not Dataverse, not premium connectors, not Managed Environments.
- Not a replacement for the SharePoint views, which stay as the admin surface.
- Not a decision about the canvas app's future.
