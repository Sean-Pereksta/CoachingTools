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
    state.data.retail.headers.sv2=['Representative','Team','Cash Apps','Cash Opps','Referral Apps','Referral Opps'];
    state.data.retail.sv2=[{Representative:'Test Rep',Team:'Alpha','Cash Apps':10,'Cash Opps':20,'Referral Apps':5,'Referral Opps':10,_rep:'Test Rep',_repKey:fullNameIdentityKey('Test Rep'),_team:'Alpha',_sourceKey:'retail_sv2'}];
    state.sourceMeta.retail_sv2={sourceVersion:1};markDataIndexDirty('browser expression',{sources:['retail_sv2']});
    state.models=[normalizeModelForStorage({id:'test-model',name:'Cash Model',type:'both',criteria:[{...emptyCriterion(),id:'apps',name:'Cash Apps',source:'retail_sv2',column:'Cash Apps'}]})];
    state.researchItems=[normalizeResearchItem({id:'expression-ui',title:'Formula fixture',source:'retail_sv2',analysisGrain:'rows',groupField:'Team',outputType:'table',columns:[{mode:'sum',field:'Cash Apps'}]})];saveResearchItems();openResearchItemEditor('expression-ui');
   });
   await page.locator('[data-rw-mode="advanced"]').click();
   await page.locator('[data-rc="mode"]').selectOption('expression');
   const input=page.locator('[data-research-expression-input]');
   const formula='([Cash Apps] + [Referral Apps]) / ([Cash Opps] + [Referral Opps])';
   await input.fill(formula);
   await page.evaluate(()=>renderResearchColumnsEditor());assert.equal(await input.inputValue(),formula,'rerender preserves formula');
   await input.fill('');
   for(const character of '[Cash Apps] / [Cash Opps]'){
    await input.pressSequentially(character);
    assert.ok(await page.locator('#headerSuggestMenu.open,.rwFieldPicker,.researchValueSuggestions[data-model-picker]').count()<=1,'one surface throughout typing');
    assert.equal(await input.getAttribute('list'),null);
   }
   await input.fill('[Cash Ap] / [Cash Opps]');
   await input.evaluate(el=>{el.focus();el.setSelectionRange(8,8);el.dispatchEvent(new Event('input',{bubbles:true}));});
   assert.equal(await page.locator('#headerSuggestMenu.open').count(),1);
   assert.equal(await page.locator('.rwFieldPicker,.researchValueSuggestions[data-model-picker]').count(),0);
   assert.equal(await input.getAttribute('list'),null);
   await page.locator('#headerSuggestMenu button').filter({hasText:'Cash Apps'}).first().click();
   assert.equal(await input.inputValue(),'[Cash Apps] / [Cash Opps]');
   await page.waitForTimeout(100);assert.equal(await page.locator('#headerSuggestMenu.open').count(),0,'no delayed event reopens menu');
   await input.fill(';Cash');assert.equal(await page.locator('#headerSuggestMenu.open').count(),1);
   await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.match(await input.inputValue(),/^model\(/);
   await input.fill('[Cash');await page.keyboard.press('Escape');assert.equal(await page.locator('#headerSuggestMenu.open').count(),0);
   await input.fill('[Cash');await page.locator('#researchTitleInput').click();assert.equal(await page.locator('#headerSuggestMenu.open').count(),0);
   await input.fill(formula);await page.locator('#saveResearchItemBtn').click();
   await page.waitForFunction(()=>!document.getElementById('researchEditorModal').classList.contains('open'));
   assert.equal(await page.evaluate(()=>state.researchItems.find(x=>x.id==='expression-ui').columns[0].field),formula);
   assert.equal(await page.evaluate(()=>evaluateResearchItem(state.researchItems.find(x=>x.id==='expression-ui')).data[0].values[0]),0.5);
   await page.evaluate(()=>openResearchItemEditor('expression-ui'));await page.locator('[data-rw-mode="advanced"]').click();assert.equal(await input.inputValue(),formula);
   await page.evaluate(()=>{closeModal('researchEditorModal');window.AllStarResearchWorkspace.duplicate('expression-ui');});
   assert.equal(await input.inputValue(),formula,'duplicate retains expression');
   await page.evaluate(()=>{closeModal('researchEditorModal');closeModal('researchModal');state.models[0].criteria[0].calcType='custom';openEditModel('test-model');});
   const modelInput=page.locator('[data-expression-input]').first();await modelInput.fill('[Cash');
   assert.equal(await page.locator('#headerSuggestMenu.open').count(),1);assert.equal(await page.locator('.rwFieldPicker,.researchValueSuggestions[data-model-picker]').count(),0);
   await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');assert.match(await modelInput.inputValue(),/^\[Cash/);
   await page.evaluate(()=>closeModal('editModelModal'));
   await page.evaluate(()=>{closeModal('researchEditorModal');closeModal('researchModal');state.orgs=[normalizeOrg({id:'long-org',name:'Specialty Consumer Operations Support Organization',coachNames:['Alpha']})];state.activeOrgId='long-org';saveOrgs();openOrgBuilder();});
   for(const width of [1280,750,480]){
    await page.setViewportSize({width,height:900});
    const boxes=await page.locator('.orgCard').first().evaluate(el=>{const n=el.querySelector('strong').getBoundingClientRect(),m=el.querySelector('span').getBoundingClientRect();return {nameBottom:n.bottom,metaTop:m.top,scroll:el.scrollWidth,width:el.clientWidth};});
    assert.ok(boxes.nameBottom<=boxes.metaTop,'metadata never overlaps name at '+width);assert.ok(boxes.scroll<=boxes.width+1);
   }
   await page.locator('[data-org-coach="Alpha"]').uncheck();assert.match(await page.locator('#orgCountBadge').innerText(),/^0 coaches/);
   await page.locator('[data-org-coach="Alpha"]').check();assert.match(await page.locator('#orgCountBadge').innerText(),/^1 coaches/);
   assert.equal(await page.locator('.orgHealthCard').count(),6);
   await page.reload();await page.waitForFunction(()=>state.startup.completed);assert.equal(await page.evaluate(()=>state.researchItems.find(x=>x.id==='expression-ui').columns[0].field),formula,'storage survives reload');
   assert.deepEqual(errors,[],file);console.log('PASS '+file+': expression mode, save/run/reopen/duplicate, one popup, caret insertion, keyboard, org responsive layout and selection');
   await context.close();
  }
  const context=await browser.newContext({viewport:{width:900,height:900},timezoneId:'America/New_York'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(path.resolve(root,'../coaching-gaps.html')).href);await page.waitForFunction(()=>typeof render==='function' && els.dockHint.textContent.startsWith('Loaded'));
  await page.evaluate(()=>{
   selectedTeam='Alpha';allRows=Array.from({length:12},(_,i)=>({Name:i%2?'Second Rep':'Test Rep',Sheet:'Alpha',_d:new Date(2026,8,7+Math.floor(i/2)*7),Apps:10,Opps:20}));
   fieldMap={consumerApps:'Apps',consumerOpps:'Opps'};els.startDate.value='2026-09-07';els.endDate.value='2026-10-18';els.minCovInp.value='0';rebuildTeamIndex();
   coachingTypes=['Scorecard','Team Meeting'];enabledTypes=new Set(['Scorecard']);includedCoachingTerms=new Set(['retention']);excludedCoachingTerms=new Set(['meeting']);
   checklistCriteria=[{id:'keep-id',name:'Keep name',color:'#abcdef',mode:'exclude',incident:'Missed Item',incidentTerms:[],keywords:['word']}];selectedCriteriaId='keep-id';render();
  });
  assert.equal(await page.evaluate(()=>reportWeekLabel('2026-W38')),'9/13/2026');
  assert.equal(await page.evaluate(()=>reportWeekLabel('2026-W01')),'12/28/2025');
  assert.ok(await page.locator('.activeFilterChip').count()>=4);
  await page.locator('.activeFilterChip').first().click();assert.equal(await page.locator('#panelChevron').getAttribute('aria-expanded'),'true');await page.locator('#filterCloseBtn').click();
  assert.ok(await page.locator('#repList .timelineDates').count()>0);
  const x=await page.locator('#repList .repNameBtn').first().evaluate(el=>el.getBoundingClientRect().left);
  await page.locator('#repList .timelineScroller').first().evaluate(el=>{el.scrollLeft=200;});
  assert.equal(await page.locator('#repList .repNameBtn').first().evaluate(el=>el.getBoundingClientRect().left),x);
  await page.locator('#resetReportFilters').click();assert.equal(await page.locator('.activeFilterChip').count(),0);
  assert.deepEqual(await page.evaluate(()=>[checklistCriteria[0].id,checklistCriteria[0].name,checklistCriteria[0].color]),['keep-id','Keep name','#abcdef']);
  assert.equal(await page.evaluate(()=>els.startDate.value),'2026-09-07');
  assert.deepEqual(errors,[],'Coaching Gaps runtime errors');console.log('PASS Coaching Gaps: actual date labels, year boundary, fixed names, active filters, drawer and scoped reset');
  await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
