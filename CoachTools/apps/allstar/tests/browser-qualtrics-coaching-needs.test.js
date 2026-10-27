'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900},timezoneId:'America/New_York'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(pathToFileURL(path.join(__dirname,'../qualtrics/generator.html')).href);
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.db&&document.getElementById('status').textContent.startsWith('Ready.'));
  await page.evaluate(async()=>{
   const names=['Never Person','Mixed Person','Recent Person','Healthy Person'];
   state.rules=['QA','Sales'].map(id=>normalizeRule({id,title:id,baseName:id,agentHeader:'Agent Name',coachLookbackWeeks:id==='Sales'?3:2,criteria:[{header:'Value',operator:'lt',value:'50'}],coaching:{mode:'descriptionContains',descriptionPhrases:[id]},individualMessage:{concern:{enabled:true,sourceType:'legacy',operator:'legacy',message:`Review ${id}`},strength:{enabled:false}}}));
   state.dashboardFiles=state.rules.map((rule,index)=>({id:`file-${rule.id}`,fileName:`${rule.id}.csv`,ruleId:rule.id,status:'matched',headers:['Agent Name','Value','Coach','Team'],rows:names.map((name,i)=>({'Agent Name':name,Value:i===3||i===2&&index===1?60:20,Coach:i%2?'Coach B':'Coach A',Team:'Work Group'}))}));
   const coaching=[['Never Person','2026-10-13','Unrelated'],['Never Person','2026-10-15','QA'],['Mixed Person','2026-10-10','QA'],['Mixed Person','2026-09-01','Sales'],['Recent Person','2026-10-10','QA']].map(([name,date,topic])=>({'Associate Name':name,'Job Coach':'Former Coach','Coaching Date':date,Description:topic,'Coaching Type':'Regular'}));
   await loadCoaching({name:'coaching.csv',__allStarRows:coaching});
   state.individualSelectedRuleIds=new Set(state.rules.map(rule=>rule.id));state.individualSelectedReportFileIds=new Set(state.dashboardFiles.map(file=>file.id));
   state.individualScopeSelection={allByDefault:true,organizationIds:new Set(),coachKeys:new Set(),includeRepKeys:new Set(),excludeRepKeys:new Set()};
   els.reportDate.value='2026-10-14';els.individualMaxConcerns.value='1';els.individualResultSearch.value='will not match anybody';
   rebuildDerivedMaps();renderIndividualDataSelection();renderIndividualScope();switchTab('individual');
   window.capturedDownloads=[];downloadBlob=(blob,name)=>window.capturedDownloads.push({blob,name});
  });
  await page.locator('#exportIndividualCoachingNeedsBtn').click();
  await page.waitForFunction(()=>!state.individualCoachingExportRun&&window.capturedDownloads.length===1);
  const individual=await page.evaluate(async()=>({name:window.capturedDownloads[0].name,csv:await window.capturedDownloads[0].blob.text(),roster:state.individualRosterRows.length,history:state.history.length}));
  assert.equal(individual.roster,0);assert.equal(individual.history,0);assert.match(individual.csv,/"Never Person","High"/);assert.match(individual.csv,/"Mixed Person","Medium"/);assert.match(individual.csv,/QA: 14 \| Sales: 14/);assert.ok(!individual.csv.includes('"Recent Person"'));assert.ok(!individual.csv.includes('"Healthy Person"'));
  await page.evaluate(()=>{switchTab('report');window.capturedDownloads=[];});
  await page.locator('#exportEmailCoachingNeedsBtn').click();
  await page.waitForFunction(()=>!state.emailWorkflowRunning&&window.capturedDownloads.length===1);
  const email=await page.evaluate(async()=>({csv:await window.capturedDownloads[0].blob.text(),history:state.history.length,findings:state.report.flagged.length}));
  assert.equal(email.history,0);assert.equal(email.findings,5);assert.match(email.csv,/"Never Person","High"/);assert.match(email.csv,/"Mixed Person","Medium"/);assert.ok(!email.csv.includes('"Recent Person"'));assert.ok(!email.csv.includes('"Healthy Person"'));
  // A real Generate Report run hides the selected small team in email output, but its full list keeps all scoped needs.
  await page.evaluate(async()=>{
   const selectedCoaches=[...new Set(state.report.allFlagged.map(record=>record.coach))];
   for(const file of state.dashboardFiles) file.rows.push({'Agent Name':'Outside Person',Value:20,Coach:'Outside Coach',Team:'Outside Team'});
   const raw=[...state.masterRows.coaching.map(row=>row.raw),{'Associate Name':'Outside Person','Job Coach':'Outside Coach','Coaching Date':'2026-10-13',Description:'Unrelated','Coaching Type':'Regular'}];
   await loadCoaching({name:'coaching.csv',__allStarRows:raw});
   state.organizations=[{id:'selected-org',name:'Selected Organization',coachNames:selectedCoaches}];state.reportAudienceSettings={scope:'org',value:'selected-org',minPeople:10};renderReportAudienceControls();window.capturedDownloads=[];
  });
  await page.locator('#exportEmailCoachingNeedsBtn').click();
  await page.waitForFunction(()=>!state.emailWorkflowRunning);
  const smallTeam=await page.evaluate(async()=>({downloads:window.capturedDownloads.length,status:els.emailCoachingNeedsStatus.textContent,setup:els.toast.textContent,csv:window.capturedDownloads[0]?await window.capturedDownloads[0].blob.text():'',displayed:state.report.flagged.length,scoped:state.report.allFlagged.length,audienceExcluded:state.report.audienceExcludedRecords}));
  assert.equal(smallTeam.downloads,1,JSON.stringify(smallTeam));
  assert.equal(smallTeam.displayed,0);assert.equal(smallTeam.scoped,5);assert.equal(smallTeam.audienceExcluded,2);
  assert.match(smallTeam.csv,/"Never Person","High"/);assert.match(smallTeam.csv,/"Mixed Person","Medium"/);assert.ok(!smallTeam.csv.includes('"Outside Person"'),'the complete list still honors the selected organization audience');
  await page.evaluate(()=>{
   state.hireDateSettings=normalizeHireDateSettings({sourceKey:'browser:hires',repColumn:'Name',hireDateColumn:'Hire Date',filterMode:'between',startDate:'2026-01-01',endDate:'2026-12-31'});
   state.hireDateLookupCache.set(hireDateMappingSignature(),['Never Person','Mixed Person','Recent Person','Healthy Person','Outside Person'].map(repName=>({repName,hireDate:repName==='Never Person'?'2025-01-01':'2026-01-01'})));window.capturedDownloads=[];
  });
  await page.locator('#exportEmailCoachingNeedsBtn').click();
  await page.waitForFunction(()=>!state.emailWorkflowRunning&&window.capturedDownloads.length===1);
  const hired=await page.evaluate(async()=>({csv:await window.capturedDownloads[0].blob.text(),displayed:state.report.flagged.length,scoped:state.report.allFlagged.length,hireExcluded:state.report.hireDateExcludedRecords}));
  assert.equal(hired.displayed,0);assert.equal(hired.scoped,3);assert.equal(hired.hireExcluded,2);assert.match(hired.csv,/"Mixed Person","Medium"/);assert.ok(!hired.csv.includes('"Never Person"'),'the complete list still honors the hire-date range');assert.ok(!hired.csv.includes('"Outside Person"'));
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('#exportEmailCoachingNeedsBtn').isVisible(),true);
  // A fresh full-app run proves that the visible weeks control governs both generators.
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(async()=>{
   const names=['Same Day Person','Future Day Person','Older Match Person','Unrelated Topic Person'];
   state.rules=[normalizeRule({id:'same-day-sales',title:'Same-day Sales',baseName:'Same-day Sales',agentHeader:'Agent Name',coachLookbackWeeks:2,criteria:[{header:'Value',operator:'lt',value:'50'}],coaching:{mode:'descriptionContains',descriptionPhrases:['save the sale']},individualMessage:{concern:{enabled:true,sourceType:'legacy',operator:'legacy',message:'Review sales'},strength:{enabled:false}}})];
   state.dashboardFiles=[{id:'same-day-file',fileName:'Same-day Sales.csv',ruleId:state.rules[0].id,status:'matched',headers:['Agent Name','Value','Coach','Team'],rows:names.map(name=>({'Agent Name':name,Value:20,Coach:'Current Coach',Team:'Current Team'}))}];
   state.selectedOtherRuleIds=new Set();state.history=[];
   state.reportSettings={...state.reportSettings,orderEnabled:false,weightsEnabled:false};
   state.reportAudienceSettings={scope:'all',value:'',minPeople:1};renderReportAudienceControls();
   state.hireDateSettings=normalizeHireDateSettings();
   const coaching=[['Same Day Person','2026-10-27T23:59:59','Discussed SAVE THE SALE'],['Future Day Person','2026-10-28T00:00:00','Discussed save the sale'],['Older Match Person','2026-10-07T12:00:00','Discussed save the sale'],['Unrelated Topic Person','2026-10-27T16:00:00','Discussed an unrelated topic']].map(([name,date,description])=>({'Associate Name':name,'Job Coach':'Former Coach','Coaching Date':date,Description:description,'Coaching Type':'save the sale'}));
   await loadCoaching({name:'same-day-coaching.csv',__allStarRows:coaching});
   state.individualSelectedRuleIds=new Set(state.rules.map(rule=>rule.id));state.individualSelectedReportFileIds=new Set(state.dashboardFiles.map(file=>file.id));
   state.individualScopeSelection={allByDefault:true,organizationIds:new Set(),coachKeys:new Set(),includeRepKeys:new Set(),excludeRepKeys:new Set()};
   els.reportDate.value='2026-10-27';els.individualResultSearch.value='';
   rebuildDerivedMaps();renderIndividualDataSelection();renderIndividualScope();switchTab('keyfiles');
  });
  for(const weeks of [1,3]){
   await page.locator('[data-tab="keyfiles"]').click();
   await page.locator('#globalCoachLookback').fill(String(weeks));
   await page.locator('#globalCoachLookback').dispatchEvent('change');
   assert.equal(await page.evaluate(()=>localStorage.getItem('coachingEmailGeneratorCoachLookbackWeeks.v1')),String(weeks),'changing the visible control saves the shared setting');
   await page.evaluate(()=>{switchTab('report');window.capturedDownloads=[];});
   await page.locator('#exportEmailCoachingNeedsBtn').click();
   await page.waitForFunction(()=>!state.emailWorkflowRunning&&window.capturedDownloads.length===1);
   const fresh=await page.evaluate(async()=>({rows:state.report.allFlagged.map(record=>({name:record.repName,coached:record.coached.isCoached})),coverage:summaryStats(state.report.allFlagged).coachedPct,csv:await window.capturedDownloads[0].blob.text()}));
   assert.equal(fresh.rows.length,4);
   assert.deepEqual(Object.fromEntries(fresh.rows.map(record=>[record.name,record.coached])),{'Same Day Person':true,'Future Day Person':false,'Older Match Person':weeks===3,'Unrelated Topic Person':false},'full-day coaching and the shared weeks apply despite the saved per-rule value of two');
   assert.equal(fresh.coverage,weeks===3?.5:.25);
   assert.ok(!fresh.csv.includes('"Same Day Person"'),'23:59 coaching closes the same-day coaching gap');
   assert.ok(fresh.csv.includes('"Future Day Person"'));assert.ok(fresh.csv.includes('"Unrelated Topic Person"'));
   assert.equal(fresh.csv.includes('"Older Match Person"'),weeks===1);
   assert.match(fresh.csv,new RegExp(`Same-day Sales: ${weeks*7}`));
   await page.evaluate(()=>{switchTab('individual');window.capturedDownloads=[];});
   await page.locator('#exportIndividualCoachingNeedsBtn').click();
   await page.waitForFunction(()=>!state.individualCoachingExportRun&&window.capturedDownloads.length===1);
   const freshIndividual=await page.evaluate(async()=>await window.capturedDownloads[0].blob.text());
   assert.ok(!freshIndividual.includes('"Same Day Person"'));
   assert.ok(freshIndividual.includes('"Future Day Person"'));assert.ok(freshIndividual.includes('"Unrelated Topic Person"'));
   assert.equal(freshIndividual.includes('"Older Match Person"'),weeks===1,'individual needs use the same shared window as the report');
   assert.match(freshIndividual,new RegExp(`Same-day Sales: ${weeks*7}`));
  }
  await page.reload();
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.db&&document.getElementById('status').textContent.startsWith('Ready.'));
  assert.equal(await page.locator('#globalCoachLookback').inputValue(),'3','reopening restores the last shared weeks value');
  assert.equal(await page.evaluate(()=>currentCoachLookbackWeeks()),3);
  assert.deepEqual(errors,[]);
  console.log('PASS browser Qualtrics coaching needs: uploaded coaching, live rules, both actions, audience/hire filters, same-day timestamps, shared weeks over legacy rule settings, saved/reloaded control, priority and read-only exports');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
