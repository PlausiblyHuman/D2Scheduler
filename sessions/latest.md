# 2026-09-10a — Edit form, Crew as Choice, the group calendar, and a client-facing PM guide

**Session goal:** Shane opened on the edit form still looking messy, free-text fields that invite
errors, and wanting the calendar reassessed. It ended with a client-facing guide, a staged tenant
and the pre-pilot cleanup gate run.

## What shipped

**1. The Assignments edit form is formatted.** Navy header carrying the title plus crew and
sign-off chips, the 13 fields grouped into four named sections in job order, and a footer stating
the crew-code rule where the mistake happens. `SubPhaseNumber` / `SubPhaseName` marked readonly.

The wrapper key names are **`headerJSONFormatter` / `bodyJSONFormatter` / `footerJSONFormatter`**
and are documented nowhere. Three plausible shapes were tried first and all three returned 204,
round-tripped byte-for-byte, and rendered nothing. The real shape was captured by making
SharePoint's own Format pane write one. Reaching that pane needs a real CDP click on a list-view
row; synthetic events only select it.

**2. Summary emails repainted** into navy/green/cream, and the invalid `<p><div>` wrapper removed.
**The colours live in two actions, not one:** repainting `Compose_body` left every table deep link
teal, because those rows come from `Append_row` inside the loop. The definition read clean while
the emails did not.

**3. `Assignments.Crew` converted Text to Choice.** A real dropdown of the 14 codes. Ten sites
changed across seven flows, plus three in the canvas app, each read off a real payload. The canvas
app also needed its **data source refreshed in Studio** or every `.Value` resolved to `Error`.

The counter-intuitive finding, proven on a throwaway list first: **a Choice column does not
validate REST writes.** `Devon Crew +3` returns 201. The validation guard is still the only thing
that rejects it, so both are needed. A `SchemaXml` MERGE also **silently wipes ValidationFormula**.

**4. `D2 - Calendar Sync` built** (flow 13). Nightly 04:30 Central, one all-day event per in-scope
sub-phase on the site's M365 group calendar. The Outlook connector **cannot reach a group
calendar** (`Invalid resource, Allowed values: me,users`); `shared_office365groups` is Standard tier
and can. Its connection created silently, no consent needed. All-day `end` is **exclusive**.

**5. Tenant staged and the cleanup gate run.** Harrison and both TEST pools deleted (282 tasks, 43
assignments, 3 jobs, zero failures). The three demo pools reflowed to 85% / 28% / 2% complete with
sign-offs attributed to Cody and Emon and four deliberate misses.

**6. Site chrome is app-shaped.** `HorizontalQuickLaunch` gives real header tabs on a GROUP site,
`HeaderEmphasis` paints the band, and `zoneEmphasis` gives the home page colour bands where inline
CSS would be sanitised away. Nav rebuilt around what a PM opens.

**7. A client-facing PM guide**, eight drafts, published as an artifact.

## Files touched

- `CLAUDE.md` — form-formatter shape, the Choice conversion, the group calendar, cleanup-gate state, site chrome, the Delete Pool gap
- `sharepoint/configure-assignments-form.js` — step 5, the form formatter
- `sharepoint/guard-crew-values.js` — `SP.FieldChoice`, and why the guard must stay
- `sharepoint/build-navigation.js` — new
- `sharepoint/build-home-page.js` — calendar link, section emphasis
- `canvas-app/src/Src/Screen1.pa.yaml` — `Crew.Value` in three places
- `flows/exports/*` — eight flows re-exported, each verified by content

## Commits

`6e6b76d`, `3c808e3`, `a3b2065`, plus this one.

## Decisions

- **Choice over a Power Apps custom form** for the crew picker. Bounded and enumerable work versus
  unbounded UI construction that would also have replaced the form formatter built the same day.
- **The validation guard stays** alongside the Choice column. They are complements: Choice
  constrains the form, the guard constrains REST.
- **Active pools only on the calendar**, consistent with dispatch and the summaries.
- **Cleanup gate run early** so the guide's screenshots would not carry `TEST-9002` to a client.
- **Sign-offs attributed to Cody and Emon**, matching the pilot model rather than inventing users.
- **Guide is third person throughout**, no second person and no em dashes. Shane: it is targeted at
  the PMs, not written to them.
- **The "why this exists" opening was cut.** It read as preachy and spoke on Don and David's behalf.

## Open

- **`D2 - Delete Pool` leaves ghost calendar events.** Cause understood, fix blocked on a Dataverse
  connection reference; two edit attempts failed and rolled back cleanly.
- **Nobody at D2 has access yet.** The group has one member, so every link in the guide fails for
  the four of them, and the summaries still send only to `stratirus@d2pools.com`.
- **Whether members can be stopped from editing the group calendar** directly. Unverified Exchange
  route recorded; the guide already warns that edits are overwritten nightly.
- Durations are still a 2-day placeholder on every template row.

## Later the same session (after the first checkpoint)

**8. Site chrome and navigation.** `sharepoint/build-navigation.js`. Three native levers, none
needing the page editor: `Web.HorizontalQuickLaunch` turns a GROUP team site's left rail into
**header tabs**; `Web.HeaderEmphasis` paints the header band; and `zoneEmphasis` on a canvas
section gives the home page real colour bands, which matters because inline CSS inside
`data-sp-rte` is stripped by the rich-text sanitiser.

Nav rebuilt around what a PM opens: Home, Today, This Week, Pools, Attention, Calendar, Sign-off
App, Lists. The horizontal bar cuts to an overflow at four or five items and the owner-only "Edit
navigation" link competes for the space, so the first build buried Pools and Calendar. Short
labels, most-used first.

`Jobs` All Items showed only the Title column, which made the guide's own instruction to change
Status impossible to follow. Fixed.

**9. Calendar Sync went hourly and incremental.** 04:30 full sweep plus 06:30 to 18:30 Central.
Going hourly without changing anything else would have cost ~1,800 Groups calls a day at three
pools and ~6,000 at ten, against a shared seeded-licence allowance. `Compose_mode` branches on the
Central hour; incremental runs append `and Modified ge '<utcNow-2h>'`. The overlapping window
self-heals a missed run with no state row to corrupt.

**The safety property:** `Filter_orphans` is fed an empty array on incremental runs. Without it an
incremental run sees only recently-changed rows and concludes every other event is an orphan,
deleting the whole calendar. Tested that case first: idle incremental 3.8s with 138 events intact;
touch one row and re-run, 5s, `Update_event` fires exactly once, still 138, zero duplicates.

**10. The PM guide went through eight drafts**, mostly on voice. Second person removed entirely
(Shane: it is targeted at the PMs, not written to them), em dashes removed, and a "why this exists"
opening cut for reading as preachy and speaking on Don and David's behalf. Instructions rewritten
click-by-click after Shane pointed out they assumed the reader already knew SharePoint. Shane then
edited it directly from the artifact page, removing the beta/welcome framing entirely so it reads
as a reference guide; the fictional-pools note and feedback routing survive in the footer and
closing section. Local source was rebased onto his version and the placeholder build pipeline
retired, so a stale rebuild cannot resurrect the cut section.

## Open at wrap

- **`D2 - Delete Pool` still leaves ghost calendar events.** Cause understood, fix blocked on a
  Dataverse connection reference for the Groups connector.
- **`HeaderEmphasis` was changed 3 to 0 in the script but may not be applied to the live site.**
  The browser profile was locked and the `az` SharePoint token is not consented, so it could not be
  verified. Re-run `build-navigation.js` in the browser console and hard-reload to confirm.
- **Nobody at D2 has access**, and the summary emails still send only to `stratirus@d2pools.com`.
- **First hourly Calendar Sync runs fire 04:30 Central on 2026-09-11.** Worth a glance at the first
  few, since that schedule has never run unattended.
- `flows/exports/` still keeps multiple dated generations per flow.

## Next action

Add David, Don, Emon and Cody to the group, set the PMs on the three pools, point the summary
emails at the real audience, then send the guide.
