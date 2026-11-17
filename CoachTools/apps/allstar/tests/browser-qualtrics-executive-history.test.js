'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900},timezoneId:'America/New_York'}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(path.join(__dirname,'../qualtrics/generator.html')).href);
    await page.waitForFunction(()=>typeof state!=='undefined'&&state.db&&document.getElementById('status').textContent.startsWith('Ready.'));
    await page.evaluate(async()=>{
      const people=[['Alex One','sales','Coach Rowan'],['Blair Two','sales','Coach Rowan'],['Casey Three','quality','Coach Rowan'],['Drew Four','sales','Coach Avery'],['Evan Five','quality','Coach Avery']];
      state.rules=[normalizeRule({id:'sales',title:'Assumptive language',coaching:{mode:'descriptionContains',descriptionPhrases:['assumptive language']}}),normalizeRule({id:'quality',title:'Verification',coaching:{mode:'descriptionContains',descriptionPhrases:['verification']}})];
      state.history=people.flatMap(([name,ruleId,coach])=>['2026-08-20','2026-09-10','2026-10-15','2026-11-10'].map(date=>({repKey:repKey(name),repName:name,ruleId,coach,team:coach,reportDate:date,runId:date})));
      state.history.push({...state.history[0]}); // Imported duplicate is one occurrence.
      await loadCoaching({name:'coaching.csv',__allStarRows:[
        {'Associate Name':'Alex One','Coaching Date':'2026-11-17T23:55:00',Description:'Practice assumptive language','Job Coach':'Former Coach'},
        {'Associate Name':'Blair Two','Coaching Date':'2026-11-01',Description:'An unrelated subject','Coaching Type':'assumptive language'},
        {'Associate Name':'Evan Five','Coaching Date':'2026-10-01',Description:'Practice verification'},
        {'Associate Name':'Evan Five','Coaching Date':'2026-10-15',Description:'Practice verification'}
      ]});
      state.teamMap=new Map(people.map(([name,ruleId,coach])=>[repKey(name),{name,coach,team:coach}]));
      els.reportDate.value='2026-11-17'; els.executiveHistoryMonths.value='3'; els.executiveHistoryAppearances.value='2'; els.executiveHistoryCoachings.value='2';
      window.capturedDownloads=[]; downloadBlob=(blob,name)=>window.capturedDownloads.push({blob,name});
      state.report=null; switchTab('report');
    });
    await page.locator('#reviewExecutiveHistoryBtn').click();
    const snapshot=await page.evaluate(()=>{
      const review=buildExecutiveHistoryReview();
      return {summary:review.summary,coaches:review.coaches.map(c=>({coach:c.coach,count:c.concernRepCount,shares:c.missingTopicShares})),historyLength:state.history.length,html:els.executiveHistoryPreview.innerHTML,chart:els.executiveHistoryPreview.querySelector('img')?.src};
    });
    assert.equal(snapshot.summary.concernRepCount,4); assert.equal(snapshot.summary.coachedRepCount,2);
    assert.equal(snapshot.summary.coachingContactCount,3); assert.equal(snapshot.coaches[0].coach,'Coach Rowan'); assert.equal(snapshot.coaches[0].count,3);
    assert.equal(snapshot.coaches[0].shares[0].count,2); assert.equal(snapshot.coaches[0].shares[1].count,1);
    assert.match(snapshot.chart,/^data:image\/png;base64,/); assert.match(snapshot.html,/66\.7%/);
    assert.equal(await page.locator('#executiveHistoryPreview a[href="#executive-coach-1"]').count(),1);
    await page.locator('#downloadExecutiveHistoryBtn').click();
    const download=await page.evaluate(async()=>({name:capturedDownloads[0].name,text:await capturedDownloads[0].blob.text(),historyLength:state.history.length}));
    assert.equal(download.name,'Executive_History_2026-11-17.eml'); assert.equal(download.historyLength,snapshot.historyLength);
    assert.match(download.text,/Content-Type: multipart\/related/); assert.match(download.text,/Content-Type: image\/png/); assert.match(download.text,/src="cid:coaching-chart-1@coachtools"/);
    assert.ok(!download.text.includes('src="data:image/png'));
    // A normal report still exposes the exact saved coaching phrase in Breakdown.
    await page.evaluate(async()=>{
      state.dashboardFiles=[{id:'sales-file',fileName:'Assumptive language.csv',ruleId:'sales',status:'matched',headers:['Agent Name','Value','Coach'],rows:[{'Agent Name':'Blair Two',Value:20,Coach:'Coach Rowan'}]}];
      state.rules[0].agentHeader='Agent Name'; state.rules[0].criteria=[{header:'Value',operator:'lt',value:'50'}];
      state.selectedOtherRuleIds=new Set(); state.hireDateSettings=normalizeHireDateSettings();
      state.reportAudienceSettings={scope:'all',value:'',minPeople:1}; renderReportAudienceControls();
      await generateReport();
    });
    const normal=await page.evaluate(()=>makeEmailHtml('Coach Rowan',state.report.flagged));
    assert.match(normal,/To register as coached/); assert.match(normal,/assumptive language/);
    await page.setViewportSize({width:390,height:844});
    await page.locator('#reviewExecutiveHistoryBtn').click();
    const overflow=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,preview:els.executiveHistoryPreview.getBoundingClientRect().width,previewScroll:els.executiveHistoryPreview.scrollWidth,wide:[...document.querySelectorAll('#executiveHistoryEdition *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(el=>({tag:el.tagName,id:el.id,width:el.getBoundingClientRect().width}))}));
    assert.ok(overflow.width<=overflow.viewport+1,'executive controls and email fit the mobile viewport: '+JSON.stringify(overflow));
    if(process.env.EXECUTIVE_SCREENSHOT_DIR){
      fs.mkdirSync(process.env.EXECUTIVE_SCREENSHOT_DIR,{recursive:true});
      await page.setViewportSize({width:1280,height:900});
      const target=path.join(process.env.EXECUTIVE_SCREENSHOT_DIR,'executive-history-preview.png');
      const email=await page.evaluate(()=>makeExecutiveHistoryEmail().html), preview=await browser.newPage({viewport:{width:1000,height:900}});
      await preview.setContent(email);
      await preview.screenshot({path:target,fullPage:true});
      await preview.setViewportSize({width:390,height:844});
      assert.equal(await preview.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'standalone email fits mobile');
      await preview.screenshot({path:path.join(process.env.EXECUTIVE_SCREENSHOT_DIR,'executive-history-mobile.png'),fullPage:true});
      await preview.close();
      fs.writeFileSync(path.join(process.env.EXECUTIVE_SCREENSHOT_DIR,'executive-history-sample.eml'),download.text);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS executive history browser: history-only cohort, coach ranking, topic pies, embedded email charts, normal keyword pills, mobile layout, read-only export');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
