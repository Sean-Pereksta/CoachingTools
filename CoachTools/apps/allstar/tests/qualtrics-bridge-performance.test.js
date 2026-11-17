'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/qualtrics-bridge.js'),'utf8');

function harness(costPerRow){
  let time=0, converted=0;
  const yields=[];
  const context=vm.createContext({
    performance:{now:()=>time},
    setTimeout:callback=>{ yields.push(converted); queueMicrotask(callback); },
    console
  });
  vm.runInContext(source,context);
  context.qualtricsBridgeRow=row=>{ converted++; time+=costPerRow; return row; };
  return {context,yields,get converted(){ return converted; }};
}

(async()=>{
  const rows=Array.from({length:3200},(_,index)=>({index}));
  const wide=harness(.25);
  const converted=await wide.context.qualtricsBridgeRowsDeferred(rows,'qa');
  assert.equal(JSON.stringify(converted),JSON.stringify(rows),'batching preserves every row and its order');
  assert.ok(wide.yields[0]<=50,'costly rows yield before the previous 1,500-row boundary');
  assert.ok(wide.yields.every((count,index)=>count-(wide.yields[index-1]||0)<=50),'time budget applies to every batch');

  const cheap=harness(0);
  await cheap.context.qualtricsBridgeRowsDeferred(rows,'qa');
  assert.deepEqual(cheap.yields,[1500,3000],'cheap conversions retain a row-count upper bound without excessive yields');

  const cancelled=harness(.25);
  await assert.rejects(()=>cancelled.context.qualtricsBridgeRowsDeferred(rows,'qa','',()=>!cancelled.yields.length),{name:'AbortError'});
  assert.equal(cancelled.converted,50,'superseded source conversion stops immediately after its yield');
  console.log('PASS Qualtrics bridge responsive batches, output parity, row limit, and cancellation');
})().catch(error=>{console.error(error);process.exitCode=1;});
