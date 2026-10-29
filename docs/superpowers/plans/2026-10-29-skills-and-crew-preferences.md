# Skills and Crew Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SharePoint holds every crew's skills and ratings; Don and David edit them on the planner's Crews tab; Auto-Schedule, the pickers, Schedule Check and the nightly Crew Trade Check all honour the same ratings.

**Architecture:** Two new Number columns (`Preference` on Crew-Trades and Crews) and one Text column (`Crews.Members`), backfilled to 3 so nothing changes on day one. The planner's Refresh reads Crews, Crew-Trades and Trades and replaces its per-browser copy; the Crews tab edits that copy and Save writes it back over Graph through the existing pure-core / Graph-shape split (`writeback-core.js` decides, `graph-writeback.js` sends). A new polling flow, `D2 - Crew Sync`, keeps the `Assignments.Crew` dropdown and validation formula in step with the Crews list as D2 Bot. Qualified now means "holds the trade above 0 and overall above 0" everywhere.

**Tech Stack:** SharePoint Lists (REST through `tools/sp-proxy.js` for provisioning, Graph from the planner), Power Automate (FlowAgent MCP, Dataverse `clientdata` PATCH + `PublishXml`), plain browser JavaScript in `web/`, jsdom harnesses in `fixtures/planner/`, Python for flow builders and tests.

**Spec:** `docs/specs/2026-10-29-skills-and-crew-preferences-design.md`

## Global Constraints

- The four rating words, verbatim and nowhere else spelled: `First choice` (3), `Second choice` (2), `Last resort` (1), `Never` (0). A null or absent rating reads as 3 in the planner, the mapper and the flow.
- Qualified for a trade = a Crew-Trades row exists, its rating is not 0, and the crew's overall rating is not 0. The three pseudo-trades (`@office`, `@sub`, `@unassigned`) keep their fixed bucket crews and take no ratings.
- Column names are exactly `Preference` (Crew-Trades), `Preference` (Crews) and `Members` (Crews). Nothing D2-specific in a column name or rule.
- Never write `SchemaXml` to the `Assignments.Crew` column (it wipes the validation formula). The sync flow MERGEs `Choices`, `ValidationFormula` and `ValidationMessage` with `__metadata.type` `SP.FieldChoice`.
- Every Graph join goes through `String()` on both sides. Every write body is compared against a captured shape, never assumed.
- Escape crew names and skill names at construction everywhere they are painted; both are shared SharePoint data now.
- No em dashes in any copy, comment or commit. Copy in Don's words. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and carry no other AI mention. Never `git add` the untracked `.claude/` folder.
- Live tenant writes run as `stratirus@d2pools.com` through `tools/sp-proxy.js` after the tenant assertion in CLAUDE.md ("TENANT ASSERTION FOR THIS PROJECT"). Flow publishes and the Static Web App deploy are run by Shane; the implementer prepares, verifies and hands over the command.
- Every new harness is registered in `package.json` `scripts.test`, has a mutation file, and every mutation is watched red with `fixtures/planner/mutate.py` before the task is called done. Sweeps run one at a time.
- Every harness uses the house pattern: `const ok = (label, cond, detail = '') => {...}` printing `PASS`/`FAIL`, `process.exit(fail)` non-zero on any failure, jsdom loading `web/index.html` with `runScripts: 'dangerously'`.

## Review Focus

Inputs the spec implies but no acceptance test above exercises; each gets a test in the task named.

1. A Crew-Trades row with no `Preference` (hand-added on the list) must count as held at 3 in the planner (Task 6) and in the nightly check (Task 14), never as excluded.
2. A `Members` value with blank entries and stray spaces (`"Devon, , Martin "`) must read as `['Devon','Martin']` (Task 6) and write back trimmed (Task 7).
3. A new skill whose name slugs to an existing code (`Dig/Excavation` against `dig`) or to nothing (`***`) must be refused with a sentence, never create a duplicate or an empty code (Task 7).
4. A Save where the Trades create lands and the Crews or Crew-Trades write then fails (a non-editor's 403, a 500) must report each op by name, skip only the ops that depended on the failed one, and leave the on-screen edits in place (Tasks 8 and 11).
5. A crew whose code is on the Crews list but not yet in the Assignments dropdown (created minutes ago, sync not yet run) must be greyed in every picker, excluded from Auto-Schedule, and refused locally by Save with the sentence from the spec, never sent to Graph (Tasks 9, 11, 12).

---

## Session 1: columns, backfill, gate, captures, the sync flow

### Task 1: Capture Crew-Trades and Crews into the Graph fixture

**Files:**
- Modify: `fixtures/planner/capture-graph.js:68-83` (the `LISTS` map and `MERGE_KEYS`)
- Modify: `fixtures/planner/capture-graph.html` (reads every key of `LISTS`; no change expected, confirm)
- Modify: `fixtures/planner/merge-capture.js` (folds `MERGE_KEYS` into the two fixtures)
- Data: `fixtures/planner/live-payloads-graph.json`, `fixtures/planner/live-payloads-graph-filtered.json`

**Interfaces:**
- Produces: fixture keys `ct` (Crew-Trades rows, `{id, fields:{id, Title, CrewLookupId, TradeLookupId, Preference?}}`) and `crews` (Crews rows, `{id, fields:{id, Title, CrewID, Size, Unlimited, Active, LeadEmail, Notes, Preference?, Members?}}`), both `$expand=fields`.

- [ ] **Step 1: Add the list and the merge keys**

In `capture-graph.js` add `ct: '32c6154d-2572-4dfd-877a-18fa20a3a07e',     // Crew-Trades` to `LISTS` after `crews`, and set `MERGE_KEYS = ['spt', 'tpt', 'trades', 'crews', 'ct']`. Confirm `capture-graph.html` iterates `Object.keys(LISTS)` and needs no edit.

- [ ] **Step 2: Capture live**

Run the capture the way 2026-10-28 did it (CLAUDE.md "THE BUILD PHASES TAB CHECKS THE TEMPLATES": the request-triggered proxy as D2 Bot, then `node fixtures/planner/merge-capture.js <capture.json>`). Run this task AFTER Task 2 has landed the columns, so the captured rows carry `Preference` and `Members`.

- [ ] **Step 3: Verify the fixture**

Run: `node -e "const d=require('./fixtures/planner/live-payloads-graph.json');console.log(d.ct.length,d.crews.length,d.ct[0].fields,d.crews[0].fields)"`
Expected: `51 14`, a `ct` row showing `CrewLookupId` and `TradeLookupId` as strings and `Preference` `3`, a `crews` row showing `Preference` `3` and `Members` on a field crew. Record the Crew-Trades `Title` convention you see; Task 8 needs it.

- [ ] **Step 4: Run the existing harnesses that read the fixture**

Run: `node fixtures/planner/graph-read.js && node fixtures/planner/template-check.js`
Expected: both PASS (the new keys are ignored by the current mapper).

- [ ] **Step 5: Commit**

```bash
git add fixtures/planner/capture-graph.js fixtures/planner/merge-capture.js fixtures/planner/live-payloads-graph.json fixtures/planner/live-payloads-graph-filtered.json
git commit -m "Graph fixture carries Crew-Trades and Crews rows"
```

### Task 2: Columns and backfill

**Files:**
- Create: `sharepoint/provision-preferences.js`
- Create: `sharepoint/stamp-preferences.js`
- Reference pattern: `sharepoint/provision-task-feature.js` (whole file), `sharepoint/stamp-structure.js:14-35`

**Interfaces:**
- Produces: `Crew-Trades.Preference` (Number, default 3), `Crews.Preference` (Number, default 3), `Crews.Members` (Text), all `Required='FALSE'`; every existing row stamped.

- [ ] **Step 1: Write `provision-preferences.js`**

Copy `provision-task-feature.js`'s shape (IIFE, `window.D2_DRY`, digest, `list()`, `post()`, sequential `CreateFieldAsXml` with skip-if-exists, returned `report`). Fields:

```js
const PREF = "<Field Type='Number' Name='Preference' DisplayName='Preference' Required='FALSE' Min='0' Max='3' Decimals='0'><Default>3</Default></Field>";
const MEMBERS = "<Field Type='Text' Name='Members' DisplayName='Members' Required='FALSE' MaxLength='255' />";
```

Create `PREF` on `Crew-Trades` and on `Crews`, `MEMBERS` on `Crews`. No form hiding (Don and David may edit these on the list). After the writes, read each list's `/fields?$select=InternalName,TypeAsString,DefaultValue` back and put the three fields in `report.readBack`; a missing one goes in `report.failures`.

- [ ] **Step 2: Write `stamp-preferences.js`**

Same transport as `stamp-structure.js` (`NM` reads with paging through `odata.nextLink`, MERGE with `IF-MATCH: *`, `inChunks` of 8). Write flag: `const WRITE = typeof window !== 'undefined' && window.D2_WRITE === true;` (dry by default; `tools/sp-proxy.js --write` sets it). Behaviour:
- Crew-Trades: every row with `Preference` null gets `{Preference: 3}`. Report duplicate `(CrewId, TradeId)` pairs in `report.duplicates` (expected `[]`).
- Crews: every row with `Preference` null gets `{Preference: 3}`; the seven field crews get `Members` from this constant, by `CrewID`, only when `Members` is blank:

```js
const ROSTER = { devon:'Devon, Martin, Ocoundo, Eric', guillermo:'Guillermo, Sergio R, Valentine', cirilo:'Cirilo, Yair, Marbin',
  saul:'Saul, Sergio E, Miguel', antonio:'Antonio, brother', campos:'Campos, ?, ?', harrison:'Harrison, Ian, ?' };
```
- Report `{ct:{total, stamped, alreadySet}, crews:{total, stamped, membersSet, alreadySet}, duplicates, errors}` and, after a write, read both lists back and fail the report if any `Preference` is still null.

- [ ] **Step 3: Dry run both under the proxy**

Create the proxy flow per CLAUDE.md "A REQUEST-TRIGGERED FLOW IS A GENERIC SHAREPOINT REST PROXY", assert the tenant, then:
Run: `D2_PROXY_URL='<url>' node tools/sp-proxy.js sharepoint/provision-preferences.js` and the same for `stamp-preferences.js`.
Expected: provision reports three fields to create; stamp reports 51 and 14 rows to stamp, 7 rosters, `duplicates: []`, nothing written.

- [ ] **Step 4: Write, then read back**

Run both again with `--write`. Then read back independently:
Run: a proxy GET of `Crew-Trades/items?$select=Id,Preference&$top=500` and `Crews/items?$select=CrewID,Preference,Members&$top=100`.
Expected: 51 rows at `3`; 14 rows at `3`; `Members` populated on the seven field crews, blank on the other seven. Delete the proxy flow at the end of the session, not now (Tasks 3 and 4 use it).

- [ ] **Step 5: Commit**

```bash
git add sharepoint/provision-preferences.js sharepoint/stamp-preferences.js
git commit -m "Preference columns on Crew-Trades and Crews, Members on Crews, backfilled to 3"
```

### Task 3: Gate Crews, Crew-Trades and Trades

**Files:**
- Modify: `sharepoint/gate-template-lists.js:36` (`LISTS`), header comment
- Modify: `tools/sp-proxy.js:48-49` (window flags)

- [ ] **Step 1: Make the list set overridable**

Change line 36 to `const LISTS = (typeof window !== 'undefined' && Array.isArray(window.D2_GATE_LISTS) && window.D2_GATE_LISTS.length) ? window.D2_GATE_LISTS : ['Sub-phase Template', 'Task Template'];`. In `sp-proxy.js` accept `--lists a,b,c` and set `window.D2_GATE_LISTS` to the split array. Add a header line to the gate script: "2026-10-29: also run with `--lists Crews,Crew-Trades,Trades` (spec 2026-10-29-skills-and-crew-preferences)."

- [ ] **Step 2: Dry run**

Run: `D2_PROXY_URL='<url>' node tools/sp-proxy.js sharepoint/gate-template-lists.js --lists Crews,Crew-Trades,Trades`
Expected: a plan per list: break inheritance, Members Edit removed, Don (16) and David (13) added at Edit; Owners keep Full Control; nothing written.

- [ ] **Step 3: Apply and verify**

Run the same with `--write`.
Expected `report.verify[list].ok === true` for all three: Don edit, David edit, Cody view and not edit, signed-in account manageLists. Run the dry form once more: it must plan nothing.

- [ ] **Step 4: Commit**

```bash
git add sharepoint/gate-template-lists.js tools/sp-proxy.js
git commit -m "Gate script takes a list set; Crews, Crew-Trades and Trades gated to Don and David"
```

### Task 4: Capture the Graph write shapes

**Files:**
- Create: `fixtures/planner/crew-capture.json`
- Reference: `fixtures/planner/structure-capture.json` (top-level keys `source, note, derivedFrom, storedShapes, input, requests, readBack`)

**Interfaces:**
- Produces: `requests[]` each `{op, method, url, body, response}` and `readBack` for: a Trades POST, a Crews POST, a Crew-Trades POST (lookups as strings), a Crew-Trades PATCH of `Preference`, a Crew-Trades DELETE, a Crews PATCH of `Members`, and a GET of `/lists/<asg>/columns` showing the `Crew` column's `choice.choices` and `validation.formula`.

- [ ] **Step 1: Capture from the hosted planner's console**

Signed in as `stratirus@d2pools.com` on `https://mango-sky-0d6904310.5.azurestaticapps.net`, obtain a token with `await graphToken()` and the site id with `(await graphSite(tok)).id`. Create a throwaway skill (`Title: 'ZZ Capture Skill'`, `TradeCode: 'zzcapture'`, `SortOrder: 999`), a throwaway crew (`Title: 'ZZ Capture +1'`, `CrewID: 'zzcapture'`, `Size: 2`, `Unlimited: false`, `Active: true`, `Members: 'A, B'`, `Preference: 3`), a Crew-Trades row joining them with `Preference: 2` (the `Title` per the convention from Task 1 step 3), PATCH it to `1`, read each row back with `$expand=fields`, GET the Assignments `columns`, then DELETE the Crew-Trades row and the two parent rows. Record every request and response in the JSON. Do NOT create any Assignments row; the throwaway crew must never reach the dropdown (the sync flow does not exist yet, so it cannot).

- [ ] **Step 2: Verify the capture**

Run: `node -e "const c=require('./fixtures/planner/crew-capture.json');console.log(c.requests.map(r=>r.op+' '+r.method+' '+r.response.status).join('\n'));console.log(c.readBack.ct.fields)"`
Expected: 201 for the three POSTs, 200 for the PATCHes and GET, 204 for the DELETEs; the Crew-Trades read-back shows `CrewLookupId` and `TradeLookupId` as strings and `Preference` `1`.

- [ ] **Step 3: Commit**

```bash
git add fixtures/planner/crew-capture.json
git commit -m "Captured Graph write shapes for Trades, Crews and Crew-Trades"
```

### Task 5: `D2 - Crew Sync`

**Files:**
- Create: `flows/scripts/crew_sync.py` (`build() -> dict` returning `{definition, connectionReferences}`)
- Create: `flows/scripts/test_crew_sync.py`
- Create: `flows/exports/D2-Crew-Sync-<yyyy-mm-dd>.json` (after creation, via `flows/scripts/export-flows.py "Crew Sync"`)
- Reference: `flows/exports/D2-Crew-Trade-Check-2026-10-01.json` (SharePoint `GetItems` and `HttpRequest` shapes, `connectionReferences`), `flows/exports/D2-Daily-Dispatch-Reminders-2026-09-25.json` (the Office 365 Outlook `SendEmailV2` shape and its connection reference), `sharepoint/guard-crew-values.js:60-64` (formula and message text)

**Interfaces:**
- Produces: a flow named `D2 - Crew Sync`, trigger SharePoint `GetOnUpdatedItems` on list `45e9ff1f-bf36-4ab5-929d-25ab9a80d460`; on each run rebuilds the `Assignments.Crew` choices and validation from every Crews row.

- [ ] **Step 1: Prove the MERGE shape on a throwaway list**

Through the proxy: create a throwaway list, add a Choice column with two choices and a validation formula, MERGE the field with body
```json
{"__metadata":{"type":"SP.FieldChoice"},"Choices":{"__metadata":{"type":"Collection(Edm.String)"},"results":["a","b","c"]},"ValidationFormula":"=OR(ISBLANK([X]),[X]=\"a\",[X]=\"b\",[X]=\"c\")","ValidationMessage":"m"}
```
with `Content-Type: application/json;odata=verbose`, `X-HTTP-Method: MERGE`, `If-Match: *`. Read the field back.
Expected: 204, and the read-back shows three choices AND the formula intact. Delete the list. Record the exact body that worked in the builder's docstring.

- [ ] **Step 2: Write the failing structural test**

`test_crew_sync.py`, run with `py -3 flows/scripts/test_crew_sync.py`:

```python
d = crew_sync.build()['definition']
trig = d['triggers']['When_a_crew_is_added_or_changed']
assert trig['inputs']['parameters']['table'] == '45e9ff1f-bf36-4ab5-929d-25ab9a80d460'
assert trig['inputs']['host']['operationId'] == 'GetOnUpdatedItems'
a = d['actions']
for k in ['Get_crews','Select_codes','Get_crew_field','Guard_codes','Merge_crew_field','Get_crew_field_after','Guard_written']:
    assert k in a, k
assert a['Get_crews']['inputs']['parameters']['$top'] == 500 and '$filter' not in a['Get_crews']['inputs']['parameters']
body = a['Merge_crew_field']['inputs']['parameters']['parameters/body']
assert '"type":"SP.FieldChoice"' in body and 'Collection(Edm.String)' in body and 'ValidationFormula' in body and 'ValidationMessage' in body
assert 'SchemaXml' not in json.dumps(d)
assert a['Merge_crew_field']['inputs']['parameters']['parameters/headers']['X-HTTP-Method'] == 'MERGE'
# guards end the run Failed with no write
assert a['Guard_codes']['type'] == 'If' and 'Terminate_bad_codes' in a['Guard_codes']['actions']
assert a['Merge_crew_field']['runAfter'] == {'Guard_codes': ['Succeeded']}
assert 'Send_failure_email' in json.dumps(d) and 'stratirus@d2pools.com' in json.dumps(d)
# no Terminate inside a loop
```
Also assert `json.dumps(crew_sync.build(), ensure_ascii=True)` round-trips and that `connectionReferences` carries `shared_sharepointonline` and `shared_office365` copied from the two exports named above.

- [ ] **Step 3: Run the test, expect failure**

Run: `py -3 flows/scripts/test_crew_sync.py`
Expected: `ModuleNotFoundError` or `KeyError` (builder absent).

- [ ] **Step 4: Write the builder**

`build()` returns the definition with these actions, top level, in `runAfter` order: `Get_crews` (GetItems, `$top` 500, no filter: retired crews stay in the dropdown); `Select_codes` (`@trim(item()?['CrewID'])`); `Filter_bad_codes` (Query over `Select_codes`: `or(equals(item(),''), not(equals(item(), toLower(item()))), contains(item(),' '), contains(item(),'"'))`); `Get_crew_field` (HttpRequest GET `_api/web/lists/GetByTitle('Assignments')/fields/getbyinternalnameortitle('Crew')?$select=Choices,ValidationFormula`, `Accept: application/json;odata=nometadata`); `Guard_codes` (If: `or(greater(length(body('Filter_bad_codes')),0), less(length(body('Select_codes')),1), less(length(body('Select_codes')), length(body('Get_crew_field')?['Choices'])))` → `Send_failure_email` to `stratirus@d2pools.com`, subject `D2 Crew Sync stopped: crew codes not written`, then `Terminate_bad_codes` Failed `BadCrewCodes`); `Compose_formula` (`concat('=OR(ISBLANK([Crew]),', join(<select of concat('[Crew]="',item(),'"')>, ','), ')')`); `Compose_message` (the text of `guard-crew-values.js:61-64` with the codes joined by `, `); `Merge_crew_field` (HttpRequest POST to the same field URI, headers as Step 1, body the Step 1 shape with `results` = `body('Select_codes')` serialised with `string()`); `Get_crew_field_after` (same GET); `Guard_written` (If: any code of `Select_codes` missing from `Choices` or from `ValidationFormula` → `Send_failure_email_2`, `Terminate_not_written` Failed `CrewFieldNotWritten`). Email bodies name the codes read and the count of choices. Use `string(setProperty(json(...)))` or a literal template with `@{...}` for the body, whichever the Step 1 capture shows works; never `SchemaXml`.

- [ ] **Step 5: Run the test, expect pass**

Run: `py -3 flows/scripts/test_crew_sync.py`
Expected: exit 0.

- [ ] **Step 6: Create, publish and verify live**

Assert the tenant (`az` and FlowAgent `whoami`, environment `D2 Automation`). FlowAgent `create_flow` with `state: "Stopped"`, the definition and `connectionRefs` split per `flows/README.md`; Dataverse `PublishXml` against the returned `workflowid` (`az rest ... --body @C:/...` with the tenant pin in the same command); FlowAgent `publish_flow`. Then through the proxy create a throwaway Crews row (`CrewID: 'zzsync'`, `Title: 'ZZ Sync'`, `Active: true`, `Preference: 3`). Wait for the run (FlowAgent `get_run_history`, remembering it can lag; the field read is the authority).
Expected: within a few minutes the Assignments `Crew` field reads `zzsync` in `Choices` AND in `ValidationFormula`, `ValidationMessage` present, choice count 15. Then delete the throwaway row, edit `Notes` on any other Crews row, wait, and read the field again: `zzsync` gone, 14 choices, formula intact. Finally set `Notes` back.

- [ ] **Step 7: Export, add to the solution, commit**

Run: `py -3 flows/scripts/export-flows.py "Crew Sync"`. Add the flow to the `D2BuildSchedulerFlows` solution and export it the way `docs/restore-runbook.md` describes. Delete the proxy flow (CLAUDE.md: it is an unauthenticated SAS endpoint while it exists).

```bash
git add flows/scripts/crew_sync.py flows/scripts/test_crew_sync.py flows/exports/D2-Crew-Sync-*.json flows/solution/
git commit -m "D2 - Crew Sync keeps the Assignments crew dropdown and formula in step with Crews"
```

---

## Session 2: mapper, core, Graph write, the Crews tab editor, Save

### Task 6: Mapper: crew rows, trade rows, assignable codes

**Files:**
- Modify: `web/graph-to-planner.js` (header comment lines 14-16; new functions beside `crewCodesFrom` at 178; `toPlannerPayload` return object at 263-271; module `return` at 404)
- Modify: `fixtures/planner/graph-read.js`
- Create: `fixtures/planner/graph-read.crews-mutations.json`

**Interfaces:**
- Produces, on the payload: `crewRows` (array or `null`), `tradeRows` (array), `assignableCodes` (array or `null`).
  - `crewRowsFrom(crewRows, ctRows, tradeRows)` → `[{spId:String, id:String(CrewID).trim(), name:Title, size:Number|null, unlimited:bool, active:bool, members:[String], note:String, overall:0..3, ratings:{<tradeCode>:0..3}, ctIds:{<tradeCode>:String}}]`, sorted as the list returns them; returns `null` when `crewRows` is empty or not an array (the empty-join guard), and `console.warn`s a Crew-Trades row whose crew or trade does not resolve, or a duplicate `(crew, trade)` pair (lower rating kept).
  - `tradeRowsFrom(tradeRows)` → `[{spId:String, code:TradeCode, label:Title, sort:Number|null}]` sorted by `sort` then `label`.
  - `normRating(v)` → `3` for `null`/`undefined`/`''`/non-numeric, else `Math.min(3, Math.max(0, Math.round(Number(v))))`.
  - `assignableCodesFrom(columns)` → the `choice.choices` array of the column whose `name === 'Crew'`, or `null` when `columns` is not an array or has no such column.

- [ ] **Step 1: Write the failing assertions in `graph-read.js`**

Append, using the fixture from Task 1 (`G.ct`, `G.crews`) and a hand-built columns array:

```js
const rows = M.crewRowsFrom(G.crews, G.ct, G.trades);
ok('14 crew rows from the fixture', rows && rows.length === 14);
const h = rows.find(c => c.id === 'harrison');
ok('harrison holds plumbing at 3 with a Crew-Trades row id', h.ratings.plumbing === 3 && /^\d+$/.test(h.ctIds.plumbing));
ok('harrison overall is 3', h.overall === 3);
ok('members split and trimmed', JSON.stringify(h.members) === JSON.stringify(['Harrison','Ian','?']));
ok('a null Preference reads as 3', M.normRating(null) === 3 && M.normRating(undefined) === 3 && M.normRating('') === 3);
ok('ratings clamp to 0..3 integers', M.normRating(7) === 3 && M.normRating(-1) === 0 && M.normRating('2') === 2);
ok('a hand-added ct row with no Preference reads as held at 3',
   M.crewRowsFrom(G.crews, G.ct.concat([{id:'9999',fields:{id:'9999',CrewLookupId:String(h.spId),TradeLookupId:G.trades.find(t=>t.fields.TradeCode==='tile').fields.id}}]), G.trades).find(c=>c.id==='harrison').ratings.tile === 3);
ok('stray spaces and blanks in Members are dropped',
   M.crewRowsFrom([{id:'1',fields:{id:'1',CrewID:'x',Title:'X',Members:'Devon, , Martin '}}],[],[])[0].members.join('|') === 'Devon|Martin');
ok('an empty Crews read yields null, never fourteen crews with no skills', M.crewRowsFrom([], G.ct, G.trades) === null);
ok('a duplicate pair keeps the lower rating', (() => { const ct = G.ct.concat([{id:'9998',fields:{id:'9998',CrewLookupId:String(h.spId),TradeLookupId:G.ct.find(r=>String(r.fields.CrewLookupId)===String(h.spId)).fields.TradeLookupId,Preference:0}}]); const c = M.crewRowsFrom(G.crews, ct, G.trades).find(c=>c.id==='harrison'); return Object.values(c.ratings).includes(0); })());
ok('trade rows carry code, label and sort', M.tradeRowsFrom(G.trades).every(t => t.code && t.label && typeof t.spId === 'string'));
ok('assignable codes come from the Crew column', JSON.stringify(M.assignableCodesFrom([{name:'Title'},{name:'Crew',choice:{choices:['a','b']}}])) === '["a","b"]');
ok('no Crew column means null', M.assignableCodesFrom([{name:'Title'}]) === null && M.assignableCodesFrom(null) === null);
const p = M.toPlannerPayload(Object.assign({}, G, { asgColumns: [{name:'Crew',choice:{choices:['harrison']}}] }));
ok('payload carries crewRows, tradeRows and assignableCodes', p.crewRows.length === 14 && p.tradeRows.length === 26 && p.assignableCodes[0] === 'harrison');
ok('payload still carries crews as codes for the template check', Array.isArray(p.crews) && p.crews.includes('harrison'));
```

- [ ] **Step 2: Run, expect failure**

Run: `node fixtures/planner/graph-read.js`
Expected: FAIL lines (`M.crewRowsFrom is not a function`).

- [ ] **Step 3: Implement the four functions and wire the payload**

In `toPlannerPayload` add `crewRows: crewRowsFrom(graph.crews, graph.ct, graph.trades)`, `tradeRows: tradeRowsFrom(graph.trades)`, `assignableCodes: assignableCodesFrom(graph.asgColumns)`. Export the three new functions and `normRating` from the module `return`. Extend the header comment's list of Graph-only keys.

- [ ] **Step 4: Run, expect pass; then sweep**

Run: `node fixtures/planner/graph-read.js` → PASS. Write `graph-read.crews-mutations.json` with at least: `String(` removed from one side of the ct join; `normRating` returning `0` for null; `members` not trimmed; the empty guard returning `[]`; duplicate keeping the higher rating. Run `python fixtures/planner/mutate.py fixtures/planner/graph-read.js web/graph-to-planner.js --json fixtures/planner/graph-read.crews-mutations.json` → every mutation red.

- [ ] **Step 5: Commit**

```bash
git add web/graph-to-planner.js fixtures/planner/graph-read.js fixtures/planner/graph-read.crews-mutations.json
git commit -m "Mapper emits crew rows with ratings, trade rows and the assignable crew codes"
```

### Task 7: Core: `planCrewEdits` and its helpers

**Files:**
- Modify: `web/writeback-core.js` (new functions before the module `return` at 760; export them)
- Create: `fixtures/planner/crews-editor.js` (part A: pure core, no DOM yet)
- Create: `fixtures/planner/crews-editor.core-mutations.json`
- Modify: `package.json` (`scripts.test` gains `&& node fixtures/planner/crews-editor.js`)

**Interfaces:**
- `RATING_WORDS = {3:'First choice', 2:'Second choice', 1:'Last resort', 0:'Never'}`; `ratingWord(n)` → the word, `''` for null.
- `skillKey(name)` → `String(name).toLowerCase().replace(/[^a-z0-9]/g,'')`.
- `slugCode(name, existingCodes)` → `skillKey(name)` with a numeric suffix (`2`, `3`, ...) while it collides with `existingCodes`; `null` when the key is empty.
- `planCrewEdits(local, live, opts)`:
  - `local = {trades:[{code,label,sort,spId|null,isNew}], crews:[{id, spId|null, isNew, name, size, unlimited, members, note, overall, ratings, ctIds, base:{name,size,unlimited,members,note,overall,ratings}}]}`
  - `live = {trades:[{spId,code,label}], crews:[{spId,id,name,size,unlimited,members,note,overall}], ct:[{spId,crewSpId,tradeSpId,rating}]}` (fresh read, already through `normRating`)
  - returns `{ops:[...], refusals:[{kind, crew, trade, reason, loaded, nowLive, wanted}]}`; ops in this order: `{kind:'trade-create', label, code, sort}`, `{kind:'crew-create', id, fields:{Title, CrewID, Size, Unlimited, Active:true, Members, Notes, Preference:3}}`, `{kind:'crew-patch', spId, id, fields}`, `{kind:'ct-create', crewCode, tradeCode, rating}`, `{kind:'ct-patch', spId, crewCode, tradeCode, rating}`, `{kind:'ct-delete', spId, crewCode, tradeCode}`.
  - Rules: a crew field patch is refused per field when the live value differs from `base`; a `ct-patch` is refused when the live rating differs from `base.ratings[code]`; a `ct-create` is refused `already-exists` when a live row holds the pair; a `ct-delete` is refused when the live rating differs from base; a `crew-create` is refused `code-exists` when a live crew has that `id`; a `trade-create` is refused `duplicate-skill` when `skillKey(label)` equals `skillKey` of any live label or code; `Members` is written as `members.map(trim).filter(Boolean).join(', ')`.

- [ ] **Step 1: Write the failing part A assertions**

`crews-editor.js` loads `../../web/writeback-core.js` with `require` and asserts, among others:

```js
ok('rating words', C.ratingWord(3)==='First choice' && C.ratingWord(2)==='Second choice' && C.ratingWord(1)==='Last resort' && C.ratingWord(0)==='Never');
ok('skillKey ignores case, spaces and punctuation', C.skillKey('Dig / Excavation') === 'digexcavation' && C.skillKey(' gas-line ') === 'gasline');
ok('slugCode suffixes a collision and refuses an empty key', C.slugCode('Dig', ['dig']) === 'dig2' && C.slugCode('***', []) === null);
// a one-rating change on harrison/plumbing 3 -> 2 produces exactly one ct-patch
// a chip turned off produces one ct-delete; a chip turned on produces one ct-create with rating 3
// a new skill produces trade-create first, before any ct-create that points at it
// a new crew produces crew-create with Active:true and Preference:3, and its ct-creates after it
// a live rating that moved since load refuses the ct-patch and still lands a sibling crew-patch
// a Members value 'Devon, , Martin ' writes 'Devon, Martin'
// a trade whose skillKey matches a live code ('Dig/Excavation' vs 'dig') is refused duplicate-skill
// an unchanged crew produces no ops
// setting overall to 0 produces one crew-patch with fields {Preference:0} and nothing else: Active is never touched
```

Each `//` line above is one `ok(...)` with the exact op list asserted by `JSON.stringify` against a literal.

- [ ] **Step 2: Run, expect failure**

Run: `node fixtures/planner/crews-editor.js` → FAIL (`C.planCrewEdits is not a function`).

- [ ] **Step 3: Implement**

Pure functions, no I/O, beside `planStructureCreates`. Export `RATING_WORDS, ratingWord, skillKey, slugCode, normRating` (re-export or duplicate `normRating`; one definition, imported by the mapper is not possible in the browser, so both files hold the same three-line function and `crews-editor.js` asserts they agree) and `planCrewEdits`.

- [ ] **Step 4: Run, expect pass; sweep**

Run: `node fixtures/planner/crews-editor.js` → PASS. Mutations (at least 8): refusal on a moved rating removed; `ct-delete` before `trade-create`; `Members` not trimmed; `slugCode` without suffix; `skillKey` keeping spaces; `crew-create` with `Active:false`; duplicate-skill check on label only; an unchanged crew emitting a patch. Sweep → all red.

- [ ] **Step 5: Commit**

```bash
git add web/writeback-core.js fixtures/planner/crews-editor.js fixtures/planner/crews-editor.core-mutations.json package.json
git commit -m "planCrewEdits: ordered, compare-before-write ops for crews, skills and ratings"
```

### Task 8: Graph write: `applyCrewOps`

**Files:**
- Modify: `web/graph-writeback.js` (new functions; `urls()` gains `columns(listId)` and `item` is reused for DELETE; export)
- Modify: `fixtures/planner/crews-editor.js` (part B: bodies against `crew-capture.json`, a stubbed fetch)
- Create: `fixtures/planner/crews-editor.gw-mutations.json`

**Interfaces:**
- `tradeBody(op)` → `{fields:{Title, TradeCode, SortOrder}}`; `crewBody(op)` → `{fields: op.fields}`; `ctBody(op, crewSpId, tradeSpId)` → `{fields:{Title:<the Task 1 convention>, CrewLookupId:String(crewSpId), TradeLookupId:String(tradeSpId), Preference:op.rating}}`; `ctPatchBody(op)` → `{Preference: op.rating}`.
- `applyCrewOps(ctx, ops)` with `ctx = {token, siteId, lists:{crews, ct, trades}, crewSpIdByCode:{}, tradeSpIdByCode:{}, fetchImpl, sleep}`; sequential, in the given order; POST through `postRetrying`; PATCH to `/items/{id}/fields`; DELETE to `/items/{id}` (expect 204). Returns `{done:[{op, id}], failed:[{op, status, detail}], skipped:[{op, reason:'depends-on-failed'}]}`. A `ct-create` whose crew or trade id is neither in `ctx` nor in `done` is `skipped`. Failures never stop the loop.

- [ ] **Step 1: Write the failing part B assertions**

Stub `fetch` per `signoff-push.js:187-193` capturing `{method, url, body}`; feed the ops from part A; compare each body field for field with `crew-capture.json` `requests[].body`; assert the order of calls; make the Crews POST return 403 and assert its dependent `ct-create` is `skipped` with `depends-on-failed` while a later `ct-patch` still runs; assert DELETE hits `/items/{id}` with no body and a 204 counts as done.

- [ ] **Step 2: Run, expect failure** → `G.applyCrewOps is not a function`.

- [ ] **Step 3: Implement**, documenting at the top of the function the capture file every shape came from.

- [ ] **Step 4: Run, expect pass; sweep** with at least: lookup ids sent as numbers; `Preference` dropped from `ctBody`; a failed POST stopping the loop; DELETE sent to `/fields`; `skipped` reported as `done`. All red.

- [ ] **Step 5: Commit**

```bash
git add web/graph-writeback.js fixtures/planner/crews-editor.js fixtures/planner/crews-editor.gw-mutations.json
git commit -m "applyCrewOps: Graph bodies for Trades, Crews and Crew-Trades, captured shapes"
```

### Task 9: Planner read: crews, trades and ratings from the payload

**Files:**
- Modify: `web/index.html`: `D2_GRAPH.lists` (3534-3545) gains `ct:'32c6154d-2572-4dfd-877a-18fa20a3a07e'`; `loadFromD2ViaGraph` (3768-3802) also reads `base+D2_GRAPH.lists.asg+'/columns'` into `graphPayload.asgColumns` with `.catch(()=>null)`; `importFromD2Payload` (2699-2781) stores crews, trades, assignable codes; load at 435 migrates a stored crew; `skillLabel` (274), `isQualified` (321), `qualified` (472); new `ratingFor`, `assignable`, `skillList`
- Modify: `fixtures/planner/crews-editor.js` (part C: the real page, stubbed Graph, `refreshLive(true)` per `template-check.js:123-161`)
- Create: `fixtures/planner/crews-editor.mutations.json`

**Interfaces:**
- `ratingFor(c, sk)` → `c.ratings[sk]` (0..3) or `null` when not held.
- `assignable(c)` → `!Array.isArray(S.assignableCodes) || S.assignableCodes.includes(c.id)`.
- `qualified(sk)` → for a FIXED code the bucket crew as today; otherwise `S.crews.filter(c => ratingFor(c,sk) > 0 && c.overall !== 0 && assignable(c))`.
- `isQualified(c, sk)` → `!sk ? true : FIXED[sk] ? c.id===FIXED[sk] : (ratingFor(c,sk) > 0 && c.overall !== 0)` (assignability is not a qualification; Schedule Check names it separately in Task 13).
- `skillList()` → `S.trades` mapped to `{id:code,label}` when present, else `SKILLS`. `skillLabel` reads it.
- Crew object in `S.crews`: `{id, spId, name, members, size, unlimited, active, note, overall, ratings, ctIds, color?, base}` where `base` is `{name, size, unlimited, members, note, overall, ratings}` deep-copied at import. A crew with no `spId` is local (a `+ Crew` not yet saved) or the `file://` seed.

- [ ] **Step 1: Write the failing part C assertions**

Boot the page with the fixture plus `asgColumns` (choices = all 14 codes but `campos`), `refreshLive(true)`, then:

```js
ok('S.crews comes from SharePoint after Refresh', S.crews.length === 14 && S.crews.every(c => c.spId));
ok('harrison plumbing rating 3, base recorded', win.ratingFor(win.crew('harrison'),'plumbing') === 3 && win.crew('harrison').base.ratings.plumbing === 3);
ok('S.trades has 26 skills and skillLabel reads them', S.trades.length === 26 && win.skillLabel('plumbing') === 'Plumbing');
ok('a crew rated 0 for a trade is not qualified for it', (() => { win.crew('harrison').ratings.plumbing = 0; return !win.qualified('plumbing').some(c=>c.id==='harrison') && !win.isQualified(win.crew('harrison'),'plumbing'); })());
ok('a crew at overall 0 is qualified for nothing', (() => { const c = win.crew('stl'); c.overall = 0; return !win.qualified('shotcrete').some(x=>x.id==='stl'); })());
ok('overall 1 changes nothing', (() => { const c = win.crew('stl'); c.overall = 1; return win.qualified('shotcrete').some(x=>x.id==='stl'); })());
ok('a code not in the Assignments dropdown is not assignable and not offered', !win.assignable(win.crew('campos')) && !win.qualified('demolition').some(c=>c.id==='campos'));
ok('FIXED codes still map to their bucket crew only', win.qualified('@office').length === 1 && win.qualified('@office')[0].id === 'office');
ok('an empty Crews read keeps the previous crews', (() => { const n = S.crews.length; win.eval('importFromD2Payload').call(win, {kind:'d2-sharepoint-export', jobs:[], crewRows:null}, true); return S.crews.length === n; })());
ok('a stored legacy crew with a skills array migrates to ratings of 3', (() => {
  // a second jsdom whose localStorage holds S with crews:[{id:'devon',name:'Devon Crew +3',members:[],size:4,skills:['dig']}] before the page script runs
  const c = win2.crew('devon'); return c.ratings && c.ratings.dig === 3 && c.overall === 3 && c.skills === undefined; })());
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

`importFromD2Payload`: when `Array.isArray(d.crewRows)` set `S.crews = d.crewRows.map(crewFromRow)` keeping each bucket crew's `color` from `SEED_CREWS`; when `Array.isArray(d.tradeRows)` set `S.trades`; set `S.assignableCodes = Array.isArray(d.assignableCodes) ? d.assignableCodes : null`. Replace `c.skills.includes(sk)` at 321, 474 and 1586 with `ratingFor`. In the load at 435, map any crew carrying `skills` (array) to `ratings` of 3 and `overall` 3. Keep `SEED_CREWS`, giving each a `ratings` map at 3 and `overall` 3, for `file://` and tests.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: exit 0. `rules.js`, `determinism.js`, `roundtrip.js`, `escaping.js`, `freshness.js` all still green (they seed through `SEED_CREWS` or `win.crew`).

- [ ] **Step 5: Sweep** `crews-editor.mutations.json` against `web/index.html`: `qualified` ignoring `overall`; `assignable` always true; `importFromD2Payload` replacing `S.crews` on `null`; `skillLabel` ignoring `S.trades`; the legacy migration dropped. All red.

- [ ] **Step 6: Commit**

```bash
git add web/index.html fixtures/planner/crews-editor.js fixtures/planner/crews-editor.mutations.json
git commit -m "Planner reads crews, skills and ratings from SharePoint; qualified honours ratings"
```

### Task 10: The Crews tab editor and the unsaved guards

**Files:**
- Modify: `web/index.html`: `vCrews` (1577-1598), `setCrew`/`toggleSkill`/`addCrew`/`delCrew` (2549-2566), `stopForUnsaved` (2474-2490), the Refresh warning in `importFromD2Payload` (2731-2735), `render()` Save-button rule (1056), chip CSS (46-51)
- Modify: `fixtures/planner/crews-editor.js` (part D), `fixtures/planner/crews-editor.mutations.json`, `fixtures/planner/honest-copy.js`

**Interfaces:**
- `cycleRating(crewId, code)`: off → 3 → 2 → 1 → 0 → off (`delete c.ratings[code]`), then `save(); render();`.
- `setOverall(crewId, n)`: `c.overall = Number(n)`.
- `addSkill()`: `prompt('Name of the new skill')`; refuse (alert, exact sentence) when `skillKey` matches an existing `S.trades` label or code: `That skill is already on the list as "<label>".`; else push `{code: slugCode(label, codes), label, sort: max+1, spId:null, isNew:true}` to `S.trades`.
- `addCrew()`: prompts for name, code (default `slugCode(name)`, refused if it exists or is null: `A crew code is lower-case letters and digits, and <code> is already taken.`), size, `confirm('Is this a subcontractor (never double-booked)?')`, members; pushes `{id:code, spId:null, isNew:true, name, members, size, unlimited, active:true, note:'', overall:3, ratings:{}, ctIds:{}}`.
- `delCrew` removed, along with its button and the `confirm` text; the hint reads: `A crew that should not be used any more is set to Never overall. It stays on the list.`
- `setCrew(id,'unlimited',bool)`: a `Subcontractor` checkbox per field crew row; on an existing crew it first asks `confirm('<name> will no longer count as busy and can be on several projects the same day. Continue?')` when ticking, and `confirm('<name> will count as busy again, so double-bookings on it will be flagged. Continue?')` when unticking; Cancel changes nothing.
- On a downloaded copy (`!graphModeAvailable()`): the chips, selects and buttons render disabled, the card carries the hint `Crew changes are not saved from a downloaded copy. Use the hosted planner.`, and `crewChangeCount()` returns 0 so Save never offers them.
- `buildCrewChanges()` → `{local, lines, count}`: `local` as Task 7 consumes; `lines` the words for the preview (`<Crew>, <Skill>: <old word> to <new word>`, `<Crew>: overall <word>`, `<Crew>: <field> changed`, `New skill: <label>`, `New crew: <name>, code <code>`); `count` = `lines.length`.
- `crewChangeCount()` = `buildCrewChanges().count`; `render()` enables Save when it is > 0; `stopForUnsaved` adds a third block: `<strong>Save first.</strong> There are changes on the Crews tab that are not in SharePoint yet (<count>). <doing> reloads the crew list, which would lose them.`; the Refresh warning adds `and <count> change(s) on the Crews tab`.

- [ ] **Step 1: Write the failing part D assertions**

After `refreshLive(true)` and `setTab('crews')`:

```js
ok('no delete control anywhere on the Crews tab', !/delCrew|✕/.test(main()));
ok('a held chip shows its word', /First choice/.test(chipFor('harrison','plumbing').textContent));
ok('clicking cycles 3,2,1,0,off', (() => { const seq=[]; for (let i=0;i<5;i++){ chipFor('harrison','plumbing').click(); seq.push(win.ratingFor(win.crew('harrison'),'plumbing')); } return seq.join(',') === '2,1,0,,3'; })());
ok('overall control writes c.overall', (() => { win.setOverall('stl', 0); return win.crew('stl').overall === 0; })());
ok('buckets have no chips or overall control', !chipFor('office','dig') && !main().includes('setOverall(\'office\''));
ok('Skill Coverage omits a crew rated Never for the skill', (() => { win.crew('stl').ratings.shotcrete = 0; win.render(); const row = [...win.document.querySelectorAll('tr')].find(r => /Shotcrete/.test(r.textContent)); return row && !/STL Shotcrete/.test(row.textContent); })());
ok('a Subcontractor tick on an existing crew asks first and Cancel changes nothing', (() => { win.confirm = () => false; win.setCrew('devon','unlimited',true); return win.crew('devon').unlimited === false; })());
ok('a confirmed Subcontractor tick lands', (() => { win.confirm = () => true; win.setCrew('devon','unlimited',true); const r = win.crew('devon').unlimited === true; win.setCrew('devon','unlimited',false); return r; })());
ok('+ Skill refuses a duplicate ignoring case, spaces and punctuation', (() => { win.prompt = () => 'DIG /  excavation'; let msg=''; win.alert = m => msg = m; win.addSkill(); return /already on the list/.test(msg) && S.trades.length === 26; })());
ok('+ Skill adds a trade with a code and the next sort', (() => { win.prompt = () => 'Electrical'; win.addSkill(); const t = S.trades.find(x=>x.label==='Electrical'); return t && t.code==='electrical' && t.isNew && t.sort === 27; })());
ok('+ Crew refuses a taken code', (() => { const answers = ['Devon Two','devon']; win.prompt = () => answers.shift(); let msg=''; win.alert = m => msg = m; const n = S.crews.length; win.addCrew(); return /already taken/.test(msg) && S.crews.length === n; })());
ok('+ Crew adds a local crew at overall 3 with no skills', (() => { const answers = ['Lopez +2','lopez','3','Lopez, Ana, Raul']; win.prompt = () => answers.shift(); win.confirm = () => false; win.addCrew(); const c = win.crew('lopez'); return c && c.spId === null && c.isNew && c.overall === 3 && Object.keys(c.ratings).length === 0 && c.unlimited === false && c.size === 3 && c.members.length === 3; })());
ok('Save is enabled by a crew change alone', (() => { win.render(); return !win.document.getElementById('saveBtn').disabled; })());
ok('stopForUnsaved names the Crews tab', (() => { win.stopForUnsaved('Activate','Activating'); return /Crews tab/.test(win.document.getElementById('dBody').textContent); })());
ok('the Refresh warning counts crew changes', (() => { let text=''; win.confirm = t => { text = t; return false; }; win.eval('importFromD2Payload').call(win, payloadWithOneJob, false); return /change\(s\) on the Crews tab/.test(text) || /changes? on the Crews tab/.test(text); })());
ok('crew and skill names are escaped on the Crews tab', (() => { S.crews[0].name = 'Devon <svg id="xss-probe"></svg>'; S.trades[0].label = 'Dig <svg id="xss-probe"></svg>'; win.render(); return win.document.getElementById('xss-probe') === null; })());
```

Add to `honest-copy.js`: the retire hint's claim ("stays on the list") paired with `S.crews.length` unchanged after `setOverall(...,0)`.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

Chips: keep `class="chip skill"` markup; add classes `r3 r2 r1 r0` with four distinct background colours (r0 the existing rust `#a84a18` family) and the word plus number as text (`First choice · 3`), `title` with the skill label. Overall: a `<select>` of the four words per crew row. Buckets (`FIXED` values) render name and note only. Skill Coverage: `qualified(s.id)` chips suffixed with the rating word. New `S.trades` and `S.crews` entries carry `isNew`.

- [ ] **Step 4: Run, expect pass; sweep** (cycle order; delete button restored; `buildCrewChanges` ignoring overall; the Refresh warning dropping the crew count; Save disabled with only crew changes; an unescaped label). All red.

- [ ] **Step 5: Commit**

```bash
git add web/index.html fixtures/planner/crews-editor.js fixtures/planner/crews-editor.mutations.json fixtures/planner/honest-copy.js
git commit -m "Crews tab edits skills, ratings and crews; crew changes count as unsaved"
```

### Task 11: Save: preview section, push, results

**Files:**
- Modify: `web/index.html`: `openSavePreview` (3129-3240), `confirmSaveByPush` (3293-3353), `showPushResult` (3357-3466), the PENDING reset at 3467, new `pushCrewChanges`; `inlineSet`/`saveSec` refuse a non-assignable crew; `explainGraphError` 403 text for the crew lists
- Modify: `fixtures/planner/crews-editor.js` (part E), `fixtures/planner/crews-editor.mutations.json`

**Interfaces:**
- `PENDING_CREWS` (module `let`, beside line 3120), set in `openSavePreview` to `buildCrewChanges().local` when `count > 0`, cleared with the others at 3467.
- `pushCrewChanges(siteId, tok)`: reads the three lists live with `graphPageAll` (`$expand=fields&$top=500`), maps them through `D2GraphToPlanner.crewRowsFrom`/`tradeRowsFrom` into the `live` shape Task 7 consumes, calls `planCrewEdits`, then `applyCrewOps` with `lists:{crews:D2_GRAPH.lists.crews, ct:D2_GRAPH.lists.ct, trades:D2_GRAPH.lists.trades}` and `crewSpIdByCode` / `tradeSpIdByCode` built from that same live read; returns `{plan, res}`. Called in `confirmSaveByPush` right after `pushChangeSet` returns (`out.cw`), errors caught into `out.cwError`. `anyWrite` includes `out.cw.res.done.length`. Never called in file mode: `openSavePreview` sets `PENDING_CREWS` only when `canPush`.
- Preview: a `Crews and skills (<n>)` section listing `lines`, placed before the schedule pools, with the sentence `A new crew can be assigned a few minutes after Save, once the crew list has been updated. Press Refresh then.` when any op is a `crew-create`.
- Results: one row per op in words (`Harrison, Plumbing` / `rating` / `First choice to Second choice`), refusals with `loaded <word>, now <word>` (or `already exists`, `skill already on the list`, `code taken`), failures with the 403 sentence `Changes to crews and skills are limited to the people set up to make them; nothing was changed.` when `status === 403`, else `HTTP <status>`; skipped ops as `not written because <dependency> failed`.
- `inlineSet(...,'crew',v)` and the drawer save refuse a crew with `!assignable(c)` with `alert('<name> is not on the crew list yet. Press Refresh in a few minutes, then try again.')` and write nothing.

- [ ] **Step 1: Write the failing part E assertions**

Stub fetch as in `signoff-push.js` for the three lists' GETs (return the fixture rows) and writes (capture bodies); after a chip change, a new skill and a new crew: open the preview and assert the section text and order; call `confirmSaveByPush()` and assert the calls in order (Trades POST, Crews POST, Crew-Trades PATCH), the results table rows, and that `PENDING_CREWS` is null afterwards. Second scenario: make the Crews POST return 403, assert the 403 sentence appears once, the dependent `ct-create` is reported `not written`, the ct PATCH still ran, and `S.crews` still holds the new local crew. Third: set `S.assignableCodes` without `campos`, call `inlineSet(j.id,gi,si,'crew','campos')`, assert the alert text and that `s.crewId` is unchanged.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement.** Reuse the row/sec helpers in `showPushResult` (3364-3367).

- [ ] **Step 4: Run, expect pass; sweep** (crew ops after schedule pools in the preview is fine; mutations: `PENDING_CREWS` not cleared; 403 wording replaced by the code; skipped reported as written; `inlineSet` writing an unassignable crew; `anyWrite` ignoring crew ops so no re-read). All red. Then `npm test` green.

- [ ] **Step 5: Commit**

```bash
git add web/index.html fixtures/planner/crews-editor.js fixtures/planner/crews-editor.mutations.json
git commit -m "Save sends crew, skill and rating changes over Graph and reports each in words"
```

---

## Session 3: scheduling, pickers, the nightly check, gates and deploy

### Task 12: Auto-Schedule by rating, and the Your call list

**Files:**
- Modify: `web/index.html`: `autoSchedule` (495-541; the sort at 525 and the all-unlimited branch at 521), `autoScheduleRun` (556-574), `openAutoPreview` (618-660), `AUTO_RULES` (606-616)
- Modify: `fixtures/planner/rules.js`, `fixtures/planner/determinism.js` (seed ratings), create `fixtures/planner/rules.ratings-mutations.json`

**Interfaces:**
- Sort at 525 becomes: by `ratingFor(c, s.skill)` descending, then load ascending, then `a.id.localeCompare(b.id)`. The all-unlimited branch picks the highest-rated, ties by id.
- `yourCalls(snapshot)` → `[{jobno, pool, num, name, crew, got, better:[{name, rating, free}]}]`: for every sub-phase Auto-Schedule placed (not pinned, not skipped, with a skill and a crew), `best = max(ratingFor(q, skill) for q in qualified(skill))`; when `ratingFor(crew, skill) < best`, `better` = the qualified crews at `best`, each with `free` = the first working day on or after `s.start` where `workSpan(day, s.days)` has no day in `busyMap({jobId, gi, si}).get(q.id)`, searched up to 600 working days (null if none).
- `openAutoPreview(moves, pinned, settled, skipped, calls)` renders a `Your call (<n>)` group after the moves table and before the rules: one row per entry, `<num> <name>` / `<crew> (<word>)` / `<better name> (<word>) free from <pretty(free)>`. Capped at 40 like moves.
- New `AUTO_RULES` entry after the least-loaded rule: `Among the crews free that day, the <b>higher-rated</b> one wins. It never waits for a better crew; every place it settled for a lower rating is listed for you to decide.`

- [ ] **Step 1: Write the failing assertions in `rules.js`**

A fourth isolated scenario, two field crews both holding `plumbing`, A rated 3 and B rated 2, one sub-phase:
- both free → A picked; ratings equal and loads differ → the less loaded picked (unchanged rule);
- A busy on the day, B free → B picked on that day, start not delayed, and `yourCalls` lists the sub-phase with A and A's first free day;
- B rated 0 → never picked even when A is busy (the sub-phase waits for A);
- A at overall 0 → B picked and the Your call list is empty (B is the best available);
- A at overall 1 → A still picked;
- a lower-rated `unlimited` crew free beats a higher-rated busy field crew the same day, and is listed;
- `AUTO_RULES` contains `higher-rated`.
Each with a mutation that reverts it.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement.** Keep the determinism fix's secondary key.

- [ ] **Step 4: Run `rules.js`, `determinism.js`, `startdate.js`, `schedulecheck.js`; sweep** `rules.ratings-mutations.json` (rating sort removed; waits for a better crew; Never not excluded; overall 1 excluding; Your call computed before the run; the rule line missing). All red.

- [ ] **Step 5: Commit**

```bash
git add web/index.html fixtures/planner/rules.js fixtures/planner/determinism.js fixtures/planner/rules.ratings-mutations.json
git commit -m "Auto-Schedule prefers the higher rating on the day and lists where it settled"
```

### Task 13: Pickers and Schedule Check

**Files:**
- Modify: `web/index.html`: `inlineControls` (1295-1312), `editSec` (1645-1700), `conflicts` (909-913), `checkText` (1156-1159)
- Modify: `fixtures/planner/crews-editor.js` (part F), `fixtures/planner/schedulecheck.js`, `fixtures/planner/escaping.js`, mutation files

**Interfaces:**
- Both pickers: `<optgroup label="First choice">`, `Second choice`, `Last resort` from `qualified(skill)` grouped by `ratingFor`, empty groups omitted; then `<optgroup label="⚠ Not qualified">` as today where a crew rated 0 for the trade is suffixed ` (rated Never)` and a crew at overall 0 ` (rated Never overall)`; a crew with `!assignable(c)` is `disabled` and suffixed ` (not on the crew list yet)`.
- `conflicts()`: the `unqual` message says `rated Never for <skill>` or `rated Never overall` when that is why; a new `kind:'unassignable'` error `<ref> — <crew> is not on the crew list yet; press Refresh in a few minutes.` when `!assignable(crew)`.
- `checkText`: `unqual` fix becomes `Pick a crew from the First choice or Second choice group on the row.`; `unassignable` groups per project with fix `Press Refresh; the new crew becomes assignable a few minutes after it was saved.`

- [ ] **Step 1: Write the failing assertions**

In `crews-editor.js` part F, after `refreshLive(true)` with `harrison` plumbing at 3, `stl` plumbing set to 2 and `campos` absent from `assignableCodes`:

```js
win.editSec(j.id, gi, si);   // a plumbing sub-phase
const groups = [...win.document.querySelectorAll('#fCrew optgroup')].map(g => g.label);
ok('drawer groups qualified crews by rating word, empty groups omitted', groups.join('|') === 'First choice|Second choice|⚠ Not qualified');
ok('harrison is under First choice and stl under Second choice', optUnder('First choice').includes('harrison') && optUnder('Second choice').includes('stl'));
ok('a crew rated Never for the trade is suffixed in Not qualified', (() => { win.crew('saul').ratings.plumbing = 0; win.editSec(j.id, gi, si); return /\(rated Never\)/.test(optText('saul')); })());
ok('a crew at overall Never is suffixed overall', (() => { win.crew('devon').overall = 0; win.editSec(j.id, gi, si); return /\(rated Never overall\)/.test(optText('devon')); })());
ok('an unassignable crew is disabled with the sentence', win.document.querySelector('#fCrew option[value="campos"]').disabled && /not on the crew list yet/.test(optText('campos')));
ok('the inline picker uses the same groups', (() => { win.setTab('board'); win.render(); const cell = win.document.querySelector('.ic-row .ic[data-ic="crew"]'); win.icOpen(cell, j.id, gi, si, 'crew'); return [...win.document.querySelectorAll('.ic-row select optgroup')].map(g=>g.label)[0] === 'First choice'; })());
const msgs = win.conflicts().map(x => x.msg + '|' + x.kind);
ok('Schedule Check says rated Never for the trade', msgs.some(m => /rated Never for Plumbing/.test(m) && /unqual/.test(m)));
ok('Schedule Check says rated Never overall', msgs.some(m => /rated Never overall/.test(m)));
ok('Schedule Check names a not-yet-assignable crew', msgs.some(m => /not on the crew list yet/.test(m) && /unassignable/.test(m)));
```

`escaping.js` gains the probe in `S.trades[0].label` and in `S.crews[0].name`, swept over all seven tabs and an opened drawer, asserting `getElementById('xss-probe') === null` after each.

- [ ] **Step 2: Run, expect failure.** - [ ] **Step 3: Implement.** - [ ] **Step 4: Pass; sweep; `npm test` green.**

- [ ] **Step 5: Commit**

```bash
git add web/index.html fixtures/planner/crews-editor.js fixtures/planner/schedulecheck.js fixtures/planner/escaping.js fixtures/planner/*.mutations.json
git commit -m "Pickers group crews by rating; Schedule Check names Never and not-yet-assignable crews"
```

### Task 14: `D2 - Crew Trade Check` honours ratings

**Files:**
- Create: `flows/scripts/crew_trade_check_preferences.py` (`apply(actions) -> actions`, idempotent)
- Create: `flows/scripts/test_crew_trade_check_preferences.py`
- Create: `flows/scripts/<yyyy-mm-dd>-crew-trade-check-preferences.py` (driver on the `2026-10-22-new-pool-task-features.py` pattern: `check` and `push`, backup to `flows/exports/backups/D2-Crew-Trade-Check-pre-preferences.json`)
- Reference: `flows/exports/D2-Crew-Trade-Check-2026-10-01.json`

**Interfaces:**
- Inside `For_each_crew`: `Compose_overall_never` = `@equals(coalesce(items('For_each_crew')?['Preference'], 3), 0)`; `Filter_crew_trades` `where` becomes `@and(equals(item()?['Crew']?['Id'], items('For_each_crew')?['ID']), not(outputs('Compose_overall_never')), not(equals(coalesce(item()?['Preference'], 3), 0)))`; new `Filter_never_rows` with the complementary `or(...)`, `Select_never_pairs` (same `concat` as `Select_pairs`), `Compose_merged_never`, `Set_never` into a new top-level `Init_never` array variable.
- Inside `For_each_assignment`: `Compose_text` returns `''` when the pair is in `qual`, else `concat('Crew ', <crew>, ' is rated Never for ', <trade>)` when the pair is in `never`, else the existing `does not hold the required trade` text.

- [ ] **Step 1: Write the failing test** on the `test_new_pool_task_features.py` pattern: load the newest export without `Init_never`, apply, assert the new actions and expressions above verbatim, idempotence, `InitializeVariable` only at top level, no `Terminate` inside a loop, and a no-drift check against the newest export that contains `Init_never` once one exists.

- [ ] **Step 2: Run, expect failure.** - [ ] **Step 3: Write the builder.** - [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Push and verify both ways live**

Assert the tenant. `py -3 flows/scripts/<date>-crew-trade-check-preferences.py check`, then `push` (Shane runs the push if the classifier refuses it). Read the published `clientdata` back. Then on a throwaway `Planned` project owned by D2 Bot with default crews on (raised through `+ Job`; set it `Active` for the test): set `harrison`'s Crew-Trades row for `plumbing` to `Preference 0` on the list, run the flow, read `TradeMismatch` on that project's plumbing rows.
Expected: each reads `Crew harrison is rated Never for Plumbing`; no other row changed; `Compose_result` names the flagged count. Set the row back to 3, run again: cleared. Set `harrison`'s overall to 0, run: every harrison row on the project flagged `rated Never for`; set back to 3, run: cleared. Delete the throwaway through Delete Pool Requests and remove both request rows. Export with `export-flows.py "Crew Trade Check"`.

- [ ] **Step 6: Commit**

```bash
git add flows/scripts/crew_trade_check_preferences.py flows/scripts/test_crew_trade_check_preferences.py flows/scripts/*-crew-trade-check-preferences.py flows/exports/D2-Crew-Trade-Check-*.json flows/exports/backups/D2-Crew-Trade-Check-pre-preferences.json
git commit -m "Crew Trade Check treats a rating of Never, per trade or overall, as not qualified"
```

### Task 15: Gates, docs, deploy, live verification

**Files:**
- Modify: `tools/planner-shakedown.js` (Crews tab checks), `fixtures/planner/README.md` (a `crews-editor.js` row, the `rules.js` row), `CLAUDE.md` (business rule 1, flow table row 16, the Crews tab decision of 2026-09-16b, the `Assignments.Crew` entry), `sessions/`

- [ ] **Step 1: Shakedown**

Add to the Crews tab pass: no `✕` button; at least one `.chip.skill.r3`; clicking a chip changes its text; a `<select>` of four words per field crew; the Auto-Schedule drawer contains `higher-rated`. Run `web/` on 8787 and headless Chrome `--window-size=1600,1000 --remote-debugging-port=9222`; `node tools/planner-shakedown.js` → all PASS, console clean.

- [ ] **Step 2: Full suite and every sweep**

Run: `npm test` → exit 0 (oracle 15/16 is the known state). Run each new mutation file once more, one at a time, and record the counts in the session log.

- [ ] **Step 3: Docs**

README rows; CLAUDE.md edits named above (business rule 1 gains the rating dimension and the four words; flow table gets `| 16 | Crew Sync | Started | ... |`; the 2026-09-16b "PMs keep edit access to both tabs" entry is marked superseded for the Crews tab by this spec; the `Assignments.Crew` entry says `D2 - Crew Sync` now maintains the choices and the formula and `guard-crew-values.js` is the manual fallback). Note the guide item for the next major version (the Crews tab section).

- [ ] **Step 4: Deploy**

Hand Shane the deploy block from CLAUDE.md ("THE HOSTED PLANNER WAS REDEPLOYED") and the tag `deploy/<yyyy-mm-dd>`. After it: every path 302 to `/.auth/login/aad`, `/auth-redirect.html` 200, `/.auth/login/github` 404; read the served `index.html`, `graph-to-planner.js`, `writeback-core.js`, `graph-writeback.js` back through the wall and confirm they are hash-identical to the working copy.

- [ ] **Step 5: Live verification, rows read back over REST after each step**

In the hosted planner as D2 Bot: Refresh shows 14 crews with ratings and `First choice` chips; change one rating on a throwaway skill (create `ZZ Test Skill` with `+ Skill`, rate one crew `Second choice`, Save) and read the Trades and Crew-Trades rows back; `+ Crew` `zztest`, Save, confirm the planner marks it not yet assignable, wait for `D2 - Crew Sync`, Refresh, confirm it is assignable and the Assignments column holds the code and the formula; set the crew to `Never` overall and confirm it leaves every picker; remove the test rows (Crew-Trades row, Crews row, Trades row), edit any Crews row's `Notes` so the sync drops the code, read the column back at 14 choices; tenant counts unchanged.

- [ ] **Step 6: Commit and session log**

```bash
git add tools/planner-shakedown.js fixtures/planner/README.md CLAUDE.md sessions/
git commit -m "Skills and crew preferences: shakedown, docs, deploy record"
```

---

## Self-review notes

- Spec coverage: scale and words (Tasks 7, 10); data model and backfill (Task 2); permissions (Task 3); Crew Sync and the not-yet-assignable mark (Tasks 5, 6, 9, 11, 13); planner read (Tasks 6, 9); editor (Task 10); Save and order (Tasks 7, 8, 11); scheduling and Your call (Task 12); Schedule Check and pickers (Task 13); Crew Trade Check (Task 14); tests and live verification (every task, Task 15); follow-ups recorded in Task 15 step 3.
- Names used across tasks: `crewRowsFrom`, `tradeRowsFrom`, `assignableCodesFrom`, `normRating` (mapper and core, asserted equal); `ratingWord`, `skillKey`, `slugCode`, `planCrewEdits` (core); `applyCrewOps`, `tradeBody`, `crewBody`, `ctBody`, `ctPatchBody` (Graph); `ratingFor`, `assignable`, `qualified`, `isQualified`, `skillList`, `cycleRating`, `setOverall`, `addSkill`, `addCrew`, `buildCrewChanges`, `crewChangeCount`, `pushCrewChanges`, `yourCalls`, `PENDING_CREWS` (planner).
- Review Focus coverage: 1 in Tasks 6 and 14; 2 in Tasks 6 and 7; 3 in Task 7 and 10; 4 in Tasks 8 and 11; 5 in Tasks 9, 11, 12 and 13.
