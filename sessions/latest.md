# 2026-10-28a: meeting record, guide Version 9, follow-up plans

**Session goal:** prepare Shane for the 8 AM meeting with Don and David, then capture what was
decided and turn it into the guide update and the next plans. Done: agenda artifact, October hours,
the meeting record from the Teams recording and Loop notes, guide Version 9 (28 October) on the
private copy, and the questions, solutions and plans document.

**Time:** to fill at close (session continues; Shane remote for the afternoon).

**Files touched:**
- `docs/2026-10-28-status-meeting-notes.md` (new: decisions, guidance given, asks to scope, commercial)
- `docs/2026-10-28-questions-solutions-plans.md` (new: questions with defaults, a design per ask,
  the order and sizes, a draft message to Don and David)
- `CLAUDE.md` (28 October section: the binding decisions, guide Version 9 published privately)
- `~/.claude/projects/.../memory/teams-meeting-artifacts-access.md` (the working headless route)
- Scratchpad, not committed: `d2-guide-v10.html` (the patched guide), `patch-guide-v9.py` (29
  exact-match edits, each asserted once), `don-oct28-run-sheet.html` (the agenda artifact)

**Published:**
- Agenda for the meeting: https://claude.ai/artifact/9186937XNeLkVtHZtGqDu1 (private)
- Guide Version 9, 28 October 2026: https://claude.ai/artifact/UoeNwV4i4EQQaQgSuJCqiJ (private
  copy; the client copy stays at Version 8 until Shane approves)

**Done:**
- October D2 hours read from TimeTrack: 32.25 h posted against 20 included; 10-27 (2.25 h) and
  today unposted; 10-05 never posted and needs a number from Shane.
- The meeting: recording found in OneDrive Recordings (453 MB, Stream expires it in 120 days);
  Graph transcript access is off for the tenant, so the transcript was harvested from the Stream
  player's Transcript pane through Claude in Chrome (671 lines), and the Facilitator's Loop page
  read the same way. Both tabs closed afterwards.
- Guide edits: Optional features section (switch on and off, New in the template, adding a feature
  to the templates with the row fields), build type and the Optional features checklist at + Job,
  Build phases read-only, the plain-tick rule, Reject only on a saved sign-off, calendar paused,
  three traps, four help rows, contents and footer. Sections balance (25 open, 25 close), one
  `id="features"`, every anchor resolves.

**Decisions made:**
- Meeting decisions: `docs/2026-10-28-status-meeting-notes.md` and the CLAUDE.md section.
- Shane's rulings on the twelve open design questions, taken one by one in the afternoon
  (CLAUDE.md "Shane's rulings the same afternoon"): preference scale 3 best / 0 never; overall
  preference only matters at 0; subcontractors rated; editor before mapping; job numbers generated
  at + Job; draws as template rows (so zero-day sub-phases first); override now and a Closeout
  status later; reset on Don's keeper list; design for Plumbline reuse; build the New Pool burst
  gate in November; **the guide waits for the next major version** (Version 9 stays private); the
  message to Don and David goes after Shane edits it.
- The build order in the plans document is revised to match; items 1 to 6 are about eight sessions,
  more than November's 20 hours.

**Open questions / blocked on:**
- Shane: edit and send the message to Don and David (two lines need updating against the rulings);
  post the October hours; give the 10-05 figure.
- Don and David: draws trigger and who marks received (now shapes the template rows), the 3000
  series question, the keeper list, the scope-note questions.
- Amy: the seven Rev4 questions and the three files.
- Template column display names: confirm on the live lists before the guide's next major version
  goes to the client.

**Item 1 started the same afternoon (Shane: "Start item 1").**
- **Template lists gated, live.** `sharepoint/gate-template-lists.js` (new) run through a throwaway
  proxy flow as D2 Bot via the new `tools/sp-proxy.js`: dry run, live write (10 REST calls), read
  back, and SharePoint's own effective-permission check on both lists: Don and David edit, Cody (a
  plain member) reads only, D2 Bot still manages. A second dry run planned nothing. Proxy flow
  deleted afterwards. Recorded in CLAUDE.md ("THE TEMPLATE LISTS ARE GATED").
- **Template check on the Build phases tab:** built by a subagent from a written brief (new
  `web/template-check-core.js`, `graph-to-planner.js` emitting `templateRows` and `crews`,
  `D2_GRAPH.lists.crews`, the card in `vPhases`, harness `fixtures/planner/template-check.js` with
  three mutation files), then reviewed: the card now says "crew codes not checked" when the Crews
  list could not be read (assertion and mutation added), and the mapper header names the two new
  keys. Live template rows (91 / 543 / 26 trades / 14 crews) captured through the proxy and run
  through the real mapper and check: **0 errors, 0 warnings; 17 errors with one crew code
  removed**. Card seen rendering in the browser pane on a deliberately broken test template.
  Not deployed: ships with the next release. Recorded in CLAUDE.md ("THE BUILD PHASES TAB CHECKS
  THE TEMPLATES").

- **Gates on the check:** `template-check.js` 71 assertions; sweeps 30 of 30 (core), 8 of 8
  (mapper), 12 of 12 (page) red and reverted green; `npm test` exit 0 with only the known oracle
  15/16 (Don's 10 unmapped trades); `tools/planner-shakedown.js` in a throwaway headless Chrome,
  every check PASS, console clean. Nothing committed, nothing deployed.

**Next action:**
Commit item 1 (gate script, proxy driver, template check and its harness, the three documents from
today). Then the skills and preferences spec with the ruled scale (3 best, 0 never) and the
0-only override, before any code.
