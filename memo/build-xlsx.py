from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, NamedStyle
from openpyxl.utils import get_column_letter
from openpyxl.comments import Comment

wb = Workbook()

# ---------- Styling constants ----------
INK = "1A2332"
ACCENT = "0B6E78"
MUTED = "5D6E77"
RULE = "D6DCDE"

INPUT_FONT = Font(name="Arial", size=11, color="0000FF", bold=True)   # blue = input
FORMULA_FONT = Font(name="Arial", size=11, color=INK)
LINK_FONT = Font(name="Arial", size=11, color="008000")               # green = cross-sheet link
LABEL_FONT = Font(name="Arial", size=11, color=INK)
HEADER_FONT = Font(name="Arial", size=11, color="FFFFFF", bold=True)
TITLE_FONT = Font(name="Arial", size=16, color=INK, bold=True)
SUBTITLE_FONT = Font(name="Arial", size=10, color=MUTED, italic=True)
NOTE_FONT = Font(name="Arial", size=10, color=MUTED, italic=True)

YELLOW = PatternFill("solid", fgColor="FFFF99")
HEADER_FILL = PatternFill("solid", fgColor=ACCENT)
ALT_FILL = PatternFill("solid", fgColor="F0F3F4")
TOTAL_FILL = PatternFill("solid", fgColor="E7EBEC")

thin = Side(border_style="thin", color=RULE)
med  = Side(border_style="medium", color=INK)
BORDER_HEADER = Border(top=med, bottom=med, left=thin, right=thin)
BORDER_CELL   = Border(top=thin, bottom=thin, left=thin, right=thin)
BORDER_TOTAL  = Border(top=med, bottom=med, left=thin, right=thin)

CURRENCY = '"$"#,##0.00;[Red]("$"#,##0.00);"-"'
CURRENCY_INT = '"$"#,##0;[Red]("$"#,##0);"-"'
INT = '#,##0'

# =========================================================
# Sheet 1: LEGEND
# =========================================================
ws = wb.active
ws.title = "Legend"
ws.column_dimensions['A'].width = 22
ws.column_dimensions['B'].width = 90

ws['A1'] = "D2 Build Scheduler — Licensing Cost Model"
ws['A1'].font = TITLE_FONT
ws['A2'] = "Prepared for D2 Pools · Stratirus · verified pricing as of August 13, 2026"
ws['A2'].font = SUBTITLE_FONT

row = 4
ws.cell(row=row, column=1, value="How to use").font = Font(name="Arial", size=12, bold=True, color=INK)
row += 1
notes = [
    ("Blue cells", "Inputs. Change these to model different scenarios."),
    ("Yellow fill", "Key assumptions you should verify or override."),
    ("Black cells", "Calculated. Do not edit — they will recompute."),
    ("Green text",  "Cross-sheet link."),
    ("", ""),
    ("Baseline sheet", "Editable cost model with user counts and unit prices."),
    ("Scenarios sheet","Three side-by-side plans: Current, Scale to 30, Downsize."),
    ("Sources sheet", "Every price cited with the URL it came from."),
]
for label, txt in notes:
    ws.cell(row=row, column=1, value=label).font = LABEL_FONT
    ws.cell(row=row, column=2, value=txt).font = FORMULA_FONT
    ws.cell(row=row, column=1).alignment = Alignment(vertical="top")
    ws.cell(row=row, column=2).alignment = Alignment(wrap_text=True, vertical="top")
    row += 1

row += 2
ws.cell(row=row, column=1, value="Bottom line").font = Font(name="Arial", size=12, bold=True, color=INK)
row += 1
ws.cell(row=row, column=1, value="At 21 users the monthly cost is").font = LABEL_FONT
ws.cell(row=row, column=2, value="=Baseline!F14").font = LINK_FONT
ws.cell(row=row, column=2).number_format = CURRENCY
row += 1
ws.cell(row=row, column=1, value="Annualized").font = LABEL_FONT
ws.cell(row=row, column=2, value="=Baseline!F14*12").font = LINK_FONT
ws.cell(row=row, column=2).number_format = CURRENCY

# =========================================================
# Sheet 2: BASELINE
# =========================================================
ws = wb.create_sheet("Baseline")
for col, w in [('A',36),('B',12),('C',16),('D',16),('E',16),('F',16),('G',48)]:
    ws.column_dimensions[col].width = w

ws['A1'] = "Baseline monthly cost — 21 users"
ws['A1'].font = TITLE_FONT
ws['A2'] = "Change the blue cells to re-plan. Yellow cells are assumptions to verify."
ws['A2'].font = SUBTITLE_FONT

# Header row
hdr = ["Licence line", "Users", "Per user / mo", "Discount %", "Effective /mo", "Monthly total", "Source / notes"]
for i, h in enumerate(hdr, 1):
    c = ws.cell(row=4, column=i, value=h)
    c.font = HEADER_FONT
    c.fill = HEADER_FILL
    c.border = BORDER_HEADER
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

# Data rows
data = [
    # (label, users, unit_price, discount, source)
    ("Power Apps Premium — office & PMs", 8,  20.00, 0.00, "MS list price; annual per-user commitment. Src: microsoft.com/power-platform/pricing"),
    ("Power Apps Premium — crew leads",   10, 20.00, 0.00, "Per-app SKU RETIRED for new customers Jan 2, 2026 — Premium is the only path."),
    ("Power BI Pro — ownership",          3,  14.00, 0.00, "Raised from $10 to $14 on April 1, 2025. Src: powerbi.microsoft.com blog"),
    ("Managed Environments",              0,  0.00,  0.00, "INCLUDED as entitlement with any standalone Premium licence. Src: learn.microsoft.com managed-environment-licensing"),
    ("Dataverse capacity (base + per-seat)",0,0.00,  0.00, "20 GB DB + 40 GB file per tenant + 250 MB per Premium user. D2 uses <20 MB/yr."),
    ("Optional add-on (spare row)",       0,  0.00,  0.00, "Use this row for AI Builder credits, portal capacity, storage add-on, etc."),
]
for r, (label, users, price, disc, src) in enumerate(data, start=5):
    ws.cell(row=r, column=1, value=label).font = LABEL_FONT
    c = ws.cell(row=r, column=2, value=users); c.font = INPUT_FONT; c.number_format = INT; c.alignment = Alignment(horizontal="right")
    c = ws.cell(row=r, column=3, value=price); c.font = INPUT_FONT; c.number_format = CURRENCY
    c = ws.cell(row=r, column=4, value=disc);  c.font = INPUT_FONT; c.number_format = "0.0%"; c.fill = YELLOW
    c = ws.cell(row=r, column=5, value=f"=C{r}*(1-D{r})"); c.font = FORMULA_FONT; c.number_format = CURRENCY
    c = ws.cell(row=r, column=6, value=f"=B{r}*E{r}");     c.font = FORMULA_FONT; c.number_format = CURRENCY
    ws.cell(row=r, column=7, value=src).font = NOTE_FONT
    ws.cell(row=r, column=7).alignment = Alignment(wrap_text=True, vertical="top")
    for col in range(1, 8):
        ws.cell(row=r, column=col).border = BORDER_CELL
        pass  # alt fill disabled

# Totals
total_row = 14
ws.cell(row=total_row, column=1, value="TOTAL").font = Font(name="Arial", size=11, bold=True, color=INK)
ws.cell(row=total_row, column=2, value="=SUM(B5:B10)").font = Font(name="Arial", size=11, bold=True, color=INK)
ws.cell(row=total_row, column=2).number_format = INT
ws.cell(row=total_row, column=6, value="=SUM(F5:F10)").font = Font(name="Arial", size=11, bold=True, color=INK)
ws.cell(row=total_row, column=6).number_format = CURRENCY
for col in range(1, 8):
    ws.cell(row=total_row, column=col).border = BORDER_TOTAL
    ws.cell(row=total_row, column=col).fill = TOTAL_FILL

# Annualized
ws.cell(row=total_row+2, column=1, value="Annualized").font = LABEL_FONT
ws.cell(row=total_row+2, column=6, value=f"=F{total_row}*12").font = Font(name="Arial", size=11, bold=True, color=INK)
ws.cell(row=total_row+2, column=6).number_format = CURRENCY

# 3-year TCO
ws.cell(row=total_row+3, column=1, value="3-year TCO (no escalation)").font = LABEL_FONT
ws.cell(row=total_row+3, column=6, value=f"=F{total_row}*36").font = Font(name="Arial", size=11, bold=True, color=INK)
ws.cell(row=total_row+3, column=6).number_format = CURRENCY

ws.cell(row=total_row+5, column=1,
        value="Assumption: annual per-user commitment terms. Monthly billing is generally billed same; multi-year through EA or CSP typically 10–15% discount — model with column D.").font = NOTE_FONT
ws.merge_cells(start_row=total_row+5, end_row=total_row+5, start_column=1, end_column=7)
ws.cell(row=total_row+5, column=1).alignment = Alignment(wrap_text=True, vertical="top")
ws.row_dimensions[total_row+5].height = 32

# =========================================================
# Sheet 3: SCENARIOS
# =========================================================
ws = wb.create_sheet("Scenarios")
for col, w in [('A',36),('B',18),('C',18),('D',18),('E',48)]:
    ws.column_dimensions[col].width = w

ws['A1'] = "Scenarios — side by side"
ws['A1'].font = TITLE_FONT
ws['A2'] = "Change blue cells to compare. All formulas apply same Premium ($20) and Pro ($14) unit prices from Baseline sheet."
ws['A2'].font = SUBTITLE_FONT

hdr = ["", "A · Current plan", "B · Scale to 30 pools/yr", "C · Downsize (5 users)", "Notes"]
for i, h in enumerate(hdr, 1):
    c = ws.cell(row=4, column=i, value=h)
    c.font = HEADER_FONT; c.fill = HEADER_FILL; c.border = BORDER_HEADER
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

rows = [
    # (label, current, scale, downsize, notes, is_currency)
    ("Power Apps Premium seats",   18, 24, 4, "Office + PMs + crew leads",           False),
    ("Power BI Pro seats",         3,  5,  1, "Ownership + finance if scaling",       False),
    ("Total headcount",            None, None, None, "Sum of the above",              False),
    ("Premium unit price",        20.00,20.00,20.00,"Verified Aug 2026 — MS list",   True),
    ("Pro unit price",            14.00,14.00,14.00,"Verified Aug 2026 — MS list",   True),
    ("Monthly cost",              None, None, None, "Premium × $20 + Pro seats × $14", True),
    ("Annualized",                None, None, None, "Monthly × 12",                True),
    ("3-year TCO (no escalation)",None, None, None, "Monthly × 36",                True),
    ("Per-pool cost per year (@ pool count)", 40, 60, 15, "Adjust the pool count to estimate license cost / job", False),
    ("License $ / pool",          None, None, None, "Annualized ÷ pool count",     True),
]
start = 5
for r, (label, cur, sca, dwn, notes, is_curr) in enumerate(rows, start=start):
    ws.cell(row=r, column=1, value=label).font = LABEL_FONT
    if label == "Total headcount":
        ws.cell(row=r, column=2, value=f"=B{start}+B{start+1}")
        ws.cell(row=r, column=3, value=f"=C{start}+C{start+1}")
        ws.cell(row=r, column=4, value=f"=D{start}+D{start+1}")
        for col in (2,3,4):
            ws.cell(row=r, column=col).font = FORMULA_FONT
            ws.cell(row=r, column=col).number_format = INT
    elif label == "Monthly cost":
        ws.cell(row=r, column=2, value=f"=B{start}*B{start+3}+B{start+1}*B{start+4}")
        ws.cell(row=r, column=3, value=f"=C{start}*C{start+3}+C{start+1}*C{start+4}")
        ws.cell(row=r, column=4, value=f"=D{start}*D{start+3}+D{start+1}*D{start+4}")
        for col in (2,3,4):
            ws.cell(row=r, column=col).font = FORMULA_FONT
            ws.cell(row=r, column=col).number_format = CURRENCY
    elif label == "Annualized":
        for col in (2,3,4):
            ws.cell(row=r, column=col, value=f"={get_column_letter(col)}{start+5}*12").font = FORMULA_FONT
            ws.cell(row=r, column=col).number_format = CURRENCY
    elif label == "3-year TCO (no escalation)":
        for col in (2,3,4):
            ws.cell(row=r, column=col, value=f"={get_column_letter(col)}{start+5}*36").font = FORMULA_FONT
            ws.cell(row=r, column=col).number_format = CURRENCY
    elif label == "License $ / pool":
        for col in (2,3,4):
            ws.cell(row=r, column=col, value=f"=IF({get_column_letter(col)}{start+8}=0,0,{get_column_letter(col)}{start+6}/{get_column_letter(col)}{start+8})").font = FORMULA_FONT
            ws.cell(row=r, column=col).number_format = CURRENCY
    else:
        for col, val in [(2, cur), (3, sca), (4, dwn)]:
            c = ws.cell(row=r, column=col, value=val)
            c.font = INPUT_FONT
            c.number_format = CURRENCY if is_curr else INT
    ws.cell(row=r, column=5, value=notes).font = NOTE_FONT
    ws.cell(row=r, column=5).alignment = Alignment(wrap_text=True, vertical="top")
    for col in range(1, 6):
        ws.cell(row=r, column=col).border = BORDER_CELL

# Add a comment to the Premium unit price cell in scenarios
ws.cell(row=8, column=2).comment = Comment(
    "Verified via MS Power Platform pricing page, August 2026. Volume discount to $12 kicks in at 2000+ seats — not applicable at D2's scale.",
    "Stratirus")

# =========================================================
# Sheet 4: SOURCES
# =========================================================
ws = wb.create_sheet("Sources")
for col, w in [('A',36),('B',22),('C',80)]:
    ws.column_dimensions[col].width = w

ws['A1'] = "Price sources — verified August 13, 2026"
ws['A1'].font = TITLE_FONT
ws['A2'] = "Every price and rule cited in Baseline and Scenarios traces to one of these."
ws['A2'].font = SUBTITLE_FONT

hdr = ["Item", "Value", "URL / reference"]
for i, h in enumerate(hdr, 1):
    c = ws.cell(row=4, column=i, value=h)
    c.font = HEADER_FONT; c.fill = HEADER_FILL; c.border = BORDER_HEADER
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

srcs = [
    ("Power Apps Premium", "$20 / user / month", "https://www.microsoft.com/en-us/power-platform/products/power-apps/pricing"),
    ("Power Apps Premium volume", "$12 at 2000+ seats", "Same page — not applicable at D2's scale."),
    ("Power Apps per-app (retired)", "End of sale Jan 2, 2026 for new customers", "https://www.microsoft.com/en-us/licensing/news/power-app-per-app-end-of-sale"),
    ("Power Apps Pay-As-You-Go", "$10 / active user / app / month", "Only cheaper than Premium if a crew lead uses the app <2 days/month. Field use is daily, so Premium wins."),
    ("Power BI Pro", "$14 / user / month (as of Apr 1, 2025)", "https://powerbi.microsoft.com/en-us/blog/important-update-to-microsoft-power-bi-pricing/"),
    ("Managed Environments", "Included with standalone Premium licences", "https://learn.microsoft.com/en-us/power-platform/admin/managed-environment-licensing"),
    ("Dataverse storage (tenant)", "20 GB DB + 40 GB file (raised Dec 2025)", "https://www.microsoft.com/en-us/power-platform/products/power-apps/pricing"),
    ("Dataverse storage (per-seat)", "250 MB DB + 2 GB file per Premium user", "Same source."),
    ("Offline canvas app limits", "Dataverse-only; standalone canvas only; ≤3M rows; no Relate/Unrelate; no M:N; one lookup level", "https://learn.microsoft.com/en-us/power-apps/mobile/limitations-canvas-apps"),
]
for r, (item, val, url) in enumerate(srcs, start=5):
    ws.cell(row=r, column=1, value=item).font = LABEL_FONT
    ws.cell(row=r, column=2, value=val).font = FORMULA_FONT
    c = ws.cell(row=r, column=3, value=url); c.font = NOTE_FONT
    c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[r].height = 32
    for col in range(1, 4):
        ws.cell(row=r, column=col).border = BORDER_CELL

# Save
out = "/sessions/sweet-great-mayer/mnt/outputs/memo/D2-License-Model.xlsx"
wb.save(out)
print(f"Wrote {out}")
