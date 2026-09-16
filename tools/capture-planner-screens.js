/* Capture screenshots of the planner's tabs, for the PM guide.
 *
 * WHY THIS EXISTS: the PM guide leans on figures, and every figure of the
 * SharePoint surface went stale the moment the planner became the surface the
 * pilot runs on. Recapturing them by hand means signing in to the hosted app and
 * cropping by eye, which is slow and is not reproducible. This does it offline.
 *
 * It needs NO tenant access and NO sign-in. It serves web/ locally, which puts
 * the planner in the same hosted mode a PM sees (graphModeAvailable() is true
 * over http, false only over file://), and then injects a payload built from the
 * captured fixtures rather than reading the live tenant. So the figures show the
 * three fictional demo pools, which is what a client-facing guide should show
 * anyway.
 *
 *   node tools/capture-planner-screens.js <outputDir>
 *
 * Prerequisites, both of which the script checks for and explains:
 *   1. A static server on 8787 serving web/     python -m http.server 8787
 *   2. Chrome listening on 9222 (or $CDP_PORT), on a THROWAWAY profile:
 *        chrome --headless=new --remote-debugging-port=9222 \
 *               --user-data-dir=<scratch> --window-size=1440,1000 --hide-scrollbars
 *      A throwaway profile matters: the chrome-devtools MCP cannot attach when
 *      Chrome already holds the user's normal profile lock, which has cost this
 *      project two sessions (see CLAUDE.md "DRIVING CHROME WITHOUT THE
 *      chrome-devtools MCP"). A second Chrome on its own profile runs happily
 *      beside the user's.
 *
 * Node 24 has a global WebSocket, so this needs no dependencies at all.
 *
 * TWO THINGS THAT ARE EASY TO GET WRONG:
 *   * /json/new must be called with PUT. A GET returns a deprecation notice as
 *     plain text, which then fails to parse as JSON with a misleading error.
 *   * The Job Board used to need a hard scroll offset here, because its timeline
 *     starts at the earliest date across ALL pools and an unscrolled capture was
 *     empty grid with every bar off to the right. The board now lands on today by
 *     itself (see positionTimeline), so the offset is 0 and the figure shows
 *     whatever is current.
 */
const fs = require('fs');
const path = require('path');

const PORT_CDP = Number(process.env.CDP_PORT || 9222);
const PAGE = 'http://localhost:8787/index.html';
const OUT = process.argv[2] || '.';

/* tab, which .card on that tab, output name, timeline scroll, max height */
const FIGURES = [
  ['board',     1, 'board',        0, 900],   // the board now lands on today by itself
  ['board',     0, 'check',        0, 760],
  ['crewboard', 0, 'crewboard',    0, 720],
  ['dispatch',  0, 'dispatch',     0, 900],
  ['signoff',   0, 'signoff',      0, 820],
  ['jobs',      0, 'jobs',         0, 300],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdp(p) {
  const r = await fetch(`http://127.0.0.1:${PORT_CDP}${p}`, { method: 'PUT' });
  return r.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    sock.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((ok, no) => {
          const n = ++id;
          pending.set(n, { ok, no });
          sock.send(JSON.stringify({ id: n, method, params }));
        });
      },
      close: () => sock.close(),
    });
    sock.onerror = reject;
    sock.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { ok, no } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? no(new Error(JSON.stringify(m.error))) : ok(m.result);
      }
    };
  });
}

async function buildPayload() {
  const { runExport } = require('../fixtures/planner/run-export.js');
  const live = require('../fixtures/planner/live-payloads.json');
  return runExport(live);
}

(async () => {
  for (const [url, hint] of [
    [PAGE, 'Start a static server first:  cd web && python -m http.server 8787'],
    [`http://127.0.0.1:${PORT_CDP}/json/version`, 'Start Chrome with --remote-debugging-port=9222 on a throwaway --user-data-dir'],
  ]) {
    try { await fetch(url, { method: url === PAGE ? 'GET' : 'GET' }); }
    catch { console.error(`Cannot reach ${url}\n  ${hint}`); process.exit(1); }
  }

  const payload = await buildPayload();
  const secs = payload.jobs.reduce((n, j) => n + (j.sections || []).length, 0);
  console.log(`payload: ${payload.jobs.length} pools, ${secs} sub-phases`);

  const target = await cdp('/json/new?' + encodeURIComponent(PAGE));
  const c = await connect(target.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await sleep(1800);

  const ev = async expr => {
    const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
    return r.result.value;
  };

  /* Guard: if this is false the planner fell back to the file picker and the
     figures would show the wrong mode, with the wrong Save tooltip. */
  if (!(await ev('graphModeAvailable()'))) {
    throw new Error('planner is not in hosted mode; serve web/ over http rather than opening the file');
  }
  await ev(`importFromD2Payload(${JSON.stringify(payload)}, true); render(); 'ok'`);
  await sleep(600);

  fs.mkdirSync(OUT, { recursive: true });
  for (const [tab, idx, name, hscroll, maxh] of FIGURES) {
    await ev(`document.querySelector('[data-t="${tab}"]').click(); scrollTo(0,0); 'ok'`);
    await sleep(650);
    if (hscroll) {
      await ev(`(()=>{const el=[...document.querySelectorAll('#main *')]
        .find(e=>e.scrollWidth>e.clientWidth+40&&e.clientWidth>300); if(el)el.scrollLeft=${hscroll}; return 1;})()`);
      await sleep(350);
    }
    const box = await ev(`(()=>{const e=document.getElementById('main').children[${idx}];
      const r=e.getBoundingClientRect();
      return {x:Math.max(0,r.x+scrollX-10), y:Math.max(0,r.y+scrollY-10),
              w:Math.min(1440,r.width+20), h:Math.min(${maxh},r.height+20)};})()`);
    const img = await c.send('Page.captureScreenshot', {
      format: 'jpeg', quality: 82, captureBeyondViewport: true,
      clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 },
    });
    const file = path.join(OUT, `fig-${name}.jpg`);
    fs.writeFileSync(file, Buffer.from(img.data, 'base64'));
    console.log(`  ${file}  ${Math.round(box.w)}x${Math.round(box.h)}  ${Math.round(img.data.length * 0.75 / 1024)}KB`);
  }

  await c.send('Page.close').catch(() => {});
  c.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
