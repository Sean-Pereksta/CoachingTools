/* All-Star to Qualtrics iframe bridge and local-file-safe generator loader.
 * Behavior-preserving extraction from the definitive All-Star application.
 */
'use strict';

function qualtricsStatSourceChoices(){
  const out=[{key:'auto',label:'Auto — weekly custom source first, otherwise combined Retail + Referral SV2'},{key:'combined_sv2',label:'Combined Retail + Referral SV2'}];
  if((state.data.retail.sv2||[]).length) out.push({key:'retail_sv2',label:`Retail SV2 (${state.data.retail.sv2.length.toLocaleString()} rows)`});
  if((state.data.referral.sv2||[]).length) out.push({key:'referral_sv2',label:`Referral SV2 (${state.data.referral.sv2.length.toLocaleString()} rows)`});
  (state.customSources||[]).filter(c=>(c.rows||[]).length).sort((a,b)=>{ const aw=isCustomWeeklyStatSource(a.sourceKey)?0:1,bw=isCustomWeeklyStatSource(b.sourceKey)?0:1; return aw-bw||String(a.name||'').localeCompare(String(b.name||'')); }).forEach(c=>out.push({key:c.sourceKey,label:`${c.name||c.displayName||c.sourceKey}${isCustomWeeklyStatSource(c.sourceKey)?' — Weekly Stat File':''} (${(c.rows||[]).length.toLocaleString()} rows)`}));
  return out;
}
function populateQualtricsStatsSources(){
  if(!els.qualtricsStatsSource) return; const choices=qualtricsStatSourceChoices(), previous=els.qualtricsStatsSource.value||state.savedQualtricsStatsSource||'auto';
  els.qualtricsStatsSource.innerHTML=choices.map(x=>`<option value="${esc(x.key)}">${esc(x.label)}</option>`).join(''); els.qualtricsStatsSource.value=choices.some(x=>x.key===previous)?previous:'auto';
}
function qualtricsStatRows(selection){
  const customWeekly=(state.customSources||[]).filter(c=>(c.rows||[]).length&&isCustomWeeklyStatSource(c.sourceKey)).sort((a,b)=>(b.rows||[]).length-(a.rows||[]).length)[0];
  let key=selection||'auto'; if(key==='auto') key=customWeekly?.sourceKey||'combined_sv2';
  if(key==='combined_sv2') return {key,label:'Combined Retail + Referral SV2',rows:[...(state.data.retail.sv2||[]),...(state.data.referral.sv2||[])]};
  if(key==='retail_sv2') return {key,label:'Retail SV2',rows:state.data.retail.sv2||[]}; if(key==='referral_sv2') return {key,label:'Referral SV2',rows:state.data.referral.sv2||[]};
  const custom=customSource(key); return custom?{key,label:custom.name||custom.displayName||key,rows:custom.rows||[]}:{key:'combined_sv2',label:'Combined Retail + Referral SV2',rows:[...(state.data.retail.sv2||[]),...(state.data.referral.sv2||[])]};
}
function bridgeValue(v){ if(v instanceof Date) return isNaN(v)?'':ymd(v); if(typeof v==='number') return Number.isFinite(v)?v:''; if(typeof v==='string'||typeof v==='boolean') return v; if(v==null) return ''; if(Array.isArray(v)) return v.join('; '); return ''; }
function qualtricsBridgeRow(row,kind,sourceLabel=''){
  const out={}; Object.entries(row||{}).forEach(([k,v])=>{ if(k.startsWith('_')) return; const val=bridgeValue(v); if(val!==''||v===0||v===false) out[k]=val; });
  const rep=row?._rep||row?.Representative||row?.['Agent Name']||row?.['Associate Name']||'', team=row?._team||row?.Team||row?.['Team Name']||'', date=row?._date||row?._interactionDate||row?.Date||'';
  const stableRepKey=row?._rosterId||row?._stableRepKey||row?._employeeId||row?._email||'';
  if(stableRepKey&&!out['All-Star Representative Key']) out['All-Star Representative Key']=bridgeValue(stableRepKey);
  if(kind==='qa'){ if(!out['Agent Name']&&rep) out['Agent Name']=rep; if(!out.Team&&team) out.Team=team; if(!out.Coach&&team) out.Coach=team; if(!out['Interaction Start Time']&&date) out['Interaction Start Time']=bridgeValue(date); if(!out['Score %']&&Number.isFinite(row?._score)) out['Score %']=row._score; }
  if(kind==='coaching'){
    if(!out['Associate Name']&&rep) out['Associate Name']=rep; if(!out['Job Coach']&&team) out['Job Coach']=team;
    // The normalized bridge Date always represents the coaching event date.
    const coachingDate=row?.['Coaching Date']||row?.['Documented Coaching Date']||date;
    if(!out.Date&&coachingDate) out.Date=bridgeValue(coachingDate);
  }
  if(kind==='checklist'){ if(!out['Associate Name']&&rep) out['Associate Name']=rep; if(!out['Job Coach']&&team) out['Job Coach']=team; if(!out['Incident Date']&&date) out['Incident Date']=bridgeValue(date); }
  if(kind==='stats'){ if(!out['Agent Name']&&rep) out['Agent Name']=rep; if(!out.Team&&team) out.Team=team; if(!out.Coach&&team) out.Coach=team; if(!out['Date Column']&&date) out['Date Column']=bridgeValue(date); if(sourceLabel) out['All-Star Source']=sourceLabel; }
  return out;
}
function qualtricsBridgeRows(rows,kind,sourceLabel=''){ return (rows||[]).map(row=>qualtricsBridgeRow(row,kind,sourceLabel)).filter(r=>Object.keys(r).length); }
async function qualtricsBridgeRowsDeferred(rows,kind,sourceLabel=''){
  const out=[], source=rows||[];
  for(let i=0;i<source.length;i++){
    const row=qualtricsBridgeRow(source[i],kind,sourceLabel); if(Object.keys(row).length) out.push(row);
    if(i&&i%1500===0) await new Promise(resolve=>setTimeout(resolve,0));
  }
  return out;
}
function qualtricsBridgeHeaders(source,rows,extra=[]){ return [...new Set([...(getHeaders(source)||[]),...extra,...Object.keys((rows||[])[0]||{})])].filter(h=>h&&!String(h).startsWith('_')); }
function qualtricsHireDateSourceCatalog(){
  return allSourceKeys().map(sourceKey=>{
    const rows=getRowsRaw(sourceKey)||[], headers=new Set(getHeaders(sourceKey)||[]);
    for(const row of rows.slice(0,50)) Object.keys(row||{}).forEach(h=>{ if(h&&!String(h).startsWith('_')) headers.add(h); });
    return {key:sourceKey,label:labelSource(sourceKey),headers:[...headers].filter(Boolean),rowCount:rows.length};
  }).filter(source=>source.rowCount||source.headers.length).sort((a,b)=>String(a.label).localeCompare(String(b.label))||String(a.key).localeCompare(String(b.key)));
}
function qualtricsCoreSourceSignature(){
  const sourceSignature=['qa','documented_coaching','checklist'].map(source=>{
    const rows=getRowsRaw(source)||[], meta=state.sourceMeta?.[source]||{}, data=state.data?.[source]||{};
    return `${source}:${meta.version||state.versions?.data||0}:${rows.length}:${getHeaders(source).length}:${data.fileName||''}`;
  }).join('|');
  const orgSignature=(state.orgs||[]).map(o=>`${o.id}:${o.name}:${(o.coachNames||[]).join(',')}`).sort().join(';');
  const lookupSignature=qualtricsHireDateSourceCatalog().map(source=>`${source.key}:${source.rowCount}:${source.headers.join(',')}`).join(';');
  return `${sourceSignature}|orgs:${orgSignature}|lookup:${lookupSignature}`;
}
async function buildQualtricsCorePayload(){
  const rawCoachingRows=state.data.documented_coaching.rows||[];
  const qaRows=await qualtricsBridgeRowsDeferred(state.data.qa.rows||[],'qa');
  const coachingRows=await qualtricsBridgeRowsDeferred(rawCoachingRows,'coaching');
  const checklistRows=await qualtricsBridgeRowsDeferred(state.data.checklist.rows||[],'checklist');
  return {sentAt:new Date().toISOString(),diagnostics:{documentedCoaching:{rawRows:rawCoachingRows.length,normalizedRows:rawCoachingRows.length,bridgeRows:coachingRows.length}},organizations:(state.orgs||[]).map(o=>({id:o.id,name:o.name,coachNames:[...(o.coachNames||[])]})),lookupSources:qualtricsHireDateSourceCatalog(),files:{
    qa:{fileName:state.data.qa.fileName||'All-Star QA',sheetName:'90-day KPI',headers:qualtricsBridgeHeaders('qa',qaRows,['All-Star Representative Key','Agent Name','Team','Coach','Interaction Start Time','Score %']),rows:qaRows},
    coaching:{fileName:state.data.documented_coaching.fileName||'All-Star Documented Coaching',sheetName:'Documented Coaching',headers:qualtricsBridgeHeaders('documented_coaching',coachingRows,['All-Star Representative Key','Associate Name','Job Coach','Date']),rows:coachingRows},
    checklist:{fileName:state.data.checklist.fileName||'All-Star Checklist',sheetName:'Checklist',headers:qualtricsBridgeHeaders('checklist',checklistRows,['All-Star Representative Key','Associate Name','Job Coach','Incident Date']),rows:checklistRows}
  }};
}
async function sendQualtricsHireDateSource(request={}){
  if(!state.qualtricsReady||!els.qualtricsEmailFrame?.contentWindow) return;
  const sourceKey=String(request.sourceKey||''), source=allSourceKeys().includes(sourceKey)?sourceKey:'';
  const requestedRep=String(request.repColumn||''), requestedHire=String(request.hireDateColumn||'');
  if(!source||!requestedRep||!requestedHire){ els.qualtricsEmailFrame.contentWindow.postMessage({type:'allstar-hire-date-source',payload:{requestId:request.requestId||'',sourceKey,repColumn:requestedRep,hireDateColumn:requestedHire,rows:[]}},'*'); return; }
  const repColumn=resolveColumn(source,requestedRep)||requestedRep, hireDateColumn=resolveColumn(source,requestedHire)||requestedHire, rawRows=getRowsRaw(source)||[], rows=[], seen=new Set();
  if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent=`Connecting representative names and hire dates from ${labelSource(source)} without running a report…`;
  for(let i=0;i<rawRows.length;i++){
    const raw=rawRows[i]||{}, repName=bridgeValue(raw[repColumn]), hireDate=bridgeValue(raw[hireDateColumn]);
    if(String(repName??'').trim()||String(hireDate??'').trim()){
      const pair=`${String(repName??'').trim()}\u001f${String(hireDate??'').trim()}`;
      if(!seen.has(pair)){ seen.add(pair); rows.push({repName,hireDate}); }
    }
    if(i&&i%2000===0) await new Promise(resolve=>setTimeout(resolve,0));
  }
  els.qualtricsEmailFrame.contentWindow.postMessage({type:'allstar-hire-date-source',payload:{requestId:request.requestId||'',sourceKey,sourceLabel:labelSource(source),repColumn:requestedRep,hireDateColumn:requestedHire,rows}},'*');
  if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent=`Connected ${rows.length.toLocaleString()} representative/hire-date pair${rows.length===1?'':'s'} from ${labelSource(source)}. No preview or report ran.`;
}
async function buildQualtricsWeeklyPayload(){
  const stats=qualtricsStatRows(els.qualtricsStatsSource?.value||'auto'), rows=await qualtricsBridgeRowsDeferred(stats.rows,'stats',stats.label);
  let headers=[];
  if(stats.key==='combined_sv2') headers=[...(getHeaders('retail_sv2')||[]),...(getHeaders('referral_sv2')||[])]; else headers=getHeaders(stats.key)||[];
  return {sentAt:new Date().toISOString(),statsSource:stats.label,files:{stats:{fileName:`All-Star ${stats.label}`,sheetName:'Weekly Stats',headers:[...new Set([...headers,...Object.keys(rows[0]||{}),'All-Star Representative Key','Agent Name','Team','Coach','Date Column','All-Star Source'])],rows}}};
}
async function sendQualtricsCoreFiles(force=false){
  if(!state.qualtricsReady||!els.qualtricsEmailFrame?.contentWindow){ if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent='Opening the Qualtrics email workspace…'; return; }
  if(force) state.qualtricsAutoConnectSuppressed=false;
  if(state.qualtricsAutoConnectSuppressed&&!force){ if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent='Qualtrics-side data is cleared. Saved rules remain available. Press Refresh Auto-Connected Sources when you want to load data again.'; return; }
  const signature=qualtricsCoreSourceSignature();
  if(!force&&signature===state.qualtricsCoreConnectedSignature){ if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent='Saved rules are loaded. 90-day KPI, Documented Coaching, and Checklist are already connected. Weekly Stats remain manual; no preview or report has run.'; return; }
  if(!force&&signature===state.qualtricsCorePendingSignature) return;
  const token=id(); state.qualtricsCoreBuildToken=token; state.qualtricsCorePendingSignature=signature;
  if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent='Preparing the three automatic source connections in responsive batches. No preview or report is running…';
  try{
    const payload=await buildQualtricsCorePayload(); if(state.qualtricsCoreBuildToken!==token) return; const f=payload.files;
    if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent=`Connecting ${f.qa.rows.length.toLocaleString()} KPI, ${f.coaching.rows.length.toLocaleString()} coaching, and ${f.checklist.rows.length.toLocaleString()} checklist rows without running a report…`;
    els.qualtricsEmailFrame.contentWindow.postMessage({type:'allstar-core-files',payload},'*');
  }catch(err){ state.qualtricsCorePendingSignature=''; if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent=`Could not prepare the connected sources: ${err?.message||err}`; }
}
async function sendQualtricsWeeklyStats(){
  if(!state.qualtricsReady||!els.qualtricsEmailFrame?.contentWindow){ if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent='Wait for the Qualtrics email workspace to finish opening, then load Weekly Stats.'; return; }
  if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent='Preparing the selected Weekly Stats in responsive batches because you pressed Load…';
  const payload=await buildQualtricsWeeklyPayload(), stats=payload.files.stats; state.savedQualtricsStatsSource=els.qualtricsStatsSource?.value||'auto'; saveRunSettings();
  if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent=`Loading ${stats.rows.length.toLocaleString()} ${payload.statsSource} rows because you pressed Load Selected Weekly Stats…`;
  els.qualtricsEmailFrame.contentWindow.postMessage({type:'allstar-weekly-stats',payload},'*');
}
function clearQualtricsEmailData(){
  if(!confirm('Clear all source rows, manually loaded report files, previews, and generated report data from the Qualtrics email workspace? Saved rules and settings will be kept.')) return;
  state.qualtricsAutoConnectSuppressed=true;
  state.qualtricsCoreConnectedSignature='';
  state.qualtricsCorePendingSignature='';
  state.qualtricsCoreBuildToken=id();
  if(els.qualtricsEmailFrame?.contentWindow) els.qualtricsEmailFrame.contentWindow.postMessage({type:'allstar-clear-data'},'*');
  if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent='Clearing Qualtrics-side source rows and generated data while keeping saved rules and settings…';
}

let qualtricsGeneratorLoadPromise=null;
let qualtricsGeneratorReadyTimer=null;
function validateQualtricsGeneratorHtml(html){
  if(typeof html!=='string'||!html.trim()) throw new Error('The final Qualtrics generator source is empty.');
  for(const id of ['view-keyfiles','qaInput','coachingInput','checklistInput','weeklyStatsInput']) if(!html.includes(`id="${id}"`)) throw new Error(`The Qualtrics generator is missing ${id}.`);
  const inlineScripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(source=>source.trim());
  if(!inlineScripts.length) throw new Error('The Qualtrics generator contains no executable scripts.');
  for(const marker of ['els.qaInput.onchange=e=>loadQA','els.coachingInput.onchange=e=>loadCoaching','els.checklistInput.onchange=e=>loadChecklist','els.weeklyStatsInput.onchange=e=>loadWeeklyStats']) if(!html.includes(marker)) throw new Error(`The Qualtrics generator is missing an Add 4 Key Files handler: ${marker}.`);
  return html;
}
function mountQualtricsGeneratorHtml(html){
  if(!els.qualtricsEmailFrame) throw new Error('The Qualtrics iframe is unavailable.');
  els.qualtricsEmailFrame.srcdoc=validateQualtricsGeneratorHtml(html);
}
function loadQualtricsGeneratorFrame(){
  if(qualtricsGeneratorLoadPromise) return qualtricsGeneratorLoadPromise;
  qualtricsGeneratorLoadPromise=new Promise(resolve=>{
    let finished=false;
    const fallback=reason=>{
      if(finished) return; finished=true;
      const direct=els.qualtricsEmailFrame?.dataset?.src||'qualtrics/generator.html';
      if(els.qualtricsEmailFrame){ els.qualtricsEmailFrame.removeAttribute('srcdoc'); els.qualtricsEmailFrame.src=direct; }
      if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent=`The generated Qualtrics carrier could not be used (${reason}). Opening the standalone generator so Add 4 Key Files remains available…`;
      console.error('[Qualtrics Generator] Carrier recovery',reason);
      resolve();
    };
    const ready=()=>{
      try{
        mountQualtricsGeneratorHtml(window.__ALLSTAR_QUALTRICS_GENERATOR_HTML__); finished=true; resolve();
        clearTimeout(qualtricsGeneratorReadyTimer);
        qualtricsGeneratorReadyTimer=setTimeout(()=>{
          if(state.qualtricsReady) return;
          const direct=els.qualtricsEmailFrame?.dataset?.src||'qualtrics/generator.html';
          if(els.qualtricsEmailFrame){ els.qualtricsEmailFrame.removeAttribute('srcdoc'); els.qualtricsEmailFrame.src=direct; }
          if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent='The embedded Qualtrics workspace did not finish starting. Retrying with the standalone generator so Add 4 Key Files can load…';
        },12000);
      }catch(err){ fallback(err?.message||String(err)); }
    };
    if(typeof window.__ALLSTAR_QUALTRICS_GENERATOR_HTML__==='string') return ready();
    const carrier=document.createElement('script');
    carrier.src=`qualtrics/generator-source.js?v=${Date.now().toString(36)}`;
    carrier.async=true;
    carrier.onload=ready;
    carrier.onerror=()=>fallback('the carrier file did not load');
    document.head.appendChild(carrier);
  });
  return qualtricsGeneratorLoadPromise;
}
function openQualtricsEmailWorkspace(){
  populateQualtricsStatsSources(); openModal('qualtricsEmailModal');
  if(!state.qualtricsLoaded){
    state.qualtricsLoaded=true;
    loadQualtricsGeneratorFrame().catch(err=>{
      state.qualtricsLoaded=false;
      qualtricsGeneratorLoadPromise=null;
      if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent='The Qualtrics Email Generator could not open: '+(err?.message||err);
      console.error('[Qualtrics Generator] Startup failed',err);
    });
  }else sendQualtricsCoreFiles(false);
}

function handleQualtricsMessage(event){
  if(event.source!==els.qualtricsEmailFrame?.contentWindow) return; const data=event.data||{};
  if(data.type==='qualtrics-generator-ready'){ clearTimeout(qualtricsGeneratorReadyTimer); qualtricsGeneratorReadyTimer=null; state.qualtricsReady=true; sendQualtricsCoreFiles(false); return; }
  if(data.type==='qualtrics-hire-date-source-request'){ sendQualtricsHireDateSource(data); return; }
  if(data.type==='qualtrics-key-files-progress'){ if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent=data.message||'Connecting All-Star data…'; return; }
  if(data.type==='qualtrics-key-files-complete'){ const c=data.counts||{}; state.qualtricsCoreConnectedSignature=state.qualtricsCorePendingSignature||qualtricsCoreSourceSignature(); state.qualtricsCorePendingSignature=''; if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent=`Connected: ${Number(c.qa||0).toLocaleString()} KPI · ${Number(c.coaching||0).toLocaleString()} coaching · ${Number(c.checklist||0).toLocaleString()} checklist. Weekly Stats remain manual. Nothing was previewed or generated.`; return; }
  if(data.type==='qualtrics-weekly-progress'){ if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent=data.message||'Loading Weekly Stats on request…'; return; }
  if(data.type==='qualtrics-weekly-complete'){ const c=data.counts||{}; if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent=`Loaded ${Number(c.stats||0).toLocaleString()} weekly stat rows on request. Nothing was previewed or generated; use the buttons inside the email workspace when ready.`; return; }
  if(data.type==='qualtrics-data-cleared'){ if(els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent='Qualtrics-side data cleared. Saved rules and settings were kept. Press Refresh Auto-Connected Sources when you want to load the KPI, coaching, and checklist rows again.'; return; }
  if(data.type==='qualtrics-key-files-error'&&els.qualtricsBridgeStatus) els.qualtricsBridgeStatus.textContent=`Could not connect the All-Star key files: ${data.message||'unknown error'}`;
}

/*
 * Shared-data-first startup policy.
 *
 * All-Star's normal startup should behave like the other CoachingTools apps: if
 * the shared CoachTools dataset store already has usable data, use that store and
 * do not hydrate All-Star's private IndexedDB import cache first. Hydrating that
 * cache restores the saved categorized databases and immediately performs broad
 * alias/team work before the shared-data reconciliation even starts.
 *
 * The existing local cache remains fully available from Import > Load Local Data,
 * and it still acts as the automatic fallback when no shared CoachTools dataset is
 * available. Categorize Data remains an explicit user action.
 */
const allStarLegacyStartupCacheLoader=loadImportCacheOnStartup;
const ALLSTAR_SHARED_STARTUP_DATASETS=['monthlyRetail','monthlyReferral','qa','documentedCoaching','checklist','compCoaching'];
function allStarHasSharedStartupData(){
  if(typeof window.CoachToolsData?.getDatasetVersion!=='function') return false;
  return ALLSTAR_SHARED_STARTUP_DATASETS.some(type=>{
    try{ return !!window.CoachToolsData.getDatasetVersion(type); }
    catch(_){ return false; }
  });
}
loadImportCacheOnStartup=async function(opts={}){
  const startupRequest=!!(opts?.deferRender && state.startup?.running);
  if(startupRequest && allStarHasSharedStartupData()){
    state.importCacheStartupMode='shared-data-first';
    state.startup.diagnostics={...(state.startup.diagnostics||{}),localCacheAutoLoaded:false,categorizationDeferred:true};
    console.info('[All-Star Startup] Shared CoachTools data found; skipping automatic All-Star cache hydration. Categorization remains manual.');
    return false;
  }
  state.importCacheStartupMode=startupRequest?'local-cache-fallback':'manual';
  return allStarLegacyStartupCacheLoader(opts);
};

const allStarLegacyCentralSync=syncAllStarFromCoachToolsData;
syncAllStarFromCoachToolsData=async function(options={}){
  const result=await allStarLegacyCentralSync(options);
  if(state.importCacheStartupMode==='shared-data-first' && String(options?.reason||'').toLowerCase().includes('startup')){
    state.startup.diagnostics={...(state.startup.diagnostics||{}),startupSource:'shared CoachTools data',localCacheAutoLoaded:false,categorizationDeferred:true};
  }
  return result;
};
