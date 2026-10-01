'use strict';
const assert=require('node:assert/strict');
const {createHarness}=require('./modernization-compatibility.test.js');
async function run(){
  const h=createHarness();
  try{
    h.run(`
      window.AllStarResearchWorkspace.init();
      const previewRows=Array.from({length:50000},(_,index)=>({Date:'2026-09-'+String(index%4*7+6).padStart(2,'0'),Name:'Rep '+index,Sheet:index%2?'Coach Beta':'Coach Alpha','Consumer Opportunities':index%3,_sourceKey:'weeklyRetail'}));
      let previewRowReads=0;
      state.data.weeklyRetail={headers:['Date','Name','Sheet','Consumer Opportunities'],rows:previewRows,config:window.AllStarDatedStats.defaultConfig('weeklyRetail',['Date','Name','Sheet','Consumer Opportunities'])};
      state.orgs=[normalizeOrg({name:'Retail Coaches',coachNames:['Coach Alpha']})];
      const previewItem=normalizeResearchItem({id:'sample',title:'Sample',source:'weeklyRetail',outputType:'line',guidedEnabled:true,guidedSubject:'representatives',guidedQuestion:'percentage',guidedPercentageUnit:'unique_reps',guidedBreakdown:'coach',guidedDisplay:'line',guidedConditions:[{field:'Consumer Opportunities',operator:'greater_than',value:1,source:'weeklyRetail'}],weeklyCoverage:{enabled:true,minWeeks:8},populationScope:{includeOrgs:['Retail Coaches']}});
      state.researchItems=[previewItem];openResearchItemEditor('sample');
      const originalRawRows=getRowsRaw,previewRowProxy=new Proxy(previewRows,{get(target,key,receiver){if(/^\\d+$/.test(String(key)))previewRowReads++;return Reflect.get(target,key,receiver);}});
      getRowsRaw=source=>source==='weeklyRetail'?previewRowProxy:originalRawRows(source);
      const originalPlan=buildQueryPlan,originalHealth=weeklySourceHealth,originalIndexes=ensureResearchExecutionIndexes,originalJoin=researchJoinPreviewSnapshot;
      let expensivePreviewJobs=0;
      buildQueryPlan=()=>{expensivePreviewJobs++;throw Error('Full query plan must not run for previews');};
      weeklySourceHealth=()=>{expensivePreviewJobs++;throw Error('Full weekly health scan must not run in the editor');};
      ensureResearchExecutionIndexes=()=>{expensivePreviewJobs++;throw Error('Full index preparation must not run for previews');};
      researchJoinPreviewSnapshot=()=>{expensivePreviewJobs++;throw Error('Full join preview must not run in the editor');};
      previewRowReads=0;
      scheduleResearchJoinPreview();scheduleResearchWeeklyPreview();updateGuidedResearchUi();
      els.researchTitleInput.value='Changed without running';els.researchTitleInput.dispatchEvent(new Event('input',{bubbles:true}));
      scheduleResearchCacheWarm('data updated');
    `);
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(h.run('expensivePreviewJobs'),0,'editing starts no query, join, source-health or index jobs');
    assert.equal(h.run('previewRowReads'),0,'automatic preview updates do not touch source rows');
    assert.match(h.run('els.researchJoinPreview.textContent'),/Click Run preview/);
    const snapshot=h.run('researchSamplePreview(previewItem)');
    assert.equal(snapshot.sampledRows,500);
    assert.equal(snapshot.importedRows,50000);
    assert.equal(h.run('previewRowReads'),500,'large preview reads exactly the bounded sample');
    assert.ok(snapshot.rows.every(row=>row.Sheet==='Coach Alpha'&&row['Consumer Opportunities']>1));
    assert.ok(snapshot.rows.length<=100);
    assert.ok(snapshot.notes.some(note=>/complete selected period/.test(note)),'sample coverage is never presented as full eligibility');
    h.run('previewRowReads=0;');
    await h.run('renderResearchFoundPreview()');
    assert.equal(h.run('previewRowReads'),500);
    assert.equal(h.run('expensivePreviewJobs'),0);
    assert.match(h.run('els.researchFoundPreview.textContent'),/Sampled 500 of 50,000/);
    assert.match(h.run('els.researchFoundPreview.textContent'),/not complete population totals/);
    assert.equal(h.run('state.researchPerformanceRuns.length'),0);
    const cross=h.run("researchSamplePreview({...previewItem,guidedConditions:[{field:'Description',source:'documented_coaching',operator:'contains',value:'example'}]})");
    assert.ok(cross.notes.some(note=>/Cross-source/.test(note)),'advanced joins are deferred explicitly instead of launching a full calculation');
    assert.equal(h.run('expensivePreviewJobs'),0);
    h.run("els.researchTitleInput.dispatchEvent(new Event('input',{bubbles:true}));");
    assert.match(h.run('els.researchFoundPreview.textContent'),/Settings changed/);
    h.run('getRowsRaw=originalRawRows;buildQueryPlan=originalPlan;weeklySourceHealth=originalHealth;ensureResearchExecutionIndexes=originalIndexes;researchJoinPreviewSnapshot=originalJoin;');
    assert.deepEqual(h.errors,[]);
    console.log('PASS zero automatic preview scans, 500-row/100-display sample bounds on 50k rows, population/qualifier matching, explicit advanced/coverage limitations and no full index/calculation work');
  }finally{h.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
