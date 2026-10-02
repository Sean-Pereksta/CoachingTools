/* All-Star adapters and editors for the versioned Dated Stats engine.
 * Source rows remain in the established sourceData store. Categorized numerical
 * observations and saved Research snapshots use the existing IndexedDB stores.
 */
'use strict';
function isDatedStatsSource(source){return source==='weeklyRetail'||source==='weeklyReferral';}
function datedStatsHasData(){return ['weeklyRetail','weeklyReferral'].some(s=>state.data[s]?.rows?.length);}
function datedStatsConfig(source){
  const data=state.data[source]||{},detected=window.AllStarDatedStats.defaultConfig(source,data.headers||[],data.config?[]:data.rows||[]);
  if(!data.config)return detected;
  const fields={...data.config.fields};
  // Retire only the former automatic mixed-scale blocker. Saved corrections
  // and deliberately declared per-date units retain their interpretation.
  for(const [field,def] of Object.entries(fields))if(def.inputUnit==='per-date'&&!def.unitReviewed&&!Object.keys(def.unitsByDate||{}).length&&detected.fields[field]?.inputUnit)fields[field]={...def,inputUnit:detected.fields[field].inputUnit};
  return {...data.config,fields};
}
function datedStatsUploadedFields(){
  return ['weeklyRetail','weeklyReferral'].flatMap(source=>Object.entries(datedStatsConfig(source).fields||{}).map(([field,def])=>window.AllStarDatedStats.normalizeMetric({id:'field:'+source+':'+encodeURIComponent(field),name:labelSource(source)+' → '+field,source,field,kind:def.kind,behavior:def.behavior,aggregation:'equal_rep',directField:true})));
}
function datedStatsAvailableMetrics(){return [...datedStatsUploadedFields(),...state.metrics.filter(m=>m.dataCategory==='datedStats'&&m.output!=='summary')];}
function datedStatsResearchMetric(settings){
  if(settings.fieldMetric)return datedStatsUploadedFields().find(m=>m.id===settings.fieldMetric.id);
  return state.metrics.find(m=>m.id===settings.metricId);
}
function datedStatsSelectMetric(settings,metric){
  delete settings.fieldMetric;delete settings.metricId;
  if(metric.directField)settings.fieldMetric=clonePlain(metric);else settings.metricId=metric.id;
  return settings;
}
function datedStatsLoadedObservations(){return ['weeklyRetail','weeklyReferral'].filter(source=>state.data[source]?.rows?.length).flatMap(source=>{try{return datedStatsCategory(source,true,true).observations;}catch(_){return [];}});}
function datedStatsIdentity(name,source){
  const area=source==='weeklyReferral'?'referral':'retail',D=window.CoachToolsStatsDirectory;
  name=D?D.resolve(name,'name'):name;
  const unresolved=(state.quarantinedRepAliases||[]).some(a=>(a.sourceArea===area||a.sourceArea==='global')&&fullNameIdentityKey(a.aliasName||a.alias)===fullNameIdentityKey(name));
  if(unresolved)return {reason:'Saved name alias needs review'};
  const canonical=canonicalRepName(name,area),repId=fullNameIdentityKey(canonical);
  if(!repId||!String(canonical).trim())return {reason:'Missing representative identity'};
  if(ensureRosterIndex().byRepKey.get(repId)?.conflict)return {reason:'Representative name matches multiple roster identities; review aliases before joining dated measurements and events'};
  return {id:repId,name:canonical};
}
const datedStatsDirectCategories=new Map();
function datedStatsCategory(source,required=true,sourceDate=false){
  let pack=sourceDate?datedStatsDirectCategories.get(source):state.categorized.stats?.sources?.[source];
  const signature=datedStatsSourceSignature(source);
  if(required&&(!pack||pack.pending||pack.signature!==signature)){
    const data=state.data[source]||{},config=clonePlain(datedStatsConfig(source));
    if(sourceDate)config.calendar={reviewed:false,frequency:'observation'};
    const coachCache=new Map(),resolveCoach=raw=>{if(!coachCache.has(raw))coachCache.set(raw,datedStatsResolveCoach(raw));return coachCache.get(raw);};
    pack={...window.AllStarDatedStats.categorize(data.rows||[],config,{headers:data.headers||[],fileName:data.fileName,resolveIdentity:name=>datedStatsIdentity(name,source),resolveCoach}),signature};
    if(sourceDate)datedStatsDirectCategories.set(source,pack);else {state.categorized.stats=state.categorized.stats||{version:1,sources:{}};state.categorized.stats.sources[source]=pack;}
  }
  return pack;
}
function datedStatsResolveCoach(raw){const value=window.CoachToolsStatsDirectory?.resolve(raw,'coach')||raw,candidates=[...new Set([...controlRosterRows().map(r=>r._team||r.team),...(window.CoachToolsStatsDirectory?.grouped()||[]).flatMap(g=>g.coaches)].filter(Boolean))],resolved=resolveWeeklyCoachIdentity(value,'',candidates);return resolved.method==='unresolved'?{value:String(value||''),method:'historical source label; not in current directory'}:resolved;}
async function datedStatsResearchCategory(source,sourceDate,cancelled){
  const signature=datedStatsSourceSignature(source),existing=sourceDate?datedStatsDirectCategories.get(source):state.categorized.stats?.sources?.[source];
  if(existing&&!existing.pending&&existing.signature===signature)return existing;
  const data=state.data[source]||{},config=clonePlain(datedStatsConfig(source)),coaches=new Map();
  if(sourceDate)config.calendar={reviewed:false,frequency:'observation'};
  const result=await window.AllStarDatedStats.categorizeAsync(data.rows||[],config,{headers:data.headers||[],fileName:data.fileName,resolveIdentity:name=>datedStatsIdentity(name,source),resolveCoach:raw=>{if(!coaches.has(raw))coaches.set(raw,datedStatsResolveCoach(raw));return coaches.get(raw);},yield:yieldToBrowser,cancelled,progress:(n,total)=>updateProgress(`Preparing ${labelSource(source)} · ${n} / ${total} rows`,8)});
  if(cancelled()||signature!==datedStatsSourceSignature(source))throw Object.assign(new Error('Research source changed; run again.'),{name:'AbortError'});
  const pack={...result,signature};if(sourceDate)datedStatsDirectCategories.set(source,pack);else{state.categorized.stats=state.categorized.stats||{version:1,sources:{}};state.categorized.stats.sources[source]=pack;}return pack;
}
const datedStatsRosterSignatures=new WeakMap();
function datedStatsRosterSignature(){
  const index=ensureRosterIndex();
  if(!datedStatsRosterSignatures.has(index))datedStatsRosterSignatures.set(index,researchHashText(JSON.stringify(index.rows.map(r=>[r._repKey,r._team,r.sourceArea,r.rosterId]))));
  return datedStatsRosterSignatures.get(index);
}
function datedStatsSourceSignature(source){return JSON.stringify(['source-dates-v2',state.sourceMeta[source]?.sourceVersion||0,datedStatsConfig(source),repAliasCacheSignature(),datedStatsRosterSignature(),window.CoachToolsStatsDirectory?.snapshot().revision||0]);}
async function buildDatedStatsCategory(options={}){
  const prior=state.categorized.stats||{version:1,sources:{}},sources={};
  for(const source of ['weeklyRetail','weeklyReferral']){
    const data=state.data[source];if(!data?.rows?.length)continue;
    const signature=datedStatsSourceSignature(source);
    if(prior.sources?.[source]?.signature===signature){sources[source]=prior.sources[source];continue;}
    const config=clonePlain(datedStatsConfig(source));
    const coachCandidates=[...new Set([...controlRosterRows().map(r=>r._team||r.team),...(window.CoachToolsStatsDirectory?.grouped()||[]).flatMap(g=>g.coaches)].filter(Boolean))],coachCache=new Map();
    const resolveCoach=raw=>{if(coachCache.has(raw))return coachCache.get(raw);const value=window.CoachToolsStatsDirectory?.resolve(raw,'coach')||raw,resolved=resolveWeeklyCoachIdentity(value,'',coachCandidates),result=resolved.method==='unresolved'?{value:String(value||''),method:'historical source label; not in current directory'}:resolved;coachCache.set(raw,result);return result;};
    const result=await window.AllStarDatedStats.categorizeAsync(data.rows,config,{headers:data.headers,fileName:data.fileName,resolveIdentity:name=>datedStatsIdentity(name,source),resolveCoach,yield:yieldToBrowser,cancelled:()=>options.active&&!options.active(),progress:(done,total)=>updateProgress(`Dated Stats · ${labelSource(source)} · ${done.toLocaleString()} / ${total.toLocaleString()}`,82)});
    if(signature!==datedStatsSourceSignature(source))throw Object.assign(new Error('Dated Stats changed during categorization; previous results were retained.'),{name:'AbortError'});
    sources[source]={...result,signature};
  }
  return {version:1,sources,builtAt:new Date().toISOString()};
}
async function loadDatedStatsFile(source,file,options={}){
  const load=async()=>{
    const wb=options.workbook||await readFileWorkbook(file,{cellDates:false,raw:true,cellNF:true}),headers=[],incoming=[];
    for(const sheet of wb.SheetNames||[]){
      // Preserve counts, fraction percentages and Excel date serials. A cell's
      // display text (e.g. 9/6/26 or a rounded 56%) is not its numerical value.
      const aoa=wb.__coachToolsAoaBySheet?.[sheet]||XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:'',raw:true,range:0});
      const headerRow=aoa.slice(0,40).findIndex(row=>row.some(v=>['name','representative','agent name','associate name'].includes(norm(v)))&&row.some(v=>['date','stats date','report date','week date'].includes(norm(v))));
      if(headerRow<0)continue;
      const hs=aoa[headerRow].map(v=>String(v??'').trim()),detected=window.AllStarDatedStats.defaultConfig(source,hs);for(const h of hs)if(h&&!headers.includes(h))headers.push(h);
      for(let i=headerRow+1;i<aoa.length;i++){
        const values=aoa[i];if(!values?.some(v=>String(v??'').trim()))continue;
        const row={_dsUnits:{}};hs.forEach((h,j)=>{if(h){row[h]=values[j]??'';const cell=wb.Sheets[sheet]?.[XLSX.utils.encode_cell({r:i,c:j})];if(cell?.z&&/%/.test(cell.z.replace(/"[^"]*"|\\./g,'')))row._dsUnits[h]='fraction';}});
        const D=window.CoachToolsStatsDirectory;
        for(const [h,role] of [[detected.repField,'name'],[detected.coachField,'coach'],[detected.managerField,'manager']])if(D&&row[h])row[h]=D.resolve(row[h],role);
        const identity=datedStatsIdentity(row[detected.repField],source);
        incoming.push({...row,_rep:identity.name||row[detected.repField],_repKey:identity.id||'',_rawRep:row[detected.repField],_rawRepKey:fullNameIdentityKey(row[detected.repField]),_team:row[detected.coachField]||'',_date:row[detected.dateField],_sourceKey:source,_sourceArea:source==='weeklyRetail'?'retail':'referral',_dsRow:i+1,_dsFile:file.name});
        if(i%1000===0){await yieldToBrowser();assertAllStarImportActive();}
      }
    }
    if(!incoming.length)throw new Error('Weekly files need a representative and Date column. No recognized rows were found.');
    const previous=state.data[source]||{},config=clonePlain(options.config||wb.__datedStatsConfig||(previous.config?datedStatsConfig(source):null)||window.AllStarDatedStats.defaultConfig(source,headers,incoming));
    config.fields={...window.AllStarDatedStats.defaultConfig(source,headers,incoming).fields,...config.fields};
    const unitProfiles=window.AllStarDatedStats.profileUnits(options.fromCentral?incoming:[...(previous.rows||[]),...incoming],config);
    const scope=new Set((wb.__weeklyScope||[]).map(coachNameKey)),history=(previous.rows||[]).filter(row=>!options.fromCentral||!scope.size||scope.has(coachNameKey(row[config.coachField])));
    const merged=window.AllStarDatedStats.mergeRows(history,incoming,config,{fileName:file.name});
    // Compare a new shared snapshot with the old one for corrections, while
    // keeping the shared source's authoritative selected population intact.
    const audit=options.fromCentral?window.AllStarDatedStats.mergeRows(previous.rows||[],incoming,config,{fileName:file.name}).audit:merged.audit;
    state.data[source]={fileName:file.name,headers:[...new Set([...(previous.headers||[]),...headers])],rows:normalizeDatedStatsRawIdentities(merged.rows,source,config),config,unitProfiles,audit:[...(previous.audit||wb.__datedStatsAudit||[]),...audit],lastImport:merged.counts};
    noteCategorizationSourceVersion(source,state.data[source].rows,state.data[source].headers);
    markSourceCacheDirty(source,'Dated Stats import');markCategorizationNeeded('Weekly numerical observations changed',[source]);
    return true;
  };
  if(options.fromCentral)return load();
  const ok=await runAllStarImport(source,file,{...options,label:labelSource(source)},load);
  if(ok){
    await publishDatedStatsSharedSource(source);
    renderDatedStatsImportSummary();
  }
  return ok;
}
async function publishDatedStatsSharedSource(source){
  const d=state.data[source];if(!d?.rows?.length||!window.CoachToolsData)return;
  const aoa=[d.headers,...d.rows.map(r=>d.headers.map(h=>r._dsUnits?.[h]==='fraction'&&typeof r[h]==='number'?String(r[h]*100)+'%':r[h]??''))];
  const data={meta:{fileName:d.fileName,totalRows:d.rows.length,datedStatsConfig:d.config,datedStatsAudit:d.audit||[]},workbook:{sheets:['Dated Stats'],data:{'Dated Stats':{aoa}}}};
  try{const saved=await window.CoachToolsData.importDataset(source,data,{originalFileName:d.fileName,rowCount:d.rows.length,classificationMethod:'allstar-dated-stats',validationStatus:'ready'});const meta=window.CoachToolsData.getDatasetVersion?.(source)||saved?.current||saved?.dataset;if(meta){const sync=readAllStarCentralSyncMap();sync[source]=allStarCentralSyncIdentity(meta);localStorage.setItem(ALLSTAR_SYNC_KEY,JSON.stringify(sync));}}
  catch(error){alert('All-Star data was saved, but the shared weekly dataset could not be updated: '+error.message);}
}
function renderDatedStatsImportSummary(){
  document.querySelectorAll('[data-ds-summary]').forEach(box=>{
    const source=box.dataset.dsSummary,data=state.data[source]||{};
    let pack,message='';try{if(data.rows?.length)pack=datedStatsCategory(source,true,true);}catch(error){message=error.message;}
    const issues=[...new Set((pack?.issues||[]).map(i=>(i.field?i.field+': ':'')+i.reason))];
    box.innerHTML=weeklySourceStatusHtml(source)+`${data.rows?.length?`<button type="button" class="smallBtn" data-ds-config="${source}">Edit fields</button><span class="hint"> Uses source Date automatically</span>`:''}${message||issues.length?`<div role="status">${esc(message||issues.slice(0,5).join(' · '))}</div>`:''}`;
    box.querySelector('[data-ds-config]')?.addEventListener('click',()=>openDatedStatsSourceEditor(source));
    box.querySelector('[data-source-fix-teams]')?.addEventListener('click',()=>els.fixTeamsBtn?.click());
  });
}
function evaluateDatedStatsMetric(metric,rows,source,warnings=[]){
  const pack=datedStatsCategory(metric.source);
  const ids=new Set((rows||[]).map(r=>r._repKey||fullNameIdentityKey(r._rep||r.Representative||r.Name||'')));
  let observations=pack.observations.filter(o=>ids.has(o.repId));
  // A numerical source cohort carries periods; event cohorts supply identities
  // only, leaving measurement dates to the reusable metric definition.
  if(isDatedStatsSource(source)){
    const allowed=new Set((rows||[]).map(r=>{const p=window.AllStarDatedStats.period(r[pack.config.dateField],pack.config.calendar);return `${r._repKey}|${p?.key}`;}));
    observations=observations.filter(o=>allowed.has(`${o.repId}|${o.period.key}`));
  }
  const result=window.AllStarDatedStats.metricResult(observations,metric,{scalar:true,expectedIds:[...ids]});
  if(result.exclusions?.length)warnings.push(`${metric.name}: ${result.missingRepresentatives} representatives missing or excluded. Open Dated Stats Research for period-level evidence.`);
  return result.value;
}
function datedStatsEvents(sources=['documented_coaching','checklist','qa']){
  const events=[],invalidSources=new Set();
  for(const source of sources){
    const rows=getRowsRaw(source),hs=getHeaders(source);
    const mapped=researchMappedSourceFields(source),dateField=mapped.date;
    const idField=researchExactHeader(source,['Coaching ID','Session ID','Evaluation ID','Event ID','Record ID','ID']);
    const textFields=[...new Set([mapped.text,...hs.filter(h=>/description|topic|comment|focus|item|notes|category|behavior|type/i.test(h))].filter(Boolean))];
    if(!hs.length&&!rows.length)invalidSources.add(source);
    for(const r of rows){
      const repId=researchSourceMappings()[source]?.rep?fullNameIdentityKey(researchRowRepName(r,source)):(r._repKey||fullNameIdentityKey(researchRowRepName(r,source)));
      const rawDate=dateField?r[dateField]:r._date,date=Number.isFinite(window.AllStarDatedStats.day(rawDate))?rawDate:parseDateOnly(rawDate);
      if(!repId||!Number.isFinite(window.AllStarDatedStats.day(date))){invalidSources.add(source);continue;}
      const fields=Object.fromEntries(hs.map(h=>[h,r[h]])),eventId=idField&&String(r[idField]??'').trim()?r[idField]:JSON.stringify(Object.keys(fields).sort().map(h=>[h,fields[h]]));
      events.push({source,repId,date:window.AllStarDatedStats.iso(window.AllStarDatedStats.day(date)),id:eventId,fields,text:textFields.map(h=>r[h]??'').join(' | '),topics:textFields.map(h=>String(r[h]??'')),deliveredBy:r['Coached By']||r['Coaching Delivered By']||''});
    }
  }
  const distinct=window.AllStarDatedStats.dedupeEvents(events);distinct.invalidSources=[...invalidSources];return distinct;
}
function datedStatsCriterionValue(c,entry,opts={}){
  const metric=state.metrics.find(m=>m.id===c.datedStatsMetricId);
  if(!metric)throw new Error(`Choose a Dated Stats metric for ${c.name}.`);
  const pack=datedStatsCategory(metric.source),index=datedStatsObservationIndex(pack);
  let rows=(entry.kind==='team'?index.byCoach.get(coachNameKey(entry.team||entry.name)):index.byRep.get(entry.key))||[];
  const area=metric.source==='weeklyReferral'?'referral':'retail';
  if(entry.kind!=='team'&&entry.sourceArea&&entry.sourceArea!==area)rows=[];
  const rule={...(c.datedStatsRule||{})};
  rule.startDate=rule.startDate||metric.startDate||ymd(opts.start);rule.endDate=rule.endDate||metric.endDate||ymd(opts.end);
  if(c.datedStatsEventConditions?.length){
    const events=opts._datedStatsEvents||(opts._datedStatsEvents=datedStatsEvents()),E=window.AllStarDatedStats;
    const ids=new Set(rows.map(o=>o.repId));
    for(const cond of c.datedStatsEventConditions)if(!(cond.startDate||rule.startDate)||!(cond.endDate||rule.endDate))throw new Error('Choose dates for the Dated Items condition or a measurement/run window.');
    for(const repId of ids)if(!c.datedStatsEventConditions.every(cond=>{const coverage=c.datedStatsCoverage?.[cond.source]||{},summary=E.eventSummary(events,repId,{start:cond.startDate||rule.startDate,end:cond.endDate||rule.endDate},coverage,cond);return E.eventConditionPass(summary,cond);}))rows=rows.filter(o=>o.repId!==repId);
  }
  const result=window.AllStarDatedStats.criterion(rows,metric,rule);
  opts.datedStatsTraces=opts.datedStatsTraces||[];opts.datedStatsTraces.push({criterion:c.name,entry:entry.name,...result});
  const trace={value:result.value,unit:c.datedStatsReturn==='qualifies'?'':result.unit,trend:result.trend,points:result.points.map(p=>({period:p.period,value:p.value,eligibleRepresentatives:p.eligibleRepresentatives,missingRepresentatives:p.missingRepresentatives,numerator:p.numerator,denominator:p.denominator})),metric:clonePlain(metric),rule:clonePlain(rule)};
  entry.datedStatsTrends={...(entry.datedStatsTrends||{}),[c.id]:trace};
  datedStatsModelTrends.set(c.id+'|'+entry.key,trace);if(datedStatsModelTrends.size>5000)datedStatsModelTrends.delete(datedStatsModelTrends.keys().next().value);
  if(c.datedStatsReturn==='qualifies')return result.value==null?null:(result.pass?1:0);
  return result.value;
}
function datedStatsCriterionHtml(c,i){
  const r=c.datedStatsRule||{},metrics=state.metrics.filter(m=>m.dataCategory==='datedStats');
  const option=(k,label)=>`<option value="${k}" ${r.mode===k?'selected':''}>${label}</option>`;
  return `<div class="criterionRow" data-crit="${esc(c.id)}"><div class="row"><strong>${i+1} · Dated Stats</strong><button class="smallBtn red" data-remove-crit="${esc(c.id)}">Delete</button><button class="smallBtn" data-copy-crit="${esc(c.id)}">Copy</button><button class="smallBtn" type="button" data-ds-criterion-preview="${esc(c.id)}">Trend / evidence</button></div><div class="grid4"><div class="field"><label>Name</label><input data-cfield="name" value="${esc(c.name)}"></div><div class="field"><label>Reusable metric</label><select data-dscr="datedStatsMetricId"><option value="">Choose metric</option>${metrics.map(m=>`<option value="${esc(m.id)}" ${m.id===c.datedStatsMetricId?'selected':''}>${esc(m.name)}</option>`).join('')}</select></div><div class="field"><label>Applies to</label><select data-cfield="audience"><option value="rep" ${c.audience==='rep'?'selected':''}>Representatives</option><option value="both" ${c.audience==='both'?'selected':''}>Both</option><option value="team" ${c.audience==='team'?'selected':''}>Teams</option></select></div><div class="field"><label>Scoring</label><select data-cfield="scoreType"><option value="display" ${c.scoreType==='display'?'selected':''}>Display only</option><option value="rank" ${c.scoreType==='rank'?'selected':''}>Rank</option><option value="points" ${c.scoreType==='points'?'selected':''}>Points</option></select></div></div><div class="grid4"><div class="field"><label>Evaluation</label><select data-dsr="mode">${option('aggregate','Selected-period aggregate')}${option('qualifying_periods','Count qualifying weeks')}${option('trend','Trend summary')}${option('comparison_change','Baseline/comparison change')}</select></div><div class="field"><label>Trend summary</label><select data-dsr="summary">${['average','first','latest','change','relativeChange','slope','validPeriods'].map(v=>`<option value="${v}" ${(r.summary||'change')===v?'selected':''}>${esc(v)}</option>`).join('')}</select></div><div class="field"><label>Criterion output</label><select data-dscr="datedStatsReturn"><option value="value" ${c.datedStatsReturn!=='qualifies'?'selected':''}>Numerical value</option><option value="qualifies" ${c.datedStatsReturn==='qualifies'?'selected':''}>Meets condition: 1 / 0</option></select></div><div class="field"><label>Direction</label><select data-cfield="direction"><option value="higher" ${c.direction!=='lower'?'selected':''}>Higher best</option><option value="lower" ${c.direction==='lower'?'selected':''}>Lower best</option></select></div></div><div class="grid4">${dsInput('From','startDate',r.startDate,'date','data-dsr')}${dsInput('Through','endDate',r.endDate,'date','data-dsr')}${dsInput('Last reporting periods','lastPeriods',r.lastPeriods||0,'number','data-dsr')}${dsInput('Minimum valid periods','minPeriods',r.minPeriods||1,'number','data-dsr')}<div class="field"><label>Numerical operator</label>${dsOperator(r.operator,'data-dsr="operator"')}</div>${dsInput('Threshold (rates use 0–100)','threshold',r.threshold??0,'number','data-dsr')}${dsInput('Upper threshold','threshold2',r.threshold2??0,'number','data-dsr')}${dsInput('Required qualifying periods','requiredPeriods',r.requiredPeriods||1,'number','data-dsr')}${dsInput('Baseline from','baselineStart',r.baselineStart,'date','data-dsr')}${dsInput('Baseline through','baselineEnd',r.baselineEnd,'date','data-dsr')}${dsInput('Comparison from','comparisonStart',r.comparisonStart,'date','data-dsr')}${dsInput('Comparison through','comparisonEnd',r.comparisonEnd,'date','data-dsr')}${dsInput('Weight','weight',c.weight||1,'number','data-cfield')}${dsInput('Points','points',c.points??1,'number','data-cfield')}${dsInput('No-score rank','missingRank',c.missingRank??999,'number','data-cfield')}${dsInput('No-score points','missingPoints',c.missingPoints??0,'number','data-cfield')}</div><div class="hint">Independent complete reporting periods. Change in rates uses percentage points; slope uses elapsed weeks. Sparklines and display-only criteria do not change rankings. For points based on passing the condition, select “Meets condition: 1 / 0”.</div><button type="button" class="smallBtn" data-ds-model-events="${esc(c.id)}">Coaching / checklist conditions and coverage</button><div data-ds-model-preview></div></div>`;
}
function bindDatedStatsCriteria(){
  const host=els.criteriaList;if(!host)return;
  host.querySelectorAll('[data-dscr],[data-dsr]').forEach(input=>input.onchange=()=>{
    const c=getEditCriterion(input.closest('[data-crit]').dataset.crit);if(!c)return;
    if(input.dataset.dscr)c[input.dataset.dscr]=input.value;else{c.datedStatsRule=c.datedStatsRule||{};c.datedStatsRule[input.dataset.dsr]=input.value;}
    const m=state.metrics.find(m=>m.id===c.datedStatsMetricId);if(m){c.source=c.leftSource=c.rightSource=c.customSource=m.source;c.trueValueEnabled=false;c.format=m.kind==='percentage'&&c.datedStatsReturn!=='qualifies'?'pct':'number';}
  });
  host.querySelectorAll('[data-ds-model-events]').forEach(b=>b.onclick=()=>{
    const c=getEditCriterion(b.dataset.dsModelEvents);openDatedStatsConditions(c.datedStatsEventConditions||[],c.datedStatsCoverage||{},(conditions,coverage)=>{c.datedStatsEventConditions=conditions;c.datedStatsCoverage=coverage;});
  });
  host.querySelectorAll('[data-ds-criterion-preview]').forEach(b=>b.onclick=()=>{
    const c=getEditCriterion(b.dataset.dsCriterionPreview),metric=state.metrics.find(m=>m.id===c.datedStatsMetricId),target=b.closest('[data-crit]').querySelector('[data-ds-model-preview]');
    try{if(!metric)throw new Error('Choose a saved Dated Stats metric.');const E=window.AllStarDatedStats,result=E.criterion(datedStatsCategory(metric.source).observations,metric,c.datedStatsRule||{});target.innerHTML=`<div class="hint">Loaded group preview · ${esc(result.unit)} · ${dsNumber(result.value)} · ${result.pass?'Meets threshold':'Does not meet threshold / insufficient data'}</div>${datedStatsSparkline(result.points)}<div>${result.trend.validPeriods} valid periods</div>`;}catch(error){target.textContent=error.message;}
  });
}
function dsNumber(value){return value==null?'—':Number(value).toLocaleString(undefined,{maximumFractionDigits:2});}
function dsInput(label,name,value='',type='text',attr='data-ds') {return `<div class="field"><label>${esc(label)}</label><input ${attr}="${esc(name)}" type="${type}" step="any" value="${esc(value??'')}"></div>`;}
function dsSelect(label,name,options,value='',attr='data-ds'){return `<div class="field"><label>${esc(label)}</label><select ${attr}="${name}">${options.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}" ${v===value?'selected':''}>${esc(l)}</option>`;}).join('')}</select></div>`;}
function dsOperator(value,attr='data-ds="operator"'){return `<select ${attr}>${[['gte','≥'],['gt','>'],['lte','≤'],['lt','<'],['eq','='],['between','Between']].map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select>`;}
function dsDialog(title,html){
  const wrap=document.createElement('div');wrap.className='researchGearModal ds-modal';wrap.setAttribute('role','dialog');wrap.setAttribute('aria-modal','true');wrap.setAttribute('aria-label',title);
  wrap.innerHTML=`<div class="researchGearBox ds-dialog"><div class="row"><h2>${esc(title)}</h2><button type="button" class="dark" data-ds-close>Close</button></div>${html}<div class="ds-message" role="status"></div></div>`;document.body.appendChild(wrap);
  const previouslyFocused=document.activeElement;const close=()=>{wrap.remove();previouslyFocused?.focus?.();};wrap.querySelector('[data-ds-close]').onclick=close;
  wrap.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  wrap.querySelector('input,select,button')?.focus();return wrap;
}
function dsValues(wrap){return Object.fromEntries([...wrap.querySelectorAll('[data-ds]')].map(n=>[n.dataset.ds,n.type==='checkbox'?n.checked:n.value]));}
function dsMessage(wrap,message){wrap.querySelector('.ds-message').textContent=message;}
function datedStatsDiagnostics(source){
  const data=state.data[source]||{},pack=state.categorized.stats?.sources?.[source];
  const result={source,config:datedStatsConfig(source),diagnostics:pack?.diagnostics||{},issues:pack?.issues||[],import:data.lastImport,corrections:data.audit||[],totals:pack?.totals||[]};
  const wrap=dsDialog('Dated Stats diagnostics',`<p>Summary rows are retained separately and never added to representative results. Corrections replace affected measurements and preserve their prior values here.</p><button type="button" data-ds-download>Export full diagnostics</button><pre class="ds-code">${esc(JSON.stringify({...result,issues:result.issues.slice(0,50),corrections:result.corrections.slice(-30),totals:result.totals.slice(0,10)},null,2))}</pre>`);
  wrap.querySelector('[data-ds-download]').onclick=()=>downloadText(source+'_diagnostics.json',JSON.stringify(result,null,2));
}
function openDatedStatsSourceEditor(source){
  const data=state.data[source]||{},c=clonePlain(datedStatsConfig(source)),headers=data.headers||[];
  let fieldIssues=[];try{fieldIssues=datedStatsCategory(source,true,true).issues||[];}catch(_){}
  const wrap=dsDialog(labelSource(source)+' · Source configuration',`<p>Dates and numerical fields are detected automatically. Correct only the fields that need adjustment.</p><div class="grid4">${dsSelect('Representative','repField',headers,c.repField)}${dsSelect('Assigned coach / team','coachField',['',...headers],c.coachField)}${dsSelect('Reporting date label','dateField',headers,c.dateField)}${dsSelect('Historical manager (optional)','managerField',['',...headers],c.managerField)}</div><details><summary>Period alignment for custom analyses (optional)</summary><div class="grid4">${dsSelect('Reporting frequency','frequency',[['week','Weekly'],['day','Daily'],['month','Monthly']],c.calendar.frequency)}${dsSelect('Date label means','label',[['','Choose / review'],['ending','Period ending'],['beginning','Period beginning'],['publication','Publication date']],c.calendar.label)}${dsInput('Publication → start offset in days','offsetDays',c.calendar.offsetDays||0,'number')}${dsSelect('Separate scope field (optional)','scopeField',['',...headers],c.scopeField)}</div><label><input type="checkbox" data-ds="reviewed" ${c.calendar.reviewed?'checked':''}> Use these boundaries for custom period analyses</label></details><p class="hint">Graphs of uploaded fields always use the attached Date. Optional period alignment applies to custom analyses.</p><div class="tableWrap ds-mapping"><table><thead><tr><th>Field</th><th>Measurement type</th><th>Input unit</th><th>Meaning over time</th></tr></thead><tbody>${headers.filter(h=>!['Name','Sheet','Date','Manager'].includes(h)).map(h=>{const f=c.fields[h]||{};return `<tr data-ds-field="${esc(h)}"><th>${esc(h)}<small>${esc([...new Set(fieldIssues.filter(issue=>issue.field===h).map(issue=>issue.reason))].join(' · '))}</small></th><td>${dsSelect('Type','kind',[['','Identifier / not mapped'],['count','Count'],['percentage','Percentage'],['duration','Duration'],['currency','Currency'],['number','Other number']],f.kind)}</td><td>${dsSelect('Unit','inputUnit',[['','Unknown / use cell format'],'number','fraction','percentage-points','per-date','days','minutes','seconds'],f.inputUnit)}</td><td>${dsSelect('Behavior','behavior',['activity','rate','average','snapshot','cumulative'],f.behavior)}</td></tr>`;}).join('')}</tbody></table></div><div data-ds-unit-review></div><div class="row"><button class="green" type="button" data-ds-save>Save source configuration</button></div>`);
  renderDatedStatsUnitReview(wrap,data,c);
  wrap.querySelector('[data-ds-save]').onclick=async()=>{
    try{const v=dsValues(wrap);
      const config={...c,repField:v.repField,coachField:v.coachField,managerField:v.managerField,dateField:v.dateField,scopeField:v.scopeField,calendar:v.reviewed?{reviewed:true,frequency:v.frequency,label:v.label,offsetDays:Number(v.offsetDays)}:{reviewed:false,frequency:'observation'},fields:{}};
      window.AllStarDatedStats.period('2026-09-20',config.calendar);
      wrap.querySelectorAll('[data-ds-field]').forEach(row=>{const f=dsValues(row);if(f.kind)config.fields[row.dataset.dsField]={...c.fields[row.dataset.dsField],kind:f.kind,inputUnit:f.inputUnit,behavior:f.behavior,nonnegative:f.kind==='count'||f.kind==='percentage',unitReviewed:!!c.fields[row.dataset.dsField]?.unitReviewed||f.kind!==c.fields[row.dataset.dsField]?.kind||f.inputUnit!==c.fields[row.dataset.dsField]?.inputUnit};});
      wrap.querySelectorAll('[data-ds-unit-date]').forEach(input=>{const f=config.fields[input.dataset.dsUnitField];if(f){f.unitsByDate=f.unitsByDate||{};f.unitsByDate[input.dataset.dsUnitDate]=input.value;}});
      if(!Object.keys(config.fields).length)throw new Error('Map at least one numerical field.');
      const before=state.data[source];state.data[source]={...before,config,rows:normalizeDatedStatsRawIdentities(before?.rows||[],source,config)};markSourceCacheDirty(source,'Reporting calendar / field units reviewed');markCategorizationNeeded('Dated Stats mapping changed',[source]);
      const saved=await flushImportCacheSave('Dated Stats configuration');if(!saved){state.data[source]=before;throw new Error('Configuration could not be saved.');}await publishDatedStatsSharedSource(source);renderDatedStatsImportSummary();wrap.remove();
    }catch(error){dsMessage(wrap,error.message);}
  };
}
const datedMetricCalculations=[['equal_rep','Average each representative equally'],['combined_rate','Combine all opportunities into one rate'],['sum','Total numerical activity'],['min','Lowest valid measurement'],['max','Highest valid measurement'],['first','Average in the first valid period'],['latest','Average in the latest valid period']];
const datedMetricSummaries=[['change','Change from first to latest'],['slope','Trend per elapsed week'],['average','Average of the period values'],['first','First valid period value'],['latest','Latest valid period value'],['validPeriods','Number of valid periods'],['relativeChange','Relative change from first to latest (%)']];
function datedStatsMetricPresentation(metric){
  const m=metric,standard=window.AllStarDatedStats.standardMetrics(m.source).find(s=>s.id===m.statistic),components=value=>Array.isArray(value)?'('+value.join(' + ')+')':value||'Choose a field';
  const numerator=standard?.numerator||m.numerator,denominator=standard?.denominator||m.denominator;
  const measurement=standard?.name||(numerator&&denominator?'Custom rate':m.expression?'Custom calculation':m.field||'Custom calculation');
  const formula=numerator&&denominator?`${components(numerator)} ÷ ${components(denominator)} × 100`:m.expression||m.field||'Review the measurement definition';
  const calculation=datedMetricCalculations.find(([key])=>key===(m.aggregation||'equal_rep'))?.[1]||'Review calculation';
  const calculationHelp={equal_rep:'Average each representative’s valid periods first, then average those representatives equally. Example: representative averages of 40% and 60% give 50%, regardless of opportunity volume.',combined_rate:'Add the usable numerators and denominators, then divide once. Example: 4 of 10 and 12 of 20 give 16 of 30 = 53.33%. Higher-volume observations carry more weight.',sum:'Add separate activity measurements across eligible representatives and periods. Percentages, snapshots and cumulative totals cannot be summed.',min:'Use the lowest usable representative-period measurement in the selected window.',max:'Use the highest usable representative-period measurement in the selected window.',first:'Find the earliest period with usable measurements, then average the measurements in that period.',latest:'Find the latest period with usable measurements, then average the measurements in that period.'}[m.aggregation||'equal_rep']||'Choose a supported calculation.';
  let windowLabel=m.startDate&&m.endDate?`${m.startDate} through ${m.endDate}`:m.startDate?`From ${m.startDate}`:m.endDate?`Through ${m.endDate}`:'All available complete reporting periods';
  if(Number(m.lastPeriods)>0)windowLabel+=` · latest ${m.lastPeriods} ${m.periodSelection==='valid'?'valid periods per representative':'reporting periods, including gaps'}`;
  const eligibility=`At least ${m.minValidPeriods||1} valid period${Number(m.minValidPeriods||1)===1?'':'s'} per representative${Number(m.minDenominator)>0?' · denominator at least '+m.minDenominator:''}`;
  const output=m.output==='series'?'One value per reporting period':m.output==='summary'?datedMetricSummaries.find(([key])=>key===(m.summary||'change'))?.[1]||'Trend summary':'One value across the selected periods';
  return {measurement,formula,calculation,calculationHelp,window:windowLabel,eligibility,output,summary:`${measurement} · ${formula} · ${calculation} · ${windowLabel} · ${output}`};
}
function datedStatsMetricPreview(metric,result,points,hasRows){
  const p=datedStatsMetricPresentation(metric),unit=result.unit||'',periodUnit=metric.kind==='percentage'?'%':metric.kind==='duration'?'seconds':metric.kind||'number';
  const contributions=result.contributions||points.flatMap(point=>point.contributions||[]),exclusions=result.exclusions||points.flatMap(point=>point.exclusions||[]);
  const periodLabel=period=>period?`${period.start} through ${period.end}`:'—';
  const table=(headers,rows)=>`<div class="tableWrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const cell=value=>`<td>${esc(value)}</td>`,number=value=>value==null?'Unavailable':dsNumber(value);
  const headline=metric.output==='series'?'Reporting-period series':`${number(result.value)} ${unit}`;
  const periods=points.slice(0,30).map(point=>`<tr>${[periodLabel(point.period),`${number(point.value)} ${periodUnit}`,point.eligibleRepresentatives,point.missingRepresentatives,point.numerator==null?'—':dsNumber(point.numerator),point.denominator==null?'—':dsNumber(point.denominator)].map(cell).join('')}</tr>`);
  const usable=contributions.slice(0,30).map(row=>`<tr>${[row.rep||row.repId,periodLabel(row.period),`${number(row.value)} ${periodUnit}`,row.numerator==null?'—':dsNumber(row.numerator),row.denominator==null?'—':dsNumber(row.denominator)].map(cell).join('')}</tr>`);
  const excluded=exclusions.slice(0,30).map(row=>`<tr>${[row.rep||row.repId,periodLabel(row.period),row.reason||row.status||'No usable measurement'].map(cell).join('')}</tr>`);
  return `<p class="hint">Current unsaved draft · ${esc(labelSource(metric.source))} · loaded representatives only · ${esc(p.window)}</p><h3>${esc(p.output)}: ${esc(headline)}</h3><p>${esc(p.formula)} · ${esc(p.calculation)}</p><p class="hint">${esc(p.eligibility)}. Missing or invalid measurements are excluded; valid zeros remain values.</p>${result.eligibleRepresentatives!=null?`<p>${result.eligibleRepresentatives} included representatives · ${result.missingRepresentatives} without usable measurements</p>`:''}${datedStatsSparkline(points)}<details open><summary>Values by reporting period</summary><p class="hint">First ${Math.min(points.length,30)} of ${points.length} periods. A gap is unavailable, not zero.</p>${table(['Complete reporting period','Value','Included representatives','Without usable measurements','Numerator','Denominator'],periods)}</details><details><summary>Why? Included measurements and exclusions</summary><p class="hint">First ${Math.min(contributions.length,30)} of ${contributions.length} usable representative-period contributions. These are measurements, not a count of unique people.</p>${usable.length?table(['Representative','Reporting period','Usable value','Numerator','Denominator'],usable):'<p>No usable contributions for this selected scope.</p>'}<p class="hint">First ${Math.min(exclusions.length,30)} of ${exclusions.length} exclusions.</p>${excluded.length?table(['Representative','Reporting period','Reason excluded'],excluded):'<p>No exclusions were reported for this selected scope.</p>'}<details><summary>Technical evidence</summary><pre class="researchCalcCode">${esc(JSON.stringify({contributions:contributions.slice(0,30),exclusions:exclusions.slice(0,30)},null,2))}</pre></details></details>${hasRows?'':'<p>No loaded observations are available for this preview.</p>'}`;
}
function openDatedStatsMetricEditor(metricId,initialSource='weeklyRetail'){
  const E=window.AllStarDatedStats,existing=state.metrics.find(m=>m.id===metricId),m=existing||E.normalizeMetric({id:id(),name:initialSource==='weeklyRetail'?'Weekly Consumer Appointment Rate':'Weekly Appointment Rate',source:initialSource,statistic:initialSource==='weeklyRetail'?'consumer_ar':'total_ar'});
  const wrap=dsDialog('Dated Stats metric',`<p>A reusable measurement from numerical reporting history. Use it in Models and Research; coaching-session counts remain Dated Items.</p><div class="creationGuide" data-ds-metric-guide><strong>What this metric means</strong><dl data-ds-definition-summary></dl></div><div class="grid2">${dsInput('Metric name','name',m.name)}${dsSelect('Numerical history source','source',[['weeklyRetail','Weekly Retail'],['weeklyReferral','Weekly Referral']],m.source)}</div><section class="ds-metric-measure"><h3>What are you measuring?</h3><div data-ds-metric-fields></div><p class="hint" data-ds-measure-help></p><p class="hint">Changing the measurement replaces its calculation when you save. Hidden inputs stay available while you edit.</p></section><details class="creationSection" data-ds-dates><summary>Which reporting periods? <span class="hint" data-ds-window-summary></span></summary><div class="creationSectionBody grid2">${dsInput('From — include only complete periods','startDate',m.startDate,'date')}${dsInput('Through — include only complete periods','endDate',m.endDate,'date')}${dsInput('Use latest periods (0 = all)','lastPeriods',m.lastPeriods||0,'number')}${dsSelect('Count the latest periods using','periodSelection',[['reporting','Reporting periods, including missing'],['valid','Valid periods per representative']],m.periodSelection||'reporting')}<p class="hint">A period is included only when its full start and end fit inside these dates. Blank dates use all loaded complete periods; latest-period limits apply within that window.</p></div></details><details class="creationSection" data-ds-eligibility><summary>Who has enough usable data? <span class="hint" data-ds-eligibility-summary></span></summary><div class="creationSectionBody grid2">${dsInput('Minimum valid periods per representative','minValidPeriods',m.minValidPeriods||1,'number')}${dsInput('Minimum denominator / opportunities','minDenominator',m.minDenominator||0,'number')}<p class="hint">A representative needs this many usable periods to contribute. A minimum denominator applies to each rate observation. Missing values are excluded with reasons; valid zeros remain values.</p></div></details><details class="creationSection" data-ds-output><summary>What should the result show? <span class="hint" data-ds-output-summary></span></summary><div class="creationSectionBody grid2">${dsSelect('Result shape','output',[['value','One value across the selected periods'],['series','One value per reporting period'],['summary','Summarize the trend over time']],m.output||'value')}${dsSelect('Trend summary','summary',datedMetricSummaries,m.summary||'change')}<p class="hint" data-ds-output-help></p></div></details><div class="creationPreview"><h3>Preview this draft</h3><p class="hint">Uses the existing calculation engine and real loaded reporting history. Previewing does not save this metric.</p><div class="row"><button type="button" data-ds-preview>Calculate preview</button><button type="button" class="green" data-ds-save>Save metric</button></div><div data-ds-result></div></div>`);
  const sourceInput=wrap.querySelector('[data-ds="source"]'),fieldsBox=wrap.querySelector('[data-ds-metric-fields]');
  let showAll=false;try{showAll=localStorage.getItem('allstar.datedMetric.view.v1')==='all';}catch(_){}
  const viewButton=document.createElement('button');viewButton.type='button';viewButton.className='smallBtn';viewButton.textContent='All metric settings';viewButton.setAttribute('aria-pressed','false');fieldsBox.before(viewButton);
  const referenceValue=value=>Array.isArray(value)?JSON.stringify(value):value||'';
  const reference=value=>{if(value.startsWith('[')){try{const values=JSON.parse(value);if(Array.isArray(values)&&values.every(v=>typeof v==='string'))return values;}catch(_){}}return value;};
  const visibility=()=>{const v=dsValues(wrap),mode=v.statistic;for(const [key,visible] of [['field',['field','expression'].includes(mode)],['expression',mode==='expression'],['numerator',mode==='ratio'],['denominator',mode==='ratio'],['periodSelection',Number(v.lastPeriods)>0],['summary',v.output==='summary'],['minDenominator',!['field','expression'].includes(mode)||Number(v.minDenominator)>0]])wrap.querySelector(`[data-ds="${key}"]`)?.closest('.field').classList.toggle('hidden',!showAll&&!visible);viewButton.setAttribute('aria-pressed',String(showAll));};
  viewButton.onclick=()=>{showAll=!showAll;try{localStorage.setItem('allstar.datedMetric.view.v1',showAll?'all':'focused');}catch(_){}wrap.querySelectorAll('.creationSection').forEach(section=>section.open=showAll);visibility();};
  const presentationDraft=()=>{const v=dsValues(wrap);return {...m,...v,statistic:['field','expression','ratio'].includes(v.statistic)?'':v.statistic,numerator:v.statistic==='ratio'?reference(v.numerator):'',denominator:v.statistic==='ratio'?reference(v.denominator):'',expression:v.statistic==='expression'?v.expression:''};};
  const describe=()=>{
    const v=dsValues(wrap),p=datedStatsMetricPresentation(presentationDraft());
    wrap.querySelectorAll('.field').forEach(field=>{const input=field.querySelector('[data-ds]'),label=field.querySelector('label');if(input&&label){input.id=input.id||'datedMetric_'+id();label.htmlFor=input.id;}});
    wrap.querySelector('[data-ds-definition-summary]').innerHTML=[['Measurement',p.measurement],['Formula / value',p.formula],['Calculation',p.calculation],['Dates',p.window],['Usable data',p.eligibility],['Result',p.output]].map(([title,value])=>`<div><dt>${esc(title)}</dt><dd>${esc(value)}</dd></div>`).join('');
    wrap.querySelector('[data-ds-window-summary]').textContent=p.window;wrap.querySelector('[data-ds-eligibility-summary]').textContent=p.eligibility;wrap.querySelector('[data-ds-output-summary]').textContent=p.output;
    wrap.querySelector('[data-ds-measure-help]').textContent=p.calculationHelp+(v.statistic==='expression'?' Use [Field] references and arithmetic from the same representative and reporting period. The selected numerical field supplies its unit and activity behavior.':'');
    wrap.querySelector('[data-ds-output-help]').textContent=v.output==='summary'?'Change in a rate is measured in percentage points; relative change is a percentage. Trend per elapsed week uses real elapsed weeks, including gaps.':'One value combines the selected window; a period series keeps a separate value for each reporting period.';
  };
  const draw=(draft=m)=>{
    const source=sourceInput.value,config=datedStatsConfig(source),fields=Object.keys(config.fields||{}),standard=E.standardMetrics(source);
    const choices=value=>{const saved=referenceValue(value);return ['',...fields,...(saved&&!fields.includes(saved)?[[saved,Array.isArray(value)?value.join(' + ')+' (saved fields)':saved+' (review source mapping)']]:[])];};
    const measurement=draft.statistic||(draft.numerator&&draft.denominator?'ratio':draft.expression?'expression':'field'),measurements=[...standard.map(s=>[s.id,s.name]),['field','Use one numerical field'],['expression','Calculate with an expression'],['ratio','Divide numerator by denominator']];if(!measurements.some(([key])=>key===measurement))measurements.push([measurement,'Saved measurement — review definition']);
    fieldsBox.innerHTML=`<div class="grid3">${dsSelect('Measurement','statistic',measurements,measurement)}${dsSelect('Numerical field / expression units','field',choices(draft.field),draft.field)}${dsSelect('How should values be combined?','aggregation',datedMetricCalculations,draft.aggregation)}</div><div class="grid2">${dsInput('Expression — e.g. [Appointments] + [Other Appointments]','expression',draft.expression||'')}${dsSelect('Numerator — the successful / counted amount','numerator',choices(draft.numerator),referenceValue(draft.numerator))}${dsSelect('Denominator — the eligible / total amount','denominator',choices(draft.denominator),referenceValue(draft.denominator))}</div>`;
    const refresh=()=>{const v=dsValues(wrap),def=config.fields?.[v.field],isRate=!['field','expression'].includes(v.statistic),sumAllowed=!isRate&&def?.behavior==='activity'&&def.kind!=='percentage';for(const o of fieldsBox.querySelector('[data-ds="aggregation"]').options){o.disabled=(o.value==='sum'&&!sumAllowed)||(o.value==='combined_rate'&&!isRate);}if(fieldsBox.querySelector('[data-ds="aggregation"]').selectedOptions[0]?.disabled)dsMessage(wrap,'This calculation is incompatible with the selected measurement. Choose an available calculation; the existing selection has been retained.');};
    fieldsBox.querySelectorAll('select').forEach(s=>s.onchange=()=>{refresh();visibility();describe();});refresh();
    visibility();
  };sourceInput.onchange=()=>draw(dsValues(wrap));draw();describe();if(showAll)wrap.querySelectorAll('.creationSection').forEach(section=>section.open=true);
  const opened=dsValues(wrap),signature=()=>{const {name,...definition}=dsValues(wrap);return stableSerialize(definition);};let previewSignature='';
  const draftChanged=event=>{if(event.target.matches('[data-ds]')){visibility();describe();const result=wrap.querySelector('[data-ds-result]');if(result.textContent&&signature()!==previewSignature){result.classList.add('creationStale');dsMessage(wrap,'Draft changed. Calculate preview to update the result.');}}};
  wrap.addEventListener('input',draftChanged);wrap.addEventListener('change',draftChanged);
  const read=()=>{
    // Merge only edited controls into the complete saved definition; hidden inputs are not new defaults.
    const v=dsValues(wrap),changes=Object.fromEntries(Object.entries(v).filter(([key,value])=>value!==opened[key]));if(existing&&!Object.keys(changes).length)return clonePlain(m);
    const cfg=datedStatsConfig(v.source),f=cfg.fields?.[v.field]||{},base={...m,...changes};
    if(!existing||['source','statistic','field','expression','numerator','denominator'].some(key=>key in changes)){
      Object.assign(base,{...v,statistic:['field','expression','ratio'].includes(v.statistic)?'':v.statistic,kind:v.statistic==='ratio'?'percentage':f.kind,behavior:f.behavior,numerator:v.statistic==='ratio'?reference(v.numerator):'',denominator:v.statistic==='ratio'?reference(v.denominator):'',expression:v.statistic==='expression'?v.expression:''});
      if(v.statistic==='expression')base.behavior=f.behavior||'average';
    }
    const value=E.normalizeMetric(base);if(!value.name.trim())throw new Error('Name the metric.');if(!value.statistic&&!value.expression&&!value.field&&!value.numerator)throw new Error('Choose a numerical measurement.');return value;
  };
  wrap.querySelector('[data-ds-preview]').onclick=()=>{try{const m=read(),rows=datedStatsCategory(m.source).observations||[],res=E.metricResult(rows,m),points=res.points||E.series(rows,m),result=wrap.querySelector('[data-ds-result]');result.classList.remove('creationStale');result.innerHTML=datedStatsMetricPreview(m,res,points,rows.length>0);previewSignature=signature();dsMessage(wrap,'');}catch(error){dsMessage(wrap,error.message);}};
  wrap.querySelector('[data-ds-save]').onclick=async()=>{try{const value=read();if(existing&&stableSerialize(value)===stableSerialize(m)){wrap.remove();return;}const previous=state.metrics;state.metrics=previous.some(saved=>saved.id===value.id)?previous.map(saved=>saved.id===value.id?value:saved):[...previous,value];if(!await saveMetrics()){state.metrics=previous;throw new Error('Metric could not be saved.');}renderMetricList();wrap.remove();}catch(error){dsMessage(wrap,error.message);}};
}
function openDatedStatsConditions(conditions=[],coverage={},onSave){
  let rows=clonePlain(conditions),cover=clonePlain(coverage);
  const wrap=dsDialog('Dated Items population conditions',`<p>Count distinct coaching sessions, checklist records, or call monitors separately from performance measurements. A session with several tags is counted once. Leave dates blank to use the analysis anchor / current plotted week.</p><div data-ds-conditions></div><button type="button" data-ds-add>Add event condition</button><h3>Reviewed event coverage</h3><p>Exact frequency and zero-session groups need complete source coverage for these dates and the selected population. Otherwise the result is Unknown coaching coverage.</p><div data-ds-coverage></div><button type="button" class="green" data-ds-save>Apply conditions and coverage</button>`);
  const render=()=>{
    wrap.querySelector('[data-ds-conditions]').innerHTML=rows.map((r,i)=>`<div class="panel" data-event-row="${i}"><div class="grid4">${dsSelect('Dated Items source','source',[['documented_coaching','Documented Coaching'],['checklist','Checklist'],['qa','Call monitors / QA']],r.source||'documented_coaching')}${dsInput('Topic / text contains (optional)','topic',r.topic||'')}<div class="field"><label>Session / event count</label>${dsOperator(r.operator)}</div>${dsInput('Count','threshold',r.threshold??1,'number')}${dsInput('Upper count','threshold2',r.threshold2??0,'number')}${dsInput('From','startDate',r.startDate,'date')}${dsInput('Through','endDate',r.endDate,'date')}</div><button type="button" class="smallBtn red" data-event-remove="${i}">Remove condition</button></div>`).join('')||'<p>All eligible loaded representatives; no event qualification required.</p>';
    wrap.querySelectorAll('[data-event-remove]').forEach(b=>b.onclick=()=>{read();rows.splice(Number(b.dataset.eventRemove),1);render();});
  };
  const read=()=>{rows=[...wrap.querySelectorAll('[data-event-row]')].map(dsValues);};
  wrap.querySelector('[data-ds-coverage]').innerHTML=['documented_coaching','checklist','qa'].map(source=>{const c=cover[source]||{};return `<div class="panel" data-coverage-source="${source}"><strong>${esc(labelSource(source))}</strong><div class="grid3">${dsInput('Coverage from','start',c.start,'date')}${dsInput('Coverage through','end',c.end,'date')}<label><input type="checkbox" data-ds="complete" ${c.complete?'checked':''}> Complete event coverage for all selected representatives</label></div></div>`;}).join('');
  wrap.querySelector('[data-ds-add]').onclick=()=>{read();rows.push({source:'documented_coaching',operator:'gte',threshold:1});render();};
  wrap.querySelector('[data-ds-save]').onclick=()=>{read();cover=Object.fromEntries([...wrap.querySelectorAll('[data-coverage-source]')].map(n=>[n.dataset.coverageSource,dsValues(n)]));onSave(rows,cover);wrap.remove();};render();
}
function openDatedStatsStatConditions(conditions=[],onSave){
  let rows=clonePlain(conditions);const metrics=state.metrics.filter(m=>m.dataCategory==='datedStats');
  const wrap=dsDialog('Numerical population conditions',`<p>Each condition uses a reusable metric and its own window. Blank dates use the selected anchor or current plotted week. Different conditions are combined with AND.</p><div data-ds-conditions></div><button type="button" data-ds-add>Add numerical condition</button><button type="button" class="green" data-ds-save>Apply conditions</button>`);
  const read=()=>{rows=[...wrap.querySelectorAll('[data-stat-row]')].map(dsValues);};
  const render=()=>{wrap.querySelector('[data-ds-conditions]').innerHTML=rows.map((r,i)=>`<div class="panel" data-stat-row="${i}"><div class="grid4">${dsSelect('Saved metric','metricId',metrics.map(m=>[m.id,m.name]),r.metricId)}${dsSelect('Apply threshold to','mode',[['aggregate','Selected-period aggregate'],['qualifying_periods','Each reporting week'],['trend','Trend summary']],r.mode||'aggregate')}${dsSelect('Trend summary','summary',['change','slope','average','first','latest','validPeriods'],r.summary||'change')}<div class="field"><label>Operator</label>${dsOperator(r.operator)}</div>${dsInput('Threshold','threshold',r.threshold??0,'number')}${dsInput('Upper threshold','threshold2',r.threshold2??0,'number')}${dsInput('Required qualifying weeks','requiredPeriods',r.requiredPeriods||1,'number')}${dsInput('Minimum valid weeks','minPeriods',r.minPeriods||1,'number')}${dsInput('From','startDate',r.startDate,'date')}${dsInput('Through','endDate',r.endDate,'date')}${dsInput('Last periods','lastPeriods',r.lastPeriods||0,'number')}</div><button type="button" class="smallBtn red" data-stat-remove="${i}">Remove</button></div>`).join('');wrap.querySelectorAll('[data-stat-remove]').forEach(b=>b.onclick=()=>{read();rows.splice(Number(b.dataset.statRemove),1);render();});};
  wrap.querySelector('[data-ds-add]').onclick=()=>{read();rows.push({metricId:metrics[0]?.id,operator:'gte'});render();};
  wrap.querySelector('[data-ds-save]').onclick=()=>{read();onSave(rows);wrap.remove();};render();
}
function dsMulti(label,name,options,selected=[]){return `<fieldset class="ds-picker"><legend>${esc(label)}</legend><input type="search" data-ds-search placeholder="Search ${esc(label.toLowerCase())}" aria-label="Search ${esc(label)}"><div>${options.map(([v,l])=>`<label data-ds-choice><input type="checkbox" data-ds-multi="${name}" value="${esc(v)}" ${selected.includes(v)?'checked':''}> ${esc(l)}</label>`).join('')}</div></fieldset>`;}
function openDatedStatsResearchEditor(itemId,preferredSource){
  const item=state.researchItems.find(i=>i.id===itemId),settings=clonePlain(item?.datedStats||{}),metrics=datedStatsAvailableMetrics();
  if(!metrics.length){alert('Upload weekly statistics to choose a numerical field.');return;}
  const selectedMetric=datedStatsResearchMetric(settings)||metrics.find(m=>m.source===preferredSource)||metrics[0];
  let conditions=settings.eventConditions||[],coverage=settings.coverage||{},statConditions=settings.statConditions||[];
  const observations=datedStatsLoadedObservations(),coaches=[...new Set(observations.map(o=>o.coach).filter(Boolean))].sort(),directory=window.CoachToolsStatsDirectory?.grouped()||[],reps=[...new Map(observations.map(o=>[o.repId,o.rep])).entries()];
  const wrap=dsDialog('Weekly Stats Research',`<p>Choose a source, a numerical field, and a display. Its dates are ready to use.</p><div class="grid3">${dsInput('Research title','title',item?.title||'Weekly performance trends')}${dsSelect('Data source','source',['weeklyRetail','weeklyReferral'].map(source=>[source,labelSource(source)]),selectedMetric.source)}${dsSelect('Value','metricId',metrics.filter(m=>m.source===selectedMetric.source).map(m=>[m.id,m.directField?m.field:'Custom metric → '+m.name]),selectedMetric.id)}<div class="field"><label>Date / horizontal axis</label><span data-ds-axis>${esc(labelSource(selectedMetric.source))} → ${esc(datedStatsConfig(selectedMetric.source).dateField)}</span></div>${dsSelect('Display','display',[['line','Line graph']], 'line')}</div><details data-ds-research-options><summary>Filters, grouping, and comparisons</summary><div class="grid3">${dsSelect('Membership','mode',[['fixed','Fixed group from anchor window'],['changing','Membership recalculated each week'],['before_after','Before / after first qualifying coaching']],settings.mode||'fixed')}${dsSelect('One line per','groupBy',[['all','All eligible loaded representatives'],['coach','Assigned coach'],['organization','Organization'],['manager','Manager'],['representative','Representative'],['coaching_frequency','Number of coaching sessions']],settings.groupBy||'all')}${dsInput('Measure from (complete period)','startDate',settings.startDate,'date')}${dsInput('Measure through (complete period)','endDate',settings.endDate,'date')}${dsInput('Anchor / coaching window from','anchorStart',settings.anchorStart,'date')}${dsInput('Anchor / coaching window through','anchorEnd',settings.anchorEnd,'date')}${dsSelect('Coaching-frequency window','frequencyWindow',[['anchor','Selected anchor week / range'],['plotted','Each plotted week'],['fixed','Fixed anchor date range'],['rolling','Rolling complete weeks']],settings.frequencyWindow||'anchor')}${dsInput('Rolling weeks','rollingWeeks',settings.rollingWeeks||4,'number')}${dsInput('Coaching topic (optional)','topic',settings.topic||'')}${dsInput('Frequency buckets (last is +)','buckets',(settings.buckets||[0,1,2,3,4]).join(','))}${dsInput('Weeks before coaching','beforeWeeks',settings.beforeWeeks??4,'number')}${dsInput('Complete weeks after coaching','afterWeeks',settings.afterWeeks??6,'number')}</div><div class="row"><button type="button" data-ds-events>Dated Items conditions / coverage</button><span data-ds-event-count>${conditions.length} conditions</span><button type="button" data-ds-stats>Numerical conditions</button><span data-ds-stat-count>${statConditions.length} conditions</span></div><div class="grid2">${dsMulti('Organizations','orgIds',(state.orgs||[]).map(o=>[o.id,o.name]),settings.orgIds||[])}${dsMulti('Managers','managerNames',[...new Set([...directory.map(g=>g.name),...observations.map(o=>o.manager).filter(Boolean)])].map(name=>[name,name]),settings.managerNames||[])}${dsMulti('Coaches','coachNames',coaches.map(c=>[c,c]),settings.coachNames||[])}${dsMulti('Representatives','selectedRepIds',reps,settings.selectedRepIds||[])}</div><p class="hint">An empty selection includes all eligible representatives in the loaded source. Multiple selected organizations are combined without duplicating representatives. Manager and organization selections use saved current membership; assigned coaches on each point come from that reporting period.</p><div class="grid3">${dsSelect('Optional saved model population','modelId',[['','No model restriction'],...state.models.map(m=>[m.id,m.name])],settings.modelId||'')}${dsInput('Model criterion name (qualification)','modelCriterion',settings.modelCriterion||'')}${dsInput('Criterion value must be at least','modelThreshold',settings.modelThreshold??1,'number')}</div><p class="hint">A saved model/category qualification is static context evaluated in the anchor window. It does not become an invented historical measurement.</p></details><div class="row"><button type="button" data-ds-run>Calculate</button><button type="button" data-ds-cancel>Cancel calculation</button><button type="button" class="green" data-ds-save>Save definition &amp; calculated result</button></div><div data-ds-preview-result></div>`);
  const sourcePicker=wrap.querySelector('[data-ds="source"]'),valuePicker=wrap.querySelector('[data-ds="metricId"]');
  sourcePicker.onchange=()=>{valuePicker.innerHTML=metrics.filter(m=>m.source===sourcePicker.value).map(m=>`<option value="${esc(m.id)}">${esc(m.directField?m.field:'Custom metric → '+m.name)}</option>`).join('');wrap.querySelector('[data-ds-axis]').textContent=labelSource(sourcePicker.value)+' → '+datedStatsConfig(sourcePicker.value).dateField;};
  let result=null,resultSignature='',generation=0;
  wrap.querySelectorAll('[data-ds-search]').forEach(input=>input.oninput=()=>{const q=input.value.toLowerCase();input.closest('fieldset').querySelectorAll('[data-ds-choice]').forEach(l=>l.hidden=!l.textContent.toLowerCase().includes(q));});
  wrap.querySelector('[data-ds-events]').onclick=()=>openDatedStatsConditions(conditions,coverage,(c,v)=>{conditions=c;coverage=v;wrap.querySelector('[data-ds-event-count]').textContent=c.length+' conditions';});
  wrap.querySelector('[data-ds-stats]').onclick=()=>openDatedStatsStatConditions(statConditions,c=>{statConditions=c;wrap.querySelector('[data-ds-stat-count]').textContent=c.length+' conditions';});
  const read=()=>{
    const v=dsValues(wrap),multi={};for(const name of ['orgIds','managerNames','coachNames','selectedRepIds'])multi[name]=[...wrap.querySelectorAll(`[data-ds-multi="${name}"]:checked`)].map(n=>n.value);
    const buckets=v.buckets.split(',').map(n=>Number(n.trim()));if(!buckets.length||buckets[0]!==0||buckets.some((n,i)=>!Number.isInteger(n)||n<0||(i>0&&n<=buckets[i-1])))throw new Error('Buckets must start at 0 and increase, such as 0,1,2,3,4.');
    const metric=metrics.find(m=>m.id===v.metricId);if(!metric)throw new Error('Choose an available numerical field or custom metric.');return normalizeResearchItem({...item,id:item?.id||settings.draftId||(settings.draftId=id()),title:v.title,source:metric.source,outputType:item?.datedStats?.sentenceQuery?item.outputType:'line',cardSize:'full',datedStats:datedStatsSelectMetric({...settings,version:1,...v,...multi,buckets,eventConditions:conditions,coverage,statConditions,coachingSource:'documented_coaching'},metric),columns:[{field:'@'+metric.name,mode:'datedStats'}],groupField:'Date',secondaryGroupField:'Coach',valueMode:'datedStats'});
  };
  const run=async()=>{
    const next=read(),current=++generation,signature=JSON.stringify(next.datedStats);dsMessage(wrap,'Calculating complete reporting periods…');
    wrap.querySelector('[data-ds-preview-result]').innerHTML=researchLoadingStoredBody('Calculating Research…','Preparing the selected sources.');
    await yieldToBrowser();
    if(current!==generation||!wrap.isConnected)return null;
    const calculated=await evaluateDatedStatsResearch(next,{token:{get cancelled(){return current!==generation||!wrap.isConnected;}}});
    if(current!==generation)return null;result=calculated;resultSignature=signature;wrap.querySelector('[data-ds-preview-result]').innerHTML=renderDatedStatsResult(next,calculated);bindDatedStatsCharts(wrap);dsMessage(wrap,`${calculated.data.length} points calculated. Missing weeks remain gaps.`);return next;
  };
  wrap.querySelector('[data-ds-run]').onclick=()=>run().catch(e=>dsMessage(wrap,e.message));
  wrap.querySelector('[data-ds-cancel]').onclick=()=>{generation++;dsMessage(wrap,'Calculation cancelled. Previous saved results retained.');};
  wrap.querySelector('[data-ds-save]').onclick=async()=>{
    try{let next=read();if(!result||JSON.stringify(next.datedStats)!==resultSignature||result.sourceSignature!==JSON.stringify([datedStatsSourceSignature(next.source),state.metrics,state.orgs,['documented_coaching','checklist','qa'].map(source=>state.sourceMeta[source]?.sourceVersion||0)])){next=await run();if(!next)return;}
      state.researchItems=[...state.researchItems.filter(i=>i.id!==next.id),next];saveResearchItems();const saved=await researchSaveRenderedResult(next,result);if(!saved)throw new Error('Definition saved, but the result could not be saved. Retry saving the calculated result.');wrap.remove();await renderResearchCanvasAsync({reason:'Dated Stats saved'});
    }catch(e){dsMessage(wrap,e.message);}
  };
}
async function evaluateDatedStatsResearch(item,progress={}){
  const operation={};datedStatsResearchOperations.set(item.id,operation);
  const cancelled=()=>progress.token?.cancelled||datedStatsResearchOperations.get(item.id)!==operation;
  await yieldToBrowser();
  if(cancelled())throw Object.assign(new Error('Research cancelled.'),{name:'AbortError'});
  const E=window.AllStarDatedStats,s=clonePlain(item.datedStats),metric=datedStatsResearchMetric(s);if(!metric)throw new Error('This Research definition references a missing Dated Stats metric.');
  if(metric.output==='summary')throw new Error('This metric returns a trend summary. Choose a single-value or series metric for period-by-period Research; Models can evaluate the summary.');
  if(s.sentenceQuery?.view==='number')s.resultWindow='range';
  const pack=await datedStatsResearchCategory(metric.source,!!metric.directField,cancelled);
  const dependency=()=>JSON.stringify([datedStatsSourceSignature(metric.source),state.metrics,state.orgs,['documented_coaching','checklist','qa'].map(source=>[state.sourceMeta[source]?.sourceVersion||0,researchSourceMappings()[source]||{}])]),sourceVersion=dependency(),settings={...s},orgs=(state.orgs||[]).filter(o=>s.orgIds?.includes(o.id)),directory=window.CoachToolsStatsDirectory?.grouped()||[];
  const selectedManagers=directory.filter(g=>s.managerNames?.includes(g.name));
  const restrictSets=[];
  if(s.orgIds?.length){if(orgs.length!==s.orgIds.length)throw new Error('A selected organization is missing. Review the population selection.');restrictSets.push(new Set(orgs.flatMap(o=>o.coachNames).map(coachNameKey)));}
  if(s.managerNames?.length){if(metric.directField)settings.managers=s.managerNames;else {if(selectedManagers.length!==s.managerNames.length)throw new Error('A selected manager group is missing. Review the population selection.');restrictSets.push(new Set(selectedManagers.flatMap(g=>g.coaches).map(coachNameKey)));}}
  if(s.coachNames?.length)restrictSets.push(new Set(s.coachNames.map(coachNameKey)));
  const allCoaches=[...new Set(pack.observations.map(o=>o.coach))];settings.coaches=restrictSets.length?allCoaches.filter(c=>restrictSets.every(set=>set.has(coachNameKey(c)))):[];
  if(restrictSets.length&&!settings.coaches.length)throw new Error('No loaded historical coaches match the selected population.');
  settings.organizations=orgs.map(o=>({name:o.name,coaches:o.coachNames}));
  if(settings.groupBy==='organization'&&!settings.organizations.length)settings.organizations=state.orgs.map(o=>({name:o.name,coaches:o.coachNames}));
  settings.currentMembership=!!(s.orgIds?.length||s.managerNames?.length||settings.groupBy==='manager'||settings.groupBy==='organization');
  if(s.selectedRepIds?.length)settings.repIds=s.selectedRepIds;
  settings.statConditions=(s.statConditions||[]).map(c=>{const m=state.metrics.find(m=>m.id===c.metricId);if(!m)throw new Error('A numerical population metric is missing.');if(m.source!==metric.source)throw new Error('Numerical conditions must use the same reporting source/scope as the measured metric. Choose a compatible metric.');return {...c,metric:m};});
  let observations=pack.observations;
  if(s.modelId){
    const model=findModel(s.modelId),criterion=model?.criteria.find(c=>c.name===s.modelCriterion||c.id===s.modelCriterion);if(!criterion)throw new Error('Choose a valid criterion from the saved model for population qualification.');
    const ids=new Map(observations.map(o=>[o.repId,o]));const accepted=[];
    for(const [repId,o] of ids){const value=criterionValue(criterion,{kind:'rep',key:repId,name:o.rep,team:o.coach},{start:parseDateOnly(s.anchorStart),end:parseDateOnly(s.anchorEnd)});if(Number.isFinite(value)&&value>=Number(s.modelThreshold??1))accepted.push(repId);}
    settings.repIds=settings.repIds?settings.repIds.filter(id=>accepted.includes(id)):accepted;
  }
  // Managers only fall back to the saved directory with an explicit current
  // membership label. Never rewrite historical assigned-coach observations.
  if(settings.groupBy==='manager'||metric.directField&&s.managerNames?.length)observations=observations.map(o=>({...o,manager:o.manager||directory.find(g=>g.coaches.some(c=>coachNameKey(c)===coachNameKey(o.coach)))?.name||''}));
  if(s.measure==='calculated'){
    settings.calculation=E.normalizeCalculation(s.calculation);
    for(const part of [settings.calculation.numerator,...(settings.calculation.denominator.kind==='events'?[settings.calculation.denominator]:[])]){
      if(part.field&&!getHeaders(part.source).includes(part.field))throw new Error(`The ${part.label} filter column “${part.field}” is missing. Review the counted items.`);
    }
  }
  const eventSources=[...new Set([...(s.eventConditions||[]).map(c=>c.source),...(s.measure==='calculated'?E.calculationSources(s.calculation):[]),...((s.groupBy==='coaching_frequency'||s.mode==='before_after'||['coaching_count','coaching_per_rep','coached_percent'].includes(s.measure))?[s.coachingSource||'documented_coaching']:[])])];
  const events=datedStatsEvents(eventSources);
  if(events.invalidSources.length){settings.coverage={...settings.coverage};for(const source of events.invalidSources)settings.coverage[source]={...(settings.coverage[source]||settings.coverage),complete:false};}
  const runMetric=m=>E.research(observations,{...m,startDate:s.startDate||m.startDate,endDate:s.endDate||m.endDate},settings,events,{yield:yieldToBrowser,cancelled:()=>cancelled()||sourceVersion!==dependency(),progress:(n,total)=>updateProgress(`Research · ${m.name} · ${n} / ${total} periods`,Math.round(n/total*100))});
  const result=await runMetric(metric);
  if(!s.measure||s.measure==='performance'){
    result.additionalMetrics=[];
    for(const metricId of [...new Set(s.additionalMetricIds||[])].filter(id=>id!==metric.id).slice(0,6)){
      const additional=datedStatsAvailableMetrics().find(m=>m.id===metricId);
      if(!additional||additional.source!==metric.source)throw new Error('An additional statistic is missing or uses a different source. Review the selected values.');
      // All columns must share the same period boundaries.
      if(!!additional.directField!==!!metric.directField)throw new Error('Choose additional values with the same date alignment as the first value.');
      result.additionalMetrics.push({name:additional.name,result:await runMetric(additional)});
    }
  }
  result.calendar=pack.config.calendar;result.sourceSignature=sourceVersion;result.description+=' · '+labelSource(metric.source);result.perf={rowsScanned:observations.length};
  if(metric.directField&&(!s.measure||s.measure==='performance')){
    const grouping={all:'All representatives',coach:'One line per coach',representative:'One line per representative',manager:'One line per manager',organization:'One line per organization',coaching_frequency:'One line per coaching frequency'};
    result.description=metric.name+' · Average of representative values · '+(grouping[settings.groupBy]||grouping.all).replace('One line',settings.resultWindow==='range'?'One value':'One line')+(settings.resultWindow==='range'?' · Entire selected date range':'');
    if(!s.eventConditions?.length&&!s.statConditions?.length&&!s.sentenceQuery?.root?.children?.length&&s.groupBy!=='coaching_frequency'&&s.mode!=='before_after')result.warnings=result.warnings.filter(w=>!w.startsWith('Observed performance comparison'));
  }
  if(datedStatsResearchOperations.get(item.id)===operation)datedStatsResearchOperations.delete(item.id);
  return result;
}
function datedStatsSparkline(points){
  const valid=points.filter(p=>Number.isFinite(p.value));if(!valid.length)return '<span class="hint">No valid numerical observations</span>';
  const low=Math.min(...valid.map(p=>p.value)),high=Math.max(...valid.map(p=>p.value)),range=high-low||1;
  let segments=[],part=[];points.forEach((p,i)=>{if(!Number.isFinite(p.value)){if(part.length)segments.push(part);part=[];}else part.push(`${8+i/Math.max(1,points.length-1)*264},${56-(p.value-low)/range*44}`);});if(part.length)segments.push(part);
  return `<svg viewBox="0 0 280 64" class="ds-sparkline" role="img" aria-label="Trend sparkline; missing periods are gaps">${segments.map(p=>`<polyline points="${p.join(' ')}" fill="none" stroke="currentColor" stroke-width="2"/>`).join('')}</svg>`;
}
const datedStatsChartResults=new Map();
const DATED_CHART_VIEWS_KEY='allstar.datedStatsChartViews.v1';
function datedStatsChartPreferences(value={}){return {...AllStarCharts.linePreferences(value),rolling:[0,2,3,4,6,8,12].includes(Number(value.rolling))?Number(value.rolling):0};}
function datedStatsSavedChartPreferences(itemId){try{return datedStatsChartPreferences(JSON.parse(localStorage.getItem(DATED_CHART_VIEWS_KEY)||'{}')[itemId]||{});}catch(_){return datedStatsChartPreferences();}}
function datedStatsLineControls(prefs){
  return `<details class="ds-line-options"><summary>Line display and labels</summary><div class="grid4">${dsSelect('Rolling average','rolling',[[0,'Off'],[2,'2 weeks / points'],[3,'3 weeks / points'],[4,'4 weeks / points'],[6,'6 weeks / points'],[8,'8 weeks / points'],[12,'12 weeks / points']],prefs.rolling)}${dsSelect('Line display','rollingDisplay',[['overlay','Original + rolling average'],['only','Rolling average only']],prefs.rollingDisplay)}${dsSelect('Line labels','endLabelMode',[['none','No line labels'],['all','All lines (up to 8)'],['top','Top N by average'],['bottom','Bottom N by average'],['both','Top and bottom N by average']],prefs.endLabelMode)}${dsInput('Number at each end (N)','endLabelCount',prefs.endLabelCount,'number')}</div><p class="hint">Dated points use trailing calendar weeks; relative-week charts use that many points. Missing values remain gaps; starting windows use available values. Top/bottom labels rank each visible line’s unsmoothed average over the displayed dates. Other lines stay visible.</p><button type="button" class="smallBtn" data-ds-save-view>Save chart defaults</button><span role="status" data-ds-view-status></span></details>`;
}

function renderDatedStatsResult(item,result){
  const token='ds_'+id(),prefs=datedStatsSavedChartPreferences(item.id);datedStatsChartResults.set(token,{result,itemId:item.id,prefs});if(datedStatsChartResults.size>80)datedStatsChartResults.delete(datedStatsChartResults.keys().next().value);
  const lines=[...new Set((result.data||[]).map(p=>p.line))],palette=['#c6253b','#2668b5','#18806a','#8654a8','#bc6d14','#516174','#b0458b','#1c8495'];
  return `<section class="ds-result" data-ds-chart="${token}"><p><strong>${esc(result.description||'Dated Stats')}</strong></p><p class="hint">${esc(result.savedAt?'Saved snapshot · '+result.savedAt:'Calculated preview · '+(result.calculatedAt||''))} · ${esc((result.warnings||[]).join(' '))}</p><div class="row"><input type="search" data-ds-legend-search placeholder="Search chart lines"><button type="button" class="smallBtn" data-ds-show-all>Show all</button><button type="button" class="smallBtn" data-ds-export>Export definition &amp; evidence JSON</button></div><div class="ds-legend">${lines.map((line,i)=>`<span data-ds-line-option="${esc(line.toLowerCase())}"><label><input type="checkbox" data-ds-line="${i}" checked> <span style="color:${AllStarCharts.colorForIndex(i)}">${esc(line)}</span></label><button type="button" class="smallBtn" data-ds-isolate="${i}">Isolate</button></span>`).join('')}</div>${datedStatsLineControls(prefs)}<div data-ds-plot>${datedStatsPlot(result,lines,prefs)}</div><details><summary>Point values, eligibility, and evidence</summary><div class="tableWrap ds-points"><table><thead><tr><th>Period</th><th>Line</th><th>Value</th><th>Eligible reps</th><th>Missing reps</th><th>Numerator</th><th>Denominator</th></tr></thead><tbody>${(result.data||[]).map((p,i)=>`<tr><td>${esc(p.label)}</td><td>${esc(p.line)}</td><td><button type="button" class="smallBtn" data-ds-point="${i}">${dsNumber(p.value)} ${esc(p.unit||'')}</button></td><td>${p.eligibleRepresentatives}</td><td>${p.missingRepresentatives}</td><td>${dsNumber(p.numerator)}</td><td>${dsNumber(p.denominator)}</td></tr>`).join('')}</tbody></table></div></details></section>`;
}
function datedStatsPlot(result,visibleLines,preferences={}){
  const C=AllStarCharts,prefs=datedStatsChartPreferences(preferences),data=result.data||[],labels=result.axisLabels?.length?result.axisLabels:[...new Set(data.map(p=>p.label))],lines=[...new Set(data.map(p=>p.line))],byLine=new Map();
  data.forEach((p,index)=>{if(!byLine.has(p.line))byLine.set(p.line,new Map());byLine.get(p.line).set(p.label,{...p,sourcePointIndex:index});});
  const series=lines.map(line=>({id:line,name:line,points:labels.map((label,index)=>{const p=byLine.get(line)?.get(label);return {index,label,categoryKey:label,date:/^\d{4}-\d{2}-\d{2}$/.test(label)?Date.parse(label):null,value:Number.isFinite(p?.value)?p.value:null,sourcePointIndex:p?.sourcePointIndex,detail:p?{metric:result.measureLabel||result.definition?.metric?.name,representatives:p.eligibleRepresentatives,numerator:p.numerator,denominator:p.denominator,numeratorLabel:'Numerator',denominatorLabel:'Denominator'}:null};})}));
  const averages=prefs.rolling>1?series.map(s=>{const values=C.weeklyMovingAverage(s.points,prefs.rolling);return {id:s.id+'::rolling',parentId:s.id,name:s.name+' · '+prefs.rolling+(s.points.every(p=>Number.isFinite(p.date))?'-week':'-point')+' rolling average',derived:true,layerKind:'rolling',points:s.points.map((p,i)=>({...p,value:values[i],detail:null}))};}):[];
  const def={type:'line',title:result.measureLabel||result.definition?.metric?.name||'Research trend',lineWidth:2,grid:true,points:true,decimals:2,format:data.some(p=>p.unit==='%')?'percent':'number',...prefs,hiddenSeries:lines.filter(line=>!visibleLines.includes(line))};
  return C.renderSVG(def,{labels:labels.map((label,index)=>({key:label,label,order:index})),series:[...series.map(s=>({...s,suppressed:prefs.rolling>1&&prefs.rollingDisplay==='only'})),...averages]}, {width:1000,height:360,pointAttributes:(s,p)=>p.sourcePointIndex===undefined?'':`data-ds-point="${p.sourcePointIndex}"${s.layerKind==='rolling'?` data-ds-smoothed="${p.value}"`:''}`}).svg;
}

function bindDatedStatsCharts(host){
  host?.querySelectorAll('[data-ds-chart]').forEach(box=>{
    const stored=datedStatsChartResults.get(box.dataset.dsChart);if(!stored)return;const {result,itemId}=stored;let prefs=stored.prefs;datedStatsChartResults.delete(box.dataset.dsChart);const lines=[...new Set(result.data.map(p=>p.line))];
    const evidence=()=>box.querySelectorAll('[data-ds-point]').forEach(b=>{
      const open=()=>{const p=result.data[Number(b.dataset.dsPoint)],rows=[...(p?.contributions||[]),...(p?.exclusions||[])];if(!p)return;dsDialog('Supporting representative values',`${b.hasAttribute('data-ds-smoothed')?`<p>Rolling average: ${dsNumber(Number(b.dataset.dsSmoothed))}. Evidence below is the original value at this reporting point.</p>`:''}<p>${esc(p.line)} · ${esc(p.label)} · ${dsNumber(p.value)} ${esc(p.unit||'')} · ${esc(p.aggregation)}</p><p>${p.eligibleRepresentatives} eligible · ${p.missingRepresentatives} missing · Numerator ${dsNumber(p.numerator)} / denominator ${dsNumber(p.denominator)}</p><div class="tableWrap ds-points"><table><thead><tr><th>Representative</th><th>Assigned coach</th><th>Period</th><th>Value</th><th>Components</th><th>Status / reason</th><th>Source row</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.rep||r.repId)}</td><td>${esc(r.coach||'')}</td><td>${esc(r.period?.key||'')}</td><td>${dsNumber(r.value)}</td><td>${dsNumber(r.numerator)} / ${dsNumber(r.denominator)}</td><td>${esc(r.reason||r.status||'valid')}</td><td>${esc(r.provenance?.file||'')} · ${esc(r.provenance?.row||'')}</td></tr>`).join('')}</tbody></table></div>`);};b.onclick=open;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};
    });
    const redraw=()=>{box.querySelector('[data-ds-plot]').innerHTML=datedStatsPlot(result,[...box.querySelectorAll('[data-ds-line]:checked')].map(n=>lines[Number(n.dataset.dsLine)]),prefs);evidence();};
    const controls=box.querySelector('.ds-line-options');
    const updateControls=()=>{controls.querySelector('[data-ds=rollingDisplay]').disabled=prefs.rolling<2;controls.querySelector('[data-ds=endLabelCount]').disabled=!['top','bottom','both'].includes(prefs.endLabelMode);};
    controls.querySelectorAll('[data-ds]').forEach(control=>control.onchange=()=>{prefs=datedStatsChartPreferences(dsValues(controls));controls.querySelector('[data-ds=endLabelCount]').value=prefs.endLabelCount;updateControls();redraw();});
    box.querySelector('[data-ds-save-view]').onclick=()=>{try{const saved=JSON.parse(localStorage.getItem(DATED_CHART_VIEWS_KEY)||'{}');saved[itemId]=prefs;localStorage.setItem(DATED_CHART_VIEWS_KEY,JSON.stringify(saved));box.querySelector('[data-ds-view-status]').textContent='Chart defaults saved.';}catch(_){box.querySelector('[data-ds-view-status]').textContent='Could not save chart defaults. Your current view is still available.';}};updateControls();
    box.querySelectorAll('[data-ds-line]').forEach(n=>n.onchange=redraw);box.querySelectorAll('[data-ds-isolate]').forEach(b=>b.onclick=()=>{box.querySelectorAll('[data-ds-line]').forEach(n=>n.checked=n.dataset.dsLine===b.dataset.dsIsolate);redraw();});
    box.querySelector('[data-ds-show-all]').onclick=()=>{box.querySelectorAll('[data-ds-line]').forEach(n=>n.checked=true);redraw();};
    box.querySelector('[data-ds-legend-search]').oninput=e=>box.querySelectorAll('[data-ds-line-option]').forEach(n=>n.hidden=!n.dataset.dsLineOption.includes(e.target.value.toLowerCase()));
    box.querySelector('[data-ds-export]').onclick=()=>downloadText('Dated_Stats_Research.json',JSON.stringify(result,null,2));evidence();
  });
}
function initDatedStatsWorkspace(){
  if(document.documentElement.dataset.datedStatsInitialized)return;document.documentElement.dataset.datedStatsInitialized='true';
  document.querySelectorAll('[data-ds-upload]').forEach(input=>input.onchange=async()=>{for(const file of input.files||[]){const ok=await loadDatedStatsFile(input.dataset.dsUpload,file);if(!ok)break;}input.value='';renderDatedStatsImportSummary();});
  const addButton=(anchor,label,onclick)=>{if(!anchor)return;const b=document.createElement('button');b.type='button';b.className='green';b.textContent=label;b.onclick=onclick;anchor.after(b);};
  addButton(document.getElementById('newMetricBtn'),'Create custom weekly metric',()=>openDatedStatsMetricEditor());
  addButton(document.getElementById('addResearchItemBtn'),'Weekly Stats graph',()=>openDatedStatsResearchEditor());
  renderDatedStatsImportSummary();
}
const datedStatsObservationIndexes=new WeakMap(),datedStatsModelTrends=new Map();
function datedStatsObservationIndex(pack){
  if(datedStatsObservationIndexes.has(pack))return datedStatsObservationIndexes.get(pack);
  const index={byRep:new Map(),byCoach:new Map()};
  for(const o of pack.observations||[]){if(!index.byRep.has(o.repId))index.byRep.set(o.repId,[]);index.byRep.get(o.repId).push(o);const coach=coachNameKey(o.coach);if(!index.byCoach.has(coach))index.byCoach.set(coach,[]);index.byCoach.get(coach).push(o);}
  datedStatsObservationIndexes.set(pack,index);return index;
}
function renderDatedStatsUnitReview(wrap,data,config){
  const host=wrap.querySelector('[data-ds-unit-review]'),profiles=data.unitProfiles||window.AllStarDatedStats.profileUnits(data.rows||[],config);
  host.innerHTML=Object.entries(profiles).map(([field,profile])=>`<details class="panel"><summary>Review percentage scale by reporting date: ${esc(field)}</summary><p>Numeric values exist below and above 1. Choose a source-wide unit above, or choose “per-date” and declare each date’s unit. These distributions are evidence, not automatic conversions. Explicit % text is always parsed as written.</p><div class="tableWrap ds-mapping"><table><thead><tr><th>Source date</th><th>Min / max</th><th>Between 0 and 1</th><th>Above 1</th><th>Declared unit</th></tr></thead><tbody>${profile.dates.map(d=>`<tr><td>${esc(d.date)}</td><td>${d.min} / ${d.max}</td><td>${d.lessThanOne}</td><td>${d.aboveOne}</td><td><select data-ds-unit-field="${esc(field)}" data-ds-unit-date="${esc(d.date)}"><option value="">Unknown / exclude</option><option value="fraction" ${config.fields[field]?.unitsByDate?.[d.date]==='fraction'?'selected':''}>Decimal fraction</option><option value="percentage-points" ${config.fields[field]?.unitsByDate?.[d.date]==='percentage-points'?'selected':''}>Percentage points</option></select></td></tr>`).join('')}</tbody></table></div></details>`).join('');
}
const datedStatsResearchOperations=new Map();
function normalizeDatedStatsRawIdentities(rows,source,config){
  return rows.map(row=>{const person=datedStatsIdentity(row[config.repField],source);return {...row,_rep:person.name||String(row[config.repField]||''),_repKey:person.id||'',_team:String(row[config.coachField]||''),_date:row[config.dateField]};});
}
