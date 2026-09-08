/* Scaffolding for pool lifecycle + schedule reflow.
 *
 * Creates three things, and nothing else:
 *   1. Assignments.SuppressReconcileUntil  (DateTime, OPTIONAL)
 *   2. the Reschedule Requests list
 *   3. a Planned Pools view on Jobs
 *
 * WHY SuppressReconcileUntil IS A TIMESTAMP AND NOT A BOOLEAN. A reflow can
 * rewrite up to 45 assignment rows, and every one of those writes changes
 * ScheduledStart or ScheduledFinish, which is exactly what Event-Driven
 * Reconciliation's trigger gate looks for. Without suppression that is up to 45
 * conflict checks and 45 alert emails to one PM, which is how people learn to
 * ignore alerts. A boolean would need a reset write afterwards, and a reset
 * that failed would leave that row permanently invisible to conflict detection.
 * A timestamp expires on its own and cannot mute a row for longer than its
 * window.
 *
 * IT MUST NOT BE REQUIRED. Assignments already has four Required columns that
 * were seeded NULL during Phase A, and the consequence was that the SharePoint
 * list form refused to save ANY hand edit to those rows until they were
 * backfilled. Do not add a fifth.
 *
 * Field creates are SEQUENTIAL on purpose. Parallel field creates against one
 * list contend on the schema lock and fail with 500 "requires a newer version".
 *
 * Options: 8 is AddFieldInternalNameHint, so the internal name matches the Name
 * attribute instead of being mangled. Every flow expression in the plan depends
 * on these exact internal names.
 *
 * Run in the browser console on the site, signed in as stratirus@d2pools.com.
 * Idempotent: re-running reports what already existed and creates nothing twice.
 * Verify by reading the schema back, never by the status code.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo',
    { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };
  const get = async u => (await fetch(u, { headers: { Accept: H.Accept }, credentials: 'include' })).json();
  const post = async (u, body) => {
    const r = await fetch(u, { method: 'POST', credentials: 'include', headers: HD, body: JSON.stringify(body) });
    return { status: r.status, ok: r.ok, err: r.ok ? '' : (await r.text()).slice(0, 300) };
  };
  const asXml = (list, xml) => post(
    `${site}/_api/web/lists/GetByTitle('${list}')/fields/CreateFieldAsXml`,
    { parameters: { __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' },
                    SchemaXml: xml, Options: 8 } });

  const out = [];

  // ---------------------------------------- 1. Assignments.SuppressReconcileUntil
  const aFields = await get(`${site}/_api/web/lists/GetByTitle('Assignments')/fields?$select=InternalName`);
  if (aFields.d.results.some(f => f.InternalName === 'SuppressReconcileUntil')) {
    out.push('SuppressReconcileUntil ....... already present');
  } else {
    const r = await asXml('Assignments',
      `<Field Type='DateTime' DisplayName='SuppressReconcileUntil' Name='SuppressReconcileUntil' `
      + `Format='DateTime' Required='FALSE' Description='Set by D2 - Reschedule Pool. While this `
      + `timestamp is in the future, Event-Driven Reconciliation skips this row. Expires on its own.' />`);
    out.push(`SuppressReconcileUntil ....... create ${r.status} ${r.err}`);
  }

  // ---------------------------------------------- 2. Reschedule Requests list
  const lists = await get(`${site}/_api/web/lists?$select=Title`);
  if (lists.d.results.some(l => l.Title === 'Reschedule Requests')) {
    out.push('Reschedule Requests list ..... already present');
  } else {
    const c = await post(`${site}/_api/web/lists`, {
      __metadata: { type: 'SP.List' }, BaseTemplate: 100, Title: 'Reschedule Requests',
      Description: 'Ask the system to recompute a pool schedule from one sub-phase onward. '
                 + 'Locked and signed-off sub-phases are never moved.'
    });
    out.push(`Reschedule Requests list ..... create ${c.status} ${c.err}`);

    const fields = [
      ['JobNumber',    `<Field Type='Text' DisplayName='JobNumber' Name='JobNumber' Required='TRUE' `
                     + `Description='The pool to reschedule, e.g. D2-1042.' />`],
      ['FromSequence', `<Field Type='Number' DisplayName='FromSequence' Name='FromSequence' Required='TRUE' `
                     + `Decimals='0' Description='Reflow this sub-phase and every one after it.' />`],
      ['NewStartDate', `<Field Type='DateTime' DisplayName='NewStartDate' Name='NewStartDate' `
                     + `Format='DateOnly' Required='FALSE' Description='Optional. Leave blank to keep `
                     + `the from-row where it is and only re-chain what follows.' />`],
      ['Status',       `<Field Type='Choice' DisplayName='Status' Name='Status' Required='FALSE' `
                     + `Format='Dropdown'><Default>Requested</Default><CHOICES>`
                     + `<CHOICE>Requested</CHOICE><CHOICE>Running</CHOICE>`
                     + `<CHOICE>Done</CHOICE><CHOICE>Failed</CHOICE></CHOICES></Field>`],
      ['Result',       `<Field Type='Note' DisplayName='Result' Name='Result' Required='FALSE' `
                     + `NumLines='6' Description='Written by the flow. What moved, what was skipped and why.' />`]
    ];
    for (const [name, xml] of fields) {          // SEQUENTIAL, see header
      const r = await asXml('Reschedule Requests', xml);
      out.push(`  field ${name.padEnd(14)} ....... ${r.status} ${r.err}`);
    }
  }

  // ------------------------------------------------ 3. Planned Pools view on Jobs
  const jv = await get(`${site}/_api/web/lists/GetByTitle('Jobs')/views?$select=Title,Id`);
  let planned = jv.d.results.find(v => v.Title === 'Planned Pools');
  if (planned) {
    out.push('Planned Pools view ........... already present');
  } else {
    const r = await post(`${site}/_api/web/lists/GetByTitle('Jobs')/views`, {
      __metadata: { type: 'SP.View' }, Title: 'Planned Pools',
      ViewQuery: `<Where><Eq><FieldRef Name='Status' /><Value Type='Text'>Planned</Value></Eq></Where>`
               + `<OrderBy><FieldRef Name='StartDate' /></OrderBy>`,
      RowLimit: 100, Paged: true
    });
    out.push(`Planned Pools view ........... create ${r.status} ${r.err}`);
    planned = (await get(`${site}/_api/web/lists/GetByTitle('Jobs')/views?$select=Title,Id`))
      .d.results.find(v => v.Title === 'Planned Pools');
  }

  // A view created through REST carries ONLY LinkTitle, which renders as a single
  // useless column. Caught by opening the view rather than by any status code.
  if (planned) {
    const vfBase = `${site}/_api/web/lists/GetByTitle('Jobs')/views('${planned.Id}')/viewfields`;
    const current = (await get(vfBase)).d.Items.results;
    for (const f of ['JobNumber', 'StartDate', 'ProjectManager', 'Address', 'City']) {
      if (current.includes(f)) continue;
      const r = await fetch(`${vfBase}/addviewfield('${f}')`,
        { method: 'POST', credentials: 'include', headers: HD });
      out.push(`  view field ${f.padEnd(14)} .. ${r.status}`);
    }
  }

  console.log(out.join('\n'));
  return out;
})();
