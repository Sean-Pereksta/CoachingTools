'use strict';
// Fresh browser contexts and synthetic imports only; never reads user storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const chosen = ['Coach Alpha', 'Coach Beta', 'Coach Gamma'];
const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(request.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, content) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    response.end(content);
  });
});

async function seed(page, base) {
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.CoachToolsData && window.CoachToolsIdentity && window.CoachToolsAppData);
  await page.evaluate(async chosen => {
    await CoachToolsData.ready(); await CoachToolsIdentity.ready();
    window.fixtureIngested=[];window.fixtureLastIdentity=performance.now();
    addEventListener('coachtools:identity-updated',event=>{
      fixtureLastIdentity=performance.now();
      if(event.detail?.reason==='ingestion-batch-complete')fixtureIngested.push(...(event.detail.datasetTypes||[]));
    });
    const coaches = [...chosen, 'Coach Other'];
    const people = [];
    for (const name of coaches) {
      const coach = await CoachToolsIdentity.learn(name, {role:'coach', source:'coaching-tools-browser'});
      people.push(coach);
      await CoachToolsIdentity.learn(name + ' Representative', {role:'representative', currentCoachId:coach.personId, source:'coaching-tools-browser'});
    }
    localStorage.setItem('myone.master.v2.setup', JSON.stringify({groups:{team:[{name:'Fixture team', members:coaches}], coord:[]}}));
    const retail = [['Date','Sheet','Name','Consumer Appointments','Consumer Opportunities','Wiper Count','Wiper Jobs']];
    const referral = [['Date','Sheet','Name','Consumer Appointments','Consumer Opportunities','Wipers Accepted','Wipers Offered']];
    const qa = [['Agent Name','Score','Interaction Start Time','Team','Evaluator','Evaluation ID']];
    const checklist = [['Coach Assigned','Associate Name','Action Taken','Created On','Date Served','Incident']];
    const docs = [['Job Coach','Associate Name','Date','Created On','Coaching Type','Description']];
    const today = new Date(); today.setHours(12,0,0,0);
    for (const [index,name] of coaches.entries()) for (let day=0; day<2; day++) {
      const date = new Date(today); date.setDate(date.getDate()-day);
      const stamp = `${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()}`;
      retail.push([stamp,name,name+' Representative',5,10,3,10]);
      referral.push([stamp,name,name+' Representative',4,10,2,5]);
      qa.push([name+' Representative',90,stamp,name,'Fixture Reviewer',`eval-${index}-${day}`]);
      checklist.push([name,name+' Representative','Addressed',stamp,stamp,'Call Quality']);
      docs.push([name,name+' Representative',stamp,stamp,'Call Quality','Synthetic call quality and wiper coaching']);
    }
    for (const [type,aoa] of Object.entries({weeklyRetail:retail,weeklyReferral:referral,qa,checklist,documentedCoaching:docs})) {
      // Exercise the persisted chunk path even with a small, easy-to-audit fixture.
      await CoachToolsData.importDataset(type, {meta:{fileName:type+'.csv'},workbook:{sheets:['Fixture'],data:{Fixture:{aoa}}}}, {
        originalFileName:type+'.csv', fileSize:4*1024*1024, scopeSnapshot:{mode:'all'},
        detectedPeriod:{periodKey:'fixture-current',sortKey:'9999-01-01'}
      });
    }
    CoachToolsStorage.setScope({mode:'team',label:'3 selected coaches',coaches:chosen,coachPersonIds:people.slice(0,3).map(person=>person.personId)});
    window.fixtureScope=CoachToolsStorage.getScope();
    window.fixtureCalls=[]; window.fixtureNotices=[];
    const data=CoachToolsAppData;
    window.CoachToolsAppData=Object.freeze({...data,async getMany(...args) {
      const call={at:performance.now(),progressUi:args[1]?.progressUi};fixtureCalls.push(call);
      try {return await data.getMany(...args);} finally {call.done=performance.now();}
    },async getManyProgressive(...args) {
      const call={at:performance.now(),progressUi:args[1]?.progressUi};fixtureCalls.push(call);
      try {return await data.getManyProgressive(...args);} finally {call.done=performance.now();}
    },subscribe(types,callback){return data.subscribe(types,detail=>{fixtureNotices.push({types,detail});callback(detail);});}});
    const identity=CoachToolsIdentity; let first=true;
    window.CoachToolsIdentity=Object.freeze({...identity,async resolveName(...args) {
      if(first) { first=false; await identity.learn('Background Registry Observer',{role:'coach',source:'scope-open-race'});window.fixtureEnriched=true; }
      return identity.resolveName(...args);
    }});
  }, chosen);
}

async function openTool(page, app) {
  await page.evaluate(app => {
    const frame=document.createElement('iframe');frame.id='fixtureTool';frame.dataset.appId=app.id;frame.src='/apps/'+app.file;document.body.appendChild(frame);
  }, app);
  let frame=await (await page.waitForSelector('#fixtureTool')).contentFrame();
  if(app.id==='kpi-impact') frame=await (await frame.waitForSelector('#kpiFrame')).contentFrame();
  await frame.waitForSelector(app.id==='kpi-impact'?'#coachSel':app.id==='qa-scores'?'#teamSel':'#kRows',{state:'attached'});
  return frame;
}

async function snapshot(frame, app) {
  return frame.evaluate(id => {
    if(id==='kpi-impact') return {coaches:[...document.querySelectorAll('#coachSel option')].map(o=>o.value),rows:allRows.length,coachingRows:coachings.length};
    if(id==='qa-scores') return {coaches:[...new Set(qaRowsLocal.map(r=>r.team))].sort(),rows:qaRowsLocal.length,coachingRows:coRowsAll.length};
    const coaches=id==='coach-timeline'?[...document.querySelectorAll('#coachFocusSelect option')].map(o=>o.value).filter(Boolean).sort():[...new Set([...document.querySelectorAll('#coachTable [data-kind="view"][data-coach]')].map(o=>decodeURIComponent(o.dataset.coach)))].sort();
    return {coaches,rows:Number(document.getElementById('kRows').textContent.replace(/,/g,''))||0,coachingRows:Number(document.getElementById('kDocRows').textContent.replace(/,/g,''))||0};
  },app.id);
}

async function expectScope(frame, app, expected) {
  try {
    await frame.waitForFunction(({id,expected}) => {
      let coaches,rows;
      if(id==='kpi-impact') {if(!window.__KPI_IMPACT_READY__)return false;coaches=[...document.querySelectorAll('#coachSel option')].map(o=>o.value);rows=allRows.length;}
      else if(id==='qa-scores') {if(typeof qaRowsLocal==='undefined')return false;coaches=[...new Set(qaRowsLocal.map(r=>r.team))].sort();rows=qaRowsLocal.length;}
      else {if(!document.getElementById('kRows'))return false;coaches=id==='coach-timeline'?[...document.querySelectorAll('#coachFocusSelect option')].map(o=>o.value).filter(Boolean).sort():[...new Set([...document.querySelectorAll('#coachTable [data-kind="view"][data-coach]')].map(o=>decodeURIComponent(o.dataset.coach)))].sort();rows=Number(document.getElementById('kRows').textContent.replace(/,/g,''))||0;}
      return JSON.stringify(coaches)===JSON.stringify(expected) && rows===expected.length*2;
    },{id:app.id,expected},{timeout:45000});
  } catch(error) {
    console.error(JSON.stringify(await frame.evaluate(async()=>({notices:top.fixtureNotices,calls:top.fixtureCalls,representatives:(await top.CoachToolsIdentity.getRepresentatives()).map(person=>({name:person.displayName,coach:person.currentCoachId}))})).catch(error=>({diagnosticError:error.message}))));
    throw new Error(`${app.id} must show exactly ${expected.join(', ') || 'zero coaches'}; last state: ${JSON.stringify(await snapshot(frame,app).catch(error=>({snapshotError:error.message})))}; ${error.message}`);
  }
  const state=await snapshot(frame,app);
  assert.deepEqual(state.coaches,expected);assert.equal(state.rows,expected.length*2);
  assert.equal(state.coachingRows,expected.length*2,'Documented coaching follows the same selected population.');
}

async function testWipers(frame) {
  const option=await frame.locator('#autoSetSel option').evaluateAll(options=>options.find(option=>/Wiper Rate/.test(option.textContent))?.value);
  assert.ok(option!==undefined,'Wipers is automatically offered as a KPI.');
  await frame.selectOption('#autoSetSel',option);
  for(const [retail,referral,accepted,offered] of [[true,false,6,20],[false,true,4,10],[true,true,10,30]]) {
    await frame.evaluate(({retail,referral})=>{
      document.getElementById('incRetail').checked=retail;document.getElementById('incReferral').checked=referral;refreshFromCache();
      const set=autoSets.find(set=>set.label==='Wiper Rate');selectedSet={A:set.A,B:set.B};
    },{retail,referral});
    const result=await frame.evaluate(()=>computeTeamMetrics(selectedSet));
    assert.equal(result.apps,accepted);assert.equal(result.opps,offered);assert.equal(result.rate,accepted/offered);
  }
}

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
    for(const app of [
      {id:'kpi-impact',file:'kpi-impact-galactic.html'}, {id:'qa-scores',file:'qa-scores.html'},
      {id:'coach-timeline',file:'coach-timeline.html'}, {id:'audit-checklist',file:'audit-checklist.html'}
    ].filter(app=>!process.env.COACHING_SCOPE_APP||app.id===process.env.COACHING_SCOPE_APP)) {
      const context=await browser.newContext(),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>{errors.push(error.message);console.error(`${app.id}: ${error.stack}`);});
      page.on('console',message=>{if(message.type()==='error')console.error(`${app.id}: ${message.text()}`);});
      try {
        await seed(page,`http://127.0.0.1:${server.address().port}`);
        const frame=await openTool(page,app);
        await expectScope(frame,app,chosen);
        assert.equal(await page.evaluate(()=>fixtureEnriched),true,'Identity enrichment occurs during the scoped read.');
        if(app.id!=='audit-checklist') {
          await frame.waitForFunction(()=>window.CoachToolsIdentity,{},{timeout:15000});
          assert.equal(await frame.evaluate(()=>CoachToolsIdentity===top.CoachToolsIdentity),true,'Hosted tools reuse the desktop identity owner.');
        }
        if(app.id==='kpi-impact') await testWipers(frame);
        // Finish the import's real background directory learning before editing
        // an assignment, so that source observation cannot overwrite the edit.
        await page.waitForFunction(()=>['weeklyRetail','weeklyReferral','qa','checklist','documentedCoaching'].every(type=>fixtureIngested.includes(type))&&performance.now()-fixtureLastIdentity>600,null,{timeout:15000});
        await expectScope(frame,app,chosen);
        await frame.evaluate(()=>{
          window.fixtureMasks=[];
          new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&(node.matches('#coachtools-progressive-data-status,#coachtools-heavy-startup-progress,#coachtools-dock-chunk-progress')||node.querySelector('#coachtools-progressive-data-status,#coachtools-heavy-startup-progress,#coachtools-dock-chunk-progress')))fixtureMasks.push(node.id);}).observe(document.body,{childList:true,subtree:true});
        });
        await page.evaluate(async()=>{
          const rep=(await CoachToolsIdentity.getRepresentatives()).find(p=>p.displayName==='Coach Beta Representative');
          const coaches=await CoachToolsIdentity.getCoaches();fixtureRep=rep.personId;fixtureCoach=coaches.find(p=>p.displayName==='Coach Beta').personId;
          await CoachToolsIdentity.updatePerson(rep.personId,{currentCoachId:coaches.find(p=>p.displayName==='Coach Other').personId});
        });
        await expectScope(frame,app,['Coach Alpha','Coach Gamma']);
        await page.evaluate(async()=>CoachToolsIdentity.updatePerson(fixtureRep,{currentCoachId:fixtureCoach}));
        await expectScope(frame,app,chosen);
        await page.evaluate(()=>CoachToolsStorage.setScope({mode:'coach',label:'Coach Beta',coaches:['Coach Beta']}));
        await expectScope(frame,app,['Coach Beta']);
        await page.evaluate(()=>CoachToolsStorage.setScope({mode:'all',label:'All people'}));
        await expectScope(frame,app,[...chosen,'Coach Other']);
        await page.evaluate(()=>CoachToolsStorage.setScope({mode:'coach',label:'Coach Nobody',coaches:['Coach Nobody']}));
        await expectScope(frame,app,[]);
        await page.evaluate(()=>CoachToolsStorage.setScope(fixtureScope));
        await expectScope(frame,app,chosen);
        await page.evaluate(()=>{CoachToolsStorage.setScope({mode:'coach',label:'Coach Gamma',coaches:['Coach Gamma']});CoachToolsStorage.setScope({mode:'all',label:'All people'});});
        await expectScope(frame,app,[...chosen,'Coach Other']);
        await page.evaluate(async()=>{await CoachToolsIdentity.syncTeamSetup();});
        await new Promise(resolve=>setTimeout(resolve,1000));
        const before=await page.evaluate(()=>fixtureCalls.length);
        await page.evaluate(async()=>{await CoachToolsIdentity.syncTeamSetup();});
        await new Promise(resolve=>setTimeout(resolve,500));
        assert.equal(await page.evaluate(()=>fixtureCalls.length),before,'Unchanged team setup must remain settled.');
        assert.deepEqual(await frame.evaluate(()=>fixtureMasks),[],'Background changes do not reopen startup overlays.');
        assert.deepEqual(await page.evaluate(async()=>{
          const counts={};for(const type of ['weeklyRetail','weeklyReferral','qa','checklist','documentedCoaching'])counts[type]=(await CoachToolsData.getCurrent(type)).workbook.data.Fixture.aoa.length;return counts;
        }),{weeklyRetail:9,weeklyReferral:9,qa:9,checklist:9,documentedCoaching:9},'Scoping preserves complete backing sources.');
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({app:app.id,scenario:'chunked imports, identity race and assignment changes, three coaches, single/all/empty/rapid scopes, quiet refresh',rows:8,errors}));
      } catch(error) {console.error({app:app.id,pageErrors:errors});throw error;} finally {await context.close();}
    }
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
