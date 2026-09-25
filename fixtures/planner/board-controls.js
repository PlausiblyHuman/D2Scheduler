/* Batch 1 of the 24 September status-meeting build, in the real page:
 *
 *  1a. The Job Board keeps its VERTICAL scroll across a re-render. render() runs
 *      on every sign-off tick and rebuilt the board, and only scrollLeft was
 *      remembered, so ticking a box far down the board landed the PM at the top.
 *  1b. Skill labels on the Crews tab are chips. They were <span class="skill">
 *      with no chip class, so they ran into one block of text.
 *  1c. A project whose New Pool Request is still Requested or Building is
 *      marked, badged, and closed to edits. The planner fetched that list on
 *      every Refresh and ignored it; the first live pool was edited mid-build.
 *  1d. An Active project can be put back to Planned from the Jobs tab, with the
 *      same compare-before-write Activate uses.
 *  WP3-A. A project picker on the Board, and an "Open schedule" link on each
 *      Jobs row that lands on the Board filtered to that project.
 *  WP4. Live / Planned / Both on the Board and Crew Board, and a Day / Week /
 *      Month zoom that changes cell width, not layout.
 *  WP2. Start is editable on the Jobs tab for every project; changing it reflows
 *      the whole project from the first row, and Save writes Jobs.StartDate
 *      back with a per-field compare against the loaded value.
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

const UIL = [
  { id: '3', Title: 'D2 Build Scheduler Owners', Name: 'D2 Build Scheduler Owners' },
  { id: '7', Title: 'D2 Bot', Name: 'i:0#.f|membership|stratirus@d2pools.com', EMail: 'd2bot@d2pools.com' },
  { id: '14', Title: 'Cody Campbell', Name: 'i:0#.f|membership|cody@d2pools.com', EMail: 'cody@d2pools.com' },
  { id: '15', Title: 'Emon Alexander', Name: 'i:0#.f|membership|emon@d2pools.com', EMail: 'emon@d2pools.com' },
  { id: '16', Title: 'Don Borgeson', Name: 'i:0#.f|membership|don@d2pools.com', EMail: 'don@d2pools.com' }
].map(f => ({ id: f.id, fields: f }));

// A New Pool Requests row in the Graph shape (Title is the pool NAME, JobNumber
// the job number, Status flow-owned). Case and whitespace on JobNumber are
// deliberately sloppy: SharePoint's own filter is case-insensitive.
const reqRow = (id, jobno, status) => ({ id: String(id), fields: { id: String(id), Title: 'Pool ' + id, JobNumber: jobno, Status: status } });

const MSAL_STUB = `<script>
window.__msal={cfg:null,accounts:[],active:{username:'cody@d2pools.com',name:'Cody Campbell'}};
window.msal={PublicClientApplication:class{
  constructor(cfg){window.__msal.cfg=cfg;}
  getActiveAccount(){return window.__msal.active;}
  setActiveAccount(a){window.__msal.active=a;}
  getAllAccounts(){return window.__msal.accounts;}
  acquireTokenSilent(){return Promise.resolve({accessToken:'t'});}
  loginPopup(){return Promise.resolve({accessToken:'t',account:window.__msal.active});}
}};
</script>`;

function boot(state) {
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL_STUB)
    .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
    .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
    .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
    .replace('</body>', `<script>window.__x=()=>{window.S=S;window.getUI=()=>UI;window.getTAB=()=>TAB;window.D2_GRAPH=D2_GRAPH;
       window.render=render;window.crew=crew;window.allSecs=allSecs;window.divergedSecs=divergedSecs;
       window.buildChangeSet=buildChangeSet;window.editSec=editSec;window.nextWork=nextWork;window.touch=touch;
       window.openSavePreview=openSavePreview;window.confirmSaveByPush=confirmSaveByPush;
       window.activatePool=activatePool;window.closeDrawer=closeDrawer;
       window.buildJobStartChanges=typeof buildJobStartChanges==='function'?buildJobStartChanges:null;};</script><script>__x();</script></body>`);
  const errs = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const net = { posts: [], patches: [] };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, opts) => {
        u = String(u);
        const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status,
          json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
        if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
        if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: G.siteId, webUrl: G.site });
        if (u.includes('User Information List')) return json(200, { value: UIL });
        if (opts && opts.method === 'POST') { net.posts.push({ url: u, body: JSON.parse(opts.body) }); return json(201, {}); }
        if (opts && opts.method === 'PATCH') { net.patches.push({ url: u, body: JSON.parse(opts.body) }); return json(200, {}); }
        const L = w.D2_GRAPH && w.D2_GRAPH.lists;
        if (L) {
          if (u.includes('/lists/' + L.jobs + '/items')) return json(200, { value: state.jobsOverride || G.jobs });
          if (u.includes('/lists/' + L.req + '/items')) return json(200, { value: state.req });
          for (const k of ['asg', 'tasks', 'cal']) if (u.includes('/lists/' + L[k] + '/items')) return json(200, { value: G[k] });
        }
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
const refresh = async w => { w.document.getElementById('d2Btn').click(); await sleep(600); };
// The Jobs table row for one job. Job numbers live in <input> boxes there.
const rowFor = (w, jobno) => [...main(w).querySelectorAll('tbody tr')]
  .find(tr => { const i = tr.querySelector('td input'); return i && i.value === jobno; });
const jobRows = w => [...main(w).querySelectorAll('tr.jobrow')];
const btnIn = (el, re) => [...el.querySelectorAll('button, a')].find(b => re.test(b.textContent));
const drawer = w => w.document.getElementById('drawer');
const dBody = w => w.document.getElementById('dBody');
const dFoot = w => w.document.getElementById('dFoot');

(async () => {
  // ---------- 1c, mapper half: a request still building marks its job ----------
  {
    const M = require(path.join(WEB, 'graph-to-planner.js'));
    const req = [reqRow(9, ' d2-1043 ', 'Building'), reqRow(10, 'D2-1042', 'Done'), reqRow(11, 'D2-1044', 'Requested')];
    const p = M.toPlannerPayload(Object.assign({}, G, { users: UIL, req }));
    const by = n => p.jobs.find(j => j.jobno === n) || {};
    ok('a job whose request is still Building is marked building', by('D2-1043').building === true, String(by('D2-1043').building));
    ok('a job whose request is still Requested is marked building too', by('D2-1044').building === true, String(by('D2-1044').building));
    ok('a job whose request is Done is not', by('D2-1042').building === false, String(by('D2-1042').building));
    ok('the job-number match ignores case and whitespace (SharePoint\'s own filter does)', by('D2-1043').building === true);
    const bare = M.toPlannerPayload(G);
    ok('with no request list at all nothing throws and nothing is building', bare.jobs.every(j => j.building === false));
  }

  const state = { req: [], jobsOverride: null };
  const { w, errs, net } = boot(state);
  await sleep(400);
  ok('boots with no jsdom errors', errs.length === 0, errs.join(' | '));
  await refresh(w);
  ok('Refresh loaded the live pools', w.S.jobs.length === G.jobs.length, 'jobs=' + w.S.jobs.length);
  const L = w.D2_GRAPH.lists;

  // ---------- 1b. Crews tab: skill labels are chips ----------
  tab(w, 'crews');
  const skills = [...main(w).querySelectorAll('span.skill')];
  ok('every skill label on the Crews tab is a chip, so the labels do not run together',
     skills.length > 0 && skills.every(s => s.classList.contains('chip')),
     skills.length + ' labels, ' + skills.filter(s => !s.classList.contains('chip')).length + ' without chip');

  // ---------- 1a. Board keeps vertical scroll across a re-render ----------
  tab(w, 'board');
  {
    const tl = main(w).querySelector('.tl');
    tl.scrollTop = 120; tl.scrollLeft = 300;
    tl.dispatchEvent(new w.Event('scroll'));
    w.render();
    const tl2 = main(w).querySelector('.tl');
    ok('a re-render keeps the horizontal scroll', tl2.scrollLeft === 300, 'left=' + tl2.scrollLeft);
    ok('a re-render keeps the VERTICAL scroll (a sign-off tick no longer jumps to the top)', tl2.scrollTop === 120, 'top=' + tl2.scrollTop);
  }

  // ---------- WP3-A. Project picker on the Board, link from the Jobs tab ----------
  {
    const sel = w.document.getElementById('boardJob');
    ok('the Board has a project picker', !!sel);
    if (sel) {
      ok('it offers All plus every project', sel.options.length === G.jobs.length + 1, String(sel.options.length));
      sel.value = job(w, 'D2-1044').id; sel.dispatchEvent(new w.Event('change'));
      ok('picking a project shows only that project', jobRows(w).length === 1 && /D2-1044/.test(jobRows(w)[0].textContent), 'rows=' + jobRows(w).length);
      w.getUI().boardJob = 'no-such-job'; w.render();
      ok('a project that is no longer here falls back to all', jobRows(w).length === G.jobs.length, 'rows=' + jobRows(w).length);
    }
    tab(w, 'jobs');
    const link = rowFor(w, 'D2-1044') && rowFor(w, 'D2-1044').querySelector('[data-open-schedule]');
    ok('each Jobs row has an Open schedule link', !!link);
    if (link) {
      link.click();
      ok('Open schedule lands on the Board', w.getTAB() === 'board', w.getTAB());
      ok('filtered to that project', jobRows(w).length === 1 && /D2-1044/.test(jobRows(w)[0].textContent), 'rows=' + jobRows(w).length);
      await refresh(w);
      ok('the project filter survives a Refresh', jobRows(w).length === 1 && /D2-1044/.test((jobRows(w)[0] || {}).textContent || ''), 'rows=' + jobRows(w).length);
    }
    w.getUI().boardJob = ''; w.render();
  }

  // ---------- WP4. Live / Planned / Both, on the Board and the Crew Board ----------
  {
    const planned = job(w, 'D2-1044'), others = w.S.jobs.filter(j => j !== planned);
    planned.status = 'Planned'; w.render();
    const sel = w.document.getElementById('boardStatus');
    ok('the Board has a Live / Planned / Both control', !!sel);
    const set = v => { const s = w.document.getElementById('boardStatus'); s.value = v; s.dispatchEvent(new w.Event('change')); };
    if (sel) {
      const check = () => [...main(w).querySelectorAll('.card h2')].map(h => h.textContent).find(t => /Schedule Check/.test(t)) || '';
      const bothCheck = check();
      set('planned');
      ok('Planned shows only the Planned project', jobRows(w).length === 1 && /D2-1044/.test(jobRows(w)[0].textContent), 'rows=' + jobRows(w).length);
      ok('Schedule Check still covers every project under a filter', check() === bothCheck, check() + ' vs ' + bothCheck);
      set('live');
      ok('Live shows the other two', jobRows(w).length === 2 && !jobRows(w).some(r => /D2-1044/.test(r.textContent)), 'rows=' + jobRows(w).length);
      set('both');
      ok('Both shows all three', jobRows(w).length === 3, 'rows=' + jobRows(w).length);
      set('planned');
      tab(w, 'crewboard');
      const t = main(w).textContent;
      ok('the Crew Board honours the same filter', t.includes(planned.name) && others.every(j => !t.includes(j.name)),
         others.map(j => j.name + ':' + t.includes(j.name)).join(' '));
      tab(w, 'board'); set('both');
    }
    planned.status = 'Active'; w.render();
  }

  // ---------- WP4. Zoom ----------
  {
    const z = w.document.getElementById('boardZoom');
    ok('the Board has a Day / Week / Month zoom', !!z);
    if (z) {
      ok('the header carries a months row at every zoom', !!main(w).querySelector('th.mo'));
      z.value = 'week'; z.dispatchEvent(new w.Event('change'));
      let tl = main(w).querySelector('.tl');
      ok('Week zoom narrows the day cells rather than re-laying out', tl.classList.contains('zoom-week') && tl.style.getPropertyValue('--day') === '10px',
         tl.className + ' --day=' + tl.style.getPropertyValue('--day'));
      ok('the zoom is remembered per browser', w.S.settings.zoom === 'week', String(w.S.settings.zoom));
      w.render(); tl = main(w).querySelector('.tl');
      ok('a re-render keeps the zoom', tl.classList.contains('zoom-week'));
      tab(w, 'crewboard');
      ok('the Crew Board shares the zoom', main(w).querySelector('.tl').classList.contains('zoom-week'));
      tab(w, 'board');
      const z2 = w.document.getElementById('boardZoom'); z2.value = 'day'; z2.dispatchEvent(new w.Event('change'));
      tl = main(w).querySelector('.tl');
      ok('Day zoom restores the full width', !tl.classList.contains('zoom-week') && tl.style.getPropertyValue('--day') === '26px', tl.style.getPropertyValue('--day'));
    }
  }

  // ---------- 1c. Building guard, in the page ----------
  {
    state.req = [reqRow(9, 'D2-1043', 'Building')];
    await refresh(w);
    const b = job(w, 'D2-1043');
    ok('Refresh marks the project whose request is still building', b.building === true, String(b.building));
    tab(w, 'jobs');
    const row = rowFor(w, 'D2-1043');
    ok('the Jobs tab says Building for it', row && /Building/.test(row.textContent));
    b.status = 'Planned'; job(w, 'D2-1042').status = 'Planned'; w.render();
    ok('Activate is withheld while it builds', !btnIn(rowFor(w, 'D2-1043'), /Activate/));
    ok('but still offered on a Planned project that is not building', !!btnIn(rowFor(w, 'D2-1042'), /Activate/));
    b.status = 'Active'; job(w, 'D2-1042').status = 'Active'; w.render();
    tab(w, 'board');
    const jr = jobRows(w).find(r => /D2-1043/.test(r.textContent));
    ok('the Board badges it', jr && /Building/.test(jr.textContent));
    w.closeDrawer(); w.activatePool(b.id);
    ok('activatePool() itself refuses a building project, not only the button',
       !drawer(w).classList.contains('open') || !/^Activate/.test(w.document.getElementById('dTitle').textContent));
    w.closeDrawer();
    const x = w.allSecs(b).find(o => o.s.base && !o.s.locked && !o.s.skip);
    const wasDays = x.s.days; x.s.days = wasDays + 3; w.touch(b);
    ok('a local edit on a building project is not offered to Save', w.divergedSecs(b).length === 0 && !w.buildChangeSet().some(p => p.jobno === 'D2-1043'),
       'diverged=' + w.divergedSecs(b).length);
    w.editSec(b.id, x.gi, x.si);
    ok('the drawer says it is still being built', /still being built/i.test(dBody(w).textContent));
    ok('and offers no Save', !btnIn(dFoot(w), /^Save/));
    x.s.days = wasDays; b.touchedAt = null;
    state.req = [];
    await refresh(w);
    ok('once the request is Done the mark clears on the next Refresh', job(w, 'D2-1043').building === false, String(job(w, 'D2-1043').building));
  }

  // ---------- 1d. Back to planning ----------
  {
    tab(w, 'jobs');
    const j = job(w, 'D2-1042');
    const btn = btnIn(rowFor(w, 'D2-1042'), /back to planning/i);
    ok('an Active project offers Back to planning', !!btn);
    if (btn) {
      btn.click();
      ok('it opens a dialog that says what changes', drawer(w).classList.contains('open') && /Planned/.test(dBody(w).textContent) && /calendar/i.test(dBody(w).textContent));
      const go = btnIn(dFoot(w), /back to planning|to planned/i);
      ok('with a confirm button', !!go);
      const before = net.patches.length;
      if (go) { go.click(); await sleep(400); }
      const p = net.patches.slice(before).find(x => x.url.includes('/lists/' + L.jobs + '/items/') && x.url.endsWith('/fields'));
      const liveRow = G.jobs.find(r => r.fields.JobNumber === 'D2-1042');
      ok('it PATCHes Status Planned to that Jobs row', p && p.body.Status === 'Planned' && p.url.includes('/items/' + liveRow.fields.id + '/'),
         p ? p.url + ' ' + JSON.stringify(p.body) : 'no PATCH');
      ok('and nothing else in the body', p && Object.keys(p.body).length === 1);
    }
    // Refused when the live row is no longer Active: someone else got there first.
    state.jobsOverride = G.jobs.map(r => r.fields.JobNumber === 'D2-1042'
      ? Object.assign({}, r, { fields: Object.assign({}, r.fields, { Status: 'Planned' }) }) : r);
    j.status = 'Active'; w.render(); tab(w, 'jobs');
    const btn2 = btnIn(rowFor(w, 'D2-1042'), /back to planning/i);
    if (btn2) {
      btn2.click();
      const go = btnIn(dFoot(w), /back to planning|to planned/i);
      const before = net.patches.length;
      if (go) { go.click(); await sleep(400); }
      ok('when the live row already reads Planned nothing is written', net.patches.length === before, 'new patches=' + (net.patches.length - before));
      ok('and the dialog says so', /already Planned/i.test(dBody(w).textContent), dBody(w).textContent.slice(0, 120));
    }
    state.jobsOverride = null;
    await refresh(w);
  }

  // ---------- WP2. Reset from a new start date, and Jobs.StartDate on Save ----------
  {
    tab(w, 'jobs');
    const j = job(w, 'D2-1042');
    const loadedStart = j.start;
    const inp = rowFor(w, 'D2-1042') && rowFor(w, 'D2-1042').querySelector('input[type=date][data-reset]');
    ok('Start is editable on a project that already has scheduled work', !!inp);
    if (inp) {
      // Pin one unlocked row so the reflow has something it must leave alone.
      const rows = w.allSecs(j).filter(o => o.s.base && !o.s.skip && o.s.start);
      const pin = rows.find(o => !o.s.locked && !o.s.inst && rows.indexOf(o) > 3);
      pin.s.locked = true; const pinnedStart = pin.s.start;
      const first = rows.find(o => !o.s.locked && !o.s.inst);
      inp.value = '2026-12-01'; inp.dispatchEvent(new w.Event('change'));
      ok('changing it asks before reflowing', drawer(w).classList.contains('open') && /reflow/i.test(dBody(w).textContent) && /locked/i.test(dBody(w).textContent));
      const go = btnIn(dFoot(w), /reflow/i);
      ok('with a confirm button', !!go);
      if (go) go.click();
      ok('the first unlocked row lands on the first working day on or after the new start', first.s.start === w.nextWork('2026-12-01'), first.s.start);
      ok('a locked row did not move', pin.s.start === pinnedStart, pin.s.start + ' vs ' + pinnedStart);
      ok('the project start is the new date and it is marked edited', j.start === '2026-12-01' && !!j.touchedAt);
      const jc = w.buildJobStartChanges ? w.buildJobStartChanges() : null;
      ok('the change-set carries the start date change with the loaded value beside it',
         jc && jc.length === 1 && jc[0].jobno === 'D2-1042' && jc[0].from === loadedStart && jc[0].to === '2026-12-01',
         JSON.stringify(jc));
      w.openSavePreview();
      const pv = dBody(w).innerHTML;
      // Its own section, with the loaded value beside the new one. The moved
      // sub-phases also list "Start date" rows, so the section label and the
      // FROM value are what prove the project start is there.
      ok('the Save preview has a project start section naming both values',
         /Project start dates/.test(pv) && /9\/14\/26/.test(pv) && /12\/1\/26/.test(pv), pv.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,160));
      const before = net.patches.length;
      await w.confirmSaveByPush();
      const jp = net.patches.slice(before).find(x => x.url.includes('/lists/' + L.jobs + '/items/'));
      const liveRow = G.jobs.find(r => r.fields.JobNumber === 'D2-1042');
      ok('Save PATCHes Jobs.StartDate as a bare date', jp && jp.body.StartDate === '2026-12-01' && jp.url.includes('/items/' + liveRow.fields.id + '/'),
         jp ? JSON.stringify(jp.body) : 'no Jobs PATCH');
      ok('with no suppression stamp, since Jobs has no such column', jp && !('SuppressReconcileUntil' in jp.body));
      ok('the moved sub-phases went out too', net.patches.slice(before).some(x => x.url.includes('/lists/' + L.asg + '/items/') && x.body.ScheduledStart));
    }
    // Refused when SharePoint's StartDate moved since the load.
    state.jobsOverride = G.jobs.map(r => r.fields.JobNumber === 'D2-1042'
      ? Object.assign({}, r, { fields: Object.assign({}, r.fields, { StartDate: '2026-10-19T05:00:00Z' }) }) : r);
    tab(w, 'jobs');
    const j2 = job(w, 'D2-1042');
    const inp2 = rowFor(w, 'D2-1042') && rowFor(w, 'D2-1042').querySelector('input[type=date][data-reset]');
    if (inp2) {
      inp2.value = '2026-12-08'; inp2.dispatchEvent(new w.Event('change'));
      const go = btnIn(dFoot(w), /reflow/i); if (go) go.click();
      w.openSavePreview();
      const before = net.patches.length;
      await w.confirmSaveByPush();
      const jp = net.patches.slice(before).find(x => x.url.includes('/lists/' + L.jobs + '/items/'));
      ok('a start date changed in SharePoint since the load is refused, not overwritten', !jp, jp ? JSON.stringify(jp.body) : '');
      ok('and the refusal is named with both values', /start/i.test(dBody(w).textContent) && /10\/19|2026-10-19/.test(dBody(w).textContent), dBody(w).textContent.slice(0, 200));
      void j2;
    }
    state.jobsOverride = null;
  }

  ok('no jsdom errors during the run', errs.length === 0, errs.join(' | '));
  process.exit(fail);
})().catch(e => { console.log('FAIL · harness threw: ' + (e && e.stack || e)); process.exit(1); });
