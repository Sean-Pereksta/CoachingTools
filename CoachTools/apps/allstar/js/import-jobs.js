/* Single-owner manual intake. Existing Retail/Referral adapters remain unchanged. */
'use strict';
function updateCategorizeImportButton(){
  const button=els.categorizeDataBtn;
  if(!button) return;
  const pending=categorizationIsStale();
  button.classList.toggle('needsCategorization',pending);
  button.textContent=pending?'✨ Categorize Data':'Categorize Data';
  button.disabled=!!state.activeImportJob;
}
function importJobStage(job,stage){
  job.stage=stage;
  job.lastProgressAt=Date.now();
  const sourceNode=job.source==='retail'?els.retailFileName:job.source==='referral'?els.referralFileName:sourceNameElement(job.source);
  if(sourceNode) sourceNode.textContent=`${job.filename} · ${stage}`;
  job.events.push({stage,at:new Date().toISOString()});
  console.info('[Allstar import]',{id:job.id,source:job.source,filename:job.filename,fileSize:job.fileSize,stage,parsed:job.parsed,normalized:job.normalized,stored:job.stored});
  const node=el('allstarImportStatus');
  if(node) node.textContent=`${job.label} — ${stage}`;
}
function assertAllStarImportActive(){
  const job=state.activeImportJob;
  if(job?.cancelled) throw new Error(`${job.label} import stopped during ${job.stage}: no progress for 60 seconds. Retry the upload.`);
}
function allStarImportSources(source){
  return source==='retail'?['retail_sv2','retail_wiper','retail_team_totals']:source==='referral'?['referral_sv2','referral_wiper','referral_team_totals']:[source];
}
async function runAllStarImport(source,file,options,loader){
  if(state.activeImportJob || state.centralSyncStageActive || state.importCacheLoading || state.startup?.running){
    console.warn('Duplicate Allstar import prevented',{source,origin:'individual upload',activeJob:state.activeImportJob?.id,activeOrigin:state.activeImportJob?.origin||'hydration'});
    return false;
  }
  const job={id:`allstar-import-${source}-${Date.now()}-${id()}`,source,label:options.label||labelSource(source),filename:file.name,fileSize:Number(file.size)||0,fingerprint:[source,file.name,file.size,file.lastModified].join('|'),origin:'individual upload',events:[],parsed:0,normalized:0,stored:0,lastProgressAt:Date.now()};
  state.activeImportJob=job;
  const controls=[...document.querySelectorAll('#importModal input, #importModal button')].filter(node=>!node.dataset.close);
  const disabled=controls.map(node=>[node,node.disabled]); controls.forEach(node=>node.disabled=true);
  let stage,committed=false,watchdog;
  showProgress(`Reading ${job.label}…`,0);
  try{
    // Drain previous saves before creating the staged view. Never mistake an
    // in-flight transaction for completion of this new import.
    importJobStage(job,'Waiting for previous save');
    if(state.importCacheSavePromise) await state.importCacheSavePromise;
    if(state.importCacheSaveTimer){ clearTimeout(state.importCacheSaveTimer); state.importCacheSaveTimer=null; }
    if(importCacheHasDirty()){
      const saved=await saveImportedDataToIndexedDB('before individual import',{silent:true,dirtyOnly:true,noCompaction:true,noRender:true,deferIndexes:true});
      if(!saved) throw new Error(state.importCache.lastError||'Previous edits could not be saved.');
    }
    stage=beginAllStarCentralStage();
    const editModel=state.editModel, customSources=state.customSources;
    state.editModel=editModel?clonePlain(editModel):editModel;
    state.customSources=(customSources||[]).map(value=>({...value}));
    const rollback=stage.rollback;
    stage.rollback=()=>{ rollback(); state.editModel=editModel; state.customSources=customSources; };
    watchdog=setInterval(()=>{
      if(state.lifecycle?.closing || state.lifecycle?.hidden || Date.now()-job.lastProgressAt>60000){ job.cancelled=true; job.cancelRead?.(); try{job.transaction?.abort();}catch(_){} }
    },1000);
    importJobStage(job,'Parsing and normalizing');
    const ok=await loader({...options,batch:true,render:false,persist:false,manageProgress:false,throwErrors:true});
    if(!ok) throw new Error('Source processing did not complete.');
    assertAllStarImportActive();
    const sources=allStarImportSources(source);
    const total=sources.reduce((count,key)=>count+(getRowsRaw(key)||[]).length,0);
    if(!total) throw new Error('No usable rows were found. Check the workbook and source mappings.');
    job.normalized=job.normalized||total;
    job.parsed=job.parsed||total;
    for(const key of sources){
      state.sourceMeta[key]={...(state.sourceMeta[key]||{}),importJobId:job.id,status:'ready',parsedRows:job.parsed,normalizedRows:(getRowsRaw(key)||[]).length,lastImportedAt:new Date().toISOString(),allstarDataSchemaVersion,allstarSourceMappingVersion};
    }
    markImportCacheDirty('misc','sourceSettings','import source mappings');
    markDataIndexDirty(`${job.label} imported`,{sources});
    if(source==='retail'||source==='referral'){ bumpVersion('roster'); invalidateRosterIndex(`${source} import`); state.teamIndexCache=null; }
    importJobStage(job,'Saving'); updateProgress(`Saving ${job.label}…`,80,{force:true});
    const saved=await saveImportedDataToIndexedDB(`${job.id} complete`,{silent:true,dirtyOnly:true,noCompaction:true,noRender:true,deferIndexes:true,verifySources:sources,importJob:job,noRetry:true});
    if(!saved) throw new Error(state.importCache.lastError||'IndexedDB replacement did not commit.');
    clearInterval(watchdog);
    committed=true;
    job.stored=total;
    importJobStage(job,'Complete');
    updateProgress(`${job.label} saved and verified`,100,{force:true});
    const message=`${job.label} — Complete · Parsed: ${job.parsed.toLocaleString()} · Normalized: ${job.normalized.toLocaleString()} · Excluded: ${Math.max(0,job.parsed-job.normalized).toLocaleString()} · Stored: ${job.stored.toLocaleString()}`;
    const node=el('allstarImportStatus'); if(node) node.textContent=message;
    state.importJobHistory=[...(state.importJobHistory||[]),{...job,transaction:undefined,cancelRead:undefined}].slice(-20);
    try{ restoreImportFileLabels(); setStatus(); renderEditModelSafe(); renderTeamSelect(); renderCategorizedSummary(); }catch(error){ console.warn('Allstar import saved; display refresh failed.',error); }
    return true;
  }catch(error){
    if(!committed) stage?.rollback();
    job.error=String(error?.message||error);
    importJobStage(job,`Failed: ${job.error}`);
    restoreImportFileLabels(); updateCategorizeImportButton();
    if(!options.silent) alert(`${job.label} import failed: ${job.error} The previous source was kept. Retry the upload.`);
    return false;
  }finally{
    clearInterval(watchdog);
    state.activeImportJob=null;
    disabled.forEach(([node,value])=>node.disabled=value);
    updateCategorizeImportButton(); hideProgress();
  }
}

async function readAllStarFileBuffer(file){
  const job=state.activeImportJob;
  if(typeof FileReader==='undefined' || typeof Blob==='undefined' || !(file instanceof Blob)){
    const buffer=await file.arrayBuffer(); assertAllStarImportActive(); return buffer;
  }
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    const cleanup=()=>{ if(job) job.cancelRead=null; };
    reader.onload=()=>{cleanup();resolve(reader.result);};
    reader.onerror=()=>{cleanup();reject(reader.error||new Error('File reading failed.'));};
    reader.onabort=()=>{cleanup();reject(new Error('File reading stopped before completion.'));};
    if(job) job.cancelRead=()=>reader.abort();
    reader.readAsArrayBuffer(file);
  });
}
async function parseAllStarWorkbook(buffer){
  assertAllStarImportActive();
  // Keep large SheetJS parsing off the UI thread. Portable builds contain the
  // same vendor source inline; hosted builds resolve their bundled vendor URL.
  if(typeof Worker==='undefined' || typeof Blob==='undefined') return XLSX.read(buffer,{type:'array',cellDates:true,raw:false});
  const embedded=document.querySelector('script[data-allstar-vendor="xlsx.full.min.js"]');
  // Blob workers cannot import a file:// dependency in desktop browsers.
  // Choose the already-loaded page parser before transferring the buffer.
  // Embedded portable builds can still use their self-contained worker.
  if(!embedded?.textContent && new URL(document.baseURI).protocol==='file:'){
    updateProgress('Parsing local workbook with the loaded spreadsheet library…',10,{force:true});
    await yieldToBrowser();
    assertAllStarImportActive();
    return XLSX.read(buffer,{type:'array',cellDates:true,raw:false});
  }
  const library=embedded?.textContent || `importScripts(${JSON.stringify(new URL('../../vendor/xlsx.full.min.js',document.baseURI).href)});`;
  const code=library+'\nself.onmessage=function(event){try{self.postMessage({workbook:XLSX.read(event.data,{type:"array",cellDates:true,raw:false})});}catch(error){self.postMessage({error:String(error.message||error)});}};';
  const url=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));
  const job=state.activeImportJob;
  return new Promise((resolve,reject)=>{
    let worker;
    const timeout=setTimeout(()=>{cleanup();reject(new Error('Workbook parser stopped responding after 60 seconds.'));},60000);
    const cleanup=()=>{clearTimeout(timeout);worker?.terminate();URL.revokeObjectURL(url);if(job)job.cancelRead=null;};
    try{
      worker=new Worker(url);
      worker.onmessage=event=>{cleanup();event.data.error?reject(new Error(event.data.error)):resolve(event.data.workbook);};
      worker.onerror=event=>{cleanup();reject(new Error(event.message||'Workbook parser worker failed.'));};
      if(job) job.cancelRead=()=>{cleanup();reject(new Error('Workbook parser stopped responding.'));};
      worker.postMessage(buffer,[buffer]);
    }catch(error){cleanup();reject(error);}
  });
}
