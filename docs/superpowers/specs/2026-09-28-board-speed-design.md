# Scale piece 4: Board speed

**Status: written 2026-09-28, awaiting Shane's review.** Spec B of two; Spec A
(`2026-09-28-complete-projects-and-live-reads-design.md`) keeps the planner holding live projects
only, and this spec keeps the Board quick at that size.

## Why

Measured 2026-09-28 in Chrome on the dev PC, the example pools cloned to N projects:

| Projects | Board redraw | Rows on the Board |
|---|---|---|
| 3 | 0.3 s | about 170 |
| 20 (D2's steady state) | **2.0 to 2.4 s** | about 1,100 |
| 20, every phase folded | **0.25 s** | about 200 |

The profile put about 60% of the time in `positionTimeline`, which is only where the browser's
forced layout of the whole table is paid. A fixed table layout made **no difference** (tested). The
cost is the number of rows, so the fix is fewer rows and fewer full redraws.

`render()` runs on every sign-off tick, task tick, crew change and drawer save. At 20 live projects
every one of those clicks freezes the screen for over two seconds.

Separately, `const save=()=>localStorage.setItem(KEY,JSON.stringify(S))` has no error handling.
Browser storage holds about 5 MB; the planner used 1.1 MB at 20 projects and 2.7 MB at 50. When it
fills, `setItem` throws partway through whatever handler called it, the in-memory state has changed
and the screen stops updating. Spec A keeps the planner at live projects only, which keeps this far
off, but it must fail safely.

## 1. The Board opens folded to the work in progress

Per project, on first sight of it in this browser:

- A phase whose every sub-phase **finished before today** is folded.
- A phase that **starts after the next 14 days** is folded.
- Everything else is open: the phase in progress and whatever starts in the next two weeks.
- A project with no dated work at all is shown open (nothing to fold by).

Measured effect at 20 projects: roughly 1,100 rows down to about 300.

**Folds are the PM's, and they stick.** Opening or folding a phase by hand is remembered in this
browser under its own key (`poolsched.folds`, by job number and phase number), so the default rule
applies only to phases the PM has never touched. Reads and writes are wrapped in try/catch; if
storage is unavailable the Board simply uses the default rule each time. Collapse all and Expand all
stay, and set every phase explicitly.

A phase row already shows its dates, its sign-off boxes and, when folded, the crews on it
(`phaseCrews`), so a folded phase still says who is on it and when.

## 2. Common clicks redraw one project, not the Board

The Board is built as one table. It becomes one `<tbody>` per project, each with a
`data-job` attribute, built by a function that takes one project. The full render is those bodies
joined, so it produces the same markup as today.

Clicks that change only their own project redraw only that project's body:

| Click | Redraws |
|---|---|
| INST or PM tick on a sub-phase or a phase row | that project |
| Crew change in the inline list | that project |
| Fold or unfold a phase | that project |
| A task tick or N/A in the drawer | the drawer, then that project |

After a project-level redraw, the page-level pieces that depend on everything are refreshed
cheaply: the Save button count, the freshness line, and the Schedule Check card (`conflicts()` takes
about 13 ms at 20 projects). A crew change can create or clear a double-booking on **another**
project, so after a crew change any other project named in a changed Schedule Check error is
redrawn too.

Everything that can move rows in several places keeps the full redraw: days or start changes and
their reflow, Auto-Schedule and its undo, Refresh, the project and status filters, zoom, tab
switches.

**Scroll position and focus survive a project redraw** because the table and its scroll container
are not replaced. That also removes the reason `positionTimeline` runs on those clicks.

## 3. A full browser storage no longer breaks anything

`save()` catches the failure:

1. On a quota error, it retries once with a slimmer copy: task lists are dropped for every project
   that carries no unsaved task or sign-off change, because Refresh re-reads them.
2. If that also fails, the planner keeps working from memory, and a notice under the header says:
   "This browser has run out of storage for the planner. Your changes are still on screen: press
   Save to send them. Anything not saved is lost if you close this tab."
3. Every handler that calls `save()` continues to its `render()`, whatever happened.

The notice clears on the next successful save.

## 4. Testing and verification

**Harness** (`fixtures/planner/board-speed.js`, jsdom, real page):

- the fold rule in each direction: a finished phase folded, the in-progress phase open, a phase
  starting in 10 days open, one starting in 30 days folded, an undated project open
- a hand fold survives a Refresh and a reload; Expand all overrides it
- after an INST tick, a crew change and a fold, **every other project's `<tbody>` is the same DOM
  node as before** (identity, not markup), and the Save count and Schedule Check card are current
- a crew change that creates a double-booking with another project redraws that project too
- a days change still redraws everything, and its reflow is visible
- `save()` with a `localStorage` that throws: the handler still renders, the slim retry drops only
  clean projects' tasks, and the notice appears, then clears after a successful save
- the full render's markup is unchanged for a board with nothing folded (so the existing harnesses
  still mean what they meant)

Every rule gets a mutation in `board-speed.mutations.json`, watched red. The existing Board
harnesses (`board-controls.js`, `inline-edit.js`, `office-views.js`, `signoff-push.js`) must stay
green unchanged.

**Real browser:** the throwaway spike script becomes `tools/board-timing.js`, which clones the
example pools to 20 and 50 projects and times a first render and an INST tick. The shakedown gains
one check: at 20 projects a tick redraws in under 0.3 s and a first render is under 1 s. Numbers
are recorded in CLAUDE.md, before and after.

**Hosted:** after deploy, the wall checks as always, and one signed-in pass on the real projects:
default folds look right, a tick is instant, Save still carries it.

## 5. Estimate

About one session. All planner-side and effort-bound: no flow, no schema, no tenant write beyond
the deploy.
