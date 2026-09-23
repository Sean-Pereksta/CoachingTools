#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');

function fixture(){
  const h=createHarness();
  h.run(`
    state.data.retail.headers.sv2=['Representative','Team','Metric','Other','Date','Employee ID'];
    state.data.retail.sv2=[
      {Representative:'Alice Able',Team:'Alpha',Metric:20,Other:2,Date:'2026-09-01','Employee ID':'a'},
      {Representative:'Alice Able',Team:'Alpha',Metric:10,Other:3,Date:'2026-09-08','Employee ID':'a'},
      {Representative:'Bob Baker',Team:'Beta',Metric:40,Other:4,Date:'2026-09-01','Employee ID':'b'}
    ].map(r=>({...r,_rep:r.Representative,_repKey:fullNameIdentityKey(r.Representative),_team:r.Team,_sourceKey:'retail_sv2'}));
    state.sourceMeta.retail_sv2={sourceVersion:1};
    state.sourceMeta.referral_sv2={sourceVersion:1};
    state.data.referral.headers.sv2=['Representative','Team','Metric','Date','Employee ID'];
    state.data.referral.sv2=[
      {Representative:'Alice Able',Team:'Alpha',Metric:5,Date:'2026-09-01','Employee ID':'a'},
      {Representative:'Alice Able',Team:'Gamma',Metric:7,Date:'2026-09-08','Employee ID':'aa'},
      {Representative:'Bob Baker',Team:'Beta',Metric:9,Date:'2026-09-01','Employee ID':'b'}
    ].map(r=>({...r,_rep:r.Representative,_repKey:fullNameIdentityKey(r.Representative),_team:r.Team,_sourceKey:'referral_sv2'}));
    markDataIndexDirty('research engine fixture',{sources:['retail_sv2','referral_sv2']});
    buildDataIndex('research engine fixture');
    const fixtureItem=normalizeResearchItem({id:'engine-fixture',source:'retail_sv2',outputType:'table',groupField:'Team',analysisGrain:'teams',columns:[{field:'Metric',mode:'sum'}],totals:true});
  `);
  return h;
}
async function cacheDependencies(){
  const h=fixture();
  try{
    const first=h.run(`researchItemCacheKey(fixtureItem,'agg')`);
    h.run(`state.models.push({id:'unused-model',name:'Unused',criteria:[]});state.metrics.push({id:'unused-metric',name:'Unused metric',source:'referral_sv2',field:'Metric',mode:'sum'});bumpVersion('models');bumpVersion('metrics');`);
    assert.equal(h.run(`researchItemCacheKey(fixtureItem,'agg')`),first,'unrelated definitions must not invalidate a numerical result');
    assert.equal(h.run(`researchItemCacheKey({...fixtureItem,title:'New title',showLegend:false,lineThickness:7},'agg')`),first,'appearance-only edits must reuse calculated values');
    h.run(`state.models.push({id:'model-a',name:'Selected',criteria:[{id:'criterion-a',name:'Chosen criterion',source:'retail_sv2',column:'Metric'}]});`);
    for(const ref of ['model("Selected","Chosen criterion")',';Selected.Chosen criterion','Chosen criterion']){
      h.context.field=ref;
      const before=h.run(`researchItemCacheKey({...fixtureItem,columns:[{field,mode:'sum'}]},'agg')`);
      h.run(`state.models.find(m=>m.id==='model-a').criteria[0].column=state.models.find(m=>m.id==='model-a').criteria[0].column==='Metric'?'Other':'Metric';`);
      assert.notEqual(h.run(`researchItemCacheKey({...fixtureItem,columns:[{field,mode:'sum'}]},'agg')`),before,`model dependency must include ${ref}`);
    }
    console.log('PASS dependency-specific Research keys and appearance-only reuse');
  }finally{h.close();}
}
async function populationAndCancellation(){
  const h=fixture();
  try{
    const legacy=h.run('evaluateResearchItem(fixtureItem)');
    h.run('state.researchResultCache.clear();state.researchPersistentCache={};');
    const first=await h.run('evaluateResearchItemAsync(fixtureItem)');
    assert.deepEqual(plain(first.data),plain(legacy.data),'responsive calculation preserves synchronous business results');
    const changed=await h.run(`evaluateResearchItemAsync({...fixtureItem,columns:[{field:'Other',mode:'sum'}]})`);
    assert.equal(changed.perf.populationCacheHit,true,'changing one measure reuses population work');
    assert.deepEqual(plain(changed.data.map(r=>[r.label,r.values[0]])),[['Alpha',5],['Beta',4]]);
    const warm=await h.run(`evaluateResearchItemAsync({...fixtureItem,columns:[{field:'Other',mode:'sum'}],title:'Different title'})`);
    assert.equal(warm.perf.cacheUsed,true);
    assert.equal(warm.perf.calculationKind,'cache hit');
    await assert.rejects(h.run(`evaluateResearchItemAsync({...fixtureItem,id:'cancelled'},{token:{cancelled:true}})`),{name:'AbortError'});
    h.run('state.researchPopulationCache.clear();state.researchResultCache.clear();state.researchPersistentCache={};');
    const stale=h.run(`evaluateResearchItemAsync({...fixtureItem,id:'concurrent'})`);
    const staleRejected=assert.rejects(stale,{name:'AbortError'});
    const fresh=h.run(`evaluateResearchItemAsync({...fixtureItem,id:'concurrent',columns:[{field:'Other',mode:'sum'}]})`);
    await staleRejected;
    const latest=await fresh;
    assert.deepEqual(plain(latest.data.map(r=>r.values[0])),[5,4]);
    assert.equal(h.run('state.researchActiveCalculations.size'),0);
    console.log('PASS population reuse, numerical parity and stale-calculation cancellation');
  }finally{h.close();}
}
async function invalidationAndBudget(){
  const h=fixture();
  try{
    h.run(`
      state.researchResultCache=new Map([
        ['retail',{dependencies:{sources:['retail_sv2']}}],
        ['referral',{dependencies:{sources:['referral_sv2']}}]
      ]);
      state.researchPersistentCache={retail:{dependencies:{sources:['retail_sv2']}},referral:{dependencies:{sources:['referral_sv2']}}};
      state.researchFilterResultCache=new Map([['retail',{dependencies:{sources:['retail_sv2']}}],['referral',{dependencies:{sources:['referral_sv2']}}]]);
      state.data.retail.sv2[0].Metric=500; // Older import path: same row count and unchanged metadata version.
      selectiveResearchInvalidation({source:'retail_sv2',reason:'same-count replacement',silent:true});
    `);
    assert.equal(h.run(`state.researchResultCache.has('retail')`),false);
    assert.equal(h.run(`state.researchResultCache.has('referral')`),true);
    assert.equal(h.run(`!!state.researchPersistentCache.retail`),false);
    assert.equal(h.run(`!!state.researchPersistentCache.referral`),true);
    assert.equal(h.run(`state.researchFilterResultCache.has('retail')`),false);
    h.run(`const budgetCache=new Map(); researchBoundedRowsCacheSet(budgetCache,'a',{rows:new Array(6)},10,10);researchBoundedRowsCacheSet(budgetCache,'b',{rows:new Array(6)},10,10);`);
    assert.deepEqual(plain(h.run('[...budgetCache.keys()]')),['b']);
    h.run(`researchBoundedRowsCacheSet(budgetCache,'oversized',{rows:new Array(11)},10,10);`);
    assert.equal(h.run(`budgetCache.has('oversized')`),false);
    h.run('const largePopulation=Array.from({length:150001},(_,i)=>({Metric:i}));');
    assert.equal(h.run("aggregateResearchValue(fixtureItem,largePopulation,{field:'Metric',mode:'min'})"),0);
    assert.equal(h.run("aggregateResearchValue(fixtureItem,largePopulation,{field:'Metric',mode:'max'})"),150000);
    console.log('PASS targeted source eviction, reload cache safety, row-budget bounds and 150k extrema');
  }finally{h.close();}
}
async function joinDiagnostics(){
  const h=fixture();
  try{
    h.run(`const joinItem=attachResearchRuntime({...fixtureItem,analysisGrain:'representatives',crossSourceJoinMode:'strict_rep',startDate:'2026-09-01',endDate:'2026-09-01'},[]);const joined1=researchRowsForCohort('referral_sv2',state.data.retail.sv2,'retail_sv2',joinItem);const joined2=researchRowsForCohort('referral_sv2',state.data.retail.sv2,'retail_sv2',joinItem);`);
    assert.equal(h.run('joined1===joined2'),true,'date-filtered joined population must be reusable by all measures');
    assert.equal(h.run('joined1.length'),h.run("filterRowsForSource('referral_sv2',state.data.referral.sv2,{start:parseDateOnly(joinItem.startDate),end:parseDateOnly(joinItem.endDate),dateColumn:researchDefaultDateColumn({source:'referral_sv2'}),qaDateMode:els.runQADateSelect?.value||'interaction'}).length"),'source-specific date range semantics are retained');
    assert.equal(h.run('researchJoinStatsSnapshot(joinItem).ambiguousIdentities'),1);
    assert.equal(h.run('researchJoinStatsSnapshot(joinItem).ambiguityDetails[0].ids.length'),2);
    assert.ok(h.run(`researchRuntimeWarnings(joinItem).some(w=>w.includes('multiple IDs or team mappings'))`));
    h.run(`const warmJoinItem=attachResearchRuntime({...joinItem},[]);researchRowsForCohort('referral_sv2',state.data.retail.sv2,'retail_sv2',warmJoinItem);`);
    assert.ok(h.run(`researchRuntimeWarnings(warmJoinItem).some(w=>w.includes('multiple IDs or team mappings'))`),'join cache hits must replay warnings');
    console.log('PASS reusable cross-source date filtering and visible ambiguous join diagnostics');
  }finally{h.close();}
}
async function teamModelOptIn(){
  const h=fixture();
  try{
    h.run(`
      Object.assign(state.data.retail.sv2[1],{Representative:'Derek Dean',_rep:'Derek Dean',_repKey:fullNameIdentityKey('Derek Dean')});
      markDataIndexDirty('team model fixture',{sources:['retail_sv2']});buildDataIndex('team model fixture');
      state.models.push(normalizeModelForStorage({id:'team-model',name:'Team model',type:'team',criteria:[{...emptyCriterion(),id:'ratio',name:'Ratio',calcType:'multi',leftSource:'retail_sv2',leftColumn:'Metric',rightSource:'retail_sv2',rightColumn:'Other',operator:'divide'}]}));
      const alphaRows=state.data.retail.sv2.slice(0,2),teamRef={model:'Team model',criteria:'Ratio'};
    `);
    const legacy=h.run(`evaluateModelReferenceValue(teamRef,alphaRows,{source:'retail_sv2',analysisGrain:'teams'},'sum',[])`);
    assert.ok(Math.abs(legacy-(20/2+10/3))<1e-9,'legacy team-grouped Research retains representative aggregation');
    const team=h.run(`evaluateModelReferenceValue(teamRef,alphaRows,{source:'retail_sv2',analysisGrain:'teams',modelEntityKind:'team'},'sum',[])`);
    assert.equal(team,30/5,'opt-in uses the Model Runner team ratio of totals');
    assert.equal(h.run(`modelEntryRowsForResearchRows(alphaRows,{source:'retail_sv2',modelEntityKind:'team'}).length`),1,'team entries deduplicate representatives');
    assert.notEqual(h.run(`researchItemCacheKey(fixtureItem,'agg')`),h.run(`researchItemCacheKey({...fixtureItem,modelEntityKind:'team'},'agg')`),'team model mode has a distinct result cache');
    console.log('PASS explicit team Model Runner semantics and unchanged legacy grouping');
  }finally{h.close();}
}
async function workerFallback(){
  const h=fixture();
  try{
    h.run(`
      researchWorkerMeasurePlan=()=>({rowCount:1,measures:[{col:{},resolved:{aggregation:'sum',label:'Metric',valueField:'Metric'}}]});
      var Worker=function(){throw new Error('Worker blocked under local file policy');};
      const workerGroups=[{primary:'Alpha',secondary:'',rows:[state.data.retail.sv2[0]],dateValue:0}];
    `);
    assert.equal(await h.run(`evaluateResearchTypedWorker(fixtureItem,workerGroups,[],[])`),null,'constructor failures must use the sliced fallback');
    await assert.rejects(h.run(`evaluateResearchTypedWorker(fixtureItem,workerGroups,[],[],{cancelled:true})`),{name:'AbortError'});
    console.log('PASS local-file Worker fallback and cancellation');
  }finally{h.close();}
}
async function main(){await cacheDependencies();await populationAndCancellation();await invalidationAndBudget();await joinDiagnostics();await teamModelOptIn();await workerFallback();}
main().catch(error=>{console.error(error);process.exitCode=1;});
