/* Browser integration for Qualtrics Individual Messages. Loaded before generator.html's main script. */
'use strict';

const INDIVIDUAL_SETTINGS_KEY='individualMessageSettings.v1';

function individualSideIds(side){
  const cap=side[0].toUpperCase()+side.slice(1);
  return {cap,enabled:`individual${cap}Enabled`,sourceType:`individual${cap}SourceType`,source:`individual${cap}Source`,field:`individual${cap}Field`,operator:`individual${cap}Operator`,threshold:`individual${cap}Threshold`,threshold2:`individual${cap}Threshold2`,message:`individual${cap}Message`,variables:`individual${cap}Variables`};
}
function individualVariableRowHtml(variable={}){
  const sourceType=variable.sourceType==='reportField'?'reportField':'stat', source=sourceType==='reportField'?(variable.field||variable.source||''):(variable.source||'');
  return `<div class="individualVariableRow" data-individual-variable><label>Name<input data-variable-name value="${esc(variable.name||'')}" placeholder="AR"></label><label>Source type<select data-variable-source-type><option value="stat"${sourceType==='stat'?' selected':''}>Stat</option><option value="reportField"${sourceType==='reportField'?' selected':''}>Report field</option></select></label><label>Source<input data-variable-source value="${esc(source)}" list="${sourceType==='reportField'?'individualReportFieldOptions':'individualMetricOptions'}" placeholder="Metric or report field"></label><label>Format<select data-variable-format>${['raw','number','percent','duration','text'].map(format=>`<option value="${format}"${format===(variable.format||'raw')?' selected':''}>${format[0].toUpperCase()+format.slice(1)}</option>`).join('')}</select></label><button class="btn small bad" type="button" data-remove-variable>Remove</button></div>`;
}
function renderIndividualVariables(side,variables){
  const ids=individualSideIds(side), root=els[ids.variables]; if(!root) return;
  root.innerHTML=(variables||[]).map(individualVariableRowHtml).join('')||'<div class="sub" data-empty-variables>No custom variables. Built-in variables are always available.</div>';
  root.querySelectorAll('[data-variable-source-type]').forEach(select=>select.addEventListener('change',()=>{
    const input=select.closest('[data-individual-variable]').querySelector('[data-variable-source]');
    input.setAttribute('list',select.value==='reportField'?'individualReportFieldOptions':'individualMetricOptions');
    autoSaveRuleEdit();
  }));
  root.querySelectorAll('input,select').forEach(field=>field.addEventListener(field.tagName==='SELECT'?'change':'input',autoSaveRuleEdit));
  root.querySelectorAll('[data-remove-variable]').forEach(button=>button.onclick=()=>{ button.closest('[data-individual-variable]').remove(); if(!root.querySelector('[data-individual-variable]')) root.innerHTML='<div class="sub" data-empty-variables>No custom variables. Built-in variables are always available.</div>'; autoSaveRuleEdit(); });
}
function readIndividualVariables(side){
  const root=els[individualSideIds(side).variables];
  return Array.from(root?.querySelectorAll('[data-individual-variable]')||[]).map(row=>{
    const sourceType=row.querySelector('[data-variable-source-type]').value, source=row.querySelector('[data-variable-source]').value.trim();
    return {name:row.querySelector('[data-variable-name]').value.trim().replace(/^\(|\)$/g,''),sourceType,source:sourceType==='stat'?source:'',field:sourceType==='reportField'?source:'',format:row.querySelector('[data-variable-format]').value};
  }).filter(variable=>variable.name);
}
function individualSideFormSnapshot(side,existing={}){
  const ids=individualSideIds(side);
  return {enabled:!!els[ids.enabled]?.checked,sourceType:els[ids.sourceType]?.value||existing.sourceType||'stat',source:(els[ids.source]?.value||'').trim(),field:(els[ids.field]?.value||'').trim(),operator:els[ids.operator]?.value||existing.operator||'lt',threshold:(els[ids.threshold]?.value||'').trim(),threshold2:(els[ids.threshold2]?.value||'').trim(),message:(els[ids.message]?.value||'').trim(),variables:readIndividualVariables(side)};
}
function individualRuleFormSnapshot(rule){
  const normalized=QualtricsIndividualMessages.normalizeRuleConfig(rule||{});
  return {schemaVersion:QualtricsIndividualMessages.SCHEMA_VERSION,concern:individualSideFormSnapshot('concern',normalized.concern),strength:individualSideFormSnapshot('strength',normalized.strength)};
}
function updateIndividualRuleVisibility(side){
  const ids=individualSideIds(side), sourceType=els[ids.sourceType]?.value||'stat', enabled=!!els[ids.enabled]?.checked;
  if(sourceType!=='legacy'&&els[ids.operator]?.value==='legacy') els[ids.operator].value=side==='concern'?'lt':'gte';
  const operator=els[ids.operator]?.value||'lt';
  const sourceField=els[`${ids.source}Field`], reportField=els[`${ids.field}Field`], thresholdField=els[ids.threshold]?.parentElement;
  if(sourceField) sourceField.classList.toggle('hidden',sourceType!=='stat');
  if(reportField) reportField.classList.toggle('hidden',sourceType!=='reportField');
  if(thresholdField) thresholdField.classList.toggle('hidden',sourceType==='legacy');
  if(els[`${ids.threshold2}Field`]) els[`${ids.threshold2}Field`].classList.toggle('hidden',sourceType==='legacy'||operator!=='between');
  if(sourceType==='legacy'&&els[ids.operator]) els[ids.operator].value='legacy';
  for(const field of [els[ids.sourceType],els[ids.source],els[ids.field],els[ids.operator],els[ids.threshold],els[ids.threshold2],els[ids.message]]) if(field) field.disabled=!enabled;
  if(els[ids.enabled]) els[ids.enabled].disabled=false;
  updateIndividualRuleSectionState();
}
function updateIndividualRuleSectionState(){
  if(!els.individualRuleSectionState) return;
  const concern=!!els.individualConcernEnabled?.checked, strength=!!els.individualStrengthEnabled?.checked;
  els.individualRuleSectionState.textContent=concern&&strength?'Concern + Strength':concern?'Concern only':strength?'Strength only':'Disabled';
  els.individualRuleSectionState.className=`pill sectionState ${concern&&strength?'good':concern?'warn':''}`;
}
function individualReportHeaders(){
  const headers=new Set();
  for(const file of state.dashboardFiles||[]) for(const header of file.headers||[]) if(String(header||'').trim()) headers.add(String(header).trim());
  for(const source of ['qa','coaching','checklist','weeklyStats']) for(const row of (state.masterRows?.[source]||[]).slice(0,100)) for(const header of Object.keys(row.raw||{})) if(String(header||'').trim()) headers.add(String(header).trim());
  return [...headers].sort((a,b)=>a.localeCompare(b));
}
function populateIndividualSourceOptions(){
  if(els.individualMetricOptions){
    const options=['Consumer Appointment Rate','Insurance Appointment Rate','Commercial Appointment Rate','Cash Appointment Rate','QA Score','Call Quality','Wiper Rate','Calls Per Hour','Save the Sale usage',...(typeof weeklyStatHeaders==='function'?weeklyStatHeaders():[])];
    els.individualMetricOptions.innerHTML=[...new Set(options.filter(Boolean))].sort((a,b)=>a.localeCompare(b)).map(value=>`<option value="${esc(value)}"></option>`).join('');
  }
  if(els.individualReportFieldOptions) els.individualReportFieldOptions.innerHTML=individualReportHeaders().map(value=>`<option value="${esc(value)}"></option>`).join('');
}
function fillIndividualRuleForm(rule){
  if(!els.individualConcernEnabled) return;
  const config=QualtricsIndividualMessages.normalizeRuleConfig(rule||{});
  for(const sideName of ['concern','strength']){
    const ids=individualSideIds(sideName), side=config[sideName];
    els[ids.enabled].checked=!!side.enabled; els[ids.sourceType].value=side.sourceType; els[ids.source].value=side.source||''; els[ids.field].value=side.field||''; els[ids.operator].value=side.operator; els[ids.threshold].value=side.threshold||''; els[ids.threshold2].value=side.threshold2||''; els[ids.message].value=side.message||'';
    renderIndividualVariables(sideName,side.variables||[]); updateIndividualRuleVisibility(sideName);
  }
  populateIndividualSourceOptions();
}

function individualTemplateFromForm(){
  return QualtricsIndividualMessages.normalizeTemplate({header:els.individualTemplateHeader?.value,concernHeading:els.individualConcernHeading?.value,strengthHeading:els.individualStrengthHeading?.value,footer:els.individualTemplateFooter?.value,includeNeither:!!els.individualIncludeNeither?.checked,includeGeneric:!!els.individualIncludeGeneric?.checked,genericMessage:els.individualGenericMessage?.value,genericPlacement:els.individualGenericPlacement?.value,maxConcerns:els.individualMaxConcerns?.value,maxStrengths:els.individualMaxStrengths?.value});
}
function fillIndividualTemplateForm(template){
  template=QualtricsIndividualMessages.normalizeTemplate(template);
  if(els.individualTemplateHeader) els.individualTemplateHeader.value=template.header;
  if(els.individualConcernHeading) els.individualConcernHeading.value=template.concernHeading;
  if(els.individualStrengthHeading) els.individualStrengthHeading.value=template.strengthHeading;
  if(els.individualTemplateFooter) els.individualTemplateFooter.value=template.footer;
  if(els.individualIncludeNeither) els.individualIncludeNeither.checked=template.includeNeither;
  if(els.individualIncludeGeneric) els.individualIncludeGeneric.checked=template.includeGeneric;
  if(els.individualGenericMessage) els.individualGenericMessage.value=template.genericMessage;
  if(els.individualGenericPlacement) els.individualGenericPlacement.value=template.genericPlacement;
  if(els.individualMaxConcerns) els.individualMaxConcerns.value=template.maxConcerns;
  if(els.individualMaxStrengths) els.individualMaxStrengths.value=template.maxStrengths;
  state.individualTemplate=template;
  updateIndividualGenericVisibility();
}
function updateIndividualGenericVisibility(){
  const enabled=!!els.individualIncludeGeneric?.checked;
  if(els.individualGenericMessage) els.individualGenericMessage.disabled=!enabled;
  if(els.individualGenericPlacement) els.individualGenericPlacement.disabled=!enabled;
}
async function loadIndividualMessageSettings(){
  const rows=await getAll(STORES.settings), saved=rows.find(row=>row.key===INDIVIDUAL_SETTINGS_KEY);
  fillIndividualTemplateForm(saved?.template||QualtricsIndividualMessages.DEFAULT_TEMPLATE);
}
async function saveIndividualMessageSettings(){
  state.individualTemplate=individualTemplateFromForm();
  await put(STORES.settings,{key:INDIVIDUAL_SETTINGS_KEY,template:state.individualTemplate,updatedAt:new Date().toISOString()});
  invalidateIndividualRunCache('message settings changed');
  toast('Individual message wrapper saved locally.');
}

function individualRuleSelection(){
  if(!(state.individualSelectedRuleIds instanceof Set)) state.individualSelectedRuleIds=new Set(state.individualSelectedRuleIds||[]);
  for(const id of [...state.individualSelectedRuleIds]) if(!state.rules.some(rule=>rule.id===id)) state.individualSelectedRuleIds.delete(id);
  return state.individualSelectedRuleIds;
}
function individualReportSelection(){
  if(!(state.individualSelectedReportFileIds instanceof Set)) state.individualSelectedReportFileIds=new Set(state.individualSelectedReportFileIds||[]);
  for(const id of [...state.individualSelectedReportFileIds]) if(!state.dashboardFiles.some(file=>file.id===id)) state.individualSelectedReportFileIds.delete(id);
  return state.individualSelectedReportFileIds;
}
function individualRuleForFile(file){ return state.rules.find(rule=>rule.id===file?.ruleId)||matchRuleForFile(file?.fileName)||null; }
function individualSelectedRules(){ const selected=individualRuleSelection(); return state.rules.filter(rule=>selected.has(rule.id)); }
function individualSelectedReportFiles(){ const selected=individualReportSelection(); return state.dashboardFiles.filter(file=>selected.has(file.id)&&file.status!=='error'); }
function renderIndividualReportOptions(){
  if(!els.individualReportOptions) return;
  const selected=individualReportSelection(), files=state.dashboardFiles||[];
  els.individualReportOptions.innerHTML=files.map(file=>{
    const rule=individualRuleForFile(file), disabled=file.status==='error';
    return `<label class="individualSelectionOption"><input type="checkbox" data-individual-report-file="${esc(file.id)}"${selected.has(file.id)&&!disabled?' checked':''}${disabled?' disabled':''}><span><strong>${esc(file.fileName)}</strong><small>${file.error?esc(file.error):`${(file.rows||[]).length.toLocaleString()} rows • ${esc(file.sheetName||'report')}`}</small><span class="pill ${rule?'good':disabled?'bad':'warn'}">${rule?`Matched: ${esc(rule.title)}`:disabled?'File error':'No matching saved rule'}</span></span></label>`;
  }).join('')||'<div class="empty compact">No report files uploaded.</div>';
  els.individualReportOptions.querySelectorAll('[data-individual-report-file]').forEach(input=>input.onchange=()=>{ input.checked?selected.add(input.dataset.individualReportFile):selected.delete(input.dataset.individualReportFile); invalidateIndividualRunCache('individual report selection changed'); renderIndividualDataSelectionSummary(); renderIndividualRuleOptions(); });
  if(els.individualReportSelectionCount) els.individualReportSelectionCount.textContent=`${individualSelectedReportFiles().length.toLocaleString()} selected`;
}
function renderIndividualRuleOptions(){
  if(!els.individualRuleOptions) return;
  const selected=individualRuleSelection(), selectedFiles=individualSelectedReportFiles(), query=QualtricsIndividualMessages.normalizeName(els.individualRuleSearch?.value||'');
  const rules=(state.rules||[]).filter(rule=>!query||QualtricsIndividualMessages.normalizeName(`${rule.title} ${ruleTypeLabel(rule)} ${rule.baseName||''}`).includes(query));
  els.individualRuleOptions.innerHTML=rules.map(rule=>{
    const config=QualtricsIndividualMessages.normalizeRuleConfig(rule), enabledSides=[config.concern.enabled?'Concern':'',config.strength.enabled?'Strength':''].filter(Boolean), reportFiles=selectedFiles.filter(file=>individualRuleForFile(file)?.id===rule.id), needsFile=ruleNeedsReportFile(rule);
    const source=needsFile?`${reportFiles.length.toLocaleString()} selected matching report${reportFiles.length===1?'':'s'}`:'Uses the four key files';
    return `<label class="individualSelectionOption"><input type="checkbox" data-individual-rule="${esc(rule.id)}"${selected.has(rule.id)?' checked':''}><span><strong>${esc(rule.title||'Untitled Rule')}</strong><small>${esc(ruleTypeLabel(rule))} • ${esc(enabledSides.join(' + ')||'No individual outcome enabled')} • ${esc(source)}</small><span class="pill ${needsFile?(reportFiles.length?'good':'warn'):'blue'}">${needsFile?'Report file rule':'4 key files'}</span></span></label>`;
  }).join('')||'<div class="empty compact">No saved rules match this search.</div>';
  els.individualRuleOptions.querySelectorAll('[data-individual-rule]').forEach(input=>input.onchange=()=>{ input.checked?selected.add(input.dataset.individualRule):selected.delete(input.dataset.individualRule); invalidateIndividualRunCache('individual rule selection changed'); renderIndividualDataSelectionSummary(); renderIndividualScopeSummary(); });
  if(els.individualRuleSelectionCount) els.individualRuleSelectionCount.textContent=`${individualSelectedRules().length.toLocaleString()} selected`;
}
function renderIndividualDataSelectionSummary(){
  if(!els.individualDataSelectionSummary) return;
  const rules=individualSelectedRules(), files=individualSelectedReportFiles(), missing=rules.filter(rule=>ruleNeedsReportFile(rule)&&!files.some(file=>individualRuleForFile(file)?.id===rule.id));
  const headline=rules.length?`${rules.length.toLocaleString()} rule${rules.length===1?'':'s'} selected`:'No rules selected';
  const detail=`${files.length.toLocaleString()} report file${files.length===1?'':'s'} selected${missing.length?` • ${missing.length.toLocaleString()} selected report-file rule${missing.length===1?' has':'s have'} no matching checked file`:' • Ready to choose an organization and people'}`;
  els.individualDataSelectionSummary.innerHTML=`<strong>${headline}</strong><span>${detail}</span>`;
  if(els.individualReportSelectionCount) els.individualReportSelectionCount.textContent=`${files.length.toLocaleString()} selected`;
  if(els.individualRuleSelectionCount) els.individualRuleSelectionCount.textContent=`${rules.length.toLocaleString()} selected`;
  renderIndividualScopeSummary();
}
function renderIndividualDataSelection(){ renderIndividualReportOptions(); renderIndividualRuleOptions(); renderIndividualDataSelectionSummary(); }
async function addIndividualReportFiles(files){
  const added=await addDashboardFiles(files);
  for(const file of added||[]) if(file.status!=='error') individualReportSelection().add(file.id);
  invalidateIndividualRunCache('individual report files uploaded'); renderIndividualDataSelection();
  if(els.individualReportInput) els.individualReportInput.value='';
}

function individualAddRepresentative(map,rawName,repK,extra={}){
  const name=displayName(rawName); if(!name) return;
  const ident=repK?{key:repK,name}:{...resolveIdentity(name)}; if(!ident.key) return;
  const current=map.get(ident.key)||{repKey:ident.key,fullName:ident.name||name,coach:'',team:'',organization:''};
  if(!current.fullName||current.fullName.split(' ').length<name.split(' ').length) current.fullName=ident.name||name;
  if(extra.coach&&!current.coach) current.coach=canonicalCoachName(extra.coach);
  if(extra.team&&!current.team) current.team=canonicalTeamName(extra.team);
  if((extra.organization||extra.org)&&!current.organization) current.organization=String(extra.organization||extra.org).trim();
  map.set(ident.key,current);
}
function invalidateIndividualRunCache(reason='inputs changed'){
  state.individualRunCache=null;
  state.individualResultsStale=!!state.individualResults?.length;
  state.individualCacheInvalidationReason=reason;
}
function invalidateIndividualScopeIndex(reason='representative membership changed'){
  state.individualDataRevision=(Number(state.individualDataRevision)||0)+1;
  state.individualScopeCache=null;
  invalidateIndividualRunCache(reason);
  if(state.activeTab==='individual'&&els.individualScopeSummary) requestAnimationFrame(()=>{ if(state.activeTab==='individual') renderIndividualScope(); });
}
function buildIndividualRepresentativeCatalog(){
  const map=new Map();
  for(const [repK,item] of state.teamMap||[]) individualAddRepresentative(map,item.name||state.fullNameByKey?.get(repK)||repK,repK,item);
  for(const rows of [state.weeklyStatsRows,state.qaRows,state.coachingRows,state.checklistRows]) for(const row of rows||[]) individualAddRepresentative(map,row.name||row.rawName,row.repKey||row.key,{coach:row.coach||row.rawCoach,team:row.team||row.rawTeam,organization:row.organization||row.org||rowVal(row.raw||{},['Organization','Org','Department','Business Unit'])});
  for(const file of state.dashboardFiles||[]){
    const rule=state.rules.find(item=>item.id===file.ruleId)||matchRuleForFile(file.fileName);
    for(const row of file.rows||[]){ const rawName=rule?getAgentFromRow(row,rule):String(rowVal(row,['Agent Name','Associate Name','Representative','Rep','Name'])||''); if(!rawName) continue; const ident=resolveIdentityFromRow(row,rawName); individualAddRepresentative(map,ident.name,ident.key,{coach:rowVal(row,['Coach','Manager','Supervisor','Job Coach']),team:rowVal(row,['Team','Sheet','Team Name']),organization:rowVal(row,['Organization','Org','Department','Business Unit'])}); }
  }
  return [...map.values()].sort((a,b)=>a.fullName.localeCompare(b.fullName));
}
function individualScopeSelection(){
  const current=state.individualScopeSelection||{};
  if(current.allByDefault==null) current.allByDefault=true;
  for(const key of ['organizationIds','coachKeys','includeRepKeys','excludeRepKeys']) if(!(current[key] instanceof Set)) current[key]=new Set(current[key]||[]);
  state.individualScopeSelection=current; return current;
}
function individualScopeIndex(){
  if(state.individualScopeCache?.revision===state.individualDataRevision) return state.individualScopeCache.index;
  const started=performance.now(), representatives=buildIndividualRepresentativeCatalog(), index=QualtricsIndividualMessages.buildScopeIndex(representatives,state.organizations||[]);
  state.individualScopeCache={revision:state.individualDataRevision,index,builtMs:performance.now()-started};
  const selection=individualScopeSelection();
  for(const key of [...selection.organizationIds]) if(!index.organizationById.has(key)) selection.organizationIds.delete(key);
  for(const key of [...selection.coachKeys]) if(!index.coachByKey.has(key)) selection.coachKeys.delete(key);
  for(const setName of ['includeRepKeys','excludeRepKeys']) for(const key of [...selection[setName]]) if(!index.repByKey.has(key)) selection[setName].delete(key);
  return index;
}
function individualRepresentativeCatalog(){ return individualScopeIndex().representatives; }
function individualResolvedScope(){ return QualtricsIndividualMessages.resolveScope(individualScopeIndex(),individualScopeSelection()); }
function individualScopeSummary(){
  const reps=individualResolvedScope(), coachKeys=new Set(), organizationIds=new Set();
  for(const rep of reps){ if(rep.coachKey) coachKeys.add(rep.coachKey); for(const id of rep.organizationIds||[]) organizationIds.add(id); }
  return {reps,representatives:reps.length,coaches:coachKeys.size,organizations:organizationIds.size};
}
function individualScopeListNote(total,shown){ return total>shown?`<div class="mini muted">Showing ${shown.toLocaleString()} of ${total.toLocaleString()}. Refine the search to narrow the list.</div>`:''; }
function renderIndividualOrganizationOptions(){
  if(!els.individualOrganizationOptions) return;
  const index=individualScopeIndex(), selection=individualScopeSelection(), query=QualtricsIndividualMessages.normalizeName(els.individualOrganizationSearch?.value||'');
  const visible=index.organizations.filter(item=>!query||item.search.includes(query));
  els.individualOrganizationOptions.innerHTML=visible.map(item=>`<label class="individualScopeOption"><input type="checkbox" data-individual-organization="${esc(item.id)}"${selection.organizationIds.has(item.id)?' checked':''}><span><strong>${esc(item.name)}</strong><small>${item.coachKeys.size.toLocaleString()} coaches • ${item.repKeys.size.toLocaleString()} people</small></span></label>`).join('')||'<div class="empty compact">No organizations match.</div>';
  els.individualOrganizationOptions.querySelectorAll('[data-individual-organization]').forEach(input=>input.onchange=()=>{ if(input.checked){ selection.allByDefault=false; selection.organizationIds.add(input.dataset.individualOrganization); }else selection.organizationIds.delete(input.dataset.individualOrganization); invalidateIndividualRunCache('review scope changed'); renderIndividualScopeSummary(); renderIndividualCoachOptions(); renderIndividualRepresentativeOptions(); });
}
function renderIndividualCoachOptions(){
  if(!els.individualCoachOptions) return;
  const index=individualScopeIndex(), selection=individualScopeSelection(), query=QualtricsIndividualMessages.normalizeName(els.individualCoachSearch?.value||'');
  const matches=index.coaches.filter(item=>!query||item.search.includes(query)||QualtricsIndividualMessages.normalizeName(item.name).includes(query)).sort((a,b)=>{
    const aSelected=[...a.organizationIds].some(id=>selection.organizationIds.has(id)), bSelected=[...b.organizationIds].some(id=>selection.organizationIds.has(id));
    return Number(bSelected)-Number(aSelected)||a.name.localeCompare(b.name);
  }), visible=matches.slice(0,160);
  els.individualCoachOptions.innerHTML=visible.map(item=>{ const organizations=[...item.organizationIds].map(id=>index.organizationById.get(id)?.name).filter(Boolean); return `<label class="individualScopeOption"><input type="checkbox" data-individual-coach="${esc(item.key)}"${selection.coachKeys.has(item.key)?' checked':''}><span><strong>${esc(item.name)}</strong><small>${item.repKeys.size.toLocaleString()} people${organizations.length?` • ${esc(organizations.join(', '))}`:''}</small></span></label>`; }).join('')+individualScopeListNote(matches.length,visible.length)||'<div class="empty compact">No coaches match.</div>';
  els.individualCoachOptions.querySelectorAll('[data-individual-coach]').forEach(input=>input.onchange=()=>{ if(input.checked){ selection.allByDefault=false; selection.coachKeys.add(input.dataset.individualCoach); }else selection.coachKeys.delete(input.dataset.individualCoach); invalidateIndividualRunCache('review scope changed'); renderIndividualScopeSummary(); renderIndividualRepresentativeOptions(); });
}
function individualRepScopeMode(repKey){ const selection=individualScopeSelection(); return selection.excludeRepKeys.has(repKey)?'exclude':selection.includeRepKeys.has(repKey)?'include':'automatic'; }
function renderIndividualRepresentativeOptions(){
  if(!els.individualRepresentativeOptions) return;
  const index=individualScopeIndex(), query=QualtricsIndividualMessages.normalizeName(els.individualRepresentativeSearch?.value||'');
  const matches=index.representatives.filter(item=>!query||item.normalizedSearch.includes(query)), visible=matches.slice(0,160);
  els.individualRepresentativeOptions.innerHTML=visible.map(rep=>`<div class="individualRepScopeRow"><span><strong>${esc(rep.fullName)}</strong><small>${esc([rep.coach,rep.team,...(rep.organizationNames||[])].filter(Boolean).join(' • ')||'No coach or organization')}</small></span><select data-individual-rep="${esc(rep.repKey)}" aria-label="Scope behavior for ${esc(rep.fullName)}"><option value="automatic"${individualRepScopeMode(rep.repKey)==='automatic'?' selected':''}>Use group scope</option><option value="include"${individualRepScopeMode(rep.repKey)==='include'?' selected':''}>Always include</option><option value="exclude"${individualRepScopeMode(rep.repKey)==='exclude'?' selected':''}>Exclude</option></select></div>`).join('')+individualScopeListNote(matches.length,visible.length)||'<div class="empty compact">No representatives match.</div>';
  els.individualRepresentativeOptions.querySelectorAll('[data-individual-rep]').forEach(select=>select.onchange=()=>{ const key=select.dataset.individualRep, scope=individualScopeSelection(); scope.includeRepKeys.delete(key); scope.excludeRepKeys.delete(key); if(select.value==='include'){ if(!scope.organizationIds.size&&!scope.coachKeys.size) scope.allByDefault=false; scope.includeRepKeys.add(key); } if(select.value==='exclude') scope.excludeRepKeys.add(key); invalidateIndividualRunCache('review scope changed'); renderIndividualScopeSummary(); });
}
function renderIndividualScopeSummary(){
  if(!els.individualScopeSummary) return;
  const summary=individualScopeSummary(), selection=individualScopeSelection(), selectedRules=individualSelectedRules(), isAll=selection.allByDefault&&!selection.organizationIds.size&&!selection.coachKeys.size&&!selection.includeRepKeys.size&&!selection.excludeRepKeys.size;
  els.individualScopeSummary.innerHTML=`<strong>${summary.representatives.toLocaleString()} representatives selected</strong><span>${summary.organizations.toLocaleString()} organizations • ${summary.coaches.toLocaleString()} coaches${isAll?' • All available people':!summary.representatives?' • Empty scope':''}</span>`;
  if(els.evaluateIndividualsBtn){ els.evaluateIndividualsBtn.textContent=selectedRules.length?`Review ${summary.representatives.toLocaleString()} ${summary.representatives===1?'Person':'People'} with ${selectedRules.length.toLocaleString()} ${selectedRules.length===1?'Rule':'Rules'}`:'Select Rules to Review'; els.evaluateIndividualsBtn.disabled=!summary.representatives||!selectedRules.length||!!state.individualReviewRun; }
  const currentResults=!!state.individualResults?.length&&!state.individualResultsStale;
  if(els.exportIndividualReviewBtn) els.exportIndividualReviewBtn.disabled=!currentResults||!!state.individualReviewRun;
  if(els.exportIndividualEmailsBtn) els.exportIndividualEmailsBtn.disabled=!currentResults||!!state.individualReviewRun;
}
function renderIndividualScope(){ renderIndividualOrganizationOptions(); renderIndividualCoachOptions(); renderIndividualRepresentativeOptions(); renderIndividualScopeSummary(); }
function resetIndividualScope(){
  const selection=individualScopeSelection(); for(const key of Object.keys(selection)) if(selection[key] instanceof Set) selection[key].clear(); selection.allByDefault=true;
  invalidateIndividualRunCache('review scope reset'); renderIndividualScope();
}
function clearIndividualScope(){
  const selection=individualScopeSelection(); for(const key of Object.keys(selection)) if(selection[key] instanceof Set) selection[key].clear(); selection.allByDefault=false;
  invalidateIndividualRunCache('review scope cleared'); renderIndividualScope();
}
function selectAllIndividualOrganizations(){
  const selection=individualScopeSelection(), index=individualScopeIndex(); selection.organizationIds=new Set(index.organizations.map(item=>item.id)); selection.allByDefault=false;
  invalidateIndividualRunCache('organization scope changed'); renderIndividualScope();
}
function clearIndividualOrganizations(){
  const selection=individualScopeSelection(); selection.organizationIds.clear(); selection.allByDefault=false;
  invalidateIndividualRunCache('organization scope changed'); renderIndividualScope();
}
function individualMetricConfig(source){
  const raw=String(source||'').trim(), normalized=headerKey(raw);
  if(/^(cash|consumer)appointmentrate$/.test(normalized)||normalized==='cashrate') return {metric:'cashAppointmentRate',cashSourceMode:'consumerRatio',lookbackWeeks:10,dateMode:'relative'};
  if(/^(qa|qascore|callquality|qualityscore)$/.test(normalized)) return {metric:'callQuality',lookbackWeeks:10,dateMode:'relative'};
  if(normalized==='wiperrate'||normalized==='wiper') return {metric:'wiperRate',lookbackWeeks:10,dateMode:'relative'};
  return {metric:'custom',customHeader:raw,customValueHeader:raw,customSourceMode:'column',lookbackWeeks:10,dateMode:'relative'};
}
function individualStatObservation(rep,source,reportDate){
  const config=individualMetricConfig(source), selected=authoritativeLookbackSeries(rep.repKey,config,reportDate,10), item=selected.valued[selected.valued.length-1];
  const label=metricLabel(config.metric,config.customHeader||source);
  if(!item) return {missing:true,label,reason:`No resolved ${label} value for this representative`};
  return {missing:false,value:item.value,raw:item.value,formatted:formatMetricValue(label,item.value),label,source:item.source||source,isPercent:isPercentHeader(label)};
}
function individualDashboardRowsFor(rep,rule,context){
  const preferred=context?.dashboardByRuleRep?.get(rule.id)?.get(rep.repKey)||[];
  return preferred.length?preferred:(context?.dashboardByRep?.get(rep.repKey)||[]);
}
function individualReportObservation(rep,field,rule,context){
  const rows=individualDashboardRowsFor(rep,rule,context); let selected=null, header='';
  for(const item of rows){ header=findHeader(Object.keys(item.raw||{}),[field]); if(header){ selected=item.raw[header]; break; } }
  if(selected==null||String(selected).trim()===''){
    for(const source of ['weeklyByRep','qaByRep','coachingByRep','checklistByRep']){
      const item=(state.indexes?.[source]?.get(rep.repKey)||[]).find(row=>findHeader(Object.keys(row.raw||{}),[field]));
      if(!item) continue; header=findHeader(Object.keys(item.raw||{}),[field]); selected=item.raw[header]; if(selected!=null&&String(selected).trim()!=='') break;
    }
  }
  if(selected==null||String(selected).trim()==='') return {missing:true,label:field||'Report field',reason:`Report field ${field||'(not selected)'} is missing`};
  const isPercent=isPercentHeader(header)||hasPercentSign(selected), value=numberForComparison(selected,header,isPercent), numericValue=isFinite(value)?value:NaN;
  return {missing:false,value:numericValue,raw:selected,formatted:formatValueForHeader(header,selected)||String(selected),label:header||field,source:'Report field',isPercent};
}
function individualLegacyObservation(rep,rule,reportDate,cache,context){
  if(!cache.has(rule.id)){
    const map=new Map(), add=(base,observation)=>{ if(base?.repKey) map.set(base.repKey,Object.assign({missing:false,matched:true,label:rule.title,score:1,rankingVolume:0,rankingLabel:'Original rule qualifying count'},observation||{})); };
    if(isStatRule(rule)) for(const repItem of context.scopeIndex.representatives){
      const check=evaluateStatRuleForRep(repItem.repKey,rule.statRule,reportDate), percentMode=rule.statRule?.minimumMode!=='weeks', rankingVolume=percentMode?(isFinite(check.pctLow)?check.pctLow*100:0):check.lowWeeks;
      add(repItem,{matched:check.meets,value:check.avg,raw:check.avg,formatted:formatMetricValue(check.label,check.avg),label:check.label,isPercent:isPercentHeader(check.label),score:(check.pctLow||0)*100,rankingVolume,rankingLabel:percentMode?'Percent of valued weeks below goal':'Weeks below goal'});
    }
    else if(isStatCountRule(rule)){
      const minimum=Math.max(0,Number(rule.statCount?.minCount)||0), volumeRule={...rule,statCount:{...(rule.statCount||{}),minCount:0}};
      for(const base of buildStatCountRecords(volumeRule,reportDate)) add(base,{matched:base.count>=minimum,value:base.count,raw:base.count,formatted:String(base.count),label:rule.statCount?.label||rule.title,score:base.count,rankingVolume:base.count,rankingLabel:rule.statCount?.label||'Matching rows'});
    }
    else if(isCoachingCorrectiveRule(rule)){
      const minimum=Math.max(0,Number(rule.coachingCorrective?.minCoachingCount)||0), volumeRule={...rule,coachingCorrective:{...(rule.coachingCorrective||{}),minCoachingCount:0}};
      for(const base of buildCoachingCorrectiveRecords(volumeRule,reportDate)) add(base,{matched:base.coachings.length>=minimum,value:base.ratio,raw:base.ratio,formatted:isFinite(base.ratio)?fmtNum(base.ratio,2):String(base.coachings?.length||0),label:rule.title,score:base.coachings?.length||1,rankingVolume:base.coachings.length,rankingLabel:'Matching documented coachings'});
    }
    else if(isHeaderCountRule(rule)){
      const sources=(context.reportFiles||[]).filter(file=>individualRuleForFile(file)?.id===rule.id).map(file=>({name:file.fileName,rows:file.rows||[]}));
      const minimum=countThreshold(rule), volumeRule={...rule,countRule:{...(rule.countRule||{}),minCount:0}};
      for(const base of buildHeaderCountRecords(volumeRule,sources).records) add(base,{matched:base.count>=minimum,value:base.count,raw:base.count,formatted:String(base.count),label:rule.countRule?.label||rule.title,score:base.count,rankingVolume:base.count,rankingLabel:rule.countRule?.label||'Matching rows'});
    }else{
      for(const [repKey,items] of context.dashboardByRuleRep.get(rule.id)||[]){
        const matches=items.filter(item=>rowMeetsRule(item.raw,rule)); if(!matches.length) continue;
        const raw=matches[0].raw, field=rule.displayColumn?.enabled?rule.displayColumn.header:(rule.criteria?.[0]?.header||''), value=field?raw[field]:rule.title;
        add({repKey},{value:numberForComparison(value,field,isPercentHeader(field)||hasPercentSign(value)),raw:value,formatted:field?formatValueForHeader(field,value):String(value),label:field||rule.title,isPercent:isPercentHeader(field),score:matches.length,rankingVolume:matches.length,rankingLabel:'Matching report rows'});
      }
    }
    cache.set(rule.id,map);
  }
  return cache.get(rule.id).get(rep.repKey)||{missing:false,matched:false,label:rule.title,raw:'',formatted:'',score:0,rankingVolume:0,rankingLabel:'Original rule qualifying count',reason:'Existing rule did not identify this representative'};
}
function createIndividualResolver(reportDate,context){
  const legacyCache=new Map(), observationCache=new Map();
  const cached=(key,build)=>{ if(!observationCache.has(key)) observationCache.set(key,build()); return observationCache.get(key); };
  return {
    resolveObservation(rep,side,rule){
      if(side.sourceType==='legacy') return individualLegacyObservation(rep,rule,reportDate,legacyCache,context);
      if(side.sourceType==='reportField') return cached(`report|${rule.id}|${rep.repKey}|${side.field}`,()=>individualReportObservation(rep,side.field,rule,context));
      return cached(`stat|${rep.repKey}|${side.source}`,()=>individualStatObservation(rep,side.source,reportDate));
    },
    resolveVariable(rep,variable,rule){
      const source=variable.field||variable.source;
      return variable.sourceType==='reportField'?cached(`report|${rule.id}|${rep.repKey}|${source}`,()=>individualReportObservation(rep,source,rule,context)):cached(`stat|${rep.repKey}|${source}`,()=>individualStatObservation(rep,source,reportDate));
    },
    resolveRankingVolume(rep,rule){ return individualLegacyObservation(rep,rule,reportDate,legacyCache,context); },
    observationCache,legacyCache
  };
}

function individualYieldToBrowser(){ return new Promise(resolve=>{ if(typeof requestAnimationFrame==='function') requestAnimationFrame(()=>setTimeout(resolve,0)); else setTimeout(resolve,0); }); }
function individualThrowIfCancelled(signal){ if(signal?.aborted){ const error=new Error('Individual review cancelled.'); error.name='AbortError'; throw error; } }
function setIndividualReviewProgress(percent,phase='',detail=''){
  const active=percent!=null;
  els.individualProgressPanel?.classList.toggle('hidden',!active);
  if(active){
    const value=Math.max(0,Math.min(100,Number(percent)||0));
    if(els.individualProgressBar) els.individualProgressBar.style.width=`${value}%`;
    if(els.individualProgressPercent) els.individualProgressPercent.textContent=`${Math.round(value)}%`;
    if(els.individualProgressPhase) els.individualProgressPhase.textContent=phase;
    if(els.individualProgressDetail) els.individualProgressDetail.textContent=detail;
    setProgress(value,phase);
  }else setProgress(null);
}
async function buildIndividualRunContext(scopeIndex,rules,reportFiles,signal,onProgress){
  const rulesById=new Map((rules||[]).map(rule=>[rule.id,rule])), dashboardByRuleRep=new Map(), dashboardByRep=new Map();
  const files=(reportFiles||[]).map(file=>{ const matched=rulesById.get(file.ruleId)||matchRuleForFile(file.fileName); return {file,rule:matched&&rulesById.has(matched.id)?matched:null}; });
  const totalRows=Math.max(1,files.reduce((sum,item)=>sum+(item.file.rows?.length||0),0)); let processed=0;
  for(const {file,rule} of files){
    individualThrowIfCancelled(signal);
    if(rule&&!dashboardByRuleRep.has(rule.id)) dashboardByRuleRep.set(rule.id,new Map());
    for(const raw of file.rows||[]){
      const rawName=rule?getAgentFromRow(raw,rule):String(rowVal(raw,['Agent Name','Associate Name','Representative','Rep','Name'])||'');
      if(rawName){
        const ident=resolveIdentityFromRow(raw,rawName), item={raw,file,fileRule:rule};
        if(!dashboardByRep.has(ident.key)) dashboardByRep.set(ident.key,[]); dashboardByRep.get(ident.key).push(item);
        if(rule){ const byRep=dashboardByRuleRep.get(rule.id); if(!byRep.has(ident.key)) byRep.set(ident.key,[]); byRep.get(ident.key).push(item); }
      }
      processed++;
      if(processed%400===0){ onProgress?.(processed/totalRows); await individualYieldToBrowser(); individualThrowIfCancelled(signal); }
    }
    onProgress?.(processed/totalRows); await individualYieldToBrowser();
  }
  return {scopeIndex,rulesById,reportFiles:reportFiles||[],dashboardByRuleRep,dashboardByRep};
}
function individualReviewSignature(representatives,rules,reportFiles,template,reportDate){
  const selection=individualScopeSelection();
  return JSON.stringify({dataRevision:state.individualDataRevision,reportDate:ymd(reportDate),rules,reportFileIds:(reportFiles||[]).map(file=>file.id).sort(),template,rosterRevision:state.individualRosterRevision||0,reps:representatives.map(rep=>rep.repKey),scope:{allByDefault:selection.allByDefault,organizations:[...selection.organizationIds].sort(),coaches:[...selection.coachKeys].sort(),include:[...selection.includeRepKeys].sort(),exclude:[...selection.excludeRepKeys].sort()}});
}
function renderIndividualPerformance(){
  if(!els.individualPerformanceDiagnostics) return;
  const timings=state.individualPerformance?.timings;
  if(!timings){ els.individualPerformanceDiagnostics.innerHTML='<div class="sub">Run a review to capture stage timings.</div>'; return; }
  const rows=Object.entries(timings).map(([label,value])=>`<div><span>${esc(label)}</span><strong>${Math.round(value).toLocaleString()} ms</strong></div>`).join('');
  const slow=Object.entries(timings).filter(([label,value])=>label!=='Total'&&value>=1000).map(([label,value])=>`${label} (${Math.round(value).toLocaleString()} ms)`);
  els.individualPerformanceDiagnostics.innerHTML=`<div class="individualPerformanceRows">${rows}</div>${state.individualPerformance.cacheHit?'<div class="note goodNote">The completed review was reused from the active run cache.</div>':''}${slow.length?`<div class="note dangerText"><strong>Unexpectedly expensive stage:</strong> ${esc(slow.join(', '))}</div>`:''}`;
}

function renderIndividualRosterStatus(){
  if(!els.individualRosterStatus) return;
  if(!state.individualRosterRows?.length){ els.individualRosterStatus.textContent='No roster loaded.'; return; }
  const reps=individualRepresentativeCatalog(), index=QualtricsIndividualMessages.buildRosterIndex(state.individualRosterRows), matches=reps.map(rep=>QualtricsIndividualMessages.matchRosterName(rep.fullName,index));
  const matched=matches.filter(item=>item.status==='matched').length, ambiguous=matches.filter(item=>item.status==='ambiguous').length;
  els.individualRosterStatus.innerHTML=`<strong>${esc(state.individualRosterFileName||'Roster loaded')}</strong> • ${index.entries.length.toLocaleString()} roster row(s) • ${reps.length.toLocaleString()} representatives available • ${matched.toLocaleString()} matched • ${(reps.length-matched-ambiguous).toLocaleString()} unmatched • ${ambiguous.toLocaleString()} ambiguous.`;
}
async function loadIndividualRoster(file){
  if(!file) return;
  try{
    const parsed=await readFileAsWorkbookRows(file,'First Name');
    const choices=(parsed.sheets||[]).map(sheet=>({sheet,first:findHeader(sheet.headers||[],['First Name','FirstName']),last:findHeader(sheet.headers||[],['Last Name','LastName','Surname']),email:findHeader(sheet.headers||[],['Username','User Name','Email','Email Address'])})).filter(item=>item.first&&item.last&&item.email).sort((a,b)=>(b.sheet.rows?.length||0)-(a.sheet.rows?.length||0));
    if(!choices.length) throw new Error('No sheet contains First Name, Last Name, and Username columns.');
    state.individualRosterRows=choices[0].sheet.rows||[]; state.individualRosterFileName=file.name; state.individualRosterRevision=(state.individualRosterRevision||0)+1; state.individualResults=[]; state.individualEvaluation=null; invalidateIndividualRunCache('email roster changed'); renderIndividualRosterStatus(); renderIndividualScopeSummary(); renderIndividualSummary(); renderIndividualReview();
    setStatus(`Loaded ${state.individualRosterRows.length.toLocaleString()} representative roster row(s). Nothing was sent.`);
  }catch(error){ console.error(error); toast(`Roster could not be loaded: ${error.message||error}`); }
  finally{ if(els.individualRosterInput) els.individualRosterInput.value=''; }
}
function loadPastedIndividualRoster(){
  try{
    const text=els.individualRosterPaste?.value||'', aoa=parseDelimitedText(text); if(aoa.length<2) throw new Error('Paste a header row and at least one representative row.');
    const parsed=aoaToRows(aoa,0), first=findHeader(parsed.headers,['First Name','FirstName']), last=findHeader(parsed.headers,['Last Name','LastName','Surname']), email=findHeader(parsed.headers,['Username','User Name','Email','Email Address']);
    if(!first||!last||!email) throw new Error('Pasted rows must include First Name, Last Name, and Username columns.');
    state.individualRosterRows=parsed.rows; state.individualRosterFileName='Pasted roster'; state.individualRosterRevision=(state.individualRosterRevision||0)+1; state.individualResults=[]; state.individualEvaluation=null; invalidateIndividualRunCache('email roster changed'); renderIndividualRosterStatus(); renderIndividualScopeSummary(); renderIndividualSummary(); renderIndividualReview();
    setStatus(`Loaded ${parsed.rows.length.toLocaleString()} pasted representative roster row(s). Nothing was sent.`);
  }catch(error){ toast(`Pasted roster could not be loaded: ${error.message||error}`); }
}
async function evaluateIndividualMessages(){
  if(!state.individualRosterRows?.length){ toast('Load the representative email roster first.'); return; }
  const selectedRules=individualSelectedRules(), selectedReportFiles=individualSelectedReportFiles();
  if(!selectedRules.length){ toast('Select at least one rule to run in Report Files & Rules.'); return; }
  if(state.individualReviewRun) return;
  const controller=new AbortController(), run={id:uid(),controller}; state.individualReviewRun=run; renderIndividualScopeSummary();
  const timings={}, totalStarted=performance.now(), mark=(label,started)=>{ timings[label]=performance.now()-started; };
  try{
    setIndividualReviewProgress(2,'Preparing review scope','Resolving organizations, coaches, and individual overrides'); await individualYieldToBrowser();
    let started=performance.now(); const scopeIndex=individualScopeIndex(), representatives=individualResolvedScope(); mark('Scope resolution',started);
    if(!representatives.length){ toast('Choose at least one representative to review.'); return; }
    state.individualTemplate=individualTemplateFromForm(); const reportDate=parseDate(els.reportDate?.value)||new Date(), signature=individualReviewSignature(representatives,selectedRules,selectedReportFiles,state.individualTemplate,reportDate);
    if(state.individualRunCache?.signature===signature){
      state.individualEvaluation=state.individualRunCache.evaluation; state.individualResults=state.individualRunCache.results; state.individualResultsStale=false; state.individualPerformance={timings:{'Scope resolution':timings['Scope resolution'],'Active run cache':0,'Total':performance.now()-totalStarted},cacheHit:true};
      setIndividualReviewProgress(95,'Rendering review',`${state.individualResults.length.toLocaleString()} cached representatives`); renderIndividualSummary(); renderIndividualReview(); renderIndividualPerformance(); setIndividualReviewProgress(100,'Review ready','Reused the completed active review');
      setStatus(`Reviewed ${state.individualResults.length.toLocaleString()} selected representatives from the active cache. Nothing was sent.`); await new Promise(resolve=>setTimeout(resolve,160)); return;
    }
    setIndividualReviewProgress(11,'Resolving representative data',`Indexing report rows for ${representatives.length.toLocaleString()} people`);
    started=performance.now(); const context=await buildIndividualRunContext(scopeIndex,selectedRules,selectedReportFiles,controller.signal,fraction=>setIndividualReviewProgress(11+fraction*14,'Resolving representative data',`${Math.round(fraction*100)}% of selected report rows indexed`)); mark('Representative indexes',started);
    individualThrowIfCancelled(controller.signal);
    started=performance.now(); const rosterIndex=QualtricsIndividualMessages.buildRosterIndex(state.individualRosterRows), resolver=createIndividualResolver(reportDate,context); mark('Roster and resolver',started);
    setIndividualReviewProgress(25,'Evaluating Concern / Strength rules',`0 / ${representatives.length.toLocaleString()} representatives`);
    started=performance.now(); const evaluation=await QualtricsIndividualMessages.evaluateAllAsync({representatives,rules:selectedRules,rosterIndex,resolver,template:state.individualTemplate,signal:controller.signal,chunkSize:20,sliceMs:12,yieldToBrowser:individualYieldToBrowser,onProgress:progress=>setIndividualReviewProgress(25+progress.fraction*45,'Evaluating Concern / Strength rules',`${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} representatives`)}); mark('Rule evaluation',started);
    individualThrowIfCancelled(controller.signal);
    setIndividualReviewProgress(72,'Ranking review priority','Putting the people who need attention first'); await individualYieldToBrowser();
    started=performance.now(); const results=QualtricsIndividualMessages.sortReviewResults(evaluation.results); evaluation.results=results; evaluation.summary=QualtricsIndividualMessages.summarize(results); mark('Priority ranking',started);
    setIndividualReviewProgress(87,'Building messages','Deduplicating and preparing review blocks'); await individualYieldToBrowser();
    started=performance.now(); state.individualEvaluation=evaluation; state.individualResults=results; state.individualResultsStale=false; state.individualRenderLimit=80; mark('Message model',started);
    setIndividualReviewProgress(95,'Rendering review',`${results.length.toLocaleString()} representative blocks`);
    started=performance.now(); renderIndividualSummary(); renderIndividualReview(); mark('Initial render',started);
    timings.Total=performance.now()-totalStarted; state.individualPerformance={timings,cacheHit:false}; renderIndividualPerformance();
    const slowStages=Object.entries(timings).filter(([label,value])=>label!=='Total'&&value>=1000); if(slowStages.length) console.warn('Individual Review slow stage(s)',Object.fromEntries(slowStages));
    state.individualRunCache={signature,evaluation,results,context,resolver,createdAt:Date.now()};
    setIndividualReviewProgress(100,'Review ready',`${results.length.toLocaleString()} people reviewed`); const summary=evaluation.summary;
    setStatus(`Reviewed ${summary.evaluated.toLocaleString()} selected representatives: ${summary.attention.toLocaleString()} need attention, ${summary.mixed.toLocaleString()} mixed, and ${summary.strengthOnly.toLocaleString()} strength only. Nothing was sent.`);
    if(new URLSearchParams(location.search).get('debug')==='1') console.table(timings);
    await new Promise(resolve=>setTimeout(resolve,220));
  }catch(error){
    if(error?.name==='AbortError'){ setStatus('Individual review cancelled. Existing rules, data, and prior results were not changed.'); toast('Review cancelled safely.'); }
    else { console.error(error); setStatus(`Individual review error: ${error.message||error}`); toast(`Review could not be completed: ${error.message||error}`); }
  }finally{
    if(state.individualReviewRun?.id===run.id) state.individualReviewRun=null;
    setIndividualReviewProgress(null); renderIndividualScopeSummary();
  }
}
function renderIndividualSummary(){
  if(!els.individualSummary) return;
  const summary=state.individualEvaluation?.summary;
  if(!summary){ els.individualSummary.innerHTML='<div class="empty">Load a roster, configure rule outcomes, and evaluate individuals.</div>'; return; }
  const tiles=[['Reviewed',summary.evaluated,'all',''],['Needs Attention',summary.attention,'attention',summary.attention?'bad':'good'],['Mixed',summary.mixed,'mixed',summary.mixed?'warn':'good'],['Doing Well',summary.strengthOnly,'strength',summary.strengthOnly?'good':''],['No Finding',summary.noFinding,'noFinding',''],['Send Ready',summary.ready,'ready','good'],['Email Issue',summary.unmatched+summary.ambiguous,'emailIssue',(summary.unmatched+summary.ambiguous)?'warn':'good'],['Template Error',summary.templateErrors,'templateError',summary.templateErrors?'bad':'good']];
  els.individualSummary.innerHTML=tiles.map(([label,count,filter,cls])=>`<button type="button" class="individualSummaryTile ${cls}" data-individual-summary-filter="${filter}"><strong>${count.toLocaleString()}</strong><span>${esc(label)}</span></button>`).join('');
  els.individualSummary.querySelectorAll('[data-individual-summary-filter]').forEach(button=>button.onclick=()=>{ els.individualResultFilter.value=button.dataset.individualSummaryFilter; state.individualRenderLimit=80; renderIndividualReview(); });
  renderIndividualResultFacets();
}
function individualDiagnosticHtml(result){
  return `<div class="individualDiagnostics">${result.diagnostics.map(item=>`<div class="individualDiagnostic ${item.pass?'pass':'fail'}"><strong>${esc(item.ruleTitle)} — ${esc(item.side[0].toUpperCase()+item.side.slice(1))}</strong><div class="mini">Value: ${esc(item.value||'N/A')} • Condition: ${esc(item.condition)} • Result: ${item.enabled?(item.missing?'MISSING':item.pass?'PASS':'FAIL'):'DISABLED'}${item.pass?` • Original qualifying counter: ${Number(item.rankingVolume||0).toLocaleString()} ${esc(item.rankingLabel||'')}`:''}${item.pass?` • Normalized score: ${Number(item.score).toFixed(2)}`:''}</div><div class="mini muted">${esc(item.reason||'')}</div></div>`).join('')}</div>`;
}
function individualMatchHtml(result){
  const match=result.emailMatch, possible=(match.matches||[]).map(item=>`<span>${esc(item.fullName)} — ${esc(item.email||'no Username')}</span>`).join('');
  return `<div class="individualMatchList"><span>Input: ${esc(result.fullName)}</span><span>Normalized: ${esc(match.normalizedName)}</span><span>Status: ${esc(match.status)}</span>${possible||'<span>No roster match</span>'}</div>`;
}
function individualMatchesResultFilter(result,filter){
  if(['attention','mixed','strength','noFinding'].includes(filter)) return QualtricsIndividualMessages.reviewCategory(result)===filter;
  return QualtricsIndividualMessages.filterResult(result,filter);
}
function renderIndividualResultFacets(){
  const results=state.individualResults||[];
  for(const [element,values,placeholder] of [[els.individualResultCoach,[...new Set(results.map(result=>result.coach).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),'All coaches'],[els.individualResultOrganization,[...new Set(results.flatMap(result=>result.organizationNames||[]).filter(Boolean))].sort((a,b)=>a.localeCompare(b)),'All organizations']]){
    if(!element) continue; const selected=element.value; element.innerHTML=`<option value="">${placeholder}</option>`+values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join(''); if(values.includes(selected)) element.value=selected;
  }
}
function individualFindingHtml(title,messages,emptyText,kind){
  return `<section class="individualFinding ${kind}"><h4>${esc(title)}</h4>${messages.length?messages.map(message=>`<p>${esc(message)}</p>`).join(''):`<p class="muted">${esc(emptyText)}</p>`}</section>`;
}
function individualReviewCardHtml(result){
  const category=QualtricsIndividualMessages.reviewCategory(result), labels={attention:'Needs Attention',mixed:'Mixed',strength:'Doing Well',noFinding:'No Individual Finding'}, generic=result.genericMessage?`<section class="individualFinding generic"><h4>Message for Everyone</h4><p>${esc(result.genericMessage)}</p></section>`:'';
  const findings=`${individualFindingHtml('Doing Well',result.strengthMessages||[],'No Strength rule qualified.','strength')}${individualFindingHtml('Needs to Work On',result.concernMessages||[],'No Concern rule qualified.','concern')}`;
  const concernShown=result.concerns?.length||0, strengthShown=result.strengths?.length||0, concernMatched=result.qualifyingConcernCount??concernShown, strengthMatched=result.qualifyingStrengthCount??strengthShown;
  const concernCount=concernMatched>concernShown?`${concernShown.toLocaleString()} of ${concernMatched.toLocaleString()}`:concernShown.toLocaleString(), strengthCount=strengthMatched>strengthShown?`${strengthShown.toLocaleString()} of ${strengthMatched.toLocaleString()}`:strengthShown.toLocaleString();
  return `<details class="individualReviewCard ${category}"${state.individualCardsExpanded===false?'':' open'}><summary><span><strong>${esc(result.fullName)}</strong><small>${esc([result.coach,result.team,...(result.organizationNames||[])].filter(Boolean).join(' • ')||'No coach assigned')}</small></span><span class="individualReviewCardMeta"><b>${concernCount} Concern${concernMatched===1?'':'s'} • ${strengthCount} Strength${strengthMatched===1?'':'s'}</b><em>${labels[category]}</em></span></summary><div class="individualReviewCardBody"><div class="individualReviewContact"><span>${esc(result.email||'No matched email')}</span><strong class="${result.sendReady?'statusReady':'statusBlocked'}">${esc(result.status)}</strong></div>${state.individualTemplate?.genericPlacement==='before'?generic:''}${findings}${state.individualTemplate?.genericPlacement==='after'?generic:''}${result.errors.length?`<div class="note dangerText">${result.errors.map(esc).join('<br>')}</div>`:''}</div></details>`;
}
function individualDiagnosticsTableHtml(results,total){
  return `<div class="row" style="margin-bottom:9px"><strong>${results.length.toLocaleString()} of ${total.toLocaleString()} representatives rendered</strong><span class="spacer"></span><span class="sub">Diagnostics expose rule values and email matching only in this mode.</span></div><div class="tableWrap"><table><thead><tr><th>Representative</th><th>Email</th><th>Concern</th><th>Strength</th><th>Status</th><th>Rule diagnostics</th></tr></thead><tbody>${results.map(result=>`<tr><td><strong>${esc(result.fullName)}</strong><div class="mini muted">${esc(result.coach||'')}</div></td><td>${esc(result.email||'—')}${individualMatchHtml(result)}</td><td>${esc((result.concerns||[]).map(item=>item.title).join(', ')||'None')}</td><td>${esc((result.strengths||[]).map(item=>item.title).join(', ')||'None')}</td><td><strong class="${result.sendReady?'statusReady':'statusBlocked'}">${esc(result.status)}</strong></td><td><details><summary>Open diagnostics</summary>${individualDiagnosticHtml(result)}</details></td></tr>`).join('')||'<tr><td colspan="6">No representatives match this filter.</td></tr>'}</tbody></table></div>`;
}
function renderIndividualReview(){
  if(!els.individualReview) return;
  const results=state.individualResults||[]; if(!results.length){ els.individualReview.innerHTML='<div class="empty">No individual evaluation has been run.</div>'; return; }
  const filter=els.individualResultFilter?.value||'all', q=QualtricsIndividualMessages.normalizeName(els.individualResultSearch?.value||''), coach=els.individualResultCoach?.value||'', organization=els.individualResultOrganization?.value||'';
  const filtered=results.filter(result=>individualMatchesResultFilter(result,filter)).filter(result=>!coach||result.coach===coach).filter(result=>!organization||(result.organizationNames||[]).includes(organization)).filter(result=>!q||QualtricsIndividualMessages.normalizeName(`${result.fullName} ${result.email} ${result.coach} ${result.team} ${(result.organizationNames||[]).join(' ')} ${(result.concerns||[]).map(item=>item.title).join(' ')} ${(result.strengths||[]).map(item=>item.title).join(' ')} ${result.status}`).includes(q));
  const limit=Math.max(40,Number(state.individualRenderLimit)||80), shown=filtered.slice(0,limit), mode=els.individualViewMode?.value||'review';
  const content=mode==='diagnostics'?individualDiagnosticsTableHtml(shown,filtered.length):`<div class="individualReviewList">${shown.map(individualReviewCardHtml).join('')||'<div class="empty">No representatives match this filter.</div>'}</div>`;
  els.individualReview.innerHTML=`${state.individualResultsStale?'<div class="note dangerText" style="margin-bottom:10px">Selections or inputs changed. Run the Individual Review again before exporting these results.</div>':''}<div class="individualReviewCount"><strong>${filtered.length.toLocaleString()} people match this view</strong><span>${shown.length.toLocaleString()} rendered • ${results.length.toLocaleString()} reviewed</span></div>${content}${filtered.length>shown.length?`<div class="row center" style="margin-top:12px"><button class="btn blue" type="button" data-individual-show-more>Show ${Math.min(80,filtered.length-shown.length).toLocaleString()} More</button></div>`:''}`;
  els.individualReview.querySelector('[data-individual-show-more]')?.addEventListener('click',()=>{ state.individualRenderLimit=limit+80; renderIndividualReview(); });
}
function individualExportRows(){
  return (state.individualResults||[]).map(result=>({
    Representative:result.fullName,Coach:result.coach||'',Team:result.team||'',Organization:(result.organizationNames||[]).join(' | '),ReviewPriority:QualtricsIndividualMessages.reviewCategory(result),Email:result.email,
    GreetingMessageWrapper:result.greeting||'',AreasToFocusOn:result.areasToFocusOn||(result.concernMessages||[]).join('\n\n'),StrengthSection:result.strengthSection||(result.strengthMessages||[]).join('\n\n'),GenericMessage:result.genericMessage||'',Closing:result.closing||'',CompleteMessage:result.message,
    IncludedConcernCount:(result.concerns||[]).length,QualifyingConcernCount:result.qualifyingConcernCount??(result.concerns||[]).length,ConcernRules:(result.concerns||[]).map(item=>item.title).join(' | '),IncludedStrengthCount:(result.strengths||[]).length,QualifyingStrengthCount:result.qualifyingStrengthCount??(result.strengths||[]).length,StrengthRules:(result.strengths||[]).map(item=>item.title).join(' | '),Status:result.status,SendReady:result.sendReady?'Yes':'No',Errors:result.errors.join(' | '),MatchStatus:result.emailMatch.status,NormalizedName:result.emailMatch.normalizedName
  }));
}
function exportIndividualReview(){
  if(state.individualResultsStale){ toast('Run the Individual Review again before exporting changed selections.'); return; }
  const rows=individualExportRows(); if(!rows.length){ toast('Evaluate individuals before exporting the review.'); return; }
  const diagnostics=(state.individualResults||[]).flatMap(result=>result.diagnostics.map(item=>({Representative:result.fullName,Rule:item.ruleTitle,Side:item.side,Enabled:item.enabled?'Yes':'No',Value:item.value,Condition:item.condition,Result:item.missing?'MISSING':item.pass?'PASS':'FAIL',OriginalQualifyingCounter:item.rankingVolume,OriginalCounterLabel:item.rankingLabel,NormalizedScore:item.score,Reason:item.reason})));
  if(window.XLSX){ const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Individual Messages'); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(diagnostics),'Rule Diagnostics'); XLSX.writeFile(wb,`qualtrics_individual_message_review_${ymd(new Date())}.xlsx`); }
  else { const headers=Object.keys(rows[0]); const csv=[headers.join(',')].concat(rows.map(row=>headers.map(header=>`"${String(row[header]??'').replace(/"/g,'""')}"`).join(','))).join('\n'); downloadBlob(new Blob([csv],{type:'text/csv'}),`qualtrics_individual_message_review_${ymd(new Date())}.csv`); }
}
function individualEml(result){
  const subject=`Qualtrics Coaching Message — ${result.fullName}`, boundary=`individual_${Date.now()}_${Math.random().toString(36).slice(2)}`, html=result.message.split(/\n{2,}/).map(block=>`<p>${esc(block).replace(/\n/g,'<br>')}</p>`).join('');
  return [`To: ${result.email}`,`Subject: ${subject}`,'MIME-Version: 1.0',`Content-Type: multipart/alternative; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset="UTF-8"','',result.message,'',`--${boundary}`,'Content-Type: text/html; charset="UTF-8"','',`<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#0f172a">${html}</body></html>`,'',`--${boundary}--`].join('\r\n');
}
async function exportIndividualEmails(){
  if(state.individualResultsStale){ toast('Run the Individual Review again before exporting changed selections.'); return; }
  const ready=(state.individualResults||[]).filter(result=>result.sendReady); if(!ready.length){ toast('No send-ready individual messages are available.'); return; }
  if(!window.JSZip){ toast('ZIP export library is unavailable.'); return; }
  const zip=new JSZip(); for(const result of ready) zip.file(`${sanitizeFile(result.fullName)}.eml`,individualEml(result));
  const blob=await zip.generateAsync({type:'blob'}); downloadBlob(blob,`qualtrics_individual_emails_${ymd(new Date())}.zip`); toast(`Exported ${ready.length} reviewed send-ready email file(s). Nothing was sent.`);
}

function bindIndividualMessages(){
  if(!els.individualConcernEnabled) return;
  for(const side of ['concern','strength']){
    const ids=individualSideIds(side);
    for(const id of [ids.enabled,ids.sourceType,ids.operator]) els[id]?.addEventListener('change',()=>{ if(side==='strength'&&id===ids.enabled&&els[id].checked&&!els[ids.source].value&&!els[ids.field].value){ els[ids.sourceType].value=els.individualConcernSourceType.value==='legacy'?'stat':els.individualConcernSourceType.value; els[ids.source].value=els.individualConcernSource.value; els[ids.field].value=els.individualConcernField.value; } updateIndividualRuleVisibility(side); autoSaveRuleEdit(); });
    for(const id of [ids.source,ids.field,ids.threshold,ids.threshold2,ids.message]) els[id]?.addEventListener('input',autoSaveRuleEdit);
  }
  els.addIndividualConcernVariableBtn.onclick=()=>{ const variables=readIndividualVariables('concern'); variables.push({}); renderIndividualVariables('concern',variables); };
  els.addIndividualStrengthVariableBtn.onclick=()=>{ const variables=readIndividualVariables('strength'); variables.push({}); renderIndividualVariables('strength',variables); };
  els.saveIndividualRuleBtn.onclick=async()=>{ const rule=readRuleForm(); await saveRuleObj(rule,{preview:false}); flashBtn(els.saveIndividualRuleBtn); toast('Concern, Strength, messages, and variables saved to this rule.'); };
  els.individualRosterInput.onchange=event=>loadIndividualRoster(event.target.files[0]); els.individualRosterDrop.onclick=event=>{ if(event.target.tagName!=='INPUT') els.individualRosterInput.click(); };
  ['dragenter','dragover'].forEach(name=>els.individualRosterDrop.addEventListener(name,event=>{ event.preventDefault(); els.individualRosterDrop.classList.add('drag'); }));
  ['dragleave','drop'].forEach(name=>els.individualRosterDrop.addEventListener(name,event=>{ event.preventDefault(); els.individualRosterDrop.classList.remove('drag'); }));
  els.individualRosterDrop.addEventListener('drop',event=>loadIndividualRoster(event.dataTransfer.files[0]));
  els.individualReportInput?.addEventListener('change',event=>addIndividualReportFiles(event.target.files));
  els.individualReportDrop?.addEventListener('click',event=>{ if(event.target.tagName!=='INPUT') els.individualReportInput.click(); });
  for(const name of ['dragenter','dragover']) els.individualReportDrop?.addEventListener(name,event=>{ event.preventDefault(); els.individualReportDrop.classList.add('drag'); });
  for(const name of ['dragleave','drop']) els.individualReportDrop?.addEventListener(name,event=>{ event.preventDefault(); els.individualReportDrop.classList.remove('drag'); });
  els.individualReportDrop?.addEventListener('drop',event=>addIndividualReportFiles(event.dataTransfer.files));
  els.loadIndividualRosterPasteBtn.onclick=loadPastedIndividualRoster;
  els.saveIndividualTemplateBtn.onclick=saveIndividualMessageSettings; els.evaluateIndividualsBtn.onclick=evaluateIndividualMessages; els.exportIndividualReviewBtn.onclick=exportIndividualReview; els.exportIndividualEmailsBtn.onclick=exportIndividualEmails;
  els.resetIndividualScopeBtn?.addEventListener('click',resetIndividualScope);
  els.clearIndividualScopeBtn?.addEventListener('click',clearIndividualScope);
  els.selectAllIndividualOrganizationsBtn?.addEventListener('click',selectAllIndividualOrganizations);
  els.clearIndividualOrganizationsBtn?.addEventListener('click',clearIndividualOrganizations);
  els.selectAllIndividualReportsBtn?.addEventListener('click',()=>{ state.individualSelectedReportFileIds=new Set(state.dashboardFiles.filter(file=>file.status!=='error').map(file=>file.id)); invalidateIndividualRunCache('individual report selection changed'); renderIndividualDataSelection(); });
  els.clearIndividualReportsBtn?.addEventListener('click',()=>{ individualReportSelection().clear(); invalidateIndividualRunCache('individual report selection changed'); renderIndividualDataSelection(); });
  els.selectMatchedIndividualRulesBtn?.addEventListener('click',()=>{ const selected=individualRuleSelection(); for(const file of individualSelectedReportFiles()){ const rule=individualRuleForFile(file); if(rule) selected.add(rule.id); } invalidateIndividualRunCache('individual rule selection changed'); renderIndividualDataSelection(); });
  els.clearIndividualRulesBtn?.addEventListener('click',()=>{ individualRuleSelection().clear(); invalidateIndividualRunCache('individual rule selection changed'); renderIndividualDataSelection(); });
  els.clearIndividualDataSelectionBtn?.addEventListener('click',()=>{ individualReportSelection().clear(); individualRuleSelection().clear(); invalidateIndividualRunCache('individual data selections cleared'); renderIndividualDataSelection(); });
  els.individualRuleSearch?.addEventListener('input',renderIndividualRuleOptions);
  els.individualOrganizationSearch?.addEventListener('input',renderIndividualOrganizationOptions);
  els.individualCoachSearch?.addEventListener('input',renderIndividualCoachOptions);
  els.individualRepresentativeSearch?.addEventListener('input',renderIndividualRepresentativeOptions);
  els.cancelIndividualReviewBtn?.addEventListener('click',()=>state.individualReviewRun?.controller?.abort());
  els.expandAllIndividualBtn?.addEventListener('click',()=>{ state.individualCardsExpanded=true; els.individualReview?.querySelectorAll('.individualReviewCard').forEach(card=>card.open=true); });
  els.collapseAllIndividualBtn?.addEventListener('click',()=>{ state.individualCardsExpanded=false; els.individualReview?.querySelectorAll('.individualReviewCard').forEach(card=>card.open=false); });
  for(const id of ['individualIncludeGeneric','individualGenericPlacement','individualIncludeNeither']) els[id]?.addEventListener('change',()=>{ updateIndividualGenericVisibility(); invalidateIndividualRunCache('message options changed'); });
  for(const id of ['individualTemplateHeader','individualConcernHeading','individualStrengthHeading','individualTemplateFooter','individualGenericMessage','individualMaxConcerns','individualMaxStrengths']) els[id]?.addEventListener('input',()=>invalidateIndividualRunCache('message options changed'));
  for(const id of ['individualResultFilter','individualResultCoach','individualResultOrganization','individualViewMode']) els[id]?.addEventListener('change',()=>{ state.individualRenderLimit=80; renderIndividualReview(); });
  let searchFrame=0; els.individualResultSearch.addEventListener('input',()=>{ cancelAnimationFrame(searchFrame); searchFrame=requestAnimationFrame(()=>{ state.individualRenderLimit=80; renderIndividualReview(); }); });
}
