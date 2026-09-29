'use strict';
// Optional browser gate; uses the same external browser setup as the other
// All-Star browser tests. All inputs are synthetic; no employee files are used.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const csv=[
  'Date,Sheet,Name,Total Opportunities,Total Appointments,Consumer Opportunities,Consumer Appointments',
  '2026-09-06,Coach Alpha,Alice Able,10,4,10,4',
  '2026-09-06,Coach Alpha,Bob Baker,20,10,20,10',
  '2026-09-20,Coach Alpha,Alice Able,20,12,20,12'
].join('\n');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    for(const file of ['allstar.html','dist/All-Star-Portable.html']){
      const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'America/New_York'});
      const page=await context.newPage(),errors=[];
      page.setDefaultTimeout(20000);
      page.on('pageerror',error=>errors.push(error.message));
      page.on('dialog',dialog=>dialog.dismiss());
      await page.goto(pathToFileURL(path.join(root,file)).href);
      await page.waitForFunction(()=>typeof state!=='undefined'&&state.startup.completed);
      await page.evaluate(()=>window.CoachToolsStatsSettingsReady);
      await page.evaluate(()=>openModal('importModal'));
      await page.locator('[data-ds-upload="weeklyRetail"]').setInputFiles({name:'synthetic-weekly.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
      await page.waitForFunction(()=>state.data.weeklyRetail.rows.length===3&&!state.activeImportJob);
      assert.equal(await page.evaluate(()=>state.data.weeklyRetail.config.calendar.reviewed),false);
      await page.locator('[data-ds-config="weeklyRetail"]').click();
      const source=page.getByRole('dialog',{name:/Source configuration/});
      await source.locator('[data-ds="label"]').selectOption('ending');
      await source.locator('[data-ds="reviewed"]').check();
      await source.locator('[data-ds-save]').click();
      await source.waitFor({state:'detached'});
      await page.locator('#categorizeDataBtn').click();
      await page.waitForFunction(()=>state.categorized.stats?.sources?.weeklyRetail?.observations?.length===3&&!state.categorizationPending);
      assert.equal(await page.evaluate(()=>state.categorized.dated.rows.length),0);
      await page.evaluate(async()=>{closeModal('importModal');await openMetricsPage();});
      await page.getByRole('button',{name:'Create Dated Stats Metric',exact:true}).click();
      const metric=page.getByRole('dialog',{name:'Dated Stats metric',exact:true});
      await metric.locator('[data-ds="name"]').fill('Synthetic weekly AR');
      await metric.locator('[data-ds="statistic"]').selectOption('total_ar');
      assert.equal(await metric.locator('[data-ds="aggregation"] option[value="sum"]').isDisabled(),true);
      await metric.locator('[data-ds-preview]').click();
      assert.match(await metric.locator('[data-ds-result]').innerText(),/50 %/);
      await metric.locator('[data-ds-save]').click();
      await metric.waitFor({state:'detached'});
      await page.evaluate(()=>{
        closeModal('metricsModal');
        const m=state.metrics.find(m=>m.name==='Synthetic weekly AR');
        const c=normalizeCriterionForStorage({...emptyCriterion(),id:'browser-ds-criterion',name:'AR change',source:m.source,calcType:'datedStats',datedStatsMetricId:m.id,datedStatsRule:{mode:'trend',summary:'change'},scoreType:'display',audience:'rep'});
        state.models.push({id:'browser-ds-model',name:'Weekly model',criteria:[c]});
        window.browserDatedStatsCriterion=c;openEditModel('browser-ds-model');
      });
      await page.locator('[data-ds-criterion-preview]').click();
      assert.equal(await page.locator('[data-ds-model-preview] svg').count(),1);
      assert.equal(await page.evaluate(()=>criterionValue(window.browserDatedStatsCriterion,{kind:'rep',key:fullNameIdentityKey('Alice Able'),name:'Alice Able',team:'Coach Alpha'},{})),20);
      // The ordinary source picker also routes to the numerical editor.
      await page.evaluate(()=>{closeModal('editModelModal');openResearchItemEditor();});
      await page.locator('[data-rw-mode="advanced"]').click();
      await page.locator('#researchSource').selectOption('weeklyRetail');
      assert.equal(await page.locator('#researchEditorModal').isVisible(),false);
      const research=page.getByRole('dialog',{name:'Dated Stats Research',exact:true});
      await research.locator('[data-ds="title"]').fill('Saved weekly trends');
      await research.locator('[data-ds="groupBy"]').selectOption('coach');
      await research.locator('[data-ds-run]').click();
      await research.locator('[data-ds-plot] circle').first().waitFor();
      assert.equal(await research.locator('[data-ds-plot] circle').count(),2,'missing reporting week is a gap');
      await research.locator('[data-ds-plot] circle').first().focus();
      await page.keyboard.press('Enter');
      const evidence=page.getByRole('dialog',{name:'Supporting representative values',exact:true});
      assert.match(await evidence.innerText(),/Alice Able/);
      assert.match(await evidence.innerText(),/Bob Baker/);
      await evidence.locator('[data-ds-close]').click();
      const downloadReady=page.waitForEvent('download');
      await research.locator('[data-ds-export]').click();
      const download=await downloadReady,exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
      assert.deepEqual(exported.data.map(p=>p.value),[45,null,60]);
      assert.equal(exported.calendar.label,'ending');
      assert.equal(exported.definition.metric.aggregation,'equal_rep');
      assert.equal(exported.data[0].contributions.length,2);
      await research.locator('[data-ds-save]').click();
      await research.waitFor({state:'detached'});
      const itemId=await page.evaluate(()=>state.researchItems.find(i=>i.title==='Saved weekly trends').id);
      await page.reload();
      await page.waitForFunction(()=>state.startup.completed);
      await page.evaluate(async()=>{await openMetricsPage();closeModal('metricsModal');await openResearchWorkspace();});
      assert.equal(await page.evaluate(()=>state.metrics.find(m=>m.name==='Synthetic weekly AR').dataCategory),'datedStats');
      assert.equal(await page.evaluate(()=>datedStatsCategory('weeklyRetail').observations.length),3,'unchanged reviewed data stays usable after reopening');
      const reopened=await page.evaluate(id=>researchRenderedResultGet(id),itemId);
      assert.deepEqual(reopened.data.map(p=>p.value),[45,null,60]);
      await page.evaluate(()=>{state.data.weeklyRetail.rows[0]['Total Appointments']=9;noteCategorizationSourceVersion('weeklyRetail');});
      const frozen=await page.evaluate(id=>researchRenderedResultGet(id),itemId);
      assert.deepEqual(frozen.data.map(p=>p.value),[45,null,60]);
      await page.evaluate(id=>openResearchItemEditor(id),itemId);
      await page.setViewportSize({width:600,height:800});
      assert.equal(await page.getByRole('dialog',{name:'Dated Stats Research',exact:true}).isVisible(),true);
      assert.deepEqual(errors,[],file+' runtime errors');
      console.log('PASS '+file+': CSV upload, reviewed calendar, manual categorization, typed Metric, Model trend, Research gap/evidence/export, frozen save/reload and small-window editor');
      await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
