'use strict';
// Optional browser gate; no HTML preview is created. An existing base checkout
// can be supplied for before screenshots using BASELINE_ALLSTAR_ROOT.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const shots=process.env.ORG_READINESS_SCREENSHOT_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'org-qa-'));
fs.mkdirSync(shots,{recursive:true});
async function seed(page){
 await page.evaluate(()=>{
  state.data.retail.headers.sv2=['Representative','Team','Apps','Opps','Date'];
  state.data.retail.sv2=Array.from({length:90},(_,i)=>({Representative:'Representative with a long name '+i,Team:'Coach '+Math.floor(i/3),Apps:i%3?12:0,Opps:30,Date:i%2?'2026-08-08':'2026-08-02'})).map(r=>({...r,_rep:r.Representative,_repKey:fullNameIdentityKey(r.Representative),_team:r.Team,_sourceKey:'retail_sv2'}));
  state.sourceMeta.retail_sv2={sourceVersion:1};markDataIndexDirty('browser org fixture',{sources:['retail_sv2']});rebuildDataIndexSync('browser fixture');
  state.orgs=[normalizeOrg({id:'long-org',name:'Specialty Consumer Operations Support Organization — Regional Services',coachNames:Array.from({length:30},(_,i)=>'Coach '+i)}),normalizeOrg({id:'overlap',name:'Intentional overlap',coachNames:['Coach 0']})];state.activeOrgId='long-org';saveOrgs();
  state.researchItems=[normalizeResearchItem({id:'rate',title:'Long saved Research title: appointment rate with date and population checks',source:'retail_sv2',dateColumn:'Date',startDate:'2026-08-02',endDate:'2026-08-08',analysisGrain:'representatives',groupField:'Representative',outputType:'table',columns:[{field:'[Apps] / [Opps]',mode:'expression',showAsPercent:true}]})];saveResearchItems();openOrgBuilder();
 });
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  if(process.env.BASELINE_ALLSTAR_ROOT){
   const page=await browser.newPage();await page.goto(pathToFileURL(path.join(process.env.BASELINE_ALLSTAR_ROOT,'allstar.html')).href);await page.waitForFunction(()=>state.startup.completed);await seed(page);
   for(const width of [1280,750,480]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(shots,`before-organizations-${width}.png`)});}await page.close();
  }
  for(const file of ['allstar.html','dist/All-Star-Portable.html']){
   const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'America/New_York'}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
   await page.goto(pathToFileURL(path.join(root,file)).href);await page.waitForFunction(()=>state.startup.completed);await seed(page);
   assert.equal(await page.evaluate(()=>orgReadinessSnapshot),null);
   await page.locator('[data-org-health="1"]').click();assert.match(await page.locator('#orgHealthDetails').innerText(),/Coach 0/);
   const variant=file.startsWith('dist')?'portable':'modular';
   for(const width of [1280,750,480]){
    await page.setViewportSize({width,height:900});
    const size=await page.locator('#orgBuilderModal .modalBody').evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));assert.ok(size.scroll<=size.width+1,'bounded modal at '+width);
    await page.screenshot({path:path.join(shots,`after-${variant}-organizations-${width}.png`)});
   }
   await page.locator('#orgReadinessTab').click();await page.locator('#orgResearchSelect').selectOption('rate');await page.locator('#orgCheckResearchBtn').click();
   await page.waitForFunction(()=>orgReadinessSnapshot?.report.status==='Ready');await page.screenshot({path:path.join(shots,`after-${variant}-readiness-480.png`)});
   await page.locator('#orgPeriodIntent').selectOption('mixed');assert.equal(await page.evaluate(()=>orgReadinessSnapshot),null);
   await page.locator('#orgMembersTab').click();await page.locator('[data-org-coach="Coach 0"]').uncheck();assert.equal(await page.evaluate(()=>activeOrg().coachNames.includes('Coach 0')),false);
   await page.locator('#orgNameInput').fill('Renamed organization');await page.locator('#orgSaveFootBtn').click();assert.equal(await page.evaluate(()=>activeOrg().name),'Renamed organization');
   await page.locator('#duplicateOrgBtn').click();assert.match(await page.evaluate(()=>activeOrg().name),/copy$/);await page.locator('#deleteOrgBtn').click();
   assert.deepEqual(errors,[],file+' runtime errors');await context.close();
  }
  console.log('PASS browser Org workflow, responsive containment and screenshots: '+shots);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
