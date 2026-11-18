'use strict';
const path=require('path');
const {pathToFileURL}=require('url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const XLSX=require('../../../vendor/xlsx.full.min.js');
const baseline=process.argv[2];
if(!baseline)throw Error('Pass the baseline CoachTools directory as the first argument.');
const suites=[['baseline',path.resolve(baseline)],['revised',path.resolve(__dirname,'../../..')]];
const wide=process.argv.includes('--wide'),rowsPerSlot=wide?2000:500;
const configs=[['qa','Evals',['Agent Name','Score %','Interaction Start Time','Coach']],['coaching','Coaching',['Associate Name','Coaching Date','Description','Coaching Type','Job Coach']],['checklist','Checklist',['Associate Name','Incident Date','Incident','Job Coach']],['weeklyStats','Weekly',['Agent Name','Date Column','Consumer Appointments','Consumer Opportunities','Coach']]];
const fixture=configs.map(([slot,name,headers])=>{
  const wb=XLSX.utils.book_new(),extra=Array.from({length:wide?32:0},(_,i)=>'Additional value '+(i+1));
  const rows=[[...headers,...extra]];
  for(let i=0;i<rowsPerSlot;i++){
    const person=i%(wide?100:20),rep='Example '+(wide?String.fromCharCode(65+Math.floor(person/26),65+person%26):String.fromCharCode(65+person));
    const date='2026-11-'+String(i%16+1).padStart(2,'0'),coach='Coach '+String.fromCharCode(65+i%(wide?10:4));
    const fields=slot==='qa'?[rep,'92%',date,coach]:slot==='coaching'?[rep,date,'Attendance follow-up','Other',coach]:slot==='checklist'?[rep,date,'Attendance',coach]:[rep,date,i%5,8,coach];
    rows.push([...fields,...extra.map((_,j)=>(i+j)%90)]);
  }
  if(wide){
    const split=1+Math.floor(rowsPerSlot/2);
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows.slice(0,split)),name+' 1');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([rows[0],...rows.slice(split)]),name+' 2');
  }else XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);
  const file=Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));return {slot,name:name+'.xlsx',size:file.length,base64:file.toString('base64')};
});
async function measureZip(page){
  await page.evaluate(async()=>{
    const specs=[['coaching','Description','contains','Attendance'],['qa','Score %','notBlank',''],['weeklyStats','Consumer Opportunities','notBlank','']];
    state.rules=specs.map(([source,header,operator,value],index)=>normalizeRule({id:'rule'+index,title:source+' follow-up',ruleType:'statCount',statCount:{source,nameHeader:source==='coaching'?'Associate Name':'Agent Name',conditionHeader:header,operator,value,minCount:1}}));
    state.selectedOtherRuleIds=new Set(state.rules.map(rule=>rule.id));
    els.reportDate.value='2026-11-17';els.executiveHistoryInclude.checked=true;
    window.benchmarkZipSizes=[];downloadBlob=(blob,name)=>{if(name.endsWith('.zip'))benchmarkZipSizes.push(blob.size);};
  });
  const measure=()=>page.evaluate(async()=>{
    const old=benchmarkZipSizes.length,start=performance.now();
    await runEmailWorkflow(true);await new Promise(requestAnimationFrame);
    if(benchmarkZipSizes.length===old)throw Error('No ZIP download. '+els.status.textContent);
    return {wall:Math.round(performance.now()-start),zipBytes:benchmarkZipSizes.at(-1),findings:state.report.flagged.length,coaches:state.report.byCoach.size};
  });
  const cold=await measure(),warm=[];for(let i=0;i<7;i++)warm.push(await measure());
  return {cold,warm};
}
async function measureHistory(page,mode){
  await page.evaluate(async()=>{
    const totalPeople=500,runs=100,names=Array.from({length:totalPeople},(_,person)=>({name:'Example Person '+person,key:'example person '+person,count:runs}));
    for(let run=0;run<runs;run++){
      await new Promise((resolve,reject)=>{
        const tx=state.db.transaction([STORES.history,STORES.settings],'readwrite'),history=tx.objectStore(STORES.history);
        for(let person=0;person<totalPeople;person++){
          const {name,key}=names[person];
          history.put({id:'appearance-'+run+'-'+person,repName:name,repKey:key,coach:'Coach '+person%20,team:'Coach '+person%20,ruleId:'topic'+person%3,ruleTitle:'Topic '+person%3,reportDate:'2026-11-'+String((run%17)+1).padStart(2,'0'),runId:'weekly-run-'+run,appearanceCount:run+1,concern:'High'});
        }
        tx.objectStore(STORES.settings).put({key:CONCERN_HISTORY_LOAD_KEY,version:2,names,fileName:'Synthetic 50,000-appearance history'});
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
      });
    }
  });
  const coldCounts=[],warmCounts=[],details=[];
  for(let i=0;i<5;i++){
    await page.reload();await page.waitForFunction(()=>state.db&&document.querySelector('#status').textContent.startsWith('Ready. Loaded'));
    const showCounts=async()=>page.evaluate(async mode=>{
      const start=performance.now();
      if(mode==='baseline'){switchTab('report');els.concernHistoryViewer.classList.remove('hidden');renderConcernHistoryStatus();if(els.concernHistoryNameList.children.length!==50)throw Error('Missing first 50 counts');}
      else{document.querySelector('#historyBrowseMode').value='counts';switchTab('history');if(document.querySelectorAll('#historyBrowseTable tbody tr').length!==50)throw Error('Missing first 50 counts');}
      await new Promise(requestAnimationFrame);
      return {sinceReload:Math.round(performance.now()),interaction:Math.round(performance.now()-start)};
    },mode);
    const first=await showCounts();coldCounts.push(first.sinceReload);
    await page.evaluate(()=>switchTab('keyfiles'));warmCounts.push((await showCounts()).interaction);
    if(mode==='revised'){
      const ms=await page.evaluate(async()=>{
        document.querySelector('#historyBrowseMode').value='details';document.querySelector('#historyBrowseTable').replaceChildren();
        const start=performance.now();await state.renderHistoryBrowser();await new Promise(requestAnimationFrame);
        if(!state.historyDeferred||document.querySelectorAll('#historyBrowseTable tbody tr').length!==50)throw Error('History detail did not use the bounded page.');
        return Math.round(performance.now()-start);
      });details.push(ms);
    }
  }
  return {seededAppearances:50000,people:500,coldCountPageFromReload:coldCounts,warmCountPage:warmCounts,firstDatedPage:details};
}

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  try{
    const results={fixture:fixture.map(({name,size})=>({name,size,rows:rowsPerSlot,sheets:wide?2:1})),chrome:browser.version(),path:'standalone file',measure:'elapsed milliseconds, prepared File objects to all slots ready, includes review paint, no user delay',runs:{}};
    for(const [mode,root] of suites){
      const page=await browser.newPage();await page.goto(pathToFileURL(path.join(root,'apps/allstar/qualtrics/generator.html')).href);
      await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Ready. Loaded'));
      if(mode==='revised')await page.locator('#toggleQualtricsWorkflow').click();
      const measures=[];
      for(let i=0;i<6;i++){
        const result=await page.evaluate(async({mode,fixture})=>{
          const files=fixture.map(({base64,name})=>new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],name));
          const t=performance.now();let last=t,maxGap=0;const pulse=()=>{let now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;};const timer=setInterval(pulse,10);
          if(mode==='baseline'){for(const [i,fn] of [loadQA,loadCoaching,loadChecklist,loadWeeklyStats].entries())await fn(files[i]);}
          else{await startKeyBatch(files);await new Promise(requestAnimationFrame);await applyKeyBatch();if(state.keyBatch)throw Error(document.querySelector('#keyBatchStatus').textContent);}
          await new Promise(requestAnimationFrame);pulse();clearInterval(timer);
          return {wall:Math.round(performance.now()-t),maxHeartbeatGap:Math.round(maxGap),rows:Object.values(state.masterRows).map(r=>r.length)};
        },{mode,fixture});measures.push(result);
      }
      results.runs[mode]={intake:{cold:measures[0],warm:measures.slice(1)},zip:await measureZip(page)};
      if(!wide)results.runs[mode].history=await measureHistory(page,mode);
      await page.close();
    }
    console.log(JSON.stringify(results));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
