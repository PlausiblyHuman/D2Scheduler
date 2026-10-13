/* Three office-facing views asked for at the 2026-09-17 session, in the real page.
 *
 *  1. Sign-Offs, one job at a time: a job picker, so a PM is not scrolling past
 *     every pool to find theirs.
 *  2. Crews on the collapsed Job Board: "Collapse all" folds each phase to one
 *     line, and that line used to lose the crews ("I don't see the crews
 *     assigned" -- "because we collapsed everything").
 *  3. A project manager on every job: the Jobs tab shows each job's PM and can
 *     filter to one PM, and + Job lets the office pick the PM instead of it
 *     silently being whoever is signed in.
 *
 * The PM is the one with a trap in it. Graph returns ProjectManagerLookupId, an
 * id with no name, so the name comes from the User Information List -- which
 * also holds SharePoint GROUPS and system principals. An earlier resolver
 * matched a group ("D2 Build Scheduler Owners") on an empty field and looked
 * confident. A group must never be offered as a PM.
 *
 * MSAL and fetch are stubbed. The planner, graph-to-planner.js, writeback-core.js
 * and graph-writeback.js all run for real.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const WEB = path.resolve(__dirname, '../../web');
const HOST = 'https://mango-sky-0d6904310.5.azurestaticapps.net';
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-payloads-graph.json'), 'utf8'));

// User Information List rows, in the {id, Title, Name, EMail} shape graph-writeback.js
// selects and signoff-push.js already stubs. Ids 14/15/16 are the live PM ids the
// captured jobs carry (Reyes, Whitfield, Salcedo).
const UIL = [
  { id: '3', Title: 'D2 Build Scheduler Owners', Name: 'D2 Build Scheduler Owners' },
  { id: '5', Title: 'D2 Build Scheduler Members', Name: 'c:0o.c|federateddirectoryclaimprovider|7b305c56-ceea-4838-9e58-90050a846204' },
  { id: '1073741823', Title: 'System Account', Name: 'SHAREPOINT\\system' },
  { id: '7', Title: 'D2 Bot', Name: 'i:0#.f|membership|stratirus@d2pools.com', EMail: 'd2bot@d2pools.com' },
  { id: '13', Title: 'David Taylor', Name: 'i:0#.f|membership|david@d2pools.com', EMail: 'david@d2pools.com' },
  { id: '14', Title: 'Cody Campbell', Name: 'i:0#.f|membership|cody@d2pools.com', EMail: 'cody@d2pools.com' },
  { id: '15', Title: 'Emon Alexander', Name: 'i:0#.f|membership|emon@d2pools.com', EMail: 'emon@d2pools.com' },
  { id: '16', Title: 'Don Borgeson', Name: 'i:0#.f|membership|don@d2pools.com', EMail: 'don@d2pools.com' },
  { id: '21', Title: 'Amy Stevens', Name: 'i:0#.f|membership|amy_d2install.com#ext#@netorgft15040037.onmicrosoft.com' }
].map(f => ({ id: f.id, fields: f }));

const MSAL_STUB = `<script>
window.__msal={cfg:null,popupCalls:[],accounts:[],active:null};
window.msal={PublicClientApplication:class{
  constructor(cfg){window.__msal.cfg=cfg;}
  getActiveAccount(){return window.__msal.active;}
  setActiveAccount(a){window.__msal.active=a;}
  getAllAccounts(){return window.__msal.accounts;}
  acquireTokenSilent(){return Promise.resolve({accessToken:'t'});}
  loginPopup(r){window.__msal.popupCalls.push(r);return Promise.resolve({accessToken:'t',account:{username:'cody@d2pools.com'}});}
}};
</script>`;

function boot() {
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL_STUB)
    .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
    .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
    .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
    .replace('</body>', `<script>window.__x=()=>{window.S=S;window.getUI=()=>UI;window.D2_GRAPH=D2_GRAPH;
       window.collapseAll=collapseAll;window.pushCreates=pushCreates;window.addJob=addJob;
       window.confirmNewPoolRequest=confirmNewPoolRequest;window.crew=crew;window.render=render;};</script><script>__x();</script></body>`);
  const errs = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const net = { posts: [] };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, opts) => {
        u = String(u);
        const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
        if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
        if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: G.siteId, webUrl: G.site });
        if (u.includes('User Information List')) return json(200, { value: UIL });
        if (opts && opts.method === 'POST') { net.posts.push({ url: u, body: JSON.parse(opts.body) }); return json(201, {}); }
        const L = w.D2_GRAPH && w.D2_GRAPH.lists;
        if (L) for (const k of Object.keys(L)) if (u.includes('/lists/' + L[k] + '/items')) return json(200, { value: G[k] || [] });
        if (/\/lists\/[^/]+\/items/.test(u)) return json(200, { value: [] });
        return json(404, {});
      };
    }
  });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true;
  return { w, errs, net };
}
const tab = (w, t) => w.document.querySelector(`#tabs button[data-t="${t}"]`).click();
const main = w => w.document.getElementById('main');
const job = (w, jobno) => w.S.jobs.find(j => j.jobno === jobno);
// Job numbers live in <input> boxes on the Jobs tab, so they never appear in
// textContent. Read the rows actually on screen instead.
const shownJobs = w => {
  const t = [...main(w).querySelectorAll('table')].find(x => /Job Name/.test((x.querySelector('thead') || {}).textContent || ''));
  return t ? [...t.querySelectorAll('tbody tr')].map(tr => (tr.querySelector('td input') || {}).value).filter(Boolean).sort().join(',') : '';
};

(async () => {
  // ---------- graph-to-planner: names, ids and the people list ----------
  {
    const M = require(path.join(WEB, 'graph-to-planner.js'));
    const p = M.toPlannerPayload(Object.assign({}, G, { users: UIL }));
    const reyes = p.jobs.find(j => j.jobno === 'D2-1042');
    ok('a job gets its PM name from the user list', reyes && reyes.pm === 'Cody Campbell', reyes && reyes.pm);
    ok('and keeps the PM site-user id', reyes && reyes.pmId === '14', reyes && reyes.pmId);
    const people = p.people || [];
    const ids = people.map(x => x.id);
    ok('people are real sign-ins only: no SharePoint groups, system or claim principals',
       ids.length && !ids.includes('3') && !ids.includes('5') && !ids.includes('1073741823'), ids.join(','));
    ok('guest duplicates are left out of the people list', ids.length > 0 && !ids.includes('21'), ids.join(','));
    ok('people carry name and UPN, sorted by name',
       JSON.stringify(people.map(x => x.name)) === JSON.stringify(['Cody Campbell', 'D2 Bot', 'David Taylor', 'Don Borgeson', 'Emon Alexander'])
       && (people.find(x => x.id === '15') || {}).upn === 'emon@d2pools.com', JSON.stringify(people));
    const bare = M.toPlannerPayload(G);
    ok('without a user list the PM stays blank and nothing throws',
       bare.jobs.every(j => j.pm === '') && !(bare.people && bare.people.length));
  }

  const { w, errs, net } = boot();
  await sleep(400);
  ok('boots with no jsdom errors', errs.length === 0, errs.join(' | '));
  w.document.getElementById('d2Btn').click();
  await sleep(600);
  ok('Refresh loaded the live pools', w.S.jobs.length === G.jobs.length, 'jobs=' + w.S.jobs.length);
  ok('Refresh stored each PM name on the job', (job(w, 'D2-1042') || {}).pm === 'Cody Campbell'
     && (job(w, 'D2-1043') || {}).pm === 'Emon Alexander' && (job(w, 'D2-1044') || {}).pm === 'Don Borgeson',
     w.S.jobs.map(j => j.jobno + '=' + j.pm).join(', '));
  ok('Refresh stored the people list for the + Job picker', (w.S.people || []).length === 5, String((w.S.people || []).length));

  // ---------- 3a. Jobs tab: PM column and filter ----------
  tab(w, 'jobs');
  let t = main(w).textContent;
  ok('Jobs tab shows each PM', /Cody Campbell/.test(t) && /Emon Alexander/.test(t) && /Don Borgeson/.test(t));
  const pmSel = w.document.getElementById('pmFilter');
  ok('Jobs tab has a PM filter', !!pmSel);
  if (pmSel) {
    const opts = [...pmSel.options].map(o => o.textContent.trim());
    ok('the filter lists each PM once, plus All', opts.length === 4 && /all/i.test(opts[0]), opts.join(' | '));
    pmSel.value = 'Emon Alexander'; pmSel.dispatchEvent(new w.Event('change'));
    ok('filtering to one PM shows only their jobs', shownJobs(w) === 'D2-1043', shownJobs(w));
  }
  const pmLink = main(w).querySelector('[data-pm]');
  ok('a PM name in the table is clickable', !!pmLink);
  const clear = [...main(w).querySelectorAll('button, a')].find(b => /show all/i.test(b.textContent));
  ok('a filtered list offers Show all', !!clear);
  if (clear) clear.click();
  ok('Show all brings every job back', shownJobs(w) === 'D2-1042,D2-1043,D2-1044', shownJobs(w));
  const donLink = [...main(w).querySelectorAll('[data-pm]')].find(a => a.getAttribute('data-pm') === 'Don Borgeson');
  if (donLink) donLink.click();
  ok('clicking a PM name filters to that PM', shownJobs(w) === 'D2-1044', shownJobs(w));
  w.document.getElementById('d2Btn').click();
  await sleep(600);
  ok('the PM filter survives a Refresh', shownJobs(w) === 'D2-1044', shownJobs(w));
  const clear2 = [...main(w).querySelectorAll('button, a')].find(b => /show all/i.test(b.textContent));
  if (clear2) clear2.click();

  // ---------- 1. Sign-Offs: one job at a time ----------
  tab(w, 'signoff');
  const soSel = w.document.getElementById('soJob');
  ok('Sign-Offs has a job picker', !!soSel);
  const cards = () => [...main(w).querySelectorAll('.card')].filter(c => c.querySelector('h2'));
  ok('with no job picked, every job shows', cards().length >= G.jobs.length, 'cards=' + cards().length);
  if (soSel) {
    ok('the picker offers All plus every job', soSel.options.length === G.jobs.length + 1, String(soSel.options.length));
    const reyes = job(w, 'D2-1042');
    soSel.value = reyes.id; soSel.dispatchEvent(new w.Event('change'));
    const shown = cards().filter(c => /Residence|Estate/.test(c.querySelector('h2').textContent));
    ok('picking a job shows only that job', shown.length === 1 && /D2-1042/.test(shown[0].textContent),
       shown.map(c => c.querySelector('h2').textContent.slice(0, 30)).join(' | '));
    w.getUI().signoffJob = 'no-such-job'; w.render();
    ok('a job that is no longer here falls back to showing all', cards().length >= G.jobs.length);
  }

  // ---------- 2. Crews on the collapsed Job Board ----------
  tab(w, 'board');
  w.collapseAll(true);
  const r = job(w, 'D2-1043');
  const g = r.groups.find(gr => new Set(gr.sections.filter(s => !s.skip && s.crewId).map(s => s.crewId)).size >= 2)
         || r.groups.find(gr => gr.sections.some(s => s.crewId));
  const want = [...new Set(g.sections.filter(s => !s.skip && s.crewId).map(s => w.crew(s.crewId)).filter(Boolean).map(c => c.name))];
  const phRows = [...main(w).querySelectorAll('tr.phrow')].filter(tr => tr.textContent.includes(g.num + '.0 ' + g.name));
  const txt = phRows.map(tr => (tr.querySelector('.phcrews') || { textContent: '' }).textContent).join(' ');
  ok('a collapsed phase row names every crew in it', want.length > 0 && want.every(n => txt.includes(n)),
     'want ' + want.join(', ') + ' got "' + txt.trim() + '"');
  w.collapseAll(false);
  ok('an expanded board adds no crew summary to phase rows', !main(w).querySelector('tr.phrow .phcrews'));

  // ---------- 3b. + Job picks the PM ----------
  // Signed in as Don, who is NOT first alphabetically, so a picker that ignored
  // the default and fell back to its first option would fail this.
  w.__msal.active = { username: 'don@d2pools.com' };
  w.addJob();
  const pmPick = w.document.getElementById('ncPm');
  ok('+ Job has a project manager picker', !!pmPick);
  if (pmPick) {
    const vals = [...pmPick.options].map(o => o.value);
    ok('the picker offers people only, never a group', vals.length === 5 && !vals.includes('3') && !vals.includes('5'), vals.join(','));
    ok('it defaults to the signed-in person', pmPick.value === '16', pmPick.value);
    pmPick.value = '15';
    w.document.getElementById('ncJobNo').value = 'TEST-9501';
    w.document.getElementById('ncName').value = 'Picker Test';
    w.confirmNewPoolRequest();
    const pc = (w.S.pendingCreates || []).find(c => c.jobno === 'TEST-9501');
    ok('the queued request carries the chosen PM', pc && pc.pmId === '15' && pc.pmName === 'Emon Alexander', JSON.stringify(pc));
    tab(w, 'jobs');
    ok('the queued request shows its PM', /Emon Alexander/.test(main(w).querySelector('.card').textContent));
    net.posts.length = 0;
    await w.pushCreates(G.siteId, 't', [pc]);
    const post = net.posts.find(p => p.url.includes('/lists/' + w.D2_GRAPH.lists.req));
    ok('Save sends the chosen PM, not the signed-in person',
       post && post.body.fields.ProjectManagerLookupId === '15', post && JSON.stringify(post.body.fields));
  }

  // ---------- 3c. no people loaded yet: fall back to the signed-in person ----------
  w.S.people = [];
  w.addJob();
  const pm2 = w.document.getElementById('ncPm');
  ok('with no people loaded, the picker says it will use you', pm2 && pm2.options.length === 1 && pm2.value === ''
     && /you|signed/i.test(pm2.options[0].textContent), pm2 && pm2.options[0] && pm2.options[0].textContent);
  w.document.getElementById('ncJobNo').value = 'TEST-9502';
  w.document.getElementById('ncName').value = 'Fallback Test';
  w.confirmNewPoolRequest();
  const pc2 = w.S.pendingCreates.find(c => c.jobno === 'TEST-9502');
  net.posts.length = 0;
  await w.pushCreates(G.siteId, 't', [pc2]);
  const post2 = net.posts.find(p => p.url.includes('/lists/' + w.D2_GRAPH.lists.req));
  ok('and Save then uses the signed-in person', post2 && post2.body.fields.ProjectManagerLookupId === '16',
     post2 && JSON.stringify(post2.body.fields));

  // One Save carrying both kinds: a request with a picked PM and one without.
  // This is the case where the signed-in person IS looked up, so it is the one
  // that shows whether the picked PM still wins over it.
  {
    const picked = Object.assign({}, w.S.pendingCreates.find(c => c.jobno === 'TEST-9501'), { jobno: 'TEST-9503' });
    const blank = Object.assign({}, pc2, { jobno: 'TEST-9504' });
    net.posts.length = 0;
    await w.pushCreates(G.siteId, 't', [picked, blank]);
    const byNo = n => (net.posts.find(p => p.body.fields.JobNumber === n) || { body: { fields: {} } }).body.fields.ProjectManagerLookupId;
    ok('in one Save, a picked PM and a blank one each land correctly', byNo('TEST-9503') === '15' && byNo('TEST-9504') === '16',
       'picked=' + byNo('TEST-9503') + ' blank=' + byNo('TEST-9504'));
  }

  ok('no jsdom errors at the end', errs.length === 0, errs.join(' | '));

  // ---------- hostile names stay text ----------
  // A PM's display name and a pool name are both typed by people. Both now land
  // in new places: option lists, the PM column, the crew summary's tooltip.
  {
    // Starts by closing <option> and <select>: inside a <select> the parser drops a
    // bare <svg>, so a probe without the break-out passes even when unescaped.
    const PROBE = '</option></select><svg id="xss-probe"></svg>';
    const hostileUIL = UIL.map(u => u.id === '15' ? { id: '15', fields: Object.assign({}, u.fields, { Title: 'Emon ' + PROBE }) } : u);
    const b = boot();
    b.w.fetch = (orig => (u, o) => String(u).includes('User Information List')
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ value: hostileUIL }) })
      : orig(u, o))(b.w.fetch);
    await sleep(400);
    b.w.document.getElementById('d2Btn').click();
    await sleep(600);
    job(b.w, 'D2-1042').name = 'Reyes ' + PROBE;
    const seen = [];
    for (const t of ['jobs', 'signoff']) { tab(b.w, t); if (b.w.document.getElementById('xss-probe')) seen.push(t); }
    b.w.addJob(); if (b.w.document.getElementById('xss-probe')) seen.push('+ Job picker');
    ok('a PM or pool name carrying markup renders as text in every new place', seen.length === 0, seen.join(', ') || 'none');
    ok('and the probe name really did load (the check is not vacuous)', (job(b.w, 'D2-1043') || {}).pm === 'Emon ' + PROBE);
  }
  process.exit(fail);
})();
