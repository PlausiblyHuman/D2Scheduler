/* Apply D2 Pools branding to the D2 Build Scheduler SharePoint site.
 *
 * Run in the browser console on the site while signed in as stratirus@d2pools.com.
 * Idempotent.
 *
 * COLOURS ARE MEASURED, NOT CHOSEN. Reading computed styles across every visible
 * element on d2pools.com and weighting by painted area gave:
 *
 *     #082544   navy    dominant brand colour
 *     #0B594B   green   accent
 *     #F6F3ED   cream   warm off-white
 *     Poppins (headings/links) + Source Sans Pro (body)
 *
 * SharePoint will not load Poppins, so typography stays native and the brand
 * cue is colour, the logo, and restraint. Verified applied by reading computed
 * styles back off the live page: headings resolve to rgb(8,37,68) and links to
 * rgb(11,89,75), which are those two hex values exactly.
 *
 * NAVY IS DELIBERATELY THE NEUTRAL, NOT THE THEME PRIMARY. themePrimary drives
 * links and interactive affordances, and navy there is nearly indistinguishable
 * from body text, so the accent green takes it and navy becomes neutralPrimary /
 * bodyText. That is why headings read navy and links read green.
 *
 * NO HEADER PHOTOGRAPHY, AND THIS IS A LICENSING DECISION, not an oversight.
 * The hero images on d2pools.com are licensed Getty stock -- GettyImages-134108091,
 * -1364656744 and -521154563. D2 holds a licence for their marketing site; that
 * almost certainly does not extend to copying them into their SharePoint tenant.
 * The logo is different in kind: D2's own mark, on D2's own site, going onto
 * D2's own intranet. A real header photo would have to come from D2's own
 * project photography, which someone at D2 has to supply.
 *
 * There is also no place to put one. The home page is PageLayoutType "Home",
 * which has no title-banner region at all (confirmed: no pageHeader element in
 * the DOM). Getting one would mean switching to Article layout and pushing the
 * live "Today by Crew" list below a decorative title block -- a bad trade for a
 * page whose whole job is getting people to work fast.
 *
 * THE LOGO FILE. D2's published mark is WHITE ON TRANSPARENT, so used directly
 * it is invisible against SharePoint's white site header. make-site-logo.py
 * composites it onto the navy; assets/d2-logo-160.png is the result and is
 * committed. Regenerate with:  python sharepoint/make-site-logo.py
 *
 * To upload it, base64 the committed PNG and paste it in as B64 below:
 *     python -c "import base64;print(base64.b64encode(open('sharepoint/assets/d2-logo-160.png','rb').read()).decode())"
 *
 * Note the copy currently live in the tenant is byte-for-byte very slightly
 * different from the committed PNG (same 2898 bytes, different SHA-256) because
 * the base64 was hand-carried through a console paste. It renders correctly and
 * nothing depends on the bytes, so it was left alone; re-running the upload
 * below from the committed file makes them identical if that ever matters.
 */
(async () => {
  const B64 = '';   // paste base64 of sharepoint/assets/d2-logo-160.png to re-upload the logo

  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const digest = dg.d.GetContextWebInformation.FormDigestValue;
  const HD = { ...H, 'X-RequestDigest': digest };
  const out = {};

  // ---- theme -------------------------------------------------------------
  const palette = {
    themePrimary: '#0b594b', themeLighterAlt: '#f1f9f7', themeLighter: '#c9e8e1',
    themeLight: '#9fd4c9', themeTertiary: '#54a795', themeSecondary: '#1d6a5b',
    themeDarkAlt: '#0a5043', themeDark: '#084438', themeDarker: '#06322a',
    neutralLighterAlt: '#f8f8f8', neutralLighter: '#f4f4f4', neutralLight: '#eaeaea',
    neutralQuaternaryAlt: '#dadada', neutralQuaternary: '#d0d0d0', neutralTertiaryAlt: '#c8c8c8',
    neutralTertiary: '#a6a6a6', neutralSecondary: '#666666', neutralPrimaryAlt: '#3c3c3c',
    neutralPrimary: '#082544', neutralDark: '#151515', black: '#0b0b0b',
    white: '#ffffff', primaryBackground: '#ffffff', primaryText: '#082544',
    bodyBackground: '#ffffff', bodyText: '#082544',
    disabledBackground: '#f4f4f4', disabledText: '#c8c8c8'
  };
  const t = await fetch(site + '/_api/thememanager/ApplyTheme', {
    method: 'POST', credentials: 'include', headers: HD,
    body: JSON.stringify({ name: 'D2 Pools', themeJson: JSON.stringify({ palette }) }) });
  out.applyTheme = t.status;

  // ---- site description --------------------------------------------------
  const w = await fetch(site + '/_api/web', {
    method: 'POST', credentials: 'include',
    headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
    body: JSON.stringify({ __metadata: { type: 'SP.Web' },
      Description: 'Scheduling and field sign-off for D2 Pools builds.' }) });
  out.setDescription = w.status;

  // ---- welcome page ------------------------------------------------------
  const rf = await fetch(site + '/_api/web/RootFolder', {
    method: 'POST', credentials: 'include',
    headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
    body: JSON.stringify({ __metadata: { type: 'SP.Folder' }, WelcomePage: 'SitePages/Home.aspx' }) });
  out.setWelcomePage = rf.status;

  // ---- logo --------------------------------------------------------------
  if (B64) {
    const bin = Uint8Array.from(atob(B64), c => c.charCodeAt(0));
    const up = await fetch(site + "/_api/web/GetFolderByServerRelativeUrl('/sites/D2BuildScheduler/SiteAssets')/Files/add(url='d2-logo.png',overwrite=true)",
      { method: 'POST', credentials: 'include',
        headers: { Accept: 'application/json;odata=verbose', 'X-RequestDigest': digest }, body: bin });
    out.uploadLogo = up.status;
    const sl = await fetch(site + '/_api/siteiconmanager/setsitelogo', {
      method: 'POST', credentials: 'include', headers: HD,
      body: JSON.stringify({ relativeLogoUrl: '/sites/D2BuildScheduler/SiteAssets/d2-logo.png', type: 0, aspect: 0 }) });
    out.setSiteLogo = sl.status;
  } else {
    out.logo = 'skipped -- B64 not set; the site logo already in place is unchanged';
  }

  const g = async u => (await fetch(u, { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' })).json();
  const web = await g(site + '/_api/web?$select=Title,Description,SiteLogoUrl');
  out.now = { title: web.Title, description: web.Description, siteLogoUrl: web.SiteLogoUrl };
  return out;
})();
