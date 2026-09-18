/* Signing in from the hosted planner, and what a PM sees when it does not work.
 *
 * WHY THIS EXISTS: at the 2026-09-17 training session four of six people pressed
 * Refresh and got nothing. Entra's sign-in log showed every one of them was issued
 * a planner token, so it was not consent and not rights. The Static Web Apps
 * wall's session cookie is SameSite=Strict, and when the user clicked anything on
 * Microsoft's page (account picker, "Stay signed in?", MFA) the popup's trip back
 * to the planner was treated as cross-site, the cookie was withheld, the wall ran
 * its own login inside the popup, and the sign-in code in the URL was lost. The
 * popup sat on a second copy of the planner, MSAL gave up after 60 seconds with
 * monitor_window_timeout, and the page then alerted a raw error and opened a file
 * picker asking for a .json nobody had. Reproduced both ways in a real browser.
 *
 * The fix, pinned here:
 *  1. The popup lands on /auth-redirect.html, a blank page OUTSIDE the wall, so
 *     the cookie no longer matters.
 *  2. A failed sign-in on the hosted site says what happened and offers Try
 *     again. It never opens the file picker, which only makes sense for a
 *     downloaded copy.
 *  3. The account the wall already signed in is passed to Microsoft as a login
 *     hint, so a browser holding several Microsoft accounts skips the picker.
 *
 * MSAL and fetch are stubbed; the planner and graph-to-planner.js run for real.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const WEB = path.join(ROOT, 'web');
const HOST = 'https://mango-sky-0d6904310.5.azurestaticapps.net';
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-payloads-graph.json'), 'utf8'));

const MSAL_STUB = `<script>
window.__msal={cfg:null,popupCalls:[],silentCalls:[],accounts:[],active:null,
  popupImpl:()=>Promise.reject(new Error('no popupImpl')),silentImpl:()=>Promise.reject(new Error('no silentImpl'))};
window.msal={PublicClientApplication:class{
  constructor(cfg){window.__msal.cfg=cfg;}
  getActiveAccount(){return window.__msal.active;}
  setActiveAccount(a){window.__msal.active=a;}
  getAllAccounts(){return window.__msal.accounts;}
  acquireTokenSilent(r){window.__msal.silentCalls.push(r);return window.__msal.silentImpl(r);}
  loginPopup(r){window.__msal.popupCalls.push(r);return window.__msal.popupImpl(r);}
}};
</script>`;

function boot({ withMsal = true, url = HOST + '/', me = { clientPrincipal: { identityProvider: 'aad', userDetails: 'don@d2pools.com', userRoles: ['anonymous', 'authenticated'] } }, siteStatus = 200 } = {}) {
  let html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="graph-to-planner.js"></script>',
      '<script>' + fs.readFileSync(path.join(WEB, 'graph-to-planner.js'), 'utf8') + '</script>')
    .replace('</body>', `<script>window.__x=()=>{window.S=S;window.D2_GRAPH=D2_GRAPH;window.showPushResult=showPushResult;
       window.doActivatePool=doActivatePool;};</script><script>__x();</script></body>`);
  html = html.replace('<script src="vendor/msal-browser.min.js"></script>', withMsal ? MSAL_STUB : '');
  const errs = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const net = { calls: [], siteStatus };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, opts) => {
        u = String(u); net.calls.push(u);
        const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
        if (u.endsWith('/.auth/me')) return me ? json(200, me) : json(404, {});
        if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:'))
          return net.siteStatus === 200 ? json(200, { id: G.siteId, webUrl: G.site }) : json(net.siteStatus, { error: { code: 'accessDenied' } });
        const L = w.D2_GRAPH && w.D2_GRAPH.lists;
        if (L) for (const k of ['jobs', 'asg', 'tasks', 'cal']) if (u.includes('/lists/' + L[k] + '/items')) return json(200, { value: G[k] });
        // Refresh also reads every other list in D2_GRAPH.lists (New Pool Requests today).
        if (/\/lists\/[0-9a-f-]+\/items/.test(u)) return json(200, { value: [] });
        return json(404, {});
      };
    }
  });
  const w = dom.window;
  const seen = { alerts: [], picker: 0 };
  w.alert = m => seen.alerts.push(String(m));
  w.confirm = () => true;
  w.document.getElementById('d2File').click = () => { seen.picker++; };
  return { w, errs, net, seen };
}
const mErr = (code, msg) => Object.assign(new Error(code + ': ' + msg), { errorCode: code, name: 'BrowserAuthError' });
const drawerOpen = w => w.document.getElementById('drawer').classList.contains('open');
const bodyText = w => w.document.getElementById('dBody').textContent.replace(/\s+/g, ' ');
const footHTML = w => w.document.getElementById('dFoot').innerHTML;
const clickRefresh = w => w.document.getElementById('d2Btn').click();
const tryAgain = w => {
  const b = [...w.document.querySelectorAll('#dFoot button')].find(x => /try again/i.test(x.textContent));
  if (b) b.click();
  return !!b;
};

(async () => {
  // ---------- 1 + 3: where the popup lands, and who it is for ----------
  {
    const { w, errs, net, seen } = boot();
    await sleep(400);
    ok('boots with no jsdom errors', errs.length === 0, errs.join(' | '));
    ok('asks the wall who is signed in', net.calls.some(u => u.endsWith('/.auth/me')));

    w.__msal.popupImpl = () => Promise.reject(mErr('monitor_window_timeout', 'Token acquisition in popup failed due to timeout.'));
    clickRefresh(w);
    await sleep(100);
    const cfg = w.__msal.cfg;
    ok('the popup lands on /auth-redirect.html, outside the wall',
       !!cfg && cfg.auth.redirectUri === HOST + '/auth-redirect.html', cfg && cfg.auth.redirectUri);
    const req = w.__msal.popupCalls[0] || {};
    ok('the popup carries the wall account as a login hint', req.loginHint === 'don@d2pools.com', JSON.stringify(req));
    ok('the popup still asks for the Graph scope', JSON.stringify(req.scopes) === JSON.stringify(w.D2_GRAPH.scopes));

    // ---------- 2: a sign-in that does not finish ----------
    ok('a failed sign-in does NOT open the file picker', seen.picker === 0, 'picker opened ' + seen.picker + 'x');
    ok('a failed sign-in raises no alert', seen.alerts.length === 0, seen.alerts.join(' | ').slice(0, 120));
    ok('a failed sign-in opens the drawer to explain', drawerOpen(w));
    ok('it says the sign-in did not finish', /did not finish/i.test(bodyText(w)), bodyText(w).slice(0, 160));
    ok('it keeps the MSAL code for support, but not as the headline',
       /monitor_window_timeout/.test(w.document.getElementById('dBody').innerHTML)
       && !/^.{0,40}monitor_window_timeout/.test(bodyText(w).trim()));
    ok('it offers Try again', /try again/i.test(footHTML(w)), footHTML(w).slice(0, 160));

    // Try again, with a cached account whose silent token fails: go straight to the
    // popup, because awaiting a failing silent call first can cost the popup its
    // user gesture and get it blocked.
    w.__msal.accounts = [{ username: 'don@d2pools.com' }];
    w.__msal.silentImpl = () => Promise.reject(mErr('interaction_required', 'x'));
    w.__msal.popupImpl = () => Promise.resolve({ accessToken: 't', account: { username: 'don@d2pools.com' } });
    const silentBefore = w.__msal.silentCalls.length, popBefore = w.__msal.popupCalls.length;
    ok('Try again is a real button', tryAgain(w));
    await sleep(300);
    ok('Try again goes straight to the popup', w.__msal.popupCalls.length === popBefore + 1
       && w.__msal.silentCalls.length === silentBefore,
       'popups +' + (w.__msal.popupCalls.length - popBefore) + ', silent +' + (w.__msal.silentCalls.length - silentBefore));
    if (w.S.jobs.length !== G.jobs.length) console.log("  drawer says:", bodyText(w).slice(0, 200));
    ok('after a good sign-in the schedule loads', w.S.jobs.length === G.jobs.length, 'jobs=' + w.S.jobs.length);
    ok('and the drawer is closed again', !drawerOpen(w));
    ok('still no file picker, and the only message is the usual load summary', seen.picker === 0
       && seen.alerts.length === 1 && /^Schedule loaded\./.test(seen.alerts[0]), JSON.stringify(seen.alerts).slice(0, 300));

    // ---------- the same explanation on Activate ----------
    const job = w.S.jobs[0];
    w.__msal.silentImpl = () => Promise.reject(mErr('interaction_required', 'x'));
    w.__msal.popupImpl = () => Promise.reject(mErr('user_cancelled', 'User cancelled the flow.'));
    await w.doActivatePool(job.id);
    ok('Activate explains a closed sign-in window in words', /closed/i.test(bodyText(w)), bodyText(w).slice(0, 160));

    // ---------- and on Save ----------
    w.showPushResult(null, mErr('monitor_window_timeout', 'Token acquisition in popup failed due to timeout.'));
    ok('Save says nothing was written, and why, in words',
       /nothing was written/i.test(bodyText(w)) && /did not finish/i.test(bodyText(w)), bodyText(w).slice(0, 200));
  }

  // ---------- each way a sign-in fails gets its own sentence ----------
  const cases = [
    ['user_cancelled', /closed/i],
    ['popup_window_error', /pop-?ups?/i],
    ['empty_window_error', /pop-?ups?/i],
    ['interaction_in_progress', /already open/i],
  ];
  for (const [code, re] of cases) {
    const { w, seen } = boot();
    await sleep(300);
    w.__msal.popupImpl = () => Promise.reject(mErr(code, 'x'));
    clickRefresh(w);
    await sleep(100);
    ok(code + ' is explained', drawerOpen(w) && re.test(bodyText(w)) && seen.picker === 0, bodyText(w).slice(0, 140));
  }

  // ---------- signed in, but SharePoint will not let the account in ----------
  {
    const { w, seen } = boot({ siteStatus: 403 });
    await sleep(300);
    w.__msal.popupImpl = () => Promise.resolve({ accessToken: 't', account: { username: 'amy@d2pools.com' } });
    clickRefresh(w);
    await sleep(150);
    const t = bodyText(w);
    ok('a 403 names the account that was refused', /amy@d2pools\.com/.test(t), t.slice(0, 200));
    ok('and says it is about access to the site', /access/i.test(t) && /D2 Build Scheduler site/.test(t), t.slice(0, 200));
    ok('and still opens no file picker', seen.picker === 0);
  }

  // ---------- local dev: no wall, so no hint ----------
  {
    const { w } = boot({ me: null, url: 'http://localhost:8787/' });
    await sleep(300);
    w.__msal.popupImpl = () => Promise.reject(mErr('user_cancelled', 'x'));
    clickRefresh(w);
    await sleep(100);
    const req = w.__msal.popupCalls[0] || {};
    ok('with no wall account, no loginHint key is sent at all', req.scopes && !('loginHint' in req), JSON.stringify(req));
    ok('local dev lands on its own /auth-redirect.html', w.__msal.cfg.auth.redirectUri === 'http://localhost:8787/auth-redirect.html',
       w.__msal.cfg.auth.redirectUri);
  }

  // ---------- a downloaded copy keeps its file picker ----------
  {
    const { w, seen } = boot({ withMsal: false, url: 'http://localhost/' });
    await sleep(300);
    clickRefresh(w);
    await sleep(50);
    ok('without MSAL, Refresh still opens the file picker', seen.picker === 1, 'picker ' + seen.picker);
  }

  // ---------- the hosting config that makes 1 work ----------
  {
    const cfg = JSON.parse(fs.readFileSync(path.join(WEB, 'staticwebapp.config.json'), 'utf8'));
    const i = cfg.routes.findIndex(r => r.route === '/auth-redirect.html');
    const star = cfg.routes.findIndex(r => r.route === '/*');
    const r = cfg.routes[i] || {};
    ok('/auth-redirect.html has its own route', i >= 0);
    ok('it is public', JSON.stringify(r.allowedRoles) === '["anonymous"]', JSON.stringify(r.allowedRoles));
    ok('it comes before the /* wall, so it wins', i >= 0 && i < star, 'index ' + i + ' vs /* at ' + star);
    ok('the wall still covers everything else', JSON.stringify((cfg.routes[star] || {}).allowedRoles) === '["authenticated"]');
    const h = r.headers || {};
    ok('the page can be framed by the planner itself (MSAL silent renewal)',
       /frame-ancestors 'self'/.test(h['Content-Security-Policy'] || '') && h['X-Frame-Options'] === 'SAMEORIGIN',
       JSON.stringify(h).slice(0, 160));
    const page = path.join(WEB, 'auth-redirect.html');
    const src = fs.existsSync(page) ? fs.readFileSync(page, 'utf8') : '';
    ok('web/auth-redirect.html exists', !!src);
    ok('and runs no script, so nothing can clear the sign-in code', !!src && !/<script/i.test(src));
  }

  process.exit(fail);
})();
