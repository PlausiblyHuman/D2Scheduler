# 2026-09-23a: reject-a-sign-off, built, deployed and verified live

**Session goal:** finish the reject-with-comments plan (Tasks 6 to 11). Done: built, deployed to the hosted planner,
added to the Daily Summary, walked end to end on a throwaway pool, and written into the client guide.

## What shipped

| Commit | Change |
|---|---|
| `cce7b88` | Refresh reads `Sign-off Comments` with its own catch; a failing read costs the threads, never the schedule |
| `c97fb09` | Sub-phase panel: thread, Add comment, Reject sign-off (reason required), Mark resolved, a removable queue |
| `c8d9e9e` | Save counts, previews, sends and reports them; rejections go before sign-off |
| `b17c55c` | Open rejections card on Sign-Offs, Rejected label on the board; the shakedown now drives the panel |
| `a408f63` | Daily Summary Open rejections section, omitted when empty; export regenerated |
| `f53ecfa` | CLAUDE.md record |

Deployed to the Static Web App; the wall was re-checked anonymously (everything 302 except `/auth-redirect.html` 200
and `/.auth/login/github` 404). Client guide published as **Version 8** of `MnJkMLwg3LHXpv9g74SiV2`.

## Decisions made

- **Four departures from the plan, all kept:** rejections are sent before sign-off, and a reject that did not land
  takes its reopen away so ticks are refused under a live sign-off; a queued reject carries the sign-off change, so
  the on-screen Installer un-tick is not also sent as a plain reopen; removing a queued reject restores Installer;
  the Daily Summary section is an `if()` in `Compose_body` rather than a Condition action.
- The Daily Summary was tested on a copy mailing `stratirus@` only, against a temporary flag on a Navarro row
  (PM D2 Bot), then the real flow was edited.
- The client guide was published to the shared artifact on Shane's explicit instruction, after the classifier refused
  the first attempt.

## Verified

Live on `TEST-9500` (built 10m19s, removed via Delete Pool Requests), every step read back from SharePoint: sign-off;
reject plus ticks in one Save (one Central-time audit line, ticks landed, counters 2/17); a comment that leaves the
assignment untouched; both refusal directions stay queued and write nothing; "Signed again" on the card; resolve
keeps `RejectedOn`; the view 0 → 1 → 0 with an inverted control. Event-Driven Reconciliation fired twice and sent no
alert. `npm test` green, 50 of 50 mutations red, shakedown console clean. Tenant audited back to baseline: 5 jobs,
230 assignments, 1475 tasks, 5 New Pool Requests rows, 0 Delete Pool Requests, 0 comments, 0 rejected.

## Found

- `edit_flow` on the Daily Summary wrote straight to the published row; `PublishXml` then failed with a generic
  `0x80040216` because there was no draft. Verify by reading the Dataverse row, not by `PublishXml`'s result.
- `Rejected` reads null on every pre-existing row; filter with `eq 1` / `ne 1`, never `eq 0`.
- **A fifth job, `26- 2055 Gunite/Trailov`, raised and activated by Don on 09-22** (see CLAUDE.md). It is complete,
  but its start date and default crews copy Navarro's schedule: 18 double-bookings, 27 unsigned sub-phases counting
  against compliance. Activating before the build finished may have sent Don conflict alerts; not checked.
- Sessions 09-17 to 09-22 had no logs; three were reconstructed from commits.

## Open questions / blocked on

- **Is `26- 2055` a real job or Don trying the system?** Real: set its real start, reflow, fix the job number.
  Practice: set it to Planned, delete after the 04:30 sweep.
- **The client guide's share link is still pinned to an earlier version.** Shane moves it in the Share menu.
- Did Don get conflict-alert emails from the early activation? Checkable from Flow 3's runs, 20:07–20:15 UTC on 09-22.
- Carried: Don's trade mapping, the template-permissions gate (item 7), crew-lead accounts and seats.

## Next action

Settle `26- 2055` with Don, move the guide's share pin to Version 8, and check the first live Daily Summary with the
new section on the next rejection.
