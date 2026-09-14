# 2026-09-13b — security review, hosting posture, and the planner's copy

**Session goal:** verify the planner end to end over HTTP (step 3), then — on Shane's ask — review
the security of what actually ships and settle how it gets hosted, since it should not be public.
The session pivoted from "stand up hosting" to "decide what hosting has to do first", and that
turned out to be the right order: the obvious answer was wrong.

---

## What shipped

**1. Six renderers were putting a PM-typed pool name straight into `innerHTML`.** Not two, which is
what a grep for `${j.name}` reported. `conflicts()` built both its `ref` string and its double-book
message raw; `vBoard`, the crew-board bar, `vSignoff` and `vDispatch` each painted `j.name` raw. On
two of those lines `j.jobno` was **already escaped immediately beside the unescaped name**.

Escaped at construction rather than at the sink, because the Schedule Check messages deliberately
carry `<b>` and `<u>`. Pinned by the new `fixtures/planner/escaping.js`, which probes with an
`<svg id="xss-probe">` in the pool name — no dependence on a script actually executing — and sweeps
**all seven tabs**. It was watched fail twice with the probe genuinely in the DOM before it passed.

**2. The hosting decision: Static Web Apps Free, not Standard.** `web/staticwebapp.config.json` now
carries the wall, a CSP, `noindex` and the security headers. Written, not deployed.

**3. The planner stopped calling D2 the other party.** 25 strings; `Load from D2` is now `Refresh`,
`Not loaded from D2` is `No schedule loaded yet`, `Not yet pushed` is `Draft — not saved`.

**4. Fonts self-hosted**, removing the last third-party request. 4 files, 52 KB, latin only.

**5. Step 3's mechanical half is done** — all deploy-root assets return 200 over HTTP, the check
CLAUDE.md flags as invisible to the jsdom harnesses. The interactive sign-in half still needs Shane.

## Decisions

- **Free plan, not Standard, and the reasoning is the durable part.** The planner has two gates.
  MSAL against the single-tenant Entra app plus SharePoint permissions protect every schedule row,
  and no hosting choice can weaken that. The host wall protects only the shell. So a
  tenant-restricted wall in front of already-tenant-restricted data is overbuying at $9/app/month.
  I initially recommended Standard and revised after Shane pushed back on cost for a small team;
  he was right.
- **Manual usernames and passwords: no.** Static Web Apps has no such provider, a client-side check
  is bypassable with View Source, and — decisively — every user must sign in with their D2 account
  anyway for the Graph token. A password would be a second, weaker credential removing nothing.
- **Invitation roles rejected** on this project's own precedent: a forwardable redeemable link is
  the weakness that killed anonymous Forms sign-off.
- **Creating the Azure resource was held for Shane.** Not because it could not be done unattended,
  but because the deployment method is a real fork — an Azure DevOps pipeline wants to commit a
  workflow file into this repo.

## Traps found

- **A pattern grep defined the scope of a fix and got it wrong.** `${j.name}` cannot see
  `x.j.name` reached through `.map()` and concatenation. The all-tabs sweep is what caught the other
  four. When a grep bounds a fix, the fix is only as complete as the pattern.
- **`az` had drifted to Tennetech again** — fourth time in three days, caught by asserting before a
  read rather than after acting on one. `az account set` fixed it with no interactive login.
- **An empty Azure retail-price query meant a wrong filter, not a zero price** — same shape as the
  billing-account episode. `serviceName eq 'Azure Static Web Apps'` returns nothing;
  `contains(productName,'Static Web')` returns 72 rows.
- **The Azure pricing page renders its figures client-side**, so fetching it returns dashes. The
  retail API is how to get a real number.
- **MSAL 2.38.3 is the LTS line and still gets critical security fixes**, while v3 and v4 are *out*
  of active support. A future session "upgrading" it would be moving to something less supported.
- **A font that silently falls back still returns 200 for every file**, and measuring an unused
  weight before `document.fonts.load()` reports fallback metrics — which looks identical to a broken
  font. Source Sans 3's 400 and 600 share one file, so that needed proving variable rather than
  assuming: 716.91 vs 735.11 at 64px.
- **Four harness assertions pinned the old copy** and had to move in lockstep with the rename.

## Files touched

`web/index.html` · `web/staticwebapp.config.json` · `web/fonts.css` + `web/fonts/` (new) ·
`web/robots.txt` (new) · `fixtures/planner/escaping.js` (new) · `fixtures/planner/{roundtrip,
empty,graph-read,live-export}.js` · `fixtures/planner/README.md` · `CLAUDE.md` ·
memory `planner-hosting-decision`, `prove-blocks-before-reporting` (new)

## Commits

`c5c1758`, `6a2f0fe`, `ee6eb56`, `bec6522` on `canvas-app-handoff`, pushed.
Gate throughout: **12 planner harnesses pass** (11 existing plus `escaping.js`), `oracle-test.js`
at its documented **15/16**, zero browser console messages at any level on a cold load.

## Open

- **Create the Static Web App.** `Microsoft.Web` is `NotRegistered` and the subscription is
  completely empty — register the provider first, it propagates for a few minutes.
- **Add the SWA hostname as a third SPA redirect URI**; keep both localhost entries.
- **The config is unverified until deployed.** Four checks are listed in CLAUDE.md; the one most
  likely to be wrong is that `navigationFallback` is documented not to apply route rules, so a
  nonsense path could serve `index.html` unauthenticated while the front door looks fine.
- Nothing — write-back, `+ Job`, or the Graph read — has ever run against the tenant.
- Unchanged: the `flows/pending/` permission gate, and Don's trade mapping.

## Next action

Register `Microsoft.Web`, create a Free-tier Static Web App in D2's subscription, deploy `web/`,
add the redirect URI, then verify by signing in rather than by pipeline status.
