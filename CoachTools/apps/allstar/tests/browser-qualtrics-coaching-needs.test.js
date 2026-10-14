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
  assert.equal(individual.roster,0);assert.equal(individual.history,0);assert.match(individual.csv,/"Never Person","High"/);assert.match(individual.csv,/"Mixed Person","Medium"/);assert.match(individual.csv,/QA: 14 \| Sales: 21/);assert.ok(!individual.csv.includes('"Recent Person"'));assert.ok(!individual.csv.includes('"Healthy Person"'));
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
  assert.deepEqual(errors,[]);
  console.log('PASS browser Qualtrics coaching needs: real uploaded coaching, live rules, both top actions, full small-team lists with audience/hire filters, view/cap independence, dates and priority, no roster or history writes');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
