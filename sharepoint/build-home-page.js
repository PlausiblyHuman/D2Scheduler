/* Build the D2 Build Scheduler home page: a launchpad for the office.
 *
 * WHY: replaces the default Microsoft team-site landing page, whose sample web
 * parts and placeholder links are not relevant to this site.
 *
 * AUDIENCE, in priority order: owners, who mostly read and who also receive the
 * daily and weekly summary emails, then the project managers, who need to act.
 * The page is a launchpad rather than a showcase, optimised for getting people
 * to the view they need quickly.
 *
 * The office surface IS the SharePoint views. This page is the front door to
 * them. The List web part in the middle is the point of the whole design: it
 * accepts selectedViewId, so the hero view renders live ON the landing page
 * rather than a click away. A PM lands already looking at the answer.
 *
 * CHANGED 2026-09-09 -- hero swapped from "Today by Crew" to "This Week by
 * Job". A crew-first hero suits a single pool, where there is only one job to
 * place crews on. With several pools running the office needs to think in
 * pools first, so a job-first hero is the better default. "This Week by
 * Job" is a new view (see provision-views.js), same Mon-Sun WeekMonday
 * filter as "This Week by Crew", grouped by Job instead of Crew. "Today by
 * Crew" is not gone -- it is still the right view for "who is on site right
 * now", so it stays first in the Day to day list below.
 *
 * DO NOT describe mechanisms that do not exist. There is no browser-tool ->
 * Lists nightly sync (descoped from the pilot 2026-09-05) and there are no
 * Teams channels (deferred post-pilot). The Phase F training docs had to be
 * corrected for exactly that, so nothing on this page mentions either.
 *
 * ADDED 2026-09-08 -- "Pool management" section: New Pool and Delete Pool now
 * link to the New Pool Requests / Delete Pool Requests lists, which is how a
 * PM actually starts or removes a pool build (D2 - New Pool and D2 - Delete
 * Pool read the row and do the rest). Kept in their own labelled section
 * below the day-to-day views rather than mixed into either list, because
 * these are actions, not something to glance at. Delete Pool is captioned
 * "permanent" in the link text itself rather than styled or hidden away --
 * a PM who reads the one line before clicking is the actual safeguard, not
 * colour.
 *
 * ADDED 2026-09-09 -- Reschedule Pool and Planned Pools joined the same
 * section. Found missing in the final whole-branch review of the
 * Planned-suppression / reflow work: the office quick reference already
 * makes Reschedule Requests the answer to "a date slipped" and sends PMs to
 * Planned Pools to confirm a commit, but neither surface was linked from the
 * page the office actually starts from.
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
    weekByJob: L('Assignments/This Week by Job.aspx'),
    overdue: L('Assignments/Signoff Overdue.aspx'),
    late: L('Assignments/LateStarting Jobs.aspx'),
    conflicts: L('Assignments/Conflicts.aspx'),
    unassigned: L('Assignments/Unassigned.aspx'),
    all: L('Assignments/All Assignments.aspx'),
    tasks: L('Tasks/Incomplete Tasks.aspx'),
    jobs: L('Jobs/AllItems.aspx'),
    crews: L('Crews/AllItems.aspx'),
    newPool: L('New Pool Requests/AllItems.aspx'),
    deletePool: L('Delete Pool Requests/AllItems.aspx'),
    reschedulePool: L('Reschedule Requests/AllItems.aspx'),
    plannedPools: L('Jobs/Planned Pools.aspx'),
    calendar: '/sites/D2BuildScheduler/_layouts/15/groupstatus.aspx?Target=CALENDAR&Source=QuickLaunch',
    app: 'https://apps.powerapps.com/play/e/2710a01b-6cfa-e820-b338-2286f2649300/a/6bad1fae-7f3b-42d7-a63f-48a63e1e8771'
  };
  const ASSIGNMENTS = '49ef7006-d3fe-40a7-a52f-c4c18545bd35';
  // Hero view for the embedded List web part. Was "Today by Crew"
  // (a9d66854-3e04-48f8-95cf-a8b6c258d2b1) until 2026-09-09; now "This Week
  // by Job" -- see the CHANGED note above.
  const VIEW_HERO = '85da575e-9452-4987-985e-96c8ee4fdb9c';

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
  // zoneEmphasis paints the whole section band from the site theme. This is the
  // lever for colour on this page: inline style attributes inside data-sp-rte are
  // stripped by the rich-text sanitiser, but section emphasis is native and sticks.
  // 0 none, 1 neutral, 2 soft, 3 strong (theme primary, which is D2 green).
  const text = (zone, id, innerHtml, zoneEmphasis = 0) =>
    '<div data-sp-canvascontrol="" data-sp-canvasdataversion="1.0" data-sp-controldata="'
    + enc({ controlType: 4, id, position: pos(zone), emphasis: { zoneEmphasis } })
    + '"><div data-sp-rte="">' + innerHtml + '</div></div>';

  // controlType 3 = a web part.
  const webpart = (zone, id, webPartId, ver, data, zoneEmphasis = 0) =>
    '<div data-sp-canvascontrol="" data-sp-canvasdataversion="1.0" data-sp-controldata="'
    + enc({ controlType: 3, id, position: pos(zone), webPartId, emphasis: { zoneEmphasis }, addedFromPersistedData: true })
    + '"><div data-sp-webpart="" data-sp-webpartdataversion="' + ver + '" data-sp-webpartdata="' + enc(data) + '"></div></div>';

  const a = (u, t) => '<a href="' + u + '">' + t + '</a>';

  const intro = '<h2>Every pool, this week</h2>'
    + '<p>Live schedule, crew assignments and field sign-off for D2 pool builds. '
    + 'This week&#39;s work is below, grouped by pool. Use the tabs at the top of '
    + 'the page to jump anywhere else.</p>'
    + '<p><strong>' + a(U.app, 'Open the D2 Sign-off app') + '</strong>'
    + ' &nbsp;&middot;&nbsp; tick tasks and sign off from a phone'
    + ' &nbsp;&nbsp;|&nbsp;&nbsp; <strong>' + a(U.calendar, 'Open the pool calendar') + '</strong>'
    + ' &nbsp;&middot;&nbsp; every live pool, in Outlook and Teams</p>';

  const links = '<h3>Day to day</h3><ul>'
    + '<li>' + a(U.today, 'Today by Crew') + ' &mdash; who is on which site today</li>'
    + '<li>' + a(U.week, 'This Week by Crew') + ' &mdash; Monday to Saturday, by crew</li>'
    + '<li>' + a(U.weekByJob, 'This Week by Job') + ' &mdash; Monday to Saturday, by pool</li>'
    + '<li>' + a(U.overdue, 'Sign-off Overdue') + ' &mdash; finished, but nobody has signed it off</li>'
    + '<li>' + a(U.late, 'Late-Starting Jobs') + ' &mdash; should have started and has not been signed off</li>'
    + '<li>' + a(U.conflicts, 'Conflicts') + ' &mdash; same crew, overlapping dates, different pools &mdash; flagged nightly by D2 - Conflict Flag</li>'
    + '<li>' + a(U.unassigned, 'Unassigned Work') + ' &mdash; scheduled with no crew allocated</li>'
    + '</ul><h3>Everything</h3><ul>'
    + '<li>' + a(U.all, 'All Assignments') + ' &mdash; every sub-phase, grouped by job</li>'
    + '<li>' + a(U.tasks, 'Incomplete Tasks') + ' &mdash; outstanding work at task level</li>'
    + '<li>' + a(U.jobs, 'Jobs') + ' &nbsp;&middot;&nbsp; ' + a(U.crews, 'Crews') + '</li>'
    + '</ul><h3>Pool management</h3><ul>'
    + '<li>' + a(U.newPool, 'New Pool') + ' &mdash; start a new pool build: job number, name, address and start date generate every sub-phase and task</li>'
    + '<li>' + a(U.reschedulePool, 'Reschedule Pool') + ' &mdash; a date slipped or a sub-phase needs to move: name the job and the sub-phase to reflow from, everything after it recomputes automatically</li>'
    + '<li>' + a(U.plannedPools, 'Planned Pools') + ' &mdash; pools waiting on a commit. Nothing dispatches or alerts for these until Status changes from Planned to Active on the Jobs list</li>'
    + '<li>' + a(U.deletePool, 'Delete Pool') + ' &mdash; <strong>permanent.</strong> Removes a pool and everything under it. Only for a pool created by mistake.</li>'
    + '</ul>';

  const listData = {
    id: 'f92bf067-bc19-489e-a556-7fe95f508720', instanceId: iid(2), title: 'List',
    description: 'Add a list', dataVersion: '1.0',
    serverProcessedContent: { htmlStrings: {}, searchablePlainTexts: { listTitle: 'This Week by Job' },
                              imageSources: {}, links: {} },
    properties: {
      isDocumentLibrary: false, selectedListId: ASSIGNMENTS,
      selectedListUrl: '/sites/D2BuildScheduler/Lists/Assignments',
      webRelativeListUrl: 'Lists/Assignments',
      selectedViewId: VIEW_HERO, webpartHeightKey: 2, hideCommandBar: true
      // height 2, not 6: the web part reserves a FIXED height, so a taller
      // setting leaves a large empty gap above the link index on a quiet day.
      // Six pools a week is a normal week for D2, not a busy one.
    }
  };

  const canvas = '<div>'
    + text(1, iid(11), intro, 3)            // green hero band, flows out of the header
    + webpart(2, iid(2), listData.id, '1.0', listData, 0)   // live schedule stays on white
    + text(3, iid(13), links, 2)            // soft tint, so the index reads as a separate shelf
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
           sections: ['Text intro + app link', 'This Week by Job (live list)', 'Text link index'] };
})();
