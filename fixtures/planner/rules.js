/* D-RULE1: isQualified() and qualified() disagree on a FIXED (pseudo-trade)
 * skill. qualified('@office') offers only the one bucket crew a FIXED code
 * names, but isQualified() let ANY capacity-exempt crew through
 * (`|| c.unlimited`), so a drawer could put e.g. STL Shotcrete on an @office
 * row and conflicts() would raise nothing. The two predicates must agree.
 *
 * D-RULE2: business rule 2 exempts capacity-exempt crews from ever being
 * "double-booked" -- busyMap() honours this, but autoSchedule()'s own busy
 * seeding did not, so a subcontractor already locked to one pool on a day
 * could be treated as unavailable for a second pool the same day, even
 * though rule 2 says it never is.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../web/index.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.crew=crew;
    window.isQualified=isQualified;window.qualified=qualified;window.conflicts=conflicts;
    window.autoSchedule=autoSchedule;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.confirm = () => true; win.alert = () => {};

const mkSec = (o) => Object.assign({ sid: 'x', num: 'x', name: 'x', skill: null, days: 2,
  crewId: null, start: null, skip: false, locked: false, inst: false, pm: false, tasks: [] }, o);
const mkJob = (o) => Object.assign({ id: 'j' + Math.random().toString(36).slice(2, 8), jobno: 'TEST',
  name: 'Test Pool', addr: '', city: '', state: '', zip: '', start: null, status: null,
  groups: [{ tid: 'g', num: '0', name: 'G', inst: false, pm: false, sections: [] }] }, o);

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = win.S;

  // ================= D-RULE1: isQualified() must agree with qualified() =================
  const stl = win.crew('stl'), office = win.crew('office'), subcon = win.crew('subcon');

  ok('qualified(@office) offers only the one bucket crew',
     JSON.stringify(win.qualified('@office').map(c => c.id)) === JSON.stringify(['office']),
     win.qualified('@office').map(c => c.id).join(','));

  ok('an unlimited crew outside the bucket is NOT qualified for @office',
     win.isQualified(stl, '@office') === false,
     'isQualified(stl,@office) = ' + win.isQualified(stl, '@office'));

  ok('a different bucket (subcon) is NOT qualified for @office either',
     win.isQualified(subcon, '@office') === false);

  ok('the bucket crew itself is still qualified for its own @-code',
     win.isQualified(office, '@office') === true);

  const jFixed = mkJob({ jobno: 'RULE1' });
  jFixed.groups[0].sections.push(mkSec({ num: '0.0', skill: '@office', crewId: 'stl',
    start: '2026-01-05', days: 1 }));
  S.jobs = [jFixed];
  const msgsBad = win.conflicts().map(c => c.msg);
  ok('conflicts() flags an unlimited crew wrongly parked on a bucket sub-phase',
     msgsBad.some(m => /not qualified/i.test(m) && /Main Office/.test(m)),
     msgsBad.join(' | ').slice(0, 160));

  jFixed.groups[0].sections[0].crewId = 'office';
  const msgsGood = win.conflicts().map(c => c.msg);
  ok('...and raises nothing once the correct bucket crew is assigned',
     !msgsGood.some(m => /not qualified/i.test(m)),
     msgsGood.join(' | ').slice(0, 160));

  // ================= D-RULE2: autoSchedule's busy seeding must exempt unlimited crews =================
  // 'dig' candidates: guillermo, saul, harrison (real crews) and stl (unlimited,
  // capacity-exempt). Lock the three real crews AND stl to the same day on
  // separate pools, so the only crew genuinely free that day is stl -- which
  // rule 2 says is always free regardless of what else it is locked to.
  const DATE1 = '2026-01-05'; // a Monday, a real work day, not a holiday
  const jStl = mkJob({ jobno: 'RULE2-STL' });
  jStl.groups[0].sections.push(mkSec({ num: '0.0', skill: 'dig', crewId: 'stl', start: DATE1, days: 1, locked: true }));
  const jHarrison = mkJob({ jobno: 'RULE2-H' });
  jHarrison.groups[0].sections.push(mkSec({ num: '0.0', skill: 'dig', crewId: 'harrison', start: DATE1, days: 1, locked: true }));
  const jGuillermo = mkJob({ jobno: 'RULE2-G' });
  jGuillermo.groups[0].sections.push(mkSec({ num: '0.0', skill: 'dig', crewId: 'guillermo', start: DATE1, days: 1, locked: true }));
  const jSaul = mkJob({ jobno: 'RULE2-S' });
  jSaul.groups[0].sections.push(mkSec({ num: '0.0', skill: 'dig', crewId: 'saul', start: DATE1, days: 1, locked: true }));
  const jOpen = mkJob({ jobno: 'RULE2-OPEN', start: DATE1 });
  jOpen.groups[0].sections.push(mkSec({ num: '0.0', skill: 'dig', locked: false }));
  S.jobs = [jStl, jHarrison, jGuillermo, jSaul, jOpen];

  win.autoSchedule();
  const openSec = jOpen.groups[0].sections[0];
  ok('the open pool lands on the SAME day stl is already locked to, not a later one',
     openSec.start === DATE1, 'got ' + openSec.start + ' (expected ' + DATE1 + ')');
  ok('...picking stl, the only crew rule 2 says is actually free that day',
     openSec.crewId === 'stl', 'got ' + openSec.crewId);

  process.exit(fail);
})();
