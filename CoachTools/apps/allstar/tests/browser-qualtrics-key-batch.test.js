'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const XLSX=require('../../../vendor/xlsx.full.min.js');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
  try{
    const page=await browser.newPage({timezoneId:'America/New_York'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname,'../qualtrics/generator.html')).href);
    const ready=()=>page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready.'));
    await ready();
    assert.equal(await page.locator('#keyBatchTools').isHidden(),true);
    await page.locator('#toggleQualtricsWorkflow').click();
    assert.equal(await page.locator('[data-tab="keyfiles"]').innerText(),'Data');
    const packageParity=await page.evaluate(async()=>{
      const time=Date.UTC(2026,10,17,15),rng=.125,stamp={time,suffix:rng.toString(36).slice(2)};
      const entries=[
        ['Executive_2026-11-17.msg','report',['Executive — November','<p>José &amp; Alex</p>']],
        ['Executive_History_2026-11-17.eml','report',['Executive history','<img src="data:image/png;base64,YWJjZA==">']],
        ['Coach_North_2026-11-17.msg','report',['Coach North','<p>0%</p>']],
        ['Alex_Example.eml','individual',[{fullName:'Alex Example',email:'alex@example.test',message:'Hello Alex,\n\nReview <attendance> & follow-up.'}]]
      ];
      const baseline=new JSZip();
      for(const [name,kind,args] of entries)baseline.file(name,(kind==='report'?makeEml:individualEml)(...args,stamp),{date:new Date(time)});
      const expected=await baseline.generateAsync({type:'uint8array'}),originalPost=Worker.prototype.postMessage,originalRandom=Math.random,originalNow=Date.now;
      let finishes=0,failure=false;
      Worker.prototype.postMessage=function(message){
        if(message.action==='finish'){
          finishes++;
          if(failure){queueMicrotask(()=>this.onmessage({data:{error:'Simulated packaging failure'}}));return;}
        }
        return originalPost.apply(this,arguments);
      };
      Date.now=()=>time;Math.random=()=>rng;
      const run=async()=>{
        const archive=QualtricsEmailPackage.create();
        try{
          for(const e of entries)await archive.add(...e);
          const bytes=new Uint8Array(await (await archive.finish()).arrayBuffer());
          const zip=await JSZip.loadAsync(bytes);
          return {same:bytes.length===expected.length&&bytes.every((v,i)=>v===expected[i]),names:Object.keys(zip.files)};
        }finally{archive.close();}
      };
      try{
        const worker=await run();failure=true;const fallback=await run();
        return {finishes,worker,fallback};
      }finally{Math.random=originalRandom;Date.now=originalNow;Worker.prototype.postMessage=originalPost;}
    });
    assert.equal(packageParity.finishes,2,'The offline Worker packaged the first ZIP and attempted the second one');
    assert.equal(packageParity.worker.same,true,'Worker MIME and ZIP bytes must equal the legacy archive at a fixed clock and random boundary');
    assert.deepEqual(packageParity.worker,packageParity.fallback,'Injected worker failure must preserve ZIP entries, ordering, and bytes');
    const qa=XLSX.utils.book_new(),checklist=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(qa,XLSX.utils.aoa_to_sheet([['Report cover'],['Notes']]),'Cover');
    XLSX.utils.book_append_sheet(qa,XLSX.utils.aoa_to_sheet([[null,null,null,null,'Agent Name','Score %','Interaction Start Time','Coach'],[null,null,null,null,'Alex Example','95%','2026-11-16','Coach North']]),'Evals');
    XLSX.utils.book_append_sheet(checklist,XLSX.utils.aoa_to_sheet([['Associate Name','Incident Date','Incident','Job Coach'],['Alex Example','2026-11-15','Attendance','Coach North']]),'Checklist');
    const utf16=Buffer.concat([Buffer.from([255,254]),Buffer.from('Agent Name\tDate Column\tConsumer Appointments\tConsumer Opportunities\tCoach\r\nAlex Example\t2026-11-16\t0\t10\tCoach North','utf16le')]);
    const coaching=Buffer.from('System ID,Created By,Revision,Associate Name,Coaching Date,Description,Coaching Type,Job Coach\r\n1,Admin,3,Alex Example,2026-11-15,"First line, Attendance\nSecond ""quoted"" line",Other,Coach North');
    const files=[{name:'Coaching.csv',mimeType:'text/csv',buffer:coaching},{name:'Evals.xlsx',mimeType:'application/octet-stream',buffer:XLSX.write(qa,{type:'buffer',bookType:'xlsx'})},{name:'Checklist.xls',mimeType:'application/octet-stream',buffer:XLSX.write(checklist,{type:'buffer',bookType:'xls'})},{name:'Weekly.tsv',mimeType:'text/tab-separated-values',buffer:utf16}];
    const pick=async input=>{await page.locator('#keyBatchPicker').setInputFiles(input.map(file=>({...file,buffer:Buffer.from(file.buffer)})));await page.waitForFunction(()=>state.keyBatch&&!state.keyBatch.busy);};
    await page.evaluate(()=>{
      window.rebuilds=0;const prev=rebuildDerivedMaps;rebuildDerivedMaps=()=>{rebuilds++;return prev();};
      const original=XLSX.read;window.mainThreadWorkbooks=0;XLSX.read=(...args)=>{mainThreadWorkbooks++;return original(...args);};
    });
    await pick(files);
    assert.deepEqual(await page.evaluate(()=>state.keyBatch.items.map(i=>[i.slot,i.selected.length])),[['coaching',1],['qa',1],['checklist',1],['weeklyStats',1]]);
    assert.deepEqual(await page.evaluate(()=>Object.values(state.masterRows).map(r=>r.length)),[0,0,0,0]);
    await page.locator('#applyKeyBatch').click();await page.waitForFunction(()=>!state.keyBatch);
    assert.equal(await page.evaluate(()=>mainThreadWorkbooks),0,'Offline workbook discovery and materialization use the batch worker');
    assert.deepEqual(await page.evaluate(()=>({counts:Object.values(state.masterRows).map(r=>r.length),rebuilds,score:state.qaRows[0].score,description:state.coachingRows[0].raw.Description,zero:state.weeklyStatsRows[0].raw['Consumer Appointments']})),{counts:[1,1,1,1],rebuilds:1,score:.95,description:'First line, Attendance\nSecond "quoted" line',zero:'0'});
    await pick([files[0],{...files[0],name:'Corrected Coaching.csv'}]);assert.equal(await page.locator('#applyKeyBatch').isDisabled(),true);
    await page.locator('#cancelKeyBatch').click();assert.equal(await page.evaluate(()=>state.masterFileNames.coaching),'Coaching.csv');
    await pick([{...files[3],name:'Replacement Weekly.tsv'},{name:'Bad Checklist.csv',mimeType:'text/csv',buffer:Buffer.from('Associate Name,Incident Date,Incident\nAlex Example,invalid,Attendance')}]);
    await page.locator('#applyKeyBatch').click();await page.waitForFunction(()=>state.keyBatch&&!state.keyBatch.busy&&state.keyBatch.items.some(i=>i.error));
    assert.equal(await page.evaluate(()=>state.masterFileNames.weeklyStats),'Weekly.tsv');
    await page.locator('#applyKeyBatch').click();await page.waitForFunction(()=>state.masterFileNames.weeklyStats==='Replacement Weekly.tsv');
    assert.equal(await page.evaluate(()=>state.masterFileNames.checklist),'Checklist.xls');await page.locator('#cancelKeyBatch').click();
    await page.evaluate(async()=>{
      await importAllStarCoreFiles({files:{qa:{rows:[{'Agent Name':'Other Person'}]}}});
      if(state.masterFileNames.qa!=='Evals.xlsx')throw Error('Bridge overwrote manual QA');
      state.rules=[normalizeRule({id:'attendance',title:'Attendance',ruleType:'statCount',statCount:{source:'coaching',nameHeader:'Associate Name',conditionHeader:'Description',operator:'contains',value:'Attendance',minCount:1},individualMessage:{concern:{enabled:true,sourceType:'legacy',operator:'legacy',message:'(FirstName), review your attendance.'}}})];
      await put(STORES.rules,state.rules[0]);
      state.currentRuleId='attendance';state.selectedOtherRuleIds=new Set(['attendance']);fillRuleForm(state.rules[0]);switchTab('rules');
    });
    await page.locator('#sampleKeyRuleBtn').click();await page.waitForFunction(()=>document.querySelector('#keyRuleTestResult').textContent.includes('Alex Example'));
    assert.match(await page.locator('#keyRuleTestResult').innerText(),/Second "quoted" line/);
    await page.locator('[data-show-message]').click();await page.waitForFunction(()=>document.querySelector('[data-message-result]').textContent.includes('Alex, review your attendance.'));
    await page.locator('#fullKeyRuleBtn').click();await page.waitForFunction(()=>document.querySelector('#keyRuleTestResult').textContent.includes('Full rule preview'));
    await page.evaluate(async()=>{els.reportDate.value='2026-11-17';switchTab('report');await runEmailWorkflow(false);if(!state.report)throw Error(els.status.textContent);window.reviewId=state.report.runId;window.evaluations=0;const evaluate=generateReport;generateReport=async()=>{evaluations++;return evaluate();};window.downloads=[];downloadBlob=(_,name)=>downloads.push(name);await runEmailWorkflow(true);});
    assert.deepEqual(await page.evaluate(()=>({evaluations,downloads,recorded:state.concernHistoryLoad.names.length,who:state.report.flagged.map(r=>r.repName)})),{evaluations:0,downloads:['coaching_opportunity_emails_2026-11-17.zip'],recorded:0,who:['Alex Example']});
    await page.evaluate(async()=>{
      switchTab('rules');await beginRuleStudio(state.rules[0]);document.querySelector('[data-rule-step="qualifies"]').click();
    });
    await page.locator('#statCountMin').fill('2');await page.locator('#saveStatCountRuleBtn').click();
    await page.locator('#ruleTitle').fill('Draft title');
    await page.waitForTimeout(800);
    assert.deepEqual(await page.evaluate(async()=>{
      const stored=await studioRuleRead('attendance');
      await runEmailWorkflow(true);
      return [state.rules[0].title,stored.statCount.minCount,evaluations,state.report.runId,state.ruleStudio.value.title];
    }),['Attendance',1,0,await page.evaluate(()=>reviewId),'Draft title']);
    await page.evaluate(()=>switchTab('rules'));
    await page.locator('#fullKeyRuleBtn').click();await page.waitForFunction(()=>document.querySelector('#keyRuleTestResult').textContent.includes('0 qualifying'));
    await page.locator('#cancelRuleDraft').click();await page.waitForFunction(()=>state.ruleStudio&&!state.ruleStudio.dirty&&els.statCountMin.value==='1');
    await page.locator('#ruleTitle').fill('Attendance saved');await page.locator('#saveRuleBtn').click();
    await page.waitForFunction(()=>state.rules[0].title==='Attendance saved'&&state.ruleStudio&&!state.ruleStudio.dirty);
    assert.equal(await page.evaluate(async()=>(await studioRuleRead('attendance')).title),'Attendance saved');
    assert.equal(await page.evaluate(()=>emailEvaluationCurrent(state.report)),false);
    await page.evaluate(async()=>{
      for(const type of ['multiHeader','headerCount','statRule','statCount','coachingCorrective']){
        await beginRuleStudio(null,type);
        if(state.ruleStudio.value.ruleType!==type)throw Error('Incorrect template '+type);
        els.ruleType.value='headerCount';await els.ruleType.onchange();
        if((await getAll(STORES.rules)).length!==1||state.rules.length!==1)throw Error('Rule type wrote an unsaved draft');
        leaveRuleStudio(true);
      }
    });
    await page.evaluate(async()=>{const report=state.report;await Promise.all([incrementConcernAppearances(report.flagged,report),incrementConcernAppearances(report.flagged,{...report})]);});
    await page.reload();await ready();
    assert.equal(await page.locator('#toggleQualtricsWorkflow').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>state.concernHistoryLoad.counts.get('alex example')),1);
    assert.equal(await page.evaluate(()=>state.historyDeferred),true);
    await page.locator('[data-tab="history"]').click();await page.selectOption('#historyBrowseMode','details');await page.waitForFunction(()=>document.querySelector('#historyBrowseTable').textContent.includes('Alex Example'));
    assert.equal(await page.evaluate(()=>state.historyDeferred),true);
    await page.locator('#toggleQualtricsWorkflow').click();await page.reload();await ready();
    assert.equal(await page.locator('[data-tab="keyfiles"]').innerText(),'1. Data / Key Files');
    assert.equal(await page.locator('#keyBatchTools').isHidden(),true);
    assert.deepEqual(errors,[]);
    console.log('PASS Qualtrics mixed XLS/XLSX/CSV/UTF-16 TSV batch, staged publication, collision, cancellation, partial retry, precedence, rule sample/full, review ZIP reuse, concurrent recording and paged history after reload.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
