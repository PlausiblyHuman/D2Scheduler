/* WP3-B: edit in place on the Job Board. Every editable sub-phase row carries a
 * crew dropdown, a days input and a start date input, always visible, so a
 * simple change no longer needs the drawer. In the real page with MSAL and
 * fetch stubbed.
 *
 * The rules pinned here, each watched red under mutate.py:
 *   - a change to days or start reflows THAT project from THAT row, the same
 *     walk as the drawer's Save + reflow, so the rows below stay in step;
 *     locked and signed-off rows stay put; a crew change reflows nothing
 *   - locked, signed-off, N/A and still-building rows show text, not controls
 *   - the controls live outside the name, so they neither open the drawer nor
 *     swallow the sign-off boxes beside them
 *   - the crew dropdown keeps the drawer's Qualified / Not qualified split and
 *     escapes crew names
 *   - an inline edit marks the project edited and counts on Save
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
const reqRow = (id, jobno, status) => ({ id: String(id), fields: { id: String(id), Title: 'Pool ' + id, JobNumber: jobno, Status: status } });

const MSAL_STUB = `<script>
window.__msal={active:{username:'cody@d2pools.com',name:'Cody Campbell'},accounts:[]};
window.msal={PublicClientApplication:class{constructor(){}getActiveAccount(){return window.__msal.active;}setActiveAccount(a){window.__msal.active=a;}
  getAllAccounts(){return window.__msal.accounts;}acquireTokenSilent(){return Promise.resolve({accessToken:'t'});}loginPopup(){return Promise.resolve({accessToken:'t',account:window.__msal.active});}}};
</script>`;

function boot(state) {
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL_STUB)
    .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
    .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
    .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
    .replace('</body>', `<script>window.__x=()=>{window.S=S;window.getUI=()=>UI;window.D2_GRAPH=D2_GRAPH;window.render=render;window.crew=crew;window.allSecs=allSecs;
       window.divergedSecs=divergedSecs;window.nextWork=nextWork;window.workSpan=workSpan;window.qualified=qualified;
       window.openSavePreview=openSavePreview;window.confirmSaveByPush=confirmSaveByPush;};</script><script>__x();</script></body>`);
  const errs = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, opts) => {
        u = String(u);
        const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
        if (opts && opts.method === 'PATCH') { state.patches.push({ url: u, body: JSON.parse(opts.body) }); return json(200, {}); }
        if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
        if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: G.siteId, webUrl: G.site });
        if (u.includes('User Information List')) return json(200, { value: [] });
        const L = w.D2_GRAPH && w.D2_GRAPH.lists;
        if (L) {
          if (u.includes('/lists/' + L.req + '/items')) return json(200, { value: state.req });
          for (const k of ['jobs', 'asg', 'tasks', 'cal']) if (u.includes('/lists/' + L[k] + '/items')) return json(200, { value: G[k] });
        }
        if (/\/lists\/[^/]+\/items/.test(u)) return json(200, { value: [] });
        return json(404, {});
      };
    }
  });
  const w = dom.window; w.alert = () => {}; w.confirm = () => true;
  return { w, errs };
}
const tab = (w, t) => w.document.querySelector(`#tabs button[data-t="${t}"]`).click();
const main = w => w.document.getElementById('main');
const job = (w, jobno) => w.S.jobs.find(j => j.jobno === jobno);
const change = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
// The Board row for a section: the <tr> whose name span carries the sub-phase number in bold.
const rowFor = (w, j, s) => [...main(w).querySelectorAll('#main tbody tr')].find(tr => {
  const t = tr.querySelector('.t.sec'); return t && t.getAttribute('onclick') && t.getAttribute('onclick').includes(`'${j.id}'`) && t.querySelector('b') && t.querySelector('b').textContent === s.num; });
const ctl = (tr, kind) => tr && tr.querySelector(`[data-ic="${kind}"]`);

(async () => {
  const state = { req: [], patches: [] };
  const { w, errs } = boot(state);
  await sleep(400);
  w.document.getElementById('d2Btn').click(); await sleep(600);
  ok('boots and loads the live pools', errs.length === 0 && w.S.jobs.length === G.jobs.length, errs.join(' | ') || 'jobs=' + w.S.jobs.length);
  tab(w, 'board');
  const j = job(w, 'D2-1042');
  const rows = w.allSecs(j).filter(o => o.s.base && !o.s.skip && o.s.start);
  const editable = rows.filter(o => !o.s.locked && !o.s.inst);
  // Rows whose IMMEDIATE successor in the pool is also editable, so "the next
  // row follows on" is not at the mercy of a locked row sitting in between.
  const adjacent = rows.filter((o, i) => !o.s.locked && !o.s.inst && rows[i + 1] && !rows[i + 1].s.locked && !rows[i + 1].s.inst);
  const a = adjacent[0], b = adjacent[1], c = editable[editable.length - 1];
  const lockedRow = rows.find(o => o.s.locked || o.s.inst);

  // ---------- presence ----------
  {
    const tr = rowFor(w, j, a.s);
    ok('an editable sub-phase row carries crew, days and start controls', !!ctl(tr, 'crew') && !!ctl(tr, 'days') && !!ctl(tr, 'start'));
    ok('the controls sit outside the clickable name', tr && !tr.querySelector('.t.sec [data-ic]'));
    ok('the days control shows the row\'s duration', ctl(tr, 'days') && +ctl(tr, 'days').value === a.s.days, ctl(tr, 'days') && ctl(tr, 'days').value);
    ok('the start control shows the row\'s start', ctl(tr, 'start') && ctl(tr, 'start').value === a.s.start, ctl(tr, 'start') && ctl(tr, 'start').value);
    ok('the crew control shows the row\'s crew', ctl(tr, 'crew') && ctl(tr, 'crew').value === (a.s.crewId || ''), ctl(tr, 'crew') && ctl(tr, 'crew').value);
    ok('the finish date still shows beside the controls', tr && /→/.test(tr.querySelector('.dt').textContent));
    const jobRow = [...main(w).querySelectorAll('tr.jobrow')].find(r => r.textContent.includes('D2-1042'));
    const phRow = main(w).querySelector('tr.phrow');
    ok('job and phase rows carry no controls', jobRow && !jobRow.querySelector('[data-ic]') && phRow && !phRow.querySelector('[data-ic]'));
    ok('a locked or signed-off row shows text, not controls', lockedRow && !ctl(rowFor(w, j, lockedRow.s), 'crew') && /→/.test(rowFor(w, j, lockedRow.s).querySelector('.dt').textContent));
    const skipRow = w.allSecs(j).find(o => o.s.skip);
    if (skipRow) ok('an N/A row shows text, not controls', !ctl(rowFor(w, j, skipRow.s), 'crew'));
  }

  // ---------- crew dropdown: same split as the drawer, escaped ----------
  {
    const tr = rowFor(w, j, a.s); const sel = ctl(tr, 'crew');
    const groups = [...sel.querySelectorAll('optgroup')].map(g => g.label);
    ok('the crew dropdown has the Qualified group first', groups.length >= 1 && /Qualified/.test(groups[0]) && !/Not/.test(groups[0]), groups.join(' | '));
    ok('and a Not qualified group', groups.some(g => /Not qualified/.test(g)), groups.join(' | '));
    ok('it offers Unassigned', [...sel.options].some(o => o.value === '' && /Unassigned/i.test(o.textContent)));
    const q = w.qualified(a.s.skill).map(x => x.id).sort().join(',');
    const inQ = [...sel.querySelector('optgroup').querySelectorAll('option')].map(o => o.value).sort().join(',');
    ok('the Qualified group holds exactly the crews qualified() names', q === inQ, q + ' vs ' + inQ);
    const probeCrew = w.S.crews[0]; const was = probeCrew.name; probeCrew.name = '</option></select><svg id="xss-probe">';
    w.render();
    ok('a hostile crew name is escaped in the dropdown', !main(w).querySelector('#xss-probe') && [...ctl(rowFor(w, j, a.s), 'crew').options].some(o => o.textContent.includes('<svg')));
    probeCrew.name = was; w.render();
  }

  // ---------- crew change: recorded, edited, no reflow ----------
  {
    const tr = rowFor(w, j, a.s); const sel = ctl(tr, 'crew');
    const other = [...sel.options].map(o => o.value).find(v => v && v !== a.s.crewId);
    const startsBefore = editable.map(o => o.s.start).join(',');
    j.touchedAt = null;
    change(w, sel, other);
    ok('changing the crew records it on the row', a.s.crewId === other, a.s.crewId);
    ok('and marks the project edited', !!j.touchedAt);
    ok('a crew change reflows nothing', editable.map(o => o.s.start).join(',') === startsBefore);
    ok('it counts on Save', w.divergedSecs(j).length >= 1 && w.document.getElementById('saveBtn').disabled === false);
    ok('and does not open the drawer', !w.document.getElementById('drawer').classList.contains('open'));
    change(w, ctl(rowFor(w, j, a.s), 'crew'), a.s.base.crewId || '');
  }

  // ---------- days change: reflows from this row, locked rows stay ----------
  {
    const tr = rowFor(w, j, b.s);
    const bStart = b.s.start, cStartBefore = c.s.start, lockedStart = lockedRow && lockedRow.s.start;
    const later = [rows[rows.indexOf(b) + 1]];
    change(w, ctl(tr, 'days'), String(b.s.days + 4));
    ok('changing days records it', b.s.days === b.s.base.days + 4, String(b.s.days));
    ok('the row itself keeps its start', b.s.start === bStart, b.s.start);
    const expectNext = w.nextWork(w.workSpan(b.s.start, b.s.days).pop() && addDaysStr(w, w.workSpan(b.s.start, b.s.days).pop(), 1));
    const next = later[0];
    ok('the next unlocked row now starts the first working day after the longer span', next && next.s.start === expectNext, (next && next.s.start) + ' vs ' + expectNext);
    if (lockedRow) ok('a locked row did not move', lockedRow.s.start === lockedStart, lockedRow.s.start);
    ok('the Board re-rendered with the new value', +ctl(rowFor(w, j, b.s), 'days').value === b.s.days);
    void cStartBefore;
    change(w, ctl(rowFor(w, j, b.s), 'days'), String(b.s.base.days));
  }

  // ---------- start change: lands on a working day and the rest follow ----------
  {
    const tr = rowFor(w, j, a.s);
    const later = [rows[rows.indexOf(a) + 1]];
    change(w, ctl(tr, 'start'), '2026-11-29');   // a Sunday
    ok('a start on a Sunday lands on the next working day', a.s.start === w.nextWork('2026-11-29') && a.s.start !== '2026-11-29', a.s.start);
    const expectNext = w.nextWork(addDaysStr(w, w.workSpan(a.s.start, a.s.days).pop(), 1));
    ok('the following rows follow on', later[0] && later[0].s.start === expectNext, (later[0] && later[0].s.start) + ' vs ' + expectNext);
    ok('a days input below one is not accepted', (() => { change(w, ctl(rowFor(w, j, a.s), 'days'), '0'); return a.s.days >= 1; })(), String(a.s.days));
  }

  // ---------- the sign-off boxes beside the controls still work ----------
  {
    const tr = rowFor(w, j, c.s); const inst = tr.querySelector('.sg input[type=checkbox]');
    const was = c.s.inst;
    inst.click();
    ok('ticking INST beside the controls still ticks the row', c.s.inst === !was);
    if (c.s.inst !== was) { const tr2 = rowFor(w, j, c.s); const inst2 = tr2.querySelector('.sg input[type=checkbox]'); inst2.click(); }
    ok('a signed-off row loses its controls', (() => { c.s.inst = true; c.s.locked = true; w.render(); const r = rowFor(w, j, c.s); const gone = !ctl(r, 'crew'); c.s.inst = was; c.s.locked = !!(c.s.spLocked || was); w.render(); return gone; })());
  }

  // ---------- a days change that moves nothing below it is still an edit ----------
  {
    // The last editable row: nothing after it can move, so the reflow alone
    // would not mark the project edited. The edit itself must.
    const last = editable[editable.length - 1]; const tr = rowFor(w, j, last.s);
    j.touchedAt = null;
    change(w, ctl(tr, 'days'), String(last.s.base.days + 1));
    ok('a days change on the last row marks the project edited even though nothing below it moved', !!j.touchedAt && last.s.days === last.s.base.days + 1);
    change(w, ctl(rowFor(w, j, last.s), 'days'), String(last.s.base.days));
  }

  // ---------- Save sends the finish with every start or days change ----------
  {
    // The start change above moved a row and reflowed the rows after it, so
    // this Save carries real start writes. Every flow reads ScheduledFinish,
    // so a PATCH that moves a start or a duration without its finish leaves
    // the finish behind the start in SharePoint while the Board looks right.
    const asgId = w.D2_GRAPH.lists.asg;
    state.patches = [];
    w.openSavePreview(); await w.confirmSaveByPush(); await sleep(300);
    const moved = state.patches.filter(p => p.url.includes('/lists/' + asgId + '/items/') && ('ScheduledStart' in p.body || 'DurationDays' in p.body));
    ok('the Save carried start or duration writes to check', moved.length >= 2, 'moved=' + moved.length);
    const liveById = Object.fromEntries(G.asg.map(r => [String(r.fields.id), r.fields]));
    const wrong = moved.filter(p => {
      const id = p.url.split('/items/')[1].split('/')[0], lv = liveById[id];
      const st = p.body.ScheduledStart || String(lv.ScheduledStart).slice(0, 10);
      const dd = p.body.DurationDays != null ? p.body.DurationDays : lv.DurationDays;
      return p.body.ScheduledFinish !== w.workSpan(st, dd).pop();
    });
    ok('every one also sends the finish, on the work calendar, as a bare date', wrong.length === 0,
       wrong.slice(0, 3).map(p => JSON.stringify(p.body)).join(' | '));
    const crewOnly = state.patches.filter(p => p.url.includes('/lists/' + asgId + '/items/') && !('ScheduledStart' in p.body) && !('DurationDays' in p.body));
    ok('a write with no start or duration carries no finish', crewOnly.every(p => !('ScheduledFinish' in p.body)));
    const said = w.document.getElementById('dBody').textContent;
    ok('the Save results name the fields in words, not SharePoint column names',
       /Start date, Finish date/.test(said) && !/Scheduled(Start|Finish)|DurationDays/.test(said), said.slice(0, 200));
  }

  // ---------- a project still building shows text only ----------
  {
    state.req = [reqRow(9, 'D2-1043', 'Building')];
    w.document.getElementById('d2Btn').click(); await sleep(600);
    const bj = job(w, 'D2-1043');
    tab(w, 'board');
    const r0 = w.allSecs(bj).find(o => o.s.base && !o.s.locked && !o.s.skip && o.s.start);
    ok('a building project\'s rows carry no controls', bj.building === true && !ctl(rowFor(w, bj, r0.s), 'crew'));
    state.req = [];
  }

  ok('no jsdom errors during the run', errs.length === 0, errs.join(' | '));
  process.exit(fail);
})().catch(e => { console.log('FAIL · harness threw: ' + (e && e.stack || e)); process.exit(1); });

function addDaysStr(w, d, n) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
