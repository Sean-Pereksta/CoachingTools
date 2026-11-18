'use strict';
const assert=require('node:assert/strict');
const {IDBObjectStore}=require('fake-indexeddb');
const {createHarness,plain}=require('./modernization-compatibility.test.js');

async function main(){
  const h=createHarness();
  try{
    h.run(`
      const source='documented_coaching', headers=['System ID','Created By','Updated','Associate Name','Job Coach','Coaching Date','Description','Coaching Type'];
      state.data[source].headers=headers;
      state.data[source].rows=['2026-01-01','2026-01-07','2026-02-01'].map((date,i)=>({
        'System ID':i,'Associate Name':'Alice Able','Job Coach':'Alpha','Coaching Date':date,
        'Description':i===1?'Punctuality':'Attendance','Coaching Type':i===1?'Attendance':'Other',
        _date:date,_rep:'Alice Able',_repKey:fullNameIdentityKey('Alice Able'),_team:'Alpha',_sourceKey:source
      }));
      state.sourceMeta[source]={sourceVersion:1};markDataIndexDirty('trace test',{sources:[source]});rebuildDataIndexSync('trace test');
      const rule={...emptyCriterion(),source,id:'attendance',name:'Attendance coaching',audience:'rep',calcType:'checklistCount',
        checkColumn:'Description',checkDateColumn:'Coaching Date',checkText:'Attendance',scoreType:'points',points:2,
        rowPullConditions:[{id:'desc',column:'Description',connector:'base',operator:'contains',phrasesText:'"Attendance"'}]};
      const example=normalizeModelForStorage({id:'rule-model',name:'Rules',criteria:[rule,{...rule,id:'other',name:'Other'}]});state.models.push(example);
      window.AllStarModelWorkspace.init();openEditModel(example.id);
      const library=el('useRuleLibrary');library.checked=true;library.onchange();
    `);
    assert.equal(h.run("els.criteriaList.querySelectorAll('[data-crit]').length"),1);
    h.run("el('criterionLibraryList').querySelector('[data-library-rule=other]').click()");
    assert.equal(h.run("els.criteriaList.firstElementChild.dataset.crit"),'other');
    h.run(`
      [...els.criteriaList.querySelectorAll('button')].find(b=>b.textContent==='Test rule').click();
      const panel=els.criteriaList.querySelector('.ruleTestPanel');
      panel.querySelector('[data-start]').value='2026-01-01';panel.querySelector('[data-end]').value='2026-01-31';
    `);
    await h.run("panel.querySelector('[data-run]').onclick()");
    const trace=h.run("panel.querySelector('[data-output]').textContent");
    assert.match(trace,/Description → Description/);
    assert.match(trace,/3 source rows · 2 for Alice Able in period · 2 after filters · 1 after conditions/);
    assert.match(trace,/Result 1.*Score 2/);
    assert.doesNotMatch(trace,/Punctuality/);
    assert.equal(h.run("countRunDates(state.runIndexes.get(source).coaching.dates,parseDateOnly('2026-01-01'),parseDateOnly('2026-01-31'))"),2);
    h.run(`
      populateRunModels();els.runModelSelect.value=example.id;state.selectedTeams=new Set(['Alpha']);state.runMode='single';
      els.runStartDate.value='2026-01-01';els.runEndDate.value='2026-01-31';el('reportFocusedMode').checked=true;
      const config=captureRunExecutionSettings();
      const oldReport={model:{name:'previous'}};state.lastRenderedReport=oldReport;
      const oldYield=yieldToBrowser;let first=true;
      yieldToBrowser=async()=>{if(first){first=false;state.versions.models++;}await oldYield();};
    `);
    assert.equal(await h.run('buildRun({settings:config})'),null);
    assert.equal(h.run('state.lastRenderedReport===oldReport'),true);
    h.run('yieldToBrowser=oldYield');
    const report=await h.run('buildRun({settings:config})');
    assert.ok(report,'run should complete');
    assert.equal(report.repPack.rows[0].values.other,1);
    assert.equal(h.run("el('reportResultScope').options.length"),3);
    await h.run('listSavedReportSummaries()');
    const oldGet=IDBObjectStore.prototype.get,oldGetAll=IDBObjectStore.prototype.getAll;
    let reads=0;
    try{
      IDBObjectStore.prototype.getAll=function(){if(this.name==='reports')throw Error('Full snapshot scan');return oldGetAll.apply(this,arguments);};
      IDBObjectStore.prototype.get=function(){if(this.name==='reports')reads++;return oldGet.apply(this,arguments);};
      const summaries=plain(await h.run('listSavedReportSummaries()'));
      assert.equal(summaries.length,1);assert.equal(summaries[0].report,undefined);assert.equal(reads,0);
      h.context.reportId=summaries[0].id;
      await h.run('openSavedReport(reportId)');
      assert.equal(reads,1);assert.equal(h.run('state.lastRenderedReport.repPack.rows[0].values.other'),1);
      await h.run(`workflowReportTransaction('readwrite',store=>{
        for(let i=1;i<=16;i++)store.put({id:'legacy-'+i,modelName:'Old report '+i,teams:['Alpha'],
          createdAt:'2020-01-'+String(i).padStart(2,'0')+'T00:00:00Z',report:{model:{},teamPack:{},repPack:{}}});
      })`);
      const legacy=await h.run('listSavedReportSummaries()');
      assert.equal(legacy.length,17);assert.equal(reads,17,'one targeted read per historical record on first discovery');
      await h.run('listSavedReportSummaries()');assert.equal(reads,17,'warm reads skip backfilled payloads');
      await h.run('saveCompletedReport(state.lastRenderedReport,config)');
      const retained=await h.run('listSavedReportSummaries()');
      assert.equal(retained.length,15);
      assert.equal(retained.some(r=>r.id==='legacy-3'),false);
      assert.equal(retained.some(r=>r.id==='legacy-4'),true);
      await h.run('renderRecentRuns()');
      assert.equal(h.run("el('recentRunsList').querySelectorAll('[data-open-report]').length"),5);
    }finally{IDBObjectStore.prototype.get=oldGet;IDBObjectStore.prototype.getAll=oldGetAll;}
    console.log('PASS single-editor library, physical Description trace, date index, stale report rejection, bounded result view and targeted snapshot reads');
  }finally{h.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
