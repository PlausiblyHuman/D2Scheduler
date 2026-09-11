/* A first-run browser starts with S.jobs=[] and nothing loaded from D2 (see the
 * "NO DEMO POOLS" comment in web/index.html). This pins that the planner still
 * boots cleanly in that state, rather than merely printing numbers about it.
 *
 * Fix round 1 (final whole-branch review, finding 1): the original version of
 * this file only ever console.log'd its checks -- no assertion, no non-zero
 * exit. Proven by the reviewer: replacing `save` (web/index.html:306) with an
 * undefined reference makes autoSchedule() throw on its own trailing save()
 * call, and jsdom reports the uncaught ReferenceError -- and the old file still
 * printed both facts and exited 0. It sat in eight `&&` chains and in the plan's
 * exit-criteria table, so a boot-time break in the planner passed the whole
 * suite. Now every check below is a real assertion.
 */
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../web/index.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.autoSchedule=autoSchedule;};</script><script>__x();</script></body>`);
const errs = [];
const vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });

setTimeout(() => {
  const w = dom.window;

  ok('no jsdom errors at boot', errs.length === 0, errs.length ? errs.join(' | ') : 'none');

  const S = w.S;
  ok('state initialised', !!S, S ? '' : 'window.S is undefined');
  ok('a first-run browser starts with no pools', !!S && Array.isArray(S.jobs) && S.jobs.length === 0,
     S ? 'jobs=' + S.jobs.length : '-');
  ok('crews seeded', !!S && Array.isArray(S.crews) && S.crews.length > 0,
     S ? 'crews=' + S.crews.length : '-');
  const subPhases = S && S.template ? S.template.reduce((n, g) => n + g.sections.length, 0) : 0;
  ok('phase template loaded', subPhases > 0, 'sub-phases=' + subPhases);

  ok('Load from D2 button present', !!w.document.getElementById('d2Btn'));

  let threw = false, threwMsg = '';
  try { w.autoSchedule(); } catch (e) { threw = true; threwMsg = e.message; }
  ok('autoSchedule does not throw on an empty pool list', !threw, threw ? threwMsg : 'OK');

  const main = w.document.getElementById('main');
  ok('the board renders on an empty pool list', !!main && main.innerHTML.length > 0,
     main ? main.innerHTML.length + ' chars' : 'no #main element');

  process.exit(fail);
}, 700);
