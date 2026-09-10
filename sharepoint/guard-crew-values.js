/* NOTE 2026-09-10: Crew is now a CHOICE column, not Text.
 *
 * THE GUARD IS STILL LOAD-BEARING AND MUST NOT BE REMOVED. A Choice column
 * constrains the FORM only -- it accepts anything on a REST write. Proven on a
 * throwaway list before the conversion: creating an item with
 * Crew = "Devon Crew +3" returned 201, and a MERGE with "NOT_A_CREW" returned
 * 204. Both were accepted. This validation formula is the ONLY thing that
 * rejects them (SPListDataValidationException).
 *
 * So adding a crew now means updating BOTH the column's choice list AND the
 * formula below. They are complements, not alternatives.
 *
 * The __metadata type is SP.FieldChoice since the conversion. This script
 * MERGEs ValidationFormula/ValidationMessage ONLY and never SchemaXml -- a
 * SchemaXml write clobbers the choice list, and (found the hard way) a
 * SchemaXml write also SILENTLY WIPES ValidationFormula, which is how the
 * guard was lost for a few minutes during the conversion itself.
 */
/**
 * Assignments.Crew is a TEXT column and it is the JOIN KEY to Crews.CrewID.
 *
 * A wrong value does not error. It matches nothing: dispatch skips the row,
 * conflict detection cannot see it, and the summaries render it as unassigned.
 * Nobody is told. This already happened once on this project, when assignments
 * held "Devon Crew" while Crews held "devon", and every crew filter silently
 * returned zero rows.
 *
 * This adds a column validation formula listing the valid codes.
 *
 * VERIFIED 2026-09-09, and the result is better than the SharePoint docs imply:
 * the formula is enforced on REST writes as well as on the list form. Writing
 * Crew = "Devon Crew +3" by REST returns HTTP 500 SPListDataValidationException
 * and the stored value is unchanged. So flows and scripts are guarded too, not
 * just humans.
 *
 * Consequence worth knowing: if the Sub-phase Template ever carries a
 * DefaultCrew that is not in Crews, `D2 - New Pool` will now FAIL LOUDLY on that
 * row rather than quietly creating an unmatchable assignment. That is the
 * intended trade. All 12 codes currently in the template are valid.
 *
 * This is a guard, not a picker. A real dropdown means converting Crew to a
 * Choice column, which changes the connector's output shape from a string to
 * {Id, Value} and breaks all nine in-memory ?['Crew'] reads across five
 * published flows plus the canvas app. That is its own considered change.
 *
 * Idempotent. Re-run after adding or renaming a crew.
 */
const SITE = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';

async function run() {
  const j = async (u, o) => (await fetch(u, o)).json();
  const ctx = await j(`${SITE}/_api/contextinfo`, {method:'POST', headers:{Accept:'application/json;odata=nometadata'}});
  const digest = ctx.FormDigestValue;

  const crews = await j(`${SITE}/_api/web/lists/GetByTitle('Crews')/items?$select=CrewID&$top=100`,
                        {headers:{Accept:'application/json;odata=nometadata'}});
  const ids = crews.value.map(c => c.CrewID).filter(Boolean).sort();
  if (!ids.length) throw new Error('No CrewID values read; refusing to write an empty formula.');

  const formula = '=OR(ISBLANK([Crew]),' + ids.map(i => `[Crew]="${i}"`).join(',') + ')';
  const message = 'Crew must be one of the codes from the Crews list, lower case, no spaces: '
    + ids.join(', ') + '. Use the short code (devon), never the display name (Devon Crew +3). '
    + 'A code that is not on this list matches nothing: the row would be skipped by dispatch and '
    + 'by conflict detection, silently.';

  const r = await fetch(`${SITE}/_api/web/lists/GetByTitle('Assignments')/fields/getbyinternalnameortitle('Crew')`, {
    method:'POST',
    headers:{'Accept':'application/json;odata=nometadata','Content-Type':'application/json;odata=verbose',
             'X-RequestDigest':digest,'X-HTTP-Method':'MERGE','If-Match':'*'},
    body: JSON.stringify({__metadata:{type:'SP.FieldChoice'}, ValidationFormula: formula, ValidationMessage: message})
  });
  console.log('crew validation ..... ' + r.status + (r.ok ? '' : ' ' + (await r.text()).slice(0,300)));
  console.log('valid codes ......... ' + ids.join(', '));
}
run().catch(e => console.error(e));
