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
  function autoReason(name) { return name + ' not on this project'; }

  /* Raw template Feature column wins; an optional line with none is its own
     feature, named by its title; a plain line has no feature. */
  function secFeatureName(sec) {
    const f = sec && sec.feature != null ? String(sec.feature).trim() : '';
    if (f) return f;
    return sec && sec.optional ? sec.name : null;
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

  return { featureKey, autoReason, secFeatureName, templateFeatures, projectFeatures, missingTemplateLines };
});
