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
  if(job?.cancelled&&!job.committed) throw Object.assign(new Error(job.cancelReason||`${job.label} import stopped during ${job.stage}.`),{cancelled:true});
}
function cancelAllStarImport(reason='Import cancelled. The previous data was kept.'){
  const job=state.activeImportJob;
  if(!job || job.committed) return false;
  job.cancelReason=reason; job.cancelled=true;
  if(state.coachToolsBatchImportRunning) state.coachToolsBatchImportCancelled=true;
  job.cancelRead?.();
  try{job.transaction?.abort();}catch(_){}
  return true;
}
function allStarImportSources(source){
  if(source==='packaged') return state.activeImportJob?.packageSources||[];
  return source==='monthly'?['retail_sv2','retail_wiper','retail_team_totals','referral_sv2','referral_wiper','referral_team_totals']:source==='retail'?['retail_sv2','retail_wiper','retail_team_totals']:source==='referral'?['referral_sv2','referral_wiper','referral_team_totals']:[source];
}
async function runAllStarImport(source,file,options,loader){
  if(state.activeImportJob || state.coachRenameActive || state.reportingDataClearing || state.centralSyncStageActive || state.importCacheLoading || state.startup?.running){
    console.warn('Duplicate Allstar import prevented',{source,origin:'individual upload',activeJob:state.activeImportJob?.id,activeOrigin:state.activeImportJob?.origin||'hydration'});
    return false;
  }
  const job={id:`allstar-import-${source}-${Date.now()}-${id()}`,source,label:options.label||labelSource(source),filename:file.name,fileSize:Number(file.size)||0,fingerprint:[source,file.name,file.size,file.lastModified].join('|'),origin:'individual upload',events:[],parsed:0,normalized:0,stored:0,lastProgressAt:Date.now()};
  state.activeImportJob=job;
  const controls=[...document.querySelectorAll('#importModal input, #importModal button')].filter(node=>!node.dataset.close && node.id!=='allstarCancelImportBtn');
  const disabled=controls.map(node=>[node,node.disabled]); controls.forEach(node=>node.disabled=true);
  let stage,committed=false,watchdog;
  const background=el('dataLayoutToggle')?.getAttribute?.('aria-pressed')==='true';
  els.loadingOverlay?.classList.toggle('backgroundImport',background);
  showProgress(`Reading ${job.label}…`,0);
  const cancelButton=el('allstarCancelImportBtn');
  if(cancelButton){cancelButton.hidden=false;cancelButton.disabled=false;cancelButton.onclick=()=>cancelAllStarImport();}
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
      if(state.lifecycle?.closing || state.lifecycle?.hidden) cancelAllStarImport('Import stopped because the application was closed or hidden. The previous data was kept.');
      else if(Date.now()-job.lastProgressAt>60000) cancelAllStarImport(`${job.label} import stopped during ${job.stage}: no progress for 60 seconds. Retry the upload.`);
    },1000);
    importJobStage(job,'Parsing and normalizing');
    const ok=await loader({...options,batch:true,render:false,persist:false,manageProgress:false,throwErrors:true});
    if(!ok) throw new Error('Source processing did not complete.');
    assertAllStarImportActive();
    const sources=allStarImportSources(source);
    if(typeof applyRememberedCoachCorrections==='function') await applyRememberedCoachCorrections({sources,token:job});
    assertAllStarImportActive();
    const total=sources.reduce((count,key)=>count+(getRowsRaw(key)||[]).length,0);
    if(!total&&!options.allowEmpty) throw new Error('No usable rows were found. Check the workbook and source mappings.');
    job.normalized=job.normalized||total;
    job.parsed=job.parsed||total;
    for(const key of sources){
      state.sourceMeta[key]={...(state.sourceMeta[key]||{}),importJobId:job.id,status:'ready',parsedRows:job.parsed,normalizedRows:(getRowsRaw(key)||[]).length,lastImportedAt:new Date().toISOString(),allstarDataSchemaVersion,allstarSourceMappingVersion};
    }
    markImportCacheDirty('misc','sourceSettings','import source mappings');
    markDataIndexDirty(`${job.label} imported`,{sources});
    if(source==='retail'||source==='referral'||source==='monthly'||source==='packaged'){ bumpVersion('roster'); invalidateRosterIndex(`${source} import`); state.teamIndexCache=null; }
    importJobStage(job,'Saving'); updateProgress(`Saving ${job.label}…`,80,{force:true});
    const saved=await saveImportedDataToIndexedDB(`${job.id} complete`,{silent:true,dirtyOnly:true,noCompaction:true,noRender:true,deferIndexes:true,verifySources:sources,importJob:job,noRetry:true});
    if(!saved) throw new Error(state.importCache.lastError||'IndexedDB replacement did not commit.');
    clearInterval(watchdog);
    committed=true; job.committed=true;
    try{await options.onCommitted?.(job);}catch(error){job.warning='The data was saved. Settings will recover from the saved package when reopened.';console.warn(job.warning,error);}
    job.stored=total;
    importJobStage(job,'Complete');
    updateProgress(`${job.label} saved and verified`,100,{force:true});
    const message=`${job.label} — Complete · Parsed: ${job.parsed.toLocaleString()} · Normalized: ${job.normalized.toLocaleString()} · Excluded: ${Math.max(0,job.parsed-job.normalized).toLocaleString()} · Stored: ${job.stored.toLocaleString()}`;
    const node=el('allstarImportStatus'); if(node) node.textContent=message;
    state.importJobHistory=[...(state.importJobHistory||[]),{...job,transaction:undefined,cancelRead:undefined}].slice(-20);
    try{ restoreImportFileLabels(); setStatus(); if(els.editModelModal?.classList.contains('open')) renderEditModelSafe(); if(els.runModal?.classList.contains('open')) renderTeamSelect(); renderCategorizedSummary(); }catch(error){ console.warn('Allstar import saved; display refresh failed.',error); }
    return true;
  }catch(error){
    if(!committed) stage?.rollback();
    job.error=String(error?.message||error);
    options.onError?.(error);
    importJobStage(job,`${error?.cancelled||job.cancelled?'Cancelled':'Failed'}: ${job.error}`);
    restoreImportFileLabels(); updateCategorizeImportButton();
    if(!options.silent && !error?.cancelled && !job.cancelled) alert(`${job.label} import failed: ${job.error} The previous source was kept. Retry the upload.`);
    return false;
  }finally{
    clearInterval(watchdog);
    state.activeImportJob=null;
    if(cancelButton) cancelButton.hidden=true;
    els.loadingOverlay?.classList.remove('backgroundImport');
    disabled.forEach(([node,value])=>node.disabled=value);
    updateCategorizeImportButton(); hideProgress();
  }
}

async function readAllStarFileBuffer(file,job=state.activeImportJob){
  const check=()=>{if(job?.cancelled)throw Object.assign(new Error('File reading canceled.'),{cancelled:true});assertAllStarImportActive();};
  if(typeof FileReader==='undefined' || typeof Blob==='undefined' || !(file instanceof Blob)){
    const buffer=await file.arrayBuffer(); check(); return buffer;
  }
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    const cleanup=()=>{ if(job) job.cancelRead=null; };
    reader.onload=()=>{cleanup();try{check();resolve(reader.result);}catch(error){reject(error);}};
    reader.onerror=()=>{cleanup();reject(reader.error||new Error('File reading failed.'));};
    reader.onabort=()=>{cleanup();reject(Object.assign(new Error(job?.cancelReason||'File reading stopped before completion.'),{cancelled:!!job?.cancelled}));};
    if(job) job.cancelRead=()=>reader.abort();
    reader.readAsArrayBuffer(file);
  });
}
function allStarMonthlyTextWorkbook(buffer,monthly){
  if(!monthly) return null;
  // XLSX/ODS ZIP and legacy OLE workbooks cannot be monthly delimited text.
  const bytes=new Uint8Array(buffer,0,Math.min(buffer.byteLength,4));
  if((bytes[0]===0x50 && bytes[1]===0x4b)||(bytes[0]===0xd0 && bytes[1]===0xcf)) return null;
  try{
    const text=monthly.decode(buffer);
    // Detect from a small prefix before allocating a second full row array for
    // ordinary CSV imports. Headers of monthly exports occur in the first rows.
    const prefix=text.slice(0,65536), lineEnd=prefix.lastIndexOf('\n');
    const sample=monthly.delimited(prefix.length<text.length&&lineEnd>=0?prefix.slice(0,lineEnd):prefix);
    if(monthly.detect(sample)) return {SheetNames:['Monthly Export'],Sheets:{},__coachToolsAoaBySheet:{'Monthly Export':monthly.delimited(text)}};
  }catch(_){}
  return null;
}
function readAllStarWorkerWorkbook(buffer,options,monthly){
  if(options.allstarSharedFile){
    if(options.allstarSharedFile.csv){
      let text;try{text=monthly?monthly.decode(buffer):new TextDecoder().decode(buffer);}catch(_){text=new TextDecoder().decode(buffer);}
      if(monthly){
        let rows=[];try{rows=monthly.delimited(text);}catch(error){if(/OPPORTUNITY_LATEST_SEGMENT|EMPLOYEE_FULL_NAME/.test(text.slice(0,1000)))throw error;}
        if(monthly.detect(rows)){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Monthly Export');return wb;}
      }
      // Match the shared reader exactly: date-labelled weekly CSV keeps ISO
      // source dates as text, while ordinary exports retain SheetJS inference.
      const headings=text.split(/\r?\n/).slice(0,40).join('\n');
      const weekly=/\bweekly\b/i.test(options.allstarSharedFile.name)||/(?:^|[,\t;])\s*"?(?:Date|Stats Date|Report Date|Week Date)"?\s*(?:[,\t;]|$)/im.test(headings)&&/(?:^|[,\t;])\s*"?(?:Name|Representative|Agent Name|Associate Name)"?\s*(?:[,\t;]|$)/im.test(headings);
      return XLSX.read(text,{type:'string',cellNF:true,raw:weekly});
    }
    return XLSX.read(buffer,{type:'array',cellNF:true});
  }
  return allStarMonthlyTextWorkbook(buffer,monthly)||XLSX.read(buffer,options);
}
function allStarPreviewWorkbook(workbook){
  const preview={SheetNames:workbook.SheetNames,Sheets:{},Props:workbook.Props,__ranges:{}};
  for(const name of workbook.SheetNames){
    const sheet=workbook.Sheets[name],ref=sheet?.['!ref'];
    const copy={};preview.Sheets[name]=copy;
    if(!ref)continue;
    const range=XLSX.utils.decode_range(ref);
    preview.__ranges[name]=range;
    const end={r:Math.min(59,range.e.r),c:Math.min(1023,range.e.c)};
    copy['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:end});
    for(let r=0;r<=end.r;r++)for(let c=0;c<=end.c;c++){
      const key=XLSX.utils.encode_cell({r,c});
      if(sheet[key])copy[key]=sheet[key];
    }
  }
  return preview;
}
function allStarWorkbookWorker(){
  let acknowledge;
  const send=message=>new Promise(resolve=>{acknowledge=resolve;self.postMessage(message);});
  self.onmessage=async function(event){
    if(event.data.ack){acknowledge?.();return;}
    try{
      const options=event.data.options,workbook=readAllStarWorkerWorkbook(event.data.buffer,options,self.CoachToolsMonthly);
      if(options.allstarDiscovery){self.postMessage({workbook:allStarPreviewWorkbook(workbook)});return;}
      self.postMessage({stage:'worksheets',sheetNames:workbook.SheetNames,props:workbook.Props});
      for(let index=0;index<workbook.SheetNames.length;index++){
        const name=workbook.SheetNames[index],worksheet=workbook.Sheets[name];
        if(options.allstarSharedFile){
          // Keep cell types, formats, formulas, and worksheet metadata exact.
          let cells={},count=0,bytes=0,since=performance.now();
          for(const address in worksheet){
            const cell=worksheet[address];cells[address]=cell;count++;
            bytes+=64+address.length*2+(typeof cell?.v==='string'?cell.v.length*2:16)+(cell?.w?.length||0)*2+(cell?.f?.length||0)*2;
            if(count>=2000||bytes>=262144||performance.now()-since>=12){
              await send({sheet:name,cells});cells={};count=bytes=0;since=performance.now();
            }
          }
          await send({sheet:name,cells});delete workbook.Sheets[name];continue;
        }
        const raw=options.raw===true;
        const direct=workbook.__coachToolsAoaBySheet?.[name];
        const range=worksheet?.['!ref']?XLSX.utils.decode_range(worksheet['!ref']):null;
        const first=raw?0:range?.s.r||0;
        const length=direct?.length??(range?range.e.r-first+1:0);
        // Bound the values materialized at once even for wide workbooks.
        const windowRows=Math.max(1,Math.min(2000,Math.floor(8192/Math.max(1,range?range.e.c-range.s.c+1:1))));
        for(let base=0;base<length;base+=windowRows){
          const limit=Math.min(length,base+windowRows);
          const rows=direct?direct.slice(base,limit):XLSX.utils.sheet_to_json(worksheet,{header:1,defval:'',raw,
            range:{s:{r:first+base,c:range.s.c},e:{r:first+limit-1,c:range.e.c}}});
          for(let offset=0;offset<rows.length;){
            const start=offset,formats={};let bytes=0,since=performance.now();
            do{
              const row=rows[offset];
              for(let c=0;c<row.length;c++){
                bytes+=typeof row[c]==='string'?16+2*row[c].length:16;
                if(raw&&options.cellNF){
                  const local=XLSX.utils.encode_cell({r:base+offset,c});
                  const cell=worksheet?.[XLSX.utils.encode_cell({r:first+base+offset,c:(range?.s.c||0)+c})];
                  if(cell?.z&&/%/.test(cell.z.replace(/"[^"]*"|\\./g,'')))formats[local]={z:cell.z};
                }
              }
              bytes+=32;offset++;
            }while(offset<rows.length&&offset-start<2000&&bytes<262144&&performance.now()-since<12);
            await send({sheet:name,rows:rows.slice(start,offset),formats,progress:10+2*((index+(base+offset)/length)/workbook.SheetNames.length)});
          }
        }
        if(!length)await send({sheet:name,rows:[]});
        delete workbook.Sheets[name];
      }
      self.postMessage({complete:true});
    }catch(error){self.postMessage({error:String(error.message||error)});}
  };
}


async function parseAllStarWorkbook(buffer,parseOptions={},job=state.activeImportJob){
  assertAllStarImportActive();
  if(job?.cancelled)throw Object.assign(new Error('Workbook parsing canceled.'),{cancelled:true});
  const readOptions={type:'array',cellDates:true,raw:false,...parseOptions};
  // Keep large SheetJS parsing off the UI thread. Portable builds contain the
  // same vendor source inline; hosted builds resolve their bundled vendor URL.
  const fallback=()=>{const wb=readAllStarWorkerWorkbook(buffer,readOptions,typeof window!=='undefined'?window.CoachToolsMonthly:null);return readOptions.allstarDiscovery?allStarPreviewWorkbook(wb):wb;};
  if(typeof Worker==='undefined' || typeof Blob==='undefined') return fallback();
  const embedded=document.querySelector('script[data-allstar-vendor="xlsx.full.min.js"]');
  const carried=typeof window!=='undefined'?window.__ALLSTAR_IMPORT_WORKER_LIBRARIES__:null;
  // Blob workers cannot import a file:// dependency in desktop browsers.
  // Choose the already-loaded page parser before transferring the buffer.
  // Embedded portable builds can still use their self-contained worker.
  if(!embedded?.textContent && !carried?.xlsx && new URL(document.baseURI).protocol==='file:'){
    updateProgress('Parsing local workbook with the loaded spreadsheet library…',10,{force:true});
    await yieldToBrowser();
    assertAllStarImportActive();
    return fallback();
  }
  const monthly=document.querySelector('script[data-coachtools-source="shared/coachtools-monthly.js"]');
  const library=embedded?.textContent || carried?.xlsx || `importScripts(${JSON.stringify(new URL('../../vendor/xlsx.full.min.js',document.baseURI).href)});`;
  const monthlyLibrary=monthly?.textContent || carried?.monthly || (!embedded?.textContent?`importScripts(${JSON.stringify(new URL('../../shared/coachtools-monthly.js',document.baseURI).href)});`:'');
  const code=library+'\n'+monthlyLibrary+'\n'+allStarMonthlyTextWorkbook.toString()+'\n'+readAllStarWorkerWorkbook.toString()+'\n'+allStarPreviewWorkbook.toString()+'\n('+allStarWorkbookWorker.toString()+')();';
  const url=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));
  return new Promise((resolve,reject)=>{
    let worker, settled=false, workbook={SheetNames:[],Sheets:{},__coachToolsAoaBySheet:{}};
    let timeout;
    const resetTimeout=()=>{clearTimeout(timeout);timeout=setTimeout(()=>{cleanup();reject(new Error('Workbook parser stopped responding after 60 seconds.'));},60000);};
    const cleanup=()=>{if(settled)return;settled=true;clearTimeout(timeout);if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();}URL.revokeObjectURL(url);if(job)job.cancelRead=null;};
    try{
      worker=new Worker(url);
      resetTimeout();
      worker.onmessage=event=>{
        if(settled)return;
        const message=event.data;
        resetTimeout();
        if(job) job.lastProgressAt=Date.now();
        if(message.error){cleanup();reject(new Error(message.error));return;}
        if(message.workbook){cleanup();resolve(message.workbook);return;}
        if(message.stage==='worksheets'){workbook.SheetNames=message.sheetNames;workbook.Props=message.props;}
        if(message.cells){
          Object.assign(workbook.Sheets[message.sheet]||(workbook.Sheets[message.sheet]={}),message.cells);
          worker.postMessage({ack:true});
        }else if(message.sheet){
          const rows=workbook.__coachToolsAoaBySheet[message.sheet]||(workbook.__coachToolsAoaBySheet[message.sheet]=[]);
          for(const row of message.rows) rows.push(row);
          if(message.formats&&Object.keys(message.formats).length) Object.assign(workbook.Sheets[message.sheet]||(workbook.Sheets[message.sheet]={}),message.formats);
          updateProgress(`Reading worksheet ${message.sheet} · ${rows.length.toLocaleString()} rows`,message.progress||10);
        }
        if(message.rows)worker.postMessage({ack:true});
        if(message.complete){if(readOptions.allstarSharedFile)delete workbook.__coachToolsAoaBySheet;cleanup();resolve(workbook);}
      };
      worker.onerror=event=>{cleanup();reject(new Error(event.message||'Workbook parser worker failed.'));};
      if(job) job.cancelRead=()=>{cleanup();reject(Object.assign(new Error(job.cancelReason||'Workbook parser cancelled.'),{cancelled:true}));};
      worker.postMessage({buffer,options:readOptions},[buffer]);
    }catch(error){
      cleanup();
      if(!worker&&buffer.byteLength&&!job?.cancelled)resolve(Promise.resolve().then(fallback));
      else reject(error);
    }
  });
}
