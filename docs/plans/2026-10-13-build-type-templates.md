# Build Type Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project is Gunite or Fiberglass, chosen on `+ Job`; `D2 - New Pool` builds it from the template of its type; the planner lays it out from that template, shows both templates on a read-only Phase Template tab, and marks Fiberglass projects.

**Architecture:** One `BuildType` choice column on four SharePoint lists, with the Fiberglass rows added beside the Gunite 46 in the same two template lists. The flow filters its template reads by type and refuses a read that hits its cap. The planner stops carrying a per-browser template and reads both templates from SharePoint on Refresh (Graph, and the REST export for parity), keeping `S.templates` by type.

**Tech Stack:** SharePoint Online REST from the site's browser console; Power Automate definition edited in Python and pushed through Dataverse (`PATCH workflows(...).clientdata` + `PublishXml`); a single-file browser planner (`web/index.html`) with three sibling scripts; Node + jsdom harnesses under `fixtures/planner/` with `mutate.py` sweeps; Python 3 with `openpyxl` available.

**Spec:** `docs/specs/2026-10-13-build-type-templates-design.md`

## Global Constraints

- Join crews on `CrewID`, never `Title`. Default crews are codes (`devon`, `office`, `subcon`, `unassigned`).
- Capture platform payloads, never hand-author them: every Graph or REST field name used in a mapping is read off a captured fixture first.
- Flow JSON is emitted with `json.dumps(..., ensure_ascii=True)`; never rebuild a definition from an `az rest` capture.
- Field creates on one list are sequential (parallel creates 500 on the schema lock). Item creates may be parallel in chunks of 8.
- A Choice column validates nothing on a REST write; the writers normalise the value to `Gunite` or `Fiberglass` themselves.
- DateOnly values are written as bare `yyyy-MM-dd` strings.
- Before any bulk write to Assignments (the throwaway builds), stop Flow 3 (Event-Driven Reconciliation) and restart it afterwards.
- Pin the tenant on every CLI call: `f24d9b39-6a71-4f4e-a376-03b6f61c97e4`; confirm with FlowAgent `whoami` before trusting a listing.
- Client-visible copy (planner, emails, list views) is neutral and never names a person or a tool. No em dashes in new copy.
- No hard-coded "46 sub-phases" or "295 tasks" in new or touched copy; counts come from the template in use.
- Every Static Web App deploy gets a git tag `deploy/YYYY-MM-DD[letter]`; wall checks run after every deploy.
- Specs live in `docs/specs/`, plans in `docs/plans/`.

## Review Focus

1. A `New Pool Requests` row created with `BuildType` absent or blank (an older planner build, or a REST create that omits it) must build Gunite, not fail. Pinned in Task 5 (`Compose_build_type` coalesces) and Task 11 (`createBody` and `planCreates` default to Gunite).
2. A Fiberglass project arriving from an old REST export file that carries no `templates` must not crash the planner: its sections are reported unmatched, nothing is laid out from the Gunite template by mistake. Pinned in Task 12.
3. A `BuildType` read back from SharePoint with different case or trailing space (`fiberglass `) must map to `Fiberglass` on both read paths. Pinned in Task 10.
4. A template read that returns at its cap (100 sub-phases or 1000 tasks) must fail the request before `Create_job`, with a `ReadAtCap` result, never a half-built project. Pinned in Task 5.
5. The Phase Template tab must render with no `S.templates` at all (a browser that has never refreshed, or a Refresh whose template reads failed) and must not expose an edit control. Pinned in Task 13.

---

## Task order and who runs it

| Task | What | Runs where | Depends on |
|---|---|---|---|
| 1 | Fiberglass template JSON from the TSV | subagent | — |
| 2 | Seed generator by build type, fresh crew capture | subagent (capture step: orchestrator) | 1 |
| 3 | SharePoint column, stamp and view scripts | subagent | — |
| 4 | Seed script by build type | subagent | 2 (seed file shape) |
| 5 | Flow builder, structural test, push driver | subagent | — |
| 6 | LIVE 1: columns, stamping, views; Gunite throwaway | orchestrator | 3 |
| 7 | LIVE 2: push flow; Gunite throwaway; export | orchestrator | 5, 6 |
| 8 | LIVE 3: Fiberglass seed; Fiberglass + Gunite throwaways; delete | orchestrator | 2, 4, 7 |
| 9 | Capture the three lists into both fixtures | orchestrator (browser) + subagent (merge tool) | 8 |
| 10 | Payload mapping on both read paths | subagent | 9 |
| 11 | Planner create path (+ PM fix) | subagent | 9 |
| 12 | Planner templates and layout | subagent | 10, 11 |
| 13 | Phase Template tab read-only with switch | subagent | 12 |
| 14 | LIVE 4: suite, shakedown, deploy, wall checks | orchestrator | 13 |
| 15 | Docs | subagent | 14 |

Tasks 1, 3, 5 can run in parallel. Tasks 10 to 13 are sequential because 11 to 13 all edit `web/index.html`.

---

### Task 1: Fiberglass template JSON from the TSV

**Files:**
- Create: `tools/fiberglass-template.py`
- Create: `tools/test_fiberglass_template.py`
- Create (generated): `D2-Build-Scheduler/D2-Build-Scheduler/data/fiberglass-template.json`
- Create (generated): `D2-Build-Scheduler/D2-Build-Scheduler/data/fiberglass-sub-phase-template.csv`
- Create (generated): `D2-Build-Scheduler/D2-Build-Scheduler/data/fiberglass-task-template.csv`
- Read: `D2-Build-Scheduler/D2-Build-Scheduler/source/Fiberglass Build Phase_Rev1_091726.tsv`
- Read: `D2-Build-Scheduler/D2-Build-Scheduler/data/sub-phase-template.csv` (the Gunite 46 with `TradeCode` and `AssignTo`)

**Interfaces:**
- Produces `fiberglass-template.json`: a JSON array in the planner's `SEED_TEMPLATE` shape:
  `[{num:'0', name:'Pre Construction/Sales', sections:[{num:'0.0', name:'Sales to Production Handoff', skill:'@office', days:2, tasks:['Contract review', ...]}, ...]}, ...]`.
  `skill` is a Gunite `TradeCode` (`'demolition'`, `'plumbing'`, ...) or one of `'@office'`, `'@sub'`, `'@unassigned'`.
- Produces the two CSVs with the same columns as the Gunite ones: `SubPhaseNumber,SubPhaseName,PhaseNumber,PhaseName,TradeCode,TradeName,AssignTo,DefaultDurationDays,Sequence,TaskCount` and `SubPhaseNumber,SubPhaseName,TaskName,Sequence`.

- [ ] **Step 1: Write the failing test**

```python
# tools/test_fiberglass_template.py   Run: python tools/test_fiberglass_template.py  (exit 0 = pass)
import json, pathlib, subprocess, sys, csv
ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / 'D2-Build-Scheduler' / 'D2-Build-Scheduler' / 'data'
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

r = subprocess.run([sys.executable, '-I', str(ROOT / 'tools' / 'fiberglass-template.py')], capture_output=True, text=True)
ok('generator exits 0', r.returncode == 0, r.stderr[-400:])
tpl = json.loads((DATA / 'fiberglass-template.json').read_text(encoding='utf-8'))
secs = [s for p in tpl for s in p['sections']]
ok('10 phases, 0 to 9', [p['num'] for p in tpl] == [str(i) for i in range(10)])
ok('45 sub-phases', len(secs) == 45, len(secs))
ok('248 tasks', sum(len(s['tasks']) for s in secs) == 248, sum(len(s['tasks']) for s in secs))
ok('sub-phase numbers unique', len({s['num'] for s in secs}) == 45)
ok('the two Phase 7s merged into 7.1 to 7.7',
   [s['num'] for s in secs if s['num'].startswith('7.')] == ['7.1','7.2','7.3','7.4','7.5','7.6','7.7'])
ok('7.4 is Startup Preparation (was the second 7.1)', next(s['name'] for s in secs if s['num']=='7.4') == 'Startup Preparation')
ok('7.7 is Trim Out', next(s['name'] for s in secs if s['num']=='7.7') == 'Trim Out')
ok('phase 7 name is the merged one', tpl[7]['name'] == 'Equipment Installation, Startup and Trim Out')
ok('phase 4 is Electrical Rough-In, from the Task Name column', tpl[4]['name'] == 'Electrical Rough-In')
ok('phase 6 is Coping and Decking, from the Task Name column', tpl[6]['name'] == 'Coping and Decking')
ok('every duration is 2', all(s['days'] == 2 for s in secs))
ok('the punch-list note row is not a task', not any('multipal' in t for s in secs for t in s['tasks']))
s85 = next(s for s in secs if s['num'] == '8.5')
ok('the two oddly-sectioned rows are tasks of 8.5', len(s85['tasks']) == 6 and any(t.startswith('Fence Pool safety') for t in s85['tasks']))
ok("Don's text is verbatim", any(t.startswith('Fence Pool safety Barrior') for t in s85['tasks']))
by = {s['num']: s for s in secs}
ok('name matches copy the Gunite trade: 1.2 Site Preparation -> demolition', by['1.2']['skill'] == 'demolition')
ok('shifted matches: 1.4 Pool Layout -> dig (Gunite 1.3)', by['1.4']['skill'] == 'dig')
ok('near-name: 3.2 Plumbing Installation -> plumbing', by['3.2']['skill'] == 'plumbing')
ok('near-name: 6.1 Bond Beam/Collar Preparation -> rebar', by['6.1']['skill'] == 'rebar')
ok('swapped pair: 7.1 Equipment Plumbing -> plumbing, 7.3 Equipment Electrical -> automation',
   by['7.1']['skill'] == 'plumbing' and by['7.3']['skill'] == 'automation')
ok('9.0 Client Orientation -> poolschool', by['9.0']['skill'] == 'poolschool')
ok('office exceptions: 0.1 and 1.3 -> @office', by['0.1']['skill'] == '@office' and by['1.3']['skill'] == '@office')
ok('Gunite-unassigned matches stay @unassigned: 1.5, 4.4, 6.7', all(by[n]['skill'] == '@unassigned' for n in ('1.5','4.4','6.7')))
ok('subcontractor matches: 4.1, 4.2 -> @sub', by['4.1']['skill'] == '@sub' and by['4.2']['skill'] == '@sub')
ok('14 Fiberglass-only rows are @unassigned',
   sorted(n for n, s in by.items() if s['skill'] == '@unassigned' and n in ('2.1','2.2','2.3','5.1','5.2','5.3','7.4','7.7','8.1','8.2','8.3','8.4','8.5','8.6')) ==
   ['2.1','2.2','2.3','5.1','5.2','5.3','7.4','7.7','8.1','8.2','8.3','8.4','8.5','8.6'])
rows = list(csv.DictReader(open(DATA / 'fiberglass-sub-phase-template.csv', encoding='utf-8-sig')))
ok('sub-phase CSV has 45 rows and the Gunite columns', len(rows) == 45 and list(rows[0].keys()) ==
   ['SubPhaseNumber','SubPhaseName','PhaseNumber','PhaseName','TradeCode','TradeName','AssignTo','DefaultDurationDays','Sequence','TaskCount'])
ok('Sequence is 1..45', [int(r['Sequence']) for r in rows] == list(range(1, 46)))
trows = list(csv.DictReader(open(DATA / 'fiberglass-task-template.csv', encoding='utf-8-sig')))
ok('task CSV has 248 rows', len(trows) == 248)
ok('generator is deterministic', subprocess.run([sys.executable, '-I', str(ROOT / 'tools' / 'fiberglass-template.py')], capture_output=True).returncode == 0
   and json.loads((DATA / 'fiberglass-template.json').read_text(encoding='utf-8')) == tpl)
sys.exit(1 if fails else 0)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python tools/test_fiberglass_template.py`
Expected: FAIL on "generator exits 0" (file not found), then exceptions; exit 1.

- [ ] **Step 3: Write the generator**

```python
# tools/fiberglass-template.py
"""Build the Fiberglass template from Don's sheet (the TSV saved from his 2026-10-10 email).

Applies the decisions in docs/specs/2026-10-13-build-type-templates-design.md section 2:
the two Phase 7s merge into 7.1..7.7; phase names come from the PHASE heading rows (Task Name
column); sub-phase numbers come from the Task Name column; every Task row is a task; the untyped
punch-list note row is dropped; durations are 2; trade comes from the Gunite 46 by the name table.
Writes nothing to the tenant.
"""
import csv, io, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / 'D2-Build-Scheduler' / 'D2-Build-Scheduler' / 'source' / 'Fiberglass Build Phase_Rev1_091726.tsv'
DATA = ROOT / 'D2-Build-Scheduler' / 'D2-Build-Scheduler' / 'data'
GUNITE = DATA / 'sub-phase-template.csv'

PHASE_NAMES = {
    '0': 'Pre Construction/Sales', '1': 'Preconstruction Back Office Admin',
    '2': 'Base Preparation and Shell Set', '3': 'Plumbing Rough-In', '4': 'Electrical Rough-In',
    '5': 'Backfill and Water Fill', '6': 'Coping and Decking',
    '7': 'Equipment Installation, Startup and Trim Out',
    '8': 'Site Restoration and Final Grade', '9': 'Post Construction Completion Phase',
}
# The second Phase 7 block (Startup and Trim Out) is renumbered to follow Equipment Installation.
RENUMBER = {'7.1 Startup Preparation': '7.4', '7.2 Startup Procedures': '7.5',
            '7.3 Water Chemistry Startup': '7.6', '7.4 Trim Out': '7.7'}
# Fiberglass sub-phase number -> Gunite sub-phase number whose trade and assignment it takes.
GUNITE_MATCH = {
    '0.0': '0.0', '1.0': '1.0', '1.1': '1.1', '1.2': '1.2', '3.1': '3.1', '3.3': '3.3',
    '1.4': '1.3', '1.5': '1.4', '1.6': '1.5', '1.7': '1.6',
    '3.2': '3.2',
    '4.1': '3.4', '4.2': '3.5', '4.3': '3.6', '4.4': '3.7',
    '6.1': '2.3',
    '6.2': '5.4', '6.3': '5.3', '6.4': '5.5', '6.5': '5.6', '6.6': '5.7', '6.7': '5.8',
    '7.1': '6.2', '7.2': '6.1', '7.3': '6.3',
    '7.5': '6.6', '7.6': '6.7',
    '9.0': '6.8', '9.1': '7.0',
}
OFFICE_EXCEPTIONS = {'0.1', '1.3'}
ASSIGN_TO_SKILL = {'Main Office': '@office', 'Subcontractor': '@sub', 'Unassigned': '@unassigned'}

gunite = {r['SubPhaseNumber']: r for r in csv.DictReader(io.open(GUNITE, encoding='utf-8-sig'))}

def skill_for(num):
    if num in OFFICE_EXCEPTIONS:
        return '@office', '', '', 'Main Office'
    g = gunite.get(GUNITE_MATCH.get(num, ''))
    if not g:
        return '@unassigned', '', '', 'Unassigned'
    if g['TradeCode']:
        return g['TradeCode'], g['TradeCode'], g['TradeName'], g['AssignTo']
    return ASSIGN_TO_SKILL[g['AssignTo']], '', '', g['AssignTo']

phases, cur_phase, cur_sec = [], None, None
seen_7 = False
for row in csv.DictReader(io.open(SRC, encoding='utf-8'), delimiter='\t'):
    name, kind = row['Task Name'].strip(), (row['Row Type'] or '').strip()
    if kind == 'Phase':
        m = re.match(r'PHASE (\d+)\.', name)
        pnum = m.group(1)
        if pnum == '7' and seen_7:        # the second Phase 7 folds into the first
            continue
        seen_7 = seen_7 or pnum == '7'
        cur_phase = {'num': pnum, 'name': PHASE_NAMES[pnum], 'sections': []}
        phases.append(cur_phase)
    elif kind == 'Section':
        num, sname = name.split(' ', 1)
        if name in RENUMBER:
            num = RENUMBER[name]
        cur_sec = {'num': num, 'name': sname, 'skill': skill_for(num)[0], 'days': 2, 'tasks': []}
        cur_phase['sections'].append(cur_sec)
    elif kind == 'Task':
        cur_sec['tasks'].append(name)
    # untyped rows (the punch-list note) are dropped

assert [p['num'] for p in phases] == [str(i) for i in range(10)], [p['num'] for p in phases]
secs = [s for p in phases for s in p['sections']]
assert len(secs) == 45 and len({s['num'] for s in secs}) == 45, len(secs)

io.open(DATA / 'fiberglass-template.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(phases, indent=1, ensure_ascii=False) + '\n')
with io.open(DATA / 'fiberglass-sub-phase-template.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL)
    w.writerow(['SubPhaseNumber','SubPhaseName','PhaseNumber','PhaseName','TradeCode','TradeName','AssignTo','DefaultDurationDays','Sequence','TaskCount'])
    seq = 0
    for p in phases:
        for s in p['sections']:
            seq += 1
            _, code, tname, assign = skill_for(s['num'])
            w.writerow([s['num'], s['name'], p['num'] + '.0', p['name'], code, tname, assign, s['days'], seq, len(s['tasks'])])
with io.open(DATA / 'fiberglass-task-template.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL)
    w.writerow(['SubPhaseNumber','SubPhaseName','TaskName','Sequence'])
    for s in secs:
        for i, t in enumerate(s['tasks'], 1):
            w.writerow([s['num'], s['name'], t, i])
print('phases %d  sub-phases %d  tasks %d' % (len(phases), len(secs), sum(len(s['tasks']) for s in secs)))
```

- [ ] **Step 4: Run the test**

Run: `python tools/test_fiberglass_template.py`
Expected: every line PASS, exit 0. If "7.4 is Startup Preparation" fails, the `RENUMBER` keys do not match the TSV's section text exactly; print the Section rows and fix the keys.

- [ ] **Step 5: Commit**

```bash
git add tools/fiberglass-template.py tools/test_fiberglass_template.py D2-Build-Scheduler/D2-Build-Scheduler/data/fiberglass-*
git commit -m "Fiberglass template from Don's sheet: 45 sub-phases, 248 tasks, trades copied from Gunite by name"
```

---

### Task 2: Seed generator by build type

**Files:**
- Modify: `tools/gen-template-seed.py` (whole file; it is 125 lines)
- Create: `tools/test_gen_template_seed.py`
- Create: `tools/fixtures/live-crews-sample.json` (a 3-crew, 3-trade cut of `tools/live-crews.json`, same shape)
- Regenerate: `tools/template-seed.json` (Gunite, now with `buildType` and `phaseName`), create `tools/template-seed-fiberglass.json`
- Create: `sharepoint/capture-crews.js` (console snippet that re-captures `tools/live-crews.json`)

**Interfaces:**
- Consumes `fiberglass-template.json` from Task 1 (SEED_TEMPLATE shape).
- Produces seed files consumed by Task 4: `{buildType:'Gunite'|'Fiberglass', subphases:[{num, name, phaseNum, phaseName, skill, tradeCode, defaultCrew, days, seq, candidates, tasks:[]}], counts:{subphases, tasks}}`. `seq` is 1-based position in the template.
- CLI: `python tools/gen-template-seed.py [--template <json>] [--build-type Gunite|Fiberglass] [--live <json>] [--out <json>]`. Defaults reproduce today's run: SEED_TEMPLATE from `web/index.html`, Gunite, `tools/live-crews.json`, `tools/template-seed.json`.

- [ ] **Step 1: Write the failing test**

```python
# tools/test_gen_template_seed.py   Run: python tools/test_gen_template_seed.py
import json, pathlib, subprocess, sys, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
GEN = ROOT / 'tools' / 'gen-template-seed.py'
LIVE = ROOT / 'tools' / 'fixtures' / 'live-crews-sample.json'
FIB = ROOT / 'D2-Build-Scheduler' / 'D2-Build-Scheduler' / 'data' / 'fiberglass-template.json'
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)
def run(*args):
    return subprocess.run([sys.executable, str(GEN), *args], capture_output=True, text=True)
with tempfile.TemporaryDirectory() as d:
    out = pathlib.Path(d) / 'fib.json'
    r = run('--template', str(FIB), '--build-type', 'Fiberglass', '--live', str(LIVE), '--out', str(out))
    ok('fiberglass run exits 0', r.returncode == 0, r.stdout[-300:] + r.stderr[-300:])
    seed = json.loads(out.read_text(encoding='utf-8'))
    ok('buildType on the file', seed.get('buildType') == 'Fiberglass')
    ok('45 sub-phases, 248 tasks', seed['counts'] == {'subphases': 45, 'tasks': 248}, seed['counts'])
    s = seed['subphases']
    ok('every sub-phase carries phaseNum and phaseName', all(x.get('phaseNum') and x.get('phaseName') for x in s))
    ok('2.3 is in Base Preparation and Shell Set', next(x for x in s if x['num'] == '2.3')['phaseName'] == 'Base Preparation and Shell Set')
    ok('seq is 1..45', [x['seq'] for x in s] == list(range(1, 46)))
    ok('@office rows get the office crew', next(x for x in s if x['num'] == '0.1')['defaultCrew'] == 'office')
    ok('@unassigned rows get unassigned', next(x for x in s if x['num'] == '2.3')['defaultCrew'] == 'unassigned')
    ok('a traded row gets a qualified crew from the live list', next(x for x in s if x['num'] == '1.2')['defaultCrew'] in ('campos', 'devon'))
    out2 = pathlib.Path(d) / 'gun.json'
    r = run('--live', str(LIVE), '--out', str(out2))
    ok('default run (Gunite from SEED_TEMPLATE) exits 0', r.returncode == 0, r.stderr[-300:])
    g = json.loads(out2.read_text(encoding='utf-8'))
    ok('default run is Gunite with 46/295', g['buildType'] == 'Gunite' and g['counts'] == {'subphases': 46, 'tasks': 295})
    ok('Gunite rows carry phaseName too', next(x for x in g['subphases'] if x['num'] == '4.3')['phaseName'] == 'Gunite And Shotcrete')
    r = run('--template', str(FIB), '--build-type', 'Carbon', '--live', str(LIVE), '--out', str(out))
    ok('an unknown build type is refused', r.returncode != 0)
sys.exit(1 if fails else 0)
```

`tools/fixtures/live-crews-sample.json`: copy `tools/live-crews.json` and cut `crews` to `campos`, `devon`, `office`, `subcon`, `unassigned`; `trades` to `demolition`, `dig`, `plumbing`; `crewTrades` to the rows joining those. Keep the raw-id shape (`CrewId`, `TradeId` integers). The file header `note` stays.

- [ ] **Step 2: Run it to verify it fails**

Run: `python tools/test_gen_template_seed.py`
Expected: "fiberglass run exits 0" FAILs (unknown arguments), exit 1.

- [ ] **Step 3: Rework the generator**

Replace the constants and the `TPL`/`SECTIONS` block of `tools/gen-template-seed.py` with argument parsing, keeping the crew logic as it is:

```python
import argparse, io, json, collections
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--template', help='template JSON in SEED_TEMPLATE shape; default: SEED_TEMPLATE inside web/index.html')
ap.add_argument('--build-type', default='Gunite', choices=['Gunite', 'Fiberglass'])
ap.add_argument('--live', default='tools/live-crews.json')
ap.add_argument('--out', help='default tools/template-seed.json for Gunite, tools/template-seed-fiberglass.json otherwise')
args = ap.parse_args()
OUT = args.out or ('tools/template-seed.json' if args.build_type == 'Gunite' else 'tools/template-seed-fiberglass.json')

if args.template:
    TPL = json.load(io.open(args.template, encoding='utf-8'))
else:
    src = io.open('web/index.html', encoding='utf-8', errors='replace').read()
    def extract_array(marker):  # unchanged bracket matcher
        ...
    TPL = json.loads(extract_array('SEED_TEMPLATE'))

SECTIONS = [(s['num'], s['name'], s.get('skill'), s['days'] if 'days' in s else 2, s.get('tasks', []),
             ph['num'], ph['name'])
            for ph in TPL for s in ph['sections']]
live = json.load(io.open(args.live, encoding='utf-8'))
```

In the loop, unpack `phase_num, phase_name` and add `'phaseNum': phase_num, 'phaseName': phase_name` to each sub-phase dict. In `out`, add `'buildType': args.build_type` before `'subphases'`. Keep `ensure_ascii=False` for this file (it is served from SiteAssets, UTF-8). Refuse an empty `phaseName` in the validation block: `if not s.get('phaseName'): errs.append('NO PHASE NAME on %s' % s['num'])`.

- [ ] **Step 4: Run the test**

Run: `python tools/test_gen_template_seed.py`
Expected: all PASS.

- [ ] **Step 5: Write the crew capture snippet** (the orchestrator runs it on the site; it replaces the 2026-09-07 capture so default crews reflect the current roster)

```javascript
// sharepoint/capture-crews.js  -- paste into the console on the D2BuildScheduler site, copy the
// printed JSON into tools/live-crews.json (keep the top-level shape: capturedAt, capturedFrom, note, crews, trades, crewTrades)
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const g = async u => (await (await fetch(site + u, { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json()).value;
  const out = {
    capturedAt: new Date().toISOString().slice(0, 10), capturedFrom: site,
    note: 'Crew-Trades.CrewId and .TradeId are raw integer lookup ids: CrewId joins to Crews.Id, TradeId to Trades.Id.',
    crews: await g("/_api/web/lists/GetByTitle('Crews')/items?$select=Id,Title,CrewID,Unlimited,Active,Size&$top=200"),
    trades: await g("/_api/web/lists/GetByTitle('Trades')/items?$select=Id,Title,TradeCode&$top=200"),
    crewTrades: await g("/_api/web/lists/GetByTitle('Crew-Trades')/items?$select=Id,CrewId,TradeId&$top=500")
  };
  console.log(JSON.stringify(out, null, 1));
  return { crews: out.crews.length, trades: out.trades.length, crewTrades: out.crewTrades.length };
})();
```

- [ ] **Step 6: Regenerate both seed files against the fresh capture** (orchestrator, after the capture lands in `tools/live-crews.json`)

```bash
python tools/gen-template-seed.py
python tools/gen-template-seed.py --template "D2-Build-Scheduler/D2-Build-Scheduler/data/fiberglass-template.json" --build-type Fiberglass
```

Expected: `sub-phases : 46` / `tasks : 295` then `sub-phases : 45` / `tasks : 248`, `unassigned : 14` or close to it (rows whose Gunite trade has no live qualified crew also land unassigned; print and accept). Diff `tools/template-seed.json` against git: the only changes should be the two new keys per row and `buildType`; a changed `defaultCrew` means the roster moved since 09-07 and is reported in the session log, not reverted.

- [ ] **Step 7: Commit**

```bash
git add tools/gen-template-seed.py tools/test_gen_template_seed.py tools/fixtures/live-crews-sample.json tools/template-seed.json tools/template-seed-fiberglass.json tools/live-crews.json sharepoint/capture-crews.js
git commit -m "Seed generator takes a template and a build type; Fiberglass seed with phase names"
```

---

### Task 3: SharePoint column, stamp and view scripts

**Files:**
- Create: `sharepoint/provision-build-type.js`
- Create: `sharepoint/stamp-build-type.js`
- Create: `fixtures/planner/build-type-scripts.js`
- Read for the patterns: `sharepoint/provision-pool-lists.js:1-45` (digest, `fieldXml`, sequential creates), `sharepoint/configure-request-lists.js:95-115` (`ShowInNewForm` via `SchemaXml` string insert), `sharepoint/provision-views.js:360-430` (view create and drift check), `fixtures/planner/restore.js` (how a console IIFE is run under Node with a stubbed `fetch`)

**Interfaces:**
- Both scripts are console IIFEs on `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler`. Each returns a report object. Both are idempotent and accept `window.D2_DRY = true` to report without writing.
- `provision-build-type.js` report: `{fields:{created:[], kept:[]}, hidden:[], views:{created:[], kept:[]}, failures:[]}`.
- `stamp-build-type.js` report: `{stamped:{Jobs:n, 'New Pool Requests':n, 'Sub-phase Template':n, 'Task Template':n}, phaseNamed:n, remaining:{...}, blanks:{...}}`. It reads `/SiteAssets/template-seed.json` (Task 2 output, Gunite) for `PhaseName` by `SubPhaseNumber`.

- [ ] **Step 1: Write the failing harness**

```javascript
// fixtures/planner/build-type-scripts.js   Run: node fixtures/planner/build-type-scripts.js
// Runs the two console scripts under Node with a recording fetch, the way restore.js runs restore-project.js.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fails = 0;
const ok = (l, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) { fails++; process.exitCode = 1; } };
const SITE = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';

function stub(state) {
  const calls = [];
  const fetch = async (u, o = {}) => {
    u = String(u); const m = o.method || 'GET'; const h = o.headers || {};
    calls.push({ u: u.replace(SITE, ''), m, h, body: o.body ? JSON.parse(o.body) : null });
    const json = b => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.endsWith('/_api/contextinfo')) return json({ d: { GetContextWebInformation: { FormDigestValue: 'dg' } } });
    if (/\/fields\?\$select=InternalName/.test(u)) { const l = decodeURIComponent(u.match(/GetByTitle\('([^']+)'\)/)[1]); return json({ value: (state.fields[l] || []).map(i => ({ InternalName: i })) }); }
    if (/\/fields\/CreateFieldAsXml/.test(u)) { const l = decodeURIComponent(u.match(/GetByTitle\('([^']+)'\)/)[1]); (state.fields[l] = state.fields[l] || []).push(o.body.match(/Name='([^']+)'/)[1]); return json({ d: {} }); }
    if (/getByInternalNameOrTitle\('BuildType'\)\?\$select=SchemaXml/.test(u)) return json({ SchemaXml: "<Field Type=\"Choice\" Name=\"BuildType\"><CHOICES><CHOICE>Gunite</CHOICE></CHOICES></Field>" });
    if (/\/views\?\$select=Title,Id/.test(u)) return json({ d: { results: state.views || [] } });
    if (/\/views$/.test(u) && m === 'POST') return json({ d: { Id: 'v1' } });
    if (/\/items\?\$select=Id,BuildType/.test(u) || /\/items\?\$select=Id,SubPhaseNumber,BuildType,PhaseName/.test(u)) return json({ value: state.rows });
    if (/\/items\(\d+\)$/.test(u) && m === 'POST') return json({});
    if (/SiteAssets\/template-seed\.json/.test(u)) return json(state.seed);
    return json({ value: [] });
  };
  return { fetch, calls };
}
async function runScript(file, state) {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'sharepoint', file), 'utf8');
  const s = stub(state);
  const ctx = vm.createContext({ fetch: s.fetch, console, window: { D2_DRY: !!state.dry }, URLSearchParams, encodeURIComponent, decodeURIComponent });
  const report = await vm.runInContext(src, ctx);
  return { report, calls: s.calls };
}
(async () => {
  // ---- provision: four BuildType columns, one PhaseName, hidden on Jobs, two views per template list
  let r = await runScript('provision-build-type.js', { fields: {}, views: [] });
  const creates = r.calls.filter(c => /CreateFieldAsXml/.test(c.u));
  ok('BuildType created on four lists', creates.filter(c => /Name='BuildType'/.test(c.body)).length === 4);
  ok('PhaseName created on Sub-phase Template only', creates.filter(c => /Name='PhaseName'/.test(c.body)).map(c => c.u).join() .includes("Sub-phase%20Template") && creates.filter(c => /Name='PhaseName'/.test(c.body)).length === 1);
  const bt = creates.find(c => /Name='BuildType'/.test(c.body)).body;
  ok('BuildType is a required dropdown Choice defaulting to Gunite', /Type='Choice'/.test(bt) && /Required='TRUE'/.test(bt) && /<CHOICE>Gunite<\/CHOICE><CHOICE>Fiberglass<\/CHOICE>/.test(bt) && /<Default>Gunite<\/Default>/.test(bt));
  ok('field creates are sequential (each POST follows the previous response)', r.report.failures.length === 0);
  ok('BuildType hidden on the Jobs New form by SchemaXml insert', r.calls.some(c => /Jobs.*BuildType/.test(c.u) && c.h['X-HTTP-Method'] === 'MERGE' && /ShowInNewForm="FALSE"/.test(c.body.SchemaXml)));
  ok('two views per template list', r.calls.filter(c => /\/views$/.test(c.u) && c.m === 'POST').length === 4);
  ok('view query filters by BuildType and orders by Sequence', r.calls.filter(c => /\/views$/.test(c.u) && c.m === 'POST').every(c => /BuildType/.test(c.body.ViewQuery) && /Sequence/.test(c.body.ViewQuery)));
  // ---- idempotent
  r = await runScript('provision-build-type.js', { fields: { Jobs: ['BuildType'], 'New Pool Requests': ['BuildType'], 'Sub-phase Template': ['BuildType', 'PhaseName'], 'Task Template': ['BuildType'] }, views: [{ Title: 'Gunite', Id: 'a' }, { Title: 'Fiberglass', Id: 'b' }] });
  ok('second run creates nothing', !r.calls.some(c => /CreateFieldAsXml/.test(c.u)) && r.report.fields.kept.length === 5);
  // ---- dry run
  r = await runScript('provision-build-type.js', { fields: {}, views: [], dry: true });
  ok('dry run writes nothing', !r.calls.some(c => c.m === 'POST' && !/contextinfo/.test(c.u)));
  // ---- stamp
  const seed = { subphases: [{ num: '0.0', phaseName: 'Pre Construction/Sales' }, { num: '1.2', phaseName: 'Preconstruction Back Office Admin' }] };
  r = await runScript('stamp-build-type.js', { rows: [{ Id: 1, BuildType: null, SubPhaseNumber: '0.0', PhaseName: null }, { Id: 2, BuildType: 'Gunite', SubPhaseNumber: '1.2', PhaseName: 'x' }], seed });
  const merges = r.calls.filter(c => c.h['X-HTTP-Method'] === 'MERGE');
  ok('only blank rows are stamped', merges.every(c => /items\(1\)$/.test(c.u)));
  ok('the stamp body sets Gunite', merges.some(c => c.body.BuildType === 'Gunite'));
  ok('PhaseName comes from the seed by SubPhaseNumber', merges.some(c => c.body.PhaseName === 'Pre Construction/Sales'));
  ok('report counts blanks remaining after the pass', r.report && r.report.blanks && typeof r.report.blanks.Jobs === 'number');
  process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node fixtures/planner/build-type-scripts.js`
Expected: throws reading `sharepoint/provision-build-type.js` (ENOENT).

- [ ] **Step 3: Write `sharepoint/provision-build-type.js`**

```javascript
/* Add BuildType (Choice: Gunite, Fiberglass; required; default Gunite) to Jobs, New Pool Requests,
 * Sub-phase Template and Task Template, and PhaseName (Text) to Sub-phase Template. Hide BuildType
 * on the Jobs New form (flow-owned). Add Gunite and Fiberglass views to both template lists.
 * Idempotent. window.D2_DRY = true reports without writing.
 * Run in the browser console on https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler
 * signed in as stratirus@d2pools.com. FIELD CREATES ARE SEQUENTIAL (schema lock). */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const DRY = !!(typeof window !== 'undefined' && window.D2_DRY);
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const NM = { Accept: 'application/json;odata=nometadata' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };
  const list = l => site + "/_api/web/lists/GetByTitle('" + encodeURIComponent(l) + "')";
  const g = async u => (await fetch(u, { headers: NM, credentials: 'include' })).json();
  const post = async (u, body, extra) => {
    if (DRY) return { dry: true };
    const r = await fetch(u, { method: 'POST', credentials: 'include', headers: { ...HD, ...(extra || {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    if (!r.ok) throw new Error(u.replace(site, '') + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 300));
    return r.json().catch(() => ({}));
  };
  const report = { fields: { created: [], kept: [] }, hidden: [], views: { created: [], kept: [] }, failures: [] };

  const BUILD_TYPE = "<Field Type='Choice' Name='BuildType' DisplayName='Build Type' Required='TRUE' Format='Dropdown'><CHOICES><CHOICE>Gunite</CHOICE><CHOICE>Fiberglass</CHOICE></CHOICES><Default>Gunite</Default></Field>";
  const PHASE_NAME = "<Field Type='Text' Name='PhaseName' DisplayName='Phase Name' Required='FALSE' MaxLength='255' />";
  const WANT = { 'Jobs': [['BuildType', BUILD_TYPE]], 'New Pool Requests': [['BuildType', BUILD_TYPE]],
                 'Sub-phase Template': [['BuildType', BUILD_TYPE], ['PhaseName', PHASE_NAME]], 'Task Template': [['BuildType', BUILD_TYPE]] };
  for (const [l, fields] of Object.entries(WANT)) {
    const have = new Set(((await g(list(l) + '/fields?$select=InternalName&$top=500')).value || []).map(f => f.InternalName));
    for (const [name, xml] of fields) {            // sequential, deliberately
      if (have.has(name)) { report.fields.kept.push(l + '/' + name); continue; }
      try { await post(list(l) + '/fields/CreateFieldAsXml', { parameters: { __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' }, SchemaXml: xml, Options: 8 } }); report.fields.created.push(l + '/' + name); }
      catch (e) { report.failures.push(l + '/' + name + ': ' + e.message); }
    }
  }
  // Jobs.BuildType is written by D2 - New Pool; hide it on the New form the way Status is (SchemaXml string insert, never a rebuild).
  try {
    const fUrl = list('Jobs') + "/fields/getByInternalNameOrTitle('BuildType')";
    const cur = await g(fUrl + '?$select=SchemaXml');
    if (/ShowInNewForm=/i.test(cur.SchemaXml)) report.hidden.push('Jobs/BuildType (already)');
    else { await post(fUrl, { SchemaXml: cur.SchemaXml.replace('<Field ', '<Field ShowInNewForm="FALSE" ') }, { 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' }); report.hidden.push('Jobs/BuildType'); }
  } catch (e) { report.failures.push('hide Jobs/BuildType: ' + e.message); }
  // One view per type on each template list.
  for (const l of ['Sub-phase Template', 'Task Template']) {
    const existing = ((await g(list(l) + '/views?$select=Title,Id')).d || {}).results || (await g(list(l) + '/views?$select=Title,Id')).value || [];
    for (const t of ['Gunite', 'Fiberglass']) {
      if (existing.some(v => v.Title === t)) { report.views.kept.push(l + '/' + t); continue; }
      const q = "<Where><Eq><FieldRef Name='BuildType'/><Value Type='Choice'>" + t + "</Value></Eq></Where><OrderBy><FieldRef Name='Sequence'/></OrderBy>";
      try { await post(list(l) + '/views', { __metadata: { type: 'SP.View' }, Title: t, ViewQuery: q, RowLimit: 100, Paged: true, PersonalView: false }); report.views.created.push(l + '/' + t); }
      catch (e) { report.failures.push('view ' + l + '/' + t + ': ' + e.message); }
    }
  }
  return report;
})();
```

- [ ] **Step 4: Write `sharepoint/stamp-build-type.js`**

```javascript
/* Stamp BuildType = Gunite on every existing row of Jobs, New Pool Requests, Sub-phase Template and
 * Task Template that has none, and PhaseName on the Gunite sub-phases from SiteAssets/template-seed.json
 * (tools/gen-template-seed.py, Gunite run). Idempotent; 32 s budget per call, re-run until remaining is 0.
 * Run in the console on the D2BuildScheduler site, signed in as stratirus@d2pools.com. */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const DRY = !!(typeof window !== 'undefined' && window.D2_DRY);
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const NM = { Accept: 'application/json;odata=nometadata' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' };
  const list = l => site + "/_api/web/lists/GetByTitle('" + encodeURIComponent(l) + "')";
  const g = async u => (await fetch(u, { headers: NM, credentials: 'include' })).json();
  const all = async u => { let out = [], next = u; while (next) { const d = await g(next); out = out.concat(d.value || []); next = d['odata.nextLink'] || null; } return out; };
  const t0 = Date.now(), outOfTime = () => Date.now() - t0 > 32000;
  const seed = await (await fetch(site + '/SiteAssets/template-seed.json', { credentials: 'include' })).json();
  const phaseByNum = Object.fromEntries((seed.subphases || []).map(s => [s.num, s.phaseName]));
  const report = { stamped: {}, phaseNamed: 0, remaining: {}, blanks: {}, errors: [] };
  const merge = async (l, id, body) => {
    if (DRY) return true;
    const r = await fetch(list(l) + '/items(' + id + ')', { method: 'POST', credentials: 'include', headers: HD, body: JSON.stringify(body) });
    if (!r.ok) { report.errors.push(l + '/' + id + ': ' + r.status); return false; }
    return true;
  };
  for (const l of ['Jobs', 'New Pool Requests', 'Sub-phase Template', 'Task Template']) {
    const sel = l === 'Sub-phase Template' ? 'Id,SubPhaseNumber,BuildType,PhaseName' : 'Id,BuildType';
    const rows = await all(list(l) + '/items?$select=' + sel + '&$top=2000');
    report.stamped[l] = 0; report.remaining[l] = 0;
    for (const r of rows) {
      const body = {};
      if (!r.BuildType) body.BuildType = 'Gunite';
      if (l === 'Sub-phase Template' && !r.PhaseName && phaseByNum[r.SubPhaseNumber]) body.PhaseName = phaseByNum[r.SubPhaseNumber];
      if (!Object.keys(body).length) continue;
      if (outOfTime()) { report.remaining[l]++; continue; }
      if (await merge(l, r.Id, body)) { if (body.BuildType) report.stamped[l]++; if (body.PhaseName) report.phaseNamed++; }
    }
    const after = DRY ? rows : await all(list(l) + '/items?$select=' + sel + '&$top=2000');
    report.blanks[l] = after.filter(r => !r.BuildType).length;
  }
  return report;
})();
```

- [ ] **Step 5: Run the harness**

Run: `node fixtures/planner/build-type-scripts.js`
Expected: all PASS. If the views assertion fails because the stub's `/views?$select` returns `{d:{results}}` while the script read `.value`, keep the script's dual read (it handles both) and fix the stub, not the script.

- [ ] **Step 6: Commit**

```bash
git add sharepoint/provision-build-type.js sharepoint/stamp-build-type.js fixtures/planner/build-type-scripts.js
git commit -m "BuildType column, Gunite stamping and per-type views as console scripts, with a Node harness"
```

---

### Task 4: Seed script by build type

**Files:**
- Modify: `sharepoint/seed-templates.js` (whole file, 77 lines)
- Modify: `fixtures/planner/build-type-scripts.js` (add a seed section)

**Interfaces:**
- Consumes a seed file from Task 2: `{buildType, subphases:[{num, name, phaseName, tradeCode, defaultCrew, days, seq, tasks:[]}]}`.
- The script reads `window.D2_SEED_FILE` (default `'template-seed.json'`) from `/SiteAssets/`, and offers `window.D2_SEED_UPLOAD = <json string>` to upload that file to SiteAssets first, so no hand upload is needed.
- Sub-phases match on `BuildType` + `SubPhaseNumber`; tasks on parent id + `Sequence`. Both writes carry `BuildType`; sub-phases also carry `PhaseName`.

- [ ] **Step 1: Add the failing assertions to the harness**

Append to `fixtures/planner/build-type-scripts.js` before `process.exit`, and extend `stub()` so `/SiteAssets/<file>` returns `state.seed`, `/_api/web/lists/GetByTitle('Sub-phase Template')/items?$select=Id,SubPhaseNumber,BuildType` returns `state.sub`, `/Task Template/items?$select=Id,SubPhaseId,Sequence` returns `state.tasks`, `/Trades/items` returns `[{Id: 7, TradeCode: 'demolition'}]`, and a POST to `/items` returns `{d:{Id: 100 + state.n++}}`:

```javascript
  // ---- seed by build type
  const fib = { buildType: 'Fiberglass', subphases: [
    { num: '1.2', name: 'Site Preparation', phaseName: 'Preconstruction Back Office Admin', tradeCode: 'demolition', defaultCrew: 'campos', days: 2, seq: 1, tasks: ['A', 'B'] },
    { num: '2.3', name: 'Crane Set and Shell Placement', phaseName: 'Base Preparation and Shell Set', tradeCode: null, defaultCrew: 'unassigned', days: 2, seq: 2, tasks: ['C'] } ] };
  r = await runScript('seed-templates.js', { seed: fib, sub: [{ Id: 5, SubPhaseNumber: '1.2', BuildType: 'Gunite' }], tasks: [], n: 0, seedFile: 'template-seed-fiberglass.json' });
  const subPosts = r.calls.filter(c => c.m === 'POST' && /Sub-phase%20Template'\)\/items$/.test(c.u));
  ok('a Gunite 1.2 does not satisfy a Fiberglass 1.2: both Fiberglass sub-phases are created', subPosts.length === 2);
  ok('sub-phase bodies carry BuildType and PhaseName', subPosts.every(c => c.body.BuildType === 'Fiberglass' && c.body.PhaseName));
  ok('TradeId resolved by TradeCode, absent when there is no trade', subPosts[0].body.TradeId === 7 && !('TradeId' in subPosts[1].body));
  const taskPosts = r.calls.filter(c => c.m === 'POST' && /Task%20Template'\)\/items$/.test(c.u));
  ok('three tasks created, each with BuildType and its parent id', taskPosts.length === 3 && taskPosts.every(c => c.body.BuildType === 'Fiberglass' && c.body.SubPhaseId >= 100));
  ok('report says remaining 0', r.report.remaining === 0 && r.report.subCreated === 2 && r.report.taskCreated === 3);
  r = await runScript('seed-templates.js', { seed: fib, sub: [{ Id: 5, SubPhaseNumber: '1.2', BuildType: 'Fiberglass' }, { Id: 6, SubPhaseNumber: '2.3', BuildType: 'Fiberglass' }], tasks: [{ Id: 1, SubPhaseId: 5, Sequence: 1 }, { Id: 2, SubPhaseId: 5, Sequence: 2 }, { Id: 3, SubPhaseId: 6, Sequence: 1 }], n: 0, seedFile: 'template-seed-fiberglass.json' });
  ok('second run creates nothing', !r.calls.some(c => c.m === 'POST' && /\/items$/.test(c.u)));
  ok('the seed file name is taken from window.D2_SEED_FILE', r.calls.some(c => /SiteAssets\/template-seed-fiberglass\.json/.test(c.u)));
```

In `runScript`, pass `window: { D2_DRY: !!state.dry, D2_SEED_FILE: state.seedFile }`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node fixtures/planner/build-type-scripts.js`
Expected: the seed section FAILs ("both Fiberglass sub-phases are created" sees 1 create, no BuildType on bodies).

- [ ] **Step 3: Rework `sharepoint/seed-templates.js`**

Replace the file body (keep the header comment, add the lines about build type and the optional upload):

```javascript
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const TYPE_SUB  = 'SP.Data.Subphase_x0020_TemplateListItem';
  const TYPE_TASK = 'SP.Data.Task_x0020_TemplateListItem';
  const CHUNK = 8, BUDGET_MS = 32000;
  const W = typeof window !== 'undefined' ? window : {};
  const FILE = W.D2_SEED_FILE || 'template-seed.json';

  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };
  const g = async u => (await fetch(site + u, { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json();
  const t0 = Date.now(), outOfTime = () => Date.now() - t0 > BUDGET_MS;
  const create = async (list, type, body) => {
    const r = await fetch(site + `/_api/web/lists/GetByTitle('${encodeURIComponent(list)}')/items`, { method: 'POST', credentials: 'include', headers: HD, body: JSON.stringify({ __metadata: { type }, ...body }) });
    if (!r.ok) return { ok: false, status: r.status, err: (await r.text()).slice(0, 200) };
    return { ok: true, item: (await r.json()).d };
  };
  // Optional: upload the seed file first, so nothing is dragged into SiteAssets by hand.
  if (W.D2_SEED_UPLOAD) {
    const up = await fetch(site + `/_api/web/GetFolderByServerRelativeUrl('SiteAssets')/Files/add(url='${FILE}',overwrite=true)`, { method: 'POST', credentials: 'include', headers: HD, body: W.D2_SEED_UPLOAD });
    if (!up.ok) return { error: 'upload ' + up.status + ' ' + (await up.text()).slice(0, 200) };
  }
  const plan = await (await fetch(site + '/SiteAssets/' + FILE, { credentials: 'include' })).json();
  const TYPE = plan.buildType || 'Gunite';
  const out = { buildType: TYPE, subCreated: 0, taskCreated: 0, errors: [], remaining: 0 };

  // ---- sub-phases (sequential: tasks need their ids). Match on BuildType + SubPhaseNumber: 1.1 exists in both types.
  const have = (await g("/_api/web/lists/GetByTitle('Sub-phase%20Template')/items?$select=Id,SubPhaseNumber,BuildType&$top=500")).value;
  const byNum = Object.fromEntries(have.filter(r => (r.BuildType || 'Gunite') === TYPE).map(r => [r.SubPhaseNumber, r.Id]));
  const trades = (await g("/_api/web/lists/GetByTitle('Trades')/items?$select=Id,TradeCode&$top=200")).value;
  const tradeId = Object.fromEntries(trades.map(t => [t.TradeCode, t.Id]));
  for (const s of plan.subphases) {
    if (byNum[s.num]) continue;
    if (outOfTime()) { out.remaining = plan.subphases.filter(x => !byNum[x.num]).length; return out; }
    const body = { Title: s.name, SubPhaseNumber: s.num, Sequence: s.seq, DefaultCrew: s.defaultCrew, DurationDays: s.days, BuildType: TYPE, PhaseName: s.phaseName || '' };
    if (s.tradeCode && tradeId[s.tradeCode]) body.TradeId = tradeId[s.tradeCode];
    const r = await create('Sub-phase Template', TYPE_SUB, body);
    if (!r.ok) { out.errors.push(s.num + ': ' + r.err); continue; }
    byNum[s.num] = r.item.Id; out.subCreated++;
  }
  // ---- tasks (parallel in chunks). Parent id + Sequence is already type-specific through the parent.
  const haveTasks = (await g("/_api/web/lists/GetByTitle('Task%20Template')/items?$select=Id,SubPhaseId,Sequence&$top=2000")).value;
  const seen = new Set(haveTasks.map(r => r.SubPhaseId + ':' + r.Sequence));
  const todo = [];
  for (const s of plan.subphases) {
    const pid = byNum[s.num]; if (!pid) continue;
    s.tasks.forEach((name, i) => { if (!seen.has(pid + ':' + (i + 1))) todo.push({ Title: name, SubPhaseId: pid, Sequence: i + 1, BuildType: TYPE }); });
  }
  for (let i = 0; i < todo.length; i += CHUNK) {
    if (outOfTime()) { out.remaining = todo.length - i; return out; }
    const rs = await Promise.all(todo.slice(i, i + CHUNK).map(b => create('Task Template', TYPE_TASK, b)));
    rs.forEach((r, k) => r.ok ? out.taskCreated++ : out.errors.push(todo[i + k].Title + ': ' + r.err));
  }
  return out;
})();
```

- [ ] **Step 4: Run the harness**

Run: `node fixtures/planner/build-type-scripts.js`
Expected: all PASS, including the Task 3 sections.

- [ ] **Step 5: Commit**

```bash
git add sharepoint/seed-templates.js fixtures/planner/build-type-scripts.js
git commit -m "Seed script seeds one build type, matches on type and number, uploads its own seed file"
```

---

### Task 5: Flow builder, structural test, push driver

**Files:**
- Create: `flows/scripts/new_pool_build_type.py`
- Create: `flows/scripts/test_new_pool_build_type.py`
- Create: `flows/scripts/2026-10-13-new-pool-build-type.py` (copy of `flows/scripts/2026-10-03-new-pool-always-create.py` with the module swapped; same tenant guard, dry/apply modes, PATCH + PublishXml)
- Read: `flows/exports/D2-New-Pool-2026-10-03.json` (the source definition), `flows/scripts/new_pool_always_create.py` and its test (the pattern)

**Interfaces:**
- `apply(actions) -> actions`, idempotent, mutates in place and returns. `find(actions, name)` as in the sibling module.
- Adds `Compose_build_type` in `Scope_provision_job` before `Create_job`; filters on both template reads; `$top` 1000 on tasks; `Condition_read_at_cap` after `Get_task_template` with `Set_status_failed_cap` + `Terminate_cap` inside; `BuildType` in the `Create_job` body; type named in `Compose_result`.

- [ ] **Step 1: Write the failing test**

```python
# flows/scripts/test_new_pool_build_type.py   Run: python flows/scripts/test_new_pool_build_type.py
import json, pathlib, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from new_pool_build_type import apply, find
EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-New-Pool-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
before = load([p for p in EXPORTS if 'Compose_build_type' not in json.dumps(load(p))][-1])
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

A = apply(json.loads(json.dumps(before)))
scope = A['Scope_provision_job']['actions']
ok('Compose_build_type sits in the provision scope after Ensure_pm_user', scope['Compose_build_type']['runAfter'] == {'Ensure_pm_user': ['Succeeded']})
ok('it coalesces a missing BuildType to Gunite', scope['Compose_build_type']['inputs'] == "@coalesce(triggerOutputs()?['body/BuildType']?['Value'], 'Gunite')")
sp, tt = scope['Get_subphase_template']['inputs']['parameters'], scope['Get_task_template']['inputs']['parameters']
ok('the template reads now run BEFORE Create_job, straight after the type', scope['Get_subphase_template']['runAfter'] == {'Compose_build_type': ['Succeeded']} and scope['Get_task_template']['runAfter'] == {'Get_subphase_template': ['Succeeded']})
ok('sub-phase read filtered by type, still ordered by Sequence, cap 100', sp['$filter'] == "BuildType eq '@{outputs('Compose_build_type')}'" and sp['$orderby'] == 'Sequence asc' and sp['$top'] == 100)
ok('task read filtered by type, cap raised to 1000', tt['$filter'] == "BuildType eq '@{outputs('Compose_build_type')}'" and tt['$top'] == 1000)
cap = scope['Condition_read_at_cap']
ok('the guard runs after the task read', cap['runAfter'] == {'Get_task_template': ['Succeeded']})
ok('the guard fires at either cap', cap['expression'] == {'or': [{'greaterOrEquals': ["@length(outputs('Get_subphase_template')?['body/value'])", 100]}, {'greaterOrEquals': ["@length(outputs('Get_task_template')?['body/value'])", 1000]}]})
ok('the guard marks the request Failed with ReadAtCap and terminates', 'ReadAtCap' in json.dumps(cap['actions']['Set_status_failed_cap']['inputs']) and cap['actions']['Terminate_cap']['type'] == 'Terminate' and cap['actions']['Terminate_cap']['inputs']['runStatus'] == 'Failed')
ok('Create_job runs only after the guard passes, so a capped read builds nothing', scope['Create_job']['runAfter'] == {'Condition_read_at_cap': ['Succeeded']})
ok('Create_job writes BuildType', '"BuildType\\":\\"@{outputs(\'Compose_build_type\')}\\"' in json.dumps(scope['Create_job']['inputs']['parameters']['parameters/body']))
ok('the work-calendar read follows Create_job, as the reads used to', scope['Get_work_calendar']['runAfter'] == {'Create_job': ['Succeeded']})
ok('the result message names the type', "outputs('Compose_build_type')" in find(A, 'Compose_result')['inputs'])
ok('a short-span and failure messages are untouched', find(A, 'Compose_short_scheduled_message') == find(before, 'Compose_short_scheduled_message'))
ok('apply is idempotent', json.dumps(apply(json.loads(json.dumps(A))), sort_keys=True) == json.dumps(A, sort_keys=True))
ok('nothing outside the scope and the result changed', json.dumps({k: v for k, v in before.items() if k not in ('Scope_provision_job', 'Condition_short_scheduled')}, sort_keys=True) == json.dumps({k: v for k, v in A.items() if k not in ('Scope_provision_job', 'Condition_short_scheduled')}, sort_keys=True))
body = scope['Create_job']['inputs']['parameters']['parameters/body']
rendered = json.loads(re.sub(r'@\{([^{}]*)\}', lambda m: 'Fiberglass' if 'Compose_build_type' in m.group(1) else ('X' if body[m.start()-1] == '"' else '7'), body))
ok('the Create_job body is valid JSON with BuildType beside Status', rendered['BuildType'] == 'Fiberglass' and rendered['Status'] == 'Planned')
for name in ('Compose_build_type', 'Compose_result'):
    ok(f'{name}: quotes balanced', json.dumps(find(A, name)['inputs']).count("'") % 2 == 0)
ok('the definition is ASCII-safe when dumped', json.dumps(A, ensure_ascii=True).isascii())
newest = load(EXPORTS[-1])
if 'Compose_build_type' in json.dumps(newest):
    strip = lambda x: json.loads(json.dumps(x).replace('"authentication": "@parameters(\'$authentication\')", ', ''))
    ok('published flow equals what the builder produces (no drift)', strip(newest) == strip(A))
sys.exit(1 if fails else 0)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python flows/scripts/test_new_pool_build_type.py`
Expected: ImportError on `new_pool_build_type`.

- [ ] **Step 3: Write the builder**

```python
# flows/scripts/new_pool_build_type.py
"""D2 - New Pool builds from the template of the request's build type (2026-10-13).

- Compose_build_type reads BuildType off the request, Gunite when absent (older planner builds and
  REST creates that omit it).
- Both template reads are filtered by type. The task read's cap rises to 1000: the list now holds
  Gunite's 295 and Fiberglass's 248, and the old cap of 500 would have truncated Gunite's own tasks.
- A read that comes back at its cap fails the request (ReadAtCap) before Create_job, as the
  2026-09-28 guards do on four other flows. A truncated template must never become a half-built project.
- Create_job writes BuildType on the Job; the result email names the type.
"""
SCOPE = 'Scope_provision_job'
TYPE = "outputs('Compose_build_type')"
COMPOSE_TYPE = {'runAfter': {'Ensure_pm_user': ['Succeeded']}, 'type': 'Compose',
                'inputs': "@coalesce(triggerOutputs()?['body/BuildType']?['Value'], 'Gunite')"}
FILTER = "BuildType eq '@{" + TYPE + "}'"
REQ_TYPE = 'SP.Data.New_x0020_Pool_x0020_RequestsListItem'
CAP = {
    'runAfter': {'Get_task_template': ['Succeeded']}, 'type': 'If',
    'expression': {'or': [
        {'greaterOrEquals': ["@length(outputs('Get_subphase_template')?['body/value'])", 100]},
        {'greaterOrEquals': ["@length(outputs('Get_task_template')?['body/value'])", 1000]}]},
    'actions': {
        'Set_status_failed_cap': {'runAfter': {}, 'type': 'OpenApiConnection', 'inputs': {
            'host': {'apiId': '/providers/Microsoft.PowerApps/apis/shared_sharepointonline', 'operationId': 'HttpRequest', 'connectionName': 'shared_sharepointonline'},
            'parameters': {
                'dataset': 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler',
                'parameters/method': 'POST',
                'parameters/uri': "_api/web/lists/GetByTitle('New Pool Requests')/items(@{triggerOutputs()?['body/ID']})",
                'parameters/headers': {'X-HTTP-Method': 'MERGE', 'If-Match': '*', 'Content-Type': 'application/json;odata=verbose', 'Accept': 'application/json;odata=verbose'},
                'parameters/body': '{"__metadata":{"type":"' + REQ_TYPE + '"},"Status":"Failed","Result":"ReadAtCap: the @{' + TYPE + '} template read came back at its cap (sub-phases @{length(outputs(\'Get_subphase_template\')?[\'body/value\'])}, tasks @{length(outputs(\'Get_task_template\')?[\'body/value\'])}). Nothing was built. The template lists need checking before this request is re-entered."}'}}},
        'Terminate_cap': {'runAfter': {'Set_status_failed_cap': ['Succeeded']}, 'type': 'Terminate', 'inputs': {'runStatus': 'Failed', 'runError': {'code': 'ReadAtCap', 'message': 'Template read at cap'}}}},
}
RESULT_OLD = "@concat('Created ', triggerOutputs()?['body/JobNumber'], ': ', "
RESULT_NEW = "@concat('Created ', triggerOutputs()?['body/JobNumber'], ' (', " + TYPE + ", '): ', "

def find(actions, name):
    for k, a in actions.items():
        if k == name:
            return a
        for sub in (a.get('actions', {}), a.get('else', {}).get('actions', {})):
            hit = find(sub, name)
            if hit:
                return hit
    return None

def apply(actions):
    scope = actions[SCOPE]['actions']
    if 'Compose_build_type' in scope:
        return actions
    # Order today: Ensure_pm_user -> Create_job -> Get_subphase_template -> Get_task_template -> Get_work_calendar.
    # Order after:  Ensure_pm_user -> Compose_build_type -> Get_subphase_template -> Get_task_template
    #               -> Condition_read_at_cap -> Create_job -> Get_work_calendar. A capped read never creates the Job.
    assert scope['Get_subphase_template']['runAfter'] == {'Create_job': ['Succeeded']}, scope['Get_subphase_template']['runAfter']
    assert scope['Get_work_calendar']['runAfter'] == {'Get_task_template': ['Succeeded']}, scope['Get_work_calendar']['runAfter']
    scope['Compose_build_type'] = COMPOSE_TYPE
    scope['Get_subphase_template']['runAfter'] = {'Compose_build_type': ['Succeeded']}
    sp = scope['Get_subphase_template']['inputs']['parameters']; sp['$filter'] = FILTER
    tt = scope['Get_task_template']['inputs']['parameters']; tt['$filter'] = FILTER; tt['$top'] = 1000
    scope['Condition_read_at_cap'] = CAP
    scope['Create_job']['runAfter'] = {'Condition_read_at_cap': ['Succeeded']}
    body = scope['Create_job']['inputs']['parameters']['parameters/body']
    assert body.count('"Status":"Planned"') == 1
    scope['Create_job']['inputs']['parameters']['parameters/body'] = body.replace('"Status":"Planned"', '"Status":"Planned","BuildType":"@{' + TYPE + '}"')
    scope['Get_work_calendar']['runAfter'] = {'Create_job': ['Succeeded']}
    res = find(actions, 'Compose_result')
    assert res['inputs'].startswith(RESULT_OLD), res['inputs'][:80]
    res['inputs'] = RESULT_NEW + res['inputs'][len(RESULT_OLD):]
    return actions
```

If either `runAfter` assertion fails, the live order differs from the 10-03 export: print both values, stop, and report; do not guess a new order.

- [ ] **Step 4: Run the test**

Run: `python flows/scripts/test_new_pool_build_type.py`
Expected: all PASS except the final no-drift line, which is skipped until the flow is exported after Task 7.

- [ ] **Step 5: Write the push driver**

Copy `flows/scripts/2026-10-03-new-pool-always-create.py` to `flows/scripts/2026-10-13-new-pool-build-type.py`. Change the import to `from new_pool_build_type import apply, find`, the docstring to name this change, the "create in else" print lines to `print(f"live: ... Compose_build_type present: {'Compose_build_type' in A['Scope_provision_job']['actions']}")`, and keep the tenant guard, `MODE`, `PATCH` with `ensure_ascii=True` and the `PublishXml` call exactly as they are. Add, before the PATCH, a backup write: `pathlib.Path('flows/exports/D2-New-Pool-pre-build-type-backup.json').write_text(row['clientdata'], encoding='utf-8')`.

- [ ] **Step 6: Dry-run the driver** (needs `az login --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4` on this machine; if `az` is on another tenant the script aborts, which is the correct outcome)

Run: `python flows/scripts/2026-10-13-new-pool-build-type.py`
Expected: `tenant CONFIRMED stratirus@d2pools.com`, `live: statecode 1 ... Compose_build_type present: False`, `dry run, nothing written`.

- [ ] **Step 7: Commit**

```bash
git add flows/scripts/new_pool_build_type.py flows/scripts/test_new_pool_build_type.py flows/scripts/2026-10-13-new-pool-build-type.py
git commit -m "New Pool builds from the request's build type: filtered template reads, raised task cap, read-at-cap guard"
```

---

### Task 6: LIVE 1 — columns, stamping, views; Gunite throwaway on the unchanged flow

**Runs where:** orchestrator, in the signed-in browser on the site (Claude in Chrome, per CLAUDE.md "REST-from-page"). Nothing in this task is a code change.

- [ ] **Step 1: Upload the Gunite seed** (stamping reads `PhaseName` from it): run `sharepoint/seed-templates.js` with `window.D2_SEED_FILE='template-seed.json'; window.D2_SEED_UPLOAD=<contents of tools/template-seed.json>`. Expected report: `subCreated 0, taskCreated 0, remaining 0` (everything already exists; only the upload happened).
- [ ] **Step 2: Dry-run `sharepoint/provision-build-type.js`** with `window.D2_DRY=true`. Expected: `fields.created` lists the five columns, `views.created` lists four, `failures` empty.
- [ ] **Step 3: Run it for real.** Expected the same lists under `created`; re-run once and expect everything under `kept`.
- [ ] **Step 4: Run `sharepoint/stamp-build-type.js`** until `remaining` is all zeros. Expected `stamped`: Jobs = the live Jobs count (34 plus completed ones), New Pool Requests = its row count, Sub-phase Template 46, Task Template 295; `phaseNamed` 46; `blanks` all 0.
- [ ] **Step 5: Read back from the site** and record the numbers in the session log:

```
/_api/web/lists/GetByTitle('Sub-phase Template')/items?$select=SubPhaseNumber,BuildType,PhaseName&$top=200
/_api/web/lists/GetByTitle('Jobs')/items?$select=JobNumber,BuildType&$filter=BuildType ne 'Gunite'&$top=100   -> expected zero rows
```

- [ ] **Step 6: Throwaway Gunite build on the unchanged flow.** Stop Flow 3. Raise `TEST-9902` through the planner's `+ Job` (hosted planner, as today: no build type yet) or the New Pool Requests form, PM = stratirus@d2pools.com. Wait for `Done` (10 to 20 min). Read back: 46 Assignments, 295 Tasks, `Jobs.BuildType = Gunite` (the column default on the Job row written by the old flow is Gunite because the column defaults; confirm it, and if it is blank, note that the old flow does not write it and the stamp will catch it). Leave `TEST-9902` in place for Task 7's comparison; Flow 3 stays stopped through Task 8.

---

### Task 7: LIVE 2 — push the flow; Gunite throwaway; export

**Runs where:** orchestrator.

- [ ] **Step 1:** `m365-tenant-guard`: `az account show` must report tenant `f24d9b39-…`; FlowAgent `whoami` must agree.
- [ ] **Step 2:** `python flows/scripts/2026-10-13-new-pool-build-type.py` (dry) then `... apply`. Expected: `PATCH 204` and `PublishXml 204`.
- [ ] **Step 3:** FlowAgent `get_flow` on `02905018-4f41-e05a-d140-74e2afc82052`: confirm `Compose_build_type` is in the published definition and the two `$filter` strings are intact.
- [ ] **Step 4:** Delete `TEST-9902` through `Delete Pool Requests`, then raise it again. Wait for `Done`. Read back 46 / 295 and `Jobs.BuildType = Gunite`; open the run in FlowAgent `get_run_actions` and confirm `Compose_build_type` output is `Gunite` and `Get_task_template` returned 295 rows. Record the trigger body's `BuildType` shape (`{Id, Value}` expected) in the session log; if it is a bare string, change `COMPOSE_TYPE` to coalesce both forms and re-push.
- [ ] **Step 5:** Export: `python flows/scripts/export-flows.py` (or the documented FlowAgent export) to `flows/exports/D2-New-Pool-2026-10-13.json`; run `python flows/scripts/test_new_pool_build_type.py` and expect the no-drift line to PASS. Commit the export.

---

### Task 8: LIVE 3 — Fiberglass seed; Fiberglass and Gunite throwaways; delete

**Runs where:** orchestrator.

- [ ] **Step 1:** Run `sharepoint/seed-templates.js` with `window.D2_SEED_FILE='template-seed-fiberglass.json'; window.D2_SEED_UPLOAD=<contents of tools/template-seed-fiberglass.json>`, repeating until `remaining` is 0. Expected totals across runs: `subCreated 45, taskCreated 248, errors []`.
- [ ] **Step 2:** Read back and record: Sub-phase Template 46 Gunite + 45 Fiberglass; Task Template 295 + 248; every Fiberglass task's `SubPhaseId` is a Fiberglass sub-phase id; no blank `BuildType` anywhere.
- [ ] **Step 3:** Raise `TEST-9901` as Fiberglass through the New Pool Requests form (the planner cannot send a type yet). Wait for `Done`. Read back: 45 Assignments whose `SubPhaseNumber` set equals the Fiberglass template's, 248 Tasks, `Jobs.BuildType = Fiberglass`, crews per `tools/template-seed-fiberglass.json`. Confirm the result email says `(Fiberglass)`.
- [ ] **Step 4:** Raise one more Gunite request (`TEST-9903`) and read back 46 / 295: the filter keeps the types apart.
- [ ] **Step 5:** Leave `TEST-9901` in place until Task 14's real-browser check; delete `TEST-9902` and `TEST-9903` through `Delete Pool Requests`. Restart Flow 3.

---

### Task 9: Capture the three lists into both fixtures

**Files:**
- Modify: `fixtures/planner/capture-graph.js` (`LISTS` gains `spt`, `tpt`, `trades`; a `--merge` flag that writes only those keys into the existing `live-payloads-graph.json` and `live-payloads-graph-filtered.json`)
- Modify: `fixtures/planner/capture-graph.html` (reads `__LISTS__` as it does; no change if it iterates the object)
- Create: `fixtures/planner/merge-capture.js` (Node: `node fixtures/planner/merge-capture.js <captured.json> <target.json> spt tpt trades` copies the named keys into the target, nothing else)
- Create: `sharepoint/capture-template-lists.js` (console: REST `$select` reads of the three lists, printed as JSON, for `live-payloads.json`)
- Modify: `fixtures/planner/live-payloads.json`, `fixtures/planner/live-payloads-graph.json`, `fixtures/planner/live-payloads-graph-filtered.json` (new keys only)

**Interfaces:**
- Graph fixture keys: `spt` (Sub-phase Template rows, `{id, fields:{Title, SubPhaseNumber, Sequence, TradeLookupId, DefaultCrew, DurationDays, BuildType, PhaseName, id, ...}}`), `tpt` (`fields:{Title, SubPhaseLookupId, Sequence, BuildType, id}`), `trades` (`fields:{Title, TradeCode, id}`). **The exact names are whatever the capture prints**; Task 10 reads them from the file.
- REST fixture keys with the same names, flat rows: `spt` `{Id, Title, SubPhaseNumber, Sequence, TradeId, DefaultCrew, DurationDays, BuildType, PhaseName}`, `tpt` `{Id, Title, SubPhaseId, Sequence, BuildType}`, `trades` `{Id, TradeCode}`.

- [ ] **Step 1 (subagent):** write `merge-capture.js` and the `--merge` path in `capture-graph.js` (the page POSTs the full capture; with `--merge` the server copies only the three keys into the two target files and leaves `jobs`, `asg`, `tasks`, `cal` untouched). Write `sharepoint/capture-template-lists.js`:

```javascript
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const all = async u => { let out = [], next = site + u; while (next) { const d = await (await fetch(next, { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json(); out = out.concat(d.value || []); next = d['odata.nextLink'] || null; } return out; };
  const out = {
    spt: await all("/_api/web/lists/GetByTitle('Sub-phase%20Template')/items?$select=Id,Title,SubPhaseNumber,Sequence,TradeId,DefaultCrew,DurationDays,BuildType,PhaseName&$top=500&$orderby=Id"),
    tpt: await all("/_api/web/lists/GetByTitle('Task%20Template')/items?$select=Id,Title,SubPhaseId,Sequence,BuildType&$top=2000&$orderby=Id"),
    trades: await all("/_api/web/lists/GetByTitle('Trades')/items?$select=Id,TradeCode&$top=200")
  };
  console.log(JSON.stringify(out));
  return { spt: out.spt.length, tpt: out.tpt.length, trades: out.trades.length };
})();
```

- [ ] **Step 2 (orchestrator):** run `node fixtures/planner/capture-graph.js --merge` and sign in; then run the REST snippet and merge its output into `live-payloads.json` with `node fixtures/planner/merge-capture.js <saved.json> fixtures/planner/live-payloads.json spt tpt trades`.
- [ ] **Step 3:** `node fixtures/planner/graph-read.js` and `npm test` still pass (the new keys are ignored until Task 10).
- [ ] **Step 4: Commit** the three fixtures and the tools: `git commit -m "Fixtures: Sub-phase Template, Task Template and Trades captured on both read paths"`.

---

### Task 10: Payload mapping on both read paths

**Files:**
- Modify: `web/graph-to-planner.js:114-275` (`toPlannerPayload`)
- Modify: `sharepoint/export-to-planner.js:66-130` (the reads and the payload)
- Modify: `fixtures/planner/run-export.js:14-40` (serve the three lists from `live.spt`, `live.tpt`, `live.trades`)
- Modify: `fixtures/planner/graph-read.js` (new assertions)
- Modify: `fixtures/planner/office-views.g2p-mutations.json` (two mutations)

**Interfaces:**
- Produces on both payloads: `jobs[i].buildType` (`'Gunite'` or `'Fiberglass'`, normalised: trimmed, case-folded, anything else or missing is `'Gunite'`) and `templates: {Gunite:[phase...], Fiberglass:[phase...]}` where a phase is `{num:'0', name:'Pre Construction/Sales', sections:[{num:'0.0', name, skill, days, tasks:['...']}]}`. A type with no rows is simply absent from `templates`. `skill` is `TradeCode` via the lookup id, else `'@office'` / `'@sub'` / `'@unassigned'` from `DefaultCrew` `office` / `subcon` / `unassigned`, else `null`.
- Exports `normType` and `templatesFrom` from `graph-to-planner.js` for the harnesses.

- [ ] **Step 1: Read the captured field names** in `fixtures/planner/live-payloads-graph.json` (`spt[0].fields`, `tpt[0].fields`, `trades[0].fields`) and `live-payloads.json` (`spt[0]`, `tpt[0]`, `trades[0]`). Write the mapping against those names; if a name below differs from the capture, the capture wins.

- [ ] **Step 2: Write the failing assertions** (append to `fixtures/planner/graph-read.js` before the exit):

```javascript
  /* ---- templates and build type (2026-10-13) ---- */
  const T = graphPayload.templates;
  ok('Graph payload carries templates for both types', T && Array.isArray(T.Gunite) && Array.isArray(T.Fiberglass));
  const gs = T.Gunite.flatMap(p => p.sections), fsx = T.Fiberglass.flatMap(p => p.sections);
  ok('Gunite template is the live 46 with 295 tasks', gs.length === 46 && gs.reduce((n, s) => n + s.tasks.length, 0) === 295);
  ok('Fiberglass template is 45 with 248 tasks', fsx.length === 45 && fsx.reduce((n, s) => n + s.tasks.length, 0) === 248);
  ok('phases are grouped by the integer part of the number, in order', T.Fiberglass.map(p => p.num).join() === '0,1,2,3,4,5,6,7,8,9');
  ok('phase names come from PhaseName', T.Fiberglass[2].name === 'Base Preparation and Shell Set');
  ok('sections are in Sequence order', fsx.map(s => s.num).slice(0, 3).join() === '0.0,0.1,1.0');
  ok('skill is the TradeCode through the Trade lookup', gs.find(s => s.num === '1.2').skill === 'demolition');
  ok('a row with no trade and DefaultCrew office is @office', gs.find(s => s.num === '0.0').skill === '@office');
  ok('subcon -> @sub, unassigned -> @unassigned', gs.find(s => s.num === '2.4').skill === '@sub' && gs.find(s => s.num === '1.4').skill === '@unassigned');
  ok('days come from DurationDays', gs.every(s => s.days >= 1));
  ok('every live job carries buildType Gunite', graphPayload.jobs.every(j => j.buildType === 'Gunite'));
  const M = require(path.join(WEB, 'graph-to-planner.js'));
  ok('normType folds case and space, defaults to Gunite', M.normType(' fiberglass ') === 'Fiberglass' && M.normType('GUNITE') === 'Gunite' && M.normType(undefined) === 'Gunite' && M.normType('Carbon') === 'Gunite');
  ok('a template read with no rows yields no key, not an empty array', !('Carbon' in T));
  ok('REST payload carries the same templates and types', JSON.stringify(restPayload.templates) === JSON.stringify(T) && restPayload.jobs.every(j => j.buildType === 'Gunite'));
```

`restPayload` comes from `runExport(live)` where `live` is `live-payloads.json`; check how the file already builds it and reuse that variable.

- [ ] **Step 3: Run to verify it fails**

Run: `node fixtures/planner/graph-read.js`
Expected: the new block FAILs (`templates` undefined).

- [ ] **Step 4: Implement in `graph-to-planner.js`**

Add inside the factory, before `toPlannerPayload`:

```javascript
  const TYPES = ['Gunite', 'Fiberglass'];
  function normType(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return TYPES.find(t => t.toLowerCase() === s) || 'Gunite';
  }
  const PSEUDO_BY_CREW = { office: '@office', subcon: '@sub', unassigned: '@unassigned' };
  /* Both templates in the planner's phase/section/task shape. Phases are the integer part of
     SubPhaseNumber, named from PhaseName; sections in Sequence order; tasks hang off the
     SubPhase lookup. A type with no rows is left out, so a failed read never produces an
     empty template that lays a project out as nothing. */
  function templatesFrom(sptRows, tptRows, tradeRows) {
    const tradeCode = new Map((tradeRows || []).map(t => [key(t.fields.id), t.fields.TradeCode || null]));
    const tasksBySub = new Map();
    (tptRows || []).forEach(t => { const k = key(t.fields.SubPhaseLookupId); if (!tasksBySub.has(k)) tasksBySub.set(k, []); tasksBySub.get(k).push(t); });
    const out = {};
    (sptRows || []).slice().sort((a, b) => (a.fields.Sequence || 0) - (b.fields.Sequence || 0)).forEach(r => {
      const f = r.fields, type = normType(f.BuildType);
      const phases = out[type] = out[type] || [];
      const pnum = String(f.SubPhaseNumber || '').split('.')[0];
      let ph = phases.find(p => p.num === pnum);
      if (!ph) { ph = { num: pnum, name: f.PhaseName || '', sections: [] }; phases.push(ph); }
      const skill = f.TradeLookupId != null ? (tradeCode.get(key(f.TradeLookupId)) || null)
                  : (PSEUDO_BY_CREW[String(f.DefaultCrew || '').trim().toLowerCase()] || null);
      ph.sections.push({ num: f.SubPhaseNumber, name: f.Title, skill, days: Number(f.DurationDays) || 2,
        tasks: (tasksBySub.get(key(f.id)) || []).slice().sort((x, y) => (x.fields.Sequence || 0) - (y.fields.Sequence || 0)).map(t => t.fields.Title) });
    });
    return out;
  }
```

In `toPlannerPayload`: add `buildType: normType(jf.BuildType),` after `status`, and after `nonWork` add `templates: templatesFrom(graph.spt, graph.tpt, graph.trades),`. Export `normType` and `templatesFrom` in the return object.

- [ ] **Step 5: Implement in `sharepoint/export-to-planner.js`**

Extend the `Promise.all` with the three reads (same `$select` strings as `sharepoint/capture-template-lists.js`), add `BuildType` to the Jobs `$select`, and add to the payload: `buildType: normType(j.BuildType)` per job and `templates: templatesFrom(spt, tpt, trades)`, where the two helpers are copied into this file in REST shape (`r.Id`, `r.TradeId`, `r.SubPhaseId` instead of `fields.id`, `fields.TradeLookupId`, `fields.SubPhaseLookupId`). Keep the two copies textually parallel; `graph-read.js` proves they agree.

- [ ] **Step 6: Serve the lists in `run-export.js`**: add `/GetByTitle\('Sub-phase(%20| )Template'\)/.test(url) ? (live.spt || []) :`, the same for `Task(%20| )Template` → `live.tpt`, and `Trades` → `live.trades`.

- [ ] **Step 7: Run the harnesses**

Run: `node fixtures/planner/graph-read.js && node fixtures/planner/live-export.js && npm test`
Expected: all PASS.

- [ ] **Step 8: Mutations.** Add to `fixtures/planner/office-views.g2p-mutations.json` (or a new `graph-read.g2p-mutations.json` if that file is keyed to office-views):

```json
[
 { "label": "buildType never normalised", "find": "buildType: normType(jf.BuildType),", "replace": "buildType: jf.BuildType,"},
 { "label": "templates dropped from the payload", "find": "templates: templatesFrom(graph.spt, graph.tpt, graph.trades),", "replace": ""}
]
```

Run: `python fixtures/planner/mutate.py fixtures/planner/graph-read.js web/graph-to-planner.js --json <that file>`
Expected: every mutation red.

- [ ] **Step 9: Commit**

```bash
git add web/graph-to-planner.js sharepoint/export-to-planner.js fixtures/planner/run-export.js fixtures/planner/graph-read.js fixtures/planner/*.g2p-mutations.json
git commit -m "Both read paths carry each project's build type and both templates from SharePoint"
```

---

### Task 11: Planner create path, and the dropped PM

**Files:**
- Modify: `web/index.html:1801-1880` (`addJob`, `confirmNewPoolRequest`), `:1412-1430` (pending card), `:2465-2469` (`buildPendingCreates`)
- Modify: `web/writeback-core.js:220-228` (`planCreates` output)
- Modify: `web/graph-writeback.js:116-136` (`createBody`)
- Modify: `sharepoint/apply-planner-changes.js:310-320` (normalise), `:566-581` (REST body), `:614-620` (verify select and compare)
- Create: `fixtures/planner/build-type.js`, `fixtures/planner/build-type.mutations.json`
- Modify: `fixtures/planner/graph-write.js` (createBody), `fixtures/planner/writeback-core.js` (planCreates), `fixtures/planner/office-views.js:85-90` (stub serves `spt`, `tpt`, `trades`, `req` too)
- Modify: `package.json` (`npm test` gains `node fixtures/planner/build-type.js`)

**Interfaces:**
- `S.pendingCreates[i].buildType` (`'Gunite'`|`'Fiberglass'`).
- `buildPendingCreates()` returns `{jobno, name, addr, city, start, assignDefaultCrews, buildType, pmId, pmName}`.
- `planCreates` output gains `buildType` (normalised); `createBody` sends `BuildType`; the console applier sends and verifies `BuildType`.
- `templateFor(type)` does not exist yet (Task 12); this task reads counts with a local helper `tplCounts(type)` that returns `null` when `S.templates` lacks the type, and the copy falls back to "the sub-phases and tasks of that template".

- [ ] **Step 1: Write the failing harness** (`fixtures/planner/build-type.js`, hosted-mode boot copied from `office-views.js:54-100` with the stub extended to every key of `D2_GRAPH.lists` present in the fixture, plus `req`):

```javascript
// fixtures/planner/build-type.js   Run: node fixtures/planner/build-type.js
// Build type on + Job, through Save, into the New Pool Requests body; the chosen PM reaches the body too.
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const WEB = path.join(__dirname, '..', '..', 'web');
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-payloads-graph.json'), 'utf8'));
const HOST = 'https://mango-sky-0d6904310.5.azurestaticapps.net';
let fails = 0;
const ok = (l, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) { fails++; process.exitCode = 1; } };
const UIL = [{ id: '14', Title: 'Cody Campbell', Name: 'i:0#.f|membership|cody@d2pools.com', EMail: 'cody@d2pools.com' },
             { id: '16', Title: 'Don Borgeson', Name: 'i:0#.f|membership|don@d2pools.com', EMail: 'don@d2pools.com' }].map(f => ({ id: f.id, fields: f }));
const MSAL_STUB = `<script>window.msal={PublicClientApplication:class{constructor(){} getActiveAccount(){return {username:'cody@d2pools.com'};} setActiveAccount(){} getAllAccounts(){return [{username:'cody@d2pools.com'}];} acquireTokenSilent(){return Promise.resolve({accessToken:'t'});} loginPopup(){return Promise.resolve({accessToken:'t',account:{username:'cody@d2pools.com'}});}}};</script>`;
function boot() {
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL_STUB)
    .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
    .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
    .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
    .replace('</body>', `<script>window.__x=()=>{window.S=S;window.getUI=()=>UI;window.D2_GRAPH=D2_GRAPH;window.addJob=addJob;
      window.confirmNewPoolRequest=confirmNewPoolRequest;window.buildPendingCreates=buildPendingCreates;window.pushCreates=pushCreates;
      window.render=render;window.refreshLive=refreshLive;window.importFromD2Payload=importFromD2Payload;window.save=save;window.load=load;
      window.templateFor=typeof templateFor==='function'?templateFor:null;window.jobBadge=jobBadge;window.mkTemplate=mkTemplate;};</script><script>__x();</script></body>`);
  const errs = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const net = { posts: [] };
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, opts) => {
        u = String(u);
        const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
        if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
        if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: G.siteId, webUrl: G.site });
        if (u.includes('User Information List')) return json(200, { value: UIL });
        if (opts && opts.method === 'POST') { net.posts.push({ url: u, body: JSON.parse(opts.body) }); return json(201, { fields: { id: '900' } }); }
        const L = w.D2_GRAPH && w.D2_GRAPH.lists;
        if (L) for (const k of Object.keys(L)) if (u.includes('/lists/' + L[k] + '/items')) return json(200, { value: G[k] || [] });
        if (/\/lists\/[^/]+\/items/.test(u)) return json(200, { value: [] });
        return json(404, {});
      };
    } });
  const w = dom.window; const alerts = []; w.alert = m => alerts.push(String(m)); w.confirm = () => true;
  return { w, errs, net, alerts };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const { w, errs, net } = boot(); await wait(600);
  await w.refreshLive(true); await wait(300);
  // ---- + Job carries the type
  w.addJob();
  const radios = [...w.document.querySelectorAll('input[name=ncType]')];
  ok('+ Job offers Gunite and Fiberglass, Gunite preselected', radios.map(r => r.value).join() === 'Gunite,Fiberglass' && radios[0].checked);
  ok('the form copy no longer hard-codes 46 and 295', !/46 sub-phases|295 tasks/.test(w.document.getElementById('dBody').textContent));
  radios[1].checked = true; radios[1].dispatchEvent(new w.Event('change'));
  ok('the copy follows the choice', /Fiberglass/.test(w.document.getElementById('dBody').textContent));
  w.document.getElementById('ncJobNo').value = 'TEST-9950'; w.document.getElementById('ncName').value = 'Fibre Test';
  const pm = w.document.getElementById('ncPm'); if (pm) pm.value = '16';
  w.confirmNewPoolRequest();
  const pc = w.S.pendingCreates.find(c => c.jobno === 'TEST-9950');
  ok('the pending entry carries Fiberglass', pc && pc.buildType === 'Fiberglass');
  ok('the pending card shows the type', /Fiberglass/.test(w.document.getElementById('main').textContent));
  const built = w.buildPendingCreates().find(c => c.jobno === 'TEST-9950');
  ok('buildPendingCreates keeps buildType', built && built.buildType === 'Fiberglass');
  ok('buildPendingCreates keeps the chosen PM (fixed in passing)', built && built.pmId === '16' && built.pmName === 'Don Borgeson');
  // ---- through the core and the Graph body
  const C = require(path.join(WEB, 'writeback-core.js')), GW = require(path.join(WEB, 'graph-writeback.js'));
  const planned = C.planCreates([built, { jobno: 'TEST-9951', name: 'Old build', start: '2026-11-02' }], [], []).creates;
  ok('planCreates keeps Fiberglass and defaults a missing type to Gunite', planned[0].buildType === 'Fiberglass' && planned[1].buildType === 'Gunite');
  ok('planCreates normalises an unknown type to Gunite', C.planCreates([{ jobno: 'X', name: 'X', start: '2026-11-02', buildType: 'Carbon' }], [], []).creates[0].buildType === 'Gunite');
  ok('createBody sends BuildType', GW.createBody(planned[0], '16').BuildType === 'Fiberglass' && GW.createBody(planned[1], '16').BuildType === 'Gunite');
  await w.pushCreates(G.siteId, 't', w.buildPendingCreates());
  const post = net.posts.find(p => p.body && p.body.fields && p.body.fields.JobNumber === 'TEST-9950');
  ok('the New Pool Requests POST carries BuildType and the chosen PM', post && post.body.fields.BuildType === 'Fiberglass' && post.body.fields.ProjectManagerLookupId === '16');
  ok('no page errors', errs.length === 0, errs.join(' | '));
  process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node fixtures/planner/build-type.js`
Expected: FAIL from the first radio assertion onward.

- [ ] **Step 3: `addJob` and `confirmNewPoolRequest`** in `web/index.html`

Replace the hint paragraph and add the radio group:

```javascript
function tplCounts(type){
  const t=S.templates&&S.templates[type];
  if(!t)return null;
  const secs=t.reduce((n,g)=>n+g.sections.length,0), tasks=t.reduce((n,g)=>n+g.sections.reduce((m,s)=>m+s.tasks.length,0),0);
  return {secs,tasks};
}
function ncTypeCopy(type){
  const c=tplCounts(type);
  return c?`builds the ${c.secs} sub-phases and ${c.tasks} tasks of the ${esc(type)} template`:`builds the sub-phases and tasks of the ${esc(type)} template`;
}
function ncTypeChanged(){
  const t=(document.querySelector('input[name=ncType]:checked')||{}).value||'Gunite';
  const el=document.getElementById('ncTypeCopy'); if(el)el.innerHTML=ncTypeCopy(t);
  const c=tplCounts(t), u=document.getElementById('ncUnassignedCopy');
  if(u)u.textContent=c?`Unchecked leaves all ${c.secs} sub-phases`:'Unchecked leaves every sub-phase';
}
```

In `addJob()`, the hint becomes `This raises a row in SharePoint's <b>New Pool Requests</b> list. <b>D2 - New Pool</b> <span id="ncTypeCopy">${ncTypeCopy('Gunite')}</span>. The last measured run took ...` (rest unchanged). After the name field:

```html
    <div class="fld"><label>Build type</label>
      <label style="margin-right:14px"><input type="radio" name="ncType" value="Gunite" checked onchange="ncTypeChanged()"> Gunite</label>
      <label><input type="radio" name="ncType" value="Fiberglass" onchange="ncTypeChanged()"> Fiberglass</label></div>
```

The crews hint becomes:

```html
      <div class="hint" style="padding:4px 0 0">Checked pulls each sub-phase's default crew from the
      template (rule 1 is checked nightly by D2 - Crew Trade Check either way, never enforced at
      creation). <span id="ncUnassignedCopy">${tplCounts('Gunite')?'Unchecked leaves all '+tplCounts('Gunite').secs+' sub-phases':'Unchecked leaves every sub-phase'}</span> <span class="mono">unassigned</span> for a PM to
      allocate by hand.</div>
```

In `confirmNewPoolRequest()`: `const buildType=(document.querySelector('input[name=ncType]:checked')||{}).value==='Fiberglass'?'Fiberglass':'Gunite';` and add `buildType` to the pushed object.

- [ ] **Step 4: `buildPendingCreates`**

```javascript
function buildPendingCreates(){
  return (S.pendingCreates||[]).filter(c=>!c.requestedAt)
    .map(c=>({jobno:c.jobno,name:c.name,addr:c.addr||'',city:c.city||'',start:c.start,
      assignDefaultCrews:!!c.assignDefaultCrews,
      buildType:c.buildType==='Fiberglass'?'Fiberglass':'Gunite',
      // The PM picked on + Job. These two were dropped here until 2026-10-13, so Save always
      // sent the signed-in user whatever the form said.
      pmId:c.pmId==null||c.pmId===''?null:String(c.pmId), pmName:c.pmName||''}));
}
```

- [ ] **Step 5: Pending card**: add `<th style="width:90px">Type</th>` after Name and `<td class="small">${esc(c.buildType||'Gunite')}</td>` in the row.

- [ ] **Step 6: `planCreates`** in `writeback-core.js`: add `buildType: c.buildType === 'Fiberglass' ? 'Fiberglass' : 'Gunite',` to the `out.push` object with the comment `// Choice columns validate nothing on a REST write; normalise here.`

- [ ] **Step 7: `createBody`** in `graph-writeback.js`: add `BuildType: create.buildType === 'Fiberglass' ? 'Fiberglass' : 'Gunite',` after `AssignDefaultCrews`, with the comment `// Required Choice, default Gunite on the list; sent explicitly for the same reason AssignDefaultCrews is.`

- [ ] **Step 8: Console applier** `sharepoint/apply-planner-changes.js`: in the `createsByJobno.set` object add `buildType: c.buildType === 'Fiberglass' ? 'Fiberglass' : 'Gunite'`; in the REST body add `BuildType: c.buildType`; in the verify `$select` add `,BuildType` and to the mismatch test `|| r.BuildType !== c.buildType`.

- [ ] **Step 9: Harness updates.** `fixtures/planner/graph-write.js` next to the existing `createBody` test at line 99: `ok('createBody sends BuildType, Gunite when absent', b.BuildType === 'Gunite' && G.createBody({ jobno:'D2-1046', name:'X', start:'2026-10-05', buildType:'Fiberglass' }, '13').BuildType === 'Fiberglass');`. `fixtures/planner/writeback-core.js` next to the `planCreates` tests at line 160: an assertion that `buildType` survives and defaults. `fixtures/planner/office-views.js:87`: change `['jobs','asg','tasks','cal']` to `Object.keys(L)` so the stub serves every configured list from `G` (missing keys serve `[]`). `package.json`: append ` && node fixtures/planner/build-type.js` to the `test` script.

- [ ] **Step 10: Run**

Run: `node fixtures/planner/build-type.js && node fixtures/planner/graph-write.js && node fixtures/planner/writeback-core.js && node fixtures/planner/writeback.js && npm test`
Expected: all PASS. `writeback.js` exercises the console applier on a change-set; if it compares the REST body key set, add `BuildType` to its expectation.

- [ ] **Step 11: Mutations** `fixtures/planner/build-type.mutations.json`:

```json
[
 { "label": "buildType dropped in buildPendingCreates", "find": "      buildType:c.buildType==='Fiberglass'?'Fiberglass':'Gunite',\n", "replace": "" },
 { "label": "PM dropped again in buildPendingCreates", "find": "pmId:c.pmId==null||c.pmId===''?null:String(c.pmId), pmName:c.pmName||''", "replace": "pmId:null, pmName:''" },
 { "label": "confirm ignores the radio", "find": "value==='Fiberglass'?'Fiberglass':'Gunite';", "replace": "value==='Fiberglass'?'Gunite':'Gunite';" },
 { "label": "pending card hides the type", "find": "<td class=\"small\">${esc(c.buildType||'Gunite')}</td>", "replace": "<td class=\"small\"></td>" }
]
```

Run: `python fixtures/planner/mutate.py fixtures/planner/build-type.js web/index.html --json fixtures/planner/build-type.mutations.json`
Expected: every mutation red. Also run `mutate.py` for `writeback-core.js` and `graph-write.js` with their built-in lists; add `buildType` mutations there if the built-in list is in `mutate.py` (then edit `mutate.py`'s embedded list).

- [ ] **Step 12: Commit**

```bash
git add web/index.html web/writeback-core.js web/graph-writeback.js sharepoint/apply-planner-changes.js fixtures/planner/build-type.js fixtures/planner/build-type.mutations.json fixtures/planner/graph-write.js fixtures/planner/writeback-core.js fixtures/planner/office-views.js package.json
git commit -m "+ Job chooses Gunite or Fiberglass and the request carries it; the chosen PM now reaches Save"
```

---

### Task 12: Planner templates and layout

**Files:**
- Modify: `web/index.html:344-376` (`mkTemplate`, `mkJobGroups`, `newJob`), `:383-392` (`jobBadge`), `:393-396` (`load`), `:1511-1518` (Skill Coverage), `:2207-2290` (`importFromD2Payload`), `:3143-3162` (`D2_GRAPH.lists`)
- Modify: `fixtures/planner/build-type.js` (part 2), `fixtures/planner/build-type.mutations.json`, `fixtures/planner/empty.js:39`

**Interfaces:**
- `S.templates` (`{Gunite:[...], Fiberglass:[...]}`, planner shape with `id` on phases and sections), `S.templatesFrom` (ISO string). `S.template` no longer exists after `load()`.
- `templateFor(type)`: returns `S.templates[type]` when present; for `'Gunite'` with nothing loaded returns `mkTemplate()`; for any other type with nothing loaded returns `[]`.
- `newJob(name,addr,city,state,zip,start,buildType)`; `j.buildType` on every job.
- `tplFromPayload(phases)` assigns `id`s the way `mkTemplate` does.

- [ ] **Step 1: Append failing assertions** to `fixtures/planner/build-type.js` (a second block, new JSDOM):

```javascript
  // ---- templates from SharePoint, layout by type, chip, migration, fallback
  {
    const { w, alerts, errs } = boot(); await wait(600);
    ok('a never-refreshed browser has the built-in Gunite template and nothing else', w.templateFor('Gunite').length > 0 && w.templateFor('Fiberglass').length === 0 && !w.S.template);
    await w.refreshLive(true); await wait(300);
    ok('Refresh stores both templates and the time', w.S.templates && w.S.templates.Gunite && w.S.templates.Fiberglass && typeof w.S.templatesFrom === 'string');
    ok('live jobs carry buildType Gunite', w.S.jobs.length > 0 && w.S.jobs.every(j => j.buildType === 'Gunite'));
    // a Fiberglass project, laid out from the Fiberglass template
    const F = w.S.templates.Fiberglass;
    const fsecs = F.flatMap(p => p.sections);
    const fibJob = { id: 999, jobno: 'TEST-9901', name: 'Fibre', addr: '', city: '', start: '2026-11-02', status: 'Planned', buildType: 'Fiberglass', pm: '', pmId: null,
      sections: fsecs.map((s, i) => ({ id: 5000 + i, seq: i + 1, num: s.num, name: s.name, crewId: null, start: null, finish: null, days: 2, skip: false, locked: false, inst: false, pm: false, tasks: s.tasks.map((t, k) => ({ id: 9000 + i * 20 + k, seq: k + 1, title: t, done: false, na: false, note: '' })) })) };
    const base = w.D2GraphToPlanner.toPlannerPayload(Object.assign({}, G, { users: [] }));
    alerts.length = 0;
    w.importFromD2Payload(Object.assign({}, base, { jobs: base.jobs.concat([fibJob]) }), true);
    const fj = w.S.jobs.find(j => j.jobno === 'TEST-9901');
    ok('the Fiberglass project exists with its type', fj && fj.buildType === 'Fiberglass');
    ok('it is laid out from the Fiberglass template: 45 sub-phases including 2.3', fj && fj.groups.flatMap(g => g.sections).length === 45 && fj.groups.flatMap(g => g.sections).some(s => s.num === '2.3'));
    ok('no unmatched alert for it', !alerts.some(a => /matched nothing/.test(a)), alerts.join(' | '));
    ok('a Gunite job is still 46', w.S.jobs.find(j => j.buildType === 'Gunite').groups.flatMap(g => g.sections).length === 46);
    ok('jobBadge draws a Fiberglass chip only for Fiberglass', /Fiberglass/.test(w.jobBadge(fj)) && !/Fiberglass/.test(w.jobBadge(w.S.jobs.find(j => j.buildType === 'Gunite'))));
    w.document.querySelector('#tabs button[data-t="crews"]').click();
    ok('Skill Coverage lists sub-phases from both templates, labelled', /Gunite:.*Fiberglass:/s.test(w.document.getElementById('main').textContent));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  }
  {
    // an old REST export with no templates and a Fiberglass job: reported, not crashed, not laid out as Gunite
    const { w, alerts, errs } = boot(); await wait(600);
    const old = { kind: 'd2-sharepoint-export', exported: '2026-10-01', jobs: [{ jobno: 'TEST-9901', name: 'Fibre', start: '2026-11-02', status: 'Planned', buildType: 'Fiberglass', sections: [{ num: '2.3', name: 'Crane Set and Shell Placement', crewId: null, start: null, days: 2, tasks: [] }] }] };
    alerts.length = 0; let threw = null;
    try { w.importFromD2Payload(old, true); } catch (e) { threw = e; }
    ok('an export without templates does not throw', !threw, threw && threw.message);
    const fj = w.S.jobs.find(j => j.jobno === 'TEST-9901');
    ok('the Fiberglass job has no Gunite layout and its section is reported unmatched', fj && fj.groups.length === 0 && alerts.some(a => /matched nothing/.test(a)));
    ok('no page errors', errs.length === 0, errs.join(' | '));
  }
  {
    // migration of a stored per-browser template
    const { w } = boot(); await wait(600);
    const T = w.mkTemplate(); T[0].name = 'Edited locally';
    w.localStorage.setItem('poolsched.v6', JSON.stringify({ crews: [], template: T, jobs: [], settings: {}, pendingCreates: [], pendingComments: [] }));
    w.load();
    ok('a stored S.template becomes S.templates.Gunite and S.template is gone', w.S.templates && w.S.templates.Gunite && w.S.templates.Gunite[0].name === 'Edited locally' && !('template' in w.S));
  }
```

Add `window.D2GraphToPlanner=window.D2GraphToPlanner;` to the `__x` exports if the global is not already reachable (it is set by the inlined script; `w.D2GraphToPlanner` should work).

- [ ] **Step 2: Run to verify it fails.** Expected: `w.templateFor` is null (not defined yet).

- [ ] **Step 3: Implement**

```javascript
function templateFor(type){
  type=type==='Fiberglass'?'Fiberglass':'Gunite';
  const t=(S&&S.templates)||{};
  if(t[type])return t[type];
  return type==='Gunite'?mkTemplate():[];
}
/* Templates read from SharePoint arrive without ids; assign them the way mkTemplate does. */
function tplFromPayload(phases){
  return (phases||[]).map((p,i)=>({id:'g'+i,num:String(p.num),name:p.name||'',
    sections:(p.sections||[]).map((s,k)=>({id:'s'+i+'_'+k,num:s.num,name:s.name,skill:s.skill||null,days:s.days||2,tasks:(s.tasks||[]).slice()}))}));
}
```

`newJob(name,addr,city,state,zip,start,buildType)`: `buildType:buildType==='Fiberglass'?'Fiberglass':'Gunite', groups:mkJobGroups(templateFor(buildType))`.

`load()`: in the stored branch, after `S.pendingComments=...`: `if(S.template){S.templates=S.templates||{};if(!S.templates.Gunite)S.templates.Gunite=S.template;delete S.template;} S.templates=S.templates||{};`. In the fresh object replace `template:mkTemplate()` with `templates:{}`.

`importFromD2Payload`: right after the `kind` check: `if(d.templates&&typeof d.templates==='object'){const t={};Object.keys(d.templates).forEach(k=>{if(Array.isArray(d.templates[k])&&d.templates[k].length)t[k]=tplFromPayload(d.templates[k]);});if(Object.keys(t).length){S.templates=t;S.templatesFrom=new Date().toISOString();}}`. In the plan loop: `j=newJob(inj.name||'Pool',inj.addr||'',inj.city||'',inj.state||'',inj.zip||'',inj.start||todayStr(),inj.buildType);` and in the else branch `j.buildType=inj.buildType==='Fiberglass'?'Fiberglass':(j.buildType||'Gunite');`.

`jobBadge(j)`: first line `const bt=j.buildType==='Fiberglass'?'<span class="chip jb type" title="Built from the Fiberglass template">Fiberglass</span>':'';` and prefix `bt+` on every return value. Add `.chip.jb.type{background:#0B594B;color:#fff}` beside the other `.chip.jb` rules in the stylesheet.

Skill Coverage (line 1513): replace the `used` line with
```javascript
    const T=S.templates&&Object.keys(S.templates).length?S.templates:{Gunite:templateFor('Gunite')};
    const usedBy=Object.entries(T).map(([t,tpl])=>[t,tpl.flatMap(g=>g.sections.filter(x=>x.skill===s.id).map(x=>x.num))]).filter(([,a])=>a.length);
    const used=usedBy.map(([t,a])=>(Object.keys(T).length>1?esc(t)+': ':'')+a.join(', '));
```
and render `used.join(' · ')` where the cell printed `used.join(', ')`; the `used.length` emptiness test stays.

`D2_GRAPH.lists`: add `spt:'453e7cd5-f84a-4e2a-9372-73f26019e3f0', tpt:'61824add-8eaa-4b1b-aed7-a202204bf9f5', trades:'05038f7f-a6cb-4f57-b1a1-3ff9c7126ba5'` with the comment `// Templates and the Trades lookup, read whole on Refresh (2026-10-13); same GUIDs as capture-graph.js.` The existing `keys` loop in `loadFromD2ViaGraph` then reads them.

`fixtures/planner/empty.js:39`: `const subPhases = S && S.templates && S.templates.Gunite ? ... : (typeof templateFor === 'function' ? templateFor('Gunite') : []).reduce(...)`; simplest is to export `templateFor` in that harness's `__x` and count `templateFor('Gunite')`.

- [ ] **Step 4: Run**

Run: `node fixtures/planner/build-type.js && npm test && node fixtures/planner/roundtrip.js && node fixtures/planner/freshness.js && node fixtures/planner/honest-copy.js`
Expected: all PASS. `roundtrip.js` and `honest-copy.js` build payloads from `window.SEED_TEMPLATE`; they still work because a Gunite job with no templates loaded falls back to `mkTemplate()`.

- [ ] **Step 5: Mutations.** Append to `build-type.mutations.json`:

```json
 { "label": "newJob ignores the type", "find": "groups:mkJobGroups(templateFor(buildType))", "replace": "groups:mkJobGroups(templateFor('Gunite'))" },
 { "label": "import never stores templates", "find": "if(Object.keys(t).length){S.templates=t;S.templatesFrom=new Date().toISOString();}", "replace": "if(false){}" },
 { "label": "Fiberglass falls back to the Gunite template", "find": "return type==='Gunite'?mkTemplate():[];", "replace": "return mkTemplate();" },
 { "label": "chip never drawn", "find": "const bt=j.buildType==='Fiberglass'?", "replace": "const bt=false?" },
 { "label": "migration keeps S.template", "find": "delete S.template;}", "replace": "}" }
```

Run the sweep; every mutation red.

- [ ] **Step 6: Commit**

```bash
git add web/index.html fixtures/planner/build-type.js fixtures/planner/build-type.mutations.json fixtures/planner/empty.js
git commit -m "Planner reads both templates from SharePoint and lays each project out by its build type"
```

---

### Task 13: Phase Template tab, read-only with a switch

**Files:**
- Modify: `web/index.html:1520-1552` (`vPhases`), `:2141-2171` (remove the nine edit functions)
- Modify: `fixtures/planner/honest-copy.js:29,90-120` (drop the `applyTemplate` and `setAllDays` sections and their exports), `fixtures/planner/build-type.js` (part 3), `fixtures/planner/build-type.mutations.json`, `fixtures/planner/README.md` (table row)

**Interfaces:**
- `UI.tplType` (`'Gunite'`|`'Fiberglass'`), reset to Gunite when the chosen type has no template.
- Removed: `setGrp`, `setSec`, `moveSec`, `delSec`, `delGrp`, `addSection`, `addPhase`, `setAllDays`, `applyTemplate`. Grep `web/index.html` for each before deleting; the only callers are inside `vPhases`.

- [ ] **Step 1: Append failing assertions** (`build-type.js`, new JSDOM):

```javascript
  // ---- Phase Template tab: read-only, switch, hints
  {
    const { w, errs } = boot(); await wait(600);
    const phases = () => { w.document.querySelector('#tabs button[data-t="phases"]').click(); return w.document.getElementById('main'); };
    let m = phases();
    ok('before any Refresh the tab shows the built-in Gunite copy and says so', /Built-in copy of the Gunite template/.test(m.textContent) && m.querySelectorAll('tbody tr').length === 46 + 8);
    ok('the tab has no inputs, selects or edit buttons', m.querySelectorAll('input,select').length === 0 && !/Set all durations|Apply template|\+ Phase|\+ Sub/.test(m.textContent));
    for (const fn of ['setGrp','setSec','moveSec','delSec','delGrp','addSection','addPhase','setAllDays','applyTemplate']) ok(fn + ' is gone', typeof w[fn] === 'undefined' && !new RegExp('function ' + fn + '\\(').test(fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')));
    await w.refreshLive(true); await wait(300);
    m = phases();
    ok('after Refresh the hint says from SharePoint and when', /From SharePoint, as of/.test(m.textContent));
    const btn = [...m.querySelectorAll('button')].find(b => b.textContent.trim() === 'Fiberglass');
    ok('a Fiberglass switch exists', !!btn);
    btn.click(); m = w.document.getElementById('main');
    ok('switching shows the 45 Fiberglass sub-phases under 10 phases', m.querySelectorAll('tbody tr').length === 45 + 10 && /Crane Set and Shell Placement/.test(m.textContent));
    ok('the switch is remembered until reload', w.getUI().tplType === 'Fiberglass');
    ok('no page errors', errs.length === 0, errs.join(' | '));
  }
```

- [ ] **Step 2: Run to verify it fails.** Expected: inputs present, functions still defined.

- [ ] **Step 3: Rewrite `vPhases`**

```javascript
function vPhases(){
  const have=S.templates||{};
  const type=UI.tplType==='Fiberglass'&&have.Fiberglass?'Fiberglass':'Gunite';
  UI.tplType=type;
  const tpl=templateFor(type);
  const fromSp=!!have[type];
  const sw=['Gunite','Fiberglass'].map(t=>`<button class="btn sm${t===type?' p':''}" onclick="UI.tplType='${t}';render()"${t!=='Gunite'&&!have[t]?' disabled title="Press Refresh to load the Fiberglass template from SharePoint"':''}>${t}</button>`).join(' ');
  const secs=tpl.reduce((a,g)=>a+g.sections.length,0), tasks=tpl.reduce((a,g)=>a+g.sections.reduce((b,s)=>b+s.tasks.length,0),0);
  return `<div class="card"><h2>Build phases<span class="sp"></span>${sw}</h2>
  <table><thead><tr><th style="width:60px">#</th><th>Sub-phase</th><th style="width:180px">Required trade</th><th style="width:70px">Days</th><th style="width:60px">Tasks</th></tr></thead><tbody>
  ${tpl.map(g=>`
    <tr class="phrow"><td><b>${esc(g.num)}.0</b></td><td style="font-weight:650">${esc(g.name)}</td>
      <td colspan="2" class="small muted">parent phase, rolls up its sub-phases</td>
      <td class="small muted">${g.sections.reduce((a,s)=>a+s.tasks.length,0)}</td></tr>
    ${g.sections.map(s=>`<tr><td class="small muted" style="padding-left:20px">${esc(s.num)}</td><td>${esc(s.name)}</td>
      <td>${skillLabel(s.skill)}</td><td>${s.days}</td><td class="small muted">${s.tasks.length}</td></tr>`).join('')}`).join('')}
  </tbody></table>
  <div class="hint">${fromSp
    ?`From SharePoint, as of ${esc(freshStamp(S.templatesFrom))}: ${tpl.length} phases, ${secs} sub-phases, ${tasks} tasks. Every new ${esc(type)} project is built from this. Don and David change the templates in SharePoint; ask them for a permanent change.`
    :`Built-in copy of the Gunite template: ${tpl.length} phases, ${secs} sub-phases, ${tasks} tasks. Press Refresh to load both templates from SharePoint.`}</div></div>`;
}
```

Delete lines 2141 to 2171 (the nine functions). Check `freshStamp` accepts an ISO string (it is used on `c.requestedAt`, which is one).

- [ ] **Step 4: `honest-copy.js`**: remove the `applyTemplate` and `setAllDays` sections (lines ~90-120) and the two names from the `__x` export at line 29. Its header comment lists what it pins; drop the two entries and add one line: "The template tab no longer edits anything (2026-10-13), so the two rebuild dialogs are gone."

- [ ] **Step 5: Run**

Run: `node fixtures/planner/build-type.js && node fixtures/planner/honest-copy.js && npm test`
Expected: all PASS.

- [ ] **Step 6: Mutations.** Append:

```json
 { "label": "switch ignored", "find": "const type=UI.tplType==='Fiberglass'&&have.Fiberglass?'Fiberglass':'Gunite';", "replace": "const type='Gunite';" },
 { "label": "hint lies about the source", "find": "?`From SharePoint, as of", "replace": "?`Built-in copy of the Gunite template, as of" }
```

Run the sweep; all red. Add the README row: `| build-type.js | 2026-10-13. Gunite or Fiberglass on + Job and through Save (and the chosen PM reaching the body); both templates read from SharePoint; a project laid out by its type; the chip; an old export without templates; the migration of a stored per-browser template; the read-only Phase Template tab with its switch. Sweep with build-type.mutations.json. |`

- [ ] **Step 7: Commit**

```bash
git add web/index.html fixtures/planner/honest-copy.js fixtures/planner/build-type.js fixtures/planner/build-type.mutations.json fixtures/planner/README.md
git commit -m "Phase Template tab shows SharePoint's templates read-only, with a Gunite / Fiberglass switch"
```

---

### Task 14: LIVE 4 — suite, shakedown, deploy, wall checks

**Runs where:** orchestrator.

- [ ] **Step 1:** `npm test`, then every harness not in `npm test` (`freshness`, `workcalendar`, `schedulecheck`, `startdate`, `rules`, `writeback`, `graph-read`, `writeback-core`, `writeback-parity`, `graph-write`, `honest-copy`, `escaping`, `check-groups`, `signoff-push`, `build-type-scripts`), then every mutation sweep listed in `fixtures/planner/README.md` plus `build-type.mutations.json`. All green, all red respectively.
- [ ] **Step 2:** Shakedown: `cd web && python -m http.server 8787`, headless Chrome on 9222, `node tools/planner-shakedown.js`. Expected: every tab renders, `phases` included, no console errors.
- [ ] **Step 3:** Deploy per CLAUDE.md "THE PLANNER IS HOSTED": `az account set --subscription cbcbe68b-bbaa-4926-bd9a-d33f0a9bd312`, token from `az staticwebapp secrets list`, `npx -y @azure/static-web-apps-cli deploy ./web --deployment-token "$TOKEN" --env production`. Tag `deploy/2026-10-13` (or the day's date, with a letter if a second deploy).
- [ ] **Step 4:** Wall checks: `/`, `/index.html`, both scripts, `/robots.txt` and a nonsense path return 302 to `/.auth/login/aad`; `/.auth/login/github` returns 404.
- [ ] **Step 5:** Real browser, signed in: Refresh; Phase Template tab shows both templates with the switch; `TEST-9901` shows a Fiberglass chip and 45 sub-phases, no unmatched alert; `+ Job` shows the radio. Then delete `TEST-9901` through `Delete Pool Requests` and confirm Flow 3 is Started.

---

### Task 15: Docs

**Files:**
- Modify: `CLAUDE.md` (a dated section after "ONE STUCK REJECT…"; the deployed-state rows for Jobs, New Pool Requests, Sub-phase Template, Task Template; the New Pool flow row; the three "46 sub-phases" sentences at lines 233, 1167 and 1533 become "the sub-phases of the project's build type")
- Modify: `docs/pm-guide/README.md` or the Guide v9 list in CLAUDE.md: two items (choose Gunite or Fiberglass on `+ Job`; the Phase Template tab shows SharePoint's templates and edits nothing)
- The session log is written at close by the orchestrator, with the live read-back numbers from Tasks 6 to 8 and 14.

- [ ] **Step 1:** Write the CLAUDE.md section from the spec's sections 2 to 5 and the live numbers, in the file's existing voice (dated heading, what was found, what was built, how to verify). Include: the live Sequence scheme correction (1..n, not phase-hundreds), the `BuildType` trigger shape as observed in Task 7, the 14 Unassigned Fiberglass rows, the four renumbered Startup sub-phases, and that the template tab no longer edits.
- [ ] **Step 2:** Update the table rows and the three sentences. Grep for `46 sub-phases` and `295 tasks` in `CLAUDE.md` and `web/index.html`; what remains must be historical narrative, not a current claim.
- [ ] **Step 3: Commit** `git commit -m "CLAUDE.md: build types, the template lists by type, the read-only template tab"`.

---

## Self-review

- Spec coverage: section 2 → Task 1; section 3 columns, stamping, views, seed tooling → Tasks 2, 3, 4, 6, 8; section 4 → Tasks 5, 7; section 5.1 → Task 11; 5.2 → Tasks 10, 12; 5.3 → Task 13; 5.4 → Task 12; section 6 → Tasks 9 to 14; section 7 → Task 11; section 8 → Task 15. No gap found.
- Placeholders: none; every code step carries its code. Task 7 step 4 names a contingency (a bare-string trigger value) with the exact change to make.
- Names: `templateFor`, `tplFromPayload`, `tplCounts`, `ncTypeChanged`, `normType`, `templatesFrom`, `Compose_build_type`, `Condition_read_at_cap`, `Set_status_failed_cap`, `Terminate_cap`, `buildType`, `BuildType`, `PhaseName`, `S.templates`, `S.templatesFrom`, `UI.tplType` are used consistently across tasks.
- Review Focus lines 1 to 5 each name the task whose test pins them (5, 11; 12; 10; 5; 13).
