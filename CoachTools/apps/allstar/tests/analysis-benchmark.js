'use strict';
// Synthetic Node/DOM harness benchmark. This does not measure Excel parsing,
// physical browser paint, export rendering, or network/device startup.
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
const sizes=process.argv.slice(2).map(Number).filter(Number.isFinite);
const round=n=>Math.round(n*100)/100;
async function measure(fn){const start=performance.now(); const value=await fn(); return {ms:round(performance.now()-start),value};}

async function benchmark(count){
  const boot=performance.now(), h=createHarness(), startup=round(performance.now()-boot);
  let lastTick=performance.now(), maxDelay=0, measuring=true, activePhase='fixture'; const phaseDelays={};
  const timer=setInterval(()=>{const current=performance.now();if(measuring){ const delay=Math.max(0,current-lastTick-5); maxDelay=Math.max(maxDelay,delay); phaseDelays[activePhase]=Math.max(phaseDelays[activePhase]||0,delay); }lastTick=current;},5);
  async function phaseMeasure(name,fn){ activePhase=name; const result=await measure(fn); await new Promise(resolve=>setTimeout(resolve,10)); return result; }
  try{
    h.context.fixtureSize=count;
    const fixture=await phaseMeasure('fixture',()=>h.run(`
      const benchmarkRepCount=500;
      state.data.retail.headers.sv2=['Representative','Team','Metric','Opportunities','Date'];
      state.data.retail.sv2=Array.from({length:fixtureSize},(_,i)=>({Representative:'Rep '+(i%benchmarkRepCount),Team:'Team '+(i%20),Metric:String(i%31),Opportunities:'100',Date:'2026-09-'+String(i%28+1).padStart(2,'0'),_rep:'Rep '+(i%benchmarkRepCount),_repKey:'rep '+(i%benchmarkRepCount),_team:'Team '+(i%20),_sourceKey:'retail_sv2'}));
      state.data.referral.headers.sv2=state.data.retail.headers.sv2.slice();
      state.data.referral.sv2=state.data.retail.sv2.map(row=>({...row,Metric:String(Number(row.Metric)*2),_sourceKey:'referral_sv2'}));
      state.sourceMeta.retail_sv2={sourceVersion:1};state.sourceMeta.referral_sv2={sourceVersion:1};
      markDataIndexDirty('benchmark fixture',{sources:['retail_sv2','referral_sv2']});
      const benchmarkEntries=Array.from({length:benchmarkRepCount},(_,i)=>({kind:'rep',name:'Rep '+i,key:'rep '+i,team:'Team '+(i%20)}));
      const benchmarkModel=normalizeModelForStorage({id:'benchmark',name:'Benchmark',criteria:[
        {...emptyCriterion(),id:'total',name:'Total',column:'Metric',aggregate:'sum'},
        {...emptyCriterion(),id:'average',name:'Average',column:'Metric',aggregate:'avg'},
        {...emptyCriterion(),id:'ratio',name:'Cross-source ratio',calcType:'multi',leftSource:'retail_sv2',leftColumn:'Metric',rightSource:'referral_sv2',rightColumn:'Opportunities',operator:'divide',format:'pct'}
      ]});
      const benchmarkOptions=()=>({_sourceRowsCache:new Map(),_entryRowsCache:new Map(),_criterionPlan:compileRunCriterionPlan(benchmarkModel,{})});
      const benchmarkResearch=normalizeResearchItem({id:'benchmark-research',title:'Metric by Team',source:'retail_sv2',analysisGrain:'rows',outputType:'bar',groupField:'Team',valueMode:'sum',valueField:'Metric',sort:'default'});
    `));
    const heapBefore=process.memoryUsage().heapUsed;
    const indexes=await phaseMeasure('indexes',()=>h.run(`Promise.all(['retail_sv2','referral_sv2'].map(source=>ensureResearchSourceIndex(source)))`));
    h.run(`
      // Frozen pre-modernization numeric aggregation path: every finite value
      // allocated a pair and parsed a date even for sum/average.
      function baselineNumeric(c,entry,options){
        const rows=criterionRowsForEntry(c,entry,options),col=resolveColumn(c.source,c.column);
        const pairs=rows.map((r,i)=>({r,i,n:toNum(r[col]),t:rowDateMillisForSource(c.source,r)})).filter(x=>Number.isFinite(x.n));
        if(!pairs.length)return NaN;
        if(c.aggregate==='avg')return pairs.reduce((a,b)=>a+b.n,0)/pairs.length;
        return pairs.reduce((a,b)=>a+b.n,0);
      }
      const numericCriteria=benchmarkModel.criteria.slice(0,2);
    `);
    measuring=false;
    const previousNumeric=await measure(()=>h.run(`numericCriteria.map(c=>benchmarkEntries.map(entry=>baselineNumeric(c,entry,{})))`));
    const currentNumeric=await measure(()=>h.run(`numericCriteria.map(c=>benchmarkEntries.map(entry=>valueSingle(c,entry,{})))`));
    assert.deepEqual(plain(previousNumeric.value),plain(currentNumeric.value));
    h.run(`AllStarAnalysis.invalidate({full:true,reason:'benchmark cold model reset'});state.criterionInputCache.clear();`);
    await new Promise(resolve=>setTimeout(resolve,10));lastTick=performance.now();measuring=true;
    const plan=await phaseMeasure('plan',()=>h.run(`compileRunCriterionPlan(benchmarkModel,{})`));
    const cold=await phaseMeasure('cold',()=>h.run(`computeEntriesAsync(benchmarkModel,benchmarkEntries,'rep',benchmarkOptions())`));
    const warm=await phaseMeasure('warm',()=>h.run(`computeEntriesAsync(benchmarkModel,benchmarkEntries,'rep',benchmarkOptions())`));
    assert.deepEqual(plain(warm.value),plain(cold.value));
    const researchCold=await phaseMeasure('researchCold',()=>h.run(`evaluateResearchItemAsync(benchmarkResearch)`));
    const researchWarm=await phaseMeasure('researchWarm',()=>h.run(`evaluateResearchItemAsync(benchmarkResearch)`));
    assert.deepEqual(plain(researchCold.value.data),plain(researchWarm.value.data));
    assert.equal(researchWarm.value.perf.cacheUsed,true);
    const appearance=await phaseMeasure('appearance',()=>h.run(`evaluateResearchItemAsync({...benchmarkResearch,title:'Renamed',showGridlines:false,showLegend:false})`));
    assert.equal(appearance.value.perf.cacheUsed,true);
    const filtered=await phaseMeasure('filtered',()=>h.run(`evaluateResearchItemAsync({...benchmarkResearch,id:'filtered',filters:[{id:'metric-filter',field:'Metric',op:'greater than',value:'15'}]})`));
    const cross=await phaseMeasure('cross',()=>h.run(`evaluateResearchItemAsync({...benchmarkResearch,id:'cross',valueField:'![referral_sv2].[Metric]'})`));
    await new Promise(resolve=>setTimeout(resolve,10));
    return {rowsPerSource:count,sources:2,representatives:500,nodeHarnessStartupMs:startup,syntheticFixtureMs:fixture.ms,
      sourceIndexesMs:indexes.ms,legacyNumericAggregationsMs:previousNumeric.ms,modernNumericAggregationsMs:currentNumeric.ms,modelPlanMs:plan.ms,modelColdMs:cold.ms,modelWarmMs:warm.ms,
      researchColdMs:researchCold.ms,researchWarmMs:researchWarm.ms,researchAppearanceCacheMs:appearance.ms,
      researchFilterChangeMs:filtered.ms,crossSourceResearchMs:cross.ms,
      observedAsyncAnalysisEventLoopDelayMs:round(Math.max(0,maxDelay)),phaseEventLoopDelayMs:Object.fromEntries(Object.entries(phaseDelays).map(([name,delay])=>[name,round(delay)])),heapGrowthMiB:round((process.memoryUsage().heapUsed-heapBefore)/1048576),
      derivedCache:h.run('AllStarAnalysis.diagnostics()')};
  }finally{clearInterval(timer);h.close();}
}
async function main(){
  const results=[];
  for(const size of sizes.length?sizes:[10000,50000,150000]){
    const result=await benchmark(size);results.push(result);
    console.log(JSON.stringify({...result,derivedCache:{estimatedBytes:result.derivedCache.estimatedBytes,entries:result.derivedCache.entries,hits:result.derivedCache.hits,misses:result.derivedCache.misses,evictions:result.derivedCache.evictions}}));
  }
  return results;
}
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={benchmark};
