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
  return QualtricsIndividualMessages.normalizeTemplate({header:els.individualTemplateHeader?.value,concernHeading:els.individualConcernHeading?.value,strengthHeading:els.individualStrengthHeading?.value,footer:els.individualTemplateFooter?.value,includeNeither:!!els.individualIncludeNeither?.checked});
}
function fillIndividualTemplateForm(template){
  template=QualtricsIndividualMessages.normalizeTemplate(template);
  if(els.individualTemplateHeader) els.individualTemplateHeader.value=template.header;
  if(els.individualConcernHeading) els.individualConcernHeading.value=template.concernHeading;
  if(els.individualStrengthHeading) els.individualStrengthHeading.value=template.strengthHeading;
  if(els.individualTemplateFooter) els.individualTemplateFooter.value=template.footer;
  if(els.individualIncludeNeither) els.individualIncludeNeither.checked=template.includeNeither;
  state.individualTemplate=template;
}
async function loadIndividualMessageSettings(){
  const rows=await getAll(STORES.settings), saved=rows.find(row=>row.key===INDIVIDUAL_SETTINGS_KEY);
  fillIndividualTemplateForm(saved?.template||QualtricsIndividualMessages.DEFAULT_TEMPLATE);
}
async function saveIndividualMessageSettings(){
  state.individualTemplate=individualTemplateFromForm();
  await put(STORES.settings,{key:INDIVIDUAL_SETTINGS_KEY,template:state.individualTemplate,updatedAt:new Date().toISOString()});
  toast('Individual message wrapper saved locally.');
}

function individualAddRepresentative(map,rawName,repK,extra={}){
  const name=displayName(rawName); if(!name) return;
  const ident=repK?{key:repK,name}:{...resolveIdentity(name)}; if(!ident.key) return;
  const current=map.get(ident.key)||{repKey:ident.key,fullName:ident.name||name,coach:'',team:''};
  if(!current.fullName||current.fullName.split(' ').length<name.split(' ').length) current.fullName=ident.name||name;
  if(extra.coach&&!current.coach) current.coach=canonicalCoachName(extra.coach);
  if(extra.team&&!current.team) current.team=canonicalTeamName(extra.team);
  map.set(ident.key,current);
}
function individualRepresentativeCatalog(){
  const map=new Map();
  for(const [repK,item] of state.teamMap||[]) individualAddRepresentative(map,item.name||state.fullNameByKey?.get(repK)||repK,repK,item);
  for(const rows of [state.weeklyStatsRows,state.qaRows,state.coachingRows,state.checklistRows]) for(const row of rows||[]) individualAddRepresentative(map,row.name||row.rawName,row.repKey||row.key,{coach:row.coach||row.rawCoach,team:row.team||row.rawTeam});
  for(const file of state.dashboardFiles||[]){
    const rule=state.rules.find(item=>item.id===file.ruleId)||matchRuleForFile(file.fileName);
    for(const row of file.rows||[]){ const rawName=rule?getAgentFromRow(row,rule):String(rowVal(row,['Agent Name','Associate Name','Representative','Rep','Name'])||''); if(!rawName) continue; const ident=resolveIdentityFromRow(row,rawName); individualAddRepresentative(map,ident.name,ident.key,{coach:rowVal(row,['Coach','Manager','Supervisor','Job Coach']),team:rowVal(row,['Team','Sheet','Team Name'])}); }
  }
  return [...map.values()].sort((a,b)=>a.fullName.localeCompare(b.fullName));
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
function individualDashboardRowsFor(rep,rule){
  const preferred=(state.dashboardFiles||[]).filter(file=>file.ruleId===rule.id||matchRuleForFile(file.fileName)?.id===rule.id), files=preferred.length?preferred:(state.dashboardFiles||[]), rows=[];
  for(const file of files){ const fileRule=state.rules.find(item=>item.id===file.ruleId)||matchRuleForFile(file.fileName)||rule; for(const raw of file.rows||[]){ const rawName=getAgentFromRow(raw,fileRule); if(!rawName) continue; const ident=resolveIdentityFromRow(raw,rawName); if(ident.key===rep.repKey) rows.push({raw,file,fileRule}); } }
  return rows;
}
function individualReportObservation(rep,field,rule){
  const rows=individualDashboardRowsFor(rep,rule); let selected=null, header='';
  for(const item of rows){ header=findHeader(Object.keys(item.raw||{}),[field]); if(header){ selected=item.raw[header]; break; } }
  if(selected==null||String(selected).trim()===''){
    for(const sourceRows of [state.weeklyStatsRows,state.qaRows,state.coachingRows,state.checklistRows]){
      const item=(sourceRows||[]).find(row=>(row.repKey||row.key)===rep.repKey&&findHeader(Object.keys(row.raw||{}),[field]));
      if(!item) continue; header=findHeader(Object.keys(item.raw||{}),[field]); selected=item.raw[header]; if(selected!=null&&String(selected).trim()!=='') break;
    }
  }
  if(selected==null||String(selected).trim()==='') return {missing:true,label:field||'Report field',reason:`Report field ${field||'(not selected)'} is missing`};
  const isPercent=isPercentHeader(header)||hasPercentSign(selected), value=numberForComparison(selected,header,isPercent), numericValue=isFinite(value)?value:NaN;
  return {missing:false,value:numericValue,raw:selected,formatted:formatValueForHeader(header,selected)||String(selected),label:header||field,source:'Report field',isPercent};
}
function individualLegacyObservation(rep,rule,reportDate,cache){
  if(!cache.has(rule.id)){
    const map=new Map(), add=(base,observation)=>{ if(base?.repKey) map.set(base.repKey,Object.assign({missing:false,matched:true,label:rule.title,score:1},observation||{})); };
    if(isStatRule(rule)) for(const repItem of individualRepresentativeCatalog()){ const check=evaluateStatRuleForRep(repItem.repKey,rule.statRule,reportDate); if(check.meets) add(repItem,{value:check.avg,raw:check.avg,formatted:formatMetricValue(check.label,check.avg),label:check.label,isPercent:isPercentHeader(check.label),score:(check.pctLow||0)*100}); }
    else if(isStatCountRule(rule)) for(const base of buildStatCountRecords(rule,reportDate)) add(base,{value:base.count,raw:base.count,formatted:String(base.count),label:rule.statCount?.label||rule.title,score:base.count});
    else if(isCoachingCorrectiveRule(rule)) for(const base of buildCoachingCorrectiveRecords(rule,reportDate)) add(base,{value:base.ratio,raw:base.ratio,formatted:isFinite(base.ratio)?fmtNum(base.ratio,2):String(base.coachings?.length||0),label:rule.title,score:base.coachings?.length||1});
    else if(isHeaderCountRule(rule)){
      const sources=(state.dashboardFiles||[]).filter(file=>file.ruleId===rule.id||matchRuleForFile(file.fileName)?.id===rule.id).map(file=>({name:file.fileName,rows:file.rows||[]}));
      for(const base of buildHeaderCountRecords(rule,sources).records) add(base,{value:base.count,raw:base.count,formatted:String(base.count),label:rule.countRule?.label||rule.title,score:base.count});
    }else{
      for(const file of (state.dashboardFiles||[]).filter(file=>file.ruleId===rule.id||matchRuleForFile(file.fileName)?.id===rule.id)) for(const raw of file.rows||[]){
        if(!rowMeetsRule(raw,rule)) continue; const rawName=getAgentFromRow(raw,rule); if(!rawName) continue; const ident=resolveIdentityFromRow(raw,rawName); const field=rule.displayColumn?.enabled?rule.displayColumn.header:(rule.criteria?.[0]?.header||''); const value=field?raw[field]:rule.title;
        add({repKey:ident.key},{value:numberForComparison(value,field,isPercentHeader(field)||hasPercentSign(value)),raw:value,formatted:field?formatValueForHeader(field,value):String(value),label:field||rule.title,isPercent:isPercentHeader(field),score:1});
      }
    }
    cache.set(rule.id,map);
  }
  return cache.get(rule.id).get(rep.repKey)||{missing:false,matched:false,label:rule.title,raw:'',formatted:'',score:0,reason:'Existing rule did not identify this representative'};
}
function createIndividualResolver(reportDate){
  const legacyCache=new Map();
  return {
    resolveObservation(rep,side,rule){
      if(side.sourceType==='legacy') return individualLegacyObservation(rep,rule,reportDate,legacyCache);
      if(side.sourceType==='reportField') return individualReportObservation(rep,side.field,rule);
      return individualStatObservation(rep,side.source,reportDate);
    },
    resolveVariable(rep,variable,rule){
      return variable.sourceType==='reportField'?individualReportObservation(rep,variable.field||variable.source,rule):individualStatObservation(rep,variable.source,reportDate);
    }
  };
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
    state.individualRosterRows=choices[0].sheet.rows||[]; state.individualRosterFileName=file.name; state.individualResults=[]; state.individualEvaluation=null; renderIndividualRosterStatus(); renderIndividualSummary(); renderIndividualReview();
    setStatus(`Loaded ${state.individualRosterRows.length.toLocaleString()} representative roster row(s). Nothing was sent.`);
  }catch(error){ console.error(error); toast(`Roster could not be loaded: ${error.message||error}`); }
  finally{ if(els.individualRosterInput) els.individualRosterInput.value=''; }
}
function loadPastedIndividualRoster(){
  try{
    const text=els.individualRosterPaste?.value||'', aoa=parseDelimitedText(text); if(aoa.length<2) throw new Error('Paste a header row and at least one representative row.');
    const parsed=aoaToRows(aoa,0), first=findHeader(parsed.headers,['First Name','FirstName']), last=findHeader(parsed.headers,['Last Name','LastName','Surname']), email=findHeader(parsed.headers,['Username','User Name','Email','Email Address']);
    if(!first||!last||!email) throw new Error('Pasted rows must include First Name, Last Name, and Username columns.');
    state.individualRosterRows=parsed.rows; state.individualRosterFileName='Pasted roster'; state.individualResults=[]; state.individualEvaluation=null; renderIndividualRosterStatus(); renderIndividualSummary(); renderIndividualReview();
    setStatus(`Loaded ${parsed.rows.length.toLocaleString()} pasted representative roster row(s). Nothing was sent.`);
  }catch(error){ toast(`Pasted roster could not be loaded: ${error.message||error}`); }
}
function evaluateIndividualMessages(){
  if(!state.individualRosterRows?.length){ toast('Load the representative email roster first.'); return; }
  const representatives=individualRepresentativeCatalog(); if(!representatives.length){ toast('Load report or key-file data with representative names first.'); return; }
  state.individualTemplate=individualTemplateFromForm();
  state.individualEvaluation=QualtricsIndividualMessages.evaluateAll({representatives,rules:state.rules,rosterRows:state.individualRosterRows,resolver:createIndividualResolver(parseDate(els.reportDate?.value)||new Date()),template:state.individualTemplate});
  state.individualResults=state.individualEvaluation.results; renderIndividualSummary(); renderIndividualReview();
  const summary=state.individualEvaluation.summary; setStatus(`Evaluated ${summary.evaluated.toLocaleString()} representatives: ${summary.ready.toLocaleString()} send ready. Nothing was sent.`);
}
function renderIndividualSummary(){
  if(!els.individualSummary) return;
  const summary=state.individualEvaluation?.summary;
  if(!summary){ els.individualSummary.innerHTML='<div class="empty">Load a roster, configure rule outcomes, and evaluate individuals.</div>'; return; }
  const tiles=[['Evaluated',summary.evaluated,'all',''],['Email matches',summary.matched,'all','good'],['Ready',summary.ready,'ready','good'],['Unmatched',summary.unmatched,'missingEmail',summary.unmatched?'warn':'good'],['Ambiguous',summary.ambiguous,'ambiguous',summary.ambiguous?'bad':'good'],['Concern + Strength',summary.both,'both',''],['No behavior',summary.neither,'neither',''],['Template errors',summary.templateErrors,'templateError',summary.templateErrors?'bad':'good']];
  els.individualSummary.innerHTML=tiles.map(([label,count,filter,cls])=>`<button type="button" class="individualSummaryTile ${cls}" data-individual-summary-filter="${filter}"><strong>${count.toLocaleString()}</strong><span>${esc(label)}</span></button>`).join('');
  els.individualSummary.querySelectorAll('[data-individual-summary-filter]').forEach(button=>button.onclick=()=>{ els.individualResultFilter.value=button.dataset.individualSummaryFilter; renderIndividualReview(); });
}
function individualDiagnosticHtml(result){
  return `<div class="individualDiagnostics">${result.diagnostics.map(item=>`<div class="individualDiagnostic ${item.pass?'pass':'fail'}"><strong>${esc(item.ruleTitle)} — ${esc(item.side[0].toUpperCase()+item.side.slice(1))}</strong><div class="mini">Value: ${esc(item.value||'N/A')} • Condition: ${esc(item.condition)} • Result: ${item.enabled?(item.missing?'MISSING':item.pass?'PASS':'FAIL'):'DISABLED'}${item.pass?` • Normalized score: ${Number(item.score).toFixed(2)}`:''}</div><div class="mini muted">${esc(item.reason||'')}</div></div>`).join('')}</div>`;
}
function individualMatchHtml(result){
  const match=result.emailMatch, possible=(match.matches||[]).map(item=>`<span>${esc(item.fullName)} — ${esc(item.email||'no Username')}</span>`).join('');
  return `<div class="individualMatchList"><span>Input: ${esc(result.fullName)}</span><span>Normalized: ${esc(match.normalizedName)}</span><span>Status: ${esc(match.status)}</span>${possible||'<span>No roster match</span>'}</div>`;
}
function renderIndividualReview(){
  if(!els.individualReview) return;
  const results=state.individualResults||[]; if(!results.length){ els.individualReview.innerHTML='<div class="empty">No individual evaluation has been run.</div>'; return; }
  const filter=els.individualResultFilter?.value||'all', q=norm(els.individualResultSearch?.value||'');
  const shown=results.filter(result=>QualtricsIndividualMessages.filterResult(result,filter)).filter(result=>!q||norm(`${result.fullName} ${result.email} ${result.concern?.title||''} ${result.strength?.title||''} ${result.status}`).includes(q));
  els.individualReview.innerHTML=`<div class="row" style="margin-bottom:9px"><strong>${shown.length.toLocaleString()} of ${results.length.toLocaleString()} representatives shown</strong><span class="spacer"></span><span class="sub">Only Ready rows are included in send-ready exports.</span></div><div class="tableWrap"><table><thead><tr><th>Representative</th><th>Email</th><th>Concern</th><th>Concern Value</th><th>Strength</th><th>Strength Value</th><th>Status</th><th>Preview &amp; Diagnostics</th></tr></thead><tbody>${shown.map(result=>`<tr><td><strong>${esc(result.fullName)}</strong><div class="mini muted">${esc(result.coach||'')}</div></td><td>${esc(result.email||'—')}${individualMatchHtml(result)}</td><td>${esc(result.concern?.title||'No qualifying concern')}</td><td>${esc(result.concern?QualtricsIndividualMessages.formatValue(result.concern.observation,'raw',result.concern.observation?.isPercent):'—')}</td><td>${esc(result.strength?.title||'No qualifying strength')}</td><td>${esc(result.strength?QualtricsIndividualMessages.formatValue(result.strength.observation,'raw',result.strength.observation?.isPercent):'—')}</td><td><strong class="${result.sendReady?'statusReady':'statusBlocked'}">${esc(result.status)}</strong>${result.errors.length?`<div class="mini dangerText">${result.errors.map(esc).join('<br>')}</div>`:''}</td><td><details><summary>Preview exact message</summary><div class="individualMessagePreview">${esc(result.message||'No message generated.')}</div><div class="note" style="margin-top:8px"><strong>Selected Concern:</strong> ${esc(result.concern?.title||'None')} — ${esc(result.selectionReason.concern)}<br><strong>Selected Strength:</strong> ${esc(result.strength?.title||'None')} — ${esc(result.selectionReason.strength)}</div>${individualDiagnosticHtml(result)}</details></td></tr>`).join('')||'<tr><td colspan="8">No representatives match this filter.</td></tr>'}</tbody></table></div>`;
}
function individualExportRows(){
  return (state.individualResults||[]).map(result=>({Representative:result.fullName,Email:result.email,Concern:result.concern?.title||'',ConcernValue:result.concern?QualtricsIndividualMessages.formatValue(result.concern.observation,'raw',result.concern.observation?.isPercent):'',Strength:result.strength?.title||'',StrengthValue:result.strength?QualtricsIndividualMessages.formatValue(result.strength.observation,'raw',result.strength.observation?.isPercent):'',Status:result.status,SendReady:result.sendReady?'Yes':'No',Message:result.message,Errors:result.errors.join(' | '),MatchStatus:result.emailMatch.status,NormalizedName:result.emailMatch.normalizedName}));
}
function exportIndividualReview(){
  const rows=individualExportRows(); if(!rows.length){ toast('Evaluate individuals before exporting the review.'); return; }
  const diagnostics=(state.individualResults||[]).flatMap(result=>result.diagnostics.map(item=>({Representative:result.fullName,Rule:item.ruleTitle,Side:item.side,Enabled:item.enabled?'Yes':'No',Value:item.value,Condition:item.condition,Result:item.missing?'MISSING':item.pass?'PASS':'FAIL',NormalizedScore:item.score,Reason:item.reason})));
  if(window.XLSX){ const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Individual Messages'); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(diagnostics),'Rule Diagnostics'); XLSX.writeFile(wb,`qualtrics_individual_message_review_${ymd(new Date())}.xlsx`); }
  else { const headers=Object.keys(rows[0]); const csv=[headers.join(',')].concat(rows.map(row=>headers.map(header=>`"${String(row[header]??'').replace(/"/g,'""')}"`).join(','))).join('\n'); downloadBlob(new Blob([csv],{type:'text/csv'}),`qualtrics_individual_message_review_${ymd(new Date())}.csv`); }
}
function individualEml(result){
  const subject=`Qualtrics Coaching Message — ${result.fullName}`, boundary=`individual_${Date.now()}_${Math.random().toString(36).slice(2)}`, html=result.message.split(/\n{2,}/).map(block=>`<p>${esc(block).replace(/\n/g,'<br>')}</p>`).join('');
  return [`To: ${result.email}`,`Subject: ${subject}`,'MIME-Version: 1.0',`Content-Type: multipart/alternative; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset="UTF-8"','',result.message,'',`--${boundary}`,'Content-Type: text/html; charset="UTF-8"','',`<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#0f172a">${html}</body></html>`,'',`--${boundary}--`].join('\r\n');
}
async function exportIndividualEmails(){
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
  els.loadIndividualRosterPasteBtn.onclick=loadPastedIndividualRoster;
  els.saveIndividualTemplateBtn.onclick=saveIndividualMessageSettings; els.evaluateIndividualsBtn.onclick=evaluateIndividualMessages; els.exportIndividualReviewBtn.onclick=exportIndividualReview; els.exportIndividualEmailsBtn.onclick=exportIndividualEmails;
  els.individualResultFilter.onchange=renderIndividualReview; els.individualResultSearch.addEventListener('input',renderIndividualReview);
}
