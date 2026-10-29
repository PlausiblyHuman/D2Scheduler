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
    window.autoSchedule=autoSchedule;window.reflowFrom=reflowFrom;
    window.yourCalls=yourCalls;window.AUTO_RULES=AUTO_RULES;window.autoScheduleRun=autoScheduleRun;};</script><script>__x();</script></body>`);
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

  // ====== D-FEAT: reflowFrom opts (floor, pinStarted, fromPrev) for feature switches ======
  const FLOOR = '2026-10-23';                       // a Friday, not a holiday
  const mkFeat = () => {
    const jF = mkJob({ jobno: 'FEAT' });
    const sc = jF.groups[0].sections;
    sc.push(mkSec({ num: '1', days: 2, start: '2026-08-06' }));                 // ends 2026-08-10 (Mon)
    sc.push(mkSec({ num: '2', days: 2, start: null }));                         // re-enabled row
    sc.push(mkSec({ num: '3', days: 2, start: '2026-09-01' }));                 // already started
    sc.push(mkSec({ num: '4', days: 2, start: '2026-11-30' }));                 // later work
    S.jobs = [jF];
    return { jF, sc };
  };
  {
    const { jF, sc } = mkFeat();
    win.reflowFrom(jF.id, 0, 1, undefined, { floor: FLOOR, pinStarted: true, fromPrev: true });
    ok('floor wins over an earlier previous row', sc[1].start === FLOOR, sc[1].start);
    ok('pinStarted leaves an already-started row where it is', sc[2].start === '2026-09-01', sc[2].start);
    ok('a later row moves to follow the re-enabled one', sc[3].start === '2026-10-26', sc[3].start);
  }
  {
    const { jF, sc } = mkFeat();
    sc[1].start = null;                                                          // re-enabled row, start cleared
    win.reflowFrom(jF.id, 0, 1, undefined, { floor: FLOOR, pinStarted: true, fromPrev: true });
    ok('a cleared re-enabled row lands exactly at the floor', sc[1].start === FLOOR, sc[1].start);
    ok('...and a later already-started row stays put', sc[2].start === '2026-09-01', sc[2].start);
  }
  {
    const { jF, sc } = mkFeat();
    win.reflowFrom(jF.id, 0, 1, undefined, { floor: FLOOR, fromPrev: true });
    ok('without pinStarted the started row is pulled forward too', sc[2].start === '2026-10-26', sc[2].start);
  }
  {
    const { jF, sc } = mkFeat();
    sc[0].start = '2026-10-30';                                                  // previous row ends after the floor
    win.reflowFrom(jF.id, 0, 1, undefined, { floor: FLOOR, pinStarted: true, fromPrev: true });
    ok('fromPrev follows the previous row when it ends after the floor', sc[1].start === '2026-11-02', sc[1].start);
  }
  {
    const { jF, sc } = mkFeat();
    sc[1].start = '2026-12-14';
    win.reflowFrom(jF.id, 0, 1, undefined, { floor: FLOOR, fromPrev: true });
    ok('fromPrev ignores the own start of the row', sc[1].start === FLOOR, sc[1].start);
  }
  {
    const { jF, sc } = mkFeat();
    sc[0].skip = true; sc[0].start = '2026-11-02';                               // off row must not set the cursor
    win.reflowFrom(jF.id, 0, 1, undefined, { floor: FLOOR, fromPrev: true });
    ok('fromPrev skips an off (skip) previous row', sc[1].start === FLOOR, sc[1].start);
  }
  {
    const jU = mkJob({ jobno: 'FEATP' });
    jU.groups[0].sections.push(mkSec({ num: '1', days: 2, start: null }));
    S.jobs = [jU];
    win.reflowFrom(jU.id, 0, 0, undefined, { floor: '2026-01-05', fromPrev: true });
    ok('with no previous row the cursor is the floor, not today', jU.groups[0].sections[0].start === '2026-01-05', jU.groups[0].sections[0].start);
  }
  {
    const jU = mkJob({ jobno: 'FEATU' });
    jU.groups[0].sections.push(mkSec({ num: '1', days: 2, start: null }), mkSec({ num: '2', days: 2, start: null }));
    S.jobs = [jU];
    win.reflowFrom(jU.id, 0, 0, undefined, { floor: FLOOR, pinStarted: true, fromPrev: true });
    ok('an undated project starts at the floor', jU.groups[0].sections[0].start === FLOOR, jU.groups[0].sections[0].start);
    ok('...and its next row follows', jU.groups[0].sections[1].start === '2026-10-26', jU.groups[0].sections[1].start);
  }
  {
    const { jF, sc } = mkFeat();
    const r = win.reflowFrom(jF.id, 0, 1);
    ok('no opts: behaves as before (starts from the row, today when undated)', sc[1].start && sc[1].start >= '2026-10-22' && r.pinned === 0, sc[1].start);
  }

  // ====== D-RATING: Auto-Schedule prefers the higher rating on the day, and lists where it settled ======
  // A synthetic skill no seed crew holds, so qualified() returns exactly our crews.
  {
    // jsdom does not fetch <script src>, and the preview words come from writeback-core.js.
    if (!win.D2WritebackCore) win.eval(fs.readFileSync(path.resolve(__dirname, '../../web/writeback-core.js'), 'utf8'));
    const SK = 'zz-rating-test', D1 = '2026-03-02', D2 = '2026-03-03'; // Monday, Tuesday, no holidays
    const savedCrews = S.crews.slice(), savedJobs = S.jobs;
    const mkCrew = (id, o) => Object.assign({ id, spId: 9000 + id.length, name: 'Crew ' + id, members: [], size: 1,
      unlimited: false, active: true, note: '', overall: 3, ratings: { [SK]: 3 }, ctIds: {} }, o);
    // build a world: crews list, plus a locked "busy" row per crew-and-day, plus one open sub-phase on D1
    const world = (crews, busy) => {
      S.crews = crews;
      const jobs = [];
      (busy || []).forEach(([cid, start, days]) => {
        const jb = mkJob({ jobno: 'BUSY-' + cid });
        jb.groups[0].sections.push(mkSec({ num: '0.0', skill: SK, crewId: cid, start, days: days || 1, locked: true }));
        jobs.push(jb);
      });
      const jo = mkJob({ jobno: 'OPEN', start: D1 });
      jo.groups[0].sections.push(mkSec({ num: '1.0', skill: SK, days: 1 }));
      jobs.push(jo);
      S.jobs = jobs;
      win.autoSchedule();
      return { sec: jo.groups[0].sections[0], calls: win.yourCalls() };
    };
    const A = (o) => mkCrew('zzA', o), B = (o) => mkCrew('zzB', Object.assign({ ratings: { [SK]: 2 } }, o));

    let r = world([A(), B()]);
    ok('rating: both free, the higher rating (A, 3) is picked', r.sec.crewId === 'zzA' && r.sec.start === D1, r.sec.crewId + ' ' + r.sec.start);
    ok('rating: nothing to list when the best crew got it', r.calls.length === 0, JSON.stringify(r.calls));

    // the higher rating beats the lighter load, with the id order against it too
    r = world([mkCrew('zzA', { ratings: { [SK]: 2 } }), mkCrew('zzB', { ratings: { [SK]: 3 } })], [['zzB', '2026-02-02', 5]]);
    ok('rating: a higher rating beats a lighter load (and id order)', r.sec.crewId === 'zzB', r.sec.crewId);

    r = world([A({ ratings: { [SK]: 2 } }), B()], [['zzA', '2026-02-02', 5]]);
    ok('rating: equal ratings, the less loaded crew is picked (rule unchanged)', r.sec.crewId === 'zzB', r.sec.crewId);

    r = world([A(), B()], [['zzA', D1, 1]]);
    ok('rating: A busy, B free: B is picked that same day, start not delayed', r.sec.crewId === 'zzB' && r.sec.start === D1, r.sec.crewId + ' ' + r.sec.start);
    ok('rating: ...and yourCalls lists it with A and A\'s first free day',
       r.calls.length === 1 && r.calls[0].num === '1.0' && r.calls[0].better.length === 1
       && r.calls[0].better[0].name === 'Crew zzA' && r.calls[0].better[0].free === D2 && r.calls[0].got === 2,
       JSON.stringify(r.calls));

    r = world([A(), B({ ratings: { [SK]: 0 } })], [['zzA', D1, 1]]);
    ok('rating: a 0 (Never) is never picked even when A is busy, the sub-phase waits for A', r.sec.crewId === 'zzA' && r.sec.start === D2, r.sec.crewId + ' ' + r.sec.start);

    r = world([A({ overall: 0 }), B()]);
    ok('rating: A at overall 0 is out, B is picked', r.sec.crewId === 'zzB', r.sec.crewId);
    ok('rating: ...and nothing is listed, B is the best available', r.calls.length === 0, JSON.stringify(r.calls));

    r = world([A({ overall: 1 }), B()]);
    ok('rating: A at overall 1 is still picked', r.sec.crewId === 'zzA', r.sec.crewId);

    r = world([A(), mkCrew('zzC', { unlimited: true, ratings: { [SK]: 2 } })], [['zzA', D1, 1]]);
    ok('rating: a lower-rated unlimited crew free that day beats a busy higher-rated field crew', r.sec.crewId === 'zzC' && r.sec.start === D1, r.sec.crewId + ' ' + r.sec.start);
    ok('rating: ...and is listed', r.calls.length === 1 && r.calls[0].better[0].name === 'Crew zzA' && r.calls[0].better[0].free === D2, JSON.stringify(r.calls));

    r = world([mkCrew('zzC', { unlimited: true, ratings: { [SK]: 2 } }), A({ unlimited: true })]);
    ok('rating: all-unlimited candidates pick the highest rating', r.sec.crewId === 'zzA', r.sec.crewId);

    // the preview, driven through the real run
    world([A(), B()], [['zzA', D1, 1]]);
    S.jobs[S.jobs.length - 1].groups[0].sections[0].crewId = null;       // unplaced again, so the run does the placing
    S.jobs[S.jobs.length - 1].groups[0].sections[0].start = null;
    win.autoScheduleRun();
    const body = win.document.getElementById('dBody').innerHTML;
    ok('rating: the preview shows a "Your call (1)" group', /Your call \(1\)/.test(body), body.slice(0, 120));
    ok('rating: ...with the better crew, its word and free date', /Crew zzA \(First choice\) free from/.test(body));
    ok('rating: ...before the rules list', body.indexOf('Your call') < body.indexOf('How Auto-Schedule decides'));
    ok('rating: AUTO_RULES says the higher-rated crew wins', win.AUTO_RULES.some(x => /higher-rated/.test(x)));

    S.crews = savedCrews; S.jobs = savedJobs;
  }

  process.exit(fail);
})();
