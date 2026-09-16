/* Capture the drawer and dialog states the demo run sheet and PM guide need.
 *
 * Companion to capture-planner-screens.js, which does the tabs. This does the
 * things only reachable by clicking: the sub-phase panel, the Save preview, the
 * + Job form, the Activate dialog, the Auto-Schedule summary and its rules list,
 * and the Jobs tab with a Planned pool so Activate is visible at all.
 *
 *   node tools/capture-planner-drawers.js <outputDir>
 *
 * Same rig as capture-planner-screens.js: a static server on 8787 serving web/,
 * and Chrome on a THROWAWAY profile with --remote-debugging-port. CDP_PORT
 * overrides the default. No tenant access and no sign-in.
 *
 * TWO CLIPPING TRAPS, both of which produced figures that looked fine:
 *  * The drawer is full-height and its body flexes to fill, so its height and
 *    scrollHeight both report the whole panel. Clip from the last child of
 *    #dBody instead.
 *  * #dBody is overflow:auto, so on a tall summary everything past its own
 *    height is clipped and never paints. unclip() lifts that for the capture
 *    and puts it back after.
 */
const fs = require('fs');
const PORT = Number(process.env.CDP_PORT || 9223);
async function http(p){const r=await fetch('http://127.0.0.1:'+PORT+p,{method:'PUT'});return r.json();}
function connect(ws){return new Promise((res,rej)=>{const s=new WebSocket(ws);let id=0;const w=new Map();
 s.onopen=()=>res({send(m,p={}){return new Promise((ok,no)=>{const i=++id;w.set(i,{ok,no});s.send(JSON.stringify({id:i,method:m,params:p}));});},close:()=>s.close()});
 s.onerror=rej;s.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w.has(m.id)){const{ok,no}=w.get(m.id);w.delete(m.id);m.error?no(new Error(JSON.stringify(m.error))):ok(m.result);}};});}
const OUT = process.argv[2] || '.';
const path = require('path');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
 const t=await http('/json/new?'+encodeURIComponent('http://localhost:8787/index.html'));
 const c=await connect(t.webSocketDebuggerUrl);
 await c.send('Page.enable');await c.send('Runtime.enable');await sleep(1800);
 const ev=async e=>{const r=await c.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});
   if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||'evaluate failed');return r.result.value;};

 const {runExport}=require('../fixtures/planner/run-export.js');
 const payload=await runExport(require('../fixtures/planner/live-payloads.json'));
 await ev("localStorage.clear();'ok'");
 await ev(`importFromD2Payload(${JSON.stringify(payload)},true);render();'ok'`);
 await sleep(600);

 /* Clip a drawer to its real content: the drawer element is full-height, so
    measuring it directly leaves most of the figure blank. The footer's bottom
    edge is where the content actually ends. */
 /* A drawer body is overflow:auto, so anything past its own height is clipped
    and never paints into a screenshot. For the tall ones, unclip it for the
    capture and put it back afterwards. */
 const unclip=async on=>ev(`(()=>{const b=document.getElementById('dBody'),d=document.getElementById('drawer');
   if(${on}){b.dataset.o=b.style.cssText;d.dataset.o=d.style.cssText;
     b.style.overflow='visible';b.style.maxHeight='none';b.style.height='auto';
     d.style.height='auto';d.style.maxHeight='none';}
   else {b.style.cssText=b.dataset.o||'';d.style.cssText=d.dataset.o||'';}
   return 1;})()`);
 const shotEl=async (sel,name,maxh=900)=>{
   const box=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});
     if(!e)return null;const r=e.getBoundingClientRect();
     let h=r.height;
     const bd=e.querySelector('#dBody'), ft=e.querySelector('#dFoot');
     if(bd&&bd.children.length){
       let bot=0;
       for(const k of bd.children){const kr=k.getBoundingClientRect(); if(kr.bottom>bot)bot=kr.bottom;}
       const ftH=ft?ft.getBoundingClientRect().height:0;
       h=(bot-r.top)+ftH+28;
     }
     return {x:Math.max(0,r.x+scrollX-8),y:Math.max(0,r.y+scrollY-8),
             w:Math.min(1440,r.width+16),h:Math.min(${maxh},h+16)};})()`);
   if(!box){console.log('  MISS',name,sel);return;}
   const img=await c.send('Page.captureScreenshot',{format:'jpeg',quality:82,captureBeyondViewport:true,
     clip:{x:box.x,y:box.y,width:box.w,height:box.h,scale:1}});
   fs.mkdirSync(OUT,{recursive:true});
   fs.writeFileSync(path.join(OUT,`fig-${name}.jpg`),Buffer.from(img.data,'base64'));
   console.log(`  ${path.join(OUT,'fig-'+name+'.jpg')}  ${Math.round(box.w)}x${Math.round(box.h)}  ${Math.round(img.data.length*0.75/1024)}KB`);
 };

 // 1. Jobs tab WITH a Planned pool, so the Activate button is visible.
 await ev(`(()=>{const j=S.jobs.find(x=>/Reyes/.test(x.name));j.status='Planned';render();return 1;})()`);
 await ev(`document.querySelector('[data-t="jobs"]').click();'ok'`);await sleep(650);
 await shotEl('#main .card','jobs-planned',320);

 // 2. The Activate dialog, on a pool that has conflicts so the warning block shows.
 await ev(`(()=>{const j=S.jobs.find(x=>/Reyes/.test(x.name));activatePool(j.id);return 1;})()`);
 await sleep(600);
 await shotEl('#drawer','activate',760);
 await ev("closeDrawer();'ok'");await sleep(300);

 // 3. The sub-phase drawer: crew, days, lock, checklist.
 await ev(`document.querySelector('[data-t="board"]').click();'ok'`);await sleep(500);
 await ev(`(()=>{const j=S.jobs.find(x=>/Salcedo/.test(x.name));
   const all=allSecs(j);const i=all.findIndex(x=>x.s.num==='4.3');
   const k=i>=0?i:all.findIndex(x=>!x.s.locked&&!x.s.inst&&!x.s.skip&&x.s.tasks.length);
   editSec(j.id,all[k].gi,all[k].si);return all[k].s.num;})()`);
 await sleep(600);
 await shotEl('#drawer','drawer',900);
 await ev("closeDrawer();'ok'");await sleep(300);

 // 4. The Save preview, with a couple of real changes queued.
 await ev(`(()=>{const j=S.jobs.find(x=>/Salcedo/.test(x.name));
   const all=allSecs(j).filter(x=>!x.s.locked&&!x.s.inst&&!x.s.skip);
   all[0].s.crewId='devon'; all[1].s.days=5; touch(j); return 1;})()`);
 await ev("openSavePreview();'ok'");await sleep(700);
 await shotEl('#drawer','savepreview',860);
 await ev("closeDrawer();'ok'");await sleep(300);

 // 5. The + Job form.
 await ev("addJob();'ok'");await sleep(600);
 await shotEl('#drawer','newjob',860);
 await ev("closeDrawer();'ok'");await sleep(300);

 // 6. The Auto-Schedule summary, which only exists after it has run.
 await ev("autoScheduleRun();'ok'");await sleep(900);
 await unclip(true); await sleep(350);
 await shotEl('#drawer','autoschedule',780);
 // and the rules block on its own, since that is the part people need to read
 await shotEl('#dBody .fld:last-child','autorules',600);
 await unclip(false);
 await ev("undoAutoSchedule();'ok'");

 await c.send('Page.close').catch(()=>{});c.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
