'use strict';
// Real Chromium, modular file:// and portable builds. Synthetic data only.
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
function qaFile(count,name='qa.csv'){
  const lines=['Agent Name,Team,Score %,Interaction Start Time,Assigned Date'];
  for(let i=0;i<count;i++) lines.push(`Agent ${i},${i<count/2?'Johnny Doe':'John Doe'},${i%2?80:100}%,2026-09-${String(i%28+1).padStart(2,'0')},2026-10-01`);
  return {name,mimeType:'text/csv',buffer:Buffer.from(lines.join('\n'))};
}
async function upload(page,file){
  await page.locator('#qaFile').setInputFiles(file);
  await page.waitForFunction(()=>state.importJobHistory?.at(-1)?.filename===document.getElementById('qaFile').files[0]?.name&&state.importJobHistory.at(-1).stage==='Complete'&&!state.activeImportJob,{},{timeout:90000});
  await page.waitForFunction(()=>!document.getElementById('loadingOverlay').classList.contains('open'));
}
async function startup(page){await page.waitForFunction(()=>state.startup?.completed,{},{timeout:60000});await page.waitForFunction(()=>!document.getElementById('loadingOverlay').classList.contains('open'));}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  try{for(const file of ['allstar.html','dist/All-Star-Portable.html']){
    const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto(pathToFileURL(path.join(root,file)).href);await startup(page);
    // Settings must clear without opening the import workspace in this session.
    await page.locator('[data-as-section="Settings"]').click();
    assert.equal(await page.locator('#coachNameManagement details').count(),0);
    await page.locator('#settingsClearAllDataBtn').click();
    await page.waitForFunction(()=>state.reportingDataCleared&&!state.reportingDataClearing);
    await page.reload();await startup(page);
    assert.equal(await page.evaluate(()=>state.data.qa.rows.length),0);
    await page.locator('[data-as-section="Data"]').click();
    await upload(page,qaFile(1000));
    assert.equal(await page.evaluate(()=>state.data.qa.rows.length),1000);
    const before=await page.evaluate(()=>state.data.qa.rows.reduce((n,r)=>n+Number(String(r['Score %']).replace('%','')),0));
    await page.locator('#coachNameManagement summary').click();
    await page.waitForFunction(()=>document.querySelector('#coachNameManagement [data-coach-status]').textContent.includes('coaches available'));
    await page.locator('[data-coach-from]').fill('Johnny Doe');await page.locator('[data-coach-to]').fill('John Doe');
    await page.locator('[data-coach-remember]').check();await page.locator('[data-coach-preview]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-coach-apply]').disabled);
    assert.match(await page.locator('[data-coach-status]').innerText(),/500 reporting records/);
    assert.match(await page.locator('[data-coach-status]').innerText(),/target coach already exists/);
    await page.locator('[data-coach-apply]').click();
    await page.waitForFunction(()=>document.querySelector('[data-coach-status]').textContent.startsWith('Saved:'),{},{timeout:60000});
    assert.deepEqual(await page.evaluate(()=>[state.data.qa.rows.length,[...new Set(state.data.qa.rows.map(r=>r._team))],state.data.qa.rows.reduce((n,r)=>n+Number(String(r['Score %']).replace('%','')),0)]),[1000,['John Doe'],before]);
    await page.reload();await startup(page);
    assert.deepEqual(await page.evaluate(()=>[state.data.qa.rows.length,[...new Set(state.data.qa.rows.map(r=>r.Team))]]),[1000,['John Doe']]);
    await page.locator('[data-as-section="Data"]').click();await upload(page,qaFile(12,'future.csv'));
    assert.deepEqual(await page.evaluate(()=>[...new Set(state.data.qa.rows.map(r=>r._team))]),['John Doe']);
    const settings=await page.evaluate(()=>JSON.stringify(state.models));
    await page.locator('#clearImportCacheBtn').click();await page.waitForFunction(()=>state.reportingDataCleared&&!state.reportingDataClearing);
    await page.reload();await startup(page);
    assert.equal(await page.evaluate(()=>state.data.qa.rows.length),0);
    assert.equal(await page.evaluate(()=>JSON.stringify(state.models)),settings);
    await page.locator('[data-as-section="Data"]').click();await upload(page,qaFile(20,'reloaded.csv'));
    await page.locator('#importModal [data-close]').first().click();
    await page.locator('[data-as-section="Settings"]').click();await page.locator('#settingsClearAllDataBtn').click();
    await page.waitForFunction(()=>state.reportingDataCleared&&!state.reportingDataClearing);await page.reload();await startup(page);
    assert.equal(await page.evaluate(()=>state.data.qa.rows.length),0);
    assert.deepEqual(errors,[],file+' runtime errors');
    console.log('PASS '+file+': Settings-first clear, CSV upload, exact rename/merge, conserved rows and scores, reload, remembered corrections, both clear buttons, settings preserved');
    await context.close();
  }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
