'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const file=(name,csv)=>({name,mimeType:'text/csv',buffer:Buffer.from(csv)});
const qa=file('QA.csv','Agent Name,Team,Score %,Assigned Date\nAda Example,Coach East,98%,2026-05-20');
const invalid=file('unmapped.csv','Heading,Other\none,two');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
  try{
    for(const entry of ['allstar.html','dist/All-Star-Portable.html']){
      const page=await browser.newPage({viewport:{width:680,height:860}}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(pathToFileURL(path.join(root,entry)).href);
      await page.waitForFunction(()=>state.startup?.completed);
      await page.locator('[data-as-section="Data"]').click();
      await page.locator('#dataLayoutToggle').focus();
      await page.keyboard.press('Space');
      assert.equal(await page.locator('#importModal .modalBody > section').first().getAttribute('class'),'panel importSection updateDataSection');
      await page.locator('#coachtoolsFiles').setInputFiles([qa,invalid]);
      const review=page.locator('#coachtoolsImportReview');
      await page.waitForFunction(()=>document.querySelectorAll('#coachtoolsImportReview tbody[data-batch-row]').length===2);
      assert.match(await review.innerText(),/Needs review/);
      await page.locator('#coachtoolsImportAllBtn').click();
      await page.waitForFunction(()=>!state.coachToolsBatchImportRunning&&state.data.qa.rows.length===1);
      assert.match(await review.innerText(),/Complete/);
      await review.getByRole('button',{name:'unmapped.csv'}).click();
      await review.locator('[data-batch-replace]:visible').setInputFiles(qa);
      await page.waitForFunction(()=>document.getElementById('coachtoolsImportReview').textContent.includes('Duplicate'));
      assert.equal(await page.locator('#coachtoolsImportAllBtn').isDisabled(),true);
      assert.deepEqual(await page.evaluate(()=>[state.data.qa.rows[0]._rep,state.sourceMeta.qa.rowCount]),['Ada Example',1]);
      await page.reload();await page.waitForFunction(()=>state.startup?.completed);
      assert.equal(await page.evaluate(()=>state.data.qa.rows.length),1);
      assert.deepEqual(errors,[]);
      await page.close();
      console.log('PASS '+entry+' keyboard batch intake, mixed review, single commit, replacement, duplicate and reload');
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
