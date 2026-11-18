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
  if(!force&&prior.workflowScope===allStarGlobalScopeKey()&&prior.workflowSignature===signature&&Number.isFinite(prior.rowCount)) return prior;
  const rows=getRowsRaw(source)||[];
  const stats=workflowSourceRowStats(rows), book=bookForSource(source)||{};
  const next={...prior,...stats,workflowSignature:signature,workflowScope:allStarGlobalScopeKey(),fileName:sourceFileName(source)||prior.fileName||'',selectedWorksheet:prior.selectedWorksheet||prior.selectedSheet||book.selectedSheets?.[source]||book.sheetName||'',importedAt:prior.lastImportedAt||prior.importedAt||state.importCache?.meta?.savedAt||''};
  state.sourceMeta[source]=next;
  return next;
}
function workflowImportedSources(){
  return allSourceKeys().filter(source=>{ const m=state.sourceMeta?.[source]; return sourceHasImportedData(source)||Number(m?.rowCount||0)>0; });
}
async function workflowSourceMetadataAsync(source){
  const signature=sourceVersionSignature(source), rows=getRowsRaw(source)||[];
  const reps=new Set(), teams=new Set(); let min=Infinity,max=-Infinity,started=performance.now();
  for(let i=0;i<rows.length;i++){
    const row=rows[i], rep=row?._repKey||fullNameIdentityKey(row?._rep||''), team=row?._teamKey||coachNameKey(row?._team||rowTeam(row)||'');
    if(rep) reps.add(rep); if(team) teams.add(team);
    const time=workflowRowTimestamp(row); if(Number.isFinite(time)){ min=Math.min(min,time); max=Math.max(max,time); }
    if(i%256===0&&performance.now()-started>=8){
      await yieldToBrowser(); started=performance.now();
      if(state.reportingDataClearing||signature!==sourceVersionSignature(source)||rows!==getRowsRaw(source)) return null;
    }
  }
  if(signature!==sourceVersionSignature(source)||rows!==getRowsRaw(source)) return null;
  const prior=state.sourceMeta[source]||{}, book=bookForSource(source)||{};
  return state.sourceMeta[source]={...prior,rowCount:rows.length,representativeCount:reps.size,teamCount:teams.size,earliestDate:Number.isFinite(min)?new Date(min).toISOString():'',latestDate:Number.isFinite(max)?new Date(max).toISOString():'',workflowSignature:signature,workflowScope:allStarGlobalScopeKey(),fileName:sourceFileName(source)||prior.fileName||'',selectedWorksheet:prior.selectedWorksheet||prior.selectedSheet||book.selectedSheets?.[source]||'',importedAt:prior.lastImportedAt||prior.importedAt||''};
}
function workflowDateText(value){ const d=value?new Date(value):null; return d&&!isNaN(d)?ymd(d):'—'; }
function workflowImportedTime(value){ const d=value?new Date(value):null; return d&&!isNaN(d)?d.toLocaleString():'—'; }
function currentCoachToolsDataGroups(){
  return [
    {label:'Retail Monthly Stats',sources:['retail_sv2','retail_wiper','retail_team_totals'],fileName:state.data?.retail?.fileName||state.books?.retail?.fileName||''},
    {label:'Referral Monthly Stats',sources:['referral_sv2','referral_wiper','referral_team_totals'],fileName:state.data?.referral?.fileName||state.books?.referral?.fileName||''},
    {label:'Retail Weekly Stats',sources:['weeklyRetail'],fileName:state.data?.weeklyRetail?.fileName||''},
    {label:'Referral Weekly Stats',sources:['weeklyReferral'],fileName:state.data?.weeklyReferral?.fileName||''},
    {label:'QA',sources:['qa'],fileName:state.data?.qa?.fileName||state.books?.qa?.fileName||''},
    {label:'Checklist',sources:['checklist'],fileName:state.data?.checklist?.fileName||state.books?.checklist?.fileName||''},
    {label:'Documented Coaching',sources:['documented_coaching'],fileName:state.data?.documented_coaching?.fileName||state.books?.documented_coaching?.fileName||''},
    {label:'Comp Calls',sources:['comp_calls'],fileName:state.data?.comp_calls?.fileName||state.books?.comp_calls?.fileName||''}
  ].map(group=>{
    const rowCount=group.sources.reduce((sum,source)=>sum+(getRowsUnscoped(source)?.length??0),0);
    const fileName=group.fileName||group.sources.map(source=>state.sourceMeta?.[source]?.fileName).find(Boolean)||'';
    return {...group,fileName,rowCount,ready:rowCount>0||!!fileName};
  });
}
function renderSourceHealthOverview(){
  const host=el('sourceHealthOverview'); if(!host) return;
  const groups=currentCoachToolsDataGroups(), loaded=groups.filter(group=>group.ready).length;
  const cards=groups.map(group=>{
    const metadata=group.sources.map(key=>state.sourceMeta?.[key]||{});
    const area=group.sources[0].split('_')[0],monthly=state.data?.[area]?.monthlySummary;
    const ranges=metadata.map(m=>m.fileCoverage||((m.workflowScope==='all'||!m.workflowSignature)&&m.earliestDate&&m.latestDate?{start:workflowDateText(m.earliestDate),end:workflowDateText(m.latestDate)}:null)).filter(Boolean);
    if(monthly?.period?.start&&monthly.period.end)ranges.push(monthly.period);
    const dates=[...new Set(ranges.map(range=>range.start+' – '+range.end))].join(' · ');
    const needsReview=!group.rowCount||metadata.some(m=>['needs_review','needs-review','review'].includes(m.status)||m.monthlyPartial);
    const needsCategories=categorizationIsStale()&&group.sources.some(key=>(state.categorized?.changedSources||[]).includes(key));
    const status=!group.ready?'Missing':needsReview?'Needs review':needsCategories?'Needs categorization':'Ready';
    const scopes=[...new Set(metadata.map(m=>m.intakeScope).filter(Boolean))].join(' · ');
    return '<div class="currentDataCard"><strong>'+esc(group.label)+'</strong><span>'+group.rowCount.toLocaleString()+' rows</span><small>'+esc(group.fileName||'No file connected')+'</small>'+
      (group.ready?'<span>'+esc(dates||'Date coverage unavailable')+'</span>':'')+
      (scopes?'<span>Import scope · '+esc(scopes)+'</span>':'')+
      '<span class="badge '+(status==='Ready'?'good':'')+'">'+esc(status)+'</span></div>';
  }).join('');
  const imported=workflowImportedSources(), details=state.sourceHealthExpanded?`<div class="sourceMetaCards">${imported.map(source=>{ const m=state.sourceMeta?.[source]||{}; return `<div class="sourceMetaCard"><strong>${esc(labelSource(source))}</strong><span>${Number(m.rowCount||0).toLocaleString()} rows · ${Number(m.representativeCount||0).toLocaleString()} representatives · ${Number(m.teamCount||0).toLocaleString()} teams</span><span>Data: ${workflowDateText(m.earliestDate)} → ${workflowDateText(m.latestDate)}</span><span>${esc(m.selectedWorksheet||m.selectedSheet||'No worksheet selected')}</span></div>`; }).join('')}</div>`:'';
  host.innerHTML=`<div class="sourceHealthHead"><div><strong>${loaded} of ${groups.length} connected</strong><div class="hint">Counts cover each imported file. Open source details for the selected scope.</div></div><button id="refreshSourceHealthBtn" class="smallBtn dark" type="button">Refresh Detailed Metadata</button></div><div class="currentDataGrid">${cards}</div>${details}`;
  el('refreshSourceHealthBtn').onclick=async event=>{
    const button=event.currentTarget; button.disabled=true; button.textContent='Reading source details…';
    try{ for(const source of imported) await workflowSourceMetadataAsync(source); state.sourceHealthExpanded=true; renderSourceHealthOverview(); }
    catch(error){ button.textContent='Refresh failed — try again'; console.warn('[Source details]',error); }
    finally{button.disabled=false;}
  };
}

function renderImportWorkspace(){
  const scope=el('allstarIntakeScope');
  if(scope){const current=window.CoachToolsStorage?.getScope?.();scope.textContent='CoachTools scope · '+(current?.label||current?.mode||'All people');}
  restoreImportFileLabels();
  renderSourceHealthOverview();
  renderCategorizedSummary();
  renderTeamTotalsImportControls();
  renderCustomSourcesList();
  renderImportCacheStatus();
  if(typeof mountCoachNameManager==='function') mountCoachNameManager('coachNameManagement');
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
    items.forEach(item=>{ if(!headerMatch(headers,item.expected)) out.push(allStarDiagnostic({severity:'error',module:'model',source,title:`${item.label||'The model'} cannot find ${item.expected} in ${labelSource(source)}`,message:'Review the source mapping or change the configured column.',entity:item.expected,blocking:true})); });
  });
  (model.criteria||[]).forEach(c=>{
    if(c.calcType==='datedStats'){try{const m=state.metrics.find(m=>m.id===c.datedStatsMetricId);if(!m)throw new Error('Select a reusable Dated Stats metric.');const pack=datedStatsCategory(m.source);if(pack.pending)throw new Error('Review reporting calendar and Categorize Data.');}catch(error){out.push(allStarDiagnostic({severity:'error',module:'model',source:c.source,title:c.name||'Dated Stats',message:error.message,blocking:true}));}}
    if(!c.name) out.push(allStarDiagnostic({severity:'warning',module:'model',source:c.source,title:'Unnamed criterion',message:'Name this criterion so audit details remain understandable.'}));
    if(c.calcType==='custom'&&!String(c.expression||'').trim()) out.push(allStarDiagnostic({severity:'error',module:'model',source:c.source,title:`${c.name||'Custom criterion'} has no expression`,message:'Enter a valid expression before running.',blocking:true}));
    (rowPullWarnings(c)||[]).filter(Boolean).forEach(w=>out.push(allStarDiagnostic({severity:'warning',module:'model',source:c.source,title:`${c.name||'Criterion'} phrase warning`,message:w})));
  });
  try{ compileRunCriterionPlan(model,{qaDateMode:settings.qaDateMode||'interaction',qaTeamScoreMode:settings.qaTeamScoreMode||'assignedReps'}); }
  catch(error){ out.push(allStarDiagnostic({severity:'error',module:'model',title:'Model compilation failed',message:error?.message||String(error),blocking:true})); }
  return out;
}
function preparedRunCoverage(source){
  const idx=state.runIndexes?.get(source);
  if(idx&&idx.signature===sourceVersionSignature(source))return {
    earliestDate:Number.isFinite(idx.coverageMin)?new Date(idx.coverageMin).toISOString():'',
    latestDate:Number.isFinite(idx.coverageMax)?new Date(idx.coverageMax).toISOString():''
  };
  const meta=state.sourceMeta?.[source]||{};
  if(meta.workflowSignature&&(meta.workflowScope!==allStarGlobalScopeKey()||meta.workflowSignature!==sourceVersionSignature(source))) return {};
  return meta;
}
function countRunDates(dates,start,end){
  function bound(value,afterEqual){
    let lo=0,hi=dates.length;
    while(lo<hi){const mid=lo+Math.floor((hi-lo)/2);if(dates[mid]<value||(afterEqual&&dates[mid]===value))lo=mid+1;else hi=mid;}
    return lo;
  }
  return Math.max(0,(end?bound(end.getTime(),true):dates.length)-(start?bound(start.getTime(),false):0));
}
function runPreflight(model,settings={}){
  const began=performance.now();
  const diagnostics=modelHealthDiagnostics(model,settings), deps=modelDependencySummary(model,settings);
  const start=parseDateOnly(settings.startDate), end=parseDateOnly(settings.endDate);
  if(start&&end&&start>end) diagnostics.push(allStarDiagnostic({severity:'error',module:'run',title:'Invalid report dates',message:'Start Date must be on or before End Date.',blocking:true}));
  if((settings.runMode||state.runMode)==='single'&&!(settings.selectedTeams||[]).length&&!(settings.includeOrgIds||[]).length) diagnostics.push(allStarDiagnostic({severity:'error',module:'run',title:'No report population selected',message:'Select at least one team or include one organization.',blocking:true}));
  deps.sources.forEach(source=>{
    if(!sourceHasImportedData(source)) return;
    const m=preparedRunCoverage(source), latest=m.latestDate?new Date(m.latestDate):null;
    if(end&&latest&&!isNaN(latest)&&end.getTime()>latest.getTime()+86400000) diagnostics.push(allStarDiagnostic({severity:'warning',module:'freshness',source,title:`${labelSource(source)} ends before the report`,message:`Latest available date is ${ymd(latest)}; the selected report ends ${ymd(end)}.`}));
  });
  if(deps.sources.includes('documented_coaching')){
    const src='documented_coaching', signature=sourceVersionSignature(src), idx=state.runIndexes?.get(src);
    const summary=idx?.signature===signature?idx.coaching:null, headers=getHeaders(src)||[], dateColumn=sourceDateHeader(src,headers);
    const total=(getRowsRaw(src)||[]).length;
    state.documentedCoachingDiagnostics={centralDataset:readAllStarCentralSyncMap?.().documentedCoaching||null,fileName:sourceFileName(src),
      rawRows:Number(state.sourceMeta?.[src]?.rawRowCount||total),hydratedRows:total,normalizedRows:total,headers:[...headers],
      repColumn:getSourceSetting(activeModelForImport(),src)?.columns?.rep||findHeader(headers,['Associate name','Associate','Agent Name','Rep']),
      coachColumn:getSourceSetting(activeModelForImport(),src)?.columns?.team||findHeader(headers,['Job Coach','Coach Assigned','Coach','Team']),dateColumn,
      validDatedRows:summary?.dates.length??null,matchedRepresentatives:summary?.representatives.size??null,
      unmatchedRepresentatives:summary?.unmatchedRepresentatives??null,matchedCoaches:summary?.matchedCoaches??null,
      unmatchedCoaches:summary?total-summary.matchedCoaches:null,dateRange:{start:ymd(start),end:ymd(end)},
      recordsAfterDateFilter:summary?(dateColumn?(start||end?countRunDates(summary.dates,start,end):total):0):null,
      sourceIndexVersion:signature,runIndexCache:summary?'reused':'preparing'};
    if(total&&(start||end)&&(!dateColumn||summary?.dates.length===0)) diagnostics.push(allStarDiagnostic({severity:'warning',module:'import',source:src,title:'Documented Coaching date column is unusable',message:`Documented Coaching loaded ${total.toLocaleString()} records but no usable coaching date column was detected for this date-filtered report.`}));
  }
  const quarantined=(state.quarantinedRepAliases||[]).length;
  if(quarantined) diagnostics.push(allStarDiagnostic({severity:'warning',module:'identity',title:`${quarantined.toLocaleString()} quarantined identit${quarantined===1?'y':'ies'}`,message:'Review uncertain representative matches; they will not be merged automatically.'}));
  const conflicts=(state.rosterIndex?.conflicts||state.identityConflicts||[]).length;
  if(conflicts) diagnostics.push(allStarDiagnostic({severity:'warning',module:'identity',title:`${conflicts.toLocaleString()} roster conflict${conflicts===1?'':'s'}`,message:'Conflicting identities remain separated and may affect coverage.'}));
  ['retail','referral'].forEach(area=>{ const source=`${area}_team_totals`; if(!deps.sources.includes(source)) return; const ds=state.data?.[area]?.teamTotals, d=ds?.diagnostics||{}; if(d.missingSummarySheet||d.invalidHeaders||(d.teamsWithNoExtractedRow||[]).length) diagnostics.push(allStarDiagnostic({severity:'warning',module:'team totals',source,title:`${labelSource(source)} needs review`,message:teamTotalsSummaryText(area)})); });
  const knownOrgIds=new Set((state.orgs||[]).map(o=>o.id));
  [...(settings.includeOrgIds||[]),...(settings.excludeOrgIds||[]),...(settings.multiOrgIds||[])].filter(id=>!knownOrgIds.has(id)).forEach(id=>diagnostics.push(allStarDiagnostic({severity:'warning',module:'organization',title:'Saved organization is no longer available',message:`Organization id ${id} was removed or renamed.`})));
  const c=allStarDiagnosticCounts(diagnostics), readySources=deps.sources.filter(source=>state.runIndexes?.get(source)?.signature===sourceVersionSignature(source)).length;
  if(typeof AllStarAnalysis!=='undefined')AllStarAnalysis.record('Report readiness','preflight',performance.now()-began,{sources:deps.sources.length});
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
  const inputs=el('reportInputs');
  if(inputs){
    const corrections=result.diagnostics.filter(d=>d.blocking||d.severity==='warning');
    inputs.innerHTML=result.requiredSources.map(source=>{
      const coverage=preparedRunCoverage(source),loaded=sourceHasImportedData(source);
      return `<span class="badge">${esc(labelSource(source))} · ${loaded?'Loaded':'Missing'}${coverage.earliestDate&&coverage.latestDate?' · '+workflowDateText(coverage.earliestDate)+' – '+workflowDateText(coverage.latestDate):''}</span>`;
    }).join('')+corrections.map((d,i)=>`<p>${esc(d.title)} <button type="button" class="smallBtn" data-report-correct="${i}">${d.module==='model'?'Review model':d.module==='run'?'Review setup':d.module==='categorization'?'Categorize data':'Review data'}</button></p>`).join('');
    inputs.querySelectorAll('[data-report-correct]').forEach(button=>button.onclick=()=>{
      const d=corrections[Number(button.dataset.reportCorrect)];
      if(d.module==='run')return (d.title.includes('dates')?els.runStartDate:els.teamSearchInput)?.focus();
      if(d.module==='model'&&model)return openEditModel(model.id);
      openModal('importModal');
    });
  }
  const details=el('runPreflightDetails'); if(details){ details.innerHTML=`<div class="dependencySummary"><strong>Uses</strong><span>${result.requiredSources.length?result.requiredSources.map(s=>esc(labelSource(s))).join(' · '):'No imported sources required'}</span></div><div class="checkResultList">${diagnosticRowsHtml(result.diagnostics)}</div>`; if(openDetails) details.classList.remove('hidden'); }
  if(els.executeRunBtn) els.executeRunBtn.disabled=!!result.counts.blocking||!!state.multiRunActive||!!activeReportJob;
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
  const s=preset.settings||{};
  applyReportSettings(s,preset.dateMode==='fixed'?s:workflowPresetDates(preset.dateMode,preset.lastDays));
}
function applyReportSettings(s,dates=s){
  workflowSetSelect(els.runModelSelect,s.modelId); workflowSetSelect(els.runViewSelect,s.view); workflowSetSelect(els.runQADateSelect,s.qaDateMode); workflowSetSelect(els.runQATeamScoreMode,s.qaTeamScoreMode); workflowSetSelect(els.hideNoScoreThreshold,s.hideNoScoreThreshold);
  if(els.runStartDate) els.runStartDate.value=dates.startDate||''; if(els.runEndDate) els.runEndDate.value=dates.endDate||''; if(els.hideNoScoreReps) els.hideNoScoreReps.checked=!!s.hideNoScore;
  els.hideNoScoreThreshold?.classList.toggle('hidden',!s.hideNoScore);
  if(el('runReportNote')&&s.reportNote!==undefined)el('runReportNote').value=s.reportNote;
  if(els.rankRepresentativesWithinTeam) els.rankRepresentativesWithinTeam.checked=!!s.teamSpecificRepRanking;
  state.selectedTeams=new Set((s.selectedTeams||[]).map(canonicalCoachName).filter(Boolean)); state.teamSelectionInitialized=true; state.runIncludeOrgs=new Set(s.includeOrgIds||[]); state.runExcludeOrgs=new Set(s.excludeOrgIds||[]); state.multiRunOrgIds=new Set(s.multiOrgIds||[]);
  renderTeamSelect();applyRunMode(s.runMode||'single'); renderRunOrgSelect(); renderMultiRunOrgSelect(); updateRunQADateField(); updateMultiRunSummary(); saveRunSettings(); beginSelectedModelPreparation(); renderRunWorkflow({openDetails:true});
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
async function workflowReportTransaction(mode,run){ const revision=state.versions?.data||0, generation=state.reportingDataGeneration||''; if(state.reportingDataClearing||state.reportingDataCleanupPending) return null; const db=await workflowReportDb(); if(state.reportingDataClearing||state.reportingDataCleanupPending||(mode==='readwrite'&&revision!==(state.versions?.data||0))||generation!==(state.reportingDataGeneration||'')){db.close();return null;} return new Promise((resolve,reject)=>{ const tx=db.transaction(ALLSTAR_REPORT_STORE,mode), store=tx.objectStore(ALLSTAR_REPORT_STORE); let value; try{ value=run(store);if(value?.catch)value.catch(()=>{}); }catch(e){tx.abort();db.close();reject(e);return;} tx.oncomplete=()=>{db.close();resolve(value);}; tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||new Error('Saved report transaction interrupted.'));}; }); }
function workflowRequest(req){ return new Promise((resolve,reject)=>{ req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function listSavedReports({allowPendingRename=false}={}){ if(!allowPendingRename&&state.coachRenameReferences?.pendingSavedReports?.length) return []; const generation=state.reportingDataGeneration||''; if(state.reportingDataClearing||state.reportingDataCleanupPending) return []; const db=await workflowReportDb(); try{ const tx=db.transaction(ALLSTAR_REPORT_STORE,'readonly'); const rows=await workflowRequest(tx.objectStore(ALLSTAR_REPORT_STORE).getAll()); if(state.reportingDataClearing||state.reportingDataCleanupPending||generation!==(state.reportingDataGeneration||'')) return []; return rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))); }finally{db.close();} }
// The original records remain authoritative. The small list cache may be discarded
// at any time, including when an older portable copy adds or deletes snapshots.
const REPORT_LIST_CACHE_KEY='allStarReportList.v1';
function readReportListCache(){
  try{ return new Map(JSON.parse(localStorage.getItem(REPORT_LIST_CACHE_KEY)||'[]')); }catch(_){return new Map();}
}
function writeReportListCache(cache){
  try{localStorage.setItem(REPORT_LIST_CACHE_KEY,JSON.stringify([...cache]));}catch(_){}
}
function reportSummary(rec){
  const {id,createdAt,modelName,periodStart,periodEnd,note,organizationName}=rec;
  return {id,createdAt,modelName,periodStart,periodEnd,note,organizationName,teamCount:rec.teams?.length||0};
}
function reportReadsAllowed(generation){
  return !state.reportingDataClearing&&!state.reportingDataCleanupPending&&!state.coachRenameReferences?.pendingSavedReports?.length&&generation===(state.reportingDataGeneration||'');
}
async function getSavedReport(id){
  const generation=state.reportingDataGeneration||'';
  if(!reportReadsAllowed(generation)) return null;
  const record=await workflowReportTransaction('readonly',store=>workflowRequest(store.get(id)));
  return reportReadsAllowed(generation)?record:null;
}
async function listSavedReportSummaries(){
  const generation=state.reportingDataGeneration||'';
  if(!reportReadsAllowed(generation)) return [];
  const ids=await workflowReportTransaction('readonly',store=>workflowRequest(store.getAllKeys()));
  if(!ids||!reportReadsAllowed(generation)) return [];
  const cache=readReportListCache(), summaries=[];
  let backfilled=false;
  for(const id of ids){
    let metadata=cache.get(id);
    if(!metadata||metadata.id!==id){
      // Each historical payload is released before fetching the next.
      const record=await getSavedReport(id);
      if(!record) continue;
      metadata=reportSummary(record);backfilled=true;
    }
    summaries.push(metadata);
  }
  if(!reportReadsAllowed(generation)) return [];
  if(backfilled||cache.size!==summaries.length){
    // A concurrent save or rename may have published a newer summary while
    // legacy payloads were being read. Preserve its entries.
    const current=readReportListCache();
    for(const [id,meta] of cache)if(!ids.includes(id)&&current.get(id)?.createdAt===meta.createdAt)current.delete(id);
    for(const meta of summaries)if(!current.has(meta.id))current.set(meta.id,meta);
    writeReportListCache(current);
  }
  return summaries.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||String(b.id).localeCompare(String(a.id)));
}
function workflowPlain(value){ return JSON.parse(JSON.stringify(value)); }
async function renameCoachSavedReports(from,to,{merge=false}={}){
  const key=exactCoachNameKey(from), replace=name=>exactCoachNameKey(name)===key?to:name;
  const records=await listSavedReports({allowPendingRename:true}), changed=[];
  for(const original of records){
    await new Promise(resolve=>setTimeout(resolve,0));
    const rec=workflowPlain(original); let affected=false;
    const replaceNames=names=>(names||[]).map(name=>{const next=replace(name);if(next!==name)affected=true;return next;});
    rec.teams=[...new Set(replaceNames(rec.teams))];
    // Typed references include representative-only packs and diagnostic/model scopes.
    // Compare values: the reference walker also copies unchanged arrays.
    const reportBefore=JSON.stringify(rec.report||{}), report=coachRenameReferences(rec.report||{},from,to);rec.report=report;
    if(JSON.stringify(report)!==reportBefore)affected=true;
    for(const [kind,pack] of [['team',report.teamPack],['rep',report.repPack],['rep',report.teamRepPack]]){
      for(const row of pack?.rows||[]){
        if(!row.entry)continue;
        if(kind==='team'){const name=replace(row.entry.name);if(name!==row.entry.name){affected=true;if(row.entry.key===coachNameKey(from))row.entry.key=coachNameKey(to);}row.entry.name=name;}
        if(row.entry.team){const name=replace(row.entry.team);if(name!==row.entry.team)affected=true;row.entry.team=name;}
      }
    }
    if(report.runOpts)report.runOpts.selectedTeamNames=[...new Set(replaceNames(report.runOpts.selectedTeamNames))];
    if(rec.settings)rec.settings.selectedTeams=[...new Set(replaceNames(rec.settings.selectedTeams))];
    if(affected){
      rec.coachNameUpdatedAt=new Date().toISOString();
      // Cached averages, eligibility and ranks require the original report
      // engine when coaches merge; never add those cached values together.
      if(merge)rec.requiresRerun='Coach records were combined. Re-run this report to recalculate team scores and rankings.';
      changed.push(rec);
    }
  }
  if(changed.length){
    await workflowReportTransaction('readwrite',store=>changed.forEach(rec=>store.put(rec)));
    const cache=readReportListCache();for(const rec of changed)cache.set(rec.id,reportSummary(rec));writeReportListCache(cache);
  }
  if(typeof renameQualtricsCoachHistory==='function')await renameQualtricsCoachHistory(from,to);
  window.AllStarWorkspaceNavigation?.refresh();
  return true;
}
async function recoverCoachSavedReportRenames(){
  const pending=state.coachRenameReferences?.pendingSavedReports||[];
  for(const entry of pending){
    await renameCoachSavedReports(entry.from,entry.to,{merge:entry.merge});
    state.coachRenameReferences={...state.coachRenameReferences,pendingSavedReports:(state.coachRenameReferences.pendingSavedReports||[]).filter(item=>item.id!==entry.id)};
    markImportCacheDirty('misc','coachRenameReferences','Recovered saved report coach names');
  }
  if(pending.length)await saveImportedDataToIndexedDB('Recovered saved report coach names',{silent:true,dirtyOnly:true,noRender:true,deferIndexes:true,noRetry:true});
}
function savedReportNeedsRerun(rec){
  if(!rec?.requiresRerun)return false;
  alert(rec.requiresRerun+' Your saved snapshot is retained. Choose Run Model with the original dates to create an updated report.');
  return true;
}
function workflowReportSnapshot(report){
  const safeOpts={pdfOptions:report?.runOpts?.pdfOptions,qaSourceLabel:report?.runOpts?.qaSourceLabel,monthlyCoverage:report?.monthlyCoverage||'',rosterCount:report?.runOpts?.rosterCount,selectedTeamNames:report?.runOpts?.selectedTeamNames||[],organizationId:report?.runOpts?.organizationId||'',organizationName:report?.runOpts?.organizationName||'',teamSpecificRepRanking:!!report?.runOpts?.teamSpecificRepRanking,qaTeamScoreMode:report?.runOpts?.qaTeamScoreMode||'assignedReps',trueValueDiagnostics:report?.runOpts?.trueValueDiagnostics||[]};
  return {model:workflowPlain(report.model),teamPack:workflowPlain(report.teamPack),repPack:workflowPlain(report.repPack),teamRepPack:workflowPlain(report.teamRepPack||report.repPack),view:report.view,start:report.start?ymd(report.start):'',end:report.end?ymd(report.end):'',qaDateMode:report.qaDateMode,runOpts:workflowPlain(safeOpts)};
}
async function saveCompletedReport(report,settings={},preflight=null){
  if(!report||state.reportingDataClearing||state.reportingDataCleanupPending||state.coachRenameActive||(report.runOpts?._dataRevision!==undefined&&report.runOpts._dataRevision!==(state.versions?.data||0))) return null;
  const saveStart=performance.now();
  const note=String(settings.reportNote??el('runReportNote')?.value??'').trim(), deps=modelDependencySummary(report.model,settings), sourceSignature=Object.fromEntries(deps.sources.map(s=>[s,sourceVersionSignature(s)]));
  const rec={id:'report_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),allStarReportSchemaVersion:ALLSTAR_REPORT_SCHEMA_VERSION,createdAt:new Date().toISOString(),modelId:report.model?.id||'',modelName:report.model?.name||'All-Star Report',periodStart:report.start?ymd(report.start):'',periodEnd:report.end?ymd(report.end):'',teams:report.runOpts?.selectedTeamNames||[],organizationName:report.runOpts?.organizationName||'',settings:workflowPlain(settings),note,sourceSignature,modelSignature:stableSerialize(report.model||{}),scopeKey:typeof allStarGlobalScopeKey==='function'?allStarGlobalScopeKey():'all',diagnostics:workflowPlain(preflight?.diagnostics||[]),report:workflowReportSnapshot(report)};
  const written=await workflowReportTransaction('readwrite',store=>{
    if(report.runOpts?._reportInputVersion&&report.runOpts._reportInputVersion!==reportInputVersion()) return false;
    store.put(rec); return true;
  });
  if(!written) return null;
  const cached=readReportListCache();cached.set(rec.id,reportSummary(rec));writeReportListCache(cached);
  const all=await listSavedReportSummaries(); if(all.length>ALLSTAR_REPORT_LIMIT) await workflowReportTransaction('readwrite',store=>all.slice(ALLSTAR_REPORT_LIMIT).forEach(x=>store.delete(x.id)));
  AllStarAnalysis.record('Report snapshot','saved report',performance.now()-saveStart);return rec;
}
async function deleteSavedReport(id){ if(!confirm('Delete this saved report snapshot?')) return; await workflowReportTransaction('readwrite',store=>store.delete(id));comparedReports.delete(id);await renderRecentRuns(); }
function hydrateSavedReport(rec){ const r=workflowPlain(rec.report); r.start=parseDateOnly(r.start); r.end=parseDateOnly(r.end);r.monthlyCoverage=r.runOpts?.monthlyCoverage||'';
  r.runOpts={...r.runOpts,start:r.start,end:r.end,qaDateMode:r.qaDateMode,_saved:true,
    _evidenceUnavailable:!rec.sourceSignature||Object.entries(rec.sourceSignature).some(([source,signature])=>signature!==sourceVersionSignature(source))}; return r; }
async function openSavedReport(id){ const rec=await getSavedReport(id); if(!rec||savedReportNeedsRerun(rec)) return; cancelReportRun();const report=hydrateSavedReport(rec); renderResults(report.model,report.teamPack,report.repPack,report.view,report.start,report.end,report.qaDateMode,report.runOpts,report.teamRepPack); if(els.workArea) els.workArea.querySelector('.reportMeta')?.insertAdjacentHTML('beforeend',`<span class="badge warn">Saved snapshot: ${esc(new Date(rec.createdAt).toLocaleString())}</span>${report.runOpts._evidenceUnavailable?'<span class="badge warn">Source rows changed. Historical values retained.</span>':''}${rec.note?`<span class="badge">Note: ${esc(rec.note)}</span>`:''}`); closeModal('recentRunsModal'); injectCompletedReportActions(); }
async function reexportSavedReport(id){ const rec=await getSavedReport(id); if(rec&&!savedReportNeedsRerun(rec)) await exportPDF({report:hydrateSavedReport(rec),options:rec.report?.runOpts?.pdfOptions}); }
function reportRowMap(pack){ return new Map((pack?.rows||[]).map(r=>[nameKey(r.entry?.name||''),r])); }
function comparePack(oldPack,newPack,kind){
  const before=reportRowMap(oldPack), after=reportRowMap(newPack), rows=[];
  new Set([...before.keys(),...after.keys()]).forEach(key=>{ const a=before.get(key),b=after.get(key), name=b?.entry?.name||a?.entry?.name||key, rankA=Number(a?.overallRank),rankB=Number(b?.overallRank),scoreA=Number(a?.overallScore),scoreB=Number(b?.overallScore); rows.push({name,kind,rankA:Number.isFinite(rankA)?rankA:null,rankB:Number.isFinite(rankB)?rankB:null,rankChange:Number.isFinite(rankA)&&Number.isFinite(rankB)?rankA-rankB:null,scoreA:Number.isFinite(scoreA)?scoreA:null,scoreB:Number.isFinite(scoreB)?scoreB:null,scoreChange:Number.isFinite(scoreA)&&Number.isFinite(scoreB)?scoreB-scoreA:null,newlyEligible:!!b?.eligible&&!a?.eligible,newlyIneligible:!!a?.eligible&&!b?.eligible}); });
  return rows.sort((a,b)=>Math.abs(b.scoreChange||0)-Math.abs(a.scoreChange||0));
}
function compareSavedReportRecords(older,newer){
  const a=hydrateSavedReport(older),b=hydrateSavedReport(newer), config=[];
  if(older.scopeKey&&newer.scopeKey&&older.scopeKey!==newer.scopeKey)config.push(`CoachTools scope changed · ${older.scopeKey} → ${newer.scopeKey}`);
  if(older.modelSignature!==newer.modelSignature) config.push(`Model updated · ${older.modelName} → ${newer.modelName}`); for(const source of new Set([...Object.keys(older.sourceSignature||{}),...Object.keys(newer.sourceSignature||{})])) if(older.sourceSignature?.[source]!==newer.sourceSignature?.[source]) config.push(`Source data changed · ${labelSource(source)}`); if(older.settings?.qaDateMode!==newer.settings?.qaDateMode) config.push('QA date mode changed'); if(stableSerialize(older.teams)!==stableSerialize(newer.teams)) config.push('Team population changed'); if(older.organizationName!==newer.organizationName||stableSerialize([older.settings?.includeOrgIds,older.settings?.excludeOrgIds])!==stableSerialize([newer.settings?.includeOrgIds,newer.settings?.excludeOrgIds])) config.push('Organization selection changed');
  return {older,newer,config,teams:comparePack(a.teamPack,b.teamPack,'team'),reps:comparePack(a.repPack,b.repPack,'rep')};
}
function comparisonTable(title,rows){ const shown=rows.filter(r=>r.rankChange||r.scoreChange||r.newlyEligible||r.newlyIneligible).slice(0,25); return `<div class="comparisonSection"><strong>${esc(title)}</strong><div class="tableWrap"><table><thead><tr><th>Name</th><th>Rank</th><th>Score</th><th>Movement</th></tr></thead><tbody>${shown.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.rankA??'—'} → ${r.rankB??'—'}</td><td>${r.scoreA==null?'—':fmt(r.scoreA,'number')} → ${r.scoreB==null?'—':fmt(r.scoreB,'number')}</td><td>${r.newlyEligible?'<span class="badge good">Newly eligible</span>':r.newlyIneligible?'<span class="badge bad">Newly ineligible</span>':`${r.rankChange>0?'+':''}${r.rankChange||0} rank · ${r.scoreChange>0?'+':''}${Number(r.scoreChange||0).toFixed(2)} score`}</td></tr>`).join('')||'<tr><td colspan="4">No movement found.</td></tr>'}</tbody></table></div></div>`; }
async function compareSelectedReports(){
  const ids=[...new Set([...comparedReports,...[...document.querySelectorAll('[data-compare-report]:checked')].map(x=>x.value)])]; if(ids.length!==2) return alert('Select exactly two compatible saved reports to compare.');
  const chosen=(await Promise.all(ids.map(getSavedReport))).filter(Boolean).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))); if(chosen.length!==2||chosen.some(savedReportNeedsRerun)) return;
  if(chosen.some(r=>r.allStarReportSchemaVersion!==ALLSTAR_REPORT_SCHEMA_VERSION)) return alert('One saved report uses an incompatible report schema.');
  const c=compareSavedReportRecords(chosen[0],chosen[1]), host=el('recentRunComparison');
  host.innerHTML=`<div class="comparisonHeader"><strong>${esc(chosen[0].modelName)} · ${esc(chosen[0].periodStart||'All dates')} → ${esc(chosen[1].periodEnd||'All dates')}</strong><span>${esc(new Date(chosen[0].createdAt).toLocaleString())} compared with ${esc(new Date(chosen[1].createdAt).toLocaleString())}</span></div>${c.config.length?`<div class="configurationWarning"><strong>Configuration Changed</strong><span>${c.config.map(esc).join(' · ')}</span><small>Treat movement cautiously; this is not a strict apples-to-apples comparison.</small></div>`:''}${comparisonTable('Team movement',c.teams)}${comparisonTable('Representative movement',c.reps)}`;
}
let recentRunPage=0;
const comparedReports=new Set();
async function renderRecentRuns(){
  const host=el('recentRunsList'); if(!host) return; const rows=await listSavedReportSummaries();
  const pages=Math.max(1,Math.ceil(rows.length/5));
  recentRunPage=Math.min(recentRunPage,pages-1);
  host.innerHTML=rows.slice(recentRunPage*5,recentRunPage*5+5).map(r=>`<div class="recentRunRow"><label><input type="checkbox" data-compare-report value="${esc(r.id)}" ${comparedReports.has(r.id)?'checked':''}><span><strong>${esc(r.modelName)}</strong><small>${esc(r.periodStart||'All dates')} → ${esc(r.periodEnd||'All dates')} · ${esc(new Date(r.createdAt).toLocaleString())} · ${r.teamCount} teams${r.organizationName?` · ${esc(r.organizationName)}`:''}</small>${r.note?`<small>Note: ${esc(r.note)}</small>`:''}</span></label><div class="recentRunActions"><button class="smallBtn dark" data-open-report="${esc(r.id)}">Open</button><button class="smallBtn" data-rerun-report="${esc(r.id)}">Run again</button><button class="smallBtn" data-export-report="${esc(r.id)}">Re-export</button><button class="smallBtn red" data-delete-report="${esc(r.id)}">Delete</button></div></div>`).join('')||'<div class="checkItem">No saved runs yet. Successful reports are stored here automatically.</div>';
  if(pages>1){
    host.insertAdjacentHTML('beforeend',`<div class="row"><button type="button" data-report-page="-1" ${recentRunPage===0?'disabled':''}>Previous</button><span role="status">Page ${recentRunPage+1} of ${pages}</span><button type="button" data-report-page="1" ${recentRunPage===pages-1?'disabled':''}>Next</button></div>`);
    host.querySelectorAll('[data-report-page]').forEach(b=>b.onclick=()=>{recentRunPage+=Number(b.dataset.reportPage);renderRecentRuns();});
  }
  host.querySelectorAll('[data-compare-report]').forEach(input=>input.onchange=()=>input.checked?comparedReports.add(input.value):comparedReports.delete(input.value));
  host.querySelectorAll('[data-rerun-report]').forEach(b=>b.onclick=async()=>{
    const rec=await getSavedReport(b.dataset.rerunReport); if(!rec) return;
    if(!findModel(rec.modelId))return alert('This saved model is no longer available. Restore the model to run it again.');
    closeModal('recentRunsModal');await els.runBtn.onclick();
    const settings={...rec.settings,modelId:rec.modelId,startDate:rec.periodStart,endDate:rec.periodEnd,reportNote:rec.note||''};
    if(rec.organizationName){
      const orgId=rec.report?.runOpts?.organizationId;
      if(orgId&&!(state.orgs||[]).some(o=>o.id===orgId))return alert('This organization was removed. Choose the scope for a new report.');
      settings.selectedTeams=orgId?[]:rec.teams||[];settings.includeOrgIds=orgId?[orgId]:[];settings.excludeOrgIds=[];settings.runMode='single';
    }
    applyReportSettings(settings);reportStage('Saved run settings restored.');els.executeRunBtn?.focus();
  });
  host.querySelectorAll('[data-open-report]').forEach(b=>b.onclick=()=>openSavedReport(b.dataset.openReport)); host.querySelectorAll('[data-export-report]').forEach(b=>b.onclick=()=>reexportSavedReport(b.dataset.exportReport)); host.querySelectorAll('[data-delete-report]').forEach(b=>b.onclick=()=>deleteSavedReport(b.dataset.deleteReport));
}
async function openRecentRuns(){ recentRunPage=0;comparedReports.clear();el('recentRunComparison').innerHTML=''; await renderRecentRuns(); openModal('recentRunsModal'); }
function injectCompletedReportActions(){ const header=els.workArea?.querySelector('.reportHeader'); if(!header||header.querySelector('.completedReportActions')) return; header.insertAdjacentHTML('beforeend','<div class="completedReportActions"><button id="openRecentRunsFromReport" class="smallBtn dark" type="button">Recent Runs</button><button id="explainReportHelp" class="smallBtn" type="button">Calculation Audit</button></div>'); el('openRecentRunsFromReport').onclick=openRecentRuns; el('explainReportHelp').onclick=()=>alert('Click any underlined criterion value in the report to see its source rows, filters, numerator/denominator, aggregation, and displayed calculation.'); }

function workflowBindUi(){
  renderRunPresetOptions();
  const toggle=el('reportFocusedMode'),options=el('reportOptions');
  if(toggle){
    try{toggle.checked=localStorage.getItem('allStarFocusedReports.v1')==='true';}catch(_){}
    const update=()=>{
      options.open=!toggle.checked;
      el('runModal').dataset.focused=String(toggle.checked);
      try{localStorage.setItem('allStarFocusedReports.v1',String(toggle.checked));}catch(_){}
    };
    toggle.onchange=update;update();
  }
  if(el('reportCancel'))el('reportCancel').onclick=cancelReportRun;
  els.runModelSelect?.addEventListener('change',cancelReportRun);
  el('runModal')?.addEventListener('change',event=>{
    if(event.target.closest('#singleRunSelectionPanel,#multiRunPanel')||['runStartDate','runEndDate'].includes(event.target.id))renderRunWorkflow();
  });
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
commitImportedSource=function(source,file,pack,rows,cfg,meta,options={}){ const value=workflowBaseCommitSource(source,file,pack,rows,cfg,meta,options); const enriched={...(state.sourceMeta[source]||{}),rowCount:(rows||[]).length,workflowSignature:'',fileName:file?.name||sourceFileName(source)||'',selectedWorksheet:cfg?.sheetName||'',importedAt:new Date().toISOString()}; state.sourceMeta[source]=enriched; markImportCacheDirty('misc','sourceMeta','source freshness metadata updated'); return value; };
const workflowBaseBuildRun=buildRun;
buildRun=async function(runRequest={}){
  if(runRequest instanceof Event) runRequest={};
  const settings=runRequest.settings||{...captureRunExecutionSettings(),reportNote:el('runReportNote')?.value||''}, model=findModel(settings.modelId||els.runModelSelect?.value), preflight=runPreflight(model,settings);
  if(preflight.counts.blocking){ renderRunWorkflow({openDetails:true}); if(runRequest.rethrow) throw new Error('Run Preflight found blocking problems.'); alert('Run Preflight found blocking problems. Open View Details to resolve them.'); return null; }
  const report=await workflowBaseBuildRun({...runRequest,settings}); if(report&&report.model){ try{ await saveCompletedReport(report,settings,runPreflight(model,settings)); }catch(error){ console.warn('[Saved Reports] Snapshot could not be stored',error); } injectCompletedReportActions(); } return report;
};

workflowBindUi();
window.ALLSTAR_REPORT_SCHEMA_VERSION=ALLSTAR_REPORT_SCHEMA_VERSION;
window.runPreflight=runPreflight;
window.modelHealthDiagnostics=modelHealthDiagnostics;
window.workflowSourceMetadata=workflowSourceMetadata;
window.compareSavedReportRecords=compareSavedReportRecords;
