/* Adapter into the existing All-Star sources, rosters and verified import transaction. */
'use strict';
function monthlyAreaData(bundle,area,current={},selection=null){
  const M=window.CoachToolsMonthly,out=M.compile(bundle);
  if(!out.canApply)throw new Error('Monthly bundle needs review before it can replace committed data.');
  const rows=out.reps.filter(r=>r.area===area&&(!selection||selection.some(([name,coach])=>M.key(name)===M.key(r.name)&&M.key(coach)===M.key(r.coach))));
  const identity=r=>({_monthly:true,_rosterId:`monthly|${area}|${r.id}`,_rep:r.name,_repKey:fullNameIdentityKey(r.name),_rawRep:r.name,_rawRepKey:fullNameIdentityKey(r.name),_team:r.coach,_sourceArea:area,_date:'',_monthlyPeriod:out.period?.id||'',_monthlyUndated:out.undated,_importedAt:bundle.importedAt||''});
  const sv2=rows.map(r=>({...M.stats(r,out.consumerAsCash),...identity(r),_sourceKey:`${area}_sv2`,_sourceRow:r.sourceRow,_monthlyStatus:Object.fromEntries(M.SEGMENTS.map(s=>[s,r.segments[s].status]))}));
  const wiper=rows.map(r=>({...M.wipers(r),...identity(r),_sourceKey:`${area}_wiper`,_monthlyStatus:r.wiper.status,_contributions:r.wiper.contributions}));
  const controlRoster=rows.map(r=>({...identity(r),rosterId:`monthly|${area}|${r.id}`,source:area,sourceArea:area,team:r.coach,representative:r.name,displayName:r.name,originalName:r.name,fullNameKey:fullNameIdentityKey(r.name),_isControlRoster:true,_sourceKey:`${area}_control_roster`,workbook:bundle.opportunity.name,sheetName:'Monthly Opportunity',rowNumber:r.sourceRow,controlRosterSchemaVersion:CONTROL_ROSTER_SCHEMA_VERSION}));
  const teamRows=out.teams.filter(t=>t.area===area).map(t=>({...M.stats(t,out.consumerAsCash),...M.wipers(t),'Full Team Name':t.coach,_team:t.coach,_teamKey:coachNameKey(t.coach),_sourceKey:`${area}_team_totals`,_monthly:true,_monthlyUndated:out.undated,_importedAt:bundle.importedAt||'',_monthlyPartial:out.partial,_summarySheet:'Calculated from monthly representatives',_monthlyStatus:{...Object.fromEntries(M.SEGMENTS.map(s=>[s,t.segments[s].status])),wiper:t.wiper.status}}));
  const headers=rs=>Object.keys(rs[0]||{}).filter(k=>!k.startsWith('_'));
  const sv2Headers=headers(sv2),wiperHeaders=headers(wiper),aoa=(hs,rs)=>[hs,...rs.map(r=>hs.map(h=>r[h]))];
  const history={...(current.monthlyHistory||{})};
  if(current.monthlyBundle){const previous=M.compile(current.monthlyBundle).period,changed=current.monthlyBundle.opportunity?.canonical!==bundle.opportunity?.canonical;if((previous&&previous.id!==out.period?.id)||(!previous&&changed)){const key=previous?.id||`loaded-${current.monthlyBundle.importedAt||'unknown'}-${current.monthlyBundle.opportunity.id}`;history[key]=M.clone(current.monthlyBundle);}}
  return {...current,fileName:bundle.opportunity.name,monthlyBundle:M.clone(bundle),monthlySelection:selection,monthlyHistory:history,monthlySummary:{period:out.period,undated:out.undated,importedAt:bundle.importedAt||'',partial:out.partial,issues:out.issues.length,files:bundle.wipers.map(f=>({id:f.id,name:f.name,importedAt:f.importedAt||'',assignments:f.assignments,replaces:f.replaces})),repCount:rows.length,teamCount:teamRows.length},sv2,wiper,sv2Aoa:aoa(sv2Headers,sv2),wiperAoa:aoa(wiperHeaders,wiper),controlRoster,headers:{...(current.headers||{}),sv2:sv2Headers,wiper:wiperHeaders,...(area==='referral'?{itac:[]}:{})},...(area==='referral'?{itac:[],itacAoa:[],itacSheetName:''}:{}),teamTotals:{...emptyTeamTotalsDataset(area),fileName:'Calculated monthly team totals',headers:headers(teamRows),rows:teamRows,_sourceKey:`${area}_team_totals`,diagnostics:{controlTeamsInspected:teamRows.length,teamsWithNoExtractedRow:[]}}};
}
function restoreMonthlyBundles(data){
  if(!window.CoachToolsMonthly)return;
  for(const area of ['retail','referral'])if(data[area]?.monthlyBundle)data[area]=monthlyAreaData(data[area].monthlyBundle,area,data[area],data[area].monthlySelection||null);
}
function applyMonthlyBundleInStage(bundle,onlyArea,selection=null,options={}){
  bundle={...bundle,importedAt:bundle.importedAt||new Date().toISOString()};
  const M=window.CoachToolsMonthly,out=M.compile(bundle);
  if(!out.canApply)throw new Error('Resolve monthly import issues before applying.');
  const areas=onlyArea?[onlyArea]:bundle.scope==='mixed'?['retail','referral']:[...new Set(out.reps.map(r=>r.area))];
  // A contribution belongs to only one area, even across separate monthly uploads.
  if(areas.length===1&&!options.coordinated){
    const other=areas[0]==='retail'?'referral':'retail',otherBundle=state.data[other]?.monthlyBundle;
    if(otherBundle){const otherOut=M.compile(otherBundle);if(out.undated||otherOut.undated||otherOut.period?.id===out.period?.id){const used=new Set(otherOut.reps.filter(r=>r.area===other).flatMap(r=>r.wiper.contributions.map(c=>`${c.fileId}:${c.row}`)));if(out.reps.filter(r=>r.area===areas[0]).some(r=>r.wiper.contributions.some(c=>used.has(`${c.fileId}:${c.row}`))))throw new Error('Some wiper contributions are already assigned to the other monthly area. Use one mixed-area bundle and review the coach mapping.');}}
  }
  for(const area of areas){
    state.data[area]=monthlyAreaData(bundle,area,state.data[area],selection);
    const d=state.data[area];
    replaceWorkbookCache(area,{fileName:d.fileName,sheetNames:['Monthly Opportunity','Monthly Wipers'],selectedSheets:{[`${area}_sv2`]:'Monthly Opportunity',[`${area}_wiper`]:'Monthly Wipers'},aoaBySheet:{'Monthly Opportunity':d.sv2Aoa,'Monthly Wipers':d.wiperAoa}},'monthly export bundle');
    for(const source of [`${area}_sv2`,`${area}_wiper`,`${area}_team_totals`]){noteCategorizationSourceVersion(source);state.sourceMeta[source]={...(state.sourceMeta[source]||{}),monthlyFormat:1,monthlyPartial:out.partial,monthlyPeriod:out.period?.id||'',monthlyUndated:out.undated,lastImportedAt:bundle.importedAt};}
    for(const source of [`${area}_sv2`,`${area}_wiper`,`${area}_team_totals`])state.sourceMeta[source]={...(state.sourceMeta[source]||{}),importJobId:state.activeImportJob?.id};
    (area==='retail'?markRetailPersistenceDirty:markReferralPersistenceDirty)('monthly export bundle');
    markCategorizationNeeded('Monthly bundle updated',[`${area}_sv2`,`${area}_wiper`]);
  }
  return true;
}
async function commitMonthlyBundle(bundle,options={}){
  if(!bundle?.opportunity)throw new Error('Choose an Opportunity file before saving monthly data.');
  if(options.throwOnFailure&&(state.activeImportJob||state.centralSyncStageActive||state.importCacheLoading||state.startup?.running))throw new Error('All-Star is still loading or saving data. Your files are retained; try Save monthly data again when it finishes.');
  const areas=bundle.scope==='mixed'?['retail','referral']:[...new Set(window.CoachToolsMonthly.compile(bundle).reps.map(r=>r.area))];
  const source=areas.length===2?'monthly':areas[0];
  let failure;
  const ok=await runAllStarImport(source,{name:bundle.opportunity.name,size:0},{...options,label:'Monthly export bundle',onError:error=>{failure=error;options.onError?.(error);}},async()=>applyMonthlyBundleInStage(bundle));
  if(ok)renderMonthlyImportSummary();
  else if(options.throwOnFailure)throw failure||new Error('Monthly data was not saved. Your selected files are retained; please retry.');
  return ok;
}
async function monthlyFileRoute(area,file,options={}){
  if(!window.CoachToolsMonthly)return {handled:false,workbook:options.workbook};
  if(options.monthlyBundle)return {handled:true,result:await commitMonthlyBundle(options.monthlyBundle,options)};
  const wb=options.workbook||await readFileWorkbook(file);
  if(wb.__monthlyBundle)return {handled:true,result:await commitMonthlyBundle(wb.__monthlyBundle,options)};
  const sn=(wb.SheetNames||[]).find(sn=>window.CoachToolsMonthly.detect(sheetAoa(wb,sn)));
  if(!sn)return {handled:false,workbook:wb};
  const src=window.CoachToolsMonthly.source(sheetAoa(wb,sn),file.name);
  const current=state.data[area]?.monthlyBundle;
  hideProgress();
  const bundle=await window.CoachToolsMonthlyReview.review({bundle:current||window.CoachToolsMonthly.create(area),sources:[src],previousRoster:monthlyExistingRoster(),onApply:b=>commitMonthlyBundle(b,{...options,silent:true,throwOnFailure:true})});
  return {handled:true,result:!!bundle};
}
async function openMonthlyImport(area='mixed',readOnly=false,period=''){
  let existing=period?state.data[area]?.monthlyHistory?.[period]:state.data[area]?.monthlyBundle;
  if(area==='mixed')existing=['retail','referral'].map(a=>state.data[a]?.monthlyBundle).find(b=>b?.scope==='mixed')||null;
  return window.CoachToolsMonthlyReview.review({bundle:existing||window.CoachToolsMonthly.create(area),readOnly,previousRoster:monthlyExistingRoster(),onApply:b=>commitMonthlyBundle(b,{silent:true,throwOnFailure:true})});
}
function renderMonthlyImportSummary(){
  const node=el('monthlyImportSummary');if(!node)return;
  const lines=[];
  for(const area of ['retail','referral']){const d=state.data[area],s=d.monthlySummary;if(!d.monthlyBundle||!s)continue;lines.push(`${area==='retail'?'Monthly Retail':'Monthly Referral'}: ${monthlyImportLabel(s)} · ${s.repCount} reps / ${s.teamCount} teams · ${s.files.length} Wiper files · ${s.partial?'PARTIAL — review missing data':'loaded records complete'}`);}
  node.textContent=lines.join(' | ')||'Upload Opportunity and Wiper exports here. Existing monthly Excel workbooks remain available under individual uploads.';
  const banner=el('monthlyCompleteness');if(banner){banner.hidden=!lines.length;banner.textContent=lines.join(' | ');}
  const history=el('monthlyHistory');if(history){history.replaceChildren();for(const area of ['retail','referral'])for(const [key,bundle] of Object.entries(state.data[area]?.monthlyHistory||{})){const btn=document.createElement('button');btn.type='button';btn.textContent=`${area} ${monthlyImportLabel({undated:bundle.dateMode==='undated',importedAt:bundle.importedAt,period:window.CoachToolsMonthly.compile(bundle).period})}`;btn.onclick=()=>openMonthlyImport(area,true,key);history.append(btn);}}
}
function monthlyImportLabel(summary){return summary.undated?`Non-dated · ${summary.importedAt?'Loaded '+summary.importedAt:'Load date not recorded'}`:summary.period?`${summary.period.start}–${summary.period.end}`:'Non-dated';}
window.CoachToolsGetMonthlyBundle=async area=>state.data[area]?.monthlyBundle||null;

window.CoachToolsMonthlyAreaAssignments=()=>{
  const matches=new Map();for(const area of ['retail','referral'])for(const r of state.data[area]?.controlRoster||[]){const k=window.CoachToolsMonthly.key(r._team||r.team);if(!matches.has(k))matches.set(k,new Set());matches.get(k).add(area);}
  return Object.fromEntries([...matches].filter(([,areas])=>areas.size===1).map(([k,areas])=>[k,[...areas][0]]));
};

function preserveMonthlyRosterEntries(map){
  const rows=controlRosterRows(), names=new Set(rows.filter(r=>r._monthly).map(r=>r._repKey));
  if(!names.size)return map;
  for(const [key,rep] of map)if(names.has(rep.key))map.delete(key);
  for(const r of rows)if(names.has(r._repKey))map.set(r.rosterId,{kind:'rep',key:r._repKey,rosterId:r.rosterId,name:r._rep,team:r._team,sourceArea:r.sourceArea});
  return map;
}

function monthlyReportCoverage(model){
  const sources=new Set((model?.criteria||[]).flatMap(c=>[c.source,c.leftSource,c.rightSource,c.customSource,c.trueValueSource]).filter(Boolean));
  const notes=[];
  for(const area of ['retail','referral']){
    const d=state.data[area], s=d?.monthlySummary;
    if(!d?.monthlyBundle||!s||(!sources.has('nondate')&&![...sources].some(src=>src.startsWith(area))))continue;
    notes.push(`${area==='retail'?'Retail':'Referral'} ${monthlyImportLabel(s)}: ${s.partial?'PARTIAL monthly data; rates use available valid counts':s.undated?'loaded records complete':'complete monthly coverage'}`);
  }
  return notes.join(' | ');
}

function monthlyExistingRoster(){return controlRosterRows().map(r=>({name:r._rep,coach:r._team,area:r.sourceArea}));}
window.CoachToolsMonthlyExistingRoster=monthlyExistingRoster;
