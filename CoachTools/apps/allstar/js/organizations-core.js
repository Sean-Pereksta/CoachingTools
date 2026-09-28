/* Organization persistence, coverage, builder UI, and run selection.
 * Behavior-preserving extraction from the definitive All-Star application.
 */
'use strict';

function normalizeOrgName(v){ return normalizeResearchText(v); }
function normalizeOrg(o={}){ const now=new Date().toISOString(), coaches=new Map(); (o.coachNames||[]).forEach(x=>{ const name=canonicalCoachName(x); if(name) coaches.set(coachNameKey(name),name); }); return {id:o.id||id(),name:String(o.name||'New Org').trim()||'New Org',coachNames:[...coaches.values()].sort((a,b)=>a.localeCompare(b)),createdAt:o.createdAt||now,updatedAt:o.updatedAt||now}; }
function loadOrgs(){ try{ const raw=JSON.parse(localStorage.getItem(ORG_BUILDER_KEY)||'[]'); state.orgs=(Array.isArray(raw)?raw:(raw.orgs||[])).map(normalizeOrg); }catch(_){ state.orgs=[]; } }
function saveOrgs(){ state.orgs=(state.orgs||[]).map(normalizeOrg); localStorage.setItem(ORG_BUILDER_KEY,JSON.stringify(state.orgs)); selectiveResearchInvalidation({reason:'org builder changed',teams:true}); renderRunOrgSelect(); renderMultiRunOrgSelect(); }
function findOrg(ref){ const raw=String(ref||'').replace(/^\$/,'').trim(), n=normalizeOrgName(raw); return (state.orgs||[]).find(o=>o.id===raw||normalizeOrgName(o.name)===n); }
function orgCoachSet(ref){ const o=typeof ref==='object'?ref:findOrg(ref); return new Set((o?.coachNames||[]).map(normalizeOrgName)); }
function inOrg(value, orgNameOrId){ const set=orgCoachSet(orgNameOrId); return set.has(normalizeOrgName(value)); }
function orgTokenNames(){ return (state.orgs||[]).map(o=>'$'+o.name); }

function parseListTesterNames(value,commaSeparated=false){
  const lines=String(value||'').replace(/\u00a0/g,' ').split(/\r?\n/), out=[];
  const pushName=v=>{ let s=String(v||'').trim().replace(/^[\s•·▪◦*-]+/,'').replace(/^\d+[.)-]\s*/, '').replace(/^['"]|['"]$/g,'').trim(); if(s) out.push(s); };
  lines.forEach(line=>{
    const trimmed=String(line||'').trim(); if(!trimmed) return;
    let parts=trimmed.split(/[\t;]+/);
    if(commaSeparated) parts=parts.flatMap(part=>String(part).split(','));
    parts.forEach(pushName);
  });
  return out;
}

function openOrgBuilder(){ loadOrgs(); if(!state.activeOrgId&&state.orgs[0]) state.activeOrgId=state.orgs[0].id; renderOrgBuilder(); openModal('orgBuilderModal'); }
function createOrg(){ const o=normalizeOrg({name:'New Org'}); state.orgs.push(o); state.activeOrgId=o.id; saveOrgs(); renderOrgBuilder(); }
function orgCoverage(org){
  const teams=orgCoachSet(org), reps=new Map(), coveredTeams=new Set(), missing=[];
  for(const rep of currentTeamIndex().reps||[]){
    if(!teams.has(normalizeOrgName(rep.team))) continue;
    const key=normalizeIdentityName(rep.key||rep.name||'');
    if(!key){ missing.push(rep.team); continue; }
    if(!reps.has(key)) reps.set(key,rep);
    coveredTeams.add(normalizeOrgName(rep.team));
  }
  const noRoster=(org?.coachNames||[]).filter(team=>!coveredTeams.has(normalizeOrgName(team)));
  return {reps:[...reps.values()],count:reps.size,noRoster,missing,complete:!noRoster.length&&!missing.length};
}
function renderOrgBuilder(){
  const q=normalizeOrgName(state.orgSearch||''), cq=normalizeOrgName(state.orgCoachSearch||''), act=activeOrg();
  if(els.orgNameInput) els.orgNameInput.value=act?.name||'';
  const activeName=document.getElementById('orgActiveNameSummary');if(activeName)activeName.textContent=act?.name||'No organization selected';
  const orgRows=(state.orgs||[]).filter(o=>!q||normalizeOrgName(o.name).includes(q));
  if(els.orgList){
    els.orgList.innerHTML=orgRows.map(o=>{ const coverage=orgCoverage(o); return `<button type="button" class="teamManagerItem orgCard ${o.id===state.activeOrgId?'active':''}" aria-pressed="${o.id===state.activeOrgId}" data-org-id="${esc(o.id)}"><strong>${esc(o.name)}</strong><span>${o.coachNames.length} coaches · ${coverage.count} unique reps${coverage.complete?'':' · coverage incomplete'}</span></button>`; }).join('')||`<div class="teamManagerItem">${q?'No organizations match your search.':'Create an organization to start assigning teams.'}</div>`;
    els.orgList.querySelectorAll('[data-org-id]').forEach(x=>x.onclick=()=>{ state.activeOrgId=x.dataset.orgId; invalidateOrgReadiness('Organization selection changed'); renderOrgBuilder(); });
  }
  const selected=new Set((act?.coachNames||[]).map(normalizeOrgName)), coaches=knownCoachNames().filter(c=>!cq||normalizeOrgName(c).includes(cq));
  const summary=document.getElementById('orgCoachSummary'); if(summary) summary.textContent=`${coaches.length} teams shown · ${selected.size} selected`;
  if(els.orgCoachList) els.orgCoachList.innerHTML=coaches.map(c=>`<label class="checkItem orgCoachRow ${selected.has(normalizeOrgName(c))?'selected':''}"><input type="checkbox" ${act?'':'disabled'} data-org-coach="${esc(c)}" ${selected.has(normalizeOrgName(c))?'checked':''}><span>${esc(c)}</span></label>`).join('')||'<div class="checkItem">No coaches match.</div>';
  if(els.orgSelectedList) els.orgSelectedList.innerHTML=(act?.coachNames||[]).map(c=>`<div class="checkItem orgMembership"><span>${esc(c)}</span><button class="smallBtn red" data-remove-org-coach="${esc(c)}" type="button" aria-label="Remove ${esc(c)} from this organization">Remove</button></div>`).join('')||'<div class="checkItem">No coaches selected.</div>';
  const coverage=orgCoverage(act);
  if(els.orgCountBadge) els.orgCountBadge.textContent=`${act?.coachNames?.length||0} coaches · ${coverage.count} unique reps covered`;
  const note=document.getElementById('orgCoverageNote');
  if(note) note.textContent=coverage.complete?'Coverage uses the current imported roster / team index; historical assignments are not established.':`Coverage is incomplete: no identifiable representatives for ${coverage.noRoster.join(', ')||coverage.missing.join(', ')}. Counts use only the current imported roster / team index.`;
  for(const id of ['duplicateOrgBtn','deleteOrgBtn','selectVisibleOrgCoachesBtn','clearOrgCoachesBtn']) if(els[id]) els[id].disabled=!act;
  if(els.orgHealthPanel) renderOrgHealth();
  if(els.orgCoachList) els.orgCoachList.querySelectorAll('[data-org-coach]').forEach(x=>x.onchange=()=>{
    if(!act) return; const val=x.dataset.orgCoach, next=new Set(act.coachNames||[]); x.checked?next.add(val):next.delete(val);
    act.coachNames=[...next].sort((a,b)=>a.localeCompare(b)); act.updatedAt=new Date().toISOString(); saveOrgs(); renderOrgBuilder();
    [...els.orgCoachList.querySelectorAll('[data-org-coach]')].find(cb=>cb.dataset.orgCoach===val)?.focus();
  });
  if(els.orgSelectedList) els.orgSelectedList.querySelectorAll('[data-remove-org-coach]').forEach(b=>b.onclick=()=>{
    if(!act) return; act.coachNames=(act.coachNames||[]).filter(c=>c!==b.dataset.removeOrgCoach); act.updatedAt=new Date().toISOString(); saveOrgs(); renderOrgBuilder();
  });
  renderOrgReadinessControls();
}
function orgHealthIssues(){
  const known=new Map(knownCoachNames().map(c=>[normalizeOrgName(c),c])), memberships=new Map();
  for(const org of state.orgs||[]) for(const coach of org.coachNames||[]){
    const key=normalizeOrgName(coach); if(!memberships.has(key)) memberships.set(key,{coach,orgs:[]}); memberships.get(key).orgs.push(org);
  }
  const orgIssue=org=>({label:org.name,orgs:[org]});
  return [
    {label:'Organizations',items:(state.orgs||[]).map(orgIssue)},
    {label:'Overlapping membership',note:'Informational: a coach may intentionally belong to multiple organizations.',items:[...memberships.values()].filter(x=>x.orgs.length>1).map(x=>({...x,label:x.coach}))},
    {label:'Stale coaches',warning:true,items:[...memberships].filter(([key])=>!known.has(key)).map(([,x])=>({...x,label:x.coach}))},
    {label:'Unassigned coaches',warning:true,items:[...known].filter(([key])=>!memberships.has(key)).map(([,coach])=>({label:coach,orgs:[]}))},
    {label:'Empty organizations',warning:true,items:(state.orgs||[]).filter(o=>!o.coachNames.length).map(orgIssue)},
    {label:'No reps covered',warning:true,note:'No representatives could be identified in the current roster. This is not proof that a team has no people.',items:(state.orgs||[]).filter(o=>orgCoverage(o).count===0).map(orgIssue)}
  ];
}
function renderOrgHealth(){
  const issues=orgHealthIssues();
  els.orgHealthPanel.innerHTML=issues.map((issue,i)=>`<button type="button" data-org-health="${i}" class="orgHealthCard ${issue.warning&&issue.items.length?'warning':''}" aria-expanded="${state.orgHealthSelection===i}" aria-controls="orgHealthDetails"><strong>${issue.items.length}</strong><span>${esc(issue.label)}</span></button>`).join('');
  els.orgHealthPanel.querySelectorAll('[data-org-health]').forEach(b=>b.onclick=()=>{ state.orgHealthSelection=+b.dataset.orgHealth; renderOrgHealth(); document.getElementById('orgHealthDetails')?.focus(); });
  const details=document.getElementById('orgHealthDetails'), issue=issues[state.orgHealthSelection];
  if(!details) return;
  details.innerHTML=issue?`<h3>${esc(issue.label)}</h3>${issue.note?`<p class="hint">${esc(issue.note)}</p>`:''}<ul class="orgIssueList">${issue.items.map(x=>`<li><span>${esc(x.label)}</span><span>${x.orgs.map(org=>`<button type="button" class="smallBtn" data-inspect-org="${esc(org.id)}">Open ${esc(org.name)}</button>`).join(' ')||'Use Members to explicitly assign this coach to the selected organization.'}</span></li>`).join('')||'<li>No items to review.</li>'}</ul>`:'';
  details.querySelectorAll('[data-inspect-org]').forEach(b=>b.onclick=()=>{ state.activeOrgId=b.dataset.inspectOrg; state.orgWorkspaceTab='members'; invalidateOrgReadiness('Organization selection changed'); renderOrgBuilder(); document.getElementById('orgNameInput')?.focus(); });
}

function exportOrgs(){ downloadText('all_star_orgs.json',JSON.stringify({version:1,orgs:state.orgs||[]},null,2)); }
function importOrgs(text){ const obj=JSON.parse(text), incoming=(Array.isArray(obj)?obj:(obj.orgs||[])).map(normalizeOrg); incoming.forEach(o=>{ const byId=state.orgs.findIndex(x=>x.id===o.id); if(byId>=0) state.orgs[byId]=o; else { if(state.orgs.some(x=>normalizeOrgName(x.name)===normalizeOrgName(o.name))) o.name+=' copy'; state.orgs.push(o); } }); saveOrgs(); renderOrgBuilder(); }

function updateRunQADateField(){
  const model=findModel(els.runModelSelect?.value);
  const show=modelUsesQA(model);
  if(els.qaDateField) els.qaDateField.classList.toggle('hidden', !show);
  if(els.qaTeamScoreModeField) els.qaTeamScoreModeField.classList.toggle('hidden', !show);
}
function selectedRunOrgSet(set){ const names=[]; (set||new Set()).forEach(idv=>{ const o=(state.orgs||[]).find(x=>x.id===idv); if(o) names.push(...(o.coachNames||[])); }); return new Set(names.map(normalizeOrgName)); }
function renderRunOrgSelect(){ if(!els.runIncludeOrgGrid) return; const q=normalizeOrgName(state.runOrgSearch||''); const orgs=(state.orgs||[]).filter(o=>!q||normalizeOrgName(o.name).includes(q)); const grid=(set,kind)=>orgs.map(o=>`<label class="checkItem"><input type="checkbox" data-run-org="${esc(kind)}" value="${esc(o.id)}" ${set.has(o.id)?'checked':''}> ${esc(o.name)} <span class="badge">${o.coachNames.length}</span></label>`).join('')||'<div class="checkItem">No orgs found.</div>'; els.runIncludeOrgGrid.innerHTML=grid(state.runIncludeOrgs,'include'); els.runExcludeOrgGrid.innerHTML=grid(state.runExcludeOrgs,'exclude'); document.querySelectorAll('[data-run-org]').forEach(x=>x.onchange=()=>{ const s=x.dataset.runOrg==='include'?state.runIncludeOrgs:state.runExcludeOrgs; x.checked?s.add(x.value):s.delete(x.value); updateRunOrgBadge(); saveRunSettings(); }); updateRunOrgBadge(); }
function updateRunOrgBadge(){ if(!els.runOrgBadge) return; const ids=new Set([...(state.runIncludeOrgs||[]),...(state.runExcludeOrgs||[])]), coaches=new Set(); ids.forEach(idv=>{ const o=(state.orgs||[]).find(x=>x.id===idv); (o?.coachNames||[]).forEach(c=>coaches.add(normalizeOrgName(c))); }); const reps=new Set(); (currentTeamIndex().reps||[]).forEach(r=>{ if(coaches.has(normalizeOrgName(r.team))) reps.add(r.key||r.name); }); els.runOrgBadge.textContent=`${ids.size} orgs selected · ${coaches.size} coaches · ${reps.size} reps covered`; }

function captureRunExecutionSettings(){
  syncTeamSelectionsFromDom();
  return {
    modelId:els.runModelSelect?.value||'', startDate:els.runStartDate?.value||'', endDate:els.runEndDate?.value||'', view:els.runViewSelect?.value||'both',
    qaDateMode:els.runQADateSelect?.value||'interaction', qaTeamScoreMode:els.runQATeamScoreMode?.value||'assignedReps', hideNoScore:!!els.hideNoScoreReps?.checked,
    hideNoScoreThreshold:els.hideNoScoreThreshold?.value||'all', teamSpecificRepRanking:!!els.rankRepresentativesWithinTeam?.checked, selectedTeams:[...(state.selectedTeams||[])], includeOrgIds:[...(state.runIncludeOrgs||[])], excludeOrgIds:[...(state.runExcludeOrgs||[])],
    multiOrgIds:[...(state.multiRunOrgIds||[])], runMode:state.runMode||'single', qualtricsStatsSource:els.qualtricsStatsSource?.value||''
  };
}
function saveRunSettings(){ try{ localStorage.setItem(RUN_SETTINGS_KEY,JSON.stringify(captureRunExecutionSettings())); }catch(e){ console.warn('Run settings could not be saved',e); } }
function loadRunSettings(){
  if(state.runSettingsLoaded) return;
  state.runSettingsLoaded=true;
  let s={}; try{ s=JSON.parse(localStorage.getItem(RUN_SETTINGS_KEY)||'{}')||{}; }catch(_){ s={}; }
  const setSelect=(node,value)=>{ if(node&&value!=null&&[...node.options].some(o=>o.value===String(value))) node.value=String(value); };
  setSelect(els.runModelSelect,s.modelId); if(els.runStartDate&&s.startDate) els.runStartDate.value=s.startDate; if(els.runEndDate&&s.endDate) els.runEndDate.value=s.endDate; setSelect(els.runViewSelect,s.view); setSelect(els.runQADateSelect,s.qaDateMode); setSelect(els.runQATeamScoreMode,s.qaTeamScoreMode);
  if(els.hideNoScoreReps) els.hideNoScoreReps.checked=!!s.hideNoScore; setSelect(els.hideNoScoreThreshold,s.hideNoScoreThreshold); els.hideNoScoreThreshold?.classList.toggle('hidden',!els.hideNoScoreReps?.checked);
  if(els.rankRepresentativesWithinTeam) els.rankRepresentativesWithinTeam.checked=!!s.teamSpecificRepRanking;
  if(Array.isArray(s.selectedTeams)){ state.selectedTeams=new Set(s.selectedTeams.map(canonicalCoachName).filter(Boolean)); state.teamSelectionInitialized=true; }
  state.runIncludeOrgs=new Set((s.includeOrgIds||[]).filter(idv=>(state.orgs||[]).some(o=>o.id===idv))); state.runExcludeOrgs=new Set((s.excludeOrgIds||[]).filter(idv=>(state.orgs||[]).some(o=>o.id===idv)));
  state.multiRunOrgIds=new Set((s.multiOrgIds||[]).filter(idv=>(state.orgs||[]).some(o=>o.id===idv))); state.runMode=s.runMode==='multi'?'multi':'single'; state.savedQualtricsStatsSource=s.qualtricsStatsSource||'';
}
function applyRunMode(mode){
  state.runMode=mode==='multi'?'multi':'single'; const multi=state.runMode==='multi';
  els.runSingleTab?.classList.toggle('active',!multi); els.runMultiTab?.classList.toggle('active',multi); els.runSingleTab?.setAttribute('aria-selected',String(!multi)); els.runMultiTab?.setAttribute('aria-selected',String(multi));
  els.singleRunSelectionPanel?.classList.toggle('hidden',multi); els.multiRunPanel?.classList.toggle('hidden',!multi); if(els.executeRunBtn) els.executeRunBtn.textContent=multi?'Run & Export Selected Orgs':'Run Single Report';
  if(multi) renderMultiRunOrgSelect(); saveRunSettings();
}
function visibleMultiRunOrgs(){ const q=normalizeOrgName(state.multiRunOrgSearch||''); return (state.orgs||[]).filter(o=>!q||normalizeOrgName(o.name).includes(q)); }
function renderMultiRunOrgSelect(){
  if(!els.multiRunOrgGrid) return;
  const valid=new Set((state.orgs||[]).map(o=>o.id)); state.multiRunOrgIds=new Set([...(state.multiRunOrgIds||[])].filter(idv=>valid.has(idv)));
  const orgs=visibleMultiRunOrgs(); els.multiRunOrgGrid.innerHTML=orgs.map(o=>`<label class="multiRunOrg"><input type="checkbox" data-multi-run-org="${esc(o.id)}" ${state.multiRunOrgIds.has(o.id)?'checked':''}><span><strong>${esc(o.name)}</strong><small>${o.coachNames.length.toLocaleString()} coaches · ${orgRepCount(o).toLocaleString()} representatives</small></span></label>`).join('')||'<div class="checkItem">No organizations match this search. Create organizations in Import → Org Builder.</div>';
  els.multiRunOrgGrid.querySelectorAll('[data-multi-run-org]').forEach(cb=>cb.onchange=()=>{ cb.checked?state.multiRunOrgIds.add(cb.dataset.multiRunOrg):state.multiRunOrgIds.delete(cb.dataset.multiRunOrg); updateMultiRunSummary(); saveRunSettings(); }); updateMultiRunSummary();
}
function updateMultiRunSummary(){
  const orgs=[...(state.multiRunOrgIds||[])].map(idv=>(state.orgs||[]).find(o=>o.id===idv)).filter(Boolean), count=orgs.length; if(els.multiRunOrgBadge) els.multiRunOrgBadge.textContent=`${count} selected`;
  if(els.multiRunSummary){ const model=findModel(els.runModelSelect?.value), dates=els.runStartDate?.value&&els.runEndDate?.value?`${els.runStartDate.value} to ${els.runEndDate.value}`:'all available dates', ranking=els.rankRepresentativesWithinTeam?.checked?'team-specific representative ranks on team pages':'overall representative ranks on every page'; els.multiRunSummary.textContent=count?`${count} organization PDF${count===1?'':'s'} queued · ${model?.name||'No model selected'} · ${dates} · ${els.runViewSelect?.selectedOptions?.[0]?.textContent||'Both'} · ${ranking}.`:'Choose one or more organizations. Every organization will use the same model, dates, view, QA settings, no-score setting, ranking scope, and saved PDF options.'; }
}
function compileRunCriterionPlan(model, opts={}){
  return window.AllStarAnalysis ? window.AllStarAnalysis.modelPlan(model,opts,()=>compileRunCriterionPlanUncached(model,opts)) : compileRunCriterionPlanUncached(model,opts);
}
function compileRunCriterionPlanUncached(model, opts={}){
  const signature=stableSerialize({modelId:model?.id||'',modelsVersion:state.versions?.models||0,dataVersion:state.versions?.data||0,mappings:state.versions?.mappings||0,aliases:state.versions?.aliases||0,qaDateMode:opts.qaDateMode||'',qaTeamScoreMode:opts.qaTeamScoreMode||'',criteria:(model?.criteria||[]).map(c=>({id:c.id,name:c.name,source:c.source,calcType:c.calcType,audience:c.audience,scoreType:c.scoreType,weight:c.weight,points:c.points,column:c.column,filters:c.filters,trueValueEnabled:c.trueValueEnabled,trueValueSource:c.trueValueSource,trueValueColumn:c.trueValueColumn}))});
  const criteria=(model?.criteria||[]).map(c=>{
    const source=c.customSource||c.source||rowPullSourceForCriterion(c)||'retail_sv2';
    const plan={criterion:c,source,audience:c.audience||'both',scoreType:c.scoreType||'rank',weight:Number(c.weight||1),isAutofail:String(c.weight)==='autofail',points:Number(c.points||0),trueValueColumn:c.trueValueColumn?resolveColumn(c.trueValueSource,c.trueValueColumn)||c.trueValueColumn:'',column:c.column?resolveColumn(source,c.column)||c.column:'',dateColumn:c.checkDateColumn?resolveColumn(source,c.checkDateColumn)||c.checkDateColumn:'',filters:(c.filters||[]).map(f=>normalizeFilterForStorage(f,source)),compiledFilterKey:compiledFilterSignature(source,c.filters||[],opts),zeroCanWin:!!c.zeroCanWin,missingRank:missingRankForCriterion(c),missingPoints:missingPointsForCriterion(c),requiresFullPopulation:!!(c.populationScope==='all'||c.populationScope==='organization'||c.fullPopulation||c.calcType==='custom')};
    if(c.calcType==='custom' && c.expression) plan.compiledExpression=compileCachedExpression(source,c.expression,getHeaders(source),raw=>Function('row','toNum','return ('+raw+');'),{source,context:'Model criterion'});
    return plan;
  });
  return {model,signature,criteria,teamCriteria:criteria.filter(p=>p.audience==='both'||p.audience==='team'||p.audience==='coach'),repCriteria:criteria.filter(p=>p.audience==='both'||p.audience==='rep'),requiredSources:requiredRunSourcesForModel(model,opts),createdAt:Date.now()};
}
function runPerfSnapshot(){ const p=state.perfCounters||{}; return {teamTotalsIndexBuilds:p.teamTotalsIndexBuilds||0,trueTeamValueLookups:p.trueTeamValueLookups||0,runIndexCacheHits:p.runIndexCacheHits||0,runIndexCacheMisses:p.runIndexCacheMisses||0,sourceRowCacheHits:p.sourceRowCacheHits||0,sourceRowCacheMisses:p.sourceRowCacheMisses||0,entryRowCacheHits:p.entryRowCacheHits||0,entryRowCacheMisses:p.entryRowCacheMisses||0}; }
function runPerfDelta(a){ const b=runPerfSnapshot(), out={}; Object.keys(b).forEach(k=>out[k]=b[k]-(a?.[k]||0)); out.teamTotalsIndexBuildsBySource={...(state.perfCounters.teamTotalsIndexBuildsBySource||{})}; return out; }
