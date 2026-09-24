# 2026-09-18a: hosted Refresh sign-in fixed after the 09-17 training

**Reconstructed on 2026-09-23 from the commits and CLAUDE.md.** No log was written at the time.

**Session goal:** find out why Refresh failed for four of the six people at the 2026-09-17 PM
training (Don, Emon, Amy, Carolyn), and fix it.

**Files touched:**
- `web/index.html`, `web/auth-redirect.html` (new), `web/staticwebapp.config.json`: the MSAL popup now returns to a
  blank page outside the Static Web Apps wall; a failed hosted Refresh opens the drawer with a sentence and Try again
  instead of an alert and the file picker; `login_hint` comes from `/.auth/me`
- `fixtures/planner/signin.js` (new, 35 assertions), `fixtures/planner/mutate.py`, `package.json`
- `CLAUDE.md`: the full diagnosis

**Commits:**
- `7929f25` Record: native dialogs in the Playwright MCP window are answered by the automation (09-17)
- `1786c8c` Fix hosted Refresh sign-in that failed for four of six at training

**Decisions made:**
- Root cause was the wall's `SameSite=Strict` cookie being withheld on a popup return that Microsoft's page
  initiated, not consent or rights. Entra's sign-in log was the evidence and is the first place to look next time.
- Amy and Carolyn added to the M365 group, after re-reading `WelcomeMessageEnabled = False` from Exchange.

**Open questions / blocked on:**
- David never signed in on 09-17.

**Next action:**
PM on every job and a Sign-Offs job picker (done 09-21).
