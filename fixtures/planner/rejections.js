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
// SUMMARY -- keep this block last. A later task appends its own section above
// this line and moves this block back down to the bottom of the file.
// ============================================================================
console.log(fail ? '\nFAILED' : '\ncore rejection assertions passed.');
process.exit(fail);
