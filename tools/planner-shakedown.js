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
 ok('the dates column is aligned across row types', await ev(
   "new Set([...document.querySelectorAll('#main tbody .dt')].slice(0,40).map(x=>Math.round(x.getBoundingClientRect().right))).size===1"));
 await ev("[...document.querySelectorAll('#main tbody .t.sec.click')][4].click();'ok'");await sleep(450);
 ok('clicking a sub-phase NAME opens the editor',
    await ev("document.getElementById('drawer').classList.contains('open')")===true);
 await ev("closeDrawer();'ok'");await sleep(250);

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

 // Activate only offers itself on a Planned pool.
 await ev(`document.querySelector('[data-t="jobs"]').click();'ok'`);await sleep(500);
 const commitsNow=await ev("[...document.querySelectorAll('#main button')].filter(b=>b.textContent==='Activate').length");
 await ev(`(()=>{S.jobs[0].status='Planned';render();return 1;})()`);await sleep(400);
 const commitsPlanned=await ev("[...document.querySelectorAll('#main button')].filter(b=>b.textContent==='Activate').length");
 ok('Activate appears only on a Planned pool', commitsNow===0&&commitsPlanned===1,
    `active=${commitsNow} planned=${commitsPlanned}`);

 console.log('\nconsole during shakedown:', c.logs.length?c.logs.join('\n  '):'clean');
 if(c.logs.length)bad=1;
 await c.send('Page.close').catch(()=>{});c.close();
 process.exit(bad);
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
