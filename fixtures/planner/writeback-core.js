/* The five safety properties of the write path, as pure functions.
 *
 * These are the assertions that do not need a tenant, which is exactly why the
 * decisions were pulled out of the I/O layer into web/writeback-core.js in the
 * first place. The Graph-shaped half is asserted separately in graph-write.js.
 *
 * Every assertion here was watched failing against a deliberate mutation of
 * the production code before it was trusted. See the mutation list in
 * docs/superpowers/plans/2026-09-15-planner-primary-write-path.md, Task 1.
 */
const path = require('path');
const C = require(path.resolve(__dirname, '../../web/writeback-core.js'));

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

// A live row as Graph returns it. Note ids are STRINGS on that surface and
// numbers over REST, which is why every id comparison goes through String().
const live = (over) => Object.assign({
  id: '384', Title: 'D2-1044 · 3.5 Bonding Grid Completion', Crew: 'subcon',
  ScheduledStart: '2026-09-22T05:00:00Z', ScheduledFinish: '2026-09-23T05:00:00Z',
  DurationDays: 2, Locked: false, NotApplicable: false
}, over || {});

const pool = (fields, over) => [{
  jobno: 'D2-1044', name: 'Salcedo Residence',
  sections: [Object.assign({ id: '384', seq: 19, num: '3.5', name: 'Bonding Grid Completion', fields }, over || {})]
}];

const OPTS = { nowMs: Date.parse('2026-09-15T12:00:00Z'), suppressMinutes: 10 };

// ---------- 1. the allowlist ----------
ok('allowlist is exactly the five owned columns',
   C.ALLOWLIST.join(',') === 'Crew,ScheduledStart,DurationDays,Locked,NotApplicable',
   C.ALLOWLIST.join(','));
ok('ScheduledFinish is not writable -- it is derived from start + duration',
   C.ALLOWLIST.indexOf('ScheduledFinish') === -1);
{
  const r = C.planEdits(pool({ InstallerSignOff: { from: false, to: true } }), { '384': live() }, OPTS);
  ok('a sign-off field in a hostile change-set is refused, never written',
     r.writes.length === 0 && r.refusals.some(x => x.reason === 'not-allowlisted'),
     JSON.stringify(r.refusals));
}
{
  const r = C.planEdits(pool({ ScheduledFinish: { from: '2026-09-23', to: '2026-09-30' } }),
                        { '384': live() }, OPTS);
  ok('ScheduledFinish specifically is refused even though it is a real column',
     r.writes.length === 0 && r.refusals.some(x => x.col === 'ScheduledFinish'),
     JSON.stringify(r.refusals));
}

// ---------- 2. compare-before-write, PER FIELD ----------
{
  const r = C.planEdits(
    pool({ Crew: { from: 'subcon', to: 'saul' }, DurationDays: { from: 2, to: 3 } }),
    { '384': live({ DurationDays: 4 }) },   // somebody else moved the duration meanwhile
    OPTS);
  ok('a field whose live value diverged from the baseline is refused',
     r.refusals.length === 1 && r.refusals[0].col === 'DurationDays', JSON.stringify(r.refusals));
  ok('...and the refusal reports loaded, nowLive and wanted',
     r.refusals[0].loaded === 2 && r.refusals[0].nowLive === 4 && r.refusals[0].wanted === 3,
     JSON.stringify(r.refusals[0]));
  ok('...while the OTHER changed field on the SAME row still lands',
     r.writes.length === 1 && r.writes[0].fields.Crew === 'saul' &&
     !('DurationDays' in r.writes[0].fields), JSON.stringify(r.writes));
}
{
  const r = C.planEdits(pool({ Locked: { from: false, to: true } }),
                        { '384': live({ Locked: true }) }, OPTS);
  ok('a boolean that already holds the wanted value is still refused if the baseline disagrees',
     r.writes.length === 0 && r.refusals.length === 1, JSON.stringify(r));
}

// ---------- 3. row identity, token-anchored ----------
{
  const r = C.planEdits(pool({ Crew: { from: 'subcon', to: 'saul' } }),
                        { '384': live({ Title: 'D2-1044 · 3.50 Something Else' }) }, OPTS);
  ok('a 3.5 edit does NOT match a 3.50 row (a substring test would)',
     r.writes.length === 0 && r.errors.some(e => e.reason === 'identity-mismatch'),
     JSON.stringify(r.errors));
}
ok('titleMatches accepts the real row',
   C.titleMatches('D2-1044 · 3.5 Bonding Grid', 'D2-1044', '3.5'));
ok('titleMatches rejects the same sub-phase number on a different job',
   !C.titleMatches('D2-1042 · 3.5 Bonding Grid', 'D2-1044', '3.5'));
{
  const r = C.planEdits(pool({ Crew: { from: 'subcon', to: 'saul' } }), {}, OPTS);
  ok('a row that is no longer live is an error, not a silent skip',
     r.writes.length === 0 && r.errors.some(e => e.reason === 'row-missing'),
     JSON.stringify(r.errors));
}

// ---------- 4. suppression, in the SAME write ----------
{
  const r = C.planEdits(pool({ Crew: { from: 'subcon', to: 'saul' } }), { '384': live() }, OPTS);
  ok('every write carries a suppression stamp',
     r.writes.length === 1 && !!r.writes[0].suppressUntil, JSON.stringify(r.writes[0]));
  ok('...set ahead of now, not behind it',
     Date.parse(r.writes[0].suppressUntil) > OPTS.nowMs, r.writes[0].suppressUntil);
  ok('...by exactly the requested window',
     Date.parse(r.writes[0].suppressUntil) === OPTS.nowMs + 10 * 60000,
     r.writes[0].suppressUntil);
}

// ---------- date normalisation, both directions ----------
{
  const r = C.planEdits(pool({ ScheduledStart: { from: '2026-09-22', to: '2026-10-01' } }),
                        { '384': live() }, OPTS);
  ok('a live DateOnly is compared on its DATE PART, so an unchanged date is not a false divergence',
     r.writes.length === 1, JSON.stringify(r.refusals));
  ok('...and the written value is a bare yyyy-MM-dd, never an ISO timestamp',
     r.writes[0].fields.ScheduledStart === '2026-10-01', r.writes[0].fields.ScheduledStart);
}
{
  const r = C.planEdits(pool({ ScheduledStart: { from: '2026-09-22', to: '2026-10-01T00:00:00Z' } }),
                        { '384': live() }, OPTS);
  ok('a timestamp arriving in a change-set is normalised down to its date part before writing',
     r.writes[0].fields.ScheduledStart === '2026-10-01', r.writes[0].fields.ScheduledStart);
}

// ---------- 5. creates: refuse rather than guess ----------
{
  const r = C.planCreates([{ jobno: 'D2-1042', name: 'X', start: '2026-10-01' }], ['D2-1042'], []);
  ok('a job number that already exists live is refused',
     r.creates.length === 0 && r.refusals.length === 1, JSON.stringify(r.refusals));
}
{
  const r = C.planCreates([{ jobno: 'D2-1099', name: 'X', start: '2026-10-01' }], [], ['d2-1099']);
  ok('a job number already queued in New Pool Requests is refused (re-run safety)',
     r.creates.length === 0 && r.refusals.length === 1, JSON.stringify(r.refusals));
}
{
  const r = C.planCreates([{ jobno: ' d2-1042 ', name: 'X', start: '2026-10-01' }], ['D2-1042'], []);
  ok('the duplicate check is case- and whitespace-insensitive, as SharePoint\'s own filter is',
     r.creates.length === 0, JSON.stringify(r.creates));
}
{
  const r = C.planCreates([
    { jobno: 'D2-1099', name: 'A', start: '2026-10-01' },
    { jobno: 'D2-1099', name: 'B', start: '2026-10-02' }
  ], [], []);
  ok('two creates of the SAME job number in one batch yield one create and one refusal',
     r.creates.length === 1 && r.refusals.length === 1, JSON.stringify(r));
}
{
  const r = C.planCreates([{ jobno: 'D2-1099', name: '', start: '2026-10-01' }], [], []);
  ok('a create missing a required field is refused before any request is sent',
     r.creates.length === 0 && r.refusals.length === 1, JSON.stringify(r.refusals));
}
{
  const r = C.planCreates([{ jobno: 'D2-1099', name: 'X', start: '2026-10-01', assignDefaultCrews: true }], [], []);
  ok('a valid create survives and carries assignDefaultCrews explicitly',
     r.creates.length === 1 && r.creates[0].assignDefaultCrews === true, JSON.stringify(r.creates));
}
{
  const r = C.planCreates([{ jobno: 'D2-1099', name: 'X', start: '2026-10-01' }], [], []);
  ok('assignDefaultCrews is a real boolean even when the caller omitted it',
     r.creates[0].assignDefaultCrews === false, JSON.stringify(r.creates[0]));
}


// ---------- sign-off and task ticks (added 2026-09-16) ----------
// These write ATTESTED data, so every assertion here is about refusing to write
// something dishonest as much as about writing the right thing.
{
  const TITLE = 'D2-1042 · 2.1 Engineering Review by PM';
  const liveOpen = { '10': { Title: TITLE, InstallerSignOff: false, PMSignOff: false, SignOffNotes: 'earlier note' } };
  const liveSigned = { '10': { Title: TITLE, InstallerSignOff: true, PMSignOff: false, SignOffNotes: 'earlier note' } };
  const sec = (extra) => Object.assign({ id: '10', num: '2.1' }, extra);
  const pool = (extra) => [{ jobno: 'D2-1042', sections: [sec(extra)] }];
  const WHO = { userLookupId: 14, userName: 'Cody Campbell', nowIso: '2026-09-16T10:00:00Z' };

  let r = C.planSignoffs(pool({ inst: { from: false, to: true } }), liveOpen, WHO);
  ok('a sign-off writes the flag, the person AND the timestamp',
     r.writes.length === 1
     && r.writes[0].fields.InstallerSignOff === true
     && r.writes[0].fields.InstallerSignOffByLookupId === '14'
     && r.writes[0].fields.InstallerSignOffOn === '2026-09-16T10:00:00Z',
     JSON.stringify(r.writes[0] && r.writes[0].fields));

  // The whole reason this path was forbidden for months.
  r = C.planSignoffs(pool({ inst: { from: false, to: true } }), liveOpen,
                     { userName: 'x', nowIso: WHO.nowIso });
  ok('an UNATTRIBUTED sign-off is refused, never written as a bare flag',
     r.refusals.length === 1 && r.refusals[0].reason === 'no-user'
     && !r.writes.some(w => 'InstallerSignOff' in w.fields),
     JSON.stringify(r.refusals[0]));

  r = C.planSignoffs(pool({ inst: { from: true, to: false } }), liveSigned, WHO);
  ok('clearing a sign-off is a Reopen that records who and when',
     r.writes[0].fields.InstallerSignOff === false
     && r.writes[0].fields.InstallerSignOffByLookupId === null
     && /REOPENED .* by Cody Campbell/.test(r.writes[0].fields.SignOffNotes),
     r.writes[0].fields.SignOffNotes);

  ok('a Reopen keeps the notes that were already there',
     /earlier note/.test(r.writes[0].fields.SignOffNotes));

  // Somebody else signed it while this planner was open.
  r = C.planSignoffs(pool({ inst: { from: false, to: true } }), liveSigned, WHO);
  ok('a sign-off somebody else made first is refused, not overwritten',
     r.writes.length === 0 && r.refusals[0].reason === 'diverged'
     && r.refusals[0].nowLive === true, JSON.stringify(r.refusals[0]));

  // PM sign-off has no attribution column on this list, by schema.
  r = C.planSignoffs(pool({ pm: { from: false, to: true } }), liveOpen, WHO);
  ok('PM sign-off writes the flag only, since the list has no PMSignOffBy',
     JSON.stringify(r.writes[0].fields) === '{"PMSignOff":true}',
     JSON.stringify(r.writes[0].fields));

  // Identity is checked before anything is written, same as planEdits.
  r = C.planSignoffs([{ jobno: 'D2-1042', sections: [sec({ num: '2.10', inst: { from: false, to: true } })] }],
                     liveOpen, WHO);
  ok('a sub-phase number that does not match the live row is refused',
     r.writes.length === 0 && r.errors[0].reason === 'identity-mismatch',
     JSON.stringify(r.errors[0]));

  // ---- task ticks ----
  const liveTasks = { '900': { Complete: false, NotApplicable: false },
                      '901': { Complete: false, NotApplicable: false } };
  const tpool = (tasks) => [{ jobno: 'D2-1042', sections: [{ num: '2.1', tasks: tasks }] }];

  let t = C.planTaskTicks(tpool([{ id: 900, title: 'A', from: { done: false, na: false }, to: { done: true, na: false } }]),
                          liveTasks, WHO);
  ok('ticking a task writes Complete, the timestamp and who did it',
     t.writes[0].fields.Complete === true
     && t.writes[0].fields.CompletedOn === WHO.nowIso
     && t.writes[0].fields.CompletedByLookupId === '14',
     JSON.stringify(t.writes[0].fields));

  t = C.planTaskTicks(tpool([{ id: 901, title: 'B', from: { done: false, na: false }, to: { done: false, na: true } }]),
                      liveTasks, WHO);
  ok('marking a task N/A clears Complete and its timestamp',
     t.writes[0].fields.NotApplicable === true && t.writes[0].fields.Complete === false
     && t.writes[0].fields.CompletedOn === null,
     JSON.stringify(t.writes[0].fields));

  t = C.planTaskTicks(tpool([{ id: 900, title: 'A', from: { done: false, na: false }, to: { done: true, na: false } }]),
                      { '900': { Complete: true, NotApplicable: false } }, WHO);
  ok('a task somebody else ticked first is refused',
     t.writes.length === 0 && t.refusals[0].reason === 'diverged', JSON.stringify(t.refusals[0]));

  t = C.planTaskTicks(tpool([{ id: null, title: 'local only', from: { done: false, na: false }, to: { done: true, na: false } }]),
                      liveTasks, WHO);
  ok('a task with no SharePoint row is an ERROR, never a silent skip',
     t.writes.length === 0 && t.errors[0].reason === 'no-row-id', JSON.stringify(t.errors[0]));

  t = C.planTaskTicks(tpool([{ id: 900, title: 'A', from: { done: true, na: false }, to: { done: true, na: false } }]),
                      { '900': { Complete: true, NotApplicable: false } }, WHO);
  ok('a task that did not change produces no write at all',
     t.writes.length === 0 && t.refusals.length === 0 && t.errors.length === 0);

  // Counters ride with the row so the morning compliance figures are right.
  r = C.planSignoffs(pool({ counters: { done: 5, total: 6 } }), liveOpen, WHO);
  ok('task counters are written alongside, without inventing a sign-off',
     r.writes[0].fields.TasksComplete === 5 && r.writes[0].fields.TasksTotal === 6
     && !('InstallerSignOff' in r.writes[0].fields),
     JSON.stringify(r.writes[0].fields));
}

console.log(fail ? '\nFAILED' : '\nWrite-back decision core: allowlist, per-field compare, row identity, '
  + 'suppression, create refusal, attributed sign-off and task ticks all hold.');
process.exit(fail);
