'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    for(const file of (process.env.ALLSTAR_GROUPS_MODULAR_ONLY?['allstar.html']:['allstar.html','dist/All-Star-Portable.html'])){
      const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('dialog',dialog=>dialog.accept());
      await page.goto(pathToFileURL(path.join(root,file)).href);
      await page.waitForFunction(()=>typeof state!=='undefined'&&state.startup.completed);
      await page.evaluate(()=>{
        const rows=[['Alice Able','Coach Alpha'],['Bob Baker','Coach Alpha'],['Cara Clark','Coach Beta']].map(([Representative,Team])=>({Representative,Team,_rep:Representative,_repKey:fullNameIdentityKey(Representative),_team:Team,_sourceKey:'retail_sv2'}));
        state.data.retail.headers.sv2=['Representative','Team'];state.data.retail.sv2=rows;state.sourceMeta.retail_sv2={sourceVersion:1};
        markDataIndexDirty('browser Research Groups fixture',{sources:['retail_sv2']});rebuildDataIndexSync('browser Research Groups fixture');
      });
      await page.locator('[data-as-section="Research Groups"]').click();
      await page.waitForFunction(()=>document.getElementById('researchGroupBuilderModal').classList.contains('open'));
      await page.locator('#createResearchGroupBtn').click();
      await page.locator('#researchGroupNameInput').fill('Appointment work group');
      await page.locator('#saveResearchGroupBtn').click();
      await page.locator('#researchGroupPasteInput').fill('Alice Able, Bob Bker\nCara Clark\nMissing Person');
      await page.locator('#researchGroupMatchBtn').click();
      await page.waitForFunction(()=>!researchGroupsUi.running&&researchGroupsUi.review.length===4);
      assert.deepEqual(await page.evaluate(()=>state.researchGroups[0].repNames),[],'matching is a preview until apply');
      assert.equal(await page.locator('[data-research-group-approve="1"]').isChecked(),false,'fuzzy matches need explicit approval');
      await page.locator('[data-research-group-approve="1"]').check();
      await page.locator('#researchGroupApplyMatchesBtn').click();
      assert.deepEqual(await page.evaluate(()=>activeResearchGroup().repNames),['Alice Able','Bob Baker','Cara Clark']);
      assert.deepEqual(await page.evaluate(()=>currentTeamIndex().reps.filter(r=>r.name==='Cara Clark').map(r=>r.team)),['Coach Beta']);
      if(process.env.ALLSTAR_GROUPS_SCREENSHOT)await page.screenshot({path:process.env.ALLSTAR_GROUPS_SCREENSHOT,fullPage:true});
      await page.locator('#researchGroupBuilderModal [data-close]').first().click();
      await page.evaluate(()=>openResearchItemEditor(null));
      await page.locator('[data-rw-target="researchPopulationScopeSection"]').click();
      await page.locator('#researchIncludeGroupInput').fill('Appointment work group');
      await page.locator('#researchIncludeGroupAdd').click();
      await page.locator('#researchIncludeTeamInput').fill('Coach Alpha');
      await page.locator('#researchAddIncludeTeamBtn').click();
      assert.deepEqual(await page.evaluate(()=>researchApplyPopulationScope(state.data.retail.sv2,{source:'retail_sv2',populationScope:state.editingResearchPopulationScope}).map(r=>r._rep)),['Alice Able','Bob Baker']);
      assert.equal((await page.locator('#researchIncludeGroupChips').innerText()).replace(/\s*×$/,'×'),'Appointment work group×');
      await page.setViewportSize({width:600,height:800});
      await page.evaluate(()=>{closeModal('researchEditorModal');openResearchGroupBuilder();});
      const bounds=await page.locator('#researchGroupBuilderModal > .modal').boundingBox();
      assert.ok(bounds.width<=600&&bounds.height<=800,'manager fits a small window');
      assert.equal(await page.evaluate(()=>{const node=document.querySelector('#researchGroupBuilderModal .modalBody');return node.scrollWidth<=node.clientWidth+2;}),true,'small manager has no page-width overflow');
      await page.reload();await page.waitForFunction(()=>state.startup.completed);
      assert.deepEqual(await page.evaluate(()=>state.researchGroups[0].repNames),['Alice Able','Bob Baker','Cara Clark'],'groups survive restart');
      assert.deepEqual(errors,[],file+' browser errors');
      console.log('PASS '+file+': navigation, comma/newline paste, fuzzy approval, membership, coach preservation, org/rep intersection, persistence and responsive layout');
      await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
