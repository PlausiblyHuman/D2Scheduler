# D2 Phase 1 verifications — runbook

Three checks that unblock everything else in Rev D. Total time ~15 minutes.
Use your D2 tenant service account (not your Stratirus account).

---

## Check 1 — M365 SKU includes Power Apps for M365 seeded rights

**Why:** Rev D's canvas app for crew-lead sign-off relies on this. If D2's on a lighter SKU, we fall back to Microsoft Forms + a SharePoint list view (uglier UX, cuts ~30 build hours).

**Steps:**

1. Open `https://admin.microsoft.com` in a browser signed in with the D2 service account
2. Left nav → **Billing** → **Your products**
3. Look at each subscription line. You're looking for any of:
   - Microsoft 365 Business Basic
   - Microsoft 365 Business Standard
   - Microsoft 365 Business Premium
   - Microsoft 365 E3
   - Microsoft 365 E5
   - Office 365 E1 / E3 / E5

**Decision rule:**
- **Green** — any of the above. Canvas app in scope, proceed with Rev D as written.
- **Yellow** — Business Basic only, all 10 crew leads. Canvas app still works (Business Basic includes Power Apps for M365) but confirm no one's on Exchange Online kiosk or a legacy plan.
- **Red** — Exchange Online only, standalone Kiosk, or legacy Office 365 Small Business. Canvas app is off the table. Text or Teams me and we'll drop the canvas app from Rev D and go Forms fallback.

---

## Check 2 — Power Apps tenant-level sharing enabled

**Why:** Some hardened tenants disable maker sharing by default, which would block us publishing the canvas app to crew leads.

**Steps:**

1. Open `https://admin.powerplatform.microsoft.com` signed in with the D2 service account
2. Left nav → **Environments**
3. Click the environment you'll use for the build (probably the default, unless there's already a "D2 Production" env)
4. Top nav → **Settings** → **Users + permissions** → **Sharing**
5. Under **Who can share apps**, look at what's allowed

**Decision rule:**
- **Green** — "Everyone" or "Specific security groups" that include D2 crew leads
- **Yellow / Red** — "No one" or a group that excludes crew leads. Flip it: check "Everyone" or add a security group. Change is instant, admin-only.

If you don't see the Sharing panel, you may not have Power Platform admin role on that tenant. Grant it to the service account from `admin.microsoft.com` → Users → Active users → [service account] → Roles → check "Power Platform administrator".

---

## Check 3 — Power Automate polling floor measurement

**Why:** Rev D §07 reports the double-book detection window as "one polling interval." We need to measure the actual interval for D2's seeded Power Automate rights so we can report a real number to Don and Ryan.

**Fast method** (5 min, low precision but usually enough):

1. Open `https://make.powerautomate.com` signed in with the D2 service account
2. Create a scratch flow: **My flows** → **New flow** → **Automated cloud flow**
3. Name it `Polling Test — DELETE ME`, trigger: **When an item is created or modified — SharePoint**
4. Point it at any test SharePoint list on the D2 tenant (or create a scratch one first — one list, one column)
5. Add one action: **Send an email (V2)** — to yourself, subject `Polling test fired at @{utcNow()}`, body `.`
6. Save + turn on
7. Add a row to the test list. Note the current UTC time.
8. When the email arrives, note the timestamp difference.
9. Repeat 3–4 times over a few minutes to get an average.

**What you're looking for:**
- If emails arrive within ~30–60 seconds: seeded rights got upgraded to 1-min minimum. Rev D §07 keeps "60 seconds."
- If emails take 3–5 minutes: standard seeded floor. Rev D §07 updates to "3–5 minutes."
- If emails take 10+ minutes: something's throttled or the flow's on a shared-quota degraded path. Text me — we may need a Premium Power Automate seat for the reconciliation flow specifically (~$15/user/mo for one seat, cheap workaround).

Delete the scratch flow when done.

**Decision rule:**
Any measurement ≤10 min is workable and doesn't stop the build. If we're consistently over 10 min, that's a real problem for the "detects within one polling interval" positioning — flag it and we'll decide whether to buy Premium for the flow or reframe the value prop.

---

## When all three are done

Text me the results in this format:

```
SKU: [Business Standard / Premium / E3 / other]
Sharing: [Green / opened up]
Polling: [avg ~X minutes across N tests]
```

I'll finalize the SOW numbers with Ken and Rev D §07's detection-window language, then we're clear for Week 1 kickoff.

---

## If something's blocked

Any of the three failing isn't fatal. Named fallbacks:

- **SKU too light** → drop canvas app, Forms fallback. Rev D scope adjusts, build drops ~$4k.
- **Sharing locked and can't unlock** → escalate to whoever owns D2's tenant admin (may be Don's IT contact). If it's truly locked, canvas app publishes only to specific security groups we'd have to define.
- **Polling >10 min** → one Premium Power Automate per-user seat (~$15/mo) for the service account running reconciliation, plus a note in §07 that detection is 30–60s only when the seat is provisioned. Everything else stays free.
