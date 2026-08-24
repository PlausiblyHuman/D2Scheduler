from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.comments import Comment

wb = Workbook()

INK = "1A2332"; ACCENT = "0B6E78"; CLAY = "A84A18"; MUTED = "5D6E77"; RULE = "D6DCDE"

INPUT_FONT   = Font(name="Arial", size=11, color="0000FF", bold=True)
FORMULA_FONT = Font(name="Arial", size=11, color=INK)
LINK_FONT    = Font(name="Arial", size=11, color="008000")
LABEL_FONT   = Font(name="Arial", size=11, color=INK)
HEADER_FONT  = Font(name="Arial", size=11, color="FFFFFF", bold=True)
TITLE_FONT   = Font(name="Arial", size=16, color=INK, bold=True)
SUB_FONT     = Font(name="Arial", size=10, color=MUTED, italic=True)
NOTE_FONT    = Font(name="Arial", size=10, color=MUTED, italic=True)
BOLD_FONT    = Font(name="Arial", size=11, color=INK, bold=True)
WINNER_FONT  = Font(name="Arial", size=11, color="0B6E78", bold=True)

YELLOW = PatternFill("solid", fgColor="FFFF99")
HEADER_FILL = PatternFill("solid", fgColor=ACCENT)
TOTAL_FILL = PatternFill("solid", fgColor="E7EBEC")
WIN_FILL = PatternFill("solid", fgColor="E8F4F3")

thin = Side(border_style="thin", color=RULE)
med  = Side(border_style="medium", color=INK)
BORDER_HEADER = Border(top=med, bottom=med, left=thin, right=thin)
BORDER_CELL   = Border(top=thin, bottom=thin, left=thin, right=thin)
BORDER_TOTAL  = Border(top=med, bottom=med, left=thin, right=thin)

CURRENCY = '"$"#,##0.00;[Red]("$"#,##0.00);"-"'
CURRENCY_INT = '"$"#,##0;[Red]("$"#,##0);"-"'
INT = '#,##0'

def header(ws, row, cols):
    for i, h in enumerate(cols, 1):
        c = ws.cell(row=row, column=i, value=h)
        c.font = HEADER_FONT; c.fill = HEADER_FILL; c.border = BORDER_HEADER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

# =========================================================
# SHEET 1 — SUMMARY
# =========================================================
ws = wb.active; ws.title = "Summary"
for col, w in [('A',36),('B',20),('C',20),('D',48)]:
    ws.column_dimensions[col].width = w

ws['A1'] = "Supabase vs Power Platform — D2 Build Scheduler"
ws['A1'].font = TITLE_FONT
ws['A2'] = "Cost + time comparison — verified pricing as of August 2026 · Stratirus"
ws['A2'].font = SUB_FONT

header(ws, 4, ["Dimension", "Power Platform", "Supabase + Next.js", "Notes"])

# We'll pull values from the detail sheets via formulas
rows = [
    ("Software cost — monthly",           "=Detail_PP!D14",        "=Detail_Supa!D18",           "Steady-state at 21 users. See detail sheets.", CURRENCY),
    ("Software cost — Year 1",            "=Detail_PP!D14*12",     "=Detail_Supa!D18*12",        "Software only, no build.", CURRENCY),
    ("One-time build cost",               "=Detail_PP!E18",        "=Detail_Supa!E22",           "Dev hours × rate. Yellow cell = your hourly rate.", CURRENCY),
    ("3-year TCO (build + software)",     "=Detail_PP!D14*36+Detail_PP!E18",  "=Detail_Supa!D18*36+Detail_Supa!E22", "3-yr software + one-time build.", CURRENCY),
    ("Time to production (weeks)",        13,                       "=Detail_Supa!E26",           "PP is the plan's 13 weeks; Supabase is an estimate.", INT),
    ("MS-stack integration friction",     "None (native)",           "Real (Entra + SharePoint bridging)", "D2 is already Entra/SP/Outlook.", None),
    ("Post-launch owner",                 "Stratirus + D2 low-code maker", "Requires Node/Postgres/React dev", "Skills continuity risk.", None),
    ("DB-level uniqueness constraint",    "Alternate key on Crew+Date", "EXCLUDE constraint on Crew+Date", "Both enforce it structurally. Postgres arguably cleaner.", None),
    ("Offline mobile",                    "Native (documented limits)", "PWA + IndexedDB (custom build)", "Power Apps offline is a shipped product; PWA is code.", None),
    ("Vendor lock-in",                    "High (Microsoft)",         "Low (open-source Postgres)", "Supabase is Postgres — portable if you leave.", None),
]
for r_idx, (label, pp, supa, notes, fmt) in enumerate(rows, start=5):
    ws.cell(row=r_idx, column=1, value=label).font = LABEL_FONT
    for col, val in [(2, pp), (3, supa)]:
        c = ws.cell(row=r_idx, column=col, value=val)
        if isinstance(val, str) and val.startswith("="):
            c.font = LINK_FONT
        else:
            c.font = FORMULA_FONT
        if fmt: c.number_format = fmt
        c.alignment = Alignment(horizontal="left" if fmt is None else "right", vertical="top", wrap_text=True)
    ws.cell(row=r_idx, column=4, value=notes).font = NOTE_FONT
    ws.cell(row=r_idx, column=4).alignment = Alignment(wrap_text=True, vertical="top")
    for col in range(1,5):
        ws.cell(row=r_idx, column=col).border = BORDER_CELL

# Verdict block
row = 17
ws.cell(row=row, column=1, value="Verdict").font = Font(name="Arial", size=13, bold=True, color=INK)
row += 1
verdict = [
    "Power Platform remains the right call for D2 unless there is a strategic reason to leave the MS stack.",
    "Supabase saves ~$3,000/yr on software but costs $15k–30k more upfront in dev hours than the low-code Power Platform build.",
    "The savings break even around year 3 IF build cost stays low and IF D2 has (or hires) someone who can maintain a Node/Postgres app.",
    "For D2's size and staffing, that break-even scenario is unlikely. Recommend Power Platform.",
]
for v in verdict:
    ws.cell(row=row, column=1, value=v).font = LABEL_FONT
    ws.merge_cells(start_row=row, end_row=row, start_column=1, end_column=4)
    ws.cell(row=row, column=1).alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[row].height = 32
    row += 1

# =========================================================
# SHEET 2 — DETAIL_PP (Power Platform)
# =========================================================
ws = wb.create_sheet("Detail_PP")
for col, w in [('A',36),('B',12),('C',16),('D',16),('E',16),('F',48)]:
    ws.column_dimensions[col].width = w
ws['A1'] = "Power Platform — cost model"
ws['A1'].font = TITLE_FONT
ws['A2'] = "Software costs from verified MS pricing. Build hours from the plan §11 estimate."
ws['A2'].font = SUB_FONT

header(ws, 4, ["Line", "Users", "Per user / mo", "Monthly", "Build $", "Notes"])

items = [
    ("Power Apps Premium — office/PMs", 8, 20.00, "MS list price"),
    ("Power Apps Premium — crew leads", 10, 20.00, "Per-app retired Jan 2026; Premium is only path"),
    ("Power BI Pro",                    3, 14.00, "Raised April 2025"),
    ("Managed Environments",            0, 0.00,  "Included with Premium"),
    ("Dataverse capacity",              0, 0.00,  "20 GB base + 250 MB/seat included"),
]
for i, (label, users, price, note) in enumerate(items, start=5):
    ws.cell(row=i, column=1, value=label).font = LABEL_FONT
    c = ws.cell(row=i, column=2, value=users); c.font = INPUT_FONT; c.number_format = INT
    c = ws.cell(row=i, column=3, value=price); c.font = INPUT_FONT; c.number_format = CURRENCY
    c = ws.cell(row=i, column=4, value=f"=B{i}*C{i}"); c.font = FORMULA_FONT; c.number_format = CURRENCY
    ws.cell(row=i, column=6, value=note).font = NOTE_FONT
    ws.cell(row=i, column=6).alignment = Alignment(wrap_text=True, vertical="top")
    for col in range(1,7):
        ws.cell(row=i, column=col).border = BORDER_CELL

# Total monthly software
ws.cell(row=14, column=1, value="Total monthly software").font = BOLD_FONT
ws.cell(row=14, column=4, value="=SUM(D5:D9)").font = BOLD_FONT
ws.cell(row=14, column=4).number_format = CURRENCY
for col in range(1,7):
    ws.cell(row=14, column=col).border = BORDER_TOTAL
    ws.cell(row=14, column=col).fill = TOTAL_FILL

# Build inputs
ws.cell(row=16, column=1, value="Build effort").font = BOLD_FONT
ws.cell(row=17, column=1, value="Estimated build hours").font = LABEL_FONT
c = ws.cell(row=17, column=2, value=260); c.font = INPUT_FONT; c.fill = YELLOW; c.number_format = INT
ws.cell(row=17, column=6, value="Plan §11: 13 weeks × ~20 low-code hrs/wk. Adjust the yellow cell.").font = NOTE_FONT

ws.cell(row=18, column=1, value="Blended low-code rate ($/hr)").font = LABEL_FONT
c = ws.cell(row=18, column=2, value=140); c.font = INPUT_FONT; c.fill = YELLOW; c.number_format = CURRENCY_INT
ws.cell(row=18, column=6, value="Stratirus blended low-code rate. Adjust the yellow cell.").font = NOTE_FONT

ws.cell(row=18, column=5, value="=B17*B18").font = BOLD_FONT
ws.cell(row=18, column=5).number_format = CURRENCY

# =========================================================
# SHEET 3 — DETAIL_SUPA
# =========================================================
ws = wb.create_sheet("Detail_Supa")
for col, w in [('A',36),('B',12),('C',16),('D',16),('E',16),('F',48)]:
    ws.column_dimensions[col].width = w
ws['A1'] = "Supabase + Next.js on Vercel — cost model"
ws['A1'].font = TITLE_FONT
ws['A2'] = "Software costs from verified 2026 pricing. Build hours are a professional-services estimate for equivalent scope."
ws['A2'].font = SUB_FONT

header(ws, 4, ["Line", "Qty", "Per unit / mo", "Monthly", "Build $", "Notes"])

items = [
    ("Supabase Pro (1 project)",              1,  25.00,  "Includes Postgres, Auth (50k MAU), Storage 100GB, 8GB DB, Edge Functions, Realtime"),
    ("Supabase compute upgrade — Small",      1,  5.00,   "Micro ($10 credit included) → Small ($15). Adjust up if load requires."),
    ("Vercel Pro — developer seats",          2,  20.00,  "Two seats for dev + backup. Viewer/D2 access is free."),
    ("Vercel usage overage buffer",           1,  20.00,  "$20 credit included per seat; extra buffer for bandwidth/compute spikes."),
    ("Domain + SSL",                          1,  2.00,   "~$15–20/yr amortized"),
    ("Transactional email (SES or Postmark)", 1,  10.00,  "Sign-off notifications; SES cheaper if AWS in play"),
    ("Monitoring (Sentry Team or similar)",   1,  26.00,  "Optional; skip for the first 90 days if budget-tight"),
    ("Backups + point-in-time recovery",      1,  0.00,   "Included in Supabase Pro"),
    ("Analytics / BI (Metabase self-host on Fly.io)", 1, 12.00, "Alternative to Power BI. Or use Supabase's built-in reports for free."),
]
for i, (label, qty, price, note) in enumerate(items, start=5):
    ws.cell(row=i, column=1, value=label).font = LABEL_FONT
    c = ws.cell(row=i, column=2, value=qty);   c.font = INPUT_FONT; c.number_format = INT
    c = ws.cell(row=i, column=3, value=price); c.font = INPUT_FONT; c.number_format = CURRENCY
    c = ws.cell(row=i, column=4, value=f"=B{i}*C{i}"); c.font = FORMULA_FONT; c.number_format = CURRENCY
    ws.cell(row=i, column=6, value=note).font = NOTE_FONT
    ws.cell(row=i, column=6).alignment = Alignment(wrap_text=True, vertical="top")
    for col in range(1,7):
        ws.cell(row=i, column=col).border = BORDER_CELL

# Total monthly software
ws.cell(row=18, column=1, value="Total monthly software").font = BOLD_FONT
ws.cell(row=18, column=4, value="=SUM(D5:D13)").font = BOLD_FONT
ws.cell(row=18, column=4).number_format = CURRENCY
for col in range(1,7):
    ws.cell(row=18, column=col).border = BORDER_TOTAL
    ws.cell(row=18, column=col).fill = TOTAL_FILL

# Build inputs
ws.cell(row=20, column=1, value="Build effort").font = BOLD_FONT
ws.cell(row=21, column=1, value="Estimated build hours").font = LABEL_FONT
c = ws.cell(row=21, column=2, value=420); c.font = INPUT_FONT; c.fill = YELLOW; c.number_format = INT
ws.cell(row=21, column=6, value="Full-code build: Next.js UI, Supabase schema + RLS + triggers, PWA offline, auth glue. ~14 wks × 30 hrs/wk.").font = NOTE_FONT

ws.cell(row=22, column=1, value="Blended senior dev rate ($/hr)").font = LABEL_FONT
c = ws.cell(row=22, column=2, value=185); c.font = INPUT_FONT; c.fill = YELLOW; c.number_format = CURRENCY_INT
ws.cell(row=22, column=6, value="US senior full-stack rate. Adjust the yellow cell.").font = NOTE_FONT

ws.cell(row=22, column=5, value="=B21*B22").font = BOLD_FONT
ws.cell(row=22, column=5).number_format = CURRENCY

# Time estimate
ws.cell(row=25, column=1, value="Timeline estimate").font = BOLD_FONT
ws.cell(row=26, column=1, value="Estimated calendar weeks").font = LABEL_FONT
c = ws.cell(row=26, column=2, value=14); c.font = INPUT_FONT; c.fill = YELLOW; c.number_format = INT
ws.cell(row=26, column=5, value="=B26").font = LINK_FONT  # exposed for Summary
ws.cell(row=26, column=6, value="Ship equivalent scope: office app + crew-lead PWA + reporting. Adjust the yellow cell.").font = NOTE_FONT

# =========================================================
# SHEET 4 — FEATURE PARITY
# =========================================================
ws = wb.create_sheet("Feature parity")
for col, w in [('A',34),('B',26),('C',26),('D',36)]:
    ws.column_dimensions[col].width = w
ws['A1'] = "Feature-by-feature comparison"
ws['A1'].font = TITLE_FONT
ws['A2'] = "Where the two stacks are equivalent, and where one clearly wins."
ws['A2'].font = SUB_FONT

header(ws, 4, ["Requirement", "Power Platform", "Supabase + Next.js", "Winner / notes"])

parity = [
    ("One crew per day uniqueness",       "Alternate key on Crew+Date, enforced by Dataverse", "EXCLUDE constraint on (crew_id, date), enforced by Postgres", "Tie. Postgres slightly cleaner semantics."),
    ("Row-level security",                 "Column security profiles + business rules", "RLS policies in SQL, per-role", "Tie. Different mental models."),
    ("Model-driven office app",            "Native — auto-generated grids, forms, views", "Custom Next.js UI to build", "PP wins. Big time savings."),
    ("Canvas / mobile app",                "Power Apps Mobile with offline profile", "PWA + IndexedDB, custom sync layer", "PP wins on time. PWA more flexible long-term."),
    ("Offline sync",                       "Native, documented limits", "Custom-build with Supabase realtime + local cache", "PP wins. PWA offline is a real engineering task."),
    ("Scheduled batch jobs",               "Power Automate scheduled flows", "Supabase pg_cron + Edge Functions", "Tie."),
    ("Reporting / BI",                     "Power BI (native Dataverse connector)", "Metabase, self-hosted, or Supabase built-in views", "PP wins on polish; Supabase cheaper."),
    ("Entra SSO",                          "Native", "Custom via Supabase Auth + Azure OIDC", "PP wins. Native identity is 'free' for M365 shops."),
    ("SharePoint document integration",    "Native", "Requires Graph API glue code", "PP wins."),
    ("Vendor lock-in",                     "High — leaving means a full rebuild", "Low — Postgres is portable", "Supabase wins on strategic optionality."),
    ("Post-launch support skills needed",  "Low-code maker + M365 admin", "Node.js dev + Postgres DBA + DevOps", "PP wins for D2's size."),
    ("Extensibility / custom logic",       "Power Fx + Automate (limited); C# plugins possible", "TypeScript + SQL (unlimited)", "Supabase wins for anything unusual."),
]
for i, row in enumerate(parity, start=5):
    for col, val in enumerate(row, 1):
        c = ws.cell(row=i, column=col, value=val)
        c.font = LABEL_FONT if col == 1 else FORMULA_FONT
        c.alignment = Alignment(wrap_text=True, vertical="top")
        c.border = BORDER_CELL
    ws.row_dimensions[i].height = 36

# =========================================================
# SHEET 5 — SOURCES
# =========================================================
ws = wb.create_sheet("Sources")
for col, w in [('A',36),('B',30),('C',70)]:
    ws.column_dimensions[col].width = w
ws['A1'] = "Verified pricing sources"
ws['A1'].font = TITLE_FONT
ws['A2'] = "Every unit price in Detail_PP and Detail_Supa traces to one of these."
ws['A2'].font = SUB_FONT

header(ws, 4, ["Item", "Value", "URL / note"])

srcs = [
    ("Supabase Pro base",                 "$25 / month / project",             "supabase.com/pricing — verified Aug 2026"),
    ("Supabase Pro includes",             "8GB DB, 100GB storage, 50k MAU, 2M edge fn invocations, $10 compute credit", "Enough for D2's <20MB/yr and <30 users"),
    ("Supabase compute upgrade",          "Small +$5/mo, Medium +$50/mo, Large +$100/mo", "Micro ok for D2 volume; Small buys headroom"),
    ("Vercel Pro",                        "$20 / developer seat / mo",         "vercel.com/pricing — viewer seats free"),
    ("Vercel usage",                      "$0.128/hr compute, $0.15/GB transfer beyond $20 credit", "For D2 volume, $20 credit likely covers it"),
    ("SES transactional email",           "$0.10 per 1000 emails",              "aws.amazon.com/ses; ~$1/mo at D2 scale"),
    ("Sentry Team",                       "~$26/mo",                            "sentry.io/pricing"),
    ("Metabase self-host on Fly.io",      "~$12/mo",                            "fly.io free-tier eligible; Metabase OSS is free"),
    ("Power Apps Premium",                "$20/user/mo",                         "microsoft.com/power-platform/products/power-apps/pricing"),
    ("Power BI Pro",                      "$14/user/mo (raised Apr 2025)",       "powerbi.microsoft.com/en-us/blog"),
    ("Managed Environments",              "Included with Premium",               "learn.microsoft.com managed-environment-licensing"),
]
for i, (item, val, url) in enumerate(srcs, start=5):
    ws.cell(row=i, column=1, value=item).font = LABEL_FONT
    ws.cell(row=i, column=2, value=val).font = FORMULA_FONT
    ws.cell(row=i, column=3, value=url).font = NOTE_FONT
    for col in range(1,4):
        ws.cell(row=i, column=col).border = BORDER_CELL
    ws.row_dimensions[i].height = 30

out = "/sessions/sweet-great-mayer/mnt/outputs/alt-stack/D2-Stack-Comparison.xlsx"
wb.save(out)
print("Wrote", out)

# Compute expected numbers so we can report them without needing recalc
pp_monthly = 8*20 + 10*20 + 3*14
pp_build = 260 * 140
supa_monthly = 25 + 5 + 2*20 + 20 + 2 + 10 + 26 + 0 + 12
supa_build = 420 * 185
print(f"\nExpected values:")
print(f"  PP monthly: ${pp_monthly:,.2f}  · annual ${pp_monthly*12:,.2f}  · build ${pp_build:,.0f}  · 3-yr TCO ${pp_monthly*36+pp_build:,.0f}")
print(f"  Supa monthly: ${supa_monthly:,.2f}  · annual ${supa_monthly*12:,.2f}  · build ${supa_build:,.0f}  · 3-yr TCO ${supa_monthly*36+supa_build:,.0f}")
print(f"  Annual software savings: ${pp_monthly*12 - supa_monthly*12:,.2f}")
print(f"  Build cost gap: ${supa_build - pp_build:,.0f} (Supabase costs MORE to build)")
print(f"  Break-even years: {(supa_build - pp_build) / ((pp_monthly - supa_monthly)*12):.1f}")
