const {Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  PageOrientation, LevelFormat, convertInchesToTwip} = require('/tmp/node_modules/docx');
const fs = require('fs');

const INK = "1a2332", ACCENT = "0b6e78", CLAY = "a84a18", MUTED = "5d6e77", RULE = "d6dcde";

// Helpers
const p = (text, opts={}) => new Paragraph({
  spacing: {after: opts.after ?? 120, before: opts.before ?? 0, line: 300},
  alignment: opts.align,
  children: (Array.isArray(text) ? text : [new TextRun({text, ...opts})])
});
const h1 = t => new Paragraph({heading: HeadingLevel.HEADING_1, spacing:{before:280, after:120}, children:[new TextRun({text:t, bold:true, size:26, color:INK})]});
const h2 = t => new Paragraph({heading: HeadingLevel.HEADING_2, spacing:{before:240, after:80}, children:[new TextRun({text:t, bold:true, size:22, color:INK})]});
const h3 = t => new Paragraph({heading: HeadingLevel.HEADING_3, spacing:{before:180, after:60}, children:[new TextRun({text:t, bold:true, size:20, color:ACCENT})]});
const bullet = (text, level=0) => new Paragraph({numbering:{reference:"bullets", level}, spacing:{after:80, line:280}, children:[new TextRun({text, size:22})]});
const rule = () => new Paragraph({border:{bottom:{color: RULE, size:6, style: BorderStyle.SINGLE}}, spacing:{after:200, before:100}});

const cell = (txt, opts={}) => new TableCell({
  width: {size: opts.width, type: WidthType.DXA},
  shading: opts.header ? {type: ShadingType.CLEAR, fill: "f0f3f4", color:"auto"} : undefined,
  margins: {top:100, bottom:100, left:120, right:120},
  children: [new Paragraph({
    spacing:{after:0, line:260},
    children: [new TextRun({text: String(txt), bold: !!opts.header, size: opts.header ? 18 : 20, color: opts.header ? MUTED : INK})]
  })]
});

function table(headers, rows, colWidths) {
  const totalWidth = colWidths.reduce((a,b)=>a+b,0);
  return new Table({
    width: {size: totalWidth, type: WidthType.DXA},
    columnWidths: colWidths,
    borders: {
      top:    {style: BorderStyle.SINGLE, size: 8, color: INK},
      bottom: {style: BorderStyle.SINGLE, size: 8, color: INK},
      left:   {style: BorderStyle.NONE},
      right:  {style: BorderStyle.NONE},
      insideHorizontal:{style: BorderStyle.SINGLE, size: 3, color: RULE},
      insideVertical:  {style: BorderStyle.NONE}
    },
    rows: [
      new TableRow({tableHeader: true, children: headers.map((h,i)=>cell(h, {header:true, width: colWidths[i]}))}),
      ...rows.map(r => new TableRow({children: r.map((c,i)=>cell(c, {width: colWidths[i]}))}))
    ]
  });
}

// ========== Content ==========
const children = [];

// Title block
children.push(new Paragraph({
  spacing:{after:40},
  children:[new TextRun({text:"DECISION MEMO · REVISION A", bold:true, size:16, color:ACCENT, characterSpacing:24})]
}));
children.push(new Paragraph({
  spacing:{after:80},
  children:[new TextRun({text:"D2 Build Scheduler — Decisions Required Before Week 3", bold:true, size:36, color:INK})]
}));
children.push(new Paragraph({
  border:{bottom:{color: INK, size:12, style: BorderStyle.SINGLE}},
  spacing:{after:200},
  children:[new TextRun({text:"Prepared for D2 Pools · Stratirus · August 13, 2026", size:20, color:MUTED, italics:true})]
}));

// Bottom line
children.push(h2("Bottom line"));
children.push(p([
  new TextRun({text:"Nine decisions block the week-3 data-migration milestone in the deployment plan. ", size:22}),
  new TextRun({text:"Five are data gaps ", size:22, bold:true}),
  new TextRun({text:"documented in §09, ", size:22}),
  new TextRun({text:"four are open questions ", size:22, bold:true}),
  new TextRun({text:"from §13. Recommended defaults for six; three need D2 input.", size:22})
]));
children.push(p([
  new TextRun({text:"Licensing has changed since the plan was written: ", size:22}),
  new TextRun({text:"the Power Apps per-app SKU is retired for new customers as of January 2, 2026", size:22, bold:true, color:CLAY}),
  new TextRun({text:". Monthly cost lands at the same ~$402 as the original estimate, but for different reasons — full breakdown in §3.", size:22})
]));

// ========== Section 1: Data gaps ==========
children.push(h2("1 · Data gaps (§09) — 5 decisions"));
children.push(p("Each item below blocks a specific week in the rollout. All five must be resolved before the ~450 template rows can be loaded into Dev.", {size:22}));

const gaps = [
  ["1.1", "Four crews have no size or roster",
   "George, Armondo, STL Shotcrete, Brothers.",
   "D2 supplies roster. If a crew is a solo or a sub, mark it as a 1-person crew or a subcontractor entry.",
   "Auto-Schedule will still assign work — but resource planning and mobile app scoping will be wrong for those crews."],
  ["1.2", "Ten trades map to no sub-phase",
   "Forms, Grading, Water Line Install, Pavers, Retaining Walls, CMU Block, Brick/Masonry, Veneer/Stone, Landscaping, Material Runs.",
   "Two paths: (a) add new sub-phases to the template if D2's process actually does this work in-house, or (b) delete the unmapped trades. Retaining Walls and Veneer most likely belong under 5.6 Deck Placement; Forms under 2.2 Steel Installation.",
   "George Crew is scheduled ZERO days of work today because their only trades are unmapped. This is the single most consequential gap."],
  ["1.3", "Finish Grade assignment on Saul & Guillermo is inferred",
   "Cirilo is the only crew explicitly excluded from Finish Grade on the D2 crew list. The tool assumes all other crews can do it.",
   "D2 confirms or corrects for each of the 13 field crews. Uncheck the trade on the Crews tab where wrong.",
   "Wrong assignment shows up as under-utilization of specialists and idle time on the wrong crews."],
  ["1.4", "Eleven sub-phases sit in Unassigned",
   "The field supervision and QC items (1.1 through 1.4 in Pre-Construction, etc.).",
   "Recommendation: create a 'PM' capacity-exempt bucket in the Crews tab (like Main Office / Subcontractor), assign all 11 there. This is the cheapest resolution for the browser tool AND for the Power Platform build.",
   "Sub-phases in Unassigned block Auto-Schedule from completing a job's plan and produce 11 warnings per pool."],
  ["1.5", "All 46 durations are a 2-day placeholder",
   "No sub-phase has a real duration.",
   "Do NOT try to fix this before go-live. Migrate as-is; use the Power BI 'actual vs. planned' report to measure durations from the first 3-5 pools, then update the template.",
   "Blocks quoting a customer a finish date but does not block system rollout. Only becomes urgent at §11 week 13."]
];

children.push(table(
  ["ID", "Gap", "Detail", "Recommended action", "Impact if unresolved"],
  gaps,
  [700, 1900, 2600, 3200, 2700]
));

// ========== Section 2: Open decisions ==========
children.push(h2("2 · Open decisions (§13) — 4 decisions"));

const decisions = [
  ["2.1", "Should a PM crew bucket exist?",
   "YES — recommended. Clears 11 unassigned sub-phases at zero cost; matches the capacity-exempt pattern already used for Main Office and Subcontractor.",
   "D2 owner"],
  ["2.2", "Where do the 10 unmapped trades belong?",
   "Session with D2 field supervisor to map each trade to an existing sub-phase or a new one. See 1.2. This is a 30-minute conversation with the right person.",
   "D2 field supervisor + Stratirus"],
  ["2.3", "Per-app vs. Premium for crew leads",
   "MOOT — per-app is retired for new customers. Premium at $20/user/mo for all 10 crew leads. See §3. No savings option remains on this line.",
   "Auto-resolved by MS licensing change"],
  ["2.4", "Who builds it?",
   "Stratirus recommends internal-plus-partner: Stratirus scopes and architects, D2 identifies an internal maker for ongoing changes, Stratirus stays on retainer for the flow and BI work. Alternative: full Microsoft partner build at higher cost but no D2 skills dependency.",
   "D2 leadership"]
];

children.push(table(
  ["ID", "Decision", "Recommendation", "Owner"],
  decisions,
  [700, 2900, 5000, 2500]
));

// ========== Section 3: License update ==========
children.push(h2("3 · Licensing — verified August 2026"));

children.push(p([
  new TextRun({text:"Critical change: ", size:22, bold:true, color:CLAY}),
  new TextRun({text:"Power Apps per-app SKU (was $5/user/app/mo) is no longer available to new customers as of January 2, 2026. ", size:22}),
  new TextRun({text:"The deployment plan's contingency to run crew leads on per-app for ~$150/mo savings is off the table. Premium at $20/user/mo is now the only sensible option for daily-use field workers.", size:22})
]));

children.push(h3("Refreshed monthly cost — 21 users"));

const licTable = [
  ["Power Apps Premium — office & PMs", "8", "$20.00", "$160.00", "Unchanged from plan"],
  ["Power Apps Premium — crew leads",    "10", "$20.00", "$200.00", "Was $5 per-app; now Premium (per-app retired)"],
  ["Power BI Pro — ownership",           "3",  "$14.00", "$42.00",  "Confirmed at $14 (raised April 2025)"],
  ["Managed Environments",               "—",  "included","$0.00",  "Free entitlement with Premium licenses"],
  ["Dataverse capacity",                 "—",  "included","$0.00",  "20 GB base + 250 MB per Premium seat. D2 uses <20 MB/yr"],
  ["TOTAL",                              "21", "",       "$402.00", ""]
];
children.push(table(
  ["Licence", "Users", "Per user / mo", "Monthly", "Notes"],
  licTable,
  [3600, 900, 1500, 1500, 3600]
));

children.push(p(""));
children.push(p([
  new TextRun({text:"Net effect on the budget: ", size:22, bold:true}),
  new TextRun({text:"the plan's $402 headline holds, but the plan's optional $150/mo savings path is gone. Annual: ", size:22}),
  new TextRun({text:"$4,824.", size:22, bold:true}),
  new TextRun({text:" A three-year commitment through EA channels may reduce this ~10-15%; verify with MS reseller before signing.", size:22})
]));

children.push(h3("Offline capability — confirmed viable"));
children.push(p([
  new TextRun({text:"The plan's canvas-app offline design fits within Microsoft's documented offline limits: Dataverse-only tables (checked), standalone canvas app (checked), no Relate/Unrelate functions (checked), under 3 million records (checked, ~450 rows per pool × ~40 pools/yr = 18,000). One caveat to note in build: the field app must not use many-to-many relationships or nested lookups beyond one level.", size:22})
]));

// ========== Section 4: Deadlines ==========
children.push(h2("4 · Deadlines"));

const deadlines = [
  ["Data gap 1.1 (crew rosters)", "End of Week 2", "Blocks §11 data migration"],
  ["Data gap 1.2 (10 unmapped trades)", "End of Week 2", "Blocks §11 data migration + George Crew idle"],
  ["Data gap 1.3 (Finish Grade assignments)", "End of Week 2", "Blocks §11 data migration"],
  ["Data gap 1.4 (11 Unassigned sub-phases)", "End of Week 2", "Blocks §11 data migration"],
  ["Data gap 1.5 (durations)", "Week 13", "Blocks quoting customer finish dates only"],
  ["Decision 2.1 (PM crew)", "End of Week 1", "Feeds 1.4"],
  ["Decision 2.2 (trade mapping)", "End of Week 1", "Feeds 1.2"],
  ["Decision 2.4 (build ownership)", "End of Week 1", "Determines scope of work"]
];
children.push(table(
  ["Item", "Deadline", "What it blocks"],
  deadlines,
  [4200, 2500, 4300]
));

// Signature
children.push(p("", {after: 400}));
children.push(rule());
children.push(p([
  new TextRun({text:"Prepared by ", size:20, color:MUTED}),
  new TextRun({text:"Shane Talbot", size:20, color:INK, bold:true}),
  new TextRun({text:" · VP of AI Solutions · Stratirus · stalbot@stratirus.com", size:20, color:MUTED})
]));

// ========== Document ==========
const doc = new Document({
  creator: "Stratirus",
  title: "D2 Build Scheduler — Decisions Required Before Week 3",
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: {paragraph: {indent: {left: 360, hanging: 260}}}
      }]
    }]
  },
  styles: {
    default: {
      document: {run: {font: "Calibri", size: 22, color: INK}}
    }
  },
  sections: [{
    properties: {
      page: {
        size: {width: 12240, height: 15840},   // US Letter
        margin: {top: 1080, bottom: 1080, left: 1080, right: 1080}
      }
    },
    children
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('/sessions/sweet-great-mayer/mnt/outputs/memo/D2-Decisions-Memo.docx', buf);
  console.log('OK bytes:', buf.length);
});
