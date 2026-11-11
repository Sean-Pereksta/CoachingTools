'use strict';
// Real Horizon desktop/iframe regression; all imported data is synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((request,response)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(request.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
 fs.readFile(file,(error,content)=>{if(error){response.writeHead(404).end();return;}response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/octet-stream');response.end(content);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.fixtureEvents=[];for(const type of ['coachtools:data-updated','coachtools:scope-updated','coachtools:identity-updated'])window.addEventListener(type,event=>fixtureEvents.push({type,at:performance.now(),reason:event.detail?.reason,relayed:event.detail?.relayed,version:event.detail?.identityVersion}));});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(()=>window.CoachToolsData&&window.CoachToolsIdentity&&document.querySelector('[data-app-id="coaching-gaps"]'));
  await page.evaluate(async()=>{
   await CoachToolsData.ready();await CoachToolsIdentity.ready();
   const coaches=['Coach Alpha','Coach Beta','Coach Gamma','Coach Other'],people=[];
   for(const name of coaches){const coach=await CoachToolsIdentity.learn(name,{role:'coach',source:'browser-reload'});people.push(coach);await CoachToolsIdentity.learn(name+' Representative',{role:'representative',currentCoachId:coach.personId,source:'browser-reload'});}
   localStorage.setItem('myone.master.v2.setup',JSON.stringify({groups:{team:[{name:'Retail Test',members:coaches}],coord:[]}}));
   const aoa=[['Date','Sheet','Name','Consumer Appointments','Consumer Opportunities','Wiper Count','Wiper Jobs']];
   for(let i=0;i<10000;i++){const name=coaches[i%4];aoa.push(['10/4/2026',name,name+' Representative',5,10,3,10]);}
   await CoachToolsData.importDataset('weeklyRetail',{meta:{fileName:'Retail Weekly.csv'},workbook:{sheets:['Weekly'],data:{Weekly:{aoa}}}},{originalFileName:'Retail Weekly.csv',scopeSnapshot:{mode:'all'},detectedPeriod:{periodKey:'2026-10-04',sortKey:'2026-10-04'}});
   CoachToolsStorage.setScope({mode:'team',label:'3 selected coaches',coaches:coaches.slice(0,3),coachPersonIds:people.slice(0,3).map(person=>person.personId)});
   window.fixtureCalls=[];const original=CoachToolsAppData;
   window.CoachToolsAppData=Object.freeze({...original,async getMany(...args){const call={at:performance.now()};fixtureCalls.push(call);try{return await original.getMany(...args);}finally{call.done=performance.now();}}});
   document.querySelector('[data-app-id="coaching-gaps"]').click();
  });
  const frame=await(await page.waitForSelector('iframe[data-app-id="coaching-gaps"]')).contentFrame();
  await frame.waitForFunction(()=>typeof coachingGapsReady!=='undefined'&&coachingGapsReady,null,{timeout:60000});
  await page.waitForFunction(()=>{
   const child=document.querySelector('iframe[data-app-id="coaching-gaps"]')?.contentWindow;
   const lastCall=fixtureCalls.at(-1),lastEvent=fixtureEvents.at(-1);
   return child&&typeof child.refreshSharedDockData==='function'&&lastCall?.done&&fixtureCalls.every(call=>call.done)
    &&performance.now()-Math.max(lastCall.done,lastEvent?.at||0)>1800;
  },null,{timeout:60000});
  const result=await page.evaluate(()=>({calls:fixtureCalls,events:fixtureEvents}));
  const child=await frame.evaluate(()=>({revision:sharedReloadRevision,loading:!!sharedReloadJob,teams:[...document.querySelectorAll('#teamSel option')].map(option=>option.value),events:fixtureEvents}));
  assert.deepEqual(child.teams,['Coach Alpha','Coach Beta','Coach Gamma']);
  assert.equal(child.loading,false,'The completed scope must settle without an active reload.');
  assert.equal(await frame.evaluate(()=>CoachToolsIdentity===parent.CoachToolsIdentity),true,'Hosted Gaps shares the desktop directory instead of starting duplicate enrichment.');
  await frame.evaluate(()=>{
   window.fixturePostReadyMasks=[];
   window.fixtureMaskObserver=new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes){
     if(node.nodeType!==1)continue;
     if(node.matches('#coachtools-progressive-data-status,#coachtools-heavy-startup-progress')||node.querySelector('#coachtools-progressive-data-status,#coachtools-heavy-startup-progress'))fixturePostReadyMasks.push(node.id);
    }
   });
   fixtureMaskObserver.observe(document.body,{childList:true,subtree:true});
  });
  const before=await frame.evaluate(()=>sharedReloadRevision);
  await page.evaluate(async()=>CoachToolsIdentity.syncTeamSetup());
  await frame.evaluate(async()=>CoachToolsIdentity.syncTeamSetup());
  await new Promise(resolve=>setTimeout(resolve,1500));
  const after=await frame.evaluate(()=>sharedReloadRevision);
  assert.equal(after,before,'Re-reading unchanged saved team setup must not reload Coaching Gaps.');
  assert.ok(result.calls.length<10,'A fixed source/scope cannot keep starting more data loads.');
  // Real membership edits must still refresh the report after idle no-op work.
  await page.evaluate(async()=>{
   const representative=(await CoachToolsIdentity.getRepresentatives()).find(person=>person.displayName==='Coach Beta Representative');
   const coaches=await CoachToolsIdentity.getCoaches();
   window.fixtureBetaRep=representative.personId;
   window.fixtureBetaCoach=coaches.find(person=>person.displayName==='Coach Beta').personId;
   await CoachToolsIdentity.updatePerson(representative.personId,{currentCoachId:coaches.find(person=>person.displayName==='Coach Other').personId});
  });
  await frame.waitForFunction(()=>document.querySelectorAll('#teamSel option').length===2&&!sharedReloadJob,null,{timeout:30000});
  assert.deepEqual(await frame.locator('#teamSel option').evaluateAll(options=>options.map(option=>option.value)),['Coach Alpha','Coach Gamma']);
  await page.evaluate(async()=>CoachToolsIdentity.updatePerson(fixtureBetaRep,{currentCoachId:fixtureBetaCoach}));
  await frame.waitForFunction(()=>document.querySelectorAll('#teamSel option').length===3&&!sharedReloadJob,null,{timeout:30000});
  await page.evaluate(()=>{
   CoachToolsStorage.setScope({mode:'coach',label:'Coach Beta',coaches:['Coach Beta']});
   CoachToolsStorage.setScope({mode:'all',label:'All people'});
  });
  await frame.waitForFunction(()=>document.querySelectorAll('#teamSel option').length===4&&!sharedReloadJob,null,{timeout:30000});
  assert.equal(await frame.evaluate(()=>allRows.length),10000,'A rapid scope change keeps the complete All people view.');
  assert.equal(await page.evaluate(async()=>(await CoachToolsData.getCurrent('weeklyRetail')).workbook.data.Weekly.aoa.length),10001,'Reloads preserve every backing source row.');
  assert.deepEqual(await frame.evaluate(()=>fixturePostReadyMasks),[],'Completed tools refresh quietly without repeatedly masking the report.');
  console.log(JSON.stringify({initialLoads:result.calls.length,initialRevision:child.revision,unchangedTeamSyncReloads:after-before,scenario:'real Horizon, 3 coaches, no-op parent/frame setup sync, real membership changes, rapid coach/all',rows:10000,errors}));
  assert.deepEqual(errors,[]);await context.close();
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
