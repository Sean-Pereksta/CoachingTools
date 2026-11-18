'use strict';
// Usage: node browser-workflow-timing.js [baseline Allstar directory]. REPEATS defaults to 5.
// Times include browser interaction, actionability, and two animation frames after the observed outcome.
// Each file-picker submission is one action; native file browsing and human reading time are excluded.
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {performance} = require('node:perf_hooks');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const XLSX = require('../../../vendor/xlsx.full.min.js');
const repeats = Number(process.env.REPEATS || 5);
const names = [['qa','QA.xlsx'],['coaching','Coaching.csv'],['checklist','Checklist.xls'],['weeklyStats','Weekly.tsv']];
const data = [
  [['Agent Name','Score %','Interaction Start Time','Coach'],['Alex Example','95%','2026-11-16','Coach North']],
  [['System ID','Created By','Revision','Associate Name','Coaching Date','Description','Coaching Type','Job Coach'],['1','Admin','3','Alex Example','2026-11-15','Attendance','Other','Coach North']],
  [['Associate Name','Incident Date','Incident','Job Coach'],['Alex Example','2026-11-15','Attendance','Coach North']],
  [['Agent Name','Date Column','Consumer Appointments','Consumer Opportunities','Coach'],['Alex Example','2026-11-16','2','10','Coach North']]
];
const files = names.map(([,name],i)=>{
  const workbook = XLSX.utils.book_new();
  const rows = i===0 ? data[i].map(row=>[null,null,null,null,...row]) : data[i];
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'Data');
  const buffer = /xls/.test(name) ? XLSX.write(workbook,{type:'buffer',bookType:i===0?'xlsx':'xls'}) :
    Buffer.from(rows.map(row=>row.join(i===3?'\t':',')).join('\r\n'));
  return {name,mimeType:'application/octet-stream',buffer:Buffer.from(buffer)};
});
const output = [];
function paint(page){return page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
function probe(page,build,iteration){
  let actions=0;
  async function click(selector){actions++;await (typeof selector==='string'?page.locator(selector).first():selector).click();}
  async function fill(selector,value){actions++;await page.locator(selector).first().fill(value);}
  async function select(selector,value){actions++;await page.locator(selector).first().selectOption(value);}
  async function upload(selector,items){actions++;await page.locator(selector).setInputFiles(items);}
  async function measure(task,perform){
    const count=actions,start=performance.now();
    await page.evaluate(()=>{window.taskSignals=[];window.taskStages=[];window.taskFirstEvent=0;window.taskLastEvent=null;});
    await perform();
    await paint(page);
    const observed=await page.evaluate(()=>{
      const ready=performance.now(),event=window.taskFirstEvent;
      const stages=window.taskStages.map((s,i,a)=>s.durationMs===undefined?{stage:s.stage,durationMs:Math.round((a[i+1]?.time||ready)-s.time)}:s);
      return {dispatchToPaintMs:event?Math.round(ready-event):null,stages,signals:window.taskSignals.filter(s=>event&&s.time>=event).map(s=>({...s,elapsedMs:Math.round(s.time-event),time:undefined}))};
    });
    const row={build,iteration,task,actions:actions-count,taskMs:Math.round(performance.now()-start),...observed};
    output.push(row);console.log(JSON.stringify(row));
  }
  return {click,fill,select,upload,measure};
}
async function observe(page){
  await page.evaluate(()=>{
    window.taskSignals=[];window.taskStages=[];
    if(window.AllStarAnalysis){
      const record=AllStarAnalysis.record;
      AllStarAnalysis.record=(stage,kind,ms,details)=>{
        if(stage.startsWith('Report '))window.taskStages.push({stage,durationMs:Math.round(ms)});
        return record(stage,kind,ms,details);
      };
    }
    if(!window.AllStarAnalysis&&typeof setProgress==='function'){
      const set=setProgress;setProgress=(pct,message)=>{
        const text=String(message||'');
        const stage=pct==null?'Complete':/packag|zip|compress/i.test(text)?'Packaging':/preview/i.test(text)?'Building previews':/prepar/i.test(text)?'Preparing':text?'Evaluating or rendering':'';
        if(stage&&window.taskStages.at(-1)?.stage!==stage)window.taskStages.push({stage,time:performance.now()});
        return set(pct,message);
      };
    }
    for(const type of ['click','input','change','keydown'])document.addEventListener(type,event=>{
      const time=performance.now();if(!window.taskFirstEvent)window.taskFirstEvent=time;
      window.taskLastEvent={time,control:event.target.id||event.target.getAttribute?.('data-tab')||event.target.tagName};
    },true);
    const watch=['#status','#progressText','#keyBatchStatus','#reportStage','#keyRuleTestResult'];
    let last='';
    const capture=()=>{
      const visible=watch.map(s=>document.querySelector(s)).filter(e=>e?.getClientRects().length).map(e=>e.textContent.trim().replace(/\s+/g,' ').slice(0,110)).join(' | ');
      if(!visible||visible===last)return;
      last=visible;
      // Only acknowledge a message observed at a browser frame and retained to the following frame.
      const trigger=window.taskLastEvent;
      requestAnimationFrame(()=>{if(last===visible&&trigger===window.taskLastEvent&&trigger){const time=performance.now();window.taskSignals.push({message:visible,time,control:trigger.control,feedbackMs:Math.round(time-trigger.time)});}});
    };
    const observer=new MutationObserver(()=>{requestAnimationFrame(capture);});
    for(const s of watch){const node=document.querySelector(s);if(node)observer.observe(node,{subtree:true,characterData:true,childList:true});}
  });
}
async function qualtrics(browser,dir,build,iteration){
  const updated=build==='updated',page=await browser.newPage({offline:true,timezoneId:'America/New_York'});
  page.setDefaultTimeout(9000);
  try{
    await page.goto(pathToFileURL(path.join(dir,'qualtrics/generator.html')).href);
    const ready=()=>page.waitForFunction(()=>state.db&&document.querySelector('#status').textContent.startsWith('Ready. Loaded'));
    await ready();
    await page.evaluate(async()=>{
      const rule=normalizeRule({id:'attendance',title:'Attendance',ruleType:'statCount',statCount:{source:'coaching',nameHeader:'Associate Name',conditionHeader:'Description',operator:'contains',value:'Attendance',minCount:1},individualMessage:{concern:{enabled:true,sourceType:'legacy',operator:'legacy',message:'(FirstName), please review your attendance.'}}});
      await put(STORES.rules,rule);
    });
    await page.reload();await ready();
    await page.locator('[data-tab="keyfiles"]').click();
    await page.evaluate(()=>{els.reportDate.value='2026-11-17';state.selectedOtherRuleIds=new Set(['attendance']);});
    await observe(page);
    const ui=probe(page,build,iteration);
    if(updated&&await page.locator('#toggleQualtricsWorkflow').getAttribute('aria-pressed')!=='true')await ui.measure('Enable guided Qualtrics workflow',()=>ui.click('#toggleQualtricsWorkflow'));
    await ui.measure('Four key files to ready',async()=>{
      if(updated){
        await ui.upload('#keyBatchPicker',files);await page.waitForFunction(()=>state.keyBatch&&!state.keyBatch.busy);
        await ui.click('#applyKeyBatch');
      }else{
        for(const [i,[slot]] of names.entries()){
          await ui.upload('#'+slot+'Input',files[i]);await page.waitForFunction(s=>state.masterRows[s].length===1,slot);
        }
      }
      await page.waitForFunction(()=>Object.values(state.masterRows).every(rows=>rows.length===1));
    });
    if(updated){
      await ui.upload('#keyBatchPicker',[files[0],{...files[0],name:'Duplicate QA.xlsx'}]);
      await page.waitForFunction(()=>state.keyBatch&&!state.keyBatch.busy);
      await ui.measure('Cancel staged key files',async()=>{
        await ui.click('#cancelKeyBatch');await page.waitForFunction(()=>!state.keyBatch&&document.getElementById('keyBatchStatus').textContent.includes('canceled'));
        assert.equal(await page.locator('#keyBatchPicker').evaluate(node=>node===document.activeElement),true);
      });
    }
    await ui.measure('Open Rules and test saved rule',async()=>{
      await ui.click('[data-tab="rules"]');
      const selector=updated?'#sampleKeyRuleBtn':'#refreshRulePreviewBtn';
      const button=page.locator(selector);
      if(!await button.isVisible()){
        const closed=button.locator('xpath=ancestor::details[not(@open)]');
        for(const details of await closed.all()) {await ui.click(details.locator('summary').first());}
      }
      await ui.click(selector);
      if(updated)await page.waitForFunction(()=>document.getElementById('keyRuleTestResult').textContent.includes('Alex Example'));
      else await page.waitForFunction(()=>document.getElementById('status').textContent.includes('preview refreshed'));
    });
    await ui.measure('Open Review and evaluate output',async()=>{
      await ui.click('[data-tab="report"]');await ui.click('#reviewReportBtn');
      await page.waitForFunction(()=>!state.emailWorkflowRunning&&state.report?.flagged?.some(r=>r.repName==='Alex Example'));
    });
    await ui.measure('Download ZIP from current review',async()=>{
      const download=page.waitForEvent('download');await ui.click('#generateReportBtn');
      const file=await download;assert.match(file.suggestedFilename(),/emails.*\.zip$/);assert.equal(await file.failure(),null);
    });
  }finally{await page.close();}
}
async function allstar(browser,dir,build,iteration){
  const updated=build==='updated',page=await browser.newPage({offline:true,viewport:{width:1200,height:850},timezoneId:'America/New_York'});
  page.setDefaultTimeout(9000);page.on('pageerror',error=>console.error(error.stack));page.on('dialog',dialog=>{console.error(dialog.message());return dialog.dismiss();});
  try{
    await page.goto(pathToFileURL(path.join(dir,'allstar.html')).href);
    await page.waitForFunction(()=>typeof state!=='undefined'&&state.startup.completed);
    await page.evaluate(()=>{
      const source='documented_coaching',teams=['Alpha','Beta'];
      state.data[source].headers=['Associate Name','Job Coach','Coaching Date','Description','Amount'];
      state.data[source].rows=Array.from({length:24},(_,i)=>{
        const name='Person '+i,team=teams[i%2],date='2026-11-'+(i%2?'15':'16');
        return {'Associate Name':name,'Job Coach':team,'Coaching Date':date,Description:'Attendance',Amount:i,_rep:name,_repKey:fullNameIdentityKey(name),_team:team,_date:date,_sourceKey:source};
      });
      state.data.retail.headers.sv2=['Representative','Team','Amount'];
      state.data.retail.sv2=state.data[source].rows.map(row=>({Representative:row._rep,Team:row._team,Amount:row.Amount,_rep:row._rep,_repKey:row._repKey,_team:row._team,_sourceKey:'retail_sv2'}));
      state.data.qa.headers=['Agent Name','Team','Score %','Interaction Start Time','Assigned Date'];
      state.data.qa.rows=state.data[source].rows.map(row=>({'Agent Name':row._rep,Team:row._team,'Score %':0.95,'Interaction Start Time':row._date,'Assigned Date':row._date,_rep:row._rep,_repKey:row._repKey,_team:row._team,_date:row._date,_sourceKey:'qa'}));
      state.sourceMeta.qa={sourceVersion:1,rowCount:24};
      state.sourceMeta[source]={sourceVersion:1};state.sourceMeta.retail_sv2={sourceVersion:1};
      markDataIndexDirty('common jobs',{sources:[source,'retail_sv2']});rebuildDataIndexSync('common jobs');
      const model=normalizeModelForStorage({id:'timed',name:'Amount report',criteria:[{...emptyCriterion(),id:'amount',source:'retail_sv2',column:'Amount',aggregate:'sum',scoreType:'points',name:'Amount',points:2}]});
      state.models.push(model);saveModels();
    });
    await observe(page);
    const ui=probe(page,build,iteration),setup='[data-as-command="action:report-new"]:visible',closed=async()=>{
      await page.waitForFunction(()=>!el('runModal').classList.contains('open')&&state.lastRenderedReport?.model.id==='timed',{},{timeout:3000}).catch(async error=>{throw Error(error.message+' '+JSON.stringify(await page.evaluate(()=>({modal:el('runModal').className,result:state.lastRenderedReport?.model?.id,settings:captureRunExecutionSettings(),stage:el('reportStage')?.textContent}))));});
    };
    async function openSetup(){await ui.click(setup);await page.locator('#runModal.open #executeRunBtn').waitFor();}
    await ui.measure('Cold report setup',openSetup);
    await ui.select('#runModelSelect','timed');await ui.fill('#runStartDate','2026-11-01');await ui.fill('#runEndDate','2026-11-30');await ui.click('#selectAllTeamsBtn');
    if(await page.locator('#executeRunBtn').isDisabled())await ui.click('#runCheckModelBtn');
    if(await page.locator('#executeRunBtn').isDisabled())throw Error((await page.locator('#runModelSelect').inputValue())+' '+(await page.locator('#runPreflightDetails').textContent()));
    if(updated)await page.locator('#reportFocusedMode').check();
    await ui.click('#executeRunBtn');await closed();
    await ui.measure('Recent runs list',async()=>{await ui.click('#openRecentRunsFromReport');await page.locator('#recentRunsModal.open [data-open-report]').first().waitFor();});
    await ui.measure('Reopen saved snapshot',async()=>{await ui.click('[data-open-report]');await page.locator('#recentRunsModal.open').waitFor({state:'hidden'});await page.locator('#workArea .badge').filter({hasText:'Saved snapshot'}).first().waitFor();});
    await ui.click('[data-as-section="Home"]');
    await ui.measure('Warm report setup',openSetup);
    await ui.click('#runModal [data-close="runModal"]');
    // Start with model, dates and scope differing from the saved run, as after unrelated work.
    await page.evaluate(()=>{els.runModelSelect.selectedIndex=0;els.runStartDate.value='';els.runEndDate.value='';state.selectedTeams.clear();state.teamSelectionInitialized=true;renderTeamSelect();});
    await ui.measure('Restore and rerun saved report from Home',async()=>{
      if(updated){
        await ui.click('[data-as-section="History"]');await ui.click('[data-as-command="action:report-saved"]:visible');
        await ui.click('[data-rerun-report]');await page.waitForFunction(()=>el('reportStage').textContent.includes('restored'));
      }else{
        await openSetup();await ui.select('#runModelSelect','timed');await ui.fill('#runStartDate','2026-11-01');await ui.fill('#runEndDate','2026-11-30');await ui.click('#selectAllTeamsBtn');
        if(await page.locator('#executeRunBtn').isDisabled())await ui.click('#runCheckModelBtn');
      }
      await ui.click('#executeRunBtn');await closed();
      assert.deepEqual(await page.evaluate(()=>[state.lastRenderedReport.start.getDate(),state.lastRenderedReport.end.getDate(),state.lastRenderedReport.teamPack.rows.length]),[1,30,2]);
    });
    await page.evaluate(async()=>{await openResearchWorkspace();});
    if(updated){
      if(await page.locator('#researchLibraryToggle').getAttribute('aria-pressed')!=='true')await ui.click('#researchLibraryToggle');
      for(const dated of [false,true]){
        await ui.measure((dated?'Dated':'Undated')+' comparison to saved result',async()=>{
          await ui.click('#researchNewQuestionBtn');const form='.rwQuestionDialog ';
          await ui.select(form+'[name=source]',dated?'documented_coaching':'retail_sv2');
          await ui.fill(form+'[name=search]','Amount');
          if(dated){await ui.fill(form+'[name=from]','2026-11-15');await ui.fill(form+'[name=through]','2026-11-16');}
          await ui.click('[data-question-open]');await ui.click('#researchSaveDefinitionBtn');
          const src=dated?'documented_coaching':'retail_sv2';await page.waitForFunction(src=>state.researchItems.some(i=>i.source===src),src);
          const id=await page.evaluate(src=>state.researchItems.find(i=>i.source===src).id,src);
          await ui.click('[data-lib-run="'+id+'"]');
          await page.waitForFunction(id=>!!state.researchItems.find(i=>i.id===id)?.renderedResult?.inputKey,id);
          await ui.click('[data-lib-open="'+id+'"]');
          await page.locator('#researchLibraryDetail button').filter({hasText:'Export full result CSV'}).waitFor();
          const snap=await page.evaluate(id=>researchRenderedResultGet(id),id);
          assert.ok(snap.data.length);assert.equal(snap.snapshotDefinition.startDate||'',dated?'2026-11-15':'');
        });
      }
    }else{
      async function reveal(selector){
        const closed=page.locator(selector).locator('xpath=ancestor::details[not(@open)]');
        for(const details of await closed.all())await ui.click(details.locator('summary').first());
      }
      for(const dated of [false,true]){
        await ui.measure((dated?'Dated':'Undated')+' comparison to saved result',async()=>{
          await ui.click('#addResearchItemBtn');
          await ui.click('[data-rw-mode="advanced"]');
          const source=dated?'documented_coaching':'retail_sv2';
          await reveal('#researchTitleInput');await ui.fill('#researchTitleInput',(dated?'Dated':'Undated')+' Amount by coach');
          await ui.select('#researchSource',source);await ui.select('#researchOutputType','bar');
          if(dated){await ui.fill('#researchDateColumn','Coaching Date');await ui.fill('#researchStartDate','2026-11-15');await ui.fill('#researchEndDate','2026-11-16');}
          await reveal('#researchGroupField');await ui.fill('#researchGroupField','_team');
          await ui.select('#researchValueMode','avg');await ui.fill('#researchValueField','Amount');
          await ui.click('#saveResearchItemBtn');
          await page.waitForFunction(source=>state.researchItems.some(i=>i.source===source&&i.renderedResult?.renderedAt),source);
          const saved=await page.evaluate(source=>state.researchItems.find(i=>i.source===source),source);
          assert.equal(saved.startDate||'',dated?'2026-11-15':'');assert.equal(saved.valueField,'Amount');
          await page.locator('[data-research-card="'+saved.id+'"] .researchCardBody').waitFor();
        });
      }
    }
    await ui.click('#researchModal [data-close="researchModal"]');await ui.click('[data-as-section="Home"]');
    await ui.measure('Reopen saved Research list',async()=>{
      await ui.click('[data-as-section="Research"]');
      await page.locator(updated?'#researchLibrary [data-lib-open]':'[data-research-card]').first().waitFor();
    });
  }finally{await page.close();}
}
async function main(){
  const updated=path.resolve(__dirname,'..'),baseline=process.argv[2]?path.resolve(process.argv[2]):null;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
  try{
    console.log(JSON.stringify({browser:browser.version(),repeats,bytes:files.map(f=>f.buffer.length)}));
    for(let i=0;i<repeats;i++){
      const builds=baseline?[['baseline',baseline],['updated',updated]]:[['updated',updated]];
      for(const [build,dir] of i%2?builds.reverse():builds){
        await qualtrics(browser,dir,build,i);await allstar(browser,dir,build,i);
      }
    }
    for(const key of new Set(output.map(row=>row.build+'/'+row.task))){
      const data=output.filter(row=>row.build+'/'+row.task===key).sort((a,b)=>a.taskMs-b.taskMs);
      console.log(JSON.stringify({summary:key,actions:data[0].actions,p50:data[Math.ceil(data.length*.5)-1].taskMs,p95:data[Math.ceil(data.length*.95)-1].taskMs}));
    }
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
