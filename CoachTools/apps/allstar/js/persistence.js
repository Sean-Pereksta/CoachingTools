/* Imported-data cache, IndexedDB lifecycle, and persistence restoration.
 * Behavior-preserving extraction from the definitive All-Star application.
 */
'use strict';

function defaultImportedDataState(){
  return {
    retail: { fileName:'', rosterFileName:'', rosterUpdatedAt:'', sv2:[], wiper:[], sv2Aoa:[], wiperAoa:[], controlRoster:[], teamTotals:emptyTeamTotalsDataset('retail'), headers:{sv2:[],wiper:[]} },
    referral: { fileName:'', rosterFileName:'', rosterUpdatedAt:'', sv2:[], wiper:[], itac:[], sv2Aoa:[], wiperAoa:[], itacAoa:[], controlRoster:[], teamTotals:emptyTeamTotalsDataset('referral'), headers:{sv2:[],wiper:[],itac:[]}, itacSheetName:'' },
    qa: { fileName:'', rows:[], headers:[], aoa:[] },
    qa_direct: { fileName:'', rows:[], headers:[], aoa:[], sheetName:'' },
    checklist: { fileName:'', rows:[], headers:[], aoa:[] },
    documented_coaching: { fileName:'', rows:[], headers:[], aoa:[] },
    comp_calls: { fileName:'', rows:[], headers:[], aoa:[] }
  };
}
function defaultImportedBooksState(){
  return {
    nondate:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    date:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    retail:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    referral:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    qa:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    checklist:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    documented_coaching:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    comp_calls:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    packaged:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}}
  };
}
function importCacheClone(obj){ try{ if(typeof structuredClone==='function') return structuredClone(obj); }catch(_){} return clonePlain(obj); }

function createImportCacheDirty(){ return {metadata:false,sources:new Set(),books:new Set(),sheets:new Set(),misc:new Set(),deletedSources:new Set(),deletedBooks:new Set(),deletedSheets:new Set()}; }
function ensureImportCacheDirty(){ return state.importCacheDirty || (state.importCacheDirty=createImportCacheDirty()); }
function importCacheHasDirty(d=ensureImportCacheDirty()){ return !!(d.metadata||d.sources.size||d.books.size||d.sheets.size||d.misc.size||d.deletedSources.size||d.deletedBooks.size||d.deletedSheets.size); }
function clearImportCacheDirty(){ state.importCacheDirty=createImportCacheDirty(); }
function markImportCacheDirty(kind, key='', reason='data changed'){
  // Dirty tracking keeps automatic persistence record-sized: callers mark the changed
  // source, workbook metadata, worksheet, or misc record instead of rewriting stores.
  const d=ensureImportCacheDirty(); d.metadata=true;
  if(kind==='source'&&key) d.sources.add(key);
  else if(kind==='book'&&key) d.books.add(key);
  else if(kind==='sheet'&&key) d.sheets.add(key);
  else if(kind==='misc'&&key) d.misc.add(key);
  else if(kind==='deletedSource'&&key) d.deletedSources.add(key);
  else if(kind==='deletedBook'&&key) d.deletedBooks.add(key);
  else if(kind==='deletedSheet'&&key) d.deletedSheets.add(key);
  if(reason) state.importCacheSaveReasons=[...(state.importCacheSaveReasons||[]),reason].slice(-8);
}
function markSourceCacheDirty(source, reason='source changed'){
  invalidateRunSourceIndex(source,reason);
  markImportCacheDirty('source',source,reason);
  const rows=getRowsRaw(source)||[], headers=getHeaders(source)||[];
  state.sourceMeta[source]={...(state.sourceMeta[source]||{}),version:(state.versions?.data||0),rowCount:rows.length,headerCount:headers.length,fileName:sourceFileName(source),selectedSheet:bookForSource(source)?.selectedSheets?.[source]||''};
}
function markBookCacheDirty(bookKey, reason='workbook changed'){
  markImportCacheDirty('book',bookKey,reason);
  const book=state.books?.[bookKey]; Object.keys(book?.aoaBySheet||{}).forEach(sn=>markImportCacheDirty('sheet',`${bookKey}:${sn}`,reason));
}
function scheduleImportedDataSave(reason='automatic save', opts={}){
  // Save scheduling debounces connected edits, merges dirty sets, and queues exactly
  // one follow-up save if another edit arrives while IndexedDB is committing.
  if(state.lifecycle?.closing) return false;
  if(state.importCacheLoading){ state.importCachePostLoadSave=true; if(reason) state.importCacheSaveReasons=[...(state.importCacheSaveReasons||[]),reason].slice(-8); return true; }
  if(reason) state.importCacheSaveReasons=[...(state.importCacheSaveReasons||[]),reason].slice(-8);
  const delay=opts.priority==='manual'||opts.flush ? 0 : Number(opts.delay??500);
  if(state.importCacheSaving){ state.importCacheSaveQueued=true; return true; }
  if(state.importCacheSaveTimer) clearTimeout(state.importCacheSaveTimer);
  state.importCacheSaveTimer=setTimeout(()=>{ state.importCacheSaveTimer=null; saveImportedDataToIndexedDB((state.importCacheSaveReasons||[reason]).join('; ')||reason,{silent:opts.silent!==false,dirtyOnly:!!opts.dirtyOnly,noRender:!!opts.noRender,noCompaction:!!opts.noCompaction,lifecycleSave:!!opts.lifecycleSave}); },delay);
  return true;
}
function sourceCacheRecordId(source){
  const legacy={retail_sv2:'retail:sv2',retail_wiper:'retail:wiper',retail_team_totals:'retail:teamTotals',referral_sv2:'referral:sv2',referral_wiper:'referral:wiper',referral_team_totals:'referral:teamTotals'};
  return legacy[source] || source;
}
function sourceCacheValue(source){
  const key=sourceCacheRecordId(source);
  const retail=state.data.retail||{}, referral=state.data.referral||{};
  if(key==='retail:metadata') return importCacheClone({fileName:retail.fileName||'',rosterFileName:retail.rosterFileName||'',rosterUpdatedAt:retail.rosterUpdatedAt||'',headers:retail.headers||{sv2:[],wiper:[]}});
  if(key==='retail:sv2') return importCacheClone({headers:retail.headers?.sv2||[],rows:retail.sv2||[],aoa:retail.sv2Aoa||[]});
  if(key==='retail:wiper') return importCacheClone({headers:retail.headers?.wiper||[],rows:retail.wiper||[],aoa:retail.wiperAoa||[]});
  if(key==='retail:controlRoster') return importCacheClone({rows:retail.controlRoster||[]});
  if(key==='retail:teamTotals'){ const ds=normalizeTeamTotalsDataset(retail.teamTotals||emptyTeamTotalsDataset('retail'),'retail_team_totals',{force:true}); return importCacheClone({...ds,rowsByTeamKey:Object.create(null),rowsByCoachAliasKey:Object.create(null),indexVersion:-1,indexSignature:''}); }
  if(key==='referral:metadata') return importCacheClone({fileName:referral.fileName||'',rosterFileName:referral.rosterFileName||'',rosterUpdatedAt:referral.rosterUpdatedAt||'',headers:referral.headers||{sv2:[],wiper:[],itac:[]},itacSheetName:referral.itacSheetName||''});
  if(key==='referral:sv2') return importCacheClone({headers:referral.headers?.sv2||[],rows:referral.sv2||[],aoa:referral.sv2Aoa||[]});
  if(key==='referral:wiper') return importCacheClone({headers:referral.headers?.wiper||[],rows:referral.wiper||[],aoa:referral.wiperAoa||[]});
  if(key==='referral:itac') return importCacheClone({headers:referral.headers?.itac||[],rows:referral.itac||[],aoa:referral.itacAoa||[],sheetName:referral.itacSheetName||''});
  if(key==='referral:controlRoster') return importCacheClone({rows:referral.controlRoster||[]});
  if(key==='referral:teamTotals'){ const ds=normalizeTeamTotalsDataset(referral.teamTotals||emptyTeamTotalsDataset('referral'),'referral_team_totals',{force:true}); return importCacheClone({...ds,rowsByTeamKey:Object.create(null),rowsByCoachAliasKey:Object.create(null),indexVersion:-1,indexSignature:''}); }
  if(isCustomSource(key)){ const c=customSource(key)||{}; return importCacheClone({sourceKey:c.sourceKey,id:c.id,name:c.name,fileName:c.fileName,headers:c.headers||[],rows:c.rows||[],framework:c.framework||'generic_table',sheetName:c.sheetName||'',headerRow:c.headerRow||1,startCol:c.startCol||1,manualHeaders:c.manualHeaders||[],columns:c.columns||{},aggregation:c.aggregation||{},sourceType:c.sourceType||'custom'}); }
  return importCacheClone(state.data[key]||{});
}
function hydrateSourceCacheRecord(nextData, rec, customData){
  const id=sourceCacheRecordId(rec?.id||''), v=rec?.value||{};
  if(['retail_sv2','retail_wiper','retail_team_totals'].includes(rec?.id)){ // v2 aggregate migration, field-wise and not key-order authoritative
    nextData.retail={...nextData.retail,...v}; return;
  }
  if(['referral_sv2','referral_wiper','referral_team_totals'].includes(rec?.id)){ nextData.referral={...nextData.referral,...v}; return; }
  if(id==='retail:metadata'){ nextData.retail.fileName=v.fileName||''; nextData.retail.rosterFileName=v.rosterFileName||''; nextData.retail.rosterUpdatedAt=v.rosterUpdatedAt||''; nextData.retail.headers={...(nextData.retail.headers||{}),...(v.headers||{})}; return; }
  if(id==='retail:sv2'){ nextData.retail.sv2=v.rows||[]; nextData.retail.sv2Aoa=v.aoa||[]; nextData.retail.headers.sv2=v.headers||[]; return; }
  if(id==='retail:wiper'){ nextData.retail.wiper=v.rows||[]; nextData.retail.wiperAoa=v.aoa||[]; nextData.retail.headers.wiper=v.headers||[]; return; }
  if(id==='retail:controlRoster'){ nextData.retail.controlRoster=v.rows||[]; return; }
  if(id==='retail:teamTotals'){ nextData.retail.teamTotals=normalizeTeamTotalsDataset(v||emptyTeamTotalsDataset('retail'),'retail_team_totals',{force:true}); return; }
  if(id==='referral:metadata'){ nextData.referral.fileName=v.fileName||''; nextData.referral.rosterFileName=v.rosterFileName||''; nextData.referral.rosterUpdatedAt=v.rosterUpdatedAt||''; nextData.referral.headers={...(nextData.referral.headers||{}),...(v.headers||{})}; nextData.referral.itacSheetName=v.itacSheetName||''; return; }
  if(id==='referral:sv2'){ nextData.referral.sv2=v.rows||[]; nextData.referral.sv2Aoa=v.aoa||[]; nextData.referral.headers.sv2=v.headers||[]; return; }
  if(id==='referral:wiper'){ nextData.referral.wiper=v.rows||[]; nextData.referral.wiperAoa=v.aoa||[]; nextData.referral.headers.wiper=v.headers||[]; return; }
  if(id==='referral:itac'){ nextData.referral.itac=v.rows||[]; nextData.referral.itacAoa=v.aoa||[]; nextData.referral.headers.itac=v.headers||[]; nextData.referral.itacSheetName=v.sheetName||v.itacSheetName||''; return; }
  if(id==='referral:controlRoster'){ nextData.referral.controlRoster=v.rows||[]; return; }
  if(id==='referral:teamTotals'){ nextData.referral.teamTotals=normalizeTeamTotalsDataset(v||emptyTeamTotalsDataset('referral'),'referral_team_totals',{force:true}); return; }
  if(isCustomSource(id)){ customData[id]=v; return; }
  if(nextData[id]) nextData[id]={...nextData[id],...v};
}
function hydrateSourceCacheRecords(nextData, sourceRecords, customData){
  const records=Array.isArray(sourceRecords)?sourceRecords:[], legacy=records.filter(r=>LEGACY_AGGREGATE_SOURCE_RECORD_IDS.has(r?.id));
  // Old aggregate records must hydrate first. Current split records then win
  // deterministically, regardless of IndexedDB key ordering.
  legacy.forEach(r=>hydrateSourceCacheRecord(nextData,r,customData));
  records.filter(r=>!LEGACY_AGGREGATE_SOURCE_RECORD_IDS.has(r?.id)).forEach(r=>hydrateSourceCacheRecord(nextData,r,customData));
  return legacy.map(r=>r.id);
}
function markRetailPersistenceDirty(reason='retail changed'){
  ['retail:metadata','retail:sv2','retail:wiper','retail:controlRoster','retail:teamTotals'].forEach(k=>markImportCacheDirty('source',k,reason));
  markBookCacheDirty('retail',reason); markImportCacheDirty('misc','sourceMeta',reason); markImportCacheDirty('misc','sourceSettings',reason);
}
function markReferralPersistenceDirty(reason='referral changed'){
  ['referral:metadata','referral:sv2','referral:wiper','referral:itac','referral:controlRoster','referral:teamTotals'].forEach(k=>markImportCacheDirty('source',k,reason));
  markBookCacheDirty('referral',reason); markImportCacheDirty('misc','sourceMeta',reason); markImportCacheDirty('misc','sourceSettings',reason);
}
function normalizedCustomSourceDefinitions(){
  return (state.customSources||[]).map(c=>({id:c.id,sourceKey:c.sourceKey,name:c.name,displayName:c.displayName||c.name,fileName:c.fileName||'',framework:c.framework||'generic_table',sheetName:c.sheetName||'',selectedWorksheet:c.sheetName||'',sheetNames:c.sheetNames||[],headerRow:c.headerRow||1,startCol:c.startCol||1,manualHeaders:c.manualHeaders||[],columns:c.columns||{},aggregation:c.aggregation||{},sourceType:c.sourceType||'custom'}));
}
function recordPersistenceMutation({reason='data changed',sources=[],books=[],sheets=[],misc=[],deletions={},critical=false}={}){
  sources.forEach(s=>markImportCacheDirty('source',sourceCacheRecordId(s),reason)); books.forEach(b=>markBookCacheDirty(b,reason)); sheets.forEach(s=>markImportCacheDirty('sheet',s,reason)); misc.forEach(m=>markImportCacheDirty('misc',m,reason));
  (deletions.sources||[]).forEach(s=>markImportCacheDirty('deletedSource',sourceCacheRecordId(s),reason)); (deletions.books||[]).forEach(b=>markImportCacheDirty('deletedBook',b,reason)); (deletions.sheets||[]).forEach(s=>markImportCacheDirty('deletedSheet',s,reason));
  return critical ? flushImportCacheSave(reason) : (scheduleImportedDataSave(reason), Promise.resolve(true));
}
async function persistCriticalMutation(args={}){ recordPersistenceMutation({...args,critical:false}); return flushImportCacheSave(args.reason||'critical save'); }
async function flushImportCacheSave(reason='flush import cache', opts={}){
  if(state.importCacheSaveTimer){ clearTimeout(state.importCacheSaveTimer); state.importCacheSaveTimer=null; }
  // Lifecycle callers never poll an existing transaction. IndexedDB may finish it
  // safely after the iframe starts closing; starting a second flush is worse.
  if(state.importCacheSaving) return true;
  if(!importCacheHasDirty() && state.importCache?.status==='saved') return true;
  return saveImportedDataToIndexedDB(reason,{silent:true,force:true,...opts});
}
function workbookMetadataRecord(bookKey){
  const b=state.books?.[bookKey]||{}; return {fileName:b.fileName||'',sheetNames:[...new Set(b.sheetNames||[])],selectedSheets:b.selectedSheets||{},sheetVersions:b.sheetVersions||{},packageLayoutVersion:b.packageLayoutVersion||0,updatedAt:new Date().toISOString()};
}
function sheetRecordId(bookKey,sheetName){ return `sheet:${bookKey}:${sheetName}`; }
function bookRecordId(bookKey){ return `book:${bookKey}`; }
function splitSheetDirtyKey(key){ const i=String(key).indexOf(':'); return i<0?[key,'']:[key.slice(0,i),key.slice(i+1)]; }
function replaceWorkbookCache(bookKey,nextBook,reason='workbook replaced'){
  const previous=state.books?.[bookKey]||{};
  const keep=new Set([...(nextBook?.sheetNames||[]),...Object.keys(nextBook?.aoaBySheet||{})]);
  [...new Set([...(previous.sheetNames||[]),...Object.keys(previous.aoaBySheet||{})])].forEach(sn=>{ if(sn&&!keep.has(sn)) markImportCacheDirty('deletedSheet',`${bookKey}:${sn}`,reason); });
  state.books[bookKey]={fileName:nextBook?.fileName||'',sheetNames:[...keep],aoaBySheet:nextBook?.aoaBySheet||{},selectedSheets:nextBook?.selectedSheets||{},sheetVersions:nextBook?.sheetVersions||{},packageLayoutVersion:nextBook?.packageLayoutVersion||0};
  markImportCacheDirty('book',bookKey,reason);
  Object.keys(state.books[bookKey].aoaBySheet||{}).forEach(sn=>markImportCacheDirty('sheet',`${bookKey}:${sn}`,reason));
  return state.books[bookKey];
}
function compactPackagedWorkbookViews({markDirty=true}={}){
  const packaged=state.books?.packaged;
  if(!packaged?.fileName) return false;
  const metaSheet=(packaged.sheetNames||[]).find(sn=>norm(sn)===norm('All Star Metadata'))||'';
  let changed=false;
  Object.entries(state.books||{}).forEach(([bookKey,book])=>{
    if(bookKey==='packaged'||!book||book.fileName!==packaged.fileName) return;
    const selected=[...new Set(Object.values(book.selectedSheets||{}).filter(Boolean))];
    const looksLikeMirror=!!metaSheet && (book.sheetNames||[]).includes(metaSheet) && (book.sheetNames||[]).length>selected.length;
    if(!looksLikeMirror) return;
    const nextAoa={}; selected.forEach(sn=>{ if(book.aoaBySheet?.[sn]) nextAoa[sn]=book.aoaBySheet[sn]; });
    if(markDirty) replaceWorkbookCache(bookKey,{...book,sheetNames:selected,aoaBySheet:nextAoa,packageLayoutVersion:2},'compact duplicated packaged workbook cache');
    else state.books[bookKey]={...book,sheetNames:selected,aoaBySheet:nextAoa,packageLayoutVersion:2};
    changed=true;
  });
  const keepMeta=metaSheet?[metaSheet]:[];
  const packageNeedsCompaction=(packaged.sheetNames||[]).some(sn=>!keepMeta.includes(sn)) || Object.keys(packaged.aoaBySheet||{}).some(sn=>!keepMeta.includes(sn));
  if(packageNeedsCompaction){
    const nextAoa={}; if(metaSheet&&packaged.aoaBySheet?.[metaSheet]) nextAoa[metaSheet]=packaged.aoaBySheet[metaSheet];
    if(markDirty) replaceWorkbookCache('packaged',{...packaged,sheetNames:keepMeta,aoaBySheet:nextAoa,selectedSheets:{},packageLayoutVersion:2},'compact packaged workbook owner');
    else state.books.packaged={...packaged,sheetNames:keepMeta,aoaBySheet:nextAoa,selectedSheets:{},packageLayoutVersion:2};
    changed=true;
  }
  return changed;
}
function expectedImportCacheBookIds(){
  const ids=new Set();
  Object.entries(state.books||{}).forEach(([bookKey,b])=>{
    ids.add(bookRecordId(bookKey));
    [...new Set([...(b?.sheetNames||[]),...Object.keys(b?.aoaBySheet||{})])].filter(Boolean).forEach(sn=>ids.add(sheetRecordId(bookKey,sn)));
  });
  return ids;
}
async function importCacheBookStoreKeys(db){
  const tx=db.transaction(IMPORT_CACHE_BOOK_STORE,'readonly');
  const keys=await idbReq(tx.objectStore(IMPORT_CACHE_BOOK_STORE).getAllKeys());
  return keys||[];
}
function describeImportCacheError(err,estimate){
  const name=String(err?.name||''); const raw=String(err?.message||err||'Unknown IndexedDB error');
  if(name==='QuotaExceededError'||/quota|disk|storage.*full/i.test(raw)){
    const used=estimate?` Browser storage is using ${bytesToNice(estimate.usage)} of ${bytesToNice(estimate.quota)}.`:'';
    return `Browser storage quota was exceeded. The cache previously duplicated packaged workbook sheets under several source books; this build compacts those duplicates before retrying.${used}`;
  }
  if(name==='DataCloneError'||/clone/i.test(raw)) return `IndexedDB rejected a non-cloneable value (${raw}). The save now isolates workbook sheets and plain source records to prevent that failure.`;
  if(name==='TransactionInactiveError'||name==='AbortError') return `The IndexedDB transaction was interrupted (${raw}). The dirty records remain queued and will retry.`;
  return `${name?name+': ':''}${raw}`;
}
function releaseInactiveWorkbookSheets(bookKey){
  // Memory release keeps selected/control/troubleshoot AOA expanded and lets IDB hold
  // every other worksheet for later Troubleshoot selection.
  const b=state.books?.[bookKey]; if(!b?.aoaBySheet) return;
  const keep=new Set(Object.values(b.selectedSheets||{}).filter(Boolean));
  ['Control','Appt Summary','KPI Summary',state.troubleshoot?.sheetName].filter(Boolean).forEach(sn=>{ if((b.sheetNames||[]).includes(sn)) keep.add(sn); });
  Object.keys(b.aoaBySheet).forEach(sn=>{ if(!keep.has(sn)) delete b.aoaBySheet[sn]; });
}
async function ensureSheetLoaded(bookKey, sheetName){
  const b=state.books?.[bookKey]; if(!b||!sheetName) return [];
  if(b.aoaBySheet?.[sheetName]) return b.aoaBySheet[sheetName];
  let db; try{ db=await importCacheOpenDb(); const rec=await idbReq(db.transaction(IMPORT_CACHE_BOOK_STORE,'readonly').objectStore(IMPORT_CACHE_BOOK_STORE).get(sheetRecordId(bookKey,sheetName))); const aoa=rec?.value?.aoa||rec?.aoa||[]; b.aoaBySheet=b.aoaBySheet||{}; b.aoaBySheet[sheetName]=aoa; return aoa; } finally{ if(db) db.close(); }
}
function getBookSheetAoa(bookKey, sheetName){ return state.books?.[bookKey]?.aoaBySheet?.[sheetName] || []; }

function bytesToNice(n){
  n=Number(n)||0;
  if(n>=1024*1024*1024) return (n/1024/1024/1024).toFixed(2)+' GB';
  if(n>=1024*1024) return (n/1024/1024).toFixed(1)+' MB';
  if(n>=1024) return (n/1024).toFixed(1)+' KB';
  return n.toLocaleString()+' B';
}
function importCacheSourceRowCount(){ return allSourceKeys().reduce((sum,src)=>sum+(getRowsRaw(src)||[]).length,0); }
function importCacheSheetCount(){ return Object.values(state.books||{}).reduce((sum,b)=>sum+(b?.sheetNames||[]).length,0); }
async function importCacheStorageEstimate(){
  if(!navigator.storage?.estimate) return null;
  try{ return await navigator.storage.estimate(); }catch(_){ return null; }
}
function importCacheSummaryText(meta){
  if(!meta) return 'No local import cache saved yet.';
  const rows=Number(meta.totalRows||0).toLocaleString();
  const sheets=Number(meta.sheetCount||0).toLocaleString();
  const saved=meta.savedAt ? new Date(meta.savedAt).toLocaleString() : 'unknown time';
  const files=Object.values(meta.fileNames||{}).filter(Boolean).slice(0,5).join(', ');
  return `Local cache saved ${saved}: ${rows} rows, ${sheets} sheets${files?' · '+files:''}.`;
}
async function renderImportCacheStatus(extra=''){
  if(state.lifecycle?.closing || !els.importCacheStatus) return;
  const meta=state.importCache?.meta || await importCacheReadMeta().catch(()=>null);
  if(meta && !state.importCache.meta) state.importCache.meta=meta;
  const est=await importCacheStorageEstimate();
  const storage=est ? ` Browser storage used ${bytesToNice(est.usage)} of ${bytesToNice(est.quota)}.` : '';
  const current=` Current session: ${importCacheSourceRowCount().toLocaleString()} rows across ${importCacheSheetCount().toLocaleString()} workbook sheets.`;
  els.importCacheStatus.textContent=[extra, importCacheSummaryText(meta), current, storage].filter(Boolean).join(' ');
}
function importCacheOpenDb(){
  if(!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(IMPORT_CACHE_DB,IMPORT_CACHE_SCHEMA_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(IMPORT_CACHE_META_STORE)) db.createObjectStore(IMPORT_CACHE_META_STORE,{keyPath:'id'});
      if(!db.objectStoreNames.contains(IMPORT_CACHE_SOURCE_STORE)) db.createObjectStore(IMPORT_CACHE_SOURCE_STORE,{keyPath:'id'});
      if(!db.objectStoreNames.contains(IMPORT_CACHE_BOOK_STORE)) db.createObjectStore(IMPORT_CACHE_BOOK_STORE,{keyPath:'id'});
      if(!db.objectStoreNames.contains(IMPORT_CACHE_MISC_STORE)) db.createObjectStore(IMPORT_CACHE_MISC_STORE,{keyPath:'id'});
      if(!db.objectStoreNames.contains('coachtoolsDatasets')){ const store=db.createObjectStore('coachtoolsDatasets',{keyPath:'id'}); store.createIndex('datasetType','datasetType',{unique:false}); store.createIndex('periodKey',['datasetType','periodKey'],{unique:false}); store.createIndex('fingerprint',['datasetType','fingerprint'],{unique:false}); }
      if(!db.objectStoreNames.contains('coachtoolsDatasetChunks')){ const store=db.createObjectStore('coachtoolsDatasetChunks',{keyPath:'id'}); store.createIndex('datasetId','datasetId',{unique:false}); store.createIndex('datasetOrder',['datasetId','index'],{unique:true}); }
      if(!db.objectStoreNames.contains('coachtoolsCurrent')) db.createObjectStore('coachtoolsCurrent',{keyPath:'datasetType'});
      if(!db.objectStoreNames.contains('coachtoolsImports')){ const store=db.createObjectStore('coachtoolsImports',{keyPath:'id'}); store.createIndex('datasetType','datasetType',{unique:false}); store.createIndex('importedAt','importedAt',{unique:false}); }
      if(!db.objectStoreNames.contains('coachtoolsPeople')){ const store=db.createObjectStore('coachtoolsPeople',{keyPath:'personId'}); store.createIndex('normalizedName','normalizedName',{unique:false}); store.createIndex('role','role',{unique:false}); store.createIndex('department','department',{unique:false}); store.createIndex('currentCoachId','currentCoachId',{unique:false}); }
      if(!db.objectStoreNames.contains('coachtoolsIdentityReviews')){ const store=db.createObjectStore('coachtoolsIdentityReviews',{keyPath:'id'}); store.createIndex('status','status',{unique:false}); store.createIndex('createdAt','createdAt',{unique:false}); }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Could not open import cache database.'));
  });
}
function idbReq(req){ return new Promise((resolve,reject)=>{ req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error||new Error('IndexedDB request failed.')); }); }
function idbTxDone(tx){ return new Promise((resolve,reject)=>{ tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.')); tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.')); }); }
async function importCacheReadMeta(){
  const db=await importCacheOpenDb();
  try{ return await idbReq(db.transaction(IMPORT_CACHE_META_STORE,'readonly').objectStore(IMPORT_CACHE_META_STORE).get('current')); }
  finally{ db.close(); }
}
function importedFileNameMap(){
  return {
    retail: state.data.retail.fileName || state.books.retail.fileName || '',
    referral: state.data.referral.fileName || state.books.referral.fileName || '',
    qa: state.data.qa.fileName || state.books.qa.fileName || '',
    qa_direct: state.data.qa_direct?.fileName || '',
    checklist: state.data.checklist.fileName || state.books.checklist.fileName || '',
    documented_coaching: state.data.documented_coaching.fileName || state.books.documented_coaching.fileName || '',
    comp_calls: state.data.comp_calls.fileName || state.books.comp_calls.fileName || '',
    packaged: state.books.packaged.fileName || '',
    custom: (state.customSources||[]).map(c=>c.fileName).filter(Boolean).join(', ')
  };
}
function importCacheMetadata(reason='manual save'){
  // Metadata is built from maintained sourceMeta counts when possible so saving does
  // not scan every imported row just to update the status line.
  const rowCounts={};
  allSourceKeys().forEach(src=>{ const m=state.sourceMeta?.[src]; rowCounts[src]=Number.isFinite(m?.rowCount)?m.rowCount:(getRowsRaw(src)||[]).length; });
  return {id:'current',version:IMPORT_CACHE_SCHEMA_VERSION,controlRosterSchemaVersion:CONTROL_ROSTER_SCHEMA_VERSION,savedAt:new Date().toISOString(),reason,rowCounts,totalRows:Object.values(rowCounts).reduce((a,b)=>a+Number(b||0),0),sheetCount:importCacheSheetCount(),fileNames:importedFileNameMap(),customSourceCount:(state.customSources||[]).length,categorizedBuiltAt:state.categorized?.nondated?.builtAt || state.categorized?.dated?.builtAt || '',sourceMeta:importCacheClone(state.sourceMeta||{})};
}

function mergeImportCacheDirtySnapshot(snapshot){
  if(!snapshot) return; const d=ensureImportCacheDirty(); d.metadata=true;
  ['sources','books','sheets','misc','deletedSources','deletedBooks','deletedSheets'].forEach(k=>{ (snapshot[k]||new Set()).forEach(v=>d[k].add(v)); });
}
function scheduleImportCacheRetry(reason='retry import cache save'){
  if(state.lifecycle?.closing) return false;
  const delays=[500,1500,4000]; state.importCache.retryCount=Number(state.importCache.retryCount||0);
  if(state.importCache.retryCount>=delays.length){ state.importCache.status='manual_action_required'; return false; }
  const delay=delays[state.importCache.retryCount++]; state.importCache.status='retrying';
  setTimeout(()=>{ if(!state.lifecycle?.closing && importCacheHasDirty()) saveImportedDataToIndexedDB(reason+' retry '+state.importCache.retryCount,{silent:true}); },delay);
  return true;
}
function lightweightImportCacheManifest(meta={}, snapshot={}){
  const previous=state.importCache?.meta?.manifest||{};
  return {...previous,schemaVersion:IMPORT_CACHE_SCHEMA_VERSION,generationId:state.importCache?.generationId||(state.importCache.generationId=id()),revision:Number(state.importCache?.revision||0)+1,savedAt:meta.savedAt,reason:meta.reason,dirtyOnly:true,changed:{sources:[...(snapshot.sources||[])].sort(),books:[...(snapshot.books||[])].sort(),sheets:[...(snapshot.sheets||[])].sort(),misc:[...(snapshot.misc||[])].sort()}};
}
function importCacheManifest(meta={}, snapshot={}){
  const sourceIds=[...new Set([...(snapshot.sources||[]),...Object.keys(state.sourceMeta||{}).map(sourceCacheRecordId)])].sort();
  const bookIds=Object.keys(state.books||{}).map(bookRecordId).sort();
  const sheetIds=[]; Object.entries(state.books||{}).forEach(([bookKey,b])=>(b.sheetNames||[]).forEach(sn=>sheetIds.push(sheetRecordId(bookKey,sn))));
  const headerCounts={}; sourceIds.forEach(src=>{ const h=getHeaders(src)||[]; headerCounts[src]=h.length; });
  return {schemaVersion:IMPORT_CACHE_SCHEMA_VERSION,generationId:state.importCache?.generationId||(state.importCache.generationId=id()),revision:Number(state.importCache?.revision||0)+1,savedAt:meta.savedAt,reason:meta.reason,sourceIds,bookIds,sheetIds:sheetIds.sort(),miscIds:[...(snapshot.misc||[])].sort(),rowCounts:meta.rowCounts||{},headerCounts,workbookWorksheetCounts:Object.fromEntries(Object.entries(state.books||{}).map(([k,b])=>[k,(b.sheetNames||[]).length])),selectedSheets:Object.fromEntries(Object.entries(state.books||{}).map(([k,b])=>[k,b.selectedSheets||{}])),customSourceKeys:customSourceKeys(),controlRosterCounts:{retail:(state.data.retail.controlRoster||[]).length,referral:(state.data.referral.controlRoster||[]).length},teamTotalsCounts:{retail:(state.data.retail.teamTotals?.rows||[]).length,referral:(state.data.referral.teamTotals?.rows||[]).length},categorizedRowCounts:{nondated:(state.categorized?.nondated?.rows||[]).length,dated:(state.categorized?.dated?.rows||[]).length,warnings:(state.categorized?.warnings||[]).length},aliasCounts:{active:(state.repAliases||new Map()).size,quarantined:(state.quarantinedRepAliases||[]).length},sourceSettingModelCount:(state.models||[]).filter(m=>m.sourceSettings).length};
}
function mergeSourceSettingsFromImportCache(records){
  if(!Array.isArray(records)) return; const byId=new Map((state.models||[]).map(m=>[m.id,m]));
  records.forEach(r=>{ const m=byId.get(r.id); if(m&&r.sourceSettings) m.sourceSettings=normalizeSourceSettings({...r.sourceSettings,...(m.sourceSettings||{})}); });
}
function restoreAliasesFromImportCache(value){
  const active=Array.isArray(value)?value:(value?.active||[]); state.repAliases=new Map(); active.forEach(a=>{ const key=a?.alias||a?.aliasKey||a?.aliasName; if(key) state.repAliases.set(key,a); }); state.quarantinedRepAliases=Array.isArray(value?.quarantined)?value.quarantined:(state.quarantinedRepAliases||[]); if(value?.sourceArea) state.aliasSourceArea=value.sourceArea;
}
async function saveImportedDataToIndexedDB(reason='manual save', opts={}){
  if(state.lifecycle?.closing && !opts.lifecycleSave) return false;
  if(state.importCacheLoading && !opts.force) return false;
  if(state.importCacheSaving){ state.importCacheSaveQueued=true; return false; }
  if(state.importCacheSaveTimer){ clearTimeout(state.importCacheSaveTimer); state.importCacheSaveTimer=null; }
  if(!opts.noCompaction) compactPackagedWorkbookViews({markDirty:true});
  const dirty=ensureImportCacheDirty();
  if(opts.full || (!state.importCache.meta && !opts.dirtyOnly)){
    allSourceKeys().forEach(src=>markSourceCacheDirty(src,reason));
    ['retail:metadata','retail:controlRoster','referral:metadata','referral:itac','referral:controlRoster'].forEach(k=>markImportCacheDirty('source',k,reason));
    Object.keys(state.books||{}).forEach(k=>markBookCacheDirty(k,reason));
    ['categorized','customSources','teamIndex','sourceMeta','sourceSettings','aliases','manifest'].forEach(k=>markImportCacheDirty('misc',k,reason));
  }
  if(!opts.lifecycleSave && (dirty.sources.size || dirty.misc.has('categorized') || dirty.misc.has('aliases') || dirty.misc.has('customSources'))) dirty.misc.add('teamIndex');
  if(!importCacheHasDirty(dirty) && !opts.force){ if(!opts.noRender) await renderImportCacheStatus('Local cache already up to date.'); return true; }
  state.importCacheSaving=true; state.importCache.status='saving'; state.importCacheSavePromise=null;
  let snapshot=null;
  let db;
  try{
    db=await importCacheOpenDb();
    const existingBookKeys=opts.dirtyOnly||opts.noCompaction?[]:await importCacheBookStoreKeys(db);
    const expectedBookIds=opts.dirtyOnly||opts.noCompaction?new Set():expectedImportCacheBookIds();
    const obsoleteBookKeys=existingBookKeys.filter(k=>!expectedBookIds.has(String(k)));
    const meta=importCacheMetadata(reason);
    snapshot={sources:new Set(dirty.sources),books:new Set(dirty.books),sheets:new Set(dirty.sheets),misc:new Set(dirty.misc),deletedSources:new Set(dirty.deletedSources),deletedBooks:new Set(dirty.deletedBooks),deletedSheets:new Set(dirty.deletedSheets)};
    const teamIndex=snapshot.misc.has('teamIndex') ? serializeTeamIndex(state.teamIndexCache || buildCompactTeamIndexFromRows(reason,{mutateRows:opts.mutateRows!==false && !opts.lifecycleSave})) : null;
    if(teamIndex) state.teamIndexCache=restoreTeamIndex(teamIndex);
    const tx=db.transaction([IMPORT_CACHE_META_STORE,IMPORT_CACHE_SOURCE_STORE,IMPORT_CACHE_BOOK_STORE,IMPORT_CACHE_MISC_STORE],'readwrite');
    const done=idbTxDone(tx); state.importCacheSavePromise=done;
    const metaStore=tx.objectStore(IMPORT_CACHE_META_STORE), sourceStore=tx.objectStore(IMPORT_CACHE_SOURCE_STORE), bookStore=tx.objectStore(IMPORT_CACHE_BOOK_STORE), miscStore=tx.objectStore(IMPORT_CACHE_MISC_STORE);
    // Cleanup and writes share one transaction, so an unsuccessful save still leaves the previous cache intact.
    obsoleteBookKeys.forEach(k=>bookStore.delete(k));
    snapshot.deletedSources.forEach(k=>sourceStore.delete(k));
    snapshot.deletedBooks.forEach(k=>bookStore.delete(bookRecordId(k)));
    snapshot.deletedSheets.forEach(k=>bookStore.delete(sheetRecordId(...splitSheetDirtyKey(k))));
    snapshot.sources.forEach(k=>{ const id=sourceCacheRecordId(k); sourceStore.put({id,value:sourceCacheValue(id),updatedAt:meta.savedAt,revision:Number(state.importCache?.revision||0)+1}); });
    snapshot.books.forEach(k=>bookStore.put({id:bookRecordId(k),type:'book',bookKey:k,value:importCacheClone(workbookMetadataRecord(k))}));
    snapshot.sheets.forEach(k=>{ const [bookKey,sheetName]=splitSheetDirtyKey(k); if(!sheetName) return; bookStore.put({id:sheetRecordId(bookKey,sheetName),type:'sheet',bookKey,sheetName,value:{aoa:importCacheClone(getBookSheetAoa(bookKey,sheetName)),version:Date.now()}}); });
    if(snapshot.misc.has('categorized')) miscStore.put({id:'categorized',value:importCacheClone(state.categorized||{})});
    if(snapshot.misc.has('customSources')) miscStore.put({id:'customSources',value:importCacheClone(normalizedCustomSourceDefinitions())});
    if(snapshot.misc.has('teamIndex') && teamIndex) miscStore.put({id:'teamIndex',value:importCacheClone(teamIndex)});
    if(snapshot.misc.has('sourceMeta')) miscStore.put({id:'sourceMeta',value:importCacheClone(state.sourceMeta||{})});
    if(snapshot.misc.has('sourceSettings')) miscStore.put({id:'sourceSettings',value:importCacheClone((state.models||[]).map(m=>({id:m.id,sourceSettings:m.sourceSettings||{}})))});
    if(snapshot.misc.has('aliases')) miscStore.put({id:'aliases',value:importCacheClone({active:[...(state.repAliases||new Map()).values()],quarantined:state.quarantinedRepAliases||[],sourceArea:state.aliasSourceArea||''})});
    const manifest=opts.lifecycleSave?lightweightImportCacheManifest(meta,snapshot):importCacheManifest(meta, snapshot); meta.manifest=manifest; meta.revision=manifest.revision; meta.generationId=manifest.generationId;
    miscStore.put({id:'manifest',value:manifest});
    metaStore.put(meta); // metadata last is the commit marker for the completed dirty batch.
    await done;
    if(!opts.noCompaction) Object.keys(state.books||{}).forEach(releaseInactiveWorkbookSheets);
    clearImportCacheDirty(); state.importCache.meta=meta; state.importCache.generationId=manifest.generationId; state.importCache.revision=manifest.revision; state.importCache.status='saved'; state.importCache.lastError=''; state.importCache.retryCount=0; state.importCacheSaveReasons=[];
    if(!opts.silent) alert('Imported data saved locally in IndexedDB.');
    if(!opts.noRender) await renderImportCacheStatus(obsoleteBookKeys.length?`Saved imported data locally and removed ${obsoleteBookKeys.length.toLocaleString()} obsolete duplicated workbook cache records.`:'Saved imported data locally.');
    return true;
  }catch(err){
    console.error('[Import Cache] Save failed',err);
    mergeImportCacheDirtySnapshot(snapshot);
    const estimate=await importCacheStorageEstimate();
    state.importCache.status='error'; state.importCache.lastError=describeImportCacheError(err,estimate);
    if(!opts.silent) alert('Could not save local IndexedDB import cache. '+state.importCache.lastError+' The previous valid cache was left in place.');
    if(!opts.noRender) await renderImportCacheStatus('Local cache save failed; previous cache retained: '+state.importCache.lastError);
    if(!opts.lifecycleSave) scheduleImportCacheRetry(reason);
    return false;
  }finally{
    if(db) db.close();
    state.importCacheSaving=false; state.importCacheSavePromise=null;
    if(!state.lifecycle?.closing && (state.importCacheSaveQueued || importCacheHasDirty())){
      state.importCacheSaveQueued=false;
      scheduleImportedDataSave('changes queued during save',state.lifecycle?.hidden?{delay:0,silent:true,dirtyOnly:true,noRender:true,noCompaction:true,lifecycleSave:true}:{delay:250});
    }
  }
}
function restoreImportFileLabels(){
  const set=(node,txt)=>{ if(node) node.textContent=txt||''; };
  const retailRoster=(state.data.retail.controlRoster||[]).length, referralRoster=(state.data.referral.controlRoster||[]).length;
  set(els.retailFileName, (state.data.retail.fileName || state.books.retail.fileName) + (retailRoster?` · ${retailRoster.toLocaleString()} Control reps`:''));
  set(els.referralFileName, (state.data.referral.fileName || state.books.referral.fileName) + (referralRoster?` · ${referralRoster.toLocaleString()} Control reps`:''));
  const qaSheet=state.books.qa?.selectedSheets?.qa || '';
  set(els.qaFileName, state.data.qa.fileName ? `${state.data.qa.fileName}${qaSheet?' · '+qaSheet:''}` : state.books.qa.fileName);
  set(els.qaDirectFileName, state.data.qa_direct?.fileName ? `${state.data.qa_direct.fileName}${state.data.qa_direct.sheetName?' · '+state.data.qa_direct.sheetName:''} · direct mode source` : '');
  const checklistSheet=state.books.checklist?.selectedSheets?.checklist || '';
  set(els.checklistFileName, state.data.checklist.fileName ? `${state.data.checklist.fileName}${checklistSheet?' · '+checklistSheet:''}` : state.books.checklist.fileName);
  const dcSheet=state.books.documented_coaching?.selectedSheets?.documented_coaching || '';
  set(els.documentedCoachingFileName, state.data.documented_coaching.fileName ? `${state.data.documented_coaching.fileName}${dcSheet?' · '+dcSheet:''}` : state.books.documented_coaching.fileName);
  const compSheet=state.books.comp_calls?.selectedSheets?.comp_calls || '';
  set(els.compCallsFileName, state.data.comp_calls.fileName ? `${state.data.comp_calls.fileName}${compSheet?' · '+compSheet:''}` : state.books.comp_calls.fileName);
  set(els.packagedFileName, state.books.packaged.fileName ? `${state.books.packaged.fileName} · cached` : '');
  const area=els.rosterReassignmentArea?.value||'retail', areaData=state.data?.[area]||{};
  set(els.rosterReassignmentFileName, areaData.rosterFileName ? `${areaData.rosterFileName} · active roster override · ${(areaData.controlRoster||[]).length.toLocaleString()} representatives` : '');
}

function renderAllStarAfterDataBatch({sourcesChanged=[],teamsChanged=false,aliasesChanged=false,reason='data batch'}={}){
  if(state.lifecycle?.closing) return false;
  const changed=new Set(sourcesChanged||[]);
  restoreImportFileLabels();
  if(changed.size || aliasesChanged) renderCustomSourcesList();
  if(changed.size) renderCategorizedSummary();
  if(teamsChanged || [...changed].some(source=>source.startsWith('retail')||source.startsWith('referral'))) renderTeamTotalsImportControls();
  if(changed.size || teamsChanged || aliasesChanged){ renderModelList(); populateRunModels(); renderTeamSelect(); renderEditModelSafe(); }
  setStatus(); updateResearchCacheBadge();
  state.startup.diagnostics={...(state.startup.diagnostics||{}),fullRenders:Number(state.startup.diagnostics?.fullRenders||0)+1,lastRenderReason:reason};
  return true;
}
function afterImportedDataRestored(reason='local cache loaded', opts={}){
  state.data={...defaultImportedDataState(),...(state.data||{})};
  state.books={...defaultImportedBooksState(),...(state.books||{})};
  state.data.retail.teamTotals=rebuildTeamTotalsIndex(state.data.retail.teamTotals||emptyTeamTotalsDataset('retail'));
  state.data.referral.teamTotals=rebuildTeamTotalsIndex(state.data.referral.teamTotals||emptyTeamTotalsDataset('referral'));
  state.categorized=state.categorized||{nondated:{headers:['Representative','Coach'],rows:[],builtAt:'',sourceStats:[]},dated:{headers:['Representative','Coach','Date'],rows:[],builtAt:'',sourceStats:[]},warnings:[]};
  applyRepAliasMappingsToAllRows(); markDataIndexDirty(reason); state.teamIndexCache=buildCompactTeamIndexFromRows(reason); selectiveResearchInvalidation({reason,aliases:true,teams:true,mappings:true,silent:!!opts.deferRender});
  if(!opts.deferRender) renderAllStarAfterDataBatch({sourcesChanged:allSourceKeys(),teamsChanged:true,aliasesChanged:true,reason});
}
async function loadImportedDataFromIndexedDB(opts={}){
  const generation=Number(opts.generation??state.lifecycle?.generation??0);
  const stillActive=()=>!state.lifecycle?.closing && !state.lifecycle?.hidden && generation===Number(state.lifecycle?.generation||0);
  if(state.importCacheSaving || !stillActive()) return false;
  state.importCacheLoading=true; state.importCache.status='loading';
  if(opts.showProgress) showProgress('Loading local IndexedDB import cache...',6);
  let db;
  try{
    db=await importCacheOpenDb();
    const tx=db.transaction([IMPORT_CACHE_META_STORE,IMPORT_CACHE_SOURCE_STORE,IMPORT_CACHE_BOOK_STORE,IMPORT_CACHE_MISC_STORE],'readonly');
    const metaStore=tx.objectStore(IMPORT_CACHE_META_STORE), sourceStore=tx.objectStore(IMPORT_CACHE_SOURCE_STORE), bookStore=tx.objectStore(IMPORT_CACHE_BOOK_STORE), miscStore=tx.objectStore(IMPORT_CACHE_MISC_STORE);
    const meta=await idbReq(metaStore.get('current'));
    if(!stillActive()) return false;
    if(!meta){ state.importCache.status='empty'; if(opts.showProgress) hideProgress(); if(!opts.deferRender) await renderImportCacheStatus(); if(opts.alert) alert('No local IndexedDB import cache has been saved yet.'); return false; }
    if(opts.showProgress) updateProgress('Loading cached source rows...',28);
    const sourceRecords=await idbReq(sourceStore.getAll());
    if(!stillActive()) return false;
    if(opts.showProgress) updateProgress('Loading cached workbook metadata...',54);
    const bookRecords=await idbReq(bookStore.getAll());
    if(!stillActive()) return false;
    if(opts.showProgress) updateProgress('Restoring categorized/custom sources...',76);
    const categorized=await idbReq(miscStore.get('categorized'));
    const customSources=await idbReq(miscStore.get('customSources'));
    const teamIndex=await idbReq(miscStore.get('teamIndex'));
    const sourceMeta=await idbReq(miscStore.get('sourceMeta'));
    const sourceSettings=await idbReq(miscStore.get('sourceSettings'));
    const aliases=await idbReq(miscStore.get('aliases'));
    const manifest=await idbReq(miscStore.get('manifest'));
    if(!stillActive()) return false;
    const nextData=defaultImportedDataState();
    const customData={};
    const legacySourceRecordIds=hydrateSourceCacheRecords(nextData,sourceRecords,customData);
    if(Number(meta.controlRosterSchemaVersion||0)<CONTROL_ROSTER_SCHEMA_VERSION){
      if(nextData.retail) nextData.retail.controlRoster=[];
      if(nextData.referral) nextData.referral.controlRoster=[];
      state.importCache.lastError='Cached Control rosters used an older schema and were discarded; re-upload or rebuild from Control before categorizing.';
    }
    const nextBooks=defaultImportedBooksState();
    const legacyBookRecords=[];
    bookRecords.forEach(r=>{
      if(!r?.id) return;
      if(r.type==='sheet' || String(r.id).startsWith('sheet:')) return;
      if(r.type==='book' || String(r.id).startsWith('book:')){ const key=r.bookKey||String(r.id).slice(5); nextBooks[key]={...(nextBooks[key]||{}),...(r.value||{}),aoaBySheet:{}}; return; }
      legacyBookRecords.push(r); if(r.id) nextBooks[r.id]={...(nextBooks[r.id]||{}),...(r.value||{})};
    });
    // Migration path: legacy book records with aoaBySheet load correctly, are marked as
    // dirty sheet records, and get one scheduled schema save instead of being discarded.
    let migrated=legacySourceRecordIds.length>0;
    legacyBookRecords.forEach(r=>{ const sheets=r.value?.aoaBySheet||{}; Object.keys(sheets).forEach(sn=>{ markImportCacheDirty('sheet',`${r.id}:${sn}`,'legacy workbook sheet migration'); migrated=true; }); markImportCacheDirty('book',r.id,'legacy workbook metadata migration'); });
    state.data=nextData; state.books=nextBooks; state.customSources=Array.isArray(customSources?.value) ? customSources.value.map(c=>({...c,headers:customData[c.sourceKey]?.headers||c.headers||[],rows:customData[c.sourceKey]?.rows||c.rows||[],aoaBySheet:{}})) : []; Object.entries(customData).forEach(([key,val])=>{ if(!customSource(key)) state.customSources.push({...val,sourceKey:key,aoaBySheet:{}}); }); state.categorized=categorized?.value || state.categorized; state.teamIndexCache=restoreTeamIndex(teamIndex?.value); state.sourceMeta=sourceMeta?.value || meta.sourceMeta || {}; if(sourceSettings?.value) mergeSourceSettingsFromImportCache(sourceSettings.value); if(aliases?.value) restoreAliasesFromImportCache(aliases.value); state.importCache.meta={...meta,manifest:manifest?.value||meta.manifest}; state.importCache.generationId=state.importCache.meta.generationId||state.importCache.meta.manifest?.generationId||''; state.importCache.revision=Number(state.importCache.meta.revision||state.importCache.meta.manifest?.revision||0); state.importCache.status='loaded';
    const teamTotalsBefore=[teamTotalsPersistedIdentitySignature(state.data.retail.teamTotals),teamTotalsPersistedIdentitySignature(state.data.referral.teamTotals)];
    const teamTotalsIdentityMigrated=[state.data.retail.teamTotals,state.data.referral.teamTotals].some(ds=>(ds?.rows||[]).length && Number(ds.identitySchemaVersion||0)<TEAM_TOTAL_IDENTITY_SCHEMA_VERSION);
    revalidateRepAliases();
    state.data.retail.teamTotals=rebuildTeamTotalsIndex(state.data.retail.teamTotals||emptyTeamTotalsDataset('retail')); state.data.referral.teamTotals=rebuildTeamTotalsIndex(state.data.referral.teamTotals||emptyTeamTotalsDataset('referral')); afterImportedDataRestored('local IndexedDB import cache loaded',{deferRender:!!opts.deferRender}); if(!opts.deferRender) renderTeamTotalsImportControls();
    const teamTotalsIdentityChanged=teamTotalsBefore.some((signature,i)=>signature!==teamTotalsPersistedIdentitySignature(i===0?state.data.retail.teamTotals:state.data.referral.teamTotals));
    clearImportCacheDirty();
    legacySourceRecordIds.forEach(id=>markImportCacheDirty('deletedSource',id,'obsolete aggregate source cache migrated'));
    const compactedPackageCache=compactPackagedWorkbookViews({markDirty:true});
    if(Number(meta.version||0)<IMPORT_CACHE_SCHEMA_VERSION || migrated || compactedPackageCache){ ['retail:metadata','retail:sv2','retail:wiper','retail:controlRoster','retail:teamTotals','referral:metadata','referral:sv2','referral:wiper','referral:itac','referral:controlRoster','referral:teamTotals'].forEach(k=>markImportCacheDirty('source',k,'schema v8 migration')); markImportCacheDirty('misc','customSources','schema v8 migration'); markImportCacheDirty('misc','manifest','schema v8 migration'); migrated=true; }
    if(teamTotalsIdentityMigrated || teamTotalsIdentityChanged){ ['retail:teamTotals','referral:teamTotals'].forEach(k=>markImportCacheDirty('source',k,'canonical Team Totals coach-name migration')); migrated=true; }
    if(migrated){ legacyBookRecords.forEach(r=>{ markBookCacheDirty(r.id,'legacy cache migrated to sheet records'); }); if(!opts.deferRender) scheduleImportedDataSave(compactedPackageCache?'compacting duplicated packaged workbook cache':'legacy cache migrated to sheet records',{delay:500}); }
    if(opts.showProgress) updateProgress('Local data loaded',100,{force:true});
    if(opts.showProgress) setTimeout(hideProgress,250);
    if(!opts.deferRender) await renderImportCacheStatus(migrated?'Loaded and scheduled one cache migration save.':'Loaded local IndexedDB data.');
    if(opts.alert) alert('Local IndexedDB data loaded.');
    return true;
  }catch(err){
    console.error('[Import Cache] Load failed',err);
    state.importCache.status='error'; state.importCache.lastError=String(err?.message||err);
    if(opts.showProgress) hideProgress();
    if(!opts.deferRender) await renderImportCacheStatus('Local cache load failed: '+state.importCache.lastError);
    if(opts.alert) alert('Could not load local IndexedDB data.');
    return false;
  }finally{
    if(db) db.close();
    state.importCacheLoading=false;
    if(state.importCachePostLoadSave && state.importCache.status==='loaded' && importCacheHasDirty()){
      state.importCachePostLoadSave=false;
      scheduleImportedDataSave('post-load cache migration',{delay:250});
    }else state.importCachePostLoadSave=false;
  }
}
async function clearImportedDataIndexedDB(){
  if(!confirm('Clear the saved local IndexedDB import cache? This does not remove the data currently visible on screen until you refresh or import new data.')) return false;
  let db;
  try{
    db=await importCacheOpenDb();
    const tx=db.transaction([IMPORT_CACHE_META_STORE,IMPORT_CACHE_SOURCE_STORE,IMPORT_CACHE_BOOK_STORE,IMPORT_CACHE_MISC_STORE],'readwrite');
    const done=idbTxDone(tx); state.importCacheSavePromise=done;
    tx.objectStore(IMPORT_CACHE_META_STORE).clear(); tx.objectStore(IMPORT_CACHE_SOURCE_STORE).clear(); tx.objectStore(IMPORT_CACHE_BOOK_STORE).clear(); tx.objectStore(IMPORT_CACHE_MISC_STORE).clear();
    await done;
    state.importCache.meta=null; state.importCache.status='empty'; state.importCache.lastError='';
    await renderImportCacheStatus('Cleared local IndexedDB import cache.');
    return true;
  }catch(err){
    console.error('[Import Cache] Clear failed',err);
    await renderImportCacheStatus('Could not clear local cache: '+String(err?.message||err));
    return false;
  }finally{ if(db) db.close(); }
}
async function requestImportCachePersistence(){
  if(!navigator.storage?.persist){ alert('This browser does not expose persistent storage requests. IndexedDB can still work, but browser cleanup rules may apply.'); return false; }
  try{
    const already=await navigator.storage.persisted?.();
    const granted=already || await navigator.storage.persist();
    await renderImportCacheStatus(granted ? 'Persistent storage is enabled for this report.' : 'Persistent storage was not granted by the browser.');
    alert(granted ? 'Persistent storage is enabled for this report.' : 'The browser did not grant persistent storage. The cache can still save, but may be easier for the browser to clear under storage pressure.');
    return granted;
  }catch(err){ console.error('[Import Cache] Persistence request failed',err); alert('Persistent storage request failed.'); return false; }
}
async function loadImportCacheOnStartup(opts={}){
  try{
    const meta=await importCacheReadMeta();
    state.importCache.meta=meta||null;
    if(!opts.deferRender) await renderImportCacheStatus(meta ? 'Found saved local import data. Loading it automatically...' : 'No saved local import data yet.');
    if(!meta) return false;
    const loaded=await loadImportedDataFromIndexedDB({showProgress:!!opts.showProgress,deferRender:!!opts.deferRender,generation:opts.generation});
    if(loaded && !opts.deferRender) await renderImportCacheStatus('Automatically loaded the last valid local import cache.');
    return loaded;
  }catch(err){
    console.warn('[Import Cache] Startup check failed',err);
    state.importCache.status='error'; state.importCache.lastError=String(err?.message||err);
    if(!opts.deferRender) await renderImportCacheStatus('Could not check or auto-load local IndexedDB cache: '+state.importCache.lastError);
    return false;
  }
}
