'use strict';
// Isolated experiment. Both formats store the same real normalized QA source
// and workbook records. Nothing here opens or upgrades a production database.
// Run with node apps/allstar/tests/browser-storage-prototype.test.js using the
// same PLAYWRIGHT_MODULE and CHROMIUM_PATH as the other browser suites.
// ALLSTAR_STORAGE_REPEATS defaults to 5. The two arms alternate order. Each
// save includes the same full read-back SHA-256 check before pointer publication.
// Fixture import, post-commit orphan collection, and fault injection are timed
// separately or excluded. Heap samples cover JS heap only, not browser-process
// RSS. Browser origin usage is an estimate including the initial QA import.
//
// Windows / Chrome 157.0.8103.52, 50k normalized rows plus two 50,001-row
// worksheet arrays: five whole-record saves took 1,334/1,764 ms p50/p95,
// versus 1,667/2,185 ms for 305 acknowledged parts of at most 256 KiB.
// The largest heartbeat gaps were 710 and 25 ms, respectively. Sampled
// peak JS heap p50/p95 was 282/289 vs 226/227 MiB. The elapsed-time cost
// and direct record access in old clients make this a candidate for further
// experiments, including larger byte budgets and worker-side verification.
// Any production migration needs a compatible reader/rollback route for the
// source record, selected sheet, package restore, and exports.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../../..'),origin='http://127.0.0.1:41586';

function installPrototype(){
  const dbName='test-only-qa-store',pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  const byteLimit=256*1024,rowLimit=512,encoder=new TextEncoder();
  let db,data,stage='idle';
  const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  async function open(){
    if(db)return db;
    const req=indexedDB.open(dbName,1);
    req.onupgradeneeded=()=>{
      const d=req.result;d.createObjectStore('head');d.createObjectStore('versions');
      d.createObjectStore('parts',{keyPath:['version','stream','sequence']}).createIndex('version','version');
      d.createObjectStore('whole',{keyPath:['version','stream']}).createIndex('version','version');
    };
    return db=await request(req);
  }
  async function tx(names,mode,body){
    const d=await open(),t=d.transaction(names,mode);
    const done=new Promise((ok,fail)=>{t.oncomplete=ok;t.onerror=t.onabort=()=>fail(t.error||new DOMException('Transaction aborted','AbortError'));});
    done.catch(()=>{});
    try{const result=await body(t);await done;return result;}catch(error){try{t.abort();}catch(_){}await done.catch(()=>{});throw error;}
  }
  const get=(store,key)=>tx([store],'readonly',t=>request(t.objectStore(store).get(key)));
  const put=(store,value,key)=>tx([store],'readwrite',t=>{t.objectStore(store).put(value,key);});
  function encode(value){
    // Type and order checks cover every field, including Excel dates, empty
    // cells, undefined properties and NaN in normalized scores and dates.
    return JSON.stringify(value,function(key,cell){
      if(this[key] instanceof Date)return {$fixtureDate:this[key].getTime()};
      if(cell===undefined)return {$fixtureUndefined:true};
      if(typeof cell==='number'&&!Number.isFinite(cell))return {$fixtureNumber:String(cell)};
      return cell;
    });
  }
  async function digest(serialized){
    const bytes=encoder.encode(serialized);
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    return {bytes:bytes.length,hash:Array.from(hash,v=>v.toString(16).padStart(2,'0')).join('')};
  }
  async function fixture(count){
    const csv=['Agent Name,Team,Score %,Interaction Start Time,Assigned Date',...Array.from({length:count},(_,i)=>'Agent '+i+',Coach '+i%44+',90%,2026-09-01,2026-09-02')].join('\n');
    if(!await loadQAFile(new File([csv],'QA-storage.csv',{type:'text/csv'})))throw Error('QA fixture import failed');
    const source=sourceCacheValue('qa',false),book=workbookMetadataRecord('qa'),streams={};
    const fields={...source};
    for(const key of Object.keys(fields))if(Array.isArray(fields[key])&&['rows','aoa'].includes(key)){streams['source.'+key]=fields[key];delete fields[key];}
    for(const name of book.sheetNames)streams['sheet.'+name]=getBookSheetAoa('qa',name);
    if(streams['source.rows']?.length!==count||!book.sheetNames.some(name=>streams['sheet.'+name].length===count+1))throw Error('Expected normalized rows and physical worksheet');
    data={fields,book,streams};return {normalized:count,sheets:book.sheetNames,streams:Object.fromEntries(Object.entries(streams).map(([k,v])=>[k,v.length]))};
  }
  async function* batches(rows){
    let sequence=0;
    for(let first=0;first<rows.length;){
      const start=performance.now(),encoded=[];let bytes=2;
      while(first+encoded.length<rows.length&&encoded.length<rowLimit){
        const line=encode(rows[first+encoded.length]),size=encoder.encode(line).length+(encoded.length?1:0);
        if(size+2>byteLimit)throw Error('Single row exceeds prototype byte budget');
        if(encoded.length&&(bytes+size>byteLimit||performance.now()-start>=12))break;
        encoded.push(line);bytes+=size;
      }
      const part={sequence:sequence++,start:first,count:encoded.length,...await digest('['+encoded.join(',')+']')};
      first+=part.count;yield part;
    }
  }
  function check(actual,expected,label){if(actual!==expected)throw Error(label+' integrity check failed');}
  async function verify(manifest){
    stage='verification';
    const stored=await get('versions',manifest.version);
    check((await digest(encode([stored.fields,stored.book]))).hash,manifest.headerHash,'Header');
    const wholeSource=manifest.format==='whole'?(await get('whole',[manifest.version,'source'])).value:null;
    if(wholeSource){
      const fields={...wholeSource};delete fields.rows;delete fields.aoa;
      check((await digest(encode([fields,stored.book]))).hash,manifest.headerHash,'Stored source header');
    }
    for(const [stream,parts] of Object.entries(manifest.parts)){
      const whole=wholeSource?(stream.startsWith('source.')?wholeSource[stream.slice(7)]:(await get('whole',[manifest.version,stream]))?.value.aoa):null;
      if(whole)check(whole.length,manifest.counts[stream],stream);
      let count=0;
      for(const part of parts){
        check(count,part.start,'Sequence');
        const rows=whole?whole.slice(part.start,part.start+part.count):(await get('parts',[manifest.version,stream,part.sequence]))?.rows;
        check(rows?.length,part.count,'Chunk length');
        const actual=await digest('['+rows.map(encode).join(',')+']');
        check(actual.hash,part.hash,'Content');check(actual.bytes,part.bytes,'Bytes');count+=rows.length;
      }
      check(count,manifest.counts[stream],stream);
    }
    return manifest;
  }
  async function publish(manifest,parent,fault){
    stage='pointer';
    return tx(['head','versions'],'readwrite',async t=>{
      const head=t.objectStore('head'),current=await request(head.get('qa'));
      if((current||null)!==parent)throw Error('Source version changed before publication');
      t.objectStore('versions').put({...manifest,status:'verified'},manifest.version);
      head.put(manifest.version,'qa');
      if(fault==='commit')t.abort();
    });
  }
  async function write(format,fault){
    return navigator.locks.request(dbName,{mode:'shared'},async()=>{
      const version=crypto.randomUUID(),parent=(await get('head','qa'))||null;
      const {fields,book,streams}=data;
      const m={version,format,fields,book,headerHash:(await digest(encode([fields,book]))).hash,parts:{},counts:{},status:'staging'};
      const start=performance.now();
      await put('versions',m,version);stage='preparation';
      if(format==='whole'){
        stage='whole write';
        await tx(['whole'],'readwrite',t=>{
          const store=t.objectStore('whole'),source={...fields};
          for(const [stream,rows] of Object.entries(streams)){
            if(stream.startsWith('source.'))source[stream.slice(7)]=rows;
            else store.put({version,stream,value:{aoa:rows}});
          }
          store.put({version,stream:'source',value:source});
        });
      }
      let total=0,maxBytes=0,partCount=0;
      for(const [stream,rows] of Object.entries(streams)){
        m.parts[stream]=[];m.counts[stream]=rows.length;
        for await(const part of batches(rows)){
          stage='staging';total+=part.bytes;maxBytes=Math.max(maxBytes,part.bytes);m.parts[stream].push(part);
          if(format==='chunk'){
            await tx(['parts'],'readwrite',t=>{
              t.objectStore('parts').put({version,stream,sequence:part.sequence,rows:rows.slice(part.start,part.start+part.count)});
              if(fault==='write'&&partCount===1)t.abort();
              if(fault==='quota'&&partCount===0){
                // Exceed any write space the browser reserved before DevTools
                // lowered this test origin's quota. Incompressible bytes keep
                // the physical write larger than the reserved budget.
                const padding=new Uint8Array(16*1024*1024);
                for(let i=0;i<padding.length;i+=65536)crypto.getRandomValues(padding.subarray(i,i+65536));
                t.objectStore('parts').put({version,stream:'quota-fixture',sequence:0,rows:padding});
              }
            });
          }
          partCount++;
          if(fault==='interrupt'&&partCount===2){
            window.interruptedVersion=version;
            // The test navigates away here. This writer and its shared lock
            // disappear before either verification or the head transaction.
            await new Promise(()=>{});
          }
        }
      }
      if(fault==='corrupt')await tx(['parts'],'readwrite',async t=>{
        const parts=t.objectStore('parts'),part=await request(parts.get([version,'source.rows',0]));
        part.rows[0]['Score %']='0%';parts.put(part);
      });
      const staged=performance.now();
      await verify(m);const verified=performance.now();
      await publish(m,parent,fault);
      return {version,partCount,bytes:total,maxBytes,stagingMs:Math.round(staged-start),verificationMs:Math.round(verified-staged),commitMs:Math.round(performance.now()-verified)};
    });
  }
  async function cleanup(){
    return navigator.locks.request(dbName,{mode:'exclusive'},async()=>{
      const current=await get('head','qa'),keys=await tx(['versions'],'readonly',t=>request(t.objectStore('versions').getAllKeys()));
      for(const version of keys)if(version!==current){
        await tx(['versions','whole','parts'],'readwrite',t=>{
          for(const name of ['whole','parts']){
            const store=t.objectStore(name),cursor=store.index('version').openKeyCursor(IDBKeyRange.only(version));
            cursor.onsuccess=()=>{if(cursor.result){store.delete(cursor.result.primaryKey);cursor.result.continue();}};
          }
          t.objectStore('versions').delete(version);
        });
      }
      return keys.filter(k=>k!==current).length;
    });
  }
  async function readPublished(){
    return navigator.locks.request(dbName,{mode:'shared'},async()=>{
      const version=await get('head','qa'),m=await get('versions',version);
      check(m.status,'verified','Manifest');await verify(m);return {version,counts:m.counts};
    });
  }
  async function timing(format){
    const gaps=[];let last=performance.now(),maxHeap=performance.memory?.usedJSHeapSize||0;
    const tick=()=>{const now=performance.now();gaps.push({ms:now-last,stage});last=now;maxHeap=Math.max(maxHeap,performance.memory?.usedJSHeapSize||0);};
    const timer=setInterval(tick,16),baseHeap=maxHeap,start=performance.now();
    try{
      const result=await write(format),elapsed=performance.now()-start;await pause();tick();
      const worst=gaps.reduce((a,b)=>a.ms>=b.ms?a:b);
      return {...result,ms:Math.round(elapsed),gapMs:Math.round(worst.ms),gapStage:worst.stage,peakHeapMiB:Math.round(maxHeap/1048576),heapDeltaMiB:Math.round((maxHeap-baseHeap)/1048576)};
    }finally{clearInterval(timer);stage='idle';}
  }
  window.storageExperiment={fixture,timing,write,cleanup,readPublished,head:()=>get('head','qa'),async orphanCount(){
    const version=await get('head','qa');
    return tx(['parts','whole','versions'],'readonly',async t=>{
      const requests=['parts','whole','versions'].map(name=>request(t.objectStore(name).getAllKeys()));
      const keys=await Promise.all(requests);return keys.flat().filter(key=>(Array.isArray(key)?key[0]:key)!==version).length;
    });
  }};
}

async function main(){
  const rows=Number(process.env.ALLSTAR_BENCHMARK_ROWS||50000),repeats=Number(process.env.ALLSTAR_STORAGE_REPEATS||5);
  const ctx=await chromium.launchPersistentContext('',{headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--enable-precise-memory-info']});
  const page=await ctx.newPage();
  try{
    // A loopback origin gives the test a real dedicated browser quota bucket.
    // Serve repository files through Playwright, without opening a listening port.
    await ctx.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
      const name=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      if(!name.startsWith(root+path.sep)||!fs.existsSync(name)||!fs.statSync(name).isFile())return route.fulfill({status:404,body:''});
      return route.fulfill({path:name});
    });
    page.on('dialog',d=>d.dismiss());page.setDefaultTimeout(120000);
    await page.goto(origin+'/apps/allstar/allstar.html');
    const setup=async()=>{await page.waitForFunction(()=>state.startup.completed);await page.evaluate(installPrototype);};
    await setup();const fixture=await page.evaluate(n=>storageExperiment.fixture(n),rows);
    const cdp=await ctx.newCDPSession(page),results={whole:[],chunk:[]};
    for(let i=0;i<repeats;i++)for(const format of i%2?['chunk','whole']:['whole','chunk']){
      await cdp.send('HeapProfiler.collectGarbage');
      const timing=await page.evaluate(f=>storageExperiment.timing(f),format);
      timing.storageMiBBeforeCleanup=Math.round((await cdp.send('Storage.getUsageAndQuota',{origin})).usage/1048576);
      const cleanupStart=performance.now();await page.evaluate(()=>storageExperiment.cleanup());
      timing.cleanupMs=Math.round(performance.now()-cleanupStart);results[format].push(timing);
    }
    const prior=await page.evaluate(()=>storageExperiment.head());
    const interrupted=page.evaluate(()=>storageExperiment.write('chunk','interrupt')).then(()=>false,()=>true);
    await page.waitForFunction(()=>window.interruptedVersion);
    await page.reload();assert.equal(await interrupted,true);await setup();
    const restored=await page.evaluate(()=>storageExperiment.readPublished());
    assert.equal(restored.version,prior);assert.deepEqual(restored.counts,fixture.streams);
    await page.evaluate(n=>storageExperiment.fixture(n),rows);
    for(const fault of ['write','corrupt','commit']){
      await assert.rejects(()=>page.evaluate(f=>storageExperiment.write('chunk',f),fault),fault==='corrupt'?/integrity check failed/:/abort/i);
      assert.equal(await page.evaluate(()=>storageExperiment.head()),prior);
    }
    await cdp.send('Storage.overrideQuotaForOrigin',{origin,quotaSize:1});
    // IndexedDB caches quota grants briefly. A DevTools override affects the
    // next grant, after that cached grant expires.
    await new Promise(resolve=>setTimeout(resolve,35000));
    try{
      await assert.rejects(()=>page.evaluate(()=>storageExperiment.write('chunk','quota')),/quota/i);
      assert.equal(await page.evaluate(()=>storageExperiment.head()),prior);
    }finally{await cdp.send('Storage.overrideQuotaForOrigin',{origin});}
    assert.ok(await page.evaluate(()=>storageExperiment.cleanup())>=4);
    assert.equal(await page.evaluate(()=>storageExperiment.orphanCount()),0);
    assert.equal((await page.evaluate(()=>storageExperiment.readPublished())).version,prior);
    const percentiles=(list,key)=>{const values=list.map(x=>x[key]).sort((a,b)=>a-b);return {p50:values[Math.ceil(values.length*.50)-1],p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)};};
    const summary=Object.fromEntries(Object.entries(results).map(([name,list])=>[name,Object.fromEntries(['ms','gapMs','stagingMs','verificationMs','commitMs','peakHeapMiB','heapDeltaMiB','storageMiBBeforeCleanup','cleanupMs'].map(k=>[k,percentiles(list,k)]))]));
    console.log(JSON.stringify({chrome:(await cdp.send('Browser.getVersion')).product,rows,repeats,fixture,summary,results},null,2));
    console.log('PASS staged publication, read-back checks, interruption and reload, aborted write and pointer commit, corrupt chunk, native quota exhaustion and orphan cleanup');
  }finally{await ctx.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
