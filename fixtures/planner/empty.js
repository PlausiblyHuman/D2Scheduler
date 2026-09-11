const path=require('path');
const PLANNER = path.resolve(__dirname,'../../D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html');
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');
const P=PLANNER;
let h=fs.readFileSync(P,'utf8').replace('</body>',`<script>window.__x=()=>{window.S=S;window.autoSchedule=autoSchedule;};</script><script>__x();</script></body>`);
const errs=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errs.push(e.message));
const d=new JSDOM(h,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/',virtualConsole:vc});
setTimeout(()=>{
 const w=d.window;
 console.log('jobs seeded          :',w.S?w.S.jobs.length:'NO STATE');
 console.log('crews seeded         :',w.S?w.S.crews.length:'-');
 console.log('template sub-phases  :',w.S?w.S.template.reduce((n,g)=>n+g.sections.length,0):'-');
 console.log('jsdom errors         :',errs.length?errs.join(' | '):'none');
 console.log('Load from D2 button  :',!!w.document.getElementById('d2Btn'));
 let t=false; try{w.autoSchedule();t=true}catch(e){console.log('autoSchedule threw:',e.message)}
 console.log('autoSchedule on empty:',t?'OK':'THREW');
 const main=w.document.getElementById('main');
 console.log('main rendered chars  :',main?main.innerHTML.length:0);
},700);
