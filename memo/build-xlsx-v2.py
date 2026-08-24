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
WIN_FONT     = Font(name="Arial", size=11, color=ACCENT, bold=True)
YELLOW = PatternFill("solid", fgColor="FFFF99")
HEADER_FILL = PatternFill("solid", fgColor=ACCENT)
TOTAL_FILL = PatternFill("solid", fgColor="E7EBEC")
WIN_FILL   = PatternFill("solid", fgColor="E8F4F3")

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

# ========== Sheet 1: Legend / Bottom line ==========
ws = wb.active; ws.title = "Bottom line"
for col, w in [('A',30),('B',18),('C',18),('D',54)]:
    ws.column_dimensions[col].width = w

ws['A1'] = "D2 Build Scheduler — confirmed-scope cost model"
ws['A1'].font = TITLE_FONT
ws['A2'] = "Based on D2 answers: 5 users, no BI, no offline required, four subcontractor crews · Aug 13 2026"
ws['A2'].font = SUB_FONT

header(ws, 4, ["", "Option A (Lists) — RECOMMENDED", "Dataverse plan (fallback)", "Note"])

rows = [
    ("Monthly software cost",       "=Lists!C13",  "=Dataverse!C10",  "Both at confirmed scope: 5 seats, no BI"),
    ("Annual software cost",        "=Lists!C13*12","=Dataverse!C10*12", ""),
    ("One-time build",              "=Lists!F14",   "=Dataverse!F14",  "Build hours × blended rate; edit in respective sheet"),
    ("3-year TCO",                  "=Lists!C13*36+Lists!F14",  "=Dataverse!C10*36+Dataverse!F14", ""),
    ("Time to production (weeks)",  5,              13,                 "Lists is 5 wks; Dataverse is 13 per §11 of the original plan"),
    ("Vs. original plan estimate",  "-100%",        "-75%",             "Original plan was $402/mo — dropping BI and right-sizing seats"),
]
for r, (label, a, b, note) in enumerate(rows, start=5):
    ws.cell(row=r, column=1, value=label).font = LABEL_FONT
    for col, v in [(2, a), (3, b)]:
        c = ws.cell(row=r, column=col, value=v)
        c.font = LINK_FONT if isinstance(v, str) and v.startswith("=") else FORMULA_FONT
        if isinstance(v, (int, float)) and label != "Time to production (weeks)":
            c.number_format = CURRENCY
        elif isinstance(v, str) and v.startswith("=") and "TCO" in label or "cost" in label or "build" in label.lower():
            c.number_format = CURRENCY
        elif label == "Time to production (weeks)":
            c.number_format = INT
    ws.cell(row=r, column=4, value=note).font = NOTE_FONT
    ws.cell(row=r, column=4).alignment = Alignment(wrap_text=True, vertical="top")
    for col in range(1,5):
        ws.cell(row=r, column=col).border = BORDER_CELL

# Highlight the recommended column
for r in range(4, 11):
    ws.cell(row=r, column=2).fill = WIN_FILL

# Notes section
row = 13
ws.cell(row=row, column=1, value="What changed from Rev A of this model").font = Font(name="Arial", size=12, bold=True, color=INK)
row += 1
notes = [
    "Office/PM seats: 3 (Don) + 2 PMs = 5. Was 8 in the original plan.",
    "Power BI Pro: 0 seats. Don confirmed weekly/daily PDFs by email are fine — no dashboards.",
    "Field crew leads: covered by existing M365 seats. Workers (subcontracted labor) are not in the system.",
    "Four subcontractor crews (George, Armondo, STL Shotcrete, Brothers) modeled as capacity-exempt buckets — no roster, no seat.",
    "Stratirus support: baseline for the standard 3-year Stratirus contract with monthly hourly commit — reflected in the SOW, not in this software cost model.",
]
for n in notes:
    ws.cell(row=row, column=1, value="  · " + n).font = LABEL_FONT
    ws.merge_cells(start_row=row, end_row=row, start_column=1, end_column=4)
    ws.cell(row=row, column=1).alignment = Alignment(wrap_text=True)
    row += 1

# ========== Sheet 2: Lists (confirmed scope) ==========
ws = wb.create_sheet("Lists")
for col, w in [('A',34),('B',12),('C',16),('D',16),('E',16),('F',16),('G',44)]:
    ws.column_dimensions[col].width = w

ws['A1'] = "Option A: Microsoft Lists — confirmed scope"
ws['A1'].font = TITLE_FONT
ws['A2'] = "$0 incremental monthly · 5-week build · adjust yellow cells to model changes"
ws['A2'].font = SUB_FONT

header(ws, 4, ["Line", "Qty", "Per unit / mo", "Monthly", "One-time", "Notes"])

lists_items = [
    ("M365 seats (existing, no incremental)",   5,   0.00, "", "3 Don + 2 PMs already licensed"),
    ("Crew lead M365 seats (existing)",          None, 0.00, "", "Leads already have accounts; workers don't touch the system"),
    ("Power Automate premium connectors",         0,   0.00, "", "None used — standard connectors only"),
    ("SharePoint storage",                        1,   0.00, "", "20 GB base + per-seat; D2 uses <100 MB"),
    ("Microsoft Forms",                           1,   0.00, "", "Included"),
    ("Teams channels",                            2,   0.00, "", "Field channel + Ownership channel; included"),
    ("Weekly / daily PDF flow",                   1,   0.00, "", "Standard Convert File action; replaces BI dashboards"),
]
for i, (label, qty, price, monthly, note) in enumerate(lists_items, start=5):
    ws.cell(row=i, column=1, value=label).font = LABEL_FONT
    c = ws.cell(row=i, column=2, value=qty if qty is not None else "—"); c.font = INPUT_FONT if qty is not None else FORMULA_FONT
    if qty is not None: c.number_format = INT
    c = ws.cell(row=i, column=3, value=price); c.font = INPUT_FONT; c.number_format = CURRENCY
    if qty is not None:
        c = ws.cell(row=i, column=4, value=f"=B{i}*C{i}"); c.font = FORMULA_FONT; c.number_format = CURRENCY
    else:
        c = ws.cell(row=i, column=4, value=0); c.font = FORMULA_FONT; c.number_format = CURRENCY
    ws.cell(row=i, column=7, value=note).font = NOTE_FONT
    ws.cell(row=i, column=7).alignment = Alignment(wrap_text=True, vertical="top")
    for col in range(1,8):
        ws.cell(row=i, column=col).border = BORDER_CELL

ws.cell(row=13, column=1, value="Total monthly software").font = BOLD_FONT
ws.cell(row=13, column=3, value="=SUM(D5:D11)").font = BOLD_FONT
ws.cell(row=13, column=3).number_format = CURRENCY
for col in range(1,8):
    ws.cell(row=13, column=col).border = BORDER_TOTAL
    ws.cell(row=13, column=col).fill = TOTAL_FILL

# Build
ws.cell(row=14, column=1, value="Build effort").font = BOLD_FONT
ws.cell(row=15, column=1, value="Estimated build hours").font = LABEL_FONT
c = ws.cell(row=15, column=2, value=100); c.font = INPUT_FONT; c.fill = YELLOW; c.number_format = INT
ws.cell(row=15, column=7, value="Rev C: adds a Tasks list for the 295-task granularity Don wants ticked. +10 hrs from Rev B.").font = NOTE_FONT

ws.cell(row=16, column=1, value="Blended low-code rate ($/hr)").font = LABEL_FONT
c = ws.cell(row=16, column=2, value=140); c.font = INPUT_FONT; c.fill = YELLOW; c.number_format = CURRENCY_INT

ws.cell(row=14, column=6, value="=B15*B16").font = BOLD_FONT
ws.cell(row=14, column=6).number_format = CURRENCY

# ========== Sheet 3: Dataverse (fallback scope) ==========
ws = wb.create_sheet("Dataverse")
for col, w in [('A',34),('B',12),('C',16),('D',16),('E',16),('F',16),('G',44)]:
    ws.column_dimensions[col].width = w

ws['A1'] = "Dataverse plan (fallback) — confirmed scope"
ws['A1'].font = TITLE_FONT
ws['A2'] = "If Option A gets rejected. Original plan at $402/mo becomes $100/mo at confirmed scope."
ws['A2'].font = SUB_FONT

header(ws, 4, ["Line", "Users", "Per user / mo", "Monthly", "One-time", "Notes"])

dv_items = [
    ("Power Apps Premium — office & PMs", 5,  20.00, "3 Don + 2 PMs; was 8 in original plan"),
    ("Power Apps Premium — crew leads",   None, 0.00,  "Now $0 — if we're on Dataverse we'd still need seats for the field app; keeping this line here for the confirmed-scope-with-mobile scenario, adjust as needed"),
    ("Power BI Pro",                      0,   14.00, "Don confirmed weekly PDF acceptable — no BI seats"),
    ("Managed Environments",              None, 0.00, "Included with Premium"),
    ("Dataverse capacity",                None, 0.00, "20 GB base + 250 MB/seat included"),
]
for i, (label, users, price, note) in enumerate(dv_items, start=5):
    ws.cell(row=i, column=1, value=label).font = LABEL_FONT
    c = ws.cell(row=i, column=2, value=users if users is not None else "—")
    c.font = INPUT_FONT if users is not None else FORMULA_FONT
    if users is not None: c.number_format = INT
    c = ws.cell(row=i, column=3, value=price); c.font = INPUT_FONT; c.number_format = CURRENCY
    if users is not None:
        c = ws.cell(row=i, column=4, value=f"=B{i}*C{i}"); c.font = FORMULA_FONT; c.number_format = CURRENCY
    else:
        c = ws.cell(row=i, column=4, value=0); c.font = FORMULA_FONT; c.number_format = CURRENCY
    ws.cell(row=i, column=7, value=note).font = NOTE_FONT
    ws.cell(row=i, column=7).alignment = Alignment(wrap_text=True, vertical="top")
    for col in range(1,8):
        ws.cell(row=i, column=col).border = BORDER_CELL

ws.cell(row=10, column=1, value="Total monthly software").font = BOLD_FONT
ws.cell(row=10, column=3, value="=SUM(D5:D9)").font = BOLD_FONT
ws.cell(row=10, column=3).number_format = CURRENCY
for col in range(1,8):
    ws.cell(row=10, column=col).border = BORDER_TOTAL
    ws.cell(row=10, column=col).fill = TOTAL_FILL

# Build
ws.cell(row=12, column=1, value="Build effort").font = BOLD_FONT
ws.cell(row=13, column=1, value="Estimated build hours").font = LABEL_FONT
c = ws.cell(row=13, column=2, value=260); c.font = INPUT_FONT; c.fill = YELLOW; c.number_format = INT
ws.cell(row=13, column=7, value="Per plan §11: 13 weeks × ~20 low-code hrs/wk. Adjust if BI is dropped from build too.").font = NOTE_FONT

ws.cell(row=14, column=1, value="Blended low-code rate ($/hr)").font = LABEL_FONT
c = ws.cell(row=14, column=2, value=140); c.font = INPUT_FONT; c.fill = YELLOW; c.number_format = CURRENCY_INT
ws.cell(row=12, column=6, value="=B13*B14").font = BOLD_FONT
ws.cell(row=12, column=6).number_format = CURRENCY
ws.cell(row=14, column=6, value="=B13*B14").font = BOLD_FONT  # ensure total build one-time visible
ws.cell(row=14, column=6).number_format = CURRENCY

# Ensure F14 has the build total for Bottom line reference
ws.cell(row=14, column=6, value="=B13*B14")

# ========== Sheet 4: What changed ==========
ws = wb.create_sheet("What changed")
for col, w in [('A',24),('B',24),('C',24),('D',50)]:
    ws.column_dimensions[col].width = w

ws['A1'] = "What changed from the previous cost model"
ws['A1'].font = TITLE_FONT
ws['A2'] = "Driven by David and Don's answers on the Aug 13 call"
ws['A2'].font = SUB_FONT

header(ws, 4, ["Line", "Previous", "Confirmed", "Reason"])
changes = [
    ("Office/PM seats",           "8 assumed",              "5 (3 Don + 2 PMs)",           "Right-sized to actual per Don"),
    ("Power BI Pro seats",        "3",                       "0",                            "Don confirmed weekly/daily PDF by email acceptable"),
    ("Crew lead seats",           "10 Premium",              "0 incremental (existing M365)","Leads already licensed; workers don't touch the system"),
    ("Field workers",             "10 Premium (was $200/mo)","Not in the system",            "Sign-off is at the lead level only"),
    ("Offline mobile requirement","Load-bearing",           "Not required",                 "David: online required for all mobile / laptop use"),
    ("Task granularity",          "295 tasks (or 46 collapsed)","295 tasks kept",             "Don wants each step ticked"),
    ("Subcontractor crew handling","Undefined",             "Unlimited=Yes on 4 crews",     "George, Armondo, STL Shotcrete, Brothers"),
    ("Post-launch support",       "Discussed separately",   "Standard 3-yr Stratirus contract","Baseline; not a separate cost line"),
]
for i, r in enumerate(changes, start=5):
    for col, v in enumerate(r, 1):
        c = ws.cell(row=i, column=col, value=v)
        c.font = LABEL_FONT if col == 1 else FORMULA_FONT
        c.border = BORDER_CELL
        c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[i].height = 32

out = "/sessions/sweet-great-mayer/mnt/outputs/memo/D2-License-Model-Confirmed.xlsx"
wb.save(out)
print("Wrote", out)

# Print expected values
print()
print("Expected values:")
print(f"  Lists monthly: $0 · annual $0 · build ${100*140}")
print(f"  Dataverse monthly: ${5*20 + 0*14} · annual ${(5*20)*12} · build ${260*140}")
print(f"  Lists 3-yr TCO: ${100*140}")
print(f"  Dataverse 3-yr TCO: ${100*36 + 260*140}")
