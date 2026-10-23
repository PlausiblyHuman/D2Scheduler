/* The feature model: named groups of optional sub-phases and tagged tasks.
 *
 * WHY THIS IS SEPARATE FROM web/index.html: deciding which features a project
 * has, and whether each is on, off or partly, is a decision about DATA, so it
 * lives in pure functions that run under Node without a DOM or a tenant.
 * Nothing here calls fetch or touches the page.
 *
 * Feature identity is the name trimmed and lower-cased, so "Auto Cover " and
 * "auto cover" are one feature. The display name is the first spelling met.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.D2FeaturesCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function featureKey(name) { return name == null ? '' : String(name).trim().toLowerCase(); }

  /* The reason written on a task or sub-phase set N/A because the project
     does not have the feature. */
  function autoReason(name) { return String(name).trim() + ' not on this project'; }

  /* Only an optional line belongs to a feature: its Feature column if set,
     else its own title. A plain line has no feature even when its Feature
     column carries a value, so it is never switched off with one. */
  function secFeatureName(sec) {
    if (!sec || !sec.optional) return null;
    const f = sec.feature != null ? String(sec.feature).trim() : '';
    if (f) return f;
    return sec.name != null ? String(sec.name).trim() : null;
  }

  function byName(a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; } // key is the case-insensitive name

  function templateMap(tpl) {
    const map = new Map();
    const get = (name) => {
      const key = featureKey(name);
      if (!key) return null;
      if (!map.has(key)) map.set(key, { key, name: String(name).trim(), secs: [], tasks: [] });
      return map.get(key);
    };
    (tpl || []).forEach(ph => (ph.sections || []).forEach(sec => {
      const f = get(secFeatureName(sec));
      if (f) f.secs.push({ tplId: sec.id, num: sec.num, name: sec.name, seq: sec.seq });
      (sec.tasks || []).forEach((title, i) => {
        const tf = get((sec.taskFeature || [])[i]);
        if (tf) tf.tasks.push({ tplSecId: sec.id, secNum: sec.num, title, seq: (sec.taskSeq || [])[i] });
      });
    }));
    return { map, get };
  }

  function templateFeatures(tpl) {
    return Array.from(templateMap(tpl).map.values()).sort(byName);
  }

  function projectFeatures(groups, tpl) {
    const { map, get } = templateMap(tpl);
    const extra = new Map();
    const rec = (name) => {
      const f = get(name);
      if (!f) return null;
      if (!extra.has(f.key)) extra.set(f.key, { rows: [], taskRefs: [] });
      return { f, x: extra.get(f.key) };
    };
    const items = new Map(); // key -> applicable flags
    const flag = (key, applicable) => { (items.get(key) || items.set(key, []).get(key)).push(applicable); };
    (groups || []).forEach((g, gi) => (g.sections || []).forEach((s, si) => {
      const r = rec(s.feature);
      if (r) { r.x.rows.push({ gi, si }); flag(r.f.key, !s.skip); }
      (s.tasks || []).forEach((t, ti) => {
        const tr = rec(t.feature);
        if (tr) { tr.x.taskRefs.push({ gi, si, ti }); flag(tr.f.key, !t.na); }
      });
    }));
    return Array.from(map.values()).sort(byName).map(f => {
      const x = extra.get(f.key) || { rows: [], taskRefs: [] };
      const fl = items.get(f.key) || [];
      const on = fl.filter(Boolean).length;
      const state = !fl.length ? 'absent' : on === fl.length ? 'on' : on === 0 ? 'off' : 'partly';
      return Object.assign({}, f, { state, rows: x.rows, taskRefs: x.taskRefs });
    });
  }

  /* Plain template lines the project has no row for, e.g. one added to the
     template after the project was built. Optional lines are never missing:
     their absence is the project's choice. */
  function missingTemplateLines(groups, tpl) {
    const have = new Set();
    (groups || []).forEach(g => (g.sections || []).forEach(s => {
      if (s.templateItemId != null) have.add(String(s.templateItemId));
    }));
    const out = [];
    (tpl || []).forEach(ph => (ph.sections || []).forEach(sec => {
      if (!sec.optional && !have.has(String(sec.id))) out.push({ tplId: sec.id, num: sec.num, name: sec.name, seq: sec.seq });
    }));
    return out;
  }

  /* What flipping one feature on or off does to a project, as data. Nothing is
     applied here: the caller writes the plan to the groups and reflows from
     firstSec. "Signed" reads s.base.inst, the state SharePoint holds, never the
     on-screen tick, so an unsaved tick can neither protect nor expose a row.
     Only the automatic reason is ever cleared on On; a PM's own N/A note stays. */
  function planSwitch(groups, tpl, key, on) {
    const plan = { secs: [], tasks: [], creates: [], left: [], firstSec: null };
    const k = featureKey(key);
    const feat = projectFeatures(groups, tpl).find(f => f.key === k);
    if (!feat) return plan;
    const gs = groups || [];
    const signed = (s) => !!(s.base && s.base.inst);
    const leftSigned = new Set();
    const leave = (gi, si, reason) => {
      if (reason === 'signed') { const id = gi + ':' + si; if (leftSigned.has(id)) return; leftSigned.add(id); }
      plan.left.push({ gi, si, num: gs[gi].sections[si].num, reason });
    };
    const reason = autoReason(feat.name);
    feat.rows.forEach(({ gi, si }) => {
      const s = gs[gi].sections[si];
      const label = s.num + ' ' + s.name;
      if (on) {
        if (!s.skip) return;
        if (signed(s)) { leave(gi, si, 'signed'); return; }
        plan.secs.push({ gi, si, skip: false, clearStart: true, label });
      } else {
        if (s.skip) return;
        if (signed(s)) { leave(gi, si, 'signed'); return; }
        if ((s.tasks || []).some(t => t.done)) { leave(gi, si, 'done'); return; }
        plan.secs.push({ gi, si, skip: true, label });
      }
    });
    feat.taskRefs.forEach(({ gi, si, ti }) => {
      const s = gs[gi].sections[si];
      const t = s.tasks[ti];
      const label = s.num + ' ' + t.t;
      if (on) {
        if (!t.na) return;
        if (t.note !== reason) { leave(gi, si, 'pm-na'); return; }
        if (signed(s)) { leave(gi, si, 'signed'); return; }
        plan.tasks.push({ gi, si, ti, na: false, note: '', label });
      } else {
        if (t.done || t.na) return;
        if (signed(s)) { leave(gi, si, 'signed'); return; }
        plan.tasks.push({ gi, si, ti, na: true, note: reason, label });
      }
    });
    if (on) {
      const have = new Set();
      gs.forEach(g => (g.sections || []).forEach(s => { if (s.templateItemId != null) have.add(String(s.templateItemId)); }));
      feat.secs.forEach(x => { if (!have.has(String(x.tplId))) plan.creates.push({ tplId: x.tplId, num: x.num, name: x.name }); });
    }
    plan.secs.forEach(x => {
      if (!plan.firstSec || x.gi < plan.firstSec.gi || (x.gi === plan.firstSec.gi && x.si < plan.firstSec.si)) plan.firstSec = { gi: x.gi, si: x.si };
    });
    return plan;
  }

  return { featureKey, autoReason, secFeatureName, templateFeatures, projectFeatures, missingTemplateLines, planSwitch };
});
