'use strict';
// Synthetic fixtures in a fresh browser context; never reads the user's imports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };
const host = '<!doctype html><html><body><script src="/shared/coachtools-storage.js"></script><script src="/shared/coachtools-identity.js"></script><script src="/shared/coachtools-app-data.js"></script></body></html>';
const server = http.createServer((request, response) => {
  const url = request.url.split('?')[0];
  if (url === '/__scope-host.html') { response.setHeader('Content-Type','text/html'); response.end(host); return; }
  const file = path.resolve(root, '.' + decodeURIComponent(url));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, content) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(content);
  });
});
const chosen = ['Coach Alpha', 'Coach Beta', 'Coach Gamma'];
async function setup(page, base, race) {
  await page.goto(base + '/__scope-host.html');
  await page.evaluate(async ({ chosen, race }) => {
    await CoachToolsData.ready();
    await CoachToolsIdentity.ready();
    const allCoaches = [...chosen, 'Coach Other'];
    const people = [];
    for (const name of allCoaches) {
      const coach = await CoachToolsIdentity.learn(name, { role:'coach', source:'browser-scope-fixture' });
      await CoachToolsIdentity.learn(name + ' Representative', { role:'representative', currentCoachId:coach.personId, source:'browser-scope-fixture' });
      people.push(coach);
    }
    const aoa = [['Date','Sheet','Name','Consumer Appointments','Consumer Opportunities','Wiper Count','Wiper Jobs']];
    for (const name of allCoaches) aoa.push(['10/4/2026', name, name + ' Representative', 5, 10, 3, 10]);
    await CoachToolsData.importDataset('weeklyRetail', {
      meta:{fileName:'Retail Weekly.csv'}, workbook:{sheets:['Weekly'],data:{Weekly:{aoa}}}
    }, { originalFileName:'Retail Weekly.csv', scopeSnapshot:{mode:'all'}, detectedPeriod:{periodKey:'2026-10-04',sortKey:'2026-10-04'} });
    CoachToolsStorage.setScope({ mode:'team', label:'3 selected coaches', coaches:chosen, coachPersonIds:people.slice(0,3).map(person=>person.personId) });
    window.fixtureScope = CoachToolsStorage.getScope();
    // Identity hydration/enrichment can finish while a scoped dataset is read.
    // Make that timing deterministic by doing a real identity write at the
    // resolver's asynchronous boundary, without changing data or selected people.
    if (race) {
      const original = CoachToolsIdentity;
      let first = true;
      window.CoachToolsIdentity = Object.freeze({ ...original, async resolveName(...args) {
        if (first) {
          first = false;
          await original.learn('Background Registry Observer', { role:'coach', source:'background-enrichment-fixture' });
          window.fixtureEnriched = true;
        }
        return original.resolveName(...args);
      }});
    }
    const iframe = document.createElement('iframe');
    iframe.dataset.appId = 'coaching-gaps';
    iframe.src = '/apps/coaching-gaps.html';
    document.body.appendChild(iframe);
  }, { chosen, race });
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForFunction(() => document.getElementById('dockHint')?.textContent.startsWith('Loaded')
    && (typeof coachingGapsReady === 'undefined' || coachingGapsReady)
    && (typeof sharedReloadJob === 'undefined' || !sharedReloadJob), {}, {timeout:30000});
  return frame;
}
async function teams(frame) { return frame.locator('#teamSel option').evaluateAll(options => options.map(option=>option.value)); }
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const race of [false,true]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror',error=>errors.push(error.message));
        const frame = await setup(page,base,race);
        assert.deepEqual(await teams(frame),chosen,`Three selected teams must load${race?' when identity enrichment finishes during the read':''}.`);
        if (race) assert.equal(await page.evaluate(()=>fixtureEnriched),true);
        assert.equal(await frame.evaluate(()=>allRows.length),3);
        assert.equal(await page.evaluate(async()=> (await CoachToolsData.getCurrent('weeklyRetail')).workbook.data.Weekly.aoa.length),5,'Scoped views preserve every backing source row.');
        // A completed identity update must refresh an already open tool, even
        // though neither its source fingerprint nor the selected scope changed.
        await page.evaluate(async()=>{
          const coaches = await CoachToolsIdentity.getCoaches();
          const beta = coaches.find(person=>person.displayName==='Coach Beta');
          const other = coaches.find(person=>person.displayName==='Coach Other');
          const representative = (await CoachToolsIdentity.getRepresentatives()).find(person=>person.displayName==='Coach Beta Representative');
          window.fixtureBetaId = beta.personId;
          window.fixtureBetaRepId = representative.personId;
          await CoachToolsIdentity.updatePerson(representative.personId, {currentCoachId:other.personId});
        });
        await frame.waitForFunction(()=>document.querySelectorAll('#teamSel option').length===2);
        assert.deepEqual(await teams(frame),['Coach Alpha','Coach Gamma']);
        await page.evaluate(async()=>CoachToolsIdentity.updatePerson(fixtureBetaRepId, {currentCoachId:fixtureBetaId}));
        await frame.waitForFunction(()=>document.querySelectorAll('#teamSel option').length===3);
        assert.deepEqual(await teams(frame),chosen);
        await page.evaluate(()=>CoachToolsStorage.setScope({mode:'coach',label:'Coach Beta',coaches:['Coach Beta']}));
        await frame.waitForFunction(()=>document.querySelectorAll('#teamSel option').length===1 && document.querySelector('#teamSel option')?.value==='Coach Beta');
        assert.equal(await frame.evaluate(()=>allRows.length),1);
        await page.evaluate(()=>CoachToolsStorage.setScope({mode:'all',label:'All people'}));
        await frame.waitForFunction(()=>document.querySelectorAll('#teamSel option').length===4);
        assert.equal(await frame.evaluate(()=>allRows.length),4);
        await page.evaluate(()=>CoachToolsStorage.setScope(fixtureScope));
        await frame.waitForFunction(()=>document.querySelectorAll('#teamSel option').length===3);
        assert.deepEqual(await teams(frame),chosen);
        await page.evaluate(()=>{
          CoachToolsStorage.setScope({mode:'coach',label:'Coach Gamma',coaches:['Coach Gamma']});
          CoachToolsStorage.setScope({mode:'all',label:'All people'});
        });
        await frame.waitForFunction(()=>document.querySelectorAll('#teamSel option').length===4);
        assert.equal(await frame.evaluate(()=>allRows.length),4,'A rapid scope switch publishes the final selection.');
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({scenario:race?'identity changes during scoped load':'stable selected scope',teams:chosen,scopeChanges:'3 coaches → identity update → restored membership → Coach Beta → all → 3 coaches → rapid Gamma/all',rows:4}));
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
