/* Spec A, Part 3: completing projects and reading only live ones.
 * docs/superpowers/specs/2026-09-28-complete-projects-and-live-reads-design.md
 * docs/superpowers/plans/2026-10-01-spec-a-complete-projects-live-reads.md (Tasks 5-10)
 *
 * Run: node fixtures/planner/complete.js
 * The mapper runs under Node; the planner runs in jsdom with MSAL and fetch stubbed, and the
 * fetch stub answers the per-project $filter URLs the way Graph did in the 2026-10-01 capture
 * (fixtures/planner/live-payloads-graph-filtered.json).
 */
const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '../../web');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-payloads-graph.json'), 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));

(async () => {
  // ---------- Task 5: the mapper splits live and completed projects ----------
  {
    const M = require(path.join(WEB, 'graph-to-planner.js'));
    const G2 = clone(G);
    // The OLDER completion is first in list order, so only a real sort puts the newer one first.
    const done = G2.jobs[1]; done.fields.Status = 'Complete'; done.fields.Modified = '2026-10-02T15:00:00Z';
    const older = G2.jobs[0]; older.fields.Status = 'Complete'; older.fields.Modified = '2026-09-01T15:00:00Z';
    const p = M.toPlannerPayload(G2);
    const nos = p.jobs.map(j => String(j.jobno));
    ok('complete projects are left out of jobs', !nos.includes(done.fields.JobNumber) && !nos.includes(older.fields.JobNumber), nos.join(' | '));
    ok('live projects still mapped', p.jobs.length === G2.jobs.length - 2);
    ok('completed projects listed, newest first',
      Array.isArray(p.completedJobs) && p.completedJobs.length === 2 && p.completedJobs[0].jobno === done.fields.JobNumber
      && p.completedJobs[0].completedOn === '2026-10-02T15:00:00Z', JSON.stringify(p.completedJobs));
    ok('a completed project carries its SharePoint id, name and PM field',
      p.completedJobs[0].id === Number(done.fields.id) && p.completedJobs[0].name === done.fields.Title && 'pm' in p.completedJobs[0]);
    ok('completed job numbers carried for the import', Array.isArray(p.completedJobNumbers)
      && p.completedJobNumbers.includes(done.fields.JobNumber) && p.completedJobNumbers.includes(older.fields.JobNumber));
    ok('includeComplete keeps a completed project in jobs',
      M.toPlannerPayload(G2, { includeComplete: true }).jobs.some(j => j.jobno === done.fields.JobNumber));
    const none = M.toPlannerPayload(clone(G));
    ok('with nothing complete, both lists are empty and every project is mapped',
      none.completedJobs.length === 0 && none.completedJobNumbers.length === 0 && none.jobs.length === G.jobs.length);
  }

  process.exit(fail);
})().catch(e => { console.log('FAIL · harness threw: ' + (e && e.stack || e)); process.exit(1); });
