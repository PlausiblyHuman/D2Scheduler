/* Task-level feature columns for step 4 (docs/specs/2026-10-22-step4-features-design.md).
 *   Task Template: Feature (Text). Non-blank = the task belongs to that feature and is optional.
 *   Tasks:         Feature (Text), copied from Task Template by D2 - New Pool; hidden on the New and
 *                  Edit forms (machine-owned).
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
  const report = { fields: { created: [], kept: [] }, hidden: [], failures: [] };

  const FEATURE = "<Field Type='Text' Name='Feature' DisplayName='Feature' Required='FALSE' MaxLength='255' />";
  for (const l of ['Task Template', 'Tasks']) {            // sequential, deliberately
    const have = new Set(((await g(list(l) + '/fields?$select=InternalName&$top=500')).value || []).map(f => f.InternalName));
    if (have.has('Feature')) { report.fields.kept.push(l + '/Feature'); continue; }
    try { await post(list(l) + '/fields/CreateFieldAsXml', { parameters: { __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' }, SchemaXml: FEATURE, Options: 8 } }); report.fields.created.push(l + '/Feature'); }
    catch (e) { report.failures.push(l + '/Feature: ' + e.message); }
  }
  // Hide Tasks.Feature on New and Edit (SchemaXml string insert, never a rebuild).
  try {
    const fUrl = list('Tasks') + "/fields/getByInternalNameOrTitle('Feature')";
    if (DRY) report.hidden.push('Tasks/Feature (dry)');
    else {
      const cur = await g(fUrl + '?$select=SchemaXml');
      if (/ShowInNewForm=/i.test(cur.SchemaXml)) report.hidden.push('Tasks/Feature (already)');
      else {
        await post(fUrl, { __metadata: { type: 'SP.FieldText' }, SchemaXml: cur.SchemaXml.replace('<Field ', '<Field ShowInNewForm="FALSE" ShowInEditForm="FALSE" ') }, { 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' });
        report.hidden.push('Tasks/Feature');
      }
    }
  } catch (e) { report.failures.push('hide Tasks/Feature: ' + e.message); }
  return report;
})();
