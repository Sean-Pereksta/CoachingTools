'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const dates=['2026-09-13','2026-09-20','2026-09-27'];
const csv='Date,Sheet,Name,Manager,Consumer Appointment Rate,Alternate Date\n'+dates.map((d,i)=>`${d},Coach Alpha,Alice Able,Manager One,${[50,55,60][i]}%,${d}`).join('\n');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  try{
    for(const file of ['allstar.html','dist/All-Star-Portable.html']){
      const context=await browser.newContext({timezoneId:'America/New_York'}),page=await context.newPage(),errors=[];
      page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
      await page.goto(pathToFileURL(path.join(root,file)).href);
      await page.waitForFunction(()=>state.startup.completed);
      await page.evaluate(()=>window.CoachToolsStatsSettingsReady);
      await page.evaluate(()=>openModal('importModal'));
      const uploads=page.locator('.advancedUploads');await uploads.locator('summary').first().click();
      assert.deepEqual(await uploads.locator('.importUploadGrid .panelTitle').allTextContents().then(x=>x.slice(0,4)),['Retail Monthly Stats','Referral Monthly Stats','Retail Weekly Stats','Referral Weekly Stats']);
      assert.equal(await page.getByText('Review calendar & field types',{exact:true}).count(),0);
      for(const source of ['weeklyRetail','weeklyReferral']){
        const input=page.locator(`[data-ds-upload="${source}"]`);
        await input.setInputFiles({name:source+'.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
        await page.waitForFunction(source=>state.data[source].rows.length===3&&!state.activeImportJob,source);
        assert.equal(await page.evaluate(source=>state.data[source].config.calendar.reviewed,source),false);
        await page.evaluate(source=>{closeModal('importModal');openDatedStatsResearchEditor(undefined,source);},source);
        const research=page.getByRole('dialog',{name:'Weekly Stats Research',exact:true});
        assert.equal(await research.locator('[data-ds="source"]').inputValue(),source);
        await research.locator('[data-ds="metricId"]').selectOption('field:'+source+':Consumer%20Appointment%20Rate');
        assert.equal(await research.locator('[data-ds="startDate"]').inputValue(),'');
        assert.equal(await research.locator('[data-ds="endDate"]').inputValue(),'');
        await research.locator('[data-ds-run]').click();
        await research.locator('[data-ds-plot] circle').first().waitFor();
        assert.equal(await research.locator('[data-ds-plot] circle').count(),3);
        assert.match(await research.locator('.ds-result').innerText(),/Average of representative values/);
        const downloadReady=page.waitForEvent('download');await research.locator('[data-ds-export]').click();
        const download=await downloadReady,fs=require('node:fs'),result=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
        assert.deepEqual(result.data.map(p=>[p.label,p.value]),dates.map((d,i)=>[d,[50,55,60][i]]));
        assert.equal(await page.evaluate(()=>state.metrics.length),0);
        await research.locator('[data-ds="title"]').fill(source+' direct');
        await research.locator('[data-ds-save]').click();await research.waitFor({state:'detached'});
        await page.evaluate(()=>openModal('importModal'));
        await input.setInputFiles({name:source+'.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
        await page.waitForFunction(source=>!state.activeImportJob&&state.data[source].lastImport.duplicates===3,source);
        assert.equal(await page.evaluate(source=>state.data[source].rows.length,source),3);
      }
      await page.reload();await page.waitForFunction(()=>state.startup.completed);
      for(const source of ['weeklyRetail','weeklyReferral']){
        assert.deepEqual(await page.evaluate(async source=>{const item=state.researchItems.find(i=>i.title===source+' direct');return (await evaluateDatedStatsResearch(item)).data.map(p=>[p.label,p.value]);},source),dates.map((d,i)=>[d,[50,55,60][i]]));
      }
      // Optional mapping correction is saved without calendar confirmation.
      await page.evaluate(()=>{openModal('importModal');state.data.weeklyRetail.rows[2]['Alternate Date']='2026-09-28';markSourceCacheDirty('weeklyRetail','test date correction');renderDatedStatsImportSummary();});
      await page.locator('.advancedUploads > summary').click();
      await page.locator('[data-ds-config="weeklyRetail"]').click();
      const editor=page.getByRole('dialog',{name:/Retail Weekly Stats · Source configuration/});
      await editor.locator('[data-ds="dateField"]').selectOption('Alternate Date');
      await editor.locator('[data-ds-save]').click();await editor.waitFor({state:'detached'});
      const changed=await page.evaluate(async()=>{const item=state.researchItems.find(i=>i.title==='weeklyRetail direct');return (await evaluateDatedStatsResearch(item)).axisLabels;});
      assert.deepEqual(changed,['2026-09-13','2026-09-20','2026-09-28']);
      await page.reload();await page.waitForFunction(()=>state.startup.completed);
      assert.deepEqual(await page.evaluate(async()=>{const item=state.researchItems.find(i=>i.title==='weeklyRetail direct');return (await evaluateDatedStatsResearch(item)).axisLabels;}),changed);
      // The sentence builder uses the same inline field and optional date bounds.
      await page.evaluate(()=>window.AllStarSentenceWorkspace.open());
      const sentence=page.locator('dialog.sq-dialog');
      await sentence.locator('[data-sq-edit="metric"]').click();
      await sentence.locator('[data-sq-value="source"]').selectOption('weeklyReferral');
      await sentence.locator('[data-sq-value="metricId"]').selectOption('field:weeklyReferral:Consumer%20Appointment%20Rate');
      await sentence.getByRole('button',{name:'Apply to sentence',exact:true}).click();
      await sentence.locator('[data-sq-preview]').click();
      await sentence.locator('[data-ds-plot] circle').first().waitFor().catch(async e=>{console.error(await sentence.locator('[data-sq-status]').innerText(),errors);throw e;});
      assert.equal(await sentence.locator('[data-ds-plot] circle').count(),3);
      assert.equal(await page.evaluate(()=>state.metrics.length),0);
      assert.deepEqual(errors,[],file+' runtime errors');
      console.log('PASS '+file+': uploads, exact graph, no setup/metric, duplicate import, save/reopen, optional Edit and sentence builder');
      await context.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
