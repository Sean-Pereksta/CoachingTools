'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');

async function main(){
  const h=createHarness();
  try{
    h.run(`
      state.data.retail.headers.sv2=['Representative','Team','Metric','Date','Category'];
      state.data.retail.sv2=[10,20,'',-3,'bad'].map((value,index)=>({Representative:'Alice Able',Team:'Alpha',Metric:value,Date:index===3?'2026-09-03':'2026-09-01',Category:index%2?'A':'B',_rep:'Alice Able',_repKey:'alice able',_team:'Alpha',_sourceKey:'retail_sv2'}));
      state.sourceMeta.retail_sv2={sourceVersion:1};
      state.data.referral.headers.sv2=['Metric']; state.data.referral.sv2=[{Metric:7}]; state.sourceMeta.referral_sv2={sourceVersion:1};
      markDataIndexDirty('analysis fixture',{sources:['retail_sv2','referral_sv2']}); rebuildDataIndexSync('analysis fixture');
      const c={...emptyCriterion(),id:'analysis-criterion',name:'Metric',source:'retail_sv2',column:'Metric',aggregate:'sum'};
      const rep={kind:'rep',key:'alice able',name:'Alice Able',team:'Alpha'};
      const options=()=>({_sourceRowsCache:new Map(),_entryRowsCache:new Map()});
      const result=()=>criterionValue(c,rep,options());
    `);
    assert.equal(h.run('result()'),27);
    const writes=h.run('AllStarAnalysis.diagnostics().writes');
    assert.equal(h.run('result()'),27);
    assert.equal(h.run('AllStarAnalysis.diagnostics().writes'),writes,'warm model should reuse a stored criterion value');
    h.run(`state.versions.models++; state.models.push({id:'unrelated',name:'Unrelated',criteria:[]}); selectiveResearchInvalidation({models:true});`);
    assert.equal(h.run('result()'),27);
    assert.equal(h.run('AllStarAnalysis.diagnostics().writes'),writes,'unrelated model must not discard another result');
    h.run(`state.sourceMeta.referral_sv2.sourceVersion++; AllStarAnalysis.invalidate({source:'referral_sv2'});`);
    assert.equal(h.run('result()'),27);
    assert.equal(h.run('AllStarAnalysis.diagnostics().writes'),writes,'unrelated source must not invalidate this model');
    h.run(`state.data.retail.sv2[0].Metric=100; state.sourceMeta.retail_sv2.sourceVersion++; selectiveResearchInvalidation({source:'retail_sv2'});`);
    assert.equal(h.run('result()'),117,'own source update must invalidate row inputs and values');
    h.run(`c.aggregate='avg';`);
    assert.equal(h.run('result()'),39,'unsaved criterion edits invalidate only that definition');
    for(const [mode,expected] of [['sum',117],['avg',39],['min',-3],['max',100],['first',100],['latest',-3],['count',4]]){
      h.run(`c.aggregate=${JSON.stringify(mode)};`);
      assert.equal(h.run('result()'),expected,mode+' preserves existing finite-number/blank/date semantics');
    }
    const beforeIdentity=h.run('AllStarAnalysis.diagnostics().writes');
    h.run(`state.versions.aliases++;`); h.run('result()');
    assert.ok(h.run('AllStarAnalysis.diagnostics().writes')>beforeIdentity,'identity versions must be dependencies');
    h.run(`
      const filterRows=state.data.retail.sv2;
      const filterCases=[
        [{column:'Metric',operator:'greaterEqual',value:'20',action:'include'}],
        [{column:'Metric',operator:'between',value:'-3',value2:'20',action:'exclude'}],
        [{column:'Category',operator:'is',values:['A'],action:'include'},{column:'Metric',operator:'lessThan',value:'0',action:'exclude'}],
        [{column:'Category',operator:'contains',value:'A',action:'include'}],
        [{column:'Category',operator:'notContains',value:'A',action:'include'}],
        [{column:'Metric',operator:'greaterThan',value:'bad',action:'include'}],
        [{column:'Metric',operator:'between',value:'0',value2:'bad',action:'include'}],
        [{column:'Metric',operator:'greaterThan',dynamic:true,expression:'[Metric] - 1',action:'include'}],
        [{dynamicColumn:true,columnExpression:'[Metric] / 2',operator:'greaterThan',value:'8',action:'include'}],
        [{action:'includeWithin',targetSource:'qa',targetDateColumn:'Date',targetValueColumn:'Metric',targetOp:'is',targetValue:'1',dayWindow:'3'}]
      ];
    `);
    assert.equal(h.run(`filterCases.every(filters=>JSON.stringify(filterRows.filter(compileModelFilterPredicate('retail_sv2',filters,{})))===JSON.stringify(applyFilters(filterRows,filters,'retail_sv2',{})))`),true,'compiled filter is semantically identical to sequential legacy filtering');
    h.run(`
      const planModel=normalizeModelForStorage({id:'plan',name:'Plan',criteria:[{...c,weight:'1'}]});
      const planOne=compileRunCriterionPlan(planModel,{qaDateMode:'interaction'});
      const planTwo=compileRunCriterionPlan(planModel,{qaDateMode:'interaction'});
    `);
    assert.equal(h.run('planOne===planTwo'),true,'unchanged execution plan is reused');
    h.run(`planModel.criteria[0].weight='2'; const restoredPlanModel=JSON.parse(JSON.stringify(planModel)); restoredPlanModel.criteria[0].weight='1'; const restoredPlan=compileRunCriterionPlan(restoredPlanModel,{qaDateMode:'interaction'});`);
    assert.equal(h.run('restoredPlan.criteria[0].criterion.weight'),'1','mutating an editor must not contaminate cached criteria');
    assert.equal(h.run('compileRunCriterionPlan(restoredPlanModel,{qaDateMode:"assigned"})===restoredPlan'),false,'QA date mode separates plans');
    h.run(`
      state.categorized.dated.headers=['Representative','Coach','Date','Metric'];
      state.categorized.dated.rows=[{Representative:'Alice Able',Coach:'Alpha',Date:'2026-09-01',Metric:5,_rep:'Alice Able',_repKey:'alice able',_team:'Alpha'},{Representative:'Alice Able',Coach:'Alpha',Date:'2026-09-12',Metric:9,_rep:'Alice Able',_repKey:'alice able',_team:'Alpha'}];
      state.sourceMeta.date={sourceVersion:1}; markDataIndexDirty('dated fixture',{sources:['date']});
      const datedCriterion={...c,source:'date',customSource:'date',aggregate:'sum'};
    `);
    assert.equal(h.run(`criterionValue(datedCriterion,rep,{start:parseDateOnly('2026-09-01'),end:parseDateOnly('2026-09-05')})`),5);
    assert.equal(h.run(`criterionValue(datedCriterion,rep,{start:parseDateOnly('2026-09-01'),end:parseDateOnly('2026-09-30')})`),14,'date range is included in value and row cache identity');
    // Persisted keys must not contain runtime object counters or session-only cache epochs.
    const stable=h.run(`researchSourceIndexSignature('date')`);
    h.run(`AllStarAnalysis.invalidate({source:'date'});`);
    assert.equal(h.run(`researchSourceIndexSignature('date')`),stable,'Research persisted signatures remain stable across memory cache resets');
    h.run(`
      for(let i=0;i<500;i++) AllStarAnalysis.set('bounded-test','key'+i,{sources:['retail_sv2'],signature:'v1'},i);
    `);
    assert.equal(h.run(`AllStarAnalysis.diagnostics().entries['bounded-test']`),120,'derived namespaces are bounded');
    assert.ok(h.run('AllStarAnalysis.diagnostics().estimatedBytes<=AllStarAnalysis.diagnostics().maxBytes'));
    h.run(`AllStarAnalysis.set('bounded-test','oversized',{},1,{weight:40*1024*1024});`);
    assert.equal(h.run(`AllStarAnalysis.get('bounded-test','oversized',{})`),undefined,'oversized items are not retained');
    // A source can change while index construction is yielding to the browser.
    h.run(`
      state.data.retail.sv2=Array.from({length:1500},(_,i)=>({...filterRows[0],Metric:i}));
      state.sourceMeta.retail_sv2.sourceVersion++; markDataIndexDirty('stale job fixture',{sources:['retail_sv2']});
      const pendingIndex=ensureResearchSourceIndex('retail_sv2',{chunkSize:500});
      state.data.retail.sv2=[{...filterRows[0],Metric:888}]; state.sourceMeta.retail_sv2.sourceVersion++;
    `);
    await assert.rejects(()=>h.run('pendingIndex'),/Source changed during preparation/);
    assert.equal(h.run(`state.researchSourceIndexes.has('retail_sv2')`),false,'stale job must not publish an index');
    const fresh=await h.run(`ensureResearchSourceIndex('retail_sv2')`);
    assert.equal(fresh.rows.length,1);
    await assert.rejects(()=>h.run(`ensureResearchSourceIndex('retail_sv2',{token:{cancelled:true}})`),/cancelled/);
    console.log('PASS shared analysis: calculation parity, dependency-specific reuse, filter compilation, plan edits, dates, bounded memory, stable persistence, and stale/cancelled index jobs');
  }finally{h.close();}
}
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
