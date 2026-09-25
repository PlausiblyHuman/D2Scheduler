/* Restore ONE project from a nightly snapshot: its Jobs row, its Assignments rows
 * and their Tasks rows, field by field, writing only what differs.
 *
 * The snapshots are written by `D2 - Snapshot` at 03:00 Central into the site's
 * Documents library, folder `Backups`, one JSON file per list, named
 * `<yyyy-MM-dd HHmm> <List>.json`. Each file is the list's rows exactly as
 * SharePoint REST returns them with `odata=nometadata`. This script reads three
 * of them (Jobs, Assignments, Tasks), finds the project by job number, and puts
 * its rows back the way the snapshot holds them.
 *
 * HOW TO RUN
 *   1. Open the D2 Build Scheduler site in a browser signed in as a site Owner.
 *   2. DevTools > Sources > Snippets (no paste guard there), paste this file.
 *   3. Set SNAPSHOT to the stamp of the set you want (the part of the file name
 *      before the list name) and JOB_NUMBER to the project. Run it. DRY_RUN is
 *      true, so it prints the plan and writes nothing.
 *   4. Read the plan. Every field it would change is listed with the live value
 *      beside the snapshot value.
 *   5. Set DRY_RUN to false and run it again.
 *
 * SAFETY PROPERTIES
 *   - DRY_RUN defaults true. With it true there is no POST of any kind, not
 *     even the digest fetch.
 *   - Only fields that differ are written, and only rows that differ. The
 *     field sets below are the only columns this script reads or writes.
 *   - Identity is checked before anything is written. The snapshot job's Id
 *     must be the live Id for that job number: a project deleted and created
 *     again under the same number is a different row with different
 *     Assignments and Tasks ids, and a restore onto it would be nonsense. Every
 *     Assignments and Tasks row the snapshot holds must still exist live, and
 *     no extra live rows may have appeared under the project; either way the
 *     WHOLE restore is refused. Nothing partial.
 *   - Assignments MERGEs carry SuppressReconcileUntil ten minutes ahead, exactly
 *     as every other batch writer here does, so a 46-row restore does not burn
 *     one Event-Driven Reconciliation run per row. Jobs and Tasks have no such
 *     column and sending it fails the write, so they do not.
 *   - After writing, every row is re-read and diffed again. Anything still
 *     differing is reported by list, row and field. A row whose MERGE failed is
 *     reported by name and the others still land.
 *
 * WHAT A RESTORE PUTS BACK. Scheduling (crew, dates, duration, lock, N/A), the
 * sign-off record with its person id and timestamp, the reopen notes, the task
 * counters, the rejection state, every task tick with its person and time, and
 * every task N/A with its reason. Machine-owned columns (CalendarEventId,
 * ConflictWith, TradeMismatch, SuppressReconcileUntil) are left alone: the
 * nightly flows own them and will recompute them.
 *
 * A Person column is written as <Field>Id, the numeric site-user id the
 * snapshot carries, which is the same id the row had. Clearing one writes null.
 */
(async () => {
  const DRY_RUN = true;
  const SNAPSHOT = '';
  const JOB_NUMBER = '';

  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const BACKUPS = '/sites/D2BuildScheduler/Shared Documents/Backups';
  const H = { Accept: 'application/json;odata=nometadata' };
  const CHUNK = 8;
  const day = v => (v ? String(v).slice(0, 10) : null);
  const jobKey = v => String(v == null ? '' : v).trim().toLowerCase();

  // kind: day  = DateOnly, compared and written as a bare yyyy-MM-dd
  //       dt   = DateTime, compared and written as the ISO string SharePoint returns
  //       bool, num, text (null and '' are the same text)
  const JOB_FIELDS = { Title: 'text', Address: 'text', City: 'text', StartDate: 'day', Status: 'text', ProjectManagerId: 'num' };
  const ASG_FIELDS = {
    Crew: 'text', ScheduledStart: 'day', ScheduledFinish: 'day', DurationDays: 'num', Locked: 'bool', NotApplicable: 'bool',
    InstallerSignOff: 'bool', InstallerSignOffById: 'num', InstallerSignOffOn: 'dt', PMSignOff: 'bool', SignOffNotes: 'text',
    WorkDate: 'day', TasksTotal: 'num', TasksComplete: 'num', Rejected: 'bool', RejectedOn: 'dt', RejectedReason: 'text'
  };
  const TASK_FIELDS = { Complete: 'bool', CompletedOn: 'dt', CompletedById: 'num', NotApplicable: 'bool', Note: 'text' };

  const norm = (kind, v) => {
    if (kind === 'day') return day(v);
    if (kind === 'bool') return !!v;
    if (kind === 'num') return v == null || v === '' ? null : Number(v);
    if (kind === 'dt') return v == null || v === '' ? null : String(v);
    return v == null || v === '' ? null : String(v);
  };
  const writeVal = (kind, v) => (kind === 'day' ? day(v) : kind === 'bool' ? !!v : (v == null || v === '' ? null : v));

  if (!SNAPSHOT || !JOB_NUMBER) {
    console.error('Set SNAPSHOT (the stamp of a set in Documents/Backups, e.g. 2026-09-25 0300) and JOB_NUMBER at the top of this script.');
    return { dryRun: DRY_RUN, refused: { reason: 'SNAPSHOT and JOB_NUMBER must both be set' }, plan: null, rowsWritten: 0, failed: [], verifyMismatch: [] };
  }

  async function getJson(url) {
    const r = await fetch(url, { headers: H });
    let body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    if (!r.ok) throw new Error('GET ' + url.slice(site.length) + ' -> HTTP ' + r.status + ' ' + JSON.stringify(body).slice(0, 200));
    return body;
  }
  async function all(rel) {
    const out = []; let url = site + rel;
    while (url) { const b = await getJson(url); out.push(...(b.value || [])); url = b['odata.nextLink'] || null; }
    return out;
  }
  async function readSnapshotFile(list) {
    const path = encodeURIComponent(BACKUPS + '/' + SNAPSHOT + ' ' + list + '.json');
    const body = await getJson(site + "/_api/web/GetFileByServerRelativeUrl('" + path + "')/$value");
    const rows = Array.isArray(body) ? body : (body && Array.isArray(body.value) ? body.value : null);
    if (!rows) throw new Error('Snapshot file for ' + list + ' did not parse as a list of rows.');
    return rows;
  }

  // ---- 1. the snapshot ----
  const snapJobs = await readSnapshotFile('Jobs');
  const snapJob = snapJobs.filter(r => jobKey(r.JobNumber) === jobKey(JOB_NUMBER));
  if (snapJob.length !== 1) {
    const reason = snapJob.length ? 'the snapshot holds ' + snapJob.length + ' projects with job number ' + JOB_NUMBER
      : 'the snapshot ' + SNAPSHOT + ' holds no project with job number ' + JOB_NUMBER;
    console.error('Refused: ' + reason);
    return { dryRun: DRY_RUN, refused: { reason }, plan: null, rowsWritten: 0, failed: [], verifyMismatch: [] };
  }
  const sJob = snapJob[0];
  const snapAsg = (await readSnapshotFile('Assignments')).filter(r => Number(r.JobId) === Number(sJob.Id));
  const asgIds = new Set(snapAsg.map(r => Number(r.Id)));
  const snapTasks = (await readSnapshotFile('Tasks')).filter(r => asgIds.has(Number(r.AssignmentId)));
  console.log('Snapshot ' + SNAPSHOT + ': ' + sJob.JobNumber + ' ' + sJob.Title + ' (Jobs row ' + sJob.Id + '), '
    + snapAsg.length + ' sub-phases, ' + snapTasks.length + ' tasks.');

  // ---- 2. the live rows, and identity ----
  const liveJobs = await all("/_api/web/lists/GetByTitle('Jobs')/items?$select=" + ['Id', 'JobNumber'].concat(Object.keys(JOB_FIELDS)).join(',')
    + "&$filter=JobNumber eq '" + String(sJob.JobNumber).replace(/'/g, "''") + "'&$top=10");
  const refuse = reason => {
    console.error('Refused: ' + reason);
    return { dryRun: DRY_RUN, refused: { reason }, plan: null, rowsWritten: 0, failed: [], verifyMismatch: [] };
  };
  if (liveJobs.length !== 1) return refuse(liveJobs.length ? liveJobs.length + ' live Jobs rows carry job number ' + sJob.JobNumber : 'no live Jobs row carries job number ' + sJob.JobNumber + '; a deleted project cannot be restored by this script');
  const lJob = liveJobs[0];
  if (Number(lJob.Id) !== Number(sJob.Id)) return refuse('the live project with job number ' + sJob.JobNumber + ' is Jobs row Id ' + lJob.Id
    + ' but the snapshot holds Id ' + sJob.Id + ': it was deleted and created again since the snapshot, so its rows are different rows');

  const liveAsg = await all("/_api/web/lists/GetByTitle('Assignments')/items?$select=" + ['Id', 'Title', 'SubPhaseNumber', 'JobId'].concat(Object.keys(ASG_FIELDS)).join(',')
    + '&$filter=JobId eq ' + Number(lJob.Id) + '&$top=5000');
  const liveAsgIds = new Set(liveAsg.map(r => Number(r.Id)));
  const missingAsg = snapAsg.filter(r => !liveAsgIds.has(Number(r.Id)));
  const extraAsg = liveAsg.filter(r => !asgIds.has(Number(r.Id)));
  if (missingAsg.length || extraAsg.length) return refuse(
    (missingAsg.length ? missingAsg.length + ' snapshot sub-phase row(s) no longer exist live: ' + missingAsg.map(r => (r.SubPhaseNumber || '?') + ' (Id ' + r.Id + ')').join(', ') + '. ' : '')
    + (extraAsg.length ? extraAsg.length + ' live sub-phase row(s) are not in the snapshot: ' + extraAsg.map(r => (r.SubPhaseNumber || '?') + ' (Id ' + r.Id + ')').join(', ') + '. ' : '')
    + 'The project changed shape since the snapshot, so nothing was restored.');

  const liveTasks = [];
  const ids = liveAsg.map(r => Number(r.Id));
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = await Promise.all(ids.slice(i, i + CHUNK).map(id =>
      all("/_api/web/lists/GetByTitle('Tasks')/items?$select=" + ['Id', 'Title', 'AssignmentId'].concat(Object.keys(TASK_FIELDS)).join(',') + '&$filter=AssignmentId eq ' + id + '&$top=5000')));
    part.forEach(rows => liveTasks.push(...rows));
  }
  const liveTaskIds = new Set(liveTasks.map(r => Number(r.Id)));
  const snapTaskIds = new Set(snapTasks.map(r => Number(r.Id)));
  const missingTasks = snapTasks.filter(r => !liveTaskIds.has(Number(r.Id)));
  const extraTasks = liveTasks.filter(r => !snapTaskIds.has(Number(r.Id)));
  if (missingTasks.length || extraTasks.length) return refuse(
    (missingTasks.length ? missingTasks.length + ' snapshot task row(s) no longer exist live (Ids ' + missingTasks.map(r => r.Id).join(', ') + '). ' : '')
    + (extraTasks.length ? extraTasks.length + ' live task row(s) are not in the snapshot (Ids ' + extraTasks.map(r => r.Id).join(', ') + '). ' : '')
    + 'The project changed shape since the snapshot, so nothing was restored.');

  // ---- 3. the diff, per field ----
  const asgNum = new Map(liveAsg.map(r => [Number(r.Id), r.SubPhaseNumber || '']));
  function diffRows(list, fields, snapRows, liveRows, numOf) {
    const byId = new Map(liveRows.map(r => [Number(r.Id), r]));
    const out = [];
    snapRows.forEach(s => {
      const l = byId.get(Number(s.Id));
      if (!l) return;
      const body = {}, changed = [];
      Object.keys(fields).forEach(col => {
        const kind = fields[col];
        const sv = norm(kind, s[col]), lv = norm(kind, l[col]);
        if (sv !== lv) {
          body[col] = writeVal(kind, s[col]);
          changed.push({ list, id: Number(s.Id), num: numOf(s), field: col, live: lv, to: sv });
        }
      });
      if (changed.length) out.push({ list, id: Number(s.Id), num: numOf(s), body, changed });
    });
    return out;
  }
  const jobDiff = diffRows('Jobs', JOB_FIELDS, [sJob], [lJob], () => '');
  const asgDiff = diffRows('Assignments', ASG_FIELDS, snapAsg, liveAsg, s => asgNum.get(Number(s.Id)) || s.SubPhaseNumber || '');
  const taskDiff = diffRows('Tasks', TASK_FIELDS, snapTasks, liveTasks, s => asgNum.get(Number(s.AssignmentId)) || '');
  const fields = [].concat(...jobDiff.map(r => r.changed), ...asgDiff.map(r => r.changed), ...taskDiff.map(r => r.changed));
  const plan = { jobFields: jobDiff.reduce((n, r) => n + r.changed.length, 0), assignmentRows: asgDiff.length, taskRows: taskDiff.length, fields };

  console.log(plan.fields.length + ' field(s) differ from the snapshot: ' + plan.jobFields + ' on the Jobs row, '
    + asgDiff.length + ' sub-phase row(s), ' + taskDiff.length + ' task row(s).');
  if (plan.fields.length) console.table(plan.fields.map(f => ({ list: f.list, row: f.id, subPhase: f.num, field: f.field, liveNow: f.live, snapshot: f.to })));

  if (DRY_RUN) {
    console.log('DRY_RUN: nothing written. Set DRY_RUN to false at the top of this script and run it again to restore '
      + (jobDiff.length + asgDiff.length + taskDiff.length) + ' row(s).');
    return { dryRun: true, refused: null, plan, rowsWritten: 0, failed: [], verifyMismatch: [] };
  }
  if (!plan.fields.length) {
    console.log('Nothing differs from the snapshot. Nothing written.');
    return { dryRun: false, refused: null, plan, rowsWritten: 0, failed: [], verifyMismatch: [] };
  }

  // ---- 4. write ----
  const digestBody = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H })).json();
  const digest = digestBody.FormDigestValue || (digestBody.d && digestBody.d.GetContextWebInformation && digestBody.d.GetContextWebInformation.FormDigestValue);
  if (!digest) throw new Error('No form digest returned; is this tab signed in to the site?');
  const stamp = new Date(Date.now() + 10 * 60000).toISOString();
  const writes = [].concat(
    jobDiff.map(r => ({ list: 'Jobs', id: r.id, num: r.num, body: r.body })),
    asgDiff.map(r => ({ list: 'Assignments', id: r.id, num: r.num, body: Object.assign({}, r.body, { SuppressReconcileUntil: stamp }) })),
    taskDiff.map(r => ({ list: 'Tasks', id: r.id, num: r.num, body: r.body })));
  const failed = []; let rowsWritten = 0;
  for (let i = 0; i < writes.length; i += CHUNK) {
    await Promise.all(writes.slice(i, i + CHUNK).map(async w => {
      const r = await fetch(site + "/_api/web/lists/GetByTitle('" + w.list + "')/items(" + w.id + ')', {
        method: 'POST',
        headers: Object.assign({}, H, { 'Content-Type': 'application/json;odata=nometadata', 'X-RequestDigest': digest, 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' }),
        body: JSON.stringify(w.body)
      });
      if (r.ok) rowsWritten++;
      else failed.push({ list: w.list, id: w.id, num: w.num, status: r.status, detail: await r.text().catch(() => '') });
    }));
  }
  console.log(rowsWritten + ' row(s) written, ' + failed.length + ' failed.');
  if (failed.length) console.table(failed);

  // ---- 5. verify: re-read and diff again ----
  const vJobs = await all("/_api/web/lists/GetByTitle('Jobs')/items?$select=" + ['Id', 'JobNumber'].concat(Object.keys(JOB_FIELDS)).join(',') + "&$filter=JobNumber eq '" + String(sJob.JobNumber).replace(/'/g, "''") + "'&$top=10");
  const vAsg = await all("/_api/web/lists/GetByTitle('Assignments')/items?$select=" + ['Id', 'Title', 'SubPhaseNumber', 'JobId'].concat(Object.keys(ASG_FIELDS)).join(',') + '&$filter=JobId eq ' + Number(lJob.Id) + '&$top=5000');
  const vTasks = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = await Promise.all(ids.slice(i, i + CHUNK).map(id =>
      all("/_api/web/lists/GetByTitle('Tasks')/items?$select=" + ['Id', 'Title', 'AssignmentId'].concat(Object.keys(TASK_FIELDS)).join(',') + '&$filter=AssignmentId eq ' + id + '&$top=5000')));
    part.forEach(rows => vTasks.push(...rows));
  }
  const verifyMismatch = [].concat(
    ...diffRows('Jobs', JOB_FIELDS, [sJob], vJobs, () => '').map(r => r.changed),
    ...diffRows('Assignments', ASG_FIELDS, snapAsg, vAsg, s => asgNum.get(Number(s.Id)) || '').map(r => r.changed),
    ...diffRows('Tasks', TASK_FIELDS, snapTasks, vTasks, s => asgNum.get(Number(s.AssignmentId)) || '').map(r => r.changed));
  if (verifyMismatch.length) { console.warn(verifyMismatch.length + ' field(s) still differ after the restore:'); console.table(verifyMismatch); }
  else console.log('Verified: every restored field reads back as the snapshot holds it.');
  return { dryRun: false, refused: null, plan, rowsWritten, failed, verifyMismatch };
})();
