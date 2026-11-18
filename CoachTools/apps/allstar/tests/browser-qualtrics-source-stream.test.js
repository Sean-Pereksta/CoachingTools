'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
  try{
    const page=await browser.newPage(),root=path.resolve(__dirname,'..'),file=path.join(root,'qualtrics/generator.html'),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root,'../../README.md')).href);
    await page.setContent('<main class="open"><iframe></iframe></main>');
    await page.addScriptTag({content:`
      const state={versions:{data:1}},els={qualtricsEmailModal:document.querySelector('main'),qualtricsEmailFrame:document.querySelector('iframe')};
      let scope='team:A',interrupt=false,completed=0,chunks=0;
      const allStarGlobalScopeKey=()=>scope;
      window.addEventListener('message',e=>{
        if(e.source!==els.qualtricsEmailFrame.contentWindow)return;
        if(e.data.type==='qualtrics-source-publish-check')handleQualtricsMessage(e);
        if(e.data.type==='qualtrics-key-files-complete')completed++;
        if(e.data.type==='qualtrics-key-files-progress'&&interrupt){state.versions.data++;interrupt=false;}
      });
    `});
    await page.addScriptTag({path:path.join(root,'js/qualtrics-bridge.js')});
    await page.evaluate(({html,base})=>{els.qualtricsEmailFrame.srcdoc=html.replace('<head>','<head><base href="'+base+'">');},{html:fs.readFileSync(file,'utf8'),base:pathToFileURL(file).href});
    const frame=page.frames()[1];
    await frame.waitForFunction(()=>typeof state!=='undefined'&&state.db&&els.status.textContent.startsWith('Ready.'));
    await frame.evaluate(()=>window.addEventListener('message',e=>{if(e.data?.type==='allstar-source-chunk')window.chunkCount=(window.chunkCount||0)+1;}));
    async function stream(name,count){
      await page.evaluate(async({name,count})=>{
        state.qualtricsCoreBuildToken=name;
        const rows=Array.from({length:count},(_,i)=>({'Agent Name':'Example '+i,'Interaction Start Time':'2026-11-17','Score %':'97%',Coach:'Coach A',Description:'Example row '.repeat(40)}));
        await streamQualtricsFiles('core',name,[{slot:'qa',fileName:name,sheetName:'Evals',headers:Object.keys(rows[0]),rows}],{organizations:[],lookupSources:[]});
      },{name,count});
    }
    await stream('first',800);await page.waitForFunction(()=>completed===1);
    assert.deepEqual(await frame.evaluate(()=>[state.masterFileNames.qa,state.qaRows.length,state.allStarScope,state.keySlotInfo.qa.origin]),['first',800,'team:A','Use Allstar data']);
    assert.ok(await frame.evaluate(()=>window.chunkCount>1));
    await page.evaluate(()=>{interrupt=true;});await stream('superseded',820);
    await frame.waitForFunction(()=>!state.incomingBridge.core);
    await frame.evaluate(()=>state.allStarCoreImportPromise);
    assert.deepEqual(await frame.evaluate(()=>[state.masterFileNames.qa,state.qaRows.length]),['first',800]);
    await page.evaluate(()=>{scope='team:B';});await stream('fresh',400);await page.waitForFunction(()=>completed===2);
    assert.deepEqual(await frame.evaluate(()=>[state.masterFileNames.qa,state.qaRows.length,state.allStarScope]),['fresh',400,'team:B']);
    assert.deepEqual(errors,[]);console.log('PASS offline frame bridge: bounded messages, ordered rows, scope/version publication check, rejected superseded data, renewed connection.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
