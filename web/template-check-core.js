/* The template check: rows of the Sub-phase Template and Task Template that
 * would make D2 - New Pool fail, or quietly build a wrong project.
 *
 * WHY THIS IS SEPARATE FROM web/index.html: Don and David edit the two lists by
 * hand and nothing validates a row, so the planner (which reads both lists on
 * every Refresh) is where a typo can be caught. Judging rows is a decision about
 * data, so it lives in pure functions that run under Node with no DOM and no
 * tenant. Every string returned is plain text; the page escapes it.
 *
 * An error is something that fails a build or builds it wrong. A warning is
 * something that looks off but still builds.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.D2TemplateCheck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PSEUDO_CREWS = ['office', 'subcon', 'unassigned'];
  const TYPES = ['Gunite', 'Fiberglass'];

  const low = v => (v == null ? '' : String(v).trim().toLowerCase());
  const txt = v => (v == null ? '' : String(v).trim());
  const finite = v => v != null && v !== '' && Number.isFinite(Number(v));

  /* Sub-phase numbers compare segment by segment as numbers, so 3.10 is after 3.9. */
  function cmpNum(a, b) {
    const x = txt(a).split('.').map(Number), y = txt(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i] == null || isNaN(x[i]) ? 0 : x[i], q = y[i] == null || isNaN(y[i]) ? 0 : y[i];
      if (p !== q) return p < q ? -1 : 1;
    }
    return 0;
  }

  const refOf = r => r.buildType + ' ' + (txt(r.num) ? txt(r.num) + ' ' : '') + (txt(r.name) || '(no name)');

  function check(input) {
    input = input || {};
    const spt = input.spt || [], tpt = input.tpt || [];
    const crews = new Set((input.crews || []).map(low).filter(Boolean));
    const trades = new Set((input.trades || []).map(t => String(t.id)));
    const issues = [];
    const add = (level, kind, buildType, ref, msg, fix, seq) =>
      issues.push({ level, kind, buildType, ref, msg, fix, _seq: finite(seq) ? Number(seq) : Infinity });

    const types = TYPES.concat([...new Set(spt.concat(tpt).map(r => r.buildType))].filter(t => TYPES.indexOf(t) < 0));
    types.forEach(type => {
      const rows = spt.filter(r => r.buildType === type);

      rows.forEach(r => {
        const ref = refOf(r);
        /* An unreadable Crews list gives no codes at all; flagging every row then would be noise. */
        if (txt(r.crew) && crews.size && !crews.has(low(r.crew)))
          add('error', 'crew-unknown', type, ref,
            'Crew code "' + txt(r.crew) + '" is not on the Crews list, so a new project would fail to build this row.',
            'Use a code from the Crews tab exactly as it appears there, or leave it blank for Unassigned.', r.seq);
        if (!finite(r.seq))
          add('error', 'seq-blank', type, ref, 'It has no Sequence number, so it has no place in the build order.',
            'Give it a Sequence between its neighbours; decimals such as 21.5 are fine.', r.seq);
        if (!txt(r.num))
          add('error', 'num-blank', type, ref, 'It has no sub-phase number.', 'Fill in SubPhaseNumber, for example 3.8.', r.seq);
        if (!txt(r.name))
          add('error', 'name-blank', type, ref, 'It has no name.', 'Fill in the Title of the row.', r.seq);
        if (r.tradeId != null && r.tradeId !== '' && !trades.has(String(r.tradeId)))
          add('error', 'trade-unknown', type, ref, 'Its Trade points at a row that is not on the Trades list.',
            'Pick the Trade again from the list, or clear it.', r.seq);
        if ((r.tradeId == null || r.tradeId === '') && PSEUDO_CREWS.indexOf(low(r.crew)) < 0 && !txt(r.skill))
          add('warning', 'skill-blank', type, ref, 'No trade or skill, so Auto-Schedule cannot pick a crew for it.',
            'Set the Trade, or set the crew to office, subcon or unassigned.', r.seq);
        const d = r.days == null || r.days === '' ? NaN : Number(r.days);
        if (!Number.isFinite(d) || d < 1)
          add('warning', 'days-bad', type, ref,
            (Number.isFinite(d) ? 'Days is ' + d : 'Days is blank') + ', and a new project builds this row as 2 days today. 0-day rows are coming for draws, so a 0 is not an error yet.',
            'Enter the working days it should take, 1 or more.', r.seq);
      });

      const bySeq = new Map(), byNum = new Map();
      rows.forEach(r => {
        if (finite(r.seq)) { const k = Number(r.seq); if (!bySeq.has(k)) bySeq.set(k, []); bySeq.get(k).push(r); }
        if (txt(r.num)) { const k = txt(r.num); if (!byNum.has(k)) byNum.set(k, []); byNum.get(k).push(r); }
      });
      bySeq.forEach((rs, k) => {
        if (rs.length > 1)
          add('error', 'seq-dup', type, type + ' Sequence ' + k,
            rs.length + ' rows share Sequence ' + k + ': ' + rs.map(r => txt(r.num) + ' ' + txt(r.name)).join(', ') + '.',
            'Give each row its own Sequence.', k);
      });
      byNum.forEach((rs, k) => {
        if (rs.length > 1)
          add('error', 'num-dup', type, type + ' ' + k,
            rs.length + ' rows share the number ' + k + ': ' + rs.map(r => txt(r.name) || '(no name)').join(', ') + '.',
            'Renumber one of them.', rs[0].seq);
      });

      const byPhase = new Map();
      rows.forEach(r => {
        if (!txt(r.num) || !txt(r.phase)) return;
        const p = txt(r.num).split('.')[0];
        if (!byPhase.has(p)) byPhase.set(p, new Set());
        byPhase.get(p).add(txt(r.phase));
      });
      byPhase.forEach((names, p) => {
        if (names.size > 1)
          add('warning', 'phase-name-disagree', type, type + ' phase ' + p,
            'Sub-phases of phase ' + p + ' spell the phase name differently: ' + [...names].map(n => '"' + n + '"').join(', ') + '. The planner names the phase from the first row it meets.',
            'Use one PhaseName on every row of the phase.',
            Math.min.apply(null, rows.filter(r => txt(r.num).split('.')[0] === p).map(r => finite(r.seq) ? Number(r.seq) : Infinity)));
      });

      const ordered = rows.filter(r => finite(r.seq) && txt(r.num)).slice().sort((a, b) => Number(a.seq) - Number(b.seq));
      for (let i = 1; i < ordered.length; i++) {
        if (cmpNum(ordered[i - 1].num, ordered[i].num) > 0) {
          add('warning', 'seq-order', type, refOf(ordered[i]),
            'In Sequence order ' + txt(ordered[i - 1].num) + ' comes before ' + txt(ordered[i].num) + ', so the numbers go backwards.',
            'Fix the Sequence or the number so the numbers rise down the list.', ordered[i].seq);
          break;
        }
      }
    });

    const sptById = new Map(spt.map(r => [String(r.id), r]));
    tpt.forEach(t => {
      const ref = t.buildType + ' task "' + txt(t.title) + '"';
      const parent = t.subId != null && t.subId !== '' ? sptById.get(String(t.subId)) : null;
      if (!parent) {
        add('error', 'task-orphan', t.buildType, ref, 'It is not under any sub-phase on the Sub-phase Template list.',
          'Set its SubPhase to a sub-phase, or delete the task.', t.seq);
      } else if (parent.buildType !== t.buildType) {
        add('error', 'task-type-mismatch', t.buildType, ref + ' under ' + txt(parent.num),
          'It is a ' + t.buildType + ' task but its sub-phase ' + txt(parent.num) + ' is ' + parent.buildType + '.',
          'Match the Build Type to the sub-phase, or move the task to the right sub-phase.', t.seq);
      }
    });

    /* Feature identity is the trimmed, lower-cased name. Two spellings that differ only in
       spacing or punctuation are different features to the planner and almost surely a typo. */
    const feats = new Map();
    const note = n => { const s = txt(n); if (!s) return; const k = low(s); if (!feats.has(k)) feats.set(k, s); };
    spt.forEach(r => { if (r.optional) note(txt(r.feature) || r.name); });
    tpt.forEach(t => note(t.feature));
    const byCompact = new Map();
    feats.forEach((disp, k) => {
      const c = k.replace(/[^a-z0-9]/g, '');
      if (!c) return;
      if (!byCompact.has(c)) byCompact.set(c, []);
      byCompact.get(c).push(disp);
    });
    byCompact.forEach(ds => {
      if (ds.length > 1)
        add('warning', 'feature-near-dup', 'Both', 'Feature "' + ds.join('" and "') + '"',
          'These look like the same feature spelled two ways: ' + ds.map(d => '"' + d + '"').join(' and ') + '. The planner treats them as two features.',
          'Use one spelling everywhere; copy it from an existing row.', null);
    });

    const rank = l => (l === 'error' ? 0 : 1);
    issues.sort((a, b) => rank(a.level) - rank(b.level)
      || String(a.buildType).localeCompare(String(b.buildType))
      || (a._seq === b._seq ? 0 : a._seq < b._seq ? -1 : 1));
    issues.forEach(i => { delete i._seq; });
    const errors = issues.filter(i => i.level === 'error').length;
    return { issues, errors, warnings: issues.length - errors };
  }

  return { check, cmpNum };
});
