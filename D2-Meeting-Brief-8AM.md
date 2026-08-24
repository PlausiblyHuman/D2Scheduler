# D2 meeting — Wed 8 AM · talking notes

**With:** David, Don
**Prepared:** Aug 13, 2026

---

## Where we are

Ryan built a working browser-based scheduler with a matching 13-week Dataverse deployment plan. Stratirus reviewed both this week — the tool works and the plan is sound. Two things came out of the review worth talking through.

## What we're recommending

1. **The tool has a one-line fix** that stops it from picking different crews on repeat runs of the same job set. Ryan applies it, we're clean. No cost, no timeline hit.

2. **There's a lighter deployment path worth considering** before committing to the full Dataverse build. Microsoft Lists + Automate + Teams gets you 80% of the same functionality at zero incremental cost, ships in 5 weeks instead of 13, and uses tools already in your M365. Trades off preventive double-book protection (replaced with 60-second detection) and native offline mobile. Full Dataverse plan is still on the table if you want the polish and the belt-and-suspenders.

Rough numbers over 3 years:
- Full Dataverse plan: ~$51k
- Microsoft Lists path: ~$13k

Not a decision for the room today unless you want it to be — the choice hinges on two questions below.

## Questions we need answered

**For David (operations):**

1. Where and when do crew leads actually sign off on a completed sub-phase today? At the truck at end of day? On-site the moment work finishes? Back at the office? This determines whether we need offline mobile or if signal-required is fine.

2. Does anyone tick off tasks below the sub-phase level on the paper form? (Individual line items like "verify plumb line at pre-dig.") If yes, we keep the 295-task granularity. If no, we simplify to 46 sub-phase checkboxes and lose nothing.

3. The 10 unmapped trades — Retaining Walls, Veneer/Stone, CMU, Brick/Masonry, Landscaping, Pavers, Forms, Water Line Install, Material Runs, plain Grading. Are these sub-contracted out, done under existing sub-phases (retaining walls under Deck Placement, forms under Steel Installation), or missing sub-phases we need to add? George Crew is scheduled zero days of work today because their trades are unmapped.

4. Four crews have no roster in the file — George, Armondo, STL Shotcrete, Brothers. Who's on each and how many?

5. The Finish Grade skill on Saul and Guillermo is inferred — the crew list only says Cirilo doesn't do it. Are Saul and Guillermo actually qualified for Finish Grade?

**For Don (ownership):**

6. Eleven sub-phases are field supervision and QC items sitting in Unassigned. Recommend creating a "PM" bucket that any PM can be scheduled against. Sound right, or do you want a specific person owning those?

7. What do you actually want to see for ownership visibility? A weekly PDF summary emailed to you (jobs on track, jobs late, hours by crew)? Or interactive dashboards you can slice and dice? First is free, second is ~$42/mo — I don't want to build the dashboards if a PDF gets you what you need.

**For both:**

8. Do all crew leads have M365 email accounts today? Yes/no changes the cost picture on the Lists path by $60/mo.

9. How many office/PM users will actually touch the scheduling tool day-to-day? Plan assumes 8. If it's 5, that's $720/yr back.

10. Who's the internal person at D2 who'd own this after go-live for small changes (adding a crew, updating a template)? Determines how simple we need to keep it.

## Timeline

Once those answers land, we can finalize the recommendation and get Ryan the go-ahead. Best case, we're locking scope by end of next week and hitting the 13-week clock (or 5-week clock if we pick Lists) shortly after.

## Not on the agenda unless you raise it

- Licensing math changed since Ryan wrote the plan. Total is still ~$402/mo for the Dataverse path — happy to walk through the details if useful, but the number didn't move.
- I've got a Claude Code prompt going back to Ryan today with all the technical detail. He'll do an independent review pass on his end.
