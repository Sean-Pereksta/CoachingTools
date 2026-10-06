'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    for(const file of ['allstar.html','dist/All-Star-Portable.html']){
      const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'America/New_York'}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
      await page.goto(pathToFileURL(path.join(root,file)).href);await page.waitForFunction(()=>state.startup.completed);
      await page.evaluate(()=>{
        const headers=['Date','Name','Sheet','Consumer Appointments','Consumer Opportunities'];
        state.data.weeklyRetail={headers,rows:[
          ['Alice Able','2026-09-06',18,42],['Alice Able','2026-09-13',28,50],['Alice Able','2026-09-20',21,50],
          ['Bob Baker','2026-09-06',18,46],['Bob Baker','2026-09-13',19,40],['Bob Baker','2026-09-20',5,10],['Cara Clark','2026-09-06',0,0]
        ].map(([Name,Date,a,o])=>({Name,Date,Sheet:'Coach Alpha','Consumer Appointments':a,'Consumer Opportunities':o,_sourceKey:'weeklyRetail'})),config:window.AllStarDatedStats.defaultConfig('weeklyRetail',headers)};
        state.data.documented_coaching={headers:['Associate Name','Date','Notes'],rows:[
          ['Alice Able','2026-09-09'],['Alice Able','2026-09-15'],['Bob Baker','2026-09-23']
        ].map(([name,Date])=>({'Associate Name':name,Date,Notes:'Appointment coaching',_rep:name,_repKey:fullNameIdentityKey(name),_team:'Coach Alpha',_sourceKey:'documented_coaching'}))};
        state.sourceMeta.weeklyRetail={sourceVersion:1};state.sourceMeta.documented_coaching={sourceVersion:1};
        markDataIndexDirty('browser population',{sources:['weeklyRetail','documented_coaching']});
        state.researchItems=[normalizeResearchItem({id:'population-browser',title:'Below goal and coached',source:'weeklyRetail',dateColumn:'Date',analysisGrain:'representatives',guidedEnabled:true,guidedSubject:'representatives',guidedQuestion:'percentage',guidedPercentageUnit:'unique_reps',guidedBreakdown:'coach',guidedDisplay:'line',outputType:'line',valueMode:'percent',populationFilterMode:'dynamic',populationFilterPeriod:'weekly',filters:[{field:'![weeklyRetail].[Consumer Appointments] / ![weeklyRetail].[Consumer Opportunities]',op:'less than',value:'50%',include:'include',conditionResult:'true'}],guidedConditions:[{source:'documented_coaching',field:'Notes',operator:'is_not_blank'}]})];
        saveResearchItems();openModal('researchModal');openResearchItemEditor('population-browser');
      });
      await page.locator('#creationResearchFor > summary').click();
      await page.locator('#researchPopulationFilterMode').selectOption('static');
      assert.equal(await page.locator('#researchPopulationFilterPeriodWrap').isVisible(),false);
      await page.locator('#researchPopulationFilterMode').selectOption('dynamic');
      assert.equal(await page.locator('#researchPopulationFilterPeriodWrap').isVisible(),true);
      await page.locator('#researchPopulationFilterPeriod').selectOption('auto');
      assert.match(await page.locator('#researchPopulationFilterPeriod option:checked').innerText(),/Week/);
      await page.locator('#previewResearchFoundBtn').click();
      await page.waitForFunction(()=>document.getElementById('researchPopulationFilterPreview').textContent.includes('Population Preview'));
      await page.locator('#researchPopulationFilterPreview summary').click();
      assert.match(await page.locator('#researchPopulationFilterPreview').innerText(),/Matching: 4/);
      assert.match(await page.locator('#researchPopulationFilterPreview').innerText(),/18 \/ 42 = 42.9% \| MATCH/);
      assert.match(await page.locator('#researchPopulationFilterPreview').innerText(),/zero denominator.*NOT EVALUATED/);
      await page.locator('#saveResearchItemBtn').click();
      await page.waitForFunction(()=>!document.getElementById('researchEditorModal').classList.contains('open'));
      await page.waitForFunction(()=>state.researchItems.find(i=>i.id==='population-browser')?.renderedResult?.storedIn==='indexedDB');
      const data=await page.evaluate(async()=>(await researchRenderedResultGet('population-browser')).data.map(r=>[r.label,r.values[0],r.pointDetails[0].denominator]));
      assert.deepEqual(data,[['2026-09-06',50,2],['2026-09-13',0,1],['2026-09-20',0,1]],'only below-goal reps in each week form the coaching denominator');
      assert.ok(await page.locator('.researchCardBody > .researchPopulationPreview').count()>0,'compact preview remains available beside the result');
      await page.evaluate(()=>openResearchItemEditor('population-browser'));
      assert.equal(await page.locator('#researchPopulationFilterMode').inputValue(),'dynamic');
      assert.equal(await page.locator('#researchPopulationFilterPeriod').inputValue(),'auto');
      assert.equal(await page.locator('[data-rf="op"]').inputValue(),'less than');
      assert.deepEqual(errors,[],file);
      console.log('PASS '+file+': real mode controls, 50% ratio, bounded preview, save/run/reopen and weekly 50%/0%/0% coaching denominators');
      await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
