'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const csv='Date,Sheet,Name,Consumer Appointment Rate\n2026-09-13,Alpha,Alice Able,50%\n2026-09-20,Alpha,Alice Able,55%\n2026-09-27,Alpha,Alice Able,60%';

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 try{for(const file of ['allstar.html','dist/All-Star-Portable.html']){
  const context=await browser.newContext({timezoneId:'America/New_York'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());page.setDefaultTimeout(20000);
  await page.goto(pathToFileURL(path.join(root,file)).href);await page.waitForFunction(()=>state.startup.completed);await page.evaluate(()=>window.CoachToolsStatsSettingsReady);
  await page.evaluate(()=>openModal('importModal'));
  await page.locator('#coachtoolsFiles').setInputFiles({name:'Retail Weekly Stats.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#coachtoolsImportAllBtn:enabled').waitFor();await page.locator('#coachtoolsImportAllBtn').click();
  await page.waitForFunction(()=>state.data.weeklyRetail.rows.length===3&&!state.activeImportJob);
  assert.equal(await page.evaluate(()=>state.data.weeklyRetail.config.calendar.reviewed),false);
  assert.deepEqual(await page.evaluate(async()=>{const m=datedStatsUploadedFields().find(m=>m.field==='Consumer Appointment Rate');return (await evaluateDatedStatsResearch({id:'update',datedStats:datedStatsSelectMetric({groupBy:'all'},m)})).data.map(p=>[p.label,p.value]);}),[['2026-09-13',50],['2026-09-20',55],['2026-09-27',60]]);
  // Clean Upload's same shared API, with unrestricted source selection.
  const correction='Date,Sheet,Name,Consumer Appointment Rate\n2026-09-27,Alpha,Alice Able,70%\n2026-10-04,Alpha,Alice Able,65%';
  const clean=async text=>page.evaluate(async text=>{
   const file=new File([text],'Retail Weekly Stats.csv',{type:'text/csv'}),analysis=await window.CoachToolsImport.analyzeFiles([file],{authoritativeCleanUpload:true});
   if(analysis.errors.length||analysis.recognized.length!==1)throw new Error('Clean Upload did not recognize weekly statistics');
   await window.CoachToolsImport.saveRecognizedEntry(analysis.recognized[0],{authoritativeCleanUpload:true,scope:{mode:'all',label:'All people'}});
   const sync=await syncAllStarFromCoachToolsData({persist:true,render:true});if(sync.error)throw sync.error;
   const m=datedStatsUploadedFields().find(m=>m.field==='Consumer Appointment Rate');return (await evaluateDatedStatsResearch({id:'clean',datedStats:datedStatsSelectMetric({groupBy:'all'},m)})).data.map(p=>[p.label,p.value]);
  },text);
  const expected=[['2026-09-13',50],['2026-09-20',55],['2026-09-27',70],['2026-10-04',65]];
  assert.deepEqual(await clean(correction),expected);assert.deepEqual(await clean(correction),expected);
  assert.equal(await page.evaluate(()=>state.data.weeklyRetail.rows.length),4);
  assert.equal(await page.evaluate(()=>state.data.retail.sv2.length),0);
  await page.reload();await page.waitForFunction(()=>state.startup.completed);
  assert.deepEqual(await page.evaluate(async()=>{const m=datedStatsUploadedFields().find(m=>m.field==='Consumer Appointment Rate');return (await evaluateDatedStatsResearch({id:'reload',datedStats:datedStatsSelectMetric({},m)})).data.map(p=>[p.label,p.value]);}),expected);
  assert.deepEqual(errors,[]);console.log('PASS '+file+': Update Data and Clean Upload API parity, corrections, preserved history, deduplication and reopening');
  await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
