/* Schedule Check, grouped by root cause and collapsed by default.
 *
 * On 34 real projects the card listed 1,679 findings, almost all of them the
 * same few causes repeated: a project started in the past with nothing signed
 * (46 "not signed off" lines each), the same 11 field-supervision sub-phases
 * in Unassigned on every project, and one crew holding all the plumbing (118
 * double-bookings). The rules pinned here, each watched red under mutate.py:
 *   - checkGroups() loses no finding: its groups hold every conflicts() item
 *   - a project's past-due findings are ONE group, rooted at the earliest one,
 *     because everything after it is a consequence of it slipping
 *   - out-of-order starts group per project, rooted at the first
 *   - double-bookings group per crew, and the fix names the other crews that
 *     hold the trades involved
 *   - Unassigned is one group across every project
 *   - errors come before warnings, then larger groups first
 *   - the card is collapsed by default, shows the counts, and remembers being
 *     opened across a redraw
 *   - crew names are escaped in every message
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../web/index.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.conflicts=conflicts;window.newJob=newJob;window.render=render;
     window.checkGroups=checkGroups;window.getUI=()=>UI;window.qualified=qualified;window.crew=crew;window.nextWork=nextWork;
     window.workSpan=workSpan;window.addCal=addCal;window.getTab=()=>TAB;};</script><script>__x();</script></body>`);
const errs = [];
const vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push(e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const w = dom.window;
w.confirm = () => true; w.alert = () => {};
const main = () => w.document.getElementById('main');
const card = () => main().querySelector('details.chk');

// Lay a pool's sub-phases end to end from `from`, one working day each.
function lay(j, from, crewFor) {
  let d = w.nextWork(from);
  w.allSecs(j).forEach(({ s }) => { s.skip = false; s.inst = false; s.locked = false; s.days = 1; s.start = d; s.crewId = crewFor(s);
    d = w.nextWork(w.addCal(d, 1)); });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = w.S;
  S.jobs = [];
  const A = w.newJob('Alpha', '', '', '', '', '2026-01-05'); A.jobno = 'T-1';
  const B = w.newJob('Beta', '', '', '', '', '2027-03-01'); B.jobno = 'T-2';
  const C = w.newJob('Gamma', '', '', '', '', '2027-03-01'); C.jobno = 'T-3';
  S.jobs.push(A, B, C);
  // Every row gets a qualified crew so the only findings are the ones set up below.
  const fit = s => { if (!s.skill) return null; const q = w.qualified(s.skill); return q.length ? q[0].id : null; };
  lay(A, '2026-01-05', fit);
  lay(B, '2027-03-01', fit);
  lay(C, '2028-03-01', fit);

  const exempt = o => { const c = o.s.crewId && w.crew(o.s.crewId); return !!c && c.unlimited && o.s.crewId !== 'unassigned'; };
  // Beta: two sub-phases start before the one ahead of them ends. Done on three
  // consecutive rows held by capacity-exempt crews, so moving them double-books nobody.
  const bs = w.allSecs(B);
  const i = bs.findIndex((o, k) => k > 0 && exempt(bs[k - 1]) && exempt(o) && bs[k + 1] && exempt(bs[k + 1]));
  ok('the scenario has three consecutive capacity-exempt rows to reorder', i > 0, 'i=' + i);
  bs[i].s.start = bs[i - 1].s.start; bs[i + 1].s.start = bs[i - 1].s.start;
  // A double-booking: a limited crew on the same day in Beta and Gamma, on a trade sub-phase.
  const pick = bs.find((o, k) => (k < i - 1 || k > i + 1) && o.s.skill && !o.s.skill.startsWith('@') && w.qualified(o.s.skill).some(c => !c.unlimited) && w.qualified(o.s.skill).length > 1);
  const dupCrew = w.qualified(pick.s.skill).find(c => !c.unlimited);
  const cs = w.allSecs(C);
  const ti = cs.findIndex(o => o.s.num === pick.s.num), twin = cs[ti];
  pick.s.crewId = dupCrew.id; twin.s.crewId = dupCrew.id; twin.s.start = pick.s.start; twin.s.days = pick.s.days;
  // Gamma holds only the twin and the Unassigned rows after it, so the twin's
  // earlier date puts nothing out of order.
  cs.forEach((o, k) => { if (k !== ti && !(k > ti && o.s.crewId === 'unassigned')) o.s.skip = true; });
  const unRows = S.jobs.flatMap(j => w.allSecs(j).filter(o => !o.s.skip && o.s.crewId === 'unassigned').map(() => j.id));

  const all = w.conflicts();
  const groups = w.checkGroups(all);
  const items = groups.reduce((n, g) => n + g.items.length, 0);
  ok('checkGroups loses no finding', items === all.length, items + ' of ' + all.length);

  // ---------- past due: one group per project, rooted at the earliest ----------
  const od = groups.filter(g => g.kind === 'overdue');
  ok('a project past due and unsigned is ONE group', od.length === 1 && od[0].jobId === A.id, od.map(g => g.jobId).join(','));
  ok('it counts every past-due sub-phase', od[0] && od[0].items.length === w.allSecs(A).length, od[0] && od[0].items.length);
  ok('its root is the earliest one', od[0] && od[0].root.act && od[0].root.act.gi === 0 && od[0].root.act.si === 0);

  // ---------- out of order: per project, first one ----------
  const or = groups.filter(g => g.kind === 'order');
  ok('out-of-order starts are one group for the project', or.length === 1 && or[0].jobId === B.id && or[0].items.length === 2, or.map(g => g.items.length).join(','));
  ok('rooted at the first out-of-order sub-phase', or[0] && or[0].root.act && or[0].root.act.gi === bs[i].gi && or[0].root.act.si === bs[i].si);

  // ---------- double-booked: per crew, with alternatives ----------
  const db = groups.filter(g => g.kind === 'double');
  ok('a double-booking groups under its crew', db.length === 1 && db[0].crewId === dupCrew.id, db.map(g => g.crewId).join(','));
  const alts = w.qualified(pick.s.skill).filter(c => c.id !== dupCrew.id).map(c => c.name);
  const fixTxt = db[0] ? db[0].fix.replace(/<[^>]+>/g, '') : '';
  ok('the fix names the other crews that hold the trade', alts.length > 0 && alts.every(n => fixTxt.includes(n)), fixTxt);
  ok('and not the double-booked crew itself', !fixTxt.split(': ').slice(1).join(': ').split('.')[0].includes(dupCrew.name), fixTxt);
  {
    const solo = Object.entries(S.crews.reduce((m, c) => { Object.keys(c.ratings || {}).forEach(k => { (m[k] = m[k] || []).push(c); }); return m; }, {})).find(([k, cs]) => cs.length === 1 && !cs[0].unlimited);
    const g = solo && w.checkGroups([{ kind: 'double', lvl: 'err', crewId: solo[1][0].id, day: '2027-01-04', jobs: ['T-8', 'T-9'], skills: [solo[0]], msg: 'm' }])[0];
    ok('with no other crew holding the trade, the fix says stagger the dates', !!g && /No other crew holds/.test(g.fix), g && g.fix);
  }

  // ---------- Unassigned: one group across every project ----------
  const un = groups.filter(g => g.kind === 'unassigned');
  const unProjects = new Set(unRows).size;
  ok('the scenario has Unassigned rows in more than one project', unProjects > 1, unRows.length + ' rows, ' + unProjects + ' projects');
  ok('Unassigned is one group across projects', un.length === 1 && un[0].items.length === unRows.length && new RegExp(unProjects + ' projects').test(un[0].title.replace(/<[^>]+>/g, '')), un[0] && un[0].title);

  // ---------- order ----------
  const firstWarn = groups.findIndex(g => g.lvl !== 'err');
  ok('errors come before warnings', firstWarn > 0 && groups.slice(firstWarn).every(g => g.lvl !== 'err'));
  const errs_ = groups.filter(g => g.lvl === 'err');
  ok('larger groups first within a level', errs_.every((g, i) => i === 0 || errs_[i - 1].items.length >= g.items.length));

  // ---------- the card ----------
  w.render();
  ok('the card is collapsed by default', !!card() && card().open === false);
  const h2 = card() && card().querySelector('summary h2');
  const errN = all.filter(x => x.lvl === 'err').length, warnN = all.length - errN;
  ok('its summary shows the counts', h2 && /Schedule Check/.test(h2.textContent) && h2.textContent.includes(errN + ' error') && h2.textContent.includes(warnN + ' warning'), h2 && h2.textContent.replace(/\s+/g, ' '));
  ok('and one line per group inside it', card().querySelectorAll('.grp').length === groups.length, card().querySelectorAll('.grp').length + ' vs ' + groups.length);
  card().open = true; card().dispatchEvent(new w.Event('toggle'));
  ok('opening it is remembered', w.getUI().chkOpen === true);
  w.render();
  ok('and survives a redraw', card().open === true);

  // ---------- the links on a past-due group ----------
  const odLine = [...card().querySelectorAll('.grp')].find(el => el.getAttribute('data-kind') === 'overdue');
  ok('a past-due group offers Push from here', !!(odLine && odLine.querySelector('[data-act=push]')));
  const so = odLine && odLine.querySelector('[data-act=signoffs]');
  ok('and Open in Sign-Offs', !!so);
  if (so) { so.click(); }
  ok('which opens Sign-Offs on that project', w.getTab() === 'signoff' && w.getUI().signoffJob === A.id, w.getTab() + ' ' + w.getUI().signoffJob);
  w.document.querySelector('#tabs button[data-t="board"]').click();

  // ---------- escaping ----------
  const was = dupCrew.name; dupCrew.name = '</b></summary><svg id="xss-probe">';
  w.getUI().chkOpen = true; w.render();
  card().querySelectorAll('details').forEach(d => { d.open = true; });
  ok('a hostile crew name is escaped in the card', !w.document.getElementById('xss-probe') && card().textContent.includes('<svg'));
  // The Activate dialog prints conflicts() messages directly, so the message itself must be escaped too.
  const dmsg = w.conflicts().filter(x => x.kind === 'double').map(x => x.msg);
  ok('and in the double-booking message itself', dmsg.length > 0 && dmsg.every(m => !m.includes('<svg') && m.includes('&lt;svg')), dmsg[0] && dmsg[0].slice(0, 80));
  dupCrew.name = was;

  // ---------- all clear ----------
  S.jobs = []; w.render();
  ok('with nothing wrong it says so', card() && /All clear/.test(card().textContent), card() && card().textContent.replace(/\s+/g, ' ').slice(0, 80));

  ok('no jsdom errors', errs.length === 0, errs.join(' | '));
  process.exit(fail);
})().catch(e => { console.log('FAIL · harness threw: ' + (e && e.stack || e)); process.exit(1); });
