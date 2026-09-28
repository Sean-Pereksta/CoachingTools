/* Organization-only diagnostics. The shared Research evaluator owns all results.
 * No saved Research definition, mapping, roster, or rendered result is written here.
 */
'use strict';
const ORG_READINESS_SETTINGS_KEY='allStar.orgReadiness.v1';
let orgReadinessOperation=null, orgReadinessSnapshot=null, orgReadinessSequence=0;
function orgReadinessSettings(orgId,itemId){
  try{ return JSON.parse(localStorage.getItem(ORG_READINESS_SETTINGS_KEY)||'{}')[orgId]?.[itemId]||{}; }catch(_){ return {}; }
}
function saveOrgReadinessSettings(orgId,itemId,patch){
  let all={}; try{ all=JSON.parse(localStorage.getItem(ORG_READINESS_SETTINGS_KEY)||'{}')||{}; }catch(_){}
  all[orgId]=all[orgId]||{}; all[orgId][itemId]={...all[orgId][itemId],...patch};
  localStorage.setItem(ORG_READINESS_SETTINGS_KEY,JSON.stringify(all));
  invalidateOrgReadiness('Organization validation settings changed');
}
function orgReadinessSignature(org,item){
  if(!org||!item) return '';
  return stableSerialize({org,item:{...item,renderedResult:null},key:researchItemCacheKey(item,'agg'),versions:state.versions,sourceMeta:state.sourceMeta,settings:orgReadinessSettings(org.id,item.id),qaDateMode:els.runQADateSelect?.value||'interaction'});
}
function invalidateOrgReadiness(reason='Inputs changed'){
  if(orgReadinessOperation) orgReadinessOperation.cancelled=true;
  orgReadinessSnapshot=null;
  const output=document.getElementById('orgReadinessResults'), status=document.getElementById('orgReadinessStatus');
  if(output) output.replaceChildren();
  if(status){ status.className='orgReadinessStatus'; status.textContent=reason+'. Check Research Setup to validate the current inputs.'; }
}
function renderOrgReadinessControls(){
  const org=activeOrg(), select=document.getElementById('orgResearchSelect'); if(!select) return;
  const selected=state.orgResearchItemId||select.value, items=state.researchItems||[];
  select.innerHTML='<option value="">Select a saved Research item…</option>'+items.map(item=>`<option value="${esc(item.id)}">${esc(item.title||'Research Item')}</option>`).join('');
  select.value=items.some(item=>item.id===selected)?selected:''; state.orgResearchItemId=select.value;
  const item=items.find(x=>x.id===select.value), intent=document.getElementById('orgPeriodIntent');
  intent.value=orgReadinessSettings(org?.id,item?.id).periodIntent||'same';
  document.getElementById('orgCheckResearchBtn').disabled=!org||!item||!!(orgReadinessOperation&&!orgReadinessOperation.cancelled);
  document.getElementById('orgEditResearchBtn').disabled=!item;
  const footerSave=document.getElementById('orgSaveFootBtn');if(footerSave)footerSave.onclick=()=>els.saveOrgBtn?.click();
  document.querySelectorAll('[data-org-tab]').forEach(button=>{
    const active=button.dataset.orgTab===(state.orgWorkspaceTab||'members');
    button.setAttribute('aria-selected',String(active)); button.tabIndex=active?0:-1;
    button.onclick=()=>{state.orgWorkspaceTab=button.dataset.orgTab;renderOrgReadinessControls();};
    button.onkeydown=event=>{ if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); state.orgWorkspaceTab=event.key==='Home'?'members':event.key==='End'?'readiness':active&&button.dataset.orgTab==='members'?'readiness':'members'; renderOrgReadinessControls(); document.querySelector('[data-org-tab][aria-selected="true"]')?.focus(); };
  });
  document.getElementById('orgMembersPanel').classList.toggle('hidden',state.orgWorkspaceTab==='readiness');
  document.getElementById('orgReadinessPanel').classList.toggle('hidden',state.orgWorkspaceTab!=='readiness');
  select.onchange=()=>{state.orgResearchItemId=select.value;invalidateOrgReadiness('Research selection changed');renderOrgReadinessControls();};
  intent.onchange=()=>{if(org&&item)saveOrgReadinessSettings(org.id,item.id,{periodIntent:intent.value});};
  document.getElementById('orgCheckResearchBtn').onclick=checkOrgResearchSetup;
  document.getElementById('orgEditResearchBtn').onclick=()=>{if(item)openResearchItemEditor(item.id);};
  if(orgReadinessSnapshot&&orgReadinessSnapshot.signature!==orgReadinessSignature(org,item)) invalidateOrgReadiness('Inputs changed');
}
function orgReadinessStage(label,rows,source){
  const readers=researchCohortIdentityReaders(source), keys=researchCohortKeys(rows,source), unnamed=rows.filter(row=>!readers.rep(row)).length;
  return {label,records:rows.length,reps:keys.reps.size,unidentified:unnamed};
}
function orgReadinessDateField(source,item){
  if(source===item.source) return item.dateColumn||'';
  if(source==='qa'||source===QA_DIRECT_SOURCE){
    const assigned=(els.runQADateSelect?.value||'interaction')==='assigned', columns=getSourceSetting(activeModelForImport(),'qa').columns||{};
    return findHeaderFromExpected(getHeaders('qa')||[],assigned?columns.assignedDate:columns.interactionDate,assigned?['Assigned Date','Date Assigned','Assignment Date']:['Interaction Start Time','Interaction start Time','Interaction Start','Start Time'])||(assigned?'_assignedDate':'_interactionDate');
  }
  return researchDefaultDateColumn({source});
}
function orgReadinessSourceAudit(source,item,baseRows,settings){
  const rows=getResearchSourceRows(source), config=settings.sources?.[source]||{}, meta=state.sourceMeta?.[source]||{};
  const area=source.startsWith('retail_')?'retail':source.startsWith('referral_')?'referral':'';
  const monthly=area&&state.data[area]?.monthlySummary?.period;
  const period=(meta.monthlyPeriod||rows.some(r=>r._monthly))&&monthly?{start:monthly.start,end:monthly.end}:config.kind==='period'?{start:config.start||'',end:config.end||''}:null;
  const dateField=orgReadinessDateField(source,item), dates=[], missing=[], invalid=[];
  for(const row of rows){
    const raw=dateField?(source!==item.source&&(source==='qa'||source===QA_DIRECT_SOURCE)?qaDateFromRow(row,els.runQADateSelect?.value||'interaction'):researchFieldValue(row,dateField,source)):'';
    if(!String(raw??'').trim()){missing.push(row);continue;}
    const parsed=parseDateOnly(raw); if(parsed) dates.push({row,date:ymd(parsed)}); else invalid.push(row);
  }
  const sorted=dates.map(x=>x.date).sort(), window=!!(item.startDate||item.endDate);
  const confirmed=dates.filter(x=>(!item.startDate||x.date>=item.startDate)&&(!item.endDate||x.date<=item.endDate));
  const kind=period?'period':config.kind==='static'?'static':dateField?(missing.length||invalid.length?'mixed':'dated'):'unknown';
  const primaryAmbiguities=source===item.source?researchCohortIdentityIndex(source,'rep').ambiguities:null;
  const joined=source===item.source?{rows:baseRows,missingRepIdentities:[],missingCoachIdentities:[],ambiguityDetails:[...researchCohortKeys(baseRows,source).reps].filter(key=>primaryAmbiguities?.has(key)).map(key=>({identity:key,...primaryAmbiguities.get(key)})),fallbackRows:0,joinMode:'primary'}:resolveRowsForCohort(source,{rows:baseRows,baseRows,baseSource:item.source,item});
  const used=source===item.source?baseRows:researchRowsForCohort(source,baseRows,item.source,item);
  const usedSet=new Set(used), unconfirmedRetained=window?[...missing,...invalid].filter(r=>usedSet.has(r)).length:0;
  const repeats=new Map(); for(const row of used){ const key=researchCohortIdentityReaders(source).rep(row); if(key)repeats.set(key,(repeats.get(key)||0)+1); }
  const duplicateIdentities=[...repeats].filter(([,n])=>n>1).length;
  const issues=[], label=labelSource(source)||source;
  const periodGrain=isCustomWeeklyStatSource(source)?customSource(source)?.columns?.statPeriod:'';
  if(periodGrain&&periodGrain!=='day')issues.push({level:'attention',text:`${label}: rows represent ${periodGrain} totals. The mapped date/week is a period label, not an individual observation date; filtering selects entire records, not prorated totals.`});
  if(source!==item.source&&(researchGroupDateField(item)||(item.useSecondaryGroup&&researchFieldNameLooksDate(item,item.secondaryGroupField))))issues.push({level:'blocking',text:`${label}: cross-source matching uses the item-wide window, not each output date bucket. The same source total can repeat across buckets. This setup cannot certify period-by-period results.`});
  const conditionWindows=(item.guidedConditions||[]).filter(c=>!c.expression&&c.operator==='date_between'&&parseDateOnly(c.value)&&parseDateOnly(c.value2)).map(c=>({source:c.source||item.source,field:c.field,start:ymd(parseDateOnly(c.value)),end:ymd(parseDateOnly(c.value2))}));
  if(period)for(const condition of conditionWindows)if(condition.start!==period.start||condition.end!==period.end)issues.push({level:settings.periodIntent==='mixed'?'attention':'blocking',text:`${label} uses ${period.start||'?'}–${period.end||'?'}, while the ${labelSource(condition.source)} condition on ${condition.field} requires ${condition.start}–${condition.end}. This is a mixed-period comparison, not weekly performance evidence.`});
  if(!rows.length) issues.push({level:'blocking',text:`${label}: no imported records are available.`});
  if(kind==='unknown') issues.push({level:window?'blocking':'attention',text:`${label}: no established observation date or reporting period. Upload dates, filenames and hire dates are not substituted.`});
  if(config.kind==='static'&&dateField) issues.push({level:'attention',text:`${label}: declared static reference data; the existing engine still uses ${dateField} where applicable. This declaration does not change filtering.`});
  if(kind==='static') issues.push({level:'attention',text:`${label}: static reference information supports membership or matching, not dated performance evidence. Verify that the item uses it in that role.`});
  if(dateField&&/hire|upload|import/i.test(dateField)) issues.push({level:'blocking',text:`${label}: the saved date field is ${dateField}; it does not establish the observation period. Review that mapping in the existing editor.`});
  if(missing.length+invalid.length&&dateField) issues.push({level:unconfirmedRetained?'blocking':'attention',text:`${label}: ${missing.length} missing and ${invalid.length} invalid dates; ${unconfirmedRetained} such rows remain in the matched calculation population. They are not confirmed to be in the requested window.`});
  if(period){
    const known=period.start&&period.end;
    if(!known) issues.push({level:'blocking',text:`${label}: period totals have no complete reporting period declaration.`});
    else if(window&&(period.start!==item.startDate||period.end!==item.endDate)) issues.push({level:settings.periodIntent==='mixed'?'attention':'blocking',text:`${label} uses the full ${period.start}–${period.end} reporting period; the Research window is ${item.startDate||'open start'}–${item.endDate||'open end'}. This is a mixed-period comparison, not a result for that narrower window. Totals are not allocated across dates.`});
    if(item.dateGrouping&&item.dateGrouping!=='other'&&(item.groupField===dateField||item.groupMultiAdd)) issues.push({level:'blocking',text:`${label}: undated period totals cannot establish values for individual date buckets.`});
  }
  if(meta.monthlyPartial) issues.push({level:'attention',text:`${label}: the monthly import is marked partial.`});
  if(window&&kind==='dated'&&(!confirmed.length||sorted[0]>item.startDate||sorted[sorted.length-1]<item.endDate)) issues.push({level:'attention',text:`${label}: observed date coverage does not establish complete coverage of the requested window.`});
  if(joined.missingRepIdentities.length||joined.missingCoachIdentities.length) issues.push({level:'attention',text:`${label}: ${joined.missingRepIdentities.length} unmatched representatives and ${joined.missingCoachIdentities.length} unmatched teams. Missing matches mean no matching data available.`});
  if(joined.ambiguityDetails?.length) issues.push({level:'blocking',text:`${label}: matching identities have conflicting IDs or team assignments; the engine retains all matching rows.`});
  if(joined.fallbackRows) issues.push({level:'attention',text:`${label}: ${joined.fallbackRows} rows came from the saved team fallback. They do not establish individual evidence.`});
  if(window&&dateField&&!period&&used.some(row=>{const d=parseDateOnly(researchFieldValue(row,dateField,source));return d&&((item.startDate&&ymd(d)<item.startDate)||(item.endDate&&ymd(d)>item.endDate));})) issues.push({level:'blocking',text:`${label}: the existing cross-source path retains dated rows outside the requested window. This diagnostic does not change that calculation.`});
  return {source,label,role:researchSourceUsageLabels(item,source).join(', '),kind,dateField,period,available:sorted.length?`${sorted[0]}–${sorted[sorted.length-1]}`:'Not established',requested:(window?`${item.startDate||'open start'}–${item.endDate||'open end'}`:'All available data')+conditionWindows.filter(c=>c.source===source).map(c=>`\nCondition on ${c.field}: ${c.start}–${c.end}`).join(''),records:rows.length,dated:dates.length,missing:missing.length,invalid:invalid.length,confirmed:dateField?confirmed.length:null,used:used.length,usedReps:researchCohortKeys(used,source).reps.size,unconfirmedRetained,duplicateIdentities,joined:{...joined,rows:undefined},issues,complete:config.complete===true&&!meta.monthlyPartial&&kind==='dated'&&!!config.start&&!!config.end&&(!item.startDate||config.start<=item.startDate)&&(!item.endDate||config.end>=item.endDate)};
}
function orgReadinessInput(raw,aggregation,item,rows,warnings){
  const sourceRef=parseResearchSourceFieldRef(raw), metric=findMetricByNameOrId(raw)||findMetricByRef(raw), model=parseModelRef(raw)||findModelCriterionReferenceByName(raw);
  let source=item.source,field=raw,kind='Field';
  if(sourceRef){source=sourceRef.source;field=sourceRef.field;}
  else if(metric){source=metric.source;field=metric.field;kind='Saved metric';}
  else if(model){kind=item.modelEntityKind==='team'?'Team model criteria':'Representative model criteria aggregated over this group';field=raw;}
  else {const direct=resolveResearchExpressionField(raw,item);const inferred=direct?null:researchBestSourceForHeader(raw,item.source,rows,item);field=direct||inferred?.field||raw;source=inferred?.source||item.source;}
  if(!metric&&!model&&(!source||!getResearchHeaders(source).includes(resolveColumn(source,field))))warnings.push(`Missing header: ${labelSource(source)||source} / ${field}`);
  const matches=allSourceKeys().filter(src=>getResearchHeaders(src).includes(field));
  if(!sourceRef&&!metric&&!model&&matches.length>1) warnings.push(`Unqualified header "${field}" appears in ${matches.map(labelSource).join(', ')}. The current resolver selects ${labelSource(source)}.`);
  const scoped=source===item.source?rows:researchRowsForCohort(source,rows,item.source,item);
  const used=metric?metricRows(metric,scoped,source,warnings):scoped;
  const values=field&&!model?used.map(researchFieldReader(field,source)):[];
  const populated=values.filter(v=>String(v??'').trim()!==''), usable=populated.filter(v=>Number.isFinite(toNum(v)));
  const percentText=populated.filter(v=>String(v).includes('%')).length;
  const percentNote=percentText?`${percentText} percentage strings. Existing numeric coercion strips %: 40% → 40; 0.40 stays 0.40. No automatic unit correction.`:'0.40 stays 0.40; 40 stays 40. No unit conversion is inferred from numeric size.';
  if(percentText&&usable.some(v=>!String(v).includes('%')&&Math.abs(toNum(v))>0&&Math.abs(toNum(v))<1))warnings.push(`${raw}: fractional values and percentage strings coexist. Verify units before interpreting this result.`);
  return {raw,source,field,kind,aggregation:metric?metric.mode:aggregation,records:used.length,baseRecords:scoped.length,qualifiedEmpty:!!metric&&scoped.length>0&&!used.length&&['count','percent','percent_total','percent_parent','percent_item'].includes(metric.mode),usable:model?null:usable.length,missing:model?null:values.length-populated.length,units:percentNote,sample:populated.slice(0,3).map(String),model:!!model};
}
function orgReadinessCell(item,rows,col,value,ctx,warnings){
  const mode=col.mode||item.valueMode||'count', field=col.field||item.valueField||'', inputs=[], local=[];
  const typed=researchTypedMeasureDefinition(col.measureId||researchMeasureIdFromRef(field)||item.measureId), resolved=typed?resolveResearchTypedMeasure(typed,item.source):null;
  if(col._level2Field&&!typed&&!findMetricByRef(field)&&!parseModelRef(field))rows=rows.filter(r=>String(researchFieldValue(r,col._level2Field,item.source)??'(blank)')===String(col._level2Value));
  let trace={lines:[],numerator:null,denominator:null}, semantics=mode;
  if(typed&&resolved?.compatible){
    const stats=researchTypedMeasureStats(resolved,rows,item,col.missingBehavior||item.missingBehavior);
    trace=researchTraceCalculation(item,rows,col,value,ctx); semantics=resolved.aggregation==='weighted_rate'?'Ratio of totals × 100 (percentage points)':resolved.aggregation;
    for(const f of [resolved.numeratorField,resolved.denominatorField,resolved.valueField].filter(Boolean)) inputs.push(orgReadinessInput(`![${resolved.source}].[${f}]`,resolved.aggregation,item,rows,local));
    if(resolved.aggregation==='weighted_rate'&&(!stats.denominator||stats.missingDenominator)) local.push('Cannot validate this percentage: zero or missing denominator inputs.');
  }else if(mode==='expression'){
    const expression=normalizeResearchLooseSourceReferences(field);
    replaceResearchAggregateReferences(expression,item,rows,local,entry=>{const input=orgReadinessInput(entry.raw,entry.aggregation,item,rows,local);input.value=entry.value;inputs.push(input);});
    semantics='Aggregate expression: bare numeric fields resolve as sums; avg(field) averages source values. No average of individual ratios is substituted.';
    if(value==null||value===''||typeof value==='number'&&!Number.isFinite(value))local.push('Expression did not return a usable value.');
  }else{
    if(field)inputs.push(orgReadinessInput(field,mode,item,rows,local));
    if(col.percentOfField||item.percentOfField)inputs.push(orgReadinessInput(col.percentOfField||item.percentOfField,'sum',item,rows,local));
    if(['percent','percent_item','date_percent_within','value_percent_within'].includes(mode))trace=researchTraceCalculation(item,rows,col,value,ctx);
    if(mode==='percent_item')semantics='Ratio of totals';
    else if(mode==='avg')semantics='Average of individual source values (not a ratio of totals)';
    if(trace.denominator===0)local.push('Cannot validate this percentage: the denominator contains no usable records for this population.');
  }
  const metric=findMetricByRef(field)||findMetricByNameOrId(field);
  if(metric){
    const src=metric.source||item.source, matched=researchRowsForCohort(src,rows,item.source,item), hit=metricRows(metric,matched,src,local);
    semantics=`Saved metric ${metric.name}: ${metric.mode} on ${hit.length} rule-matching records. Rules are evaluated within each source row.`;
    if(metric.mode==='percent_item'){
      const num=researchAggregateColumnValue(hit,{...item,source:src},metric.field,'sum',local), den=researchAggregateColumnValue(matched,{...item,source:src},metric.percentOfField,'sum',local);
      trace={lines:[`Numerator: ${num} from rule-matching records.`,`Denominator: ${den} from the matched population before metric rules.`,`Ratio of totals × 100; raw percentage points: ${value}`],numerator:num,denominator:den};
      inputs.push(orgReadinessInput(`![${src}].[${metric.percentOfField}]`,'sum',item,rows,local));
      if(!den)local.push('Cannot validate this percentage: the saved metric denominator is zero or missing.');
    }
  }
  for(const input of inputs){
    if(!input.records&&!input.qualifiedEmpty)local.push(`${input.raw}: no matching input records.`);
    else if(input.usable===0&&!input.qualifiedEmpty&&!['count','count_by','unique','direct','display'].includes(input.aggregation)&&!input.model)local.push(`${input.raw}: no usable numeric inputs; a returned zero does not establish a valid zero.`);
    if(input.missing)local.push(`${input.raw}: ${input.missing} missing inputs; saved missing-value behavior still applies.`);
  }
  for(const input of inputs.slice()){
    const referencedMetric=findMetricByNameOrId(input.raw)||findMetricByRef(input.raw);
    if(referencedMetric&&referencedMetric!==metric&&referencedMetric.percentOfField){
      const denominatorInput=orgReadinessInput(`![${referencedMetric.source}].[${referencedMetric.percentOfField}]`,'sum',item,rows,local);
      denominatorInput.raw=`${referencedMetric.name} denominator: ${referencedMetric.percentOfField}`;
      inputs.push(denominatorInput);
      trace.lines.push(`${referencedMetric.name}: ${referencedMetric.mode}; numerator uses the metric's rule-matching records, denominator uses matched records before its rules. Raw percentage output is in percentage points.`);
    }
  }
  const modelRefs=inputs.filter(input=>input.model).map(input=>parseModelRef(input.raw)||findModelCriterionReferenceByName(input.raw));
  for(const ref of modelRefs){
    const model=findModelByNameOrId(ref.model);if(!model)continue;
    const criteria=ref.criteria?[findCriterionByNameOrId(model,ref.criteria)].filter(Boolean):model.criteria||[], entries=modelEntryRowsForResearchRows(rows,item), opts={start:parseDateOnly(item.startDate),end:parseDateOnly(item.endDate),qaDateMode:els.runQADateSelect?.value||'interaction',_sourceRowsCache:new Map(),_entryRowsCache:new Map()};
    trace.lines.push(`Model evaluation level: ${item.modelEntityKind==='team'?'team':'representative'}; ${entries.length} entries. Entry results are aggregated by the saved column mode; a team label does not change that level.`);
    for(const entry of entries)for(const criterion of criteria){
      const v=criterionValue(criterion,entry,opts);
      if(typeof v==='number'&&!Number.isFinite(v))local.push(`Model ${model.name} / ${criterion.name} returned a non-finite value for ${entry.name}.`);
      if(trace.lines.length<16)trace.lines.push(`${entry.name} / ${criterion.name}: ${String(v)} (${criterion.calcType||'single'} / ${criterion.aggregate||'sum'}).`);
    }
    local.push(`Model ${model.name} uses its own entry-level source preparation. The source table shows identity coverage; it does not certify every model criterion's input lineage. Review the listed criterion values and source settings.`);
  }
  warnings.push(...local);
  return {label:researchColumnDisplayTitle(item,col)||col.label||field||mode,mode,field,value,display:formatResearchValue(value,item,col),semantics,inputs,trace,warnings:local,percent:!!col.showAsPercent||!!item.showPercent};
}
function orgReadinessLogic(item){
  const conditions=(item.guidedConditions||[]).filter(guidedValidCondition), individual=item.guidedSubject==='representatives'&&['show','count','compare'].includes(item.guidedQuestion), percentage=researchItemUsesGuidedPercentage(item);
  const conditionText=c=>`${c.expression?'Aggregate expression ':''}${labelSource(c.source||item.source)}: ${c.field||'record count'} ${c.operator||'contains'} ${c.value??''}${c.value2?' through '+c.value2:''}`;
  let grouping=conditions.length?'('+conditionText(conditions[0])+')':'No guided conditions';
  for(let i=1;i<conditions.length;i++)grouping=`(${grouping} ${conditions[i].logic==='or'?'OR':'AND'} (${conditionText(conditions[i])}))`;
  return {grouping,conditions,individual,percentage,level:percentage?'Guided conditions qualify the numerator in percentage calculations; they do not remove the denominator population at the pre-group stage.':individual?'Conditions may match different records for the same representative. Expression conditions evaluate that representative’s aggregate.':'Conditions evaluate one primary record at a time. Referenced sources use the saved matching strategy; expression conditions aggregate the related records.',filters:(item.filters||[]).map(f=>({text:f.expression||`${f.field||'Team'} ${f.op||'contains'} ${f.value||f.teamInput||''}`,include:f.include||'include',conditionResult:f.conditionResult||'true',kind:f.expression?'Primary row expression':f.type==='team_is'?'Team population filter':findMetricByRef(f.field)?'Saved metric / entity filter':isMultiPhraseTextOperator(f.op||'')&&filterPhrases(f).length?'Entity evidence / phrase filter':'Primary record filter'}))};
}
async function buildOrgReadiness(org,saved,settings={},options={}){
  researchThrowIfCancelled(options.token);
  const item=effectiveResearchItem(normalizeResearchItem(clonePlain({...saved,renderedResult:null}))), coverage=orgCoverage(org), warnings=[], issues=[], stages=[], cells=[], samples=[], snapshots={};
  // Intersect the current organization membership with the saved population via
  // the evaluator's optional inspection scope; never replace saved filters.
  const reps=new Set(coverage.reps.map(r=>normalizeIdentityName(r.key||r.name))), readers=researchCohortIdentityReaders(item.source);
  const all=getResearchSourceRows(item.source), scopeRows=new Set(all.filter(r=>reps.has(readers.rep(r))));
  if(item.outputType==='table'&&!(item.columns||[]).length)issues.push({level:'blocking',text:'The saved table has no output columns to evaluate.'});
  if(!coverage.complete)issues.push({level:'blocking',text:`Organization coverage is incomplete for: ${coverage.noRoster.join(', ')||'unidentified representatives'}.`});
  if(!coverage.count)issues.push({level:'blocking',text:'No current representatives can be identified for this organization.'});
  const primaryKeys=researchCohortKeys([...scopeRows],item.source).reps;
  const missingRoster=coverage.reps.filter(rep=>!primaryKeys.has(normalizeIdentityName(rep.key||rep.name)));
  if(!org.coachNames.length)issues.push({level:'blocking',text:'The selected organization has no coaches.'});
  if(missingRoster.length)issues.push({level:'attention',text:`${missingRoster.length} organization representatives have no primary-source match. This is missing data, not confirmed inactivity.`});
  await ensureResearchExecutionIndexes(item,{token:options.token});
  const inspect={scopeRows,scopeKey:`${org.id}:${++orgReadinessSequence}`,progress:options.progress,
    stage(label,rows){stages.push(orgReadinessStage(label,rows,item.source));snapshots[label]=rows;},
    beforeConditions(rows){snapshots.beforeConditions=rows;},
    group(group,computed,columns,runtime,ctx){
      const diagnosticColumns=item.outputType==='histogram'?[{mode:'count',label:'Histogram frequency'}]:item.outputType==='box'?[{mode:'median',field:item.valueField,label:'Median'}]:columns;
      const inspected=diagnosticColumns.map((col,i)=>orgReadinessCell(runtime,group.rows,col,computed.values[i],ctx,warnings));
      if(item.outputType==='scatter')inspected.unshift(orgReadinessCell(runtime,group.rows,{field:item.groupField,mode:'avg',label:'X axis'},computed.xValue,ctx,warnings));
      if(cells.length<8)cells.push({label:group.primary,secondary:group.secondary,records:group.rows.length,cells:inspected});
    },
    complete(result,groups){stages.push({label:'After calculation scope, group conditions and matching',records:groups.reduce((n,g)=>n+g.rows.length,0),reps:researchCohortKeys([...new Set(groups.flatMap(g=>g.rows))],item.source).reps.size,groups:groups.length});stages.push({label:'Displayed output after result filters, sorting and limits',groups:result.data.length,records:null,reps:null});}
  };
  const result=await evaluateResearchItemWorkAsync(item,{inspect,token:options.token});
  researchThrowIfCancelled(options.token);
  const runtime=attachResearchRuntime(item,warnings), base=snapshots['After saved population filters']||[...scopeRows], beforeConditions=snapshots.beforeConditions||base, final=snapshots['After research conditions (before grouping)']||[], finalSet=new Set(final), logic=orgReadinessLogic(item);
  // Normalization supplies an inactive Percent Builder on every column. Do not
  // report that default qualifier as evidence for a non-percentage calculation.
  const activeDefinition={...item,percentBuilder:item.valueMode==='percent'?item.percentBuilder:null,columns:(item.columns||[]).map(c=>({...c,percentBuilder:c.mode==='percent'?c.percentBuilder:null}))};
  const dependencies=researchDefinitionDependencies(activeDefinition), sources=[...new Set([...researchExecutionSources(item),...dependencies.sources])].filter(source=>!isDynamicResearchSource(source));
  const audits=sources.map(source=>orgReadinessSourceAudit(source,runtime,base,settings)); audits.forEach(source=>issues.push(...source.issues));
  for(const stage of stages)if(stage.unidentified)issues.push({level:'attention',text:`${stage.label}: ${stage.unidentified} records lack a representative identity.`});
  const byRep=percentBuilderRepEntries([...scopeRows],item.source), beforeSet=new Set(beforeConditions);
  const ordered=[...byRep.filter(rep=>rep.rows.some(r=>finalSet.has(r))).slice(0,4),...byRep.filter(rep=>!rep.rows.some(r=>finalSet.has(r))).slice(0,4)];
  for(const rep of ordered){
    const eligible=rep.rows.filter(r=>beforeSet.has(r)), pass=rep.rows.some(r=>finalSet.has(r));
    const conditions=logic.conditions.map(condition=>{
      const groups=logic.individual?[eligible]:eligible.map(row=>[row]);
      const outcomes=groups.map(rows=>({rows,pass:guidedConditionMatchesRows(rows,runtime,condition)}));
      const evidence=guidedConditionTargetRows(eligible,runtime,condition), expression=condition.expression?groups.map(rows=>evaluateResearchAggregateExpression({...runtime,source:condition.source||item.source},guidedConditionTargetRows(rows,runtime,condition),condition.field,{warnings})):null;
      return {text:`${condition.field||'Record count'} ${condition.operator} ${condition.value||''}`,pass:outcomes.some(x=>x.pass),tested:outcomes.length,matched:outcomes.filter(x=>x.pass).length,records:evidence.length,expression,values:evidence.slice(0,4).map(row=>String(researchFieldValue(row,condition.field,condition.source||item.source)??'')),absence:evidence.length?'':audits.find(a=>a.source===(condition.source||item.source))?.complete?'No activity in a source declared complete for all organization members and this window.':'No matching data available. Source completeness and identity coverage do not establish no activity.'};
    });
    const failedStage=stages.find(stage=>Array.isArray(snapshots[stage.label])&&!rep.rows.some(row=>snapshots[stage.label].includes(row)));
    samples.push({name:rep.name,pass,stage:failedStage?.label||'Retained before grouping',eligible:eligible.length,conditions});
  }
  missingRoster.slice(0,4).forEach(rep=>samples.push({name:rep.name,pass:false,stage:'No primary-source match; no matching data available',eligible:0,conditions:[]}));
  for(const condition of logic.conditions){
    const source=condition.source||item.source;
    if(!condition.expression&&researchFieldNeedsHeaderWarning({source},condition.field))issues.push({level:'blocking',text:`Missing header in condition: ${labelSource(source)} / ${condition.field}`});
    if(condition.expression&&/\//.test(condition.field)&&researchAnalysisGrain(item)==='rows')issues.push({level:'attention',text:'A ratio condition is evaluated at the primary-row grain. It is not a representative-wide ratio unless the saved guided settings group by representative.'});
  }
  if((item.guidedConditions||[]).length!==logic.conditions.length)issues.push({level:'blocking',text:'An incomplete saved guided condition is ignored by the existing engine. Complete or remove it in the Research editor.'});
  for(const filter of item.filters||[])if(!filter.expression&&filter.type!=='team_is'&&researchFieldNeedsHeaderWarning(item,filter.field))issues.push({level:'blocking',text:`Missing header in population filter: ${filter.field}`});
  // The generic health helper treats a leading @ as one direct metric. Parsed
  // expressions such as @Rate + 1 already have per-input diagnostics above.
  const healthItem={...item,valueField:item.valueMode==='expression'?'':item.valueField,columns:(item.columns||[]).map(c=>c.mode==='expression'?{...c,field:''}:c)};
  const health=researchHealthCheck(healthItem,result);
  issues.push(...health.blocking.map(text=>({level:'blocking',text})));
  const allWarnings=[...new Set([...(result.warnings||[]),...warnings,...health.warnings])];
  for(const text of allWarnings)issues.push({level:/denominator|unknown expression|missing (header|metric|model)|expression (error|did not)|no usable numeric|no matching input|ambiguous|unavailable|requires numeric|cannot reference|incompatible|non-finite/i.test(text)?'blocking':'attention',text});
  if(!base.length)issues.push({level:'blocking',text:'No eligible primary records remain after population and date restrictions. A zero output cannot validate missing evidence.'});
  // Zero qualifying rows are valid when a known input population failed explicit
  // conditions. Do not reject that case merely because no groups were produced.
  if(logic.conditions.some(c=>['not_contains','not_equals','is_blank','appears_at_most'].includes(c.operator)))issues.push({level:'attention',text:'The engine can treat missing evidence as a match for negative or at-most conditions. Inspect the representative examples; absence of a source match is not proof of no activity.'});
  if(dependencies.models.length)issues.push({level:'attention',text:'Referenced model calculations may aggregate representative results even under team labels. Source dates and input levels must be reviewed using the saved model settings.'});
  if(item.outputType==='conversation')issues.push({level:'blocking',text:'Conversation viewers use the raw-row rendering path. This setup audit explains population preparation; it cannot certify conversation display results.'});
  const unique=[...new Map(issues.map(issue=>[issue.text,issue])).values()];
  return {item,org:clonePlain(org),coverage,stages,audits,logic,cells,samples,result,dependencies,issues:unique,status:unique.some(i=>i.level==='blocking')?'Cannot evaluate reliably':unique.length?'Needs attention':'Ready',validZero:base.length>0&&!final.length&&!unique.some(i=>i.level==='blocking')};
}
function orgReadinessTable(headers,rows){return `<div class="orgAuditTable"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function renderOrgReadinessResult(report){
  const {item,org}=report, status=document.getElementById('orgReadinessStatus'), out=document.getElementById('orgReadinessResults');
  status.className='orgReadinessStatus '+(report.status==='Ready'?'ready':report.status==='Needs attention'?'attention':'blocked');
  status.textContent=report.status;
  const settings=orgReadinessSettings(org.id,item.id);
  out.innerHTML=`<p class="hint">${esc(org.name)} · ${esc(item.title||'Research Item')} · Current roster / team-index membership. Historical assignments are not established. This is an on-demand setup check; source completeness is not inferred from the date range.</p>
    ${report.issues.length?`<ul class="orgReadinessIssues">${report.issues.map(issue=>`<li><strong>${issue.level==='blocking'?'Cannot validate':'Review'}:</strong> ${esc(issue.text)}</li>`).join('')}</ul>`:`<p>All checked inputs support this setup.${report.validZero?' No representatives passed the saved conditions; this is a supported zero qualifying population.':''}</p>`}
    <h3>Sources and periods</h3>${orgReadinessTable(['Source / role','Coverage type','Date mapping / available coverage','Requested window','Records / matching'],report.audits.map(a=>[`${a.label}\n${a.role}`,a.kind==='period'?`Period totals: ${a.period.start||'?'}–${a.period.end||'?'}`:a.kind==='static'?'Static reference (user declaration)':a.kind,`${a.dateField||'No observation date mapping'}\nObserved: ${a.available}\nMissing dates: ${a.missing}; invalid: ${a.invalid}`,a.requested,`${a.records} imported; ${a.confirmed??'unknown'} confirmed dated records in window\n${a.used} engine-matched records / ${a.usedReps} reps`]))}
    <p class="hint">Confirmed dated-record counts describe source coverage before organization and condition restrictions. Engine-matched counts describe the selected population and may include undated totals as disclosed above.</p>
    <details><summary>Declare undated source roles / reporting periods for this organization</summary><p class="hint">These validation notes are separate from shared mappings. They do not change Research calculations. Use static only for roster or reference information.</p>${report.audits.map(a=>{const c=settings.sources?.[a.source]||{};return `<div class="orgSourceDeclaration" data-source-declaration="${esc(a.source)}"><strong>${esc(a.label)}</strong><label>Role<select data-declaration-kind aria-label="Role for ${esc(a.label)}"><option value="auto">Use established metadata</option><option value="period" ${c.kind==='period'?'selected':''}>Undated period totals</option><option value="static" ${c.kind==='static'?'selected':''}>Static reference</option></select></label><label>Period starts<input type="date" data-declaration-start value="${esc(c.start||'')}"></label><label>Period ends<input type="date" data-declaration-end value="${esc(c.end||'')}"></label><label class="orgCompleteness"><input type="checkbox" data-declaration-complete ${c.complete?'checked':''}> I confirm this export covers all current organization members for the entire declared period.</label></div>`;}).join('')}<button type="button" class="dark" id="orgSaveSourceDeclarations">Save validation notes</button></details>
    <details open><summary>Effective condition logic</summary><p>${esc(report.logic.level)}</p><code class="orgLogic">${esc(report.logic.grouping)}</code><p>Starting population = current organization members AND saved population settings AND every saved population filter. Within a saved population scope, includes are ORed; excludes then remove matches.</p>${orgReadinessTable(['Population filter (all applied)','Evaluation level','Include / expected result'],report.logic.filters.map(f=>[f.text,f.kind,`${f.include}; condition result ${f.conditionResult}`]))}<p class="hint">Field selections, duplicate handling, calculation scope, group-level value filters, unmatched-group behavior and displayed result limits retain their saved meaning. The trace separates preparation from output groups.</p></details>
    <details><summary>Population trace</summary>${orgReadinessTable(['Stage','Unique representatives','Records','Output groups'],report.stages.map(stage=>[stage.label,stage.reps,stage.records,stage.groups]))}<p class="hint">Stage counts follow the existing preparation order. Displayed output groups are not a count of qualifying representatives. Group record counts may repeat when the saved item creates multiple groups per record.</p></details>
    <details><summary>Cross-source matching and repeated records</summary>${report.audits.map(a=>`<h4>${esc(a.label)}</h4><p>${esc(a.joined.joinMode)} · ${a.used} matched records · ${a.duplicateIdentities} identities have repeated records. The shared join selects each source row once per cohort; repeated rows in the source still contribute and multiple output groups may reuse them.</p>${orgReadinessTable(['Unmatched representatives','Unmatched teams','Team fallback rows'],[[(a.joined.missingRepIdentities||[]).join(', ')||'None',(a.joined.missingCoachIdentities||[]).join(', ')||'None',a.joined.fallbackRows||0]])}${(a.joined.ambiguityDetails||[]).length?orgReadinessTable(['Ambiguous identity','IDs','Teams'],a.joined.ambiguityDetails.map(d=>[d.identity,(d.ids||[]).join(', '),(d.teams||[]).join(', ')])):''}`).join('')}</details>
    <details><summary>Calculation inputs and units — first ${report.cells.length} calculated groups</summary><p class="hint">These are the engine’s group calculations before displayed result filters and limits. Raw values and formatted values are shown separately. A readiness warning takes precedence over a numeric zero.</p>${report.cells.map(group=>`<h4>${esc(group.label)} ${esc(group.secondary||'')} · ${group.records} records</h4>${group.cells.map(cell=>`<div class="orgCell"><strong>${esc(cell.label)}</strong><code class="orgLogic">${esc(cell.field||cell.mode)}</code><p>${esc(cell.semantics)}</p><p>Raw value: ${esc(cell.value??'missing')} · Display: ${cell.display||'blank'}</p>${cell.trace.lines.length?`<ul>${cell.trace.lines.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`:''}${orgReadinessTable(['Input / resolution','Source / date coverage','Aggregation / level','Usable records / units'],cell.inputs.map(input=>[`${input.raw}\n${input.kind}: ${input.field}${input.value!==undefined?'\nResolved value: '+input.value:''}`,`${labelSource(input.source)||input.source}\n${report.audits.find(a=>a.source===input.source)?.period?report.audits.find(a=>a.source===input.source).period.start+'–'+report.audits.find(a=>a.source===input.source).period.end:report.audits.find(a=>a.source===input.source)?.available||'See dependency sources'}`,`${input.aggregation} over this ${researchAnalysisGrain(item)} group`,`${input.usable??'not a direct numeric field'} numeric / ${input.records} eligible / ${input.baseRecords} matched before saved metric rules\nRaw examples: ${input.sample.join(', ')}\n${input.units}`]))}</div>`).join('')}`).join('')}${report.dependencies.metrics.length?`<h4>Saved metric definitions</h4>${orgReadinessTable(['Metric','Source','Aggregation','Stored rules'],report.dependencies.metrics.map(m=>[m.name,labelSource(m.source),m.mode,JSON.stringify(m.rules||[])]))}<p class="hint">Metric rules use metricRows: AND rules must hold on each retained row. OR rules can expand the field-selected population, but still require every AND rule. This is not general (A AND B) OR C logic.</p>`:''}${report.dependencies.models.length?`<h4>Referenced models</h4>${orgReadinessTable(['Model','Criteria / source / calculation'],report.dependencies.models.map(m=>[m.name,(m.criteria||[]).map(c=>`${c.name}: ${labelSource(c.source)} · ${c.calcType||c.mode||'saved calculation'} · ${c.column||c.expression||''}`).join('\n')]))}`:''}</details>
    <details><summary>Why included / why excluded — ${report.samples.length} sample representatives</summary><p class="hint">Included means retained before grouping. Final group filters and limits are listed separately in the population trace. Conditions may be unresolved when no eligible evidence exists.</p>${report.samples.map(rep=>`<div class="orgCell"><strong>${esc(rep.name)} · ${rep.pass?'Included before grouping':'Excluded / unavailable'}</strong><p>${esc(rep.stage)} · ${rep.eligible} eligible primary records</p>${orgReadinessTable(['Condition','Engine check','Evidence'],rep.conditions.map(c=>[c.text,!c.tested?'Not evaluated':`${c.pass?'Matched':'Failed'} (${c.matched}/${c.tested} evaluated cohorts)`,c.absence||`${c.records} related records; values: ${c.values.join(' | ')}${c.expression?' · expression result: '+c.expression.join(', '):''}`]))}</div>`).join('')}</details>`;
  document.getElementById('orgSaveSourceDeclarations').onclick=()=>{
    const sources={...settings.sources};out.querySelectorAll('[data-source-declaration]').forEach(row=>{sources[row.dataset.sourceDeclaration]={kind:row.querySelector('[data-declaration-kind]').value,start:row.querySelector('[data-declaration-start]').value,end:row.querySelector('[data-declaration-end]').value,complete:row.querySelector('[data-declaration-complete]').checked};});
    if(Object.values(sources).some(c=>(c.kind==='period'||c.complete)&&(!c.start||!c.end||c.start>c.end))){status.className='orgReadinessStatus attention';status.textContent='Enter a valid start and end for each declared reporting period.';return;}
    saveOrgReadinessSettings(org.id,item.id,{sources});
  };
}
async function checkOrgResearchSetup(){
  const org=activeOrg(), saved=(state.researchItems||[]).find(item=>item.id===state.orgResearchItemId); if(!org||!saved)return;
  invalidateOrgReadiness('Checking setup');
  const token={cancelled:false}, signature=orgReadinessSignature(org,saved);orgReadinessOperation=token;
  renderOrgReadinessControls();const status=document.getElementById('orgReadinessStatus');
  try{
    const report=await buildOrgReadiness(org,saved,orgReadinessSettings(org.id,saved.id),{token,progress:text=>{if(!token.cancelled)status.textContent=text;}});
    if(token.cancelled||signature!==orgReadinessSignature(activeOrg(),(state.researchItems||[]).find(item=>item.id===state.orgResearchItemId)))return;
    orgReadinessSnapshot={signature,report};renderOrgReadinessResult(report);scheduleOrgReadinessValidity();
  }catch(error){if(!token.cancelled){status.className='orgReadinessStatus blocked';status.textContent='Cannot evaluate reliably: '+(error.message||error);}}
  finally{if(orgReadinessOperation===token)orgReadinessOperation=null;renderOrgReadinessControls();}
}
// Cheap validity check only while a completed result is visible. Never scan data
// or evaluate Research in the timer; imports also explicitly invalidate above.
function scheduleOrgReadinessValidity(){
  setTimeout(()=>{
    if(!orgReadinessSnapshot||!document.getElementById('orgBuilderModal')?.classList.contains('open'))return;
    const item=(state.researchItems||[]).find(x=>x.id===state.orgResearchItemId);
    if(orgReadinessSnapshot.signature!==orgReadinessSignature(activeOrg(),item))invalidateOrgReadiness('Inputs changed');
    else scheduleOrgReadinessValidity();
  },1000);
}
window.addEventListener('storage',()=>invalidateOrgReadiness('Saved inputs changed in another window'));
