# 2026-09-07b — sign-off gate, Flow 3 fixed, phases replace weeks, skills extracted

Continues 2026-09-07a in the same day. Where the first half finished the app, this half closed the
last defect, rebuilt the project's structure, and lifted the platform lessons out of the repo.

## What landed

**Every known defect is now closed.**

**Sign-off gate — Done / N/A / to do.** Don's objection was never ceremony; it was someone glossing
a clean checklist with "yep, all done". Sign-off is now blocked until every task is resolved. A
bare block would have been worse — a crew lead who cannot close at 5 of 6 ticks the sixth falsely,
turning an honest number into a dishonest one carrying their name. **N/A with a mandatory reason**
is what makes the gate fair, and the mandatory part is load-bearing: without it, "mark everything
N/A then sign off" is just a second rubber-stamp route.

**Flow 3 fixed and STARTED.** Its trigger condition referenced `@odata.oldValue`, which
`GetOnUpdatedItems` never emits, so it fired on every edit. Replaced with **version-history
comparison** — the only option that adds no writes and so cannot re-trigger the flow it guards.
Verified both directions. Double-booking detection is live for the first time since 2026-09-05.

**Office surface + Don's daily view** (from 09-07a, completed here): eight SharePoint views that
had never been built despite the Phase A exit gate claiming otherwise, and a daily summary that now
leads with "Where crews are today" including site addresses.

**Weeks replaced by phases A–G.** ~104 references across 9 documents. Weeks measured elapsed time,
which had almost no relationship to the work, and two whole workstreams had no week and were lost
because of it — the office surface and the client prerequisites. Both now live in **Phase D**,
which runs alongside A–C and gates E.

**Two portable skills extracted** to `~/.claude/skills`: `powerapps-canvas-alm` and
`power-automate-flow-mechanics`, both built RED-GREEN-REFACTOR with baseline subagents. Now under
git.

**Pool generator** (`tools/add_pool.py`) — plans a whole pool from the 46-sub-phase template with
all four business rules enforced. Produces a clean 295-task, 87%-done plan. Writer not built.

## Decisions made

- **Sign-off blocks on unresolved tasks; N/A requires a reason.** Don should be fine with it.
- **Per-task attribution is not the goal** — Shane: *"who completed the work is unimportant; who
  signed off on the completed work is more important."* No per-task signature ceremony.
- **Flow 3 = version-history comparison**, not a flag column or shadow columns, both of which add
  writes to the list whose writes are the problem.
- **Phases keep the A–F letters already used by the AzDo Epics**; G is additive.
- **Cody Campbell and Emon Alexander are the two PMs** — the stakeholder list had lumped six office
  staff together.
- **Skills are user-level, not repo-level**, so platform lessons travel to the next project.

## Corrections to my own earlier work

- `Classic/*` events "do not fire" was written as a platform law; it is two instances in one app,
  and `DisplayMode` / z-order / user-interaction-only must be ruled out first.
- `AssignmentId` was described as simply wrong; it is correct server-side in `$filter`, and wrong
  only as a key in connector *output*.
- A clean-context subagent contradicted both. Testing a skill inside the repo that produced it is
  structurally unreliable, because `CLAUDE.md` loads into every subagent.

## Near miss

Reading Flow 3 via `az rest` emitted *"Unable to encode the output with cp1252"* and silently
discarded the `⚠ — → –` glyphs the flow carries. Patching from that capture would have stripped
them from the live flow. CLAUDE.md documents this exact trap and it still nearly landed.

## Open / blocked on

- **Phase D3 remains the critical path and has still not been asked for** — ~7 crew-lead
  identities, seats, a real PM, the trade mapping.
- Pool writer: the plan exists but nothing writes it. 13KB has to reach the browser, which is the
  only authenticated SharePoint write path — decide the transport before building the clumsy version.
- "Signed off with N/A" visibility view for Don.
- App icon and splash are still default.
- `~/.claude/skills` is a git repo with no remote — see next action.

## Next action

**Rewrite the D2 Build Scheduler SharePoint site** so it looks professional and leads with what the
system does, aimed at Don and David first, then Cody and Emon. Detail and audience notes are in
CLAUDE.md under "NEXT SESSION". Do not describe the browser-tool sync or Teams channels — neither
exists.
