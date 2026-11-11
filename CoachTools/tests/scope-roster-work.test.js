'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const idb=require('fake-indexeddb');

test('large roster discovery yields, keeps membership exact, and reuses its completed view',async()=>{
  const values=new Map();let ticks=0,yields=0;
  const context=vm.createContext({...idb,indexedDB:new idb.IDBFactory(),console,queueMicrotask,structuredClone,TextEncoder,TextDecoder,
    performance:{now:()=>++ticks},setTimeout:(callback,delay)=>{yields++;return setTimeout(callback,delay);},clearTimeout,
    localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)},
    addEventListener(){},removeEventListener(){},dispatchEvent(){},CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;}});
  context.window=context;context.parent=context;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../shared/coachtools-storage.js'),'utf8'),context);
  const data=context.CoachToolsData;await data.ready();
  const rows=[['Date','Sheet','Name','Wipers Accepted','Wipers Offered']];
  for(let i=0;i<12000;i++)rows.push(['2026-10-07',i%2?'Coach B':'Coach A','Agent '+i,5,10]);
  await data.importDataset('weeklyRetail',{workbook:{sheets:['Weekly'],data:{Weekly:{aoa:rows}}}},{detectedPeriod:{periodKey:'2026-10-07',sortKey:'2026-10-07'}});
  // Identity ownership remains authoritative even if an older stats row names
  // this selected coach. The deliberate conflict must remain excluded.
  context.CoachToolsIdentity={getIdentityVersion:()=>1,resolveName:async()=>null,getRepresentatives:async()=>[{personId:'moved',displayName:'Agent 0',role:'representative',currentCoachId:'coach-b'}]};
  const scope={mode:'team',label:'Selected coaches',coaches:['Coach A'],coachPersonIds:['coach-a']};
  yields=0;const resolved=await data.resolveReadScope(scope,'qa');
  assert.ok(yields>0,'long membership work must let pending browser work run');
  assert.equal(resolved.rosterKeys.size,5999);
  assert.equal(resolved.rosterKeys.has('agent 0'),false,'current identity ownership excludes stale stats membership');
  assert.equal(resolved.rosterKeys.has('agent 2'),true);
  assert.equal(resolved.rosterKeys.has('agent 3'),false);
  const afterFirst=yields;
  const cached=await data.resolveReadScope(scope,'qa');
  assert.equal(yields,afterFirst,'unchanged membership does not rescan and yield again');
  assert.deepEqual([...cached.rosterKeys],[...resolved.rosterKeys]);
  assert.equal((await data.getCurrent('weeklyRetail')).workbook.data.Weekly.aoa.length,12001,'view preparation never edits source rows');
});
