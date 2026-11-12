'use strict';
// Exercise the actual launcher/iframe route with isolated synthetic imports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const host = '<!doctype html><script src="/shared/coachtools-storage.js"></script><script src="/shared/coachtools-identity.js"></script><script src="/shared/coachtools-app-data.js"></script>';
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if(url === '/__calculator-fixture.html'){res.setHeader('Content-Type','text/html');res.end(host);return;}
  const file = path.resolve(root, '.' + decodeURIComponent(url));
  if(!file.startsWith(root + path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file, (error, content) => {if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');res.end(content);});
});
async function fixture(page, base){
  await page.goto(base + '/__calculator-fixture.html');
  await page.evaluate(async () => {
    await CoachToolsData.ready();await CoachToolsIdentity.ready();
    for(const coachName of ['Coach Alpha','Coach Beta']){
      const coach = await CoachToolsIdentity.learn(coachName,{role:'coach',source:'kpi-browser-fixture'});
      for(const name of coachName === 'Coach Alpha' ? ['Alex','Blair','Casey'] : ['Delta']){
        await CoachToolsIdentity.learn(name,{role:'representative',currentCoachId:coach.personId,source:'kpi-browser-fixture'});
      }
    }
    const aoa = [['Date','Sheet','Name','Consumer Appointments','Consumer Opportunities']];
    for(const date of ['10/4/2026','10/11/2026','10/18/2026','10/25/2026','11/1/2026','11/8/2026']){
      for(const [name,apps,opps] of [['Alex',20,100],['Blair',25,50],['Casey',90,100]]) aoa.push([date,'Coach Alpha',name,apps,opps]);
      aoa.push([date,'Coach Beta','Delta',20,100]);
    }
    await CoachToolsData.importDataset('weeklyRetail',{meta:{fileName:'Retail Weekly.csv'},workbook:{sheets:['Weekly'],data:{Weekly:{aoa}}}},
      {originalFileName:'Retail Weekly.csv',scopeSnapshot:{mode:'all'},detectedPeriod:{periodKey:'2026-11-08',sortKey:'2026-11-08'}});
    CoachToolsStorage.setScope({mode:'all',label:'All people'});
  });
  return open(page,base);
}
async function open(page,base){
  await page.goto(base + '/apps/kpi-impact-galactic.html');
  const frame = await (await page.waitForSelector('#kpiFrame')).contentFrame();
  await frame.waitForFunction(() => document.querySelectorAll('#coachSel option').length === 2 && document.querySelector('#origRate')?.textContent.includes('%'));
  return frame;
}
const result = frame => frame.locator('#calculatorResult').innerText();
async function noHorizontalOverflow(frame){return frame.evaluate(() => ({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
    const base='http://127.0.0.1:'+server.address().port;
    let frame=await fixture(page,base);
    await frame.selectOption('#coachSel','Coach Alpha');
    assert.equal(await frame.locator('#origRate').innerText(),'54.0%','Header uses weighted sums rather than mean representative rates.');
    await frame.click('#mainTabCalculator');await frame.fill('#teamTargetPercent','60');
    assert.match(await result(frame),/75 extra results/);
    assert.match(await result(frame),/54\.0% to 60\.0%.*1,250 opportunities/s);
    const rows=await frame.locator('#calculatorRepRows tr').allTextContents();
    assert.match(rows[0],/Alex.*20\.0%.*100 \/ 500.*\+50.*30\.0%/);
    assert.match(rows[1],/Blair.*50\.0%.*125 \/ 250.*\+25.*60\.0%/);
    assert.match(rows[2],/Casey.*90\.0%.*450 \/ 500.*\+0.*90\.0%/);
    await frame.click('#calculatorSelectNone');assert.match(await result(frame),/Select at least one representative/);
    await frame.getByRole('checkbox',{name:'Coach Casey',exact:true}).check();
    await frame.fill('#teamTargetPercent','80');assert.match(await result(frame),/up to 50 results.*275 results short/s);
    await frame.fill('#teamTargetPercent','');assert.match(await result(frame),/Enter a target percentage/);
    assert.equal(await frame.locator('#teamTargetPercent').getAttribute('aria-invalid'),'true');
    await frame.fill('#teamTargetPercent','101');assert.match(await result(frame),/Enter a target percentage/);
    await frame.fill('#teamTargetPercent','60');await frame.click('#calculatorBelowTarget');
    assert.equal(await frame.locator('#teamTargetPercent').getAttribute('aria-invalid'),'false');
    await page.reload();frame=await (await page.waitForSelector('#kpiFrame')).contentFrame();
    await frame.waitForFunction(()=>document.querySelector('#calculatorRepRows tr')?.textContent.includes('Alex'));
    assert.equal(await frame.locator('#mainTabCalculator').getAttribute('aria-selected'),'true','Calculator tab survives reopening.');
    assert.equal(await frame.inputValue('#teamTargetPercent'),'60');
    await frame.click('#mainTabImpacts');await frame.selectOption('#impactLayout','table');
    assert.equal(await frame.locator('#impactGrid').isVisible(),false,'Card grid is hidden in table layout.');
    assert.equal(await frame.locator('#impactTable').isVisible(),true);
    await frame.fill('#repSearch','Blair');assert.equal(await frame.locator('#impactTable tbody tr').count(),1);
    assert.match(await frame.locator('#impactTable tbody').innerText(),/Blair/);
    await frame.selectOption('#impactLayout','cards');assert.equal(await frame.locator('#impactGrid .repCard').count(),1);
    await frame.selectOption('#impactLayout','table');await frame.fill('#repSearch','');
    await frame.getByRole('checkbox',{name:'Include Alex in the team calculation',exact:true}).uncheck();
    assert.match(await frame.locator('#includeAllTop').innerText(),/1 excluded/);
    await page.reload();frame=await (await page.waitForSelector('#kpiFrame')).contentFrame();
    await frame.waitForFunction(()=>document.querySelector('#includeAllTop')?.textContent.includes('1 excluded')).catch(async error=>{console.error('Exclusion reload state',await frame.evaluate(()=>({button:document.querySelector('#includeAllTop')?.textContent,workspace:localStorage.getItem('impactTool.workspace.v2'),rows:typeof allRows==='undefined'?null:allRows.length,errors:document.body.innerText.slice(0,400)})));throw error;});
    assert.equal(await frame.locator('#impactTable').isVisible(),true,'Table layout survives reopening.');
    await frame.click('#mainTabCalculator');assert.match(await result(frame),/76\.7%/);
    assert.match(await frame.locator('#calculatorScope').innerText(),/2 included reps.*1 excluded/);
    await frame.click('#includeAllTop');assert.equal(await frame.locator('#includeAllTop').isDisabled(),true);
    assert.match(await result(frame),/54\.0%/);assert.match(await frame.locator('#calculatorScope').innerText(),/3 included reps/);
    await frame.selectOption('#timeSel','3');assert.match(await frame.locator('#calculatorScope').innerText(),/Last 3 available weeks/);
    await frame.fill('#teamTargetPercent','60');assert.match(await result(frame),/45 extra results/);
    await frame.selectOption('#coachSel','Coach Beta');assert.match(await frame.locator('#calculatorScope').innerText(),/Coach Beta.*1 included reps/);
    assert.match(await result(frame),/20\.0%/);
    await frame.selectOption('#coachSel','Coach Alpha');await frame.selectOption('#timeSel','5');
    await frame.fill('#teamTargetPercent','60');await frame.click('#calculatorBelowTarget');
    const desktop=await noHorizontalOverflow(frame);assert.ok(desktop.scroll<=desktop.width+1,JSON.stringify(desktop));
    const screenshot=process.env.KPI_SCREENSHOT;
    if(screenshot){await page.setViewportSize({width:1280,height:1400});await page.screenshot({path:screenshot,fullPage:true});}
    await page.setViewportSize({width:390,height:844});
    const mobile=await noHorizontalOverflow(frame);
    if(mobile.scroll>mobile.width+1)console.error('Mobile overflowing elements',await frame.evaluate(()=>[...document.querySelectorAll('body *')].filter(element=>{const b=element.getBoundingClientRect();return b.right>document.documentElement.clientWidth+2&&b.width>0;}).map(element=>({tag:element.tagName,id:element.id,cls:element.className,right:Math.round(element.getBoundingClientRect().right),width:Math.round(element.getBoundingClientRect().width),scroll:element.scrollWidth})).slice(0,12)));
    assert.ok(mobile.scroll<=mobile.width+1,JSON.stringify(mobile));
    assert.equal(await frame.locator('.calculatorTableWrap').evaluate(element=>element.scrollWidth>element.clientWidth),true,'The wide target table scrolls within its own container on mobile.');
    await frame.locator('#calculatorRepRows').scrollIntoViewIfNeeded();
    if(screenshot)await page.screenshot({path:screenshot.replace(/\.png$/, '-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[],'The live wrapper and inner app have no runtime errors.');
    console.log('KPI calculator browser regression passed: weighted targets, coaching selections, validation, exclusions, persistence, views, scope/window, desktop/mobile.');
    await context.close();
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
