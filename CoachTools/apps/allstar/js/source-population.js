/* Shared weekly source identity, population evidence, and upload status.
 * Keep raw source dates and current trusted assignments; never invent history.
 */
'use strict';
const weeklyIdentityContexts=new Map();
let weeklyStatsDirectory,weeklyStatsDirectoryRevision=0;
function weeklyDirectoryRevision(){
  const directory=window.CoachToolsStatsDirectory;
  if(directory!==weeklyStatsDirectory){weeklyStatsDirectory=directory;weeklyStatsDirectoryRevision=directory?.snapshot().revision||0;}
  return weeklyStatsDirectoryRevision;
}
window.addEventListener?.('coachtools-stats-directory-change',()=>{
  weeklyStatsDirectory=undefined;weeklyIdentityContexts.clear();bumpVersion('mappings');invalidateRosterIndex('Stats directory changed');
  markDataIndexDirty('Stats directory changed',{sources:allSourceKeys()});
  renderCategorizedSummary();
});
function weeklyIdentityContext(source){
  const data=state.data[source]||{}, roster=ensureRosterIndex(), directory=window.CoachToolsStatsDirectory;
  const signature=[state.sourceMeta[source]?.sourceVersion||0,state.versions?.aliases||0,state.versions?.teams||0,state.versions?.mappings||0,weeklyDirectoryRevision(),data.config?.repField||'',data.config?.coachField||'',data.config?.dateField||''].join('|');
  const previous=weeklyIdentityContexts.get(source);
  if(previous&&previous.data===data&&previous.roster===roster&&previous.signature===signature&&previous.configRef===data.config)return previous;
  const config=data.config||window.AllStarDatedStats.defaultConfig(source,data.headers||[]);
  const area=source==='weeklyReferral'?'referral':'retail';
  const candidates=[...new Set([...roster.rows.filter(r=>r.sourceArea===area).map(r=>r._team||r.team),...(state.teams||[]),...(state.orgs||[]).flatMap(o=>o.coachNames||[]),...(directory?.grouped()||[]).flatMap(g=>g.coaches)].filter(Boolean))];
  const context={data,roster,signature,config,configRef:data.config,area,candidates,coaches:new Map(),people:new Map()};
  weeklyIdentityContexts.set(source,context);return context;
}
function weeklyCoachIdentity(value,context){
  const raw=String(value??'').trim();if(!raw||raw===NA_TEAM)return {value:'',method:'unresolved',raw};
  if(context.coaches.has(raw))return context.coaches.get(raw);
  const canonical=window.CoachToolsStatsDirectory?.resolve(raw,'coach')||raw;
  const resolved=resolveWeeklyCoachIdentity(canonical,context.area,context.candidates);
  // A complete source coach name remains useful even without a current roster.
  const result=resolved.method==='unresolved'?{value:canonicalCoachName(canonical),method:'direct source name',raw}:resolved;
  context.coaches.set(raw,result);return result;
}
function weeklySourceRowIdentity(row,source){
  const context=weeklyIdentityContext(source),config=context.config;
  const repField=config.repField||findHeader(getHeaders(source),REP_IDENTITY_COLUMNS)||'';
  const rawRep=row?.[repField]||row?._rep||row?._repKey||'';
  if(!context.people.has(rawRep))context.people.set(rawRep,datedStatsIdentity(rawRep,source));
  let person=context.people.get(rawRep);
  const normalizedKey=row?._repKey||'',normalizedRecord=normalizedKey&&(context.roster.bySourceRepKey.get(sourceRepCompositeKey(context.area,normalizedKey))||context.roster.byRepKey.get(normalizedKey));
  if(!person.reason&&normalizedRecord&&!normalizedRecord.conflict)person={id:normalizedKey,name:normalizedRecord.name||normalizedRecord._rep||person.name};
  const repKey=person.id||'',repName=person.name||displayIdentityName(rawRep);
  const rosterRecord=(row?._rosterId&&context.roster.byRosterId.get(row._rosterId))||context.roster.bySourceRepKey.get(sourceRepCompositeKey(context.area,repKey))||context.roster.byRepKey.get(repKey);
  const rosterTeam=rosterRecord&&!rosterRecord.conflict?(rosterRecord.team||rosterRecord._team||''):'';
  const manual=row?._teamAssignedManually?canonicalCoachName(row._team):'';
  const coachField=config.coachField||findHeader(getHeaders(source),['Sheet','Coach','Job Coach','Team','Coach Name','Coach Assigned'])||'';
  const rawCoach=row?.[coachField]||'';
  const direct=weeklyCoachIdentity(rawCoach,context);
  const alternate=findHeader(Object.keys(row||{}),['Sheet','Coach','Job Coach','Team','Coach Name','Coach Assigned']);
  const fallback=weeklyCoachIdentity(row?._team&&row._team!==NA_TEAM?row._team:(alternate?row[alternate]:''),context);
  const mapped=repKey?(state.repTeams?.get(repKey)||''):'';
  const skip=rowSkipsTeamBuild(row,source);
  const team=manual||rosterTeam||(!skip?direct.value:'')||(!skip?fallback.value:'')||(mapped!==NA_TEAM?mapped:'')||'';
  const coach=canonicalCoachName(team),dateField=config.dateField||'Date';
  return {repKey,repName,rawRep,repField,validRep:!!repKey&&!window.AllStarDatedStats.summaryName(rawRep),repReason:person.reason||'',rosterMatched:!!(rosterRecord&&!rosterRecord.conflict),coach,coachKey:coachNameKey(coach),rawCoach,coachField,directCoach:direct.value||'',coachMethod:manual?'manual mapping':rosterTeam?'trusted roster':direct.value?direct.method:fallback.value?fallback.method:mapped?'representative mapping':'unresolved',dateField,date:row?.[dateField]??row?._date};
}
function weeklySourceHealth(source,rows=getRowsRaw(source)){
  const context=weeklyIdentityContext(source),reps=new Map(),coaches=new Map(),dates=new Set(),unresolvedCoaches=new Set(),unresolvedReps=new Set();
  if(rows===context.data.rows&&context.health)return context.health;
  let validRows=0,recognizedCoachRows=0,rosterMatchedRows=0,directCoachRows=0;
  for(const row of rows||[]){
    const identity=weeklySourceRowIdentity(row,source);
    if(!identity.validRep)continue;
    validRows++;
    if(!reps.has(identity.repKey))reps.set(identity.repKey,identity);
    if(identity.rosterMatched)rosterMatchedRows++;else unresolvedReps.add(identity.repName);
    const date=parseDateOnly(identity.date);if(date)dates.add(ymd(date));
    if(identity.directCoach)directCoachRows++;
    if(!identity.coachKey){unresolvedCoaches.add(identity.rawCoach||'(blank)');continue;}
    recognizedCoachRows++;
    if(!coaches.has(identity.coachKey))coaches.set(identity.coachKey,{name:identity.coach,reps:new Set(),rosterReps:new Set(),directReps:new Set(),unresolvedReps:new Set(),rows:0});
    const coach=coaches.get(identity.coachKey);coach.rows++;coach.reps.add(identity.repKey);
    (identity.rosterMatched?coach.rosterReps:coach.unresolvedReps).add(identity.repKey);
    if(identity.directCoach)coach.directReps.add(identity.repKey);
  }
  const sourceCoachValues=[...new Set((rows||[]).map(r=>String(r[context.config.coachField]||'').trim()).filter(Boolean))];
  const canonicalKeys=new Set(context.candidates.map(coachNameKey));
  const matchedSourceCoaches=sourceCoachValues.filter(raw=>canonicalKeys.has(coachNameKey(weeklyCoachIdentity(raw,context).value))).length;
  const weeks=[...dates].sort();
  const health={source,rows:(rows||[]).length,validRows,recognizedCoachRows,unrecognizedCoachRows:validRows-recognizedCoachRows,rosterMatchedRows,rosterUnmatchedRows:validRows-rosterMatchedRows,directCoachRows,uniqueReps:reps.size,rosterMatchedReps:[...reps.values()].filter(r=>r.rosterMatched).length,coaches:[...coaches.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(c=>({...c,reps:c.reps.size,rosterReps:c.rosterReps.size,directReps:c.directReps.size,unresolvedReps:c.unresolvedReps.size})),weeks,dateRange:weeks.length?[weeks[0],weeks.at(-1)]:[],repField:context.config.repField||'',coachField:context.config.coachField||'',dateField:context.config.dateField||'',sourceCoachCount:sourceCoachValues.length,matchedSourceCoaches,unresolvedCoachValues:[...unresolvedCoaches],unresolvedRepNames:[...unresolvedReps]};
  if(rows===context.data.rows)context.health=health;return health;
}
function normalizeResearchCoverage(value={}){
  return {enabled:!!value.enabled,minWeeks:Math.max(1,Math.floor(Number(value.minWeeks)||8))};
}
function researchWeeklyCoverage(rows,item,plan){
  if(!isDatedStatsSource(item.source))return rows;
  const config=normalizeResearchCoverage(item.weeklyCoverage),people=new Map(),weeks=new Set();
  for(const row of rows){
    const identity=weeklySourceRowIdentity(row,item.source),date=parseDateOnly(identity.date);
    if(!identity.validRep||!date)continue;
    const week=ymd(date);weeks.add(week);
    if(!people.has(identity.repKey))people.set(identity.repKey,{key:identity.repKey,name:identity.repName,weeks:new Set()});
    people.get(identity.repKey).weeks.add(week);
  }
  const excluded=config.enabled?[...people.values()].filter(p=>p.weeks.size<config.minWeeks):[];
  const excludedKeys=new Set(excluded.map(p=>p.key));
  const out=config.enabled?rows.filter(r=>{const identity=weeklySourceRowIdentity(r,item.source);return identity.validRep&&!!parseDateOnly(identity.date)&&!excludedKeys.has(identity.repKey);}):rows;
  if(plan){
    plan.coverage={...config,availableWeeks:weeks.size,repsBefore:people.size,eligibleReps:people.size-excluded.length,excludedReps:excluded.length,excluded:excluded.map(p=>({name:p.name,weeks:p.weeks.size})),weeks:[...weeks].sort()};
    if(config.enabled)plan.steps.push({name:'minimum weekly coverage',before:rows.length,candidates:rows.length,after:out.length,usedIndex:false});
  }
  return out;
}
function researchWeeklyFlow(item,rows,plan){
  if(!isDatedStatsSource(item.source))return;
  const health=weeklySourceHealth(item.source),keys=researchPopulationMatchKeys(item.populationScope),present=new Set(),directMatched=new Set();
  for(const row of rows){const i=weeklySourceRowIdentity(row,item.source);if(i.coachKey)present.add(i.coachKey);if(keys.includeTeamKeys.has(coachNameKey(i.directCoach)))directMatched.add(row);}
  const selectedNames=[...new Map(keys.includeTeamNames.map(name=>[coachNameKey(name),canonicalCoachName(name)])).values()];
  plan.populationFlow={...health,rowsAfterDate:rows.length,organizationNames:normalizeResearchPopulationScope(item.populationScope).includeOrgs.map(ref=>findOrg(ref)?.name||ref),selectedCoachCount:selectedNames.length,presentSelectedCoaches:selectedNames.filter(name=>present.has(coachNameKey(name))).length,missingCoaches:selectedNames.filter(name=>!present.has(coachNameKey(name))),directOrganizationRows:directMatched.size};
}
function researchWeeklyFlowFinish(item,rows,plan){
  const flow=plan?.populationFlow;if(!flow)return;
  const reps=new Set(),coaches=new Set(),weeks=new Set(),matched=new Set(),unmatched=new Set(),repWeeks=new Set();let qualifyingRows=0;
  const conditions=(item.guidedConditions||[]).filter(guidedValidCondition),rowConditions=conditions.length&&conditions.every(c=>!c.expression&&!guidedConditionIsCount(c.operator)&&(!c.source||c.source===item.source));
  for(const row of rows){const i=weeklySourceRowIdentity(row,item.source);if(i.repKey){reps.add(i.repKey);(i.rosterMatched?matched:unmatched).add(i.repKey);const date=parseDateOnly(i.date);if(date)repWeeks.add(JSON.stringify([i.repKey,ymd(date)]));}if(i.coachKey)coaches.add(i.coachKey);const d=parseDateOnly(i.date);if(d)weeks.add(ymd(d));if(rowConditions&&guidedConditionsMatchRows([row],item))qualifyingRows++;}
  Object.assign(flow,{candidateRows:rows.length,qualifyingRows:rowConditions?qualifyingRows:null,eligibleReps:reps.size,matchedRepresentatives:matched.size,unmatchedRepresentatives:unmatched.size,representativeWeeks:repWeeks.size,representedCoaches:coaches.size,periods:weeks.size});
}
function researchWeeklyFlowHtml(plan={}){
  const flow=plan.populationFlow;if(!flow)return '';
  const count=n=>Number(n||0).toLocaleString(),coverage=plan.coverage;
  const points=[`${count(flow.rows)} imported rows`,`${count(flow.validRows)} valid representative rows`,`${count(flow.recognizedCoachRows)} rows with recognized coach/team`,`${count(flow.rowsAfterDate)} rows after date range`,`${count(flow.rowsAfterPopulation)} rows after organization/population`,`${count(flow.candidateRows)} candidate rows before qualifying condition`,...(flow.qualifyingRows==null?[]:[`${count(flow.qualifyingRows)} rows satisfying the qualifying condition`]),`${count(flow.eligibleReps)} unique eligible representatives`,`${count(flow.representedCoaches)} coaches represented`,`${count(flow.periods)} weekly periods`];
  const empty=flow.selectedCoachCount&&flow.rowsAfterPopulation===0?`<p class="guidedValidation">${esc(flow.organizationNames.join(', ')||'Selected population')} contains ${count(flow.selectedCoachCount)} coaches, but 0 ${esc(labelSource(flow.source))} rows matched those coaches.</p>`:'';
  return `<div class="researchJoinPreview weeklyPopulationFlow"><strong>${esc(labelSource(flow.source))} · Population flow</strong>${empty}<div class="researchPreviewSummary">${points.map(p=>`<span class="badge">${esc(p)}</span>`).join('')}</div><details><summary>Inspect identity matches</summary><p>${count(flow.rosterMatchedRows)} rows matched to roster · ${count(flow.rosterUnmatchedRows)} unmatched to roster · ${count(flow.directOrganizationRows)} direct ${esc(flow.coachField||'coach')} organization matches · ${count(flow.unrecognizedCoachRows)} rows with unrecognized coach</p><p>Organization coaches present in source: ${count(flow.presentSelectedCoaches)} of ${count(flow.selectedCoachCount)}.</p>${flow.missingCoaches.length?`<p>No rows in this date range: ${flow.missingCoaches.map(esc).join(', ')}</p>`:''}${flow.unresolvedCoachValues.length?`<p>Unresolved coach values: ${flow.unresolvedCoachValues.slice(0,20).map(esc).join(', ')}</p>`:''}</details>${coverage?researchWeeklyCoverageHtml(coverage):''}</div>`;
}
function researchWeeklyCoverageHtml(coverage){
  const text=`${coverage.availableWeeks} weeks available · ${coverage.repsBefore} reps before coverage filter · ${coverage.eligibleReps} ${coverage.enabled?'meet ≥'+coverage.minWeeks+' weeks':'eligible'} · ${coverage.excludedReps} excluded`;
  return `<div role="status">${esc(text)}</div>${coverage.excluded.length?`<details><summary>View ${coverage.excludedReps} excluded representatives</summary><ul>${coverage.excluded.map(p=>`<li>${esc(p.name)} · ${p.weeks} weeks</li>`).join('')}</ul></details>`:''}`;
}
function readResearchWeeklyCoverageEditor(){return normalizeResearchCoverage({enabled:el('researchWeeklyCoverageEnabled')?.checked,minWeeks:el('researchWeeklyCoverageMin')?.value});}
function scheduleResearchWeeklyPreview(){
  const source=state.editingGuidedResearchActive?els.guidedPrimarySource?.value:els.researchSource?.value,section=el('researchWeeklyCoverageSection');
  section?.classList.toggle('hidden',!isDatedStatsSource(source));
  const preview=el('researchWeeklyCoveragePreview');if(preview)preview.textContent='Weekly coverage uses the complete selected period when you run Research. Sample previews do not estimate coverage eligibility.';
}
function weeklyGuidedInterpretation(cfg){
  if(!isDatedStatsSource(cfg.guidedPrimarySource))return [];
  const source=cfg.guidedPrimarySource,data=state.data[source]||{},config=data.config||window.AllStarDatedStats.defaultConfig(source,data.headers||[]),scope=normalizeResearchPopulationScope(state.editingResearchPopulationScope),orgs=scope.includeOrgs.map(findOrg).filter(Boolean),keys=researchPopulationMatchKeys(scope),coverage=readResearchWeeklyCoverageEditor();
  const line=cfg.guidedDisplay==='line',series=!['none','day','week','month','quarter'].includes(cfg.guidedBreakdown)?cfg.guidedBreakdown:(cfg.showLinesFor==='teams'?'coach':'representative');
  const possible=keys.includeTeamKeys.size,period=el('researchPopulationFilterMode')?.value==='dynamic'?researchPopulationPeriod(currentResearchItemFromEditor()):'weekly',periodLabel={daily:'day',weekly:'imported week',monthly:'month',period:'research period'}[period];
  return [['Population',orgs.length?orgs.map(o=>`${o.name} · ${orgCoachSet(o).size} coaches`).join(' | '):guidedPopulationDescription()],['Preview','Click Run preview for a small sample; full results are calculated by Save & Run Research.'],['Eligibility',coverage.enabled?`Representatives appearing in at least ${coverage.minWeeks} weeks within the selected population and date range`:'All eligible representatives with an observation'],...(line?[['Chart interpretation',`Each point = ${cfg.guidedQuestion==='percentage'?'percentage of eligible unique representatives for':'result for'} one ${series==='None'?'group':series} during one ${periodLabel} · X-axis = ${config.dateField||'Date'} (weekly source dates) · Line = ${series} · ${cfg.guidedSort==='default'?'Natural chronological order':cfg.guidedSort}`],['Expected',`${possible&&['coach','team'].includes(series)?'Up to '+possible+' coach lines':'One line per selected '+series} across ${period==='weekly'?'imported weeks':period==='period'?'the research period':period==='daily'?'days':'months'} in the selected date range`]]:[])];
}
function sourceCoachDetailHtml(health){
  return `<details><summary>View ${health.coaches.length} coaches</summary><div class="tableWrap"><table class="sourceCoachTable"><thead><tr><th>Coach</th><th>Weekly Reps</th><th>Roster Matches</th><th>Direct Source Matches</th><th>Unresolved Reps</th></tr></thead><tbody>${health.coaches.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.reps}</td><td>${c.rosterReps}</td><td>${c.directReps}</td><td>${c.unresolvedReps}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function weeklySourceStatusHtml(source){
  const data=state.data[source]||{},health=weeklySourceHealth(source);
  if(!health.rows)return '<div class="hint">No data loaded</div>';
  return `<strong class="good">Loaded</strong><div class="fileName">File: ${esc(data.fileName||'Imported source')}</div><div>${health.rows.toLocaleString()} rows · ${health.weeks.length} weeks · ${health.uniqueReps} unique representatives · ${health.coaches.length} coaches identified</div><div class="hint">Date range: ${health.dateRange.map(esc).join(' – ')||'No valid dates'}<br>Representative field: ${esc(health.repField)} · Coach field identified: ${esc(health.coachField)} · Date field: ${esc(health.dateField)}<br>Last updated: ${esc(state.sourceMeta[source]?.lastImportedAt||data.lastImportedAt||'Unavailable')}</div><div>Identity matching: ${health.rosterMatchedReps} of ${health.uniqueReps} representatives matched to known roster identities</div><div>Coach matching: ${health.matchedSourceCoaches} of ${health.sourceCoachCount} source coaches matched to canonical coaches</div>${sourceCoachDetailHtml(health)}${health.unresolvedRepNames.length?`<details><summary>${health.unresolvedRepNames.length} representative names need review</summary><p>${health.unresolvedRepNames.map(esc).join(', ')}</p><button type="button" data-source-fix-teams class="smallBtn">Review in Fix Teams</button></details>`:''}${health.unresolvedCoachValues.length?`<p role="status">Unresolved coach values: ${health.unresolvedCoachValues.slice(0,20).map(esc).join(', ')}</p>`:''}`;
}
function renderCoreSourceStatus(){
  document.querySelectorAll('[data-source-status]').forEach(box=>{
    const source=box.dataset.sourceStatus,area=source==='retail_sv2'?'retail':source==='referral_sv2'?'referral':'',data=area?state.data[area]:state.data[source],rows=getRowsRaw(source)||[],reps=new Set(),coaches=new Set(),managers=new Set();
    for(const row of rows){const key=repKeyFromAnyRow(row),team=rowTeam(row);if(key)reps.add(key);if(team&&team!==NA_TEAM)coaches.add(canonicalCoachName(team));if(row._manager)managers.add(row._manager);}
    const summary=data?.monthlySummary;
    box.innerHTML=rows.length?`<strong class="good">Loaded</strong><div>${rows.length.toLocaleString()} rows · ${reps.size} representatives · ${coaches.size} coaches${area?` · ${summary?.managerCount??managers.size} manager groups`:''}</div>${area?`<div class="hint">Opportunity file: ${esc(data.monthlyBundle?.opportunity?.name||sourceFileName(source)||'Imported source')}<br>Wiper file(s): ${(summary?.files||[]).map(f=>esc(f.name)).join(', ')||esc(sourceFileName(area+'_wiper')||'None')}</div>`:''}<div class="hint">Last updated: ${esc(state.sourceMeta[source]?.lastImportedAt||summary?.importedAt||'Unavailable')}</div>${coaches.size?`<details><summary>View ${coaches.size} coaches</summary><p>${[...coaches].sort().map(esc).join(', ')}</p></details>`:''}`:'<div class="hint">No data loaded</div>';
  });
}
