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
