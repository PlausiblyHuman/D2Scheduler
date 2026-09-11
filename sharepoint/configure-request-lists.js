/*
 * configure-request-lists.js
 *
 * Makes the three REQUEST lists usable by a project manager:
 *
 *   New Pool Requests  -- raise a pool
 *   Delete Pool Requests -- remove one
 *   Reschedule Requests  -- reflow one
 *
 * These are the only lists a PM WRITES to, and until 2026-09-10 both halves of
 * that experience were broken.
 *
 * ---------------------------------------------------------------------------
 * 1. HIDE THE FLOW-OWNED FIELDS FROM THE **NEW** FORM
 * ---------------------------------------------------------------------------
 *
 * Every one of these lists exposed `Status` and `Result` on its New form.
 * Both are written by the flow, never by a person, so the form was asking a PM
 * to fill in two fields they must not touch -- and the PM guide, which says
 * "fill in every box", contradicted itself on sight.
 *
 * THE TRAP: `ShowInNewForm` IS NOT SETTABLE ON THE REST FIELD ENTITY.
 *
 *     MERGE .../fields/getByInternalNameOrTitle('Status')  {"ShowInNewForm":false}
 *     -> 400  "The property 'ShowInNewForm' does not exist"
 *
 * It lives on SP.FieldCreationInformation / CSOM, not on SP.Field. The route
 * that works is `SchemaXml` -- and the SAFE way to use SchemaXml is a STRING
 * INSERT into the field's existing XML, never a rebuild. Hand-built SchemaXml
 * is exactly what silently wipes ValidationFormula (see guard-crew-values.js
 * and the Assignments.Crew entry in CLAUDE.md). Here we read the current XML,
 * splice one attribute in after `<Field `, and write that exact string back, so
 * <CHOICES>, <Default> and everything else survive verbatim. Handles both the
 * self-closing `<Field .../>` and `<Field ...>...</Field>` shapes.
 *
 * HIDING A **REQUIRED** FIELD IS ONLY SAFE WHEN IT HAS A DEFAULT, which
 * SharePoint then supplies on save. All three `Status` fields default to
 * "Requested", so this holds. Proven end to end on 2026-09-10, not assumed: a
 * pool was created through the form with Status hidden, saved, defaulted to
 * "Requested", and D2 - New Pool built all 46 sub-phases and 295 tasks.
 *
 * Both fields stay on the DISPLAY and EDIT forms. The PM guide tells people to
 * watch Status until it reads Done, so hiding it everywhere would be worse than
 * the problem being fixed.
 *
 * ---------------------------------------------------------------------------
 * 2. GIVE THE DEFAULT VIEWS REAL COLUMNS
 * ---------------------------------------------------------------------------
 *
 * All three default views contained exactly one field: LinkTitle. So a PM told
 * to "refresh until Status says Done" COULD NOT SEE STATUS AT ALL -- the view
 * rendered pool names and nothing else. Same defect class as the Jobs All Items
 * one fixed on 2026-09-10, which was never checked on these lists.
 *
 * Also sets RowLimit=50 / Paged=true. Paged=false means "return N and stop",
 * with no next control and no indication anything is missing (see CLAUDE.md).
 *
 * ---------------------------------------------------------------------------
 * HOW TO RUN
 * ---------------------------------------------------------------------------
 * Paste into DevTools on a page of the D2BuildScheduler site, signed in as
 * stratirus@d2pools.com. Idempotent: re-running skips fields already hidden and
 * rewrites the views to the same shape.
 *
 * Console paste is guarded by Chrome's self-XSS warning (type "allow pasting"),
 * or use Sources -> Snippets, which has no guard.
 */

(async () => {
  const SITE = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const JSON_NM = 'application/json;odata=nometadata';

  const digest = (await (await fetch(SITE + '/_api/contextinfo',
    { method: 'POST', credentials: 'include', headers: { Accept: JSON_NM } })).json()).FormDigestValue;

  const HD = { Accept: JSON_NM, 'Content-Type': JSON_NM, 'X-RequestDigest': digest };
  const listUrl = name => SITE + "/_api/web/lists/GetByTitle('" + encodeURIComponent(name) + "')";

  // Flow-owned on every request list. Never filled in by a person.
  const FLOW_OWNED = ['Status', 'Result'];

  // Default-view columns, in display order.
  const VIEW_FIELDS = {
    'New Pool Requests':    ['LinkTitle', 'JobNumber', 'Status', 'StartDate', 'ProjectManager', 'Result', 'Created'],
    'Delete Pool Requests': ['LinkTitle', 'ConfirmJobNumber', 'Reason', 'Status', 'Result', 'Created'],
    // NOTE: the job-number column is NOT named the same on every list. It is
    // JobNumber here and on New Pool Requests, but ConfirmJobNumber on Delete
    // Pool Requests. Verified by probing $select against the live lists; the
    // obvious guess of a shared JobNumber returns 400 on Delete Pool Requests.
    'Reschedule Requests':  ['LinkTitle', 'JobNumber', 'FromSequence', 'NewStartDate', 'Status', 'Result', 'Created']
  };

  const report = { hidden: [], skipped: [], views: [], failures: [] };

  for (const list of Object.keys(VIEW_FIELDS)) {

    // ---- 1. hide the flow-owned fields from the New form -------------------
    for (const field of FLOW_OWNED) {
      const fUrl = listUrl(list) + "/fields/getByInternalNameOrTitle('" + field + "')";
      const cur = await (await fetch(fUrl + '?$select=SchemaXml',
        { credentials: 'include', headers: { Accept: JSON_NM } })).json();

      if (/ShowInNewForm=/i.test(cur.SchemaXml)) { report.skipped.push(list + '/' + field); continue; }

      const next = cur.SchemaXml.replace('<Field ', '<Field ShowInNewForm="FALSE" ');
      if (next === cur.SchemaXml) { report.failures.push(list + '/' + field + ' attribute insert failed'); continue; }

      const r = await fetch(fUrl, {
        method: 'POST', credentials: 'include',
        headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
        body: JSON.stringify({ SchemaXml: next })
      });
      if (r.ok) report.hidden.push(list + '/' + field);
      else report.failures.push(list + '/' + field + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 160));
    }

    // ---- 2. rebuild the default view's columns -----------------------------
    const view = await (await fetch(listUrl(list) + '/DefaultView?$select=Id,Title',
      { credentials: 'include', headers: { Accept: JSON_NM } })).json();
    const vUrl = listUrl(list) + "/views('" + view.Id + "')";

    await fetch(vUrl + '/viewfields/removeallviewfields',
      { method: 'POST', credentials: 'include', headers: HD });

    for (const f of VIEW_FIELDS[list]) {
      const r = await fetch(vUrl + "/viewfields/addviewfield('" + f + "')",
        { method: 'POST', credentials: 'include', headers: HD });
      if (!r.ok) report.failures.push(list + ' view field ' + f + ' -> ' + r.status);
    }

    await fetch(vUrl, {
      method: 'POST', credentials: 'include',
      headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
      body: JSON.stringify({ RowLimit: 50, Paged: true })
    });
    report.views.push(list + ' -> ' + VIEW_FIELDS[list].join(', '));
  }

  // ---- verify by READING BACK, never by the status code --------------------
  // This codebase's whole failure signature is a write that returns 2xx and
  // does nothing. Confirm the choices and defaults survived the SchemaXml write.
  const verify = {};
  for (const list of Object.keys(VIEW_FIELDS)) {
    verify[list] = {};
    for (const field of FLOW_OWNED) {
      const j = await (await fetch(listUrl(list) + "/fields/getByInternalNameOrTitle('" + field + "')"
        + '?$select=SchemaXml,DefaultValue,Required,Choices,ValidationFormula',
        { credentials: 'include', headers: { Accept: JSON_NM } })).json();
      verify[list][field] = {
        hiddenOnNew: /ShowInNewForm="FALSE"/i.test(j.SchemaXml),
        required: j.Required, default: j.DefaultValue,
        choices: j.Choices, validation: j.ValidationFormula
      };
    }
    const v = await (await fetch(listUrl(list) + '/DefaultView?$select=RowLimit,Paged&$expand=ViewFields',
      { credentials: 'include', headers: { Accept: JSON_NM } })).json();
    verify[list].view = { fields: (v.ViewFields && v.ViewFields.Items) || v.ViewFields, paged: v.Paged, rowLimit: v.RowLimit };
  }

  console.log('CHANGES', report);
  console.log('VERIFY', verify);
  if (report.failures.length) console.warn('FAILURES', report.failures);
  return { report, verify };
})();
