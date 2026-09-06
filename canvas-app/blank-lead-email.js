/* Blank the placeholder Crews.LeadEmail values.  PREREQUISITE FOR THE CANVAS APP.
 *
 * WHY THIS IS NOT COSMETIC
 * ------------------------
 * All seven real field crews (saul, guillermo, harrison, antonio, devon, cirilo, campos)
 * currently carry the SAME value: stalbot@stratirus.com.  That is an external UPN which
 * does not exist in the D2 tenant, so no D2 user can ever match it -- and because all
 * seven share it, a Power Apps LookUp against LeadEmail returns only the FIRST match.
 *
 * The failure mode is the dangerous kind: the app appears to work, and shows every crew
 * lead Saul's assignments.  Empty is strictly safer than wrong, because empty falls
 * through to the PM-proxy picker -- which has to be built anyway for the four Unlimited
 * subcontractor crews, who have no M365 seat by design and can never sign off for
 * themselves.
 *
 * WHAT REPLACES IT
 * ----------------
 * Once the ~7 crew-lead identities exist in the tenant, seed LeadEmail with
 * userPrincipalName, NOT mail.  In this tenant `mail` is unreliable: blank on unlicensed
 * accounts, and divergent even on the service account (D2 Bot's UPN is
 * stratirus@d2pools.com while its mail is d2bot@d2pools.com).  Match in the app as
 *     LookUp(Crews, LeadEmail = gblCurrentUser.userPrincipalName)
 * Matching on `mail` fails silently -- the same signature as the CrewID bug.
 *
 * HOW TO RUN
 * ----------
 * Paste into the browser console on
 *   https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler
 * while signed in as stratirus@d2pools.com.  Chrome MCP tab groups get their own cookie
 * context and land on the sign-in wall, so this has to be your own signed-in tab.
 *
 * Idempotent.  Only clears rows whose LeadEmail exactly equals PLACEHOLDER, so a real
 * UPN seeded later is never touched.  Re-running after a clean pass is a no-op.
 *
 * Flow 3 is currently Stopped, so these writes cost nothing.  If it has been restarted,
 * stop it first: every Assignments/Crews edit fires it while its trigger condition
 * remains a no-op.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const PLACEHOLDER = 'stalbot@stratirus.com';
  const H = { Accept: 'application/json;odata=verbose' };
  const get = async u => (await fetch(u, { headers: H, credentials: 'include' })).json();

  const dg = await (await fetch(site + '/_api/contextinfo',
    { method: 'POST', headers: H, credentials: 'include' })).json();
  const digest = dg.d.GetContextWebInformation.FormDigestValue;

  // Never hand-write the entity type name -- read it off the list metadata.
  const meta = await get(`${site}/_api/web/lists/GetByTitle('Crews')?$select=ListItemEntityTypeFullName`);
  const etype = meta.d.ListItemEntityTypeFullName;

  // No $select: naming a column that does not exist 400s the whole call and tells you
  // nothing useful. Fetch everything (14 rows) and check the shape ourselves.
  const before = await get(`${site}/_api/web/lists/GetByTitle('Crews')/items?$top=100`);
  const rows = before.d.results;

  if (!rows.length) { console.error('Crews list returned no rows. Wrong site?'); return; }
  if (!('LeadEmail' in rows[0])) {
    console.error('No LeadEmail column. Internal names on this list are:');
    console.error(Object.keys(rows[0]).filter(k => !k.startsWith('__')).sort().join(', '));
    return;
  }

  console.table(rows.map(r => ({
    ID: r.ID, CrewID: r.CrewID, Title: r.Title,
    LeadEmail: r.LeadEmail || '(empty)', Unlimited: r.Unlimited
  })));

  const doomed = rows.filter(r => r.LeadEmail === PLACEHOLDER);
  if (!doomed.length) {
    console.log('Nothing to do -- no row holds the placeholder. Already clean.');
    return { cleared: 0, rows: rows.length };
  }

  // MERGE, not Update: it validates only the fields named in the body.  Crews does not
  // have the Required-but-NULL problem Assignments has, but MERGE is the house pattern
  // and stays correct if required columns are added later.
  const clear = r => fetch(`${site}/_api/web/lists/GetByTitle('Crews')/items(${r.ID})`, {
    method: 'POST', credentials: 'include',
    headers: {
      ...H, 'Content-Type': 'application/json;odata=verbose',
      'X-RequestDigest': digest, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE'
    },
    body: JSON.stringify({ __metadata: { type: etype }, LeadEmail: null })
  }).then(res => ({ id: r.ID, crew: r.CrewID, status: res.status }));

  const results = [];
  for (let i = 0; i < doomed.length; i += 8) {
    results.push(...await Promise.all(doomed.slice(i, i + 8).map(clear)));
  }

  const after = await get(`${site}/_api/web/lists/GetByTitle('Crews')/items?$top=100`);
  const out = {
    entityType: etype,
    cleared: doomed.length,
    failures: results.filter(r => r.status !== 200 && r.status !== 204),
    stillSet: after.d.results.filter(r => r.LeadEmail).map(r => `${r.CrewID}=${r.LeadEmail}`),
    expected: 'cleared 7, failures [], stillSet []'
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
})();
