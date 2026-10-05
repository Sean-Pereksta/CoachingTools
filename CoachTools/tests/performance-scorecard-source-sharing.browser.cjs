'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const F=require('./fixtures/performance-scorecard-source-exports.js');
const C=require('../shared/weekly-data-builder-core.js');
const XLSX=require('../vendor/xlsx.full.min.js');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,b)=>{if(e)res.writeHead(404).end();else{res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(b);}});});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try {
 const packed=process.env.CHROMIUM_MODULE ? (await import(process.env.CHROMIUM_MODULE)).default : null;
 browser=await chromium.launch({headless:true,executablePath:packed ? await packed.executablePath() : process.env.CHROMIUM_PATH || undefined,args:packed ? packed.args : ['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.setDefaultTimeout(15000); page.on('pageerror',e=>errors.push(e.message));
 page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text());});
 const base=`http://127.0.0.1:${server.address().port}`;
 await page.goto(base+'/apps/performance-scorecard-enhanced.html');
 await page.waitForSelector('#psUploadModeBtn');await page.click('#psUploadModeBtn');
 const excel=rows=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Original Source');return Buffer.from(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));};
 await page.setInputFiles('#psSourceFile-appointments',{name:'rep-opportunities.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:excel(F.opportunities())});
 await page.waitForFunction(()=>document.querySelector('#psSourceStatus-appointments')?.textContent.includes('source period') || document.querySelector('#psUploadError')?.textContent);
 await page.waitForFunction(()=>document.querySelector('#psUploadTableBody')?.textContent.includes('Alex Reed'));
 assert.equal(await page.locator('#psUploadTableBody tr').count(),1);
 await page.setInputFiles('#psSourceFile-wipers',{name:'rep-wipers.txt',mimeType:'text/plain',buffer:Buffer.from('\ufeff'+C.csv(F.wipers()),'utf16le')});
 await page.waitForFunction(()=>document.querySelector('#psUploadNotice')?.textContent.includes('1 matched'));
 assert.match(await page.locator('#psUploadTableBody').innerText(),/37\.5%/);
 assert.match(await page.locator('#psUploadTableBody').innerText(),/60\.0%/);
 await page.setInputFiles('#psSourceFile-wipers',{name:'multiple-periods.csv',mimeType:'text/csv',buffer:Buffer.from(C.csv(F.wipers([['9/20/2026','Coach A','Alex Reed',1,2],['9/27/2026','Coach A','Alex Reed',3,8]])))});
 await page.waitForSelector('#psSourcePeriodLabel-wipers:not([hidden])');
 assert.ok(await page.locator('#psUploadResults').evaluate(n=>n.classList.contains('hide')));
 await page.selectOption('#psSourcePeriod-wipers','9/27/2026');
 await page.waitForFunction(()=>document.querySelector('#psUploadTableBody')?.textContent.includes('37.5%'));
 assert.match(await page.locator('#psUploadMeta').innerText(),/9\/27\/2026/);
 // Observe the actual capture DOM and still use the real vendored canvas renderer.
 await page.addScriptTag({url:base+'/vendor/html2canvas.min.js'});
 await page.evaluate(()=>{
  const render=window.html2canvas;window.captures=[];
  window.html2canvas=async(node,options)=>{
   const overlaps=[],edgeViolations=[];
   for(const cell of node.querySelectorAll('td,th')){
    const box=cell.getBoundingClientRect(),texts=[],walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
     const text=walker.currentNode.textContent;if(!text.trim())continue;
     const range=document.createRange();range.selectNodeContents(walker.currentNode);
     for(const rect of range.getClientRects()){
      if(Math.min(rect.left-box.left,box.right-rect.right,rect.top-box.top,box.bottom-rect.bottom)<4) edgeViolations.push(text);
      for(const other of texts) if(Math.min(rect.right,other.rect.right)-Math.max(rect.left,other.rect.left)>.5&&Math.min(rect.bottom,other.rect.bottom)-Math.max(rect.top,other.rect.top)>.5) overlaps.push([text,other.text]);
      texts.push({text,rect});
     }
    }
   }
   window.captures.push({rows:node.querySelectorAll('tbody tr').length,columns:node.querySelectorAll('thead th').length,text:node.innerText,controls:node.querySelectorAll('button,input,select').length,fonts:[...node.querySelectorAll('td *')].map(n=>parseFloat(getComputedStyle(n).fontSize)),backgrounds:[...node.querySelectorAll('td')].map(n=>getComputedStyle(n).backgroundColor),overlaps,edgeViolations});
   return render(node,options);
  };
 });
 await page.click('#psUploadExportMenu');await page.waitForSelector('.scorecardShareDialog img[src]');
 assert.equal(await page.evaluate(()=>captures.at(-1).rows),1);
 assert.equal(await page.evaluate(()=>captures.at(-1).controls),0);
 assert.deepEqual(await page.evaluate(()=>captures.at(-1).overlaps),[],'worksheet export text does not overlap');
 assert.deepEqual(await page.evaluate(()=>captures.at(-1).edgeViolations),[],'worksheet values stay clear of dividers');
 await page.evaluate(()=>document.querySelector('.scorecardShareDialog').close());
 await page.click('#psUploadClose');
 // Dense advanced metrics, normal metrics, badges, long names and signed values.
 await page.evaluate(()=>{
 document.body.dataset.scorecardDensity='condensed';
 const table=document.querySelector('#scorecardWorkspace table');
 table.tHead.innerHTML='<tr><th>Representative</th>'+Array.from({length:7},(_,i)=>`<th style="${i===6?'display:none':''}">Metric ${i+1} long heading</th>`).join('')+'</tr>';
 table.tBodies[0].innerHTML=Array.from({length:23},(_,r)=>'<tr><td><button>'+`Representative ${22-r} Alexandra Long Name`+'</button></td>'+Array.from({length:7},(_,i)=>`<td style="background:${i%2?'rgb(255,220,220)':'rgb(210,250,220)'};color:#172033;${i===6?'display:none':''}">${i%2?`<div class="metricMain">${r+i}.0%</div><div class="metricMeta"><span>Goal 85.0%</span><span>·</span><span>+15.0 pp</span></div>`:`<div class="metricInline metricInlineAdvanced"><b>${i===0?'-12.5%':'100.0%'}</b><span>| 1,247 / 1,520</span><span>| <span>Goal 85.0%</span></span><span>| +15.0 pp</span><span>| P100 · #1/125</span><span class="zeroMonitorBadge">! 0 monitors ×3</span></div>`}</td>`).join('')+'</tr>').join('');
 document.getElementById('workspaceMeta').textContent='23 selected representatives · 9/27/2026';
 window.captures=[];
 });
 await page.click('#scorecardExportMenu');await page.waitForSelector('.scorecardShareDialog img[src]');
 const capture=await page.evaluate(()=>captures[0]);assert.equal(capture.rows,23);assert.equal(capture.columns,7);assert.equal(capture.controls,0);
 assert.ok(capture.text.includes('Representative 0 Alexandra Long Name'));assert.ok(capture.text.indexOf('Representative 22')<capture.text.indexOf('Representative 0'));
 assert.ok(capture.text.includes('-12.5%'));assert.ok(capture.text.includes('9/27/2026'));assert.ok(capture.fonts.every(f=>f>=12));
 assert.ok(capture.backgrounds.includes('rgb(255, 220, 220)'));assert.ok(capture.backgrounds.includes('rgb(210, 250, 220)'));
 assert.equal(await page.evaluate(()=>captures.length),1);
 assert.deepEqual(capture.overlaps,[],'percentages, goals and compact details never overlap');
 assert.deepEqual(capture.edgeViolations,[],'text stays at least 4px inside divider boundaries');
 const data=await page.evaluate(async()=>Array.from(new Uint8Array(await(await fetch(document.querySelector('.scorecardShareDialog img').src)).arrayBuffer())));
 assert.deepEqual(data.slice(0,8),[137,80,78,71,13,10,26,10]);
 const image=await page.locator('.scorecardShareDialog img').evaluate(n=>({width:n.naturalWidth,height:n.naturalHeight}));assert.ok(image.width>1000 && image.height>500);
 await page.click('[data-share=size]');assert.equal(await page.locator('[data-share=size]').getAttribute('aria-pressed'),'true');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));await page.click('[data-share=copy]');
 assert.match(await page.locator('.scorecardShareDialog [role=status]').innerText(),/unavailable/);assert.doesNotMatch(await page.locator('.scorecardShareDialog [role=status]').innerText(),/Image copied/);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async(items)=>{const blob=await items[0].getType('image/png');window.copied=Array.from(new Uint8Array(await blob.arrayBuffer()));}}}));
 await page.click('[data-share=copy]');await page.waitForFunction(()=>document.querySelector('.scorecardShareDialog [role=status]').textContent.includes('Image copied'));
 assert.deepEqual(await page.evaluate(()=>copied),data);
 const downloadPromise=page.waitForEvent('download');await page.click('[data-share=png]');const download=await downloadPromise;const saved=await download.path();assert.deepEqual([...fs.readFileSync(saved)],data);
 assert.equal(await page.evaluate(()=>captures.length),1,'copy and save reuse the exact same image');
 const pdfDownloadPromise=page.waitForEvent('download');await page.click('[data-share=pdf]');const pdfDownload=await pdfDownloadPromise,pdfBytes=fs.readFileSync(await pdfDownload.path());
 assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');
 assert.equal((pdfBytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,6,'PDF includes all row and column sections');
 const pdfCaptures=await page.evaluate(()=>captures.slice(1));assert.equal(pdfCaptures.length,6);
 for(const part of pdfCaptures){assert.deepEqual(part.overlaps,[],'PDF text never overlaps');assert.deepEqual(part.edgeViolations,[],'PDF dividers stay outside text');assert.ok(part.rows<=10);}
 // Export layout is independent of the screen's theme and zoom setting.
 await page.evaluate(()=>{document.querySelector('.scorecardShareDialog').close();document.body.dataset.theme='frost-glass';document.querySelector('.main').style.zoom='1.25';window.captures=[];});
 await page.click('#scorecardExportMenu');await page.waitForSelector('.scorecardShareDialog img[src]');
 assert.deepEqual(await page.evaluate(()=>captures[0].overlaps),[]);assert.deepEqual(await page.evaluate(()=>captures[0].edgeViolations),[]);
 assert.match(await page.evaluate(()=>captures[0].text),/100\.0%/);
 await page.evaluate(()=>document.querySelector('.scorecardShareDialog').close());
 await page.click('#psUploadModeBtn');
 const details=[['Manager One','Coach A','Alex Reed','Week',2,1,'50%',10,6,'60%',20,19,'95%'],['Manager One','Coach B','Blake Doe','Week',2,1,'50%',10,7,'70%',20,19,'95%']];
 await page.setInputFiles('#psSourceFile-appointments',{name:'two-coaches.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:excel(F.opportunities(details))});
 await page.waitForFunction(()=>document.querySelector('#psUploadCoach').textContent.includes('Coach B'));
 await page.selectOption('#psUploadCoach','coach b');
 assert.equal(await page.locator('#psUploadTableBody tr').count(),1);assert.match(await page.locator('#psUploadTableBody').innerText(),/Blake Doe/);
 await page.selectOption('#psUploadCoach','__ALL__');
 await page.fill('#psUploadSearch','Alex');assert.equal(await page.locator('#psUploadTableBody tr').count(),1);assert.match(await page.locator('#psUploadTableBody').innerText(),/Alex Reed/);
 await page.fill('#psUploadSearch','');await page.click('[data-ps-sort=consumer]');assert.match(await page.locator('#psUploadTableBody tr').first().innerText(),/Blake Doe/);
 await page.setInputFiles('#psUploadFile',{name:'legacy-workbook.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:excel([['Agent Name','Team','Date','Cash Opps','Cash Apps'],['Legacy Person','Legacy Coach','9/27/2026',10,5]])});
 await page.waitForFunction(()=>document.querySelector('#psUploadMeta').textContent.includes('legacy-workbook.xlsx'));
 assert.match(await page.locator('#psUploadTableBody').innerText(),/Legacy Person/);assert.match(await page.locator('#psUploadTableBody').innerText(),/50.0%/);
 // Verify builder still parses delimited uploads in its worker after core extraction.
 await page.goto(base+'/apps/weekly-data-builder.html');
 await page.setInputFiles('#file-appointments',{name:'opportunities.csv',mimeType:'text/csv',buffer:Buffer.from(C.csv(F.opportunities()))});
 await page.waitForFunction(()=>document.querySelector('#status-appointments').textContent.includes('Header row'));
 assert.deepEqual(errors,[]);
 console.log('PASS browser: source XLSX/UTF-16, full PNG, signed values/colors, Copy/PNG parity, readable six-page PDF, compact/normal metrics clear of dividers in dark/light themes and zoom, shared builder worker');
 } finally {await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
