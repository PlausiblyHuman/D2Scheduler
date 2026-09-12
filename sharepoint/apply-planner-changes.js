/* Apply a planner change-set to SharePoint Assignments.
 *
 * The exact inverse of `export-to-planner.js`: that script reads the live
 * schedule out of SharePoint and into the planner; this one reads the
 * change-set the planner's Save button downloaded and pushes it back, one
 * MERGE per row, touching only the fields the planner is ever allowed to own.
 *
 * DRY_RUN DEFAULTS TRUE. This writes to a live client tenant. It still does
 * the full compare-before-write pass and prints the plan with DRY_RUN true --
 * read that before flipping the flag below and running it again.
 *
 * WHY COMPARE-BEFORE-WRITE, NOT ETAGS. Several flows write to Assignments on
 * schedules that have nothing to do with a PM -- Calendar Sync (hourly),
 * Counter Reconciliation, Conflict Flag and Crew Trade Check (nightly), and
 * Event-Driven Reconciliation on any edit. Every one of those bumps the row's
 * version, so a row-level ETag would reject a PM's whole batch because a
 * nightly flow annotated the row overnight, over fields nobody contested.
 * Instead this re-reads the five owned fields on every row in the change-set
 * and compares each one against the BASELINE the file carries (the value the
 * planner loaded last). A field is written only if the live value still
 * matches that baseline; otherwise it is refused and reported by sub-phase and
 * field name. This is one paged read for the whole batch, not one per row.
 * See docs/superpowers/specs/2026-09-12-batch-write-back-design.md for the
 * full reasoning.
 *
 * THE ALLOWLIST IS THE SAFETY PROPERTY OF THIS SCRIPT, enforced in code, not
 * assumed from what a file happens to contain. FIELD_DEFS below is the only
 * set of columns this script will ever read or write. A change-set field
 * outside that set is rejected before any network call and reported, never
 * silently dropped or silently kept. InstallerSignOff, InstallerSignOffBy,
 * InstallerSignOffOn, SignOffNotes, PMSignOff and every Tasks-list field are
 * never candidates: the planner has no attribution model for a sign-off and
 * must never be its authority. ScheduledFinish is derived on the planner side
 * (`workSpan(start,days).pop()`, the same arithmetic the flows use) and is
 * never sent either.
 *
 * SuppressReconcileUntil is set a few minutes ahead in the same MERGE as
 * every write, exactly as `D2 - Reschedule Pool` does, so a batch does not
 * burn one Event-Driven Reconciliation run per row. It is a timestamp, never
 * a boolean, because a boolean needs a second write to clear and a failed
 * clear would leave the row permanently invisible to conflict detection.
 * What this costs: a suppressed row gets no real-time conflict check for that
 * window. `D2 - Conflict Flag`'s nightly sweep and Nightly Reconciliation both
 * still cover it, and the planner's own Schedule Check already ran locally
 * before Save was pressed.
 *
 * HOW TO RUN
 *   1. In the planner, press Save. Confirm the preview, download the
 *      change-set file.
 *   2. Open https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler
 *      signed in as a member with Edit rights.
 *   3. Paste this into the browser console (DevTools > Sources > Snippets
 *      avoids Chrome's paste guard; in the Console, type `allow pasting`
 *      first).
 *   4. Pick the change-set file when the picker opens.
 *   5. Read the plan -- it runs the full compare-before-write pass and prints
 *      what WOULD happen even with DRY_RUN true, with nothing written yet.
 *   6. Set DRY_RUN to false below and run it again to actually write.
 *
 * ROW IDENTITY IS VERIFIED, NOT TRUSTED. A change-set names a row by its
 * SharePoint id alone. Before any field on that row is compared or written,
 * the row's live `Title` (e.g. "D2-1042 · 2.1 Engineering Review by PM")
 * is checked against the change-set's own jobno and sub-phase number. This is
 * a plain includes check, deliberately not an exact-format match -- the
 * separator is a non-ASCII middle dot, and this project has already lost time
 * once assuming an exact rendered shape instead of reading it. A mismatch
 * refuses the whole row and reports it; nothing about a mismatched row is
 * ever compared or written. The live Title is also what the dry-run plan
 * prints, so a human reviewing it is reading SharePoint's own account of the
 * row, not the change-set file's.
 *
 * FIELD SHAPES -- read off the same real payloads export-to-planner.js uses,
 * not guessed:
 *   - `Crew` is a Choice column. Raw REST with odata=nometadata reads and
 *     writes it as a PLAIN STRING (the short code, e.g. "devon") -- exactly
 *     what the planner's crewId already is and exactly what the change-set
 *     carries. Never the connector's {Id, Value} shape.
 *   - `ScheduledStart` is a DateOnly column. It is written as a bare
 *     'yyyy-MM-dd' string, which SharePoint stores at site-local midnight. An
 *     explicit ...T00:00:00Z is the off-by-one this project already fixed
 *     once on this exact class of column -- never write one.
 *   - A MERGE needs X-HTTP-Method: MERGE, IF-MATCH: *, a fresh
 *     X-RequestDigest from /_api/contextinfo, and the list's
 *     ListItemEntityTypeFullName read off the list metadata rather than
 *     hand-written -- hyphenated or spaced list names sanitize unpredictably,
 *     and this reads it for Assignments rather than assume it.
 */
(async () => {
  const DRY_RUN = true; // SAFE DEFAULT. Read the printed plan before setting this false.

  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=nometadata' };
  const day = v => (v ? String(v).slice(0, 10) : null);

  // ---- 1. THE ALLOWLIST -- the only columns this script will ever touch ----
  // `write` normalizes a change-set value before it goes in a MERGE body; it
  // defaults to identity. ScheduledStart is the one field that needs it: the
  // read side already slices a live DateOnly value to a bare 'yyyy-MM-dd' via
  // day(), and the write side must do the same to whatever the change-set
  // carries, or the two sides of this script disagree about what the column
  // holds. The planner cannot currently emit anything but a bare date, so
  // this is defensive rather than fixing an observed bad write -- but this
  // project has already fixed a date off-by-one across every list once, on
  // this exact class of column, and asymmetry between a read and a write path
  // is exactly how that kind of thing comes back.
  const FIELD_DEFS = {
    Crew:           { read: r => r.Crew || null,           eq: (a, b) => (a || null) === (b || null) },
    ScheduledStart: { read: r => day(r.ScheduledStart),    eq: (a, b) => (a || null) === (b || null), write: day },
    DurationDays:   { read: r => (r.DurationDays ?? null), eq: (a, b) => (a ?? null) === (b ?? null) },
    Locked:         { read: r => !!r.Locked,               eq: (a, b) => !!a === !!b },
    NotApplicable:  { read: r => !!r.NotApplicable,        eq: (a, b) => !!a === !!b }
  };
  const writeVal = (col, v) => (FIELD_DEFS[col].write ? FIELD_DEFS[col].write(v) : v);

  // ---- 2. pick the change-set the planner's Save button downloaded ----
  const file = await new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = () => resolve(inp.files && inp.files[0]);
    inp.click();
  });
  if (!file) { console.log('No file chosen.'); return; }

  let cs;
  try { cs = JSON.parse(await file.text()); }
  catch (e) { console.error('That file is not valid JSON.'); return; }
  if (!cs || cs.kind !== 'd2-planner-changeset' || !Array.isArray(cs.pools)) {
    console.error('That is not a D2 planner change-set (kind=' + (cs && cs.kind) +
      '). Use the Save button in the planner -- not Backup, and not a Load-from-D2 export.');
    return;
  }

  // ---- 3. flatten to one entry per SharePoint row, enforcing the allowlist
  // BEFORE any network call. A field outside FIELD_DEFS is rejected here and
  // never reaches a live read or a write, no matter how the file got built.
  // `Object.hasOwn`, not `!FIELD_DEFS[col]` -- a plain truthiness check on an
  // object lets an inherited key (`constructor`, `toString`, `valueOf`, even
  // `__proto__`) through as if it were an allowed column, and it would then
  // throw inside `def.read(...)` rather than being reported as a rejection.
  // That throw happens before any network call too, so nothing is written --
  // but it surfaces as a crash instead of a clean, reported refusal.
  //
  // A row id repeated within one change-set is dropped entirely, both
  // occurrences, and reported -- never last-write-wins. A legitimate
  // change-set never repeats a row id (each sub-phase appears once per pool),
  // so a repeat means the file is malformed or was tampered with, and this is
  // not the place to guess which copy was meant. ----
  const rejected = [];
  const rows = new Map(); // Assignments row id -> {jobno, name, num, secName, fields:{col:{from,to}}}
  const seenIds = new Set();
  cs.pools.forEach(p => {
    (p.sections || []).forEach(sec => {
      if (sec.id == null) { rejected.push({ jobno: p.jobno, num: sec.num, reason: 'no SharePoint row id' }); return; }
      if (seenIds.has(sec.id)) {
        rejected.push({ jobno: p.jobno, num: sec.num, id: sec.id, reason: 'duplicate row id in change-set -- row dropped entirely' });
        rows.delete(sec.id);
        return;
      }
      seenIds.add(sec.id);
      const fields = {};
      Object.entries(sec.fields || {}).forEach(([col, v]) => {
        if (!Object.hasOwn(FIELD_DEFS, col)) { rejected.push({ jobno: p.jobno, num: sec.num, field: col, reason: 'not in the write-back allowlist' }); return; }
        fields[col] = v;
      });
      if (Object.keys(fields).length) {
        rows.set(sec.id, { jobno: p.jobno, name: p.name, num: sec.num, secName: sec.name, fields });
      }
    });
  });
  if (rejected.length) {
    console.warn(rejected.length + ' field(s) rejected before any read -- never in scope for this script.');
    console.table(rejected);
  }
  if (!rows.size) {
    console.log('Nothing to push.');
    return { dryRun: DRY_RUN, rowsWritten: 0, fieldsWritten: 0, fieldsRefused: 0,
             rowsMissing: 0, rowsMismatched: 0, fieldsRejected: rejected.length, failed: [], verifyMismatch: [] };
  }

  // ---- 4. re-read the live rows. ONE paged read for the whole batch, not one
  // per row, so this is immune to unrelated writes elsewhere in the list and
  // costs the same whether the batch is one row or a whole pool. Title rides
  // along for identity verification -- see the header comment. ----
  async function all(path) {
    let url = site + path, out = [];
    while (url) {
      const r = await fetch(url, { headers: H, credentials: 'include' });
      if (!r.ok) throw new Error(r.status + ' on ' + url.slice(0, 120));
      const d = await r.json();
      out = out.concat(d.value || []);
      url = d['odata.nextLink'] || null;
    }
    return out;
  }
  const SELECT = "?$select=Id,Title,Crew,ScheduledStart,DurationDays,Locked,NotApplicable&$top=2000&$orderby=Id";
  const live = await all("/_api/web/lists/GetByTitle('Assignments')/items" + SELECT);
  const liveById = new Map(live.map(r => [r.Id, r]));

  // Plain includes check, deliberately not an exact-format match -- see the
  // header comment ("ROW IDENTITY IS VERIFIED, NOT TRUSTED").
  function titleMatches(title, jobno, num) {
    if (typeof title !== 'string' || !title) return false;
    return title.indexOf(String(jobno)) === 0 && title.includes(String(num));
  }

  // ---- 5. compare-before-write, per FIELD, not per row. A row with two
  // changed fields can have one refused and the other still land. A row whose
  // live Title does not name this pool/sub-phase is refused WHOLESALE, before
  // any field on it is compared -- see the header comment. ----
  const planned = [], refused = [], missing = [], mismatched = [];
  const toWrite = [];
  rows.forEach((row, id) => {
    const liveRow = liveById.get(id);
    if (!liveRow) { missing.push({ jobno: row.jobno, num: row.num, id }); return; }
    if (!titleMatches(liveRow.Title, row.jobno, row.num)) {
      mismatched.push({ jobno: row.jobno, num: row.num, id, liveTitle: liveRow.Title || '(blank)' });
      return;
    }
    const body = {};
    Object.entries(row.fields).forEach(([col, { from, to }]) => {
      const def = FIELD_DEFS[col];
      const liveVal = def.read(liveRow);
      if (def.eq(liveVal, from)) {
        body[col] = writeVal(col, to);
        planned.push({ jobno: row.jobno, num: row.num, name: row.secName, id, field: col, from, to: body[col], liveTitle: liveRow.Title });
      } else {
        refused.push({ jobno: row.jobno, num: row.num, name: row.secName, id, field: col, loaded: from, live: liveVal, wanted: to });
      }
    });
    if (Object.keys(body).length) toWrite.push({ id, body, jobno: row.jobno, num: row.num });
  });

  console.log(toWrite.length + ' row(s), ' + planned.length + ' field write(s) planned. '
    + refused.length + ' field(s) refused (changed in SharePoint since this was loaded). '
    + missing.length + ' row(s) no longer exist. '
    + mismatched.length + ' row(s) refused -- live Title does not name this pool/sub-phase.');
  if (planned.length) console.table(planned.map(p => ({ pool: p.jobno, subPhase: p.num, field: p.field, from: p.from, to: p.to, liveTitle: p.liveTitle })));
  if (refused.length) console.table(refused.map(r => ({ pool: r.jobno, subPhase: r.num, field: r.field, loaded: r.loaded, nowLive: r.live, wanted: r.wanted })));
  if (missing.length) console.table(missing);
  if (mismatched.length) console.table(mismatched);

  if (DRY_RUN) {
    console.log('DRY_RUN -- nothing written. Set DRY_RUN to false at the top of this script and run it again to push ' + toWrite.length + ' row(s).');
    return {
      dryRun: true, rowsWritten: 0, wouldWriteRows: toWrite.length,
      fieldsWritten: 0, fieldsPlanned: planned.length, fieldsRefused: refused.length,
      rowsMissing: missing.length, rowsMismatched: mismatched.length, fieldsRejected: rejected.length,
      failed: [], verifyMismatch: [],
      planned, refused, missing, mismatched, rejected
    };
  }
  if (!toWrite.length) {
    console.log('Nothing left to write after compare-before-write.');
    return { dryRun: false, rowsWritten: 0, fieldsWritten: 0, fieldsRefused: refused.length,
             rowsMissing: missing.length, rowsMismatched: mismatched.length, fieldsRejected: rejected.length, failed: [], verifyMismatch: [] };
  }

  // ---- 6. digest + the list's real entity type, read off metadata rather
  // than hand-written (see the header comment above) ----
  const dg = await (await fetch(site + '/_api/contextinfo', {
    method: 'POST', credentials: 'include', headers: { Accept: 'application/json;odata=verbose' }
  })).json();
  const digest = dg.d.GetContextWebInformation.FormDigestValue;
  const meta = await (await fetch(site + "/_api/web/lists/GetByTitle('Assignments')?$select=ListItemEntityTypeFullName",
    { headers: H, credentials: 'include' })).json();
  const entityType = meta.ListItemEntityTypeFullName;

  // ---- 7. write, in chunks of 8. Item writes may run in parallel; it is
  // field CREATES on the same list that must be sequential (see CLAUDE.md). ----
  async function mergeRow(id, body) {
    const r = await fetch(site + "/_api/web/lists/GetByTitle('Assignments')/items(" + id + ")", {
      method: 'POST', credentials: 'include',
      headers: {
        Accept: 'application/json;odata=verbose',
        'Content-Type': 'application/json;odata=verbose',
        'X-RequestDigest': digest,
        'X-HTTP-Method': 'MERGE',
        'IF-MATCH': '*'
      },
      body: JSON.stringify({ __metadata: { type: entityType }, ...body })
    });
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 300));
  }
  const failed = [];
  const CHUNK = 8;
  for (let i = 0; i < toWrite.length; i += CHUNK) {
    const chunk = toWrite.slice(i, i + CHUNK);
    await Promise.all(chunk.map(async row => {
      const body = { ...row.body, SuppressReconcileUntil: new Date(Date.now() + 10 * 60000).toISOString() };
      try { await mergeRow(row.id, body); }
      catch (e) { failed.push({ jobno: row.jobno, num: row.num, id: row.id, error: String(e.message || e) }); }
    }));
  }

  // ---- 8. verify by reading back, never by the status code ----
  const failedIds = new Set(failed.map(f => f.id));
  const writtenPlan = planned.filter(p => !failedIds.has(p.id));
  const after = await all("/_api/web/lists/GetByTitle('Assignments')/items" + SELECT);
  const afterById = new Map(after.map(r => [r.Id, r]));
  const verifyMismatch = writtenPlan.filter(p => {
    const r = afterById.get(p.id); if (!r) return true;
    return !FIELD_DEFS[p.field].eq(FIELD_DEFS[p.field].read(r), p.to);
  });

  const out = {
    dryRun: false,
    rowsWritten: toWrite.length - failed.length,
    fieldsWritten: writtenPlan.length,
    fieldsRefused: refused.length,
    rowsMissing: missing.length,
    rowsMismatched: mismatched.length,
    fieldsRejected: rejected.length,
    failed,
    verifyMismatch
  };
  console.log(JSON.stringify(out, null, 2));
  if (failed.length) console.table(failed);
  if (verifyMismatch.length) console.warn('Verify found ' + verifyMismatch.length + ' field(s) that did not read back as written -- see verifyMismatch.');
  return out;
})();
