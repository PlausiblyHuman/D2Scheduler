const {JSDOM, VirtualConsole} = require('jsdom');
const fs = require('fs');
// Repaired 2026-09-11: this pointed at a build sandbox that no longer exists,
// so the harness could not run at all. Now resolves inside the repo.
const nodepath = require('path');
const path = process.argv[2] || nodepath.resolve(__dirname,'web/index.html');
let html = fs.readFileSync(path, 'utf8');

// Append an expose script so we can introspect the module-scoped `let` bindings.
html = html.replace('</body>',
  `<script>window.__expose=()=>{window.S=S;window.autoSchedule=autoSchedule;window.conflicts=conflicts;window.crew=crew;window.isQualified=isQualified;window.workSpan=workSpan;window.FIXED=FIXED;window.qualified=qualified;window.newJob=newJob;};</script>
   <script>__expose();</script></body>`);

const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('[jsdom]', e.message));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;

(async () => {
await new Promise(r => setTimeout(r, 400));
const S = win.S;
const TPL = win.templateFor("Gunite");
if (!S) { console.log('FAIL: state not loaded'); process.exit(2); }

// The planner no longer seeds demo pools (removed 2026-09-11 -- they were three
// fictional California jobs that matched nothing in SharePoint). Without jobs,
// most invariants below pass VACUOUSLY: "no Sunday in any span" over zero spans,
// "no crew double-booked" over zero assignments. So the harness builds its own
// two pools. Two, not one, because the double-book check needs a second job.
if (S.jobs.length === 0) {
  // Built directly via newJob() -- #addJobBtn no longer creates a local pool
  // as of 2026-09-12, it opens a New Pool Requests form instead (see
  // fixtures/planner/writeback.js).
  S.jobs.push(win.newJob('New Job','','','','','2026-09-08'));
  S.jobs.push(win.newJob('New Job','','','','','2026-09-08'));
  win.autoSchedule();
  console.log(`(harness seeded ${S.jobs.length} pools -- the tool ships with none)`);
}

const results = [];
const check = (label, cond, detail='') => { results.push({label, pass: !!cond, detail}); console.log((cond?'PASS':'FAIL')+' · '+label+(detail?'  ['+detail+']':'')); };

console.log(`\nSeed: ${S.jobs.length} jobs, ${S.crews.length} crews, ${TPL.length} phases`);
const totalSubs = TPL.reduce((n,g)=>n+g.sections.length,0);
const totalTasks = TPL.reduce((n,g)=>n+g.sections.reduce((m,s)=>m+s.tasks.length,0),0);
console.log(`Template: ${totalSubs} sub-phases, ${totalTasks} tasks\n`);

// 1) No Sunday in any scheduled span
{
  const spans=[]; S.jobs.forEach(j=>j.groups.forEach(g=>g.sections.forEach(s=>{
    if(s.skip||!s.start)return; win.workSpan(s.start,s.days).forEach(d=>spans.push(d));})));
  const sun = spans.filter(d => new Date(d+'T00:00:00').getDay()===0);
  check('Mon-Sat only (no Sunday in any span)', sun.length===0, sun.length?`first Sunday: ${sun[0]}`:`${spans.length} days sampled`);
}
// 2) Assigned crews are qualified
{
  let bad=null;
  S.jobs.forEach(j=>j.groups.forEach(g=>g.sections.forEach(s=>{
    if(s.skip||!s.crewId||!s.skill)return;
    const c=win.crew(s.crewId);
    if(c&&!win.isQualified(c,s.skill))bad=`${j.name} ${s.num}: ${c.name} not qualified for ${s.skill}`;
  })));
  check('Every assigned crew is qualified', !bad, bad||'all valid');
}
// 3) Sub-phase sequence
{
  let bad=null;
  S.jobs.forEach(j=>{ let pe=null;
    j.groups.forEach(g=>g.sections.forEach(s=>{
      if(s.skip||!s.start)return;
      if(pe&&s.start<=pe)bad=`${j.name} ${s.num} starts ${s.start} <= prior end ${pe}`;
      pe=win.workSpan(s.start,s.days).pop();
    }));
  });
  check('Sub-phases run in sequence (no overlap)', !bad, bad||'chain intact');
}
// 4) No field crew double-booked
{
  const bd={};
  S.jobs.forEach(j=>j.groups.forEach(g=>g.sections.forEach(s=>{
    if(s.skip||!s.crewId||!s.start)return;
    const c=win.crew(s.crewId); if(!c||c.unlimited)return;
    win.workSpan(s.start,s.days).forEach(d=>{const k=c.id+'|'+d; bd[k]=(bd[k]||0)+1;});
  })));
  const cl=Object.entries(bd).filter(([_,n])=>n>1);
  check('No field crew double-booked', cl.length===0, cl.length?`first: ${cl[0][0]}`:'clean');
}
// 5) conflicts() on seed
{
  const c=win.conflicts(); const errs=c.filter(x=>x.lvl==='err');
  check('conflicts() 0 errs on seed', errs.length===0, errs.length?`first: ${errs[0].msg.replace(/<[^>]+>/g,'')}`:`${c.length} warnings only`);
}
// 6) Forced double-book detected
{
  let src=null,dst=null;
  outer: for(const j of S.jobs) for(const g of j.groups) for(const s of g.sections){
    if(s.skip||!s.crewId||!s.start)continue;
    const c=win.crew(s.crewId); if(!c||c.unlimited)continue;
    if(!src){src={j,s,c};continue;}
    if(j.id!==src.j.id){dst={j,s};break outer;}
  }
  if(src&&dst){
    const o={crewId:dst.s.crewId,start:dst.s.start};
    dst.s.crewId=src.c.id; dst.s.start=src.s.start;
    const c=win.conflicts();
    const db=c.find(x=>x.lvl==='err'&&/double-booked/.test(x.msg));
    check('Forced double-book detected', !!db, db?'caught':'MISSED');
    dst.s.crewId=o.crewId; dst.s.start=o.start;
  } else check('Force double-book setup', false, 'no two field crews');
}
// 7) Unqualified assignment detected
{
  let t=null;
  outer: for(const j of S.jobs) for(const g of j.groups) for(const s of g.sections){
    if(s.skill&&s.crewId){t={j,s};break outer;}
  }
  if(t){
    const wrong=S.crews.find(c=>!c.unlimited&&!win.isQualified(c,t.s.skill));
    if(wrong){
      const o=t.s.crewId; t.s.crewId=wrong.id;
      const c=win.conflicts();
      const err=c.find(x=>x.lvl==='err'&&/not qualified/.test(x.msg));
      check('Unqualified crew assignment detected', !!err, err?'caught':'MISSED');
      t.s.crewId=o;
    } else check('Unqualified test setup', false, 'no unqualified candidate');
  }
}
// 8) Auto-Schedule idempotent
{
  const s1=JSON.stringify(S.jobs.map(j=>j.groups.map(g=>g.sections.map(s=>[s.crewId,s.start]))));
  win.autoSchedule();
  const s2=JSON.stringify(S.jobs.map(j=>j.groups.map(g=>g.sections.map(s=>[s.crewId,s.start]))));
  check('Auto-Schedule idempotent from settled state', s1===s2, s1===s2?'stable':'DRIFTED');
}
// 9) Work-calendar support
{
  const hasHol = /holiday|Holiday|nonwork|non-work|workcalendar|weather/.test(fs.readFileSync(path,'utf8'));
  check('Work-calendar support (holiday/weather)', hasHol, hasHol?'found':'NOT PRESENT — oracle limitation vs d2_workcalendar');
}
// 10) Trade-tagged sub-phases must have qualified crew
{
  const orph=[];
  TPL.forEach(g=>g.sections.forEach(s=>{
    if(!s.skill||win.FIXED[s.skill])return;
    if(S.crews.filter(c=>c.skills.includes(s.skill)).length===0)orph.push(`${s.num} ${s.name} (${s.skill})`);
  }));
  check('Every trade-tagged sub-phase has qualified crew', orph.length===0, orph.length?`${orph.length} orphans, e.g. ${orph[0]}`:'covered');
}
// 11) Every declared trade used
{
  const inU=new Set(); TPL.forEach(g=>g.sections.forEach(s=>{if(s.skill)inU.add(s.skill);}));
  const decl=new Set(); S.crews.forEach(c=>c.skills.forEach(k=>decl.add(k)));
  const un=[...decl].filter(k=>!inU.has(k));
  check('Every declared trade used by a sub-phase', un.length===0, un.length?`${un.length} unmapped: ${un.slice(0,6).join(', ')}`:'all used');
}
// 12) crewIds resolve
{
  const V=new Set(S.crews.map(c=>c.id)); let bad=null;
  S.jobs.forEach(j=>j.groups.forEach(g=>g.sections.forEach(s=>{
    if(s.crewId&&!V.has(s.crewId))bad=`${j.name} ${s.num} -> ${s.crewId}`;
  })));
  check('All assigned crewIds resolve', !bad, bad||'all resolve');
}
// 13) README counts
check('Template phase count = 8', TPL.length===8, `actual: ${TPL.length}`);
check('Template sub-phase count = 46', totalSubs===46, `actual: ${totalSubs}`);
check('Template task count = 295', totalTasks===295, `actual: ${totalTasks}`);
check('Crew count = 14', S.crews.length===14, `actual: ${S.crews.length}`);

const p = results.filter(r=>r.pass).length;
console.log(`\n=== ${p}/${results.length} passed ===`);
process.exit(0);
})();
