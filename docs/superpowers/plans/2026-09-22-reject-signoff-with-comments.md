# Reject a Sign-off, With Comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PM can reject an installer's sign-off with a reason, comment on any sub-phase, and mark a rejection resolved; rejections collect in one list in the planner and in the 04:30 Daily Summary.

**Architecture:** One new SharePoint list (`Sign-off Comments`) holds the thread; three new columns on `Assignments` duplicate the latest rejection so a flow and a view can read one list. The planner queues comment/reject/resolve entries in `localStorage` and sends them on Save through the existing Graph write path, with the same compare-before-write and suppression-stamp rules every other planner write already carries. Pure decision code goes in `writeback-core.js`, Graph shapes in `graph-writeback.js`, read mapping in `graph-to-planner.js`, and UI in `web/index.html`.

**Tech Stack:** Vanilla ES5-flavoured JS (no build step), MSAL 2.38.3 (pinned, vendored), Microsoft Graph v1.0, SharePoint Lists, Power Automate, jsdom test harnesses, `fixtures/planner/mutate.py` for mutation sweeps.

**Spec:** `docs/superpowers/specs/2026-09-21-reject-signoff-with-comments-design.md` — read it alongside this plan. Every decision below argues from it.

---

## Global Constraints

Copied verbatim from the spec and from CLAUDE.md. Every task's requirements implicitly include this section.

- **Graph returns lookup ids as STRINGS, REST as numbers.** Normalise both sides of every join with `String()`. `"20" === 20` is false, a broken join yields an empty set, errors nowhere, and reports success. This is the most repeated defect in this project (it wrote `TradeMismatch` on 66 correctly-qualified rows).
- **`createdBy` and `createdDateTime` sit at the ITEM ROOT, not under `fields`.** Verified in `fixtures/planner/live-payloads-graph.json`: every item carries `createdBy.user.displayName` and `createdDateTime` (UTC) beside `fields`, not inside it. Every other mapping in `graph-to-planner.js` goes through `.fields`, so reading `f.createdBy` returns `undefined` silently.
- **`SuppressReconcileUntil` goes on `Assignments` writes only.** The `Tasks` list has no such column and sending it fails the PATCH outright. The `Sign-off Comments` list has no such column either.
- **Never widen `s.base`.** `fixtures/planner/freshness.js:109` pins the exact key set to `crewId,days,id,inst,locked,pm,seq,skip,spLocked,start`. Rejection state is display state plus an explicit queued action, never a from/to diff, so it does not belong in `base`. Adding it there trips that fence for no gain.
- **Exactly one user match or refuse.** `resolveSiteUserId` matches the claim `Name` (`i:0#.f|membership|<upn>`), never `EMail` — D2 Bot's `EMail` is `d2bot@d2pools.com` while its UPN is `stratirus@d2pools.com`. Never match on empty: the User Information List holds SharePoint groups and system principals, groups carry no `EMail`, and `'' === ''` is true.
- **A missing or unreadable comments list costs only the comments.** Refresh must not fail because of it, the same rule as the user list. `loadFromD2ViaGraph` currently `Promise.all`s over `Object.keys(D2_GRAPH.lists)` with no per-key catch, so one failing list fails the whole Refresh. The comments read must NOT ride that loop.
- **PATCH before POST, and POST only if the PATCH succeeded.** If the PATCH lands and the POST fails, say so; the reason is not lost, it is in `RejectedReason` and `SignOffNotes`.
- **Escape every PM-typed string at construction.** Comment bodies are PM-typed and rendered as HTML. The injection probe must start `</option></select>`: the parser drops a bare `<svg>` in select context, which let an earlier probe pass with three names unescaped.
- **User-facing copy carries no internal attribution and no em dashes.** No names, no quoted feedback, no self-criticism, no judgement words about their environment. Use a comma, colon, or a new sentence instead of an em dash.
- **A new assertion has to be watched fail before it is worth anything.** Every task below ends with a mutation sweep whose mutations are each confirmed red. This repo has recorded four vacuous harnesses and one vacuous assertion.
- **Live testing runs on a throwaway `Planned` pool owned by D2 Bot (site user 7), never a demo pool.** A rejection leaves a permanent line in `SignOffNotes` and in version history. All four demo pools have real client PMs and `D2 - Reschedule Pool` emails them.
- **Assert the tenant before any write.** `az account set --subscription f24d9b39-6a71-4f4e-a376-03b6f61c97e4` then confirm, per the `m365-tenant-guard` skill. The context has drifted mid-session repeatedly.

### Naming fixed across tasks

| Thing | Exact name |
|---|---|
| New list | `Sign-off Comments` |
| List key in `D2_GRAPH.lists` | `comments` |
| Assignments columns | `Rejected`, `RejectedOn`, `RejectedReason` |
| Comments columns | `Title`, `Assignment` (lookup), `Kind`, `Body` |
| `Kind` choices | `Comment`, `Rejected`, `Resolved` |
| Core functions | `planRejections`, `appendRejected` |
| Graph functions | `commentBody`, `applyRejectionOps` |
| Planner functions | `buildRejectionSet`, `pushRejections`, `queueComment`, `queueReject`, `queueResolve`, `unqueueEntry`, `openRejectionsCard` |
| Section state | `s.rejected`, `s.rejectedOn`, `s.rejectedReason`, `s.thread` |
| Queue | `S.pendingComments` |
| Harness | `fixtures/planner/rejections.js` |

---

## File Structure

| File | Responsibility |
|---|---|
| `sharepoint/provision-signoff-comments.js` | **Create.** Provisions the list, the lookup (SchemaXml adapted from live `Tasks.Assignment`), the three Assignments columns, `WriteSecurity = 2`, and reads every piece back. |
| `sharepoint/provision-views.js` | **Modify.** Adds the `Rejected` view beside `Conflicts` and `Trade Mismatch`. |
| `sharepoint/build-home-page.js` | **Modify.** Links the new view. |
| `web/graph-to-planner.js` | **Modify.** Maps the comments list into `sections[].thread` and the three columns onto `sections[]`. |
| `web/writeback-core.js` | **Modify.** Adds `planRejections`, `appendRejected`; extends `lockedBySignoff` in `planTaskTicks`. Pure, no I/O. |
| `web/graph-writeback.js` | **Modify.** Adds `commentBody` and `applyRejectionOps` (the PATCH-then-POST walk). Graph shapes only. |
| `web/index.html` | **Modify.** Config, comments read, drawer thread and controls, queue, Save count/preview/results, Open rejections card, board label, `file://` guard. |
| `fixtures/planner/rejections.js` | **Create.** jsdom harness over the real page with only `fetch` stubbed. |
| `fixtures/planner/rejections.mutations.json` | **Create.** Mutation list for the sweep. |
| `package.json` | **Modify.** Add `rejections.js` to the `test` script. Note the script currently runs only 7 of the harnesses. |
| `flows/exports/D2-Daily-Summary-*.json` | **Regenerate** after the flow edit, via `flows/scripts/export-flows.py`. |
| `CLAUDE.md` | **Modify.** Record the list, the columns, the view, the shapes read off real payloads, and the live verification. |

---

## Task 1: Provision the SharePoint list, columns and view

Everything downstream needs the real list GUID, so this goes first and no placeholder GUID ever enters the repo.

**Files:**
- Create: `sharepoint/provision-signoff-comments.js`
- Modify: `sharepoint/provision-views.js` (add the `Rejected` view)
- Modify: `sharepoint/build-home-page.js` (link it)

**Interfaces:**
- Consumes: nothing.
- Produces: the `Sign-off Comments` list GUID, pasted into `D2_GRAPH.lists.comments` in Task 6. The three `Assignments` columns `Rejected` (Yes/No), `RejectedOn` (DateTime), `RejectedReason` (Note).

- [ ] **Step 1: Assert the tenant**

```bash
az account set --subscription f24d9b39-6a71-4f4e-a376-03b6f61c97e4
az account show --query tenantId -o tsv | grep -q "^f24d9b39" && echo CONFIRMED || echo ABORT
```

Expected: `CONFIRMED`. Expected identity is `stratirus@d2pools.com`. If it prints `ABORT`, stop.

- [ ] **Step 2: Read the live `Tasks.Assignment` SchemaXml, to copy rather than hand-write the lookup**

The spec requires the lookup's SchemaXml be adapted from the live one that works, not invented. Read it first through the authenticated route in CLAUDE.md (`chrome-devtools` MCP on the SharePoint origin, or the request-triggered proxy flow):

```js
const r = await fetch(SITE + "/_api/web/lists/GetByTitle('Tasks')/fields/getByInternalNameOrTitle('Assignment')",
  { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' });
const f = await r.json();
console.log(f.SchemaXml);
```

Expected: a `<Field Type="Lookup" ... List="{22c45847-...}" ShowField="Title" ...>` string. Record `List` and `ShowField`.

**Do not proceed on a guess.** A hand-written lookup is the documented way this goes wrong: the write returns 201 and the column renders blank.

- [ ] **Step 3: Write the provisioning script**

Create `sharepoint/provision-signoff-comments.js`. It runs in the browser console on the SharePoint origin, like its siblings. Header carries no internal attribution (it is client-visible).

```js
/* Provisions the Sign-off Comments list and the three rejection columns on
 * Assignments. Paste into the browser console on the site, signed in with Edit
 * rights, or run through the request-triggered proxy flow.
 *
 * Every piece is READ BACK after it is written. On this platform a write can
 * return 201/204 and do nothing, or render blank, so a status code is not
 * evidence. DRY_RUN reports the plan and writes nothing.
 */
const DRY_RUN = true;
const SITE = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
const ASG_LIST = '49ef7006-d3fe-40a7-a52f-c4c18545bd35';

const j = { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata' };
async function digest() {
  const r = await fetch(SITE + '/_api/contextinfo', { method: 'POST', headers: j, credentials: 'include' });
  if (!r.ok) throw new Error('contextinfo ' + r.status);
  return (await r.json()).FormDigestValue;
}
async function api(path, opts = {}) {
  const d = opts.method && opts.method !== 'GET' ? await digest() : null;
  const h = Object.assign({}, j, opts.headers || {});
  if (d) h['X-RequestDigest'] = d;
  const r = await fetch(SITE + path, Object.assign({}, opts, { headers: h, credentials: 'include' }));
  const text = await r.text();
  if (!r.ok) throw new Error(opts.method + ' ' + path + ' -> ' + r.status + ' ' + text.slice(0, 400));
  return text ? JSON.parse(text) : null;
}

async function run() {
  const out = { created: [], verified: [], skipped: [], problems: [] };

  // 1. The list. Template 100 = generic list.
  let list = await api("/_api/web/lists/GetByTitle('Sign-off Comments')").catch(() => null);
  if (list) { out.skipped.push('list already exists, id ' + list.Id); }
  else if (DRY_RUN) { out.skipped.push('DRY_RUN: would create list Sign-off Comments'); }
  else {
    list = await api('/_api/web/lists', {
      method: 'POST',
      body: JSON.stringify({ Title: 'Sign-off Comments', BaseTemplate: 100,
        Description: 'Sign-off comments, rejections and resolutions, one row per entry.' })
    });
    out.created.push('list ' + list.Id);
  }
  if (!list) { console.table(out.skipped); return out; }

  const L = "/_api/web/lists(guid'" + list.Id + "')";
  const entity = (await api(L)).ListItemEntityTypeFullName;   // read, never hand-write

  // 2. Fields. Sequential: parallel creates on one list contend and 500.
  const asgLookup = '<Field Type="Lookup" DisplayName="Assignment" Required="TRUE" '
    + 'List="{' + ASG_LIST + '}" ShowField="Title" StaticName="Assignment" Name="Assignment" />';
  const fields = [
    ['Assignment', asgLookup],
    ['Kind', '<Field Type="Choice" DisplayName="Kind" Required="TRUE" Format="Dropdown" '
      + 'FillInChoice="FALSE" StaticName="Kind" Name="Kind">'
      + '<CHOICES><CHOICE>Comment</CHOICE><CHOICE>Rejected</CHOICE><CHOICE>Resolved</CHOICE></CHOICES>'
      + '<Default>Comment</Default></Field>'],
    // Body is deliberately NOT required: SharePoint cannot require a column for
    // some Kinds only, and a Resolved entry may carry no note. The planner
    // refuses an empty Comment or Rejected.
    ['Body', '<Field Type="Note" DisplayName="Body" Required="FALSE" NumLines="6" '
      + 'RichText="FALSE" StaticName="Body" Name="Body" />']
  ];
  for (const [name, xml] of fields) {
    const have = await api(L + "/fields/getByInternalNameOrTitle('" + name + "')").catch(() => null);
    if (have) { out.skipped.push('field ' + name + ' exists'); continue; }
    if (DRY_RUN) { out.skipped.push('DRY_RUN: would create field ' + name); continue; }
    await api(L + '/fields/CreateFieldAsXml', {
      method: 'POST',
      body: JSON.stringify({ parameters: { SchemaXml: xml, Options: 8 } })   // 8 = AddToDefaultContentType
    });
    out.created.push('field ' + name);
  }

  // 3. WriteSecurity 2: create items and edit items created by the user, so a
  //    member cannot edit or delete someone else's entry. Owners unaffected.
  if (!DRY_RUN) {
    await api(L, { method: 'POST', headers: { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' },
      body: JSON.stringify({ WriteSecurity: 2 }) });
  }

  // 4. The three Assignments columns.
  const A = "/_api/web/lists(guid'" + ASG_LIST + "')";
  const asgFields = [
    ['Rejected', '<Field Type="Boolean" DisplayName="Rejected" Required="FALSE" '
      + 'StaticName="Rejected" Name="Rejected"><Default>0</Default></Field>'],
    ['RejectedOn', '<Field Type="DateTime" DisplayName="RejectedOn" Required="FALSE" '
      + 'Format="DateTime" StaticName="RejectedOn" Name="RejectedOn" />'],
    ['RejectedReason', '<Field Type="Note" DisplayName="RejectedReason" Required="FALSE" '
      + 'NumLines="6" RichText="FALSE" StaticName="RejectedReason" Name="RejectedReason" />']
  ];
  for (const [name, xml] of asgFields) {
    const have = await api(A + "/fields/getByInternalNameOrTitle('" + name + "')").catch(() => null);
    if (have) { out.skipped.push('Assignments.' + name + ' exists'); continue; }
    if (DRY_RUN) { out.skipped.push('DRY_RUN: would create Assignments.' + name); continue; }
    await api(A + '/fields/CreateFieldAsXml', {
      method: 'POST', body: JSON.stringify({ parameters: { SchemaXml: xml, Options: 8 } })
    });
    out.created.push('Assignments.' + name);
  }

  // 5. READ EVERYTHING BACK. This is the check, not the status codes above.
  const meta = await api(L + '?$select=Id,Title,WriteSecurity,ItemCount');
  out.verified.push('list ' + meta.Title + ' id=' + meta.Id
    + ' WriteSecurity=' + meta.WriteSecurity + ' (want 2) items=' + meta.ItemCount);
  if (meta.WriteSecurity !== 2 && !DRY_RUN) out.problems.push('WriteSecurity is ' + meta.WriteSecurity + ', wanted 2');

  const look = await api(L + "/fields/getByInternalNameOrTitle('Assignment')"
    + '?$select=TypeAsString,LookupList,LookupField,Required');
  out.verified.push('Assignment lookup -> ' + look.TypeAsString
    + ' list=' + look.LookupList + ' field=' + look.LookupField);
  if (!DRY_RUN && String(look.LookupList).toLowerCase().indexOf(ASG_LIST) === -1)
    out.problems.push('lookup points at ' + look.LookupList + ', not Assignments');

  const kind = await api(L + "/fields/getByInternalNameOrTitle('Kind')?$select=Choices,DefaultValue");
  out.verified.push('Kind choices = ' + JSON.stringify(kind.Choices));

  for (const [name] of asgFields) {
    const f = await api(A + "/fields/getByInternalNameOrTitle('" + name + "')"
      + '?$select=TypeAsString,Required,DefaultValue').catch(() => null);
    out.verified.push('Assignments.' + name + ' -> ' + (f ? f.TypeAsString + ' required=' + f.Required : 'MISSING'));
    if (!DRY_RUN && !f) out.problems.push('Assignments.' + name + ' missing after create');
  }

  out.verified.push('ListItemEntityTypeFullName = ' + entity);
  console.log('PASTE THIS INTO D2_GRAPH.lists.comments:', list.Id);
  console.table(out.created); console.table(out.verified); console.table(out.skipped);
  if (out.problems.length) { console.error('PROBLEMS'); console.table(out.problems); }
  return out;
}
run();
```

- [ ] **Step 4: Run it with `DRY_RUN = true` and read the plan**

Expected: reports it would create the list, three list fields and three Assignments fields, and writes nothing. Confirm the Assignments row count is unchanged afterwards.

- [ ] **Step 5: Run it live and read the verification table**

Set `DRY_RUN = false`. Expected, and all of it read back rather than inferred:

- `WriteSecurity=2`
- `Assignment lookup -> Lookup list={49ef7006-...} field=Title`
- `Kind choices = ["Comment","Rejected","Resolved"]`
- three `Assignments.*` rows all present, `required=false`
- `problems` empty

**Then open the list and the Assignments New form in a browser.** A column that stores fine can still render wrong, and the Assignments form refuses to save when a Required column is null. All three new columns are `Required=FALSE`, so the existing form must still save. Confirm it does.

- [ ] **Step 6: Add the `Rejected` view to `provision-views.js`**

Mirror `Trade Mismatch` exactly, which mirrors `Conflicts`. Use `IsNotNull`-style truth on a Boolean via `Eq 1`, grouped by Job:

```js
['Assignments', 'Rejected',
  "<Where><Eq><FieldRef Name='Rejected'/><Value Type='Boolean'>1</Value></Eq></Where>"
  + "<OrderBy><FieldRef Name='ScheduledStart' Ascending='TRUE'/></OrderBy>",
  ['Title', 'Crew', 'ScheduledStart', 'RejectedOn', 'RejectedReason'],
  { groupBy: 'Job' }],
```

**A view formatter may not contain a raw `<` or `&`** — both fail the whole MERGE with HTTP 500 and neither error names the character. There is no formatter here, but if one is added later, flip operands so a comparison uses `>` or `>=` and express AND as a nested `if`.

- [ ] **Step 7: Run the view provisioning and verify by RENDERING it**

A view can be created with invalid CAML and fail only when opened.

```js
await api("/_api/web/lists(guid'" + ASG_LIST + "')/RenderListDataAsStream", {
  method: 'POST', body: JSON.stringify({ parameters: { ViewXml: '' , ViewName: 'Rejected' } })
});
```

Expected: 0 rows today, because nothing is rejected yet. **An empty view proves nothing on its own** — this is exactly how `Trade Mismatch` was verified. Prove the query executes:

1. Stamp `Rejected = true` on one throwaway row by MERGE. View goes 0 to 1 with the right text.
2. Clear it. View goes 1 to 0.
3. Run an inverted control (`Eq 0`) and confirm it returns the other 183 rows, so the query is demonstrably executing rather than silently matching nothing.

- [ ] **Step 8: Link the view from the home page**

In `sharepoint/build-home-page.js`, add `Rejected` to the view index beside `Conflicts` and `Trade Mismatch`. Keep the label short: the horizontal bar cuts to an overflow at about four or five items.

- [ ] **Step 9: Commit**

```bash
git add sharepoint/provision-signoff-comments.js sharepoint/provision-views.js sharepoint/build-home-page.js
git commit -m "Provision Sign-off Comments list, three rejection columns and the Rejected view"
```

---

## Task 2: Map the comments list and the three columns on the way in

**Files:**
- Modify: `web/graph-to-planner.js`
- Modify: `fixtures/planner/graph-read.js` (extend; it is the REST-vs-Graph equivalence test)
- Create: `fixtures/planner/rejections.mutations.json` (started here, grown by later tasks)

**Interfaces:**
- Consumes: the list GUID from Task 1.
- Produces: on each payload section, `rejected: boolean`, `rejectedOn: string|null`, `rejectedReason: string|null`, and `thread: [{id, kind, body, by, at}]` ordered oldest first. `kind` is one of `'Comment'|'Rejected'|'Resolved'`; `by` is a display name; `at` is the raw UTC ISO string from `createdDateTime`.

- [ ] **Step 1: Write the failing test**

Append to `fixtures/planner/graph-read.js`. Synthetic comment rows, because the captured fixture predates the list. Shape them exactly as Graph returns an item: `createdBy`/`createdDateTime` at the ROOT, `fields` alongside.

```js
/* Comments map onto their sub-phase, oldest first, with author and time taken
   from the item ROOT rather than from fields. Every other mapping in
   graph-to-planner.js reads through .fields, so reading f.createdBy there
   returns undefined and the thread silently renders with no names. */
const asgId = graph.asg[0].fields.id;          // a real assignment from the capture
const mkComment = (id, kind, body, who, at, lookup) => ({
  id: String(id),
  createdBy: { user: { displayName: who, email: 'x@d2pools.com' } },
  createdDateTime: at,
  fields: { id: String(id), Kind: kind, Body: body,
            AssignmentLookupId: lookup == null ? String(asgId) : lookup }
});

const withComments = Object.assign({}, graph, {
  comments: [
    mkComment(3, 'Comment',  'third',  'Cody Campbell', '2026-09-20T15:00:00Z'),
    mkComment(1, 'Rejected', 'tile line is short', 'Don Borgeson', '2026-09-18T12:00:00Z'),
    mkComment(2, 'Resolved', '', 'Don Borgeson', '2026-09-19T09:30:00Z'),
    // A lookup id as a NUMBER, which is what a hand-built row or a REST source
    // gives. String(...) on both sides must still match it.
    mkComment(4, 'Comment', 'numeric lookup', 'Emon Alexander', '2026-09-21T08:00:00Z', Number(asgId)),
    // An orphan: points at no assignment. Must be dropped, not crash.
    mkComment(5, 'Comment', 'orphan', 'Nobody', '2026-09-21T09:00:00Z', '99999999')
  ]
});

const p2 = G.toPlannerPayload(withComments);
const sec = p2.jobs.flatMap(j => j.sections).find(s => String(s.id) === String(asgId));
assert(sec, 'the assignment carrying comments is in the payload');
assert(sec.thread.length === 4, 'four comments land, the orphan is dropped, got ' + sec.thread.length);
assert(sec.thread.map(t => t.id).join(',') === '1,2,3,4',
  'thread is oldest first by createdDateTime, got ' + sec.thread.map(t => t.id).join(','));
assert(sec.thread[0].by === 'Don Borgeson', 'author from createdBy.user.displayName, got ' + sec.thread[0].by);
assert(sec.thread[0].at === '2026-09-18T12:00:00Z', 'raw UTC timestamp preserved');
assert(sec.thread[0].kind === 'Rejected', 'kind carried through');
assert(sec.thread[3].body === 'numeric lookup', 'a NUMERIC lookup id still joins');

/* The three Assignments columns. Absent on every row in the capture, which is
   the normal state, so absent must read as not-rejected rather than undefined. */
const anySec = p2.jobs[0].sections[0];
assert(anySec.rejected === false, 'a row with no Rejected field reads false, got ' + anySec.rejected);
assert(anySec.rejectedReason === null, 'absent reason reads null');

const rejGraph = JSON.parse(JSON.stringify(graph));
rejGraph.asg[0].fields.Rejected = true;
rejGraph.asg[0].fields.RejectedOn = '2026-09-20T14:05:00Z';
rejGraph.asg[0].fields.RejectedReason = 'coping joints uneven';
const p3 = G.toPlannerPayload(rejGraph);
const r = p3.jobs.flatMap(j => j.sections).find(s => String(s.id) === String(asgId));
assert(r.rejected === true, 'Rejected maps true');
assert(r.rejectedReason === 'coping joints uneven', 'reason maps through');
assert(r.rejectedOn === '2026-09-20T14:05:00Z', 'RejectedOn maps through');

/* No comments key at all is the state on every load until Task 1 is deployed,
   and the state forever if the list read fails. It must not throw. */
const p4 = G.toPlannerPayload(Object.assign({}, graph, { comments: undefined }));
assert(p4.jobs[0].sections[0].thread.length === 0, 'no comments list yields empty threads, not a crash');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node fixtures/planner/graph-read.js`
Expected: FAIL on `sec.thread.length` being undefined, because `thread` does not exist yet.

- [ ] **Step 3: Implement the mapping**

In `web/graph-to-planner.js`, extend the header table with the new shapes, then build a thread index beside the existing `byAsg` / `byJob` indexes:

```js
/* Comments, keyed by assignment. createdBy and createdDateTime come from the
   item ROOT, not from fields: every other read in this file goes through
   .fields, and f.createdBy is undefined, which renders a thread with no names
   and no error. Sorted oldest first so the thread reads top to bottom. */
const threads = new Map();
(graph.comments || []).forEach(c => {
  const f = c.fields || {};
  const k = key(f.AssignmentLookupId);
  if (k == null) return;
  const who = (c.createdBy && c.createdBy.user && c.createdBy.user.displayName) || '';
  if (!threads.has(k)) threads.set(k, []);
  threads.get(k).push({
    id: key(f.id),
    kind: f.Kind || 'Comment',
    body: f.Body == null ? '' : String(f.Body),
    by: who,
    at: c.createdDateTime || null
  });
});
threads.forEach(list => list.sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))));
```

Then in the section mapping, beside `inst` / `pm` / `locked`:

```js
rejected: !!af.Rejected,
rejectedOn: af.RejectedOn == null ? null : String(af.RejectedOn),
rejectedReason: af.RejectedReason == null ? null : String(af.RejectedReason),
thread: threads.get(key(af.id)) || [],
```

An orphan comment is dropped by construction: nothing looks up a key that no section carries.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node fixtures/planner/graph-read.js`
Expected: PASS, and the existing REST-vs-Graph equivalence assertions still pass. The REST export carries no comments, so the equivalence check must compare only the fields both sources produce. If it now fails on `thread`, exclude `thread`, `rejected`, `rejectedOn` and `rejectedReason` from that comparison and say in a comment that the REST fallback has no comments by design.

- [ ] **Step 5: Mutation sweep**

Create `fixtures/planner/rejections.mutations.json`:

```json
{
  "web/graph-to-planner.js": [
    {"label": "lookup join not normalised to string",
     "find": "const k = key(f.AssignmentLookupId);\n  if (k == null) return;",
     "replace": "const k = f.AssignmentLookupId;\n  if (k == null) return;"},
    {"label": "author read from fields instead of the item root",
     "find": "(c.createdBy && c.createdBy.user && c.createdBy.user.displayName) || ''",
     "replace": "(f.createdBy && f.createdBy.user && f.createdBy.user.displayName) || ''"},
    {"label": "thread not sorted oldest first",
     "find": "threads.forEach(list => list.sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))));",
     "replace": ""},
    {"label": "absent Rejected reads undefined not false",
     "find": "rejected: !!af.Rejected,",
     "replace": "rejected: af.Rejected,"}
  ]
}
```

Run: `python fixtures/planner/mutate.py fixtures/planner/graph-read.js web/graph-to-planner.js --json fixtures/planner/rejections.mutations.json`
Expected: **4 of 4 red.** A mutation reported NOT-APPLIED is a failure of the sweep, not a pass.

- [ ] **Step 6: Commit**

```bash
git add web/graph-to-planner.js fixtures/planner/graph-read.js fixtures/planner/rejections.mutations.json
git commit -m "Map sign-off comments and the three rejection columns into the planner payload"
```

---

## Task 3: `planRejections` and `appendRejected` in the core

**Files:**
- Modify: `web/writeback-core.js`
- Create: `fixtures/planner/rejections.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure).
- Produces:

```js
planRejections(pools, liveById, opts) -> { ops, refusals, errors }
```

`pools`: `[{jobno, name, sections:[{id, num, name, actions:[{localId, kind, body}]}]}]` where `kind` is `'reject'|'resolve'|'comment'`.

`opts`: `{userName, userNamesById, nowIso, nowMs, suppressMinutes}`.

Each op:

```js
{ localId, kind, id, jobno, num, title,
  patch: { id, fields: {...}, suppressUntil } | null,
  post:  { Title, AssignmentLookupId, Kind, Body } }
```

`refusals`: `[{localId, kind, id, jobno, num, reason, ...detail}]` where `reason` is one of `not-signed`, `already-rejected`, `not-rejected`, `reason-required`, `body-required`.
`errors`: `[{localId, kind, id, jobno, num, reason}]` where `reason` is `row-missing` or `identity-mismatch`.

- [ ] **Step 1: Write the failing test**

Create `fixtures/planner/rejections.js`. This task's assertions cover the core only; later tasks add UI sections to the same file. Keep the core block self-contained so it can run before the page loads.

```js
/* Rejecting a sign-off, commenting, and resolving. Core decisions first, then
 * the Graph shapes, then the page.
 *
 * WHY THIS EXISTS: a rejection clears an attested sign-off and appends a
 * permanent line to SignOffNotes. Getting the refusal cases wrong means either
 * refusing a legitimate rejection or reopening a sign-off somebody else already
 * dealt with. The core is pure, so it is pinned here with no browser at all.
 */
const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exitCode = 1; } else PASS++; };
let PASS = 0;
const C = require('../../web/writeback-core.js');

const NOW = '2026-09-22T17:05:00Z';        // 12:05 Central
const live = {
  '10': { id: '10', Title: 'D2-1042 5.3 Tile Installation', InstallerSignOff: true,
          InstallerSignOffByLookupId: '14', SignOffNotes: 'signed on site', Rejected: false },
  '11': { id: '11', Title: 'D2-1042 5.4 Coping Installation', InstallerSignOff: false, Rejected: false },
  '12': { id: '12', Title: 'D2-1042 6.1 Equipment Installation', InstallerSignOff: false,
          Rejected: true, RejectedReason: 'earlier reason' }
};
const opts = { userName: 'Don Borgeson', userNamesById: { '14': 'Cody Campbell' },
               nowIso: NOW, nowMs: Date.parse(NOW), suppressMinutes: 10 };
const pool = (sections) => [{ jobno: 'D2-1042', name: 'Reyes Residence', sections }];

// --- Reject a signed sub-phase ---------------------------------------------
let r = C.planRejections(pool([
  { id: '10', num: '5.3', name: 'Tile Installation',
    actions: [{ localId: 'a1', kind: 'reject', body: 'tile line is short on the east wall' }] }
]), live, opts);

assert(r.refusals.length === 0 && r.errors.length === 0, 'a clean reject is not refused');
assert(r.ops.length === 1, 'one op for one reject, got ' + r.ops.length);
const op = r.ops[0];
assert(op.patch && op.post, 'a reject carries BOTH a patch and a post');
assert(op.patch.fields.InstallerSignOff === false, 'reject clears the sign-off flag');
assert(op.patch.fields.InstallerSignOffByLookupId === null, 'reject clears the attribution');
assert(op.patch.fields.InstallerSignOffOn === null, 'reject clears the timestamp');
assert(op.patch.fields.Rejected === true, 'reject sets Rejected');
assert(op.patch.fields.RejectedOn === NOW, 'reject stamps RejectedOn');
assert(op.patch.fields.RejectedReason === 'tile line is short on the east wall', 'reason stored on the row');
assert(typeof op.patch.suppressUntil === 'string' && op.patch.suppressUntil > NOW,
  'the patch carries a suppression stamp ahead of now');
assert(op.patch.fields.SignOffNotes ===
  'signed on site  |  REJECTED 2026-09-22 12:05 by Don Borgeson (was signed by Cody Campbell): tile line is short on the east wall',
  'the notes line matches the reopen shape, in Central time, got ' + op.patch.fields.SignOffNotes);
assert(op.post.Kind === 'Rejected', 'the comment row is Kind=Rejected');
assert(op.post.Body === 'tile line is short on the east wall', 'the reason is the comment body');
assert(op.post.AssignmentLookupId === '10', 'the comment points at the assignment, as a string');
assert(op.post.Title === 'D2-1042 5.3', 'Title is "<JobNumber> <SubPhaseNumber>", got ' + op.post.Title);

// --- Refusals --------------------------------------------------------------
r = C.planRejections(pool([{ id: '11', num: '5.4', name: 'Coping Installation',
  actions: [{ localId: 'a2', kind: 'reject', body: 'no good' }] }]), live, opts);
assert(r.ops.length === 0 && r.refusals.length === 1, 'rejecting an unsigned sub-phase is refused');
assert(r.refusals[0].reason === 'not-signed', 'reason is not-signed, got ' + r.refusals[0].reason);

r = C.planRejections(pool([{ id: '12', num: '6.1', name: 'Equipment Installation',
  actions: [{ localId: 'a3', kind: 'reject', body: 'again' }] }]), live, opts);
assert(r.refusals.length === 1 && r.refusals[0].reason === 'already-rejected',
  'rejecting an already-rejected sub-phase is refused');

r = C.planRejections(pool([{ id: '10', num: '5.3', name: 'Tile Installation',
  actions: [{ localId: 'a4', kind: 'resolve', body: '' }] }]), live, opts);
assert(r.refusals.length === 1 && r.refusals[0].reason === 'not-rejected',
  'resolving something not rejected is refused');

r = C.planRejections(pool([{ id: '10', num: '5.3', name: 'Tile Installation',
  actions: [{ localId: 'a5', kind: 'reject', body: '   ' }] }]), live, opts);
assert(r.refusals.length === 1 && r.refusals[0].reason === 'reason-required',
  'a whitespace-only rejection reason is refused by the CORE, not only by the UI');

r = C.planRejections(pool([{ id: '10', num: '5.3', name: 'Tile Installation',
  actions: [{ localId: 'a6', kind: 'comment', body: '' }] }]), live, opts);
assert(r.refusals.length === 1 && r.refusals[0].reason === 'body-required',
  'an empty comment is refused');

// --- Resolve ---------------------------------------------------------------
r = C.planRejections(pool([{ id: '12', num: '6.1', name: 'Equipment Installation',
  actions: [{ localId: 'a7', kind: 'resolve', body: 'fixed and re-checked' }] }]), live, opts);
assert(r.ops.length === 1, 'resolve produces one op');
assert(r.ops[0].patch.fields.Rejected === false, 'resolve clears Rejected');
assert(r.ops[0].patch.fields.RejectedReason === null, 'resolve clears the reason');
assert(!('RejectedOn' in r.ops[0].patch.fields), 'resolve KEEPS RejectedOn as history');
assert(!('InstallerSignOff' in r.ops[0].patch.fields), 'resolve signs nothing off');
assert(r.ops[0].post.Kind === 'Resolved', 'the comment row is Kind=Resolved');

r = C.planRejections(pool([{ id: '12', num: '6.1', name: 'Equipment Installation',
  actions: [{ localId: 'a8', kind: 'resolve', body: '' }] }]), live, opts);
assert(r.ops.length === 1 && r.ops[0].post.Body === '',
  'a resolve with no note is allowed, unlike a comment or a rejection');

// --- Comment ---------------------------------------------------------------
r = C.planRejections(pool([{ id: '11', num: '5.4', name: 'Coping Installation',
  actions: [{ localId: 'a9', kind: 'comment', body: 'waiting on materials' }] }]), live, opts);
assert(r.ops.length === 1 && r.ops[0].patch === null,
  'a comment writes NOTHING to the assignment row');
assert(r.ops[0].post.Kind === 'Comment' && r.ops[0].post.Body === 'waiting on materials',
  'the comment body goes through');

// --- Identity and missing rows --------------------------------------------
r = C.planRejections(pool([{ id: '999', num: '5.3', name: 'Gone',
  actions: [{ localId: 'b1', kind: 'comment', body: 'x' }] }]), live, opts);
assert(r.errors.length === 1 && r.errors[0].reason === 'row-missing', 'a missing row is an error');

r = C.planRejections(pool([{ id: '10', num: '5.9', name: 'Wrong',
  actions: [{ localId: 'b2', kind: 'comment', body: 'x' }] }]), live, opts);
assert(r.errors.length === 1 && r.errors[0].reason === 'identity-mismatch',
  'the live Title must match jobno and num before anything is written');

// A 2.1 action must never land on a 2.10 row: titleMatches is token-anchored.
assert(C.titleMatches('D2-1042 2.10 Something', 'D2-1042', '2.1') === false,
  'titleMatches stays token-anchored for rejections too');

// --- Ordering across many actions on one section --------------------------
r = C.planRejections(pool([{ id: '10', num: '5.3', name: 'Tile Installation', actions: [
  { localId: 'c1', kind: 'comment', body: 'first' },
  { localId: 'c2', kind: 'reject',  body: 'second' }
] }]), live, opts);
assert(r.ops.length === 2 && r.ops[0].localId === 'c1' && r.ops[1].localId === 'c2',
  'ops keep the order the PM queued them in');

console.log('core rejection assertions passed: ' + PASS);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node fixtures/planner/rejections.js`
Expected: FAIL, `C.planRejections is not a function`.

- [ ] **Step 3: Implement `appendRejected` and `planRejections`**

In `web/writeback-core.js`, beside `appendReopen`:

```js
  /* Same shape and separator as appendReopen, because both land in the same
     SignOffNotes column and are read by the same person. A rejection IS a
     reopen with a reason on it, so it says who rejected, who had signed, and
     why, in Central time. */
  function appendRejected(existing, who, nowIso, wasSignedBy, reason) {
    var line = 'REJECTED ' + centralStamp(nowIso) + ' by ' + who
      + (wasSignedBy ? ' (was signed by ' + wasSignedBy + ')' : '')
      + ': ' + reason;
    var prev = existing == null ? '' : String(existing);
    return prev ? prev + '  |  ' + line : line;
  }
```

Then, after `planSignoffs`:

```js
  /* Rejections, resolutions and plain comments.
     A SEPARATE path from planSignoffs and planEdits, for the same reason
     planSignoffs is separate: the write is not a field diff. A rejection is an
     action a PM takes once, with a reason attached, and it produces TWO writes
     on two lists that must land in order. Routing it through FIELD_DEFS would
     have meant inventing a from/to for something that has neither.

     Compare-before-write is against the live ROW STATE, not against a loaded
     baseline, so rejection state never enters s.base. */
  function planRejections(pools, liveById, opts) {
    opts = opts || {};
    var userName = opts.userName || 'the planner';
    var names = opts.userNamesById || {};
    var nowIso = opts.nowIso
      || new Date(opts.nowMs == null ? Date.now() : opts.nowMs).toISOString();
    var stamp = suppressUntil(opts.nowMs == null ? Date.parse(nowIso) : opts.nowMs,
                              opts.suppressMinutes == null ? 10 : opts.suppressMinutes);
    var ops = [], refusals = [], errors = [];

    (pools || []).forEach(function (p) {
      (p.sections || []).forEach(function (sec) {
        var id = String(sec.id);
        var live = liveById && liveById[id];

        (sec.actions || []).forEach(function (a) {
          var where = { localId: a.localId, kind: a.kind, id: id,
                        jobno: p.jobno, num: sec.num, name: sec.name };
          if (!live) { errors.push(Object.assign({}, where, { reason: 'row-missing' })); return; }
          if (!titleMatches(live.Title, p.jobno, sec.num)) {
            errors.push(Object.assign({}, where,
              { reason: 'identity-mismatch', liveTitle: live.Title }));
            return;
          }

          var body = a.body == null ? '' : String(a.body).trim();
          var post = { Title: p.jobno + ' ' + sec.num, AssignmentLookupId: id,
                       Kind: null, Body: body };
          var fields = null;

          if (a.kind === 'reject') {
            if (!body) { refusals.push(Object.assign({}, where, { reason: 'reason-required' })); return; }
            if (!live.InstallerSignOff) {
              refusals.push(Object.assign({}, where, { reason: 'not-signed' })); return;
            }
            if (live.Rejected) {
              refusals.push(Object.assign({}, where,
                { reason: 'already-rejected', liveReason: live.RejectedReason || null })); return;
            }
            var signerId = live.InstallerSignOffByLookupId;
            var wasSignedBy = signerId == null ? null : (names[String(signerId)] || 'unknown');
            fields = {
              InstallerSignOff: false,
              InstallerSignOffByLookupId: null,
              InstallerSignOffOn: null,
              SignOffNotes: appendRejected(live.SignOffNotes, userName, nowIso, wasSignedBy, body),
              Rejected: true,
              RejectedOn: nowIso,
              RejectedReason: body
            };
            post.Kind = 'Rejected';

          } else if (a.kind === 'resolve') {
            if (!live.Rejected) {
              refusals.push(Object.assign({}, where, { reason: 'not-rejected' })); return;
            }
            /* RejectedOn is deliberately left in place. It is when the problem
               was raised, which stays true after it is fixed. */
            fields = { Rejected: false, RejectedReason: null };
            post.Kind = 'Resolved';

          } else if (a.kind === 'comment') {
            if (!body) { refusals.push(Object.assign({}, where, { reason: 'body-required' })); return; }
            post.Kind = 'Comment';

          } else {
            errors.push(Object.assign({}, where, { reason: 'unknown-kind' })); return;
          }

          ops.push({
            localId: a.localId, kind: a.kind, id: id, jobno: p.jobno, num: sec.num,
            name: sec.name, title: live.Title,
            patch: fields ? { id: id, fields: fields, suppressUntil: stamp } : null,
            post: post
          });
        });
      });
    });
    return { ops: ops, refusals: refusals, errors: errors };
  }
```

Add to the returned object at the bottom of the module:

```js
    planRejections: planRejections, appendRejected: appendRejected,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node fixtures/planner/rejections.js`
Expected: PASS, `core rejection assertions passed: 31`.

Then confirm nothing else broke: `node fixtures/planner/writeback-core.js && node fixtures/planner/signoff-push.js && node fixtures/planner/writeback-parity.js`
Expected: all PASS. `writeback-parity.js` asserts the allowlist agrees across three copies; `planRejections` adds no allowlist entry, so it must still pass untouched. If it fails, the allowlist was widened by mistake.

- [ ] **Step 5: Add the harness to `package.json`**

The `test` script currently runs only 7 of the harnesses. Append `rejections.js`:

```json
"test": "node oracle-test.js && node fixtures/planner/determinism.js && node fixtures/planner/roundtrip.js && node fixtures/planner/empty.js && node fixtures/planner/live-export.js && node fixtures/planner/signin.js && node fixtures/planner/office-views.js && node fixtures/planner/rejections.js"
```

- [ ] **Step 6: Mutation sweep**

Add to `fixtures/planner/rejections.mutations.json`:

```json
  "web/writeback-core.js": [
    {"label": "reject does not check the sign-off is live",
     "find": "            if (!live.InstallerSignOff) {\n              refusals.push(Object.assign({}, where, { reason: 'not-signed' })); return;\n            }",
     "replace": ""},
    {"label": "reject does not check for an existing rejection",
     "find": "            if (live.Rejected) {",
     "replace": "            if (false) {"},
    {"label": "resolve does not check the row is rejected",
     "find": "            if (!live.Rejected) {\n              refusals.push(Object.assign({}, where, { reason: 'not-rejected' })); return;\n            }",
     "replace": ""},
    {"label": "an empty rejection reason is accepted",
     "find": "            if (!body) { refusals.push(Object.assign({}, where, { reason: 'reason-required' })); return; }",
     "replace": ""},
    {"label": "resolve wipes RejectedOn instead of keeping it",
     "find": "            fields = { Rejected: false, RejectedReason: null };",
     "replace": "            fields = { Rejected: false, RejectedReason: null, RejectedOn: null };"},
    {"label": "a comment writes to the assignment row",
     "find": "            post.Kind = 'Comment';",
     "replace": "            post.Kind = 'Comment'; fields = { Rejected: false };"},
    {"label": "the patch carries no suppression stamp",
     "find": "patch: fields ? { id: id, fields: fields, suppressUntil: stamp } : null,",
     "replace": "patch: fields ? { id: id, fields: fields } : null,"},
    {"label": "the notes line is not appended",
     "find": "              SignOffNotes: appendRejected(live.SignOffNotes, userName, nowIso, wasSignedBy, body),",
     "replace": ""},
    {"label": "identity is not checked",
     "find": "          if (!titleMatches(live.Title, p.jobno, sec.num)) {",
     "replace": "          if (false) {"}
  ]
```

Run: `python fixtures/planner/mutate.py fixtures/planner/rejections.js web/writeback-core.js --json fixtures/planner/rejections.mutations.json`
Expected: **9 of 9 red.**

- [ ] **Step 7: Commit**

```bash
git add web/writeback-core.js fixtures/planner/rejections.js fixtures/planner/rejections.mutations.json package.json
git commit -m "Add planRejections: reject, resolve and comment, with compare-before-write"
```

---

## Task 4: A rejection in the same Save counts as a reopen for task ticks

Without this, a PM who rejects a sub-phase and ticks its tasks in one Save has every tick refused as `signed-off`, which is the exact interaction the spec calls out.

**Files:**
- Modify: `web/writeback-core.js` (`planTaskTicks`, one expression)
- Modify: `fixtures/planner/rejections.js`

**Interfaces:**
- Consumes: `planRejections` from Task 3 (only conceptually; no call).
- Produces: `planTaskTicks` accepts `sec.rejecting === true` as satisfying the reopen condition. The planner sets that flag in Task 8.

- [ ] **Step 1: Write the failing test**

Append to `fixtures/planner/rejections.js`:

```js
/* A rejection IS a reopen. planTaskTicks refuses a tick on a sub-phase
   SharePoint holds as signed unless the same save reopens it; a rejection
   reopens it, so the ticks that fix the problem must land in the same Save. */
const liveTasks = { '501': { id: '501', Complete: false, NotApplicable: false, AssignmentLookupId: '10' } };
const tickPool = (extra) => [{ jobno: 'D2-1042', name: 'Reyes Residence', sections: [
  Object.assign({ id: '10', num: '5.3', name: 'Tile Installation', tasks: [
    { id: '501', title: 'Waterline tile layout',
      from: { done: false, na: false, note: '' }, to: { done: true, na: false, note: '' } }
  ] }, extra)
] }];
const tickOpts = { userLookupId: '16', userName: 'Don Borgeson',
                   nowIso: NOW, liveAsgById: live };

let t = C.planTaskTicks(tickPool({}), liveTasks, tickOpts);
assert(t.writes.length === 0 && t.refusals.length === 1 && t.refusals[0].reason === 'signed-off',
  'baseline: a tick on a signed sub-phase is refused');

t = C.planTaskTicks(tickPool({ inst: { from: true, to: false } }), liveTasks, tickOpts);
assert(t.writes.length === 1, 'baseline: an explicit un-tick of INST in the same save allows the tick');

t = C.planTaskTicks(tickPool({ rejecting: true }), liveTasks, tickOpts);
assert(t.writes.length === 1 && t.refusals.length === 0,
  'a rejection in the same save allows the tick, got ' + t.refusals.length + ' refusals');

/* And it is one reopen, not two: a rejection alongside an explicit INST
   un-tick must not produce two audit lines. That is asserted on the notes in
   Task 8, where both sets are built together; here only the tick is checked. */
t = C.planTaskTicks(tickPool({ rejecting: true, inst: { from: true, to: false } }), liveTasks, tickOpts);
assert(t.writes.length === 1, 'rejection plus an INST un-tick still allows the tick');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node fixtures/planner/rejections.js`
Expected: FAIL on `a rejection in the same save allows the tick`, reporting 1 refusal.

- [ ] **Step 3: Implement**

In `web/writeback-core.js`, `planTaskTicks`, change exactly this expression:

```js
        var lockedBySignoff = !!(liveRow && liveRow.InstallerSignOff)
          && !(sec.inst && sec.inst.to === false);
```

to:

```js
        /* A rejection reopens the sub-phase, so it satisfies this the same way
           an explicit INST un-tick does. Without it a PM who rejects and ticks
           the fix in one Save has every tick refused. */
        var lockedBySignoff = !!(liveRow && liveRow.InstallerSignOff)
          && !(sec.inst && sec.inst.to === false)
          && !sec.rejecting;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node fixtures/planner/rejections.js`
Expected: PASS.
Then: `node fixtures/planner/signoff-push.js` — expected PASS, since no existing section carries `rejecting`.

- [ ] **Step 5: Mutation sweep**

Add to the `web/writeback-core.js` list in `rejections.mutations.json`:

```json
    {"label": "a rejection does not unlock the checklist",
     "find": "          && !sec.rejecting;",
     "replace": "          ;"}
```

Run the sweep again. Expected: **10 of 10 red.**

- [ ] **Step 6: Commit**

```bash
git add web/writeback-core.js fixtures/planner/rejections.js fixtures/planner/rejections.mutations.json
git commit -m "Treat a rejection as a reopen so ticks in the same save are not refused"
```

---

## Task 5: Graph write shapes, `commentBody` and `applyRejectionOps`

**Files:**
- Modify: `web/graph-writeback.js`
- Modify: `fixtures/planner/graph-write.js`

**Interfaces:**
- Consumes: ops from `planRejections` (Task 3).
- Produces:

```js
commentBody(post) -> { fields: { Title, AssignmentLookupId, Kind, Body } }
applyRejectionOps(ctx, ops) -> Promise<{ done, failed }>
```

`ctx`: `{token, siteId, asgListId, commentsListId}`.
`done`: `[{localId, kind, id, commentId}]`. `failed`: `[{localId, kind, id, stage:'patch'|'post', status, message}]`.

- [ ] **Step 1: Write the failing test**

Append to `fixtures/planner/graph-write.js`:

```js
/* The comment POST body and the PATCH-then-POST order. A POST that fires after
   a failed PATCH records a rejection that never happened, which is worse than
   no record at all. */
const posted = [], patched = [];
let failNextPatch = false, failNextPost = false;
global.fetch = async (url, init) => {
  const body = init.body ? JSON.parse(init.body) : null;
  if (init.method === 'PATCH') {
    patched.push({ url, body });
    if (failNextPatch) return { ok: false, status: 400, text: async () => 'patch blew up' };
    return { ok: true, status: 200, json: async () => ({ id: '10' }) };
  }
  posted.push({ url, body });
  if (failNextPost) return { ok: false, status: 400, text: async () => 'post blew up' };
  return { ok: true, status: 201, json: async () => ({ id: '77' }) };
};

const GW = require('../../web/graph-writeback.js');
const ctx = { token: 't', siteId: 'site1', asgListId: 'ASG', commentsListId: 'CMT' };

// The POST body: no SuppressReconcileUntil anywhere. That column does not exist
// on this list and sending it fails the PATCH outright on Tasks; do not invent
// it here either.
const cb = GW.commentBody({ Title: 'D2-1042 5.3', AssignmentLookupId: '10',
                            Kind: 'Rejected', Body: 'tile line short' });
assert(cb.fields && cb.fields.Kind === 'Rejected', 'the body nests under fields');
assert(cb.fields.AssignmentLookupId === '10', 'the lookup is sent as AssignmentLookupId');
assert(!('SuppressReconcileUntil' in cb.fields), 'no suppression column on the comments list');
assert(Object.keys(cb.fields).sort().join(',') === 'AssignmentLookupId,Body,Kind,Title',
  'exactly four fields, got ' + Object.keys(cb.fields).sort().join(','));

// A reject: PATCH first, POST second, both to the right lists.
patched.length = 0; posted.length = 0;
let res = await GW.applyRejectionOps(ctx, [{
  localId: 'a1', kind: 'reject', id: '10',
  patch: { id: '10', fields: { Rejected: true }, suppressUntil: '2026-09-22T17:15:00Z' },
  post: { Title: 'D2-1042 5.3', AssignmentLookupId: '10', Kind: 'Rejected', Body: 'x' }
}]);
assert(patched.length === 1 && posted.length === 1, 'one PATCH and one POST');
assert(patched[0].url.indexOf('/lists/ASG/items/10/fields') > -1,
  'the PATCH goes to the Assignments row fields, got ' + patched[0].url);
assert(patched[0].body.SuppressReconcileUntil === '2026-09-22T17:15:00Z',
  'the suppression stamp rides the Assignments PATCH');
assert(posted[0].url.indexOf('/lists/CMT/items') > -1, 'the POST goes to the comments list');
assert(res.done.length === 1 && res.done[0].commentId === '77', 'the new comment id comes back');
assert(res.failed.length === 0, 'nothing failed');

// A comment: POST only, no PATCH.
patched.length = 0; posted.length = 0;
res = await GW.applyRejectionOps(ctx, [{ localId: 'a2', kind: 'comment', id: '11', patch: null,
  post: { Title: 'D2-1042 5.4', AssignmentLookupId: '11', Kind: 'Comment', Body: 'waiting' } }]);
assert(patched.length === 0 && posted.length === 1, 'a comment PATCHes nothing');

// A failed PATCH must NOT post.
patched.length = 0; posted.length = 0; failNextPatch = true;
res = await GW.applyRejectionOps(ctx, [{ localId: 'a3', kind: 'reject', id: '10',
  patch: { id: '10', fields: { Rejected: true }, suppressUntil: 'z' },
  post: { Title: 'D2-1042 5.3', AssignmentLookupId: '10', Kind: 'Rejected', Body: 'x' } }]);
failNextPatch = false;
assert(posted.length === 0, 'a failed PATCH does not post a comment');
assert(res.failed.length === 1 && res.failed[0].stage === 'patch', 'the failure names the patch stage');
assert(res.done.length === 0, 'nothing is reported done');

// A failed POST after a good PATCH is reported, and says the row did change.
patched.length = 0; posted.length = 0; failNextPost = true;
res = await GW.applyRejectionOps(ctx, [{ localId: 'a4', kind: 'reject', id: '10',
  patch: { id: '10', fields: { Rejected: true }, suppressUntil: 'z' },
  post: { Title: 'D2-1042 5.3', AssignmentLookupId: '10', Kind: 'Rejected', Body: 'x' } }]);
failNextPost = false;
assert(patched.length === 1 && res.failed.length === 1 && res.failed[0].stage === 'post',
  'a failed POST after a good PATCH is reported at the post stage');
assert(res.failed[0].patched === true, 'and it records that the row WAS changed');

// One bad op does not stop the next.
patched.length = 0; posted.length = 0;
res = await GW.applyRejectionOps(ctx, [
  { localId: 'b1', kind: 'comment', id: '999', patch: null,
    post: { Title: 'x', AssignmentLookupId: '999', Kind: 'Comment', Body: 'a' } },
  { localId: 'b2', kind: 'comment', id: '11', patch: null,
    post: { Title: 'y', AssignmentLookupId: '11', Kind: 'Comment', Body: 'b' } }
]);
assert(res.done.length === 2, 'both ops are attempted, got ' + res.done.length);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node fixtures/planner/graph-write.js`
Expected: FAIL, `GW.commentBody is not a function`.

- [ ] **Step 3: Implement**

In `web/graph-writeback.js`, beside `patchBody`:

```js
  /* The comments list carries no SuppressReconcileUntil column. Sending a
     column a list does not have fails the write outright, which is how the
     Tasks list taught this. Four fields, nothing else. */
  function commentBody(post) {
    return { fields: {
      Title: post.Title,
      AssignmentLookupId: String(post.AssignmentLookupId),
      Kind: post.Kind,
      Body: post.Body == null ? '' : post.Body
    } };
  }

  /* PATCH the assignment, then POST the comment, and POST only if the PATCH
     succeeded. A comment row saying "rejected, because X" beside an assignment
     that was never reopened is a record of something that did not happen.
     Sequential on purpose: these are few, and ordering is the point. */
  async function applyRejectionOps(ctx, ops) {
    var done = [], failed = [];
    for (var i = 0; i < (ops || []).length; i++) {
      var op = ops[i];
      if (op.patch) {
        var pb = patchBody(op.patch);
        var pr = await fetch(urls(ctx.siteId).fields(ctx.asgListId, op.patch.id), {
          method: 'PATCH', headers: headers(ctx.token), body: JSON.stringify(pb)
        });
        if (!pr.ok) {
          failed.push({ localId: op.localId, kind: op.kind, id: op.id, stage: 'patch',
                        status: pr.status, message: await pr.text() });
          continue;
        }
      }
      var cr = await fetch(urls(ctx.siteId).items(ctx.commentsListId), {
        method: 'POST', headers: headers(ctx.token), body: JSON.stringify(commentBody(op.post))
      });
      if (!cr.ok) {
        failed.push({ localId: op.localId, kind: op.kind, id: op.id, stage: 'post',
                      status: cr.status, message: await cr.text(), patched: !!op.patch });
        continue;
      }
      var row = await cr.json();
      done.push({ localId: op.localId, kind: op.kind, id: op.id,
                  commentId: row && row.id == null ? null : String(row.id) });
    }
    return { done: done, failed: failed };
  }
```

Add both to the returned object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node fixtures/planner/graph-write.js`
Expected: PASS.

- [ ] **Step 5: Mutation sweep**

Add to `rejections.mutations.json`:

```json
  "web/graph-writeback.js": [
    {"label": "POST fires even when the PATCH failed",
     "find": "          continue;\n        }\n      }\n      var cr = await fetch(urls(ctx.siteId).items(ctx.commentsListId), {",
     "replace": "        }\n      }\n      var cr = await fetch(urls(ctx.siteId).items(ctx.commentsListId), {"},
    {"label": "the lookup id is not stringified",
     "find": "      AssignmentLookupId: String(post.AssignmentLookupId),",
     "replace": "      AssignmentLookupId: post.AssignmentLookupId,"},
    {"label": "a suppression column is sent to the comments list",
     "find": "      Body: post.Body == null ? '' : post.Body\n    } };",
     "replace": "      Body: post.Body == null ? '' : post.Body,\n      SuppressReconcileUntil: new Date().toISOString()\n    } };"}
  ]
```

Run: `python fixtures/planner/mutate.py fixtures/planner/graph-write.js web/graph-writeback.js --json fixtures/planner/rejections.mutations.json`
Expected: **3 of 3 red.**

- [ ] **Step 6: Commit**

```bash
git add web/graph-writeback.js fixtures/planner/graph-write.js fixtures/planner/rejections.mutations.json
git commit -m "Add the comment POST body and the PATCH-then-POST walk"
```

---

## Task 6: Refresh reads the comments list without being able to break Refresh

**Files:**
- Modify: `web/index.html` (`D2_GRAPH.lists`, `loadFromD2ViaGraph`, `importFromD2Payload`)
- Modify: `fixtures/planner/rejections.js`

**Interfaces:**
- Consumes: the list GUID from Task 1, the mapping from Task 2.
- Produces: after a Refresh, every section carries `s.rejected`, `s.rejectedOn`, `s.rejectedReason` and `s.thread`. `s.base` is **unchanged**.

- [ ] **Step 1: Write the failing test**

Append to `fixtures/planner/rejections.js`, in the jsdom section (follow the `signoff-push.js` pattern: load the real page, inline the scripts, stub only `fetch`).

```js
/* Refresh brings rejection state and the thread onto the sections, and a
   failing comments read costs only the comments. The comments list must NOT
   ride the Promise.all over D2_GRAPH.lists: that loop has no per-key catch, so
   one failing list fails the entire Refresh and a PM loses the schedule over a
   feature they were not using. */
const payload = {
  kind: 'd2-sharepoint-export', exported: '2026-09-22', jobs: [{
    jobno: 'D2-1042', name: 'Reyes Residence', status: 'Active', start: '2026-09-08',
    sections: [{ num: '5.3', id: 10, seq: 1, crewId: 'cirilo', start: '2026-10-05', days: 2,
      inst: true, pm: false, locked: false, skip: false,
      rejected: true, rejectedOn: '2026-09-20T14:05:00Z', rejectedReason: 'coping joints uneven',
      thread: [{ id: '1', kind: 'Rejected', body: 'coping joints uneven',
                 by: 'Don Borgeson', at: '2026-09-20T14:05:00Z' }],
      tasks: [] }]
  }]
};
win.importFromD2Payload(payload, true);
const s = win.allSecs(win.S.jobs.find(j => j.jobno === 'D2-1042'))[0].s;
assert(s.rejected === true, 'rejected lands on the section');
assert(s.rejectedReason === 'coping joints uneven', 'the reason lands');
assert(s.thread.length === 1 && s.thread[0].by === 'Don Borgeson', 'the thread lands');

/* The fence that matters: base must not have grown. freshness.js pins this
   too, and this assertion states WHY it is being left alone here. */
assert(Object.keys(s.base).sort().join(',') === 'crewId,days,id,inst,locked,pm,seq,skip,spLocked,start',
  'rejection state is NOT in s.base, got ' + Object.keys(s.base).sort().join(','));

/* A second Refresh with no comments key must clear the thread rather than keep
   a stale one: the entries may have been deleted on the site. */
const noThread = JSON.parse(JSON.stringify(payload));
delete noThread.jobs[0].sections[0].thread;
noThread.jobs[0].sections[0].rejected = false;
win.importFromD2Payload(noThread, true);
const s2 = win.allSecs(win.S.jobs.find(j => j.jobno === 'D2-1042'))[0].s;
assert(s2.thread.length === 0, 'a payload with no thread clears it, got ' + s2.thread.length);
assert(s2.rejected === false, 'rejected clears too');

/* And the config wiring: comments must be reachable but must not be in the
   list keys Refresh Promise.all's over. */
assert(typeof win.D2_GRAPH.commentsList === 'string' && win.D2_GRAPH.commentsList.length > 10,
  'the comments list GUID is configured');
assert(!('comments' in win.D2_GRAPH.lists),
  'comments is NOT in D2_GRAPH.lists, so a failing comments read cannot fail Refresh');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node fixtures/planner/rejections.js`
Expected: FAIL on `rejected lands on the section` (undefined).

- [ ] **Step 3: Implement the config**

In `web/index.html`, inside `D2_GRAPH`, **beside** `lists` rather than inside it:

```js
  // Deliberately NOT in `lists`. loadFromD2ViaGraph Promise.all's over every
  // key in `lists` with no per-key catch, so a list that 404s there fails the
  // whole Refresh. Comments are read separately, with their own catch, the same
  // as the user list: a PM opened this page for the schedule.
  commentsList: '<GUID FROM TASK 1 STEP 5>',
  lists:{ ... unchanged ... }
```

- [ ] **Step 4: Implement the read**

In `loadFromD2ViaGraph`, after the `users` read:

```js
  /* Comments, with their own catch. An unreadable comments list costs the
     thread and nothing else. */
  graphPayload.comments = D2_GRAPH.commentsList
    ? await graphPageAll(base + D2_GRAPH.commentsList + '/items?$expand=fields&$top=999', tok)
        .catch(()=>[])
    : [];
```

`$top=999` because the thread grows without bound, unlike the 46-row lists; `graphPageAll` follows `@odata.nextLink` regardless.

- [ ] **Step 5: Implement the section state**

In `importFromD2Payload`, in the per-section block beside `s.inst=!!is.inst;`:

```js
        s.rejected=!!is.rejected;
        s.rejectedOn=is.rejectedOn||null;
        s.rejectedReason=is.rejectedReason||null;
        /* Replaced, never merged. An entry deleted on the site must disappear
           here on the next Refresh rather than linger. */
        s.thread=Array.isArray(is.thread)?is.thread:[];
```

Leave the `s.base={...}` assignment alone.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node fixtures/planner/rejections.js` — expected PASS.
Then: `node fixtures/planner/freshness.js && node fixtures/planner/roundtrip.js && node fixtures/planner/graph-read.js` — expected all PASS. `freshness.js` failing here means `s.base` was widened.

- [ ] **Step 7: Mutation sweep**

Add to `rejections.mutations.json` under `web/index.html`:

```json
  "web/index.html": [
    {"label": "the thread is merged rather than replaced, so deleted entries linger",
     "find": "        s.thread=Array.isArray(is.thread)?is.thread:[];",
     "replace": "        if(Array.isArray(is.thread)&&is.thread.length)s.thread=is.thread; else s.thread=s.thread||[];"},
    {"label": "the comments read has no catch, so it can fail Refresh",
     "find": "        .catch(()=>[])",
     "replace": ""}
  ]
```

Run: `python fixtures/planner/mutate.py fixtures/planner/rejections.js web/index.html --json fixtures/planner/rejections.mutations.json`
Expected: both red. The second needs an assertion that drives a failing comments read; if the harness does not reach `loadFromD2ViaGraph`, add one that stubs `fetch` to 500 on the comments URL and asserts the schedule still loaded.

- [ ] **Step 8: Commit**

```bash
git add web/index.html fixtures/planner/rejections.js fixtures/planner/rejections.mutations.json
git commit -m "Read the sign-off comments list on Refresh, without letting it break Refresh"
```

---

## Task 7: The drawer thread, the three controls, and the queue

**Files:**
- Modify: `web/index.html` (`editSec`, new `queueComment` / `queueReject` / `queueResolve` / `unqueueEntry`, `load()`)
- Modify: `fixtures/planner/rejections.js`

**Interfaces:**
- Consumes: `s.thread`, `s.rejected` from Task 6.
- Produces: `S.pendingComments` = `[{localId, jobno, num, secId, kind, body, at}]`, persisted by `save()`. Consumed by Task 8's `buildRejectionSet`.

- [ ] **Step 1: Write the failing test**

Append to `fixtures/planner/rejections.js`:

```js
/* The drawer. Three controls, one queue, and every PM-typed string escaped.
   The injection probe starts </option></select> because the parser drops a
   bare <svg> in select context: an earlier probe passed with three names
   unescaped for exactly that reason. */
win.S.pendingComments = [];
win.editSec(job.id, 0, 0);
let html = win.document.getElementById('dBody').innerHTML;
assert(/Comments/.test(html), 'the drawer has a Comments section');
assert(/Don Borgeson/.test(html), 'the thread shows the author');
assert(/Add comment/.test(html), 'there is an Add comment control');
assert(/Mark resolved/.test(html), 'a rejected sub-phase offers Mark resolved');
assert(!/Reject sign-off/.test(html), 'a sub-phase whose sign-off was cleared does not offer Reject');

// Reject is offered only while INST is ticked.
const s3 = win.allSecs(job)[0].s;
s3.inst = true; s3.rejected = false; s3.thread = [];
win.editSec(job.id, 0, 0);
html = win.document.getElementById('dBody').innerHTML;
assert(/Reject sign-off/.test(html), 'a signed sub-phase offers Reject sign-off');
assert(!/Mark resolved/.test(html), 'an unrejected sub-phase does not offer Mark resolved');

// A reject with an empty box refuses and queues nothing.
win.document.getElementById('fComment').value = '   ';
const alerts = [];
win.alert = m => alerts.push(m);
win.queueReject();
assert(win.S.pendingComments.length === 0, 'an empty reason queues nothing');
assert(alerts.length === 1 && /reason/i.test(alerts[0]), 'and it says a reason is required');

// A real reject queues, un-ticks INST on screen, and unlocks the checklist.
win.document.getElementById('fComment').value = 'tile line is short';
win.queueReject();
assert(win.S.pendingComments.length === 1, 'the reject is queued');
assert(win.S.pendingComments[0].kind === 'reject', 'queued as a reject');
assert(win.S.pendingComments[0].body === 'tile line is short', 'the reason is queued');
assert(win.S.pendingComments[0].secId === String(s3.base.id), 'queued against the SharePoint row id');
assert(s3.inst === false, 'rejecting un-ticks INST on screen so the checklist unlocks');

// Queued entries render as not saved, and are removable.
win.editSec(job.id, 0, 0);
html = win.document.getElementById('dBody').innerHTML;
assert(/Not saved yet/.test(html), 'a queued entry says it is not saved yet');
win.unqueueEntry(win.S.pendingComments[0].localId);
assert(win.S.pendingComments.length === 0, 'a queued entry can be removed before saving');

// Escaping, on both the live thread and a queued entry.
const PROBE = '</option></select><svg id="xss-probe"><用/svg>';
s3.thread = [{ id: '9', kind: 'Comment', body: PROBE, by: PROBE, at: '2026-09-21T10:00:00Z' }];
win.S.pendingComments = [{ localId: 'q1', jobno: 'D2-1042', num: '5.3', secId: String(s3.base.id),
                           kind: 'comment', body: PROBE, at: '2026-09-22T10:00:00Z' }];
win.editSec(job.id, 0, 0);
assert(win.document.getElementById('xss-probe') === null,
  'a comment body cannot inject an element, from the live thread or the queue');
assert(win.document.getElementById('dBody').innerHTML.indexOf('&lt;svg') > -1,
  'it is escaped rather than stripped');

// A pool with no SharePoint baseline cannot comment at all.
win.S.pendingComments = [];
const sketch = win.newJob('Local Sketch', '', '', '', '', '2026-10-01');
win.S.jobs.push(sketch);
win.editSec(sketch.id, 0, 0);
html = win.document.getElementById('dBody').innerHTML;
assert(!/Add comment/.test(html), 'a local-only pool offers no comment control');
assert(/not in SharePoint/i.test(html), 'and says why');
```

Add a `file://` case:

```js
/* A downloaded copy cannot write comments, like sign-off. Say so rather than
   offering a control that silently does nothing. */
assert(typeof win.commentsWritable === 'function', 'there is one place that decides this');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node fixtures/planner/rejections.js`
Expected: FAIL on `the drawer has a Comments section`.

- [ ] **Step 3: Implement the queue and the gate**

In `load()`, beside `S.pendingCreates=S.pendingCreates||[]`:

```js
S.pendingComments=S.pendingComments||[];
```

Add, near `poolHasBaseline`:

```js
/* Comments need a SharePoint row to hang off and a Graph token to write with.
   A local sketch has no row; a downloaded copy has no token. Both are told,
   rather than shown a control that does nothing. */
function commentsWritable(j){ return graphModeAvailable() && poolHasBaseline(j); }
```

- [ ] **Step 4: Implement the thread and controls in `editSec`**

Insert before the Checklist block. Every PM-typed value goes through `esc()` at construction.

```js
    ${(()=>{
      const writable=commentsWritable(j), tid=String(s.base&&s.base.id);
      const q=(S.pendingComments||[]).filter(e=>e.secId===tid);
      const label={Comment:'',Rejected:'Rejected',Resolved:'Resolved'};
      const entry=(e,pending)=>`<div class="cmt${pending?' pending':''}">
        <div class="small muted">${esc(e.by||(pending?'You':''))} · ${pending?'Not saved yet':esc(cmtWhen(e.at))}
          ${label[e.kind==='reject'?'Rejected':e.kind==='resolve'?'Resolved':e.kind]
            ?`<span class="chip">${esc(label[e.kind==='reject'?'Rejected':e.kind==='resolve'?'Resolved':e.kind])}</span>`:''}
          ${pending?`<a href="#" class="small" onclick="unqueueEntry('${esc(e.localId)}');return false">remove</a>`:''}</div>
        <div>${esc(e.body||'')}</div></div>`;
      return `<div class="fld"><label>Comments${s.rejected?' — <span class="chip warn">Rejected</span>':''}</label>
        ${s.rejected&&s.rejectedReason?`<div class="hint">${esc(s.rejectedReason)}</div>`:''}
        <div id="thread">${(s.thread||[]).map(e=>entry(e,false)).join('')
          +q.map(e=>entry(e,true)).join('')
          ||'<span class="muted small">No comments yet.</span>'}</div>
        ${writable?`<textarea id="fComment" rows="3" placeholder="Add a comment, or give a reason for rejecting"></textarea>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            <button class="btn" onclick="queueComment()">Add comment</button>
            ${s.inst?`<button class="btn" onclick="queueReject()" title="Clears the installer sign-off and records why. Saved when you press Save.">Reject sign-off</button>`:''}
            ${s.rejected?`<button class="btn" onclick="queueResolve()" title="Marks the rejection dealt with. Saved when you press Save.">Mark resolved</button>`:''}
          </div>
          <div class="hint">Comments are saved when you press Save at the top.</div>`
        :`<div class="hint">${graphModeAvailable()?'This pool is not in SharePoint yet, so comments cannot be saved.'
            :'This copy cannot save comments. Open the planner from the site to comment.'}</div>`}
      </div>`;
    })()}
```

Add the helpers:

```js
function cmtWhen(iso){
  if(!iso)return '';
  try{const p={};new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',
    month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(new Date(iso)).forEach(x=>p[x.type]=x.value);
    return p.month+'/'+p.day+'/'+String(p.year).slice(2)+' '+p.hour+':'+p.minute;
  }catch(e){return String(iso).slice(0,16).replace('T',' ')+' UTC';}
}
function queueEntry(kind,body){
  const j=S.jobs.find(x=>x.id===CUR.jobId),s=cur();
  if(!s.base||s.base.id==null)return;
  S.pendingComments.push({localId:'c'+Math.random().toString(36).slice(2,9),
    jobno:j.jobno,num:s.num,secId:String(s.base.id),kind,body,at:new Date().toISOString()});
  save();editSec(CUR.jobId,CUR.gi,CUR.si);render();
}
function commentBox(){const el=document.getElementById('fComment');return el?String(el.value||'').trim():'';}
function queueComment(){
  const b=commentBox();
  if(!b){alert('Type a comment first.');return;}
  queueEntry('comment',b);
}
function queueReject(){
  const b=commentBox();
  if(!b){alert('A reason is required to reject a sign-off. Say what is missing.');return;}
  /* Un-tick INST on screen straight away so the checklist unlocks for the fix.
     Nothing is written until Save; the queued reject is what carries it. */
  cur().inst=false;
  touch(S.jobs.find(x=>x.id===CUR.jobId));
  queueEntry('reject',b);
}
function queueResolve(){ queueEntry('resolve',commentBox()); }
function unqueueEntry(localId){
  S.pendingComments=(S.pendingComments||[]).filter(e=>e.localId!==localId);
  save();editSec(CUR.jobId,CUR.gi,CUR.si);render();
}
```

Add CSS beside the existing `.hint` rules: `.cmt{padding:6px 0;border-top:1px solid var(--rule)} .cmt.pending{opacity:.72}`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node fixtures/planner/rejections.js` — expected PASS.
Then: `node fixtures/planner/escaping.js && node fixtures/planner/honest-copy.js` — expected PASS. `honest-copy.js` pairs each dialog's claim with the behaviour it describes, so the new hint text must be true.

- [ ] **Step 6: Mutation sweep**

Add to the `web/index.html` list:

```json
    {"label": "comment bodies are not escaped",
     "find": "        <div>${esc(e.body||'')}</div></div>`;",
     "replace": "        <div>${e.body||''}</div></div>`;"},
    {"label": "an empty rejection reason is accepted by the UI",
     "find": "  if(!b){alert('A reason is required to reject a sign-off. Say what is missing.');return;}",
     "replace": ""},
    {"label": "rejecting does not un-tick INST, so the checklist stays locked",
     "find": "  cur().inst=false;",
     "replace": ""},
    {"label": "Reject is offered on an unsigned sub-phase",
     "find": "            ${s.inst?`<button class=\"btn\" onclick=\"queueReject()\"",
     "replace": "            ${true?`<button class=\"btn\" onclick=\"queueReject()\""}
```

Expected: all red.

- [ ] **Step 7: Commit**

```bash
git add web/index.html fixtures/planner/rejections.js fixtures/planner/rejections.mutations.json
git commit -m "Add the comment thread and the reject, resolve and comment controls to the sub-phase panel"
```

---

## Task 8: Save counts, previews, sends and reports them

**Files:**
- Modify: `web/index.html` (`buildRejectionSet`, `pushRejections`, `openSavePreview`, `confirmSaveByPush`, `showPushResult`, the Save button label)
- Modify: `fixtures/planner/rejections.js`

**Interfaces:**
- Consumes: `S.pendingComments` (Task 7), `planRejections` (Task 3), `applyRejectionOps` (Task 5).
- Produces: `buildRejectionSet() -> pools` in `planRejections` shape. `pushRejections(siteId, tok, liveById, pools) -> {rPlan, rRes}`. Sections carrying a queued reject also set `rejecting: true` on the matching sign-off-set section, for Task 4.

- [ ] **Step 1: Write the failing test**

Append to `fixtures/planner/rejections.js`:

```js
/* Save. The count, the preview, the order, and the results. The Save button
   once read "Save 0 edits to SharePoint" over eight sign-off changes; a queued
   comment must not repeat that. */
win.S.pendingComments = [
  { localId: 'q1', jobno: 'D2-1042', num: '5.3', secId: '10', kind: 'reject',
    body: 'tile line is short', at: '2026-09-22T10:00:00Z' },
  { localId: 'q2', jobno: 'D2-1042', num: '5.4', secId: '11', kind: 'comment',
    body: 'waiting on materials', at: '2026-09-22T10:01:00Z' }
];
const set = win.buildRejectionSet();
assert(set.length === 1, 'one pool');
assert(set[0].sections.length === 2, 'two sections carry actions');
const sec53 = set[0].sections.find(s => s.num === '5.3');
assert(sec53.id === '10' && sec53.actions[0].kind === 'reject', 'the reject is in the set');
assert(sec53.actions[0].localId === 'q1', 'the localId travels, so a result can name the entry');

// The Save button counts them.
win.render();
const btnText = win.document.querySelector('#saveBtn').textContent;
assert(/3|2/.test(btnText), 'the Save button counts queued comments, got ' + btnText);
assert(!/Save 0/.test(btnText), 'it never says 0 over real queued work');

// The preview says what will happen, in words, not column names.
win.openSavePreview();
const pv = win.document.getElementById('dBody').innerHTML;
assert(/Comments and rejections/i.test(pv), 'the preview has its own section for these');
assert(/Reject 5\.3/i.test(pv), 'it names the reject and the sub-phase, got no match');
assert(/tile line is short/.test(pv), 'and shows the reason');
assert(/Comment on 5\.4/i.test(pv), 'and names the comment');

// A queued reject marks the sign-off set section as rejecting, so ticks land.
const so = win.buildSignoffSet();
const soSec = so.length ? so[0].sections.find(s => String(s.id) === '10') : null;
if (soSec) assert(soSec.rejecting === true, 'the sign-off set marks the section as rejecting');

// Sending: ops go out, and the queue is cleared only for what landed.
const sent = [];
win.fetch = async (url, init) => {
  sent.push({ url, method: init.method });
  if (init.method === 'POST' && /items$/.test(url) && sent.length > 3)
    return { ok: false, status: 400, text: async () => 'nope' };
  return { ok: true, status: 200, json: async () => ({ id: '77' }) };
};
const out = await win.pushRejections('site1', 'tok', {
  '10': { id: '10', Title: 'D2-1042 5.3 Tile Installation', InstallerSignOff: true,
          InstallerSignOffByLookupId: '14', Rejected: false },
  '11': { id: '11', Title: 'D2-1042 5.4 Coping Installation', InstallerSignOff: false, Rejected: false }
}, set);
assert(out.rPlan.ops.length === 2, 'two ops planned');
assert(out.rRes.done.length + out.rRes.failed.length === 2, 'both attempted');

// Results say what happened in words.
win.showPushResult({ rPlan: out.rPlan, rRes: out.rRes }, null);
const rs = win.document.getElementById('dBody').innerHTML;
assert(/rejection/i.test(rs) || /comment/i.test(rs), 'results mention the comments work');
assert(!/RejectedReason/.test(rs), 'results use words, not column names');

// A landed entry leaves the queue; a failed one stays so it can be retried.
assert(!win.S.pendingComments.some(e => out.rRes.done.some(d => d.localId === e.localId)),
  'entries that landed are removed from the queue');
assert(win.S.pendingComments.length === out.rRes.failed.length,
  'entries that failed stay queued, got ' + win.S.pendingComments.length);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node fixtures/planner/rejections.js`
Expected: FAIL, `win.buildRejectionSet is not a function`.

- [ ] **Step 3: Implement `buildRejectionSet`**

Beside `buildSignoffSet`:

```js
/* The queued comment work, grouped the way planRejections wants it. Entries
   whose pool or sub-phase is no longer here are dropped: a Refresh can remove
   a pool, and an entry with nowhere to land would otherwise sit in the queue
   forever being counted. */
function buildRejectionSet(){
  const pools=[];
  (S.pendingComments||[]).forEach(e=>{
    const j=S.jobs.find(x=>String(x.jobno)===String(e.jobno));
    if(!j||!poolHasBaseline(j))return;
    const hit=allSecs(j).find(({s})=>s.base&&String(s.base.id)===String(e.secId));
    if(!hit)return;
    let p=pools.find(x=>x.jobno===j.jobno);
    if(!p){p={jobno:j.jobno,name:j.name,sections:[]};pools.push(p);}
    let sec=p.sections.find(x=>String(x.id)===String(e.secId));
    if(!sec){sec={id:String(e.secId),num:hit.s.num,name:hit.s.name,actions:[]};p.sections.push(sec);}
    sec.actions.push({localId:e.localId,kind:e.kind,body:e.body});
  });
  return pools;
}
const rejectionChangeCount=pools=>pools.reduce((n,p)=>
  n+p.sections.reduce((m,s)=>m+s.actions.length,0),0);
/* Which SharePoint rows this Save rejects, so planTaskTicks treats them as
   reopened and the ticks that fix the problem are not refused. */
function rejectingIds(){
  const out=new Set();
  (S.pendingComments||[]).forEach(e=>{if(e.kind==='reject')out.add(String(e.secId));});
  return out;
}
```

In `buildSignoffSet`, where each section is pushed, add:

```js
        rejecting: rejectingIds().has(String(s.base.id)),
```

and change its early return so a section carrying only a queued reject is still included:

```js
      const rejecting=rejectingIds().has(String(s.base.id));
      if(!instChanged && !pmChanged && !tasks.length && !rejecting)return;
```

- [ ] **Step 4: Implement `pushRejections`**

Beside `pushSignoffs`:

```js
/* Comments, rejections and resolutions. Takes the same fresh Assignments read
   pushChangeSet already did, so compare-before-write here agrees with the rest
   of this Save rather than racing a second read. */
async function pushRejections(siteId,tok,liveById,pools){
  const G=window.D2GraphWriteback, C=window.D2WritebackCore;
  const acct=graphPca().getActiveAccount()||graphPca().getAllAccounts()[0];
  const userName=(acct&&(acct.name||acct.username))||'the planner';
  const uil=await graphPageAll(G.urls(siteId).userInfo,tok).catch(()=>[]);
  const userNamesById={};
  uil.forEach(r=>{if(r.fields&&r.fields.Title)userNamesById[String(r.fields.id)]=r.fields.Title;});

  const rPlan=C.planRejections(pools,liveById,
    {userName,userNamesById,nowIso:new Date().toISOString(),nowMs:Date.now(),suppressMinutes:10});
  const rRes=await G.applyRejectionOps(
    {token:tok,siteId,asgListId:D2_GRAPH.lists.asg,commentsListId:D2_GRAPH.commentsList},
    rPlan.ops);

  /* Clear only what landed. A refused or failed entry stays queued so the PM
     can see the reason and retry, rather than losing what they typed. */
  const gone=new Set(rRes.done.map(d=>String(d.localId)));
  const refused=new Set(rPlan.refusals.map(r=>String(r.localId)));
  S.pendingComments=(S.pendingComments||[]).filter(e=>!gone.has(String(e.localId)));
  save();
  return {rPlan,rRes,refused};
}
```

Wire it into `confirmSaveByPush` after `pushSignoffs`, passing the same `siteId`, `tok` and `liveById`.

- [ ] **Step 5: Implement the count, the preview and the results**

- Save button label: add `rejectionChangeCount(buildRejectionSet())` to the total it already sums.
- `openSavePreview`: add a `Comments and rejections` section, one line per action in words: `Reject 5.3 Tile Installation: <reason>`, `Comment on 5.4 Coping Installation`, `Mark 6.1 Equipment Installation resolved`. Escape every body.
- `showPushResult`: report each entry as saved, refused with the reason in words, or failed. Map reasons to sentences, never column names:

```js
const REJ_WHY={
  'not-signed':'the sub-phase is no longer signed off',
  'already-rejected':'it is already rejected',
  'not-rejected':'it is not currently rejected',
  'reason-required':'a reason is required',
  'body-required':'a comment cannot be empty',
  'row-missing':'that sub-phase is no longer in SharePoint',
  'identity-mismatch':'that row is a different sub-phase now, so nothing was written'
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node fixtures/planner/rejections.js` — expected PASS.
Then the whole suite: `npm test` — expected PASS. `signoff-push.js` in particular, since `buildSignoffSet` changed.

- [ ] **Step 7: Mutation sweep**

Add:

```json
    {"label": "failed entries are dropped from the queue, losing what the PM typed",
     "find": "  S.pendingComments=(S.pendingComments||[]).filter(e=>!gone.has(String(e.localId)));",
     "replace": "  S.pendingComments=[];"},
    {"label": "a section with only a queued reject is left out of the sign-off set",
     "find": "      if(!instChanged && !pmChanged && !tasks.length && !rejecting)return;",
     "replace": "      if(!instChanged && !pmChanged && !tasks.length)return;"},
    {"label": "queued comments are not counted by Save",
     "find": "rejectionChangeCount(buildRejectionSet())",
     "replace": "0"}
```

Expected: all red.

- [ ] **Step 8: Commit**

```bash
git add web/index.html fixtures/planner/rejections.js fixtures/planner/rejections.mutations.json
git commit -m "Send queued comments and rejections on Save, with the preview and results"
```

---

## Task 9: The Open rejections card and the board label

**Files:**
- Modify: `web/index.html` (`vSignoff`, `vBoard`)
- Modify: `fixtures/planner/rejections.js`

**Interfaces:**
- Consumes: `s.rejected`, `s.rejectedOn`, `s.rejectedReason`, `s.thread`, `s.inst`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

```js
/* The Open rejections card. It follows the job picker, and says when the
   installer has signed again so a PM knows there is something to look at. */
const sA = win.allSecs(job)[0].s;
sA.rejected = true; sA.rejectedOn = '2026-09-20T14:05:00Z';
sA.rejectedReason = 'coping joints uneven'; sA.inst = false;
sA.thread = [{ id: '1', kind: 'Rejected', body: 'coping joints uneven',
               by: 'Don Borgeson', at: '2026-09-20T14:05:00Z' }];
win.UI.tab = 'signoff'; win.UI.signoffJob = ''; win.render();
let sv = win.document.body.innerHTML;
assert(/Open rejections/.test(sv), 'the Sign-Offs tab carries an Open rejections card');
assert(/coping joints uneven/.test(sv), 'it shows the reason');
assert(/Don Borgeson/.test(sv), 'it names who rejected it');
assert(!/Signed again/.test(sv), 'nothing says signed again while it is unsigned');

sA.inst = true; win.render();
assert(/Signed again, ready to review/.test(win.document.body.innerHTML),
  'once the installer signs again the entry says so');

sA.rejected = false; win.render();
assert(!/Open rejections/.test(win.document.body.innerHTML),
  'the card disappears when nothing is rejected');

// It follows the job picker.
sA.rejected = true;
win.UI.signoffJob = win.S.jobs.find(j => j.jobno !== job.jobno) ? 'other' : '';
win.render();

// The board labels a rejected row.
win.UI.tab = 'board'; win.render();
assert(/Rejected/.test(win.document.body.innerHTML), 'the Job Board labels a rejected sub-phase');

// Escaping again, on this surface.
sA.rejectedReason = PROBE; sA.thread[0].by = PROBE; win.UI.tab = 'signoff'; win.render();
assert(win.document.getElementById('xss-probe') === null,
  'the Open rejections card escapes the reason and the name');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node fixtures/planner/rejections.js`
Expected: FAIL on `the Sign-Offs tab carries an Open rejections card`.

- [ ] **Step 3: Implement the card**

In `vSignoff`, after `bar` and before the per-job map:

```js
  /* Every unresolved rejection, so nothing stalls unnoticed. Follows the job
     picker above. An entry whose installer has signed again is called out,
     because that is the one a PM can act on now. */
  const rej=[];
  list.forEach(j=>allSecs(j).forEach(({s,gi,si})=>{
    if(!s.rejected)return;
    const last=(s.thread||[]).filter(e=>e.kind==='Rejected').slice(-1)[0];
    rej.push({j,gi,si,s,by:last?last.by:'',at:s.rejectedOn||(last?last.at:null)});
  }));
  const card=rej.length?`<div class="card"><h2>Open rejections <span class="chip warn">${rej.length}</span></h2>
    <table><thead><tr><th style="width:90px">Job</th><th style="width:70px">#</th><th>Sub-phase</th>
      <th style="width:150px">Rejected</th><th>Reason</th><th style="width:170px"></th></tr></thead><tbody>
    ${rej.map(r=>`<tr><td class="small mono">${esc(r.j.jobno||'')}</td>
      <td class="small muted">${esc(r.s.num)}</td>
      <td><a href="#" onclick="UI.tab='signoff';editSec('${esc(r.j.id)}',${r.gi},${r.si});return false">${esc(r.s.name)}</a></td>
      <td class="small muted">${esc(cmtWhen(r.at))}${r.by?' · '+esc(r.by):''}</td>
      <td class="small">${esc(r.s.rejectedReason||'')}</td>
      <td class="small">${r.s.inst?'<b>Signed again, ready to review</b>':''}</td></tr>`).join('')}
    </tbody></table></div>`:'';
  return bar+card+list.map(j=>{ ... unchanged ... })
```

- [ ] **Step 4: Implement the board label**

In `vBoard`, on the sub-phase row beside the existing badges:

```js
${s.rejected?'<span class="chip warn" title="Sign-off rejected. See the Sign-Offs tab.">Rejected</span>':''}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node fixtures/planner/rejections.js` — expected PASS.
Then: `node fixtures/planner/escaping.js && node fixtures/planner/office-views.js` — expected PASS.

- [ ] **Step 6: Mutation sweep**

```json
    {"label": "the card does not say when the installer signed again",
     "find": "${r.s.inst?'<b>Signed again, ready to review</b>':''}",
     "replace": "''"},
    {"label": "the reason is not escaped on the Open rejections card",
     "find": "      <td class=\"small\">${esc(r.s.rejectedReason||'')}</td>",
     "replace": "      <td class=\"small\">${r.s.rejectedReason||''}</td>"},
    {"label": "the card ignores the job picker",
     "find": "  list.forEach(j=>allSecs(j).forEach(({s,gi,si})=>{",
     "replace": "  S.jobs.forEach(j=>allSecs(j).forEach(({s,gi,si})=>{"}
```

The third needs an assertion that picks one job and checks the card excludes the other; add it if the existing ones do not catch it.

- [ ] **Step 7: Run the shakedown in a real browser**

Run: `node tools/planner-shakedown.js`

Expected: every tab renders, **0 hard errors**, console clean. The jsdom harnesses cannot see a broken `<script src>`, a control that renders but throws on click, or a console error. Warnings around 43 are expected and are not a defect; the error count is the one to watch.

- [ ] **Step 8: Commit**

```bash
git add web/index.html fixtures/planner/rejections.js fixtures/planner/rejections.mutations.json
git commit -m "Add the Open rejections card to the Sign-Offs tab and a Rejected label on the board"
```

---

## Task 10: The Daily Summary "Open rejections" section

**Files:**
- Modify: the live `D2 - Daily Summary` flow (via FlowAgent `edit_flow`)
- Regenerate: `flows/exports/D2-Daily-Summary-*.json`

**Interfaces:**
- Consumes: `Assignments.Rejected`, `RejectedOn`, `RejectedReason` from Task 1.
- Produces: nothing consumed later.

- [ ] **Step 1: Load the flow-mechanics skill first**

Invoke `power-automate-flow-mechanics` **before writing any expression that reads a SharePoint column.** It was available and not invoked on 2026-09-11, which is how `D2 - Crew Trade Check` wrote 66 wrong flags. The one-line version: `OpenApiConnection`/`GetItems` gives connector names (`Rejected` as a boolean, a Choice as `{Id,Value}`); `Send an HTTP request to SharePoint` and every `$filter=` string give raw REST names. Which one you need depends on the action, never on the list.

- [ ] **Step 2: Assert the tenant and read the live definition**

```bash
az account set --subscription f24d9b39-6a71-4f4e-a376-03b6f61c97e4
az account show --query tenantId -o tsv | grep -q "^f24d9b39" && echo CONFIRMED || echo ABORT
```

Then FlowAgent `get_flow` on `D2 - Daily Summary`. **Not `az rest`**: its output on Windows silently drops characters outside cp1252, and this flow's HTML body carries them.

- [ ] **Step 3: Copy the flow and point the copy at us only**

**Never test on the live flow.** It emails `stratirus@`, `david@`, `don@`, `cody@` and `emon@`. Use FlowAgent `copy_flow`, then `edit_flow` the copy's `Send_summary` with `merge` on `actions/Send_summary/inputs/parameters` so `emailMessage/To` becomes `stratirus@d2pools.com` alone. `merge` is required rather than a path write: the parameter key is literally `emailMessage/To` and contains the `/` that `edit_flow` uses as a path separator, and `merge` leaves the 2,700-character HTML `Body` untouched.

- [ ] **Step 4: Add the section to the copy**

Follow the existing `Get_active_jobs` / `Select_active_job_ids` / `Compose_active_job_clause` idiom already in this flow. New actions:

- `Get_open_rejections`: `GetItems` on Assignments, `$filter` = `Rejected eq 1` plus the active-job clause. A boolean compares as `eq 1` in a `$filter`.
- `Select_rejection_rows` and an `Append_row`-style loop building the table, matching how `For_each_today` builds its rows. Reuse the existing palette: headings `#082544`, links `#0b594b`, table header `#f6f3ed`, warnings `#a84a18`. **The row links carry their own `style="color:..."` inside the loop, not only in `Compose_body`** — repainting `Compose_body` alone once left every row link the old colour while the definition read clean.
- `Condition_has_rejections`: wrap the section so it is **omitted entirely when there are none**.

- [ ] **Step 5: Create a rejection, run the copy, and read the body it actually sent**

Set `Rejected = true` with a reason on one row of a throwaway `Planned` pool, or temporarily on a demo row that you then revert. Run the copy with `run_flow`, then pull `Send_summary`'s `inputsLink` and read the HTML that was sent.

Expected: the section renders, names the job, sub-phase, date and reason, and the colours match. **Verify by reading the sent body, never the definition.**

- [ ] **Step 6: Run it again with no rejections**

Clear the flag. Run the copy. Expected: `Condition_has_rejections` evaluates false, `ActionBranchingConditionNotSatisfied` on the section, and the email arrives with no Open rejections block. Read the evaluated condition, not just the run status.

- [ ] **Step 7: Apply the identical edit to the real flow, verify by content, delete the copy**

`edit_flow` the real `D2 - Daily Summary` with the same change, then Dataverse `PublishXml`, then read the published definition back and compare by content. Delete the copy with `delete_flow`. The real flow picks the change up at 04:30.

- [ ] **Step 8: Regenerate the export and commit**

```bash
python flows/scripts/export-flows.py
git add flows/exports/
git commit -m "Daily Summary: add an Open rejections section, omitted when there are none"
```

**Compare exports by content, never by date.** A same-day filename is not the same as after-the-last-change.

---

## Task 11: Live end-to-end, deploy, and record it

**Files:**
- Modify: `CLAUDE.md`
- Deploy: `web/` to the Static Web App

**Interfaces:**
- Consumes: everything above.
- Produces: the record.

- [ ] **Step 1: Assert the tenant, then create a throwaway pool**

`+ Job` with **Assign default crews unticked**, so there is no crew to double-book. Job number `TEST-9500`. It stays `Planned`, so it is invisible to dispatch, the summaries and Calendar Sync, and strands no calendar events. Build time has been 8 to 10 minutes recently, against 16m33s once. **Treat a multi-minute stall as normal and do not re-raise the request**, which is how two pools get created.

- [ ] **Step 2: Deploy the planner**

```bash
az account set --subscription cbcbe68b-bbaa-4926-bd9a-d33f0a9bd312
TOKEN=$(az staticwebapp secrets list --name swa-d2-build-scheduler \
          --resource-group rg-d2-build-scheduler --query "properties.apiKey" -o tsv)
npx -y @azure/static-web-apps-cli deploy ./web --deployment-token "$TOKEN" --env production
```

**A code change that is not deployed is not a fix.**

- [ ] **Step 3: Re-run the wall checks**

`staticwebapp.config.json` ships with the content and a bad one fails open. Expected: `/`, `/index.html`, both scripts, `/robots.txt` and a **nonsense path** all 302 to `/.auth/login/aad`; `/auth-redirect.html` 200; `/.auth/login/github` 404.

- [ ] **Step 4: Walk the whole path through the real controls, reading rows back**

On `TEST-9500`, signed in:

| Do | Then read back |
|---|---|
| Sign off a sub-phase | `InstallerSignOff`, `...ByLookupId`, `...On` |
| Reject it with a reason, Save | flag, attribution and timestamp all cleared; `Rejected=true`; `RejectedOn`; `RejectedReason`; a `REJECTED ... by ... (was signed by ...): ...` line in `SignOffNotes` in **Central** time; one `Sign-off Comments` row `Kind=Rejected` with the right `AssignmentLookupId` |
| Tick tasks in the same Save as the reject | the ticks **landed**, not refused |
| Add a comment, Save | one row `Kind=Comment`, nothing written to the assignment |
| **Provoke a refusal**: sign off again in SharePoint, then Save a queued reject that expected it signed | reported refused with the reason; the entry **stays queued**; nothing written |
| **Provoke the other refusal**: clear `Rejected` in SharePoint, then Save a queued resolve | refused `not-rejected` |
| Sign off again, check the card | reads "Signed again, ready to review" |
| Mark resolved, Save | `Rejected=false`, `RejectedReason` cleared, **`RejectedOn` still there**, one row `Kind=Resolved` |
| Open the `Rejected` view while one is open | the row is there; empty again after resolving |

- [ ] **Step 5: Confirm the suppression held**

Watch `D2 - Event-Driven Reconciliation`'s runs for ten minutes after the reject. Expected: it fired, passed `Condition_scheduling_changed`, and stopped at `Terminate_suppressed` with `Send_email_alert` **Skipped**. **Read the actions, not the run duration** — a short run alone proves nothing. Note `get_run_history` has returned stale or empty results twice before; an empty result is not evidence a run did not happen.

- [ ] **Step 6: Remove the test pool and audit back to baseline**

Delete through `Delete Pool Requests` (about 6 minutes; set `OverrideSignedOff` if anything is signed; `Title` must equal `ConfirmJobNumber` exactly). Delete the `New Pool Requests` and `Delete Pool Requests` rows afterwards, since those lists are the client's operational log. Then delete the `Sign-off Comments` rows the test created.

Expected final state: 4 jobs, 184 assignments, 1180 tasks, 4 real `New Pool Requests` rows, 0 `Delete Pool Requests` rows, 0 `Sign-off Comments` rows, 0 rows with `Rejected=true`.

- [ ] **Step 7: Full suite and shakedown**

```bash
npm test
node tools/planner-shakedown.js
python fixtures/planner/mutate.py fixtures/planner/rejections.js web/writeback-core.js --json fixtures/planner/rejections.mutations.json
python fixtures/planner/mutate.py fixtures/planner/rejections.js web/index.html --json fixtures/planner/rejections.mutations.json
python fixtures/planner/mutate.py fixtures/planner/graph-read.js web/graph-to-planner.js --json fixtures/planner/rejections.mutations.json
python fixtures/planner/mutate.py fixtures/planner/graph-write.js web/graph-writeback.js --json fixtures/planner/rejections.mutations.json
```

Expected: all green, all mutations red, 0 hard errors.

- [ ] **Step 8: Record it in CLAUDE.md**

Add a section covering: the list and its `WriteSecurity=2`; the three Assignments columns; the `Rejected` view and how it was proven (stamp, clear, inverted control); that `createdBy`/`createdDateTime` are at the item root, not under `fields`; that `commentsList` is deliberately outside `D2_GRAPH.lists` so a failing comments read cannot fail Refresh; that a rejection counts as a reopen for task ticks; PATCH-before-POST and what a mid-way failure leaves behind; and the live verification, including both refusal directions. Update the flow table row for `D2 - Daily Summary`.

- [ ] **Step 9: Commit and push**

```bash
git add CLAUDE.md
git commit -m "Record the reject-with-comments build and its live verification"
git push
```

- [ ] **Step 10: Update the client guide and the priorities page**

The PM guide (`https://claude.ai/artifact/MnJkMLwg3LHXpv9g74SiV2`) needs a section on rejecting a sign-off, commenting, and the Open rejections card, and the priorities page item 12 moves to Done. Both are client-visible: neutral voice, no internal attribution, no em dashes. **Publishing to a live shared artifact has been refused by the permission classifier before**, so expect to hand the edited file to Shane rather than publishing it.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| New list `Sign-off Comments`, lookup from live SchemaXml, `Kind`, `Body` not required | 1 |
| Author/time from `createdBy`/`createdDateTime` | 2 |
| `WriteSecurity = 2` | 1 |
| Three Assignments columns | 1 |
| `Rejected` view, grouped by Job, linked from home | 1 |
| No flow triggered by these columns | 1 (nothing added to Flow 3's gate) |
| `provision-signoff-comments.js`, reads everything back | 1 |
| Drawer: thread, Add comment, Reject, Mark resolved, queued state, removable, INST un-ticks | 7 |
| Save: count, preview in words, results | 8 |
| Sign-Offs tab Open rejections card, "Signed again", follows the picker | 9 |
| Job Board Rejected label | 9 |
| Refresh reads comments, `String()` join, must not fail Refresh | 2, 6 |
| `file://` cannot comment, and says so | 7 |
| Reject: one PATCH then one POST, fields as listed, suppression stamp | 3, 5 |
| Resolve: PATCH then POST, `RejectedOn` kept | 3 |
| Comment: POST only | 3, 5 |
| Compare before write, all three refusal cases | 3, 11 |
| Rejection counts as a reopen for ticks; one reopen not two | 4, 8 |
| Failure between the two writes reported | 5 |
| Daily Summary section, omitted when empty, flow-mechanics skill, never test live | 10 |
| `fixtures/planner/rejections.js` covering the listed cases | 3, 4, 6, 7, 8, 9 |
| Mapping test including the string/number join | 2 |
| Mutation sweep, each watched red | every task |
| Shakedown clean | 9, 11 |
| Live on a throwaway `Planned` pool | 11 |

Two spec items are deliberately **not** separate tasks, and both are covered: "a rejection in the same Save as an un-tick of INST is one reopen, not two" is asserted in Task 8 where both sets are built together, and "marking resolved does not sign anything off" is asserted in Task 3.

One spec line needs a note rather than a task: the spec says the Save preview lists entries "in their own section, in words", and Task 8 implements exactly that. No gap.

**2. Placeholder scan**

One intentional placeholder remains: `commentsList: '<GUID FROM TASK 1 STEP 5>'` in Task 6 Step 3. It cannot be filled before Task 1 runs against the tenant, and Task 1 Step 5 prints it with `PASTE THIS INTO D2_GRAPH.lists.comments`. Every other step carries real code.

**3. Type consistency**

- `planRejections` returns `{ops, refusals, errors}` in Task 3 and is consumed as `rPlan.ops` / `rPlan.refusals` in Task 8. Consistent.
- `applyRejectionOps` returns `{done, failed}` in Task 5 and is read as `rRes.done` / `rRes.failed` in Task 8. Consistent.
- `localId` travels from `S.pendingComments` (Task 7) through `buildRejectionSet` (Task 8) into ops, refusals and `done` (Tasks 3, 5), which is what lets Task 8 clear only what landed. Consistent.
- `secId` is a string everywhere it is written and compared with `String()` on both sides.
- `ctx` for `applyRejectionOps` is `{token, siteId, asgListId, commentsListId}` in Task 5 and constructed with exactly those keys in Task 8. Consistent.
- `commentsList` sits on `D2_GRAPH` beside `lists`, asserted in Task 6 and read in Tasks 6 and 8 as `D2_GRAPH.commentsList`. Consistent.
- `cmtWhen` is defined in Task 7 and reused in Task 9.
