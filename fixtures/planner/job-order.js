/* Projects list in job-number order by default (asked for by Don, 2026-10-01), with Start date as
 * an option on the Board and the Jobs tab. Job numbers sort by the numbers in them, in sequence, so
 * 24-999 comes before 24-1999 (text order would invert them) and stray spaces or '=' do not matter.
 *
 * Run: node fixtures/planner/job-order.js
 * The planner and graph-to-planner.js run for real; MSAL and fetch are stubbed.
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

// Fixture projects start 21: 06-15, 19: 08-10, 20: 09-08. Numbers are chosen so number order is
// the reverse of date order, plus two projects with no sub-phases dated by Jobs.StartDate only.
const RENUMBER = { '20': '24-1999', '19': '25=2029 White Heart', '21': '26- 2055' };
const extra = (id, jobno, start) => ({ id, fields: { id, Title: 'Project ' + jobno, JobNumber: jobno,
  Status: 'Planned', StartDate: start + 'T05:00:00Z' } });
const JOBS = G.jobs.map(j => ({ ...j, fields: { ...j.fields, JobNumber: RENUMBER[j.fields.id] } }))
  .concat([extra('90', '24-999', '2026-12-01'), extra('91', '25-2038 Becky', '2026-07-01')]);
const BY_NUMBER = ['24-999', '24-1999', '25=2029 White Heart', '25-2038 Becky', '26- 2055'];
const BY_START = ['26- 2055', '25-2038 Becky', '25=2029 White Heart', '24-1999', '24-999'];

const MSAL_STUB = `<script>
window.msal={PublicClientApplication:class{
  constructor(){} getActiveAccount(){return {username:'cody@d2pools.com',name:'Cody Campbell'};}
  setActiveAccount(){} getAllAccounts(){return [];}
  acquireTokenSilent(){return Promise.resolve({accessToken:'t'});}
  loginPopup(){return Promise.resolve({accessToken:'t',account:{username:'cody@d2pools.com'}});}
}};
</script>`;

function boot() {
  const inline = f => '<script>' + fs.readFileSync(path.join(WEB, f), 'utf8') + '</script>';
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    .replace('<script src="vendor/msal-browser.min.js"></script>', MSAL_STUB)
    .replace('<script src="graph-to-planner.js"></script>', inline('graph-to-planner.js'))
    .replace('<script src="writeback-core.js"></script>', inline('writeback-core.js'))
    .replace('<script src="graph-writeback.js"></script>', inline('graph-writeback.js'))
    .replace('</body>', `<script>window.__x=()=>{window.S=S;window.render=render;window.D2_GRAPH=D2_GRAPH;};</script><script>__x();</script></body>`);
  const errs = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: HOST + '/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u) => {
        u = String(u);
        const json = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status,
          json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
        if (u.endsWith('/.auth/me')) return json(200, { clientPrincipal: { identityProvider: 'aad', userDetails: 'cody@d2pools.com' } });
        if (u.startsWith('https://graph.microsoft.com/v1.0/sites/netorgft15040037.sharepoint.com:')) return json(200, { id: G.siteId, webUrl: G.site });
        const L = w.D2_GRAPH && w.D2_GRAPH.lists;
        if (L) {
          if (u.includes('/lists/' + L.jobs + '/items')) return json(200, { value: JOBS });
          for (const k of ['asg', 'tasks', 'cal']) if (u.includes('/lists/' + L[k] + '/items')) return json(200, { value: G[k] });
        }
        if (/\/lists\/[^/]+\/items/.test(u)) return json(200, { value: [] });
        return json(404, {});
      };
    }
  });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true;
  return { w, errs };
}
const tab = (w, t) => w.document.querySelector(`#tabs button[data-t="${t}"]`).click();
const main = w => w.document.getElementById('main');
const boardOrder = w => [...main(w).querySelectorAll('tr.jobrow .mono')].map(e => e.textContent.trim());
const jobsTabOrder = w => [...main(w).querySelectorAll('tbody tr')].map(tr => tr.querySelector('td input'))
  .filter(Boolean).map(i => i.value).filter(v => BY_NUMBER.includes(v));
const pickerOrder = (w, id) => [...w.document.querySelectorAll('#' + id + ' option')].map(o => o.value).filter(Boolean)
  .map(id => w.S.jobs.find(j => j.id === id).jobno);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const setSel = (w, id, v) => { const s = w.document.getElementById(id); s.value = v; s.dispatchEvent(new w.Event('change')); };

(async () => {
  const { w, errs } = boot();
  await sleep(300);
  w.document.getElementById('d2Btn').click(); await sleep(800);

  ok('state holds projects in job-number order after Refresh', same(w.S.jobs.map(j => j.jobno), BY_NUMBER), w.S.jobs.map(j => j.jobno).join(' | '));

  tab(w, 'board'); await sleep(50);
  ok('Board defaults to job-number order', same(boardOrder(w), BY_NUMBER), boardOrder(w).join(' | '));
  ok('Board project picker lists by job number', same(pickerOrder(w, 'boardJob'), BY_NUMBER));
  ok('Board offers the order choice', !!w.document.getElementById('jobSort'));

  tab(w, 'jobs'); await sleep(50);
  ok('Jobs tab defaults to job-number order', same(jobsTabOrder(w), BY_NUMBER), jobsTabOrder(w).join(' | '));

  tab(w, 'signoff'); await sleep(50);
  ok('Sign-Offs picker lists by job number', same(pickerOrder(w, 'soJob'), BY_NUMBER), pickerOrder(w, 'soJob').join(' | '));

  tab(w, 'board'); await sleep(50);
  setSel(w, 'jobSort', 'start'); await sleep(50);
  ok('Board can order by start date', same(boardOrder(w), BY_START), boardOrder(w).join(' | '));
  ok('the choice is remembered in settings', w.S.settings.jobSort === 'start');
  tab(w, 'jobs'); await sleep(50);
  ok('Jobs tab follows the same choice', same(jobsTabOrder(w), BY_START), jobsTabOrder(w).join(' | '));
  ok('Jobs tab offers the order choice', !!w.document.getElementById('jobSort'));
  tab(w, 'signoff'); await sleep(50);
  ok('Sign-Offs stays in job-number order whatever the Board shows', same(pickerOrder(w, 'soJob'), BY_NUMBER));

  w.document.getElementById('d2Btn').click(); await sleep(800);
  tab(w, 'board'); await sleep(50);
  ok('the choice survives a Refresh', same(boardOrder(w), BY_START));
  setSel(w, 'jobSort', 'number'); await sleep(50);
  ok('back to job-number order', same(boardOrder(w), BY_NUMBER));

  ok('no script errors', errs.length === 0, errs.join(' / '));
  process.exit(fail);
})().catch(e => { console.log('FAIL · harness threw: ' + (e && e.stack || e)); process.exit(1); });
