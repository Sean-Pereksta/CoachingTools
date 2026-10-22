'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const {IDBFactory}=require('fake-indexeddb');
const XLSX=require('../../../vendor/xlsx.full.min.js');
const root=path.resolve(__dirname,'..');
function harness(db=new IDBFactory(),storage=new Map()){
  const {document}=parseHTML(fs.readFileSync(path.join(root,'allstar.html'),'utf8'));
  const errors=[];
  const context=vm.createContext({document,window:{indexedDB:db,addEventListener(){},location:{search:''}},indexedDB:db,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},XLSX,console:{info(){},warn(){},error(...args){errors.push(args);}},performance,setTimeout,clearTimeout,setInterval,clearInterval,structuredClone,URL,TextEncoder,TextDecoder,requestAnimationFrame:fn=>setTimeout(fn,0),navigator:{},location:{search:''},alert:message=>errors.push(message),confirm:()=>true});
  const names=[...fs.readFileSync(path.join(root,'allstar.html'),'utf8').matchAll(/<script src="(js\/[^\"]+)"><\/script>/g)].map(x=>x[1]).filter(x=>x!=='js/app.js');
  vm.runInContext(names.map(name=>fs.readFileSync(path.join(root,name),'utf8')).join('\n'),context);
  vm.runInContext(`
    setStatus=renderEditModelSafe=renderTeamSelect=updateResearchCacheBadge=()=>{};
    showProgress=hideProgress=()=>{};
    const progress=[]; updateProgress=(text,pct)=>{progress.push({text,pct});if(state.activeImportJob){assertAllStarImportActive();state.activeImportJob.lastProgressAt=Date.now();}};
    state.startup.running=false; state.lifecycle.hidden=false;
    loadModels();
  `,context);
  return {context,db,storage,errors,run:code=>vm.runInContext(code,context)};
}
function qaFile(count,name='qa.csv',prefix='Agent'){
  const csv=['Agent Name,Team,Score %,Interaction Start Time,Assigned Date',...Array.from({length:count},(_,i)=>`${prefix} ${i},Coach ${i%44},90%,2026-09-01,2026-09-02`)].join('\n');
  const buffer=Buffer.from(csv);
  return {name,size:buffer.length,lastModified:1,arrayBuffer:async()=>buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)};
}
(async()=>{
  const h=harness();
  assert.equal(h.run('state.models.length'),5);
  assert.equal(h.run('state.models.reduce((n,m)=>n+m.criteria.length,0)'),20);
  h.run("state.models[0].name='My edited QA';saveModels();loadModels();");
  assert.equal(h.run('state.models[0].name'),'My edited QA');
  h.context.file=qaFile(51248);
  h.run(`let parseCalls=0,normalizeCalls=0,saveCalls=0;
    const realParse=readFileWorkbook,realNormalize=normalizeImportedRowOnce,realSave=saveImportedDataToIndexedDB;
    readFileWorkbook=async(...args)=>{parseCalls++;return realParse(...args);};
    normalizeImportedRowOnce=(...args)=>{normalizeCalls++;return realNormalize(...args);};
    saveImportedDataToIndexedDB=async(...args)=>{saveCalls++;return realSave(...args);};
  `);
  const started=Date.now();
  const first=h.run('loadQAFile(file)');
  assert.equal(await h.run('loadQAFile(file)'),false,'duplicate rejected');
  assert.equal(await first,true,JSON.stringify(h.errors));
  assert.equal(h.run('parseCalls'),1);
  assert.equal(h.run('normalizeCalls'),51248);
  assert.equal(h.run('state.data.qa.rows.length'),51248);
  assert.equal(h.run('state.importJobHistory.length'),1);
  assert.equal(h.run('state.importJobHistory[0].stored'),51248);
  assert.ok(h.run('progress.some(p=>p.pct>70)'));
  assert.ok(h.run('els.categorizeDataBtn.classList.contains("needsCategorization")'));
  console.log(`PASS 51,248-row QA: one parse, one normalization per row, verified completion (${Date.now()-started} ms)`);
  h.context.file=qaFile(3,'replacement.csv','Replacement');
  assert.equal(await h.run('loadQAFile(file)'),true,JSON.stringify(h.errors));
  assert.equal(h.run('state.data.qa.rows.length'),3);
  const reloaded=harness(h.db,h.storage);
  assert.equal(await reloaded.run('loadImportedDataFromIndexedDB({deferRender:true})'),true,JSON.stringify(reloaded.errors));
  assert.equal(reloaded.run('state.data.qa.rows.length'),3);
  assert.equal(reloaded.run('state.data.qa.fileName'),'replacement.csv');
  console.log('PASS replacement survives normalized hydration');
  h.context.file={name:'malformed.csv',size:20,arrayBuffer:async()=>new TextEncoder().encode('wrong,headers\nhello,world').buffer};
  assert.equal(await h.run('loadQAFile(file)'),false);
  assert.equal(h.run('state.data.qa.fileName'),'replacement.csv');
  console.log('PASS malformed replacement preserves prior source');
  // Cancellation must discard staged mutations and keep the last durable file.
  const cancellations=harness(h.db,h.storage);
  await cancellations.run('loadImportedDataFromIndexedDB({deferRender:true})');
  cancellations.context.file=qaFile(4000,'cancelled.csv');
  cancellations.run(`const cancelNormalize=normalizeImportedRowOnce;let cancelRow=0;normalizeImportedRowOnce=(...args)=>{const row=cancelNormalize(...args);if(++cancelRow===200)cancelAllStarImport();return row;};`);
  assert.equal(await cancellations.run('loadQAFile(file)'),false);
  assert.equal(cancellations.run('state.data.qa.fileName'),'replacement.csv');
  assert.equal(cancellations.run('state.data.qa.rows.length'),3);
  assert.equal(cancellations.run('state.activeImportJob'),null);
  assert.equal(cancellations.run('cancelAllStarImport()'),false);
  cancellations.run(`normalizeImportedRowOnce=cancelNormalize;const cancelRequest=idbReq;idbReq=(request,label)=>{if(label==='Verifying qa')Promise.resolve().then(()=>cancelAllStarImport());return cancelRequest(request,label);};`);
  cancellations.context.file=qaFile(10,'cancel-saving.csv');
  assert.equal(await cancellations.run('loadQAFile(file)'),false);
  const afterCancel=harness(h.db,h.storage);
  assert.equal(await afterCancel.run('loadImportedDataFromIndexedDB({deferRender:true})'),true);
  assert.equal(afterCancel.run('state.data.qa.fileName'),'replacement.csv');
  assert.equal(afterCancel.run('state.data.qa.rows.length'),3);
  console.log('PASS cancellation during normalization and transaction verification preserves the last committed source');
  // Resolved names must retain all existing first/last, full, auto and fallback behavior.
  cancellations.run(`
    const nameHeaders=['Agent Name','First Name','Last Name','Team','Score %','Name','Last_Name First_Name'];
    const nameRows=[{'Agent Name':' Doe, Jane ','First Name':'Jane','Last Name':'Doe',Team:'Coach One','Score %':'97%'},{'Agent Name':'','First Name':'','Last Name':'Surname',Name:'Other Name'},{'Agent Name':'','First Name':'','Last Name':'','Last_Name First_Name':'Smith, Jordan'}, {'Agent Name':'','First Name':'','Last Name':''}];
    for(const nameMode of ['full','firstLast','auto'])for(const convertLastFirst of [true,false]){
      const cfg={columns:{nameMode,convertLastFirst,agent:'Agent Name',firstName:'First Name',lastName:'Last Name'}};
      const meta=buildHeaderMetadata('qa',nameHeaders,cfg),normalizer=importedNormalizerContext(nameHeaders,cfg,'qa',meta);
      const cols={...SOURCE_SETTING_DEFAULTS.qa.columns,...cfg.columns};
      nameRows.forEach(row=>{const expected=repFromResolvedColumns(row,nameHeaders,{...cols,nameMode:cols.nameMode||'full',fullName:cols.fullName||cols.agent,convertLastFirst:!!cols.convertLastFirst},meta,['Agent Name','AgentName']);if(normalizer.representative(row)!==expected)throw new Error('Changed name mapping '+nameMode);});
    }
  `);
  console.log('PASS cached header resolution preserves full-name, first/last, auto, comma conversion and sparse row fallbacks');
  const multi=harness(),entries=[];
  for(let i=1;i<=3;i++){
    const file=qaFile(250,`batch-${i}.csv`),rawWorkbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellNF:true});
    file.arrayBuffer=()=>{throw new Error('The multi-file chooser parsed this file already.');};
    entries.push({file,rawWorkbook,classification:{id:'qa'}});
  }
  multi.context.entries=entries;
  multi.run(`window.CoachToolsImport={SOURCES:{qa:{label:'QA'}}};state.coachToolsImportBatch={recognized:entries};const multiNormalize=normalizeImportedRowOnce;normalizeImportedRowOnce=(...args)=>{if(state.activeImportJob?.filename==='batch-2.csv')cancelAllStarImport();return multiNormalize(...args);};`);
  await multi.run('importCoachToolsBatch()');
  assert.equal(multi.run('state.importJobHistory.length'),1);
  assert.equal(multi.run('state.data.qa.fileName'),'batch-1.csv');
  assert.equal(multi.run('state.data.qa.rows.length'),250);
  assert.equal(multi.run('state.coachToolsBatchImportCancelled'),true);
  assert.equal(entries[0].rawWorkbook,null,'release committed workbook to avoid accumulating file memory');
  assert.ok(entries[2].rawWorkbook,'remaining files were not imported after cancellation');
  console.log('PASS multi-file imports reuse parsed workbooks; cancellation retains completed files and stops the remaining batch');
  // Inject corruption into read-back, using the real IndexedDB transaction.
  h.run(`const realReq=idbReq;idbReq=(req,label)=>realReq(req,label).then(record=>label==='Verifying qa'?{...record,value:{rows:[]}}:record);`);
  h.context.file=qaFile(7,'failed-verification.csv');
  assert.equal(await h.run('loadQAFile(file)'),false);
  assert.equal(h.run('state.data.qa.fileName'),'replacement.csv');
  const retained=harness(h.db,h.storage);
  assert.equal(await retained.run('loadImportedDataFromIndexedDB({deferRender:true})'),true);
  assert.equal(retained.run('state.data.qa.fileName'),'replacement.csv');
  console.log('PASS read-back failure aborts replacement and retains prior committed data');
  retained.run(`window.CoachToolsData={ready:async()=>{},getDatasetVersion:()=>({id:'shared-new',version:99}),getCurrent:async()=>{throw new Error('Shared data must not overwrite local QA');}};`);
  // Restrict metadata to QA; missing sources are legitimately eligible for fallback.
  retained.run(`window.CoachToolsData.getDatasetVersion=type=>type==='qa'?{id:'shared-new',version:99}:null;`);
  const sync=await retained.run('syncAllStarFromCoachToolsData()');
  assert.equal(sync.changed,false);
  assert.equal(retained.run('state.data.qa.fileName'),'replacement.csv');
  console.log('PASS local Allstar source wins over newer shared QA');
  h.run('idbReq=realReq;');
  assert.equal(await h.run("categorizeImportedData({manual:true,triggerEvent:{type:'click',isTrusted:true,currentTarget:els.categorizeDataBtn},reason:'test',silent:true})"),true,JSON.stringify(h.errors));
  assert.equal(h.run('categorizationIsStale()'),false);
  const categorized=harness(h.db,h.storage);
  await categorized.run('loadImportedDataFromIndexedDB({deferRender:true})');
  assert.equal(categorized.run('categorizationIsStale()'),false);
  console.log('PASS categorized revision survives reload');
  const fallback=harness();
  const fallbackBook=XLSX.read(await qaFile(4,'shared-seed.csv').arrayBuffer(),{type:'array'});
  fallback.context.sharedWorkbook={sheets:fallbackBook.SheetNames,data:Object.fromEntries(fallbackBook.SheetNames.map(name=>[name,{aoa:XLSX.utils.sheet_to_json(fallbackBook.Sheets[name],{header:1,defval:''})}]))};
  fallback.run(`window.CoachToolsData={ready:async()=>{},getDatasetVersion:type=>type==='qa'?{id:'shared-seed',version:1}:null,getCurrent:async()=>({originalFileName:'shared-seed.csv',data:{workbook:sharedWorkbook}})};`);
  const seeded=await fallback.run('syncAllStarFromCoachToolsData({render:false})');
  assert.equal(seeded.changed,true,JSON.stringify(seeded));
  const seedReload=harness(fallback.db,fallback.storage);
  assert.equal(await seedReload.run('loadImportedDataFromIndexedDB({deferRender:true})'),true);
  assert.equal(seedReload.run('state.data.qa.rows.length'),4);
  console.log('PASS missing Allstar source seeds from shared QA and persists locally');
  const displayFailure=harness();
  displayFailure.context.sharedWorkbook=fallback.context.sharedWorkbook;
  displayFailure.run(`window.CoachToolsData={ready:async()=>{},getDatasetVersion:type=>type==='qa'?{id:'shared-seed',version:1}:null,getCurrent:async()=>({originalFileName:'shared-seed.csv',data:{workbook:sharedWorkbook}})};renderAllStarAfterDataBatch=()=>{throw new Error('Display refresh interrupted after commit');};`);
  const committedSync=await displayFailure.run('syncAllStarFromCoachToolsData()');
  assert.equal(committedSync.changed,true,JSON.stringify(committedSync));
  assert.ok(committedSync.warning);
  assert.equal(committedSync.error,undefined);
  assert.equal(displayFailure.run('state.data.qa.rows.length'),4,'display failure cannot roll back committed live data');
  assert.equal(displayFailure.run('state.centralSyncStageActive'),false);
  const displayReload=harness(displayFailure.db,displayFailure.storage);
  assert.equal(await displayReload.run('loadImportedDataFromIndexedDB({deferRender:true})'),true);
  assert.equal(displayReload.run('state.data.qa.rows.length'),4,'live and durable data agree after a failed display refresh');
  console.log('PASS shared synchronization preserves its verified commit when display refresh fails');
  // A deliberate weekly upload after Clear All Data may refresh only that file.
  // Other apps' older shared sources remain available there without reappearing here.
  const cleared=harness();
  assert.equal(await cleared.run('clearAllStarReportingData()'),true,JSON.stringify(cleared.errors));
  cleared.run(`
    const sharedReads=[],weeklyFile={name:'weekly-retail.csv',size:1};
    const weeklyEntry={file:weeklyFile,classification:{id:'weeklyRetail'},rawWorkbook:{}};
    const weeklyShared={originalFileName:weeklyFile.name,data:{workbook:{sheets:['Weekly'],data:{Weekly:{aoa:[['Date','Sheet','Name','Total Opportunities','Total Appointments'],['2026-09-06','Coach One','Agent One',10,4]]}}}}};
    const oldSharedQa={originalFileName:'old-shared-qa.csv',data:{workbook:{sheets:['QA'],data:{QA:{aoa:[['Agent Name','Team','Score %'],['Old Agent','Old Coach','90%']]}}}}};
    window.CoachToolsData={ready:async()=>{},getDatasetVersion:type=>['weeklyRetail','qa'].includes(type)?{id:'shared-'+type,version:1}:null,getCurrent:async type=>{sharedReads.push(type);return type==='weeklyRetail'?weeklyShared:oldSharedQa;}};
    window.CoachToolsImport={SOURCES:{weeklyRetail:{label:'Weekly Retail'}},saveRecognizedEntry:async()=>true};
    state.coachToolsImportBatch={recognized:[weeklyEntry]};
  `);
  await cleared.run('importCoachToolsBatch()');
  assert.equal(cleared.run('state.data.weeklyRetail.rows.length'),1,JSON.stringify(cleared.errors));
  assert.equal(cleared.run('state.data.qa.rows.length'),0,'unrelated shared QA stays cleared');
  assert.equal(cleared.run('sharedReads.join(",")'),'weeklyRetail','only the chosen dataset is read');
  assert.equal(cleared.run('state.reportingDataCleared'),true);
  const clearedReload=harness(cleared.db,cleared.storage);
  assert.equal(await clearedReload.run('loadImportedDataFromIndexedDB({deferRender:true})'),true);
  assert.equal(clearedReload.run('state.data.weeklyRetail.rows.length'),1);
  assert.equal(clearedReload.run('state.data.qa.rows.length'),0);
  assert.equal(clearedReload.run('state.reportingDataCleared'),true,'explicit uploads preserve automatic shared-sync suppression');
  assert.equal((await cleared.run('syncAllStarFromCoachToolsData()')).cleared,true);
  console.log('PASS explicit weekly batch upload after clear imports only its selected source and preserves the clear marker after reload');
  const rosters=harness();
  const names=Array.from({length:44},(_,i)=>`Coach ${String.fromCharCode(65+Math.floor(i/26))}${String.fromCharCode(65+i%26)}`);
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Team Name','Tab Name'],...names.map((name,i)=>[name,`Team${i}`])]),'Control');
  for(let i=0;i<44;i++) XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Roster'],[],[],[],[],[`Representative ${String.fromCharCode(65+Math.floor(i/26))}${String.fromCharCode(65+i%26)}`]]),`Team${i}`);
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Retail'],[],[],['','','Agent_Firstname','Agent_Surname','Team','Cash Apps','Cash Opps'],...names.map(name=>['','','Test','Representative',name,4,10])]),'sv2');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Representative','Team','Count','Jobs'],...names.map(name=>['Test Representative',name,2,10])]),'sv2 wiper');
  rosters.context.book=book; rosters.context.file={name:'Retail.xlsx',size:1};
  assert.equal(await rosters.run('loadRetailFile(file,{workbook:book})'),true,JSON.stringify(rosters.errors));
  assert.equal(rosters.run('new Set(state.data.retail.controlRoster.map(r=>r._team)).size'),44);
  console.log('PASS Retail adapter retains all 44 Control teams');
  rosters.run(`const referralCfg=getSourceSetting(state.models[0],'referral_wiper');const referralHeaders=['FIRST_NAME','LAST_NAME','Team_Name','Accepted','Asked'];const referralRow=normalizeStatRow({FIRST_NAME:'Jane',LAST_NAME:'Smith',Team_Name:'Referral Coach',Accepted:2,Asked:4},'referral','wiper',referralCfg.columns,referralHeaders);`);
  assert.equal(rosters.run('referralRow._rep'),'Jane Smith');
  assert.equal(rosters.run('referralRow._team'),'Referral Coach');
  console.log('PASS Referral Wipers first/last name and Team_Name mapping');
  // Prevent pending UI debounce tasks from outliving the harness.
  for(const instance of [h,reloaded,retained,categorized,fallback,seedReload,displayFailure,displayReload,cleared,clearedReload,rosters,cancellations,afterCancel,multi]) instance.run('state.lifecycle.closing=true;clearTimeout(state.importCacheSaveTimer);');
})().catch(error=>{console.error(error);process.exitCode=1;});
