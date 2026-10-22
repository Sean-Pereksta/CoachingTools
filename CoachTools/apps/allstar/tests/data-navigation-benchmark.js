'use strict';
// BASELINE_ALLSTAR_HTML may point to a checkout before the change for comparison.
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
 try{for(const [label,file] of [['baseline',process.env.BASELINE_ALLSTAR_HTML],['current',path.resolve(__dirname,'../allstar.html')]].filter(([,f])=>f)){
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(pathToFileURL(file).href);await page.waitForFunction(()=>state.startup.completed);console.log(label+' started');
  const timings=await page.evaluate(async()=>{
   state.data.retail.controlRoster=Array.from({length:1000},(_,i)=>({_rep:'Representative '+i,_repKey:'rep'+i,_team:'Coach '+i%100}));
   state.data.qa.rows=Array.from({length:10000},(_,i)=>({_rep:'Representative '+i%1000,_repKey:'rep'+i%1000,_team:'Coach '+i%100}));
   state.sourceMeta.qa={sourceVersion:1,rowCount:10000};
   const init=performance.now();AllStarWorkspaceNavigation.refresh();const homeRefreshMs=performance.now()-init;
   const runs=[];for(let i=0;i<3;i++){
    let start=performance.now();await AllStarWorkspaceNavigation.execute('action:data');runs.push({view:'Update Data',ms:performance.now()-start});closeModal('importModal');
    start=performance.now();await AllStarWorkspaceNavigation.execute('action:settings');runs.push({view:'Settings',ms:performance.now()-start});
   }
   const median=view=>{const xs=runs.filter(x=>x.view===view).map(x=>x.ms).sort((a,b)=>a-b);return Math.round(xs[xs.length>>1]*10)/10;};
   return {sourceRows:10000,rosterRows:1000,homeRefreshMs:Math.round(homeRefreshMs*10)/10,updateDataMedianMs:median('Update Data'),settingsMedianMs:median('Settings'),runs};
  });console.log(JSON.stringify({label,...timings}));await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
