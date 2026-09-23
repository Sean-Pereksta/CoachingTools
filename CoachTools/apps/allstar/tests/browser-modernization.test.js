'use strict';
// Optional real Chromium gate. Install Playwright separately or point
// PLAYWRIGHT_MODULE and CHROMIUM_PATH at an existing local installation.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    for(const file of ['allstar.html','dist/All-Star-Portable.html']){
      const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'UTC'}),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('dialog',dialog=>dialog.dismiss());
      await page.goto(pathToFileURL(path.join(root,file)).href);
      await page.waitForFunction(()=>typeof state!=='undefined'&&state.startup.completed);
      assert.equal(await page.locator('#asWorkspaceHeader').count(),1);
      assert.deepEqual(await page.evaluate(()=>[typeof XLSX.utils.book_new,typeof html2pdf,typeof jspdf.jsPDF]),['function','function','function']);
      await page.locator('[data-as-open-palette]').first().click();
      await page.locator('#asCommandInput').fill('Open Research');
      await page.keyboard.press('Enter');
      await page.waitForFunction(()=>document.getElementById('researchModal').classList.contains('open'));
      await page.evaluate(()=>{ closeModal('researchModal'); openEditModel(state.models.find(m=>m.criteria.length>1).id); });
      assert.ok(await page.locator('#modelWorkspaceSummary').innerText());
      await page.locator('#modelCriterionSearch').fill('no matching criterion');
      assert.equal(await page.locator('#criteriaList [data-crit]:visible').count(),0);
      await page.evaluate(()=>closeModal('editModelModal'));
      await page.evaluate(async()=>{
        state.data.retail.headers.sv2=['Representative','Team','Value','Date'];
        state.data.retail.sv2=Array.from({length:1000},(_,i)=>({Representative:'Rep '+i,Team:i%2?'Beta':'Alpha',Value:i%10,Date:'2026-09-01',_rep:'Rep '+i,_repKey:'rep'+i,_team:i%2?'Beta':'Alpha'}));
        state.sourceMeta.retail_sv2={sourceVersion:1};markDataIndexDirty('browser fixture',{sources:['retail_sv2']});
        const item=normalizeResearchItem({id:'browser-research',title:'Team value',source:'retail_sv2',analysisGrain:'rows',groupField:'Team',columns:[{label:'Value',mode:'sum',field:'Value'}],outputType:'table',valueMode:'sum',valueField:'Value'});
        state.researchItems=[item];saveResearchItems();
        const result=await evaluateResearchItemAsync(item);window.browserFixture={item,result};
        await researchSaveRenderedResult(item,result); hideProgress();
        window.AllStarCharts.open(item,result);
      });
      assert.equal(await page.locator('.asc-stage svg').count(),1);
      const calculations=await page.evaluate(()=>state.researchPerformanceRuns.length);
      await page.locator('.asc-controls summary').filter({hasText:'Appearance'}).click();
      const builds=await page.evaluate(()=>window.AllStarCharts.stats.datasetBuilds);
      await page.locator('[data-setting="title"]').fill('Edited chart title');
      await page.locator('[data-setting="title"]').blur();
      assert.equal(await page.locator('.asc-stage [data-title]').innerText(),'Edited chart title');
      assert.equal(await page.evaluate(()=>window.AllStarCharts.stats.datasetBuilds),builds,'appearance reuses the projection');
      assert.equal(await page.evaluate(()=>state.researchPerformanceRuns.length),calculations,'appearance does not run Research');
      await page.locator('[data-pin]').click();
      assert.equal(await page.evaluate(()=>window.AllStarCharts.savedCharts().length),1);
      assert.equal(await page.evaluate(()=>window.AllStarCharts.boardCards().length),1);
      await page.locator('[data-asc-close]').click();
      await page.evaluate(()=>window.AllStarCharts.openBoard());
      await page.waitForFunction(()=>!!document.querySelector('[data-card-content] svg'));
      await page.locator('[data-asc-close]').click();
      await page.evaluate(()=>openResearchItemEditor('browser-research'));
      await page.locator('[data-rw-mode="advanced"]').click();
      await page.locator('#researchTitleInput').fill('Unsaved title');
      await page.waitForFunction(()=>!document.getElementById('rwUndo').disabled);
      await page.locator('#rwUndo').click();
      assert.equal(await page.locator('#researchTitleInput').inputValue(),'Team value');
      await page.setViewportSize({width:600,height:800});
      assert.ok(await page.locator('#researchEditorModal').isVisible());
      assert.deepEqual(errors,[],file+' runtime errors');
      console.log('PASS file:// '+file+': startup, keyboard navigation, model search, real Research, chart reuse/save/board, editor undo, small window');
      await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
