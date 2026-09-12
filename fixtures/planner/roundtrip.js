const path=require('path');
const PLANNER = path.resolve(__dirname,'../../web/index.html');
const {JSDOM, VirtualConsole} = require('jsdom');
const fs = require('fs');
const P = PLANNER;
let html = fs.readFileSync(P,'utf8').replace('</body>',
 `<script>window.__x=()=>{window.S=S;window.autoSchedule=autoSchedule;window.importFromD2=importFromD2;window.allSecs=allSecs;window.SEED_TEMPLATE=SEED_TEMPLATE;window.render=render;window.newJob=newJob;};</script><script>__x();</script></body>`);
const vc=new VirtualConsole(); vc.on('jsdomError',e=>console.log('[jsdom]',e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/',virtualConsole:vc});
const win=dom.window;
let alerts=[];
win.confirm=()=>true; win.alert=m=>alerts.push(m);

const ok=(l,c,d='')=>{console.log((c?'PASS':'FAIL')+' · '+l+(d?'  ['+d+']':'')); if(!c)process.exitCode=1;};

(async()=>{
  await new Promise(r=>setTimeout(r,600));
  const S=win.S;
  if(!S){console.log('FAIL: no state');process.exit(2);}

  // --- a pool sketched locally that SharePoint has never heard of ---
  // Built directly via newJob(), not through the +Job button: as of
  // 2026-09-12 that button no longer creates a local pool at all -- it opens
  // a New Pool Requests form instead (see fixtures/planner/writeback.js for
  // that behaviour). newJob() is still exactly what a locally-sketched pool
  // looks like -- importFromD2 uses it too, for a pool SharePoint has that
  // this browser does not yet -- so it is the right thing to construct here.
  ok('first run seeds NO phantom pools', S.jobs.length===0, S.jobs.length+' jobs');
  const localJob = win.newJob('Sketch Only','','','','','2026-09-08');
  localJob.jobno='LOCAL-1';
  S.jobs.push(localJob);
  const localSecsBefore = JSON.stringify(win.allSecs(localJob).map(x=>x.s.crewId+'|'+x.s.start));

  // --- build a payload shaped exactly like export-to-planner.js emits ---
  const T=win.SEED_TEMPLATE;
  const secDefs=T.flatMap(g=>g.sections.map(s=>({num:s.num,name:s.name,tasks:s.tasks})));
  const mk=(jobno,name,start,finishedCount,signedCount)=>({
    jobno,name,addr:'1 Test Way',city:'Nashville',start,status:'Active',pm:'Cody Campbell',
    sections:secDefs.map((s,i)=>({
      num:s.num,name:s.name,
      crewId:(i%3===0?'devon':i%3===1?'stl':'office'),
      start:'2026-0'+(1+(i%8))+'-1'+(i%9), finish:'2026-0'+(1+(i%8))+'-1'+(i%9),
      days:2, skip:false, locked:false,
      inst: i<signedCount, pm:false,
      tasks:s.tasks.map((t,k)=>({seq:k+1,title:t,done: i<finishedCount}))
    }))
  });
  const payload={app:'D2 Pool Build Scheduler',kind:'d2-sharepoint-export',
    exported:'2026-09-11',site:'https://example',
    jobs:[ mk('D2-1042','Reyes Residence','2026-09-08',1,1),
           mk('D2-1043','Whitfield Estate','2026-06-15',37,35),
           mk('D2-1044','Salcedo Residence','2026-08-10',13,12) ]};

  const file=new win.File([JSON.stringify(payload)],'d2.json',{type:'application/json'});
  win.importFromD2(file);
  await new Promise(r=>setTimeout(r,400));

  ok('import ran without throwing', alerts.length>0, alerts[0]?alerts[0].split('\n')[0]:'no alert');
  ok('local-only pool survived', !!S.jobs.find(j=>j.jobno==='LOCAL-1'));
  ok('local-only pool untouched',
     JSON.stringify(win.allSecs(S.jobs.find(j=>j.jobno==='LOCAL-1')).map(x=>x.s.crewId+'|'+x.s.start))===localSecsBefore);
  ok('all 3 live pools present', ['D2-1042','D2-1043','D2-1044'].every(n=>S.jobs.some(j=>j.jobno===n)),
     S.jobs.map(j=>j.jobno).join(','));

  const w=S.jobs.find(j=>j.jobno==='D2-1043');
  const ws=win.allSecs(w).map(x=>x.s);
  ok('46 sub-phases on an imported pool', ws.length===46, ws.length+'');
  ok('crew codes landed', ws[0].crewId==='devon'&&ws[1].crewId==='stl', ws.slice(0,3).map(s=>s.crewId).join(','));
  ok('dates landed', !!ws[0].start, ws[0].start||'null');
  ok('sign-off landed', ws.filter(s=>s.inst).length===35, ws.filter(s=>s.inst).length+' of 35');
  ok('signed work is LOCKED against Auto-Schedule', ws.filter(s=>s.inst).every(s=>s.locked));
  const ticked=ws.reduce((n,s)=>n+s.tasks.filter(t=>t.done).length,0);
  ok('task ticks landed', ticked>0, ticked+' tasks done');
  ok('task text still from local template', ws[0].tasks[0].t==='Contract review', ws[0].tasks[0].t);

  // --- the real trap: does Auto-Schedule move completed work? ---
  const before=ws.map(s=>s.crewId+'|'+s.start);
  win.autoSchedule();
  const after=win.allSecs(S.jobs.find(j=>j.jobno==='D2-1043')).map(x=>x.s);
  let movedSigned=0, movedUnsigned=0;
  after.forEach((s,i)=>{ const chg=(s.crewId+'|'+s.start)!==before[i];
    if(chg){ if(s.inst) movedSigned++; else movedUnsigned++; } });
  ok('Auto-Schedule did NOT move signed-off work', movedSigned===0, movedSigned+' signed rows moved');
  console.log('     (unsigned rows replanned by Auto-Schedule: '+movedUnsigned+' — expected, that is the point)');

  // --- idempotent import ---
  const snap=()=>S.jobs.flatMap(j=>win.allSecs(j).map(x=>j.jobno+'|'+x.s.num+'|'+x.s.crewId+'|'+x.s.start+'|'+x.s.inst));
  const s1=snap();
  win.importFromD2(new win.File([JSON.stringify(payload)],'d2.json',{type:'application/json'}));
  await new Promise(r=>setTimeout(r,400));
  const s2=snap();
  ok('re-import is idempotent (no pool duplication)', S.jobs.length===4, S.jobs.length+' jobs');

  // --- rejects the wrong file ---
  alerts=[];
  win.importFromD2(new win.File([JSON.stringify({state:{jobs:[],crews:[],template:[]}})],'b.json',{type:'application/json'}));
  await new Promise(r=>setTimeout(r,300));
  ok('rejects a plain backup file', alerts.some(a=>/not a D2 SharePoint export/.test(a)));
})();
