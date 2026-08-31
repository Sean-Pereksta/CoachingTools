/* All-Star operational workflow: source health, diagnostics, preflight, presets,
 * saved reports, notes, and report comparison. Kept separate from scoring so the
 * same validation and report model can be reused without changing calculations.
 */
'use strict';

const ALLSTAR_REPORT_SCHEMA_VERSION=1;
const ALLSTAR_PRESET_KEY='allStarRunPresets.v1';
const ALLSTAR_REPORT_DB='allStarSavedReports.v1';
const ALLSTAR_REPORT_STORE='reports';
const ALLSTAR_REPORT_LIMIT=15;

function allStarDiagnostic({severity='info',module='workflow',source='',title='',message='',entity='',blocking=false}={}){
  return {severity,module,source,title,message,entity,blocking:!!blocking};
}
function allStarDiagnosticCounts(items=[]){
  return items.reduce((out,d)=>{ out[d.severity]=(out[d.severity]||0)+1; if(d.blocking) out.blocking++; return out; },{error:0,warning:0,info:0,blocking:0});
}
function allStarDiagnosticStatus(items=[]){
  const c=allStarDiagnosticCounts(items);
  return c.blocking?'needs_attention':c.warning||c.error?'ready_with_warnings':'ready';
}
function allStarStatusLabel(status){ return status==='needs_attention'?'Needs Attention':status==='ready_with_warnings'?'Ready with warnings':'Ready'; }

function workflowRowTimestamp(row){
  const candidates=[row?._dateValue,row?._interactionDate,row?._assignedDate,row?._date,row?._week];
  for(const value of candidates){
    if(Number.isFinite(value)) return Number(value);
    if(value instanceof Date&&!isNaN(value)) return value.getTime();
    const parsed=parseDateOnly(value)||parseWeekLabel(value); if(parsed&&!isNaN(parsed)) return parsed.getTime();
  }
  return NaN;
}
function workflowSourceRowStats(rows=[]){
  const reps=new Set(), teams=new Set(); let min=Infinity,max=-Infinity;
  for(const row of rows){
    const rep=row?._repKey||fullNameIdentityKey(row?._rep||''); if(rep) reps.add(rep);
    const team=row?._teamKey||coachNameKey(row?._team||rowTeam(row)||''); if(team) teams.add(team);
    const time=workflowRowTimestamp(row); if(Number.isFinite(time)){ if(time<min) min=time; if(time>max) max=time; }
  }
  return {rowCount:rows.length,representativeCount:reps.size,teamCount:teams.size,earliestDate:Number.isFinite(min)?new Date(min).toISOString():'',latestDate:Number.isFinite(max)?new Date(max).toISOString():''};
}
function workflowSourceMetadata(source,{force=false}={}){
  state.sourceMeta=state.sourceMeta||{};
  const prior=state.sourceMeta[source]||{}, signature=sourceVersionSignature(source);
  if(!force&&prior.workflowSignature===signature&&Number.isFinite(prior.rowCount)) return prior;
  const rows=getRowsRaw(source)||[];
  const stats=workflowSourceRowStats(rows), book=bookForSource(source)||{};
  const next={...prior,...stats,workflowSignature:signature,fileName:sourceFileName(source)||prior.fileName||'',selectedWorksheet:prior.selectedWorksheet||prior.selectedSheet||book.selectedSheets?.[source]||book.sheetName||'',importedAt:prior.lastImportedAt||prior.importedAt||state.importCache?.meta?.savedAt||''};
  state.sourceMeta[source]=next;
  return next;
}
function workflowImportedSources(){
  return allSourceKeys().filter(source=>{ const m=state.sourceMeta?.[source]; return sourceHasImportedData(source)||Number(m?.rowCount||0)>0; });
}
function workflowDateText(value){ const d=value?new Date(value):null; return d&&!isNaN(d)?ymd(d):'—'; }
function workflowImportedTime(value){ const d=value?new Date(value):null; return d&&!isNaN(d)?d.toLocaleString():'—'; }
function currentCoachToolsDataGroups(){
  return [
    {label:'Retail',sources:['retail_sv2','retail_wiper','retail_team_totals'],fileName:state.data?.retail?.fileName||state.books?.retail?.fileName||''},
    {label:'Referral',sources:['referral_sv2','referral_wiper','referral_team_totals'],fileName:state.data?.referral?.fileName||state.books?.referral?.fileName||''},
    {label:'QA',sources:['qa'],fileName:state.data?.qa?.fileName||state.books?.qa?.fileName||''},
    {label:'Checklist',sources:['checklist'],fileName:state.data?.checklist?.fileName||state.books?.checklist?.fileName||''},
    {label:'Documented Coaching',sources:['documented_coaching'],fileName:state.data?.documented_coaching?.fileName||state.books?.documented_coaching?.fileName||''},
    {label:'Comp Calls',sources:['comp_calls'],fileName:state.data?.comp_calls?.fileName||state.books?.comp_calls?.fileName||''}
  ].map(group=>{
    const rowCount=group.sources.reduce((sum,source)=>{ const raw=state.sourceMeta?.[source]?.rowCount, cached=Number(raw); return sum+(raw!==null&&raw!==''&&Number.isFinite(cached)?cached:(getRowsRaw(source)||[]).length); },0);
    const fileName=group.fileName||group.sources.map(source=>state.sourceMeta?.[source]?.fileName).find(Boolean)||'';
    return {...group,fileName,rowCount,ready:rowCount>0||!!fileName};
  });
}
function renderSourceHealthOverview(){
  const host=el('sourceHealthOverview'); if(!host) return;
  const groups=currentCoachToolsDataGroups(), loaded=groups.filter(group=>group.ready).length;
  const cards=groups.map(group=>`<div class="currentDataCard"><strong>${esc(group.label)}<i class="sourceStatusDot ${group.ready?'good':''}" aria-hidden="true"></i></strong><span>${group.rowCount.toLocaleString()} rows</span><small title="${esc(group.fileName||'No file connected')}">${esc(group.fileName||'No file connected')}</small><span class="badge ${group.ready?'good':''}">${group.ready?'Ready':'Not loaded'}</span></div>`).join('');
  const imported=workflowImportedSources(), details=state.sourceHealthExpanded?`<div class="sourceMetaCards">${imported.map(source=>{ const m=state.sourceMeta?.[source]||{}; return `<div class="sourceMetaCard"><strong>${esc(labelSource(source))}</strong><span>${Number(m.rowCount||0).toLocaleString()} rows · ${Number(m.representativeCount||0).toLocaleString()} representatives · ${Number(m.teamCount||0).toLocaleString()} teams</span><span>Data: ${workflowDateText(m.earliestDate)} → ${workflowDateText(m.latestDate)}</span><span>${esc(m.selectedWorksheet||m.selectedSheet||'No worksheet selected')}</span></div>`; }).join('')}</div>`:'';
  host.innerHTML=`<div class="sourceHealthHead"><div><strong>${loaded} of 6 connected</strong><div class="hint">Filenames, row counts, and status come from saved source metadata; opening Import does not rescan rows.</div></div><button id="refreshSourceHealthBtn" class="smallBtn dark" type="button">Refresh Detailed Metadata</button></div><div class="currentDataGrid">${cards}</div>${details}`;
  el('refreshSourceHealthBtn').onclick=()=>{ imported.forEach(source=>workflowSourceMetadata(source,{force:true})); state.sourceHealthExpanded=true; renderSourceHealthOverview(); };
}

function renderImportWorkspace(){
  restoreImportFileLabels();
  renderSourceHealthOverview();
  renderCategorizedSummary();
  renderTeamTotalsImportControls();
  renderCustomSourcesList();
  renderImportCacheStatus();
}

function modelDependencySummary(model,opts={}){
  const sources=requiredRunSourcesForModel(model,opts);
  const criteria=model?.criteria||[];
  return {sources,expressions:criteria.filter(c=>c.calcType==='custom'||c.expression).length,autofails:criteria.filter(c=>String(c.weight)==='autofail').length,minimums:criteria.filter(c=>c.minimumEnabled).length,displayColumns:criteria.filter(c=>c.calcType==='displayColumn').length,trueValues:criteria.filter(c=>c.trueValueEnabled).length,rowPulls:criteria.filter(c=>isRowPullCriterion(c)).length};
}
function modelHealthDiagnostics(model,settings={}){
  const out=[];
  if(!model){ out.push(allStarDiagnostic({severity:'error',module:'model',title:'No model selected',message:'Choose a saved model before running.',blocking:true})); return out; }
  if(!(model.criteria||[]).length) out.push(allStarDiagnostic({severity:'error',module:'model',title:'Model has no criteria',message:'Add at least one criterion.',blocking:true}));
  const required=requiredColumnsForModel(model);
  if([...required.keys()].some(source=>isCategorizedSource(source)) && typeof categorizationIsStale==='function' && categorizationIsStale()){
    out.push(allStarDiagnostic({severity:'error',module:'categorization',title:'Categorization Needed',message:'Source data changed after the last manual categorization. Open Import and press Categorize Data before running this report.',blocking:true}));
  }
  required.forEach((items,source)=>{
    if(!sourceHasImportedData(source)) out.push(allStarDiagnostic({severity:'error',module:'import',source,title:`${labelSource(source)} is missing`,message:'This source is required by the selected model.',blocking:true}));
    const headers=getHeaders(source)||[];
    items.forEach(item=>{ if(!headerMatch(headers,item.expected)) out.push(allStarDiagnostic({severity:'error',module:'model',source,title:`Missing column: ${item.expected}`,message:`${item.label||'Model configuration'} expects this column in ${labelSource(source)}.`,entity:item.expected,blocking:true})); });
  });
  (model.criteria||[]).forEach(c=>{
    if(!c.name) out.push(allStarDiagnostic({severity:'warning',module:'model',source:c.source,title:'Unnamed criterion',message:'Name this criterion so audit details remain understandable.'}));
    if(c.calcType==='custom'&&!String(c.expression||'').trim()) out.push(allStarDiagnostic({severity:'error',module:'model',source:c.source,title:`${c.name||'Custom criterion'} has no expression`,message:'Enter a valid expression before running.',blocking:true}));
    (rowPullWarnings(c)||[]).filter(Boolean).forEach(w=>out.push(allStarDiagnostic({severity:'warning',module:'model',source:c.source,title:`${c.name||'Criterion'} phrase warning`,message:w})));
  });
  try{ compileRunCriterionPlan(model,{qaDateMode:settings.qaDateMode||'interaction',qaTeamScoreMode:settings.qaTeamScoreMode||'assignedReps'}); }
  catch(error){ out.push(allStarDiagnostic({severity:'error',module:'model',title:'Model compilation failed',message:error?.message||String(error),blocking:true})); }
  return out;
}
function runPreflight(model,settings={}){
  const diagnostics=modelHealthDiagnostics(model,settings), deps=modelDependencySummary(model,settings);
  const start=parseDateOnly(settings.startDate), end=parseDateOnly(settings.endDate);
  if(start&&end&&start>end) diagnostics.push(allStarDiagnostic({severity:'error',module:'run',title:'Invalid report dates',message:'Start Date must be on or before End Date.',blocking:true}));
  if((settings.runMode||state.runMode)==='single'&&!(settings.selectedTeams||[]).length&&!(settings.includeOrgIds||[]).length) diagnostics.push(allStarDiagnostic({severity:'error',module:'run',title:'No report population selected',message:'Select at least one team or include one organization.',blocking:true}));
  deps.sources.forEach(source=>{
    if(!sourceHasImportedData(source)) return;
    const m=workflowSourceMetadata(source), latest=m.latestDate?new Date(m.latestDate):null;
    if(end&&latest&&!isNaN(latest)&&end.getTime()>latest.getTime()+86400000) diagnostics.push(allStarDiagnostic({severity:'warning',module:'freshness',source,title:`${labelSource(source)} ends before the report`,message:`Latest available date is ${ymd(latest)}; the selected report ends ${ymd(end)}.`}));
  });
  if(deps.sources.includes('documented_coaching')){
    const rows=getRowsRaw('documented_coaching')||[], headers=getHeaders('documented_coaching')||[];
    const repColumn=repColumnForSource('documented_coaching')||findHeader(headers,['Associate name','Associate Name','Associate','Agent Name','Rep']);
    const coachColumn=teamColumnForSource('documented_coaching')||findHeader(headers,['Job Coach','Coach Assigned','Coach','Team']);
    const dateColumn=sourceDateHeader('documented_coaching',headers);
    const validDated=dateColumn?rows.filter(row=>!!parseDateOnly(row[dateColumn]||row._date)).length:0;
    const inDateRange=dateColumn?rows.filter(row=>inRange(row[dateColumn]||row._date,start,end)).length:0;
    const runIndex=state.runIndexes?.get?.('documented_coaching');
    const sourceVersion=sourceVersionSignature('documented_coaching');
    state.documentedCoachingDiagnostics={centralDataset:readAllStarCentralSyncMap?.().documentedCoaching||null,fileName:sourceFileName('documented_coaching'),rawRows:Number(state.sourceMeta?.documented_coaching?.rawRowCount||rows.length),hydratedRows:rows.length,normalizedRows:rows.length,headers:[...headers],repColumn,coachColumn,dateColumn,validDatedRows:validDated,matchedRepresentatives:new Set(rows.map(row=>row._repKey).filter(Boolean)).size,unmatchedRepresentatives:rows.filter(row=>!row._repKey).length,matchedCoaches:rows.filter(row=>!!row._team).length,unmatchedCoaches:rows.filter(row=>!row._team).length,dateRange:{start:ymd(start),end:ymd(end)},recordsAfterDateFilter:inDateRange,sourceIndexVersion:sourceVersion,runIndexCache:runIndex?.signature===sourceVersion?'reused':'rebuild required'};
    if(rows.length&&(start||end)&&(!dateColumn||!validDated)) diagnostics.push(allStarDiagnostic({severity:'warning',module:'import',source:'documented_coaching',title:'Documented Coaching date column is unusable',message:`Documented Coaching loaded ${rows.length.toLocaleString()} records but no usable coaching date column was detected for this date-filtered report.`}));
  }
  const quarantined=(state.quarantinedRepAliases||[]).length;
  if(quarantined) diagnostics.push(allStarDiagnostic({severity:'warning',module:'identity',title:`${quarantined.toLocaleString()} quarantined identit${quarantined===1?'y':'ies'}`,message:'Review uncertain representative matches; they will not be merged automatically.'}));
  const conflicts=(state.rosterIndex?.conflicts||state.identityConflicts||[]).length;
  if(conflicts) diagnostics.push(allStarDiagnostic({severity:'warning',module:'identity',title:`${conflicts.toLocaleString()} roster conflict${conflicts===1?'':'s'}`,message:'Conflicting identities remain separated and may affect coverage.'}));
  ['retail','referral'].forEach(area=>{ const source=`${area}_team_totals`; if(!deps.sources.includes(source)) return; const ds=state.data?.[area]?.teamTotals, d=ds?.diagnostics||{}; if(d.missingSummarySheet||d.invalidHeaders||(d.teamsWithNoExtractedRow||[]).length) diagnostics.push(allStarDiagnostic({severity:'warning',module:'team totals',source,title:`${labelSource(source)} needs review`,message:teamTotalsSummaryText(area)})); });
  const knownOrgIds=new Set((state.orgs||[]).map(o=>o.id));
  [...(settings.includeOrgIds||[]),...(settings.excludeOrgIds||[]),...(settings.multiOrgIds||[])].filter(id=>!knownOrgIds.has(id)).forEach(id=>diagnostics.push(allStarDiagnostic({severity:'warning',module:'organization',title:'Saved organization is no longer available',message:`Organization id ${id} was removed or renamed.`})));
  const c=allStarDiagnosticCounts(diagnostics), readySources=deps.sources.filter(source=>state.runIndexes?.get(source)?.signature===sourceVersionSignature(source)).length;
  return {status:allStarDiagnosticStatus(diagnostics),diagnostics,counts:c,dependencies:deps,requiredSources:deps.sources,readySources,modelId:model?.id||'',modelName:model?.name||'',checkedAt:new Date().toISOString()};
}
function diagnosticRowsHtml(diagnostics=[]){
  if(!diagnostics.length) return '<div class="checkResultRow okRow"><strong>✓ No readiness problems found.</strong></div>';
  return diagnostics.map(d=>`<div class="checkResultRow ${d.blocking?'badRow':d.severity==='warning'?'warnRow':'okRow'}"><strong>${d.blocking?'✗':d.severity==='warning'?'⚠':'✓'} ${esc(d.title)}</strong><div class="checkResultMeta">${d.source?`${esc(labelSource(d.source))} · `:''}${esc(d.message)}${d.blocking?' · Blocks Run':''}</div></div>`).join('');
}
function renderRunWorkflow({openDetails=false}={}){
  const model=findModel(els.runModelSelect?.value), settings=typeof captureRunExecutionSettings==='function'?captureRunExecutionSettings():{}, result=runPreflight(model,settings), box=el('runReadiness'); if(!box) return result;
  const statusClass=result.status==='needs_attention'?'bad':result.status==='ready_with_warnings'?'warn':'good';
  box.className=`runReadiness ${statusClass}`;
  if(els.runReadinessTitle) els.runReadinessTitle.textContent=allStarStatusLabel(result.status);
  if(els.runReadinessDetail) els.runReadinessDetail.textContent=`${result.requiredSources.length} required sources · ${result.readySources} prepared · ${result.counts.warning} warnings · ${result.counts.blocking} blockers`;
  if(els.runReadinessMeta) els.runReadinessMeta.innerHTML=`<span class="badge ${statusClass}">${esc(result.modelName||'No model')}</span><span class="badge">${result.requiredSources.length} source${result.requiredSources.length===1?'':'s'}</span><span class="badge">${result.dependencies.expressions} expressions</span><span class="badge">${result.dependencies.autofails} autofails</span><span class="badge">${result.dependencies.minimums} minimums</span><span class="badge">${result.dependencies.displayColumns} Display Columns</span><span class="badge">${result.dependencies.trueValues} True Values</span>`;
  const details=el('runPreflightDetails'); if(details){ details.innerHTML=`<div class="dependencySummary"><strong>Uses</strong><span>${result.requiredSources.length?result.requiredSources.map(s=>esc(labelSource(s))).join(' · '):'No imported sources required'}</span></div><div class="checkResultList">${diagnosticRowsHtml(result.diagnostics)}</div>`; if(openDetails) details.classList.remove('hidden'); }
  if(els.executeRunBtn) els.executeRunBtn.disabled=!!result.counts.blocking||!!state.multiRunActive;
  state.lastRunPreflight=result; return result;
}

function loadRunPresets(){ try{ const v=JSON.parse(localStorage.getItem(ALLSTAR_PRESET_KEY)||'[]'); return Array.isArray(v)?v:[]; }catch(_){ return []; } }
function saveRunPresets(items){ localStorage.setItem(ALLSTAR_PRESET_KEY,JSON.stringify(items.slice(0,30))); renderRunPresetOptions(); }
function workflowPresetDates(mode='fixed',days=30){
  const now=new Date(), at=(d)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()), end=at(now); let start=at(now);
  if(mode==='all') return {startDate:'',endDate:''};
  if(mode==='lastDays'){ start=new Date(end); start.setDate(start.getDate()-Math.max(1,Number(days)||30)+1); }
  if(mode==='currentWeek'){ start=new Date(end); start.setDate(start.getDate()-((start.getDay()+6)%7)); }
  if(mode==='previousWeek'){ end.setDate(end.getDate()-((end.getDay()+6)%7)-1); start=new Date(end); start.setDate(start.getDate()-6); }
  if(mode==='currentMonth'){ start=new Date(end.getFullYear(),end.getMonth(),1); }
  if(mode==='previousMonth'){ start=new Date(end.getFullYear(),end.getMonth()-1,1); end.setTime(new Date(end.getFullYear(),end.getMonth(),0).getTime()); }
  return {startDate:ymd(start),endDate:ymd(end)};
}
function renderRunPresetOptions(){ const select=el('runPresetSelect'); if(!select) return; const value=select.value; select.innerHTML='<option value="">Choose preset…</option>'+loadRunPresets().map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''); if([...select.options].some(o=>o.value===value)) select.value=value; }
function workflowSetSelect(node,value){ if(node&&[...node.options].some(o=>o.value===String(value))) node.value=String(value); }
function applyRunPreset(id){
  const preset=loadRunPresets().find(p=>p.id===id); if(!preset) return;
  const s=preset.settings||{}, dates=preset.dateMode==='fixed'?{startDate:s.startDate||'',endDate:s.endDate||''}:workflowPresetDates(preset.dateMode,preset.lastDays);
  workflowSetSelect(els.runModelSelect,s.modelId); workflowSetSelect(els.runViewSelect,s.view); workflowSetSelect(els.runQADateSelect,s.qaDateMode); workflowSetSelect(els.runQATeamScoreMode,s.qaTeamScoreMode); workflowSetSelect(els.hideNoScoreThreshold,s.hideNoScoreThreshold);
  if(els.runStartDate) els.runStartDate.value=dates.startDate; if(els.runEndDate) els.runEndDate.value=dates.endDate; if(els.hideNoScoreReps) els.hideNoScoreReps.checked=!!s.hideNoScore; if(els.rankRepresentativesWithinTeam) els.rankRepresentativesWithinTeam.checked=!!s.teamSpecificRepRanking;
  state.selectedTeams=new Set((s.selectedTeams||[]).map(canonicalCoachName).filter(Boolean)); state.teamSelectionInitialized=true; state.runIncludeOrgs=new Set(s.includeOrgIds||[]); state.runExcludeOrgs=new Set(s.excludeOrgIds||[]); state.multiRunOrgIds=new Set(s.multiOrgIds||[]);
  applyRunMode(s.runMode||'single'); renderTeamSelect(); renderRunOrgSelect(); renderMultiRunOrgSelect(); updateRunQADateField(); updateMultiRunSummary(); saveRunSettings(); beginSelectedModelPreparation(); renderRunWorkflow({openDetails:true});
}
function createRunPreset(){
  const name=(prompt('Preset name','Weekly Review')||'').trim(); if(!name) return;
  const mode=el('runPresetDateMode')?.value||'fixed', lastDays=Math.max(1,Number(el('runPresetLastDays')?.value)||30), items=loadRunPresets(), preset={id:'preset_'+Date.now().toString(36),name,dateMode:mode,lastDays,settings:captureRunExecutionSettings(),createdAt:new Date().toISOString()};
  items.unshift(preset); saveRunPresets(items); el('runPresetSelect').value=preset.id;
}
function deleteRunPreset(){ const id=el('runPresetSelect')?.value, items=loadRunPresets(), preset=items.find(p=>p.id===id); if(!preset||!confirm(`Delete preset "${preset.name}"?`)) return; saveRunPresets(items.filter(p=>p.id!==id)); }

function workflowReportDb(){
  return new Promise((resolve,reject)=>{ const req=indexedDB.open(ALLSTAR_REPORT_DB,1); req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(ALLSTAR_REPORT_STORE)) db.createObjectStore(ALLSTAR_REPORT_STORE,{keyPath:'id'}); }; req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });
}
async function workflowReportTransaction(mode,run){ const db=await workflowReportDb(); return new Promise((resolve,reject)=>{ const tx=db.transaction(ALLSTAR_REPORT_STORE,mode), store=tx.objectStore(ALLSTAR_REPORT_STORE); let value; try{ value=run(store); }catch(e){db.close();reject(e);return;} tx.oncomplete=()=>{db.close();resolve(value);}; tx.onerror=()=>{db.close();reject(tx.error);}; }); }
function workflowRequest(req){ return new Promise((resolve,reject)=>{ req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function listSavedReports(){ const db=await workflowReportDb(); try{ const tx=db.transaction(ALLSTAR_REPORT_STORE,'readonly'); const rows=await workflowRequest(tx.objectStore(ALLSTAR_REPORT_STORE).getAll()); return rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))); }finally{db.close();} }
function workflowPlain(value){ return JSON.parse(JSON.stringify(value)); }
function workflowReportSnapshot(report){
  const safeOpts={selectedTeamNames:report?.runOpts?.selectedTeamNames||[],organizationId:report?.runOpts?.organizationId||'',organizationName:report?.runOpts?.organizationName||'',teamSpecificRepRanking:!!report?.runOpts?.teamSpecificRepRanking,qaTeamScoreMode:report?.runOpts?.qaTeamScoreMode||'assignedReps',trueValueDiagnostics:report?.runOpts?.trueValueDiagnostics||[]};
  return {model:workflowPlain(report.model),teamPack:workflowPlain(report.teamPack),repPack:workflowPlain(report.repPack),teamRepPack:workflowPlain(report.teamRepPack||report.repPack),view:report.view,start:report.start?ymd(report.start):'',end:report.end?ymd(report.end):'',qaDateMode:report.qaDateMode,runOpts:workflowPlain(safeOpts)};
}
async function saveCompletedReport(report,settings={},preflight=null){
  if(!report) return null;
  const note=String(el('runReportNote')?.value||'').trim(), deps=modelDependencySummary(report.model,settings), sourceSignature=Object.fromEntries(deps.sources.map(s=>[s,sourceVersionSignature(s)]));
  const rec={id:'report_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),allStarReportSchemaVersion:ALLSTAR_REPORT_SCHEMA_VERSION,createdAt:new Date().toISOString(),modelId:report.model?.id||'',modelName:report.model?.name||'All-Star Report',periodStart:report.start?ymd(report.start):'',periodEnd:report.end?ymd(report.end):'',teams:report.runOpts?.selectedTeamNames||[],organizationName:report.runOpts?.organizationName||'',settings:workflowPlain(settings),note,sourceSignature,modelSignature:stableSerialize(report.model||{}),diagnostics:workflowPlain(preflight?.diagnostics||[]),report:workflowReportSnapshot(report)};
  await workflowReportTransaction('readwrite',store=>store.put(rec)); const all=await listSavedReports(); if(all.length>ALLSTAR_REPORT_LIMIT) await workflowReportTransaction('readwrite',store=>all.slice(ALLSTAR_REPORT_LIMIT).forEach(x=>store.delete(x.id))); return rec;
}
async function deleteSavedReport(id){ if(!confirm('Delete this saved report snapshot?')) return; await workflowReportTransaction('readwrite',store=>store.delete(id)); renderRecentRuns(); }
function hydrateSavedReport(rec){ const r=workflowPlain(rec.report); r.start=parseDateOnly(r.start); r.end=parseDateOnly(r.end); return r; }
async function openSavedReport(id){ const rec=(await listSavedReports()).find(r=>r.id===id); if(!rec) return; const report=hydrateSavedReport(rec); renderResults(report.model,report.teamPack,report.repPack,report.view,report.start,report.end,report.qaDateMode,report.runOpts,report.teamRepPack); if(els.workArea) els.workArea.querySelector('.reportMeta')?.insertAdjacentHTML('beforeend',`<span class="badge warn">Saved snapshot: ${esc(new Date(rec.createdAt).toLocaleString())}</span>${rec.note?`<span class="badge">Note: ${esc(rec.note)}</span>`:''}`); closeModal('recentRunsModal'); injectCompletedReportActions(); }
async function reexportSavedReport(id){ const rec=(await listSavedReports()).find(r=>r.id===id); if(rec) await exportPDF({report:hydrateSavedReport(rec)}); }
function reportRowMap(pack){ return new Map((pack?.rows||[]).map(r=>[nameKey(r.entry?.name||''),r])); }
function comparePack(oldPack,newPack,kind){
  const before=reportRowMap(oldPack), after=reportRowMap(newPack), rows=[];
  new Set([...before.keys(),...after.keys()]).forEach(key=>{ const a=before.get(key),b=after.get(key), name=b?.entry?.name||a?.entry?.name||key, rankA=Number(a?.overallRank),rankB=Number(b?.overallRank),scoreA=Number(a?.overallScore),scoreB=Number(b?.overallScore); rows.push({name,kind,rankA:Number.isFinite(rankA)?rankA:null,rankB:Number.isFinite(rankB)?rankB:null,rankChange:Number.isFinite(rankA)&&Number.isFinite(rankB)?rankA-rankB:null,scoreA:Number.isFinite(scoreA)?scoreA:null,scoreB:Number.isFinite(scoreB)?scoreB:null,scoreChange:Number.isFinite(scoreA)&&Number.isFinite(scoreB)?scoreB-scoreA:null,newlyEligible:!!b?.eligible&&!a?.eligible,newlyIneligible:!!a?.eligible&&!b?.eligible}); });
  return rows.sort((a,b)=>Math.abs(b.scoreChange||0)-Math.abs(a.scoreChange||0));
}
function compareSavedReportRecords(older,newer){
  const a=hydrateSavedReport(older),b=hydrateSavedReport(newer), config=[];
  if(older.modelSignature!==newer.modelSignature) config.push('Model updated'); if(stableSerialize(older.sourceSignature)!==stableSerialize(newer.sourceSignature)) config.push('Source data changed'); if(older.settings?.qaDateMode!==newer.settings?.qaDateMode) config.push('QA date mode changed'); if(stableSerialize(older.teams)!==stableSerialize(newer.teams)) config.push('Team population changed'); if(stableSerialize(older.settings?.includeOrgIds)!==stableSerialize(newer.settings?.includeOrgIds)) config.push('Organization selection changed');
  return {older,newer,config,teams:comparePack(a.teamPack,b.teamPack,'team'),reps:comparePack(a.repPack,b.repPack,'rep')};
}
function comparisonTable(title,rows){ const shown=rows.filter(r=>r.rankChange||r.scoreChange||r.newlyEligible||r.newlyIneligible).slice(0,25); return `<div class="comparisonSection"><strong>${esc(title)}</strong><div class="tableWrap"><table><thead><tr><th>Name</th><th>Rank</th><th>Score</th><th>Movement</th></tr></thead><tbody>${shown.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.rankA??'—'} → ${r.rankB??'—'}</td><td>${r.scoreA==null?'—':fmt(r.scoreA,'number')} → ${r.scoreB==null?'—':fmt(r.scoreB,'number')}</td><td>${r.newlyEligible?'<span class="badge good">Newly eligible</span>':r.newlyIneligible?'<span class="badge bad">Newly ineligible</span>':`${r.rankChange>0?'+':''}${r.rankChange||0} rank · ${r.scoreChange>0?'+':''}${Number(r.scoreChange||0).toFixed(2)} score`}</td></tr>`).join('')||'<tr><td colspan="4">No movement found.</td></tr>'}</tbody></table></div></div>`; }
async function compareSelectedReports(){
  const ids=[...document.querySelectorAll('[data-compare-report]:checked')].map(x=>x.value); if(ids.length!==2) return alert('Select exactly two compatible saved reports to compare.');
  const records=await listSavedReports(), chosen=ids.map(id=>records.find(r=>r.id===id)).filter(Boolean).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))); if(chosen.length!==2) return;
  if(chosen.some(r=>r.allStarReportSchemaVersion!==ALLSTAR_REPORT_SCHEMA_VERSION)) return alert('One saved report uses an incompatible report schema.');
  const c=compareSavedReportRecords(chosen[0],chosen[1]), host=el('recentRunComparison');
  host.innerHTML=`<div class="comparisonHeader"><strong>${esc(chosen[0].modelName)} · ${esc(chosen[0].periodStart||'All dates')} → ${esc(chosen[1].periodEnd||'All dates')}</strong><span>${esc(new Date(chosen[0].createdAt).toLocaleString())} compared with ${esc(new Date(chosen[1].createdAt).toLocaleString())}</span></div>${c.config.length?`<div class="configurationWarning"><strong>Configuration Changed</strong><span>${c.config.map(esc).join(' · ')}</span><small>Treat movement cautiously; this is not a strict apples-to-apples comparison.</small></div>`:''}${comparisonTable('Team movement',c.teams)}${comparisonTable('Representative movement',c.reps)}`;
}
async function renderRecentRuns(){
  const host=el('recentRunsList'); if(!host) return; const rows=await listSavedReports();
  host.innerHTML=rows.map(r=>`<div class="recentRunRow"><label><input type="checkbox" data-compare-report value="${esc(r.id)}"><span><strong>${esc(r.modelName)}</strong><small>${esc(r.periodStart||'All dates')} → ${esc(r.periodEnd||'All dates')} · ${esc(new Date(r.createdAt).toLocaleString())} · ${(r.teams||[]).length} teams${r.organizationName?` · ${esc(r.organizationName)}`:''}</small>${r.note?`<small>Note: ${esc(r.note)}</small>`:''}</span></label><div class="recentRunActions"><button class="smallBtn dark" data-open-report="${esc(r.id)}">Open</button><button class="smallBtn" data-export-report="${esc(r.id)}">Re-export</button><button class="smallBtn red" data-delete-report="${esc(r.id)}">Delete</button></div></div>`).join('')||'<div class="checkItem">No saved runs yet. Successful reports are stored here automatically.</div>';
  host.querySelectorAll('[data-open-report]').forEach(b=>b.onclick=()=>openSavedReport(b.dataset.openReport)); host.querySelectorAll('[data-export-report]').forEach(b=>b.onclick=()=>reexportSavedReport(b.dataset.exportReport)); host.querySelectorAll('[data-delete-report]').forEach(b=>b.onclick=()=>deleteSavedReport(b.dataset.deleteReport));
}
async function openRecentRuns(){ el('recentRunComparison').innerHTML=''; await renderRecentRuns(); openModal('recentRunsModal'); }
function injectCompletedReportActions(){ const header=els.workArea?.querySelector('.reportHeader'); if(!header||header.querySelector('.completedReportActions')) return; header.insertAdjacentHTML('beforeend','<div class="completedReportActions"><button id="openRecentRunsFromReport" class="smallBtn dark" type="button">Recent Runs</button><button id="explainReportHelp" class="smallBtn" type="button">Calculation Audit</button></div>'); el('openRecentRunsFromReport').onclick=openRecentRuns; el('explainReportHelp').onclick=()=>alert('Click any underlined criterion value in the report to see its source rows, filters, numerator/denominator, aggregation, and displayed calculation.'); }

function workflowBindUi(){
  renderRunPresetOptions();
  el('runViewPreflightBtn').onclick=()=>{ el('runPreflightDetails').classList.toggle('hidden'); renderRunWorkflow(); };
  el('runCheckModelBtn').onclick=()=>renderRunWorkflow({openDetails:true}); el('saveRunPresetBtn').onclick=createRunPreset; el('deleteRunPresetBtn').onclick=deleteRunPreset; el('applyRunPresetBtn').onclick=()=>applyRunPreset(el('runPresetSelect').value); el('recentRunsBtn').onclick=openRecentRuns; el('compareRecentRunsBtn').onclick=compareSelectedReports;
  el('runPresetDateMode').onchange=()=>el('runPresetLastDaysWrap').classList.toggle('hidden',el('runPresetDateMode').value!=='lastDays');
}

const workflowBaseOpenModal=openModal;
openModal=function(modalId){ const value=workflowBaseOpenModal(modalId); if(modalId==='importModal') renderImportWorkspace(); if(modalId==='runModal'){ renderRunPresetOptions(); setTimeout(()=>renderRunWorkflow(),0); } return value; };
const workflowBaseReadiness=updateRunReadiness;
updateRunReadiness=function(...args){ const value=workflowBaseReadiness(...args); renderRunWorkflow(); return value; };
const workflowBaseColumnCheck=runModelColumnCheck;
runModelColumnCheck=function(){ const value=workflowBaseColumnCheck(); const model=state.editModel, deps=modelDependencySummary(model), health=modelHealthDiagnostics(model), host=els.columnCheckResults; if(host) host.insertAdjacentHTML('afterbegin',`<div class="modelHealthSummary"><strong>Model Health: ${health.some(d=>d.blocking)?`${health.filter(d=>d.blocking).length} blocker(s)`:health.length?`${health.length} warning(s)`:'Ready'}</strong><span>Uses: ${deps.sources.map(s=>esc(labelSource(s))).join(' · ')||'None'}</span><span>${deps.expressions} expressions · ${deps.autofails} autofails · ${deps.minimums} minimums · ${deps.displayColumns} Display Columns · ${deps.trueValues} True Values</span></div>`); return value; };
const workflowBaseCommitSource=commitImportedSource;
commitImportedSource=function(source,file,pack,rows,cfg,meta,options={}){ const value=workflowBaseCommitSource(source,file,pack,rows,cfg,meta,options); const enriched={...(state.sourceMeta[source]||{}),...workflowSourceRowStats(rows||[]),workflowSignature:sourceVersionSignature(source),fileName:file?.name||sourceFileName(source)||'',selectedWorksheet:cfg?.sheetName||'',importedAt:new Date().toISOString()}; state.sourceMeta[source]=enriched; markImportCacheDirty('misc','sourceMeta','source freshness metadata updated'); return value; };
const workflowBaseBuildRun=buildRun;
buildRun=async function(runRequest={}){
  if(runRequest instanceof Event) runRequest={};
  const settings=runRequest.settings||captureRunExecutionSettings(), model=findModel(settings.modelId||els.runModelSelect?.value), preflight=runPreflight(model,settings);
  if(preflight.counts.blocking){ renderRunWorkflow({openDetails:true}); if(runRequest.rethrow) throw new Error('Run Preflight found blocking problems.'); alert('Run Preflight found blocking problems. Open View Details to resolve them.'); return null; }
  const report=await workflowBaseBuildRun(runRequest); if(report&&report.model){ try{ await saveCompletedReport(report,settings,preflight); }catch(error){ console.warn('[Saved Reports] Snapshot could not be stored',error); } injectCompletedReportActions(); } return report;
};

workflowBindUi();
window.ALLSTAR_REPORT_SCHEMA_VERSION=ALLSTAR_REPORT_SCHEMA_VERSION;
window.runPreflight=runPreflight;
window.modelHealthDiagnostics=modelHealthDiagnostics;
window.workflowSourceMetadata=workflowSourceMetadata;
window.compareSavedReportRecords=compareSavedReportRecords;
