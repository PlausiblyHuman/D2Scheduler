/* Three confirmed enforcement gaps, business rules 1, 2 and 3, all in the
 * planner only (SharePoint's own copies are unaffected).
 *
 * D-RULE1: isQualified() and qualified() disagree on a FIXED (pseudo-trade)
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
 *
 * D-RULE3: business rule 3 says sub-phases run in order. autoSchedule()'s
 * walk keeps a `cursor` and unconditionally sets it to a locked row's own
 * end when it meets one. A locked row that starts earlier than work already
 * placed pulls the cursor backwards, and the next unlocked row lands on top
 * of it.
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
    window.autoSchedule=autoSchedule;window.reflowFrom=reflowFrom;};</script><script>__x();</script></body>`);
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

  // ================= D-RULE3: the cursor must never move backwards =================
  const jCursor = mkJob({ jobno: 'RULE3', start: '2026-01-05' });
  // Section 0: unlocked, no skill -> takes the seeded cursor (2026-01-05) and
  // runs 5 work days, Mon-Fri, pushing the cursor on to 2026-01-10 (Saturday,
  // still a work day per business rule 4).
  jCursor.groups[0].sections.push(mkSec({ num: '0.0', skill: null, days: 5 }));
  // Section 1: LOCKED, with its own start earlier than the cursor above --
  // exactly the "signed-off work that sits earlier than the preceding rows"
  // shape the bug description names.
  jCursor.groups[0].sections.push(mkSec({ num: '0.1', skill: null, days: 1, locked: true, start: '2026-01-06' }));
  // Section 2: unlocked, no skill -> must not be placed before section 0 ends.
  jCursor.groups[0].sections.push(mkSec({ num: '0.2', skill: null, days: 1 }));
  S.jobs = [jCursor];

  win.autoSchedule();
  const secs3 = jCursor.groups[0].sections;
  ok('section 0 ran to the expected end (2026-01-09), cursor should sit at 2026-01-10',
     secs3[0].start === '2026-01-05', secs3[0].start);
  ok('the locked row does not pull the cursor backwards past work already placed',
     secs3[2].start === '2026-01-10', 'section 2 landed on ' + secs3[2].start);
  ok('...and specifically does not land ON or inside section 0\'s own span',
     secs3[2].start > '2026-01-09', secs3[2].start);

  // ============ D-RULE3b: reflowFrom() obeys the same rules as the flow ============
  // Added with the "Save + reflow" action. It mirrors D2 - Reschedule Pool, so it
  // has to honour rule 3 the same way autoSchedule now does, and it must never
  // move locked or signed-off work. March 2027 is used deliberately: it carries no
  // US federal holiday, so these assertions do not depend on Work Calendar data
  // being seeded into this harness.
  const jR = mkJob({ jobno: 'RULE3B' });
  const secR = jR.groups[0].sections;
  secR.push(mkSec({ num: '0.0', days: 5, start: '2027-03-01' }));                       // Mon, runs Mon-Fri
  secR.push(mkSec({ num: '0.1', days: 1, locked: true, start: '2027-02-15' }));         // pinned WAY earlier
  secR.push(mkSec({ num: '0.2', days: 1, start: '2027-06-01' }));                       // should follow 0.0
  secR.push(mkSec({ num: '0.3', days: 1, start: '2027-06-02' }));                       // should follow 0.2
  S.jobs = [jR];

  const r1 = win.reflowFrom(jR.id, 0, 0);
  ok('reflow moved the two unlocked rows and left the pinned one',
     r1 && r1.moved === 2 && r1.pinned === 1, JSON.stringify(r1));
  ok('reflow leaves the row it starts from where it is',
     secR[0].start === '2027-03-01', secR[0].start);
  ok('reflow NEVER moves a locked row',
     secR[1].start === '2027-02-15', secR[1].start);
  ok('a pinned row far in the past does not drag the cursor backwards',
     secR[2].start === '2027-03-06', 'landed ' + secR[2].start + ' (expected 2027-03-06)');
  ok('...and the row after it skips Sunday',
     secR[3].start === '2027-03-08', 'landed ' + secR[3].start + ' (expected 2027-03-08)');

  // Signed-off work is pinned even with no explicit lock.
  const jS = mkJob({ jobno: 'RULE3C' });
  const secS = jS.groups[0].sections;
  secS.push(mkSec({ num: '0.0', days: 2, start: '2027-03-01' }));
  secS.push(mkSec({ num: '0.1', days: 2, start: '2027-05-10', inst: true }));           // signed off
  secS.push(mkSec({ num: '0.2', days: 2, start: '2027-06-01' }));
  S.jobs = [jS];
  win.reflowFrom(jS.id, 0, 0);
  ok('reflow NEVER moves signed-off work, even with no explicit lock',
     secS[1].start === '2027-05-10', secS[1].start);

  // Rows before the starting point are never touched, exactly as FromSequence works.
  const jB = mkJob({ jobno: 'RULE3D' });
  const secB = jB.groups[0].sections;
  secB.push(mkSec({ num: '0.0', days: 2, start: '2027-03-01' }));
  secB.push(mkSec({ num: '0.1', days: 2, start: '2027-09-20' }));                        // deliberately adrift
  secB.push(mkSec({ num: '0.2', days: 2, start: '2027-09-30' }));
  S.jobs = [jB];
  win.reflowFrom(jB.id, 0, 1);
  ok('reflow never touches a row BEFORE the one it starts from',
     secB[0].start === '2027-03-01', secB[0].start);
  ok('...and does reflow the row it starts from onwards',
     secB[2].start === '2027-09-22', 'landed ' + secB[2].start + ' (expected 2027-09-22)');

  process.exit(fail);
})();
