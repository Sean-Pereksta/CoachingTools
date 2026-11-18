'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
  try{
    for(const file of process.argv.slice(2).length?process.argv.slice(2):['allstar.html','dist/All-Star-Portable.html']){
      const page=await browser.newPage({viewport:{width:740,height:900}}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('dialog',dialog=>{errors.push(dialog.message());return dialog.dismiss();});
      await page.goto(pathToFileURL(path.resolve(__dirname,'..',file)).href);
      await page.waitForFunction(()=>typeof state!=='undefined'&&state.startup.completed);
      await page.evaluate(async()=>{
        state.data.retail.headers.sv2=['Representative','Team','Value'];
        state.data.retail.sv2=[0,5,12].map((Value,i)=>({Representative:'Person '+i,Team:'Team A',Value,Date:'2026-09-01',_rep:'Person '+i,_repKey:'person '+i,_team:'Team A'}));
        state.sourceMeta.retail_sv2={sourceVersion:1};
        state.data.documented_coaching.headers=['Representative','Team','Amount','Coaching Date'];
        state.data.documented_coaching.rows=[14,15,16,17].map((d,i)=>({Representative:'Alice Example',Team:'Team A',Amount:[80,2,4,100][i],'Coaching Date':'2026-11-'+d,_rep:'Alice Example',_repKey:'alice example',_team:'Team A',_sourceKey:'documented_coaching'}));
        await openResearchWorkspace();
      });
      await page.locator('#researchLibraryToggle').click();
      await page.locator('#researchNewQuestionBtn').focus();
      await page.keyboard.press('Enter');
      const chooser=page.locator('.rwQuestionDialog');
      await chooser.locator('[name=source]').selectOption('retail_sv2');
      await chooser.locator('[name=intent]').selectOption('Show a distribution');
      await chooser.locator('[name=search]').fill('Value');
      assert.match(await chooser.locator('[data-question-summary]').innerText(),/Histogram.*Value/);
      await chooser.locator('[data-question-open]').click();
      assert.equal(await page.locator('#researchOutputType').inputValue(),'histogram');
      assert.equal(await page.locator('#researchValueField').inputValue(),'Value');
      const title=await page.locator('#researchTitleInput').inputValue();
      assert.match(title,/Show a distribution.*Value/);
      await page.locator('#researchSaveDefinitionBtn').click();
      await page.waitForFunction(title=>state.researchItems.some(item=>item.title===title),title);
      const id=await page.evaluate(title=>state.researchItems.find(item=>item.title===title).id,title);
      assert.equal(await page.locator('[data-lib-open="'+id+'"]').isEnabled(),false);
      await page.locator('[data-lib-check="'+id+'"]').check();
      await page.locator('#researchRunSelected').click();
      await page.waitForFunction(id=>!!state.researchItems.find(item=>item.id===id)?.renderedResult?.inputKey,id);
      await page.locator('[data-lib-open="'+id+'"]').click();
      await page.locator('#researchLibraryDetail button').filter({hasText:'Export full result CSV'}).waitFor();
      const snapshot=await page.evaluate(id=>researchRenderedResultGet(id),id);
      assert.equal(snapshot.snapshotDefinition.valueField,'Value');
      assert.ok(snapshot.data.length);
      await page.locator('#researchRunStale').click();
      await page.waitForFunction(()=>document.querySelector('#researchCanvasStatus').textContent==='All saved snapshots are current.');
      await page.locator('#researchNewQuestionBtn').click();
      await chooser.locator('[name=source]').selectOption('retail_sv2');
      assert.equal(await chooser.locator('[name=from]').isVisible(),false);
      await chooser.locator('[name=source]').selectOption('documented_coaching');
      await chooser.locator('[name=search]').fill('Amount');
      assert.equal(await chooser.locator('[name=time]').inputValue(),'dates');
      await chooser.locator('[name=from]').fill('2026-11-15');await chooser.locator('[name=through]').fill('2026-11-16');
      await chooser.locator('[data-question-open]').click();
      assert.equal(await page.locator('#researchStartDate').inputValue(),'2026-11-15');
      assert.equal(await page.locator('#researchEndDate').inputValue(),'2026-11-16');
      await page.locator('#researchSaveDefinitionBtn').click();
      await page.waitForFunction(()=>state.researchItems.some(i=>i.source==='documented_coaching'));
      const datedId=await page.evaluate(()=>state.researchItems.find(i=>i.source==='documented_coaching').id);
      await page.locator('[data-lib-run="'+datedId+'"]').click();
      await page.waitForFunction(id=>!!state.researchItems.find(i=>i.id===id)?.renderedResult,datedId);
      const dated=await page.evaluate(id=>researchRenderedResultGet(id),datedId);
      assert.equal(dated.snapshotDefinition.startDate,'2026-11-15');assert.equal(dated.snapshotDefinition.endDate,'2026-11-16');
      assert.deepEqual(dated.data.map(row=>row.values[0]),[3],'Both boundary dates are included, and amounts outside the window are skipped');
      await page.evaluate(id=>{
        state.data.retail.sv2=[];state.sourceMeta.retail_sv2.sourceVersion++;
        state.researchItems.find(item=>item.id===id).title='Edited definition';
        saveResearchItems();window.AllStarResearchLibrary.refresh();
      },id);
      await page.locator('[data-lib-open="'+id+'"]').click();
      await page.waitForFunction(title=>document.querySelector('#researchLibraryDetail h3')?.textContent===title,title);
      const reread=await page.evaluate(id=>researchRenderedResultGet(id),id);
      assert.deepEqual(reread.data,snapshot.data);
      const guards=await page.evaluate(async id=>{
        const item=state.researchItems.find(i=>i.id===id),previous=await researchRenderedResultGet(id);
        state.activeImportJob={id:'pending'};
        try{
          const blocked=await researchSaveRenderedResult(item,{data:[]});
          const readable=await researchRenderedResultGet(id);
          if(blocked||readable.snapshotDefinition.title!==previous.snapshotDefinition.title)return false;
        }finally{state.activeImportJob=null;}
        let checks=0,aborted=false;
        try{await researchRenderedResultPut(item,{data:[{label:'partial'}]},new Date().toISOString(),()=>++checks<=2);}
        catch(error){aborted=error.name==='AbortError';}
        return aborted&&JSON.stringify((await researchRenderedResultGet(id)).data)===JSON.stringify(previous.data);
      },id);
      assert.equal(guards,true,'A staged import and cancellation before pointer promotion preserve the previous snapshot');
      const second=await page.evaluate(async id=>{
        const first=state.researchItems.find(i=>i.id===id),result=await researchRenderedResultGet(id);
        const {renderedResult,...definition}=first;
        const other={...definition,id:'independent-source',title:'Independent source',source:'referral_sv2'};
        state.researchItems.push(other);saveResearchItems();
        await researchSaveRenderedResult(other,{...result,lineage:{...result.lineage,source:'referral_sv2'},data:[{label:'Second source',values:[0]}]});
        window.AllStarResearchLibrary.refresh();return other.id;
      },id);
      await page.locator('[data-lib-check="'+second+'"]').check();
      await page.locator('#researchCompareSnapshots').click();
      await page.locator('#researchLibraryDetail h3').filter({hasText:'Independent source summaries'}).waitFor();
      assert.equal(await page.locator('.rwSnapshotPair > section').count(),2);
      await page.evaluate(second=>{const item=state.researchItems.find(i=>i.id===second);delete item.renderedResult;persistResearchItemsToLocalStorage();},second);
      assert.equal(await page.locator('#researchLibraryDetail').innerText(),'Choose a saved snapshot to view its result.');
      await page.locator('#researchLibraryToggle').click();
      assert.equal(await page.locator('#researchLibrary').isVisible(),false);
      await page.evaluate(()=>{
        const headers=['Date','Name','Sheet','Cash Rate'],E=window.AllStarDatedStats,config={...E.defaultConfig('weeklyRetail',headers),calendar:{reviewed:true,frequency:'week',label:'ending'},fields:{'Cash Rate':{kind:'percentage',inputUnit:'percentage-points'}}};
        state.data.weeklyRetail={fileName:'weekly.csv',headers,config,rows:[{Name:'Person One',Date:'2026-09-06',Sheet:'Alpha','Cash Rate':25},{Name:'Person Two',Date:'2026-09-06',Sheet:'Alpha','Cash Rate':50}]};
        state.data.documented_coaching.headers=['Coaching Date','Name','Session ID'];
        state.data.documented_coaching.rows=[{_rep:'Person One',_repKey:fullNameIdentityKey('Person One'),Name:'Person One','Coaching Date':'2026-09-03','Session ID':'session-one'}];
        state.metrics.push({...E.normalizeMetric({id:'paired-rate',name:'Cash rate',source:'weeklyRetail',field:'Cash Rate',kind:'percentage'}),dataCategory:'datedStats'});
        for(const source of ['weeklyRetail','documented_coaching'])noteCategorizationSourceVersion(source);
      });
      await page.locator('#researchNewQuestionBtn').click();
      await chooser.locator('[name=source]').selectOption('weeklyRetail');
      await chooser.locator('[name=intent]').selectOption('Find a relationship');
      await chooser.locator('[name=search]').fill('coaching sessions');
      assert.match(await chooser.locator('[data-question-summary]').innerText(),/canonical representatives/);
      await chooser.locator('[data-question-open]').click();
      const pairedEditor=page.getByRole('dialog',{name:'Weekly Stats Research',exact:true});
      await pairedEditor.locator('[data-pair-sample]').click();
      assert.match(await pairedEditor.locator('[data-pair-sample]').locator('../..').innerText(),/matched representative keys/);
      await pairedEditor.locator('[data-pair-cover]').click();
      const coverage=page.locator('[data-coverage-source="documented_coaching"]');
      await coverage.locator('[data-ds="start"]').fill('2026-08-31');await coverage.locator('[data-ds="end"]').fill('2026-09-06');await coverage.locator('[data-ds="complete"]').check();
      await coverage.locator('xpath=ancestor::*[@role="dialog"][1]').locator('[data-ds-save]').click();
      await pairedEditor.locator('[data-ds-run]').click();
      await pairedEditor.getByText('All paired values and evidence',{exact:true}).click();
      assert.match(await pairedEditor.innerText(),/2 matched/);
      await pairedEditor.getByText(/session-one/).first().waitFor();
      const downloading=page.waitForEvent('download');await pairedEditor.getByText('Export all paired values CSV',{exact:true}).click();
      const downloaded=await downloading,csv=require('node:fs').readFileSync(await downloaded.path(),'utf8');
      assert.match(csv,/session-one/);assert.match(csv,/documented_coaching/);assert.match(csv,/2026-08-31 through 2026-09-06/);
      assert.deepEqual(errors,[]);
      console.log('PASS '+file+' keyboard question builder, saved/selected run, frozen evidence, import/cancel protection, independent summaries, verified rep-week scatter, paired evidence and full CSV');
      await page.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
