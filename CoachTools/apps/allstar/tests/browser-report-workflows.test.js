'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');

async function run(browser,file){
  const ctx=await browser.newContext({offline:true,viewport:{width:1100,height:750},timezoneId:'America/New_York'});
  try{
    const page=await ctx.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.dismiss());
    await page.goto(pathToFileURL(path.join(root,file)).href);
    await page.waitForFunction(()=>typeof state!=='undefined'&&state.startup.completed);
    await page.evaluate(()=>{
      const source='documented_coaching',headers=['System ID','Created By','Updated','Associate Name','Job Coach','Coaching Date','Description','Coaching Type'];
      const persons=Array.from({length:61},(_,i)=>'Person '+String(i).padStart(2,'0'));
      state.data[source].headers=headers;
      state.data[source].rows=persons.flatMap((name,i)=>['2026-01-01','2026-01-07','2026-02-01'].map((date,j)=>({
        'System ID':i,'Created By':'System','Updated':'2026-01-01','Associate Name':name,'Job Coach':'Alpha','Coaching Date':date,
        Description:j===1?'Punctuality':'Attendance','Coaching Type':j===1?'Attendance':'Other',
        _rep:name,_repKey:fullNameIdentityKey(name),_team:'Alpha',_date:date,_sourceKey:source
      })));
      state.sourceMeta[source]={sourceVersion:1};markDataIndexDirty('report fixture',{sources:[source]});rebuildDataIndexSync('report fixture');
      const c={...emptyCriterion(),id:'attendance',name:'Attendance coaching',source,calcType:'checklistCount',audience:'rep',checkColumn:'Description',
        checkDateColumn:'Coaching Date',checkText:'Attendance',scoreType:'points',points:2,
        rowPullConditions:[{id:'desc',column:'Description',connector:'base',operator:'contains',phrasesText:'"Attendance"'}]};
      state.models.push(normalizeModelForStorage({id:'browser-report',name:'Date and evidence fixture',criteria:[c,{...c,id:'second',name:'Second rule'}]}));
      openEditModel('browser-report');
    });
    await page.locator('#useRuleLibrary').check();
    const pick=page.locator('[data-library-rule="second"]');
    await pick.focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#criteriaList [data-crit]').count(),1);
    await page.locator('#criteriaList').getByRole('button',{name:'Test rule',exact:true}).click();
    const panel=page.locator('.ruleTestPanel');
    await panel.locator('[data-start]').fill('2026-01-01');await panel.locator('[data-end]').fill('2026-01-31');
    await panel.locator('[data-run]').click();
    await page.waitForFunction(()=>document.querySelector('.ruleTestPanel [data-output]').textContent.includes('after conditions'));
    const trace=await panel.locator('[data-output]').innerText();
    assert.match(trace,/Description → Description/);assert.match(trace,/1 after conditions/);assert.match(trace,/Result 1.*Score 2/);
    await page.setViewportSize({width:420,height:760});
    const library=await page.locator('#criterionLibraryList').boundingBox(),editor=await page.locator('#criteriaList').boundingBox();
    assert.ok(library.y+library.height<=editor.y+2,'narrow layout stacks list before the editor');
    await page.evaluate(async()=>{
      closeModal('editModelModal');await window.AllStarWorkspaceNavigation.execute('action:report-new');
      els.runModelSelect.value='browser-report';els.runModelSelect.dispatchEvent(new Event('change',{bubbles:true}));
      state.selectedTeams=new Set(['Alpha']);state.teamSelectionInitialized=true;renderTeamSelect();
    });
    await page.locator('#reportFocusedMode').check();
    await page.locator('#runStartDate').fill('2026-01-01');await page.locator('#runEndDate').fill('2026-01-31');
    await page.locator('#executeRunBtn').click();
    await page.waitForFunction(()=>state.lastRenderedReport?.model.id==='browser-report'&&!document.getElementById('runModal').classList.contains('open'));
    await page.locator('#reportResultScope').selectOption('1');
    assert.equal(await page.locator('#reportResultTable tr').count(),51);
    await page.locator('#reportPageNext').focus();await page.keyboard.press('Enter');
    assert.match(await page.locator('#reportPageCount').innerText(),/51–61 of 61/);
    assert.equal(await page.evaluate(()=>state.lastRenderedReport.repPack.rows.length),61);
    await page.evaluate(()=>{state.selectedTeams.clear();renderTeamSelect();});
    await page.locator('#openRecentRunsFromReport').click();
    await page.waitForSelector('[data-rerun-report]');
    await page.locator('[data-rerun-report]').first().click();
    await page.waitForFunction(()=>document.getElementById('reportStage').textContent.includes('settings restored'));
    assert.equal(await page.locator('#runStartDate').inputValue(),'2026-01-01');
    assert.equal(await page.locator('#runEndDate').inputValue(),'2026-01-31');
    assert.equal(await page.locator('#runModelSelect').inputValue(),'browser-report');
    assert.deepEqual(await page.evaluate(()=>[...state.selectedTeams]),['Alpha']);
    const files=[];
    page.on('download',download=>files.push(download.suggestedFilename()));
    const lastDownload=page.waitForEvent('download',{predicate:d=>/^west-region/.test(d.suggestedFilename())});
    await page.evaluate(()=>{
      state.orgs=[{id:'east',name:'East region',coachNames:['Alpha']},{id:'west',name:'West region',coachNames:['Alpha']}];
      state.multiRunOrgIds=new Set(['east','west']);applyRunMode('multi');renderRunWorkflow();
    });
    await page.locator('#executeRunBtn').click();
    await page.waitForFunction(()=>document.getElementById('reportStage').textContent.includes('2 organization PDFs exported'));
    await lastDownload;
    assert.equal(files.length,2);assert.match(files[0],/^east-region.*\.pdf$/);assert.match(files[1],/^west-region.*\.pdf$/);
    assert.equal(await page.evaluate(()=>state.lastRenderedReport.runOpts.organizationId),'east');
    const orgSnapshots=await page.evaluate(async()=>(await listSavedReportSummaries()).filter(r=>r.organizationName).map(r=>r.organizationName).sort());
    assert.deepEqual(orgSnapshots,['East region','West region']);
    assert.deepEqual(errors,[]);
    console.log('PASS offline '+file+': keyboard rule test, physical Description, narrow library, windowed result, saved settings, two organization PDFs and snapshots');
  }finally{await ctx.close();}
}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
  try{for(const file of process.argv.slice(2).length?process.argv.slice(2):['allstar.html','dist/All-Star-Portable.html'])await run(browser,file);}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
