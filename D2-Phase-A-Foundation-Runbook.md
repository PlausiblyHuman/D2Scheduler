# D2 Phase A build runbook — SharePoint foundation

**Prereq:** Phase 1 verifications complete (all three green or fallback decisions made).
**Time budget:** ~25 hours (~5 hrs/day × 5 days). Actual site provisioning is fast; the tedious part is column definitions.
**Working account:** D2 tenant service account with SharePoint admin + site collection admin roles.

The order matters. Lookup columns can't be created before the target list exists. Choice columns must exist before any list references them. This runbook is dependency-ordered — follow top to bottom.

---

## Day 1 — Site + shell (~4 hrs)

### Step 1 — Provision the SharePoint site

Go to `https://admin.microsoft.com` → SharePoint admin center (or directly to `https://[tenant]-admin.sharepoint.com`).

**Create a Team site** (not Communication site — we need the group-based permissions):
- Site name: `D2 Build Scheduler`
- URL: `d2-scheduler`
- Description: "D2 pool construction scheduling system — owned by Stratirus"
- Language: English
- Sensitivity label: whatever D2's tenant default is
- Privacy: Private
- Owner: your service account
- Additional owners: Shane's Stratirus account (belt-and-suspenders access)

After creation, the site URL is `https://[tenant].sharepoint.com/sites/d2-scheduler`. Note this — it's referenced everywhere.

### Step 2 — Create the four permission groups

Site → **Settings gear** → **Site permissions** → **Advanced permissions settings** → **Create Group** (×4).

| Group | Permission level | Members to add now |
|---|---|---|
| `D2 Office Admins` | Full Control | Shane, service account |
| `D2 Project Managers` | Contribute | (add later when Don names them) |
| `D2 Crew Leads` | Read | (add later — 10 crew leads) |
| `D2 Owners (View Only)` | Read | Don, +2 owners TBD |

Remove the site's default `d2-scheduler Members` and `d2-scheduler Owners` groups from any list permissions we grant. All list-level permissions will reference the four groups above only.

### Step 3 — Delete the default "Documents" library

We're not using it. Keeps the site clean.

Site contents → click `Documents` → Settings → Delete this document library.

---

## Day 2 — Reference lists (~3 hrs)

Create in this exact order. Each list uses the "Blank list" template from **New → List** on the site homepage.

### Step 4 — Trades list

**Name:** `Trades`  
**Description:** "Reference list of the 26 trades used across all crews and sub-phases."

**Columns** (delete the default `Title` column and re-create as below to control the name):

| Column | Type | Required | Enforce unique | Notes |
|---|---|---|---|---|
| Title | Single line of text | Yes | Yes | The trade's display name — e.g. "Steel / Rebar" |
| TradeCode | Single line of text | Yes | Yes | Short code — e.g. "rebar" |
| SortOrder | Number | No | No | Integer for display ordering |

**Enforce unique on Title:** List settings → click `Title` column → scroll to bottom → **Enforce unique values**. Requires the column to be indexed (SharePoint will offer to index it automatically — accept).

**Same for TradeCode.**

⚠️ *If "Enforce unique values" isn't visible where I described, Microsoft may have moved it into the column edit dialog directly. Check both List settings and the column's kebab menu.*

### Step 5 — Crews list

**Name:** `Crews`

| Column | Type | Required | Enforce unique | Notes |
|---|---|---|---|---|
| Title | Single line of text | Yes | Yes | Crew name — e.g. "Devon Crew +3" |
| CrewID | Single line of text | Yes | Yes | Stable short code matching browser tool (`devon`, `guillermo`, etc.) |
| Size | Number | No | No | Nullable |
| Unlimited | Yes/No | No | No | TRUE for capacity-exempt buckets |
| Members | Person or group, multi-select | No | No | Only populated for internal field crews |
| Active | Yes/No | Yes | No | Default: Yes |

### Step 6 — Crew–Trade intersect list

**Name:** `Crew-Trades`

Lookup columns require the target list to exist — Trades and Crews are now both in place, so we can build this.

| Column | Type | Notes |
|---|---|---|
| Title | Single line of text | Auto-generated from flow, format: `[CrewID]-[TradeCode]` |
| Crew | Lookup → Crews (show: Title) | Required |
| Trade | Lookup → Trades (show: Title) | Required |
| QualificationNote | Multiple lines of text | Optional |

No enforce-unique on lookups (SharePoint doesn't support it cleanly on composite). Uniqueness is enforced by the seed data process — no duplicate `(Crew, Trade)` pairs.

### Step 7 — Work Calendar list

**Name:** `Work Calendar`

| Column | Type | Required | Notes |
|---|---|---|---|
| Title | Single line of text | Yes | Human-readable — e.g. "Independence Day 2026" |
| Date | Date only | Yes | Enforce unique per (Date, Crew) combo — done via flow, not schema |
| Reason | Choice | Yes | Sunday, Holiday, Weather, Shutdown |
| Crew | Lookup → Crews | No | Optional; blank means all crews |

Seed the Sunday rows now via a Power Automate flow (see Step 15). Manual entry for holidays and weather.

---

## Day 3 — Job + Assignment lists (~5 hrs)

### Step 8 — Jobs list

**Name:** `Jobs`

| Column | Type | Required | Enforce unique | Notes |
|---|---|---|---|---|
| Title | Single line of text | Yes | No | Job display name — e.g. "Harrison Residence" |
| JobNumber | Single line of text | Yes | Yes | Stable code — D2-1001, D2-1002, etc. |
| Address | Single line of text | No | No | |
| City | Single line of text | No | No | |
| State | Single line of text | No | No | 2-letter |
| ZIP | Single line of text | No | No | |
| StartDate | Date only | Yes | No | |
| Status | Choice | Yes | No | Planned, Active, On Hold, Complete |
| ProjectManager | Person or group | Yes | No | Restrict to `D2 Project Managers` group in column settings |
| ScheduledFinish | Date only | No | No | Written by reconciliation flow; make read-only in view forms |

### Step 9 — Sub-phase Assignments list (the big one)

**Name:** `Sub-phase Assignments`

This is the largest list by column count and by row count. Take time to get column types right — changing them later requires a migration.

| Column | Type | Required | Notes |
|---|---|---|---|
| Title | Single line of text | Yes | Format: `[JobNumber] [SubPhaseNumber] [SubPhaseName]` — set by flow |
| Job | Lookup → Jobs (show: JobNumber) | Yes | |
| SubPhaseNumber | Single line of text | Yes | e.g. "2.2" |
| SubPhaseName | Single line of text | Yes | e.g. "Steel Installation" |
| Trade | Lookup → Trades (show: Title) | No | Empty for coordination-only sub-phases |
| Crew | Lookup → Crews (show: Title) | No | Empty when Unassigned |
| Sequence | Number | Yes | For ordering within a job |
| ScheduledStart | Date only | Yes | |
| DurationDays | Number | Yes | Default: 2 (per current template placeholder) |
| ScheduledFinish | Date only | No | Written by flow when Start/Duration change |
| Locked | Yes/No | Yes | Default: No |
| NotApplicable | Yes/No | Yes | Default: No |
| InstallerSignOff | Yes/No | Yes | Default: No |
| InstallerSignOffBy | Person or group | No | Written by intake flow only |
| InstallerSignOffOn | Date and time | No | Written by intake flow only |
| WorkDate | Date only | No | Distinct from InstallerSignOffOn. See Rev D §04. |
| PMSignOff | Yes/No | Yes | Default: No |
| PMSignOffBy | Person or group | No | |
| PMSignOffOn | Date and time | No | |
| SignOffNotes | Multiple lines of text | No | |
| TasksTotal | Number | No | Written by canvas app |
| TasksComplete | Number | No | Written by canvas app |

**Index the `Job` lookup column and the `Crew` lookup column** — both will be heavy filter targets for views. Site settings → Site columns → find the column → Column settings → Index this column. (Or: List settings → Indexed columns → Create a new index.)

⚠️ *Verify current UI path for indexed-column creation. Historically at List settings → Advanced settings → "Indexed Columns" link. Microsoft may have moved this under "Column settings" → "Add index" in the modern experience.*

**Views to create:**

| View name | Filter | Sort | Group by |
|---|---|---|---|
| All Assignments | (none) | ScheduledStart asc | Job |
| This Week by Crew | ScheduledStart between [Today] and [Today]+7 | ScheduledStart asc | Crew |
| Unassigned | Crew is empty AND Trade is not empty | ScheduledStart asc | (none) |
| Sign-off Overdue | ScheduledFinish < [Today] AND InstallerSignOff = No | ScheduledFinish asc | Crew |
| Late-Starting Jobs | ScheduledStart < [Today] AND InstallerSignOff = No | ScheduledStart asc | Job |

---

## Day 4 — Tasks list + Teams channels (~4 hrs)

### Step 10 — Sub-phase Tasks list

**Name:** `Sub-phase Tasks`

| Column | Type | Required | Notes |
|---|---|---|---|
| Title | Single line of text | Yes | Task label from template |
| Assignment | Lookup → Sub-phase Assignments (show: Title) | Yes | INDEX THIS COLUMN — critical for view perf |
| Sequence | Number | Yes | Order within the sub-phase |
| Complete | Yes/No | Yes | Default: No. Written via canvas app. |
| CompletedBy | Person or group | No | Auto-stamped |
| CompletedOn | Date and time | No | Auto-stamped |

**Views:**

| View name | Filter | Sort | Group by |
|---|---|---|---|
| All Tasks (by Assignment) | (none) | Sequence asc | Assignment |
| Incomplete for Today | Complete = No AND Assignment/ScheduledStart <= [Today] AND Assignment/ScheduledFinish >= [Today] | Sequence asc | Assignment |

### Step 11 — Teams channels

Go to the Team associated with the SharePoint site (created automatically with the site).

**Add two channels:**

- `Field Dispatch` — Standard channel. Members: all crew leads + Shane + service account. Purpose: daily dispatch posts, sign-off confirmations.
- `Ownership` — Private channel. Members: Don + 2 owners + Shane + service account. Purpose: conflict alerts, weekly PDFs, daily PDFs.

Add a **SharePoint Lists tab** to each channel:
- `Field Dispatch` → tab pointing at the `Sub-phase Assignments` list, "This Week by Crew" view
- `Ownership` → tab pointing at the `Jobs` list, "Late-Starting Jobs" view

### Step 12 — Verify the site permissions inheritance

Every list → List settings → Permissions for this list → **Stop inheriting permissions** → set to:

| List | Office Admins | Project Managers | Crew Leads | Owners |
|---|---|---|---|---|
| Jobs | Full Control | Contribute | Read (filtered view only) | Read |
| Sub-phase Assignments | Full Control | Contribute | Read (filtered view only) | Read |
| Sub-phase Tasks | Full Control | Contribute | **Contribute (via canvas app / flow only)** | Read |
| Trades | Full Control | Read | Read | Read |
| Crew-Trades | Full Control | Read | Read | Read |
| Crews | Full Control | Contribute | Read | Read |
| Work Calendar | Full Control | Contribute | Read | Read |

Note on `Sub-phase Tasks`: crew leads *do* need to write to this list (task completion), but the write happens through the canvas app calling a flow. Grant Contribute at the list level but restrict actual edits via canvas-app column bindings — no direct list editing from crew-lead browsers. Verify in Phase C pilot.

---

## Day 5 — Seed data import + exit gate (~5 hrs)

### Step 13 — Import Trades

From `D2-Build-Scheduler/data/trades.csv` (26 rows). Two options:

**Option A — Excel via SharePoint's Grid edit mode:**
1. Open Trades list → Switch to Grid view
2. Paste 26 rows from Excel (Title, TradeCode, SortOrder columns)
3. Save

**Option B — Power Automate one-time flow:**
1. Manual trigger → For each row in a JSON array → Create item in Trades
2. Paste the JSON payload from data/trades.csv converted to JSON

Option A is faster for one-time seeds. Option B is repeatable for Dev-to-Prod later.

### Step 14 — Import Crews

From `data/crews.csv`. Apply subcontractor patch:
- Flip `Unlimited = Yes` on George, Armondo, STL Shotcrete, Brothers
- Leave `Size` and `Members` empty on those four

Same Grid-view paste method.

### Step 15 — Seed Sunday rows in Work Calendar

Create a Power Automate manual flow:
- Trigger: manual button
- Compose: array of the next 52 Sunday dates (calculate from today)
- Apply to each: Create item in Work Calendar (Title: "Sunday", Date: current item, Reason: "Sunday")

Run once. Add US federal holidays manually via Grid view (10 rows).

### Step 16 — Import Crew-Trades intersect

From `data/crew-trades.csv`. Grid paste after resolving Crew and Trade lookups by CrewID / TradeCode. If lookups don't resolve on paste (SharePoint sometimes needs the display value), you'll need to convert IDs — use a small Automate flow to look up and create.

### Step 17 — Verify Phase A exit gate

Open each list, confirm:

- ✅ Trades has 26 rows, unique enforced on Title and TradeCode
- ✅ Crews has 14 rows, four flagged Unlimited=Yes
- ✅ Crew-Trades has ~51 rows, all lookups resolve
- ✅ Work Calendar has 52 Sundays plus 10 holidays
- ✅ Jobs list opens, JobNumber unique enforced (test: try to add two with same JobNumber, second one rejects)
- ✅ Sub-phase Assignments opens, all views show correct filters
- ✅ Sub-phase Tasks opens, Assignment lookup indexed
- ✅ Permission groups exist, list-level inheritance broken and per-list permissions set
- ✅ Teams channels created with SharePoint tabs pointing at correct views

> **CORRECTION 2026-09-07 — two of the checks above were ticked but never done.**
> The lists were provisioned and seeded correctly, but **no views existed** on any list
> (every one had only the default `All Items`) until they were built on 2026-09-07, and
> **no Teams channels were ever created** — Teams was later deferred post-pilot and every
> flow delivers by email instead. Left in place as the historical record; do not read the
> ticks as evidence. The lesson is that an exit gate is only worth what it was actually
> checked against.

**Test the Skill Coverage query:** open Trades list → click on the "Steel / Rebar" row → the "Related items" pane should show any Crew-Trades rows referencing that trade. If it does, the lookup wiring is correct and Ryan-Claude's concern about killing this query pattern is proven addressed.

**If any check fails, do not proceed to Phase B automations.** Fix in Phase A or extend by half a day.

---

## Common gotchas

- **Choice column values are case-sensitive.** "Planned" and "planned" become different values. Standardize on Title Case in every Choice list.
- **Person columns don't accept external users** unless the tenant is B2B-configured. All ProjectManager and CompletedBy assignments must be D2 or Stratirus tenant accounts.
- **Lookup column changes are painful.** If you need to add a new option to Status, edit the Choice column. If you need to change a Trade name, edit the Trades list row — every reference follows automatically.
- **Enforce unique doesn't work after data exists** unless every existing value is already unique. Enforce it before importing seed data.
- **View filters on lookup columns** need special syntax — use `Job/JobNumber` not `Job` when filtering.

---

## What Phase B starts with

Every column and permission in place. Phase B's Automate flows write into this schema — if anything is misspelled or wrong-typed, Phase B gets ugly. Extra 30 minutes of Phase A verification saves days in Phase B.
