'use strict';
// Real browser coverage for scoped startup, live scope changes and full-source persistence.
// Synthetic rows only. Run after build-portable.js; PLAYWRIGHT_MODULE / CHROMIUM_PATH are optional.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const appRoot=path.resolve(__dirname,'..'),suiteRoot=path.resolve(appRoot,'../..');
const count=Number(process.env.ALLSTAR_STARTUP_ROWS||24000),people=1000;
const expectedCoach=coach=>Array.from({length:count},(_,i)=>(i%people)%44).filter(value=>value===coach).length;
async function ready(page){
  await page.waitForFunction(()=>state.startup.completed,{}, {timeout:120000});
  await page.waitForFunction(()=>!document.getElementById('loadingOverlay').classList.contains('open'));
}
async function scope(page,value,expected){
  await page.evaluate(value=>CoachToolsStorage.setScope(value),value);
  await page.waitForFunction(expected=>state.globalScopeView?.key===CoachToolsData.getScopeKey()&&!state.centralSyncStageActive&&getRowsRaw('qa').length===expected,expected,{timeout:60000});
  assert.equal(await page.evaluate(()=>state.data.qa.rows.length),count,'View changes must preserve the complete editable source.');
}
function stats(page){return page.evaluate(()=>({
  durationMs:state.startup.diagnostics.durationMs,centralRefreshed:state.startup.diagnostics.centralRefreshed,
  rows:state.data.qa.rows.length,visible:getRowsRaw('qa').length,
  heartbeatTicks:window.startupHeartbeats.length,maxMainThreadGapMs:Math.round(Math.max(0,...window.startupHeartbeats))
}));}
(async()=>{
  const server=http.createServer((request,response)=>{
    const file=path.resolve(suiteRoot,'.'+decodeURIComponent(request.url.split('?')[0]));
    if(!file.startsWith(suiteRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
    response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
    const files=[['modular HTTP',`http://127.0.0.1:${server.address().port}/apps/allstar/allstar.html`],['portable file',pathToFileURL(path.join(appRoot,'dist/All-Star-Portable.html')).href]];
    for(const [label,url] of files){
      const context=await browser.newContext(),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
      await page.addInitScript(()=>{window.startupHeartbeats=[];let last=performance.now();setInterval(()=>{const now=performance.now();window.startupHeartbeats.push(now-last);last=now;},16);});
      await page.goto(url);await ready(page);
      await page.evaluate(async ({count,people})=>{
        const aoa=[['Agent Name','Team','Score %','Interaction Start Time','Assigned Date']];
        for(let i=0;i<count;i++)aoa.push(['Agent '+(i%people),'Coach '+((i%people)%44),'90%','2026-09-01','2026-09-02']);
        await CoachToolsData.importDataset('qa',{meta:{fileName:'Scope startup QA.csv'},workbook:{sheets:['QA'],data:{QA:{aoa}}}},{originalFileName:'Scope startup QA.csv',detectedPeriod:{periodKey:'2026-09-02',sortKey:'2026-09-02'}});
        CoachToolsStorage.setScope({mode:'representative',label:'Selected people',representatives:Array.from({length:200},(_,i)=>'Agent '+i)});
      },{count,people});
      await page.reload();await ready(page);
      const initial=await stats(page);
      assert.equal(initial.rows,count);assert.equal(initial.visible,count*200/people);assert.ok(initial.heartbeatTicks>5,'The browser must keep receiving work while the source loads.');
      await page.reload();await ready(page);
      const cached=await stats(page);
      assert.equal(cached.centralRefreshed,0,'An unchanged complete source should be reused.');
      assert.equal(cached.rows,count);assert.equal(cached.visible,count*200/people);
      await scope(page,{mode:'coach',label:'Coach 1',coaches:['Coach 1']},expectedCoach(1));
      assert.deepEqual(await page.evaluate(()=>[...new Set(getRowsRaw('qa').map(row=>row._team))]),['Coach 1']);
      await scope(page,{mode:'coach',label:'Coach 2',coaches:['Coach 2']},expectedCoach(2));
      assert.deepEqual(await page.evaluate(()=>[...new Set(getRowsRaw('qa').map(row=>row._team))]),['Coach 2']);
      await scope(page,{mode:'all',label:'All people'},count);
      await scope(page,{mode:'coach',label:'Coach 1',coaches:['Coach 1']},expectedCoach(1));
      await page.reload();await ready(page);
      assert.equal(await page.evaluate(()=>state.data.qa.rows.length),count,'Reloading a narrow view must not persist only that coach.');
      assert.equal(await page.evaluate(()=>getRowsRaw('qa').length),expectedCoach(1));
      assert.deepEqual(errors,[],label+' runtime errors');
      console.log(JSON.stringify({label,count,initial,cached,scopeChanges:'selected representatives → Coach 1 → Coach 2 → all → Coach 1 → reload'}));
      await context.close();
    }
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
