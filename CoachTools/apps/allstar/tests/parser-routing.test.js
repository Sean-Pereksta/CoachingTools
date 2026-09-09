'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

async function runParserRoutingTests(source,assert){
  function setup(baseURI,embedded='',workerError=false,cancelOnYield=false){
    const counts={reads:0,workers:0,yields:0,terminated:0,revoked:0}, result={SheetNames:['QA']};
    const state={activeImportJob:{cancelled:false}};
    let script='';
    class TestBlob{constructor(parts){script=parts.join('');}}
    class TestURL extends URL{
      static createObjectURL(){return 'blob:test';}
      static revokeObjectURL(){counts.revoked++;}
    }
    class TestWorker{
      constructor(){counts.workers++;}
      postMessage(){Promise.resolve().then(()=>workerError?this.onerror({message:'Worker failed'}):this.onmessage({data:{workbook:result}}));}
      terminate(){counts.terminated++;}
    }
    const parse=new Function('document','Worker','Blob','URL','XLSX','state','updateProgress','yieldToBrowser','setTimeout','clearTimeout',
      source+'\nreturn parseAllStarWorkbook;')(
      {baseURI,querySelector:()=>embedded?{textContent:embedded}:null},TestWorker,TestBlob,TestURL,
      {read(buffer,options){counts.reads++;assert.equal(options.cellDates,true);assert.equal(options.raw,false);return result;}},
      state,()=>{},async()=>{counts.yields++;if(cancelOnYield)state.activeImportJob.cancelled=true;},setTimeout,clearTimeout);
    return {parse,counts,result,script:()=>script};
  }
  for(const url of [
    'file:///C:/Users/Sean.pereksta/OneDrive%20-%20Safelite%20Group/Desktop/WFM/MyOne3.0/CoachTools/apps/allstar/allstar.html',
    'file:///C:/Users/Sean/Desktop/CoachTools/apps/allstar/allstar.html'
  ]){
    const h=setup(url);
    assert.equal(await h.parse(new ArrayBuffer(8)),h.result);
    assert.equal(h.counts.reads,1);assert.equal(h.counts.workers,0);assert.equal(h.counts.yields,1);
  }
  const hosted=setup('https://example.com/CoachTools/apps/allstar/allstar.html');
  assert.equal(await hosted.parse(new ArrayBuffer(8)),hosted.result);
  assert.equal(hosted.counts.reads,0);assert.equal(hosted.counts.workers,1);
  assert.equal(hosted.script().includes('https://example.com/CoachTools/vendor/xlsx.full.min.js'),true);
  assert.equal(hosted.counts.terminated,1);assert.equal(hosted.counts.revoked,1);
  const portable=setup('file:///C:/All-Star-Portable.html','/* embedded SheetJS */');
  assert.equal(await portable.parse(new ArrayBuffer(8)),portable.result);
  assert.equal(portable.counts.workers,1);assert.equal(portable.counts.reads,0);
  assert.equal(portable.script().includes('importScripts'),false);
  const failed=setup('https://example.com/CoachTools/apps/allstar/allstar.html','',true);
  await assert.rejects(()=>failed.parse(new ArrayBuffer(8)),/Worker failed/);
  assert.equal(failed.counts.reads,0);assert.equal(failed.counts.terminated,1);
  const cancelled=setup('file:///C:/Allstar.html','',false,true);
  await assert.rejects(()=>cancelled.parse(new ArrayBuffer(8)),/import stopped/);
  assert.equal(cancelled.counts.reads,0);assert.equal(cancelled.counts.workers,0);
}

runParserRoutingTests(fs.readFileSync(path.join(__dirname,'../js/import-jobs.js'),'utf8'),assert).then(()=>console.log('PASS Allstar parser routing: local file, hosted, portable, errors, cancellation')).catch(error=>{console.error(error);process.exitCode=1;});
