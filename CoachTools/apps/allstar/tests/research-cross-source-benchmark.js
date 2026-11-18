'use strict';
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const assert=require('node:assert/strict');

// Same rows, identity cardinality, field types and cross-source question as
// analysis-benchmark.js, with a fresh process and index for every measurement.
async function measure(directory){
  const {createHarness}=require(path.resolve(directory,'tests/modernization-compatibility.test.js'));
  const h=createHarness();
  try {
    h.run(`
      const headers=['Representative','Team','Metric','Opportunities','Date'];
      state.data.retail.headers.sv2=headers;
      state.data.referral.headers.sv2=headers.slice();
      state.data.retail.sv2=Array.from({length:150000},(_,i)=>({
        Representative:'Rep '+(i%500),Team:'Team '+(i%20),Metric:String(i%31),Opportunities:'100',
        Date:'2026-09-'+String(i%28+1).padStart(2,'0'),_rep:'Rep '+(i%500),_repKey:'rep '+(i%500),_team:'Team '+(i%20),_sourceKey:'retail_sv2'
      }));
      state.data.referral.sv2=state.data.retail.sv2.map(row=>({...row,Metric:String(Number(row.Metric)*2),_sourceKey:'referral_sv2'}));
      for(const source of ['retail_sv2','referral_sv2'])state.sourceMeta[source]={sourceVersion:1};
      markDataIndexDirty('cross-source benchmark',{sources:['retail_sv2','referral_sv2']});
      const question=normalizeResearchItem({id:'cross',title:'Metric by Team',source:'retail_sv2',analysisGrain:'rows',outputType:'bar',groupField:'Team',valueMode:'sum',valueField:'![referral_sv2].[Metric]',sort:'default'});
    `);
    const start=performance.now();
    await h.run("Promise.all(['retail_sv2','referral_sv2'].map(source=>ensureResearchSourceIndex(source)))");
    const indexed=performance.now(),result=await h.run('evaluateResearchItemAsync(question)'),calculated=performance.now();
    const hash=createHash('sha256').update(JSON.stringify([result.data.map(r=>[r.label,r.values,r.rows]),result.totalValues,result.totalRowCount,result.joinDiagnostics])).digest('hex');
    return {indexMs:Math.round(indexed-start),calculateMs:Math.round(calculated-indexed),groups:result.data.length,hash};
  } finally {h.close();}
}
async function main(){
  const [first,second,repeat]=process.argv.slice(2);
  if(first==='--one'){process.stdout.write(JSON.stringify(await measure(second)));return;}
  if(!first||!second)throw Error('Pass baseline and candidate Allstar app directories, then an optional repetition count.');
  const count=Number(repeat||3);
  assert(Number.isSafeInteger(count)&&count>0);
  let reference;
  const results=[[],[]],dirs=[first,second];
  for(let i=0;i<count;i++)for(const side of (i%2?[1,0]:[0,1])){
    const proc=spawnSync(process.execPath,[__filename,'--one',dirs[side]],{encoding:'utf8'});
    if(proc.status!==0)throw Error(proc.stderr||'Benchmark process failed.');
    const result=JSON.parse(proc.stdout.trim().split('\n').at(-1));
    reference??=result.hash;assert.equal(result.hash,reference);
    results[side].push(result);
    console.log(JSON.stringify({run:i+1,side:side?'candidate':'baseline',...result}));
  }
  const percentile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.ceil(p*values.length)-1];
  for(const [index,runs] of results.entries()){
    const summary={side:index?'candidate':'baseline',runs:runs.length};
    for(const key of ['indexMs','calculateMs'])summary[key]={p50:percentile(runs.map(r=>r[key]),.5),p95:percentile(runs.map(r=>r[key]),.95)};
    console.log(JSON.stringify(summary));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
