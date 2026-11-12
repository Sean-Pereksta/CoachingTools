'use strict';
// Exercise the actual launcher with isolated weekly performance and coaching imports.
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
  if(url === '/__support-fixture.html'){res.setHeader('Content-Type','text/html');res.end(host);return;}
  const file = path.resolve(root, '.' + decodeURIComponent(url));
  if(!file.startsWith(root + path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file, (error, content) => {if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');res.end(content);});
});
const names = ['Needs Nora','Stagnant Sam','Growing Gia','Pending Pat','On Track Oli','No Data Noor','Other Topic Otis'];
async function fixture(page, base){
  await page.goto(base + '/__support-fixture.html');
  await page.evaluate(async names => {
    await CoachToolsData.ready();await CoachToolsIdentity.ready();
    for(const coachName of ['Coach Alpha','Coach Beta']){
      const coach = await CoachToolsIdentity.learn(coachName,{role:'coach',source:'support-browser-fixture'});
      for(const name of coachName === 'Coach Alpha' ? names : ['Beta Bea']){
        await CoachToolsIdentity.learn(name,{role:'representative',currentCoachId:coach.personId,source:'support-browser-fixture'});
      }
    }
    const dates = ['10/4/2026','10/11/2026','10/18/2026','10/25/2026','11/1/2026','11/8/2026'];
    const values = {'Needs Nora':[20,20,20,20,20,20],'Stagnant Sam':[30,30,30,30,30,30],
      'Growing Gia':[20,20,20,30,40,50],'Pending Pat':[20,20,20,25,25,25],
      'On Track Oli':[70,70,70,70,70,70],'No Data Noor':[0,0,0,0,0,0],'Other Topic Otis':[35,35,35,35,35,35]};
    const aoa = [['Date','Sheet','Name','Consumer Appointments','Consumer Opportunities']];
    dates.forEach((date,i)=>{for(const name of names)aoa.push([date,'Coach Alpha',name,values[name][i],name==='No Data Noor'?0:100]);aoa.push([date,'Coach Beta','Beta Bea',60,100]);});
    await CoachToolsData.importDataset('weeklyRetail',{meta:{fileName:'Retail Weekly.csv'},workbook:{sheets:['Weekly'],data:{Weekly:{aoa}}}},
      {originalFileName:'Retail Weekly.csv',scopeSnapshot:{mode:'all'},detectedPeriod:{periodKey:'2026-11-08',sortKey:'2026-11-08'}});
    const coaching = [['Associate Name','Job Coach','Date','Coaching Type Multi','Coaching Type','Description'],
      ['Stagnant Sam','Coach Alpha','10/20/2026','Consumer AR','1:1 Coaching','<img src=x onerror="window.__unsafe=1"> Review close with confidence.'],
      ['Growing Gia','Coach Alpha','10/20/2026','Consumer AR','1:1 Coaching','Practice a clear next step.'],
      ['Pending Pat','Coach Alpha','11/10/2026','Consumer AR','1:1 Coaching','Recent support needs a complete follow-up week.'],
      ['Other Topic Otis','Coach Alpha','10/20/2026','Wipers','1:1 Coaching','This coaching is for a different topic.'],
      ['Needs Nora','Coach Alpha','10/20/2026','Consumer AR','Team Meeting','Topic matches but the selected coaching type does not.'],
      ['Needs Nora','Coach Alpha','11/20/2026','Consumer AR','1:1 Coaching','Future event must not count.']];
    await CoachToolsData.importDataset('documentedCoaching',{meta:{fileName:'Documented Coaching.csv'},workbook:{sheets:['Coaching'],data:{Coaching:{aoa:coaching}}}},
      {originalFileName:'Documented Coaching.csv',scopeSnapshot:{mode:'all'}});
    const checklist = [['Coach Assigned','Associate Name','Created On','Date Served','Action Taken','Incident','Corrective','Description'],
      ['Coach Alpha','Stagnant Sam','10/27/2026','10/29/2026','Served','Appointment behavior','Written warning','Documented escalation after topic support.'],
      ['Coach Alpha','Needs Nora','11/4/2026','','Open','Attendance','Verbal warning','Open record for a different incident.']];
    await CoachToolsData.importDataset('checklist',{meta:{fileName:'Checklist.csv'},workbook:{sheets:['Checklist'],data:{Checklist:{aoa:checklist}}}},
      {originalFileName:'Checklist.csv',scopeSnapshot:{mode:'all'}});
    CoachToolsStorage.setScope({mode:'all',label:'All people'});
  }, names);
  return open(page,base);
}
async function open(page,base){
  await page.goto(base + '/apps/kpi-impact-galactic.html');
  const frame = await (await page.waitForSelector('#kpiFrame')).contentFrame();
  await frame.waitForFunction(() => window.__KPI_IMPACT_READY__ && document.querySelectorAll('#coachSel option').length === 2 && document.querySelector('#supportTopic'));
  return frame;
}
const person = (frame,rep) => frame.locator('.supportPerson').filter({has:frame.locator('[data-support-open]').filter({hasText:rep})});
async function category(frame, rep){return person(frame,rep).getAttribute('data-category');}
async function incident(frame,value){if(!await frame.locator('#supportCorrectiveIncident').isVisible())await frame.locator('.supportSettings summary').click();await frame.selectOption('#supportCorrectiveIncident',value);}
async function noHorizontalOverflow(frame){return frame.evaluate(() => ({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:1280,height:1200}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
    const base='http://127.0.0.1:'+server.address().port;
    let frame=await fixture(page,base);
    await frame.selectOption('#coachSel','Coach Alpha');await frame.selectOption('#timeSel','10');
    await frame.click('#mainTabSupport');await frame.selectOption('#supportTopic','Consumer AR');
    await frame.selectOption('#supportCoachingType','1:1 Coaching');
    assert.equal(await frame.inputValue('#supportCorrectiveType'),'','Corrective type requires an explicit selection.');
    await frame.selectOption('#supportCorrectiveType','Written warning');
    await incident(frame,'Appointment behavior');
    assert.equal(await category(frame,'Needs Nora'),'needs-support','Future coaching does not cover a historical need.');
    assert.equal(await category(frame,'Other Topic Otis'),'needs-support','Unrelated-topic coaching does not count as selected-topic support.');
    assert.equal(await category(frame,'Stagnant Sam'),'stagnant','Corrective records do not replace the latest regular support intervention.');
    assert.equal(await category(frame,'Growing Gia'),'growing');
    assert.equal(await category(frame,'Pending Pat'),'follow-up','Do not label fresh support stagnant without a complete follow-up week.');
    assert.equal(await category(frame,'On Track Oli'),'on-track');
    assert.equal(await category(frame,'No Data Noor'),'insufficient','Zero opportunities are missing data, not 0% performance.');
    assert.match(await person(frame,'Growing Gia').locator('.supportCurrentValue').innerText(),/50\.0%/,'Current means latest measured week, not the window average.');
    assert.match(await person(frame,'Growing Gia').locator('.supportTrend').innerText(),/20\.0/,'Trend compares the older and newer weighted halves of the data.');
    assert.match(await person(frame,'Needs Nora').innerText(),/27\.0/,'Need shows percentage-point gap to goal.');
    assert.match(await person(frame,'Stagnant Sam').innerText(),/WRITTEN WARNING.*Served.*Recorded since latest coaching/s);
    await person(frame,'Stagnant Sam').locator('[data-support-open]').click();
    assert.equal(await frame.locator('#supportPersonDialog').isVisible(),true);
    assert.match(await frame.locator('#supportTopicHistory').innerText(),/10\/20|Oct 20|20 Oct/);
    assert.match(await frame.locator('#supportTopicHistory').innerText(),/<img src=x onerror=/,'Coaching notes render as literal text.');
    assert.equal(await frame.locator('#supportTopicHistory img').count(),0);
    assert.match(await frame.locator('#supportCorrectiveHistory').innerText(),/10\/29|Oct 29|29 Oct/);
    assert.equal(await frame.evaluate(()=>window.__unsafe),undefined);
    await frame.locator('#supportDialogClose').click();
    await person(frame,'Growing Gia').locator('[data-support-open]').click();await page.keyboard.press('Escape');
    assert.equal(await frame.locator('#supportPersonDialog').isVisible(),false,'History dialog closes by keyboard.');
    await frame.selectOption('#supportCorrectiveType','Verbal warning');await incident(frame,'Attendance');
    assert.match(await person(frame,'Needs Nora').innerText(),/open/i,'Unserved checklist records remain labelled open.');
    await frame.selectOption('#supportCorrectiveStatus','recorded');assert.equal(await frame.locator('.supportPerson').count(),1);
    await frame.selectOption('#supportCorrectiveStatus','after-support');assert.equal(await frame.locator('.supportPerson').count(),0,'An open corrective without regular support is not escalation after support.');
    await frame.selectOption('#supportCorrectiveStatus','all');await frame.selectOption('#supportCorrectiveType','Written warning');await incident(frame,'Appointment behavior');
    await frame.selectOption('#supportStatus','stagnant');assert.equal(await frame.locator('.supportPerson').count(),1);
    await frame.selectOption('#supportCorrectiveStatus','after-support');assert.equal(await frame.locator('.supportPerson').count(),1);
    await frame.selectOption('#supportCorrectiveStatus','none');assert.equal(await frame.locator('.supportPerson').count(),0);
    await frame.selectOption('#supportCorrectiveStatus','all');await frame.selectOption('#supportStatus','all');
    await frame.fill('#supportSearch','Nora');assert.equal(await frame.locator('.supportPerson').count(),1);
    await frame.fill('#supportSearch','');await frame.selectOption('#supportNeed','high');
    assert.ok(await frame.locator('.supportPerson').count()>=3);assert.equal(await frame.locator('.supportPerson[data-need="at-goal"]').count(),0);
    await frame.selectOption('#supportNeed','all');
    await frame.selectOption('#supportTopic','Wipers');assert.equal(await category(frame,'Growing Gia'),'on-track');
    assert.equal(await category(frame,'Other Topic Otis'),'stagnant');
    await frame.selectOption('#supportTopic','Consumer AR');await frame.selectOption('#supportGrowthThreshold','2');
    await page.reload();frame=await (await page.waitForSelector('#kpiFrame')).contentFrame();
    await frame.waitForFunction(()=>window.__KPI_IMPACT_READY__ && document.querySelector('#supportTopic'));
    assert.equal(await frame.locator('#mainTabSupport').getAttribute('aria-selected'),'true');
    assert.equal(await frame.inputValue('#supportTopic'),'Consumer AR');assert.equal(await frame.inputValue('#supportCoachingType'),'1:1 Coaching');assert.equal(await frame.inputValue('#supportCorrectiveType'),'Written warning');
    assert.equal(await frame.inputValue('#supportCorrectiveIncident'),'Appointment behavior');
    assert.equal(await frame.inputValue('#supportGrowthThreshold'),'2');
    await frame.click('#mainTabImpacts');await frame.selectOption('#impactLayout','table');
    await frame.getByRole('checkbox',{name:'Include Needs Nora in the team calculation',exact:true}).uncheck();
    await frame.click('#mainTabSupport');assert.equal(await person(frame,'Needs Nora').count(),0);
    await page.reload();frame=await (await page.waitForSelector('#kpiFrame')).contentFrame();
    await frame.waitForFunction(()=>document.querySelector('#includeAllTop')?.textContent.includes('1 excluded') && document.querySelector('#supportTopic'));
    assert.equal(await person(frame,'Needs Nora').count(),0);await frame.click('#includeAllTop');assert.equal(await person(frame,'Needs Nora').count(),1);
    await frame.selectOption('#coachSel','Coach Beta');assert.equal(await frame.locator('.supportPerson').count(),1);assert.match(await frame.locator('#coachingSupportWorkspace').innerText(),/Beta Bea/);
    await frame.selectOption('#coachSel','Coach Alpha');await frame.selectOption('#timeSel','3');
    await frame.selectOption('#supportTopic','Consumer AR');await frame.selectOption('#supportCoachingType','1:1 Coaching');await frame.selectOption('#supportCorrectiveType','Written warning');await incident(frame,'Appointment behavior');
    assert.equal(await category(frame,'Stagnant Sam'),'needs-support','A support event outside the selected review window does not imply support in this window.');
    await frame.selectOption('#timeSel','10');await frame.selectOption('#supportTopic','Consumer AR');await frame.selectOption('#supportCoachingType','1:1 Coaching');await frame.selectOption('#supportCorrectiveType','Written warning');await incident(frame,'Appointment behavior');
    await frame.locator('#coachtools-heavy-startup-progress').waitFor({state:'hidden'});
    if(await frame.locator('.supportSettings').evaluate(element=>element.open))await frame.locator('.supportSettings summary').click();
    const desktop=await noHorizontalOverflow(frame);assert.ok(desktop.scroll<=desktop.width+1,JSON.stringify(desktop));
    const screenshot=process.env.KPI_SUPPORT_SCREENSHOT;
    if(screenshot){await page.setViewportSize({width:1440,height:1600});await page.screenshot({path:screenshot,fullPage:true});}
    await page.setViewportSize({width:390,height:844});
    const mobile=await noHorizontalOverflow(frame);
    if(mobile.scroll>mobile.width+1)console.error('Mobile overflowing elements',await frame.evaluate(()=>[...document.querySelectorAll('body *')].filter(element=>{const b=element.getBoundingClientRect();return b.right>document.documentElement.clientWidth+2&&b.width>0;}).map(element=>({tag:element.tagName,id:element.id,cls:element.className,right:Math.round(element.getBoundingClientRect().right),width:Math.round(element.getBoundingClientRect().width)})).slice(0,12)));
    assert.ok(mobile.scroll<=mobile.width+1,JSON.stringify(mobile));
    if(screenshot){await frame.locator('.supportPerson').first().scrollIntoViewIfNeeded();await page.screenshot({path:screenshot.replace(/\.png$/, '-mobile.png'),fullPage:true});}
    await page.setViewportSize({width:1280,height:1200});
    await frame.evaluate(async()=>{
      const coaching=[['Associate Name','Job Coach','Date','Coaching Type Multi','Coaching Type','Description'],
        ['Stagnant Sam','Coach Alpha','11/11/2026','Consumer AR','1:1 Coaching','Replacement source with new support date.'],
        ['Growing Gia','Coach Alpha','10/20/2026','Consumer AR','1:1 Coaching','Practice a clear next step.'],
        ['Pending Pat','Coach Alpha','11/10/2026','Consumer AR','1:1 Coaching','Recent support needs a complete follow-up week.'],
        ['Other Topic Otis','Coach Alpha','10/20/2026','Wipers','1:1 Coaching','This coaching is for a different topic.'],
        ['Needs Nora','Coach Alpha','10/20/2026','Consumer AR','1:1 Coaching','New matching support from the replacement source.']];
      await CoachToolsData.importDataset('documentedCoaching',{meta:{fileName:'Documented Coaching.csv'},workbook:{sheets:['Coaching'],data:{Coaching:{aoa:coaching}}}},
        {originalFileName:'Documented Coaching.csv',scopeSnapshot:{mode:'all'}});
    });
    await frame.click('#reloadCache');
    await frame.waitForFunction(()=>[...document.querySelectorAll('.supportPerson')].find(card=>card.dataset.rep==='Stagnant Sam')?.dataset.category==='follow-up');
    assert.equal(await category(frame,'Needs Nora'),'stagnant','Reload reads replacement coaching data rather than a stale cached source.');
    await person(frame,'Stagnant Sam').locator('[data-support-open]').click();
    const replacementHistory=await frame.locator('#supportTopicHistory').innerText();
    assert.match(replacementHistory,/11\/11|Nov 11|11 Nov/);assert.doesNotMatch(replacementHistory,/10\/20|Oct 20|20 Oct/,'The removed coaching record does not survive source replacement.');
    await frame.locator('#supportDialogClose').click();
    assert.deepEqual(errors,[],'The live wrapper and support workspace have no runtime errors.');
    console.log('KPI Coaching Support browser regression passed: current KPI, weighted trends, topic support, corrective escalation, need categories, safe histories, persistence, exclusions, source replacement/reload, scope and responsive views.');
    await context.close();
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
