# 2026-09-28a: live check found the finish-date bug; the scale work began

**Session goal:** a signed-in pass over the 25 Sept features on the hosted planner, then the client
guide. It turned into a live bug fix, and a scale package after Shane gave the real volume: about
60 pools a year, about 20 live at once.

**Time:** 12:27 to 20:21 local, 1.75 h billable by the hook clock (D2 bucket, 15-min idle rule). The
wall clock was much longer, with long waits on flow builds and time away.

## What shipped

| Commit | Change |
|---|---|
| `0e3aeb2` | **Save sends `ScheduledFinish`** with every start or duration write. Before this, one inline days change left 43 of 46 rows finishing before they start in SharePoint, while the Board looked right. Reproduced live, fixed, redeployed (`deploy/2026-09-28`), verified 46 of 46 |
| `118946c`, `288452a` | Save results name fields in words; Open schedule link in the accent colour. `deploy/2026-09-28b` |
| `f68fe8c` | **Scale piece 1:** Calendar Sync reads up to 5,000 rows (was 500, which would have deleted real calendar events past about 11 live projects) with a guard that stops the 04:30 sweep rather than delete after a bad read; Crew Trade Check 1,000 to 5,000; guards on Counter Reconciliation, Crew Trade Check and Conflict Flag that fail before writing when a read comes back full. Verified both ways, including disarmed copies that tripped their guards |
| (tenant) | **Scale piece 2:** six columns indexed. `Tasks.Assignment` and `Jobs.JobNumber` were already indexed |
| `8f19288` | **Scale piece 3, measured:** the Board redraw is 2.4 s per click at 20 projects, set by row count (fixed table layout made no difference; folding phases took it to 0.25 s). Refresh about 19 s at 20 live projects. `save()` has no error handling and browser storage fills at about 90 projects |
| `c582903` | The project-close decisions |
| `67d0334`, `e5a3c7d` | **Spec A** (complete projects, read only live ones, Counter Reconciliation per project) and **Spec B** (Board speed) |

Also verified live for the first time on the hosted planner: Refresh over Graph from a clean
profile, `+ Job` with a picked PM and default crews off, the Building guard on a real half-built
project, the inline controls, and reset from a new start writing `Jobs.StartDate`. `TEST-9700` was
built for this (10m 30s) and deleted, with both request rows; the tenant is back to 2 jobs, 92
assignments, 590 tasks, 46 calendar events. Guide Version 9 drafted with two new screenshots.

## Decisions made

- Guide Version 9 approved as drafted.
- Scale package before WP5, in the order: paging and guards, indexes, measure, then specs.
- Projects are completed by a person, only when every sub-phase is signed or N/A; they stay in
  place as `Status = Complete` (the existing, unused choice, confirmed by Shane); hidden from the
  planner with a read-only Completed list; can be reopened. **Warranty is not managed in this tool.**
- WP5 release goes through an immediate write with a conflict warning, like Activate (design
  presented, spec not yet written).

## Found

- **D2's licence caps a connector read at 5,000 rows** (`InvalidPaginationPolicy` above that), so
  paging cannot save a flow that reads a whole growing list.
- `edit_flow` could not save Calendar Sync at all; the Dataverse `clientdata` + `PublishXml` route
  worked for all four flows and showed the real error where `edit_flow` showed a misleading one.
- The 26 Sept snapshot never ran because the first run lands on the slot after the start time. Not
  a fault.
- Dataverse for Teams is not an option: no API access, so the hosted planner could not reach it.

## Open questions / blocked on

- **Guide Version 9 is not on the client page.** The publish was blocked by the permission check;
  the file is ready. Shane pinned the page, which still pins Version 8.
- Specs A and B await Shane's go-ahead to plan and build.
- Activate and Back to planning have still not been exercised live.
- Counter Reconciliation needs the Spec A rewrite before about December 2026.
- Tomorrow's 04:30 Calendar Sync full sweep is the first run of its new full-sweep path.

## Next action

Check the 04:30 Calendar Sync run (succeeded, guard not tripped, still 46 events), publish guide
Version 9 with Shane's approval, then plan and build Spec A.
