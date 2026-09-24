# 2026-09-22a: reject-with-comments plan and core (Tasks 1 to 5)

**Reconstructed on 2026-09-23 from the commits and the live tenant.** No log was written at the time.

**Session goal:** plan the reject-a-sign-off feature and build its foundations.

**Files touched:**
- `docs/superpowers/plans/2026-09-22-reject-signoff-with-comments.md` (new, 11 tasks)
- `web/graph-to-planner.js`: comments and the three rejection columns mapped into the payload
- `web/writeback-core.js`: `planRejections`, `appendRejected`, and a rejection counting as a reopen for task ticks
- `web/graph-writeback.js`: `commentBody` and the PATCH-then-POST walk `applyRejectionOps`
- `sharepoint/provision-signoff-comments.js` (new), `provision-views.js` (`Rejected` view), `build-home-page.js`
- `fixtures/planner/rejections.js` (new), `graph-read.js`, `graph-write.js`, `rejections.mutations.json`, `mutate.py`

**Commits:**
- `3b80a40` Plan: reject a sign-off with comments
- `d533fc6`, `6eff5e8`, `230a6ec`, `26c76b7`: Tasks 2 to 5
- `7cbc480`, `4c46cb7`, `2bc2810`: Task 1 scripts and the view

**Decisions made:**
- Task 1 was also run against the tenant this day: the `Sign-off Comments` list, the three Assignments columns and
  the `Rejected` view were found live on 2026-09-23 (list `e6c97457-…`, `WriteSecurity=2`). The run itself was not
  recorded.

**Open questions / blocked on:**
- None recorded.

**Next action:**
Tasks 6 to 11: Refresh, panel, Save, card, Daily Summary, live test. Done 2026-09-23a.
