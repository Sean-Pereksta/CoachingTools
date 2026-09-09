'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const idb=require('fake-indexeddb');
const values=new Map();
const context=vm.createContext({...idb,console,setTimeout,clearTimeout,queueMicrotask,structuredClone,
 localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),get length(){return values.size},key:index=>[...values.keys()][index]},
 addEventListener(){},removeEventListener(){},dispatchEvent(){},CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;}});
context.window=context;context.parent=context;
vm.runInContext(fs.readFileSync(path.join(__dirname,'../shared/coachtools-storage.js'),'utf8'),context);
(async()=>{
 const result=await vm.runInContext(`(async()=>{
   const api=window.CoachToolsData;await api.ready();
   const data={meta:{totalRows:12001},workbook:{sheets:['Data'],data:{Data:{aoa:Array.from({length:12001},(_,i)=>['Coach A',\`Rep \${i}\`,90])}}}};
   const metadata={originalFileName:'QA.xlsx',scopeHash:'all',scopeMode:'all',scopedRowCount:12000,scopedFingerprint:'same-data',detectedPeriod:{periodKey:'2026-09-01',sortKey:'2026-09-01'}};
   const first=await api.importDataset('qa',data,metadata);
   const duplicate=await api.importDataset('qa',data,metadata);
   const open=()=>new Promise((resolve,reject)=>{const request=indexedDB.open(api.DB_NAME);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const db=await open();
   await new Promise((resolve,reject)=>{const tx=db.transaction('coachtoolsDatasetChunks','readwrite'),store=tx.objectStore('coachtoolsDatasetChunks');const req=store.index('datasetId').openCursor(IDBKeyRange.only(first.dataset.id));req.onsuccess=()=>{const cursor=req.result;if(cursor)cursor.delete();};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
   const inspection=await api.inspectDataset('qa',data,{...metadata,automaticImport:true});
   const repaired=await api.importDataset('qa',data,metadata);
   const afterRepair=await api.importDataset('qa',data,metadata);
   const txOriginal=IDBDatabase.prototype.transaction;
   IDBDatabase.prototype.transaction=function(stores,mode,...rest){const tx=txOriginal.call(this,stores,mode,...rest);if(mode==='readwrite')queueMicrotask(()=>tx.abort());return tx;};
   let failed=false;
   try{await api.importDataset('qa',data,{...metadata,scopedFingerprint:'replacement-will-abort'});}catch(_){failed=true;}finally{IDBDatabase.prototype.transaction=txOriginal;}
   const current=await api.getCurrent('qa', {includeRecord:true});
   const oldWeekly=await api.importDataset('weeklyRetail',data,{...metadata,detectedPeriod:{periodKey:'2026-09-09',sortKey:'2026-09-09'}});
   const weeklyInspection=await api.inspectDataset('weeklyRetail',data,{...metadata,detectedPeriod:{periodKey:'current',sortKey:''}});
   if(weeklyInspection.status!=='updated')throw Error('Undated weekly replacement blocked');
   const incoming={meta:{totalRows:2},workbook:{sheets:['Data'],data:{Data:{aoa:[['Sheet','Representative'],['Coach A','Newest Rep']]}}}};
   const replacement=await api.importDataset('weeklyRetail',incoming,{...metadata,detectedPeriod:{periodKey:'current',sortKey:''},scopedFingerprint:'new-weekly'});
   const weekly=await api.getCurrent('weeklyRetail',{includeRecord:true});
   if(weekly.id!==replacement.dataset.id)throw Error('Old dated weekly pointer blocked incoming file');
   const history=await api.getHistory('weeklyRetail',{metadataOnly:true});if(history.length!==1)throw Error('Old weekly source records were not deleted');
   const verifyDb=await open();const remainingChunks=await new Promise((resolve,reject)=>{const tx=verifyDb.transaction('coachtoolsDatasetChunks','readonly'),req=tx.objectStore('coachtoolsDatasetChunks').index('datasetId').getAll(oldWeekly.dataset.id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});verifyDb.close();
   if(remainingChunks.length)throw Error('Old weekly chunks were not deleted');
   IDBDatabase.prototype.transaction=function(stores,mode,...rest){const tx=txOriginal.call(this,stores,mode,...rest);if(mode==='readwrite')queueMicrotask(()=>tx.abort());return tx;};
   let weeklyAborted=false;try{await api.importDataset('weeklyRetail',data,metadata);}catch(_){weeklyAborted=true;}finally{IDBDatabase.prototype.transaction=txOriginal;}
   if(!weeklyAborted || (await api.getHistory('weeklyRetail',{metadataOnly:true}))[0].id!==replacement.dataset.id)throw Error('Aborted weekly override lost committed data');
   if((await api.getCurrent('qa',{includeRecord:true})).id!==current.id)throw Error('Weekly override altered QA');

   return {first:first.status,duplicate:duplicate.status,inspection:inspection.status,repaired:repaired.status,afterRepair:afterRepair.status,failed,currentId:current.id,repairedId:repaired.dataset.id,rows:current.data.workbook.data.Data.aoa.length};
 })()`,context);
 assert.equal(result.duplicate,'duplicate');assert.equal(result.inspection,'updated');assert.equal(result.repaired,'replacement');assert.equal(result.afterRepair,'duplicate');assert(result.failed);assert.equal(result.currentId,result.repairedId);assert.equal(result.rows,12001);
 console.log('IndexedDB: incomplete duplicate repaired; repeat upload deduplicated; aborted replacement retained committed data.');
})().catch(error=>{console.error(error);process.exitCode=1;});
