'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const idb = require('fake-indexeddb');

function browser(db, values) {
  const listeners = new Map();
  const ctx = vm.createContext({...idb, indexedDB:db, console, setTimeout, clearTimeout, queueMicrotask, structuredClone,
    localStorage:{getItem:k=>values.get(k) ?? null, setItem:(k,v)=>values.set(k,String(v)), removeItem:k=>values.delete(k)},
    requestIdleCallback(){}, // Drive identity learning explicitly.
    addEventListener(type, fn){ if (!listeners.has(type)) listeners.set(type,new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn){ listeners.get(type)?.delete(fn); },
    dispatchEvent(event){ for(const fn of listeners.get(event.type) || []) fn(event); },
    CustomEvent:function(type, init){ this.type=type; this.detail=init?.detail; }
  });
  ctx.window=ctx; ctx.parent=ctx;
  for(const script of ['coachtools-storage','coachtools-identity','coachtools-app-data']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../shared',script+'.js'),'utf8'),ctx,{filename:script+'.js'});
  }
  return ctx;
}
const book = rows => ({workbook:{sheets:['Data'],data:{Data:{aoa:rows}}}});
const scope = coach => ({mode:'coach',label:coach,coaches:[coach]});
const req = request => new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});

test('100 coaches: indexed cold read, legacy backfill, multi-coach union, source replacement and warm return',async()=>{
  const db = new idb.IDBFactory(), prefs = new Map(), seed=browser(db,prefs);
  await seed.CoachToolsData.ready();
  const weekly=[['Sheet','Name','Date']], qa=[['Report title'],['Agent Name','Score']];
  for(let i=0;i<100;i++) {
    const coach=i===42?'Raymond':'Coach '+i;
    for(let j=0;j<200;j++) {
      const person='Rep '+i+' '+(j%8);
      weekly.push([coach,person,'2026-10-01']);qa.push([person,j]);
    }
  }
  await seed.CoachToolsData.importDataset('weeklyRetail',book(weekly),{fingerprint:'weekly'});
  await seed.CoachToolsData.importDataset('qa',book(qa),{fingerprint:'qa'});
  const current=browser(db,prefs), data=current.CoachToolsData, app=current.CoachToolsAppData, store=current.CoachToolsStorage;
  await data.ready();
  const raymond=scope('Raymond');
  store.setScope(raymond);
  const seen=[], original=idb.IDBObjectStore.prototype.get;
  idb.IDBObjectStore.prototype.get=function(key){
    if(this.name==='coachtoolsDatasetChunks') seen.push(key);
    return original.call(this,key);
  };
  try {
    const firstScope=store.getScope();
    const first=await app.get('qa');
    assert.deepEqual(JSON.parse(JSON.stringify(first.workbook.data.Data.aoa)),[qa[1],...qa.slice(8402,8602)]);
    const chunks=seen.filter(k=>typeof k==='string' && /:\d{6}$/.test(k));
    assert.equal(chunks.length,1,'one of eleven payload chunks contains the selected rows');
    assert.ok(chunks[0].startsWith('qa:'),'weekly roster discovery reads index entries only');
    const stop=app.subscribe(['qa'],()=>{});
    store.setScope({mode:'team',label:'Selected coaches',coaches:['Raymond','Coach 7']});
    assert.equal((await app.get('qa')).meta.matchedRowCount,400);
    const before=seen.length;
    store.setScope(raymond);
    assert.equal(await app.get('qa'),first);
    assert.equal(seen.length,before,'returning to a cached coach does no index or payload reads');
    const raw=await data.getCurrent('qa');
    assert.deepEqual(JSON.parse(JSON.stringify(first)),JSON.parse(JSON.stringify(await data.filterDataset(raw,'qa',firstScope))));
    assert.equal(raw.workbook.data.Data.aoa.length,20002);
    await data.replaceDataset('qa',book([qa[1],['Rep 42 0',999]]),{fingerprint:'new',forceSourceReplacement:true});
    assert.equal((await app.get('qa')).workbook.data.Data.aoa[1][1],999);
    stop();
    // Simulate an earlier ZIP by removing only the derived records. The
    // canonical stored source still has precisely the earlier wire format.
    const qaId=data.getDatasetVersion('qa').datasetId;
    const idbDb=await req(db.open(data.DB_NAME));
    const tx=idbDb.transaction('coachtoolsDatasetChunks','readwrite');
    const cursor=tx.objectStore('coachtoolsDatasetChunks').index('datasetId').openCursor('scope-index:'+qaId);
    cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue();}};
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject;});
    const upgraded=browser(db,prefs);
    const rebuilt=await upgraded.CoachToolsAppData.get('qa');
    assert.equal(rebuilt.meta.matchedRowCount,1);
    assert.ok(await req(idbDb.transaction('coachtoolsDatasetChunks').objectStore('coachtoolsDatasetChunks').get('scope-index-v1:identity:'+qaId)));
    idbDb.close();
  } finally {idb.IDBObjectStore.prototype.get=original;}
});

test('coach transfers invalidate both owners and retain an unrelated prepared view; descriptive evidence reuses it',async()=>{
  const ctx=browser(new idb.IDBFactory(),new Map()), identity=ctx.CoachToolsIdentity, app=ctx.CoachToolsAppData, data=ctx.CoachToolsData;
  await identity.ready();
  const coaches=[];
  for(const name of ['Coach Raymond','Coach Beta','Coach Gamma']) coaches.push(await identity.learn(name,{role:'coach',source:'fixture'}));
  const scopes=coaches.map(p=>({...scope(p.displayName),personId:p.personId}));
  const agent=await identity.learn('Agent One',{role:'representative',currentCoachId:coaches[1].personId,source:'fixture'});
  await data.importDataset('qa',book([['Agent Name','Score'],['Agent One',90]]),{});
  const views=[];
  for(const sc of scopes){ctx.CoachToolsStorage.setScope(sc);views.push(await app.get('qa'));}
  ctx.CoachToolsStorage.setScope(scopes[0]);
  const events=[];const stop=app.subscribe(['qa'],e=>events.push(e));
  await identity.updatePerson(agent.personId,{currentCoachId:coaches[2].personId});
  assert.equal(await app.get('qa'),views[0]);
  assert.equal(events.length,0,'a move between other coaches does not refresh Raymond');
  await identity.learn('Coach Raymond',{role:'coach',source:'another-workbook'});
  assert.equal(await app.get('qa'),views[0],'new provenance for the same spelling keeps membership');
  for(const [index,expected] of [[1,0],[2,1]]) {
    ctx.CoachToolsStorage.setScope(scopes[index]);
    assert.equal((await app.get('qa')).meta.matchedRowCount,expected);
  }
  stop();
});

