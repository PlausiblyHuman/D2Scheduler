const path=require('path');
const PLANNER = path.resolve(__dirname,'../../web/index.html');
const {JSDOM, VirtualConsole} = require('jsdom');
const fs = require('fs');
const target = process.argv[2] || PLANNER;
let html = fs.readFileSync(target, 'utf8');
html = html.replace('</body>',
  `<script>window.__expose=()=>{window.S=S;window.autoSchedule=autoSchedule;window.newJob=newJob;};</script>
   <script>__expose();</script></body>`);
const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'http://localhost/', virtualConsole:vc});
const win = dom.window;

(async () => {
  await new Promise(r => setTimeout(r, 500));
  const S = win.S;
  if (!S) { console.log('FAIL: state not loaded'); process.exit(2); }
  // The planner no longer seeds demo pools (removed 2026-09-11), so a fresh
  // load leaves S.jobs empty and every comparison below was passing vacuously
  // against 0 assignments -- a "STABLE" result that measured nothing. Seed
  // three pools directly via newJob() (2026-09-12: `+ Job` / #addJobBtn no
  // longer builds a local pool at all -- it opens a New Pool Requests form
  // instead, see fixtures/planner/writeback.js), pushing and re-scheduling
  // one at a time exactly as the old addJob() did per click, matching the
  // 46 x 3 = 138 scale this harness was originally built against, so the
  // crew-load tiebreak this test exists to catch actually has candidates to
  // tie.
  // Ratings: crews that share a skill carry different ratings, so the rating sort key
  // (not only the load tiebreak) is exercised by the three runs below.
  const rate = (id, sk, n) => { const c = S.crews.find(x => x.id === id); if (c && c.ratings) c.ratings[sk] = n; };
  rate('harrison', 'dig', 2); rate('saul', 'dig', 1); rate('guillermo', 'dig', 3);
  const rated = S.crews.filter(c => c.ratings && c.ratings.dig != null).map(c => c.ratings.dig);
  console.log('(dig ratings in play: ' + rated.join(',') + ')');
  if (new Set(rated).size < 2) { console.log('FAIL: ratings not seeded'); process.exit(2); }
  if (S.jobs.length === 0) {
    for (let i = 0; i < 3; i++) { S.jobs.push(win.newJob('New Job','','','','','2026-09-08')); win.autoSchedule(); }
    console.log(`(harness seeded ${S.jobs.length} pools -- the tool ships with none)`);
  }
  const snap = () => S.jobs.flatMap(j => j.groups.flatMap(g => g.sections.map(s =>
      j.jobno+'|'+s.num+'|'+(s.crewId||'-')+'|'+(s.start||'-'))));
  // settle
  win.autoSchedule();
  const a = snap();
  win.autoSchedule();
  const b = snap();
  win.autoSchedule();
  const c = snap();
  const diff = (x,y) => x.reduce((n,v,i)=> n + (v===y[i]?0:1), 0);
  const crewDrift = (x,y) => x.reduce((n,v,i)=>{
    const p=v.split('|'), q=y[i].split('|'); return n + (p[2]===q[2]?0:1); },0);
  console.log('assignments compared : ' + a.length);
  console.log('run1 -> run2  changed: ' + diff(a,b) + '   (crew picks: ' + crewDrift(a,b) + ')');
  console.log('run2 -> run3  changed: ' + diff(b,c) + '   (crew picks: ' + crewDrift(b,c) + ')');
  const stable = diff(a,b)===0 && diff(b,c)===0;
  console.log(stable ? '\nSTABLE: Auto-Schedule is idempotent from a settled state.'
                     : '\nUNSTABLE: re-running Auto-Schedule still moves assignments.');
  process.exit(stable?0:1);
})();
