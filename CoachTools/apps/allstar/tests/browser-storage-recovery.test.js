'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');

async function main(){
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
  try{
    const page=await browser.newPage();
    page.on('dialog',dialog=>dialog.dismiss());
    const root=path.resolve(__dirname,'..');
    await page.goto(pathToFileURL(path.join(root,'allstar.html')).href);
    await page.waitForFunction(()=>state.startup?.completed);
    const run=()=>page.evaluate(async()=>{
      localStorage.setItem('allStarWorkerStorage.v1','on');
      const NativeWorker=window.Worker;
      let fault='',observed=0;
      // Only the optional storage worker uses batch/commit messages. Parsing
      // and all IndexedDB operations run in the real browser.
      class InterruptedWorker extends NativeWorker{
        postMessage(message,...rest){
          if(fault==='before'&&message.commit){
            observed++;
            queueMicrotask(()=>this.dispatchEvent(new ErrorEvent('error',{message:'Interrupted before write'})));
            return;
          }
          return super.postMessage(message,...rest);
        }
        set onmessage(handler){
          super.onmessage=event=>{
            if(fault==='after'&&event.data.committed){
              observed++;
              this.dispatchEvent(new ErrorEvent('error',{message:'Lost write acknowledgement'}));
            }else handler(event);
          };
        }
      }
      window.Worker=InterruptedWorker;
      const upload=(name,person,rows)=>loadQAFile(new File([['Agent Name,Team,Score %,Assigned Date',...Array.from({length:rows},(_,i)=>person+' '+i+',Coach,95%,2026-07-17')].join('\n')],name,{type:'text/csv'}));
      try{
        const initial=await upload('first.csv','Original',1);
        fault='before';
        const failed=await upload('interrupted.csv','Interrupted',10000);
        const prior=state.data.qa.fileName;
        fault='after';
        const recovered=await upload('verified.csv','Verified',10000);
        return {initial,failed,prior,recovered,observed};
      }finally{window.Worker=NativeWorker;}
    });
    assert.deepEqual(await run(),{initial:true,failed:false,prior:'first.csv',recovered:true,observed:2});
    await page.reload();await page.waitForFunction(()=>state.startup?.completed);
    const restored=await page.evaluate(()=>({file:state.data.qa.fileName,rows:state.data.qa.rows.length,first:state.data.qa.rows[0]._rep,raw:state.data.qa.aoa.length}));
    assert.deepEqual(restored,{file:'verified.csv',rows:10000,first:'Verified 0',raw:10001});
    console.log('PASS optional writer recovers previous data on interruption and reads back a committed replacement after losing its acknowledgement');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
