# D2 / Stratirus status meeting, 2026-10-28

8:00 to 9:00 Central, Teams. Shane, Don, David. Amy and Carolyn invited, not on. Sources: the
Teams recording (`Documents/Recordings/D2  Stratirus Status Meeting-20261028_125952UTC-Meeting
Recording.mp4` in Shane's OneDrive, Stream transcript read from the player; Stream expires it in
120 days) and the Facilitator's Loop notes (`Documents/Meetings/D2  Stratirus Status Meeting
2026-10-28.loop`). Agenda that was followed: https://claude.ai/artifact/9186937XNeLkVtHZtGqDu1.

## What Don saw on screen

Don shared the hosted planner. The Jobs tab Features button opened the drawer, with the "New in
the template" heading and nothing he could click. On the Phase Template tab the rows did not open
(they are read-only by design since 2026-10-13). Shane said what he built was not showing and he
would get back to Don on where custom template items are added.

What was happening, from the build as deployed (`deploy/2026-10-27b`): the drawer lists optional
features only once a Sub-phase Template row is marked Optional, and lists "New in the template"
rows only for template sub-phases the project does not already carry. Don's templates hold no
Optional rows yet and his Gunite projects already carry every Gunite template row, so both lists
were empty. If he had not pressed Refresh since the deploy, the drawer shows "Press Refresh first"
instead. Either way the control was working and had nothing to offer. The guide has to say this
plainly, and Don needs the half-page on adding an optional sub-phase to the template.

## Decisions

1. **Optional features are feature templates added to a basic pool template.** Don chose "basic
   template, then add what the pool has" over "one master template, remove what it does not
   have", because remembering every possible feature to remove is harder than picking the ones
   present. The same feature template is used standalone on an existing pool (a job that is only
   a water feature or a fire feature). This is the model already built: a feature is a group of
   template rows marked Optional with a Feature name, picked at `+ Job` or switched on from the
   Features drawer.
2. **Don's first list of optional features:** auto cover, water feature, fire feature, spa,
   diving board, grotto, slide. Water-feature variants (spillover, waterfall, deck jets, blade,
   scuppers) stay under one water feature, with the specific item named in notes or the job name,
   so the catalogue does not sprawl. Don builds the feature rows himself as he goes; Shane warned
   against ending up with 110 near-identical features.
3. **Skills and crew ratings.** Don adds skills to the master list himself (electrical and gas
   line are missing today), with a check that a new skill does not duplicate an existing one.
   Each crew gets a preference per skill, 0 to 3, and an overall crew preference, 0 to 3, which
   overrides the per-skill ones. 0 means never considered for anything; the crew stays on the list
   (Don keeps every contractor on record, like a CRM, and never deletes one). David's A/B/C tiers
   and "red means do not use" are the same idea. Shane called it preference rather than skill
   because it also covers cost. Scale beyond 0 to be settled.
4. **Job numbers come from the tool.** Format `YY-NNNN`: the year the job went under contract,
   then a running number (Shane suggested starting a 3000 series). No type letter in the number;
   the build type goes in the job name. Shane will look at auto-tagging a job from the features it
   was created with (Gunite, auto cover, fire, water, pool house), because auto covers in
   particular get forgotten until the build is half done.
5. **Mark complete gets an admin override.** Today a project can be marked complete only when
   every sub-phase is signed off. Don and David want to close a project regardless; a PM still
   needs everything signed. Don keeps a project on the list until final payment, which on
   commercial work can be 90 days.
6. **Payment draws as a soft gate.** David wants to see, in the planner, that the next draw is
   due when a phase starts, without calling Don or a PM. Don wants a flag, not a block: an ACH
   can take three days to clear and work carries on. Shape discussed: the draw is a template item
   (a zero-day sub-phase such as "submit invoice for draw" after the hardscape sign-off), assigned
   to David or Amy, shown red until satisfied; scheduling runs through it. Draw points can differ
   per job. A hard stop comes later with the accounting piece. Shane will think about solutions.
7. **Bulk changes need a heads-up.** The planner runs on SharePoint and is beta infrastructure.
   Don will tell Shane before adding or removing more than two or three projects in a day, so a
   build is not in flight and the lock-up of 2026-10-23 does not recur.
8. **A programmatic reset later, not now.** Many loaded projects are Fiberglass built on the
   Gunite template before Fiberglass existed, and are wrong. Don asked about wiping the jobs and
   starting over with fresh templates. Shane: do it programmatically when the optional features
   are built and the templates are solid (keep the two or three pools that are right, remove the
   rest), not by hand and not yet.
9. **Shared calendar stays paused.** Don had never found it and uses the planner as his calendar.
   Both agreed functionality comes first; the calendar is a later nicety.
10. **Gunite closeout.** Don: the Gunite build should end the way Fiberglass does, with phases 8,
    9 and 10 (trim out, site restoration and final grade, cleanup, seed and straw). Gunite Rev4
    already carries these as phases 8 to 11, so the Rev4 load delivers them once Amy answers the
    seven questions. Shane will ping Amy again. He forwarded his 22 October questions to Don and
    David during the call.

## Guidance given on the call that the guide should carry

- Adding a phase to a Gunite project: add it so the existing numbers do not shift. Shane said
  8.1.1 as an example. In the build, a template row keeps its own number and Sequence (decimals
  allowed), and project rows are matched by `TemplateItemId`, so a new row never renumbers
  existing ones.
- A crew that was removed from a skill stays on the sub-phases it was already assigned to. The
  planner does not reassign when crew qualifications change. Don asked why a crew still showed as
  qualified for base prep: base prep sits under the dig and excavation skill, and the assignment
  predates his edit.

## Asks to scope

| Ask | Status today | Note |
|---|---|---|
| Add a skill, with duplicate check | Not built. Skills are a fixed list in the planner; Trades and Crew-Trades in SharePoint feed only the nightly check | Replaces "PM-addable trades" in `docs/2026-10-27-don-asks-scope.md`; the crew-rating ask goes with it |
| Crew preference per skill and overall, 0 to 3 | Not built. Auto-Schedule picks the least loaded qualified crew | A new scheduling input; 0 removes the crew from Auto-Schedule and the Qualified list without deleting it |
| Generated job numbers | Not built. `+ Job` asks for the number and refuses a duplicate | Needs `+ Job`, `D2 - New Pool` (JobNumber is required on the request) and the year rule |
| Feature tags on a job | Not built | From the features picked at `+ Job`; a tag cloud on the Jobs tab and Board |
| Admin override on Mark complete | Not built. Mark complete needs every sub-phase signed or N/A | Gate on Don and David, the same two as the template lists |
| Payment draw soft gate | Not built | Template rows plus a flag; design after Don and David say how they will run it |
| "If I pull this crew off, where are my gaps" | Not built | A crew-board review; raised by Shane |
| Feature how-to for Don | Owed today | Half page: the fields a template row needs and where the Feature name goes |
| Copilot quick-reference for David, Don, Carolyn, Amy | Owed, not scheduler work | David asked for a 30-minute class or a one-pager; Shane offered a pamphlet first |

## Commercial

Shane told them October is past the contract hours and the rest of the month is goodwill, with
another 8 to 10 hours expected before month end. Don is talking to Ryan about where this goes and
the resale potential; David asked to be included. No surprise bill.

## Still owed by D2

The seven Rev4 questions (Amy), the Fiberglass and two structures files (Amy), the trade mapping,
crews for the 20 unassigned Fiberglass sub-phases, which existing jobs are Fiberglass, Harrison
and Campos, and answers to the five questions in the 27 October scope note.
