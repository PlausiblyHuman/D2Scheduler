# 2026-09-11b — Crew Trade Check, the parity audit, and a checkpoint

**Session goal:** started as "review the tasks, new screenshots for the artifact". Became: business
rule 1 has never been enforced anywhere on the SharePoint side, which Shane spotted and called
priority 1. Built the enforcer, audited the planner against SharePoint, and answered the site-AI
question.

> **This session ran CONCURRENTLY with 2026-09-11a.** Both were writing to this repo and to the
> live tenant. If something in the history looks like it appeared from nowhere, that is why.

---

## What shipped

**1. `D2 - Crew Trade Check` — the first thing in this system to enforce business rule 1.**
Flow id / workflowEntityId `a5f50628-eead-f111-aaac-6045bd0195dd`. Nightly **05:15 Central**.
Joins `Assignments.Crew` → `Crews.CrewID` → `Crew-Trades` → `Assignments.Trade` and writes
`Assignments.TradeMismatch` (Note, hidden from New/Edit). Writes only rows that changed.

Verified by **breaking it on purpose**, because a clean run of a checking flow proves nothing:
assignment 342 set to `brothers` (holds only pebbletech + plaster) on a Dig/Excavation sub-phase →
one row flagged, 65 untouched; reverted → cleared. Tenant back as it was.

**Scope, stated plainly:** only **22 of 46** sub-phases per pool carry a trade. The other 24 ride
the pseudo-trades `@office` / `@sub` / `@unassigned`, which resolve to **no Trade lookup**, are
bucket-routed by design, and are therefore a **PASS**. `Unlimited` crews ARE trade-checked —
unlimited means capacity-exempt (rule 2), never trade-exempt (rule 1).

**2. It cost 66 wrong writes first, and the fix is structural.** See "Traps" below. The flow now
terminates with `QualificationSetEmpty` rather than writing, if the join yields an empty set from a
non-empty source list.

**3. Parity map: `docs/planner-vs-sharepoint-parity.md`.** Eleven divergences between the browser
planner and this system, bucketed matched / easy / hard-with-the-wall-named / gap.

**4. CLAUDE.md corrected in three places** that were actively misleading: business rule 1's
"Verified via the Crew-Trades intersect list" (it was not), the `Unassigned` view's emptiness
(explained wrongly twice; the real cause is its CAML requiring `IsNotNull Trade` while the rows it
targets deliberately carry no trade), and `Jobs.StartDate` being "display-only" (it stopped being
true when the planner started importing it).

**5. PM guide artifact** → https://claude.ai/code/artifact/1cc7b6be-3fdb-4fc8-93b6-1899108bd6da
Now **Version 13**: welcome section cut, all seven screenshots retaken against the header-tabs site,
measured 9-10 minute build-time callout, delete-confirmation rule documented, **planner section
removed entirely** at Shane's request, overnight trap broadened. Guide sources now live in
`docs/pm-guide/` with a rebuild script — they were previously only in a session scratchpad.

**6. Request lists made usable.** All three (`New Pool Requests`, `Delete Pool Requests`,
`Reschedule Requests`) showed only `LinkTitle`, so a PM told to "refresh until Status says Done"
could not see Status. Real columns + `Paged=true`. `Status`/`Result` hidden from the New forms.
Script: `sharepoint/configure-request-lists.js`.

**7. Site header is white** (`HeaderEmphasis = 0`), separating it from the green hero band.

**8. Three research agents.** Crew audit, planner parity, and site-AI options. Findings folded into
CLAUDE.md, the parity doc, and the decisions below.

---

## Decisions Shane made

- **Business rule 1 is priority 1.** *"That was a huge point that you couldn't plan plumbing jobs
  for a carpentry crew."*
- **Detection, not prevention, is accepted** — matching the grammar already used for rule 2, which
  is also post-hoc. Column validation cannot do better; it cannot traverse a lookup into a second
  list.
- **Planner removed from the guide.** *"Just not quite ready to marry those yet. It can stay on the
  site, but it's not ready."*
- **Canvas app gets Day / Week / Month, defaulting to WEEK.** *"Daily is too myopic."* Second
  screens acceptable but not required; the requirement is that the first view is weekly.
- **Month is a grouped list by day, not a calendar grid.** One component, three ranges.
- **Planned pools shown with a badge**, not hidden. Shane's call, made after being told the risk.
- **Site AI agent: not now.** Blocked on capability, not cost — see below.
- **Work Calendar into the planner: HOLD.**

---

## NEXT TASKS

### 1. Client-gated, and overdue — do first

Held deliberately overnight so nobody stumbled on the system before the introduction email.
**That reason has expired.**

- **Add `david@`, `don@`, `emon@`, `cody@d2pools.com` to the M365 group**
  (`7b305c56-ceea-4838-9e58-90050a846204`). Adding to the **group** grants the site *and* the
  group calendar in one step. As of now the group has **one member, D2 Bot**, so every link in the
  PM guide fails for all four of them.
  Watch the duplicates: David Taylor and Amy Stevens each have a second `#EXT#` identity from
  `d2install.com`. Use the `@d2pools.com` ones.
- **Repoint `D2 - Daily Summary` and `D2 - Weekly Summary`** at the real audience. Currently both
  send only to `stratirus@d2pools.com`. One-token edit in each `Send_summary`. The guide promises
  these arrive.

### 2. Finish the trade check — it is currently INVISIBLE

**I verified this and it is my omission, not a design choice: no view surfaces `TradeMismatch`.**
All nine Assignments views were checked; none includes the column. The flag is written and nobody
can see it.

- Add a **Trade Mismatch** view on Assignments, filtered `TradeMismatch IsNotNull`, with the card
  formatter, and a nav entry under **Attention**. Model on the `Conflicts` view
  (`sharepoint/provision-views.js`, `sharepoint/format-views.js`, `sharepoint/build-navigation.js`).
- A view formatter **may not contain a raw `<` or `&`** — it is persisted inside the view's XML and
  fails the whole MERGE with HTTP 500. Flip operands to use `>`/`>=`, express AND as a nested `if`.

**Also in scope per Shane: the hourly diff flow.** Conflict Flag and Crew Trade Check both make a PM
wait until morning. Two precedents already exist in this repo, read both before designing:

- **`D2 - Calendar Sync` was made hourly AND incremental** by the parallel session (commit
  `23d3c18`). That is the closest working template for "hourly but cheap".
- **`D2 - Event-Driven Reconciliation`** already has a **version-history gate** that fires on an
  Assignments edit and proceeds only when `Crew` or the dates changed. A `Crew` change is exactly
  the trigger a trade check wants, so this may be an addition to an existing flow rather than a new
  one.

Watch the cost: every Assignments write fires Flow 3. Do not add a write-per-tick path.

### 3. Crew↔trade mappings: use the browser HTML as the source

Shane: *"The HTML has all the correct mappings for all crews. Use that as a source."*

Source is `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`:
`SEED_CREWS` (L175-208) carries `skills: []` per crew; `SEED_TEMPLATE` (L137) carries one `skill`
per sub-phase.

**Read this before starting, it will save a wasted pass.** The parity audit verified that all 14
crews' `SEED_CREWS.skills` **already match the live `Crew-Trades` join exactly** — because
`Crew-Trades` was seeded *from* `SEED_CREWS`. So for crew→trade this is currently a **no-op**, and
the value is in making the HTML the standing authority and adding a drift check, not in a one-time
import.

**The 10 unmapped trades are NOT solved by this**, and it is important not to chase that: the
planner does not map them either. 16 of 26 trades are used by the 46 sub-phases; `cmu`, `form`,
`grade`, `landscaping`, `masonry`, `materials`, `pavers`, `veneer`, `walls`, `waterline` are not.
`george` holds only `cmu` and `masonry`, both unmapped, which is why he is scheduled zero days.
That still needs Don, or an explicit decision to drop those trades.

**Confirm with Shane** whether he also meant sub-phase→trade, i.e. populating
`Sub-phase Template.Trade` from `SEED_TEMPLATE.skill`. Do not assume.

### 4. Canvas app: Day / Week / Month on Screen1 — BUILD

Design settled and approved. **A spec was promised and never written; write it first** to
`docs/superpowers/specs/`, then plan, then build.

- Query changes from "spans today" to **overlaps the range**:
  `ScheduledStart <= gblRangeEnd AND ScheduledFinish >= gblRangeStart AND NotApplicable = false`.
  Same two date comparisons, so delegability is unchanged.
- Globals `gblRangeStart` / `gblRangeEnd` / `gblRangeMode`. **Default Week, Mon–Sat.**
- Range result into a **local collection**; day headings computed from it. Keeps grouping out of
  delegation's way and leaves the existing row card untouched.
- **The crew picker filters on today too** (`Screen1.pa.yaml` ~L291) and must move to the same
  range, or the screen contradicts itself.
- **Mark today's rows and open scrolled to today**, so a crew lead still lands on their own day.
- Planned pools shown **with a badge**. Proxy refinement offered and not answered: crew leads see
  Active only, proxies see everything badged. Written in as one guarded condition, easy to delete.
- **Two defects to fix in the same pass:** `gblToday` is set once in `App.OnStart` and never
  refreshed, so an app left open overnight shows the wrong day — move to `Screen1.OnVisible`. And
  the gallery has no `Jobs.Status` filter at all.
- **Do not touch `scr_Tasks`.** The sign-off path works and is verified.
- Deploy loop: `python canvas-app/deploy.py`, then the Studio save + publish. **Batch the work and
  ask for ONE publish.**

### 5. HOLD — Work Calendar into the planner

Shane: hold. Recorded so it is not re-raised: the planner's `isWork` is `d.getDay() !== 0` and
nothing else, `importFromD2` never reads the imported finish date, so every holiday-crossing span
renders a day short and those wrong spans feed its own conflict checks. About 30 lines when it
comes back. `oracle-test.js` invariant #9 already fails on it.

---

## Open, not urgent

- **`D2 - Delete Pool` strands calendar events.** Cause understood. Blocked on a Dataverse
  connection reference that does not exist; two `edit_flow` attempts failed and rolled back cleanly.
  Better fix now known: the Groups connector exposes `HttpRequestV2`, so Calendar Sync could
  enumerate `GET /groups/{id}/events` and self-heal.
- **Work Calendar expires 2029-12-30** and nothing maintains it. Sundays are computed so they are
  correct forever; holidays are list-driven and silently become work days past the horizon.
- **Durations are still a 2-day placeholder** on every template row. Client-gated.
- **The `Unassigned` view shows 0 rows** because its CAML requires `IsNotNull Trade` while the 11
  rows it targets carry no trade. A design question for Don's mapping, not a typo.
- **`PMSignOff` exists on both sides, wired on neither.** Consequence: the planner's Schedule Check
  will warn on every finished sub-phase forever once it imports.
- **Site AI agent — revisit only if the free test passes.** Blocked on capability not cost: a
  SharePoint agent grounds on **one list at a time** and cannot combine Jobs + Assignments + Tasks,
  and counting/filtering queries are documented as unsupported. D2 is on **Copilot Business
  ($21/user/mo)**, not the $30 SKU. All four Copilot seats are consumed by Don, David, **Amy and
  Carolyn** — neither PM has one, so covering Cody and Emon may be a reassignment rather than a
  purchase. Free 20-minute test: Don or David creates an agent on the Assignments list and asks five
  questions with known answers; if the single-row lookup fails, the idea is dead.
- **`flows/definitions/` is stale and must not be used to restore anything.** Use
  `flows/exports/`, compared by **content**, never by filename date.

---

## Traps learned this session

**The connector-vs-REST shape trap, sixth instance, and it cost 66 wrong writes.**
`Crew-Trades`' lookup columns are named `Crew` and `Trade`, so **raw REST** exposes
`CrewId`/`TradeId` while the **connector** returns `Crew`/`Trade` as `{Id, Value}`. The flow read
connector output using the REST names, the filter matched nothing, the qualification set stayed
empty, and **every checkable row was flagged unqualified with every action green**.

Three fixes applied, only one of which is prose:

1. **The flow guards itself.** `Guard_qual_not_empty` terminates with `QualificationSetEmpty` if a
   join yields an empty set from a non-empty source. Copy this into any future cross-list join.
2. **The skill `power-automate-flow-mechanics` now leads with an observable predicate** — which
   action produced this output decides the naming — and its description now triggers *before*
   authoring. **Invoke it before writing any expression that reads a SharePoint column.**
3. CLAUDE.md routes to the skill instead of carrying a seventh retelling.

**Two insights worth keeping:**

- **Reading a column's internal name off the list schema tells you nothing about its shape.** That
  is the mechanism: you look up `CrewId` over REST, where it is genuinely correct, and carry it into
  a connector expression without noticing the surface changed.
- **A REST probe cannot validate a connector expression.** Mine returned 0 mismatches and was
  correct, and proved nothing. Evidence about a flow has to come from the flow.

**A clean run of a checking flow proves nothing.** Break it on purpose, both directions, and confirm
the source data is restored.

---

## Next action

Grant the four D2 accounts group access and repoint the two summary flows, then build the Trade
Mismatch view and the hourly diff flow.
