# 2026-09-13a — Graph read layer, Azure subscription, and a tenant guard

**Session goal:** close the chain Shane named — sign-in → Graph read layer → live Load from D2 →
Backup/Restore's replacement. The first three are done; the fourth needs hosting, which is now
unblocked. Nothing ran against the tenant.

---

## What shipped

**1. A real Graph payload was captured, and it earned its keep immediately.**
`fixtures/planner/live-payloads-graph.json` — jobs 3, asg 138, tasks 885, cal 210, matching the REST
fixture exactly. Captured with a new local MSAL tool (`fixtures/planner/capture-graph.js` + `.html`)
that Shane signed into once.

**Graph renames AND retypes every join field:**

| | REST | Graph |
|---|---|---|
| Assignments → Job | `JobId` (number) | `fields.JobLookupId` (**string**) |
| Tasks → Assignment | `AssignmentId` (number) | `fields.AssignmentLookupId` (**string**) |
| item id | `Id` (number) | `fields.id` (**string**) |
| `Crew`, `Sequence`, booleans, dates | — | identical |

`"20" === 20` is false, so an unnormalised join matches nothing and reports success. Writing this
mapping from the REST fixture — which is what would have happened without the capture — reproduces
the exact bug that flagged 66 rows wrongly on `D2 - Crew Trade Check`.

**2. The Graph read layer.** `web/graph-to-planner.js` maps Graph into the payload shape
`export-to-planner.js` already emits, so `importFromD2` needed **no change at all** — merging,
locking signed work and template-authoritative structure stay untouched and still covered.
`fixtures/planner/graph-read.js` is an equivalence test: map the REST fixture one way, the Graph
fixture the other, assert they agree pool by pool.

**3. `Load from D2` reads live when served**, falls back to the file picker from `file://`, and
says which mode it is in.

**4. D2 has an Azure subscription, and it needed no new card.** `D2 Build Scheduler`,
`cbcbe68b-bbaa-4926-bd9a-d33f0a9bd312`, on D2's existing **Microsoft Customer Agreement** — the same
billing profile that carries Copilot.

**5. A new global skill, `m365-tenant-guard`.**

## Files touched

`web/index.html` · `web/graph-to-planner.js` (new) · `web/vendor/msal-browser.min.js` (new) ·
`fixtures/planner/capture-graph.{js,html}` (new) · `fixtures/planner/live-payloads-graph.json` (new) ·
`fixtures/planner/graph-read.js` (new) · `CLAUDE.md` · `~/.claude/skills/m365-tenant-guard/`

## Commits

`70206ba..c46fe52` on `canvas-app-handoff`. Gate: 11 planner harnesses plus `oracle-test.js` at
15/16, `determinism.js` at 138/STABLE.

---

## Decisions

- **Map Graph into the existing payload shape** rather than inventing a second one. That is why the
  import path and all its tests were untouched.
- **Runtime dependencies moved under `web/`**, the deploy root. They pointed into `fixtures/` —
  test scaffolding that must never ship.
- **The planner is no longer a self-contained single file.** Accepted deliberately: the nav link was
  pulled at go-live, nobody is trained on the download, and Phase H retires that copy.
- **`loginPopup`, not `loginRedirect`** — a redirect would discard in-memory planner state.
- **The subscription went on the July_2026 MCA profile**, not the legacy GoDaddy one.

## Traps found

- **An empty Microsoft listing means "wrong tenant" as often as it means "empty".** The billing
  question was answered **wrong three times** — `0 accounts` across two API versions — and nearly
  became a purchasing decision. The context had drifted to Tennetech, where zero is correct.
- **The context drifts mid-session**, three times in two days, including between two reads minutes
  apart. ARM calls are the likeliest cause: a tenant-level account with no subscription cannot serve
  them, so `az` falls back to whichever account has one.
- **A jsdom harness cannot catch a broken `<script src>`** — jsdom does not fetch external scripts.
  All twelve harnesses passed while the tags pointed outside the deploy root. Verified in a real
  browser instead, both served and from `file://`.
- **MSAL cannot redirect to `file://`**, so a live read only works when the planner is served.
- **Four self-inflicted bugs on one small capture page**, each presenting identically as "the button
  does nothing": an instance named `msal` shadowing the library global; a v3 API call on a v2
  library; a backtick inside a comment terminating the enclosing template literal; and a wrong CDN
  path that 404s. Only the error reporting added after the first one made the rest diagnosable.

## Open

- **Hosting** — everything needed exists; see the CLAUDE.md next-session section.
- **Add the SWA URL as a second redirect URI** on the Entra app once it exists. Keep localhost.
- **A permission gate** still blocks live-tenant writes: the validated Reschedule cursor fix
  (`flows/pending/`), the `TradeMismatch` view, the dispatch filter.
- **Don, Monday:** trade mapping, the 11 field-supervision sub-phases, `@sub`, subcontractor emails.
- **Nothing — write-back, `+ Job`, or Graph read — has ever run against the tenant.**

## Next action

Host `web/` on Static Web Apps Free tier, add the SWA redirect URI, verify by signing in rather than
by pipeline status, then exercise the read and the write-back against the three demo pools with
`DRY_RUN` first.
