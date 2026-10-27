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
/* Since 2026-10-23 a plain tick lands under a sign-off anyway, so the change
   that needs the reopen here is an UNTICK: the task is done in SharePoint and
   the PM is clearing it. */
const liveTasks = { '501': { id: '501', Complete: true, NotApplicable: false, AssignmentLookupId: '10' } };
const tickPool = (extra) => [{ jobno: 'D2-1042', name: 'Reyes Residence', sections: [
  Object.assign({ id: '10', num: '5.3', name: 'Tile Installation', tasks: [
    { id: '501', title: 'Waterline tile layout',
      from: { done: true, na: false, note: '' }, to: { done: false, na: false, note: '' } }
  ] }, extra)
] }];
const tickOpts = { userLookupId: '16', userName: 'Don Borgeson',
                   nowIso: NOW, liveAsgById: live };

let t = C.planTaskTicks(tickPool({}), liveTasks, tickOpts);
ok('baseline: an untick on a signed sub-phase is refused',
   t.writes.length === 0 && t.refusals.length === 1 && t.refusals[0].reason === 'signed-off');

t = C.planTaskTicks(tickPool({ inst: { from: true, to: false } }), liveTasks, tickOpts);
ok('baseline: an explicit un-tick of INST in the same save allows the untick',
   t.writes.length === 1);

t = C.planTaskTicks(tickPool({ rejecting: true }), liveTasks, tickOpts);
ok('a rejection in the same save allows the untick',
   t.writes.length === 1 && t.refusals.length === 0, 'got ' + t.refusals.length + ' refusals');

/* And it is one reopen, not two: a rejection alongside an explicit INST
   un-tick must not produce two audit lines. That is asserted on the notes in
   Task 8, where both sets are built together; here only the tick is checked. */
t = C.planTaskTicks(tickPool({ rejecting: true, inst: { from: true, to: false } }), liveTasks, tickOpts);
ok('rejection plus an INST un-tick still allows the untick',
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
     window.importFromD2Payload=importFromD2Payload;window.editSec=editSec;window.render=render;};</script><script>__x();</script></body>`);
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

// ---- The sub-phase panel: thread, three controls, one queue ---------------
/* Every PM-typed string is escaped. The injection probe starts
   </option></select> because the parser drops a bare <svg> in select
   context: an earlier probe passed with three names unescaped for exactly
   that reason. */
const PROBE = '</option></select><svg id="xss-probe"></svg>';
const panelTests = async () => {
  const realMode = win.graphModeAvailable;
  win.graphModeAvailable = () => true;
  const job = win.S.jobs.find(x => x.jobno === 'D2-1042');
  const hit = win.allSecs(job).find(x => x.s.num === '5.3');
  const s = hit.s, open = () => win.editSec(job.id, hit.gi, hit.si);
  const body = () => win.document.getElementById('dBody').innerHTML;
  win.S.pendingComments = [];

  // A rejected, since-unsigned sub-phase: thread, Add comment, Mark resolved, no Reject.
  s.inst = false; s.rejected = true; s.rejectedReason = 'coping joints uneven';
  s.thread = [{ id: '1', kind: 'Rejected', body: 'coping joints uneven',
                by: 'Don Borgeson', at: '2026-09-20T14:05:00Z' }];
  open();
  let h = body();
  ok('the panel has a Comments section', /Comments/.test(h));
  ok('the thread shows the author', /Don Borgeson/.test(h));
  ok('the thread shows the time in Central', /09\/20\/26 09:05/.test(h), (h.match(/\d\d\/\d\d\/\d\d \d\d:\d\d/) || [''])[0]);
  ok('there is an Add comment control', /Add comment/.test(h));
  ok('a rejected sub-phase offers Mark resolved', /Mark resolved/.test(h));
  ok('an unsigned sub-phase does not offer Reject', !/Reject sign-off/.test(h));
  ok('the panel says the sub-phase is rejected, with the reason', /Rejected/.test(h) && /coping joints uneven/.test(h));

  // Reject is offered only while Installer is ticked.
  s.inst = true; s.rejected = false; s.rejectedReason = null; s.thread = [];
  open(); h = body();
  ok('a signed sub-phase offers Reject sign-off', /Reject sign-off/.test(h));
  ok('an unrejected sub-phase does not offer Mark resolved', !/Mark resolved/.test(h));
  ok('an empty thread says so', /No comments yet/.test(h));

  // An empty reason refuses and queues nothing.
  const alerts = [];
  win.alert = m => alerts.push(m);
  win.document.getElementById('fComment').value = '   ';
  win.queueReject();
  ok('an empty reason queues nothing', win.S.pendingComments.length === 0);
  ok('and says a reason is required', alerts.length === 1 && /reason/i.test(alerts[0]), alerts[0]);
  ok('and leaves the sign-off alone', s.inst === true);

  // An empty comment likewise.
  win.document.getElementById('fComment').value = '';
  win.queueComment();
  ok('an empty comment queues nothing', win.S.pendingComments.length === 0);

  // A real reject queues, un-ticks Installer on screen, and unlocks the checklist.
  win.document.getElementById('fComment').value = '  tile line is short  ';
  win.queueReject();
  const q = win.S.pendingComments;
  ok('the reject is queued', q.length === 1);
  ok('queued as a reject', q[0] && q[0].kind === 'reject');
  ok('the reason is queued, trimmed', q[0] && q[0].body === 'tile line is short');
  ok('queued against the SharePoint row id, as a string', q[0] && q[0].secId === String(s.base.id));
  ok('queued with the job number and sub-phase', q[0] && q[0].jobno === 'D2-1042' && q[0].num === '5.3');
  ok('rejecting un-ticks Installer on screen', s.inst === false);
  h = body();
  ok('the checklist is no longer locked', !/tasksLocked/.test(h));
  ok('the queue persists to localStorage',
     JSON.parse(win.localStorage.getItem(win.eval('KEY'))).pendingComments.length === 1);

  // Queued entries render as not saved, and are removable.
  ok('a queued entry says it is not saved yet', /Not saved yet/.test(h));
  win.unqueueEntry(q[0].localId);
  ok('a queued entry can be removed before saving', win.S.pendingComments.length === 0);

  // A comment and a resolve queue with the right kinds.
  s.rejected = true; open();
  win.document.getElementById('fComment').value = 'waiting on materials';
  win.queueComment();
  win.queueResolve();
  ok('a comment and a resolve queue in order',
     win.S.pendingComments.map(e => e.kind).join(',') === 'comment,resolve',
     win.S.pendingComments.map(e => e.kind).join(','));
  ok('a resolve with an empty box is allowed', win.S.pendingComments[1] && win.S.pendingComments[1].body === '');
  win.S.pendingComments = [];

  // Escaping, on both the live thread and a queued entry.
  s.thread = [{ id: '9', kind: 'Comment', body: PROBE, by: PROBE, at: '2026-09-21T10:00:00Z' }];
  s.rejectedReason = PROBE;
  win.S.pendingComments = [{ localId: 'q1', jobno: 'D2-1042', num: '5.3', secId: String(s.base.id),
                             kind: 'comment', body: PROBE, at: '2026-09-22T10:00:00Z' }];
  open();
  ok('a comment cannot inject an element, from the thread, the reason or the queue',
     win.document.getElementById('xss-probe') === null);
  ok('it is escaped rather than stripped', body().indexOf('&lt;svg') > -1);
  win.S.pendingComments = [];

  // A pool with no SharePoint baseline cannot comment at all, and says why.
  const sketch = win.newJob('Local Sketch', '', '', '', '', '2026-10-01');
  win.S.jobs.push(sketch);
  win.editSec(sketch.id, 0, 0); h = body();
  ok('a local-only pool offers no comment control', !/Add comment/.test(h));
  ok('and says it is not in SharePoint', /not in SharePoint/i.test(h));
  win.S.jobs = win.S.jobs.filter(x => x !== sketch);

  // A downloaded copy cannot write comments either, and says so.
  win.graphModeAvailable = () => false;
  open(); h = body();
  ok('a downloaded copy offers no comment control', !/Add comment/.test(h));
  ok('and says to open the planner from the site', /Open the planner from the site/i.test(h));

  win.graphModeAvailable = realMode;
  s.rejected = false; s.rejectedReason = null; s.thread = []; s.inst = true;
  win.alert = () => {};
};

// ---- Save: count, preview, order, send, report --------------------------
/* The Save button once read "Save 0 edits to SharePoint" over eight sign-off
   changes. Queued comments must be counted, previewed in words, sent after
   the sign-off pass on the same fresh read, and reported. */
const saveTests = async () => {
  const realMode = win.graphModeAvailable;
  win.graphModeAvailable = () => true;
  const job = win.S.jobs.find(x => x.jobno === 'D2-1042');
  const find = num => win.allSecs(job).find(x => x.s.num === num);
  const h53 = find('5.3'), s53 = h53.s;
  // Only 5.3 carries a SharePoint id in this payload; give 5.4 one too.
  const h54 = find('5.4'), s54 = h54.s;
  s54.base = { id: 11, seq: 31, crewId: s54.crewId ?? null, start: s54.start ?? null, days: s54.days ?? null,
               locked: !!s54.locked, skip: !!s54.skip, spLocked: false, inst: false, pm: !!s54.pm };
  s54.inst = false;
  // A clean slate: 5.3 signed in SharePoint and on screen, nothing queued.
  s53.base.inst = true; s53.inst = true; s53.rejected = false; s53.thread = [];
  win.S.pendingComments = [];
  win.render();
  const saveBtn = win.document.getElementById('saveBtn');
  ok('nothing queued, nothing changed: Save is disabled', saveBtn.disabled === true);

  // Queue a reject on 5.3 through the real control, and a comment on 5.4.
  win.editSec(job.id, h53.gi, h53.si);
  win.document.getElementById('fComment').value = 'tile line is short';
  win.queueReject();
  win.S.pendingComments.push({ localId: 'q2', jobno: 'D2-1042', num: '5.4', secId: '11',
    kind: 'comment', body: 'waiting on materials', at: '2026-09-22T10:01:00Z' });
  win.render();
  ok('queued comments make Save live', saveBtn.disabled === false);

  const set = win.buildRejectionSet();
  ok('one pool in the rejection set', set.length === 1);
  ok('two sections carry actions', set[0] && set[0].sections.length === 2);
  const r53 = set[0].sections.find(x => x.num === '5.3');
  ok('the reject is in the set, against the row id as a string',
     r53 && r53.id === '10' && r53.actions[0].kind === 'reject');
  ok('the localId travels, so a result can name the entry', r53 && typeof r53.actions[0].localId === 'string');

  /* One reopen, not two. Rejecting un-ticked Installer on screen; if the
     sign-off set also sent that un-tick, it would land first (reopen note +
     sign-off cleared) and the rejection would then be refused as not-signed. */
  const so = win.buildSignoffSet();
  const so53 = so.length ? so[0].sections.find(x => String(x.id) === '10') : null;
  ok('the sign-off set still carries the rejecting section, for the ticks', !!so53);
  ok('and marks it as rejecting', so53 && so53.rejecting === true);
  ok('but does NOT also send an Installer un-tick', so53 && so53.inst === null,
     so53 && JSON.stringify(so53.inst));

  // Removing a queued reject puts Installer back, so it cannot become a plain reopen.
  const rejId = win.S.pendingComments.find(e => e.kind === 'reject').localId;
  win.unqueueEntry(rejId);
  ok('removing a queued reject restores Installer on screen', s53.inst === true);
  ok('and nothing is left to reopen', !win.buildSignoffSet().some(p => p.sections.some(x => String(x.id) === '10')));
  win.editSec(job.id, h53.gi, h53.si);
  win.document.getElementById('fComment').value = 'tile line is short';
  win.queueReject();

  // The preview says what will happen, in words.
  win.openSavePreview();
  const pv = win.document.getElementById('dBody').innerHTML;
  ok('the preview has its own section for these', /Comments and rejections/.test(pv));
  ok('it names the reject and the sub-phase', /Reject sign-off/.test(pv) && /5\.3/.test(pv));
  ok('it shows the reason', /tile line is short/.test(pv));
  ok('it names the comment', /Comment/.test(pv) && /waiting on materials/.test(pv));
  const foot = win.document.getElementById('dFoot').textContent;
  ok('the confirm button counts them', /2 comments? (and|or) rejections?/.test(foot), foot.trim());
  ok('it never says 0 over real queued work', !/Save 0/.test(foot));
  ok('the reject is not also listed as an Installer reopen', !/reopened/.test(pv));

  // Send it through the real confirmSaveByPush, with only fetch stubbed.
  const G = win.D2_GRAPH;
  // JobLookupId as Graph returns it on every Assignments row: Save now reads a project's rows
  // by it and keeps only the ones that belong to that project.
  const asgRow = (id, f) => ({ id: String(id), fields: Object.assign({ id: String(id), JobLookupId: '19' }, f) });
  const liveAsg = [
    asgRow(10, { Title: 'D2-1042 · 5.3 Tile Installation', InstallerSignOff: true,
                 InstallerSignOffByLookupId: '14', SignOffNotes: 'signed on site', Rejected: false }),
    asgRow(11, { Title: 'D2-1042 · 5.4 Coping Installation', InstallerSignOff: false, Rejected: false })
  ];
  const sent = [];
  let postN = 0;
  win.graphToken = async () => 'tok';
  win.graphSite = async () => ({ id: 'site1', webUrl: 'x' });
  win.graphPca = () => ({ getActiveAccount: () => ({ username: 'don@d2pools.com', name: 'Don Borgeson' }),
                          getAllAccounts: () => [] });
  win.loadFromD2ViaGraph = async () => {};
  win.fetch = async (url, init) => {
    init = init || {};
    const m = init.method || 'GET';
    sent.push({ url, method: m, body: init.body ? JSON.parse(init.body) : null });
    if (m === 'GET') {
      const v = url.indexOf(G.lists.asg) > -1 ? liveAsg
        : /User%20Information%20List|userInfo|Information/.test(url)
          ? [{ id: '14', fields: { id: '14', Title: 'Cody Campbell', Name: 'i:0#.f|membership|cody@d2pools.com' } },
             { id: '16', fields: { id: '16', Title: 'Don Borgeson', Name: 'i:0#.f|membership|don@d2pools.com' } }]
          : [];
      return { ok: true, status: 200, json: async () => ({ value: v }), text: async () => '' };
    }
    if (m === 'POST' && url.indexOf(G.commentsList) > -1) {
      postN++;
      // The second comment POST fails, so one entry lands and one stays queued.
      if (postN === 2) return { ok: false, status: 400, json: async () => ({}), text: async () => 'nope' };
      return { ok: true, status: 201, json: async () => ({ id: String(700 + postN) }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  };
  const before = win.S.pendingComments.map(e => e.localId);
  await win.confirmSaveByPush();

  const patches = sent.filter(x => x.method === 'PATCH' && x.url.indexOf(G.lists.asg) > -1);
  const rejPatch = patches.find(x => x.body && x.body.Rejected === true);
  ok('the rejection PATCH went out', !!rejPatch);
  ok('it cleared the sign-off and carried the reason',
     rejPatch && rejPatch.body.InstallerSignOff === false && rejPatch.body.RejectedReason === 'tile line is short');
  ok('exactly one audit line was written for the rejection',
     patches.filter(x => x.body && typeof x.body.SignOffNotes === 'string').length === 1
     && /REJECTED/.test(rejPatch.body.SignOffNotes) && !/REOPENED/.test(rejPatch.body.SignOffNotes),
     patches.map(x => x.body && x.body.SignOffNotes).filter(Boolean).join(' / '));
  const posts = sent.filter(x => x.method === 'POST' && x.url.indexOf(G.commentsList) > -1);
  ok('two comment POSTs were attempted', posts.length === 2, String(posts.length));
  ok('the PATCH went before its POST',
     sent.indexOf(rejPatch) < sent.indexOf(posts.find(p => p.body.fields.Kind === 'Rejected')));
  const soAfter = win.eval('PENDING_SIGNOFFS') || [];
  const soSec = soAfter.length ? soAfter[0].sections.find(x => String(x.id) === '10') : null;
  ok('a rejection that landed keeps its section reopened for the ticks', soSec && soSec.rejecting === true);

  ok('the entry that landed left the queue, the failed one stayed',
     win.S.pendingComments.length === 1 && before.indexOf(win.S.pendingComments[0].localId) > -1,
     String(win.S.pendingComments.length));

  const rs = win.document.getElementById('dBody').innerHTML;
  ok('the results report the saved rejection in words', /Comments and rejections saved/.test(rs));
  ok('and the one that did not save', /NOT saved/.test(rs) && /HTTP 400/.test(rs));
  ok('the results use words, not column names', !/RejectedReason|InstallerSignOffByLookupId/.test(rs));
  ok('the results do not claim nothing needed saving', !/Nothing needed saving/.test(rs));

  /* A rejection whose PATCH fails leaves the row signed, so ticks under it
     must be refused, not written under a live sign-off. Rejections therefore
     go first, and a section whose reject did not land loses the flag. */
  win.S.pendingComments = [];
  s53.inst = true;
  win.editSec(job.id, h53.gi, h53.si);
  win.document.getElementById('fComment').value = 'second attempt';
  win.queueReject();
  const okFetch = win.fetch;
  win.fetch = async (url, init) => {
    if (init && init.method === 'PATCH' && url.indexOf(G.lists.asg) > -1 && init.body
        && JSON.parse(init.body).Rejected === true)
      return { ok: false, status: 503, json: async () => ({}), text: async () => 'busy' };
    return okFetch(url, init);
  };
  win.openSavePreview();
  await win.confirmSaveByPush();
  const soFail = win.eval('PENDING_SIGNOFFS') || [];
  const soFailSec = soFail.length ? soFail[0].sections.find(x => String(x.id) === '10') : null;
  ok('a rejection that did not land takes the reopen away, so its ticks are refused',
     soFailSec && soFailSec.rejecting === false, soFailSec && String(soFailSec.rejecting));
  ok('and the failed reject stays queued', win.S.pendingComments.some(e => e.kind === 'reject'));
  win.fetch = okFetch;

  // A refusal is reported in a sentence, and the entry stays queued.
  win.S.pendingComments = [{ localId: 'z1', jobno: 'D2-1042', num: '5.4', secId: '11',
                             kind: 'resolve', body: '', at: '2026-09-22T11:00:00Z' }];
  sent.length = 0;
  win.openSavePreview();
  await win.confirmSaveByPush();
  const rs2 = win.document.getElementById('dBody').innerHTML;
  ok('a refusal is reported in a sentence', /it is not currently rejected/.test(rs2));
  ok('a refused entry stays queued so it can be seen and retried', win.S.pendingComments.length === 1);

  win.S.pendingComments = [];
  s54.base = null;
  win.graphModeAvailable = realMode;
};

// ---- The Open rejections card and the board label -------------------------
/* Every unresolved rejection in one place, following the job picker, and
   calling out the ones whose installer has signed again: those are the ones a
   PM can act on now. */
const cardTests = async () => {
  const main = () => win.document.getElementById('main').innerHTML;
  const setTab = t => win.eval('TAB=' + JSON.stringify(t));
  /* UI is replaced after the page boots, so window.UI is stale: set it in-page. */
  const pick = id => win.eval('UI.signoffJob=' + JSON.stringify(id));
  const job = win.S.jobs.find(x => x.jobno === 'D2-1042');
  const hA = win.allSecs(job).find(x => x.s.num === '5.3'), sA = hA.s;
  // A second pool, also rejected, to prove the card follows the picker.
  const other = win.newJob('Other Pool', '', '', '', '', '2026-10-01');
  other.jobno = 'D2-2000';
  win.S.jobs.push(other);
  const sB = win.allSecs(other)[0].s;
  sB.rejected = true; sB.rejectedReason = 'other pool reason'; sB.rejectedOn = '2026-09-19T14:00:00Z';

  sA.rejected = true; sA.rejectedOn = '2026-09-20T14:05:00Z';
  sA.rejectedReason = 'coping joints uneven'; sA.inst = false;
  sA.thread = [{ id: '1', kind: 'Rejected', body: 'coping joints uneven',
                 by: 'Don Borgeson', at: '2026-09-20T14:05:00Z' }];
  pick('');
  setTab('signoff'); win.render();
  let v = main();
  ok('the Sign-Offs tab carries an Open rejections card', /Open rejections/.test(v));
  ok('it counts them', /Open rejections <span[^>]*>2</.test(v), (v.match(/Open rejections[^<]*<span[^>]*>\d+/) || [''])[0]);
  ok('it shows the reason', /coping joints uneven/.test(v));
  ok('it names who rejected it and when, in Central', /Don Borgeson/.test(v) && /09\/20\/26 09:05/.test(v));
  ok('nothing says signed again while it is unsigned', !/Signed again/.test(v));

  sA.inst = true; win.render();
  ok('once the installer signs again the entry says so', /Signed again, ready to review/.test(main()));

  // It follows the job picker.
  pick(job.id); win.render(); v = main();
  ok('with one job picked, that job\'s rejection is listed', /coping joints uneven/.test(v));
  ok('and the other pool\'s is not', !/other pool reason/.test(v));
  pick(other.id); win.render(); v = main();
  ok('picking the other pool swaps them', /other pool reason/.test(v) && !/coping joints uneven/.test(v));
  pick('');

  // The Job Board labels a rejected sub-phase, and only that one.
  setTab('board'); win.render(); v = main();
  ok('the Job Board labels a rejected sub-phase', /chip rej[^>]*>Rejected</.test(v));
  const labels = (v.match(/chip rej[^>]*>Rejected</g) || []).length;
  ok('one label per rejected sub-phase', labels === 2, String(labels));

  // Escaping, on this surface too.
  sA.rejectedReason = PROBE; sA.thread[0].by = PROBE;
  setTab('signoff'); win.render();
  ok('the Open rejections card escapes the reason and the name',
     win.document.getElementById('xss-probe') === null);

  sA.rejected = false; sB.rejected = false; win.render();
  ok('the card disappears when nothing is rejected', !/Open rejections/.test(main()));

  win.S.jobs = win.S.jobs.filter(x => x !== other);
  sA.thread = []; sA.rejectedReason = null;
  setTab('board'); win.render();
};

// ============================================================================
// SUMMARY -- keep this block last. A later task appends its own section above
// this line and moves this block back down to the bottom of the file.
// ============================================================================
pageTests().then(panelTests).then(saveTests).then(cardTests).then(() => {
  console.log(fail ? '\nFAILED' : '\nrejection assertions passed.');
  process.exit(fail);
}, e => { console.log('FAIL · page tests threw  [' + e.stack + ']'); process.exit(1); });
