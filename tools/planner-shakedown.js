/* Smoke-test every planner surface in a REAL browser, and fail on anything that throws.
 *
 * WHY THIS EXISTS ALONGSIDE fixtures/planner/*.js: those run the planner in jsdom,
 * which cannot see a broken <script src>, a CSS collision, a control that renders
 * but throws on click, or a console error. All twelve of them passed while the
 * vendored MSAL path was wrong (see CLAUDE.md). This drives the actual UI over CDP
 * and treats any console error or exception as a failure.
 *
 * It needs NO tenant access and NO sign-in: it serves web/ locally, which puts the
 * planner in the same hosted mode a PM sees, and injects a payload built from the
 * captured fixtures through the planner's own import path.
 *
 *   cd web && python -m http.server 8787
 *   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<throwaway>
 *   node tools/planner-shakedown.js
 *
 * Use a THROWAWAY Chrome profile: the chrome-devtools MCP cannot attach when Chrome
 * already holds the user's normal profile lock, which has cost this project two
 * sessions. A second Chrome on its own profile runs happily beside the user's.
 *
 * Run it before a demo. It is the cheapest way to find out that a tab throws.
 */
const fs = require('fs');
const path = require('path');
const PORT = Number(process.env.CDP_PORT || 9222);
async function http(p){const r=await fetch('http://127.0.0.1:'+PORT+p,{method:'PUT'});return r.json();}
function connect(ws){return new Promise((res,rej)=>{const s=new WebSocket(ws);let id=0;const w=new Map();const logs=[];
 s.onopen=()=>res({logs,send(m,p={}){return new Promise((ok,no)=>{const i=++id;w.set(i,{ok,no});s.send(JSON.stringify({id:i,method:m,params:p}));});},close:()=>s.close()});
 s.onerror=rej;
 s.onmessage=e=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.consoleAPICalled'&&/error|warning/.test(m.params.type))
    logs.push(m.params.type+': '+(m.params.args||[]).map(a=>a.value||a.description||'').join(' ').slice(0,160));
  if(m.method==='Runtime.exceptionThrown')
    logs.push('EXCEPTION: '+String(m.params.exceptionDetails.text||'')+' '+String(m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||'').slice(0,200));
  if(m.id&&w.has(m.id)){const{ok,no}=w.get(m.id);w.delete(m.id);m.error?no(new Error(JSON.stringify(m.error))):ok(m.result);}};});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let bad=0;
const ok=(label,cond,detail='')=>{console.log((cond?'PASS':'FAIL')+' · '+label+(detail?'  ['+detail+']':''));if(!cond)bad=1;};

(async()=>{
 const t=await http('/json/new?'+encodeURIComponent('http://localhost:8787/index.html'));
 const c=await connect(t.webSocketDebuggerUrl);
 await c.send('Runtime.enable');await c.send('Page.enable');await sleep(1800);
 const ev=async e=>{const r=await c.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});
   if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||'evaluate failed');
   return r.result.value;};

 await ev("localStorage.clear();'ok'");
 const { runExport } = require('../fixtures/planner/run-export.js');
 const payload = await runExport(require('../fixtures/planner/live-payloads.json'));
 await ev(`importFromD2Payload(${JSON.stringify(payload)},true);render();'ok'`);
 await sleep(600);

 ok('three demo pools loaded', await ev('S.jobs.length')===3, 'jobs='+await ev('S.jobs.length'));
 ok('138 sub-phases loaded', await ev('S.jobs.reduce((n,j)=>n+allSecs(j).length,0)')===138);
 ok('hosted mode active (Graph, not the file picker)', await ev('graphModeAvailable()')===true);

 // Every tab must render something and throw nothing.
 for(const tab of ['board','crewboard','dispatch','signoff','jobs','crews','phases']){
   const before=c.logs.length;
   await ev(`document.querySelector('[data-t="${tab}"]').click();'ok'`);
   await sleep(550);
   const html=await ev("document.getElementById('main').innerHTML.length");
   const cards=await ev("document.querySelectorAll('#main .card').length");
   ok(`tab ${tab} renders`, html>400&&cards>0, `${cards} card(s), ${html} chars`);
   if(c.logs.length>before) ok(`tab ${tab} threw nothing`, false, c.logs.slice(before).join(' | '));
 }

 // Schedule Check must report, and errors are the number that matters.
 await ev(`document.querySelector('[data-t="board"]').click();'ok'`);await sleep(500);
 const chk=await ev(`(()=>{const o=conflicts();return {err:o.filter(x=>x.lvl==='err').length,warn:o.filter(x=>x.lvl!=='err').length};})()`);
 console.log('     schedule check on demo data:', JSON.stringify(chk));
 ok('demo data has zero hard errors', chk.err===0, 'errors='+chk.err);

 // The board's left column: dates on every row, and the name opens the editor.
 await ev(`document.querySelector('[data-t="board"]').click();'ok'`);await sleep(600);
 const dt=await ev("[...document.querySelectorAll('#main tbody .dt')].filter(x=>x.textContent.includes('/')).length");
 ok('every board row shows its dates', dt>130, dt+' rows');
 ok('the board opens on TODAY, not the earliest pool date', await ev(`(()=>{
   const tl=document.querySelector('#main .tl'), t=tl.querySelector('th.today');
   if(!t)return false;
   const tlR=tl.getBoundingClientRect(), tR=t.getBoundingClientRect();
   const nmW=tl.querySelector('thead .nm').getBoundingClientRect().width;
   return tl.scrollLeft>0 && tR.left>tlR.left+nmW-1 && tR.right<tlR.right+1;})()`));
 // Batch 1 of the 24 September build. The board must keep its place when a
 // sign-off box far down it is ticked: jsdom cannot see a real scroll container.
 await ev("(()=>{const tl=document.querySelector('#main .tl');tl.scrollTop=250;tl.dispatchEvent(new Event('scroll'));return 1;})()");
 await sleep(150);
 const tickable=await ev("[...document.querySelectorAll('#main tbody .sg input[type=checkbox]')].findIndex(i=>!i.disabled&&!i.checked)");
 if(tickable>=0){
   await ev(`[...document.querySelectorAll('#main tbody .sg input[type=checkbox]')][${tickable}].click();'ok'`);await sleep(450);
   const top=await ev("document.querySelector('#main .tl').scrollTop");
   ok('ticking a sign-off box keeps the board where it was scrolled', top===250, 'scrollTop='+top);
   await ev(`[...document.querySelectorAll('#main tbody .sg input[type=checkbox]')][${tickable}].click();'ok'`);await sleep(450);
 }else ok('a tickable sign-off box exists on the board', false);
 // Zoom narrows the cells, hides the finer header rows, and lands on today.
 await ev("setZoom('week');'ok'");await sleep(450);
 // Cells carry colspans, so the width per day is the row width over the day count.
 const perDay=await ev(`(()=>{const tl=document.querySelector('#main .tl');const tr=tl.querySelector('tbody tr');
   const nmW=tl.querySelector('thead .nm').getBoundingClientRect().width;
   const days=tl.querySelectorAll('thead tr.drow th.dn').length;
   return days?(tr.getBoundingClientRect().width-nmW)/days:0;})()`);
 ok('Week zoom narrows the cells to about 10px a day', perDay>=9&&perDay<=12, 'per day='+perDay.toFixed(2));
 ok('Week zoom hides the day row and keeps the week row', await ev(`(()=>{const tl=document.querySelector('#main .tl');
   return tl.classList.contains('zoom-week')
     &&tl.querySelector('tr.drow').getBoundingClientRect().height===0&&tl.querySelector('tr.wrow').getBoundingClientRect().height>0;})()`)===true);
 const inView=await ev(`(()=>{const tl=document.querySelector('#main .tl'),t=tl.querySelector('th.today');if(!t)return null;
   const nmW=tl.querySelector('thead .nm').getBoundingClientRect().width;const days=tl.querySelectorAll('thead tr.drow th.dn').length;
   const per=(tl.querySelector('tbody tr').getBoundingClientRect().width-nmW)/days;
   return {x:nmW+(+t.dataset.idx)*per-tl.scrollLeft,nmW,cw:tl.clientWidth,scroll:tl.scrollLeft};})()`);
 ok('Week zoom keeps today in view, clear of the name column', !!inView&&inView.scroll>0&&inView.x>=inView.nmW-1&&inView.x<=inView.cw, JSON.stringify(inView));
 await ev("setZoom('month');'ok'");await sleep(450);
 ok('Month zoom shows the months row and hides the weeks', await ev(`(()=>{const tl=document.querySelector('#main .tl');
   return tl.classList.contains('zoom-month')&&tl.querySelector('tr.mrow').getBoundingClientRect().height>0
     &&tl.querySelector('tr.wrow').getBoundingClientRect().height===0;})()`)===true);
 const perDayM=await ev(`(()=>{const tl=document.querySelector('#main .tl');const tr=tl.querySelector('tbody tr');
   const nmW=tl.querySelector('thead .nm').getBoundingClientRect().width;
   const days=tl.querySelectorAll('thead tr.drow th.dn').length;
   return days?(tr.getBoundingClientRect().width-nmW)/days:0;})()`);
 ok('Month zoom narrows the cells to about 4px a day', perDayM>=3.5&&perDayM<=6, 'per day='+perDayM.toFixed(2));
 await ev("setZoom('day');'ok'");await sleep(450);
 ok('Day zoom restores the day row', await ev("document.querySelector('#main .tl tr.drow').getBoundingClientRect().height>0")===true);
 // Edit in place (WP3-B): every editable row carries crew, days and start; a
 // days change reflows the rows below it; the dates column still lines up.
 const icRows=await ev("document.querySelectorAll('#main tbody tr .dt.ic-row').length");
 ok('editable rows carry the inline controls', icRows>50, icRows+' rows');
 ok('every inline row has all three controls', await ev("[...document.querySelectorAll('#main tbody tr .dt.ic-row')].every(d=>d.querySelector('[data-ic=crew]')&&d.querySelector('[data-ic=days]')&&d.querySelector('[data-ic=start]'))")===true);
 const moved=await ev(`(()=>{const j=S.jobs[0];const list=allSecs(j).filter(o=>o.s.base&&o.s.start&&!o.s.skip);
   const i=list.findIndex((o,k)=>!o.s.locked&&!o.s.inst&&list[k+1]&&!list[k+1].s.locked&&!list[k+1].s.inst);
   if(i<0)return null;const a=list[i],b=list[i+1];const before=b.s.start;
   const tr=[...document.querySelectorAll('#main tbody tr')].find(t=>{const x=t.querySelector('.t.sec');return x&&x.getAttribute('onclick').includes("'"+j.id+"'")&&x.querySelector('b').textContent===a.s.num;});
   const inp=tr.querySelector('[data-ic=days]');inp.value=String(a.s.days+3);inp.dispatchEvent(new Event('change'));
   const after=b.s.start;inp.value=String(a.s.base.days);
   const tr2=[...document.querySelectorAll('#main tbody tr')].find(t=>{const x=t.querySelector('.t.sec');return x&&x.getAttribute('onclick').includes("'"+j.id+"'")&&x.querySelector('b').textContent===a.s.num;});
   const inp2=tr2.querySelector('[data-ic=days]');inp2.value=String(a.s.base.days);inp2.dispatchEvent(new Event('change'));
   return {before,after,days:a.s.days};})()`);
 ok('changing days on a row moves the next row', moved&&moved.after>moved.before, JSON.stringify(moved));
 // Live / Planned / Both and the project picker are on the board.
 ok('the board carries the project picker, the status filter and the zoom',
    await ev("!!document.getElementById('boardJob')&&!!document.getElementById('boardStatus')&&!!document.getElementById('boardZoom')")===true);
 // Every sign-off box, sub-phase and phase level, on both tabs that carry them:
 // each must say what Save does with it. A missed copy is how a stale tooltip
 // survived on the phase rows after the sub-phase rows had been corrected.
 for(const tab of ['board','signoff']){
   await ev(`document.querySelector('[data-t="${tab}"]').click();'ok'`);await sleep(500);
   const tips=await ev("[...document.querySelectorAll('#main .sg label')].map(l=>l.title)");
   const wrong=tips.filter(x=>!/Press Save to record it in SharePoint/.test(x)||/field app/i.test(x));
   ok(`${tab}: every sign-off box says Save records it (hosted wording)`, tips.length>0&&wrong.length===0,
      `${tips.length} boxes, ${wrong.length} wrong${wrong.length?': '+wrong[0]:''}`);
 }
 await ev(`document.querySelector('[data-t="board"]').click();'ok'`);await sleep(500);
 ok('the dates column is aligned across row types', await ev(
   "new Set([...document.querySelectorAll('#main tbody .dt')].slice(0,40).map(x=>Math.round(x.getBoundingClientRect().right))).size===1"));
 await ev("[...document.querySelectorAll('#main tbody .t.sec.click')][4].click();'ok'");await sleep(450);
 ok('clicking a sub-phase NAME opens the editor',
    await ev("document.getElementById('drawer').classList.contains('open')")===true);
 ok('the sub-phase panel has a Comments section with an Add comment control',
    await ev("/Comments/.test(document.getElementById('dBody').innerHTML)&&!!document.getElementById('fComment')")===true);
 await ev("closeDrawer();'ok'");await sleep(250);

 // Reject a signed sub-phase through the real controls, then take it back.
 // Queue only: nothing here can write, since there is no token.
 const rj=await ev(`(()=>{for(const j of S.jobs){const h=allSecs(j).find(x=>x.s.inst&&x.s.base&&x.s.base.id!=null);
   if(h){editSec(j.id,h.gi,h.si);return {job:j.id,gi:h.gi,si:h.si};}}return null;})()`);
 await sleep(300);
 if(rj){
   await ev("document.getElementById('fComment').value='shakedown reason';"
     +"[...document.querySelectorAll('#dBody button')].find(b=>b.textContent==='Reject sign-off').click();'ok'");
   await sleep(300);
   ok('Reject sign-off queues the reason and un-ticks Installer',
      await ev(`S.pendingComments.length===1&&S.pendingComments[0].kind==='reject'&&!S.jobs.find(j=>j.id===${JSON.stringify(rj.job)}).groups[${rj.gi}].sections[${rj.si}].inst`)===true);
   ok('the queued reject shows as not saved yet',
      await ev("/Not saved yet/.test(document.getElementById('dBody').innerHTML)")===true);
   await ev("[...document.querySelectorAll('#thread a')].find(a=>a.textContent==='remove').click();'ok'");await sleep(300);
   ok('removing it restores Installer and empties the queue',
      await ev(`S.pendingComments.length===0&&S.jobs.find(j=>j.id===${JSON.stringify(rj.job)}).groups[${rj.gi}].sections[${rj.si}].inst===true`)===true);
   await ev("closeDrawer();'ok'");await sleep(250);
 }else ok('a signed sub-phase exists to reject', false);

 // Auto-Schedule must summarise, not move signed-off work, and leave no rule-3 violation.
 const signedBefore=await ev(`S.jobs.flatMap(j=>allSecs(j)).filter(x=>x.s.inst).map(x=>x.s.start).join(',')`);
 await ev("autoScheduleRun();'ok'");await sleep(800);
 ok('Auto-Schedule reports what it did', /how auto-schedule decides/i.test(
    await ev("document.getElementById('dBody').innerText")));
 await ev("closeDrawer();'ok'");await sleep(300);
 const signedAfter=await ev(`S.jobs.flatMap(j=>allSecs(j)).filter(x=>x.s.inst).map(x=>x.s.start).join(',')`);
 ok('Auto-Schedule leaves signed-off work alone', signedBefore===signedAfter);
 const after=await ev(`(()=>{const o=conflicts();return o.filter(x=>x.lvl==='err').length;})()`);
 ok('Auto-Schedule introduces no errors', after===0, 'errors='+after);

 // Save preview must open, list real changes, and send nothing.
 await ev(`(()=>{const j=S.jobs[0];const x=allSecs(j).find(y=>!y.s.locked&&!y.s.inst&&!y.s.skip);
    x.s.crewId='devon';touch(j);return 1;})()`);
 await ev("openSavePreview();'ok'");await sleep(600);
 const drawerOpen=await ev("document.getElementById('drawer').classList.contains('open')");
 const previewText=await ev("document.getElementById('dBody').innerText.slice(0,120)");
 ok('Save preview opens with something to push', drawerOpen===true, previewText.replace(/\s+/g,' '));
 ok('Save preview says it writes to SharePoint (hosted wording)',
    /writes to SharePoint/i.test(await ev("document.getElementById('dBody').innerText")));
 await ev("closeDrawer();'ok'");

 // + Job dialog must open and carry the crews checkbox.
 await ev("addJob();'ok'");await sleep(500);
 const addBody=await ev("document.getElementById('dBody').innerText");
 ok('+ Job dialog opens', await ev("document.getElementById('drawer').classList.contains('open')")===true);
 ok('+ Job warns about the build time', /minut/i.test(addBody), (addBody.match(/.{0,60}minut.{0,40}/i)||[''])[0].replace(/\s+/g,' '));
 ok('+ Job carries the default-crews choice', /crew/i.test(addBody));
 await ev("closeDrawer();'ok'");

 // Open schedule lands on the Board showing that one project; Back to planning
 // sits on every Active project.
 await ev(`document.querySelector('[data-t="jobs"]').click();'ok'`);await sleep(500);
 const backBtns=await ev("[...document.querySelectorAll('#main button')].filter(b=>/Back to planning/.test(b.textContent)).length");
 ok('every Active project offers Back to planning', backBtns===3, 'buttons='+backBtns);
 ok('every project has an editable Start', await ev("document.querySelectorAll('#main input[type=date][data-reset]').length")===3);
 await ev("document.querySelector('#main [data-open-schedule]').click();'ok'");await sleep(600);
 ok('Open schedule lands on the Board showing one project',
    await ev("TAB==='board'&&document.querySelectorAll('#main tr.jobrow').length===1")===true);
 await ev("UI.boardJob='';render();'ok'");await sleep(300);
 // Activate only offers itself on a Planned pool.
 await ev(`document.querySelector('[data-t="jobs"]').click();'ok'`);await sleep(500);
 const commitsNow=await ev("[...document.querySelectorAll('#main button')].filter(b=>b.textContent==='Activate').length");
 await ev(`(()=>{S.jobs[0].status='Planned';render();return 1;})()`);await sleep(400);
 const commitsPlanned=await ev("[...document.querySelectorAll('#main button')].filter(b=>b.textContent==='Activate').length");
 ok('Activate appears only on a Planned pool', commitsNow===0&&commitsPlanned===1,
    `active=${commitsNow} planned=${commitsPlanned}`);

 // Spec A: Completed projects renders on the Jobs tab with Open and Reopen, and a project whose
 // every sub-phase is signed or N/A is offered Mark complete. No Graph needed to render either.
 await ev(`(()=>{S.completedJobs=[{id:99,jobno:'D2-0999',name:'Finished Residence',pm:'Cody Campbell',completedOn:'2026-09-30T15:00:00Z'}];
   const j=S.jobs.find(x=>x.status==='Active');allSecs(j).forEach(({s})=>{s.inst=true;});render();return 1;})()`);await sleep(400);
 ok('Completed projects lists a finished project with Open and Reopen', await ev(`(()=>{const d=document.querySelector('#main [data-completed]');
   return !!d&&/Completed projects \\(1\\)/.test(d.textContent)&&[...d.querySelectorAll('button')].map(b=>b.textContent.trim()).join(',')==='Open,Reopen';})()`)===true);
 ok('a fully signed Active project is offered Mark complete',
    await ev("[...document.querySelectorAll('#main button')].some(b=>b.textContent==='Mark complete')")===true);
 ok('the ready banner names it', await ev("!!document.querySelector('#main [data-ready-banner]')")===true);

 console.log('\nconsole during shakedown:', c.logs.length?c.logs.join('\n  '):'clean');
 if(c.logs.length)bad=1;
 await c.send('Page.close').catch(()=>{});c.close();
 process.exit(bad);
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
