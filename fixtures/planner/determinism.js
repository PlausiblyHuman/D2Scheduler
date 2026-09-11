const path=require('path');
const PLANNER = path.resolve(__dirname,'../../D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html');
const {JSDOM, VirtualConsole} = require('jsdom');
const fs = require('fs');
const target = process.argv[2] || PLANNER;
let html = fs.readFileSync(target, 'utf8');
html = html.replace('</body>',
  `<script>window.__expose=()=>{window.S=S;window.autoSchedule=autoSchedule;};</script>
   <script>__expose();</script></body>`);
const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'http://localhost/', virtualConsole:vc});
const win = dom.window;

(async () => {
  await new Promise(r => setTimeout(r, 500));
  const S = win.S;
  if (!S) { console.log('FAIL: state not loaded'); process.exit(2); }
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
