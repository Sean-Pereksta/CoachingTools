'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const XLSX=require('../../../vendor/xlsx.full.min.js');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'allstar.html'),'utf8');
const scripts=[...html.matchAll(/<script src="(js\/[^\"]+)"><\/script>/g)].map(match=>match[1]).filter(name=>name!=='js/app.js');
function harness(db=new IDBFactory(),storage=new Map()){
  const {document}=parseHTML(html),alerts=[];
  const context=vm.createContext({document,window:{indexedDB:db,addEventListener(){},location:{search:''}},indexedDB:db,IDBKeyRange,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},XLSX,console:{info(){},warn(){},error(){},time(){},timeEnd(){}},performance,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,structuredClone,URL,TextEncoder,TextDecoder,requestAnimationFrame:fn=>setTimeout(fn,0),navigator:{},location:{search:''},alert:message=>alerts.push(message),confirm:()=>true});
  vm.runInContext(scripts.map(name=>fs.readFileSync(path.join(root,name),'utf8')).join('\n'),context);
  const run=code=>vm.runInContext(code,context);
  run(`setStatus=renderEditModelSafe=renderTeamSelect=updateResearchCacheBadge=()=>{};showProgress=hideProgress=updateProgress=()=>{};state.startup.running=false;state.lifecycle.hidden=false;loadModels();`);
  return {run,db,storage,context,alerts};
}
async function fixture(h){
  h.run(`
    state.data.qa={fileName:'qa.csv',headers:['Agent Name','Team','Score %'],rows:[{'Agent Name':'Agent One',Team:'Johnny Doe','Score %':90,_rep:'Agent One',_team:'Johnny Doe',_repKey:'agentone',_teamKey:'johnnydoe'}],aoa:[]};
    state.books.qa={fileName:'qa.csv',sheetNames:['QA'],selectedSheets:{qa:'QA'},aoaBySheet:{QA:[['Agent Name','Team','Score %'],['Agent One','Johnny Doe',90]]}};
    state.data.weeklyRetail.config={weekColumn:'Week',coachColumn:'Coach'};
    state.models[0].name='My saved model';saveModels();
    state.coachNameCorrections=[{from:'Johnny Doe',to:'John Doe'}];
    state.researchItems=[{id:'research-fixture',title:'Keep this research definition',outputType:'table',renderedResult:{version:2,id:'research-fixture',storedIn:'indexedDB',renderedAt:'2026-01-01T00:00:00Z'}}];persistResearchItemsToLocalStorage();
    localStorage.setItem('unrelated-theme','dark');
    state.lastRenderedReport={teamPack:{rows:[{name:'Johnny Doe'}]}};
  `);
  assert.equal(await h.run(`saveImportedDataToIndexedDB('fixture',{full:true,silent:true,noRender:true,noCompaction:true,noRetry:true})`),true);
  await h.run(`(async()=>{
    const db=await importCacheOpenDb();const tx=db.transaction(['coachtoolsCurrent','coachtoolsDatasets','books'],'readwrite');const done=idbTxDone(tx);tx.objectStore('coachtoolsCurrent').put({datasetType:'qa',datasetId:'shared-qa'});tx.objectStore('coachtoolsDatasets').put({id:'shared-qa',datasetType:'qa',rows:[{Team:'Shared Coach'}]});tx.objectStore('books').put({id:'sheet:qa:Inactive',type:'sheet',bookKey:'qa',sheetName:'Inactive',value:{aoa:[['Coach'],['Johnny Doe']]}});await done;db.close();
    const research=await researchRenderedDb(),rtx=research.transaction(['renderMeta','renderChunks'],'readwrite'),rdone=idbTxDone(rtx);rtx.objectStore('renderMeta').put({itemId:'research-fixture',renderedAt:'2026-01-01T00:00:00Z',rowCount:1,chunkSize:1000,rowProp:'rows',result:{}});rtx.objectStore('renderChunks').put({id:'research-fixture::0',rows:[{Team:'Johnny Doe'}]});await rdone;
    await workflowReportTransaction('readwrite',store=>store.put({id:'saved-fixture',createdAt:'2026-01-01T00:00:00Z',report:{teamPack:{rows:[{name:'Johnny Doe'}]}}}));
  })()`);
  const qdb=await new Promise((resolve,reject)=>{const req=h.db.open('coachingEmailGeneratorDB',1);req.onupgradeneeded=()=>{req.result.createObjectStore('rules',{keyPath:'id'});req.result.createObjectStore('problemHistory',{keyPath:'id'});req.result.createObjectStore('settings',{keyPath:'key'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  await new Promise((resolve,reject)=>{const tx=qdb.transaction(['rules','problemHistory','settings'],'readwrite');tx.objectStore('rules').put({id:'rule',title:'Preserved rule'});tx.objectStore('problemHistory').put({id:'past-appearance',repName:'Agent One'});tx.objectStore('settings').put({key:'concernHistoryLoadedFile.v1',names:[{name:'Agent One',count:2}]});tx.objectStore('settings').put({key:'individualMessageSettings.v1',greeting:'Hello'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});qdb.close();
}
async function stored(h,name,store){const db=await new Promise((resolve,reject)=>{const req=h.db.open(name);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});try{return await new Promise((resolve,reject)=>{const req=db.transaction(store,'readonly').objectStore(store).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}}
(async()=>{
  const h=harness();await fixture(h);
  h.context.confirm=()=>false;
  assert.equal(await h.run('clearAllStarReportingData()'),false);
  assert.equal(h.run('state.data.qa.rows.length'),1);
  h.context.confirm=()=>true;
  h.run(`const actualDone=idbTxDone;idbTxDone=(tx,label)=>{const done=actualDone(tx,label);if(label==='Clearing Allstar reporting data')queueMicrotask(()=>tx.abort());return done;};`);
  assert.equal(await h.run('clearAllStarReportingData()'),false,'failed transaction reports failure');
  assert.equal(h.run('state.data.qa.rows.length'),1,'failed clear preserves live data');
  const retained=harness(h.db,h.storage);assert.equal(await retained.run('loadImportedDataFromIndexedDB({deferRender:true})'),true);assert.equal(retained.run('state.data.qa.rows.length'),1,'failed clear preserves committed data');
  h.run('idbTxDone=actualDone;');
  assert.equal(await h.run('clearAllStarReportingData()'),true,JSON.stringify(h.alerts));
  assert.equal(h.run('importCacheSourceRowCount()'),0);
  assert.equal(h.run('state.lastRenderedReport'),null);
  assert.equal(h.run('state.researchItems.length'),1);
  assert.equal(h.run('state.researchItems[0].renderedResult'),undefined);
  assert.equal(h.run('state.researchResultCache.size'),0);
  assert.equal(h.run('state.selectedTeams.size'),0);
  assert.equal(h.run('state.coachNameCorrections.length'),1);
  assert.equal(h.run('state.data.weeklyRetail.config.coachColumn'),'Coach');
  assert.equal(h.storage.get('unrelated-theme'),'dark');
  assert.equal(h.run('state.models[0].name'),'My saved model');
  assert.equal((await stored(h,'allStarImportedDataCache.v1','books')).length,0,'includes unloaded historical sheets');
  assert.equal((await stored(h,'allStarImportedDataCache.v1','coachtoolsDatasets')).length,1,'shared app data preserved');
  assert.equal((await stored(h,'allStarSavedReports.v1','reports')).length,0);
  assert.equal((await stored(h,'allStarResearchRenderedResults.v1','renderMeta')).length,0);
  assert.equal((await stored(h,'allStarResearchRenderedResults.v1','renderChunks')).length,0);
  assert.equal((await stored(h,'coachingEmailGeneratorDB','problemHistory')).length,0);
  assert.equal((await stored(h,'coachingEmailGeneratorDB','rules')).length,1);
  assert.deepEqual((await stored(h,'coachingEmailGeneratorDB','settings')).map(row=>row.key),['individualMessageSettings.v1']);
  const refreshed=harness(h.db,h.storage);assert.equal(await refreshed.run('loadImportedDataFromIndexedDB({deferRender:true})'),true);
  refreshed.run(`window.CoachToolsData={ready:async()=>{},getDatasetVersion:()=>({id:'shared-qa',version:99}),getCurrent:()=>{throw new Error('Cleared data must never be repopulated automatically');}};`);
  assert.equal((await refreshed.run('syncAllStarFromCoachToolsData()')).cleared,true);
  assert.equal(refreshed.run('importCacheSourceRowCount()'),0);
  assert.equal(refreshed.run('state.reportingDataCleanupPending'),false);
  console.log('PASS clear confirmation, atomic failure, unloaded sheets, all derived stores, preferences, and reload suppression');

  const interrupted=harness();await fixture(interrupted);
  interrupted.run(`const clearStores=clearReportingDatabaseStores;clearReportingDatabaseStores=async()=>{throw new Error('Interrupted cleanup');};`);
  assert.equal(await interrupted.run('clearAllStarReportingData()'),true);
  assert.equal(interrupted.run('state.reportingDataCleanupPending'),true);
  assert.equal(await interrupted.run(`researchRenderedResultGet('research-fixture')`),null,'stale result inaccessible while cleanup pending');
  const recovered=harness(interrupted.db,interrupted.storage);assert.equal(await recovered.run('loadImportedDataFromIndexedDB({deferRender:true})'),true);
  assert.equal(recovered.run('state.reportingDataCleanupPending'),false);
  assert.equal((await stored(recovered,'allStarSavedReports.v1','reports')).length,0);
  console.log('PASS interrupted cross-database cleanup resumes safely after reload');

  const concurrent=harness();await fixture(concurrent);
  concurrent.run(`const doneBeforeConcurrent=idbTxDone;let injected=false;idbTxDone=(tx,label)=>{const done=doneBeforeConcurrent(tx,label);if(!injected&&tx.mode==='readwrite'){injected=true;queueMicrotask(()=>{state.data.qa={...state.data.qa,rows:[...state.data.qa.rows,{_rep:'Agent Two',_team:'John Doe'}]};markSourceCacheDirty('qa','edit during commit');});}return done;};markSourceCacheDirty('qa','first edit');`);
  assert.equal(await concurrent.run(`saveImportedDataToIndexedDB('concurrent edit',{silent:true,dirtyOnly:true,noCompaction:true,noRender:true,noRetry:true,deferIndexes:true})`),true);
  assert.equal(concurrent.run(`ensureImportCacheDirty().sources.has('qa')`),true,'concurrent edit remains queued');
  concurrent.run('idbTxDone=doneBeforeConcurrent;');
  assert.equal(await concurrent.run(`flushImportCacheSave('follow-up',{silent:true,dirtyOnly:true,noCompaction:true,noRender:true,noRetry:true,deferIndexes:true})`),true);
  const concurrentReload=harness(concurrent.db,concurrent.storage);await concurrentReload.run('loadImportedDataFromIndexedDB({deferRender:true})');assert.equal(concurrentReload.run('state.data.qa.rows.length'),2);
  console.log('PASS edits arriving during commit remain dirty and survive the next reload');

  // Migrate a legacy aggregate record and prove obsolete records cannot survive
  // clear or win over newer split records on the next hydration.
  const legacy=harness();
  await legacy.run(`(async()=>{const db=await importCacheOpenDb(),tx=db.transaction(['meta','sourceData','books'],'readwrite'),done=idbTxDone(tx);tx.objectStore('meta').put({id:'current',version:2,controlRosterSchemaVersion:2,totalRows:1});tx.objectStore('sourceData').put({id:'retail_sv2',value:{sv2:[{_rep:'Legacy Agent',_team:'Old Coach'}],headers:{sv2:['Team'],wiper:[]}}});tx.objectStore('sourceData').put({id:'retail:sv2',value:{rows:[{_rep:'Current Agent',_team:'Current Coach'}],headers:['Team']}});tx.objectStore('books').put({id:'retail',value:{fileName:'legacy.xlsx',sheetNames:['Historical'],aoaBySheet:{Historical:[['Team'],['Old Coach']]},selectedSheets:{retail_sv2:'Historical'}}});await done;db.close();})()`);
  assert.equal(await legacy.run('loadImportedDataFromIndexedDB({deferRender:true})'),true);
  assert.equal(legacy.run('state.data.retail.sv2[0]._team'),'Current Coach');
  assert.equal(await legacy.run(`flushImportCacheSave('migration',{noRender:true,noRetry:true})`),true);
  assert.equal((await stored(legacy,'allStarImportedDataCache.v1','sourceData')).some(row=>row.id==='retail_sv2'),false);
  assert.equal(await legacy.run('clearImportedDataIndexedDB()'),true,'legacy clear entry point uses full clear');
  const legacyReload=harness(legacy.db,legacy.storage);await legacyReload.run('loadImportedDataFromIndexedDB({deferRender:true})');assert.equal(legacyReload.run('importCacheSourceRowCount()'),0);
  const csv=Buffer.from('Agent Name,Team,Score %,Interaction Start Time,Assigned Date\nNew Agent,New Coach,90%,2026-09-01,2026-09-02');
  legacyReload.context.newFile={name:'new.csv',size:csv.length,arrayBuffer:async()=>csv.buffer.slice(csv.byteOffset,csv.byteOffset+csv.byteLength)};
  assert.equal(await legacyReload.run('loadQAFile(newFile)'),true,'clear leaves app ready for new uploads');
  const afterNewUpload=harness(legacy.db,legacy.storage);await afterNewUpload.run('loadImportedDataFromIndexedDB({deferRender:true})');assert.equal(afterNewUpload.run('state.data.qa.rows.length'),1);assert.equal(afterNewUpload.run('state.reportingDataCleared'),true,'future local saves preserve shared-sync suppression');
  console.log('PASS legacy migration precedence, obsolete record removal, and new imports after clear');
  for(const item of [h,retained,refreshed,interrupted,recovered,concurrent,concurrentReload,legacy,legacyReload,afterNewUpload])item.run('state.lifecycle.closing=true;clearTimeout(state.importCacheSaveTimer);');
})().catch(error=>{console.error(error);process.exitCode=1;});
