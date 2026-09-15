/* The Graph-shaped half of the write path.
 *
 * Everything asserted here was read off the LIVE tenant on 2026-09-15, never
 * assumed: the PATCH endpoint and its accepted field shapes from a
 * non-destructive probe on assignment row 384, the User Information List rows
 * from a read of that list, and the New Pool Requests column names from a read
 * of that list's columns. Graph is a THIRD field-shape surface alongside raw
 * REST and the Power Automate connector; a probe on one validates nothing
 * about another, which is a lesson this repo has paid for six times.
 */
const path = require('path');
const G = require(path.resolve(__dirname, '../../web/graph-writeback.js'));

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const SITE = 'netorgft15040037.sharepoint.com,1a90e0a0,14d022b7';
const LISTS = { asg: 'ASG-GUID', jobs: 'JOBS-GUID', req: 'REQ-GUID' };
const U = G.urls(SITE, LISTS);

// ---------- URLs ----------
ok('an item field write targets /items/{id}/fields',
   U.fields(LISTS.asg, '384') ===
   'https://graph.microsoft.com/v1.0/sites/' + SITE + '/lists/ASG-GUID/items/384/fields',
   U.fields(LISTS.asg, '384'));
ok('a create targets the list\'s /items collection',
   U.items(LISTS.req) ===
   'https://graph.microsoft.com/v1.0/sites/' + SITE + '/lists/REQ-GUID/items');
ok('the User Information List is addressed by name and expands its fields',
   U.userInfo.indexOf('/lists/User Information List/items') !== -1 &&
   U.userInfo.indexOf('$expand=fields') !== -1, U.userInfo);

// ---------- PATCH body ----------
{
  const b = G.patchBody({ id: '384', fields: { Crew: 'saul', ScheduledStart: '2026-10-01' },
                          suppressUntil: '2026-09-15T12:10:00.000Z' });
  ok('the PATCH body carries the changed fields verbatim',
     b.Crew === 'saul' && b.ScheduledStart === '2026-10-01', JSON.stringify(b));
  ok('...and the suppression stamp in the SAME body, never a second write',
     b.SuppressReconcileUntil === '2026-09-15T12:10:00.000Z', JSON.stringify(b));
  ok('...and nothing else at all',
     Object.keys(b).sort().join(',') === 'Crew,ScheduledStart,SuppressReconcileUntil',
     Object.keys(b).join(','));
  ok('ScheduledFinish is never in a PATCH body -- it is derived',
     !('ScheduledFinish' in b));
}

// ---------- site-user resolution ----------
/* These rows are the real shape of the live User Information List: it holds
   SharePoint GROUPS and system principals alongside people, groups carry no
   EMail, and the service account's EMail DIFFERS from its UPN. */
const uilRows = [
  { id: '3',  Title: 'D2 Build Scheduler Owners', Name: 'D2 Build Scheduler Owners' },
  { id: '5',  Title: 'D2 Build Scheduler Members', Name: 'D2 Build Scheduler Members' },
  { id: '7',  Title: 'D2 Bot', Name: 'i:0#.f|membership|stratirus@d2pools.com', EMail: 'd2bot@d2pools.com' },
  { id: '13', Title: 'David Taylor', Name: 'i:0#.f|membership|david@d2pools.com', EMail: 'david@d2pools.com' },
  { id: '16', Title: 'Don Borgeson', Name: 'i:0#.f|membership|don@d2pools.com', EMail: 'don@d2pools.com' }
];
ok('resolves a real user from the claims Name',
   G.resolveSiteUserId(uilRows, 'david@d2pools.com').id === '13',
   JSON.stringify(G.resolveSiteUserId(uilRows, 'david@d2pools.com')));
ok('resolves the service account whose EMail DIFFERS from its UPN',
   G.resolveSiteUserId(uilRows, 'stratirus@d2pools.com').id === '7',
   JSON.stringify(G.resolveSiteUserId(uilRows, 'stratirus@d2pools.com')));
ok('matching is case-insensitive on the UPN',
   G.resolveSiteUserId(uilRows, 'David@D2Pools.com').id === '13');
ok('an unknown user resolves to nothing, never to a group',
   G.resolveSiteUserId(uilRows, 'nobody@d2pools.com').id === null);
ok('an EMPTY upn resolves to nothing -- it must never match a group with no EMail',
   G.resolveSiteUserId(uilRows, '').id === null,
   JSON.stringify(G.resolveSiteUserId(uilRows, '')));
ok('a null upn resolves to nothing',
   G.resolveSiteUserId(uilRows, null).id === null);
/* This one exists because a mutation sweep found the empty-UPN guard could be
   deleted with no test noticing: the suffix anchoring below happens to make an
   empty UPN safe by a second route. "Happens to" is not a safety property, and
   a Name ending in a bare pipe is the case where the two routes disagree. */
ok('an empty upn does not match even a row whose Name ends in a bare pipe',
   G.resolveSiteUserId([{ id: '42', Title: 'Odd principal', Name: 'x|' }], '').id === null,
   JSON.stringify(G.resolveSiteUserId([{ id: '42', Title: 'Odd principal', Name: 'x|' }], '')));
/* An EMail that matches while the claims Name does not must NOT resolve: mail
   is an attribute, Name is the sign-in identity, and this project joins on
   userPrincipalName everywhere for exactly that reason. */
ok('a row whose EMail matches but whose claims Name does not is NOT resolved',
   G.resolveSiteUserId([{ id: '99', Title: 'Impostor', Name: 'i:0#.f|membership|someone.else@d2pools.com',
                          EMail: 'david@d2pools.com' }], 'david@d2pools.com').id === null,
   'mail is not identity');
ok('two matching rows are ambiguous and resolve to nothing rather than the first',
   (() => { const r = G.resolveSiteUserId(
     [uilRows[3], { id: '77', Title: 'David Taylor (dupe)', Name: 'i:0#.f|membership|david@d2pools.com' }],
     'david@d2pools.com'); return r.id === null && r.ambiguous === true; })());

// ---------- create body ----------
/* Column names read off the live New Pool Requests list on 2026-09-15.
   Title holds the POOL NAME and JobNumber holds the job number -- every live
   row reads Title "Reyes Residence", JobNumber "D2-1042". There is no
   PoolName column. */
{
  const b = G.createBody({ jobno: 'D2-1046', name: 'Ortiz Residence', addr: '1 Main St',
                           city: 'Westlake Village', start: '2026-10-05',
                           assignDefaultCrews: true }, '13');
  ok('Title carries the POOL NAME, matching every live row',
     b.Title === 'Ortiz Residence', JSON.stringify(b.Title));
  ok('JobNumber carries the job number',
     b.JobNumber === 'D2-1046', JSON.stringify(b.JobNumber));
  ok('there is no invented PoolName column',
     !('PoolName' in b), Object.keys(b).join(','));
  ok('the Person column is set by lookup id, as a string',
     b.ProjectManagerLookupId === '13', JSON.stringify(b));
  ok('AssignDefaultCrews is sent EXPLICITLY, never left to the list default',
     b.AssignDefaultCrews === true, JSON.stringify(b));
  ok('StartDate is a bare yyyy-MM-dd, so SharePoint reads it in site-local time',
     b.StartDate === '2026-10-05', b.StartDate);
  ok('Status and Result are never set -- they are flow-owned',
     !('Status' in b) && !('Result' in b), Object.keys(b).join(','));
  ok('the body carries exactly the seven writable columns and nothing else',
     Object.keys(b).sort().join(',') ===
     'Address,AssignDefaultCrews,City,JobNumber,ProjectManagerLookupId,StartDate,Title',
     Object.keys(b).join(','));
}
{
  const b = G.createBody({ jobno: 'D2-1046', name: 'X', start: '2026-10-05' }, '13');
  ok('AssignDefaultCrews false is still sent explicitly, not omitted',
     b.AssignDefaultCrews === false, JSON.stringify(b.AssignDefaultCrews));
}
{
  let threw = false, msg = '';
  try { G.createBody({ jobno: 'D2-1046', name: 'X', start: '2026-10-05' }, null); }
  catch (e) { threw = true; msg = e.message; }
  ok('a create with no resolved PM THROWS rather than sending a blank Person column',
     threw, msg.slice(0, 60));
}

// ---------- status body ----------
ok('activating a pool writes only Status',
   JSON.stringify(G.statusBody('Active')) === '{"Status":"Active"}');

// ---------- applyWrites ----------
(async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body),
                 auth: (init.headers || {}).Authorization });
    const bad = url.indexOf('/999/') !== -1;
    return { ok: !bad, status: bad ? 403 : 200, json: async () => (bad ? { error: { code: 'denied' } } : {}) };
  };
  const r = await G.applyWrites(
    { token: 'TKN', siteId: SITE, listId: LISTS.asg, fetchImpl },
    [{ id: '384', fields: { Crew: 'saul' }, suppressUntil: 'S', jobno: 'D2-1044', num: '3.5' },
     { id: '999', fields: { Crew: 'saul' }, suppressUntil: 'S', jobno: 'D2-1044', num: '9.9' },
     { id: '385', fields: { DurationDays: 3 }, suppressUntil: 'S', jobno: 'D2-1044', num: '3.6' }]);

  ok('each write is its own PATCH', calls.length === 3 && calls.every(c => c.method === 'PATCH'),
     calls.map(c => c.method).join(','));
  ok('every request carries the bearer token', calls.every(c => c.auth === 'Bearer TKN'));
  ok('a failing row does NOT abort the batch -- the rows after it still write',
     r.written.length === 2 && r.failed.length === 1, JSON.stringify(r));
  ok('...and the failure names the row and the status',
     r.failed[0].id === '999' && r.failed[0].status === 403, JSON.stringify(r.failed));
  ok('...and captures the error detail rather than discarding it',
     !!r.failed[0].detail, JSON.stringify(r.failed[0].detail));
  ok('a written row reports which fields landed',
     r.written[0].fields.join(',') === 'Crew', JSON.stringify(r.written[0]));

  console.log(fail ? '\nFAILED'
    : '\nGraph write layer: URLs, bodies, site-user resolution and per-row failure isolation all hold.');
  process.exit(fail);
})();
