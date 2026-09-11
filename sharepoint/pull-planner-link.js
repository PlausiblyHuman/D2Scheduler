/* Remove the "Planner (download)" link from site navigation.
 *
 * The planner is moving to a hosted web app in the next phase. Until that
 * lands, the navigation points only at surfaces covered by the PM guide, so
 * this removes the entry.
 *
 * Scope: the navigation entry only. `pool-scheduler.html` stays in the site's
 * Documents library and is restored to the navigation, pointing at the hosted
 * app, when that work ships.
 *
 * Targets one node and re-reads the navigation afterwards to confirm. Use this
 * rather than build-navigation.js, which clears and rebuilds the entire bar.
 *
 * HOW TO RUN
 *   1. Open https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler
 *      signed in as stratirus@d2pools.com.
 *   2. DevTools > Sources > Snippets > new snippet, paste, Ctrl+Enter.
 *      (Snippets has no paste guard. In the Console you must first type the
 *      words `allow pasting`.)
 *   3. Check the returned object: `ok` should be true and `remaining` empty.
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

  // Re-read the navigation to confirm the change applied.
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
