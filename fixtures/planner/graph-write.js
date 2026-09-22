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

  // ---------- commentBody ----------
  /* The comments list has no SuppressReconcileUntil column. That column
     does not exist on this list and sending it fails the PATCH outright on
     Tasks; do not invent it here either. */
  const cb = G.commentBody({ Title: 'D2-1042 5.3', AssignmentLookupId: '10',
                              Kind: 'Rejected', Body: 'tile line short' });
  ok('the body nests under fields',
     !!cb.fields && cb.fields.Kind === 'Rejected', JSON.stringify(cb));
  ok('the lookup is sent as AssignmentLookupId',
     cb.fields.AssignmentLookupId === '10', JSON.stringify(cb.fields));
  ok('no suppression column on the comments list',
     !('SuppressReconcileUntil' in cb.fields), Object.keys(cb.fields).join(','));
  ok('exactly four fields',
     Object.keys(cb.fields).sort().join(',') === 'AssignmentLookupId,Body,Kind,Title',
     Object.keys(cb.fields).sort().join(','));
  /* Graph returns lookup ids as strings, and this project's most repeated
     defect is an unnormalised join. Pass a NUMBER in so a dropped String()
     is actually caught -- a string-in-string-out input can't tell the two
     apart. */
  const cbNum = G.commentBody({ Title: 'x', AssignmentLookupId: 10, Kind: 'Comment', Body: 'x' });
  ok('the lookup id is stringified even when given as a number',
     cbNum.fields.AssignmentLookupId === '10' && typeof cbNum.fields.AssignmentLookupId === 'string',
     JSON.stringify(cbNum.fields.AssignmentLookupId) + ' (' + typeof cbNum.fields.AssignmentLookupId + ')');

  // ---------- applyRejectionOps: PATCH the assignment, POST the comment ----------
  /* Follows the file's own fetchImpl convention (see applyWrites above)
     rather than reassigning global.fetch, so both stubs coexist cleanly. */
  const posted = [], patched = [];
  let failNextPatch = false, failNextPost = false;
  const rejFetch = async (url, init) => {
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
  const rctx = { token: 't', siteId: 'site1', asgListId: 'ASG', commentsListId: 'CMT', fetchImpl: rejFetch };

  // A reject: PATCH first, POST second, both to the right lists.
  patched.length = 0; posted.length = 0;
  let rres = await G.applyRejectionOps(rctx, [{
    localId: 'a1', kind: 'reject', id: '10',
    patch: { id: '10', fields: { Rejected: true }, suppressUntil: '2026-09-22T17:15:00Z' },
    post: { Title: 'D2-1042 5.3', AssignmentLookupId: '10', Kind: 'Rejected', Body: 'x' }
  }]);
  ok('one PATCH and one POST',
     patched.length === 1 && posted.length === 1,
     'patched=' + patched.length + ' posted=' + posted.length);
  ok('the PATCH goes to the Assignments row fields',
     patched[0].url.indexOf('/lists/ASG/items/10/fields') > -1, patched[0].url);
  ok('the suppression stamp rides the Assignments PATCH',
     patched[0].body.SuppressReconcileUntil === '2026-09-22T17:15:00Z', JSON.stringify(patched[0].body));
  ok('the POST goes to the comments list',
     posted[0].url.indexOf('/lists/CMT/items') > -1, posted[0].url);
  ok('the new comment id comes back',
     rres.done.length === 1 && rres.done[0].commentId === '77', JSON.stringify(rres));
  ok('nothing failed', rres.failed.length === 0, JSON.stringify(rres.failed));

  // A comment: POST only, no PATCH.
  patched.length = 0; posted.length = 0;
  rres = await G.applyRejectionOps(rctx, [{ localId: 'a2', kind: 'comment', id: '11', patch: null,
    post: { Title: 'D2-1042 5.4', AssignmentLookupId: '11', Kind: 'Comment', Body: 'waiting' } }]);
  ok('a comment PATCHes nothing',
     patched.length === 0 && posted.length === 1,
     'patched=' + patched.length + ' posted=' + posted.length);

  // A failed PATCH must NOT post.
  patched.length = 0; posted.length = 0; failNextPatch = true;
  rres = await G.applyRejectionOps(rctx, [{ localId: 'a3', kind: 'reject', id: '10',
    patch: { id: '10', fields: { Rejected: true }, suppressUntil: 'z' },
    post: { Title: 'D2-1042 5.3', AssignmentLookupId: '10', Kind: 'Rejected', Body: 'x' } }]);
  failNextPatch = false;
  ok('a failed PATCH does not post a comment', posted.length === 0, 'posted=' + posted.length);
  ok('the failure names the patch stage',
     rres.failed.length === 1 && rres.failed[0].stage === 'patch', JSON.stringify(rres.failed));
  ok('nothing is reported done', rres.done.length === 0, JSON.stringify(rres.done));

  // A failed POST after a good PATCH is reported, and says the row did change.
  patched.length = 0; posted.length = 0; failNextPost = true;
  rres = await G.applyRejectionOps(rctx, [{ localId: 'a4', kind: 'reject', id: '10',
    patch: { id: '10', fields: { Rejected: true }, suppressUntil: 'z' },
    post: { Title: 'D2-1042 5.3', AssignmentLookupId: '10', Kind: 'Rejected', Body: 'x' } }]);
  failNextPost = false;
  ok('a failed POST after a good PATCH is reported at the post stage',
     patched.length === 1 && rres.failed.length === 1 && rres.failed[0].stage === 'post',
     JSON.stringify(rres.failed));
  ok('and it records that the row WAS changed',
     rres.failed[0].patched === true, JSON.stringify(rres.failed[0]));

  // One bad op does not stop the next.
  patched.length = 0; posted.length = 0;
  rres = await G.applyRejectionOps(rctx, [
    { localId: 'b1', kind: 'comment', id: '999', patch: null,
      post: { Title: 'x', AssignmentLookupId: '999', Kind: 'Comment', Body: 'a' } },
    { localId: 'b2', kind: 'comment', id: '11', patch: null,
      post: { Title: 'y', AssignmentLookupId: '11', Kind: 'Comment', Body: 'b' } }
  ]);
  ok('both ops are attempted', rres.done.length === 2, 'got ' + rres.done.length);

  console.log(fail ? '\nFAILED'
    : '\nGraph write layer: URLs, bodies, site-user resolution, per-row failure isolation and the '
      + 'reject/comment PATCH-then-POST walk all hold.');
  process.exit(fail);
})();
