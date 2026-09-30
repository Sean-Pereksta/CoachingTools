'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const file of ['allstar.html','dist/All-Star-Portable.html']){
   const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'America/New_York'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
   await page.goto(pathToFileURL(path.join(root,file)).href);await page.waitForFunction(()=>state.startup.completed);
   assert.equal(await page.evaluate(()=>typeof window.AllStarSentenceWorkspace.open),'function','Sentence builder is bundled in both entry points');
   await page.evaluate(()=>{
    state.data.retail.headers.sv2=['Representative','Team','Value','Opps'];state.data.retail.sv2=[{Representative:'Alice',Team:'A',Value:10,Opps:2},{Representative:'Bob',Team:'A',Value:30,Opps:3}].map(r=>({...r,_rep:r.Representative,_repKey:fullNameIdentityKey(r.Representative),_team:r.Team,_sourceKey:'retail_sv2'}));state.sourceMeta.retail_sv2={sourceVersion:1};markDataIndexDirty('browser views',{sources:['retail_sv2']});rebuildDataIndexSync('browser views');
    state.models.push(normalizeModelForStorage({id:'browser-views-model',name:'Focused model',criteria:[{...emptyCriterion(),id:'v',name:'Value',column:'Value',scoreType:'points',points:2},{...emptyCriterion(),id:'r',name:'Ratio',calcType:'custom',expression:'[Value]/[Opps]',weight:'2'}]}));openEditModel('browser-views-model');window.viewOriginal=JSON.stringify(state.editModel);
   });
   assert.equal(await page.locator('.modelCriterionBody:visible').count(),1);
   await page.locator('[data-crit="r"] [data-model-edit]').click();assert.equal(await page.locator('[data-crit="r"] .modelCriterionBody:visible').count(),1);
   await page.locator('#modelAllSettingsBtn').click();assert.equal(await page.locator('.modelCriterionBody:visible').count(),2);await page.locator('#modelAllSettingsBtn').click();
   assert.equal(await page.evaluate(()=>JSON.stringify(state.editModel)),await page.evaluate(()=>window.viewOriginal));
   await page.locator('#modelSamplePreviewBtn').click();await page.waitForFunction(()=>document.querySelector('#modelSamplePreviewResult tbody'));
   const sample=await page.locator('#modelSamplePreviewResult').innerText();await page.locator('#modelCriterionSearch').fill('ratio');assert.equal(await page.locator('#modelSamplePreviewResult').innerText(),sample);
   await page.evaluate(()=>{closeModal('editModelModal');state.metrics=[normalizeMetric({id:'browser-views-metric',name:'Total Value',source:'retail_sv2',field:'Value',mode:'sum',percentOfField:'Opps',gear:{valuesEnabled:false}})];openMetricEditor('browser-views-metric');window.metricOriginal=JSON.stringify(metricFromEditor());});
   assert.equal(await page.locator('#metricPercentOfField').isVisible(),false);await page.locator('#metricAllSettingsBtn').click();assert.equal(await page.locator('#metricPercentOfField').isVisible(),true);await page.locator('#metricAllSettingsBtn').click();assert.equal(await page.locator('#metricPercentOfField').isVisible(),false);
   assert.equal(await page.evaluate(()=>JSON.stringify(metricFromEditor())),await page.evaluate(()=>window.metricOriginal));
   await page.locator('#previewMetricFoundBtn').click();assert.match(await page.locator('#metricResultContext').innerText(),/40/);
   await page.evaluate(()=>{closeModal('metricEditorModal');state.researchItems=[normalizeResearchItem({id:'browser-views-research',title:'Values',source:'retail_sv2',analysisGrain:'rows',groupField:'Team',valueMode:'sum',valueField:'Value',outputType:'table',columns:[{label:'Value',field:'Value',mode:'sum'}],guidedEnabled:false})];openResearchItemEditor('browser-views-research');});
   await page.locator('#researchDraftPreviewBtn').click();await page.waitForFunction(()=>document.querySelector('#researchDraftPreviewResult [data-drilldown-id]'));
   await page.locator('#researchDraftPreviewResult [data-drilldown-id]').first().click();await page.waitForFunction(()=>document.getElementById('researchDraftPreviewEvidence').textContent.includes('Formula and calculation'));
   assert.equal(await page.locator('#researchCellFeedbackModal').count(),0);
   await page.locator('#researchDraftPreviewEvidence [data-research-feedback-close]').click();assert.equal(await page.locator('#researchDraftPreviewEvidence').innerText(),'');
   await page.locator('#researchAllSettingsBtn').click();await page.locator('#researchAllSettingsBtn').click();
   await page.setViewportSize({width:390,height:844});
   assert.equal(await page.evaluate(()=>document.querySelector('#researchEditorModal .modal').getBoundingClientRect().width<=390),true);
   assert.deepEqual(errors,[],file+' page errors');
   console.log('PASS '+file+': focused criteria, unchanged complete drafts, scoped Metric inputs, real draft results, inline evidence, sentence availability, and narrow layout');
   await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
