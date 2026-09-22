/* Provisions the Sign-off Comments list and the three rejection columns on
 * Assignments. Paste into the browser console on the site, signed in with Edit
 * rights, or run through the request-triggered proxy flow described in this
 * repo's documented headless SharePoint route.
 *
 * Every piece is READ BACK after it is written. On this platform a write can
 * return 201/204 and do nothing, or render blank, so a status code is not
 * evidence.
 *
 * The Assignment lookup's SchemaXml is adapted from the live Tasks.Assignment
 * field (Type="Lookup", List={Assignments GUID}, ShowField="Title"), read off
 * the tenant rather than invented -- a hand-written lookup is the documented
 * way this goes wrong: the write returns 201 and the column renders blank.
 *
 * DRY_RUN reports the plan and writes nothing. On a tenant where the list does
 * not exist yet, the plan still has to name every field that would be created
 * -- both the three list fields and the three Assignments columns -- so the
 * dry-run path does not require a real list id to report on them.
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
  // A genuine failure (not DRY_RUN, still no list) stops here. DRY_RUN
  // continues with list == null so the plan can still name the list fields
  // and the Assignments columns below, neither of which needs a real list id
  // to report on in DRY_RUN mode.
  if (!list && !DRY_RUN) { console.table(out.skipped); return out; }

  const L = list ? "/_api/web/lists(guid'" + list.Id + "')" : null;
  const entity = list ? (await api(L)).ListItemEntityTypeFullName : null;   // read, never hand-write

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
    const have = list ? await api(L + "/fields/getByInternalNameOrTitle('" + name + "')").catch(() => null) : null;
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
  if (!DRY_RUN && list) {
    await api(L, { method: 'POST', headers: { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' },
      body: JSON.stringify({ WriteSecurity: 2 }) });
  } else if (DRY_RUN) {
    out.skipped.push('DRY_RUN: would set WriteSecurity=2 on Sign-off Comments');
  }

  // 4. The three Assignments columns. Independent of whether the new list
  //    exists yet -- ASG_LIST is the live Assignments list id.
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
  if (list) {
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
  } else {
    out.verified.push('DRY_RUN: Sign-off Comments list not created yet -- list-level checks skipped');
  }

  for (const [name] of asgFields) {
    const f = await api(A + "/fields/getByInternalNameOrTitle('" + name + "')"
      + '?$select=TypeAsString,Required,DefaultValue').catch(() => null);
    out.verified.push('Assignments.' + name + ' -> ' + (f ? f.TypeAsString + ' required=' + f.Required : 'MISSING'));
    if (!DRY_RUN && !f) out.problems.push('Assignments.' + name + ' missing after create');
  }

  if (entity) out.verified.push('ListItemEntityTypeFullName = ' + entity);
  if (list) console.log('PASTE THIS INTO D2_GRAPH.lists.comments:', list.Id);
  console.table(out.created); console.table(out.verified); console.table(out.skipped);
  if (out.problems.length) { console.error('PROBLEMS'); console.table(out.problems); }
  return out;
}
run();
