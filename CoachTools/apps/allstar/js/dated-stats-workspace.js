/* All-Star adapters and editors for the versioned Dated Stats engine.
 * Source rows remain in the established sourceData store. Categorized numerical
 * observations and saved Research snapshots use the existing IndexedDB stores.
 */
'use strict';
function isDatedStatsSource(source){return source==='weeklyRetail'||source==='weeklyReferral';}
function datedStatsHasData(){return ['weeklyRetail','weeklyReferral'].some(s=>state.data[s]?.rows?.length);}
function datedStatsConfig(source){const data=state.data[source]||{};return data.config||window.AllStarDatedStats.defaultConfig(source,data.headers||[]);}
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
function datedStatsCategory(source,required=true){
  const pack=state.categorized.stats?.sources?.[source];
  const signature=datedStatsSourceSignature(source);
  if(required&&(!pack||pack.signature!==signature))throw new Error(`Dated Stats for ${labelSource(source)} need Categorize Data after the source, calendar, or aliases change.`);
  return pack;
}
const datedStatsRosterSignatures=new WeakMap();
function datedStatsRosterSignature(){
  const index=ensureRosterIndex();
  if(!datedStatsRosterSignatures.has(index))datedStatsRosterSignatures.set(index,researchHashText(JSON.stringify(index.rows.map(r=>[r._repKey,r._team,r.sourceArea,r.rosterId]))));
  return datedStatsRosterSignatures.get(index);
}
function datedStatsSourceSignature(source){return JSON.stringify([state.sourceMeta[source]?.sourceVersion||0,datedStatsConfig(source),repAliasCacheSignature(),datedStatsRosterSignature(),window.CoachToolsStatsDirectory?.snapshot().revision||0]);}
async function buildDatedStatsCategory(options={}){
  const prior=state.categorized.stats||{version:1,sources:{}},sources={};
  for(const source of ['weeklyRetail','weeklyReferral']){
    const data=state.data[source];if(!data?.rows?.length)continue;
    const signature=datedStatsSourceSignature(source);
    if(prior.sources?.[source]?.signature===signature){sources[source]=prior.sources[source];continue;}
    const config=clonePlain(datedStatsConfig(source));
    const coachCandidates=[...new Set([...controlRosterRows().map(r=>r._team||r.team),...(window.CoachToolsStatsDirectory?.grouped()||[]).flatMap(g=>g.coaches)].filter(Boolean))],coachCache=new Map();
    const resolveCoach=raw=>{if(coachCache.has(raw))return coachCache.get(raw);const value=window.CoachToolsStatsDirectory?.resolve(raw,'coach')||raw,resolved=resolveWeeklyCoachIdentity(value,'',coachCandidates),result=resolved.method==='unresolved'?{value:String(value||''),method:'historical source label; not in current directory'}:resolved;coachCache.set(raw,result);return result;};
    // Unreviewed weekly calendars cannot corrupt or block existing event builds.
    if(!config.calendar.reviewed){sources[source]={signature,version:1,config,observations:[],diagnostics:{inputRows:data.rows.length,usableObservations:0,missingMappings:['Review reporting calendar']},issues:[],pending:true};continue;}
    const result=await window.AllStarDatedStats.categorizeAsync(data.rows,config,{headers:data.headers,fileName:data.fileName,resolveIdentity:name=>datedStatsIdentity(name,source),resolveCoach,yield:yieldToBrowser,cancelled:()=>options.active&&!options.active(),progress:(done,total)=>updateProgress(`Dated Stats · ${labelSource(source)} · ${done.toLocaleString()} / ${total.toLocaleString()}`,82)});
    if(signature!==datedStatsSourceSignature(source))throw Object.assign(new Error('Dated Stats changed during categorization; previous results were retained.'),{name:'AbortError'});
    sources[source]={...result,signature};
  }
  return {version:1,sources,builtAt:new Date().toISOString()};
}
async function loadDatedStatsFile(source,file,options={}){
  const load=async()=>{
    const wb=options.workbook||await readFileWorkbook(file,{cellDates:false,raw:true}),headers=[],incoming=[];
    for(const sheet of wb.SheetNames||[]){
      // Preserve counts, fraction percentages and Excel date serials. A cell's
      // display text (e.g. 9/6/26 or a rounded 56%) is not its numerical value.
      const aoa=wb.__coachToolsAoaBySheet?.[sheet]||XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:'',raw:true});
      const headerRow=aoa.slice(0,40).findIndex(row=>row.some(v=>norm(v)==='name')&&row.some(v=>norm(v)==='date')&&row.some(v=>norm(v)==='sheet'));
      if(headerRow<0)continue;
      const hs=aoa[headerRow].map(v=>String(v??'').trim());for(const h of hs)if(h&&!headers.includes(h))headers.push(h);
      for(let i=headerRow+1;i<aoa.length;i++){
        const values=aoa[i];if(!values?.some(v=>String(v??'').trim()))continue;
        const row={};hs.forEach((h,j)=>{if(h)row[h]=values[j]??'';});
        const D=window.CoachToolsStatsDirectory;
        for(const [h,role] of [['Name','name'],['Sheet','coach'],['Manager','manager']])if(D&&row[h])row[h]=D.resolve(row[h],role);
        const identity=datedStatsIdentity(row.Name,source);
        incoming.push({...row,_rep:identity.name||row.Name,_repKey:identity.id||'',_rawRep:row.Name,_rawRepKey:fullNameIdentityKey(row.Name),_team:row.Sheet||'',_date:row.Date,_sourceKey:source,_sourceArea:source==='weeklyRetail'?'retail':'referral',_dsRow:i+1,_dsFile:file.name});
        if(i%1000===0){await yieldToBrowser();assertAllStarImportActive();}
      }
    }
    if(!incoming.length)throw new Error('Weekly files need Date, Sheet, and Name headers. No recognized representative rows were found.');
    const previous=state.data[source]||{},config=clonePlain(options.config||wb.__datedStatsConfig||previous.config||window.AllStarDatedStats.defaultConfig(source,headers));
    config.fields={...window.AllStarDatedStats.defaultConfig(source,headers).fields,...config.fields};
    const unitProfiles=window.AllStarDatedStats.profileUnits(options.fromCentral?incoming:[...(previous.rows||[]),...incoming],config);
    // A numeric column that changes scale across periods needs explicit review.
    // Ratio fields may exceed 100%; do not misclassify those as mixed scales.
    for(const [field,profile] of Object.entries(unitProfiles)){if(profile.fraction>10&&profile.points>10&&profile.dates.some(d=>d.aboveOne>d.lessThanOne)&&profile.dates.some(d=>d.lessThanOne>d.aboveOne)&&config.fields[field].bounded!==false&&!config.fields[field].unitReviewed)config.fields[field]={...config.fields[field],inputUnit:'per-date',unitsByDate:{}};}
    const merged=window.AllStarDatedStats.mergeRows(options.fromCentral?[]:(previous.rows||[]),incoming,config,{fileName:file.name});
    // Compare a new shared snapshot with the old one for corrections, while
    // keeping the shared source's authoritative selected population intact.
    const audit=options.fromCentral?window.AllStarDatedStats.mergeRows(previous.rows||[],incoming,config,{fileName:file.name}).audit:merged.audit;
    state.data[source]={fileName:file.name,headers:[...new Set([...(options.fromCentral?[]:previous.headers||[]),...headers])],rows:normalizeDatedStatsRawIdentities(merged.rows,source,config),config,unitProfiles,audit:[...(previous.audit||wb.__datedStatsAudit||[]),...audit],lastImport:merged.counts};
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
  const aoa=[d.headers,...d.rows.map(r=>d.headers.map(h=>r[h]??''))];
  const data={meta:{fileName:d.fileName,totalRows:d.rows.length,datedStatsConfig:d.config,datedStatsAudit:d.audit||[]},workbook:{sheets:['Dated Stats'],data:{'Dated Stats':{aoa}}}};
  try{const saved=await window.CoachToolsData.importDataset(source,data,{originalFileName:d.fileName,rowCount:d.rows.length,classificationMethod:'allstar-dated-stats',validationStatus:'ready'});const meta=window.CoachToolsData.getDatasetVersion?.(source)||saved?.current||saved?.dataset;if(meta){const sync=readAllStarCentralSyncMap();sync[source]=allStarCentralSyncIdentity(meta);localStorage.setItem(ALLSTAR_SYNC_KEY,JSON.stringify(sync));}}
  catch(error){alert('All-Star data was saved, but the shared weekly dataset could not be updated: '+error.message);}
}
function renderDatedStatsImportSummary(){
  const box=document.getElementById('datedStatsImportSummary');if(!box)return;
  box.innerHTML=['weeklyRetail','weeklyReferral'].map(source=>{
    const data=state.data[source]||{},pack=state.categorized.stats?.sources?.[source],d=pack?.diagnostics,ready=pack&&!pack.pending&&pack.signature===datedStatsSourceSignature(source);
    return `<div class="ds-source"><strong>${esc(labelSource(source))}</strong><span>${Number(data.rows?.length||0).toLocaleString()} imported rows · ${ready?'Categorized':'Categorization / calendar review needed'}</span><button type="button" class="smallBtn" data-ds-config="${source}">Review calendar &amp; field types</button><button type="button" class="smallBtn" data-ds-diagnostics="${source}">Diagnostics / corrections</button>${d?`<small>${d.usableObservations||0} usable representative-periods · ${d.periods?.length||0} periods · ${d.invalidValues||0} invalid values · ${d.unresolvedIdentities||0} unresolved identities · ${d.duplicates||0} duplicates · ${d.conflicts||0} conflicts · ${d.summaryRows||0} summaries/headers excluded</small>`:''}</div>`;
  }).join('');
  box.querySelectorAll('[data-ds-config]').forEach(b=>b.onclick=()=>openDatedStatsSourceEditor(b.dataset.dsConfig));
  box.querySelectorAll('[data-ds-diagnostics]').forEach(b=>b.onclick=()=>datedStatsDiagnostics(b.dataset.dsDiagnostics));
}
function evaluateDatedStatsMetric(metric,rows,source,warnings=[]){
  const pack=datedStatsCategory(metric.source);if(pack.pending)throw new Error('Review the reporting calendar, then Categorize Data.');
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
  const events=[];
  for(const source of sources){
    const rows=getRowsRaw(source),hs=getHeaders(source),cfg=getSourceSetting(activeModelForImport(),source)?.columns||{};
    const dateField=cfg.date||cfg.interactionDate||findHeader(hs,['Coaching Date','Date','Incident Date','Interaction Start Time','Created Date','Completed Date']);
    const idField=findHeader(hs,['Coaching ID','Session ID','Evaluation ID','Event ID','Record ID','ID']);
    const textFields=hs.filter(h=>/description|topic|comment|focus|item|notes|category|behavior/i.test(h));
    for(const r of rows){
      const repId=r._repKey||fullNameIdentityKey(r._rep||r[cfg.rep]||r['Associate Name']||r['Associate name']||r['Agent Name']||'');
      const rawDate=r[dateField]||r._date,date=Number.isFinite(window.AllStarDatedStats.day(rawDate))?rawDate:parseDateOnly(rawDate);
      if(!repId||!Number.isFinite(window.AllStarDatedStats.day(date)))continue;
      events.push({source,repId,date:window.AllStarDatedStats.iso(window.AllStarDatedStats.day(date)),id:idField?r[idField]:'',text:textFields.map(h=>r[h]??'').join(' | '),topics:textFields.map(h=>String(r[h]??'')),deliveredBy:r['Coached By']||r['Coaching Delivered By']||''});
    }
  }
  return window.AllStarDatedStats.dedupeEvents(events);
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
  const wrap=dsDialog(labelSource(source)+' · Source configuration',`<p><strong>Data category: Dated Stats</strong> · Numerical reporting observations. Existing Dated Items retain their event calculations.</p><div class="grid4">${dsSelect('Representative','repField',headers,c.repField)}${dsSelect('Assigned coach / team','coachField',['',...headers],c.coachField)}${dsSelect('Reporting date label','dateField',headers,c.dateField)}${dsSelect('Historical manager (optional)','managerField',['',...headers],c.managerField)}${dsSelect('Reporting frequency','frequency',[['week','Weekly'],['day','Daily'],['month','Monthly']],c.calendar.frequency)}${dsSelect('Date label means','label',[['','Choose / review'],['ending','Period ending'],['beginning','Period beginning'],['publication','Publication date']],c.calendar.label)}${dsInput('Publication → start offset in days','offsetDays',c.calendar.offsetDays||0,'number')}${dsSelect('Separate scope field (optional)','scopeField',['',...headers],c.scopeField)}</div><p class="hint">The calendar determines the actual boundaries used to match coaching events. Monthly totals are never converted into weeks. Publication offset is measured from the label to the first day of the measured period.</p><div class="tableWrap ds-mapping"><table><thead><tr><th>Field</th><th>Measurement type</th><th>Input unit</th><th>Meaning over time</th></tr></thead><tbody>${headers.filter(h=>!['Name','Sheet','Date','Manager'].includes(h)).map(h=>{const f=c.fields[h]||{};return `<tr data-ds-field="${esc(h)}"><th>${esc(h)}</th><td>${dsSelect('Type','kind',[['','Identifier / not mapped'],['count','Count'],['percentage','Percentage'],['duration','Duration'],['currency','Currency'],['number','Other number']],f.kind)}</td><td>${dsSelect('Unit','inputUnit',['number','fraction','percentage-points','per-date','days','minutes','seconds'],f.inputUnit)}</td><td>${dsSelect('Behavior','behavior',['activity','rate','average','snapshot','cumulative'],f.behavior)}</td></tr>`;}).join('')}</tbody></table></div><div data-ds-unit-review></div><label><input type="checkbox" data-ds="reviewed" ${c.calendar.reviewed?'checked':''}> I reviewed the reporting calendar and field units</label><div class="row"><button class="green" type="button" data-ds-save>Save source configuration</button></div>`);
  renderDatedStatsUnitReview(wrap,data,c);
  wrap.querySelector('[data-ds-save]').onclick=async()=>{
    try{const v=dsValues(wrap);if(!v.reviewed)throw new Error('Review and confirm the reporting calendar before saving.');
      const config={...c,repField:v.repField,coachField:v.coachField,managerField:v.managerField,dateField:v.dateField,scopeField:v.scopeField,calendar:{reviewed:true,frequency:v.frequency,label:v.label,offsetDays:Number(v.offsetDays)},fields:{}};
      window.AllStarDatedStats.period('2026-09-20',config.calendar);
      wrap.querySelectorAll('[data-ds-field]').forEach(row=>{const f=dsValues(row);if(f.kind)config.fields[row.dataset.dsField]={...c.fields[row.dataset.dsField],kind:f.kind,inputUnit:f.inputUnit,behavior:f.behavior,nonnegative:f.kind==='count'||f.kind==='percentage',unitReviewed:true};});
      wrap.querySelectorAll('[data-ds-unit-date]').forEach(input=>{const f=config.fields[input.dataset.dsUnitField];if(f){f.unitsByDate=f.unitsByDate||{};f.unitsByDate[input.dataset.dsUnitDate]=input.value;}});
      if(!Object.keys(config.fields).length)throw new Error('Map at least one numerical field.');
      const before=state.data[source];state.data[source]={...before,config,rows:normalizeDatedStatsRawIdentities(before?.rows||[],source,config)};markSourceCacheDirty(source,'Reporting calendar / field units reviewed');markCategorizationNeeded('Dated Stats mapping changed',[source]);
      const saved=await flushImportCacheSave('Dated Stats configuration');if(!saved){state.data[source]=before;throw new Error('Configuration could not be saved.');}await publishDatedStatsSharedSource(source);renderDatedStatsImportSummary();wrap.remove();
    }catch(error){dsMessage(wrap,error.message);}
  };
}
function openDatedStatsMetricEditor(metricId,initialSource='weeklyRetail'){
  const E=window.AllStarDatedStats,existing=state.metrics.find(m=>m.id===metricId),m=existing||E.normalizeMetric({id:id(),name:initialSource==='weeklyRetail'?'Weekly Consumer Appointment Rate':'Weekly Appointment Rate',source:initialSource,statistic:initialSource==='weeklyRetail'?'consumer_ar':'total_ar'});
  const wrap=dsDialog('Dated Stats metric',`<p>Reusable numerical definition for Models and Research. Missing values are excluded with reasons; valid zeros remain values.</p><div class="grid2">${dsInput('Metric name','name',m.name)}${dsSelect('Source category / source','source',[['weeklyRetail','Dated Stats → Weekly Retail'],['weeklyReferral','Dated Stats → Weekly Referral']],m.source)}</div><div data-ds-metric-fields></div><div class="grid4">${dsInput('From (complete period)','startDate',m.startDate,'date')}${dsInput('Through (complete period)','endDate',m.endDate,'date')}${dsInput('Last periods (0 = all)','lastPeriods',m.lastPeriods||0,'number')}${dsSelect('Dynamic window counts','periodSelection',[['reporting','Reporting periods, including missing'],['valid','Valid periods per representative']],m.periodSelection||'reporting')}${dsInput('Minimum valid periods per representative','minValidPeriods',m.minValidPeriods||1,'number')}${dsInput('Minimum denominator / opportunities','minDenominator',m.minDenominator||0,'number')}${dsSelect('Output','output',[['value','Single value'],['series','Period series'],['summary','Trend summary']],m.output||'value')}${dsSelect('Summary of the series','summary',['change','slope','average','first','latest','validPeriods','relativeChange'],m.summary||'change')}</div><p class="hint">Equal-representative average first averages each representative’s valid weeks, then averages representatives equally. Combined rates sum matched numerators and denominators. Rate differences are percentage points.</p><div class="row"><button type="button" data-ds-preview>Calculate preview</button><button type="button" class="green" data-ds-save>Save metric</button></div><div data-ds-result></div>`);
  const sourceInput=wrap.querySelector('[data-ds="source"]'),fieldsBox=wrap.querySelector('[data-ds-metric-fields]');
  const draw=()=>{
    const source=sourceInput.value,config=datedStatsConfig(source),fields=Object.keys(config.fields||{}),standard=E.standardMetrics(source);
    fieldsBox.innerHTML=`<div class="grid3">${dsSelect('Measurement','statistic',[...standard.map(s=>[s.id,s.name]),['field','Mapped numerical field'],['expression','Arithmetic expression'],['ratio','Custom numerator / denominator']],m.statistic||(m.expression?'expression':m.numerator&&m.denominator?'ratio':'field'))}${dsSelect('Numerical field','field',fields,m.field)}${dsSelect('Calculation','aggregation',[['equal_rep','Equal-representative average'],['combined_rate','Combined / volume-weighted rate'],['sum','Total numerical activity'],['min','Minimum'],['max','Maximum'],['first','First valid period'],['latest','Latest valid period']],m.aggregation)}</div><div class="grid3">${dsInput('Arithmetic: [Field] + [Field]','expression',m.expression||'')}${dsSelect('Numerator','numerator',['',...fields],typeof m.numerator==='string'?m.numerator:'')}${dsSelect('Denominator','denominator',['',...fields],typeof m.denominator==='string'?m.denominator:'')}</div>`;
    const refresh=()=>{const v=dsValues(wrap),def=config.fields?.[v.field],isRate=!['field','expression'].includes(v.statistic),sumAllowed=!isRate&&def?.behavior==='activity'&&def.kind!=='percentage';for(const o of fieldsBox.querySelector('[data-ds="aggregation"]').options){o.disabled=(o.value==='sum'&&!sumAllowed)||(o.value==='combined_rate'&&!isRate);}if(fieldsBox.querySelector('[data-ds="aggregation"]').selectedOptions[0]?.disabled)fieldsBox.querySelector('[data-ds="aggregation"]').value='equal_rep';};
    fieldsBox.querySelectorAll('select').forEach(s=>s.onchange=refresh);refresh();
  };sourceInput.onchange=draw;draw();
  const read=()=>{
    const v=dsValues(wrap),cfg=datedStatsConfig(v.source),f=cfg.fields?.[v.field]||{},base={...m,...v,statistic:['field','expression','ratio'].includes(v.statistic)?'':v.statistic,kind:v.statistic==='ratio'?'percentage':f.kind,behavior:f.behavior,numerator:'',denominator:'',expression:v.statistic==='expression'?v.expression:''};
    if(v.statistic==='ratio'){base.numerator=v.numerator;base.denominator=v.denominator;}
    if(v.statistic==='expression')base.behavior=f.behavior||'average';
    const value=E.normalizeMetric(base);if(!value.name.trim())throw new Error('Name the metric.');if(!value.statistic&&!value.expression&&!value.field&&!value.numerator)throw new Error('Choose a numerical measurement.');return value;
  };
  wrap.querySelector('[data-ds-preview]').onclick=()=>{try{const m=read(),rows=datedStatsCategory(m.source).observations||[],res=E.metricResult(rows,m),points=E.series(rows,m);wrap.querySelector('[data-ds-result]').innerHTML=`<p><strong>${dsNumber(res.value)} ${esc(res.unit)}</strong> · ${res.eligibleRepresentatives??'Series'} eligible representatives · ${res.missingRepresentatives??'—'} missing</p>${datedStatsSparkline(points)}<p>${res.validPeriods??E.trend(points).validPeriods} valid periods · ${res.exclusions?.length??0} exclusions</p>`;dsMessage(wrap,'');}catch(error){dsMessage(wrap,error.message);}};
  wrap.querySelector('[data-ds-save]').onclick=async()=>{try{const value=read(),previous=state.metrics;state.metrics=[...state.metrics.filter(m=>m.id!==value.id),value];if(!await saveMetrics()){state.metrics=previous;throw new Error('Metric could not be saved.');}renderMetricList();wrap.remove();}catch(error){dsMessage(wrap,error.message);}};
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
function openDatedStatsResearchEditor(itemId){
  const item=state.researchItems.find(i=>i.id===itemId),settings=clonePlain(item?.datedStats||{}),metrics=state.metrics.filter(m=>m.dataCategory==='datedStats');
  if(!metrics.length){alert('Create a Dated Stats metric in Metrics first.');return openDatedStatsMetricEditor();}
  let conditions=settings.eventConditions||[],coverage=settings.coverage||{},statConditions=settings.statConditions||[];
  const observations=Object.values(state.categorized.stats?.sources||{}).flatMap(p=>p.observations||[]),coaches=[...new Set(observations.map(o=>o.coach).filter(Boolean))].sort(),directory=window.CoachToolsStatsDirectory?.grouped()||[],reps=[...new Map(observations.map(o=>[o.repId,o.rep])).entries()];
  const wrap=dsDialog('Dated Stats Research',`<p><strong>Who qualifies → What is measured → What each line represents</strong></p><div class="grid3">${dsInput('Research title','title',item?.title||'Weekly performance trends')}${dsSelect('Reusable numerical metric','metricId',metrics.map(m=>[m.id,m.name]),settings.metricId||metrics[0].id)}${dsSelect('Membership','mode',[['fixed','Fixed group from anchor window'],['changing','Membership recalculated each week'],['before_after','Before / after first qualifying coaching']],settings.mode||'fixed')}${dsSelect('One line per','groupBy',[['all','All eligible loaded representatives'],['coach','Assigned coach'],['organization','Organization'],['manager','Manager'],['representative','Representative'],['coaching_frequency','Number of coaching sessions']],settings.groupBy||'all')}${dsInput('Measure from (complete period)','startDate',settings.startDate,'date')}${dsInput('Measure through (complete period)','endDate',settings.endDate,'date')}${dsInput('Anchor / coaching window from','anchorStart',settings.anchorStart,'date')}${dsInput('Anchor / coaching window through','anchorEnd',settings.anchorEnd,'date')}${dsSelect('Coaching-frequency window','frequencyWindow',[['anchor','Selected anchor week / range'],['plotted','Each plotted week'],['fixed','Fixed anchor date range'],['rolling','Rolling complete weeks']],settings.frequencyWindow||'anchor')}${dsInput('Rolling weeks','rollingWeeks',settings.rollingWeeks||4,'number')}${dsInput('Coaching topic (optional)','topic',settings.topic||'')}${dsInput('Frequency buckets (last is +)','buckets',(settings.buckets||[0,1,2,3,4]).join(','))}${dsInput('Weeks before coaching','beforeWeeks',settings.beforeWeeks??4,'number')}${dsInput('Complete weeks after coaching','afterWeeks',settings.afterWeeks??6,'number')}</div><div class="row"><button type="button" data-ds-events>Dated Items conditions / coverage</button><span data-ds-event-count>${conditions.length} conditions</span><button type="button" data-ds-stats>Numerical conditions</button><span data-ds-stat-count>${statConditions.length} conditions</span></div><div class="grid2">${dsMulti('Organizations','orgIds',(state.orgs||[]).map(o=>[o.id,o.name]),settings.orgIds||[])}${dsMulti('Managers','managerNames',directory.map(g=>[g.name,g.name]),settings.managerNames||[])}${dsMulti('Coaches','coachNames',coaches.map(c=>[c,c]),settings.coachNames||[])}${dsMulti('Representatives','selectedRepIds',reps,settings.selectedRepIds||[])}</div><p class="hint">An empty selection includes all eligible representatives in the loaded source. Multiple selected organizations are combined without duplicating representatives. Manager and organization selections use saved current membership; assigned coaches on each point come from that reporting period.</p><div class="grid3">${dsSelect('Optional saved model population','modelId',[['','No model restriction'],...state.models.map(m=>[m.id,m.name])],settings.modelId||'')}${dsInput('Model criterion name (qualification)','modelCriterion',settings.modelCriterion||'')}${dsInput('Criterion value must be at least','modelThreshold',settings.modelThreshold??1,'number')}</div><p class="hint">A saved model/category qualification is static context evaluated in the anchor window. It does not become an invented historical measurement.</p><div class="row"><button type="button" data-ds-run>Calculate</button><button type="button" data-ds-cancel>Cancel calculation</button><button type="button" class="green" data-ds-save>Save definition &amp; calculated result</button></div><div data-ds-preview-result></div>`);
  let result=null,resultSignature='',generation=0;
  wrap.querySelectorAll('[data-ds-search]').forEach(input=>input.oninput=()=>{const q=input.value.toLowerCase();input.closest('fieldset').querySelectorAll('[data-ds-choice]').forEach(l=>l.hidden=!l.textContent.toLowerCase().includes(q));});
  wrap.querySelector('[data-ds-events]').onclick=()=>openDatedStatsConditions(conditions,coverage,(c,v)=>{conditions=c;coverage=v;wrap.querySelector('[data-ds-event-count]').textContent=c.length+' conditions';});
  wrap.querySelector('[data-ds-stats]').onclick=()=>openDatedStatsStatConditions(statConditions,c=>{statConditions=c;wrap.querySelector('[data-ds-stat-count]').textContent=c.length+' conditions';});
  const read=()=>{
    const v=dsValues(wrap),multi={};for(const name of ['orgIds','managerNames','coachNames','selectedRepIds'])multi[name]=[...wrap.querySelectorAll(`[data-ds-multi="${name}"]:checked`)].map(n=>n.value);
    const buckets=v.buckets.split(',').map(n=>Number(n.trim()));if(!buckets.length||buckets[0]!==0||buckets.some((n,i)=>!Number.isInteger(n)||n<0||(i>0&&n<=buckets[i-1])))throw new Error('Buckets must start at 0 and increase, such as 0,1,2,3,4.');
    const metric=state.metrics.find(m=>m.id===v.metricId);return normalizeResearchItem({...item,id:item?.id||settings.draftId||(settings.draftId=id()),title:v.title,source:metric.source,outputType:'line',cardSize:'full',datedStats:{version:1,...v,...multi,buckets,eventConditions:conditions,coverage,statConditions,coachingSource:'documented_coaching'},columns:[{field:'@'+metric.name,mode:'datedStats'}],groupField:'Date',secondaryGroupField:'Coach',valueMode:'datedStats'});
  };
  const run=async()=>{
    const next=read(),current=++generation,signature=JSON.stringify(next.datedStats);dsMessage(wrap,'Calculating complete reporting periods…');
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
  const E=window.AllStarDatedStats,s=clonePlain(item.datedStats),metric=state.metrics.find(m=>m.id===s.metricId);if(!metric)throw new Error('This Research definition references a missing Dated Stats metric.');
  if(metric.output==='summary')throw new Error('This metric returns a trend summary. Choose a single-value or series metric for period-by-period Research; Models can evaluate the summary.');
  const pack=datedStatsCategory(metric.source);if(pack.pending)throw new Error('Review the reporting calendar and Categorize Data before Research.');
  const dependency=()=>JSON.stringify([datedStatsSourceSignature(metric.source),state.metrics,state.orgs,['documented_coaching','checklist','qa'].map(source=>state.sourceMeta[source]?.sourceVersion||0)]),sourceVersion=dependency(),settings={...s},orgs=(state.orgs||[]).filter(o=>s.orgIds?.includes(o.id)),directory=window.CoachToolsStatsDirectory?.grouped()||[];
  const selectedManagers=directory.filter(g=>s.managerNames?.includes(g.name));
  const restrictSets=[];
  if(s.orgIds?.length){if(orgs.length!==s.orgIds.length)throw new Error('A selected organization is missing. Review the population selection.');restrictSets.push(new Set(orgs.flatMap(o=>o.coachNames).map(coachNameKey)));}
  if(s.managerNames?.length){if(selectedManagers.length!==s.managerNames.length)throw new Error('A selected manager group is missing. Review the population selection.');restrictSets.push(new Set(selectedManagers.flatMap(g=>g.coaches).map(coachNameKey)));}
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
  if(settings.groupBy==='manager')observations=observations.map(o=>({...o,manager:o.manager||directory.find(g=>g.coaches.some(c=>coachNameKey(c)===coachNameKey(o.coach)))?.name||''}));
  const result=await E.research(observations,{...metric,startDate:s.startDate||metric.startDate,endDate:s.endDate||metric.endDate},settings,datedStatsEvents(),{yield:yieldToBrowser,cancelled:()=>progress.token?.cancelled||datedStatsResearchOperations.get(item.id)!==operation||sourceVersion!==dependency(),progress:(n,total)=>updateProgress(`Dated Stats Research · ${n} / ${total} periods`,Math.round(n/total*100))});
  result.calendar=pack.config.calendar;result.sourceSignature=sourceVersion;result.description+=' · '+labelSource(metric.source);result.perf={rowsScanned:observations.length};
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
function renderDatedStatsResult(item,result){
  const token='ds_'+id();datedStatsChartResults.set(token,result);if(datedStatsChartResults.size>80)datedStatsChartResults.delete(datedStatsChartResults.keys().next().value);
  const lines=[...new Set((result.data||[]).map(p=>p.line))],palette=['#c6253b','#2668b5','#18806a','#8654a8','#bc6d14','#516174','#b0458b','#1c8495'];
  return `<section class="ds-result" data-ds-chart="${token}"><p><strong>${esc(result.description||'Dated Stats')}</strong></p><p class="hint">${esc(result.savedAt?'Saved snapshot · '+result.savedAt:'Calculated preview · '+(result.calculatedAt||''))} · ${esc((result.warnings||[]).join(' '))}</p><div class="row"><input type="search" data-ds-legend-search placeholder="Search chart lines"><button type="button" class="smallBtn" data-ds-show-all>Show all</button><button type="button" class="smallBtn" data-ds-export>Export definition &amp; evidence JSON</button></div><div class="ds-legend">${lines.map((line,i)=>`<span data-ds-line-option="${esc(line.toLowerCase())}"><label><input type="checkbox" data-ds-line="${i}" checked> <span style="color:${palette[i%palette.length]}">${esc(line)}</span></label><button type="button" class="smallBtn" data-ds-isolate="${i}">Isolate</button></span>`).join('')}</div><div data-ds-plot>${datedStatsPlot(result,lines)}</div><details><summary>Point values, eligibility, and evidence</summary><div class="tableWrap ds-points"><table><thead><tr><th>Period</th><th>Line</th><th>Value</th><th>Eligible reps</th><th>Missing reps</th><th>Numerator</th><th>Denominator</th></tr></thead><tbody>${(result.data||[]).map((p,i)=>`<tr><td>${esc(p.label)}</td><td>${esc(p.line)}</td><td><button type="button" class="smallBtn" data-ds-point="${i}">${dsNumber(p.value)} ${esc(p.unit||'')}</button></td><td>${p.eligibleRepresentatives}</td><td>${p.missingRepresentatives}</td><td>${dsNumber(p.numerator)}</td><td>${dsNumber(p.denominator)}</td></tr>`).join('')}</tbody></table></div></details></section>`;
}
function datedStatsPlot(result,visibleLines){
  const data=result.data||[],labels=result.axisLabels?.length?result.axisLabels:[...new Set(data.map(p=>p.label))],allLines=[...new Set(data.map(p=>p.line))],palette=['#c6253b','#2668b5','#18806a','#8654a8','#bc6d14','#516174','#b0458b','#1c8495'];
  const valid=data.filter(p=>visibleLines.includes(p.line)&&Number.isFinite(p.value)),values=valid.map(p=>p.value);
  if(!values.length)return '<p>No valid values for the selected lines. Review the periods, mappings, eligibility and coaching coverage.</p>';
  const low=Math.min(0,...values),high=Math.max(...values),range=high-low||1,x=i=>70+i/Math.max(1,labels.length-1)*790,y=v=>250-(v-low)/range*205;
  const pointIndex=new Map(data.map((p,i)=>[p,i]));
  let marks='';
  for(const line of visibleLines){const byLabel=new Map(data.filter(p=>p.line===line).map(p=>[p.label,p])),color=palette[allLines.indexOf(line)%palette.length];let part=[];
    const end=()=>{if(part.length)marks+=`<polyline points="${part.join(' ')}" stroke="${color}" stroke-width="2" fill="none"/>`;part=[];};
    labels.forEach((label,i)=>{const p=byLabel.get(label);if(!p||!Number.isFinite(p.value)){end();return;}part.push(`${x(i)},${y(p.value)}`);});end();
    labels.forEach((label,i)=>{const p=byLabel.get(label);if(!p||!Number.isFinite(p.value))return;marks+=`<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="${color}" tabindex="0" role="button" data-ds-point="${pointIndex.get(p)}" aria-label="${esc(line+' · '+label+' · '+dsNumber(p.value))}"><title>${esc(`${line} · ${label}: ${dsNumber(p.value)} ${p.unit} · ${p.eligibleRepresentatives} eligible · ${p.missingRepresentatives} missing · ${p.numerator??'—'} / ${p.denominator??'—'}`)}</title></circle>`;});
  }
  return `<svg viewBox="0 0 900 300" class="ds-plot" role="img" aria-label="Numerical trends by complete reporting period"><path d="M70 25V250H860" fill="none" stroke="#8c96a5"/><text x="8" y="40">${dsNumber(high)}</text><text x="8" y="253">${dsNumber(low)}</text>${labels.filter((_,i)=>i%Math.max(1,Math.ceil(labels.length/8))===0).map(label=>`<text x="${x(labels.indexOf(label))}" y="278" text-anchor="middle" font-size="11">${esc(label.replace(' (mixed timing)',''))}</text>`).join('')}${marks}</svg>`;
}
function bindDatedStatsCharts(host){
  host?.querySelectorAll('[data-ds-chart]').forEach(box=>{
    const result=datedStatsChartResults.get(box.dataset.dsChart);if(!result)return;datedStatsChartResults.delete(box.dataset.dsChart);const lines=[...new Set(result.data.map(p=>p.line))];
    const evidence=()=>box.querySelectorAll('[data-ds-point]').forEach(b=>{
      const open=()=>{const p=result.data[Number(b.dataset.dsPoint)],rows=[...(p?.contributions||[]),...(p?.exclusions||[])];if(!p)return;dsDialog('Supporting representative values',`<p>${esc(p.line)} · ${esc(p.label)} · ${dsNumber(p.value)} ${esc(p.unit||'')} · ${esc(p.aggregation)}</p><p>${p.eligibleRepresentatives} eligible · ${p.missingRepresentatives} missing · Numerator ${dsNumber(p.numerator)} / denominator ${dsNumber(p.denominator)}</p><div class="tableWrap ds-points"><table><thead><tr><th>Representative</th><th>Assigned coach</th><th>Period</th><th>Value</th><th>Components</th><th>Status / reason</th><th>Source row</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.rep||r.repId)}</td><td>${esc(r.coach||'')}</td><td>${esc(r.period?.key||'')}</td><td>${dsNumber(r.value)}</td><td>${dsNumber(r.numerator)} / ${dsNumber(r.denominator)}</td><td>${esc(r.reason||r.status||'valid')}</td><td>${esc(r.provenance?.file||'')} · ${esc(r.provenance?.row||'')}</td></tr>`).join('')}</tbody></table></div>`);};b.onclick=open;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};
    });
    const redraw=()=>{box.querySelector('[data-ds-plot]').innerHTML=datedStatsPlot(result,[...box.querySelectorAll('[data-ds-line]:checked')].map(n=>lines[Number(n.dataset.dsLine)]));evidence();};
    box.querySelectorAll('[data-ds-line]').forEach(n=>n.onchange=redraw);box.querySelectorAll('[data-ds-isolate]').forEach(b=>b.onclick=()=>{box.querySelectorAll('[data-ds-line]').forEach(n=>n.checked=n.dataset.dsLine===b.dataset.dsIsolate);redraw();});
    box.querySelector('[data-ds-show-all]').onclick=()=>{box.querySelectorAll('[data-ds-line]').forEach(n=>n.checked=true);redraw();};
    box.querySelector('[data-ds-legend-search]').oninput=e=>box.querySelectorAll('[data-ds-line-option]').forEach(n=>n.hidden=!n.dataset.dsLineOption.includes(e.target.value.toLowerCase()));
    box.querySelector('[data-ds-export]').onclick=()=>downloadText('Dated_Stats_Research.json',JSON.stringify(result,null,2));evidence();
  });
}
function initDatedStatsWorkspace(){
  if(document.getElementById('datedStatsImportSummary'))return;
  const panel=document.createElement('section');panel.className='panel';panel.innerHTML=`<div class="panelTitle">Dated Stats · Weekly numerical performance</div><p class="hint">Import weekly history, review reporting dates and field units, then use Categorize Data. Existing Dated Items count events; Dated Stats measure numerical activity.</p><div class="row"><label>Weekly Retail <input type="file" data-ds-upload="weeklyRetail" accept=".csv,.xlsx,.xls" multiple></label><label>Weekly Referral <input type="file" data-ds-upload="weeklyReferral" accept=".csv,.xlsx,.xls" multiple></label></div><div id="datedStatsImportSummary"></div>`;
  document.getElementById('categorizedDataSummary')?.parentElement?.appendChild(panel);
  panel.querySelectorAll('[data-ds-upload]').forEach(input=>input.onchange=async()=>{for(const file of input.files||[]){const ok=await loadDatedStatsFile(input.dataset.dsUpload,file);if(!ok)break;}input.value='';renderDatedStatsImportSummary();});
  const addButton=(anchor,label,onclick)=>{if(!anchor)return;const b=document.createElement('button');b.type='button';b.className='green';b.textContent=label;b.onclick=onclick;anchor.after(b);};
  addButton(document.getElementById('newMetricBtn'),'Create Dated Stats Metric',()=>openDatedStatsMetricEditor());
  addButton(document.getElementById('addResearchItemBtn'),'Dated Stats Trends',()=>openDatedStatsResearchEditor());
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
