/* Capture real Microsoft Graph payloads into fixtures/planner/live-payloads-graph.json.
 *
 * WHY THIS EXISTS: the planner's read layer is moving off SharePoint REST and onto
 * Graph, because REST only works from a page served by the SharePoint origin -- it
 * does not serve CORS to arbitrary origins and the cookies do not travel. Graph is
 * CORS-enabled and takes a bearer token, so a hosted planner can call it.
 *
 * Graph is a THIRD field-shape surface, alongside raw SharePoint REST and the Power
 * Automate connector. The same column comes back differently from each. This project
 * has lost six separate cycles to assuming a shape instead of reading one, so the
 * rule is: capture a real payload FIRST, write the mapping against the captured
 * file, never the other way round. A REST fixture does not validate a Graph
 * expression any more than a REST probe validated a connector expression.
 *
 * This script captures. It maps nothing and asserts nothing about shapes.
 *
 * HOW TO RUN
 *   node fixtures/planner/capture-graph.js
 *   Open http://localhost:8787/ and click the button.
 *   Sign in as a user with access to the D2 Build Scheduler site.
 *   The page reads the four lists and POSTs them back here; this script writes the
 *   fixture and prints the field keys each list actually returned. Ctrl+C when done.
 *
 * AUTH: delegated, via MSAL in the browser using the SPA app registration
 * "D2 Build Scheduler (planner)". Delegated means the app grants nothing on its own
 * -- what it can read is exactly what the signed-in user's own SharePoint
 * permissions allow. There is no client secret anywhere; a SPA uses auth-code with
 * PKCE. The redirect URI below must be registered on that app; localhost:8787 is.
 *
 * The page lives in capture-graph.html beside this file rather than inline. Inline
 * cost two bugs in one go -- a backtick inside a comment silently terminated the
 * enclosing template literal, and the newline escaping was wrong -- and both
 * presented as "the button does nothing".
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8787;
const OUT = path.join(__dirname, 'live-payloads-graph.json');
const PAGE_FILE = path.join(__dirname, 'capture-graph.html');
// Read from web/vendor, not a second copy under fixtures/ -- that is the same
// file the planner itself loads at runtime (web/index.html), and this repo has
// already been burned once by two copies of a file drifting apart.
const MSAL_FILE = path.join(__dirname, '..', '..', 'web', 'vendor', 'msal-browser.min.js');
/* Served from here rather than a CDN. The Microsoft CDN path returns 404 and the
   page then fails with nothing but a dead button, so the dependency is local and
   the failure is visible. Fetched once if missing; jsdelivr and unpkg both serve
   the same bytes. */
const MSAL_URL = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js';

async function ensureMsal() {
  if (fs.existsSync(MSAL_FILE)) return;
  fs.mkdirSync(path.dirname(MSAL_FILE), { recursive: true });
  console.log('Fetching MSAL once from ' + MSAL_URL);
  const r = await fetch(MSAL_URL);
  if (!r.ok) throw new Error('could not fetch MSAL: ' + r.status);
  fs.writeFileSync(MSAL_FILE, Buffer.from(await r.arrayBuffer()));
  console.log('Cached to ' + MSAL_FILE);
}

const CLIENT_ID = '1aa00e61-e5e7-42bd-95b4-fd58863e5b54';
const TENANT_ID = 'f24d9b39-6a71-4f4e-a376-03b6f61c97e4';
const SITE_HOST = 'netorgft15040037.sharepoint.com';
const SITE_PATH = '/sites/D2BuildScheduler';

// List GUIDs from CLAUDE.md's deployed-state table. Graph accepts the same ids.
const LISTS = {
  jobs: 'ee0ecabf-2f11-458d-a9ea-641f76d10cc3',
  asg: '49ef7006-d3fe-40a7-a52f-c4c18545bd35',
  tasks: '22c45847-ff0d-417a-b53e-1ea018fbb6d3',
  cal: 'd36758cf-9d27-4342-84e4-817f8dcfa2ba',
  spt: '453e7cd5-f84a-4e2a-9372-73f26019e3f0',     // Sub-phase Template
  tpt: '61824add-8eaa-4b1b-aed7-a202204bf9f5',     // Task Template
  trades: '05038f7f-a6cb-4f57-b1a1-3ff9c7126ba5'
};

/* --merge: copy ONLY these keys from the posted capture into the two existing fixtures and
   leave jobs/asg/tasks/cal alone. The existing pools in those fixtures are frozen demo data;
   a wholesale recapture would replace them with live client data. */
const MERGE = process.argv.includes('--merge');
const MERGE_KEYS = ['spt', 'tpt', 'trades'];

function page() {
  return fs.readFileSync(PAGE_FILE, 'utf8')
    .replace('__CLIENT_ID__', CLIENT_ID)
    .replace('__TENANT_ID__', TENANT_ID)
    .replace('__REDIRECT__', 'http://localhost:' + PORT + '/')
    .replace('__SITE_HOST__', SITE_HOST)
    .replace('__SITE_PATH__', SITE_PATH)
    .replace('__LISTS__', JSON.stringify(LISTS));
}

const OUT_FILTERED = path.join(__dirname, 'live-payloads-graph-filtered.json');

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/capture-filtered') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        fs.writeFileSync(OUT_FILTERED, JSON.stringify(d, null, 1), 'utf8');
        console.log('\nWROTE ' + OUT_FILTERED);
        console.log('  picked: ' + JSON.stringify(d.picked));
        for (const q of d.queries.filter(q => !/^asg job \d+ quoted$/.test(q.label)))
          console.log('  ' + (q.error ? 'REFUSED ' : 'ok      ') + q.label + '  rows=' + q.rows + ' ' + q.ms + 'ms' + (q.error ? '  ' + q.error.slice(0, 200) : ''));
        const per = d.queries.filter(q => /^asg job \d+ quoted$/.test(q.label));
        console.log('  per-project assignment reads: ' + per.length + ', refused ' + per.filter(q => q.error).length);
        console.log('  simulated per-project Refresh: ' + JSON.stringify(d.simulatedRefresh));
        console.log('  whole-list read today:         ' + JSON.stringify(d.wholeListRead));
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Captured. Written to ' + OUT_FILTERED + '\nYou can close this tab.');
      } catch (e) {
        console.error('capture failed:', e.message);
        res.writeHead(500); res.end('capture failed: ' + e.message);
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/capture') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        if (MERGE) {
          const missing = MERGE_KEYS.filter(k => !Array.isArray(d[k]));
          if (missing.length) throw new Error('capture lacks ' + missing.join(', '));
          for (const target of [OUT, OUT_FILTERED]) {
            const t = JSON.parse(fs.readFileSync(target, 'utf8'));
            for (const k of MERGE_KEYS) t[k] = d[k];
            fs.writeFileSync(target, JSON.stringify(t, null, 1), 'utf8');
            console.log('MERGED into ' + target + ': ' + MERGE_KEYS.map(k => k + '=' + d[k].length).join(', '));
          }
          console.log('Done (--merge). Other keys untouched. Ctrl+C to stop.');
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Merged ' + MERGE_KEYS.map(k => k + '=' + d[k].length).join(', ') + ' into both fixtures.\nYou can close this tab.');
          return;
        }
        fs.writeFileSync(OUT, JSON.stringify(d, null, 1), 'utf8');
        const counts = Object.keys(d).filter(k => Array.isArray(d[k]))
          .map(k => k + '=' + d[k].length).join(', ');
        console.log('\nWROTE ' + OUT);
        console.log('  ' + counts);
        console.log('  site: ' + d.site);
        console.log('\nField keys per list -- THIS is what the mapping must be written against:');
        for (const k of Object.keys(d)) {
          if (!Array.isArray(d[k]) || !d[k].length) continue;
          const row = d[k][0];
          console.log('  ' + k + ' item  : ' + Object.keys(row).join(','));
          if (row.fields) console.log('  ' + k + ' fields: ' + Object.keys(row.fields).join(','));
        }
        console.log('\nDone. Ctrl+C to stop.');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Captured: ' + counts + '\nWritten to ' + OUT + '\nYou can close this tab.');
      } catch (e) {
        console.error('capture failed:', e.message);
        res.writeHead(500);
        res.end('capture failed: ' + e.message);
      }
    });
    return;
  }
  if (req.url === '/msal.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(fs.readFileSync(MSAL_FILE));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page());
});
ensureMsal().then(() => server.listen(PORT, () => {
  console.log('Capture server on http://localhost:' + PORT + '/');
  console.log('Open that URL and click "Sign in and capture".');
  console.log('Read-only: GETs against Microsoft Graph, one local file written' + (MERGE ? ' (--merge: only spt, tpt, trades are merged into the two fixtures).' : '.'));
})).catch(e => { console.error('startup failed:', e.message); process.exit(1); });
