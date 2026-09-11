# 2026-09-11c — Go-live cut, client access, and the Phase H spec

**Session goal:** started as "Ryan thinks the presentation layer is unsexy, what are the
alternatives". Became the go-live cut: ship today on SharePoint, spec the UI work as its own phase,
and get the client into the system. The invite email went out during the session.

---

## What shipped

**1. Phase H specced and sequenced.** `docs/superpowers/specs/2026-09-11-planner-as-primary-surface-design.md`.
Host `pool-scheduler.html` on Azure Static Web Apps in D2's tenant, MSAL delegated Graph reads, D2
brand repaint, SharePoint Lists still the database and all 15 flows still the engine. Three stages,
Stage 1 read-only and independently shippable.

The reframe that made it cheap: the planner already carries seven tabs covering most of the office
surface, and four of the five walls in `docs/planner-vs-sharepoint-parity.md` section C are
SharePoint walls specifically. So this is decoupling, not migration.

**2. Client has access.** David, Don, Emon and Cody are members of the D2 Build Scheduler group,
verified on Graph (5 members, owners still D2 Bot alone). Members role is **Edit** and **0 of 18
lists break permission inheritance**, so it reaches Jobs, Assignments, Tasks and all three request
lists. The long-standing client-gated blocker is closed.

**3. Both summaries repointed** to `stratirus;david;don;cody;emon @d2pools.com`. Stratirus stays on
so a broken summary is seen by us at the same time as by the client.

**4. Morning run order moved earlier** — crews are up around 05:00. Counter Reconciliation 03:30,
Daily Dispatch 04:00, Daily Summary 04:30.

**5. PM guide rebuilt and republished**, now a **new artifact with no version history**:
https://claude.ai/code/artifact/a84a2e1a-6395-4f3a-b050-8cf53cefa2b5 (version 5). Calendar and both
email summaries moved to the front, a live weekly-summary sample added, a table of contents,
a "Changing a checklist" section, and the conflict/calendar timings corrected.

**6. Internal commentary stripped** from everything a client can see, and made a standing rule in
the `dev-session-code` skill plus project memory.

**7. Planner nav link pulled** at the go-live cut (`sharepoint/pull-planner-link.js`), because it
was discoverable in the nav while absent from the PM guide, and its Sunday-only work-calendar model
produces wrong spans over holidays.

**8. Default-view sweep finished** — Tasks now lands on `All Tasks (by Assignment)`, Jobs `All
Items` carries the `jobCard` formatter.

---

## Decisions

- **Ship today on SharePoint; the UI is a separate phase.** Explicitly NOT pre-pilot work, which
  takes a client-gated Azure signup off the critical path of a calendar-locked week. Accepted cost:
  the office gets trained twice.
- **"Phase 2" is commercial and contains build Phase H.** D2 hears Phase 2, the repo says H, and H
  continues the A-G lettering that matches the AzDo epics.
- **Publish the guide as a NEW artifact** rather than v14 of the old one, so it carries no version
  traceback. Old artifact `1cc7b6be-…` is superseded and must not be republished to.
- **No email notifications when adding the four.** Welcome mail was live and had to be suppressed
  first; see Traps.
- **Let the weekly summary fire on schedule** the same afternoon, as the first client-facing email.
- **Exchange group settings stay off** (`WelcomeMessageEnabled`, `AutoSubscribeNewMembers`,
  `AlwaysSubscribeMembersToCalendarEvents`), because re-arming would also fire for the ~7 crew leads
  added later.
- **Two Phase G items added**: duration edits should reflow by themselves, and conflict detection
  should cover subcontractors (a business-rule change needing a per-crew capacity from Don, not a
  filter change).

---

## Traps found, all now in CLAUDE.md

- **Adding an M365 group member sends a welcome email, and Graph says it does not.** Graph
  `resourceBehaviorOptions` returned `[]`, `Get-UnifiedGroup` returned the property **blank** (not
  False), and only `-IncludeAllProperties` revealed `WelcomeMessageEnabled = True`. Exchange is the
  authority because Exchange sends the mail, and `Set-UnifiedGroup` never updates the Graph array,
  so the two disagree permanently.
- **New headless route: Exchange Online** via an `az` token for `https://outlook.office365.com`
  passed to `Connect-ExchangeOnline -AccessToken`. No interactive sign-in.
- **`edit_flow`'s `set` treats an unresolvable dotted path as a LITERAL KEY NAME** and creates it,
  returning `{"mode":"applied"}`. Its `remove` resolves dots as separators and errors properly. The
  correct separator is `/`, and the path must include the container (`actions/For_each_in_scope/…`).
  Recovered via `list_backups` / `restore_backup`.
- **`delete_flow` wants the ProcessSimple id while `create_flow` RETURNS the Dataverse
  workflowid.** The mismatch fails with a misleading "concurrent Delete requests" error and leaves
  the flow live under a different id.
- **`PublishXml` is still required after `edit_flow`** — the first `get_flow` after "applied" shows
  the old text, exactly as the draft-row mechanism predicts.
- **The `Send_summary` inputs use FLAT keys** (`"emailMessage/Body"`), not a nested object. The key
  contains the `/` that `edit_flow` uses as a separator, so `merge` on the parent is the only route.
- **The tenant has duplicate accounts**: Don as `don@` and `contact@d2pools.com`, David as
  `david@d2pools.com` and a `d2install` guest. Join on `userPrincipalName`.
- **D2 has NO Azure subscription.** `az` returns `N/A(tenant level account)` and the ARM
  subscriptions call is empty. Creating one is free, so the ask is a signup, not spend.

---

## Open

- **The guide artifact may still be private.** New artifacts start private; if it was not shared
  before the invite went out, the four hit a permission wall on the link. Check first next session.
- **Jobs / Tasks view formatters verified as STORED, not as RENDERED** — `chrome-devtools` would
  not attach (profile locked by a running Chrome), so a probe flow confirmed persistence but could
  not prove the card paints. Open both views in a browser.
- **Azure subscription for D2** is the Phase H gate. Now that David and Don are in the system, the
  ask can go to them.
- **`TradeMismatch` still has no view**, so business rule 1 is enforced nightly and invisible. Last
  item outstanding from the 2026-09-11b checkpoint.
- **Crew-lead accounts and Business Basic seats** remain unbought, so Daily Dispatch reaches nobody
  and PM-proxy sign-off is the only route.

---

## Next action

**Phase H.** Review the spec, turn it into an implementation plan, and put the Azure subscription
ask to David and Don.
