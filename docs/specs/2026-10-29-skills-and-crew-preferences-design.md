# Spec: skills and crew preferences

Item 2 of the 28 October plan (`docs/2026-10-28-questions-solutions-plans.md`, section 2.2). Meeting
record: `docs/2026-10-28-status-meeting-notes.md`, decision 3. Shane's rulings of 2026-10-28 and
2026-10-29 are listed at the end with who made each call.

## Why

Don rates crews by how much he wants them on a given kind of work: who he reaches for first, who he
uses when nobody else is free, and who he keeps on the books but never calls. David wants the same
picture on the day Don is out. Today the planner cannot hold any of it. Its skill list is fixed in
code, each browser keeps its own copy of which crew holds which skill, and Auto-Schedule treats every
qualified crew as equal and picks the least loaded. The SharePoint lists that are supposed to be the
record (Trades, Crew-Trades, Crews) feed only the nightly `D2 - Crew Trade Check`, and nobody at D2
edits them.

This spec makes SharePoint the one copy, lets Don and David edit it from the Crews tab, gives every
crew a rating per skill and an overall rating, and makes Auto-Schedule and the nightly check honour
those ratings the same way.

## Goals

1. One copy. Trades, Crew-Trades and Crews in SharePoint hold skills, who has them, and the ratings.
   The planner reads them on Refresh and writes them on Save. The per-browser copy goes.
2. Don and David edit crews, skills and ratings on the Crews tab. Nobody else can change them.
3. A rating per crew per skill, 3 to 0, and an overall rating per crew where only 0 has an effect.
4. Auto-Schedule prefers a better-rated crew among those free on the day, never waits for one, and
   lists every place it settled for a lower rating so the PM can decide.
5. The drawer, the Board's crew picker, Schedule Check and the nightly `D2 - Crew Trade Check` all
   use the same definition of qualified as Auto-Schedule.
6. Don adds a skill or a crew from the Crews tab. A new crew can be assigned within minutes.
7. Day one changes no schedule. Until someone lowers a rating, every pick is what it is today.

## Non-goals

- Setting the trade on a template sub-phase. That stays in the Sub-phase Template list (the Build
  phases tab is read-only). Don's mapping of the 10 unmapped trades is data on top of this build.
- Moving work when a rating changes. Nothing is reassigned on its own.
- An overall rating of 1 to 3 changing a scheduling decision. It is stored and shown, and that is all
  (Shane, 2026-10-28). The cap rule, where the effective rating is the lower of overall and per
  skill, is the one to build if Don later wants the overall to rank crews.
- Capacity per crew (Rule 2's "STL can be on two pools but not five"). Still waiting on Don.
- The "if I pull this crew off, where are my gaps" view (plans document 2.6). A follow-on, half a
  session, once ratings exist.
- Deleting a crew or a skill. Don keeps every contractor on record; a crew leaves the rotation by an
  overall rating of Never.
- The canvas app. It does not pick crews.
- The downloaded `file://` copy of the planner. It keeps the frozen built-in crews and cannot save.

## Anti-goals (a failure even if it works)

- A rating change moves work already assigned, or clears a crew from a sub-phase. Both are silent
  rewrites of a PM's decision.
- A crew rated Never for a trade, or Never overall, is offered as qualified anywhere, or picked by
  Auto-Schedule.
- Auto-Schedule waits for a better crew and pushes a project out without saying so.
- A crew that was never rated (a null) is treated as excluded. The nightly check firing on every row
  is the documented way a check gets ignored within a week.
- A Save by someone other than Don or David changes a rating. Permissions on the lists are the gate;
  the planner only explains.
- A new crew's code reaches the Crews list but never reaches the Assignments dropdown and formula, so
  the crew exists and cannot be assigned, with no error anywhere.

## The scale, in Don's words

| Stored | Shown | Meaning |
|---|---|---|
| 3 | First choice | use this crew for this work when it is free |
| 2 | Second choice | fine; used when a first choice is not free that day |
| 1 | Last resort | used only when nobody rated higher is free that day |
| 0 | Never | holds the skill on paper; never offered, never picked |
| null | treated as 3 | an unrated row counts as held and first choice |

The same four words on the overall rating, with one difference: only Never does anything. A crew at
overall Never is out of every Qualified list and every Auto-Schedule pick for every trade, and its row
stays, as Don asked. First choice, Second choice and Last resort overall are recorded and shown.

A skill ticked on in the editor starts at First choice, because the chip cycle starts there (Shane,
2026-10-29), and a new crew's overall rating starts at First choice, which means no override. Both
match the backfill: holding a skill is first choice until someone says otherwise, and today every crew
holds every skill it has at that level. Lowering is the deliberate act.

**Qualified** for a trade means: a Crew-Trades row exists for the crew and trade, its rating is not
0, and the crew's overall rating is not 0. The three pseudo-trades (`@office`, `@sub`, `@unassigned`)
keep their fixed bucket crews and take no ratings.

## Data model

New columns, provisioned on the `provision-structure.js` pattern (sequential `CreateFieldAsXml`,
skip-if-exists, `D2_DRY` dry run, read back after the write), runnable through `tools/sp-proxy.js`:

| List | Column | Type | Default | Purpose |
|---|---|---|---|---|
| Crew-Trades | `Preference` | Number, 0 to 3 | 3 | the crew's rating for that trade |
| Crews | `Preference` | Number, 0 to 3 | 3 | the overall rating; only 0 acts |
| Crews | `Members` | Text | blank | comma-separated names; the planner's roster, which the shared-member warning and the "+2" names read |

Column names carry nothing D2-specific, so Plumbline lifts them as they are (Shane's design rule,
2026-10-28). `Trades` is unchanged: `Title` is the skill's name, `TradeCode` its code, `SortOrder` its
position. `Crews.Active`, `Unlimited`, `Size`, `LeadEmail` and `Notes` are unchanged.

**Backfill** (`sharepoint/stamp-preferences.js`, dry run by default, read back after): every existing
Crew-Trades row (51) and every Crews row (14) gets `Preference = 3`, and the seven field crews get
`Members` from the planner's built-in roster (the same names as
`D2-Build-Scheduler/D2-Build-Scheduler/data/crew-members.csv`). That is what makes day one schedule as
today.

**`Members` is plain text and that is the shape for this build.** It carries the names the planner
already holds per browser and nothing more. If a later client needs people as records (Plumbline, or
crew leads with accounts), that is a new list and a one-off migration of this column, not a change to
anything built here.

**A crew and trade pair is unique.** The editor never creates a second Crew-Trades row for a pair it
already has. The backfill script reports any duplicate pair it finds (none are expected in the 51
rows). If the mapper meets one anyway, it reports it in the console and takes the lower rating, so a
duplicate can only ever withhold a crew, never offer one that a row says is Never.

**Active and Never are separate.** `Active` is read by Daily Dispatch, Conflict Flag and the nightly
checks to mean "a working crew that gets its day's work". A crew at overall Never may still hold
sub-phases nobody has moved, and those still have to be dispatched, so Never does not touch `Active`.

**The `Assignments.Crew` dropdown and its validation formula.** `Crew` is a Choice column whose
choices are the crew codes, guarded by a validation formula listing the same codes (the Choice list
constrains the form only; the formula is what refuses a REST write). Adding a crew means updating
both. Updating a column definition over Graph needs delegated `Sites.Manage.All`, which the planner's
app registration does not hold, so the planner never touches the column. Instead a new flow does it as
D2 Bot: see **`D2 - Crew Sync`** below. The dropdown and the formula list every code ever created,
Active or not, because an old assignment still carries a retired crew's code and the formula is
checked on every save of that row.

## Permissions

Crews, Crew-Trades and Trades stop inheriting the site's permissions and get the same shape as the
template lists (gated 2026-10-28): Owners Full Control, Members Read, Visitors Read, Don Borgeson and
David Taylor Edit as named users. Done by re-running `sharepoint/gate-template-lists.js` with the three
lists added to `LISTS` (or a sibling script on the same pattern), dry run first, then the effective
permission check on each list for Don, David, a plain member and D2 Bot.

Every flow runs as D2 Bot, an owner, so nothing that reads Crews (Daily Dispatch, Conflict Flag, Crew
Trade Check, Calendar Sync) changes. The planner reads all three lists as the signed-in user, which
Read covers. Nothing else writes these three lists: no flow writes them, and the console applier never
touches them. The planner's item writes go over Graph as the signed-in user with delegated
`Sites.ReadWrite.All`, which covers creating, patching and deleting list items; `Sites.Manage.All` is
needed only for column definitions, which is why the planner never touches the Assignments column.
Delegated means the user's own SharePoint rights decide, and a named Edit on a list with broken
inheritance is exactly the shape the template lists have had since 2026-10-28, verified then with
SharePoint's effective-permission check. The same check is the acceptance test here, for Don, David, a
plain member and D2 Bot on each of the three lists. Writes from the planner by anyone other than Don or David fail with 403 from Graph, and
that refusal is the gate; the planner names it in the Save results ("Changes to crews and skills are
limited to the people set up to make them; nothing was changed") and leaves the on-screen edit in
place until the next Refresh, the same as any other refused write. The planner does not try to work
out in advance who may edit: the list of editors lives in SharePoint, and hard-coding names in the
planner would bake D2 into it.

## Planner: reading

Refresh reads Crew-Trades as well (new `D2_GRAPH.lists.ct`, 51 rows today). `graph-to-planner.js`
emits two new payload keys and leaves `crews` (the array of codes the template check reads) as it
is:

- `crewRows`: one object per Crews row: SharePoint id, `CrewID`, `Title`, `Size`, `Unlimited`,
  `Active`, `Members` (split on commas, trimmed), `Notes`, `Preference` (null kept as null), and
  `skills`: a map of trade code to rating built from Crew-Trades, with the Crew-Trades row id kept per
  entry so a rating change can be written back to its row.
- `tradeRows`: one object per Trades row: SharePoint id, `TradeCode`, `Title`, `SortOrder`.

The joins go through `String()` on both sides, because Graph returns `CrewLookupId` and
`TradeLookupId` as strings and `id` as a string (the Graph fixture rule). **Capture Crew-Trades into
`fixtures/planner/live-payloads-graph.json` with `capture-graph.js` before writing the mapping**, and
guard the join against the empty set: a Crew-Trades read that joins to no crew is reported in the
console and the planner keeps the previous crews rather than loading fourteen crews with no skills.

On a hosted Refresh `S.crews` is replaced from `crewRows` and `S.trades` from `tradeRows`; the fixed
`SKILLS` constant and `SEED_CREWS` remain only as the `file://` fallback and for tests. Each crew
records a baseline (`c.base`: overall, members, size, name, and the skills map with row ids) at
import, the way each sub-phase records `s.base`, so Save can compare before it writes. Skill labels
come from `Trades.Title`; pseudo-trade labels stay as they are. Crew and skill names are now shared
data painted into HTML on seven tabs, so they are escaped at construction everywhere, including the
new editor, the Board picker's option text and the Auto-Schedule report.

## Planner: the Crews tab becomes the editor

The tab keeps its shape (one row per crew, a Skill Coverage card below) and gains:

- **Skill chips that cycle on click.** Each click steps off, First choice, Second choice, Last
  resort, Never, off. The chip shows the word or number and a colour per rating; Never reads as red
  and off as the grey chip used today. Off means no Crew-Trades row; Never means a row at 0.
- **An overall rating control per crew row** with the four words.
- **Name, members and size** editable as today, writing `Title`, `Members` and `Size`. The crew code
  is shown and never editable after the first Save: it is the join key on every assignment.
- **Subcontractor** (`Unlimited`) shown per crew and settable on a new crew. Changing it on an
  existing crew is allowed, since it is one boolean, and the confirmation says what it does to
  double-booking.
- **+ Skill.** Asks for a name. Refuses a name that matches an existing skill ignoring case, spaces
  and punctuation (Don asked for the duplicate check). Creates a Trades row with the name as `Title`,
  a code made from the name (lower case, letters and digits only, made unique against existing
  codes), and `SortOrder` one past the highest.
- **+ Crew.** Asks for a name, a code (made from the name, editable until the first Save, must not
  match an existing code), size, whether it is a subcontractor, and members. The row is created with
  `Active` true, `Preference` 3 and no skills; skills are then ticked as on any crew. The preview and
  the Save results say the new crew can be assigned a few minutes after Save, once the dropdown has
  been updated (see `D2 - Crew Sync`), and that a Save assigning it before then is refused for that
  row and can be retried.
- **No delete.** The Delete button goes. The hint says a crew that should not be used any more is set
  to Never overall and stays on the list.
- **The three buckets** (Main Office, Subcontractor, Unassigned) are listed without chips or rating
  controls, with one line saying they are buckets and take no ratings.
- **Skill Coverage** lists the qualified crews per skill with their rating, and keeps the "not mapped
  to any sub-phase yet" column. Crews rated Never for a skill are not listed as qualified.

Edits are local until Save, like a sub-phase edit. The Save preview gains a **Crews and skills**
section listing each change in words with the loaded value beside the new one ("Harrison, Plumbing:
First choice to Second choice", "Campos: overall Never", "New skill: Electrical", "New crew:
Lopez +2, code lopez"). Compare-before-write is per field against `c.base`: a rating changed in
SharePoint since the load is refused for that cell and reported with both values, while the rest of
the batch lands.

**Write order on Save:** Trades creates first (a new skill must exist before a Crew-Trades row can
point at it), then Crews creates, then Crews field patches, then Crew-Trades creates, patches and
deletes. Turning a chip off deletes that Crew-Trades row. The Graph shapes (lookups written as
`CrewLookupId` and `TradeLookupId`, the `Title` a Crew-Trades row needs, a delete) are captured on
throwaway rows and read back field for field before the code is written, the way
`fixtures/planner/structure-capture.json` was made. The Crew-Trades `Title` follows whatever the
existing rows hold; read one before deciding.

The planner's Save results, the preview's wording and the two confirmations are pinned by
`honest-copy.js` in the usual way: a dialog claims only what the code does.

## Planner: scheduling

`qualified(skill)` returns the crews qualified under the definition above, each with its rating for
that trade. `isQualified` agrees with it. Everything that consumed `c.skills.includes(sk)` moves to
the rating map.

**Auto-Schedule.** The walk is unchanged: day by day, first working day after the previous sub-phase,
locked and signed-off rows never moved, not-applicable rows skipped. What changes is the order the
free crews are tried on a given day: **highest rating first, then least loaded, then crew code** (the
code keeps the determinism fix). It never waits for a better-rated crew (Shane, 2026-10-29: earliest
date wins). When every candidate is capacity-exempt, the best-rated one is taken, ties by code.

Two consequences, both intended. A crew busy that day is not a candidate for that day at all, so
rating before load can never double-book anyone; what it does is give a first-choice crew more of the
work over time, which is what first choice means. And a capacity-exempt subcontractor is free every
day, so a subcontractor rated Second choice is picked on a day the First choice field crew is busy;
that pick appears in the Your call list with the field crew's first free day.

A new rule in `AUTO_RULES`: "Among the crews free that day, the higher-rated one wins. It never waits
for a better crew; every place it settled for a lower rating is listed for you to decide."

**The Your call list.** After the run the report gains a group listing every sub-phase that got a crew
rated below the highest rating any qualified crew holds for that trade. Each line names the sub-phase,
the crew it got with its rating, the better-rated crew or crews, and the first working day on or after
the sub-phase's start on which the better crew is free for the whole span, computed against the busy
map after the run. Capped like the moves table. Nothing moves from this list; the PM changes the crew
in the drawer or on the Board, which reflows as it does today.

**Schedule Check.** The "not qualified" group now also catches a crew rated Never for the trade, or
Never overall, and the message says which ("rated Never for Plumbing", "rated Never overall"). There
is no warning for a crew rated below the best available; that would fire on most rows and is the
Auto-Schedule report's job.

**The drawer and the Board's inline crew picker** group the qualified crews under First choice,
Second choice and Last resort (empty groups omitted), then the Not qualified group as today, where a
crew rated Never is suffixed "(rated Never)" so the reason is visible.

## Flows

**`D2 - Crew Trade Check`** (nightly 05:15) treats a rating of 0 as not qualified, so the morning flag
agrees with the planner. `Get_crews` keeps `Active eq 1`; crews whose overall `Preference` is 0 are
left out of the qualification set, and `Filter_crew_trades` drops rows whose `Preference` is 0. A null
`Preference` is kept (unrated counts as held). The mismatch text distinguishes "does not hold" from
"rated Never for", which needs a second set of pairs for the Never rows. The `QualificationSetEmpty`
guard stays. Verified both ways on a throwaway Active project: a crew rated Never for a trade it holds
is flagged on that sub-phase and nothing else changes; setting the rating back clears it. Read the
`Preference` shape off a real run's `Get_crew_trades` output before writing the expression (a Number
column comes back as a number through the connector, and a null is omitted from the row entirely).

**`D2 - Crew Sync`** (new, flow 16). Trigger: SharePoint "When an item is created or modified" on
Crews. Reads every Crews row, takes the **union** of the codes it finds and the choices the
`Assignments.Crew` column already holds, and MERGEs the field with `Choices` and the validation
formula and message together, through `Send an HTTP request to SharePoint` with the `SP.FieldChoice`
metadata, exactly the route `sharepoint/guard-crew-values.js` uses. Never writes `SchemaXml` (that
wipes the formula). The union means the flow never removes a code: an old assignment may still carry
a deleted crew's code, and a code dropped from the formula would make that row unsavable, so a code
leaves the column only by hand (ruled 2026-10-29 after the first live run, which showed the earlier
"refuse a shrinking set" guard refusing every run after a row was deleted). Guards, each ending the
run Failed with an email to `stratirus@d2pools.com` and no write: a code outside `[a-z0-9]`; a Crews
read that returns nothing. After the write it reads the field back and fails the run if any code is
missing from either the choices or the formula. Idempotent: a run with nothing new rewrites the same
values. A Crews row Don adds on the list by hand is covered the same way.

Because the trigger polls, a new crew is assignable a few minutes after Save. Shane accepted that lag
on 2026-10-29 in preference to a planner-side column write. The planner does not guess at it: on every
Refresh it also reads the `Assignments.Crew` column definition (a Graph read of the list's columns,
which `Sites.ReadWrite.All` covers) and marks any crew whose code is not yet among the choices as
**not yet assignable**. The Crews tab shows that mark on the row, the drawer and Board pickers list the
crew greyed with the same words, and a Save never sends an assignment to such a crew; the row is
refused locally with "not on the crew list yet, press Refresh in a few minutes" rather than an HTTP
code. The same mark is how a missed sync shows: a crew still not assignable after a later Refresh means
the flow did not run, and editing any Crews row (a note, say) runs it again, since it rebuilds from all
rows. A polling trigger that was off replays its events when turned back on, so a stopped flow catches
up on its own. To remove a test crew: delete its row, then rewrite the column by hand with the live
codes (the proven MERGE body of `Choices`, `ValidationFormula` and `ValidationMessage`, as the
controller did on 2026-10-29), since the sync never drops a code.

Both flows are exported to `flows/exports/` after verification, the sync's definition kept in
`flows/scripts/` with an offline structural test like the New Pool ones, and both are added to the
`D2BuildSchedulerFlows` solution.

## Tests and gates

- `fixtures/planner/crews-editor.js` (new): the real page against stubbed Graph. Cycling a chip,
  the overall control, + Skill with the duplicate refusal, + Crew with the code rules, the preview's
  wording, the write order, every PATCH and POST body, compare-before-write refusals, the 403 message,
  and no delete control anywhere. With a mutation file.
- `rules.js`: a higher-rated free crew wins the day; a lower-rated free crew beats a higher-rated busy
  one (never waits); a crew at Never for the trade is never picked; a crew at Never overall is never
  picked for anything; an overall of 1 or 2 changes no pick; the Your call list names the right
  sub-phase and the better crew's first free day. Each watched red under `mutate.py`.
- `determinism.js`: still 0 drift across re-runs with ratings present.
- `graph-read.js`: the Crew-Trades join from the captured fixture, string keys both sides, and the
  empty-join guard.
- `escaping.js`: the probe in a crew name and in a skill name, across every tab.
- `honest-copy.js`, `schedulecheck.js`, `template-check.js` updated for the new payload and copy.
- `flows/scripts/test_crew_sync.py` and the Crew Trade Check structural test.
- `tools/planner-shakedown.js` in a wide headless Chrome, console clean.
- Live, read back over REST after each step: the backfill (51 rows at 3, 14 at 3, seven rosters);
  one rating change round-tripped; one throwaway skill created and showing in Skill Coverage; one
  throwaway crew created, the sync run, the Assignments column read back with the code in both the
  choices and the formula and the message intact, and a throwaway assignment saved to that crew; the
  Crew Trade Check both ways; the tenant back to its counts, the throwaway rows and skill removed.

## Sequencing

| Session | Work |
|---|---|
| 1 (half) | Columns, backfill, the gate on the three lists, Crew-Trades captured into the Graph fixture, the write shapes captured, `D2 - Crew Sync` built and verified, exports |
| 2 | Mapper, planner read, the Crews tab editor, the Save section, `crews-editor.js` |
| 3 | `qualified`, Auto-Schedule ratings and the Your call list, drawer and picker groups, Schedule Check, Crew Trade Check change, harnesses, shakedown, deploy |

Three sessions, at the top of the two-to-three estimate because of the sync flow and the editor's
create paths. The gate and the columns can land before any planner change with no visible effect: a
backfilled 3 schedules as today. The columns and the backfill go in one run, and nothing reads
`Preference` until the session 3 flow change, which treats a null as 3 in any case, so there is no
window in which a half-populated column changes a flag.

## Follow-ups this creates

- Guide, next major version: the Crews tab section is rewritten (it currently says the tab is a
  per-browser copy and to ask for permanent changes), with the four words and what Never does.
- CLAUDE.md: the business rule 1 entry (rule 1 now has a preference dimension), the flow table (row
  16), the Crews tab decision of 2026-09-16b (superseded for the Crews tab by this spec), and the
  `Assignments.Crew` entry (the sync flow now maintains the choices and formula).
- The "where are my gaps" view (2.6), once ratings exist.

## Left to the builder

- Chip colours and the exact label (word, number, or both) at each rating; the overall control's
  form (four buttons or a select).
- The code-from-name rule's edge cases (a name with no letters or digits; a collision suffix).
- How the Skill Coverage card shows ratings beside crew names.
- The Crew-Trades `Title` convention, read from an existing row.
- Where in the preview the Crews and skills section sits relative to the schedule sections.
- The sync flow's exact guard thresholds and email wording.
- Whether `Unlimited` on an existing crew confirms before changing or only on Save.

## Decisions

| Decision | By | When |
|---|---|---|
| Skills and ratings live in SharePoint; Don adds skills with a duplicate check; a rating per skill and an overall, 0 to 3; 0 keeps the row | Don and David, with Shane | 2026-10-28 meeting |
| 3 is first choice, 1 last resort, 0 never | Shane | 2026-10-28 |
| Only an overall 0 overrides; 1 to 3 recorded, no effect | Shane | 2026-10-28 |
| Subcontractors rated like any crew, still capacity-exempt | Shane | 2026-10-28 |
| Build the editor before chasing Don's trade mapping | Shane | 2026-10-28 |
| Design for Plumbline reuse, built here for D2 first | Shane | 2026-10-28 |
| Earliest date wins; higher rating breaks the tie on the day; the report lists each lower-rated pick | Shane | 2026-10-29 |
| The Crews tab adds crews as well as skills and ratings; no delete | Shane | 2026-10-29 |
| Ratings set by click-to-cycle chips | Shane | 2026-10-29 |
| The Assignments dropdown and formula are updated by a flow on the Crews list, not by the planner over Graph | Shane | 2026-10-29 |
| Roster moves to a `Members` column, plain text; Never does not change `Active`; null ratings count as 3; no standing warning for below-best picks; non-editors see live controls and a refusal at Save; Refresh reads the Assignments crew column to mark a crew not yet assignable; a duplicate crew and trade pair takes the lower rating | spec author's calls, flagged for review | 2026-10-29 |
