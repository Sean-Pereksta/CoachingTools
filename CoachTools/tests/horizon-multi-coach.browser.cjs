'use strict';
// Synthetic fixtures in an isolated browser; never reads the user's imports.
// PLAYWRIGHT_MODULE and CHROMIUM_PATH can point to a local test installation.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((request,response)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(request.url.split('?')[0]==='/'?'/index.html':request.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
  fs.readFile(file,(error,content)=>{if(error){response.writeHead(404).end();return;}response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');response.end(content);});
});
(async()=>{
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
    const context=await browser.newContext(),page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/');
    await page.evaluate(async()=>{
      await CoachToolsData.ready();await CoachToolsIdentity.ready();
      const names=['Coach Alpha','Coach Beta','Coach Gamma'];
      for(const name of names){
        const coach=await CoachToolsIdentity.learn(name,{role:'coach',team:'Shared Team',source:'browser-multi-coach'});
        await CoachToolsIdentity.learn(name+' Rep',{role:'representative',currentCoachId:coach.personId,team:'Shared Team',source:'browser-multi-coach'});
      }
      await CoachToolsData.importDataset('weeklyRetail',{workbook:{sheets:['Data'],data:{Data:{aoa:[['Date','Coach','Name'],...names.map(name=>['11/1/2026',name,name+' Rep'])]}}}},{scopeSnapshot:{mode:'all'}});
      CoachToolsStorage.setScope({mode:'all',label:'All people'});
    });
    await page.waitForFunction(()=>document.querySelectorAll('#globalScopeSelect option[value^="coach:"]').length===3);
    await page.locator('#changeScope').click();
    await page.getByRole('checkbox',{name:'Coach: Coach Alpha',exact:true}).check();
    await page.locator('#scopeSearch').fill('Beta');
    await page.getByRole('checkbox',{name:'Coach: Coach Beta',exact:true}).check();
    assert.equal(await page.locator('#scopeSelectionCount').textContent(),'2 coaches selected');
    assert.equal(await page.evaluate(()=>CoachToolsStorage.getScope().mode),'all','Checkboxes are a pending selection until Apply.');
    await page.locator('#applyCoachScope').click();
    await page.waitForFunction(()=>document.getElementById('globalScopeSelect').value.startsWith('coaches:'));
    const loaded=await page.evaluate(async()=>({
      scope:CoachToolsStorage.getScope(),
      rows:(await CoachToolsAppData.get('weeklyRetail')).workbook.data.Data.aoa.slice(1).map(row=>row[2]),
      sourceRows:(await CoachToolsData.getCurrent('weeklyRetail')).workbook.data.Data.aoa.length
    }));
    assert.deepEqual(loaded.scope.coaches,['Coach Alpha','Coach Beta']);assert.equal(loaded.scope.coachPersonIds.length,2);
    assert.deepEqual(loaded.rows,['Coach Alpha Rep','Coach Beta Rep']);assert.equal(loaded.sourceRows,4);
    await page.reload();
    await page.waitForFunction(()=>document.querySelectorAll('#globalScopeSelect option[value^="coach:"]').length===3);
    await page.locator('#changeScope').click();
    assert.equal(await page.locator('.scope-coach-checkbox:checked').count(),2,'Reload restores both saved coach identities.');
    assert.equal(await page.getByRole('checkbox',{name:'Coach: Coach Gamma',exact:true}).isChecked(),false);
    if(process.env.SCOPE_SCREENSHOT)await page.screenshot({path:process.env.SCOPE_SCREENSHOT});
    await page.getByRole('checkbox',{name:'Coach: Coach Beta',exact:true}).uncheck();
    await page.locator('#applyCoachScope').click();
    assert.equal(await page.evaluate(()=>CoachToolsStorage.getScope().mode),'coach');
    assert.equal(await page.locator('#activeScopeName').textContent(),'Coach Alpha');
    await page.locator('#changeScope').click();await page.locator('#scopeAllPeople').click();
    assert.equal(await page.evaluate(async()=>(await CoachToolsAppData.get('weeklyRetail')).workbook.data.Data.aoa.length),4);
    await page.setViewportSize({width:390,height:844});await page.locator('#changeScope').click();
    const apply=await page.locator('#applyCoachScope').boundingBox();
    assert.ok(apply.x>=0 && apply.x+apply.width<=390 && apply.y+apply.height<=844,'Apply stays visible on a narrow screen.');
    if(process.env.SCOPE_SCREENSHOT)await page.screenshot({path:process.env.SCOPE_SCREENSHOT.replace(/\.png$/,'-mobile.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS real desktop multi-coach checkbox selection, combined loading, source preservation, saved reload, single/all transitions, and narrow layout');
  }finally{
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
