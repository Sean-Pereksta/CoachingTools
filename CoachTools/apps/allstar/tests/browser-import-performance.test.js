'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.env.ALLSTAR_BENCHMARK_ROOT||path.resolve(__dirname,'..');
const count=Number(process.env.ALLSTAR_BENCHMARK_ROWS||50000);
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    for(const filename of ['allstar.html','dist/All-Star-Portable.html']){
      const context=await browser.newContext(),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
      page.setDefaultTimeout(120000);
      await page.goto(pathToFileURL(path.join(root,filename)).href);
      await page.waitForFunction(()=>state.startup.completed);
      await page.evaluate(()=>openModal('importModal'));
      const result=await page.evaluate(async count=>{
        const csv=['Agent Name,Team,Score %,Interaction Start Time,Assigned Date',...Array.from({length:count},(_,i)=>`Agent ${i},Coach ${i%44},90%,2026-09-01,2026-09-02`)].join('\n');
        const results=[];
        for(let run=0;run<2;run++){
          const gaps=[];let last=performance.now(),lastStage='Starting';
          const timer=setInterval(()=>{const now=performance.now(),stage=state.activeImportJob?.stage||'Complete';gaps.push({ms:now-last,from:lastStage,to:stage});last=now;lastStage=stage;},16);
          const started=performance.now(),ok=await loadQAFile(new File([csv],`QA-${run}.csv`,{type:'text/csv'}));
          await new Promise(resolve=>setTimeout(resolve,20));clearInterval(timer);
          results.push({run,ok,rows:state.data.qa.rows.length,totalMs:Math.round(performance.now()-started),longestMainThreadGapMs:Math.round(Math.max(...gaps.map(gap=>gap.ms))),gapsOver100ms:gaps.filter(gap=>gap.ms>100).length,heartbeatTicks:gaps.length,slowestStages:gaps.sort((a,b)=>b.ms-a.ms).slice(0,3).map(gap=>({...gap,ms:Math.round(gap.ms)}))});
        }
        return results;
      },count);
      result.forEach(run=>{assert.equal(run.ok,true);assert.equal(run.rows,count);assert.ok(run.heartbeatTicks>5,'UI heartbeat continues during import');});
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({root,filename,rows:count,imports:result}));
      if(!process.env.ALLSTAR_BENCHMARK_ROOT){
        const cancelled=await page.evaluate(async()=>{
          const original=normalizeImportedRowOnce;
          let rows=0;normalizeImportedRowOnce=(...args)=>{const value=original(...args);if(++rows===100)cancelAllStarImport();return value;};
          try{const ok=await loadQAFile(new File(['Agent Name,Team,Score %\n'+Array.from({length:2000},(_,i)=>`Cancel ${i},Coach Cancel,95%`).join('\n')],'cancel.csv',{type:'text/csv'}));return {ok,fileName:state.data.qa.fileName,count:state.data.qa.rows.length};}
          finally{normalizeImportedRowOnce=original;}
        });
        assert.equal(cancelled.ok,false);assert.equal(cancelled.fileName,'QA-1.csv');assert.equal(cancelled.count,count);
        await page.reload();await page.waitForFunction(()=>state.startup.completed);
        assert.equal(await page.evaluate(()=>state.data.qa.rows.length),count);
        assert.equal(await page.evaluate(()=>state.data.qa.fileName),'QA-1.csv');
        console.log('PASS '+filename+': replacement, UI heartbeat, cancellation, retained data after reload');
      }
      await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
