/* Rejecting a sign-off, commenting, and resolving. Core decisions first, then
 * the Graph shapes, then the page.
 *
 * WHY THIS EXISTS: a rejection clears an attested sign-off and appends a
 * permanent line to SignOffNotes. Getting the refusal cases wrong means either
 * refusing a legitimate rejection or reopening a sign-off somebody else already
 * dealt with. The core is pure, so it is pinned here with no browser at all.
 *
 * Grown by more than one task: this file's core section (planRejections,
 * appendRejected) is self-contained so later tasks can append a jsdom section
 * and UI assertions below it. The summary/exit block stays at the very bottom
 * of the file; a later task moves it down rather than duplicating it.
 */
const path = require('path');
const C = require(path.resolve(__dirname, '../../web/writeback-core.js'));

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

// ============================================================================
// CORE -- planRejections and appendRejected. Pure, no browser.
// ============================================================================

const NOW = '2026-09-22T17:05:00Z';        // 12:05 Central
const live = {
  '10': { id: '10', Title: 'D2-1042 5.3 Tile Installation', InstallerSignOff: true,
          InstallerSignOffByLookupId: '14', SignOffNotes: 'signed on site', Rejected: false },
  '11': { id: '11', Title: 'D2-1042 5.4 Coping Installation', InstallerSignOff: false, Rejected: false },
  '12': { id: '12', Title: 'D2-1042 6.1 Equipment Installation', InstallerSignOff: false,
          Rejected: true, RejectedReason: 'earlier reason' }
};
const opts = { userName: 'Don Borgeson', userNamesById: { '14': 'Cody Campbell' },
               nowIso: NOW, nowMs: Date.parse(NOW), suppressMinutes: 10 };
const pool = (sections) => [{ jobno: 'D2-1042', name: 'Reyes Residence', sections }];

// --- Reject a signed sub-phase ---------------------------------------------
let r = C.planRejections(pool([
  { id: '10', num: '5.3', name: 'Tile Installation',
    actions: [{ localId: 'a1', kind: 'reject', body: 'tile line is short on the east wall' }] }
]), live, opts);

ok('a clean reject is not refused', r.refusals.length === 0 && r.errors.length === 0);
ok('one op for one reject', r.ops.length === 1, 'got ' + r.ops.length);
const op = r.ops[0];
ok('a reject carries BOTH a patch and a post', !!(op.patch && op.post));
ok('reject clears the sign-off flag', op.patch.fields.InstallerSignOff === false);
ok('reject clears the attribution', op.patch.fields.InstallerSignOffByLookupId === null);
ok('reject clears the timestamp', op.patch.fields.InstallerSignOffOn === null);
ok('reject sets Rejected', op.patch.fields.Rejected === true);
ok('reject stamps RejectedOn', op.patch.fields.RejectedOn === NOW);
ok('reason stored on the row',
   op.patch.fields.RejectedReason === 'tile line is short on the east wall');
ok('the patch carries a suppression stamp ahead of now',
   typeof op.patch.suppressUntil === 'string' && op.patch.suppressUntil > NOW);
ok('the notes line matches the reopen shape, in Central time',
   op.patch.fields.SignOffNotes ===
     'signed on site  |  REJECTED 2026-09-22 12:05 by Don Borgeson (was signed by Cody Campbell): tile line is short on the east wall',
   op.patch.fields.SignOffNotes);
ok('the comment row is Kind=Rejected', op.post.Kind === 'Rejected');
ok('the reason is the comment body', op.post.Body === 'tile line is short on the east wall');
ok('the comment points at the assignment, as a string', op.post.AssignmentLookupId === '10');
ok('Title is "<JobNumber> <SubPhaseNumber>"', op.post.Title === 'D2-1042 5.3', op.post.Title);

// --- Refusals ----------------------------------------------------------------
r = C.planRejections(pool([{ id: '11', num: '5.4', name: 'Coping Installation',
  actions: [{ localId: 'a2', kind: 'reject', body: 'no good' }] }]), live, opts);
ok('rejecting an unsigned sub-phase is refused', r.ops.length === 0 && r.refusals.length === 1);
ok('reason is not-signed', r.refusals[0].reason === 'not-signed', r.refusals[0].reason);

r = C.planRejections(pool([{ id: '12', num: '6.1', name: 'Equipment Installation',
  actions: [{ localId: 'a3', kind: 'reject', body: 'again' }] }]), live, opts);
ok('rejecting an already-rejected sub-phase is refused',
   r.refusals.length === 1 && r.refusals[0].reason === 'already-rejected');

r = C.planRejections(pool([{ id: '10', num: '5.3', name: 'Tile Installation',
  actions: [{ localId: 'a4', kind: 'resolve', body: '' }] }]), live, opts);
ok('resolving something not rejected is refused',
   r.refusals.length === 1 && r.refusals[0].reason === 'not-rejected');

r = C.planRejections(pool([{ id: '10', num: '5.3', name: 'Tile Installation',
  actions: [{ localId: 'a5', kind: 'reject', body: '   ' }] }]), live, opts);
ok('a whitespace-only rejection reason is refused by the CORE, not only by the UI',
   r.refusals.length === 1 && r.refusals[0].reason === 'reason-required');

r = C.planRejections(pool([{ id: '10', num: '5.3', name: 'Tile Installation',
  actions: [{ localId: 'a6', kind: 'comment', body: '' }] }]), live, opts);
ok('an empty comment is refused', r.refusals.length === 1 && r.refusals[0].reason === 'body-required');

// --- Resolve -------------------------------------------------------------
r = C.planRejections(pool([{ id: '12', num: '6.1', name: 'Equipment Installation',
  actions: [{ localId: 'a7', kind: 'resolve', body: 'fixed and re-checked' }] }]), live, opts);
ok('resolve produces one op', r.ops.length === 1);
ok('resolve clears Rejected', r.ops[0].patch.fields.Rejected === false);
ok('resolve clears the reason', r.ops[0].patch.fields.RejectedReason === null);
ok('resolve KEEPS RejectedOn as history', !('RejectedOn' in r.ops[0].patch.fields));
ok('resolve signs nothing off', !('InstallerSignOff' in r.ops[0].patch.fields));
ok('the comment row is Kind=Resolved', r.ops[0].post.Kind === 'Resolved');

r = C.planRejections(pool([{ id: '12', num: '6.1', name: 'Equipment Installation',
  actions: [{ localId: 'a8', kind: 'resolve', body: '' }] }]), live, opts);
ok('a resolve with no note is allowed, unlike a comment or a rejection',
   r.ops.length === 1 && r.ops[0].post.Body === '');

// --- Comment -------------------------------------------------------------
r = C.planRejections(pool([{ id: '11', num: '5.4', name: 'Coping Installation',
  actions: [{ localId: 'a9', kind: 'comment', body: 'waiting on materials' }] }]), live, opts);
ok('a comment writes NOTHING to the assignment row', r.ops.length === 1 && r.ops[0].patch === null);
ok('the comment body goes through',
   r.ops[0].post.Kind === 'Comment' && r.ops[0].post.Body === 'waiting on materials');

// --- Identity and missing rows --------------------------------------------
r = C.planRejections(pool([{ id: '999', num: '5.3', name: 'Gone',
  actions: [{ localId: 'b1', kind: 'comment', body: 'x' }] }]), live, opts);
ok('a missing row is an error', r.errors.length === 1 && r.errors[0].reason === 'row-missing');

r = C.planRejections(pool([{ id: '10', num: '5.9', name: 'Wrong',
  actions: [{ localId: 'b2', kind: 'comment', body: 'x' }] }]), live, opts);
ok('the live Title must match jobno and num before anything is written',
   r.errors.length === 1 && r.errors[0].reason === 'identity-mismatch');

// A 2.1 action must never land on a 2.10 row: titleMatches is token-anchored.
ok('titleMatches stays token-anchored for rejections too',
   C.titleMatches('D2-1042 2.10 Something', 'D2-1042', '2.1') === false);

// --- Ordering across many actions on one section --------------------------
r = C.planRejections(pool([{ id: '10', num: '5.3', name: 'Tile Installation', actions: [
  { localId: 'c1', kind: 'comment', body: 'first' },
  { localId: 'c2', kind: 'reject',  body: 'second' }
] }]), live, opts);
ok('ops keep the order the PM queued them in',
   r.ops.length === 2 && r.ops[0].localId === 'c1' && r.ops[1].localId === 'c2');

// --- Task ticks on a rejected sub-phase -----------------------------------
/* A rejection IS a reopen. planTaskTicks refuses a tick on a sub-phase
   SharePoint holds as signed unless the same save reopens it; a rejection
   reopens it, so the ticks that fix the problem must land in the same Save. */
const liveTasks = { '501': { id: '501', Complete: false, NotApplicable: false, AssignmentLookupId: '10' } };
const tickPool = (extra) => [{ jobno: 'D2-1042', name: 'Reyes Residence', sections: [
  Object.assign({ id: '10', num: '5.3', name: 'Tile Installation', tasks: [
    { id: '501', title: 'Waterline tile layout',
      from: { done: false, na: false, note: '' }, to: { done: true, na: false, note: '' } }
  ] }, extra)
] }];
const tickOpts = { userLookupId: '16', userName: 'Don Borgeson',
                   nowIso: NOW, liveAsgById: live };

let t = C.planTaskTicks(tickPool({}), liveTasks, tickOpts);
ok('baseline: a tick on a signed sub-phase is refused',
   t.writes.length === 0 && t.refusals.length === 1 && t.refusals[0].reason === 'signed-off');

t = C.planTaskTicks(tickPool({ inst: { from: true, to: false } }), liveTasks, tickOpts);
ok('baseline: an explicit un-tick of INST in the same save allows the tick',
   t.writes.length === 1);

t = C.planTaskTicks(tickPool({ rejecting: true }), liveTasks, tickOpts);
ok('a rejection in the same save allows the tick',
   t.writes.length === 1 && t.refusals.length === 0, 'got ' + t.refusals.length + ' refusals');

/* And it is one reopen, not two: a rejection alongside an explicit INST
   un-tick must not produce two audit lines. That is asserted on the notes in
   Task 8, where both sets are built together; here only the tick is checked. */
t = C.planTaskTicks(tickPool({ rejecting: true, inst: { from: true, to: false } }), liveTasks, tickOpts);
ok('rejection plus an INST un-tick still allows the tick',
   t.writes.length === 1);

// ============================================================================
// PAGE -- the real planner in jsdom, with only fetch stubbed. The write
// scripts are inlined because jsdom does not fetch <script src>.
// ============================================================================
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const WEB = path.resolve(__dirname, '../../web');
const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
const pageHtml = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
  .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
  .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
  .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
  .replace('</body>', `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.D2_GRAPH=D2_GRAPH;
     window.importFromD2Payload=importFromD2Payload;window.editSec=editSec;window.render=render;
     window.UI=UI;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(pageHtml, { runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.alert = () => {}; win.confirm = () => true;

const secByNum = (jobno, num) => {
  const j = win.S.jobs.find(x => x.jobno === jobno);
  const hit = j && win.allSecs(j).find(x => x.s.num === num);
  return hit ? hit.s : null;
};

const pageTests = async () => {
  await new Promise(r => setTimeout(r, 600));

  // ---- Refresh carries rejection state and the thread --------------------
  /* The comments list must NOT ride the Promise.all over D2_GRAPH.lists: that
     loop has no per-key catch, so one failing list fails the entire Refresh
     and a PM loses the schedule over a feature they were not using. */
  const payload = {
    app: 'D2 Pool Build Scheduler', kind: 'd2-sharepoint-export', exported: '2026-09-22', site: 'x', nonWork: [],
    jobs: [{ id: 19, jobno: 'D2-1042', name: 'Reyes Residence', addr: '', city: '', start: '2026-09-08',
      status: 'Active', pm: '',
      sections: [{ num: '5.3', id: 10, seq: 30, crewId: 'cirilo', start: '2026-10-05', days: 2,
        inst: true, pm: false, locked: false, skip: false,
        rejected: true, rejectedOn: '2026-09-20T14:05:00Z', rejectedReason: 'coping joints uneven',
        thread: [{ id: '1', kind: 'Rejected', body: 'coping joints uneven',
                   by: 'Don Borgeson', at: '2026-09-20T14:05:00Z' }],
        tasks: [] }] }]
  };
  win.importFromD2Payload(JSON.parse(JSON.stringify(payload)), true);
  let s = secByNum('D2-1042', '5.3');
  ok('the imported sub-phase is found', !!s);
  ok('rejected lands on the section', s.rejected === true, String(s.rejected));
  ok('rejectedOn lands on the section', s.rejectedOn === '2026-09-20T14:05:00Z');
  ok('the reason lands', s.rejectedReason === 'coping joints uneven');
  ok('the thread lands', Array.isArray(s.thread) && s.thread.length === 1 && s.thread[0].by === 'Don Borgeson');
  ok('rejection state is NOT in s.base',
     Object.keys(s.base).sort().join(',') === 'crewId,days,id,inst,locked,pm,seq,skip,spLocked,start',
     Object.keys(s.base).sort().join(','));

  /* A second Refresh with no thread must clear it rather than keep a stale
     one: the entries may have been deleted on the site. */
  const noThread = JSON.parse(JSON.stringify(payload));
  delete noThread.jobs[0].sections[0].thread;
  noThread.jobs[0].sections[0].rejected = false;
  noThread.jobs[0].sections[0].rejectedReason = null;
  win.importFromD2Payload(noThread, true);
  s = secByNum('D2-1042', '5.3');
  ok('a payload with no thread clears it', Array.isArray(s.thread) && s.thread.length === 0,
     s.thread && String(s.thread.length));
  ok('rejected clears too', s.rejected === false);
  ok('the reason clears too', s.rejectedReason === null);

  ok('the comments list GUID is configured',
     typeof win.D2_GRAPH.commentsList === 'string' && win.D2_GRAPH.commentsList.length > 10);
  ok('comments is NOT in D2_GRAPH.lists, so it cannot ride the Promise.all',
     !('comments' in win.D2_GRAPH.lists));

  /* Drive the real loadFromD2ViaGraph with the comments read returning 500.
     The schedule must still load, and the threads come back empty. */
  const G = win.D2_GRAPH;
  const graphItem = (id, fields) => ({ id: String(id), createdDateTime: '2026-09-01T00:00:00Z',
    createdBy: { user: { displayName: 'D2 Bot' } }, fields: Object.assign({ id: String(id) }, fields) });
  const rowsFor = {};
  rowsFor[G.lists.jobs] = [graphItem(19, { Title: 'Reyes Residence', JobNumber: 'D2-1042', Status: 'Active',
                                           StartDate: '2026-09-08T05:00:00Z' })];
  rowsFor[G.lists.asg] = [graphItem(10, { Title: 'D2-1042 5.3 Tile Installation', JobLookupId: '19',
    SubPhaseNumber: '5.3', SubPhaseName: 'Tile Installation', Sequence: 30, Crew: 'cirilo',
    ScheduledStart: '2026-10-05T05:00:00Z', ScheduledFinish: '2026-10-06T05:00:00Z', DurationDays: 2,
    InstallerSignOff: true, PMSignOff: false, Locked: false, NotApplicable: false,
    Rejected: true, RejectedReason: 'still rejected', RejectedOn: '2026-09-21T10:00:00Z' })];
  let commentsHit = 0;
  win.graphToken = async () => 'tok';
  win.graphSite = async () => ({ id: 'site1', webUrl: 'https://example/sites/x' });
  win.fetch = async (url) => {
    if (G.commentsList && url.indexOf(G.commentsList) > -1) {
      commentsHit++;
      return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
    }
    const key = Object.keys(rowsFor).find(k => url.indexOf(k) > -1);
    return { ok: true, status: 200, json: async () => ({ value: key ? rowsFor[key] : [] }),
             text: async () => '' };
  };
  let threw = null;
  try { await win.eval('loadFromD2ViaGraph')(true); } catch (e) { threw = e; }
  ok('a failing comments read does not fail Refresh', threw === null, threw && threw.message);
  ok('the comments list was actually requested', commentsHit > 0, String(commentsHit));
  s = secByNum('D2-1042', '5.3');
  ok('the schedule still loaded after the comments read failed',
     !!s && s.rejectedReason === 'still rejected', s && String(s.rejectedReason));
  ok('and the thread is empty rather than missing', !!s && Array.isArray(s.thread) && s.thread.length === 0);
};

// ============================================================================
// SUMMARY -- keep this block last. A later task appends its own section above
// this line and moves this block back down to the bottom of the file.
// ============================================================================
pageTests().then(() => {
  console.log(fail ? '\nFAILED' : '\nrejection assertions passed.');
  process.exit(fail);
}, e => { console.log('FAIL · page tests threw  [' + e.stack + ']'); process.exit(1); });
