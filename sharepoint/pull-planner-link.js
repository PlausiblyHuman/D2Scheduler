/* Remove the "Planner (download)" link from site navigation.
 *
 * WHY: Shane's call at the 2026-09-11c go-live cut. The planner is absent from
 * the PM guide, so nobody is trained on it, while the nav link made it
 * discoverable to anyone browsing the site. Opened untrained it produces a
 * WRONG plan rather than an incomplete one: `isWork = d => d.getDay() !== 0` is
 * its entire work-calendar model, so any span stepping over one of the 35 Work
 * Calendar holidays draws a day short, and the shortened span then feeds its own
 * conflict checks, which can miss a real overlap and invent a sequence error.
 * See docs/planner-vs-sharepoint-parity.md D7 and D4.
 *
 * It comes back in Phase H (the build phase inside client-facing Phase 2),
 * pointing at the hosted app rather than download.aspx. Spec:
 * docs/superpowers/specs/2026-09-11-planner-as-primary-surface-design.md
 *
 * WHY THIS AND NOT build-navigation.js: that script clears every navigation node
 * and rebuilds the whole bar. Correct for a build, too much blast radius for
 * removing one link on the morning of a go-live. This touches exactly one node
 * and reads the nav back afterwards to prove it.
 *
 * NOTE: this removes the LINK only. `pool-scheduler.html` stays in the site's
 * Documents library, so it is still reachable by browsing that library. Deleting
 * the file is a separate decision and is not done here, because Phase H wants it.
 *
 * HOW TO RUN
 *   1. Open https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler
 *      signed in as stratirus@d2pools.com.
 *   2. DevTools > Sources > Snippets > new snippet, paste, Ctrl+Enter.
 *      (Snippets has no paste guard. In the Console you must first type the
 *      words `allow pasting`.)
 *   3. Read the returned object. `remaining` must be empty.
 *
 * Idempotent: re-running when the link is already gone reports found 0 and
 * changes nothing.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const QL = site + '/_api/web/navigation/quicklaunch';
  const READ = { Accept: 'application/json;odata=nometadata' };

  const ctx = await (await fetch(site + '/_api/contextinfo', {
    method: 'POST', headers: READ, credentials: 'include'
  })).json();

  const HD = {
    Accept: 'application/json;odata=verbose',
    'Content-Type': 'application/json;odata=verbose',
    'X-RequestDigest': ctx.FormDigestValue
  };

  const readNav = async () => {
    const r = await fetch(QL + '?$expand=Children', { headers: READ, credentials: 'include' });
    if (!r.ok) throw new Error('nav read failed: ' + r.status + ' ' + (await r.text()).slice(0, 300));
    return (await r.json()).value || [];
  };

  const findPlanner = nav => {
    const hits = [];
    for (const n of nav) {
      for (const c of (n.Children || [])) {
        if (/planner/i.test(c.Title) || /pool-scheduler\.html/i.test(c.Url || '')) {
          hits.push({ parent: n.Title, id: c.Id, title: c.Title, url: c.Url });
        }
      }
      if (/planner/i.test(n.Title) || /pool-scheduler\.html/i.test(n.Url || '')) {
        hits.push({ parent: '(top level)', id: n.Id, title: n.Title, url: n.Url });
      }
    }
    return hits;
  };

  const before = await readNav();
  const hits = findPlanner(before);

  const deleted = [];
  for (const h of hits) {
    const r = await fetch(`${QL}/getbyid(${h.id})`, {
      method: 'POST', credentials: 'include',
      headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'DELETE' }
    });
    deleted.push({ ...h, status: r.status, ok: r.ok });
  }

  /* Verify by re-reading, never by the status code. This codebase's dominant
     failure signature is a write that returns 2xx and does nothing. */
  const after = await readNav();
  const remaining = findPlanner(after);

  return {
    found: hits.length,
    deleted,
    remaining: remaining.map(h => h.parent + ' > ' + h.title),
    ok: remaining.length === 0,
    navAfter: after.map(n => n.Title + (n.Children && n.Children.length
      ? ' > [' + n.Children.map(c => c.Title).join(', ') + ']' : ''))
  };
})();
