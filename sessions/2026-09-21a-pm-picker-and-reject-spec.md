# 2026-09-21a: PM on every job, Sign-Offs job picker, reject-with-comments spec

**Reconstructed on 2026-09-23 from the commits and CLAUDE.md.** No log was written at the time.

**Session goal:** work the post-training priorities list (items 3, 11 and 13), and spec rejecting a sign-off.

**Files touched:**
- `web/index.html`, `web/graph-to-planner.js`, `web/writeback-core.js`: PM shown and filterable on the Jobs tab,
  a PM picker on `+ Job`, a job picker on Sign-Offs, crews named on folded board rows
- `fixtures/planner/office-views.js` (new) and its two mutation files
- `docs/superpowers/specs/2026-09-21-reject-signoff-with-comments-design.md` (new)
- `CLAUDE.md`

**Commits:**
- `4c482dd` Add PM on every job, a Sign-Offs job picker, and crews on the folded board
- `3138164` Record the PM, Sign-Offs picker and folded-board changes; correct Navarro's PM
- `83e37bb` Record decision: only Don makes template changes
- `28b9719` Spec: reject a sign-off with comments; David gets Don's template and qualifier access

**Decisions made:**
- Only Don and David make template changes; SharePoint permissions on the template lists are the intended gate
  (priorities item 7, not yet built).
- Navarro's PM is D2 Bot on the live row, not David as previously recorded. Left as is.

**Open questions / blocked on:**
- The template-permissions gate (item 7) is decided but not built.

**Next action:**
Write the implementation plan for reject-with-comments and start building it.
