# New Pool Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a D2 project manager a way to create a complete pool (1 Job, 46 sub-phase Assignments, 295 Tasks) and to delete one, without hand entry and without Stratirus running a script.

**Architecture:** Four new SharePoint lists and two Power Automate flows. Two lists hold the fixed checklist as ordinary data (`Sub-phase Template`, `Task Template`). Two are request queues a PM writes to (`New Pool Requests`, `Delete Pool Requests`). The flows copy the template forward from a start date, skipping non-work days, and tear a pool down in child-first order. No planning logic, no constraint solving, no premium connectors.

**Tech Stack:** SharePoint Lists (REST, provisioned from an authenticated browser page via `chrome-devtools` MCP), Power Automate cloud flows (authored as JSON, created via FlowAgent MCP, published via Dataverse `PublishXml`), Python for seed generation.

**Spec:** `docs/superpowers/specs/2026-09-07-new-pool-deployment-design.md`

---

## How "testing" works in this repo, and why it is not pytest

**There is no test runner and no fixture corpus for this work.** `fixtures/` is scaffolded and empty, and the things being built here are tenant state and cloud flows, not importable code. Do not go looking for `pytest`; nothing in Phases A through D had unit tests either.

The project's actual verification discipline, which is stronger than it sounds and is written at the top of CLAUDE.md's known-bugs section, is:

> **Verify by opening the result, never by the status code.**

Every expensive hour in this build came from a write that returned 200, 201 or 204 and then rendered blank or did nothing. So each task below ends with a **read-back step** that asserts on data fetched from the live tenant, and the assertions are written out in full. A task is not done because a create returned 201. It is done because a subsequent read shows the expected values.

Two rules that follow, and they are not optional:

- **Read a payload's shape before writing an expression against it.** This project has lost a build cycle four separate times to guessing a field or join name (`Crews.Title` vs `CrewID`, `Assignments.Job.Value` vs `JobNumber`, `Crew` lookup-vs-text, and `AssignmentId` vs `Assignment` + `Assignment#Id`). Task 5 has an explicit step for this and later tasks depend on it.
- **Capture platform payloads, never hand-author them.** If a shape is not already proven in this repo, create the thing once in the UI and read back what the platform wrote.

---

## Global Constraints

Copied verbatim from CLAUDE.md and the spec. Every task's requirements implicitly include this section.

- **Site URL:** `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler`. REST from a browser page must use the **absolute** site URL. A leading-slash path resolves against the tenant root and 404s with a message naming the root, which reads like a permissions problem and is not.
- **Power Platform environment:** `D2 Automation`, env id `2710a01b-6cfa-e820-b338-2286f2649300`, org URL `https://org4ed2f722.crm.dynamics.com/`.
- **Tenant:** `f24d9b39-6a71-4f4e-a376-03b6f61c97e4`. Pin it: `az login --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4`. Without `--tenant`, `az` silently reuses a cached tenant, FlowAgent `doctor` reports all checks passing, and `D2 Automation` is simply invisible with no error anywhere.
- **Identity:** sign in as `stratirus@d2pools.com`, never `stalbot@stratirus.com`. Confirm with FlowAgent `whoami` that `tokenIdentity.tenantId` is `f24d9b39-…`, and for browser work with `GET <site>/_api/web/currentuser`.
- **No premium connectors and no Dataverse.** This rules out the Flow Management and Power Platform for Admins connectors, so a flow cannot start or stop another flow.
- **DateOnly columns are written as a bare `yyyy-MM-dd` string, never `...T00:00:00Z`.** The site is UTC-06:00 Central. An explicit midnight-UTC value is read back by the SharePoint connector as the previous day. Phase A seeding did this and silently inverted the work week.
- **`DurationDays` is WORK days, never the inclusive calendar span.** Only the **endpoints** must be work days. A span containing a Sunday is legitimate: a 2-work-day sub-phase starting Saturday runs Sat and Mon.
- **Join keys are codes, never display labels.** `Crew` holds a `Crews.CrewID` such as `devon`. `Crews.Title` carries a `+N` headcount suffix and has broken every join that used it.
- **Every new Assignment must set `Locked`, `NotApplicable`, `PMSignOff` and `DurationDays`.** They are Required. REST and connector creation bypass required-field validation but the list form does not, so a row created without them can never afterwards be edited in the UI.
- **Assignment `Title` convention:** `<JobNumber> · <SubPhaseNumber> <SubPhaseName>`, with U+00B7 middle dot, e.g. `D2-1002 · 2.2 Steel Installation and Forms`.
- **FlowAgent rejects `authentication` in action inputs** (rule `extra-authentication`) even though live exports contain it. Strip it before import; the service writes it back.
- **`az rest` on Windows silently drops characters outside cp1252.** Never rebuild a flow definition from an `az rest` capture. Read with FlowAgent `get_flow`; submit with `json.dumps(..., ensure_ascii=True)`.
- **Production tenant.** `D2-1001` / Harrison and Assignments 1-5 are off limits. Use `TEST-` job numbers for all verification, and clean them up.

---

## File structure

| File | Responsibility |
|---|---|
| `sharepoint/provision-pool-lists.js` | Create the four lists and their fields. Idempotent. Browser console / `evaluate_script`. |
| `tools/gen-template-seed.py` | Extract the 46 sub-phases and 295 tasks from the browser tool's `SEED_TEMPLATE`, resolve `DefaultCrew` from live `Crew-Trades`, emit `tools/template-seed.json`. Writes nothing to the tenant. |
| `sharepoint/seed-templates.js` | Apply `template-seed.json` to `Sub-phase Template` and `Task Template`. Idempotent, resumable. |
| `flows/definitions/new-pool.json` | `D2 - New Pool` definition. |
| `flows/definitions/delete-pool.json` | `D2 - Delete Pool` definition. |
| `sharepoint/build-home-page.js` | Modified: add launchpad links to the two request lists. |
| `CLAUDE.md` | Modified: record that pools now originate in SharePoint. |

Tasks 1 through 4 need Shane's browser signed in. **They are deliberately front-loaded and batched into as few browser sessions as possible**, because each one costs him an interruption. Tasks 5 onward need only `az` and FlowAgent, no browser.

---

### Task 1: Provision the four lists

**Files:**
- Create: `sharepoint/provision-pool-lists.js`

**Interfaces:**
- Produces: four lists named exactly `New Pool Requests`, `Sub-phase Template`, `Task Template`, `Delete Pool Requests`, with the fields below. Later tasks reference these internal names verbatim.

Field types follow `canvas-app/mirror-provision.js`, which is the authoritative live-schema capture. `df: 0` means DateOnly and getting it wrong is how the work week got inverted.

- [ ] **Step 1: Write the provisioning script**

Create `sharepoint/provision-pool-lists.js`:

```js
/* Provision the four lists behind New Pool deployment.
 *
 * Run in the browser console on
 * https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler
 * signed in as stratirus@d2pools.com, or via chrome-devtools evaluate_script.
 *
 * Idempotent: an existing list or field is left alone and reported as "kept".
 *
 * FIELD CREATES MUST BE SEQUENTIAL. Parallel creates on one list contend and
 * return 500 "requires a newer version" (schema lock). Item creates may be
 * parallel; field creates may not.
 *
 * DateOnly is df:0. A DateTime field created with the wrong format is how the
 * whole work week got inverted during Phase A.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };
  const g = async u => (await fetch(site + u, { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json();
  const post = async (u, body) => {
    const r = await fetch(site + u, { method: 'POST', credentials: 'include', headers: HD, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(u + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 300));
    return r.json();
  };

  const fieldXml = (f, targets) => {
    const base = `Name='${f.i}' DisplayName='${f.d || f.i}' Required='${f.r ? 'TRUE' : 'FALSE'}'`;
    switch (f.t) {
      case 'Text':     return `<Field Type='Text' ${base} MaxLength='255' />`;
      case 'Note':     return `<Field Type='Note' ${base} NumLines='6' RichText='FALSE' />`;
      case 'Number':   return `<Field Type='Number' ${base} />`;
      case 'Boolean':  return `<Field Type='Boolean' ${base}><Default>${f.def ? 1 : 0}</Default></Field>`;
      case 'DateTime': return `<Field Type='DateTime' ${base} Format='${f.df === 0 ? 'DateOnly' : 'DateTime'}' />`;
      case 'User':     return `<Field Type='User' ${base} UserSelectionMode='PeopleOnly' UserSelectionScope='0' />`;
      case 'Choice':   return `<Field Type='Choice' ${base} Format='Dropdown'><CHOICES>${
                          f.c.map(c => `<CHOICE>${c}</CHOICE>`).join('')}</CHOICES>${
                          f.def ? `<Default>${f.def}</Default>` : ''}</Field>`;
      case 'Lookup':   return `<Field Type='Lookup' ${base} List='{${targets[f.lt]}}' ShowField='${f.lf}' />`;
      default: throw new Error('unhandled field type ' + f.t);
    }
  };

  const LISTS = {
    'New Pool Requests': [
      { i: 'JobNumber',          t: 'Text',     r: true },
      { i: 'Address',            t: 'Text',     r: false },
      { i: 'City',               t: 'Text',     r: false },
      { i: 'StartDate',          t: 'DateTime', r: true, df: 0 },
      { i: 'ProjectManager',     d: 'Project Manager', t: 'User', r: false },
      { i: 'AssignDefaultCrews', d: 'Assign Default Crews', t: 'Boolean', r: true, def: 1 },
      { i: 'Status',             t: 'Choice',   r: true, c: ['Requested', 'Building', 'Done', 'Failed'], def: 'Requested' },
      { i: 'Result',             t: 'Note',     r: false }
    ],
    'Sub-phase Template': [
      { i: 'SubPhaseNumber', t: 'Text',   r: true },
      { i: 'Sequence',       t: 'Number', r: true },
      { i: 'Trade',          t: 'Lookup', r: false, lt: 'Trades', lf: 'Title' },
      { i: 'DefaultCrew',    t: 'Text',   r: false },
      { i: 'DurationDays',   t: 'Number', r: true }
    ],
    'Task Template': [
      { i: 'SubPhase', t: 'Lookup', r: true, lt: 'Sub-phase Template', lf: 'Title' },
      { i: 'Sequence', t: 'Number', r: true }
    ],
    'Delete Pool Requests': [
      { i: 'ConfirmJobNumber',  d: 'Confirm Job Number', t: 'Text', r: true },
      { i: 'Reason',            t: 'Note',    r: true },
      { i: 'OverrideSignedOff', d: 'Override Signed Off', t: 'Boolean', r: true, def: 0 },
      { i: 'Status',            t: 'Choice',  r: true, c: ['Requested', 'Deleting', 'Done', 'Refused'], def: 'Requested' },
      { i: 'Result',            t: 'Note',    r: false }
    ]
  };

  const out = { lists: {}, fields: {} };
  const targets = {};

  // Trades already exists; its GUID is needed for the Sub-phase Template lookup.
  targets['Trades'] = (await g("/_api/web/lists/GetByTitle('Trades')?$select=Id")).Id;

  // Sub-phase Template must exist before Task Template, which looks up to it.
  for (const title of ['New Pool Requests', 'Sub-phase Template', 'Task Template', 'Delete Pool Requests']) {
    let list;
    try {
      list = await g(`/_api/web/lists/GetByTitle('${title}')?$select=Id,ListItemEntityTypeFullName`);
      out.lists[title] = 'kept';
    } catch (e) { list = null; }
    if (!list || !list.Id) {
      await post('/_api/web/lists', {
        __metadata: { type: 'SP.List' }, BaseTemplate: 100, Title: title,
        Description: 'D2 Build Scheduler — New Pool deployment', ContentTypesEnabled: false
      });
      list = await g(`/_api/web/lists/GetByTitle('${title}')?$select=Id,ListItemEntityTypeFullName`);
      out.lists[title] = 'created';
    }
    targets[title] = list.Id;

    const existing = (await g(`/_api/web/lists/GetByTitle('${title}')/fields?$select=InternalName&$top=200`))
      .value.map(x => x.InternalName);
    out.fields[title] = [];
    for (const f of LISTS[title]) {            // SEQUENTIAL — do not parallelise
      if (existing.includes(f.i)) { out.fields[title].push(f.i + ':kept'); continue; }
      await post(`/_api/web/lists/GetByTitle('${title}')/fields/CreateFieldAsXml`,
        { parameters: { __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' },
                        SchemaXml: fieldXml(f, targets), Options: 8 } });
      out.fields[title].push(f.i + ':created');
    }
  }
  return out;
})();
```

- [ ] **Step 2: Run it and read back the result**

Attach `chrome-devtools`, `list_pages`, confirm identity, then `evaluate_script` the file contents.

```
GET <site>/_api/web/currentuser
```

Expected: `LoginName` is `i:0#.f|membership|stratirus@d2pools.com`. A 403 here means the browser session changed, not that permissions did. Re-check `list_pages`.

- [ ] **Step 3: Verify each list and field actually exists**

Do not trust the script's own return value. Read it back independently:

```js
(async () => {
  const site='https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const g=async u=>(await fetch(site+u,{headers:{Accept:'application/json;odata=nometadata'},credentials:'include'})).json();
  const want={'New Pool Requests':['JobNumber','Address','City','StartDate','ProjectManager','AssignDefaultCrews','Status','Result'],
    'Sub-phase Template':['SubPhaseNumber','Sequence','Trade','DefaultCrew','DurationDays'],
    'Task Template':['SubPhase','Sequence'],
    'Delete Pool Requests':['ConfirmJobNumber','Reason','OverrideSignedOff','Status','Result']};
  const out={};
  for(const [t,fs] of Object.entries(want)){
    const l=await g(`/_api/web/lists/GetByTitle('${t}')?$select=Id,ItemCount,ListItemEntityTypeFullName`);
    const have=(await g(`/_api/web/lists/GetByTitle('${t}')/fields?$select=InternalName,TypeAsString&$top=200`)).value;
    const map=Object.fromEntries(have.map(f=>[f.InternalName,f.TypeAsString]));
    out[t]={entityType:l.ListItemEntityTypeFullName,items:l.ItemCount,
            missing:fs.filter(f=>!(f in map)),types:Object.fromEntries(fs.filter(f=>f in map).map(f=>[f,map[f]]))};
  }
  return out;
})();
```

Expected for every list: `missing` is `[]`. Expected types: `StartDate` is `DateTime`, `Trade` and `SubPhase` are `Lookup`, `AssignDefaultCrews` and `OverrideSignedOff` are `Boolean`, `Status` is `Choice`.

**Record the four `entityType` strings.** Hyphenated and spaced list names get sanitised entity type names, so `Sub-phase Template` becomes something like `SP.Data.Sub_x002d_phase_x0020_TemplateListItem`. Do not hand-write these anywhere. Copy the exact strings returned here into Task 3.

- [ ] **Step 4: Confirm StartDate is DateOnly, not DateTime**

`TypeAsString` reports `DateTime` for both. Check the format explicitly:

```js
(async () => {
  const site='https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const g=async u=>(await fetch(site+u,{headers:{Accept:'application/json;odata=nometadata'},credentials:'include'})).json();
  const f=(await g("/_api/web/lists/GetByTitle('New Pool Requests')/fields?$filter=InternalName eq 'StartDate'")).value[0];
  return {InternalName:f.InternalName, DisplayFormat:f.DisplayFormat, SchemaXml:f.SchemaXml};
})();
```

Expected: `DisplayFormat` is `0`. If it is `1`, delete the field and recreate it, because a DateTime column will reintroduce the timezone bug this project already fixed once.

- [ ] **Step 5: Commit**

```bash
git add sharepoint/provision-pool-lists.js
git commit -m "SharePoint: provision the four New Pool deployment lists"
```

---

### Task 2: Generate the template seed data

**Files:**
- Create: `tools/gen-template-seed.py`
- Create (generated, committed): `tools/template-seed.json`

**Interfaces:**
- Consumes: `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html` (`SEED_TEMPLATE`, `SKILLS`), plus a live-state capture of `Crews` and `Crew-Trades`.
- Produces: `tools/template-seed.json` with shape `{"subphases":[{"num","name","skill","tradeCode","defaultCrew","days","seq","tasks":[str,...]}], "counts":{"subphases":46,"tasks":295}}`. Task 3 reads exactly this.

**Why crew qualifications come from the live tenant, not the HTML.** The browser tool's `SEED_CREWS` predates the subcontractor patch: it marks only `office`, `subcon` and `unassigned` as `unlimited`, whereas the live `Crews` list has seven Unlimited buckets including `stl`, `george`, `armondo` and `brothers`. Picking defaults from the HTML therefore treats three subcontractor buckets as capacity crews. Business rule 1 names `Crew-Trades` as the authority for which crew holds which trade, so use it.

- [ ] **Step 1: Capture live Crews and Crew-Trades**

In the browser (same session as Task 1):

```js
(async () => {
  const site='https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const g=async u=>(await fetch(site+u,{headers:{Accept:'application/json;odata=nometadata'},credentials:'include'})).json();
  const crews=(await g("/_api/web/lists/GetByTitle('Crews')/items?$select=Id,Title,CrewID,Unlimited,Active&$top=100")).value;
  const crewTrades=(await g("/_api/web/lists/GetByTitle('Crew-Trades')/items?$top=500")).value;
  const trades=(await g("/_api/web/lists/GetByTitle('Trades')/items?$select=Id,Title,TradeCode&$top=200")).value;
  // crewTrades is returned in FULL because the generator consumes it. The
  // sample is separate so the field names can be read at a glance.
  return {crews, crewTrades, crewTradesSample: crewTrades.slice(0,3), crewTradesCount: crewTrades.length, trades};
})();
```

**Read `crewTradesSample` before writing any expression against `ct`.** You need the real field names for the crew and trade references on that list. Do not assume `CrewID` and `TradeCode`; they may be lookups, in which case the payload spells them `Crew` + `Crew#Id`. Write the field names you actually see into the script in Step 2.

Then dump the full capture to `tools/live-crews.json` and commit it, so the generator is reproducible offline.

- [ ] **Step 2: Write the generator**

Create `tools/gen-template-seed.py`. Replace `CREW_FIELD` and `TRADE_FIELD` with the names observed in Step 1.

```python
"""Emit tools/template-seed.json: the 46 sub-phases and 295 tasks that every
pool is built from, with a default crew per sub-phase.

Writes NOTHING to the tenant. Apply with sharepoint/seed-templates.js.

Crew qualification comes from the LIVE Crew-Trades list, not from the browser
tool's SEED_CREWS. SEED_CREWS predates the subcontractor patch and marks only
office/subcon/unassigned as unlimited, so picking defaults from it treats stl,
george, armondo and brothers as capacity crews when the live list has them as
Unlimited buckets. Business rule 1 names Crew-Trades as the authority.
"""
import io, json, re, collections

TOOL = 'D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html'
LIVE = 'tools/live-crews.json'
OUT  = 'tools/template-seed.json'

CREW_FIELD  = 'CrewID'      # <-- set from the Step 1 capture
TRADE_FIELD = 'TradeCode'   # <-- set from the Step 1 capture

src = io.open(TOOL, encoding='utf-8', errors='replace').read()

def extract_array(marker):
    i = src.index(marker); j = src.index('[', i); d = 0
    for k in range(j, len(src)):
        if src[k] == '[': d += 1
        elif src[k] == ']':
            d -= 1
            if d == 0: return src[j:k + 1]
    raise ValueError(marker)

TPL = json.loads(extract_array('SEED_TEMPLATE'))
SECTIONS = [(s['num'], s['name'], s.get('skill'), s.get('days', 2), s.get('tasks', []))
            for ph in TPL for s in ph['sections']]

live = json.load(io.open(LIVE, encoding='utf-8'))
live = live.get('result', live)
crews = {c['CrewID']: c for c in live['crews'] if c.get('CrewID')}
TRADE_CODES = {t['TradeCode'] for t in live['trades'] if t.get('TradeCode')}
UNLIMITED = {k for k, c in crews.items() if c.get('Unlimited')}
# trade code -> set of crew codes that hold it
QUAL = collections.defaultdict(set)
for row in live['crewTrades']:
    QUAL[row[TRADE_FIELD]].add(row[CREW_FIELD])

# The three pseudo-skills are not trades. They name Unlimited buckets directly.
PSEUDO = {'@office': 'office', '@sub': 'subcon', '@unassigned': 'unassigned'}

load = collections.Counter()
subphases = []
for seq, (num, name, skill, days, tasks) in enumerate(SECTIONS, start=1):
    if skill in PSEUDO:
        crew, trade_code, cands = PSEUDO[skill], None, []
    else:
        trade_code = skill
        cands = sorted(QUAL.get(skill, ()))
        capacity = [c for c in cands if c not in UNLIMITED]
        pool = capacity or cands
        # Spread the pool across qualified capacity crews rather than loading
        # one. Deterministic: fewest sub-phases so far, then alphabetical.
        crew = min(pool, key=lambda c: (load[c], c)) if pool else 'unassigned'
        if crew != 'unassigned':
            load[crew] += 1
    subphases.append({'num': num, 'name': name, 'skill': skill, 'tradeCode': trade_code,
                      'defaultCrew': crew, 'days': max(1, days), 'seq': seq,
                      'candidates': cands, 'tasks': tasks})

errs = []
for s in subphases:
    if s['defaultCrew'] not in crews:
        errs.append('UNKNOWN CREW %s on %s' % (s['defaultCrew'], s['num']))
    if s['days'] < 1:
        errs.append('BAD DURATION on %s' % s['num'])
    # A tradeCode absent from the live Trades list leaves Trade null on every
    # assignment built from this row, silently. That is the exact class of
    # failure that has cost this project four build cycles, so refuse instead.
    if s['tradeCode'] and s['tradeCode'] not in TRADE_CODES:
        errs.append('UNKNOWN TRADE CODE %r on %s (not in Trades.TradeCode)' % (s['tradeCode'], s['num']))
if len({s['num'] for s in subphases}) != len(subphases):
    errs.append('DUPLICATE SUB-PHASE NUMBER')
if errs:
    print('REFUSING TO WRITE — %d problem(s):' % len(errs))
    for e in errs[:20]: print('   ', e)
    raise SystemExit(1)

out = {'subphases': subphases,
       'counts': {'subphases': len(subphases), 'tasks': sum(len(s['tasks']) for s in subphases)}}
io.open(OUT, 'w', encoding='utf-8').write(json.dumps(out, indent=2, ensure_ascii=False))

print('sub-phases : %d' % out['counts']['subphases'])
print('tasks      : %d' % out['counts']['tasks'])
print('crew load  : %s' % dict(load.most_common()))
print('unassigned : %d' % sum(1 for s in subphases if s['defaultCrew'] == 'unassigned'))
print('trades ok  : %d of %d sub-phases carry a resolvable trade code'
      % (sum(1 for s in subphases if s['tradeCode']), len(subphases)))
print('wrote %s' % OUT)
```

- [ ] **Step 3: Run it and check the counts**

```bash
python tools/gen-template-seed.py
```

Expected exactly:

```
sub-phases : 46
tasks      : 295
```

Those two numbers are the independent cross-check. They match the counts CLAUDE.md carries for the real template, and the same style of check caught two scheduling collisions during the Phase B seed. **If either number differs, stop.** Do not adjust the expected number to match the output.

- [ ] **Step 4: Sanity-check the default crew assignment by eye**

```bash
python -c "import json;d=json.load(open('tools/template-seed.json',encoding='utf-8'));[print('%-5s %-12s %-12s %d cand'%(s['num'],s['skill'],s['defaultCrew'],len(s['candidates']))) for s in d['subphases']]"
```

Expected: the 24 sub-phases whose skill starts with `@` map to `office`, `subcon` or `unassigned`. No capacity crew holds a wildly disproportionate share. Any sub-phase showing `unassigned` with a non-`@` skill is one of Don's 10 unmapped trades and is correct behaviour, not a bug: it surfaces the outstanding mapping decision instead of hiding it.

- [ ] **Step 5: Commit**

```bash
git add tools/gen-template-seed.py tools/template-seed.json tools/live-crews.json
git commit -m "Tools: generate the sub-phase and task template seed"
```

---

### Task 3: Seed the two template lists

**Files:**
- Create: `sharepoint/seed-templates.js`

**Interfaces:**
- Consumes: `tools/template-seed.json` uploaded to Site Assets, plus the entity type strings recorded in Task 1 Step 3.
- Produces: 46 rows in `Sub-phase Template`, 295 rows in `Task Template`.

- [ ] **Step 1: Upload the seed to Site Assets**

Drag `tools/template-seed.json` into `<site>/SiteAssets`. This mirrors how `write-pool.js` already reads its plan, and avoids pasting a large payload through a CDP call.

- [ ] **Step 2: Write the seeding script**

Create `sharepoint/seed-templates.js`. Replace the two `TYPE_` constants with the exact strings from Task 1 Step 3.

```js
/* Seed Sub-phase Template (46) and Task Template (295) from
 * SiteAssets/template-seed.json, produced by tools/gen-template-seed.py.
 *
 * Idempotent and resumable. Sub-phases match on SubPhaseNumber, tasks on
 * parent + Sequence. Re-run until it reports remaining: 0.
 *
 * A single CDP/console call is cut off around 45 seconds, so this works to a
 * time budget and returns progress rather than trying to finish in one call.
 *
 * ENTITY TYPE NAMES ARE NOT HAND-WRITTEN. Hyphenated and spaced list titles get
 * sanitised (Sub-phase Template -> SP.Data.Sub_x002d_phase_x0020_TemplateListItem).
 * The two constants below were read off the live list metadata.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const TYPE_SUB  = 'PASTE_FROM_TASK_1_STEP_3';   // Sub-phase Template
  const TYPE_TASK = 'PASTE_FROM_TASK_1_STEP_3';   // Task Template
  const CHUNK = 8, BUDGET_MS = 32000;

  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };
  const g = async u => (await fetch(site + u, { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json();
  const t0 = Date.now(), outOfTime = () => Date.now() - t0 > BUDGET_MS;
  const create = async (list, type, body) => {
    const r = await fetch(site + `/_api/web/lists/GetByTitle('${list}')/items`, {
      method: 'POST', credentials: 'include', headers: HD,
      body: JSON.stringify({ __metadata: { type }, ...body }) });
    if (!r.ok) return { ok: false, status: r.status, err: (await r.text()).slice(0, 200) };
    return { ok: true, item: (await r.json()).d };
  };

  const plan = await (await fetch(site + '/SiteAssets/template-seed.json', { credentials: 'include' })).json();
  const out = { subCreated: 0, taskCreated: 0, errors: [], remaining: 0 };

  // ---- sub-phases (sequential: tasks need their ids) ----------------------
  let have = (await g("/_api/web/lists/GetByTitle('Sub-phase Template')/items?$select=Id,SubPhaseNumber&$top=200")).value;
  const byNum = Object.fromEntries(have.map(r => [r.SubPhaseNumber, r.Id]));
  // Trades lookup: resolve by TradeCode, never by Title.
  const trades = (await g("/_api/web/lists/GetByTitle('Trades')/items?$select=Id,TradeCode&$top=200")).value;
  const tradeId = Object.fromEntries(trades.map(t => [t.TradeCode, t.Id]));

  for (const s of plan.subphases) {
    if (byNum[s.num]) continue;
    if (outOfTime()) { out.remaining = plan.subphases.filter(x => !byNum[x.num]).length; return out; }
    const body = { Title: s.name, SubPhaseNumber: s.num, Sequence: s.seq,
                   DefaultCrew: s.defaultCrew, DurationDays: s.days };
    if (s.tradeCode && tradeId[s.tradeCode]) body.TradeId = tradeId[s.tradeCode];
    const r = await create('Sub-phase Template', TYPE_SUB, body);
    if (!r.ok) { out.errors.push(s.num + ': ' + r.err); continue; }
    byNum[s.num] = r.item.Id; out.subCreated++;
  }

  // ---- tasks (parallel in chunks) ----------------------------------------
  const haveTasks = (await g("/_api/web/lists/GetByTitle('Task Template')/items?$select=Id,SubPhaseId,Sequence&$top=1000")).value;
  const seen = new Set(haveTasks.map(r => r.SubPhaseId + ':' + r.Sequence));
  const todo = [];
  for (const s of plan.subphases) {
    const pid = byNum[s.num]; if (!pid) continue;
    s.tasks.forEach((name, i) => {
      if (!seen.has(pid + ':' + (i + 1))) todo.push({ Title: name, SubPhaseId: pid, Sequence: i + 1 });
    });
  }
  for (let i = 0; i < todo.length; i += CHUNK) {
    if (outOfTime()) { out.remaining = todo.length - i; return out; }
    const rs = await Promise.all(todo.slice(i, i + CHUNK).map(b => create('Task Template', TYPE_TASK, b)));
    rs.forEach((r, k) => r.ok ? out.taskCreated++ : out.errors.push(todo[i + k].Title + ': ' + r.err));
  }
  return out;
})();
```

Note `TradeId` and `SubPhaseId`: that `…Id` spelling is the **REST** convention for writing a lookup, and it is correct here. It is *not* how the Power Automate connector spells a lookup in its **output**, which is `Trade` plus `Trade#Id`. Both are right in their own context, and confusing them cost this project a build cycle.

- [ ] **Step 3: Run until it reports remaining 0**

Re-run the script until `remaining` is `0` and `errors` is `[]`.

- [ ] **Step 4: Verify counts and integrity from a fresh read**

```js
(async () => {
  const site='https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const g=async u=>(await fetch(site+u,{headers:{Accept:'application/json;odata=nometadata'},credentials:'include'})).json();
  const subs=(await g("/_api/web/lists/GetByTitle('Sub-phase Template')/items?$select=Id,Title,SubPhaseNumber,Sequence,DefaultCrew,DurationDays,TradeId&$top=200")).value;
  const tasks=(await g("/_api/web/lists/GetByTitle('Task Template')/items?$select=Id,SubPhaseId,Sequence&$top=1000")).value;
  const byParent={}; tasks.forEach(t=>byParent[t.SubPhaseId]=(byParent[t.SubPhaseId]||0)+1);
  const crews=(await g("/_api/web/lists/GetByTitle('Crews')/items?$select=CrewID&$top=100")).value.map(c=>c.CrewID);
  return {
    subCount: subs.length, taskCount: tasks.length,
    orphanTasks: tasks.filter(t=>!subs.some(s=>s.Id===t.SubPhaseId)).length,
    subsWithNoTasks: subs.filter(s=>!byParent[s.Id]).map(s=>s.SubPhaseNumber),
    badCrew: subs.filter(s=>!crews.includes(s.DefaultCrew)).map(s=>s.SubPhaseNumber+':'+s.DefaultCrew),
    badDuration: subs.filter(s=>!(s.DurationDays>=1)).map(s=>s.SubPhaseNumber),
    seqGaps: subs.map(s=>s.Sequence).sort((a,b)=>a-b).filter((v,i)=>v!==i+1)
  };
})();
```

Expected exactly: `subCount` 46, `taskCount` 295, `orphanTasks` 0, `subsWithNoTasks` `[]`, `badCrew` `[]`, `badDuration` `[]`, `seqGaps` `[]`.

`badCrew` is the check that matters most. It asserts every `DefaultCrew` is a real `Crews.CrewID`, which is the exact class of bug (display label used as a join key) that has broken this project four times.

- [ ] **Step 5: Commit**

```bash
git add sharepoint/seed-templates.js
git commit -m "SharePoint: seed the sub-phase and task template lists"
```

---

### Task 4: Capture the connector payload shapes

**Files:**
- Create: `flows/testdata/connector-shapes.json`

**Interfaces:**
- Produces: the exact JSON keys the SharePoint connector returns for a `Sub-phase Template` row and a `Task Template` row. Tasks 5 and 6 write expressions against these and must not guess them.

This task exists on its own because guessing here is the single most expensive recurring mistake in this build, and a `Filter array` against a wrong key matches nothing **silently**: every group comes back empty, guards on "did we find rows" skip the work, and the run reports success. The first Counter Reconciliation run reported a confident `43 assignments checked, 282 tasks scanned, 0 repaired`, which looked like a clean bill of health and was a total mismatch.

- [ ] **Step 1: Build a throwaway capture flow**

Author a Recurrence-triggered flow with three `Get items` actions against `Sub-phase Template` (top 2), `Task Template` (top 2) and `Work Calendar` (top 2). Create it with FlowAgent `create_flow`, `state: "Stopped"`, then `PublishXml`, then `publish_flow`.

```bash
az login --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4
```

Confirm with FlowAgent `whoami` that `tokenIdentity.tenantId` is `f24d9b39-…`. If `list_environments` returns only "Tennetech LLC (default)", the tenant pin did not take.

- [ ] **Step 2: Run it and read the action outputs**

Use FlowAgent `run_flow`, then `get_run_actions` and fetch each `outputsLink`. Those links are SAS-signed and need no auth header.

- [ ] **Step 3: Record the real keys**

Save the raw output bodies to `flows/testdata/connector-shapes.json` and write down, from what you actually see:

- the key holding the Trade reference on a sub-phase row (expected to be `Trade` with a sibling `Trade#Id`, **not** `TradeId`)
- the key holding the SubPhase reference on a task row (expected `SubPhase` + `SubPhase#Id`)
- the key and format of `Work Calendar`'s date column

Expected shape, to be confirmed rather than assumed:

```json
"Trade":    {"@odata.type": "#Microsoft.Azure.Connectors.SharePoint.SPListExpandedReference", "Id": 7, "Value": "Steel / Rebar"},
"Trade#Id": 7
```

- [ ] **Step 4: Delete the throwaway flow**

FlowAgent `delete_flow`. Leaving it behind adds an unexplained flow to a client environment.

- [ ] **Step 5: Commit**

```bash
git add flows/testdata/connector-shapes.json
git commit -m "Flows: capture SharePoint connector output shapes for the template lists"
```

---

### Task 5: Build D2 - New Pool, part 1 — guards and the Job row

**Files:**
- Create: `flows/definitions/new-pool.json`

**Interfaces:**
- Consumes: the four lists from Task 1, the connector keys from Task 4.
- Produces: flow `D2 - New Pool`. Later tasks extend the same definition file.

Build the flow in three passes rather than one, because a 342-create flow that fails at action 40 tells you very little, and each pass here is independently observable.

- [ ] **Step 1: Author the definition**

Create `flows/definitions/new-pool.json` with:

- **Trigger:** SharePoint `When an item is created` on `New Pool Requests`.
- **`Set_status_building`:** `Send an HTTP request to SharePoint`, MERGE on the request item, body `{"Status":"Building"}`.
- **`Get_existing_job`:** `Get items` on `Jobs`, `$filter=JobNumber eq '<trigger JobNumber>'`, `$top 1`.
- **`Condition_duplicate`:** if `length(body('Get_existing_job')?['value'])` is greater than 0, MERGE `Status = Failed` and `Result = 'Refused: job number <n> already exists.'`, then `Terminate` with status `Succeeded`. A refusal is a correct outcome, not a flow failure, and marking it Failed makes the run history useless for spotting real breakage.
- **`Create_job`:** `Create item` on `Jobs` with `Title`, `JobNumber`, `Address`, `City`, `StartDate`, `Status = Planned`, `ProjectManager`.
- **`Set_status_done`:** MERGE `Status = Done`, `Result` naming the created job id.

Use MERGE via `Send an HTTP request to SharePoint` for every write-back, not `Update item`. `Update item` requires binding every required field on the target list; MERGE only touches fields named in the body. This is the established pattern in this repo and it is the difference between roughly 15 clicks and over 100.

Write `StartDate` as a bare `yyyy-MM-dd` string: `formatDateTime(triggerOutputs()?['body/StartDate'],'yyyy-MM-dd')`.

- [ ] **Step 2: Validate before creating**

FlowAgent `validate_flow`. Strip any `"authentication": "@parameters('$authentication')"` from action inputs first; `validate_flow` rejects it under rule `extra-authentication` even though live exports contain it.

- [ ] **Step 3: Create and publish**

FlowAgent `create_flow` with `state: "Stopped"` and full `connectionRefs`. It returns the Dataverse `workflowid`, which is what `PublishXml` needs.

```bash
az rest --method post \
  --url "https://org4ed2f722.crm.dynamics.com/api/data/v9.2/PublishXml" \
  --resource "https://org4ed2f722.crm.dynamics.com/" \
  --headers "Content-Type=application/json" \
  --body '{"ParameterXml":"<importexportxml><workflows><workflow>{WORKFLOWID}</workflow></workflows></importexportxml>"}'
```

Then FlowAgent `publish_flow` to start it. Running before `PublishXml` fails with `CannotRunUnpublishedSolutionFlow`, whose message about authenticating connections is misleading and does **not** mean you need the designer. After `PublishXml` the error changes to `WorkflowTriggerIsNotEnabled`, which proves the connection binding worked.

- [ ] **Step 4: Test the duplicate guard**

Add an item to `New Pool Requests` with `JobNumber` = `D2-1001` (the existing Harrison demo job), `Title` `Guard Test`, `StartDate` today.

Read back:

```js
(async () => {
  const site='https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const g=async u=>(await fetch(site+u,{headers:{Accept:'application/json;odata=nometadata'},credentials:'include'})).json();
  const reqs=(await g("/_api/web/lists/GetByTitle('New Pool Requests')/items?$select=Id,Title,JobNumber,Status,Result&$top=20")).value;
  const jobs=(await g("/_api/web/lists/GetByTitle('Jobs')/items?$select=Id,JobNumber&$top=100")).value;
  return {reqs, jobCount: jobs.length, jobNumbers: jobs.map(j=>j.JobNumber)};
})();
```

Expected: the request row shows `Status` `Failed` and a `Result` naming the duplicate. **`jobCount` is unchanged** from before the test. The run itself shows `Succeeded`.

- [ ] **Step 5: Test the happy path creates exactly one Job**

Add a request with `JobNumber` `TEST-9101`, `Title` `Plan Test Alpha`, `StartDate` the next Monday.

Expected: `Status` `Done`, and `Jobs` gains exactly one row with `JobNumber` `TEST-9101` and `Status` `Planned`. Confirm `StartDate` reads back as the date you entered, **not one day earlier**. That single check is the regression test for the bug that inverted the work week.

- [ ] **Step 6: Commit**

```bash
git add flows/definitions/new-pool.json
git commit -m "Flows: D2 - New Pool, guards and job creation"
```

---

### Task 6: Build D2 - New Pool, part 2 — the sub-phase loop

**Files:**
- Modify: `flows/definitions/new-pool.json`

**Interfaces:**
- Consumes: the flow from Task 5.
- Produces: 46 Assignment rows per pool with chained dates.

- [ ] **Step 1: Add the reads and the date state**

Before the loop:

- **`Get_subphase_template`:** `Get items` on `Sub-phase Template`, `$orderby=Sequence asc`, `$top 100`.
- **`Get_task_template`:** `Get items` on `Task Template`, `$top 500`.
- **`Get_work_calendar`:** `Get items` on `Work Calendar`, `$top 500`.
Initialise all five variables here, outside the loop, because Power Automate does not allow `Initialize variable` inside an `Apply to each`. Action name on the left, **variable name** on the right, and the variable name is what every expression below uses:

| Action | Variable | Type | Initial value |
|---|---|---|---|
| `Init_nonWork` | `nonWork` | Array | `Select` over `Get_work_calendar` projecting `formatDateTime(item()?['Date'],'yyyy-MM-dd')`. Use the date field name confirmed in Task 4. |
| `Init_cursor` | `cursor` | String | `formatDateTime(triggerOutputs()?['body/StartDate'],'yyyy-MM-dd')` |
| `Init_daysTaken` | `daysTaken` | Integer | `0` |
| `Init_spanStart` | `spanStart` | String | empty |
| `Init_spanFinish` | `spanFinish` | String | empty |

The SharePoint `Get items` operation **rejects `$select`** with `WorkflowOperationParametersExtraParameter`. Do not add one.

- [ ] **Step 2: Add the sequential sub-phase loop**

`Apply_to_each_subphase` over `body('Get_subphase_template')?['value']`. **Set concurrency to off (degree 1).** Each sub-phase starts after the previous finishes, so parallelism would corrupt every date.

Inside, before consuming days, advance the cursor to a work day, then take the span:

- **`Reset_span`:** `Set variable` `daysTaken` to `0`, `spanStart` to empty, `spanFinish` to empty. These are resets of the variables initialised in Step 1, not new declarations. Resetting at the top of each iteration is what makes the loop correct; forgetting it carries the previous sub-phase's span forward.
- **`Do_until_span_complete`**, condition `greaterOrEquals(variables('daysTaken'), int(items('Apply_to_each_subphase')?['DurationDays']))`, limit 90 iterations:
  - **`Condition_is_work_day`:** true when **both**
    - `not(equals(dayOfWeek(variables('cursor')), 0))` — `dayOfWeek` returns 0 for Sunday
    - `not(contains(variables('nonWork'), variables('cursor')))`
  - If true: increment `daysTaken`; if `daysTaken` equals 1 set `spanStart` to `cursor`; always set `spanFinish` to `cursor`.
  - Always: `Set cursor` to `formatDateTime(addDays(variables('cursor'), 1), 'yyyy-MM-dd')`.

This gives `DurationDays` **work days**, with both endpoints on work days, and a span that may legitimately contain a Sunday. A 2-day sub-phase starting Saturday correctly produces `spanStart` Saturday and `spanFinish` Monday.

- [ ] **Step 3: Create the Assignment**

`Create item` on `Assignments`:

| Field | Expression |
|---|---|
| `Title` | `concat(triggerOutputs()?['body/JobNumber'], ' · ', items('Apply_to_each_subphase')?['SubPhaseNumber'], ' ', items('Apply_to_each_subphase')?['Title'])` |
| `Job` (lookup id) | id of the row from `Create_job` |
| `SubPhaseNumber`, `SubPhaseName`, `Sequence` | from the template item |
| `Trade` (lookup id) | the `Trade#Id` key confirmed in Task 4 |
| `Crew` | `if(triggerOutputs()?['body/AssignDefaultCrews'], coalesce(items('Apply_to_each_subphase')?['DefaultCrew'],'unassigned'), 'unassigned')` |
| `ScheduledStart` | `variables('spanStart')` |
| `ScheduledFinish` | `variables('spanFinish')` |
| `DurationDays` | template `DurationDays` |
| `Locked`, `NotApplicable`, `PMSignOff`, `InstallerSignOff` | `false` |
| `TasksComplete` | `0` |
| `TasksTotal` | set in Task 7; use `0` for now |

All four of `Locked`, `NotApplicable`, `PMSignOff` and `DurationDays` are Required. Omitting any one produces a row that can never afterwards be edited in the list form. Five rows are already in that state in production and it is why hand-editing a date there is impossible.

Then **`Set_cursor_next`**: `formatDateTime(addDays(variables('spanFinish'), 1), 'yyyy-MM-dd')`, so the next sub-phase starts strictly after this one ends.

- [ ] **Step 4: Stop Flow 3 before testing, and restart after**

```
FlowAgent disable_flow  -> D2 - Event-Driven Reconciliation
```

46 Assignment inserts otherwise fire 46 reconciliation runs during a test you are going to repeat. Restart it before finishing the task, and note that in production the flow will fire 46 times per pool by design, which the spec covers.

- [ ] **Step 5: Test with crews off**

Add a request: `JobNumber` `TEST-9102`, `Title` `Plan Test Bravo`, `StartDate` next Monday, `AssignDefaultCrews` **No**.

```js
(async () => {
  const site='https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const g=async u=>(await fetch(site+u,{headers:{Accept:'application/json;odata=nometadata'},credentials:'include'})).json();
  const job=(await g("/_api/web/lists/GetByTitle('Jobs')/items?$filter=JobNumber eq 'TEST-9102'&$select=Id")).value[0];
  const a=(await g(`/_api/web/lists/GetByTitle('Assignments')/items?$filter=JobId eq ${job.Id}&$select=Id,Title,SubPhaseNumber,Sequence,Crew,ScheduledStart,ScheduledFinish,DurationDays,Locked,NotApplicable,PMSignOff&$top=100&$orderby=Sequence asc`)).value;
  // Parse as an explicit UTC date. new Date('2026-09-14T12:00:00') is parsed in
  // LOCAL time, so getUTCDay() can report the wrong day west of UTC. Build the
  // date from its parts instead.
  const dow=s=>{const[y,m,d]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1,d)).getUTCDay();};
  const wc=(await g("/_api/web/lists/GetByTitle('Work Calendar')/items?$select=Date&$top=500")).value
             .map(r=>String(r.Date).slice(0,10));
  return {
    count: a.length,
    sundayEndpoints: a.filter(r=>dow(String(r.ScheduledStart).slice(0,10))===0||dow(String(r.ScheduledFinish).slice(0,10))===0)
                      .map(r=>r.SubPhaseNumber),
    holidayEndpoints: a.filter(r=>wc.includes(String(r.ScheduledStart).slice(0,10))||wc.includes(String(r.ScheduledFinish).slice(0,10)))
                      .map(r=>r.SubPhaseNumber),
    outOfOrder: a.slice(1).filter((r,i)=>String(r.ScheduledStart).slice(0,10) <= String(a[i].ScheduledFinish).slice(0,10))
                 .map(r=>r.SubPhaseNumber),
    notUnassigned: a.filter(r=>r.Crew!=='unassigned').map(r=>r.SubPhaseNumber),
    nullRequired: a.filter(r=>r.Locked===null||r.NotApplicable===null||r.PMSignOff===null||!(r.DurationDays>=1))
                   .map(r=>r.SubPhaseNumber),
    firstThree: a.slice(0,3).map(r=>[r.Title,String(r.ScheduledStart).slice(0,10),String(r.ScheduledFinish).slice(0,10)])
  };
})();
```

Expected exactly: `count` 46, and `sundayEndpoints`, `holidayEndpoints`, `outOfOrder`, `notUnassigned`, `nullRequired` all `[]`.

Then check the dates through the **connector**, not only through REST, because the timezone bug this guards against is a connector-read bug. Use FlowAgent `get_run_actions` on the run and read a `Create item` output: `ScheduledStart` must come back as the intended day.

- [ ] **Step 6: Test a Sunday start date**

The spec requires that a start date on a Sunday is advanced to the next work day rather than rejected. The date walk should do this for free, because `Do_until_span_complete` only counts work days and always advances the cursor, but "should" is not "does".

Add a request: `JobNumber` `TEST-9104`, `Title` `Sunday Start Test`, `StartDate` any **Sunday**, `AssignDefaultCrews` No.

Expected: the flow succeeds, and sub-phase `0.0` has `ScheduledStart` on the **Monday** following that Sunday. Read it back rather than inferring it from a green run.

Delete `TEST-9104` afterwards, in Task 8 Step 6 along with the rest.

- [ ] **Step 7: Open one row in the list form and save an edit**

Navigate to the `Assignments` list, open any `TEST-9102` row, change nothing, and click Save. It must save without complaint. If it refuses, one of the four required fields was not set and Step 3 is wrong. This is the only check that exercises the form's validation, which is the validation REST bypasses.

- [ ] **Step 8: Commit**

```bash
git add flows/definitions/new-pool.json
git commit -m "Flows: D2 - New Pool, sub-phase loop with work-day date walk"
```

---

### Task 7: Build D2 - New Pool, part 3 — tasks, counters and the result email

**Files:**
- Modify: `flows/definitions/new-pool.json`

**Interfaces:**
- Produces: 295 Task rows per pool, correct `TasksTotal` on each Assignment, a result email.

- [ ] **Step 1: Filter this sub-phase's tasks**

Inside `Apply_to_each_subphase`, after `Create_assignment`:

**`Filter_tasks_for_subphase`** over `body('Get_task_template')?['value']`, where the task's SubPhase reference equals `items('Apply_to_each_subphase')?['ID']`.

**Use the key confirmed in Task 4**, which is expected to be `item()?['SubPhase']?['Id']`. It is **not** `item()?['SubPhaseId']`. That REST spelling matches nothing in connector output, silently, and produces empty groups with a successful-looking run. This exact mistake cost a build cycle on `AssignmentId`.

- [ ] **Step 2: Create the tasks**

`Apply_to_each_task` over the filter output. Concurrency may stay on the default here, because tasks within a sub-phase are independent.

`Create item` on `Tasks`: `Title` from the template item, `Assignment` lookup set to the id returned by `Create_assignment`, `Sequence` from the template, `Complete` `false`.

- [ ] **Step 3: Write TasksTotal onto the Assignment**

After the task loop, MERGE the Assignment with `{"TasksTotal": <length of the filtered array>, "TasksComplete": 0}` via `Send an HTTP request to SharePoint`.

Set it from `length(body('Filter_tasks_for_subphase'))` rather than counting created rows, so a partial failure shows up as a mismatch in Step 6 rather than being papered over.

- [ ] **Step 4: Finish and report**

- MERGE the request row: `Status` `Done`, `Result` = counts, e.g. `Created TEST-9103: 46 sub-phases, 295 tasks, 2026-09-14 to 2027-01-23`.
- `Send an email (V2)` to the request's `ProjectManager`, falling back to the item's `Author` email when `ProjectManager` is empty. Subject names the job number. Body carries the same counts and a link to the job's assignments view.

- [ ] **Step 5: Test the full pool**

Confirm Flow 3 is still stopped. Add a request: `JobNumber` `TEST-9103`, `Title` `Plan Test Charlie`, `StartDate` next Monday, `AssignDefaultCrews` **Yes**.

```js
(async () => {
  const site='https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const g=async u=>(await fetch(site+u,{headers:{Accept:'application/json;odata=nometadata'},credentials:'include'})).json();
  const job=(await g("/_api/web/lists/GetByTitle('Jobs')/items?$filter=JobNumber eq 'TEST-9103'&$select=Id")).value[0];
  const a=(await g(`/_api/web/lists/GetByTitle('Assignments')/items?$filter=JobId eq ${job.Id}&$select=Id,SubPhaseNumber,Crew,TasksTotal,TasksComplete&$top=100`)).value;
  let tasks=[]; for(let i=0;i<a.length;i+=25){
    const f=a.slice(i,i+25).map(r=>`AssignmentId eq ${r.Id}`).join(' or ');
    tasks=tasks.concat((await g(`/_api/web/lists/GetByTitle('Tasks')/items?$filter=${encodeURIComponent(f)}&$select=Id,AssignmentId,Complete&$top=1000`)).value);
  }
  const per={}; tasks.forEach(t=>per[t.AssignmentId]=(per[t.AssignmentId]||0)+1);
  const crews=(await g("/_api/web/lists/GetByTitle('Crews')/items?$select=CrewID&$top=100")).value.map(c=>c.CrewID);
  return {
    assignments: a.length, tasks: tasks.length,
    countMismatch: a.filter(r=>(per[r.Id]||0)!==r.TasksTotal).map(r=>[r.SubPhaseNumber,r.TasksTotal,per[r.Id]||0]),
    anyComplete: tasks.filter(t=>t.Complete).length,
    badCrew: a.filter(r=>!crews.includes(r.Crew)).map(r=>r.SubPhaseNumber+':'+r.Crew),
    allUnassigned: a.every(r=>r.Crew==='unassigned')
  };
})();
```

Expected exactly: `assignments` 46, `tasks` 295, `countMismatch` `[]`, `anyComplete` 0, `badCrew` `[]`, `allUnassigned` **false** (this run had crews on, so a false here proves the toggle works).

Note the `AssignmentId eq` filter is correct: that spelling is right for a server-side `$filter`, and wrong only in connector *output*. Both facts are true at once and this is where they get confused.

- [ ] **Step 6: Restart Flow 3**

FlowAgent **`publish_flow`** on `D2 - Event-Driven Reconciliation`, then confirm state is `Started` with `get_flow`. There is no `enable_flow` verb; `publish_flow` is enable/start only, which is exactly what is wanted here, and it does not republish the definition. Leaving it stopped silently disables double-book detection, which is business rule 2's only real-time safety net.

- [ ] **Step 7: Commit**

```bash
git add flows/definitions/new-pool.json
git commit -m "Flows: D2 - New Pool, task creation, counters and result email"
```

---

### Task 8: Build D2 - Delete Pool

**Files:**
- Create: `flows/definitions/delete-pool.json`

**Interfaces:**
- Consumes: `Delete Pool Requests` from Task 1.
- Produces: flow `D2 - Delete Pool`.

- [ ] **Step 1: Author the definition**

Trigger: `When an item is created` on `Delete Pool Requests`. Then, in order, and **every refusal terminates with `Succeeded`** so run history stays meaningful:

1. **`Set_status_deleting`** MERGE `Status = Deleting`.
2. **`Condition_confirm_matches`:** refuse unless `equals(trim(triggerOutputs()?['body/ConfirmJobNumber']), trim(triggerOutputs()?['body/Title']))`. `Result`: `Refused: confirmation did not match.`
3. **`Get_job`:** `Get items` on `Jobs`, `$filter=JobNumber eq '<Title>'`. Refuse if zero rows: `Refused: no job with that number.`
4. **`Get_assignments`:** `Get items` on `Assignments`, `$filter=JobId eq <id>`, `$top 200`.
5. **`Condition_signed_off`:** if any assignment has `InstallerSignOff` true **and** `OverrideSignedOff` is false, refuse with `Refused: <n> sub-phase(s) are signed off. Tick Override Signed Off to delete anyway.`
6. **Delete children first.** For each assignment, `Get items` on `Tasks` with `$filter=AssignmentId eq <id>`, delete each task, then delete the assignment. Then delete the Job. The reverse order orphans rows that then render with a broken lookup.
7. **`Set_status_done`** MERGE `Status = Done`, `Result` = exact counts removed.
8. **Email the record** to the requester and to the job's `ProjectManager`: job number, title, counts, and the `Reason` from the request.

- [ ] **Step 2: Validate, create, publish**

Same sequence as Task 5 Step 3: `validate_flow`, `create_flow` stopped, `PublishXml`, `publish_flow`.

- [ ] **Step 3: Test the confirmation guard**

Request: `Title` `TEST-9101`, `ConfirmJobNumber` `TEST-9999`, `Reason` `guard test`.

Expected: `Status` `Refused`, `Result` naming the mismatch, and `TEST-9101` still present in Jobs. Verify by reading Jobs, not by reading the request row.

- [ ] **Step 4: Test the signed-off guard**

Sign off one sub-phase on `TEST-9103` through the canvas app, or MERGE `InstallerSignOff` true on one of its assignments. Then request deletion with a correct confirmation and `OverrideSignedOff` **No**.

Expected: `Status` `Refused`, the count of signed-off sub-phases named in `Result`, and all 46 assignments still present.

- [ ] **Step 5: Test a real deletion**

Re-submit for `TEST-9103` with `OverrideSignedOff` **Yes**.

```js
(async () => {
  const site='https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const g=async u=>(await fetch(site+u,{headers:{Accept:'application/json;odata=nometadata'},credentials:'include'})).json();
  const jobs=(await g("/_api/web/lists/GetByTitle('Jobs')/items?$select=Id,JobNumber&$top=100")).value;
  const a=(await g("/_api/web/lists/GetByTitle('Assignments')/items?$select=Id,Title&$top=500")).value;
  const t=(await g("/_api/web/lists/GetByTitle('Tasks')/items?$select=Id,AssignmentId&$top=2000")).value;
  const ids=new Set(a.map(x=>x.Id));
  return {
    jobStillThere: jobs.filter(j=>j.JobNumber==='TEST-9103').length,
    assignmentsLeft: a.filter(x=>x.Title.startsWith('TEST-9103')).length,
    orphanTasks: t.filter(x=>!ids.has(x.AssignmentId)).length
  };
})();
```

Expected exactly: `jobStillThere` 0, `assignmentsLeft` 0, **`orphanTasks` 0**. The orphan check is the one that matters: it is the whole reason children are deleted before parents, and it is global rather than scoped to this job, so it also proves nothing else was orphaned.

- [ ] **Step 6: Clean up the remaining test data**

Delete `TEST-9101`, `TEST-9102` and `TEST-9104` through the flow itself, which doubles as a second run of the happy path. Then confirm no `TEST-91xx` rows remain in Jobs, Assignments or Tasks, and no orphan tasks anywhere. Note `TEST-9101` has a Job row but no assignments, which is a useful edge case for the delete flow in its own right.

- [ ] **Step 7: Commit**

```bash
git add flows/definitions/delete-pool.json
git commit -m "Flows: D2 - Delete Pool with confirmation and signed-off guards"
```

---

### Task 9: Surface it, export the flows, and update the docs

**Files:**
- Modify: `sharepoint/build-home-page.js`
- Create: `flows/exports/D2-New-Pool-<date>.json`, `flows/exports/D2-Delete-Pool-<date>.json`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add launchpad links**

Modify `sharepoint/build-home-page.js` to add two links to the indexed link set: **New Pool** pointing at `New Pool Requests`, and **Delete Pool** pointing at `Delete Pool Requests`.

Use a **Text web part** (controlType 4, plain HTML inline in `data-sp-rte`). Hero and Quick links web parts do **not** bind `serverProcessedContent` when a page is written via list-item MERGE: they store correctly, mount, and render as nothing. Also note the page editor takes a coauthoring lock that 423s every write, cleared with `POST /_api/sitepages/pages(<id>)/discardPage`.

Verify by **opening the page**, not by the status code.

- [ ] **Step 2: Export both flows**

Fetch from `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/2710a01b-6cfa-e820-b338-2286f2649300/flows` with a bearer token from `az account get-access-token --resource https://service.flow.microsoft.com/`, and write the files from a script that sets `encoding='utf-8'` itself.

**Do not pipe `az rest` to a file.** It silently drops characters outside cp1252, and the middle dot in the Assignment title convention is exactly the kind of character at risk. Take the token from `az`; do not take the response from it.

- [ ] **Step 3: Update CLAUDE.md**

Three edits, all of which correct statements that are otherwise now wrong:

1. In **Staging / integration contracts**, record that new pools originate in SharePoint. The browser tool remains the visual planner and the only Gantt, but it is no longer where a pool is born. Note this reduces what the never-built nightly sync would have to do, since the sync's original job was carrying new pools into Lists.
2. In **How to run it**, add flows 8 and 9 to the flow-status table with their ids and verified status.
3. In the **NEXT SESSION** section, strike task 2. Replace the "there is still no user-facing way to create a pool" paragraph with what now exists, and note that `add_pool.py` and `write-pool.js` remain as Stratirus bulk tooling rather than the user path.

Also update the deployed-state list table with the four new lists and their row counts.

- [ ] **Step 4: Commit**

```bash
git add sharepoint/build-home-page.js flows/exports/ CLAUDE.md
git commit -m "New Pool: surface on the launchpad, export flows, update CLAUDE.md"
```

---

## Open items deliberately left for after the first real pool

- **Flow 3's 46 runs per pool.** Accepted for now. If the alert volume is real, add a `SuppressReconcile` boolean set in the same `Create item` call and one clause in Flow 3's version-history gate. No extra write, so the objection that killed this idea before does not apply.
- **`DurationDays` are all the 2-day placeholder**, so a generated pool runs 92 work days. After this ships that is a list edit by D2 rather than a code change, which is an argument for shipping before the real durations are known.
- **10 unmapped trades** mean some sub-phases seed as `unassigned`. Correct behaviour, and it surfaces Don's outstanding decision.
