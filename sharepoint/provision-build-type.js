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
    else { await post(fUrl, { __metadata: { type: 'SP.FieldChoice' }, SchemaXml: cur.SchemaXml.replace('<Field ', '<Field ShowInNewForm="FALSE" ') }, { 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' }); report.hidden.push('Jobs/BuildType'); }
  } catch (e) { report.failures.push('hide Jobs/BuildType: ' + e.message); }
  // One view per type on each template list.
  for (const l of ['Sub-phase Template', 'Task Template']) {
    const vr = await g(list(l) + '/views?$select=Title,Id');
    const existing = (vr.d || {}).results || vr.value || [];
    for (const t of ['Gunite', 'Fiberglass']) {
      if (existing.some(v => v.Title === t)) { report.views.kept.push(l + '/' + t); continue; }
      const q = "<Where><Eq><FieldRef Name='BuildType'/><Value Type='Choice'>" + t + "</Value></Eq></Where><OrderBy><FieldRef Name='Sequence'/></OrderBy>";
      try { await post(list(l) + '/views', { __metadata: { type: 'SP.View' }, Title: t, ViewQuery: q, RowLimit: 100, Paged: true, PersonalView: false }); report.views.created.push(l + '/' + t); }
      catch (e) { report.failures.push('view ' + l + '/' + t + ': ' + e.message); }
    }
  }
  return report;
})();
