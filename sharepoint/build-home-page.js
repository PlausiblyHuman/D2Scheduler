/* Build the D2 Build Scheduler home page: a launchpad for the office.
 *
 * WHY: the site was still the untouched Microsoft "project management" team
 * template. Its landing page carried three web parts literally titled
 * "[Sample content]" -- a Progress tracker list, an Issue tracker list and a
 * Documents library -- over stock photography of a whiteboard and some string
 * art, plus Quick links pointing at GitHub and Visual Studio. That is the first
 * thing Don Borgeson and David Taylor would ever have seen of what they bought.
 *
 * AUDIENCE, in priority order: Don and David (owners, mostly a read -- they also
 * get the daily and weekly summary emails), then Cody Campbell and Emon
 * Alexander (the two PMs, who need to DO things). Shane's call 2026-09-07: this
 * page is a LAUNCHPAD, not a showcase. Owners already have their visibility by
 * email, so the page is optimised for getting people to work fast.
 *
 * The office surface IS the SharePoint views. This page is the front door to
 * them. The List web part in the middle is the point of the whole design: it
 * accepts selectedViewId, so "Today by Crew" renders live ON the landing page
 * rather than a click away. A PM lands already looking at the answer.
 *
 * DO NOT describe mechanisms that do not exist. There is no browser-tool ->
 * Lists nightly sync (descoped from the pilot 2026-09-05) and there are no
 * Teams channels (deferred post-pilot). The Phase F training docs had to be
 * corrected for exactly that, so nothing on this page mentions either.
 *
 * ---------------------------------------------------------------------------
 * WHY TEXT WEB PARTS AND NOT HERO / QUICK LINKS -- this was tested, not assumed
 * ---------------------------------------------------------------------------
 * The first build used a Hero web part for three big tiles and a Quick links
 * web part in Button layout. Both were authored from the shapes read off this
 * site's own ProjectHome.aspx. Both FAILED, in the same way and for the same
 * underlying reason, and the failure is silent:
 *
 *   - Both web parts stored correctly. Reading CanvasContent1 back showed the
 *     Hero with its 3 content items and Quick links with its 7 items intact.
 *   - Both MOUNTED. In page-edit mode the Hero showed three tiles each reading
 *     "Add a link", and the Quick links web part was present but empty.
 *   - Neither BOUND its serverProcessedContent. Hero and Quick links keep their
 *     titles and URLs in serverProcessedContent.searchablePlainTexts and
 *     .links, keyed like "content[0].link" and "items[0].sourceItem.url".
 *     Written through the list-item MERGE path those keys are stored but never
 *     applied, so both web parts render as nothing at all in view mode.
 *
 * Things ruled out along the way, so they are not re-tried:
 *   - hideWebPartWhenEmpty:false -- Quick links still did not appear, proving
 *     it was a mount/bind failure and not the web part judging itself empty.
 *   - GUID tile ids instead of "d2hero-0" -- a real difference from the working
 *     sample, but not the cause.
 *   - The modern Pages API (SavePageAsDraft), which would have been the
 *     supported path: it rejects HTML in CanvasContent1 outright with
 *     "Unexpected character encountered while parsing value: <" -- even for a
 *     one-line probe. An earlier 409 from it looked like format acceptance but
 *     was only the edit-session check running before the parse.
 *
 * Hero has a second, independent problem worth recording: it is fundamentally
 * image-driven. Every working tile carries isCustomImageLoaded:true and a real
 * image object. "color" is a tint behind an image, not a standalone flat tile,
 * so the flat-colour hero this page originally specified was never going to
 * render regardless of the binding bug.
 *
 * The Text web part (controlType 4) stores plain HTML inline in a data-sp-rte
 * div with NO serverProcessedContent binding, which is exactly why it works
 * here. Less decorative than Button-layout Quick links, completely reliable,
 * and fully reproducible from this file.
 *
 * If Hero or Quick links are wanted later, add them through the SharePoint page
 * editor UI by hand and then capture CanvasContent1 back into this script.
 * That is the same discipline that the canvas app's control vocabulary needs,
 * and for the same reason: do not hand-author a shape the platform will only
 * accept in one exact form.
 * ---------------------------------------------------------------------------
 *
 * LOCKING: opening the page in the editor takes a short-term coauthoring lock
 * and every write then returns 423. It is NOT a checkout -- CheckOutType reads
 * 2 (None) and UndoCheckOut also returns 423. Retrying for 40s does not clear
 * it. What clears it is POST /_api/sitepages/pages(<id>)/discardPage, which is
 * why this script calls that before writing.
 *
 * Run in the browser console on the site while signed in as stratirus@d2pools.com.
 * Idempotent: re-running rewrites Home.aspx from scratch.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };

  const L = p => site + '/Lists/' + p;
  const U = {
    today: L('Assignments/Today by Crew.aspx'),
    week: L('Assignments/This Week by Crew.aspx'),
    overdue: L('Assignments/Signoff Overdue.aspx'),
    late: L('Assignments/LateStarting Jobs.aspx'),
    unassigned: L('Assignments/Unassigned.aspx'),
    all: L('Assignments/All Assignments.aspx'),
    tasks: L('Tasks/Incomplete Tasks.aspx'),
    jobs: L('Jobs/AllItems.aspx'),
    crews: L('Crews/AllItems.aspx'),
    app: 'https://apps.powerapps.com/play/e/2710a01b-6cfa-e820-b338-2286f2649300/a/6bad1fae-7f3b-42d7-a63f-48a63e1e8771'
  };
  const ASSIGNMENTS = '49ef7006-d3fe-40a7-a52f-c4c18545bd35';
  const VIEW_TODAY = 'a9d66854-3e04-48f8-95cf-a8b6c258d2b1';

  // SharePoint stores canvas control JSON HTML-entity-encoded inside an
  // attribute, using NUMERIC entities for braces and colons. Plain escaping is
  // not enough; this mirrors what the live page actually contains.
  const enc = o => JSON.stringify(o)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/:/g, '&#58;');
  const iid = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
  const pos = zone => ({ zoneIndex: zone, sectionIndex: 1, controlIndex: 1,
                         zoneId: null, sectionFactor: 12, layoutIndex: 1 });

  // controlType 4 = Text (rich text). Inner HTML is raw, not encoded.
  const text = (zone, id, innerHtml) =>
    '<div data-sp-canvascontrol="" data-sp-canvasdataversion="1.0" data-sp-controldata="'
    + enc({ controlType: 4, id, position: pos(zone), emphasis: {} })
    + '"><div data-sp-rte="">' + innerHtml + '</div></div>';

  // controlType 3 = a web part.
  const webpart = (zone, id, webPartId, ver, data) =>
    '<div data-sp-canvascontrol="" data-sp-canvasdataversion="1.0" data-sp-controldata="'
    + enc({ controlType: 3, id, position: pos(zone), webPartId, emphasis: {}, addedFromPersistedData: true })
    + '"><div data-sp-webpart="" data-sp-webpartdataversion="' + ver + '" data-sp-webpartdata="' + enc(data) + '"></div></div>';

  const a = (u, t) => '<a href="' + u + '">' + t + '</a>';

  const intro = '<h2>Where every crew is today</h2>'
    + '<p>Live schedule, crew assignments and field sign-off for D2 pool builds. '
    + 'Today&#39;s work is below. Everything else is at the bottom of this page.</p>'
    + '<p><strong>' + a(U.app, 'Open the D2 Sign-off app') + '</strong>'
    + ' &nbsp;&middot;&nbsp; crew leads tick tasks and sign off from a phone.</p>';

  const links = '<h3>Day to day</h3><ul>'
    + '<li>' + a(U.today, 'Today by Crew') + ' &mdash; who is on which site today</li>'
    + '<li>' + a(U.week, 'This Week by Crew') + ' &mdash; Monday to Saturday</li>'
    + '<li>' + a(U.overdue, 'Sign-off Overdue') + ' &mdash; finished, but nobody has signed it off</li>'
    + '<li>' + a(U.late, 'Late-Starting Jobs') + ' &mdash; should have started and has not been signed off</li>'
    + '<li>' + a(U.unassigned, 'Unassigned Work') + ' &mdash; scheduled with no crew allocated</li>'
    + '</ul><h3>Everything</h3><ul>'
    + '<li>' + a(U.all, 'All Assignments') + ' &mdash; every sub-phase, grouped by job</li>'
    + '<li>' + a(U.tasks, 'Incomplete Tasks') + ' &mdash; outstanding work at task level</li>'
    + '<li>' + a(U.jobs, 'Jobs') + ' &nbsp;&middot;&nbsp; ' + a(U.crews, 'Crews') + '</li>'
    + '</ul>';

  const listData = {
    id: 'f92bf067-bc19-489e-a556-7fe95f508720', instanceId: iid(2), title: 'List',
    description: 'Add a list', dataVersion: '1.0',
    serverProcessedContent: { htmlStrings: {}, searchablePlainTexts: { listTitle: 'Today by Crew' },
                              imageSources: {}, links: {} },
    properties: {
      isDocumentLibrary: false, selectedListId: ASSIGNMENTS,
      selectedListUrl: '/sites/D2BuildScheduler/Lists/Assignments',
      webRelativeListUrl: 'Lists/Assignments',
      selectedViewId: VIEW_TODAY, webpartHeightKey: 2, hideCommandBar: true
      // height 2, not 6: the web part reserves a FIXED height, so a taller
      // setting leaves a large empty gap above the link index on a quiet day.
      // Three assignments is a normal day for D2, not a busy one.
    }
  };

  const canvas = '<div>'
    + text(1, iid(11), intro)
    + webpart(2, iid(2), listData.id, '1.0', listData)
    + text(3, iid(13), links)
    + '</div>';

  // Release any editor coauthoring lock before writing (see LOCKING above).
  await fetch(site + '/_api/sitepages/pages(1)/discardPage',
    { method: 'POST', credentials: 'include', headers: HD });

  let status = 0; const attempts = [];
  for (let i = 0; i < 6; i++) {
    const upd = await fetch(site + "/_api/web/lists/GetByTitle('Site Pages')/items(1)", {
      method: 'POST', credentials: 'include',
      headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
      body: JSON.stringify({ __metadata: { type: 'SP.Data.SitePagesItem' },
        Title: 'D2 Build Scheduler', CanvasContent1: canvas, PageLayoutType: 'Home' }) });
    status = upd.status; attempts.push(status);
    if (upd.ok) break;
    await new Promise(r => setTimeout(r, 4000));
  }
  const pub = await fetch(site + "/_api/web/GetFileByServerRelativeUrl('/sites/D2BuildScheduler/SitePages/Home.aspx')/Publish('launchpad')",
    { method: 'POST', credentials: 'include', headers: HD });

  return { attempts, finalStatus: status, publishStatus: pub.status, canvasBytes: canvas.length,
           sections: ['Text intro + app link', 'Today by Crew (live list)', 'Text link index'] };
})();
