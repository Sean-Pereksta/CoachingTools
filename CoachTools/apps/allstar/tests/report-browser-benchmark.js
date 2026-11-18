const path=require('node:path'),{pathToFileURL}=require('node:url');
// Pass a baseline Allstar HTML path to measure both builds. Each context has an isolated data store.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
 try{
  const files=process.argv.slice(2).map(file=>path.resolve(file));
  files.push(path.resolve(__dirname,'../allstar.html'));
  for(const [index,file] of files.entries()){
   const build=index===files.length-1?'updated':'baseline';
   for(let i=0;i<5;i++){
    const ctx=await browser.newContext({offline:true,timezoneId:'America/New_York',viewport:{width:1200,height:850}});
    const page=await ctx.newPage();page.on('dialog',d=>d.dismiss());await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(()=>typeof state!=='undefined'&&state.startup.completed);
    await page.evaluate(async()=>{
      const teams=['A','B','C','D','E','F','G','H','I','J'];state.data.retail.headers.sv2=['Representative','Team','Amount','Count'];
      state.data.retail.sv2=Array.from({length:2500},(_,i)=>{const n=i%250,name='Rep '+n,team=teams[n%10];return {Representative:name,Team:team,Amount:i%37,Count:i%9,_rep:name,_repKey:fullNameIdentityKey(name),_team:team,_sourceKey:'retail_sv2'};});
      state.sourceMeta.retail_sv2={sourceVersion:1};markDataIndexDirty('timing',{sources:['retail_sv2']});rebuildDataIndexSync('timing');
      const m=normalizeModelForStorage({id:'bench',name:'Benchmark',criteria:['sum','avg','max','min'].map((aggregate,i)=>({...emptyCriterion(),column:i%2?'Amount':'Count',aggregate,id:'c'+i,name:aggregate,scoreType:'points',points:1}))});
      state.models.push(m);await window.AllStarWorkspaceNavigation.execute('action:report-new');els.runModelSelect.value=m.id;
      state.selectedTeams=new Set(teams);state.teamSelectionInitialized=true;renderTeamSelect();state.runMode='single';
      if(el('reportFocusedMode'))el('reportFocusedMode').checked=true;
      const original=renderResults;window.benchPaint=0;window.benchLong=[];
      new PerformanceObserver(list=>window.benchLong.push(...list.getEntries().map(t=>[t.startTime,t.duration]))).observe({type:'longtask'});
      renderResults=(...args)=>{const r=original(...args);requestAnimationFrame(()=>requestAnimationFrame(()=>{window.benchPaint=performance.now();}));return r;};
    });
    const runs=[];
    for(const cache of ['cold','warm']){
      const values=await page.evaluate(async()=>{
        window.benchPaint=0;const start=performance.now(),report=await buildRun();
        if(!report)throw Error('Report did not complete');
        const saved=performance.now();
        while(!window.benchPaint)await new Promise(r=>requestAnimationFrame(r));
        await new Promise(r=>setTimeout(r,30));
        return {firstPaint:Math.round(Math.max(window.benchPaint,start)-start),complete:Math.round(saved-start),longest:Math.max(0,...window.benchLong.filter(x=>x[0]>=start&&x[0]<=saved).map(x=>x[1])),rows:report.repPack.rows.length,score:report.repPack.rows.reduce((s,r)=>s+r.overallScore,0)};
      });
      runs.push({build,i,cache,...values});
    }
    console.log(JSON.stringify(runs));await ctx.close();
   }
  }
  console.log(browser.version());
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
