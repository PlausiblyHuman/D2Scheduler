/* Site chrome and navigation: turn stock SharePoint into something app-shaped.
 *
 * WHY: the default left rail is stock SharePoint -- Home, Conversations,
 * Notebook, Calendar, Documents, Recent. Only Home and Calendar are relevant
 * here, and none of the lists a PM opens day to day were reachable without
 * scrolling the home page. This puts them on header tabs instead.
 *
 * THREE LEVERS, all native and all scriptable. None of this needed the page
 * editor, which matters because the web-part binding wall (see
 * build-home-page.js) makes anything canvas-shaped expensive:
 *
 *   1. Web.HorizontalQuickLaunch = true
 *      Moves a GROUP team site's navigation from the left rail to a horizontal
 *      bar across the top. This is what "header tabs" means in practice, and it
 *      is a plain boolean on /_api/web. Confirmed working on WebTemplate=GROUP.
 *
 *   2. Web.HeaderEmphasis = 0 (None -- a white/clear header band)
 *      This was 3 (Strong), which paints the header in the theme's PRIMARY
 *      colour. On D2's theme that primary is GREEN (#0B594B), not navy, so the
 *      header band and the green hero band on the home page rendered as one
 *      continuous green slab with only the command bar between them.
 *      0 separates them: blue suite bar, white header carrying the tabs, then
 *      green as a deliberate hero band below.
 *      A NAVY header is not reachable this way. HeaderEmphasis only ever pulls
 *      from the theme, so navy would mean changing the theme primary, which
 *      repaints every link and button on the site -- a far larger change than a
 *      header colour. White was taken instead. Changed 2026-09-10.
 *      HeaderLayout stays 2 (Compact) -- Standard adds a taller site header that
 *      pushes the live schedule below the fold.
 *
 *      CACHING: SharePoint caches navigation per page. After running this, an
 *      already-visited list page keeps rendering the OLD left rail with no tabs.
 *      That is cache, not a failed write -- hard-reload each page to confirm.
 *
 *   3. quicklaunch nodes, rebuilt from scratch
 *      /_api/web/navigation/quicklaunch supports parent nodes with Children,
 *      which render as flyout menus on the horizontal bar.
 *
 * ORDER IS DISPLAY ORDER and nodes append, so this deletes every existing node
 * and rebuilds rather than trying to reorder in place.
 *
 * LABELS ARE SHORT ON PURPOSE. The horizontal bar cuts to an overflow "..." at
 * around four to five items on a 1440px window, and the site-owner-only "Edit
 * navigation" link competes for the same space (members see one more tab than
 * an owner does). First attempt used "Needs Attention" and pushed Pools and
 * Calendar into the overflow, which buried the two things a PM opens most.
 * Renaming it "Attention" and moving Pools ahead of it fixed that. Do not
 * lengthen these labels without re-checking what survives the cut.
 *
 * Run in the browser console on the site, signed in as stratirus@d2pools.com.
 * Idempotent: re-running clears and rebuilds to the same state.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };
  const QL = site + '/_api/web/navigation/quicklaunch';
  const A = '/sites/D2BuildScheduler/Lists/Assignments/';
  const L = '/sites/D2BuildScheduler/Lists/';
  const CALENDAR = '/sites/D2BuildScheduler/_layouts/15/groupstatus.aspx?Target=CALENDAR&Source=QuickLaunch';
  const APP = 'https://apps.powerapps.com/play/e/2710a01b-6cfa-e820-b338-2286f2649300/a/6bad1fae-7f3b-42d7-a63f-48a63e1e8771';

  /* THE PLANNER LINK IS NOT PUBLISHED IN THIS BUILD.

     It was published as a download from the Documents library, because an .html
     file in a document library cannot render on this site (that is the
     custom-script mechanism, blocked by default and it reverts within 24 hours)
     while download.aspx forces the download regardless of preview behaviour.
     That mechanism works and was verified from file:// in Chrome, localStorage
     and all.

     It is withheld until the planner's work-calendar handling matches the
     server side. The planner treats Sunday as the only non-working day, while
     the flows also read 35 holidays from the Work Calendar list, so any span
     crossing a holiday differs between the two. See
     docs/planner-vs-sharepoint-parity.md D7 and D4.

     It returns in the next phase, when the planner becomes a hosted web app and
     this link points at that URL rather than download.aspx. Spec:
     docs/superpowers/specs/2026-09-11-planner-as-primary-surface-design.md

  const PLANNER = '/sites/D2BuildScheduler/_layouts/15/download.aspx'
                + '?SourceUrl=/sites/D2BuildScheduler/Shared%20Documents/pool-scheduler.html';
  */

  // 1 + 2. Site chrome.
  const chrome = await fetch(site + '/_api/web', {
    method: 'POST', credentials: 'include',
    headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
    body: JSON.stringify({ __metadata: { type: 'SP.Web' },
      HorizontalQuickLaunch: true, HeaderEmphasis: 0, HeaderLayout: 2 })
  });

  // 3. Navigation, cleared and rebuilt.
  const existing = await (await fetch(QL, { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json();
  let removed = 0;
  for (const n of (existing.value || [])) {
    const r = await fetch(`${QL}/getbyid(${n.Id})`, { method: 'POST', credentials: 'include',
      headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'DELETE' } });
    if (r.ok) removed++;
  }

  const top = async (Title, Url, IsExternal = false) => {
    const r = await fetch(QL, { method: 'POST', credentials: 'include', headers: HD,
      body: JSON.stringify({ __metadata: { type: 'SP.NavigationNode' }, Title, Url, IsExternal }) });
    return (await r.json()).d.Id;
  };
  const kid = (parentId, Title, Url) =>
    fetch(`${QL}/getbyid(${parentId})/children`, { method: 'POST', credentials: 'include', headers: HD,
      body: JSON.stringify({ __metadata: { type: 'SP.NavigationNode' }, Title, Url, IsExternal: false }) });

  await top('Home', '/sites/D2BuildScheduler');
  await top('Today', A + 'Today%20by%20Crew.aspx');
  await top('This Week', A + 'This%20Week%20by%20Job.aspx');

  // Pools sits ahead of Attention so it survives the overflow cut.
  const pools = await top('Pools', L + 'Jobs/AllItems.aspx');
  await kid(pools, 'All Pools',         L + 'Jobs/AllItems.aspx');
  await kid(pools, 'Planned Pools',     L + 'Jobs/Planned%20Pools.aspx');
  await kid(pools, 'Start a New Pool',  L + 'New%20Pool%20Requests/AllItems.aspx');
  await kid(pools, 'Reschedule a Pool', L + 'Reschedule%20Requests/AllItems.aspx');
  await kid(pools, 'Remove a Pool',     L + 'Delete%20Pool%20Requests/AllItems.aspx');
  // Planner link intentionally omitted. See the block comment above.
  // It sat here, under Pools rather than as its own tab, because the horizontal
  // bar overflows at four or five top-level items and Pools/Calendar were buried
  // once already. Restore it in the same place.

  const attn = await top('Attention', A + 'Signoff%20Overdue.aspx');
  await kid(attn, 'Sign-off Overdue',   A + 'Signoff%20Overdue.aspx');
  await kid(attn, 'Conflicts',          A + 'Conflicts.aspx');
  await kid(attn, 'Unassigned Work',    A + 'Unassigned.aspx');
  await kid(attn, 'Late-Starting Jobs', A + 'LateStarting%20Jobs.aspx');

  await top('Calendar', CALENDAR);
  await top('Sign-off App', APP, true);

  const lists = await top('Lists', A + 'All%20Assignments.aspx');
  await kid(lists, 'All Assignments',   A + 'All%20Assignments.aspx');
  await kid(lists, 'This Week by Crew', A + 'This%20Week%20by%20Crew.aspx');
  await kid(lists, 'Incomplete Tasks',  L + 'Tasks/Incomplete%20Tasks.aspx');
  await kid(lists, 'Crews',             L + 'Crews/AllItems.aspx');

  const after = await (await fetch(QL + '?$expand=Children',
    { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json();
  const web = await (await fetch(site + '/_api/web?$select=HorizontalQuickLaunch,HeaderEmphasis,HeaderLayout',
    { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json();

  const out = {
    chromeStatus: chrome.status, web, removed,
    nav: (after.value || []).map(n => n.Title + (n.Children && n.Children.length
      ? ' > ' + n.Children.map(c => c.Title).join(', ') : ''))
  };
  console.log(JSON.stringify(out, null, 2));
  console.log('VERIFY BY OPENING THE SITE. A 204 on the chrome MERGE proves nothing about what renders.');
  return out;
})();
