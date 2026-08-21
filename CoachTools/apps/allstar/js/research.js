/* Research metrics, builders, joins, caching, calculations, tables, and charts.
 * Behavior-preserving extraction from the definitive All-Star application.
 */
'use strict';

function normalizeMetric(m={}){
  const mainGear={...researchGearDefault(),...(m.gear||m.mainGear||{})};
  if(Array.isArray(m.selectedValues) && !Array.isArray(mainGear.selected)) mainGear.selected=clonePlain(m.selectedValues);
  const normRules=Array.isArray(m.rules)?m.rules.map(r=>{
    const gear={...researchGearDefault(),...(r.gear||{})};
    if(Array.isArray(r.selectedValues) && !Array.isArray(gear.selected)) gear.selected=clonePlain(r.selectedValues);
    return {join:(r.join||'AND').toUpperCase()==='OR'?'OR':'AND',field:r.field||'',op:r.op||'is',value:r.value||'',value2:r.value2||'',selectedValues:Array.isArray(gear.selected)?gear.selected:[],gear};
  }):[];
  const modeMap={total_within:'date_within',percent_within:'date_percent_within'};
  return {id:m.id||id(),name:String(m.name||'New Metric'),source:m.source||allSourceKeys()[0]||'qa',mode:modeMap[m.mode]||m.mode||'count',field:m.field||'',percentOfField:m.percentOfField||m.denominatorField||'',withinCompareField:m.withinCompareField||m.compareField||'',withinUseRange:!!m.withinUseRange,withinDays:m.withinDays||m.days||'',withinRangeMin:m.withinRangeMin||'',withinRangeMax:m.withinRangeMax||'',selectedValues:Array.isArray(mainGear.selected)?mainGear.selected:[],gear:mainGear,rules:normRules,notes:m.notes||''};
}
function isQuotaExceededError(err){ return err && (err.name==='QuotaExceededError' || err.name==='NS_ERROR_DOM_QUOTA_REACHED' || err.code===22 || err.code===1014); }
function safeSetLocalStorage(key,value){
  try{ localStorage.setItem(key,value); return true; }
  catch(err){
    if(isQuotaExceededError(err)) console.warn('[Research Metrics] localStorage quota exceeded for',key);
    else console.warn('[Research Metrics] localStorage write failed for',key,err);
    return false;
  }
}
function openAllStarAppDb(){
  if(!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(METRICS_DB,1);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(METRICS_STORE)) db.createObjectStore(METRICS_STORE,{keyPath:'id'}); };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Could not open metrics database.'));
  });
}
async function saveMetricsToIndexedDB(metrics){
  const db=await openAllStarAppDb();
  try{
    const record={id:METRICS_RECORD_ID,metrics:(metrics||[]).map(normalizeMetric),savedAt:new Date().toISOString(),version:1};
    const tx=db.transaction(METRICS_STORE,'readwrite');
    tx.objectStore(METRICS_STORE).put(record);
    await idbTxDone(tx);
    return record;
  }finally{ db.close(); }
}
async function loadMetricsFromIndexedDB(){
  const db=await openAllStarAppDb();
  try{
    const record=await idbReq(db.transaction(METRICS_STORE,'readonly').objectStore(METRICS_STORE).get(METRICS_RECORD_ID));
    return Array.isArray(record?.metrics) ? record.metrics.map(normalizeMetric) : null;
  }finally{ db.close(); }
}
async function migrateMetricsLocalStorageToIndexedDB(){
  let raw='';
  try{ raw=localStorage.getItem(METRICS_KEY)||''; }catch(err){ console.warn('[Research Metrics] Could not read localStorage metrics',err); return false; }
  if(!raw) return false;
  try{
    const parsed=JSON.parse(raw);
    const metrics=(Array.isArray(parsed)?parsed:(parsed?.metrics||[])).map(normalizeMetric);
    if(!metrics.length) return false;
    const meta=await saveMetricsToIndexedDB(metrics);
    safeSetLocalStorage(METRICS_KEY,JSON.stringify({savedAt:meta.savedAt,count:metrics.length,storage:'indexeddb'}));
    state.metrics=metrics;
    if(els.topStatus) els.topStatus.textContent='Metrics saved locally.';
    return true;
  }catch(err){ console.error('[Research Metrics] Migration failed',err); if(els.topStatus) els.topStatus.textContent='Metric migration failed: '+String(err?.message||err); return false; }
}
async function loadMetrics(){
  try{
    const idbMetrics=await loadMetricsFromIndexedDB();
    if(idbMetrics){ state.metrics=idbMetrics; return true; }
  }catch(err){ console.warn('[Research Metrics] IndexedDB load failed; trying localStorage fallback.',err); }
  try{
    const raw=localStorage.getItem(METRICS_KEY)||'[]';
    const parsed=JSON.parse(raw)||[];
    state.metrics=(Array.isArray(parsed)?parsed:(parsed.metrics||[])).map(normalizeMetric);
    if(state.metrics.length) migrateMetricsLocalStorageToIndexedDB();
    return true;
  }catch(err){ console.warn('[Research Metrics] localStorage load failed',err); state.metrics=[]; return false; }
}
async function saveMetrics(){
  state.metrics=(state.metrics||[]).map(normalizeMetric);
  try{
    const meta=await saveMetricsToIndexedDB(state.metrics);
    safeSetLocalStorage(METRICS_KEY,JSON.stringify({savedAt:meta.savedAt,count:state.metrics.length,storage:'indexeddb'}));
    bumpVersion('metrics'); state.metricCache=new Map(); state.researchMetricCache=new Map(); selectiveResearchInvalidation({reason:'metric definitions changed',metrics:true});
    if(els.topStatus) els.topStatus.textContent='Metrics saved locally.';
    return true;
  }catch(err){
    console.error('[Research Metrics] Save failed',err);
    const msg='Metrics could not be saved locally. IndexedDB may be blocked or browser storage may be full. Your editor remains open so you can retry or export your metrics.';
    if(els.topStatus) els.topStatus.textContent=msg;
    alert(msg);
    return false;
  }
}
function metricRefName(s){ const m=String(s||'').trim().match(/^@(.+)$/)||String(s||'').trim().match(/^metric:(.+)$/i); return m?m[1].trim():''; }
function findMetricByRef(s){ const n=metricRefName(s); if(!n) return null; return (state.metrics||[]).find(m=>m.name===n||m.id===n)||null; }
function metricSuggestions(){ return (state.metrics||[]).map(m=>'@'+m.name); }
function metricEntityKey(row,scope='rep'){
  if(scope==='coach'||scope==='team') return 'team:'+(researchRowTeam(row)||rowTeam(row)||'(blank)');
  return 'rep:'+(personKeyFromRow(row)||'(blank)');
}
function metricGearNumericInvalid(cfg,source,field,rows){ return researchGearNumericInvalid(cfg,{source},field,rows); }
function metricGearRowPass(row,cfg,source,field){ return researchGearRowPass(row,cfg,{source},field); }
function metricGearBucketValue(rows,cfg,source,field){
  const metric=cfg.customValueMetric||'count';
  if(metric==='sum') return (rows||[]).reduce((a,r)=>{ const n=evaluateResearchNumericField(r,field,source); return a+(Number.isFinite(n)?n:0); },0);
  return (rows||[]).length;
}
function applyMetricGear(rows,source,field,cfg,warnings=[]){
  cfg={...researchGearDefault(),...(cfg||{})};
  let out=rows||[];
  if(cfg.valuesEnabled!==false || cfg.customTextEnabled || (cfg.customValueEnabled&&cfg.customValueMetric==='each')) out=out.filter(r=>metricGearRowPass(r,cfg,source,field));
  if(cfg.customValueEnabled && cfg.customValueMetric!=='each'){
    const bad=metricGearNumericInvalid(cfg,source,field,out);
    if(bad){ if(!warnings.includes(bad)) warnings.push(bad); return out; }
    const scope=cfg.metricScope||cfg.valueScope||'rep';
    if((cfg.valueLevel||'level2')==='level1' || scope==='group'){
      return researchGearGroupPass(out,cfg,{source},field) ? out : [];
    }
    const buckets=new Map();
    out.forEach(r=>{ const k=metricEntityKey(r,scope); if(!buckets.has(k)) buckets.set(k,[]); buckets.get(k).push(r); });
    const keep=new Set();
    buckets.forEach((list,k)=>{ const v=metricGearBucketValue(list,cfg,source,field); if(compareResearchGearNumber(v,cfg.customValueOp||'greater/equal',cfg.customValue1,cfg.customValue2)) keep.add(k); });
    out=out.filter(r=>keep.has(metricEntityKey(r,scope)));
  }
  return out;
}
function metricRulePass(row,rule,source){ const gear={...researchGearDefault(),...(rule.gear||{})}; if(rule.field && (gear.customTextEnabled || gear.customValueEnabled || (gear.valuesEnabled!==false && Array.isArray(gear.selected)))) return applyMetricGear([row],source,rule.field,gear,[]).length>0; const v=researchFieldValue(row,rule.field,source), op=rule.op||'is'; if(op==='blank') return String(v??'').trim()===''; if(op==='not blank') return String(v??'').trim()!==''; if((rule.selectedValues||[]).length) return rule.selectedValues.includes(String(v??'(blank)')); if(op==='within days of') return Math.abs(calendarDiffDays(v,rule.value)) <= (Number(rule.value2)||0); const mapped={ 'greater or equal':'greater/equal', 'less or equal':'less/equal' }[op]||op; return compareFilter(v,mapped,rule.value,rule.value2); }
function metricRows(metric,rows,source,warnings=[]){ metric=normalizeMetric(metric); let base=rows||[]; if(metric.field) base=applyMetricGear(base,source,metric.field,metric.gear||{selected:metric.selectedValues},warnings); const andRules=(metric.rules||[]).filter(r=>(r.join||'AND')!=='OR'), orRules=(metric.rules||[]).filter(r=>(r.join||'AND')==='OR'); const passAnd=r=>andRules.every(rule=>metricRulePass(r,rule,source)); if(!orRules.length) return base.filter(passAnd); const set=new Set(); const out=[]; const add=r=>{ if(passAnd(r)&&!set.has(r)){ set.add(r); out.push(r); } }; base.forEach(add); rows.forEach(r=>{ if(orRules.some(rule=>metricRulePass(r,rule,source))) add(r); }); return out; }
function researchMetricRowSignature(rows,source){
  rows=rows||[];
  if(rows===getRowsRaw(source)) return `${researchSourceIndexSignature(source)}|all`;
  state.researchCohortRowSignatures=state.researchCohortRowSignatures||new WeakMap();
  let signature=state.researchCohortRowSignatures.get(rows);
  if(!signature){ signature=`${researchSourceIndexSignature(source)}|cohort${++state.researchCohortSequence}|n${rows.length}`; state.researchCohortRowSignatures.set(rows,signature); }
  return signature;
}
function researchMetricCacheKey(metric,rows,source,item={},col={}){
  const normMetric=normalizeMetric(metric), actualSource=normMetric.source||source;
  const context={
    metricId:normMetric.id||'',
    metric:normMetric,
    source:actualSource,
    rowSignature:researchMetricRowSignature(rows,actualSource),
    itemSource:item.source||'',
    dateColumn:item.dateColumn||'',
    startDate:item.startDate||'',
    endDate:item.endDate||'',
    filters:item.filters||[],
    duplicateReps:!!item.filterDuplicateReps,
    columnMode:col?.mode||'',
    columnField:col?.field||'',
    sourceVersion:researchSourceIndexSignature(actualSource),
    metricVersion:state.versions?.metrics||0,
    modelVersion:state.versions?.models||0,
    rosterVersion:state.versions?.roster||0,
    mappingVersion:state.versions?.mappings||0
  };
  return 'researchMetricV1|'+JSON.stringify(context);
}
function evaluateResearchMetricCached(metric,rows,source,warnings=[],context={}){
  state.researchMetricCache=state.researchMetricCache||new Map();
  const key=researchMetricCacheKey(metric,rows,source,context.item||{},context.col||{});
  const cached=state.researchMetricCache.get(key);
  if(cached){
    (cached.warnings||[]).forEach(w=>{ if(warnings && !warnings.includes(w)) warnings.push(w); });
    return cached.value;
  }
  const before=Array.isArray(warnings)?warnings.length:0;
  const value=evaluateMetric(metric,rows,source,warnings);
  const added=Array.isArray(warnings)?warnings.slice(before):[];
  state.researchMetricCache.set(key,{value,warnings:added});
  return value;
}
function evaluateMetric(metric,rows,source,warnings=[]){
  metric=normalizeMetric(metric); const actualSource=metric.source||source;
  if(metricRefName(metric.field)){ warnings.push('Metric fields cannot reference another metric in this version; circular metric references are blocked.'); return null; }
  const hit=metricRows(metric,rows,actualSource,warnings);
  if(metric.mode==='percent' || metric.mode==='percent_total' || metric.mode==='percent_parent'){
    const denBase=metric.field?applyMetricGear(rows||[],actualSource,metric.field,metric.gear||{selected:metric.selectedValues},warnings).filter(r=>String(researchFieldValue(r,metric.field,actualSource)??'').trim()!==''):(rows||[]);
    const den=denBase.length; if(!den && warnings && !warnings.includes(`${metric.name}: denominator is zero or missing.`)) warnings.push(`${metric.name}: denominator is zero or missing.`);
    return den?hit.length/den*100:0;
  }
  if(metric.mode==='percent_item'){
    const num=researchAggregateColumnValue(hit,{source:actualSource},metric.field,'sum',warnings);
    const den=metric.percentOfField?researchAggregateColumnValue(rows||[],{source:actualSource},metric.percentOfField,'sum',warnings):0;
    if(!den && warnings && !warnings.includes(`${metric.name}: denominator is zero or missing.`)) warnings.push(`${metric.name}: denominator is zero or missing.`);
    return den?num/den*100:0;
  }
  if(['date_within','date_percent_within','value_within','value_percent_within'].includes(metric.mode)){
    const {low,high}=withinBoundsForConfig(metric);
    const stats=withinStatsForRows(hit,actualSource,metric.field,metric.withinCompareField,withinModeKind(metric.mode),low,high,warnings);
    return withinModeIsPercent(metric.mode) ? stats.percent : stats.within;
  }
  if(metric.mode==='count') return hit.length;
  const vals=hit.map(r=>toNum(researchFieldValue(r,metric.field,actualSource))).filter(Number.isFinite);
  if(!vals.length){ warnings.push(`${metric.name}: ${metric.mode==='sum'?'Sum':'Average'} requires numeric values.`); return 0; }
  return metric.mode==='avg'?vals.reduce((a,b)=>a+b,0)/vals.length:vals.reduce((a,b)=>a+b,0);
}
async function openMetricsPage(){ await loadMetrics(); refreshMetricDatalist(); renderMetricList(); openModal('metricsModal'); }
function sourceQualifiedFieldSuggestion(src,h){ return `![${labelSource(src)}].[${plainHeaderName(h)}]`; }
function refreshMetricDatalist(){ const srcs=metricSources(); if(els.metricSourceSelect) els.metricSourceSelect.innerHTML=srcs.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join(''); const opts=[...new Set(srcs.flatMap(src=>getResearchHeaders(src.value).flatMap(h=>[bracketedHeaderSuggestion(h),sourceQualifiedFieldSuggestion(src.value,h)])),...metricSuggestions(),...orgTokenNames())].filter(Boolean).map(h=>`<option value="${esc(h)}"></option>`).join(''); const dl=el('metricHeaderSuggestions'); if(dl) dl.innerHTML=opts; }
function metricFromEditor(){ return normalizeMetric({id:els.metricEditId?.value||id(),name:els.metricNameInput?.value||'New Metric',source:els.metricSourceSelect?.value||'qa',mode:els.metricModeSelect?.value||'count',field:els.metricFieldInput?.value||'',percentOfField:els.metricPercentOfField?.value||'',withinCompareField:els.metricWithinCompareField?.value||'',withinUseRange:!!els.metricWithinUseRange?.checked,withinDays:els.metricWithinDays?.value||'',withinRangeMin:els.metricWithinRangeMin?.value||'',withinRangeMax:els.metricWithinRangeMax?.value||'',selectedValues:state.editingMetricGear?.selected||[],gear:state.editingMetricGear||{},rules:state.editingMetricRules||[],notes:els.metricNotesInput?.value||''}); }
function openMetricEditor(metricId){ refreshMetricDatalist(); const m=(state.metrics||[]).find(x=>x.id===metricId)||normalizeMetric({}); state.editingMetricRules=clonePlain(m.rules||[]); state.editingMetricGear={...researchGearDefault(),...clonePlain(m.gear||{}),selected:clonePlain(m.selectedValues||m.gear?.selected||[])}; els.metricEditId.value=m.id; els.metricNameInput.value=m.name; els.metricSourceSelect.value=m.source; els.metricModeSelect.value=m.mode; els.metricFieldInput.value=m.field; if(els.metricPercentOfField) els.metricPercentOfField.value=m.percentOfField||''; if(els.metricWithinCompareField) els.metricWithinCompareField.value=m.withinCompareField||''; if(els.metricWithinUseRange) els.metricWithinUseRange.checked=!!m.withinUseRange; if(els.metricWithinDays) els.metricWithinDays.value=m.withinDays||''; if(els.metricWithinRangeMin) els.metricWithinRangeMin.value=m.withinRangeMin||''; if(els.metricWithinRangeMax) els.metricWithinRangeMax.value=m.withinRangeMax||''; els.metricNotesInput.value=m.notes||''; updateMetricEditorVisibility(); renderMetricRules(); validateMetricNumeric(); openModal('metricEditorModal'); attachModelReferencePicker(els.metricEditorModal); }
function updateMetricEditorVisibility(){
  const mode=els.metricModeSelect?.value||'count', dateWithin=['date_within','date_percent_within'].includes(mode), valueWithin=['value_within','value_percent_within'].includes(mode), within=dateWithin||valueWithin, percentItem=mode==='percent_item', useRange=!!els.metricWithinUseRange?.checked;
  document.querySelectorAll('[data-metric-percent-item]').forEach(x=>x.classList.toggle('hidden',!percentItem));
  document.querySelectorAll('[data-metric-within]').forEach(x=>x.classList.toggle('hidden',!within));
  document.querySelectorAll('[data-metric-within-days]').forEach(x=>x.classList.toggle('hidden',!within || useRange));
  document.querySelectorAll('[data-metric-within-range]').forEach(x=>x.classList.toggle('hidden',!within || !useRange));
  const fieldLabel=el('metricFieldLabel'), compareLabel=el('metricWithinCompareLabel'), daysLabel=el('metricWithinDaysLabel'), lowLabel=el('metricWithinRangeMinLabel'), highLabel=el('metricWithinRangeMaxLabel');
  if(fieldLabel) fieldLabel.textContent=dateWithin?'First date field selector':(valueWithin?'First value field selector':'Field/Expression');
  if(compareLabel) compareLabel.textContent=dateWithin?'Comparison date field selector':(valueWithin?'Comparison value field selector':'Comparison Field');
  if(daysLabel) daysLabel.textContent=dateWithin?'Days input':'Value within';
  if(lowLabel) lowLabel.textContent=dateWithin?'Min days':'Range low';
  if(highLabel) highLabel.textContent=dateWithin?'Max days':'Range high';
}
function handleMetricModeOrRangeChange(){
  const box=el('metricFoundPreview');
  if(box) box.classList.add('hidden');
  updateMetricEditorVisibility();
  validateMetricNumeric();
}
function renderMetricsPage(activeId){ refreshMetricDatalist(); renderMetricList(activeId); }
function renderMetricList(active){ const q=normalizeResearchText(els.metricSearchInput?.value||''); const rows=(state.metrics||[]).filter(m=>!q || [m.name,m.source,m.mode,m.field].some(v=>normalizeResearchText(v).includes(q))); els.metricsList.innerHTML=rows.map(m=>`<div class="metricListItem ${m.id===active?'active':''}" data-mid="${esc(m.id)}"><strong>${esc(m.name)}</strong><span>${esc(labelSource(m.source)||m.source)}</span><span>${esc(m.mode)}</span><span class="metricListActions"><button class="smallBtn" data-medit="${esc(m.id)}" type="button">Edit</button><button class="smallBtn" data-mdup="${esc(m.id)}" type="button">Duplicate</button><button class="smallBtn red" data-mdel="${esc(m.id)}" type="button">Delete</button></span></div>`).join('')||'<div class="metricListItem"><span>No metrics yet.</span></div>'; els.metricsList.querySelectorAll('[data-medit]').forEach(b=>b.onclick=e=>{e.stopPropagation();openMetricEditor(b.dataset.medit);}); els.metricsList.querySelectorAll('[data-mdup]').forEach(b=>b.onclick=e=>{e.stopPropagation(); const m=(state.metrics||[]).find(x=>x.id===b.dataset.mdup); if(!m) return; const cp=normalizeMetric({...clonePlain(m),id:id(),name:(m.name||'Metric')+' Copy'}); state.metrics.push(cp); saveMetrics().then(ok=>{ if(ok) renderMetricList(cp.id); });}); els.metricsList.querySelectorAll('[data-mdel]').forEach(b=>b.onclick=e=>{e.stopPropagation(); const m=(state.metrics||[]).find(x=>x.id===b.dataset.mdel); if(m&&confirm(`Delete metric "${m.name}"?`)){ const prev=state.metrics; state.metrics=state.metrics.filter(x=>x.id!==m.id); saveMetrics().then(ok=>{ if(ok) renderMetricList(); else state.metrics=prev; }); }}); els.metricsList.querySelectorAll('[data-mid]').forEach(x=>x.onclick=()=>openMetricEditor(x.dataset.mid)); }
function renderMetricRules(){
  const ops=['is','is not','contains','does not contain','is in org','is not in org','includes org','excludes org','blank','not blank','greater than','less than','greater or equal','less or equal','within days of'];
  els.metricRulesList.innerHTML=(state.editingMetricRules||[]).map((r,i)=>`<div class="metricRuleRow"><div class="field"><label>Join type</label><select data-mr="join" data-i="${i}"><option ${r.join!=='OR'?'selected':''}>AND</option><option ${r.join==='OR'?'selected':''}>OR</option></select></div><div class="field"><label>Field/Expression</label><div class="researchInputGear"><input data-mr="field" data-i="${i}" list="metricHeaderSuggestions" value="${esc(r.field||'')}"><button class="smallBtn researchGearBtn" data-mr-field-gear="${i}" type="button">⚙</button></div></div><div class="field"><label>Operator</label><select data-mr="op" data-i="${i}">${ops.map(o=>`<option value="${o}" ${r.op===o?'selected':''}>${o}</option>`).join('')}</select></div><div class="field"><label>Value</label><div class="researchInputGear"><input data-mr="value" data-i="${i}" value="${esc(r.value||'')}"><button class="smallBtn researchGearBtn" data-mr-gear="${i}" type="button">⚙</button></div></div><button class="smallBtn red" data-mr-remove="${i}" type="button">Remove Item</button></div>`).join('');
  els.metricRulesList.querySelectorAll('[data-mr]').forEach(x=>x.oninput=x.onchange=()=>{state.editingMetricRules[+x.dataset.i][x.dataset.mr]=x.value;});
  els.metricRulesList.querySelectorAll('[data-mr-remove]').forEach(b=>b.onclick=()=>{state.editingMetricRules.splice(+b.dataset.mrRemove,1);renderMetricRules();});
  els.metricRulesList.querySelectorAll('[data-mr-gear]').forEach(b=>b.onclick=()=>openMetricRuleValuePicker(+b.dataset.mrGear));
  els.metricRulesList.querySelectorAll('[data-mr-field-gear]').forEach(b=>b.onclick=()=>openMetricRuleFieldGear(+b.dataset.mrFieldGear));
  attachModelReferencePicker(els.metricRulesList);
}
function metricDistinctValues(field,source){ return researchGearUniqueValues(getResearchSourceRows(source),field,source); }
function metricGearPopup({title,source,field,cfg,onApply}){
  if(!field) return alert('Choose a Field/Expression first.');
  cfg={...researchGearDefault(),...(cfg||{})};
  const rows=getResearchSourceRows(source), vals=metricDistinctValues(field,source), selected=Array.isArray(cfg.selected)?new Set(cfg.selected):new Set(vals), bad=metricGearNumericInvalid(cfg,source,field,rows);
  const wrap=document.createElement('div'); wrap.className='researchGearModal';
  wrap.innerHTML=`<div class="researchGearBox"><h3>${esc(title||('Filter values for '+field))}</h3><input data-mg="search" placeholder="Search values"><div class="researchGearFilters"><label><input data-mg="valuesEnabled" type="checkbox" ${cfg.valuesEnabled!==false?'checked':''}> Values</label><label>Value Level <select data-mg="valueLevel"><option value="level1">Level 1: whole group</option><option value="level2">Level 2: rep/coach buckets</option></select></label><label>Scope <select data-mg="metricScope"><option value="rep">Rep level</option><option value="coach">Coach/team level</option><option value="group">Current group only</option></select></label><label><input data-mg="customValueEnabled" type="checkbox" ${cfg.customValueEnabled?'checked':''}> Custom value</label><label><input data-mg="customTextEnabled" type="checkbox" ${cfg.customTextEnabled?'checked':''}> Custom text</label></div><div><button class="smallBtn" data-mg-btn="all" type="button">Select All</button> <button class="smallBtn" data-mg-btn="none" type="button">Unselect All</button></div><div class="researchGearValues" data-mg-list>${vals.map(v=>`<label class="researchGearValue" data-v="${esc(v.toLowerCase())}"><input type="checkbox" data-mg-val="${esc(v)}" ${selected.has(v)?'checked':''}> <span>${esc(v)}</span></label>`).join('')||'<div class="hint">No values found.</div>'}</div><div class="researchGearCustom ${bad?'invalid':''}" data-mg-custom-value><strong>Custom value</strong><div class="researchStepGrid"><select data-mg="customValueMetric"><option value="count">Count of items</option><option value="sum">Sum of items</option><option value="each">Each individual item</option></select><select data-mg="customValueOp"><option value="greater/equal">Greater than or equal to</option><option value="greater than">Greater than</option><option value="less than">Less than</option><option value="less/equal">Less than or equal to</option><option value="between">Between</option></select><input data-mg="customValue1" type="number" step="any" placeholder="Value"><input data-mg="customValue2" type="number" step="any" placeholder="High value"></div><div class="hint">Use Level 2 + Rep level for “reps with exactly/at least 2 coachings,” or Coach/team level to compare coaches.</div><div class="researchGearWarn">${esc(bad)}</div></div><div class="researchGearCustom"><strong>Custom text</strong><div class="researchStepGrid"><select data-mg="customTextOp"><option>Contains</option><option>Is</option><option>Does not contain</option></select><input data-mg="customText" placeholder='"save the sale" "cash" or free text'></div></div><div class="modalFoot"><button class="dark" data-mg-btn="cancel">Cancel</button><button class="green" data-mg-btn="apply">Save / Apply</button></div></div>`;
  document.body.appendChild(wrap);
  ['valueLevel','metricScope','customValueMetric','customValueOp','customValue1','customValue2','customText'].forEach(k=>{ const x=wrap.querySelector(`[data-mg="${k}"]`); if(x) x.value=cfg[k]||''; });
  if(wrap.querySelector('[data-mg="customTextOp"]')) wrap.querySelector('[data-mg="customTextOp"]').value=(cfg.customTextOp||'contains').replace(/^./,m=>m.toUpperCase());
  wrap.querySelector('[data-mg="search"]').oninput=e=>wrap.querySelectorAll('[data-v]').forEach(l=>l.classList.toggle('hidden',!l.dataset.v.includes(e.target.value.toLowerCase())));
  wrap.querySelector('[data-mg-btn="all"]').onclick=()=>wrap.querySelectorAll('[data-mg-val]').forEach(x=>x.checked=true);
  wrap.querySelector('[data-mg-btn="none"]').onclick=()=>wrap.querySelectorAll('[data-mg-val]').forEach(x=>x.checked=false);
  wrap.querySelector('[data-mg-btn="cancel"]').onclick=()=>wrap.remove();
  wrap.querySelector('[data-mg-btn="apply"]').onclick=()=>{ const next={...researchGearDefault()}; wrap.querySelectorAll('[data-mg]').forEach(x=>{ if(x.type==='checkbox') next[x.dataset.mg]=x.checked; else next[x.dataset.mg]=x.value; }); next.customTextOp=String(next.customTextOp||'contains').toLowerCase(); next.selected=[...wrap.querySelectorAll('[data-mg-val]:checked')].map(x=>x.dataset.mgVal); const err=metricGearNumericInvalid(next,source,field,rows); if(err){ const area=wrap.querySelector('[data-mg-custom-value]'); area.classList.add('invalid'); area.querySelector('.researchGearWarn').textContent=err; return; } onApply(next); wrap.remove(); };
}
function openMetricRuleFieldGear(i){ const r=state.editingMetricRules[i]; if(!r||!r.field) return alert('Choose a rule Field/Expression first.'); metricGearPopup({title:'Rule filter options for '+r.field,source:els.metricSourceSelect.value,field:r.field,cfg:r.gear||{selected:r.selectedValues},onApply:gear=>{ r.gear=gear; r.selectedValues=gear.selected||[]; r.value=(gear.selected||[]).join(', '); renderMetricRules(); }}); }
function openMetricRuleValuePicker(i){ return openMetricRuleFieldGear(i); }
function openMetricValuePicker(){ const field=els.metricFieldInput.value; if(!field) return alert('Choose a Field/Expression first.'); metricGearPopup({title:'Metric field options for '+field,source:els.metricSourceSelect.value,field,cfg:state.editingMetricGear,onApply:gear=>{ state.editingMetricGear=gear; }}); }
function validateMetricNumeric(){ const mode=els.metricModeSelect?.value, need=['sum','avg','percent_item','value_within','value_percent_within'].includes(mode), needDate=['date_within','date_percent_within'].includes(mode), m=metricFromEditor(); let res=need?researchNumericValidation({source:m.source},m.field):(needDate?(researchFieldLooksDate({source:m.source},m.field)?{ok:true}:{ok:false,message:'This dates-within metric requires a date field.'}):{ok:true}); if(res.ok && mode==='percent_item'){ if(!String(m.percentOfField||'').trim()) res={ok:false,message:'% of item requires a denominator item.'}; else res=researchNumericValidation({source:m.source},m.percentOfField); } if(res.ok && (needDate||mode==='value_within'||mode==='value_percent_within') && !String(m.withinCompareField||'').trim()) res={ok:false,message:'Within metrics require a comparison field.'}; if(res.ok && ['value_within','value_percent_within'].includes(mode)) res=researchNumericValidation({source:m.source},m.withinCompareField); if(els.metricNumericWarn){ els.metricNumericWarn.textContent=res.ok?'':res.message; els.metricNumericWarn.classList.toggle('hidden',res.ok); } els.metricFieldInput?.classList.toggle('researchInvalid',!res.ok); return res.ok; }
async function saveMetricFromEditor(exit=false){ const m=metricFromEditor(); if(!m.name.trim()) return alert('Metric Name is required.'); if(metricRefName(m.field)) return alert('Metrics cannot reference other metrics in this version.'); if(!validateMetricNumeric()) return alert(els.metricNumericWarn?.textContent||'Metric needs a valid field selection.'); const prev=clonePlain(state.metrics||[]); const i=state.metrics.findIndex(x=>x.id===m.id); if(i>=0) state.metrics[i]=m; else state.metrics.push(m); const ok=await saveMetrics(); if(!ok){ state.metrics=prev; return false; } renderMetricsPage(m.id); populateResearchFieldSelectors(currentResearchItemFromEditor?.()||{}); renderMetricList(m.id); if(exit) closeModal('metricEditorModal'); return true; }

function renderMetricFoundPreview(){
  const box=el('metricFoundPreview'), badge=el('metricPreviewSummary'); if(!box) return;
  const metric=metricFromEditor(), source=metric.source, warnings=[];
  const rows=getResearchSourceRows(source);
  const found=metricRows(metric,rows,source,warnings);
  const uniqueReps=uniqueCount(found,'',source);
  let denominator='';
  if(['percent','percent_total','percent_parent'].includes(metric.mode)){
    const denRows=metric.field?applyMetricGear(rows,source,metric.field,metric.gear||{},warnings).filter(r=>String(researchFieldValue(r,metric.field,source)??'').trim()!==''):rows;
    denominator=` · Denominator ${denRows.length.toLocaleString()}`;
  }
  const sample=found.slice(0,50);
  const cols=['_rep','_team',metric.field,...(metric.rules||[]).map(r=>r.field)].filter(Boolean);
  const headers=[...new Set(cols)].slice(0,6);
  const sampleTable=sample.length?`<div class="researchTableWrap"><table><thead><tr>${headers.map(h=>`<th>${esc(researchDisplayFieldLabel(h,h))}</th>`).join('')}</tr></thead><tbody>${sample.map(r=>`<tr>${headers.map(h=>`<td>${esc(researchFieldValue(r,h,source)??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="hint">No matching rows found for this metric.</div>';
  const warnHtml=warnings.length?warnings.map(w=>`<div class="researchWarn">${esc(w)}</div>`).join(''):'';
  if(badge) badge.textContent=`${found.length.toLocaleString()} rows · ${uniqueReps.toLocaleString()} reps${denominator}`;
  box.classList.remove('hidden');
  box.innerHTML=`<div class="researchPreviewSummary"><span class="badge">${esc(labelSource(source))}</span><span class="badge">${found.length.toLocaleString()} found</span><span class="badge">${uniqueReps.toLocaleString()} unique reps</span>${['percent','percent_total','percent_parent','percent_item','date_percent_within','value_percent_within'].includes(metric.mode)?`<span class="badge">Preview value: ${formatResearchValue(evaluateMetric(metric,rows,source,warnings),{decimals:1,valueMode:metric.mode,showPercent:true})}</span>`:''}</div>${warnHtml}<div class="hint">Showing up to 50 matching rows so you can verify the metric before using it in Research.</div>${sampleTable}`;
}

function exportMetricsConfig(){ downloadText('all_star_research_metrics.txt',JSON.stringify({version:2,metrics:state.metrics||[],customSources:(state.customSources||[]).map(c=>({...clonePlain(c),rows:[],aoaBySheet:{}}))},null,2)); }
async function importMetricsConfig(text){ const obj=JSON.parse(text); if(obj&&Array.isArray(obj.customSources)){ obj.customSources.forEach(def=>{ if(def.sourceKey&&!customSource(def.sourceKey)) state.customSources.push({...def,rows:def.rows||[],headers:def.headers||[],aoa:def.aoa||[],aoaBySheet:def.aoaBySheet||{}}); }); renderCustomSourcesList(); } state.metrics=(Array.isArray(obj)?obj:(obj.metrics||[])).map(normalizeMetric); const ok=await saveMetrics(); if(ok) renderMetricsPage(state.metrics[0]?.id); return ok; }


function normalizeResearchColumnRule(rule={},type='format'){
  const opMap={'equals':'is','equal':'is','greater than or equal to':'greater/equal','greater or equal':'greater/equal','above':'greater than','below':'less than','less than or equal to':'less/equal','less or equal':'less/equal'};
  const op=opMap[String(rule.op||'').toLowerCase()] || rule.op || (type==='display'?'greater/equal':'greater than');
  const out={id:rule.id||id(),op,value:rule.value??rule.threshold??'',value2:rule.value2??rule.high??''};
  if(type==='display'){
    out.expression=rule.expression??rule.expr??'value';
    out.display=rule.display??rule.result??rule.text??'';
  }else{
    out.color=rule.color||'yellow';
  }
  return out;
}
function normalizeResearchColumn(c={}){
  const modeMap={total_within:'date_within',percent_within:'date_percent_within',countby:'count_by',countBy:'count_by','count by':'count_by','Count By':'count_by'};
  const nc={...c,mode:(c.mode==='checklistCount'||c.mode==='Checklist Count')?'count':(modeMap[c.mode]||c.mode||'count'),percentOfField:c.percentOfField||c.denominatorField||'',withinCompareField:c.withinCompareField||c.compareField||'',withinUseRange:!!c.withinUseRange,withinDays:c.withinDays||c.days||'',withinRangeMin:c.withinRangeMin||'',withinRangeMax:c.withinRangeMax||''};
  nc.measureId=c.measureId||researchMeasureIdFromRef(c.field);
  nc.missingBehavior=['missing','zero','warn'].includes(c.missingBehavior)?c.missingBehavior:'missing';
  nc.formatRules=Array.isArray(c.formatRules)?c.formatRules.map(r=>normalizeResearchColumnRule(r,'format')):[];
  nc.displayRules=Array.isArray(c.displayRules)?c.displayRules.map(r=>normalizeResearchColumnRule(r,'display')):[];
  nc.elseDisplay=c.elseDisplay??'';
  nc.customTitle=c.customTitle??c.displayTitle??'';
  nc.displayTitle=nc.customTitle;
  nc.percentBuilder=normalizePercentBuilder(c.percentBuilder||{},{});
  return nc;
}
function researchColumnOperatorOptions(selected){
  return ['greater than','greater/equal','less than','less/equal','between','contains','is'].map(o=>`<option value="${esc(o)}" ${selected===o?'selected':''}>${esc({'greater/equal':'greater than or equal to','less/equal':'less than or equal to'}[o]||o)}</option>`).join('');
}
function researchColumnColorOptions(selected){
  const colors=[['yellow','Yellow','#fef3c7'],['green','Green','#dcfce7'],['red','Red','#fee2e2'],['blue','Blue','#dbeafe'],['purple','Purple','#ede9fe'],['gray','Gray','#f3f4f6']];
  return colors.map(([v,l,hex])=>`<option value="${esc(v)}" ${selected===v?'selected':''}>${esc(l)}</option>`).join('');
}
function researchColumnColorHex(color){
  return ({yellow:'#fef3c7',green:'#dcfce7',red:'#fee2e2',blue:'#dbeafe',purple:'#ede9fe',gray:'#f3f4f6'})[color]||color||'';
}
function researchColumnTextColor(color){
  return ({red:'#7f1d1d',green:'#14532d',yellow:'#713f12',blue:'#1e3a8a',purple:'#4c1d95',gray:'#111827'})[color]||'#111827';
}
function researchColumnRulesCount(c){ return (c.formatRules?.length||0)+(c.displayRules?.length||0)+(String(c.elseDisplay||'').trim()?1:0); }
function researchColumnRulesSummary(c){
  const parts=[]; if(c.formatRules?.length) parts.push(`${c.formatRules.length} highlight`); if(c.displayRules?.length) parts.push(`${c.displayRules.length} display`); if(String(c.elseDisplay||'').trim()) parts.push('else'); return parts.join(' · ');
}
function researchCompareColumnRule(left,op,value,value2){
  const mapped={'greater than or equal to':'greater/equal','less than or equal to':'less/equal','equals':'is','equal':'is'}[String(op||'').toLowerCase()]||op;
  return compareFilter(left,mapped||'is',value,value2);
}
function researchColumnRuleExpressionValue(rule,rawValue,rows,item,ctx,warnings=[]){
  const expr=String(rule.expression??'value').trim();
  if(!expr || /^value$/i.test(expr)) return rawValue;
  const literal=Number.isFinite(toNum(rawValue)) ? String(toNum(rawValue)) : JSON.stringify(String(rawValue??''));
  const prepared=expr.replace(/\{\s*value\s*\}|\bvalue\b/gi,literal);
  return evaluateResearchExpressionInContext(prepared,rows,item,warnings);
}
function researchColumnDisplayRawValue(rawValue,item,col,rows,ctx,warnings=[]){
  col=normalizeResearchColumn(col||{});
  for(const rule of (col.displayRules||[])){
    const left=researchColumnRuleExpressionValue(rule,rawValue,rows,item,ctx,warnings);
    if(researchCompareColumnRule(left,rule.op,rule.value,rule.value2)) return rule.display;
  }
  return String(col.elseDisplay||'').trim()?col.elseDisplay:rawValue;
}
function researchColumnCellStyle(rawValue,item,col,rows,ctx,warnings=[]){
  col=normalizeResearchColumn(col||{});
  for(const rule of (col.formatRules||[])){
    if(researchCompareColumnRule(rawValue,rule.op,rule.value,rule.value2)){
      const bg=researchColumnColorHex(rule.color), fg=researchColumnTextColor(rule.color);
      return bg?`background-color:${bg};color:${fg};font-weight:800;`:'';
    }
  }
  return '';
}
function researchColumnCellPresentation(rawValue,item,col,rows,ctx,warnings=[]){
  const displayRaw=researchColumnDisplayRawValue(rawValue,item,col,rows,ctx,warnings);
  const html=formatResearchValue(displayRaw,item,col);
  const text=typeof displayRaw==='number' ? html.replace(/<[^>]+>/g,'') : String(displayRaw??'');
  return {raw:displayRaw,html,text,style:researchColumnCellStyle(rawValue,item,col,rows,ctx,warnings)};
}
function readResearchColumnRulesModal(wrap,col){
  col.formatRules=[...wrap.querySelectorAll('[data-fmt-row]')].map(row=>normalizeResearchColumnRule({
    id:row.dataset.ruleId,
    op:row.querySelector('[data-fmt="op"]')?.value||'greater than',
    value:row.querySelector('[data-fmt="value"]')?.value||'',
    value2:row.querySelector('[data-fmt="value2"]')?.value||'',
    color:row.querySelector('[data-fmt="color"]')?.value||'yellow'
  },'format'));
  col.displayRules=[...wrap.querySelectorAll('[data-disp-row]')].map(row=>normalizeResearchColumnRule({
    id:row.dataset.ruleId,
    expression:row.querySelector('[data-disp="expression"]')?.value||'value',
    op:row.querySelector('[data-disp="op"]')?.value||'greater/equal',
    value:row.querySelector('[data-disp="value"]')?.value||'',
    value2:row.querySelector('[data-disp="value2"]')?.value||'',
    display:row.querySelector('[data-disp="display"]')?.value||''
  },'display'));
  col.elseDisplay=wrap.querySelector('[data-disp-else]')?.value||'';
  return col;
}
function openResearchColumnSettings(i){
  syncResearchEditorStateFromDom();
  const col=normalizeResearchColumn(state.editingResearchColumns?.[i]||{});
  const title=col.label||col.field||`Column ${i+1}`;
  const wrap=document.createElement('div'); wrap.className='researchColumnRulesModal';
  const render=()=>{
    wrap.innerHTML=`<div class="researchColumnRulesBox"><div class="researchColumnRulesHead"><div><h3 style="margin:0">Column Rules: ${esc(title)}</h3><div class="researchRulesHint">Highlight rules color the cell based on the calculated value. Display rules can replace the visible value with labels like X/Y/Z while keeping the original calculation available in the cell details.</div></div><button class="dark" data-rules-close type="button">Close</button></div><div class="researchRuleSection"><strong>Conditional formatting / highlighting</strong><div class="researchRulesHint">Example: value greater than 100 → green, between 50 and 100 → yellow, less than 50 → red.</div><div data-format-list>${(col.formatRules||[]).map((r,ri)=>`<div class="researchRuleRow" data-fmt-row data-rule-id="${esc(r.id||id())}"><div class="field"><label>If value</label><select data-fmt="op">${researchColumnOperatorOptions(r.op)}</select></div><div class="field"><label>Value / X</label><input data-fmt="value" value="${esc(r.value||'')}" placeholder="100 or text"></div><div class="field"><label>High / Y</label><input data-fmt="value2" value="${esc(r.value2||'')}" placeholder="For between"></div><div class="field"><label>Highlight</label><select data-fmt="color">${researchColumnColorOptions(r.color||'yellow')}</select></div><div class="hint"><span class="researchColorSwatch" style="background:${esc(researchColumnColorHex(r.color||'yellow'))}"></span>${esc(r.color||'yellow')}</div><button class="smallBtn red" data-format-remove="${ri}" type="button">Remove</button></div>`).join('')||'<div class="hint">No highlight rules yet.</div>'}</div><button class="smallBtn green" data-format-add type="button">+ Add highlight rule</button></div><div class="researchRuleSection"><strong>Display value rules</strong><div class="researchRulesHint">Expression can be <code>value</code> for the current calculated cell or a formula like <code>[Cash Apps] / [Cash Opps]</code>. The first matching rule wins.</div><div data-display-list>${(col.displayRules||[]).map((r,ri)=>`<div class="researchRuleRow displayRule" data-disp-row data-rule-id="${esc(r.id||id())}"><div class="field"><label>Display if expression</label><input data-disp="expression" list="researchHeaderSuggestions" value="${esc(r.expression||'value')}" placeholder="value or [Column] / [Column]"></div><div class="field"><label>Operator</label><select data-disp="op">${researchColumnOperatorOptions(r.op)}</select></div><div class="field"><label>Value / X</label><input data-disp="value" value="${esc(r.value||'')}" placeholder="100 or text"></div><div class="field"><label>High / Y</label><input data-disp="value2" value="${esc(r.value2||'')}" placeholder="For between"></div><div class="field"><label>Show this</label><input data-disp="display" value="${esc(r.display||'')}" placeholder="X, Y, Z, Good, Watch"></div><button class="smallBtn red" data-display-remove="${ri}" type="button">Remove</button></div>`).join('')||'<div class="hint">No display rules yet.</div>'}</div><div class="researchColumnLabelTools"><div class="field"><label>Else display</label><input data-disp-else value="${esc(col.elseDisplay||'')}" placeholder="Optional fallback display when no display rule matches"></div><button class="smallBtn green" data-display-add type="button">+ Add display rule</button></div></div><div class="modalFoot"><button class="dark" data-rules-cancel type="button">Cancel</button><button class="green" data-rules-save type="button">Save Rules</button></div></div>`;
    wrap.querySelector('[data-rules-close]').onclick=()=>wrap.remove();
    wrap.querySelector('[data-rules-cancel]').onclick=()=>wrap.remove();
    wrap.querySelector('[data-format-add]').onclick=()=>{ readResearchColumnRulesModal(wrap,col); col.formatRules.push(normalizeResearchColumnRule({op:'greater than',value:'',color:'yellow'},'format')); render(); };
    wrap.querySelector('[data-display-add]').onclick=()=>{ readResearchColumnRulesModal(wrap,col); col.displayRules.push(normalizeResearchColumnRule({expression:'value',op:'greater/equal',value:'',display:''},'display')); render(); };
    wrap.querySelectorAll('[data-format-remove]').forEach(b=>b.onclick=()=>{ readResearchColumnRulesModal(wrap,col); col.formatRules.splice(+b.dataset.formatRemove,1); render(); });
    wrap.querySelectorAll('[data-display-remove]').forEach(b=>b.onclick=()=>{ readResearchColumnRulesModal(wrap,col); col.displayRules.splice(+b.dataset.displayRemove,1); render(); });
    wrap.querySelector('[data-rules-save]').onclick=()=>{ readResearchColumnRulesModal(wrap,col); state.editingResearchColumns[i]={...(state.editingResearchColumns[i]||{}),...col}; renderResearchColumnsEditor(); wrap.remove(); };
    attachModelReferencePicker(wrap);
    wrap.querySelectorAll('[data-disp="expression"]').forEach(input=>{ const show=()=>showHeaderSuggestions(input,{source:els.researchSource.value,customSource:els.researchSource.value}); input.onfocus=show; input.onkeyup=show; });
  };
  render();
  wrap.onclick=e=>{ if(e.target===wrap) wrap.remove(); };
  document.body.appendChild(wrap);
}
function researchTableHasColumnRules(item){ return (item.columns||[]).some(c=>(c.formatRules||[]).length||(c.displayRules||[]).length||String(c.elseDisplay||'').trim()); }
function researchExcelHtmlEscape(v){ return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function researchTableExportRowHtml(item,res,r,sec){
  const tds=[`<td>${researchExcelHtmlEscape(r.label)}</td>`]; if(sec) tds.push(`<td>${researchExcelHtmlEscape(r.secondary||'')}</td>`);
  (r.values||[]).forEach((v,i)=>{ const cell=(r.cells||[])[i]; if(cell){ tds.push(`<td style="${researchExcelHtmlEscape(cell.style||'')}">${researchExcelHtmlEscape(cell.text??cell.display??v)}</td>`); return; } const col=(res.columns||[])[i]||{}, pres=researchColumnCellPresentation(v,item,col,[],{},res.warnings||[]); tds.push(`<td style="${researchExcelHtmlEscape(pres.style)}">${researchExcelHtmlEscape(pres.text)}</td>`); });
  return `<tr>${tds.join('')}</tr>`;
}
function researchTableExportTotalRowHtml(item,res,sec){
  const vals=Array.isArray(res.totalValues)?res.totalValues:[], cells=Array.isArray(res.totalCells)?res.totalCells:[];
  const tds=[`<td><strong>Total</strong></td>`]; if(sec) tds.push('<td></td>');
  (res.columns||[]).forEach((col,i)=>{ const cell=cells[i]; if(cell){ tds.push(`<td style="${researchExcelHtmlEscape(cell.style||'')}"><strong>${researchExcelHtmlEscape(cell.text??cell.display??vals[i])}</strong></td>`); return; } const pres=researchColumnCellPresentation(vals[i],item,col,[],{},res.warnings||[]); tds.push(`<td style="${researchExcelHtmlEscape(pres.style)}"><strong>${researchExcelHtmlEscape(pres.text)}</strong></td>`); });
  return `<tr>${tds.join('')}</tr>`;
}
function researchTableExportShell(header,body){
  return `<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:6px 8px}th{background:#111827;color:#fff}</style></head><body><table><thead><tr>${header.map(h=>`<th>${researchExcelHtmlEscape(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}
function researchTableExportHeader(item,res,sec=!!res.hasSecondary){
  return [item.groupMultiAdd?'Multi-add group':(findMetricByRef(item.groupField)?.name||researchDisplayFieldLabel(item.groupField,'Group')),...(sec?[item.secondaryGroupField||'Secondary']:[]),...(res.columns||[]).map(c=>researchColumnDisplayTitle(item,c)||c.label||c.mode||'Value')];
}
function researchTableExportHtml(item,res){
  const sec=!!res.hasSecondary, header=researchTableExportHeader(item,res,sec), rows=[];
  (res.data||[]).forEach(r=>rows.push(researchTableExportRowHtml(item,res,r,sec)));
  if(item.totals && (res.data||[]).length) rows.push(researchTableExportTotalRowHtml(item,res,sec));
  return researchTableExportShell(header,rows.join('')||`<tr><td colspan="${header.length}">No rows matched.</td></tr>`);
}
async function researchTableExportHtmlAsync(item,res,progress={}){
  const sec=!!res.hasSecondary, header=researchTableExportHeader(item,res,sec), data=res.data||[], rows=[], total=data.length+(item.totals&&data.length?1:0), chunkSize=Math.max(100,progress.chunkSize||RESEARCH_BATCH_SIZE), start=progress.start??45, end=progress.end??95, span=end-start;
  if(!total) return researchTableExportShell(header,`<tr><td colspan="${header.length}">No rows matched.</td></tr>`);
  for(let i=0;i<data.length;i+=chunkSize){
    const part=data.slice(i,i+chunkSize);
    part.forEach(r=>rows.push(researchTableExportRowHtml(item,res,r,sec)));
    const done=Math.min(i+part.length,total), pct=start+span*(done/total);
    updateProgress(`Preparing export rows... ${done.toLocaleString()} / ${total.toLocaleString()}`,pct);
    await yieldToBrowser();
  }
  if(item.totals && data.length){
    rows.push(researchTableExportTotalRowHtml(item,res,sec));
    updateProgress(`Preparing export rows... ${total.toLocaleString()} / ${total.toLocaleString()}`,end);
    await yieldToBrowser();
  }
  return researchTableExportShell(header,rows.join(''));
}

function normalizeResearchItem(item={}){
  const normalized={...item,outputType:item.outputType||'table',cardSize:item.cardSize||'medium',collapsed:!!item.collapsed,filterDuplicateReps:!!item.filterDuplicateReps,textWrap:item.textWrap!==false,rowDensity:item.rowDensity||'comfortable',analysisGrain:['auto','rows','representatives','teams'].includes(item.analysisGrain)?item.analysisGrain:'auto',crossSourceJoinMode:['grain','strict_rep','strict_team','rep_then_team'].includes(item.crossSourceJoinMode)?item.crossSourceJoinMode:'grain',bucketSize:Number(item.bucketSize)>0?Number(item.bucketSize):'',filters:Array.isArray(item.filters)?item.filters:[],columns:Array.isArray(item.columns)?item.columns:[],gearFilters:item.gearFilters&&typeof item.gearFilters==='object'?item.gearFilters:{}};
  normalized.populationScope=normalizeResearchPopulationScope(item.populationScope);
  normalized.unmatchedBehavior=['exclude','blank'].includes(item.unmatchedBehavior)?item.unmatchedBehavior:'exclude';
  normalized.calculationGroupLimit=Math.max(0,Math.floor(Number(item.calculationGroupLimit)||0));
  normalized.missingBehavior=['missing','zero','warn'].includes(item.missingBehavior)?item.missingBehavior:'missing';
  normalized.reconcile=!!item.reconcile;
  normalized.panelField=String(item.panelField||'').trim();
  normalized.measureId=item.measureId||researchMeasureIdFromRef(item.valueField);
  normalized.renderedResult=item.renderedResult&&typeof item.renderedResult==='object'?item.renderedResult:null;
  normalized.filters=normalized.filters.map(f=>{ const nf={...f}; if(nf.type==='team_is'||nf.fieldType==='team_is'||String(nf.field||'').trim().toLowerCase()==='team is'){ nf.type='team_is'; nf.teamInput=nf.teamInput??nf.rawTeamInput??nf.value??''; nf.conditionResult=nf.conditionResult??'true'; } return nf; });
  normalized.guidedEnabled=item.guidedEnabled===true;
  normalized.guidedSubject=item.guidedSubject||({representatives:'representatives',teams:'teams',rows:'records'}[normalized.analysisGrain]||'representatives');
  normalized.guidedRecordType=item.guidedRecordType||(['documented_coaching','checklist','qa_direct','comp_calls'].includes(item.source)?item.source:'documented_coaching');
  normalized.guidedQuestion=item.guidedQuestion||((item.valueMode==='percent'||item.columns?.some(c=>c.mode==='percent'))?'percentage':(['avg','sum'].includes(item.valueMode)?'average_total':((item.sort==='yDesc'&&item.valueMode==='count')?'rank':(item.outputType==='conversation'?'show':'count'))));
  normalized.guidedPercentageUnit=item.guidedPercentageUnit||((item.percentBuilder?.unit==='documented_coaching'||item.percentBuilder?.unit==='checklist'||item.percentBuilder?.unit==='rows')?'records':(item.percentBuilder?.unit||'unique_reps'));
  normalized.guidedAggregate=item.guidedAggregate||(['sum','avg'].includes(item.valueMode)?item.valueMode:'avg');
  normalized.guidedRankUnit=item.guidedRankUnit||'records';
  normalized.guidedMeasureField=item.guidedMeasureField||item.valueField||'';
  normalized.guidedEvidenceSources=Array.isArray(item.guidedEvidenceSources)&&item.guidedEvidenceSources.length?item.guidedEvidenceSources.filter(Boolean):[item.source].filter(Boolean);
  normalized.guidedPrimarySource=item.guidedPrimarySource||item.source||DYNAMIC_RESEARCH_SOURCE;
  normalized.guidedConditions=Array.isArray(item.guidedConditions)?item.guidedConditions.map((c,i)=>({id:c.id||`condition_${i+1}`,logic:i===0?'and':(c.logic==='or'?'or':'and'),source:c.source||item.source||'',field:c.field||'',expression:!!c.expression,operator:c.operator||'contains',value:c.value??'',value2:c.value2??'',countValue:c.countValue??'',caseSensitive:!!c.caseSensitive,exactPhrase:!!c.exactPhrase,normalizeSpacing:c.normalizeSpacing!==false})):[];
  normalized.guidedBreakdown=item.guidedBreakdown||(!item.groupField?'none':(item.dateGrouping==='weekly'?'week':item.dateGrouping==='monthly'?'month':item.dateGrouping==='quarterly'?'quarter':'column'));
  normalized.guidedBreakdownColumn=item.guidedBreakdownColumn||item.groupField||'';
  normalized.guidedDisplay=item.guidedDisplay||(item.outputType==='bar'?'bar':item.outputType==='line'?'line':item.outputType==='heatmap'?'heatmap':'detailed_table');
  normalized.guidedSort=item.guidedSort||item.sort||'default';
  if(!normalized.valueMode) normalized.valueMode='count'; if(normalized.valueMode==='checklistCount'||normalized.valueMode==='Checklist Count') normalized.valueMode='count'; if(normalized.valueMode==='countby'||normalized.valueMode==='countBy'||normalized.valueMode==='count by'||normalized.valueMode==='Count By') normalized.valueMode='count_by'; if(normalized.valueMode==='people') normalized.valueMode='unique'; if(normalized.valueMode==='total_within') normalized.valueMode='date_within'; if(normalized.valueMode==='percent_within') normalized.valueMode='date_percent_within'; normalized.useSecondaryGroup=!!normalized.useSecondaryGroup; normalized.secondaryGroupField=normalized.secondaryGroupField||'';
  normalized.percentOfField=normalized.percentOfField||normalized.denominatorField||''; normalized.percentBuilder=normalizePercentBuilder(normalized.percentBuilder||{},normalized); normalized.withinUseRange=!!normalized.withinUseRange; normalized.withinDays=normalized.withinDays||normalized.days||''; normalized.withinRangeMin=normalized.withinRangeMin||''; normalized.withinRangeMax=normalized.withinRangeMax||'';
  normalized.groupMultiAdd=!!normalized.groupMultiAdd; normalized.groupAxisItems=Array.isArray(normalized.groupAxisItems)?normalized.groupAxisItems:[]; normalized.columns=normalized.columns.map(normalizeResearchColumn);
  const graph=['line','bar','scatter','histogram','heatmap','box','pie'].includes(normalized.outputType), secondary=!!(normalized.useSecondaryGroup&&normalized.secondaryGroupField);
  normalized.decimals=Number.isFinite(+normalized.decimals)?+normalized.decimals:1; normalized.axisMin=normalized.axisMin??''; normalized.axisMax=normalized.axisMax??'';
  normalized.showValues=normalized.showValues ?? ['bar','scatter','histogram','heatmap','pie'].includes(normalized.outputType); normalized.showDateLabels=!!normalized.showDateLabels; normalized.showPercent=!!normalized.showPercent; normalized.graphSort=normalized.graphSort||'inherit'; normalized.topN=+normalized.topN||0;
  normalized.showSummaryLine=!!normalized.showSummaryLine; normalized.goalValue=normalized.goalValue??''; normalized.rotateLabels=!!normalized.rotateLabels; normalized.wrapLabels=normalized.wrapLabels!==false; normalized.showLegend=normalized.showLegend ?? (normalized.outputType==='line'||secondary); normalized.showGridlines=normalized.showGridlines!==false;
  normalized.smoothLine=!!normalized.smoothLine; normalized.useDots=normalized.useDots ?? (normalized.outputType==='line'); normalized.barOrientation=normalized.barOrientation||'vertical'; normalized.stackedBars=!!normalized.stackedBars; normalized.groupedBars=normalized.groupedBars!==false; normalized.hideZeroGroups=!!normalized.hideZeroGroups; normalized.highlightBest=!!normalized.highlightBest; normalized.highlightWorst=!!normalized.highlightWorst;
  if(graph && normalized._labelCount>20 && item.rotateLabels==null) normalized.rotateLabels=true;
  Object.keys(normalized.gearFilters||{}).forEach(k=>{ normalized.gearFilters[k]={...researchGearDefault(),...normalized.gearFilters[k],valueLevel:(normalized.gearFilters[k]?.valueLevel||'level2')}; });
  return normalized;
}

function researchItemForLocalStorage(item){ const copy=clonePlain(item||{}); if(copy.renderedResult){ copy.renderedResult={version:2,outputType:copy.outputType,renderedAt:copy.renderedResult.renderedAt||'',id:copy.id,storedIn:'indexedDB'}; } return copy; }
function loadResearchItems(){ try{ state.researchItems=(JSON.parse(localStorage.getItem(RESEARCH_KEY)||'[]')||[]).map(normalizeResearchItem); }catch(_){ state.researchItems=[]; } loadResearchResultCache(); migrateLegacyResearchRenderedResults(); }
function persistResearchItemsToLocalStorage(){ try{ localStorage.setItem(RESEARCH_KEY, JSON.stringify((state.researchItems||[]).map(researchItemForLocalStorage))); }catch(e){ console.warn('[Research Builder] Saving definitions only after storage error',e); localStorage.setItem(RESEARCH_KEY, JSON.stringify((state.researchItems||[]).map(x=>{ const y=researchItemForLocalStorage(x); delete y.renderedResult; return y; }))); } updateResearchCacheBadge(); }
function saveResearchItems(){ bumpVersion('researchDefinitions'); selectiveResearchInvalidation({reason:'research changed',researchDefinitions:true}); persistResearchItemsToLocalStorage(); }

function concreteResearchSources(){ return allSourceKeys().map(k=>({value:k,label:labelSource(k)})); }
function metricSources(){ return concreteResearchSources(); }
function researchSources(){ return [{value:DYNAMIC_RESEARCH_SOURCE,label:'Dynamic (sources referenced)'},...concreteResearchSources()]; }
function isDynamicResearchSource(sourceKey){ return sourceKey===DYNAMIC_RESEARCH_SOURCE; }
function researchMeasureIdFromRef(value){
  const raw=String(value||'').trim(), m=raw.match(/^measure\(\s*["']?([^"')]+)["']?\s*\)$/i) || raw.match(/^#measure:(.+)$/i);
  return m?m[1].trim():'';
}
function researchMeasureRef(id){ return id?`measure(${JSON.stringify(id)})`:''; }
function researchTypedMeasureDefinition(idOrDef){ return typeof idOrDef==='object'?idOrDef:(RESEARCH_TYPED_MEASURES.find(m=>m.id===String(idOrDef||''))||null); }
function researchCandidateHeader(source,candidates=[]){
  const headers=getHeaders(source)||[], exact=new Map(headers.map(h=>[normalizeResearchText(h),h]));
  for(const candidate of candidates||[]){ const hit=exact.get(normalizeResearchText(candidate)); if(hit) return hit; }
  for(const candidate of candidates||[]){ const wanted=normalizeResearchText(candidate).replace(/[^a-z0-9]/g,''); const hit=headers.find(h=>{ const n=normalizeResearchText(h).replace(/[^a-z0-9]/g,''); return n===wanted || (wanted.length>6&&(n.includes(wanted)||wanted.includes(n))); }); if(hit) return hit; }
  return '';
}
function resolveResearchTypedMeasure(idOrDef,preferredSource=''){
  const def=researchTypedMeasureDefinition(idOrDef); if(!def) return null;
  const imported=allSourceKeys().filter(src=>(getRowsRaw(src)||[]).length), allowed=def.sources.includes('*')?imported:def.sources.filter(src=>allSourceKeys().includes(src));
  const ordered=[preferredSource,...allowed,...imported].filter((v,i,a)=>v&&!isDynamicResearchSource(v)&&a.indexOf(v)===i&&((def.sources.includes('*'))||allowed.includes(v)));
  for(const source of ordered){
    const resolved={...def,source,numeratorField:'',denominatorField:'',valueField:'',compatible:true,missing:[]};
    if(def.aggregation==='weighted_rate'){
      resolved.numeratorField=researchCandidateHeader(source,def.numeratorCandidates); resolved.denominatorField=researchCandidateHeader(source,def.denominatorCandidates);
      if(!resolved.numeratorField) resolved.missing.push('numerator'); if(!resolved.denominatorField) resolved.missing.push('denominator');
    }else if(['sum','avg','min','max'].includes(def.aggregation)){
      resolved.valueField=researchCandidateHeader(source,def.valueCandidates); if(!resolved.valueField) resolved.missing.push('value field');
    }
    resolved.compatible=!resolved.missing.length;
    if(resolved.compatible) return resolved;
  }
  const source=ordered[0]||preferredSource||allowed[0]||'';
  return {...def,source,numeratorField:'',denominatorField:'',valueField:'',compatible:def.aggregation==='count'||def.aggregation==='unique_rep',missing:def.aggregation==='count'||def.aggregation==='unique_rep'?[]:['required mapped headers']};
}
function researchTypedMeasureCompatible(def,item={}){
  const resolved=resolveResearchTypedMeasure(def,item.source), grain=researchAnalysisGrain(item,[]);
  return {resolved,ok:!!resolved?.compatible && (!resolved.grains?.length || resolved.grains.includes(grain)||item.analysisGrain==='auto')};
}
function researchTypedMeasureRows(resolved,rows,item){
  if(!resolved?.source) return [];
  if(resolved.source===item.source) return rows||[];
  return researchRowsForCohort(resolved.source,rows||[],item.source,item);
}
function researchTypedMeasureStats(resolved,rows,item,missingBehavior){
  const sourceRows=researchTypedMeasureRows(resolved,rows,item), behavior=missingBehavior||item.missingBehavior||resolved.missingBehavior||'missing';
  let numerator=0,denominator=0,sum=0,count=0,missingNumerator=0,missingDenominator=0,missingValue=0; const unique=new Set();
  sourceRows.forEach(r=>{
    if(resolved.aggregation==='count'){ count++; return; }
    if(resolved.aggregation==='unique_rep'){ const key=getRepIdentity(r,resolved.source).normalizedName; if(key) unique.add(key); else missingValue++; return; }
    if(resolved.aggregation==='weighted_rate'){
      let n=evaluateResearchNumericField(r,resolved.numeratorField,resolved.source), d=evaluateResearchNumericField(r,resolved.denominatorField,resolved.source);
      if(!Number.isFinite(n)){ missingNumerator++; if(behavior==='zero') n=0; }
      if(!Number.isFinite(d)){ missingDenominator++; if(behavior==='zero') d=0; }
      if(Number.isFinite(n)) numerator+=n; if(Number.isFinite(d)) denominator+=d; return;
    }
    let v=evaluateResearchNumericField(r,resolved.valueField,resolved.source);
    if(!Number.isFinite(v)){ missingValue++; if(behavior==='zero') v=0; }
    if(Number.isFinite(v)){ sum+=v; count++; }
  });
  let value=0;
  if(resolved.aggregation==='count') value=count;
  else if(resolved.aggregation==='unique_rep') value=unique.size;
  else if(resolved.aggregation==='weighted_rate') value=denominator?numerator/denominator*100:(item.zeroDenominator==='blank'?null:0);
  else if(resolved.aggregation==='avg') value=count?sum/count:(behavior==='missing'?null:0);
  else value=sum;
  return {value,numerator,denominator,sum,count,unique:unique.size,missingNumerator,missingDenominator,missingValue,sourceRows:sourceRows.length,behavior};
}
function evaluateResearchTypedMeasure(idOrDef,rows,item,col={},ctx={}){
  const resolved=resolveResearchTypedMeasure(idOrDef,item.source);
  if(!resolved?.compatible){ researchExpressionAddWarning(ctx.warnings||[],`Typed measure "${researchTypedMeasureDefinition(idOrDef)?.label||idOrDef}" is missing ${resolved?.missing?.join(' and ')||'required fields'} in ${labelSource(resolved?.source)||'the selected source'}.`); return null; }
  const stats=researchTypedMeasureStats(resolved,rows,item,col.missingBehavior||item.missingBehavior);
  if(resolved.source!==item.source&&!stats.sourceRows&&item.unmatchedBehavior==='blank') return null;
  if(stats.behavior==='warn'&&(stats.missingNumerator||stats.missingDenominator||stats.missingValue)) researchExpressionAddWarning(ctx.warnings||[],`${resolved.label}: ${stats.missingNumerator+stats.missingDenominator+stats.missingValue} blank/non-numeric inputs were excluded.`);
  if(ctx) ctx.typedMeasureTrace={...stats,resolved};
  return stats.value;
}
function researchTypedMeasureFormula(resolved){
  if(!resolved) return '';
  if(resolved.aggregation==='weighted_rate') return `SUM(${resolved.numeratorField||'numerator'}) ÷ SUM(${resolved.denominatorField||'denominator'}) × 100`;
  if(resolved.aggregation==='avg') return `AVERAGE(${resolved.valueField||'value'})`;
  if(resolved.aggregation==='sum') return `SUM(${resolved.valueField||'value'})`;
  if(resolved.aggregation==='unique_rep') return 'COUNT DISTINCT(canonical representative)';
  return 'COUNT(eligible source rows)';
}
function getResearchSourceRows(sourceKey){ if(isDynamicResearchSource(sourceKey)) return []; return (sourceRows(sourceKey)||[]).slice(); }
function getResearchHeaders(sourceKey){ if(isDynamicResearchSource(sourceKey)) return [...new Set(allSourceKeys().flatMap(src=>getHeaders(src)||[]))]; return (sourceHeaders(sourceKey)||[]).slice(); }

function firstImportedResearchSource(){ return allSourceKeys().find(src=>(getRowsRaw(src)||[]).length) || allSourceKeys()[0] || 'qa'; }
function researchFieldReferencedSources(field, defaultSource=''){
  const out=[]; const add=src=>{ if(src && !isDynamicResearchSource(src) && !out.includes(src)) out.push(src); };
  const raw=normalizeResearchLooseSourceReferences(String(field||'').trim()); if(!raw) return out;
  const measure=researchTypedMeasureDefinition(researchMeasureIdFromRef(raw)); if(measure){ const resolved=resolveResearchTypedMeasure(measure,defaultSource); if(resolved?.source) add(resolved.source); return out; }
  const metric=findMetricByRef(raw) || findMetricByNameOrId(raw.replace(/^@/,'')); if(metric) add(metric.source||defaultSource);
  const bang=parseResearchBangField(raw); if(bang) add(bang.source);
  const modelRef=parseModelRef(raw) || findModelCriterionReferenceByName(raw.replace(/^;/,''));
  if(modelRef){ const m=findModelByNameOrId(modelRef.model); (sourcesUsedByModel(m)||[]).forEach(add); }
  splitCrossExpressionRefs(raw).forEach(ref=>add(ref.source));
  splitExpressionColumns(raw).forEach(col=>{ const hit=researchUniqueSourceForHeader(col,defaultSource||''); if(hit) add(hit.source); });
  if(!/[\[\]!@()*/+\-]/.test(raw)){ const hit=researchUniqueSourceForHeader(raw,defaultSource||''); if(hit) add(hit.source); }
  return out;
}
function researchReferencedSources(item={}){
  const refs=[]; const add=src=>{ if(src && !isDynamicResearchSource(src) && !refs.includes(src)) refs.push(src); };
  [item.groupField,item.groupExpression,item.dateColumn,item.secondaryGroupField,item.panelField,item.valueField,item.percentOfField,item.numeratorExpression,item.denominatorExpression,item.withinCompareField].forEach(f=>researchFieldReferencedSources(f,item.source).forEach(add));
  (item.columns||[]).forEach(c=>{ const resolved=resolveResearchTypedMeasure(c.measureId||researchMeasureIdFromRef(c.field),item.source); if(resolved?.source) add(resolved.source); researchFieldReferencedSources(c.field,item.source).forEach(add); researchFieldReferencedSources(c.percentOfField,item.source).forEach(add); researchFieldReferencedSources(c.withinCompareField,item.source).forEach(add); });
  (item.filters||[]).forEach(f=>{ researchFieldReferencedSources(f.field,item.source).forEach(add); researchFieldReferencedSources(f.withinRightField,item.source).forEach(add); researchFieldReferencedSources(f.value,item.source).forEach(add); if(f.targetSource) add(f.targetSource); });
  (item.guidedEvidenceSources||[]).forEach(add);
  (item.guidedConditions||[]).forEach(c=>{ add(c.source); researchFieldReferencedSources(c.field,c.source||item.source).forEach(add); });
  return refs;
}
function resolveDynamicResearchSource(item={}){
  if(!isDynamicResearchSource(item.source)) return item.source || firstImportedResearchSource();
  const refs=researchReferencedSources(item);
  const withRows=refs.find(src=>(getRowsRaw(src)||[]).length);
  return withRows || refs[0] || firstImportedResearchSource();
}
function effectiveResearchItem(item={}){
  const src=resolveDynamicResearchSource(item);
  const out=src && src!==item.source ? {...item,source:src,_dynamicSource:item.source,_resolvedDynamicSource:src} : {...item,source:src||item.source};
  if(out.source===DATED_SOURCE && !out.dateColumn) out.dateColumn='Date';
  if(out.source===NONDATED_SOURCE) out.dateColumn='';
  return out;
}
function researchSourceRowsForItem(item={}){ return getResearchSourceRows(resolveDynamicResearchSource(item)); }
function researchDisplayFieldLabel(field,fallback='Group'){
  const measure=researchTypedMeasureDefinition(researchMeasureIdFromRef(field)); if(measure) return measure.label||fallback;
  const metric=findMetricByRef(field) || findMetricByNameOrId(String(field||'').replace(/^@/,''));
  if(metric) return metric.name || fallback;
  const modelRef=parseModelRef(field) || findModelCriterionReferenceByName(String(field||'').replace(/^;/,''));
  if(modelRef) return modelRef.criteria ? `${modelRef.model} - ${modelRef.criteria}` : modelRef.model;
  const bang=parseResearchBangField(field); if(bang) return bang.field || fallback;
  return String(field||fallback||'').replace(/^@/,'') || fallback;
}
function researchFieldNeedsHeaderWarning(item,field){
  const raw=String(field||'').trim(); if(!raw) return false;
  if(researchMeasureIdFromRef(raw) || findMetricByRef(raw) || parseModelRef(raw) || parseResearchBangField(raw) || findModelCriterionReferenceByName(raw.replace(/^;/,''))) return false;
  if(/[!\[\]'"().+\-*/@]/.test(raw)) return false;
  { const actual=resolveColumn(item.source,raw); return !(actual && (getHeaders(item.source)||[]).includes(actual)); }
}

const REP_IDENTITY_COLUMNS=['Agent Name','Associate Name','Associate name','Associate','Representative','Rep Name','CSR','SSR','Employee Name','Name','Teammate','User','Username','Email Username','Email','Person','Individual','Agent'];
const COACH_IDENTITY_COLUMNS=['Coach','Coach Name','Job Coach','Team','Team Name','Manager','Supervisor','Leader','Coach Assigned','Assigned Coach','QA Coach','Team Lead'];
function normalizeIdentityName(v,options={}){ let s=String(v??'').trim(); if(!s) return ''; if(options.lastFirst && /,/.test(s)){ const [last,...rest]=s.split(','); const first=rest.join(',').trim(); if(first&&last) s=(first+' '+last.trim()).trim(); } if(/@/.test(s)) s=s.split('@')[0].replace(/[._-]+/g,' '); return norm(s).replace(/[\s\p{P}]+/gu,' ').trim(); }
function displayIdentityName(v){ return String(v??'').trim().replace(/\s+/g,' '); }
function sourceConfiguredIdentityColumn(sourceKey,type){ const cs=customSource?.(sourceKey)||{}; const maps=cs.mappings||cs.fieldMappings||state.sourceMappings?.[sourceKey]||{}; const keys=type==='rep'?['rep','representative','agent','associate','name','person','employee','user','email']:['coach','team','manager','supervisor','leader']; for(const [k,v] of Object.entries(maps||{})){ if(keys.some(x=>String(k).toLowerCase().includes(x)) && v) return v; } return ''; }
function detectIdentityColumn(row,sourceKey,type){ const headers=getHeaders(sourceKey)||Object.keys(row||{}); const configured=sourceConfiguredIdentityColumn(sourceKey,type); if(configured && headers.includes(configured)) return {column:configured,confidence:1}; const aliases=type==='rep'?REP_IDENTITY_COLUMNS:COACH_IDENTITY_COLUMNS; const normAliases=new Set(aliases.map(a=>normalizeIdentityName(a))); let best='', score=0; headers.forEach(h=>{ const nh=normalizeIdentityName(h); if(normAliases.has(nh)){ best=h; score=Math.max(score,.95); } else if(aliases.some(a=>nh.includes(normalizeIdentityName(a))||normalizeIdentityName(a).includes(nh))){ if(score<.75){ best=h; score=.75; } } }); return {column:best,confidence:score}; }
function getRepIdentity(row,sourceKey,options={}){ const found=detectIdentityColumn(row,sourceKey,'rep'), rawName=found.column?row?.[found.column]:(row?._rep||row?._repKey||''); let normalizedName=normalizeIdentityName(rawName,{lastFirst:options.lastFirst}); const mapped=(state.repAliases?.get?.(aliasLookupKey(rawName))||state.repAliases?.get?.(normalizedName)||state.masterRepMap?.get?.(normalizedName)||''); if(mapped) normalizedName=normalizeIdentityName(mapped); return {rawName,normalizedName,displayName:displayIdentityName(mapped||rawName)||normalizedName,sourceKey,sourceRowIndex:researchRowSourceIndex?.(sourceKey,row),confidence:found.confidence,matchedColumn:found.column||'_rep'}; }
function getCoachIdentity(row,sourceKey,options={}){
  sourceKey=rowSourceKey(row,sourceKey);
  if(rowSkipsTeamBuild(row,sourceKey)){
    const rep=getRepIdentity(row,sourceKey,options);
    const mapped=state.repTeams?.get?.(rep.normalizedName)||'';
    const displayName=canonicalCoachName(mapped);
    const normalizedName=normalizeIdentityName(displayName);
    return {rawName:mapped,normalizedName,displayName:displayName||normalizedName,sourceKey,sourceRowIndex:researchRowSourceIndex?.(sourceKey,row),confidence:mapped?0.7:0,matchedColumn:mapped?'rep-to-team mapping':''};
  }
  const found=detectIdentityColumn(row,sourceKey,'coach'); let rawName=found.column?row?.[found.column]:(row?._team||''); if(!rawName){ const rep=getRepIdentity(row,sourceKey,options); rawName=state.repTeams?.get?.(rep.normalizedName)||''; } const displayName=canonicalCoachName(rawName); const normalizedName=normalizeIdentityName(displayName); return {rawName,normalizedName,displayName:displayName||normalizedName,sourceKey,sourceRowIndex:researchRowSourceIndex?.(sourceKey,row),confidence:found.confidence||(rawName?.length?.valueOf?.()?0.55:0),matchedColumn:found.column||(rawName?'rep-to-team mapping':'')};
}
function researchRowRepName(r,sourceKey=''){ const rep=getRepIdentity(r,sourceKey); return rep.displayName || displayIdentityName(r?._rep || r?.['Agent Name'] || r?.['Associate Name'] || r?.['Associate name'] || r?.Representative || r?.Associate || r?.Rep || r?.Name || ''); }
function personKeyFromRow(r,sourceKey=''){ return getRepIdentity(r,sourceKey).normalizedName || r?._repKey || norm(r?._rep||r?.['Agent Name']||r?.['Associate Name']||r?.['Associate name']||r?.Agent||r?.Representative||''); }
function researchRowTeam(r,sourceKey=''){
  const src=rowSourceKey(r,sourceKey);
  const mapped=getCoachIdentity(r,src).displayName;
  if(rowSkipsTeamBuild(r,src)) return mapped;
  return mapped || r?._team || r?.['Job Coach'] || r?.['Coach Assigned'] || r?.Coach || r?.Team || '';
}
function normalizeResearchPopulationScope(scope={}){
  const clean=arr=>[...new Set((Array.isArray(arr)?arr:[]).map(v=>String(v||'').trim()).filter(Boolean))];
  return {includeOrgs:clean(scope.includeOrgs),includeTeams:clean(scope.includeTeams),includeReps:clean(scope.includeReps),excludeOrgs:clean(scope.excludeOrgs),excludeTeams:clean(scope.excludeTeams),excludeReps:clean(scope.excludeReps)};
}
function researchPopulationMatchKeys(scope={}){
  scope=normalizeResearchPopulationScope(scope);
  const expandOrgs=list=>{
    const teams=[], missing=[];
    list.forEach(ref=>{ const org=findOrg(String(ref||'').replace(/^\$/,'')); if(!org){ missing.push(ref); return; } (org.coachNames||[]).forEach(team=>teams.push(team)); });
    return {teams,missing};
  };
  const includedOrgs=expandOrgs(scope.includeOrgs), excludedOrgs=expandOrgs(scope.excludeOrgs);
  const includeTeamNames=[...scope.includeTeams,...includedOrgs.teams], excludeTeamNames=[...scope.excludeTeams,...excludedOrgs.teams];
  return {
    includeTeamNames,
    excludeTeamNames,
    includeTeamKeys:new Set(includeTeamNames.map(coachNameKey).filter(Boolean)),
    includeRepKeys:new Set(scope.includeReps.map(normalizeIdentityName).filter(Boolean)),
    excludeTeamKeys:new Set(excludeTeamNames.map(coachNameKey).filter(Boolean)),
    excludeRepKeys:new Set(scope.excludeReps.map(normalizeIdentityName).filter(Boolean)),
    missingOrgs:[...includedOrgs.missing,...excludedOrgs.missing]
  };
}
function researchApplyPopulationScope(rows,item,plan){
  const scope=normalizeResearchPopulationScope(item.populationScope), keys=researchPopulationMatchKeys(scope), idx=sourceIndex(item.source);
  const hasIncludes=keys.includeTeamKeys.size||keys.includeRepKeys.size, hasExcludes=keys.excludeTeamKeys.size||keys.excludeRepKeys.size;
  if(keys.missingOrgs?.length){ const warning=`Population organization not found: ${keys.missingOrgs.join(', ')}`; researchExpressionAddWarning(researchRuntimeWarnings(item),warning); if(plan?.warnings) researchExpressionAddWarning(plan.warnings,warning); }
  if(!hasIncludes&&!hasExcludes) return rows;
  const before=rows.length, candidateSet=new Set(), candidateBits=idx?.compact?new Uint32Array(Math.ceil((idx.rows?.length||0)/32)):null; let candidateCount=0;
  const markCandidate=r=>{ const rowId=idx?.rowMeta?.get?.(r)?.rowId; if(candidateBits&&Number.isInteger(rowId)){ const word=rowId>>>5,mask=1<<(rowId&31); if(!(candidateBits[word]&mask)){ candidateBits[word]|=mask; candidateCount++; } }else if(!candidateSet.has(r)){ candidateSet.add(r); candidateCount++; } };
  const isCandidate=r=>{ const rowId=idx?.rowMeta?.get?.(r)?.rowId; return candidateBits&&Number.isInteger(rowId)?!!(candidateBits[rowId>>>5]&(1<<(rowId&31))):candidateSet.has(r); };
  if(hasIncludes&&idx){
    keys.includeTeamNames.forEach(team=>{ const teamKey=coachNameKey(team), direct=idx.byTeam?.get(team)||idx.byTeamKey?.get(normalizeIdentityName(team))||idx.byCoachKey?.get(normalizeIdentityName(team))||[]; direct.forEach(markCandidate); if(!direct.length){ for(const [name,list] of idx.byTeam||[]){ if(coachNameKey(name)===teamKey) list.forEach(markCandidate); } } });
    keys.includeRepKeys.forEach(rep=>{ (idx.byRep?.get(rep)||[]).forEach(markCandidate); });
  }
  let out=(hasIncludes&&candidateCount)?rows.filter(isCandidate):rows;
  out=out.filter(r=>{
    const rep=normalizeIdentityName(getRepIdentity(r,item.source).normalizedName), team=coachNameKey(researchRowTeam(r,item.source));
    const included=!hasIncludes || keys.includeRepKeys.has(rep) || keys.includeTeamKeys.has(team);
    const excluded=keys.excludeRepKeys.has(rep) || keys.excludeTeamKeys.has(team);
    return included&&!excluded;
  });
  if(plan){ plan.steps.push({name:'population scope',before,candidates:candidateCount||before,after:out.length,usedIndex:!!(idx&&candidateCount),bitset:!!(candidateBits&&candidateCount)}); plan.indexesUsed=plan.indexesUsed||[]; if(idx&&candidateCount) plan.indexesUsed.push(candidateBits?'canonical population bitset':'canonical population index'); }
  return out;
}
function researchScopeChipHtml(value,type,index,exclude=false){ return `<span class="researchScopeChip ${exclude?'exclude':''}">${esc(value)}<button type="button" data-research-scope-remove="${esc(type)}" data-index="${index}" aria-label="Remove ${esc(value)}">×</button></span>`; }
function researchPopulationChoices(){
  const idx=currentTeamIndex(), teams=[...new Set([...(idx.teamCounts||[]).map(x=>x.team),...(state.teams||[])].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const reps=(idx.reps||[]).filter(r=>r?.name).map(r=>({name:r.name,team:r.team||'',key:r.key||normalizeIdentityName(r.name)})).sort((a,b)=>a.name.localeCompare(b.name));
  const orgs=(state.orgs||[]).map(o=>({id:o.id,name:o.name,token:'$'+o.name,coaches:(o.coachNames||[]).length,reps:orgRepCount(o)})).sort((a,b)=>a.name.localeCompare(b.name));
  return {orgs,teams,reps};
}
function renderResearchPopulationEditor(){
  const scope=state.editingResearchPopulationScope=normalizeResearchPopulationScope(state.editingResearchPopulationScope);
  const choices=researchPopulationChoices();
  if(els.researchPopulationOrgSuggestions) els.researchPopulationOrgSuggestions.innerHTML=choices.orgs.map(o=>`<option value="${esc(o.token)}">${o.coaches.toLocaleString()} coaches · ${o.reps.toLocaleString()} reps</option>`).join('');
  if(els.researchPopulationTeamSuggestions) els.researchPopulationTeamSuggestions.innerHTML=choices.teams.map(v=>`<option value="${esc(v)}"></option>`).join('');
  if(els.researchPopulationRepSuggestions) els.researchPopulationRepSuggestions.innerHTML=choices.reps.map(v=>`<option value="${esc(v.name)}">${esc(v.team)}</option>`).join('');
  const configs=[['includeOrgs',els.researchIncludeOrgChips,false],['includeTeams',els.researchIncludeTeamChips,false],['includeReps',els.researchIncludeRepChips,false],['excludeOrgs',els.researchExcludeOrgChips,true],['excludeTeams',els.researchExcludeTeamChips,true],['excludeReps',els.researchExcludeRepChips,true]];
  configs.forEach(([key,box,exclude])=>{ if(box) box.innerHTML=scope[key].map((v,i)=>researchScopeChipHtml(v,key,i,exclude)).join('')||'<span class="hint">None selected</span>'; });
  document.querySelectorAll('#researchPopulationScopeSection [data-research-scope-remove]').forEach(b=>b.onclick=()=>{ const key=b.dataset.researchScopeRemove; state.editingResearchPopulationScope[key].splice(+b.dataset.index,1); renderResearchPopulationEditor(); scheduleResearchJoinPreview(); updateGuidedResearchUi(); });
}
function addResearchPopulationSelection(type,input){
  const raw=String(input?.value||'').trim(); if(!raw) return;
  const scope=state.editingResearchPopulationScope=normalizeResearchPopulationScope(state.editingResearchPopulationScope), isOrg=/Orgs$/.test(type), isTeam=/Teams$/.test(type), choices=researchPopulationChoices();
  const orgRaw=raw.replace(/^\$/,'');
  const match=isOrg?choices.orgs.find(o=>normalizeOrgName(o.name)===normalizeOrgName(orgRaw))?.token:(isTeam?choices.teams.find(v=>normalizeIdentityName(v)===normalizeIdentityName(raw)):choices.reps.find(v=>normalizeIdentityName(v.name)===normalizeIdentityName(raw))?.name);
  const value=match||raw; if(!scope[type].some(v=>normalizeIdentityName(v)===normalizeIdentityName(value))) scope[type].push(value);
  if(input) input.value=''; renderResearchPopulationEditor(); scheduleResearchJoinPreview(); updateGuidedResearchUi();
}
function researchJoinKey(row,source,mode){
  if(mode==='strict_team') return 'team:'+normalizeIdentityName(researchRowTeam(row,source));
  return 'rep:'+normalizeIdentityName(getRepIdentity(row,source).normalizedName);
}
function researchJoinPreviewSnapshot(item){
  item=effectiveResearchItem(normalizeResearchItem(item)); const baseRows=researchApplyPopulationScope(getRowsRaw(item.source).slice(),item), mode=item.crossSourceJoinMode==='grain'?(researchAnalysisGrain(item,baseRows)==='teams'?'strict_team':'strict_rep'):item.crossSourceJoinMode;
  const baseRepKeys=new Set(baseRows.map(r=>researchJoinKey(r,item.source,'strict_rep')).filter(k=>k!=='rep:')), baseTeamKeys=new Set(baseRows.map(r=>researchJoinKey(r,item.source,'strict_team')).filter(k=>k!=='team:')), population=mode==='strict_team'?baseTeamKeys:baseRepKeys;
  const sources=researchExecutionSources(item), rows=sources.map(source=>{
    const sourceRows=getRowsRaw(source)||[], reps=new Set([...researchCohortIdentityIndex(source,'rep').keys()].map(k=>'rep:'+normalizeIdentityName(k)).filter(k=>k!=='rep:')), teams=new Set([...researchCohortIdentityIndex(source,'team').keys()].map(k=>'team:'+normalizeIdentityName(k)).filter(k=>k!=='team:'));
    let matched=0,fallback=0;
    population.forEach(key=>{ if(mode==='strict_team'){ if(teams.has(key)) matched++; return; } if(reps.has(key)){ matched++; return; } if(mode==='rep_then_team'){ const repKey=key.slice(4), entity=ensureResearchCanonicalEntityTable().byRepKey.get(repKey), teamKey=entity?.team?'team:'+normalizeIdentityName(entity.team):''; if(teamKey&&teams.has(teamKey)){ matched++; fallback++; } } });
    return {source,sourceRows:sourceRows.length,total:population.size,matched,unmatched:Math.max(0,population.size-matched),fallback};
  });
  return {population:population.size,mode,baseSource:item.source,totalSourceRows:rows.reduce((n,x)=>n+x.sourceRows,0),rows};
}
function renderResearchJoinPreview(){
  if(!els.researchJoinPreview||!els.researchSource?.value) return;
  try{
    const snap=researchJoinPreviewSnapshot(currentResearchItemFromEditor()), label={strict_rep:'Strict representative',strict_team:'Strict team',rep_then_team:'Representative, then disclosed team fallback'}[snap.mode]||snap.mode;
    els.researchJoinPreview.innerHTML=`<strong>Join preview · ${esc(label)}</strong><div class="researchPreviewSummary"><span class="badge">Population: ${snap.population.toLocaleString()} entities</span><span class="badge">Sources: ${snap.rows.length.toLocaleString()}</span><span class="badge">Imported rows across used sources: ${snap.totalSourceRows.toLocaleString()}</span><span class="badge">Primary: ${esc(labelSource(snap.baseSource))}</span><span class="badge">Unmatched: ${currentResearchItemFromEditor().unmatchedBehavior==='blank'?'kept as blank':'excluded'}</span></div><div class="researchJoinPreviewGrid">${snap.rows.map(x=>`<div class="researchJoinPreviewCard"><strong>${esc(labelSource(x.source))}</strong><span>${x.sourceRows.toLocaleString()} imported rows</span><br><span class="good">Matched population: ${x.matched.toLocaleString()}</span><br><span class="${x.unmatched?'warn':'good'}">Unmatched: ${x.unmatched.toLocaleString()}</span>${x.fallback?`<br><span class="warn">Disclosed fallbacks: ${x.fallback.toLocaleString()}</span>`:''}</div>`).join('')}</div>`;
  }catch(err){ els.researchJoinPreview.innerHTML=`<strong>Join preview unavailable</strong><span class="hint">${esc(err.message||err)}</span>`; }
}
const scheduleResearchJoinPreview=debounce(renderResearchJoinPreview,180);
async function openResearchWorkspace(){
  loadResearchItems();
  openModal('researchModal');
  renderResearchCanvasShell('Loading research items...');
  updateResearchCacheBadge();
  await yieldToBrowser();
  renderResearchCanvasAsync({reason:'open'});
  setResearchCanvasStatus('Research opened without scanning unrelated sources. Refresh an item to prepare only the sources it uses.');
}
function researchHasAnyData(){ return allSourceKeys().some(s=>(getResearchSourceRows(s)||[]).length); }
function openResearchItemEditor(itemId){
  const existing=state.researchItems.find(x=>x.id===itemId), item=normalizeResearchItem(existing||{guidedEnabled:true});
  state.editingGuidedResearchActive=!!item.guidedEnabled;
  state.editingResearchFilters=clonePlain(item.filters||[]);
  state.editingGuidedResearchConditions=clonePlain(item.guidedConditions||[]);
  state.editingResearchColumns=clonePlain(item.columns||[]);
  state.editingResearchPopulationScope=normalizeResearchPopulationScope(item.populationScope);
  state.editingPercentBuilder=normalizePercentBuilder(item.percentBuilder||percentBuilderFromLegacyItem(item),item);
  if(!state.editingResearchColumns.length) state.editingResearchColumns=[{label:'Value',mode:item.valueMode||'count',field:item.valueField||''}]; state.editingResearchGroupAxisItems=clonePlain(item.groupAxisItems||[]);
  els.researchEditId.value=item.id||''; els.researchTitleInput.value=item.title||'New Research Item'; if(els.researchFilterDuplicateReps) els.researchFilterDuplicateReps.checked=!!item.filterDuplicateReps; els.researchOutputType.value=item.outputType||'table'; els.researchMode.value=item.mode||'direct';
  els.researchSource.innerHTML=researchSources().map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join(''); els.researchSource.value=item.source||DYNAMIC_RESEARCH_SOURCE; if(els.researchAnalysisGrain) els.researchAnalysisGrain.value=item.analysisGrain||'auto'; if(els.researchCrossSourceJoin) els.researchCrossSourceJoin.value=item.crossSourceJoinMode||'grain';
  if(els.researchUnmatchedBehavior) els.researchUnmatchedBehavior.value=item.unmatchedBehavior||'exclude'; if(els.researchCalculationGroupLimit) els.researchCalculationGroupLimit.value=item.calculationGroupLimit||''; if(els.researchReconcile) els.researchReconcile.checked=!!item.reconcile; if(els.researchMissingBehavior) els.researchMissingBehavior.value=item.missingBehavior||'missing';
  populateResearchFieldSelectors(item); state.editingResearchGear=JSON.parse(JSON.stringify(item.gearFilters||{})); ['StartDate','EndDate'].forEach(k=>els['research'+k].value=item[k[0].toLowerCase()+k.slice(1)]||'');
  els.researchGroupExpression.value=item.groupExpression||''; if(els.researchGroupMultiAdd) els.researchGroupMultiAdd.checked=!!item.groupMultiAdd; els.researchValueMode.value=item.valueMode||'count'; els.researchValueField.value=item.valueField||''; if(els.researchPercentOfField) els.researchPercentOfField.value=item.percentOfField||''; if(els.researchWithinCompareField) els.researchWithinCompareField.value=item.withinCompareField||''; if(els.researchWithinUseRange) els.researchWithinUseRange.checked=!!item.withinUseRange; if(els.researchWithinDays) els.researchWithinDays.value=item.withinDays||''; if(els.researchWithinRangeMin) els.researchWithinRangeMin.value=item.withinRangeMin||''; if(els.researchWithinRangeMax) els.researchWithinRangeMax.value=item.withinRangeMax||''; if(els.researchUseSecondaryGroup) els.researchUseSecondaryGroup.value=item.useSecondaryGroup?'yes':'no'; if(els.researchSecondaryGroupField) els.researchSecondaryGroupField.value=item.secondaryGroupField||''; if(els.researchPanelField) els.researchPanelField.value=item.panelField||''; els.researchDateGrouping.value=item.dateGrouping||'daily';
  els.researchModelSelect.innerHTML=(state.models||[]).map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join(''); els.researchModelSelect.value=item.modelId||state.models[0]?.id||''; populateResearchCriteria(item.criteriaId);
  els.researchModelResult.value=item.modelResult||'count'; els.researchPopulation.value=item.population||'rows'; els.researchNumeratorExpression.value=item.numeratorExpression||''; els.researchNumeratorCount.value=item.numeratorCount||'rows'; els.researchDenominator.value=item.denominator||'groupRows'; els.researchDenominatorExpression.value=item.denominatorExpression||''; els.researchZeroDenominator.value=item.zeroDenominator||'zero';
  els.researchSort.value=item.sort||'default'; if(els.researchBucketSize) els.researchBucketSize.value=item.bucketSize||''; els.researchAxisMin.value=item.axisMin??''; els.researchAxisMax.value=item.axisMax??''; if(els.researchTableDecimals) els.researchTableDecimals.value=item.decimals??1; if(els.researchTableShowPercent) els.researchTableShowPercent.checked=!!item.showPercent; els.researchDecimals.value=item.decimals??1; els.researchShowValues.checked=item.showValues!==false; if(els.researchShowDateLabels) els.researchShowDateLabels.checked=!!item.showDateLabels; els.researchShowPercent.checked=!!item.showPercent; if(els.researchGraphSort) els.researchGraphSort.value=item.graphSort||'inherit'; if(els.researchTopN) els.researchTopN.value=item.topN||''; if(els.researchShowSummaryLine) els.researchShowSummaryLine.checked=!!item.showSummaryLine; if(els.researchGoalValue) els.researchGoalValue.value=item.goalValue??''; if(els.researchRotateLabels) els.researchRotateLabels.checked=!!item.rotateLabels; if(els.researchWrapLabels) els.researchWrapLabels.checked=item.wrapLabels!==false; if(els.researchShowLegend) els.researchShowLegend.checked=!!item.showLegend; if(els.researchShowGridlines) els.researchShowGridlines.checked=item.showGridlines!==false; if(els.researchSmoothLine) els.researchSmoothLine.checked=!!item.smoothLine; if(els.researchUseDots) els.researchUseDots.checked=item.useDots!==false; if(els.researchBarOrientation) els.researchBarOrientation.value=item.barOrientation||'vertical'; if(els.researchStackedBars) els.researchStackedBars.checked=!!item.stackedBars; if(els.researchGroupedBars) els.researchGroupedBars.checked=item.groupedBars!==false; if(els.researchHideZeroGroups) els.researchHideZeroGroups.checked=!!item.hideZeroGroups; if(els.researchHighlightBest) els.researchHighlightBest.checked=!!item.highlightBest; if(els.researchHighlightWorst) els.researchHighlightWorst.checked=!!item.highlightWorst; els.researchRowLimit.value=item.rowLimit||''; els.researchTotals.checked=!!item.totals; if(els.researchTextWrap) els.researchTextWrap.checked=item.textWrap!==false; if(els.researchRowDensity) els.researchRowDensity.value=item.rowDensity||'comfortable';
  renderResearchPopulationEditor(); populateResearchTypedMeasurePicker(item); renderResearchFiltersEditor(); renderResearchColumnsEditor(); renderResearchGroupAxisItemsEditor(); renderPercentBuilderEditor(item); fillGuidedResearchForm(item); updateResearchBuilderVisibility(); renderResearchTypedMeasureMeta(); scheduleResearchJoinPreview(); if(els.researchFoundPreview) els.researchFoundPreview.classList.add('hidden'); if(els.researchMeasureSamplePreview) els.researchMeasureSamplePreview.classList.add('hidden'); openModal('researchEditorModal'); attachResearchGearButtons(els.researchEditorModal);
}
function populateResearchFieldSelectors(item={}){ const sourceVal=els.researchSource.value; const pbSrc=(state.editingPercentBuilder&&state.editingPercentBuilder.fromMode!=='custom_expression')?state.editingPercentBuilder.qualifierSource:''; const hs=getResearchHeaders(sourceVal), pbHs=pbSrc&&pbSrc!==sourceVal?getResearchHeaders(pbSrc):[]; const all=[]; concreteResearchSources().forEach(src=>getResearchHeaders(src.value).forEach(h=>{ all.push(bracketedHeaderSuggestion(h)); all.push(sourceQualifiedFieldSuggestion(src.value,h)); })); const opts=[...new Set([...pbHs.map(bracketedHeaderSuggestion),...hs.map(bracketedHeaderSuggestion),...all,...RESEARCH_TYPED_MEASURES.map(m=>researchMeasureRef(m.id)),...metricSuggestions(),...orgTokenNames()])].filter(Boolean).map(h=>`<option value="${esc(h)}"></option>`).join(''); const dl=el('researchHeaderSuggestions'); if(dl) dl.innerHTML=opts; els.researchDateColumn.value=sourceVal===DATED_SOURCE ? (item.dateColumn||'Date') : (sourceVal===NONDATED_SOURCE?'':(item.dateColumn||'')); els.researchGroupField.value=item.groupField||''; if(els.researchSecondaryGroupField) els.researchSecondaryGroupField.value=item.secondaryGroupField||''; if(els.researchPanelField) els.researchPanelField.value=item.panelField||''; }
function populateResearchTypedMeasurePicker(item={}){
  if(!els.researchTypedMeasure) return;
  const source=resolveDynamicResearchSource({...item,source:els.researchSource?.value||item.source}), grain=els.researchAnalysisGrain?.value||item.analysisGrain||'auto', current=researchMeasureIdFromRef(els.researchValueField?.value||item.valueField)||item.measureId||'';
  const groups=new Map();
  RESEARCH_TYPED_MEASURES.forEach(def=>{
    const resolved=resolveResearchTypedMeasure(def,source), grainOk=grain==='auto'||!def.grains?.length||def.grains.includes(grain), ok=!!resolved?.compatible&&grainOk;
    if(!groups.has(def.category)) groups.set(def.category,[]);
    groups.get(def.category).push(`<option value="${esc(def.id)}" ${def.id===current?'selected':''} ${ok?'':'disabled'}>${esc(def.label)}${ok?'':` — unavailable for ${grain==='auto'?'current data':grain}`}</option>`);
  });
  els.researchTypedMeasure.innerHTML=[...groups.entries()].map(([category,options])=>`<optgroup label="${esc(category)}">${options.join('')}</optgroup>`).join('');
  if(current&&[...els.researchTypedMeasure.options].some(o=>o.value===current&&!o.disabled)) els.researchTypedMeasure.value=current;
  if(!els.researchTypedMeasure.value){ const first=[...els.researchTypedMeasure.options].find(o=>!o.disabled); if(first) els.researchTypedMeasure.value=first.value; }
}
function renderResearchTypedMeasureMeta(){
  if(!els.researchTypedMeasureMeta) return;
  const def=researchTypedMeasureDefinition(els.researchTypedMeasure?.value), item=els.researchSource?currentResearchItemFromEditor():{}, resolved=resolveResearchTypedMeasure(def,item.source);
  if(!def||!resolved){ els.researchTypedMeasureMeta.innerHTML='<div><strong>Measure</strong>No compatible typed measure is available for this source.</div>'; return; }
  const fields=resolved.aggregation==='weighted_rate'?`${resolved.numeratorField||'missing numerator'} / ${resolved.denominatorField||'missing denominator'}`:(resolved.valueField||'No source field required');
  els.researchTypedMeasureMeta.innerHTML=`<div><strong>Measure</strong>${esc(def.label)}</div><div><strong>Source</strong>${esc(labelSource(resolved.source))}</div><div><strong>Formula</strong>${esc(researchTypedMeasureFormula(resolved))}</div><div><strong>Aggregation</strong>${esc(def.aggregation.replaceAll('_',' '))}</div><div><strong>Compatible grains</strong>${esc((def.grains||[]).join(', '))}</div><div><strong>Resolved fields</strong>${esc(fields)}</div><div><strong>Missing values</strong>${esc(els.researchMissingBehavior?.selectedOptions?.[0]?.textContent||def.missingBehavior)}</div>`;
}
function applyResearchTypedMeasureToEditor(asColumn=false){
  const def=researchTypedMeasureDefinition(els.researchTypedMeasure?.value); if(!def) return;
  const item=currentResearchItemFromEditor(), compatibility=researchTypedMeasureCompatible(def,item); if(!compatibility.ok) return alert(`${def.label} is not compatible with the selected source/grain or its required headers are missing.`);
  const col={label:def.label,customTitle:def.label,displayTitle:def.label,mode:'measure',field:researchMeasureRef(def.id),measureId:def.id,showAsPercent:def.valueType==='percentage',missingBehavior:els.researchMissingBehavior?.value||def.missingBehavior};
  if(asColumn){ state.editingResearchColumns=state.editingResearchColumns||[]; state.editingResearchColumns.push(col); renderResearchColumnsEditor(); }
  else { els.researchValueMode.value='measure'; els.researchValueField.value=col.field; if(els.researchShowPercent) els.researchShowPercent.checked=def.valueType==='percentage'; updateResearchBuilderVisibility(); }
  renderResearchTypedMeasureMeta(); scheduleResearchJoinPreview();
}
async function previewResearchMeasureSamples(){
  const box=els.researchMeasureSamplePreview, def=researchTypedMeasureDefinition(els.researchTypedMeasure?.value); if(!box||!def) return;
  box.classList.remove('hidden'); box.innerHTML='<div class="loadingTitle">Preparing five sample calculations...</div>';
  const item=effectiveResearchItem(currentResearchItemFromEditor()), resolved=resolveResearchTypedMeasure(def,item.source);
  try{
    await ensureResearchExecutionIndexes({...item,valueMode:'measure',valueField:researchMeasureRef(def.id),measureId:def.id});
    const planned=buildQueryPlan(item.source,{dateColumn:item.dateColumn,startDate:item.startDate,endDate:item.endDate,filters:item.filters||[],item}), rows=planned.rows, groups=new Map();
    rows.forEach(r=>{ const key=researchGroupLabel(item,r); if(!groups.has(key)&&groups.size<5) groups.set(key,[]); if(groups.has(key)) groups.get(key).push(r); });
    const samples=[...groups.entries()].map(([label,groupRows])=>({label,stats:researchTypedMeasureStats(resolved,groupRows,item,els.researchMissingBehavior?.value)}));
    box.innerHTML=`<strong>${esc(def.label)}</strong><div class="researchCalcCode">${esc(researchTypedMeasureFormula(resolved))}</div><div class="researchTableWrap"><table><thead><tr><th>Sample group</th><th>Result</th><th>Contributing rows</th><th>Numerator</th><th>Denominator</th><th>Missing inputs</th></tr></thead><tbody>${samples.map(s=>`<tr><td>${esc(s.label)}</td><td>${esc(formatResearchValue(s.stats.value,{decimals:2,showPercent:def.valueType==='percentage',valueMode:def.valueType==='percentage'?'percent_item':''}))}</td><td>${s.stats.sourceRows.toLocaleString()}</td><td>${Number(s.stats.numerator||0).toLocaleString()}</td><td>${Number(s.stats.denominator||0).toLocaleString()}</td><td>${(s.stats.missingNumerator+s.stats.missingDenominator+s.stats.missingValue).toLocaleString()}</td></tr>`).join('')||'<tr><td colspan="6">No scoped groups were available.</td></tr>'}</tbody></table></div>`;
  }catch(err){ box.innerHTML=`<div class="researchWarn">${esc(err.message||err)}</div>`; }
}
function populateResearchCriteria(sel){ const m=findModel(els.researchModelSelect.value); els.researchCriteriaSelect.innerHTML=(m?.criteria||[]).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join(''); if(sel) els.researchCriteriaSelect.value=sel; }
function targetDateColumnOptions(source, selected){ return headerOptions(source, selected, true); }
function researchGearDefault(){ return {valuesEnabled:true,selected:null,selectedBuckets:null,bucketSearch:'',conditionResult:'true',valueLevel:'level2',metricLevel:'level2',metricEntityMode:'representative',metricCoachMethod:'direct',metricDecimalBucket:'exact',metricBucketSize:'',customValueEnabled:false,customValueMetric:'count',customValueOp:'greater/equal',customValue1:'',customValue2:'',customTextEnabled:false,customTextOp:'contains',customText:''}; }

function researchRowCoach(r){ return r?.['Job Coach'] || r?.['Coach Assigned'] || r?.Coach || r?.['Team Lead'] || r?.Team || r?._team || ''; }
function metricEntityDisplayKey(row,source,mode='representative',method='direct'){
  if(mode==='coach') return normalizeOrgName(method==='roster' ? (researchRowTeam(row)||rowTeam(row)||'') : (researchRowCoach(row)||researchRowTeam(row)||rowTeam(row)||''));
  return personKeyFromRow(row)||'';
}
function metricBucketLabel(count,metric,cfg={}){
  const n=Number(count)||0;
  if((cfg.metricLevel||cfg.valueLevel||'level2')==='level1') return n>0 ? 'Captured' : 'Not Captured';
  if(metric?.mode==='count') return String(Math.trunc(n));
  const kind=cfg.metricDecimalBucket||'exact';
  if(kind==='rounded') return String(Math.round(n));
  if(kind==='size'){
    const size=Number(cfg.metricBucketSize)||1, low=Math.floor(n/size)*size, high=low+size;
    return `${low}-${high}`;
  }
  return String(n);
}
function metricEntityRowsForBucket(targetSource,bucketEntities,entityMode,coachMethod,item){
  const rows=researchSourceRowsForItem({...item,source:targetSource}), entities=new Set([...bucketEntities].map(normalizeIdentityName));
  if(entityMode==='coach') return rows.filter(r=>entities.has(getCoachIdentity(r,targetSource).normalizedName));
  return rows.filter(r=>entities.has(getRepIdentity(r,targetSource).normalizedName));
}
function getMetricEntityCounts(metric,context={},options={}){
  metric=normalizeMetric(metric); const item=context.item||{}, warnings=context.warnings||[];
  const cfg={...researchGearDefault(),...(options||{})}, metricSource=metric.source||context.source||item.source;
  const cacheParts=['metricEntityCountsV1',metric.id,JSON.stringify(metric),cfg.metricLevel||cfg.valueLevel,cfg.metricEntityMode,cfg.metricCoachMethod,item.source||'',item.startDate||'',item.endDate||'',JSON.stringify(item.filters||[]),researchSourceCacheSignature(),state.dataIndex?.version||0];
  const cacheKey=cacheParts.join('|'); if(state.metricCache?.has(cacheKey)) return state.metricCache.get(cacheKey);
  const allMetricRows=sourceRows(metricSource,{start:parseDateOnly(item.startDate),end:parseDateOnly(item.endDate),dateColumn:researchDefaultDateColumn({source:metricSource}),qaDateMode:els.runQADateSelect?.value||'interaction'});
  const matchedMetricRows=metricRows(metric,allMetricRows,metricSource,warnings);
  const entityMode=cfg.metricEntityMode==='coach'?'coach':'representative', coachMethod=cfg.metricCoachMethod==='roster'?'roster':'direct';
  const countsByEntity=new Map(), bucketByEntity=new Map(), entitiesByBucket=new Map();
  const seedRows=entityMode==='coach' ? researchSourceRowsForItem(item) : researchSourceRowsForItem(item);
  seedRows.forEach(r=>{ const k=metricEntityDisplayKey(r,item.source,entityMode,coachMethod); if(k&&!countsByEntity.has(k)) countsByEntity.set(k,0); });
  if(entityMode==='coach' && coachMethod==='roster'){
    matchedMetricRows.forEach(r=>{ const rep=personKeyFromRow(r); if(!rep) return; const team=(state.repTeams?.get(rep)||researchRowTeam(r)||rowTeam(r)||''); if(team) countsByEntity.set(team,(countsByEntity.get(team)||0)+1); });
  }else{
    matchedMetricRows.forEach(r=>{ const k=metricEntityDisplayKey(r,metricSource,entityMode,coachMethod); if(k) countsByEntity.set(k,(countsByEntity.get(k)||0)+1); });
  }
  countsByEntity.forEach((count,entity)=>{ const b=metricBucketLabel(count,metric,cfg); bucketByEntity.set(entity,b); if(!entitiesByBucket.has(b)) entitiesByBucket.set(b,[]); entitiesByBucket.get(b).push(entity); });
  const out={entityType:entityMode==='coach'?'coach':'rep',entityMode,coachMethod,countsByEntity,bucketByEntity,entitiesByBucket,metricSource,metricLevel:cfg.metricLevel||cfg.valueLevel||'level2'};
  state.metricCache=state.metricCache||new Map(); state.metricCache.set(cacheKey,out); return out;
}

function buildMetricBucketOptions(metricRefOrMetric,researchContext={},metricOptions={}){
  const warnings=researchContext.warnings||[];
  const metric=typeof metricRefOrMetric==='object'?normalizeMetric(metricRefOrMetric):findMetricByRef(metricRefOrMetric);
  const cfg={...researchGearDefault(),...(metricOptions||{})}, level=cfg.metricLevel||cfg.valueLevel||'level2';
  const empty=(reason)=>({ok:false,level,buckets:[],level1:[],level2:[],entitiesByBucket:new Map(),warnings:[reason].filter(Boolean),reason});
  if(!metric) return empty('Missing metric source.');
  const item=researchContext.item||currentResearchItemFromEditor?.()||{};
  const metricSource=metric.source||researchContext.source||item.source;
  if(!metricSource) return empty('Missing metric source.');
  const rawMetricRows=getRowsRaw(metricSource)||[];
  if(!rawMetricRows.length) return empty(`Metric source ${labelSource(metricSource)||metricSource} has no imported rows.`);
  const hs=getResearchHeaders(metricSource)||[];
  const ruleFields=[metric.field,...(metric.rules||[]).map(r=>r.field)].filter(Boolean).filter(f=>!metricRefName(f) && !parseResearchSourceFieldRef(f) && !parseResearchBangField(f));
  const missing=ruleFields.find(f=>!hs.includes(f));
  if(missing) warnings.push(`Metric rule field ${missing} was not found in ${labelSource(metricSource)||metricSource}.`);
  const counts=getMetricEntityCounts(metric,{item,warnings},cfg);
  if(!counts.countsByEntity.size) return {...empty('No representative or coach/team mapping was found for this metric context.'),counts};
  const level2Counts=level==='level2'?counts:getMetricEntityCounts(metric,{item,warnings},{...cfg,metricLevel:'level2',valueLevel:'level2'});
  const mk=(key,entities,label=String(key))=>({key:String(key),label,bucketKey:String(key),bucketLabel:label,countEntities:(entities||[]).length,entityCount:(entities||[]).length,entities:(entities||[]).map(name=>({entityType:counts.entityType,displayName:name,normalizedName:normalizeIdentityName(name),coachDisplayName:state.repTeams?.get?.(normalizeIdentityName(name))||'',sourceRows:[]}))});
  const exact=[...level2Counts.entitiesByBucket.entries()].map(([key,entities])=>mk(key,entities));
  exact.sort((a,b)=>{ const na=Number(a.key), nb=Number(b.key); return Number.isFinite(na)&&Number.isFinite(nb)?na-nb:String(a.label).localeCompare(String(b.label)); });
  const captured=[], notCaptured=[];
  counts.countsByEntity.forEach((count,entity)=>(Number(count)>0?captured:notCaptured).push(entity));
  const level1=[mk('Not Captured',notCaptured,'Not Captured'),mk('Captured',captured,'Captured')];
  const active=level==='level1'?level1:exact;
  const activeMap=new Map(active.map(b=>[b.key,(level==='level2'?level2Counts:counts).entitiesByBucket.get(b.key)||(b.key==='Captured'?captured:b.key==='Not Captured'?notCaptured:[])]));
  const reason=active.length?'':`No ${level==='level1'?'Level 1':'Level 2'} buckets found. The metric evaluated ${counts.countsByEntity.size||0} entities.`;
  return {ok:!!active.length,level,buckets:active,level1,level2:exact,entitiesByBucket:activeMap,counts,warnings:[...warnings],reason};
}
function selectedMetricBucketSet(cfg,buckets){
  const sel=Array.isArray(cfg.selectedBuckets)?cfg.selectedBuckets:(Array.isArray(cfg.selected)?cfg.selected:null);
  if(!sel || !sel.length) return new Set((buckets||[]).map(b=>String(b.key)));
  return new Set(sel.map(String));
}

function splitTeamFilterTokens(rawInput){ return String(rawInput||'').split(',').map(x=>x.trim()).filter(Boolean); }
function teamFilterKey(v){ return normalizeOrgName(v).replace(/[\s\p{P}]+/gu,''); }
function knownTeamAliasMap(){ const m=new Map(); knownCoachNames().forEach(n=>{ const k=teamFilterKey(n); if(k&&!m.has(k)) m.set(k,n); const parts=String(n).trim().split(/\s+/); if(parts.length>=2){ const rev=teamFilterKey(parts.slice(1).join(' ')+' '+parts[0]); if(rev&&!m.has(rev)) m.set(rev,n); } }); return m; }
function teamFilterSuggestions(prefix=''){
  const last=String(prefix||'').split(',').pop().trim(), orgMode=last.startsWith('$'), q=teamFilterKey(last.replace(/^\$/,''));
  const orgs=orgTokenNames().filter(v=>!q||teamFilterKey(v.replace(/^\$/,'')).includes(q));
  const teams=knownCoachNames().filter(v=>!q||teamFilterKey(v).includes(q));
  return (orgMode?[...orgs,...teams]:[...teams,...orgs]).slice(0,50);
}
function resolveTeamFilterSelection(rawInput, options = {}){
  const rawTokens=splitTeamFilterTokens(rawInput), alias=knownTeamAliasMap(), teamNames=[], orgNames=[], expandedTeams=[], missingTeams=[], missingOrgs=[], warnings=[];
  const addTeam=(name, fromOrg=false)=>{ const key=teamFilterKey(name); if(!key) return; const known=alias.get(key); if(!known && !fromOrg){ missingTeams.push(name); return; } const final=known||String(name).trim(); if(!teamNames.some(t=>teamFilterKey(t)===teamFilterKey(final))) teamNames.push(final); if(!expandedTeams.some(t=>teamFilterKey(t)===teamFilterKey(final))) expandedTeams.push(final); };
  rawTokens.forEach(tok=>{
    if(tok.startsWith('$')){
      const orgName=tok.replace(/^\$/,'').trim(), org=findOrg(orgName); orgNames.push(orgName);
      if(!org){ missingOrgs.push(orgName); warnings.push(`Org not found: ${orgName}`); return; }
      if(!(org.coachNames||[]).length){ warnings.push(`Org has no teams/coaches: ${org.name}`); return; }
      (org.coachNames||[]).forEach(t=>addTeam(t,true));
    }else addTeam(tok,false);
  });
  if(missingTeams.length) warnings.push(`${missingTeams.length} teams not found: ${missingTeams.join(', ')}`);
  if(rawTokens.length && !expandedTeams.length) warnings.push('No teams matched this filter.');
  return {ok:!warnings.length,rawTokens,teamNames,orgNames,expandedTeams,missingTeams,missingOrgs,warnings};
}
function rowTeamFilterCandidates(row, sourceKey='', context={}){
  const c=[]; const add=v=>{ v=String(v||'').trim(); if(v&&!c.some(x=>teamFilterKey(x)===teamFilterKey(v))) c.push(v); };
  add(researchRowTeam(row)); add(rowTeam(row)); add(researchRowCoach(row)); if(row?._repKey) add(state.repTeams?.get(row._repKey));
  return c;
}
function rowMatchesTeamFilter(row, sourceKey, resolvedTeamFilter, conditionResult=true, context={}){
  const set=new Set((resolvedTeamFilter?.expandedTeams||[]).map(teamFilterKey));
  const hit=rowTeamFilterCandidates(row,sourceKey,context).some(v=>set.has(teamFilterKey(v)));
  return conditionResultIsTrue(conditionResult)?hit:!hit;
}
function entityMatchesTeamFilter(entityName, entityType, resolvedTeamFilter, conditionResult=true, context={}){
  const set=new Set((resolvedTeamFilter?.expandedTeams||[]).map(teamFilterKey)); let candidates=[entityName];
  if(entityType==='rep'||entityType==='representative'){ const k=norm(entityName); candidates.push(state.repTeams?.get(k)||''); }
  const hit=candidates.some(v=>set.has(teamFilterKey(v))); return conditionResultIsTrue(conditionResult)?hit:!hit;
}
function teamFilterWarningHtml(f){ const res=resolveTeamFilterSelection(f.teamInput||f.rawTeamInput||f.value||''); return res.warnings.length?`<div class="teamFilterWarn">Team filter warning: ${esc(res.warnings.join('; '))}</div>`:''; }
function teamFilterChipsHtml(f,i){ return splitTeamFilterTokens(f.teamInput||f.rawTeamInput||f.value||'').map(t=>`<span class="teamFilterChip">${esc(t)} <button type="button" data-team-chip-remove="${i}" data-token="${esc(t)}">×</button></span>`).join(''); }

function conditionResultIsTrue(v){ return v===true || v==='true' || v==null || v===''; }
function resolveResearchCohortFromAxisItem(axisItem,researchContext={}){
  const item=researchContext.item||{}, rows=researchContext.rows||researchSourceRowsForItem(item), universeRows=researchContext.universeRows||rows, warnings=researchContext.warnings||[];
  const expr=axisItem.expression||axisItem.raw||axisItem.field||''; const cfg={...researchGearDefault(),...(axisItem||{})};
  const metric=findMetricByRef(expr);
  if(metric){
    const opts=buildMetricBucketOptions(metric,{item,warnings},cfg), selected=axisItem.bucketKey?new Set([String(axisItem.bucketKey)]):selectedMetricBucketSet(cfg,opts.buckets);
    const included=new Set(), excluded=new Set();
    opts.entitiesByBucket.forEach((ents,b)=>ents.forEach(e=>(selected.has(String(b))?included:excluded).add(normalizeOrgName(e))));
    const finalIncluded=conditionResultIsTrue(cfg.conditionResult)?included:excluded;
    const sourceRowsBySource=new Map();
    allSourceKeys().forEach(src=>sourceRowsBySource.set(src,metricEntityRowsForBucket(src,finalIncluded,opts.counts.entityMode,opts.counts.coachMethod,{...item,source:src})));
    return {cohortType:'entities',entityMode:opts.counts.entityMode, includedEntities:finalIncluded, excludedEntities:conditionResultIsTrue(cfg.conditionResult)?excluded:included, sourceRowsBySource,bucketKey:axisItem.bucketKey||'',bucketLabel:axisItem.bucketLabel||'',label:axisItem.label||metric.name||expr};
  }
  const term=parseResearchMultiAddTerms(expr)[0]||{source:item.source,token:expr,label:axisItem.label||expr}; const src=axisItem.source||term.source||item.source;
  const matched=researchRowsMatchingToken(src,axisItem.token||term.token,{...item,source:src,groupField:''});
  const matchedSet=new Set(src===item.source?matched:researchRowsForCohort(item.source,matched,src,item));
  const includedRows=(conditionResultIsTrue(cfg.conditionResult)?rows.filter(r=>matchedSet.has(r)):rows.filter(r=>!matchedSet.has(r)));
  const includedEntities=new Set(includedRows.map(r=>normalizeOrgName(personKeyFromRow(r))).filter(Boolean));
  return {cohortType:'rows',entityMode:'representative',includedEntities,excludedEntities:new Set(),sourceRowsBySource:new Map([[item.source,includedRows]]),label:axisItem.label||term.label||expr};
}

function metricFilterRowPass(row,item,filter,warnings=[]){
  const metric=findMetricByRef(filter.field); if(!metric) return null;
  const cfg=researchGearGetForItem(item,'filterField:'+((item.filters||[]).indexOf(filter))); const counts=getMetricEntityCounts(metric,{item,warnings},cfg);
  const entity=metricEntityDisplayKey(row,item.source,counts.entityMode,counts.coachMethod), count=counts.countsByEntity.get(entity)||0, op=filter.op||'equals', val=filter.value;
  let ok=false; if(op==='captured') ok=count>0; else if(op==='not captured') ok=count<=0; else ok=compareFilter(count,({'equals':'is','not equals':'is not','greater than':'greater than','greater than or equal to':'greater/equal','less than':'less than','less than or equal to':'less/equal'}[op]||op),val,filter.value2);
  return (filter.include==='exclude'||filter.include==='excludeWithin') ? !ok : ok;
}

function researchGearGet(key){ const all=state.editingResearchGear||(state.editingResearchGear={}); return {...researchGearDefault(),...(all[key]||{})}; }
function researchGearFieldForKey(item,key,colIndex){
  if(key.startsWith('groupAxisItem:')) return (item.groupAxisItems||[]).find(x=>x.id===key.split(':')[1])?.expression||'';
  if(key==='dateColumn') return item.dateColumn; if(key==='groupField') return item.groupField; if(key==='secondaryGroupField') return item.secondaryGroupField; if(key==='panelField') return item.panelField; if(key==='valueField') return item.valueField;
  if(key.startsWith('filterField:')) return (item.filters||[])[Number(key.split(':')[1])]?.field||'';
  if(key==='filterField') return (item.filters||[])[colIndex]?.field||'';
  if(key.startsWith('columnField:')){
    const i=Number(key.split(':')[1]);
    const dom=els.researchColumns?.querySelector(`[data-rc="field"][data-i="${i}"]`);
    return (dom?.value || (item.columns||[])[i]?.field || '').trim();
  }
  if(key==='columnField') return (item.columns||[])[colIndex]?.field||''; return '';
}
const researchDistinctCache=new Map();
function researchRowsCacheKey(source,rows){ return `${source}|${state.dataIndex?.version||0}|${(rows||[]).length}`; }
function researchGearUniqueValues(rows,field,source,limit=5000){ const cacheKey=`${researchRowsCacheKey(source,rows)}|${field}|${limit}`; if(researchDistinctCache.has(cacheKey)) return researchDistinctCache.get(cacheKey).slice(); const seen=new Set(), out=[]; for(const r of rows||[]){ const v=String(researchFieldValue(r,field,source)??'(blank)'); if(!seen.has(v)){ seen.add(v); out.push(v); if(out.length>=limit) break; } } out.sort((a,b)=>a.localeCompare(b)); researchDistinctCache.set(cacheKey,out.slice()); return out; }
function researchFilterSuggestionValues(item,field,query,limit=10){
  item=effectiveResearchItem(item||{});
  const q=normalizeResearchText(query); if(!field || !q) return [];
  const rows=applyResearchFilters(researchSourceRowsForItem(item), (item.filters||[]).filter(f=>f.field!==field || String(f.value||'').trim()===''), item);
  const vals=researchGearUniqueValues(rows,field,item.source,2000), out=[];
  for(const v of vals){ if(normalizeResearchText(v).includes(q)){ out.push(v); if(out.length>=limit) break; } }
  return out;
}
function attachResearchFilterValueSuggestions(){
  els.researchFilters?.querySelectorAll('[data-rf="value"]').forEach(inp=>{
    inp.oninput=()=>{ const i=+inp.dataset.i, f=state.editingResearchFilters[i]||{}; f.value=inp.value; const ok=['include','exclude',undefined,''].includes(f.include)&&['contains','does not contain','is','is not','is in org','is not in org','includes org','excludes org'].includes(f.op||'contains'); let box=inp.parentElement.querySelector('.researchValueSuggestions'); if(box) box.remove(); if(String(inp.value||'').trim().startsWith('$')){ showOrgSuggestionsForInput(inp,v=>{ inp.value=v; f.value=v; }); return; } if(!ok||!f.field||!inp.value.trim()) return; const item=currentResearchItemFromEditor(), vals=researchFilterSuggestionValues(item,f.field,inp.value,10); if(!vals.length) return; inp.parentElement.classList.add('researchSuggestWrap'); box=document.createElement('div'); box.className='researchValueSuggestions'; box.innerHTML=vals.map(v=>`<div class="researchValueSuggestion" data-v="${esc(v)}">${esc(v)}</div>`).join(''); inp.parentElement.appendChild(box); box.querySelectorAll('[data-v]').forEach(d=>d.onclick=()=>{ inp.value=d.dataset.v; f.value=inp.value; box.remove(); }); };
    inp.onblur=()=>setTimeout(()=>inp.parentElement.querySelector('.researchValueSuggestions')?.remove(),180);
  });
}
function showOrgSuggestionsForInput(inp,onPick){ let box=inp.parentElement.querySelector('.researchValueSuggestions'); if(box) box.remove(); const q=normalizeOrgName(String(inp.value||'').replace(/^\$/,'')); const vals=(state.orgs||[]).filter(o=>!q||normalizeOrgName(o.name).includes(q)).slice(0,10).map(o=>'$'+o.name); if(!vals.length) return; inp.parentElement.classList.add('researchSuggestWrap'); box=document.createElement('div'); box.className='researchValueSuggestions'; box.innerHTML=vals.map(v=>`<div class="researchValueSuggestion" data-v="${esc(v)}">${esc(v)}</div>`).join(''); inp.parentElement.appendChild(box); box.querySelectorAll('[data-v]').forEach(d=>d.onclick=()=>{ onPick(d.dataset.v); box.remove(); }); }

function parseMultiPhraseValueInput(raw){
  if(Array.isArray(raw)) raw=raw.join(',');
  const text=String(raw||'').replace(/[“”]/g,'"').replace(/[‘’]/g,"'");
  const out=[], seen=new Set(); let cur='', quote='';
  const add=()=>{ const v=cur.trim().replace(/^['"]|['"]$/g,'').replace(/\s+/g,' '); cur=''; if(!v) return; const k=normalizeResearchText(v); if(k&&!seen.has(k)){ seen.add(k); out.push(v); } };
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quote){ if(ch===quote) quote=''; else cur+=ch; continue; }
    if(ch==='"' || ch==="'"){ quote=ch; continue; }
    if(ch===',' || ch===';'){ add(); continue; }
    cur+=ch;
  }
  add();
  return out;
}
function normalizedTextOperator(op){
  const v=normalizeResearchText(op).replace(/[_-]+/g,' ');
  if(['notcontains','doesnotcontain','textdoesnotcontain','excludes','exclude'].includes(v.replace(/\s+/g,''))) return 'does not contain';
  if(['contains','textcontains','includes','include'].includes(v.replace(/\s+/g,''))) return 'contains';
  return v;
}
function isMultiPhraseTextOperator(op){ return ['contains','does not contain','text contains','text does not contain','includes','excludes'].includes(normalizedTextOperator(op)); }
function filterPhrases(f){ const vals=Array.isArray(f?.values)?f.values:(Array.isArray(f?.phrases)?f.phrases:null); return parseMultiPhraseValueInput(vals||f?.value||f?.targetValue||''); }
function parseResearchTextPhrases(s){ return parseMultiPhraseValueInput(s).map(v=>normalizeResearchText(v)); }
function textMatchesAnyPhrase(text, phrases, options = {}){
  const hay=options.caseSensitive?String(text??''):normalizeResearchText(text);
  return parseMultiPhraseValueInput(phrases).some(p=>{ const needle=options.caseSensitive?String(p):normalizeResearchText(p); return needle ? hay.includes(needle) : false; });
}
function matchedTextPhrases(text, phrases, options = {}){
  const hay=options.caseSensitive?String(text??''):normalizeResearchText(text);
  return parseMultiPhraseValueInput(phrases).filter(p=>{ const needle=options.caseSensitive?String(p):normalizeResearchText(p); return needle && hay.includes(needle); });
}
function evaluateMultiPhraseTextCondition(text, operator, phrases, conditionResult = true){
  const list=parseMultiPhraseValueInput(phrases); if(!list.length) return true;
  const any=textMatchesAnyPhrase(text,list);
  const base=normalizedTextOperator(operator)==='does not contain' ? !any : any;
  return conditionResultIsTrue(conditionResult) ? base : !base;
}
function entityKeyForMultiPhraseRow(row, context={}){
  const mode=context.entityMode||context.item?.entityMode||context.item?.metricEntityMode||'representative';
  if(mode==='coach'||mode==='team') return normalizeOrgName(researchRowCoach(row)||researchRowTeam(row)||rowTeam(row)||state.repTeams?.get(personKeyFromRow(row))||'');
  return normalizeOrgName(personKeyFromRow(row));
}
function entityMatchesMultiPhraseCondition(entityRows, fieldRef, operator, phrases, conditionResult=true, context={}){
  const list=parseMultiPhraseValueInput(phrases); if(!list.length) return true;
  const ref=parseResearchSourceFieldRef(fieldRef), source=(ref&&!ref.missingSource&&!ref.missingField)?ref.source:(context.source||context.item?.source||''), field=(ref&&!ref.missingSource&&!ref.missingField)?ref.field:fieldRef;
  const any=(entityRows||[]).some(r=>textMatchesAnyPhrase(researchFieldValue(r,field,source),list));
  const base=normalizedTextOperator(operator)==='does not contain' ? !any : any;
  return conditionResultIsTrue(conditionResult) ? base : !base;
}
function highlightMatchedPhrases(text, phrases){
  let html=esc(text); parseMultiPhraseValueInput(phrases).sort((a,b)=>b.length-a.length).forEach(p=>{ if(!p) return; html=html.replace(new RegExp(escapeRegExp(esc(p)),'ig'),m=>`<mark>${m}</mark>`); }); return html;
}
function researchGearNumericInvalid(cfg,item,field,rows){ if(!cfg.customValueEnabled || cfg.customValueMetric==='count') return ''; const res=researchNumericValidation(item,field,rows); return res.ok?'':'This custom value rule requires numbers, but this field is returning text.'; }
function compareResearchGearNumber(v,op,a,b){ const n=toNum(v), x=toNum(a), y=toNum(b); if(!Number.isFinite(n)||!Number.isFinite(x)) return false; if(op==='between') return Number.isFinite(y)&&n>=Math.min(x,y)&&n<=Math.max(x,y); if(op==='greater than') return n>x; if(op==='greater/equal') return n>=x; if(op==='less than') return n<x; if(op==='less/equal') return n<=x; return true; }
function researchGearRowPass(r,cfg,item,field){ if(!cfg) return true; const raw=researchFieldValue(r,field,item.source), val=String(raw??'(blank)'); if(cfg.valuesEnabled!==false && Array.isArray(cfg.selected) && !cfg.selected.includes(val)) return false; if(cfg.customTextEnabled){ const phrases=parseResearchTextPhrases(cfg.customText), t=String(raw??'').toLowerCase(); if(phrases.length){ if(cfg.customTextOp==='is'&&!phrases.some(p=>t===p)) return false; else if(cfg.customTextOp==='does not contain'&&phrases.some(p=>t.includes(p))) return false; else if((cfg.customTextOp||'contains')==='contains'&&!phrases.some(p=>t.includes(p))) return false; } } if(cfg.customValueEnabled && cfg.customValueMetric==='each' && !compareResearchGearNumber(raw,cfg.customValueOp||'greater/equal',cfg.customValue1,cfg.customValue2)) return false; return true; }
function researchGearGroupPass(rows,cfg,item,field){ if(!cfg?.customValueEnabled || cfg.customValueMetric==='each') return true; const metric=cfg.customValueMetric||'count'; const v=metric==='sum' ? rows.reduce((a,r)=>{ const n=evaluateResearchNumericField(r,field,item.source); return a+(Number.isFinite(n)?n:0); },0) : rows.length; return compareResearchGearNumber(v,cfg.customValueOp||'greater/equal',cfg.customValue1,cfg.customValue2); }
function applyResearchGearRowFilters(rows,item,warnings=[]){ const gears=item.gearFilters||{}; for(const key of Object.keys(gears)){ const cfg={...researchGearDefault(),...gears[key]}; if(key.startsWith('columnField:') && cfg.valueLevel==='level2') continue; const field=researchGearFieldForKey(item,key,+(key.split(':')[1]||0)); if(!field) continue; const bad=researchGearNumericInvalid(cfg,item,field,rows); if(bad){ warnings.push(bad); continue; } if(cfg.valuesEnabled!==false || cfg.customTextEnabled || (cfg.customValueEnabled&&cfg.customValueMetric==='each')) rows=rows.filter(r=>researchGearRowPass(r,cfg,item,field)); } return rows; }
function researchGearButton(key){ return `<button class="smallBtn researchGearBtn" type="button" data-research-gear="${esc(key)}" title="Filter values for this field">⚙</button>`; }
function syncResearchEditorStateFromDom(){ if(els.researchFilters) els.researchFilters.querySelectorAll('[data-rf]').forEach(x=>{ const i=+x.dataset.i; if(state.editingResearchFilters?.[i]) state.editingResearchFilters[i][x.dataset.rf]=x.type==='checkbox'?x.checked:x.value; }); if(els.researchColumns) els.researchColumns.querySelectorAll('[data-rc]').forEach(x=>{ const i=+x.dataset.i; if(state.editingResearchColumns?.[i]) state.editingResearchColumns[i][x.dataset.rc]=x.type==='checkbox'?x.checked:x.value; }); }
function attachResearchGearButtons(root=document){ root.querySelectorAll('[data-research-gear]').forEach(b=>b.onclick=()=>{ syncResearchEditorStateFromDom(); openResearchGearPopup(b.dataset.researchGear); }); }

function modelReferenceSuggestions(query=''){
  const q=normalizeResearchText(query); const out=[];
  (state.models||[]).forEach(m=>{
    const mn=m.name||m.id||'Model';
    if(!q||normalizeResearchText(mn).includes(q)) out.push({label:mn,detail:'Whole model',insert:`model(${JSON.stringify(mn)})`,model:mn});
    (m.criteria||[]).forEach(c=>{ const cn=c.name||c.id||'Criteria', text=`${mn} ${cn} ${c.source||''} ${c.mode||c.scoreType||''}`; if(!q||normalizeResearchText(text).includes(q)) out.push({label:`${mn} / ${cn}`,detail:`${c.source||'source'} ${c.mode||c.scoreType||''}`,insert:`model(${JSON.stringify(mn)},${JSON.stringify(cn)})`,model:mn,criteria:cn}); });
  });
  return out.slice(0,40);
}
function parseModelRef(field){
  const raw=String(field||'').trim(); let m=raw.match(/^model\(\s*["']([^"']+)["']\s*(?:,\s*["']([^"']+)["']\s*)?\)$/i); if(m) return {model:m[1],criteria:m[2]||''};
  if(raw.startsWith(';')){ const body=raw.slice(1), dot=body.indexOf('.'); return dot>=0?{model:body.slice(0,dot).trim(),criteria:body.slice(dot+1).trim()}:{model:body.trim(),criteria:''}; }
  return null;
}
function findModelByNameOrId(name){ return (state.models||[]).find(m=>m.id===name||m.name===name)||null; }
function findCriterionByNameOrId(model,name){ return (model?.criteria||[]).find(c=>c.id===name||c.name===name)||null; }
function attachModelReferencePicker(root=document){
  root.querySelectorAll('input').forEach(inp=>{
    if(inp.dataset.modelPickerAttached) return; inp.dataset.modelPickerAttached='1';
    inp.addEventListener('input',()=>{
      let v=inp.value, pos=inp.selectionStart??v.length, before=v.slice(0,pos), m=before.match(/;([^;\s]*)$/); let old=inp.parentElement?.querySelector('.researchValueSuggestions[data-model-picker]'); if(old) old.remove();
      if(!m) return; const suggestions=modelReferenceSuggestions(m[1]); if(!suggestions.length) return;
      inp.parentElement.classList.add('researchSuggestWrap'); const box=document.createElement('div'); box.className='researchValueSuggestions'; box.dataset.modelPicker='1'; box.innerHTML=suggestions.map((x,i)=>`<div class="researchValueSuggestion" data-i="${i}"><strong>${esc(x.label)}</strong><div class="hint">${esc(x.detail)}</div></div>`).join(''); inp.parentElement.appendChild(box);
      box.querySelectorAll('[data-i]').forEach(d=>d.onclick=()=>{ const sug=suggestions[+d.dataset.i], start=pos-m[0].length; inp.value=v.slice(0,start)+sug.insert+v.slice(pos); inp.dispatchEvent(new Event('input',{bubbles:true})); box.remove(); inp.focus(); });
    });
  });
}
function modelEntryRowsForResearchRows(rows){ const entries=new Map(); (rows||[]).forEach(r=>{ const k=personKeyFromRow(r)||researchRowTeam(r); if(k) entries.set(k,{kind:personKeyFromRow(r)?'rep':'team',key:k,name:r._rep||r['Agent Name']||r['Associate Name']||r['Representative']||k,team:researchRowTeam(r)||r._team||''}); }); return [...entries.values()]; }
function evaluateModelReferenceValue(ref,rows,item,mode='direct',warnings=[]){
  const model=findModelByNameOrId(ref.model); if(!model){ warnings.push(`Missing model: ${ref.model}`); return ''; }
  const criteria=ref.criteria?[findCriterionByNameOrId(model,ref.criteria)].filter(Boolean):(model.criteria||[]);
  if(ref.criteria&&!criteria.length){ warnings.push(`Missing model criteria: ${ref.model} / ${ref.criteria}`); return ''; }
  const opts={start:parseDateOnly(item.startDate),end:parseDateOnly(item.endDate),qaDateMode:els.runQADateSelect?.value||'interaction',_sourceRowsCache:new Map(),_entryRowsCache:new Map()};
  const vals=[]; modelEntryRowsForResearchRows(rows).forEach(e=>criteria.forEach(c=>vals.push(criterionValue(c,e,opts))));
  if(mode==='count') return vals.filter(v=>Number.isFinite(toNum(v))?toNum(v)>0:String(v??'').trim()).length;
  if(mode==='unique') return new Set(modelEntryRowsForResearchRows(rows).map(e=>e.key)).size;
  const nums=vals.map(toNum).filter(Number.isFinite); if(['sum','avg','min','max','percent_total','percent_parent','expression'].includes(mode)){ if(!nums.length){ warnings.push(`Model criteria returned text for numeric mode: ${ref.model}${ref.criteria?' / '+ref.criteria:''}`); return 0; } if(mode==='avg') return nums.reduce((a,b)=>a+b,0)/nums.length; if(mode==='min') return Math.min(...nums); if(mode==='max') return Math.max(...nums); return nums.reduce((a,b)=>a+b,0); }
  return nums.length===vals.length&&nums.length ? nums.reduce((a,b)=>a+b,0) : vals.filter(v=>String(v??'').trim()).join(', ');
}
function researchExpressionAddWarning(warnings,message){ if(warnings && message && !warnings.includes(message)) warnings.push(message); }
function researchExpressionHasMath(expression){ return /(^|[^A-Za-z0-9_])[-+*/](?![A-Za-z0-9_])/.test(String(expression||'')); }
function findMetricByNameOrId(name){
  const raw=String(name||'').trim(), norm=normalizeResearchText(raw);
  if(!raw) return null;
  return (state.metrics||[]).find(m=>m.id===raw||m.name===raw)||
    (state.metrics||[]).find(m=>normalizeResearchText(m.name)===norm||normalizeResearchText(m.id)===norm)||
    (state.metrics||[]).find(m=>researchExpressionAlias(m.name)===researchExpressionAlias(raw)||researchExpressionAlias(m.id)===researchExpressionAlias(raw))||null;
}
function findModelCriterionReferenceByName(name){
  const raw=String(name||'').trim(), norm=normalizeResearchText(raw); if(!raw) return null;
  for(const m of (state.models||[])){
    const crit=(m.criteria||[]).find(c=>c.id===raw||c.name===raw)||
      (m.criteria||[]).find(c=>normalizeResearchText(c.name)===norm||normalizeResearchText(c.id)===norm);
    if(crit) return {model:m.name||m.id,criteria:crit.name||crit.id};
  }
  return null;
}
function researchAggregateColumnValue(rows,item,field,fn='sum',warnings=[]){
  const bang=parseResearchBangField(field); let src=item.source, actualField=field, useRows=rows||[];
  if(bang){ src=bang.source; actualField=bang.field; useRows=researchRowsForCohort(src,rows,item.source,item); }
  else { const inferred=researchUniqueSourceForHeader(field,item.source); if(inferred && inferred.source!==item.source){ src=inferred.source; actualField=inferred.field; useRows=researchRowsForCohort(src,rows,item.source,item); } }
  const vals=(useRows||[]).map(r=>researchFieldValue(r,actualField,src)).filter(v=>String(v??'').trim()!=='');
  if(fn==='count') return vals.length;
  if(fn==='unique') return new Set(vals.map(v=>String(v??'').trim()).filter(Boolean)).size;
  const nums=vals.map(toNum).filter(Number.isFinite);
  if(vals.length && nums.length!==vals.length) researchExpressionAddWarning(warnings,`Expression requires numeric values: ${field}`);
  if(!nums.length) return 0;
  if(fn==='avg') return nums.reduce((a,b)=>a+b,0)/nums.length;
  if(fn==='min') return Math.min(...nums);
  if(fn==='max') return Math.max(...nums);
  return nums.reduce((a,b)=>a+b,0);
}
function researchExpressionAlias(v){ return normalizeResearchText(v).replace(/[^a-z0-9]/g,''); }
function resolveResearchExpressionField(token,item){
  item=effectiveResearchItem(item||{});
  const raw=String(token||'').trim(); if(!raw) return '';
  const hs=getResearchHeaders(item.source);
  const direct=resolveColumn(item.source,raw); if(direct && hs.includes(direct)) return direct;
  const norm=normalizeResearchText(raw), alias=researchExpressionAlias(raw);
  return hs.find(h=>h===raw)||hs.find(h=>normalizeResearchText(h)===norm)||hs.find(h=>researchExpressionAlias(h)===alias)||'';
}
function resolveResearchAggregateReference(name,item,rows,warnings=[],fn='sum'){
  let raw=String(name||'').trim(); if(!raw) return {found:false,value:0};
  const simpleBracket=raw.match(/^\[\s*([^\]]+?)\s*\]$/);
  if(simpleBracket) raw=simpleBracket[1].trim();
  const sourceRef=parseResearchSourceFieldRef(raw);
  if(sourceRef){
    if(sourceRef.missingSource || sourceRef.missingField){ addSourceQualifiedRefWarning(warnings,sourceRef); return {found:false,value:0,kind:'missingCrossColumn'}; }
    const crossRows=researchRowsForCohort(sourceRef.source,rows,item.source,item);
    if(!crossRows.length && sourceRef.source!==item.source && (rows||[]).length) researchExpressionAddWarning(warnings,`No matching reps/coaches found between ${labelSource(item.source)} and ${labelSource(sourceRef.source)}`);
    const crossItem={...item,source:sourceRef.source};
    return {found:true,value:researchAggregateColumnValue(crossRows,crossItem,sourceRef.field,fn,warnings),kind:'crossColumn'};
  }
  const metric=findMetricByNameOrId(raw) || findMetricByRef(raw);
  if(metric){ const metricSource=metric.source||item.source; const metricRows=researchRowsForCohort(metricSource,rows,item.source,item); return {found:true,value:evaluateMetric(metric,metricRows,metricSource,warnings)??0,kind:'metric'}; }
  const modelRef=parseModelRef(raw) || findModelCriterionReferenceByName(raw);
  if(modelRef) return {found:true,value:evaluateModelReferenceValue(modelRef,rows,item,fn,warnings)||0,kind:'model'};
  const field=resolveResearchExpressionField(raw,item);
  if(field) return {found:true,value:researchAggregateColumnValue(rows,item,field,fn,warnings),kind:'column'};
  const inferred=researchBestSourceForHeader(raw,item.source,rows,item);
  if(inferred && inferred.source && inferred.source!==item.source){
    const crossRows=researchRowsForCohort(inferred.source,rows,item.source,item);
    const crossItem={...item,source:inferred.source};
    return {found:true,value:researchAggregateColumnValue(crossRows,crossItem,inferred.field,fn,warnings),kind:'crossColumn'};
  }
  researchExpressionAddWarning(warnings,`Unknown expression reference: ${raw}`);
  return {found:false,value:0,kind:'missing'};
}
function escapeResearchRegex(s){ return String(s||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function replaceResearchAggregateReferences(expr,item,rows,warnings=[]){
  const hold=[]; const keep=(v,raw)=>`__research_ref_${hold.push({value:v,raw})-1}__`;
  const valueFor=(name,fn='sum')=>{ const res=resolveResearchAggregateReference(name,item,rows,warnings,fn); return keep(res.value,name); };
  expr=expr.replace(/\b(sum|avg|count|unique|min|max)\s*\(\s*(!\s*\[[^\]]+\]\s*\.\s*\[[^\]]+\]|!\s*[^!()[\]+\-*/,\n\r]+?\s*[:.]\s*[^!()[\]+\-*/,\n\r]+?)\s*\)/gi,(_,fn,ref)=>keep(resolveResearchAggregateReference(ref,item,rows,warnings,fn.toLowerCase()).value,ref));
  expr=replaceResearchSourceFieldRefs(expr,(m,ref)=>keep(resolveResearchAggregateReference(m,item,rows,warnings,'sum').value,m));
  expr=expr.replace(/model\(\s*["']([^"']+)["']\s*(?:,\s*["']([^"']+)["']\s*)?\)/gi,(_,m,c)=>keep(evaluateModelReferenceValue({model:m,criteria:c||''},rows,item,'sum',warnings)||0, c?`${m} / ${c}`:m));
  expr=expr.replace(/;([A-Za-z0-9 _-]+)\.([A-Za-z0-9 _.-]+)/g,(_,m,c)=>keep(evaluateModelReferenceValue({model:m.trim(),criteria:c.trim()},rows,item,'sum',warnings)||0, `${m.trim()} / ${c.trim()}`));
  expr=expr.replace(/@([A-Za-z0-9 _.-]+)/g,(_,n)=>valueFor(n,'sum'));
  expr=expr.replace(/\b(sum|avg|count|unique|min|max)\s*\(\s*\[([^\]]+)\]\s*\)/gi,(_,fn,f)=>valueFor(f,fn.toLowerCase()));
  expr=expr.replace(/\b(sum|avg|count|unique|min|max)\s*\(\s*([A-Za-z_][A-Za-z0-9_ ]*?)\s*\)/gi,(_,fn,f)=>valueFor(f,fn.toLowerCase()));
  expr=expr.replace(/\brow\s*\[\s*["']([^"']+)["']\s*\]/gi,(_,f)=>valueFor(f,'sum'));
  expr=expr.replace(/\[([^\]]+)\]/g,(_,f)=>valueFor(f,'sum'));
  const names=[...(state.metrics||[]).map(m=>m.name).filter(Boolean),...getResearchHeaders(item.source),...allSourceKeys().flatMap(src=>getResearchHeaders(src))].filter(Boolean).sort((a,b)=>b.length-a.length);
  names.forEach(n=>{
    const rx=new RegExp(`(^|[^A-Za-z0-9_\\]'"@])(${escapeResearchRegex(n)})(?=$|[^A-Za-z0-9_\\['"])`,'gi');
    expr=expr.replace(rx,(m,p,found)=>p+valueFor(found,'sum'));
  });
  expr=expr.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g,(token,offset,whole)=>{
    if(token==='Math' || token==='NaN' || token==='Infinity' || token.startsWith('__research_ref_')) return token;
    const before=whole.slice(Math.max(0,offset-2),offset), after=whole.slice(offset+token.length,offset+token.length+1);
    if(before.endsWith('__') || after==='(' || /^research_ref_\d+$/.test(token)) return token;
    const res=resolveResearchAggregateReference(token,item,rows,warnings,'sum');
    return res.found ? valueFor(token,'sum') : '0';
  });
  hold.forEach((entry,i)=>{ expr=expr.replaceAll(`__research_ref_${i}__`,String(Number.isFinite(toNum(entry.value))?toNum(entry.value):0)); });
  return expr;
}
function researchExpressionDivisionWarning(raw,warnings){
  const refMatch=String(raw||'').match(/\/\s*(!\s*\[[^\]]+\]\s*\.\s*\[[^\]]+\]|!\s*[^!()[\]+\-*/,\n\r]+?\s*[:.]\s*[^!()[\]+\-*/,\n\r]+?)(?=$|[\s()[\]+\-*/,])/i);
  const ref=refMatch?parseResearchSourceFieldRef(refMatch[1]):null;
  if(ref && !ref.missingSource && !ref.missingField){ researchExpressionAddWarning(warnings,`Denominator is zero for ${ref.rawField} in ${labelSource(ref.source)}`); return; }
  const m=String(raw||'').match(/\/\s*(?:\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_ ]*))/);
  researchExpressionAddWarning(warnings,`Expression denominator is zero or missing${m?': '+(m[1]||m[2]).trim():'.'}`);
}
function evaluateResearchAggregateExpression(item, rows, expression, ctx={}){
  const warnings=ctx.warnings||[], raw=normalizeResearchLooseSourceReferences(String(expression||'').trim());
  if(!raw) return '';
  if(!researchExpressionHasMath(raw) && !/\b(sum|avg|count|unique|min|max)\s*\(/i.test(raw)){
    const resolved=resolveResearchAggregateReference(raw,item,rows,warnings,'sum');
    if(resolved.found) return resolved.value;
  }
  const before=(warnings||[]).length;
  const expr=replaceResearchAggregateReferences(raw,item,rows,warnings);
  if((warnings||[]).slice(before).some(w=>String(w).startsWith('Unknown expression reference:'))) return '';
  try{
    const fn=compileCachedExpression(item.source,expr,getResearchHeaders(item.source),raw=>Function('Math','return ('+raw+');'),{source:item.source,context:'Research aggregate expression'});
    const out=evaluateCompiledExpression(fn,[Math],{source:item.source,context:'Research aggregate expression'});
    if(typeof out==='number' && !Number.isFinite(out)){ researchExpressionDivisionWarning(raw,warnings); return item.zeroDenominator==='blank'?null:0; }
    if(Number.isNaN(out)){ researchExpressionAddWarning(warnings,'Expression returned NaN.'); return ''; }
    return out;
  }catch(e){ researchExpressionAddWarning(warnings,'Expression error: '+e.message); return ''; }
}
function evaluateResearchExpressionInContext(expression,rows,item,warnings=[]){
  return evaluateResearchAggregateExpression(item,rows,expression,{warnings});
}
function openResearchGearPopup(key){
  const item=effectiveResearchItem(currentResearchItemFromEditor()), cfg=researchGearGet(key), field=researchGearFieldForKey(item,key,+(key.split(':')[1]||0)); if(!field){ alert('Choose a column or expression before filtering this field.'); return; }
  const metricRef=findMetricByRef(field); if(metricRef){ openResearchMetricGearPopup({item,key,source:item.source,field,metric:metricRef,cfg}); return; }
  const modelRef=parseModelRef(field); if(modelRef){ openResearchModelGearPopup(key,field,modelRef,cfg); return; }
  if(key.startsWith('columnField:') && ((item.columns||[])[Number(key.split(':')[1])]?.mode)==='expression' && !resolveResearchExpressionField(field,item)){
    alert('Gear selection works on a single field. Expressions can be calculated directly.');
    return;
  }
  const rows=applyResearchFilters(researchSourceRowsForItem(item),item.filters||[],item), vals=researchGearUniqueValues(rows,field,item.source), selected=Array.isArray(cfg.selected)?new Set(cfg.selected):new Set(vals), bad=researchGearNumericInvalid(cfg,item,field,rows);
  const wrap=document.createElement('div'); wrap.className='researchGearModal'; wrap.innerHTML=`<div class="researchGearBox"><h3>Filter values for ${esc(field)}</h3><input data-gg="search" placeholder="Search values"><div class="researchGearFilters"><label><input data-gg="valuesEnabled" type="checkbox" ${cfg.valuesEnabled!==false?'checked':''}> Values</label><label>Value Level <select data-gg="valueLevel"><option value="level1">Level 1</option><option value="level2">Level 2</option></select></label><label><input data-gg="customValueEnabled" type="checkbox" ${cfg.customValueEnabled?'checked':''}> Custom value</label><label><input data-gg="customTextEnabled" type="checkbox" ${cfg.customTextEnabled?'checked':''}> Custom text</label></div><div><button class="smallBtn" data-gg-btn="all" type="button">Select All</button> <button class="smallBtn" data-gg-btn="none" type="button">Unselect All</button></div><div class="researchGearValues" data-gg-list>${vals.map(v=>`<label class="researchGearValue" data-v="${esc(v.toLowerCase())}"><input type="checkbox" data-gg-val="${esc(v)}" ${selected.has(v)?'checked':''}> <span>${esc(v)}</span></label>`).join('')||'<div class="hint">No values found.</div>'}</div><div class="researchGearCustom ${bad?'invalid':''}" data-gg-custom-value><strong>Custom value</strong><div class="researchStepGrid"><select data-gg="customValueMetric"><option value="count">Count of items</option><option value="sum">Sum of items</option><option value="each">Each individual item</option></select><select data-gg="customValueOp"><option value="greater/equal">Greater than or equal to</option><option value="greater than">Greater than</option><option value="less than">Less than</option><option value="less/equal">Less than or equal to</option><option value="between">Between</option></select><input data-gg="customValue1" type="number" step="any" placeholder="Value"><input data-gg="customValue2" type="number" step="any" placeholder="High value"></div><div class="researchGearWarn">${esc(bad)}</div></div><div class="researchGearCustom"><strong>Custom text</strong><div class="researchStepGrid"><select data-gg="customTextOp"><option>Contains</option><option>Is</option><option>Does not contain</option></select><input data-gg="customText" placeholder='"hello" "void" or free text'></div></div><div class="modalFoot"><button class="dark" data-gg-btn="cancel">Cancel</button><button class="green" data-gg-btn="apply">Save / Apply</button></div></div>`;
  document.body.appendChild(wrap); ['valueLevel','customValueMetric','customValueOp','customValue1','customValue2','customText'].forEach(k=>{ const x=wrap.querySelector(`[data-gg="${k}"]`); if(x) x.value=cfg[k]||''; }); wrap.querySelector('[data-gg="customTextOp"]').value=(cfg.customTextOp||'contains').replace(/^./,m=>m.toUpperCase());
  wrap.querySelector('[data-gg="search"]').oninput=e=>wrap.querySelectorAll('[data-v]').forEach(l=>l.classList.toggle('hidden',!l.dataset.v.includes(e.target.value.toLowerCase())));
  wrap.querySelector('[data-gg-btn="all"]').onclick=()=>wrap.querySelectorAll('[data-gg-val]').forEach(x=>x.checked=true); wrap.querySelector('[data-gg-btn="none"]').onclick=()=>wrap.querySelectorAll('[data-gg-val]').forEach(x=>x.checked=false); wrap.querySelector('[data-gg-btn="cancel"]').onclick=()=>wrap.remove();
  wrap.querySelector('[data-gg-btn="apply"]').onclick=()=>{ const next=researchGearDefault(); wrap.querySelectorAll('[data-gg]').forEach(x=>{ if(x.type==='checkbox') next[x.dataset.gg]=x.checked; else next[x.dataset.gg]=x.value; }); next.customTextOp=String(next.customTextOp||'contains').toLowerCase(); next.selected=[...wrap.querySelectorAll('[data-gg-val]:checked')].map(x=>x.dataset.ggVal); const err=researchGearNumericInvalid(next,item,field,rows); if(err){ const area=wrap.querySelector('[data-gg-custom-value]'); area.classList.add('invalid'); area.querySelector('.researchGearWarn').textContent=err; return; } state.editingResearchGear[key]=next; wrap.remove(); };
}


function openResearchMetricGearPopup(args,legacyField,legacyMetric,legacyCfg){
  if(typeof args!=='object' || Array.isArray(args)) args={key:args,field:legacyField,metric:legacyMetric,cfg:legacyCfg};
  const researchItem=args.item||currentResearchItemFromEditor?.()||{}, key=args.key||'', field=args.field||'', metric=args.metric||findMetricByRef(field), cfg={...researchGearDefault(),...(args.cfg||{})}, source=args.source||researchItem.source;
  const wrap=document.createElement('div'); wrap.className='researchGearModal';
  wrap.innerHTML=`<div class="researchGearBox"><h3>Metric bucket options for ${esc(metric?.name||field)}</h3><div class="hint">Use metrics as cohorts. Level 1 makes captured/not captured groups; Level 2 preserves exact count or numeric buckets and restricts downstream calculations to only entities in that bucket.</div><div class="researchStepGrid"><div class="field"><label>Metric level</label><select data-mg="metricLevel"><option value="level1">Level 1: Captured / Not Captured</option><option value="level2">Level 2: Exact Count Buckets</option></select></div><div class="field"><label>Metric entity mode</label><select data-mg="metricEntityMode"><option value="representative">By Representative</option><option value="coach">By Coach / Team</option></select></div><div class="field"><label>Condition result</label><select data-mg="conditionResult"><option value="true">True / Matches criteria</option><option value="false">False / Does not match criteria</option></select></div><div class="field" data-coach-method><label>Coach/team counting method</label><select data-mg="metricCoachMethod"><option value="direct">Direct coach/team column</option><option value="roster">Team roster / rep membership</option></select></div><div class="field" data-decimal-bucket><label>Decimal bucket option</label><select data-mg="metricDecimalBucket"><option value="exact">Exact decimal</option><option value="rounded">Rounded whole number</option><option value="size">Custom bucket size</option></select></div><div class="field" data-bucket-size><label>Custom bucket size</label><input data-mg="metricBucketSize" type="number" min="0" step="any" placeholder="5"></div></div><div class="researchGearFilters"><button class="smallBtn" data-mg-buckets="all" type="button">Select all buckets</button> <button class="smallBtn" data-mg-buckets="none" type="button">Clear all buckets</button><input data-mg-bucket-search placeholder="Search buckets"></div><div class="researchGearValues" data-mg-bucket-list></div><div class="researchGearWarn" data-mg-warning></div><div class="modalFoot"><button class="dark" data-mg-cancel>Cancel</button><button class="green" data-mg-apply>Save / Apply</button></div></div>`;
  document.body.appendChild(wrap); ['metricLevel','metricEntityMode','metricCoachMethod','metricDecimalBucket','metricBucketSize','conditionResult'].forEach(k=>{ const x=wrap.querySelector(`[data-mg="${k}"]`); if(x) x.value=cfg[k]||researchGearDefault()[k]||''; });
  let selectedBuckets=Array.isArray(cfg.selectedBuckets)?new Set(cfg.selectedBuckets.map(String)):null;
  const liveCfg=()=>{ const live={...cfg}; wrap.querySelectorAll('[data-mg]').forEach(x=>live[x.dataset.mg]=x.value); live.valueLevel=live.metricLevel; return live; };
  const freshItem=()=>currentResearchItemFromEditor?.()||researchItem||{};
  const renderBuckets=()=>{
    const live=liveCfg(), box=wrap.querySelector('[data-mg-bucket-list]'), warn=wrap.querySelector('[data-mg-warning]');
    const currently=[...wrap.querySelectorAll('[data-mg-bucket]')]; if(currently.length) selectedBuckets=new Set(currently.filter(x=>x.checked).map(x=>String(x.dataset.mgBucket)));
    const opts=buildMetricBucketOptions(metric||field,{item:freshItem(),source,warnings:[]},live), q=(wrap.querySelector('[data-mg-bucket-search]')?.value||'').toLowerCase();
    if(!selectedBuckets) selectedBuckets=selectedMetricBucketSet({...cfg,...live},opts.buckets);
    const available=new Set((opts.buckets||[]).map(b=>String(b.key))), dropped=[...selectedBuckets].filter(v=>!available.has(v)); dropped.forEach(v=>selectedBuckets.delete(v));
    const list=(opts.buckets||[]).filter(b=>String(b.label).toLowerCase().includes(q));
    box.innerHTML=list.map(b=>`<label class="researchGearValue"><input type="checkbox" data-mg-bucket="${esc(b.key)}" ${selectedBuckets.has(String(b.key))?'checked':''}> <span>${esc(b.label)} <span class="hint">${b.countEntities ?? b.entityCount} ${Number(b.countEntities ?? b.entityCount)===1?'entity':'entities'}</span></span></label>`).join('')||`<div class="hint">${esc(opts.reason||'No Level 2 buckets found. The metric evaluated 0 entities.')}</div>`;
    warn.textContent=[...(opts.warnings||[]),...(dropped.length?[`Some saved bucket selections no longer exist and were cleared: ${dropped.join(', ')}`]:[])].filter(Boolean).join(' ');
  };
  const safeRenderBuckets=()=>{ try{ renderBuckets(); }catch(err){ const box=wrap.querySelector('[data-mg-bucket-list]'); if(box) box.innerHTML=`<div class="researchWarn">${esc(err.message||err)}</div>`; console.error('[Research Metric Gear] bucket render failed',err); } };
  const refresh=()=>{ const isCoach=wrap.querySelector('[data-mg="metricEntityMode"]').value==='coach'; wrap.querySelector('[data-coach-method]').classList.toggle('hidden',!isCoach); const isExpr=metric?.mode!=='count'; wrap.querySelector('[data-decimal-bucket]').classList.toggle('hidden',!isExpr); wrap.querySelector('[data-bucket-size]').classList.toggle('hidden',!isExpr||wrap.querySelector('[data-mg="metricDecimalBucket"]').value!=='size'); safeRenderBuckets(); };
  wrap.querySelectorAll('[data-mg]').forEach(x=>x.onchange=refresh); wrap.querySelector('[data-mg-bucket-search]').oninput=safeRenderBuckets; wrap.querySelector('[data-mg-buckets="all"]').onclick=()=>{ wrap.querySelectorAll('[data-mg-bucket]').forEach(x=>x.checked=true); selectedBuckets=new Set([...wrap.querySelectorAll('[data-mg-bucket]')].map(x=>String(x.dataset.mgBucket))); }; wrap.querySelector('[data-mg-buckets="none"]').onclick=()=>{ wrap.querySelectorAll('[data-mg-bucket]').forEach(x=>x.checked=false); selectedBuckets=new Set(); }; refresh(); wrap.querySelector('[data-mg-cancel]').onclick=()=>wrap.remove();
  wrap.querySelector('[data-mg-apply]').onclick=()=>{ const next={...researchGearDefault(),...cfg}; wrap.querySelectorAll('[data-mg]').forEach(x=>next[x.dataset.mg]=x.value); next.valueLevel=next.metricLevel; next.selectedBuckets=[...wrap.querySelectorAll('[data-mg-bucket]:checked')].map(x=>x.dataset.mgBucket); if(args.axisItemId) next.axisItemId=args.axisItemId; if(args.axisItemExpression) next.axisItemExpression=args.axisItemExpression; state.editingResearchGear[key]=next; if(typeof args.onApply==='function') args.onApply(next); wrap.remove(); };
}

function openResearchModelGearPopup(key,field,ref,cfg){
  const model=findModelByNameOrId(ref.model), criteria=model?(model.criteria||[]):[], selected=new Set((cfg.modelCriteria&&cfg.modelCriteria.length?cfg.modelCriteria:(ref.criteria?[ref.criteria]:[])).map(String));
  const wrap=document.createElement('div'); wrap.className='researchGearModal';
  wrap.innerHTML=`<div class="researchGearBox"><h3>Model criteria for ${esc(ref.model)}</h3>${model?'':`<div class="researchWarn">Missing model: ${esc(ref.model)}</div>`}<div class="hint">Field syntax: <code>model("Model Name")</code> or <code>model("Model Name","Criteria Name")</code>. Level 1 evaluates the whole model; Level 2 evaluates selected criteria like field values.</div><div class="researchGearFilters"><label>Level <select data-mg="valueLevel"><option value="level1">Level 1: Whole model</option><option value="level2">Level 2: Specific criteria</option></select></label></div><div class="researchGearValues">${criteria.map(c=>`<label class="researchGearValue"><input type="checkbox" data-mg-crit="${esc(c.name||c.id)}" ${selected.has(String(c.name||c.id))||selected.has(String(c.id))?'checked':''}> <span><strong>${esc(c.name||c.id)}</strong><br><span class="hint">${esc(c.source||'source')} ${esc(c.mode||c.scoreType||'')}</span></span></label>`).join('')||'<div class="hint">No criteria found.</div>'}</div><div class="modalFoot"><button class="dark" data-mg-cancel>Cancel</button><button class="green" data-mg-apply>Save / Apply</button></div></div>`;
  document.body.appendChild(wrap); wrap.querySelector('[data-mg="valueLevel"]').value=cfg.valueLevel||'level1';
  wrap.querySelector('[data-mg-cancel]').onclick=()=>wrap.remove();
  wrap.querySelector('[data-mg-apply]').onclick=()=>{ const next={...researchGearDefault(),...cfg}; next.valueLevel=wrap.querySelector('[data-mg="valueLevel"]').value; next.modelName=ref.model; next.modelCriteria=[...wrap.querySelectorAll('[data-mg-crit]:checked')].map(x=>x.dataset.mgCrit); state.editingResearchGear[key]=next; wrap.remove(); };
}
function refreshTeamFilterDatalist(prefix=''){ let dl=el('researchTeamFilterSuggestions'); if(!dl){ dl=document.createElement('datalist'); dl.id='researchTeamFilterSuggestions'; document.body.appendChild(dl); } dl.innerHTML=teamFilterSuggestions(prefix).map(v=>`<option value="${esc(v)}"></option>`).join(''); }

function multiPhraseBuilderHtml(f,i){
  const phrases=filterPhrases(f);
  f.values=phrases; f.value=phrases.join(', '); f.valueLogic=normalizedTextOperator(f.op)==='does not contain'?'none':'any';
  return `<div class="field multiPhraseField"><label>Phrases (${f.valueLogic==='none'?'NONE of these':'ANY of these'})</label><div class="researchPhraseBuilder" data-phrase-builder="${i}"><div class="researchInputGear"><input data-phrase-input="${i}" placeholder="Add word or phrase" value=""><button class="smallBtn" type="button" data-phrase-add="${i}">Add</button></div><div class="hint">Paste comma- or semicolon-separated phrases; quoted phrases stay together.</div><div class="teamFilterChips">${phrases.map((p,pi)=>`<span class="teamFilterChip">${esc(p)} <button type="button" title="Edit" data-phrase-edit="${i}|${pi}">✎</button> <button type="button" data-phrase-remove="${i}|${pi}">×</button></span>`).join('')}</div>${phrases.length?`<button class="smallBtn" type="button" data-phrase-clear="${i}">Clear all</button>`:''}</div></div>`;
}
function syncMultiPhraseFilter(f){ const phrases=filterPhrases(f); f.values=phrases; f.value=phrases.join(', '); f.valueLogic=normalizedTextOperator(f.op)==='does not contain'?'none':'any'; }
function attachMultiPhraseBuilders(root=document){
  const add=(i,raw)=>{ const f=state.editingResearchFilters?.[i]; if(!f) return; const existing=filterPhrases(f), seen=new Set(existing.map(normalizeResearchText)); parseMultiPhraseValueInput(raw).forEach(p=>{ const k=normalizeResearchText(p); if(k&&!seen.has(k)){ seen.add(k); existing.push(p); } }); f.values=existing; f.value=existing.join(', '); f.valueLogic=normalizedTextOperator(f.op)==='does not contain'?'none':'any'; renderResearchFiltersEditor(); };
  root.querySelectorAll('[data-phrase-add]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.phraseAdd, inp=root.querySelector(`[data-phrase-input="${i}"]`); add(i,inp?.value||''); });
  root.querySelectorAll('[data-phrase-input]').forEach(inp=>inp.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); add(+inp.dataset.phraseInput,inp.value); } });
  root.querySelectorAll('[data-phrase-remove]').forEach(b=>b.onclick=()=>{ const [i,pi]=b.dataset.phraseRemove.split('|').map(Number), f=state.editingResearchFilters?.[i]; if(!f) return; const phrases=filterPhrases(f); phrases.splice(pi,1); f.values=phrases; f.value=phrases.join(', '); renderResearchFiltersEditor(); });
  root.querySelectorAll('[data-phrase-edit]').forEach(b=>b.onclick=()=>{ const [i,pi]=b.dataset.phraseEdit.split('|').map(Number), f=state.editingResearchFilters?.[i]; if(!f) return; const phrases=filterPhrases(f), next=prompt('Edit phrase',phrases[pi]||''); if(next==null) return; phrases.splice(pi,1,...parseMultiPhraseValueInput(next)); f.values=[...new Map(phrases.map(p=>[normalizeResearchText(p),p])).values()]; f.value=f.values.join(', '); renderResearchFiltersEditor(); });
  root.querySelectorAll('[data-phrase-clear]').forEach(b=>b.onclick=()=>{ const f=state.editingResearchFilters?.[+b.dataset.phraseClear]; if(!f) return; f.values=[]; f.value=''; renderResearchFiltersEditor(); });
}

function renderResearchFiltersEditor(){
  els.researchFilters.innerHTML=(state.editingResearchFilters||[]).map((f,i)=>{
    const isTeam=f.type==='team_is'||f.fieldType==='team_is', adv=!!f.expression&&!isTeam, dateAware=!isTeam&&(f.include==='includeWithin'||f.include==='excludeWithin');
    const condition=`<div class="field"><label>Condition result</label><select data-rf="conditionResult" data-i="${i}"><option value="true" ${f.conditionResult!=='false'?'selected':''}>True / Matches criteria</option><option value="false" ${f.conditionResult==='false'?'selected':''}>False / Does not match criteria</option></select></div>`;
    const action=`<div class="field"><label>Action</label><select data-rf="include" data-i="${i}"><option value="include" ${f.include==='include'||!f.include?'selected':''}>Only include</option><option value="exclude" ${f.include==='exclude'?'selected':''}>Exclude</option><option value="includeWithin" ${f.include==='includeWithin'?'selected':''}>Only include if within</option><option value="excludeWithin" ${f.include==='excludeWithin'?'selected':''}>Only exclude if within</option></select></div>${condition}`;
    if(isTeam) return `<div class="researchFilterRow teamIs"><div class="field"><label>Filter type</label><select data-rf="type" data-i="${i}"><option value="team_is" selected>Team is</option><option value="">Normal filter</option></select></div><div class="field"><label>Team is</label><input data-rf="teamInput" data-i="${i}" list="researchTeamFilterSuggestions" value="${esc(f.teamInput||f.rawTeamInput||f.value||'')}" placeholder="Type team/coach names or $orgs..."><div class="teamFilterChips">${teamFilterChipsHtml(f,i)}</div>${teamFilterWarningHtml(f)}</div>${condition}<button class="smallBtn red" data-rf-remove="${i}" type="button">Remove</button></div>`;
    if(adv && !dateAware) return `<div class="researchFilterRow advanced">${action}<div class="field"><label>Advanced expression filter</label><input data-rf="expression" data-i="${i}" value="${esc(f.expression||'')}" placeholder="row['Notes'].includes('save')">${expressionDiagnosticHtml(f.expression,els.researchSource?.value||'','display')}</div><button class="smallBtn" data-rf-basic="${i}" type="button">Use Simple Filter</button><button class="smallBtn red" data-rf-remove="${i}" type="button">Remove</button></div>`;
    const op=f.op||'contains';
    const normal=`${action}<div class="field"><label>Filter type</label><select data-rf="type" data-i="${i}"><option value="" selected>Normal filter</option><option value="team_is">Team is</option></select></div><div class="field"><label>Column or expression</label><div class="researchInputGear"><input data-rf="field" data-i="${i}" list="researchHeaderSuggestions" value="${esc(f.field||'')}">${researchGearButton('filterField:'+i)}</div></div><div class="field"><label>Operator</label><select data-rf="op" data-i="${i}">${(findMetricByRef(f.field)?['equals','not equals','greater than','greater than or equal to','less than','less than or equal to','captured','not captured']:['is','is not','contains','does not contain','greater than','greater/equal','less than','less/equal','between','within days of']).map(o=>`<option ${op===o?'selected':''}>${o}</option>`).join('')}</select></div>${isMultiPhraseTextOperator(op)?multiPhraseBuilderHtml(f,i):`<div class="field"><label>${op==='between'?'Low value':'Value'}</label><input data-rf="value" data-i="${i}" value="${esc(f.value||'')}"></div>`}${op==='between'?`<div class="field"><label>High value</label><input data-rf="value2" data-i="${i}" value="${esc(f.value2||'')}"></div>`:''}${op==='within days of'?`<div class="field"><label>Right date column/expression</label><input data-rf="withinRightField" data-i="${i}" list="researchHeaderSuggestions" value="${esc(f.withinRightField||'')}"></div><div class="field"><label>Day window</label><input data-rf="dayWindow" data-i="${i}" value="${esc(f.dayWindow||'5')}" placeholder="5, -5, +5, A5"></div>`:''}`;
  const dateExtra=dateAware?`<div class="field"><label>Target source</label><select data-rf="targetSource" data-i="${i}">${['qa',DATED_SOURCE,'checklist','documented_coaching','comp_calls'].map(src=>`<option value="${src}" ${(f.targetSource||'qa')===src?'selected':''}>${esc(labelSource(src))}</option>`).join('')}</select></div><div class="field"><label>Target date column</label><select data-rf="targetDateColumn" data-i="${i}">${targetDateColumnOptions(f.targetSource||'qa',f.targetDateColumn||'')}</select></div><div class="field"><label>Target value column</label><select data-rf="targetValueColumn" data-i="${i}">${headerOptions(f.targetSource||'qa',f.targetValueColumn||'',true)}</select></div><div class="field"><label>Target match mode</label><select data-rf="targetOp" data-i="${i}">${['contains','is','does not contain'].map(o=>`<option ${ (f.targetOp||'contains')===o?'selected':''}>${o}</option>`).join('')}</select></div><div class="field"><label>Target phrase/value</label><input data-rf="targetValue" data-i="${i}" value="${esc(f.targetValue||'')}"></div><div class="field"><label>Date window mode</label><select data-rf="windowMode" data-i="${i}"><option value="days" ${(f.windowMode||'days')==='days'?'selected':''}>Within X days</option><option value="range" ${f.windowMode==='range'?'selected':''}>Within range</option></select></div>${f.windowMode==='range'?`<div class="field"><label>Range start</label><input type="date" data-rf="rangeStart" data-i="${i}" value="${esc(f.rangeStart||'')}"></div><div class="field"><label>Range end</label><input type="date" data-rf="rangeEnd" data-i="${i}" value="${esc(f.rangeEnd||'')}"></div>`:`<div class="field"><label>Day window</label><input data-rf="dayWindow" data-i="${i}" value="${esc(f.dayWindow??'0')}" placeholder="0, 1, -1, A15"></div>`}`:'';
    if(dateAware) return `<div class="researchFilterRow dateAware">${action}${dateExtra}<button class="smallBtn red" data-rf-remove="${i}" type="button">Remove</button></div>`;
    return `<div class="researchFilterRow">${normal}<button class="smallBtn" data-rf-advanced="${i}" type="button">Advanced expression</button><button class="smallBtn red" data-rf-remove="${i}" type="button">Remove</button></div>`;
  }).join('');
  els.researchFilters.querySelectorAll('[data-rf]').forEach(x=>x.onchange=x.oninput=()=>{ state.editingResearchFilters[x.dataset.i][x.dataset.rf]=x.type==='checkbox'?x.checked:x.value; if(x.dataset.rf==='type'&&x.value==='team_is') state.editingResearchFilters[x.dataset.i].conditionResult=state.editingResearchFilters[x.dataset.i].conditionResult||'true'; if(['include','op','field','targetSource','windowMode','type'].includes(x.dataset.rf)) renderResearchFiltersEditor(); }); attachResearchFilterValueSuggestions(); attachMultiPhraseBuilders(els.researchFilters); refreshTeamFilterDatalist(); els.researchFilters.querySelectorAll('[data-rf="teamInput"]').forEach(inp=>inp.oninput=()=>{ state.editingResearchFilters[inp.dataset.i].teamInput=inp.value; refreshTeamFilterDatalist(inp.value); }); els.researchFilters.querySelectorAll('[data-team-chip-remove]').forEach(b=>b.onclick=()=>{ const f=state.editingResearchFilters[+b.dataset.teamChipRemove]; f.teamInput=splitTeamFilterTokens(f.teamInput||'').filter(t=>t!==b.dataset.token).join(', '); renderResearchFiltersEditor(); });
  els.researchFilters.querySelectorAll('[data-rf-advanced]').forEach(b=>b.onclick=()=>{ const f=state.editingResearchFilters[+b.dataset.rfAdvanced]; f.expression=f.expression||''; renderResearchFiltersEditor(); });
  els.researchFilters.querySelectorAll('[data-rf-basic]').forEach(b=>b.onclick=()=>{ delete state.editingResearchFilters[+b.dataset.rfBasic].expression; renderResearchFiltersEditor(); });
  els.researchFilters.querySelectorAll('[data-rf-remove]').forEach(b=>b.onclick=()=>{state.editingResearchFilters.splice(+b.dataset.rfRemove,1);renderResearchFiltersEditor();}); attachResearchGearButtons(els.researchFilters); attachModelReferencePicker(els.researchFilters); updateGuidedResearchUi();
}
function renderResearchColumnsEditor(){
  const isConv=els.researchOutputType?.value==='conversation';
  const modes=['display','direct','measure','count','count_by','unique','percent_total','percent_parent','percent_item','date_within','date_percent_within','value_within','value_percent_within','sum','avg','min','max','percent','model','expression'];
  const label=o=>o==='display'?'Display':o==='direct'?'Display first value':o==='measure'?'Typed measure':o==='count'?'Count':o==='count_by'?'Count By':o==='unique'?'Unique Individual':o==='percent_total'?'% of total':o==='percent_parent'?'% of parent':o==='percent_item'?'Weighted Rate / % of item':o==='percent'?'Percent Builder':o==='date_within'?'Dates within':o==='date_percent_within'?'Dates within %':o==='value_within'?'Values within':o==='value_percent_within'?'Values within %':o==='expression'?'Expression':o;
  els.researchColumns.innerHTML=(state.editingResearchColumns||[]).map((c,i)=>{
    const within=['date_within','date_percent_within','value_within','value_percent_within'].includes(c.mode), dateWithin=['date_within','date_percent_within'].includes(c.mode), percentItem=c.mode==='percent_item', percentBuilderMode=c.mode==='percent', expr=c.mode==='expression'&&!isConv;
    const fieldControl=expr
      ? `<div class="field researchExpressionBox"><label>Custom Expression</label><textarea data-rc="field" data-i="${i}" data-research-expression-input="1" autocomplete="off" placeholder="[Cash Apps] / [Cash Opps]\nCash Apps / Cash Opps\nsum([Cash Apps]) / sum([Cash Opps])\nmodel(&quot;Cash Model&quot;,&quot;Cash Apps&quot;) / model(&quot;Cash Model&quot;,&quot;Cash Opps&quot;)">${esc(c.field||'')}</textarea><div class="hint">Use full formulas with columns, metrics, model() references, functions, math, and parentheses.</div>${expressionDiagnosticHtml(c.field,els.researchSource?.value||'',c.mode==='expression'?'numeric':'display')}</div>`
      : `<div class="field"><label>${within?(dateWithin?'Date field/expression':'Value field/expression'):(isConv?'Display column':'Field/Expression')}</label><div class="researchInputGear"><input data-rc="field" data-i="${i}" list="researchHeaderSuggestions" value="${esc(c.field||'')}">${researchGearButton('columnField:'+i)}</div></div>`;
    const autoTitle=researchColumnLabel({valueMode:els.researchValueMode?.value||'count'},c);
    const customTitle=String(c.customTitle||c.displayTitle||'');
    return `<div class="researchColumnRow ${expr?'expressionMode':''}"><div class="field"><label>${isConv?'Header label':'Display/export title'}</label><div class="hint">Auto title: ${esc(autoTitle)} <button class="smallBtn researchColumnSettingsBtn" data-rc-title-edit="${i}" type="button" title="Edit custom display/export title">✎</button></div><div class="researchColumnLabelTools"><input data-rc="customTitle" data-i="${i}" value="${esc(customTitle)}" placeholder="${esc(autoTitle)}"><input data-rc="label" data-i="${i}" value="${esc(c.label||c.field||'Value')}" title="Underlying formula label/reference">${isConv?'':`<button class="smallBtn researchColumnSettingsBtn" data-rc-settings="${i}" type="button" title="Column display and formatting rules">＋</button>`}</div>${isConv?'':`<div class="researchColumnRulesSummary">${esc(researchColumnRulesSummary(c)||'No display/highlight rules')}</div>`}</div>${isConv?'':`<div class="field"><label>Mode</label><select data-rc="mode" data-i="${i}">${modes.map(o=>`<option value="${o}" ${c.mode===o?'selected':''}>${label(o)}</option>`).join('')}</select></div>`}${fieldControl}${c.mode==='measure'?`<div class="field"><label>Missing values</label><select data-rc="missingBehavior" data-i="${i}"><option value="missing" ${c.missingBehavior!=='zero'&&c.missingBehavior!=='warn'?'selected':''}>Treat as missing</option><option value="zero" ${c.missingBehavior==='zero'?'selected':''}>Treat as zero</option><option value="warn" ${c.missingBehavior==='warn'?'selected':''}>Exclude and warn</option></select></div>`:''}${percentBuilderMode?`<div class="field" style="grid-column:1/-1"><label>Percent Builder column</label><button class="smallBtn" data-rc-copy-pb="${i}" type="button">Use current Percent Builder settings for this column</button><span class="hint">Column mode uses the same cohort Percent Builder calculation path. Configure the Percent Builder panel shown below, then copy it here if this table has multiple percent columns.</span></div>`:''}${percentItem?`<div class="field"><label>Percent of / denominator item</label><input data-rc="percentOfField" data-i="${i}" list="researchHeaderSuggestions" value="${esc(c.percentOfField||'')}" placeholder="Column, @Metric, model(), or expression"></div>`:''}${within?`<div class="field"><label>Comparison Field</label><input data-rc="withinCompareField" data-i="${i}" list="researchHeaderSuggestions" value="${esc(c.withinCompareField||'')}"></div><div class="field ${c.withinUseRange?'hidden':''}"><label>${dateWithin?'Days within':'Value within'}</label><input data-rc="withinDays" data-i="${i}" type="number" step="any" value="${esc(c.withinDays||'')}" placeholder="3"></div><label class="checkItem"><input data-rc="withinUseRange" data-i="${i}" type="checkbox" ${c.withinUseRange?'checked':''}> Use range</label><div class="field ${c.withinUseRange?'':'hidden'}"><label>Range low ${dateWithin?'days':''}</label><input data-rc="withinRangeMin" data-i="${i}" type="number" step="any" value="${esc(c.withinRangeMin||'')}" placeholder="3"></div><div class="field ${c.withinUseRange?'':'hidden'}"><label>Range high ${dateWithin?'days':''}</label><input data-rc="withinRangeMax" data-i="${i}" type="number" step="any" value="${esc(c.withinRangeMax||'')}" placeholder="5"></div>`:''}<div class="field"><label>Condition result</label><select data-rc="conditionResult" data-i="${i}"><option value="true" ${c.conditionResult!=='false'?'selected':''}>True / Matches criteria</option><option value="false" ${c.conditionResult==='false'?'selected':''}>False / Does not match criteria</option></select></div><label class="field"><span>Show as %</span><input data-rc="showAsPercent" data-i="${i}" type="checkbox" ${c.showAsPercent?'checked':''}></label><div class="field"><label>Keep result ≥ (optional)</label><input data-rc="resultMin" data-i="${i}" type="number" step="any" value="${esc(c.resultMin??'')}"></div><div class="field"><label>Keep result ≤ (optional)</label><input data-rc="resultMax" data-i="${i}" type="number" step="any" value="${esc(c.resultMax??'')}"></div><button class="smallBtn red" data-rc-remove="${i}" type="button">Remove</button></div>`;
  }).join('');
  els.researchColumns.querySelectorAll('[data-rc]').forEach(x=>x.onchange=x.oninput=()=>{ state.editingResearchColumns[x.dataset.i][x.dataset.rc]=x.type==='checkbox'?x.checked:x.value; if(x.dataset.rc==='customTitle') state.editingResearchColumns[x.dataset.i].displayTitle=x.value; if(x.dataset.rc==='mode'||x.dataset.rc==='withinUseRange') updateResearchBuilderVisibility(); });
  els.researchColumns.querySelectorAll('[data-rc-title-edit]').forEach(b=>b.onclick=()=>{ const inp=els.researchColumns.querySelector(`[data-rc="customTitle"][data-i="${b.dataset.rcTitleEdit}"]`); if(inp){ inp.focus(); inp.select(); } });
  els.researchColumns.querySelectorAll('[data-rc-copy-pb]').forEach(b=>b.onclick=()=>{ state.editingResearchColumns[+b.dataset.rcCopyPb].percentBuilder=clonePlain(readPercentBuilderEditor()); updateResearchBuilderVisibility(); });
  els.researchColumns.querySelectorAll('[data-rc-remove]').forEach(b=>b.onclick=()=>{state.editingResearchColumns.splice(+b.dataset.rcRemove,1);updateResearchBuilderVisibility();});
  els.researchColumns.querySelectorAll('[data-rc-settings]').forEach(b=>b.onclick=()=>openResearchColumnSettings(+b.dataset.rcSettings));
  els.researchColumns.querySelectorAll('[data-research-expression-input]').forEach(input=>{ const show=()=>showHeaderSuggestions(input,{source:els.researchSource.value,customSource:els.researchSource.value}); input.onfocus=show; input.onkeyup=show; input.oninput=()=>{ state.editingResearchColumns[input.dataset.i].field=input.value; show(); }; });
  attachResearchGearButtons(els.researchColumns); attachModelReferencePicker(els.researchColumns);
}

function renderResearchGroupAxisItemsEditor(){
  if(!els.researchGroupMultiAddBuilder) return;
  const on=!!els.researchGroupMultiAdd?.checked; els.researchGroupMultiAddBuilder.classList.toggle('hidden',!on);
  const list=state.editingResearchGroupAxisItems||(state.editingResearchGroupAxisItems=[]);
  if(!on) return;
  els.researchGroupMultiAddList.innerHTML=list.map((it,i)=>`<div class="researchColumnRow"><div class="field"><label>Item / expression</label><input data-gai="expression" data-i="${i}" list="researchHeaderSuggestions" value="${esc(it.expression||'')}"></div><div class="field"><label>Optional label</label><input data-gai="label" data-i="${i}" value="${esc(it.label||'')}"></div><button class="smallBtn" data-gai-gear="${i}" type="button">⚙</button><button class="smallBtn" data-gai-dup="${i}" type="button">Duplicate</button><button class="smallBtn red" data-gai-remove="${i}" type="button">Remove</button></div>`).join('')||'<div class="hint">No group axis items yet. Add @Metric or a source-qualified condition.</div>';
  els.researchGroupMultiAddList.querySelectorAll('[data-gai]').forEach(x=>x.oninput=x.onchange=()=>{ list[+x.dataset.i][x.dataset.gai]=x.value; });
  els.researchGroupMultiAddList.querySelectorAll('[data-gai-remove]').forEach(b=>b.onclick=()=>{ list.splice(+b.dataset.gaiRemove,1); renderResearchGroupAxisItemsEditor(); });
  els.researchGroupMultiAddList.querySelectorAll('[data-gai-dup]').forEach(b=>b.onclick=()=>{ list.splice(+b.dataset.gaiDup+1,0,{...clonePlain(list[+b.dataset.gaiDup]),id:id()}); renderResearchGroupAxisItemsEditor(); });
  els.researchGroupMultiAddList.querySelectorAll('[data-gai-gear]').forEach(b=>b.onclick=()=>openResearchGroupAxisItemGear(+b.dataset.gaiGear));
}
function openResearchGroupAxisItemGear(i){
  const list=state.editingResearchGroupAxisItems||(state.editingResearchGroupAxisItems=[]), it=list[i]; if(!it) return; const field=it.expression||''; const metric=findMetricByRef(field);
  if(metric){ const key='groupAxisItem:'+it.id; state.editingResearchGear[key]={...researchGearDefault(),...it}; openResearchMetricGearPopup({item:currentResearchItemFromEditor(),key,source:currentResearchItemFromEditor().source,field,metric,cfg:state.editingResearchGear[key],axisItemId:it.id,axisItemExpression:field,onApply:next=>{ state.editingResearchGear[key]=next; Object.assign(it,next); }}); const t=setInterval(()=>{ if(!document.querySelector('.researchGearModal')){ Object.assign(it,state.editingResearchGear[key]||{}); clearInterval(t); renderResearchGroupAxisItemsEditor(); } },250); return; }
  const key='groupAxisItem:'+it.id; state.editingResearchGear[key]={...researchGearDefault(),...it}; openResearchGearPopup(key); const t=setInterval(()=>{ if(!document.querySelector('.researchGearModal')){ Object.assign(it,state.editingResearchGear[key]||{}); clearInterval(t); renderResearchGroupAxisItemsEditor(); } },250); return;
  const wrap=document.createElement('div'); wrap.className='researchGearModal'; wrap.innerHTML=`<div class="researchGearBox"><h3>Group item settings</h3><div class="researchStepGrid"><div class="field"><label>Custom label/header</label><input data-gs="label" value="${esc(it.label||'')}"></div><div class="field"><label>Condition result</label><select data-gs="conditionResult"><option value="true">True / Matches criteria</option><option value="false">False / Does not match criteria</option></select></div><div class="field"><label>Entity mode</label><select data-gs="entityMode"><option value="representative">Representative</option><option value="coach">Coach-Team</option></select></div></div><div class="modalFoot"><button class="dark" data-gs-cancel>Cancel</button><button class="green" data-gs-apply>Save / Apply</button></div></div>`; document.body.appendChild(wrap); wrap.querySelector('[data-gs="conditionResult"]').value=it.conditionResult||'true'; wrap.querySelector('[data-gs="entityMode"]').value=it.entityMode||'representative'; wrap.querySelector('[data-gs-cancel]').onclick=()=>wrap.remove(); wrap.querySelector('[data-gs-apply]').onclick=()=>{ wrap.querySelectorAll('[data-gs]').forEach(x=>it[x.dataset.gs]=x.value); wrap.remove(); renderResearchGroupAxisItemsEditor(); };
}

const PERCENT_BUILDER_CUSTOM='__custom_expression__';
function percentBuilderDefault(){
  return {unit:'unique_reps',fromMode:'source',qualifierSource:'documented_coaching',expression:'',operator:'contains',value:'',value2:'',matchBehavior:'at_least_one',minMatches:'',maxMatches:'',rules:[{field:'',operator:'contains',value:'',value2:''}],denominator:'displayed_group',denominatorSource:'',denominatorRules:[],zeroDenominator:'zero'};
}
function normalizePercentBuilder(pb={},item={}){
  const out={...percentBuilderDefault(),...(pb&&typeof pb==='object'?pb:{})};
  if(pb?.source && !out.qualifierSource) out.qualifierSource=pb.source;
  if(pb?.field && (!out.rules||!out.rules[0]?.field)) out.rules=[{field:pb.field,operator:pb.operator||'contains',value:pb.value||'',value2:pb.value2||''}];
  if(pb?.from==='custom_expression'||pb?.fromMode==='custom_expression'||out.qualifierSource===PERCENT_BUILDER_CUSTOM) out.fromMode='custom_expression';
  const units=['unique_reps','unique_teams','unique_coaches','rows','documented_coaching','checklist','numeric_total']; if(!units.includes(out.unit)) out.unit='unique_reps';
  const dens=['displayed_group','coach_full_team','all_reps','all_source_rows','all_documented_coaching','all_checklist','custom']; if(!dens.includes(out.denominator)){ if(out.denominator==='teamReps') out.denominator='coach_full_team'; else if(out.denominator==='unique') out.denominator='displayed_group'; else out.denominator='displayed_group'; }
  const src=out.qualifierSource||item.source||'documented_coaching'; out.qualifierSource=allSourceKeys().includes(src)?src:(item.source||firstImportedResearchSource());
  out.rules=Array.isArray(out.rules)&&out.rules.length?out.rules:[{field:out.field||'',operator:out.operator||'contains',value:out.value||'',value2:out.value2||''}];
  out.rules=out.rules.map(r=>({field:r.field||'',operator:r.operator||out.operator||'contains',value:r.value??out.value??'',value2:r.value2??out.value2??''}));
  out.operator=out.operator||out.rules[0]?.operator||'contains'; out.value=out.value??out.rules[0]?.value??''; out.value2=out.value2??out.rules[0]?.value2??'';
  out.zeroDenominator=out.zeroDenominator||item.zeroDenominator||'zero';
  return out;
}
function percentBuilderFromLegacyItem(item={}){
  if(item.percentBuilder) return normalizePercentBuilder(item.percentBuilder,item);
  return normalizePercentBuilder({unit:item.numeratorCount==='unique'?'unique_reps':'rows',fromMode:item.numeratorExpression?'custom_expression':'source',qualifierSource:item.source||'documented_coaching',expression:item.numeratorExpression||'',denominator:item.denominator==='teamReps'?'coach_full_team':(item.denominator==='custom'?'custom':'displayed_group'),zeroDenominator:item.zeroDenominator||'zero'},item);
}
function percentBuilderSourceOptions(item={},selected=''){
  const opts=[{value:item.source||'',label:'Current selected source'},...concreteResearchSources(),{value:PERCENT_BUILDER_CUSTOM,label:'Custom expression'}], seen=new Set();
  return opts.filter(o=>o.value&&!seen.has(o.value)&&(seen.add(o.value),true)).map(o=>`<option value="${esc(o.value)}" ${selected===o.value?'selected':''}>${esc(o.label+(o.label==='Current selected source'?` (${labelSource(o.value)})`:''))}</option>`).join('');
}
function percentBuilderOperatorOptions(mode,selected){
  const ops=mode==='custom_expression'?[
    ['equals','equals'],['greater_than','greater than'],['greater_equal','greater than or equal'],['less_than','less than'],['less_equal','less than or equal'],['between','between'],['is_blank','is blank'],['is_not_blank','is not blank']
  ]:[
    ['contains','contains'],['not_contains','does not contain'],['equals','equals'],['not_equals','does not equal'],['starts_with','starts with'],['ends_with','ends with'],['is_blank','is blank'],['is_not_blank','is not blank'],['greater_than','greater than'],['greater_equal','greater than or equal'],['less_than','less than'],['less_equal','less than or equal'],['between','between'],['on','on'],['before','before'],['after','after']
  ];
  return ops.map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''}>${esc(l)}</option>`).join('');
}
function renderPercentBuilderEditor(item={}){
  if(!els.researchPercentBuilder) return;
  const pb=normalizePercentBuilder(state.editingPercentBuilder||percentBuilderFromLegacyItem(item),item), custom=pb.fromMode==='custom_expression', rule=pb.rules[0]||{};
  const sourceSelect=custom?PERCENT_BUILDER_CUSTOM:pb.qualifierSource;
  els.researchPercentBuilder.innerHTML=`<div class="researchRuleSection"><strong>Percent Builder</strong><div class="hint">Show the % of a cohort that matches a rule, out of a selected denominator, grouped by the Research group / X axis.</div><div class="researchStepGrid">
    <div class="field"><label>Show the % of</label><select data-pb="unit"><option value="unique_reps">Unique representatives</option><option value="unique_teams">Teams</option><option value="unique_coaches">Coaches</option><option value="rows">Rows/items</option><option value="documented_coaching">Documented coaching items</option><option value="checklist">Checklist items</option><option value="numeric_total">Numeric total</option></select></div>
    <div class="field"><label>that</label><select data-pb="matchBehavior"><option value="at_least_one">At least one related row matches</option><option value="none">No related rows match</option><option value="count_at_least">Matching row count is at least X</option><option value="count_exactly">Matching row count is exactly X</option><option value="count_between">Matching row count is between X and Y</option><option value="item_matches">Item matches rule</option></select></div>
    <div class="field ${['count_at_least','count_exactly','count_between'].includes(pb.matchBehavior)?'':'hidden'}"><label>X</label><input data-pb="minMatches" type="number" step="1" value="${esc(pb.minMatches||'')}"></div>
    <div class="field ${pb.matchBehavior==='count_between'?'':'hidden'}"><label>Y</label><input data-pb="maxMatches" type="number" step="1" value="${esc(pb.maxMatches||'')}"></div>
    <div class="field"><label>from</label><select data-pb-source>${percentBuilderSourceOptions(item,sourceSelect)}</select></div>
    ${custom?`<div class="field" style="grid-column:1/-1"><label>where custom numeric expression</label><textarea data-pb="expression" rows="3" list="researchHeaderSuggestions" placeholder="sum(![Non-Date Database].[cash apps]) / sum(![Non-Date Database].[cash opps])">${esc(pb.expression||'')}</textarea>${expressionDiagnosticHtml(pb.expression,item.source||'', 'display')}</div>`:`<div class="field"><label>where field</label><input data-pb-rule="field" list="researchHeaderSuggestions" value="${esc(rule.field||'')}" placeholder="documented.coaching.description"></div>`}
    <div class="field"><label>operator</label><select data-pb-op>${percentBuilderOperatorOptions(custom?'custom_expression':'source',pb.operator||rule.operator)}</select></div>
    <div class="field ${['is_blank','is_not_blank'].includes(pb.operator)?'hidden':''}"><label>Value</label><input data-pb="value" value="${esc(pb.value??rule.value??'')}" placeholder="${custom?'0':'save the sale, sts, saving the sale'}"></div>
    <div class="field ${pb.operator==='between'?'':'hidden'}"><label>Value 2</label><input data-pb="value2" value="${esc(pb.value2??rule.value2??'')}"></div>
    <div class="field"><label>out of</label><select data-pb="denominator"><option value="displayed_group">Each displayed group</option><option value="coach_full_team">Each coach's full team</option><option value="all_reps">All representatives</option><option value="all_source_rows">All rows/items in selected source</option><option value="all_documented_coaching">All documented coaching items</option><option value="all_checklist">All checklist items</option><option value="custom">Custom denominator filter</option></select></div>
    <div class="field"><label>grouped by</label><input value="${esc(item.groupField||item.groupExpression||'Group / X axis')}" disabled></div>
  </div></div>`;
  els.researchPercentBuilder.querySelector('[data-pb="unit"]').value=pb.unit;
  els.researchPercentBuilder.querySelector('[data-pb="matchBehavior"]').value=pb.unit==='rows'? 'item_matches' : pb.matchBehavior;
  els.researchPercentBuilder.querySelector('[data-pb="denominator"]').value=pb.denominator;
  els.researchPercentBuilder.querySelectorAll('input[data-pb],textarea[data-pb],input[data-pb-rule]').forEach(x=>{
    x.oninput=()=>{ readPercentBuilderEditor(); };
    x.onchange=()=>{ readPercentBuilderEditor(); };
  });
  els.researchPercentBuilder.querySelectorAll('select[data-pb]').forEach(x=>x.onchange=()=>{ readPercentBuilderEditor(); renderPercentBuilderEditor(currentResearchItemFromEditor()); });
  els.researchPercentBuilder.querySelector('[data-pb-source]').onchange=e=>{ readPercentBuilderEditor(); if(e.target.value===PERCENT_BUILDER_CUSTOM){ state.editingPercentBuilder.fromMode='custom_expression'; } else { state.editingPercentBuilder.fromMode='source'; state.editingPercentBuilder.qualifierSource=e.target.value; } populateResearchFieldSelectors(currentResearchItemFromEditor()); renderPercentBuilderEditor(currentResearchItemFromEditor()); };
  els.researchPercentBuilder.querySelector('[data-pb-op]').onchange=e=>{ readPercentBuilderEditor(); state.editingPercentBuilder.operator=e.target.value; state.editingPercentBuilder.rules[0].operator=e.target.value; renderPercentBuilderEditor(currentResearchItemFromEditor()); };
}
function readPercentBuilderEditor(){
  const wrap=els.researchPercentBuilder, pb=normalizePercentBuilder(state.editingPercentBuilder||{},{source:els.researchSource?.value||''}); if(!wrap) return pb;
  wrap.querySelectorAll('[data-pb]').forEach(x=>pb[x.dataset.pb]=x.value);
  const src=wrap.querySelector('[data-pb-source]')?.value; if(src){ pb.fromMode=src===PERCENT_BUILDER_CUSTOM?'custom_expression':'source'; if(src!==PERCENT_BUILDER_CUSTOM) pb.qualifierSource=src; }
  const op=wrap.querySelector('[data-pb-op]')?.value; if(op) pb.operator=op;
  const field=wrap.querySelector('[data-pb-rule="field"]')?.value; pb.rules=[{field:field??pb.rules?.[0]?.field??'',operator:pb.operator,value:pb.value,value2:pb.value2}];
  state.editingPercentBuilder=pb; return pb;
}

function researchTemplateHeader(source,candidates=[]){
  const headers=getResearchHeaders(source)||[];
  const direct=findHeader(headers,candidates.filter(Boolean)); if(direct) return direct;
  const tokens=candidates.map(normalizeResearchText).filter(Boolean);
  return headers.find(h=>tokens.some(t=>normalizeResearchText(h).includes(t)))||'';
}
function applyResearchTemplate(){
  const key=els.researchTemplateSelect?.value||''; if(!key) return;
  const chooseSource=source=>{ els.researchSource.value=source; populateResearchFieldSelectors({source}); };
  const repField=source=>detectIdentityColumn((getRowsRaw(source)||[])[0]||{},source,'rep').column||researchTemplateHeader(source,['Representative','Agent Name','Associate Name','Name']);
  const teamField=source=>detectIdentityColumn((getRowsRaw(source)||[])[0]||{},source,'coach').column||researchTemplateHeader(source,['Coach Assigned','Job Coach','Team','Coach']);
  state.editingResearchFilters=[]; state.editingResearchColumns=[]; state.editingResearchGear={}; state.editingResearchGroupAxisItems=[]; els.researchSort.value='yDesc'; els.researchUseSecondaryGroup.value='no'; els.researchCrossSourceJoin.value='grain';
  if(key==='coaching_by_team'){
    chooseSource('documented_coaching'); els.researchTitleInput.value='Documented Coaching Count by Team'; els.researchOutputType.value='bar'; els.researchAnalysisGrain.value='teams'; els.researchGroupField.value=teamField('documented_coaching'); els.researchValueMode.value='count'; els.researchValueField.value=''; state.editingResearchColumns=[{label:'Documented Coaching',customTitle:'Documented Coaching',mode:'count',field:''}];
  }else if(key==='coaching_share_rep'){
    chooseSource('documented_coaching'); els.researchTitleInput.value='Documented Coaching Share by Representative'; els.researchOutputType.value='bar'; els.researchAnalysisGrain.value='representatives'; els.researchGroupField.value=repField('documented_coaching'); els.researchValueMode.value='percent_total'; els.researchValueField.value=''; els.researchShowPercent.checked=true; state.editingResearchColumns=[{label:'Share of Coaching',customTitle:'Share of Documented Coaching',mode:'percent_total',field:'',showAsPercent:true}];
  }else if(key==='checklist_finals_rep'){
    chooseSource('checklist'); const corrective=researchTemplateHeader('checklist',['Corrective','Corrective Column','Result','Status']); els.researchTitleInput.value='Checklist Finals by Representative'; els.researchOutputType.value='bar'; els.researchAnalysisGrain.value='representatives'; els.researchGroupField.value=repField('checklist'); els.researchValueMode.value='count'; els.researchValueField.value=''; state.editingResearchFilters=[{include:'include',field:corrective,op:'contains',value:'Final',conditionResult:'true'}]; state.editingResearchColumns=[{label:'Finals',customTitle:'Checklist Finals',mode:'count',field:''}];
  }else if(key==='kpi_by_coaching'){
    const stats=(getRowsRaw('retail_sv2')||[]).length?'retail_sv2':'referral_sv2'; chooseSource(stats); const headers=getResearchHeaders(stats), cashApps=headers.find(h=>/cash.*app/i.test(h)&&!/opp/i.test(h))||researchTemplateHeader(stats,['Cash Apps','Cash Appointments']), cashOpps=headers.find(h=>/cash.*opp/i.test(h))||researchTemplateHeader(stats,['Cash Opps','Cash Opportunities']), coachingField=researchTemplateHeader('documented_coaching',['Description','Type','Coaching Type','Created Date'])||getResearchHeaders('documented_coaching')[0]||'Description'; els.researchTitleInput.value='Cash Appointment Rate by Representative and Coaching Count'; els.researchOutputType.value='table'; els.researchAnalysisGrain.value='representatives'; els.researchCrossSourceJoin.value='strict_rep'; els.researchGroupField.value=repField(stats); els.researchValueMode.value='percent_item'; els.researchValueField.value=cashApps; els.researchPercentOfField.value=cashOpps; state.editingResearchColumns=[{label:'Cash Appointment Rate',customTitle:'Cash Appointment Rate',mode:'percent_item',field:cashApps,percentOfField:cashOpps,showAsPercent:true},{label:'Documented Coaching',customTitle:'Documented Coaching Count',mode:'count',field:sourceQualifiedFieldSuggestion('documented_coaching',coachingField)}];
  }
  renderResearchFiltersEditor(); renderResearchColumnsEditor(); updateResearchBuilderVisibility(); els.researchTemplateSelect.value='';
}

function guidedSourceChoices(){
  const seen=new Set();
  return concreteResearchSources().filter(o=>o.value&&!seen.has(o.value)&&(seen.add(o.value),true));
}
function guidedSourceOptions(selected=''){ return guidedSourceChoices().map(o=>`<option value="${esc(o.value)}" ${o.value===selected?'selected':''}>${esc(o.label)}</option>`).join(''); }
function guidedSelectedEvidenceSources(){ return els.guidedEvidenceSources?[...els.guidedEvidenceSources.selectedOptions].map(o=>o.value).filter(Boolean):[]; }
function guidedConditionNeedsValue(op){ return !['is_blank','is_not_blank'].includes(op); }
function guidedConditionIsPhrase(op){ return ['contains','not_contains'].includes(op); }
function guidedConditionIsCount(op){ return ['appears_at_least','appears_no_more'].includes(op); }
function guidedConditionOperatorOptions(selected='contains'){
  const ops=[['equals','Equals'],['not_equals','Does not equal'],['contains','Contains phrase'],['not_contains','Does not contain phrase'],['greater_than','Greater than'],['greater_equal','Greater than or equal to'],['less_than','Less than'],['less_equal','Less than or equal to'],['is_blank','Is blank'],['is_not_blank','Is not blank'],['between','Is between'],['date_between','Date is between'],['appears_at_least','Appears at least X times'],['appears_no_more','Appears no more than X times']];
  return ops.map(([v,l])=>`<option value="${v}" ${v===selected?'selected':''}>${l}</option>`).join('');
}
function renderGuidedResearchConditions(){
  if(!els.guidedResearchConditions) return;
  const list=state.editingGuidedResearchConditions||[];
  els.guidedResearchConditions.innerHTML=list.map((c,i)=>{
    const op=c.operator||'contains', expression=!!c.expression, phrase=guidedConditionIsPhrase(op), count=guidedConditionIsCount(op), blank=!guidedConditionNeedsValue(op), between=['between','date_between'].includes(op);
    return `<div class="guidedConditionRow" data-guided-condition-row="${i}">
      <div class="field"><label>${i?'Connection':'Start'}</label><select data-gc="logic" data-i="${i}" ${i?'':'disabled'}><option value="and" ${c.logic!=='or'?'selected':''}>AND</option><option value="or" ${c.logic==='or'?'selected':''}>OR</option></select></div>
      <div class="field"><label>Data source</label><select data-gc="source" data-i="${i}">${guidedSourceOptions(c.source||els.guidedPrimarySource?.value||els.researchSource?.value||'')}</select></div>
      <label class="checkItem"><input type="checkbox" data-gc="expression" data-i="${i}" ${expression?'checked':''}> Expression</label>
      <div class="field"><label>${expression?'Expression, metric, or saved criterion':'Column or saved criterion'}</label><input data-gc="field" data-i="${i}" list="researchHeaderSuggestions" value="${esc(c.field||'')}" placeholder="${expression?'retail.sv2.cashapps / retail.sv2.cashopps or @Metric':'Column, @Metric, or model criteria'}">${expression?expressionDiagnosticHtml(c.field,c.source||els.guidedPrimarySource?.value||els.researchSource?.value||'','numeric'):''}</div>
      <div class="field"><label>Operator</label><select data-gc="operator" data-i="${i}">${guidedConditionOperatorOptions(op)}</select></div>
      ${blank?'':`<div class="field"><label>${count?'X (record count)':(phrase?'Phrase or phrases':(between?'From':'Value'))}</label><input data-gc="value" data-i="${i}" ${count?'type="number" min="0" step="1"':''} value="${esc(c.value??'')}" placeholder="${phrase?'Insurance Cash; Cash Conversion':(count?'1':'Value')}">${phrase?'<div class="guidedPhraseHint">Use commas or semicolons for multiple phrases. Matching is case-insensitive by default.</div>':''}</div>`}
      ${between?`<div class="field"><label>To</label><input data-gc="value2" data-i="${i}" value="${esc(c.value2??'')}"></div>`:''}
      ${phrase?`<label class="checkItem"><input type="checkbox" data-gc="exactPhrase" data-i="${i}" ${c.exactPhrase?'checked':''}> Exact phrase/value</label><label class="checkItem"><input type="checkbox" data-gc="caseSensitive" data-i="${i}" ${c.caseSensitive?'checked':''}> Case-sensitive</label><label class="checkItem"><input type="checkbox" data-gc="normalizeSpacing" data-i="${i}" ${c.normalizeSpacing!==false?'checked':''}> Trim and normalize spacing</label>`:''}
      <button class="smallBtn red" data-gc-remove="${i}" type="button">Remove</button>
    </div>`;
  }).join('')||'<div class="hint">No conditions yet. Add one to describe what must be true; filters below are kept separate.</div>';
  els.guidedResearchConditions.querySelectorAll('[data-gc]').forEach(x=>{ const event=x.tagName==='SELECT'||x.type==='checkbox'?'change':'input'; x.addEventListener(event,()=>{ const c=list[+x.dataset.i]; if(!c) return; c[x.dataset.gc]=x.type==='checkbox'?x.checked:x.value; if(x.dataset.gc==='operator'||x.dataset.gc==='expression') renderGuidedResearchConditions(); activateGuidedResearch(); }); });
  els.guidedResearchConditions.querySelectorAll('[data-gc-remove]').forEach(b=>b.onclick=()=>{ list.splice(+b.dataset.gcRemove,1); if(list[0]) list[0].logic='and'; renderGuidedResearchConditions(); activateGuidedResearch(); });
}
function guidedIdentityField(source,kind){
  const sample=(getRowsRaw(source)||[])[0]||{};
  if(kind==='representative') return detectIdentityColumn(sample,source,'rep').column||researchTemplateHeader(source,['Representative','Agent Name','Associate Name','Associate','Name'])||'_rep';
  if(kind==='team'||kind==='coach') return detectIdentityColumn(sample,source,'coach').column||researchTemplateHeader(source,kind==='coach'?['Job Coach','Coach','Coach Assigned','Team Lead','Team']:['Team','Team Name','Job Coach','Coach Assigned','Coach'])||'_team';
  if(kind==='organization') return researchTemplateHeader(source,['Organization','Org','Division','Business Unit','Region'])||guidedIdentityField(source,'team');
  return '';
}
function guidedDefaultDateField(source){ return researchDefaultDateColumn({source})||researchTemplateHeader(source,['Date','Assigned Date','Interaction Start Time','Created Date','Week']); }
function guidedBreakdownField(source,breakdown,column=''){
  if(breakdown==='representative') return guidedIdentityField(source,'representative');
  if(breakdown==='team') return guidedIdentityField(source,'team');
  if(breakdown==='coach') return guidedIdentityField(source,'coach');
  if(breakdown==='organization') return guidedIdentityField(source,'organization');
  if(['day','week','month','quarter'].includes(breakdown)) return guidedDefaultDateField(source);
  if(breakdown==='column') return column||'';
  return '';
}
function guidedSubjectField(source,subject){
  if(subject==='representatives') return guidedIdentityField(source,'representative');
  if(subject==='teams') return guidedIdentityField(source,'team');
  if(subject==='coaches') return guidedIdentityField(source,'coach');
  return '';
}
function guidedRecordPercentUnit(recordType,source){ if(recordType==='documented_coaching'||source==='documented_coaching') return 'documented_coaching'; if(recordType==='checklist'||source==='checklist') return 'checklist'; return 'rows'; }
function guidedValidCondition(c){ const op=c?.operator||'contains'; if(!String(c?.field||'').trim()) return false; if(!guidedConditionNeedsValue(op)) return true; if(!String(c?.value??'').trim()) return false; if(['between','date_between'].includes(op)&&!String(c?.value2??'').trim()) return false; return true; }
function guidedConfigFromForm(){
  const evidence=guidedSelectedEvidenceSources(), primary=els.guidedPrimarySource?.value||evidence[0]||els.researchSource?.value||firstImportedResearchSource();
  return {guidedEnabled:true,guidedSubject:els.guidedResearchSubject?.value||'representatives',guidedRecordType:els.guidedRecordType?.value||'documented_coaching',guidedQuestion:els.guidedResearchQuestion?.value||'show',guidedPercentageUnit:els.guidedPercentageUnit?.value||'unique_reps',guidedAggregate:els.guidedAggregate?.value||'avg',guidedRankUnit:els.guidedRankUnit?.value||'records',guidedMeasureField:els.guidedMeasureField?.value||'',guidedEvidenceSources:evidence.length?evidence:[primary],guidedPrimarySource:primary,guidedConditions:clonePlain(state.editingGuidedResearchConditions||[]),guidedBreakdown:els.guidedBreakdown?.value||'none',guidedBreakdownColumn:els.guidedBreakdownColumn?.value||'',guidedDisplay:els.guidedDisplay?.value||'detailed_table',guidedSort:els.guidedSort?.value||'default'};
}
function guidedApplyOutputColumns(cfg){
  const q=cfg.guidedQuestion, title=els.guidedResearchTitle?.value||els.researchTitleInput?.value||'Research Item';
  let mode='count', field='', percentBuilder=normalizePercentBuilder(state.editingPercentBuilder||{}, {source:cfg.guidedPrimarySource});
  if(q==='percentage'){
    mode='percent';
    const unit=cfg.guidedPercentageUnit==='records'?guidedRecordPercentUnit(cfg.guidedRecordType,cfg.guidedPrimarySource):(cfg.guidedPercentageUnit==='teams'?'unique_teams':(cfg.guidedPercentageUnit==='coaches'?'unique_coaches':cfg.guidedPercentageUnit));
    percentBuilder=normalizePercentBuilder({...percentBuilder,unit,qualifierSource:cfg.guidedConditions[0]?.source||cfg.guidedPrimarySource,fromMode:'source',rules:[{field:'',operator:'contains',value:'',value2:''}],operator:'contains',value:'',value2:'',matchBehavior:'at_least_one',denominator:unit==='unique_reps'||unit==='unique_teams'||unit==='unique_coaches'?'displayed_group':'displayed_group'}, {source:cfg.guidedPrimarySource});
    state.editingPercentBuilder=percentBuilder;
  }else if(q==='average_total'){ mode=cfg.guidedAggregate==='sum'?'sum':'avg'; field=cfg.guidedMeasureField; }
  else if(q==='count'&&['representatives','teams','coaches'].includes(cfg.guidedSubject)){ mode='unique'; field=guidedSubjectField(cfg.guidedPrimarySource,cfg.guidedSubject); }
  else if(q==='rank'&&cfg.guidedRankUnit==='unique_reps'){ mode='unique'; field=guidedIdentityField(cfg.guidedPrimarySource,'representative'); }
  else if(q==='rank'&&cfg.guidedRankUnit==='value'){ mode='avg'; field=cfg.guidedMeasureField; }
  else if(q==='show'){ mode='count'; }
  els.researchValueMode.value=mode; els.researchValueField.value=field;
  const label=q==='percentage'?'Percentage':q==='average_total'?(cfg.guidedAggregate==='sum'?'Total':'Average'):q==='rank'?'Rank value':q==='show'?'Matching results':'Count';
  state.editingResearchColumns=[{label,customTitle:label,mode,field,showAsPercent:q==='percentage',percentBuilder:q==='percentage'?clonePlain(percentBuilder):undefined}];
  if(els.researchTableShowPercent) els.researchTableShowPercent.checked=q==='percentage'; if(els.researchShowPercent) els.researchShowPercent.checked=q==='percentage';
  if(els.researchMode) els.researchMode.value=q==='percentage'?'percent':'direct';
  if(els.researchPopulation) els.researchPopulation.value=cfg.guidedSubject==='records'?cfg.guidedRecordType:(cfg.guidedSubject==='representatives'?'representatives':cfg.guidedSubject==='teams'?'teams':'rows');
  if(els.researchNumeratorCount) els.researchNumeratorCount.value=cfg.guidedPercentageUnit==='unique_reps'?'unique':(cfg.guidedPercentageUnit==='records'?guidedRecordPercentUnit(cfg.guidedRecordType,cfg.guidedPrimarySource):'rows');
  if(els.researchDenominator) els.researchDenominator.value=cfg.guidedPercentageUnit==='unique_reps'?'unique':'groupRows';
  return {mode,field,title};
}
function syncGuidedResearchToAdvanced(){
  if(!els.guidedResearchSubject||!els.researchSource) return;
  const cfg=guidedConfigFromForm(), source=cfg.guidedPrimarySource||cfg.guidedEvidenceSources[0]||firstImportedResearchSource();
  if(source&&els.researchSource.value!==source){ els.researchSource.value=source; populateResearchFieldSelectors({source}); }
  els.researchTitleInput.value=(els.guidedResearchTitle?.value||els.researchTitleInput.value||'Research Item').trim()||'Research Item';
  const grain=cfg.guidedSubject==='representatives'?'representatives':(cfg.guidedSubject==='teams'||cfg.guidedSubject==='coaches'?'teams':(cfg.guidedSubject==='records'?'rows':'auto'));
  els.researchAnalysisGrain.value=grain; els.researchCrossSourceJoin.value=grain==='representatives'?'strict_rep':(grain==='teams'?'strict_team':'grain');
  const subjectField=guidedSubjectField(source,cfg.guidedSubject), requestedBreakdown=guidedBreakdownField(source,cfg.guidedBreakdown,cfg.guidedBreakdownColumn), breakdownField=subjectField||requestedBreakdown;
  els.researchGroupField.value=breakdownField;
  els.researchDateGrouping.value=cfg.guidedBreakdown==='week'?'weekly':(cfg.guidedBreakdown==='month'?'monthly':(cfg.guidedBreakdown==='quarter'?'quarterly':'daily'));
  if(['day','week','month','quarter'].includes(cfg.guidedBreakdown)&&!els.researchDateColumn.value) els.researchDateColumn.value=requestedBreakdown;
  const display=cfg.guidedDisplay; els.researchOutputType.value=cfg.guidedQuestion==='show'&&cfg.guidedSubject==='records'&&display==='detailed_table'?'conversation':(['bar','line','heatmap'].includes(display)?display:(display==='table_chart'?'bar':'table'));
  els.researchSort.value=display==='ranked_table'||cfg.guidedQuestion==='rank'?(cfg.guidedSort==='default'?'yDesc':cfg.guidedSort):cfg.guidedSort;
  const secondaryBreakdown=subjectField&&requestedBreakdown&&requestedBreakdown!==subjectField?requestedBreakdown:'';
  if(secondaryBreakdown||display==='heatmap'){ els.researchUseSecondaryGroup.value='yes'; els.researchSecondaryGroupField.value=secondaryBreakdown||els.researchSecondaryGroupField.value||guidedIdentityField(source,cfg.guidedBreakdown==='team'?'coach':'team'); }
  else if(els.researchUseSecondaryGroup) els.researchUseSecondaryGroup.value='no';
  guidedApplyOutputColumns(cfg); renderResearchColumnsEditor(); renderPercentBuilderEditor({...cfg,source,groupField:breakdownField}); updateGuidedResearchUi(); updateResearchBuilderVisibility();
}
function activateGuidedResearch(){ state.editingGuidedResearchActive=true; syncGuidedResearchToAdvanced(); }
function fillGuidedResearchForm(item){
  item=normalizeResearchItem(item||{}); const choices=guidedSourceChoices(), requestedPrimary=item.guidedPrimarySource||item.source||'', primary=choices.some(o=>o.value===requestedPrimary)?requestedPrimary:(choices[0]?.value||''), selected=new Set((item.guidedEvidenceSources||[item.source]).filter(s=>choices.some(o=>o.value===s))); if(primary&&!selected.size) selected.add(primary);
  if(els.guidedEvidenceSources) els.guidedEvidenceSources.innerHTML=choices.map(o=>`<option value="${esc(o.value)}" ${selected.has(o.value)?'selected':''}>${esc(o.label)}</option>`).join('');
  if(els.guidedPrimarySource){ els.guidedPrimarySource.innerHTML=guidedSourceOptions(primary); els.guidedPrimarySource.value=primary; }
  els.guidedResearchSubject.value=item.guidedSubject||'representatives'; els.guidedRecordType.value=item.guidedRecordType||'documented_coaching'; els.guidedResearchQuestion.value=item.guidedQuestion||'show'; els.guidedPercentageUnit.value=item.guidedPercentageUnit||'unique_reps'; els.guidedAggregate.value=item.guidedAggregate||'avg'; els.guidedRankUnit.value=item.guidedRankUnit||'records'; els.guidedMeasureField.value=item.guidedMeasureField||item.valueField||''; els.guidedBreakdown.value=item.guidedBreakdown||'none'; els.guidedBreakdownColumn.value=item.guidedBreakdownColumn||''; els.guidedDisplay.value=item.guidedDisplay||'detailed_table'; els.guidedSort.value=item.guidedSort||item.sort||'default'; els.guidedResearchTitle.value=item.title||'New Research Item';
  state.editingGuidedResearchConditions=clonePlain(item.guidedConditions||[]); renderGuidedResearchConditions(); updateGuidedResearchUi();
}
function guidedConditionDescription(c){
  const op=({equals:'equals',not_equals:'does not equal',contains:'contains phrase',not_contains:'does not contain phrase',greater_than:'is greater than',greater_equal:'is at least',less_than:'is less than',less_equal:'is at most',between:'is between',is_blank:'is blank',is_not_blank:'is not blank',date_between:'is between',appears_at_least:'appears at least',appears_no_more:'appears no more than'})[c.operator]||c.operator;
  const src=labelSource(c.source)||c.source||'selected source', value=guidedConditionNeedsValue(c.operator)?` ${c.value||'(value)'}`:'';
  return `${src}: ${c.expression?'expression ':''}${c.field||'(column)'} ${op}${value}${['between','date_between'].includes(c.operator)?` and ${c.value2||'(value)'}`:''}`;
}
function guidedPopulationDescription(){
  const filters=state.editingResearchFilters||[], scope=normalizeResearchPopulationScope(state.editingResearchPopulationScope), parts=[];
  if(scope.includeOrgs.length) parts.push(`${scope.includeOrgs.length} included organization${scope.includeOrgs.length===1?'':'s'}`);
  if(scope.includeTeams.length) parts.push(`${scope.includeTeams.length} included team${scope.includeTeams.length===1?'':'s'}`);
  if(scope.includeReps.length) parts.push(`${scope.includeReps.length} included representative${scope.includeReps.length===1?'':'s'}`);
  if(scope.excludeOrgs.length) parts.push(`${scope.excludeOrgs.length} excluded organization${scope.excludeOrgs.length===1?'':'s'}`);
  if(scope.excludeTeams.length) parts.push(`${scope.excludeTeams.length} excluded team${scope.excludeTeams.length===1?'':'s'}`);
  if(scope.excludeReps.length) parts.push(`${scope.excludeReps.length} excluded representative${scope.excludeReps.length===1?'':'s'}`);
  if(filters.length) parts.push(`${filters.length} population filter${filters.length===1?'':'s'}`);
  return parts.length?`${parts.join(', ')} applied before calculation`:'all eligible people or records in the selected source and date range';
}
function guidedDenominatorDescription(cfg){
  if(cfg.guidedQuestion!=='percentage') return 'Not applicable';
  if(cfg.guidedPercentageUnit==='unique_reps') return 'All eligible unique representatives in each result group after filters';
  if(cfg.guidedPercentageUnit==='teams') return 'All eligible teams in each result group after filters';
  if(cfg.guidedPercentageUnit==='coaches') return 'All eligible coaches in each result group after filters';
  if(cfg.guidedPercentageUnit==='records') return `All eligible ${labelSource(cfg.guidedPrimarySource)||'source'} records in each result group after filters`;
  return 'The total eligible numeric value in each result group after filters';
}
function guidedNumeratorDescription(cfg){
  if(cfg.guidedQuestion!=='percentage') return 'Not applicable';
  const unit=cfg.guidedPercentageUnit==='unique_reps'?'unique representatives':cfg.guidedPercentageUnit==='records'?'records or events':cfg.guidedPercentageUnit;
  return `${unit} meeting ${cfg.guidedConditions.length?cfg.guidedConditions.length+' qualifying condition(s)':'the selected conditions'}`;
}
function validateGuidedResearch(show=false){
  if(!els.guidedResearchSubject) return {ok:true,errors:[]}; const cfg=guidedConfigFromForm(), errors=[];
  if(!cfg.guidedPrimarySource) errors.push('Choose a primary population source.');
  const invalid=cfg.guidedConditions.filter(c=>!guidedValidCondition(c)); if(invalid.length) errors.push(`${invalid.length} condition${invalid.length===1?' is':'s are'} incomplete.`);
  if(cfg.guidedQuestion==='percentage'&&!cfg.guidedConditions.some(guidedValidCondition)) errors.push('Add at least one complete condition so the percentage numerator is valid.');
  if((cfg.guidedQuestion==='average_total'||(cfg.guidedQuestion==='rank'&&cfg.guidedRankUnit==='value'))&&!String(cfg.guidedMeasureField||'').trim()) errors.push('Choose the numeric field to calculate.');
  if(cfg.guidedBreakdown==='column'&&!String(cfg.guidedBreakdownColumn||'').trim()) errors.push('Choose the source column used to break down results.');
  const ok=!errors.length; if(show&&!ok) alert(errors.join('\n')); return {ok,errors,cfg};
}
function updateGuidedResearchUi(){
  if(!els.guidedResearchSubject) return; const cfg=guidedConfigFromForm(), isPct=cfg.guidedQuestion==='percentage', isAgg=cfg.guidedQuestion==='average_total', isRank=cfg.guidedQuestion==='rank';
  els.guidedRecordTypeField.classList.toggle('hidden',cfg.guidedSubject!=='records'); els.guidedPercentageUnitField.classList.toggle('hidden',!isPct); els.guidedAggregateField.classList.toggle('hidden',!isAgg); els.guidedMeasureFieldWrap.classList.toggle('hidden',!(isAgg||(isRank&&cfg.guidedRankUnit==='value'))); els.guidedRankUnitField.classList.toggle('hidden',!isRank); els.guidedBreakdownColumnWrap.classList.toggle('hidden',cfg.guidedBreakdown!=='column');
  const subjectLabel={representatives:'unique representatives',teams:'teams',coaches:'coaches',records:`${labelSource(cfg.guidedPrimarySource)||'source'} records`,compare:'the selected groups'}[cfg.guidedSubject]||cfg.guidedSubject;
  const action={show:'Show',count:'Count',percentage:'Show the percentage of',average_total:cfg.guidedAggregate==='sum'?'Show the total for':'Show the average for',rank:'Rank',compare:'Compare'}[cfg.guidedQuestion];
  const cond=cfg.guidedConditions.length?cfg.guidedConditions.map((c,i)=>`${i?` ${String(c.logic||'and').toUpperCase()} `:''}${guidedConditionDescription(c)}`).join(''):'the conditions you add';
  const evidence=cfg.guidedEvidenceSources.map(s=>labelSource(s)||s).join(', ')||labelSource(cfg.guidedPrimarySource)||'the selected source';
  const breakdown=cfg.guidedBreakdown==='none'?'overall':`for each ${cfg.guidedBreakdown==='column'?(cfg.guidedBreakdownColumn||'selected column'):cfg.guidedBreakdown}`;
  const pctUnit=isPct?({unique_reps:'unique representatives',teams:'teams',coaches:'coaches',records:'records or events',numeric_total:'numeric value'}[cfg.guidedPercentageUnit]||cfg.guidedPercentageUnit):subjectLabel;
  els.guidedQuestionText.innerHTML=`<button type="button" data-guided-jump="subject">${esc(action+' '+pctUnit)}</button> using <button type="button" data-guided-jump="evidence">${esc(evidence)}</button> where <button type="button" data-guided-jump="conditions">${esc(cond)}</button>, <button type="button" data-guided-jump="filters">limited to ${esc(guidedPopulationDescription())}</button>, shown <button type="button" data-guided-jump="display">${esc(breakdown)}</button>.`;
  els.guidedQuestionText.querySelectorAll('[data-guided-jump]').forEach(b=>b.onclick=()=>document.querySelector(`[data-guided-step="${b.dataset.guidedJump}"]`)?.scrollIntoView({behavior:'smooth',block:'start'}));
  if(els.guidedEvidenceRelationship) els.guidedEvidenceRelationship.textContent=`Evaluate ${subjectLabel} using evidence from ${evidence}.`;
  const validation=validateGuidedResearch(false), items=[['One result represents',subjectLabel],['Population examined',guidedPopulationDescription()],['Filters',(state.editingResearchFilters||[]).length?`${state.editingResearchFilters.length} population filter(s)`:'None'],['Evidence source',evidence],['Conditions',cfg.guidedConditions.length?cfg.guidedConditions.map(guidedConditionDescription).join(' • '):'None'],['Numerator',guidedNumeratorDescription(cfg)],['Denominator',guidedDenominatorDescription(cfg)],['Breakdown',breakdown],['Sort order',cfg.guidedSort],['Expected output',cfg.guidedDisplay.replaceAll('_',' ')]];
  els.guidedCalculationGrid.innerHTML=items.filter(([k])=>isPct||!['Numerator','Denominator'].includes(k)).map(([k,v])=>`<div class="guidedCalculationItem"><strong>${esc(k)}</strong><span>${esc(v)}</span></div>`).join('');
  const guidedActive=state.editingGuidedResearchActive!==false;
  els.guidedCalculationStatus.className=!guidedActive?'hint':(validation.ok?'hint':'guidedValidation'); els.guidedCalculationStatus.textContent=!guidedActive?'This existing item is using its saved advanced calculation. Change any guided step to adopt the guided workflow without altering it automatically.':(validation.ok?(isPct?'Numerator and denominator are valid. Preview a sample or run the full calculation.':'Ready to preview matching data.'):`Complete before running: ${validation.errors.join(' ')}`);
  if(els.saveResearchItemBtn) els.saveResearchItemBtn.disabled=guidedActive&&!validation.ok; if(els.previewResearchFoundBtn) els.previewResearchFoundBtn.disabled=guidedActive&&!validation.ok;
}
function applyGuidedResearchTemplate(key){
  state.editingGuidedResearchActive=true;
  const available=s=>guidedSourceChoices().some(o=>o.value===s), stats=available('retail_sv2')?'retail_sv2':(available('referral_sv2')?'referral_sv2':guidedSourceChoices()[0]?.value||'');
  const set=(id,value)=>{ if(els[id]) els[id].value=value; };
  state.editingGuidedResearchConditions=[];
  if(key==='find_people'){ set('guidedResearchSubject','representatives'); set('guidedResearchQuestion','show'); set('guidedPrimarySource',stats); set('guidedBreakdown','representative'); set('guidedDisplay','detailed_table'); set('guidedSort','xAsc'); }
  if(key==='compare_groups'){ set('guidedResearchSubject','teams'); set('guidedResearchQuestion','percentage'); set('guidedPercentageUnit','unique_reps'); set('guidedPrimarySource',stats); set('guidedBreakdown','team'); set('guidedDisplay','table_chart'); set('guidedSort','yDesc'); }
  if(key==='rank_activity'){ set('guidedResearchSubject','coaches'); set('guidedResearchQuestion','rank'); set('guidedRankUnit','unique_reps'); set('guidedPrimarySource',available('documented_coaching')?'documented_coaching':stats); set('guidedBreakdown','coach'); set('guidedDisplay','bar'); set('guidedSort','yDesc'); }
  if(key==='analyze_records'){ set('guidedResearchSubject','records'); set('guidedRecordType','documented_coaching'); set('guidedResearchQuestion','percentage'); set('guidedPercentageUnit','records'); set('guidedPrimarySource',available('documented_coaching')?'documented_coaching':stats); set('guidedBreakdown','coach'); set('guidedDisplay','table_chart'); set('guidedSort','yDesc'); state.editingGuidedResearchConditions=[{id:id(),logic:'and',source:'documented_coaching',field:researchTemplateHeader('documented_coaching',['Description','Topic','Type-Multi','Coaching Type'])||'',operator:'contains',value:'',value2:'',normalizeSpacing:true}]; }
  const primary=els.guidedPrimarySource.value; if(els.guidedEvidenceSources){ [...els.guidedEvidenceSources.options].forEach(o=>o.selected=o.value===primary); }
  renderGuidedResearchConditions(); syncGuidedResearchToAdvanced(); document.querySelectorAll('[data-guided-template]').forEach(b=>b.classList.toggle('active',b.dataset.guidedTemplate===key));
}

function currentResearchItemFromEditor(){ const valueField=els.researchValueField.value; return normalizeResearchItem({id:els.researchEditId.value||id(),title:els.researchTitleInput.value||'Research Item',outputType:els.researchOutputType.value,mode:els.researchMode.value,filterDuplicateReps:!!els.researchFilterDuplicateReps?.checked,source:els.researchSource.value,analysisGrain:els.researchAnalysisGrain?.value||'auto',crossSourceJoinMode:els.researchCrossSourceJoin?.value||'grain',populationScope:normalizeResearchPopulationScope(state.editingResearchPopulationScope),unmatchedBehavior:els.researchUnmatchedBehavior?.value||'exclude',calculationGroupLimit:+els.researchCalculationGroupLimit?.value||0,reconcile:!!els.researchReconcile?.checked,missingBehavior:els.researchMissingBehavior?.value||'missing',bucketSize:els.researchBucketSize?.value||'',dateColumn:els.researchDateColumn.value,startDate:els.researchStartDate.value,endDate:els.researchEndDate.value,groupField:els.researchGroupField.value,groupMultiAdd:!!els.researchGroupMultiAdd?.checked,groupAxisItems:state.editingResearchGroupAxisItems||[],groupExpression:els.researchGroupExpression.value,useSecondaryGroup:els.researchUseSecondaryGroup?.value==='yes',secondaryGroupField:els.researchSecondaryGroupField?.value||'',panelField:els.researchPanelField?.value||'',valueMode:els.researchValueMode.value,valueField,measureId:researchMeasureIdFromRef(valueField),percentOfField:els.researchPercentOfField?.value||'',withinCompareField:els.researchWithinCompareField?.value||'',withinUseRange:!!els.researchWithinUseRange?.checked,withinDays:els.researchWithinDays?.value||'',withinRangeMin:els.researchWithinRangeMin?.value||'',withinRangeMax:els.researchWithinRangeMax?.value||'',dateGrouping:els.researchDateGrouping.value,modelId:els.researchModelSelect.value,criteriaId:els.researchCriteriaSelect.value,modelResult:els.researchModelResult.value,population:els.researchPopulation.value,numeratorExpression:els.researchNumeratorExpression.value,numeratorCount:els.researchNumeratorCount.value,denominator:els.researchDenominator.value,denominatorExpression:els.researchDenominatorExpression.value,zeroDenominator:els.researchZeroDenominator.value,percentBuilder:readPercentBuilderEditor(),sort:els.researchSort.value,axisMin:els.researchAxisMin.value,axisMax:els.researchAxisMax.value,decimals:+((els.researchOutputType.value==='table'?els.researchTableDecimals?.value:els.researchDecimals?.value)||0)||0,showValues:els.researchShowValues.checked,showDateLabels:!!els.researchShowDateLabels?.checked,showPercent:els.researchOutputType.value==='table'?!!els.researchTableShowPercent?.checked:els.researchShowPercent.checked,graphSort:els.researchGraphSort?.value||'inherit',topN:+(els.researchTopN?.value||0)||0,showSummaryLine:!!els.researchShowSummaryLine?.checked,goalValue:els.researchGoalValue?.value??'',rotateLabels:!!els.researchRotateLabels?.checked,wrapLabels:els.researchWrapLabels?els.researchWrapLabels.checked:true,showLegend:!!els.researchShowLegend?.checked,showGridlines:els.researchShowGridlines?els.researchShowGridlines.checked:true,smoothLine:!!els.researchSmoothLine?.checked,useDots:els.researchUseDots?els.researchUseDots.checked:true,barOrientation:els.researchBarOrientation?.value||'vertical',stackedBars:!!els.researchStackedBars?.checked,groupedBars:els.researchGroupedBars?els.researchGroupedBars.checked:true,hideZeroGroups:!!els.researchHideZeroGroups?.checked,highlightBest:!!els.researchHighlightBest?.checked,highlightWorst:!!els.researchHighlightWorst?.checked,rowLimit:+els.researchRowLimit.value||0,totals:els.researchTotals.checked,textWrap:els.researchTextWrap?els.researchTextWrap.checked:true,rowDensity:els.researchRowDensity?.value||'comfortable',cardSize:(state.researchItems.find(x=>x.id===(els.researchEditId.value||''))?.cardSize)||'medium',collapsed:!!(state.researchItems.find(x=>x.id===(els.researchEditId.value||''))?.collapsed),filters:state.editingResearchFilters||[],columns:state.editingResearchColumns||[],gearFilters:state.editingResearchGear||{},...(state.editingGuidedResearchActive?guidedConfigFromForm():{guidedEnabled:false})}); }
async function saveResearchItemFromEditor(){
  try{
    if(state.editingGuidedResearchActive) syncGuidedResearchToAdvanced();
    const guidedValidation=state.editingGuidedResearchActive?validateGuidedResearch(false):{ok:true,errors:[]};
    if(!guidedValidation.ok){ alert(guidedValidation.errors.join('\n')); return; }
    if(!validateResearchEditor()){
      const msg=els.researchValueFieldError?.textContent || 'Research item could not be saved. Check the highlighted field.';
      alert(msg);
      return;
    }
    const item=currentResearchItemFromEditor();
    if(item.analysisGrain==='auto') item.analysisGrain=researchAnalysisGrain(item,researchApplyPopulationScope(getRowsRaw(resolveDynamicResearchSource(item)).slice(0,250),effectiveResearchItem(item)));
    const i=state.researchItems.findIndex(x=>x.id===item.id);
    if(i>=0) state.researchItems[i]=item; else state.researchItems.push(item);
    saveResearchItems();
    if(els.topStatus) els.topStatus.textContent=`Saved Research item: ${item.title||'Research Item'}`;
    closeModal('researchEditorModal');
    if(els.researchModal?.classList.contains('open')){ await renderResearchCanvasAsync({reason:'save'}); await refreshResearchItem(item.id); }
  }catch(err){
    console.error(err);
    alert('Research item save failed. Check the console for details.');
  }
}
function updateResearchBuilderVisibility(){ const type=els.researchOutputType?.value||'table', graphTypes=['line','bar','scatter','histogram','heatmap','box','pie'], isGraph=graphTypes.includes(type); document.querySelectorAll('#researchEditorModal [data-show]').forEach(el=>{ const v=(el.dataset.show||'').split(/\s+/); const show=v.includes('all')||v.includes(type)||(v.includes('graph')&&isGraph)||(v.includes('table')&&type==='table')||(v.includes('conversation')&&type==='conversation'); el.classList.toggle('hidden', !show); }); const mode=els.researchValueMode?.value||'count', within=['date_within','date_percent_within','value_within','value_percent_within'].includes(mode), withinGraph=within&&isGraph, useRange=!!els.researchWithinUseRange?.checked; const valueWrap=els.researchValueField?.closest('.field'); if(valueWrap) valueWrap.classList.toggle('hidden', !isGraph || (type!=='scatter'&&['count','percent_total','percent_parent','percent','model'].includes(mode))); document.querySelectorAll('[data-secondary-group-field]').forEach(el=>el.classList.toggle('hidden', els.researchUseSecondaryGroup?.value!=='yes' && type!=='heatmap')); document.querySelectorAll('[data-percent-item-mode]').forEach(el=>el.classList.toggle('hidden', mode!=='percent_item')); document.querySelectorAll('[data-within-mode]').forEach(el=>el.classList.toggle('hidden', !withinGraph)); document.querySelectorAll('[data-within-days]').forEach(el=>el.classList.toggle('hidden', !withinGraph || useRange)); document.querySelectorAll('[data-within-range]').forEach(el=>el.classList.toggle('hidden', !withinGraph || !useRange)); const showPercentBuilder=(isGraph&&mode==='percent')||(type==='table'&&(state.editingResearchColumns||[]).some(c=>c.mode==='percent')); document.querySelectorAll('[data-percent-builder-panel]').forEach(el=>el.classList.toggle('hidden', !showPercentBuilder)); if(showPercentBuilder) renderPercentBuilderEditor(currentResearchItemFromEditor()); validateResearchEditor(); renderResearchColumnsEditor(); attachResearchGearButtons(els.researchEditorModal); attachModelReferencePicker(els.researchEditorModal); }
function normalizeOrgExpression(raw){ return String(raw||'').replace(/\borg\s*\(\s*(['"])([^'"]+)\1\s*\)/gi,'inOrg(row["Team"]||row["Job Coach"]||row["Coach"]||row._team,$1$2$1)').replace(/\b(Coach|Team)\s+in\s+\$([A-Za-z0-9 _.-]+)/gi,(m,f,n)=>`inOrg(row[${JSON.stringify(f)}]||row._team,${JSON.stringify(n.trim())})`); }
function evaluateResearchExpression(row, expression, ctx={}){ if(!expression) return ''; expression=normalizeOrgExpression(expression); const source=ctx.source||''; const rk=expressionRowKey(row,source,expression,ctx.context||'research row expression'); if(rk.m.has(rk.k)){ expressionRunStats().cacheHits++; return rk.m.get(rk.k); } const fn=compileCachedExpression(source,expression,getHeaders(source),raw=>Function('row','toNumber','inOrg','return ('+raw+');'),ctx); const out=evaluateCompiledExpression(fn,[row,toNum,inOrg],ctx); rk.m.set(rk.k,out); return out; }
function normalizeResearchText(v){ return String(v??'').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").trim().replace(/^['"]|['"]$/g,'').replace(/\s+/g,' ').toLowerCase(); }
function researchFieldValue(row, field, source){
  if(!field) return '';
  const typed=researchTypedMeasureDefinition(researchMeasureIdFromRef(field)); if(typed) return evaluateResearchTypedMeasure(typed,[row],{source,missingBehavior:'missing',zeroDenominator:'zero'},{},{warnings:[]});
  const metric=findMetricByRef(field); if(metric){ const metricSource=metric.source||source; const metricRows=metricSource===source?[row]:crossRowsForRow(metricSource,row,{}); return evaluateMetric(metric,metricRows,metricSource,[]); }
  const raw=String(field).trim();
  const mref=parseModelRef(raw); if(mref) return evaluateModelReferenceValue(mref,[row],{source},'direct',[]);
  const bang=parseResearchSourceFieldRef(raw);
  if(bang){
    if(bang.missingSource || bang.missingField) return '';
    if(bang.source===source){ const actual=bang.field; return Object.prototype.hasOwnProperty.call(row,actual)?row[actual]:''; }
    const rows=crossRowsForRow(bang.source,row,{});
    return rows.length?researchFieldValue(rows[0],bang.field,bang.source):'';
  }
  const actual=resolveColumn(source,raw);
  if(actual && Object.prototype.hasOwnProperty.call(row,actual)) return row[actual];
  if(Object.prototype.hasOwnProperty.call(row,raw)) return row[raw];
  try{ return evaluateRowExpression(raw,row,source,{}); }catch(_){ try{ return evaluateResearchExpression(row,raw); }catch(__){ return ''; } }
}
function evaluateResearchNumericField(row, field, source){ const ref=parseResearchSourceFieldRef(field); if(ref && !ref.missingSource && !ref.missingField && ref.source!==source){ const n=sumRowsColumn(ref.source,ref.field,crossRowsForRow(ref.source,row,{})); return Number.isFinite(n)?n:NaN; } const v=researchFieldValue(row,field,source); const n=toNum(v); return Number.isFinite(n)?n:NaN; }
function researchNumericValidation(item, field, rows){
  item=effectiveResearchItem(item||{});
  const typed=researchTypedMeasureDefinition(item.measureId||researchMeasureIdFromRef(field)); if(typed){ const resolved=resolveResearchTypedMeasure(typed,item.source); return resolved?.compatible?{ok:true}:{ok:false,message:`${typed.label} requires ${resolved?.missing?.join(' and ')||'mapped numeric fields'} in ${labelSource(resolved?.source)||'the selected source'}.`}; }
  if(!field) return {ok:false,message:'Value column/expression is required for this numeric value mode.'};
  const sample=(rows||researchSourceRowsForItem(item)).slice(0,150).filter(Boolean);
  let filled=0, numeric=0;
  sample.forEach(r=>{ const v=researchFieldValue(r,field,item.source); if(String(v??'').trim()!==''){ filled++; if(Number.isFinite(toNum(v))) numeric++; } });
  if(!filled || numeric/Math.max(1,filled)<.35) return {ok:false,message:'This expression is returning text, but this value mode requires numbers.'};
  return {ok:true};
}
function researchFieldLooksDate(item,field,rows){ item=effectiveResearchItem(item||{}); if(!field) return false; const sample=(rows||researchSourceRowsForItem(item)).slice(0,150); let filled=0, dates=0; sample.forEach(r=>{ const v=researchFieldValue(r,field,item.source); if(String(v??'').trim()){ filled++; if(parseDateOnly(v)) dates++; } }); return !!filled && dates/Math.max(1,filled)>=.35; }
function validateResearchChartCompatibility(item){
  const type=item.outputType, graph=['line','bar','scatter','histogram','heatmap','box','pie'].includes(type); if(!graph) return {ok:true};
  const typed=researchTypedMeasureDefinition(item.measureId||researchMeasureIdFromRef(item.valueField)), resolved=resolveResearchTypedMeasure(typed,item.source);
  if(typed&&resolved&&!typed.chartTypes.includes(type)) return {ok:false,message:`${typed.label} is not compatible with ${type} charts.`};
  if(item.panelField&&!['bar','line','scatter'].includes(type)) return {ok:false,message:'Panel / small multiples are supported for bar, line, and scatter charts.'};
  if(type==='line'&&!item.groupField&&!['daily','weekly','monthly','quarterly'].includes(item.dateGrouping)) return {ok:false,message:'Line charts require a date/time or ordered X variable.'};
  if(type==='pie'&&typed&&!['count','sum','unique_rep'].includes(typed.aggregation)) return {ok:false,message:'Pie charts require a positive additive measure such as count or sum.'};
  return {ok:true};
}
function validateResearchEditor(){
  if(!els.researchValueField) return true;
  syncResearchEditorStateFromDom(); const item=currentResearchItemFromEditor(), need=['sum','avg','min','max','percent_item','value_within','value_percent_within'].includes(item.valueMode), needDate=['date_within','date_percent_within'].includes(item.valueMode), needCountBy=item.valueMode==='count_by';
  els.researchDateColumn?.classList.remove('researchInvalid');
  let res=need?researchNumericValidation(item,item.valueField):(needDate?(researchFieldLooksDate(item,item.valueField)?{ok:true}:{ok:false,message:'This dates-within mode requires a date field.'}):(needCountBy?(String(item.valueField||'').trim()?{ok:true}:{ok:false,message:'Count By requires a Y axis field/expression to count.'}):{ok:true}));
  if(res.ok && item.valueMode==='percent_item'){
    if(!String(item.percentOfField||'').trim()) res={ok:false,message:'% of item requires a denominator item.'};
    else res=researchNumericValidation(item,item.percentOfField);
  }
  if(res.ok && ['date_within','date_percent_within','value_within','value_percent_within'].includes(item.valueMode) && !String(item.withinCompareField||'').trim()) res={ok:false,message:'Within mode requires a comparison field.'};
  if(res.ok && ['value_within','value_percent_within'].includes(item.valueMode)) res=researchNumericValidation(item,item.withinCompareField);
  if(res.ok && ['histogram','box'].includes(item.outputType)) res=researchNumericValidation(item,item.valueField);
  if(res.ok && item.outputType==='scatter'){ const x=researchNumericValidation(item,item.groupField); if(!x.ok) res={ok:false,message:'Scatter plots require a numeric Group / X axis field.'}; else if(!['count','unique','percent_total','percent_parent'].includes(item.valueMode)) res=researchNumericValidation(item,item.valueField); }
  if(res.ok && item.outputType==='heatmap' && !(item.useSecondaryGroup&&item.secondaryGroupField)) res={ok:false,message:'Heatmaps require a secondary group / series field.'};
  if(res.ok && item.valueMode==='measure'){ const def=researchTypedMeasureDefinition(item.measureId||researchMeasureIdFromRef(item.valueField)); res=def?researchNumericValidation(item,item.valueField):{ok:false,message:'Typed measure mode requires a measure selected from the registry above.'}; }
  if(res.ok&&item.outputType==='table'){ const invalid=(item.columns||[]).find(c=>{ if(c.mode!=='measure') return false; const def=researchTypedMeasureDefinition(c.measureId||researchMeasureIdFromRef(c.field)); return !def||!resolveResearchTypedMeasure(def,item.source)?.compatible; }); if(invalid) res={ok:false,message:`Table column "${invalid.customTitle||invalid.label||'Value'}" is in Typed measure mode but its registry measure or required source fields are unavailable.`}; }
  if(res.ok) res=validateResearchChartCompatibility(item);
  els.researchValueField.classList.toggle('researchInvalid', !res.ok);
  if(els.researchValueFieldError){ els.researchValueFieldError.textContent=res.ok?'':res.message; els.researchValueFieldError.classList.toggle('hidden',res.ok); }
  return res.ok;
}
function compareFilter(v,op,w,w2){ const orgOps=['is in org','includes org']; if(orgOps.includes(op)||String(w||'').trim().startsWith('$')){ const hit=inOrg(v,String(w||'').replace(/^\$/,'')); if(op==='is not'||op==='is not in org'||op==='excludes org') return !hit; return hit; } op=normalizedTextOperator(op); const textOps=['is','is not','contains','does not contain']; if(textOps.includes(op)){ const a=normalizeResearchText(v), b=normalizeResearchText(w); if(op==='is') return a===b; if(op==='is not') return a!==b; if(op==='contains') return !b || a.includes(b); if(op==='does not contain') return !b || !a.includes(b); } const na=toNum(v), nb=toNum(w), nc=toNum(w2); if(op==='between') return Number.isFinite(na)&&Number.isFinite(nb)&&Number.isFinite(nc)&&na>=Math.min(nb,nc)&&na<=Math.max(nb,nc); if(op==='greater than') return na>nb; if(op==='greater/equal') return na>=nb; if(op==='less than') return na<nb; if(op==='less/equal') return na<=nb; return true; }
function calendarDiffDays(a,b){ const da=parseDateOnly(a), db=parseDateOnly(b); if(!da||!db) return NaN; return Math.round((Date.UTC(db.getFullYear(),db.getMonth(),db.getDate())-Date.UTC(da.getFullYear(),da.getMonth(),da.getDate()))/86400000); }
function dateWindowPass(anchor,target,f){ if(f.windowMode==='range'){ const d=parseDateOnly(target), lo=parseDateOnly(f.rangeStart), hi=parseDateOnly(f.rangeEnd); return !!d && (!lo||d>=lo) && (!hi||d<=hi); } const raw=String(f.dayWindow??f.withinDays??'0').trim(); const diff=calendarDiffDays(target,anchor); if(!Number.isFinite(diff)) return false; const abs=raw.match(/^A?(\d+)$/i); if(abs) return Math.abs(diff)<=Number(abs[1]); const signed=raw.match(/^([+-])(\d+)$/); if(signed){ const n=Number(signed[2]); return signed[1]==='+' ? diff>=0&&diff<=n : diff<=0&&diff>=-n; } const n=Math.abs(Number(raw)||0); return Math.abs(diff)<=n; }
function researchAnchorDate(item,row){ item=effectiveResearchItem(item||{}); if(item.dateColumn) return row[item.dateColumn]; const hs=getResearchHeaders(item.source); const h=findHeader(hs, item.source==='qa'?['Interaction Start Time','Assigned Date','Date']:checklistLikeDefaultDateHeaders(item.source)); return h?row[h]:''; }
function researchRowsIntersect(a,b){ const set=new Set(a||[]); return (b||[]).filter(r=>set.has(r)); }
function researchFilterWord(f){ if((f.op||'')!=='contains') return ''; const toks=researchTokenizeText(f.value||''); return toks.length===1 ? toks[0] : ''; }

function stableSerialize(value){
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stableSerialize).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableSerialize(value[k])).join(',')+'}';
}
function bumpVersion(name){ if(!state.versions) state.versions={}; state.versions[name]=(Number(state.versions[name])||0)+1; return state.versions[name]; }
function boundedMapSet(map,key,value,max=250){ if(!map) return value; if(map.has(key)) map.delete(key); map.set(key,value); while(map.size>max){ map.delete(map.keys().next().value); } return value; }
function ensureColumnValueIndex(sourceOrIdx,column){
  const idx=typeof sourceOrIdx==='string'?sourceIndex(sourceOrIdx):sourceOrIdx; if(!idx || !column) return null;
  const actual=resolveColumn(idx.rows?.[0]?._sourceKey||'',column)||column, cacheKey=`columnValue|${idx.version}|${actual}|norm`;
  if(idx.lazyIndexes?.has(cacheKey)) return idx.lazyIndexes.get(cacheKey);
  const t0=performance.now(), map=new Map(); (idx.rows||[]).forEach((r,pos)=>pushMapArray(map,normalizeResearchText(r[actual]),pos));
  idx.lazyIndexes.set(cacheKey,map); idx.byColumnValue=idx.byColumnValue||new Map(); map.forEach((positions,val)=>idx.byColumnValue.set(actual+'\u0000'+val,positions.map(i=>idx.rows[i])));
  idx.perf.lazyBuilds.push({type:'columnValue',column:actual,ms:Math.round(performance.now()-t0)}); state.perfCounters.lazyIndexBuilds++; console.info('[All Star Perf] lazy index build',{type:'columnValue',column:actual,rows:(idx.rows||[]).length,ms:Math.round(performance.now()-t0)}); return map;
}
function ensureNumericColumnIndex(sourceOrIdx,column){
  const idx=typeof sourceOrIdx==='string'?sourceIndex(sourceOrIdx):sourceOrIdx; if(!idx||!column) return null;
  const actual=(idx.headers||[]).find(h=>plainHeaderName(h)===plainHeaderName(column))||column, key=`numeric|${idx.version}|${actual}`;
  if(idx.lazyIndexes?.has(key)) return idx.lazyIndexes.get(key);
  const t0=performance.now(), values=[]; (idx.rows||[]).forEach((r,pos)=>{ const n=toNum(r[actual]); if(Number.isFinite(n)) values.push({n,pos}); }); values.sort((a,b)=>a.n-b.n||a.pos-b.pos);
  const out={column:actual,values}; idx.lazyIndexes?.set(key,out); state.perfCounters.lazyIndexBuilds++; idx.perf?.lazyBuilds?.push({type:'numeric',column:actual,ms:Math.round(performance.now()-t0)}); return out;
}
function numericLowerBound(values,target,upper=false){ let lo=0,hi=values.length; while(lo<hi){ const mid=(lo+hi)>>1,n=values[mid].n; if(n<target || (upper&&n===target)) lo=mid+1; else hi=mid; } return lo; }
function numericIndexCandidateRows(idx,field,op,value,value2){
  const ni=ensureNumericColumnIndex(idx,field), arr=ni?.values||[], a=toNum(value), b=toNum(value2); if(!ni||!Number.isFinite(a)) return null;
  let lo=0,hi=arr.length;
  if(op==='greater than') lo=numericLowerBound(arr,a,true); else if(op==='greater/equal') lo=numericLowerBound(arr,a,false); else if(op==='less than') hi=numericLowerBound(arr,a,false); else if(op==='less/equal') hi=numericLowerBound(arr,a,true); else if(op==='between'&&Number.isFinite(b)){ const min=Math.min(a,b),max=Math.max(a,b); lo=numericLowerBound(arr,min,false); hi=numericLowerBound(arr,max,true); } else return null;
  return arr.slice(lo,hi).map(x=>idx.rows[x.pos]);
}
function textIndexCandidateRows(idx,source,field,word){
  const actual=resolveColumn(source,field)||field, map=ensureTextTokenIndex(idx,actual), positions=map?.get(word); return positions?positions.map(i=>idx.rows[i]):null;
}

function ensureTextTokenIndex(sourceOrIdx,column='*'){
  const idx=typeof sourceOrIdx==='string'?sourceIndex(sourceOrIdx):sourceOrIdx; if(!idx) return null;
  const actual=column==='*'?'*':(resolveColumn(idx.rows?.[0]?._sourceKey||'',column)||column), cacheKey=`textToken|${idx.version}|${actual}|norm`;
  if(idx.lazyIndexes?.has(cacheKey)) return idx.lazyIndexes.get(cacheKey);
  const t0=performance.now(), map=new Map(), repMap=new Map(), cols=actual==='*'?(idx.descriptionHeaders?.length?idx.descriptionHeaders:idx.headers):[actual];
  (idx.rows||[]).forEach((r,pos)=>{ const toks=researchTokenizeText(cols.map(h=>r[h]).join(' ')); idx.tokens.set(r,toks); idx.searchText.set(r,normalizeResearchText(cols.map(h=>r[h]).join(' '))); toks.forEach(w=>{ pushMapArray(map,w,pos); const rep=r._repKey||''; if(rep) pushMapArray(repMap,rep+'|'+w,pos); }); });
  idx.lazyIndexes.set(cacheKey,map); if(actual==='*'){ idx.byWord=new Map(); map.forEach((positions,w)=>idx.byWord.set(w,positions.map(i=>idx.rows[i]))); idx.byRepWord=new Map(); repMap.forEach((positions,w)=>idx.byRepWord.set(w,positions.map(i=>idx.rows[i]))); }
  idx.perf.lazyBuilds.push({type:'textToken',column:actual,ms:Math.round(performance.now()-t0)}); state.perfCounters.lazyIndexBuilds++; console.info('[All Star Perf] lazy index build',{type:'textToken',column:actual,rows:(idx.rows||[]).length,ms:Math.round(performance.now()-t0)}); return map;
}
function ensureMonthIndex(sourceOrIdx,dateColumn){ return ensureDateBucketIndex(sourceOrIdx,dateColumn,'month'); }
function ensureWeekIndex(sourceOrIdx,dateColumn){ return ensureDateBucketIndex(sourceOrIdx,dateColumn,'week'); }
function ensureDateBucketIndex(sourceOrIdx,dateColumn,type){ const idx=typeof sourceOrIdx==='string'?sourceIndex(sourceOrIdx):sourceOrIdx; if(!idx) return null; const col=dateColumn||'_date', key=`${type}|${idx.version}|${col}`; if(idx.lazyIndexes.has(key)) return idx.lazyIndexes.get(key); const t0=performance.now(), map=new Map(); (idx.rows||[]).forEach((r,pos)=>{ const ms=parseDateOnly(researchFieldValue(r,col,r._sourceKey||''))?.getTime()||idx.rowMeta.get(r)?.dateMs; const b=type==='month'?researchMonthBucket(ms):(Number.isFinite(ms)?ymd(startOfWeekDate(new Date(ms),'sunday')):''); if(b) pushMapArray(map,b,pos); }); idx.lazyIndexes.set(key,map); state.perfCounters.lazyIndexBuilds++; console.info('[All Star Perf] lazy index build',{type,column:col,ms:Math.round(performance.now()-t0)}); return map; }
function ensureHeaderIndex(sourceOrIdx,column){ const idx=typeof sourceOrIdx==='string'?sourceIndex(sourceOrIdx):sourceOrIdx; if(!idx) return null; const key=`header|${idx.version}|${plainHeaderName(column)}`; if(idx.lazyIndexes.has(key)) return idx.lazyIndexes.get(key); const actual=(idx.headers||[]).find(h=>plainHeaderName(h)===plainHeaderName(column))||column; const rows=(idx.rows||[]).map((_,i)=>i); idx.lazyIndexes.set(key,{column:actual,rows}); state.perfCounters.lazyIndexBuilds++; return idx.lazyIndexes.get(key); }
function compiledFilterSignature(source,filters,context={}){ return stableSerialize({source,version:state.dataIndex?.version||0,start:ymd(context.start||context.startDate),end:ymd(context.end||context.endDate),dateColumn:context.dateColumn||'',qaDateMode:context.qaDateMode||'',filters:(filters||[]).map(f=>normalizeFilterForStorage(f,source)),scope:context.scope||''}); }
function getCompiledFilterPredicate(source,filters,context={}){ const key=compiledFilterSignature(source,filters,context); state.compiledFilterCache=state.compiledFilterCache||new Map(); if(state.compiledFilterCache.has(key)){ state.perfCounters.filterCacheHits++; const v=state.compiledFilterCache.get(key); state.compiledFilterCache.delete(key); state.compiledFilterCache.set(key,v); return v; } const t0=performance.now(), normalized=(filters||[]).map(f=>normalizeFilterForStorage(f,source)); const predicate=(r)=>applyFilters([r],normalized,source,context).length===1; state.perfCounters.filterCompiles++; console.info('[All Star Perf] filter compiled',{source,count:normalized.length,ms:Math.round(performance.now()-t0)}); return boundedMapSet(state.compiledFilterCache,key,predicate,300); }

function indexRowsForExactFieldValue(idx,field,value){
  if(!idx || !field) return null;
  const val=normalizeResearchText(value), normalizedField=plainHeaderName(field);
  if(normalizedField==='source') return idx.bySourceName?.get(val)||null;
  if(normalizedField==='category' || normalizedField==='type') return idx.byCategory?.get(val)||null;
  const actual=(idx.headers||[]).find(h=>plainHeaderName(h)===normalizedField)||field;
  const lazy=ensureColumnValueIndex(idx,actual);
  const positions=lazy?.get(val);
  if(positions) return positions.map(i=>idx.rows[i]);
  return null;
}
function lowerBoundDateRows(list,idx,target){ let lo=0, hi=(list||[]).length; while(lo<hi){ const mid=(lo+hi)>>1, ms=idx.rowMeta.get(list[mid])?.dateMs||0; if(ms<target) lo=mid+1; else hi=mid; } return lo; }
function researchDateCandidatesForRep(idx,rep,anchor,f){
  const list=idx?.byRepSortedDate?.get(rep)||[], ad=parseDateOnly(anchor); if(!list.length||!ad) return null;
  if(f.windowMode==='range'){ const lo=parseDateOnly(f.rangeStart), hi=parseDateOnly(f.rangeEnd); const a=lo?lo.getTime():-Infinity, b=hi?hi.getTime():Infinity; return list.slice(lowerBoundDateRows(list,idx,a), lowerBoundDateRows(list,idx,b+86400000)); }
  const raw=String(f.dayWindow??f.withinDays??'0').trim(), abs=raw.match(/^A?(\d+)$/i), signed=raw.match(/^([+-])(\d+)$/); let loMs, hiMs;
  const base=Date.UTC(ad.getFullYear(),ad.getMonth(),ad.getDate());
  if(abs){ const n=Number(abs[1])*86400000; loMs=base-n; hiMs=base+n+86400000; }
  else if(signed){ const n=Number(signed[2])*86400000; if(signed[1]==='+'){ loMs=base; hiMs=base+n+86400000; } else { loMs=base-n; hiMs=base+86400000; } }
  else { const n=Math.abs(Number(raw)||0)*86400000; loMs=base-n; hiMs=base+n+86400000; }
  return list.slice(lowerBoundDateRows(list,idx,loMs), lowerBoundDateRows(list,idx,hiMs));
}
function dateAwareResearchMatch(row,item,f){
  const src=f.targetSource||'qa', idx=sourceIndex(src), rep=personKeyFromRow(row), team=researchRowTeam(row), word=researchFilterWord({op:f.targetOp==='does not contain'?'does not contain':'contains',value:f.targetValue}), anchor=researchAnchorDate(item,row);
  if(idx && word) ensureTextTokenIndex(idx,'*');
  let candidates=idx ? (researchDateCandidatesForRep(idx,rep,anchor,f) || (rep&&word&&idx.byRepWord.has(rep+'|'+word) ? idx.byRepWord.get(rep+'|'+word) : [...(idx.byRep.get(rep)||[]),...(idx.byTeam.get(team)||[])])) : getRowsRaw(src);
  if(idx && word){ ensureTextTokenIndex(idx,'*'); if(candidates.length>25 && idx.byWord.has(word)) candidates=researchRowsIntersect(candidates, idx.byWord.get(word)); }
  const seen=new Set(), col=f.targetValueColumn||'', dateCol=resolveColumn(src,f.targetDateColumn)||f.targetDateColumn;
  return candidates.some(tr=>{ if(seen.has(tr)) return false; seen.add(tr); const personOk=rep&&personKeyFromRow(tr)&&rep===personKeyFromRow(tr); const teamOk=team&&researchRowTeam(tr)&&team===researchRowTeam(tr); if(!personOk&&!teamOk) return false; if(!dateWindowPass(anchor, tr[dateCol], f)) return false; return compareFilter(researchFieldValue(tr,col,src), f.targetOp||'contains', f.targetValue||''); });
}
function dateWithinRowPass(row,item,f){ const left=researchFieldValue(row,f.field,item.source), right=researchFieldValue(row,f.withinRightField||f.value,item.source); return dateWindowPass(left,right,{dayWindow:f.dayWindow||f.value2||f.withinDays}); }
function intersectRowsFast(a,b){ const set=new Set(b||[]); return (a||[]).filter(r=>set.has(r)); }
function dateRangeRowsFromIndex(idx,start,end){
  if(!idx?.dateSortedRows?.length || (!start&&!end)) return null;
  const s=start?parseDateOnly(start):null, e=end?parseDateOnly(end):null, lo=s?Date.UTC(s.getFullYear(),s.getMonth(),s.getDate()):-Infinity, hi=e?Date.UTC(e.getFullYear(),e.getMonth(),e.getDate())+86400000:Infinity;
  return idx.dateSortedRows.slice(lowerBoundDateRows(idx.dateSortedRows,idx,lo),lowerBoundDateRows(idx.dateSortedRows,idx,hi));
}
function queryPlanNote(plan){ if(!plan) return ''; return `Query optimized: ${(plan.initialRows||0).toLocaleString()} rows → ${(plan.candidateRows??plan.finalRows??0).toLocaleString()} candidate rows.`; }
function queryPlanBadge(plan){ const note=queryPlanNote(plan); return note?`<div class="researchPreviewSummary"><span class="badge">${esc(note)}</span></div>`:''; }
function isPersonTeamField(field){ const f=normalizeResearchText(field); return /(^| )(rep|representative|associate|agent|person|name|team|coach|job coach|coach assigned)( |$)/.test(f); }
function researchQueryFilterCacheKey(source,opts={}){
  const item=opts.item||{}, orgSignature=researchHashText(stableSerialize((state.orgs||[]).map(o=>({id:o.id,name:o.name,coachNames:o.coachNames||[]}))));
  return ['researchFilterV1',researchSourceIndexSignature(source),state.versions?.aliases||0,state.versions?.teams||0,state.versions?.mappings||0,state.versions?.models||0,orgSignature,researchHashText(stableSerialize({dateColumn:opts.dateColumn||'',startDate:opts.startDate||'',endDate:opts.endDate||'',filters:opts.filters||[],populationScope:item.populationScope||{}}))].join('\u001f');
}
function researchFilterCacheRows(cached,idx){
  if(Array.isArray(cached?.positions)&&idx?.rows) return cached.positions.map(i=>idx.rows[i]).filter(Boolean);
  return Array.isArray(cached?.rows)?cached.rows.slice():null;
}
function buildQueryPlan(source, opts={}){
  const idx=sourceIndex(source), all=getRowsRaw(source), plan={source,usedIndex:!!idx,initialRows:all.length,candidateRows:all.length,finalRows:all.length,steps:[],fallbacks:[],filters:[],indexesUsed:[],rowsScanned:0};
  const filterCacheKey=researchQueryFilterCacheKey(source,opts), cached=state.researchFilterResultCache?.get(filterCacheKey), cachedRows=researchFilterCacheRows(cached,idx);
  if(cachedRows){ plan.cacheHit=true; plan.candidateRows=cachedRows.length; plan.finalRows=cachedRows.length; plan.indexesUsed.push('versioned filter-position cache'); plan.steps.push({name:'versioned filter cache',before:all.length,candidates:cachedRows.length,after:cachedRows.length,usedIndex:true}); state.researchCohortRowSignatures=state.researchCohortRowSignatures||new WeakMap(); state.researchCohortRowSignatures.set(cachedRows,filterCacheKey); return {rows:cachedRows,plan}; }
  plan.cacheHit=false;
  let rows=all;
  const step=(name,before,candidates,after,used)=>plan.steps.push({name,before,candidates,after,usedIndex:!!used});
  const filters=(opts.filters||[]).filter(Boolean);
  if(isCustomWeeklyStatSource(source) && (opts.startDate||opts.endDate)){ const before=rows.length; rows=rows.filter(r=>weeklyRowInRange(source,r,{...opts,start:opts.startDate,end:opts.endDate})); step('weekly date/week range filter',before,before,rows.length,false); }
  else if(idx && opts.dateColumn && (opts.startDate||opts.endDate)){
    const actual=resolveColumn(source,opts.dateColumn)||opts.dateColumn;
    let candidates=null;
    if(actual===researchDefaultDateColumn({source}) || actual==='_date') candidates=dateRangeRowsFromIndex(idx,opts.startDate,opts.endDate);
    const before=rows.length;
    if(candidates){ rows=intersectRowsFast(rows,candidates).filter(r=>inRange(researchFieldValue(r,actual,source),opts.startDate,opts.endDate)); step('date filter',before,candidates.length,rows.length,true); }
    else { rows=rows.filter(r=>inRange(researchFieldValue(r,actual,source),opts.startDate,opts.endDate)); step('date filter',before,before,rows.length,false); plan.fallbacks.push('dateColumn'); }
  }else if(opts.dateColumn && (opts.startDate||opts.endDate)){ const before=rows.length; rows=rows.filter(r=>inRange(researchFieldValue(r,opts.dateColumn,source),opts.startDate,opts.endDate)); step('date filter',before,before,rows.length,false); }
  rows=researchApplyPopulationScope(rows,{...(opts.item||{}),source},plan);
  const remaining=[];
  const applyGroup=(label,predicate,indexRows)=>{ const before=rows.length; const candidates=indexRows?intersectRowsFast(rows,indexRows):rows; rows=candidates.filter(predicate); step(label,before,candidates.length,rows.length,!!indexRows); };
  filters.forEach(f=>{
    const op=f.op||'contains', include=f.include||'include';
    if(f.expression || include==='includeWithin' || include==='excludeWithin' || parseModelRef(f.field||'') || parseModelRef(f.value||'')){ remaining.push(f); return; }
    const field=resolveColumn(source,f.field)||f.field, val=f.value;
    const orgLike=['is in org','is not in org','includes org','excludes org'].includes(op)||String(val||'').trim().startsWith('$');
    if(orgLike && include==='include'){
      const before=rows.length, org=findOrg(String(val||'').replace(/^\$/,'')), set=orgCoachSet(org); let ix=[];
      if(idx && org?.coachNames?.length){ org.coachNames.forEach(n=>{ (idx.byTeam?.get(n)||[]).forEach(r=>ix.push(r)); (idx.byCoach?.get(n)||[]).forEach(r=>ix.push(r)); }); ix=[...new Set(ix)]; }
      const pred=r=>{ const left=field?researchFieldValue(r,field,source):researchRowTeam(r); return compareFilter(left,op,val,f.value2); };
      applyGroup(`Org filter reduced ${before.toLocaleString()} rows`, pred, ix.length?ix:null); return;
    }
    if(include==='include' && op==='is' && isPersonTeamField(field)){
      const nval=normalizeResearchText(val), key=nameKey(val); let ix=null;
      if(/team|coach/.test(normalizeResearchText(field))) ix=(idx?.byTeam?.get(val)||idx?.byCoach?.get(val)||[]); else ix=(idx?.byRep?.get(key)||[]);
      applyGroup('representative/person/team/coach filter', r=>compareFilter(researchFieldValue(r,field,source),op,val,f.value2), ix&&ix.length?ix:null); return;
    }
    remaining.push(f);
  });
  const next=[];
  remaining.forEach(f=>{
    const op=f.op||'contains', include=f.include||'include', field=resolveColumn(source,f.field)||f.field;
    if(include==='include' && op==='is' && field && idx){ const before=rows.length, ix=indexRowsForExactFieldValue(idx,field,f.value); if(ix){ const cand=intersectRowsFast(rows,ix); rows=cand.filter(r=>compareFilter(researchFieldValue(r,field,source),op,f.value,f.value2)); step('exact column/value filter',before,cand.length,rows.length,true); return; } }
    if(include==='include' && ['greater than','greater/equal','less than','less/equal','between'].includes(op) && field && idx){ const before=rows.length, ix=numericIndexCandidateRows(idx,field,op,f.value,f.value2); if(ix){ const cand=intersectRowsFast(rows,ix); rows=cand.filter(r=>compareFilter(evaluateResearchNumericField(r,field,source),op,f.value,f.value2)); step('numeric range filter',before,cand.length,rows.length,true); return; } }
    next.push(f);
  });
  const last=[];
  next.forEach(f=>{
    const word=researchFilterWord(f), include=f.include||'include';
    if(include==='include' && word && idx){ const indexed=textIndexCandidateRows(idx,source,f.field,word); if(indexed){ const before=rows.length, cand=intersectRowsFast(rows,indexed); rows=cand.filter(r=>compareFilter(researchFieldValue(r,f.field,source),f.op||'contains',f.value,f.value2)); step('column text-token filter',before,cand.length,rows.length,true); return; } }
    last.push(f);
  });
  const modelRefs=[], custom=[];
  last.forEach(f=>(parseModelRef(f.field||'')||parseModelRef(f.value||''))?modelRefs.push(f):custom.push(f));
  [modelRefs,custom].forEach((list,li)=>list.forEach(f=>{ const before=rows.length; rows=applyResearchFilters(rows,[f],opts.item||{source},plan); step(li===0?'model criteria reference':'custom expression/filter',before,before,rows.length,false); }));
  if(rows===all) rows=all.slice();
  plan.candidateRows=rows.length; plan.finalRows=rows.length;
  plan.rowsScanned=Math.max(plan.rowsScanned||0,(plan.steps||[]).reduce((n,s)=>n+Number(s.candidates||0),0));
  const positions=idx?.rowMeta?[...rows].map(r=>idx.rowMeta.get(r)?.rowId):[];
  const cacheValue=positions.length===rows.length&&positions.every(Number.isInteger)?{positions,plan:{...plan}}:{rows:rows.slice(),plan:{...plan}};
  state.researchFilterResultCache=state.researchFilterResultCache||new Map(); boundedMapSet(state.researchFilterResultCache,filterCacheKey,cacheValue,120);
  state.researchCohortRowSignatures=state.researchCohortRowSignatures||new WeakMap(); state.researchCohortRowSignatures.set(rows,filterCacheKey);
  return {rows,plan};
}
function compileResearchExpression(expression,source='',context='research filter'){ if(!expression) return null; return compileCachedExpression(source,normalizeOrgExpression(expression),getHeaders(source),raw=>Function('row','toNumber','inOrg','return ('+raw+');'),{source,context}); }
function applyResearchFilters(rows, filters, item, perf){
  const source=typeof item==='string'?item:(item?.source||''), idx=sourceIndex(source); let out=rows||[]; const stat=perf||{filters:[],indexesUsed:[],rowsScanned:0};
  const compiled=(filters||[]).map((f,i)=>({f,idx:i,word:researchFilterWord(f),exprFn:f.expression?compileResearchExpression(f.expression,source,`Research filter ${i+1}`):null}));
  compiled.sort((a,b)=>{ const sa=a.word&&idx?.byWord?.has(a.word)?idx.byWord.get(a.word).length:Infinity, sb=b.word&&idx?.byWord?.has(b.word)?idx.byWord.get(b.word).length:Infinity; return sa-sb; });
  compiled.forEach(plan=>{
    const f=plan.f, before=out.length; let candidates=out; const isTeamFilter=f.type==='team_is'||f.fieldType==='team_is';
    if(!isTeamFilter && plan.word && idx && f.include!=='exclude' && f.include!=='excludeWithin'){
      const indexed=textIndexCandidateRows(idx,source,f.field,plan.word); if(indexed){ candidates=researchRowsIntersect(out,indexed); stat.indexesUsed.push(`textToken:${f.field}:${plan.word}`); }
    }
    const resolvedTeamFilter=isTeamFilter?resolveTeamFilterSelection(f.teamInput||f.rawTeamInput||f.value||''):null; if(isTeamFilter && resolvedTeamFilter?.warnings?.length && stat.warnings) resolvedTeamFilter.warnings.forEach(w=>stat.warnings.push('Team filter warning: '+w));
    const phrases=filterPhrases(f), ref=parseResearchSourceFieldRef(f.field||'');
    if(!isTeamFilter && isMultiPhraseTextOperator(f.op||'') && phrases.length){
      syncMultiPhraseFilter(f);
      const targetSource=(ref&&!ref.missingSource&&!ref.missingField)?ref.source:source, targetField=(ref&&!ref.missingSource&&!ref.missingField)?ref.field:f.field;
      const targetRows=(targetSource===source?candidates:researchRowsForCohort(targetSource,candidates,source,item||{}));
      const grouped=new Map(); targetRows.forEach(tr=>{ const k=entityKeyForMultiPhraseRow(tr,{item,source:targetSource}); if(!k) return; if(!grouped.has(k)) grouped.set(k,[]); grouped.get(k).push(tr); });
      const passEntities=new Set(); grouped.forEach((rs,k)=>{ if(entityMatchesMultiPhraseCondition(rs,targetField,f.op,phrases,f.conditionResult,{item,source:targetSource})) passEntities.add(k); });
      out=candidates.filter(r=>{ stat.rowsScanned++; const k=entityKeyForMultiPhraseRow(r,{item,source}); const ok=passEntities.has(k); return (f.include==='exclude'||f.include==='excludeWithin')?!ok:ok; });
      stat.filters.push({filter:plan.idx+1,before,candidates:candidates.length,after:out.length,multiPhrase:true,valueLogic:normalizedTextOperator(f.op)==='does not contain'?'none':'any',phrases});
      return;
    }
    out=candidates.filter(r=>{ stat.rowsScanned++; if(isTeamFilter) return rowMatchesTeamFilter(r,source,resolvedTeamFilter,f.conditionResult,{item}); const metricOk=metricFilterRowPass(r,(typeof item==='string'?{source}:item)||{},f,[]); if(metricOk!==null) return metricOk; let ok=true; if(f.include==='includeWithin'||f.include==='excludeWithin') ok=(f.op==='within days of'||f.withinRightField)?dateWithinRowPass(r,item||{},f):dateAwareResearchMatch(r,item||{},f); else if(plan.exprFn) ok=!!evaluateCompiledExpression(plan.exprFn,[r,toNum,inOrg],{source,context:`Research filter ${plan.idx+1}`,row:r}); else { if(f.op==='within days of') ok=dateWithinRowPass(r,item||{},f); else { const numeric=['greater than','greater/equal','less than','less/equal','between'].includes(f.op); const orgLike=['is in org','is not in org','includes org','excludes org'].includes(f.op)||String(f.value||'').trim().startsWith('$'); const autoField=(!f.field&&orgLike)?(researchRowTeam(r)?'_orgAutoTeam':''):f.field; const left=autoField==='_orgAutoTeam'?researchRowTeam(r):(numeric?evaluateResearchNumericField(r,autoField,source):researchFieldValue(r,autoField,source)); ok=compareFilter(left,f.op||'contains',f.value,f.value2); } } if(!conditionResultIsTrue(f.conditionResult)) ok=!ok; return (f.include==='exclude'||f.include==='excludeWithin')?!ok:ok; });
    stat.filters.push({filter:plan.idx+1,before,candidates:candidates.length,after:out.length});
  });
  return out;
}
function researchBucketDate(d,period,weekStart='sunday'){ const x=(period==='weekly'?parseWeekLabel(d,weekStart):parseDateOnly(d)); if(!x) return ''; if(period==='quarterly') return `${x.getFullYear()} Q${Math.floor(x.getMonth()/3)+1}`; if(period==='monthly') return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`; if(period==='weekly') return ymd(startOfWeekDate(x,weekStart)); return ymd(x); }
function parseResearchBangField(field){
  const ref=parseResearchSourceFieldRef(field);
  if(!ref) return null;
  return ref.missingSource||ref.missingField ? {source:ref.source,field:ref.rawField,rawSource:ref.rawSource,rawField:ref.rawField,missingSource:ref.missingSource,missingField:ref.missingField} : {source:ref.source,field:ref.field,rawSource:ref.rawSource,rawField:ref.rawField};
}
function researchUniqueSourceForHeader(field,defaultSource){
  const raw=String(field||'').trim(); if(!raw) return null;
  const hasHeader=(src)=>{ const actual=resolveColumn(src,raw); return actual && (getHeaders(src)||[]).includes(actual); };
  if(defaultSource && !isDynamicResearchSource(defaultSource) && hasHeader(defaultSource)) return {source:defaultSource,field:resolveColumn(defaultSource,raw)};
  const hits=allSourceKeys().filter(src=>src!==defaultSource && hasHeader(src));
  return hits.length===1 ? {source:hits[0],field:resolveColumn(hits[0],raw)} : null;
}
function researchBestSourceForHeader(field,defaultSource,rows,item={}){
  const raw=String(field||'').trim(); if(!raw) return null;
  const hasHeader=(src)=>{ const actual=resolveColumn(src,raw); return actual && (getHeaders(src)||[]).includes(actual); };
  if(defaultSource && !isDynamicResearchSource(defaultSource) && hasHeader(defaultSource)) return {source:defaultSource,field:resolveColumn(defaultSource,raw)};
  const hits=allSourceKeys().filter(src=>src!==defaultSource && hasHeader(src));
  if(hits.length===1) return {source:hits[0],field:resolveColumn(hits[0],raw)};
  if(!hits.length) return null;
  const scored=hits.map(src=>{ const actual=resolveColumn(src,raw); const cohort=researchRowsForCohort(src,rows,defaultSource,item).slice(0,300); let numeric=0, filled=0; cohort.forEach(r=>{ const v=r[actual]; if(String(v??'').trim()!==''){ filled++; if(Number.isFinite(toNum(v))) numeric++; } }); return {source:src,field:actual,score:numeric*2+filled,filled,numeric}; }).sort((a,b)=>b.score-a.score);
  return scored[0]?.score>0 ? {source:scored[0].source,field:scored[0].field} : null;
}
function splitResearchMultiAddText(text){
  const out=[]; let cur='', quote='', depth=0;
  for(const ch of String(text||'')){
    if(quote){ cur+=ch; if(ch===quote) quote=''; continue; }
    if(ch==='"' || ch==="'"){ quote=ch; cur+=ch; continue; }
    if(ch==='(' || ch==='[' || ch==='{'){ depth++; cur+=ch; continue; }
    if(ch===')' || ch===']' || ch==='}'){ depth=Math.max(0,depth-1); cur+=ch; continue; }
    if(ch===',' && depth===0){ if(cur.trim()) out.push(cur.trim()); cur=''; continue; }
    cur+=ch;
  }
  if(cur.trim()) out.push(cur.trim());
  return out;
}

function normalizeResearchDuplicateRepName(name){
  let raw=cleanName(name||'');
  if(raw.includes(',')){ const parts=raw.split(',').map(x=>x.trim()).filter(Boolean); if(parts.length>=2) raw=(parts.slice(1).join(' ')+' '+parts[0]).trim(); }
  return normalizeResearchText(raw).replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
}
function researchDuplicateRepNameFromRow(row){ return row?._rep||row?.['Agent Name']||row?.['Associate Name']||row?.['Associate name']||row?.Agent||row?.Representative||''; }
function researchDuplicateRepKey(row,source=''){ return (source||'')+'|'+(personKeyFromRow(row)||normalizeResearchDuplicateRepName(researchDuplicateRepNameFromRow(row))||researchRowTeam(row)||'blank'); }
function researchDuplicateReferencedSources(item={}){ const refs=[resolveDynamicResearchSource(item),...researchReferencedSources(item)]; (item.columns||[]).forEach(c=>{ const m=findMetricByRef(c.field); if(m?.source) refs.push(m.source); }); const vm=findMetricByRef(item.valueField); if(vm?.source) refs.push(vm.source); return [...new Set(refs.filter(Boolean).filter(s=>!isDynamicResearchSource(s)))]; }
function scoreDuplicateRepCandidate(repKey, rowsBySource, researchItem, context={}){
  const source=researchItem.source, refs=context.referencedSources||researchDuplicateReferencedSources(researchItem), allRows=[]; let currentSourceRowCount=0, referencedSourceRowCount=0, nonBlankFieldCount=0, numericFieldCount=0, metricMatchCount=0, dateDays=new Set(), teamMappingFound=false, displayName='';
  refs.forEach(src=>{ const rs=(rowsBySource.get(src)||[]).filter(r=>researchDuplicateRepKey(r,src)===repKey); if(src===source) currentSourceRowCount+=rs.length; else referencedSourceRowCount+=rs.length; rs.forEach(r=>{ allRows.push(r); displayName=displayName||researchDuplicateRepNameFromRow(r); if(researchRowTeam(r)) teamMappingFound=true; const d=researchDayBucket(rowDateMillisForSource(src,r)); if(d) dateDays.add(d); (getHeaders(src)||Object.keys(r||{})).forEach(h=>{ const v=r[h]; if(String(v??'').trim()!==''){ nonBlankFieldCount++; if(Number.isFinite(toNum(v))) numericFieldCount++; } }); }); });
  (state.metrics||[]).forEach(m=>{ if(refs.includes(m.source||'')){ try{ metricMatchCount+=metricRows(m,rowsBySource.get(m.source)||[],m.source,[]).filter(r=>researchDuplicateRepKey(r,m.source)===repKey).length; }catch(_){} } });
  const score=currentSourceRowCount*10 + referencedSourceRowCount*8 + nonBlankFieldCount*2 + numericFieldCount*2 + metricMatchCount*5 + dateDays.size*3 + (teamMappingFound?10:0);
  const reasons=[]; if(currentSourceRowCount) reasons.push(`${currentSourceRowCount} current-source rows`); if(referencedSourceRowCount) reasons.push(`${referencedSourceRowCount} referenced-source rows`); if(metricMatchCount) reasons.push(`${metricMatchCount} matching metric rows`); if(teamMappingFound) reasons.push('team/coach mapping found');
  return {repKey,displayName,normalizedName:normalizeResearchDuplicateRepName(displayName),score,currentSourceRowCount,referencedSourceRowCount,nonBlankFieldCount,numericFieldCount,metricMatchCount,teamMappingFound,dateCoverageDays:dateDays.size,reasons};
}
function buildResearchDuplicateRepMap(rowsBySource, researchItem, context={}){
  if(!researchItem.filterDuplicateReps) return {enabled:false,winnersByNormalizedName:new Map(),excludedRepKeys:new Set(),duplicateGroups:[]};
  const cacheKey=researchItemCacheKey(researchItem,'duplicateReps')+'|'+researchDuplicateReferencedSources(researchItem).join(','); const cached=state.researchDuplicateRepCache?.get(cacheKey); if(cached) return cached;
  const byName=new Map(), refs=context.referencedSources||researchDuplicateReferencedSources(researchItem);
  refs.forEach(src=>(rowsBySource.get(src)||[]).forEach(r=>{ const n=normalizeResearchDuplicateRepName(researchDuplicateRepNameFromRow(r)); if(!n) return; const k=researchDuplicateRepKey(r,src); if(!byName.has(n)) byName.set(n,new Set()); byName.get(n).add(k); }));
  const winnersByNormalizedName=new Map(), excludedRepKeys=new Set(), duplicateGroups=[];
  byName.forEach((keys,n)=>{ if(keys.size<2) return; const candidates=[...keys].map(k=>scoreDuplicateRepCandidate(k,rowsBySource,researchItem,{...context,referencedSources:refs})).sort((a,b)=>b.score-a.score || b.currentSourceRowCount-a.currentSourceRowCount || String(a.repKey).localeCompare(String(b.repKey))); const winner=candidates[0], excluded=candidates.slice(1); excluded.forEach(c=>excludedRepKeys.add(c.repKey)); winnersByNormalizedName.set(n,winner.repKey); duplicateGroups.push({normalizedName:n,winnerRepKey:winner.repKey,excludedRepKeys:excluded.map(c=>c.repKey),winner,excluded,reason:`Kept record with strongest linked data (${winner.reasons.join(', ')||'highest completeness score'}).`,scores:candidates}); });
  const out={enabled:true,winnersByNormalizedName,excludedRepKeys,duplicateGroups}; if(!state.researchDuplicateRepCache) state.researchDuplicateRepCache=new Map(); state.researchDuplicateRepCache.set(cacheKey,out); return out;
}
function applyDuplicateRepFilterToRows(rows, sourceKey, duplicateMap, context={}){ if(!duplicateMap?.enabled || !duplicateMap.excludedRepKeys?.size) return (rows||[]).slice(); return (rows||[]).filter(r=>!duplicateMap.excludedRepKeys.has(researchDuplicateRepKey(r,sourceKey))); }
function researchDuplicateRowsBySource(item, primaryRows){ const refs=researchDuplicateReferencedSources(item), m=new Map(); refs.forEach(src=>m.set(src, src===item.source?(primaryRows||[]).slice():researchRowsForCohort(src,primaryRows||[],item.source,{...item,filterDuplicateReps:false}))); return m; }
function researchDuplicateWarning(map){ const n=map?.excludedRepKeys?.size||0; return n?`Duplicate rep filter applied: ${n.toLocaleString()} duplicate records excluded`:''; }
function researchCohortKeys(rows,baseSource=''){
  const reps=new Set(), teams=new Set(), repTeams=new Map();
  (rows||[]).forEach(r=>{
    const rep=getRepIdentity(r,baseSource), coach=getCoachIdentity(r,baseSource);
    if(rep.normalizedName) reps.add(rep.normalizedName);
    if(coach.normalizedName) teams.add(coach.normalizedName);
    if(rep.normalizedName&&coach.normalizedName){ if(!repTeams.has(rep.normalizedName)) repTeams.set(rep.normalizedName,new Set()); repTeams.get(rep.normalizedName).add(coach.normalizedName); }
  });
  return {reps,teams,repTeams};
}
function researchAnalysisGrain(item={},rows=[]){
  if(item.analysisGrain&&item.analysisGrain!=='auto') return item.analysisGrain;
  const field=normalizeResearchText(item.groupField||'');
  if(/team|coach|manager|supervisor|leader/.test(field)) return 'teams';
  if(/rep|representative|associate|agent|person|employee|name/.test(field)) return 'representatives';
  if(item.population==='teams') return 'teams';
  if(item.population==='representatives') return 'representatives';
  const source=item.source||'', headers=getHeaders(source)||[];
  if((typeof repColumnForSource==='function'&&repColumnForSource(source))||findHeader(headers,['Representative','Rep','Agent Name','Associate Name','Employee Name'])) return 'representatives';
  const sample=(rows||[]).slice(0,50), keys=researchCohortKeys(sample,source);
  return keys.reps.size?'representatives':(keys.teams.size?'teams':'rows');
}
function researchEffectiveJoinMode(item={},rows=[]){
  const requested=item.crossSourceJoinMode||'grain';
  if(requested!=='grain') return requested;
  const grain=researchAnalysisGrain(item,rows);
  return grain==='teams'?'strict_team':'strict_rep';
}
function researchRuntimeWarnings(item){
  if(!item) return [];
  if(!Object.prototype.hasOwnProperty.call(item,'_runtimeWarnings')) Object.defineProperty(item,'_runtimeWarnings',{value:[],writable:true,configurable:true,enumerable:false});
  return item._runtimeWarnings;
}
function attachResearchRuntime(item,warnings=[]){
  try{ Object.defineProperty(item,'_runtimeWarnings',{value:warnings,writable:true,configurable:true,enumerable:false}); Object.defineProperty(item,'_joinStats',{value:{seen:new Set(),calls:0,matchedRows:0,missingReps:0,missingTeams:0,fallbackRows:0,modes:new Set(),bySource:new Map()},writable:true,configurable:true,enumerable:false}); }catch(_){}
  return item;
}
function researchJoinStatsSnapshot(item){
  const x=item?._joinStats; if(!x) return null;
  return {calls:x.calls||0,matchedRows:x.matchedRows||0,missingReps:x.missingReps||0,missingTeams:x.missingTeams||0,fallbackRows:x.fallbackRows||0,modes:[...(x.modes||[])],bySource:[...(x.bySource||new Map()).values()].map(v=>({...v,modes:[...(v.modes||[])]}))};
}
function noteResearchJoin(item,key,result){
  const x=item?._joinStats; if(!x||x.seen.has(key)) return;
  x.seen.add(key); x.calls++; x.matchedRows+=result.rows.length; x.missingReps+=result.missingRepIdentities.length; x.missingTeams+=result.missingCoachIdentities.length; x.fallbackRows+=result.fallbackRows||0; x.modes.add(result.joinMode);
  const source=result.targetSource||'unknown'; if(!x.bySource.has(source)) x.bySource.set(source,{source,calls:0,matchedRows:0,missingReps:0,missingTeams:0,fallbackRows:0,modes:new Set()}); const detail=x.bySource.get(source); detail.calls++; detail.matchedRows+=result.rows.length; detail.missingReps+=result.missingRepIdentities.length; detail.missingTeams+=result.missingCoachIdentities.length; detail.fallbackRows+=result.fallbackRows||0; detail.modes.add(result.joinMode);
}
function researchJoinSummaryHtml(diag){
  if(!diag?.calls) return '';
  const mode=(diag.modes||[]).map(m=>m==='strict_rep'?'Representative':m==='strict_team'?'Team':m==='rep_then_team'?'Rep → disclosed team fallback':m).join(', ');
  return `<div class="researchJoinHealth"><span class="badge">Cross-source join: ${esc(mode||'None')}</span><span class="badge">Matched rows: ${Number(diag.matchedRows||0).toLocaleString()}</span><span class="badge">Unmatched reps: ${Number(diag.missingReps||0).toLocaleString()}</span><span class="badge">Unmatched teams: ${Number(diag.missingTeams||0).toLocaleString()}</span>${diag.fallbackRows?`<span class="badge warn">Fallback rows: ${Number(diag.fallbackRows).toLocaleString()}</span>`:''}</div>`;
}
function researchCohortIdentityIndex(sourceKey,type){
  const idx=sourceIndex(sourceKey), rows=idx?.rows||getRowsRaw(sourceKey)||[], key='cohortIdentityV2|'+type+'|'+(idx?.version||state.dataIndex?.version||0);
  if(idx?.lazyIndexes?.has(key)) return idx.lazyIndexes.get(key);
  const map=new Map();
  const addIndexedMap=indexed=>{
    (indexed||new Map()).forEach((list,rawKey)=>{ const ident=normalizeIdentityName(rawKey); if(!ident) return; const existing=map.get(ident); if(!existing) map.set(ident,(list||[]).slice()); else { const seen=new Set(existing); (list||[]).forEach(r=>{ if(!seen.has(r)){ seen.add(r); existing.push(r); } }); } });
  };
  if(type==='rep'&&idx?.byRep?.size) addIndexedMap(idx.byRep);
  else if(type==='team'&&(idx?.byCoachKey?.size||idx?.byTeamKey?.size)){ addIndexedMap(idx.byCoachKey); addIndexedMap(idx.byTeamKey); }
  else rows.forEach(r=>{ const ident=type==='rep'?getRepIdentity(r,sourceKey).normalizedName:getCoachIdentity(r,sourceKey).normalizedName; if(ident) pushMapArray(map,ident,r); });
  if(idx?.lazyIndexes) idx.lazyIndexes.set(key,map);
  return map;
}
function resolveRowsForCohort(sourceKey, cohortContext, options = {}){
  const baseRows=cohortContext?.baseRows||cohortContext?.rows||[], baseSource=cohortContext?.baseSource||cohortContext?.source||'', item=cohortContext?.item||options.item||{};
  const targetSource=resolveDynamicResearchSource({...item,source:sourceKey}), joinMode=researchEffectiveJoinMode(item,baseRows), baseCohortSignature=researchMetricRowSignature(baseRows,baseSource);
  const dependencySignature=researchHashText(researchSourceIndexSignature(targetSource)+'//'+researchSourceIndexSignature(baseSource)), cacheKey=[dependencySignature,targetSource,baseSource,joinMode,baseCohortSignature].join('\u001f');
  state.researchCohortCache=state.researchCohortCache||new Map();
  const cached=state.researchCohortCache.get(cacheKey); if(cached){ noteResearchJoin(item,cacheKey,cached); return cached; }
  const {reps,teams,repTeams}=researchCohortKeys(baseRows,baseSource);
  const repIndex=researchCohortIdentityIndex(targetSource,'rep'), teamIndex=researchCohortIdentityIndex(targetSource,'team'), picked=new Set(), matchedRepIdentities=new Set(), matchedCoachIdentities=new Set(), missingRepIdentities=[], missingCoachIdentities=[];
  const addRows=(list,set,key)=>{ if(list?.length){ list.forEach(r=>picked.add(r)); set.add(key); return list.length; } return 0; };
  if(joinMode==='strict_rep' || joinMode==='rep_then_team'){
    reps.forEach(rep=>{ if(!addRows(repIndex.get(rep)||[],matchedRepIdentities,rep)) missingRepIdentities.push(rep); });
  }
  if(joinMode==='strict_team'){
    teams.forEach(team=>{ if(!addRows(teamIndex.get(team)||[],matchedCoachIdentities,team)) missingCoachIdentities.push(team); });
  }
  let fallbackRows=0;
  if(joinMode==='rep_then_team' && missingRepIdentities.length){
    const fallbackTeams=new Set(); missingRepIdentities.forEach(rep=>(repTeams.get(rep)||[]).forEach(t=>fallbackTeams.add(t)));
    fallbackTeams.forEach(team=>{ const list=teamIndex.get(team)||[]; if(list.length){ list.forEach(r=>picked.add(r)); matchedCoachIdentities.add(team); fallbackRows+=list.length; } else missingCoachIdentities.push(team); });
    if(fallbackRows) researchRuntimeWarnings(item).push(`Cross-source join used the disclosed team fallback for ${missingRepIdentities.length} representative(s); ${fallbackRows} team rows were included.`);
  }
  if(joinMode==='strict_rep'&&missingRepIdentities.length) researchRuntimeWarnings(item).push(`Cross-source representative join left ${missingRepIdentities.length} representative(s) unmatched; team rows were not substituted.`);
  if(joinMode==='strict_team'&&missingCoachIdentities.length) researchRuntimeWarnings(item).push(`Cross-source team join left ${missingCoachIdentities.length} team(s) unmatched.`);
  const result={rows:[...picked],targetSource,baseSource,joinMode,cohortSignature:cacheKey,fallbackRows,matchedRepIdentities:[...matchedRepIdentities],matchedCoachIdentities:[...matchedCoachIdentities],missingRepIdentities,missingCoachIdentities,warnings:[]};
  state.researchCohortRowSignatures=state.researchCohortRowSignatures||new WeakMap(); state.researchCohortRowSignatures.set(result.rows,cacheKey);
  boundedMapSet(state.researchCohortCache,cacheKey,result,600); noteResearchJoin(item,cacheKey,result); return result;
}
function researchRowsForCohort(targetSource, baseRows, baseSource, item={}){
  targetSource=resolveDynamicResearchSource({...item,source:targetSource}); baseSource=resolveDynamicResearchSource({...item,source:baseSource});
  if(!targetSource || targetSource===baseSource) return (baseRows||[]).slice();
  const resolved=resolveRowsForCohort(targetSource,{rows:baseRows,baseRows,baseSource,source:baseSource,item},{item});
  const opts={start:parseDateOnly(item.startDate),end:parseDateOnly(item.endDate),dateColumn:researchDefaultDateColumn({source:targetSource}),qaDateMode:els.runQADateSelect?.value||'interaction'};
  let filtered=filterRowsForSource(targetSource,resolved.rows,opts);
  if(item?.filterDuplicateReps){ const dm=buildResearchDuplicateRepMap(researchDuplicateRowsBySource({...item,source:baseSource},baseRows),{...item,source:baseSource},{}); filtered=applyDuplicateRepFilterToRows(filtered,targetSource,dm,{item}); }
  return filtered;
}
function researchRowsMatchingToken(source,token,item={}){
  const raw=String(token||'').trim(); if(!raw) return [];
  const idx=sourceIndex(source), rows=getResearchSourceRows(source), metric=findMetricByRef(raw) || findMetricByNameOrId(raw.replace(/^@/,'')), ref=parseModelRef(raw) || findModelCriterionReferenceByName(raw.replace(/^;/,''));
  if(metric){ const metricSource=metric.source||source; return metricRows(metric,getResearchSourceRows(metricSource),metricSource,[]); }
  if(ref) return rows.filter(r=>Number(evaluateModelReferenceValue(ref,[r],{source},'count',[]))>0);
  const cond=raw.match(/^(.*?)\s+(contains|does not contain|is not|is|greater\/equal|greater than|less\/equal|less than)\s+["']?(.+?)["']?$/i);
  if(cond){ const left=parseResearchSourceFieldRef(cond[1].trim())||parseResearchBangField(cond[1].trim()); const condSource=left?.source||source, condField=left?.field||cond[1].trim(), op=cond[2].toLowerCase(), val=cond[3]; const condRows=getResearchSourceRows(condSource).filter(r=>compareFilter(researchFieldValue(r,condField,condSource),op,val)); return condSource===source?condRows:researchRowsForCohort(source,condRows,condSource,item); }
  const field=item.groupField && !parseModelRef(item.groupField) ? item.groupField : '';
  const q=normalizeResearchText(raw.replace(/^;/,''));
  if(idx && q){ const word=researchTokenizeText(q)[0]; if(word && idx.byWord?.has(word)){ const cand=idx.byWord.get(word); return cand.filter(r=>researchMultiAddRowMatches(r,source,raw,field)); } }
  return rows.filter(r=>researchMultiAddRowMatches(r,source,raw,field));
}
function researchMultiAddRowMatches(row,source,token,field=''){
  const t=String(token||'').replace(/^;/,'').trim(); if(!t) return false;
  const q=normalizeResearchText(t), v=field?normalizeResearchText(researchFieldValue(row,field,source)):'';
  if(v && (v===q || v.includes(q))) return true;
  const idx=sourceIndex(source), full=idx?.searchText?.get(row) || normalizeResearchText((getResearchHeaders(source)||[]).map(h=>row[h]).join(' '));
  return full.includes(q);
}
function parseResearchMultiAddTerms(text){
  return splitResearchMultiAddText(text).map(raw=>{ const bang=parseResearchSourceFieldRef(raw); if(bang && !bang.missingSource){ return {raw,label:bang.rawField,source:bang.source,token:bang.rawField}; } const metric=findMetricByRef(raw) || findMetricByNameOrId(raw.replace(/^@/,'')); if(metric) return {raw,label:metric.name||raw.replace(/^@/,''),source:metric.source||'',token:'@'+(metric.name||metric.id)}; return {raw,label:raw.replace(/^;/,'').replace(/^@/,'').trim(),source:'',token:raw}; });
}
function buildResearchMultiAddGroups(item,rows,universeRows,warnings=[]){
  const configured=(item.groupAxisItems||[]).filter(x=>String(x.expression||'').trim()); const terms=configured.length?configured.map(x=>({...x,raw:x.expression,token:x.expression,label:x.label||parseResearchMultiAddTerms(x.expression)[0]?.label||x.expression,source:parseResearchMultiAddTerms(x.expression)[0]?.source||x.source||''})):parseResearchMultiAddTerms(item.groupField); const groups=new Map(), parentTotals=new Map();
  const rowSet=new Set(rows||[]), universeSet=new Set(universeRows||[]);
  const lineMultiSeries=item.outputType==='line' && !(item.useSecondaryGroup&&item.secondaryGroupField);
  const xKeyForLine=r=>{
    if(item.dateGrouping && item.dateGrouping!=='other'){
      const dateField=item.dateColumn||researchDefaultDateColumn(item);
      const bucket=researchBucketDate(researchFieldValue(r,dateField,item.source),item.dateGrouping||'daily',customSource(item.source)?.columns?.weekStart||'sunday');
      if(bucket) return bucket;
    }
    return researchGroupKey({...item,groupMultiAdd:false},r);
  };
  const addMultiRows=(seriesLabel,baseRows)=>{
    const hasSecondary=!!(item.useSecondaryGroup&&item.secondaryGroupField);
    baseRows.forEach(r=>{
      const primary=lineMultiSeries?xKeyForLine(r):seriesLabel, sec=lineMultiSeries?seriesLabel:(hasSecondary?researchSecondaryKey(item,r):''), key=sec?primary+'\u0000'+sec:primary;
      if(!groups.has(key)) groups.set(key,{primary,secondary:sec,rows:[],dateValue:researchSortDateValue(item,[r])});
      groups.get(key).rows.push(r);
      groups.get(key).dateValue=Math.min(groups.get(key).dateValue||Infinity,researchSortDateValue(item,[r])||Infinity);
    });
  };
  terms.forEach(term=>{
    const metric=findMetricByRef(term.expression||term.raw);
    if(metric){ const cfg={...researchGearDefault(),...term}, opts=buildMetricBucketOptions(metric,{item,warnings},cfg), selected=selectedMetricBucketSet(cfg,opts.buckets), counts=opts.counts; counts.entitiesByBucket.forEach((entities,bucket)=>{ const chosen=selected.has(String(bucket)); if(conditionResultIsTrue(cfg.conditionResult)?!chosen:chosen) return; const label=(term.label||metric.name||term.raw)+(cfg.metricLevel==='level2'||cfg.valueLevel==='level2'?': '+bucket:''); const baseRows=metricEntityRowsForBucket(item.source,entities,counts.entityMode,counts.coachMethod,item).filter(r=>rowSet.has(r)); const baseUniverse=metricEntityRowsForBucket(item.source,entities,counts.entityMode,counts.coachMethod,item).filter(r=>universeSet.has(r)); parentTotals.set(label,baseUniverse.length||baseRows.length||0); addMultiRows(label,baseRows); }); return; }
    const src=term.source||item.source;
    const matched=researchRowsMatchingToken(src,term.token,{...item,source:src,groupField:term.source?'':item.groupField});
    const matchedSet=new Set(matched);
    const cohort=src===item.source ? null : researchRowsForCohort(item.source,matched,src,item);
    let baseRows=src===item.source ? (rows||[]).filter(r=>matchedSet.has(r)) : cohort.filter(r=>rowSet.has(r));
    let baseUniverse=src===item.source ? (universeRows||[]).filter(r=>matchedSet.has(r)) : cohort.filter(r=>universeSet.has(r));
    if(!conditionResultIsTrue(term.conditionResult)){ baseRows=(rows||[]).filter(r=>!new Set(baseRows).has(r)); baseUniverse=(universeRows||[]).filter(r=>!new Set(baseUniverse).has(r)); }
    parentTotals.set(term.label,baseUniverse.length||baseRows.length||0);
    if(!baseRows.length && matched.length && src!==item.source) warnings.push(`${term.label}: matched rows in ${labelSource(src)}, but no tied reps/coaches were found in ${labelSource(item.source)}.`);
    addMultiRows(term.label,baseRows);
  });
  return {groups,parentTotals};
}
function researchFieldNameLooksDate(item,field){
  item=effectiveResearchItem(item||{});
  const raw=String(field||'').trim();
  if(!raw) return false;
  const ref=parseResearchSourceFieldRef(raw);
  const name=ref && !ref.missingField ? ref.field : (resolveColumn(item.source,raw)||raw);
  return headerLooksLikeDateColumn(name);
}
function researchGroupDateField(item){
  item=effectiveResearchItem(item||{});
  if(item.dateGrouping==='other') return '';
  if(item.groupField && researchFieldNameLooksDate(item,item.groupField)) return item.groupField;
  if(item.outputType==='line' && !item.groupField && item.dateColumn && researchFieldNameLooksDate(item,item.dateColumn)) return item.dateColumn;
  return '';
}
function researchGroupKey(item,r){ item=effectiveResearchItem(item||{}); const dateGroup=researchGroupDateField(item); if(dateGroup) return researchBucketDate(researchFieldValue(r,dateGroup,item.source),item.dateGrouping||'daily',customSource(item.source)?.columns?.weekStart||'sunday'); if(item.groupExpression) return String(evaluateResearchExpression(r,item.groupExpression,{source:item.source,context:'Research group expression',row:r})??'(blank)'); const metric=findMetricByRef(item.groupField); if(metric) return metric.name||metricRefName(item.groupField)||'Metric'; return String(researchFieldValue(r,item.groupField,item.source)||'(blank)')||'(blank)'; }
function researchSecondaryKey(item,r){ item=effectiveResearchItem(item||{}); if(!(item.useSecondaryGroup&&item.secondaryGroupField)) return ''; const metric=findMetricByRef(item.secondaryGroupField); if(metric){ const cfg=researchGearGetForItem(item,'secondaryGroupField'); const counts=getMetricEntityCounts(metric,{item,warnings:[]},cfg); const e=metricEntityDisplayKey(r,item.source,counts.entityMode,counts.coachMethod); return counts.bucketByEntity.get(e)||'0'; } return String(researchFieldValue(r,item.secondaryGroupField,item.source)||'(blank)'); }
function researchPanelKey(item,r){ item=effectiveResearchItem(item||{}); return item.panelField&&['line','bar','scatter','histogram','heatmap','box','pie'].includes(item.outputType)?String(researchFieldValue(r,item.panelField,item.source)||'(blank)'):''; }
function uniqueCount(rows, field, source){ return new Set(rows.map(r=>field?researchFieldValue(r,field,source):personKeyFromRow(r)).map(v=>String(v??'').trim()).filter(Boolean)).size; }
function researchRowsWithFieldValue(rows, field, source){ return (rows||[]).filter(r=>String(researchFieldValue(r,field,source)??'').trim()!==''); }
function percentBuilderPhrases(value){ const parsed=parseQuotedPhrases(String(value??'')); if(parsed.ok&&parsed.phrases?.length) return parsed.phrases.map(p=>normalizeResearchText(p)).filter(Boolean); return String(value??'').split(/[;,]/).map(p=>normalizeResearchText(p)).filter(Boolean); }
function comparePercentBuilderRuleValue(left,op,value,value2){
  op=String(op||'contains'); const phrases=percentBuilderPhrases(value), a=normalizeResearchText(left);
  if(op==='is_blank') return !String(left??'').trim(); if(op==='is_not_blank') return !!String(left??'').trim();
  if(['contains','not_contains','equals','not_equals','starts_with','ends_with'].includes(op)){
    const hits=phrases.length?phrases:['']; const any=hits.some(b=>op.includes('contains')?a.includes(b):(op.includes('equals')?a===b:(op==='starts_with'?a.startsWith(b):a.endsWith(b))));
    return op.startsWith('not_') ? !any : any;
  }
  const na=toNum(left), nb=toNum(value), nc=toNum(value2);
  if(op==='between') return Number.isFinite(na)&&Number.isFinite(nb)&&Number.isFinite(nc)&&na>=Math.min(nb,nc)&&na<=Math.max(nb,nc);
  if(op==='greater_than') return na>nb; if(op==='greater_equal') return na>=nb; if(op==='less_than') return na<nb; if(op==='less_equal') return na<=nb; if(op==='equals') return Number.isFinite(na)&&na===nb;
  const da=parseDateOnly(left), db=parseDateOnly(value), dc=parseDateOnly(value2);
  if(op==='on') return !!da&&!!db&&da.toDateString()===db.toDateString(); if(op==='before') return !!da&&!!db&&da<db; if(op==='after') return !!da&&!!db&&da>db; if(op==='between'&&da&&db&&dc) return da>=new Date(Math.min(db,dc))&&da<=new Date(Math.max(db,dc));
  return false;
}
function guidedComparableText(value,c={}){
  let text=String(value??''); if(c.normalizeSpacing!==false) text=text.trim().replace(/\s+/g,' '); if(!c.caseSensitive) text=text.toLowerCase(); return text;
}
function guidedConditionPhrases(c={}){ return parseMultiPhraseValueInput(c.value??'').map(v=>guidedComparableText(v,c)).filter(Boolean); }
function guidedConditionValueMatches(left,c={}){
  const op=c.operator||'contains'; if(op==='is_blank') return !String(left??'').trim(); if(op==='is_not_blank') return !!String(left??'').trim();
  if(['contains','not_contains','equals','not_equals'].includes(op)){
    const a=guidedComparableText(left,c), phrases=guidedConditionPhrases(c), exact=!!c.exactPhrase||op==='equals'||op==='not_equals';
    const hit=phrases.some(p=>exact?a===p:a.includes(p)); return op==='not_contains'||op==='not_equals'?!hit:hit;
  }
  if(op==='date_between'){ const d=parseDateOnly(left), a=parseDateOnly(c.value), b=parseDateOnly(c.value2); return !!d&&!!a&&!!b&&d>=new Date(Math.min(a,b))&&d<=new Date(Math.max(a,b)); }
  const n=toNum(left), a=toNum(c.value), b=toNum(c.value2); if(op==='greater_than') return n>a; if(op==='greater_equal') return n>=a; if(op==='less_than') return n<a; if(op==='less_equal') return n<=a; if(op==='between') return Number.isFinite(n)&&Number.isFinite(a)&&Number.isFinite(b)&&n>=Math.min(a,b)&&n<=Math.max(a,b);
  return false;
}
function guidedConditionTargetRows(baseRows,item,c){
  const source=c.source||item.source, rows=baseRows||[]; if(source===item.source) return rows;
  return researchRowsForCohort(source,rows,item.source,item);
}
function guidedConditionMatchesRows(baseRows,item,c){
  const source=c.source||item.source, rows=guidedConditionTargetRows(baseRows,item,c), op=c.operator||'contains';
  if(c.expression){
    const expressionItem={...item,source}, warnings=researchRuntimeWarnings(item);
    const result=evaluateResearchAggregateExpression(expressionItem,rows,c.field,{warnings});
    return guidedConditionValueMatches(result,c);
  }
  if(guidedConditionIsCount(op)){ const count=c.field?rows.filter(r=>String(researchFieldValue(r,c.field,source)??'').trim()!=='').length:rows.length, x=Math.max(0,Number(c.value)||0); return op==='appears_at_least'?count>=x:count<=x; }
  if(!rows.length) return op==='not_contains'||op==='not_equals'||op==='is_blank';
  const matches=rows.map(r=>guidedConditionValueMatches(researchFieldValue(r,c.field,source),c));
  return op==='not_contains'||op==='not_equals'?matches.every(Boolean):matches.some(Boolean);
}
function guidedConditionsMatchRows(baseRows,item){
  const conditions=(item.guidedConditions||[]).filter(guidedValidCondition); if(!conditions.length) return true; let result=guidedConditionMatchesRows(baseRows,item,conditions[0]);
  for(let i=1;i<conditions.length;i++){ const hit=guidedConditionMatchesRows(baseRows,item,conditions[i]); result=conditions[i].logic==='or'?(result||hit):(result&&hit); }
  return result;
}
function applyGuidedConditionsToRows(rows,item){
  const conditions=(item.guidedConditions||[]).filter(guidedValidCondition); if(!conditions.length) return rows||[];
  if(item.guidedSubject==='representatives'&&['show','count','compare'].includes(item.guidedQuestion)){
    const grouped=new Map(); (rows||[]).forEach(r=>{ const key=personKeyFromRow(r,item.source)||normalizeIdentityName(researchRowRepName(r,item.source)); if(!key) return; if(!grouped.has(key)) grouped.set(key,[]); grouped.get(key).push(r); });
    const qualified=new Set(); grouped.forEach((entityRows,key)=>{ if(guidedConditionsMatchRows(entityRows,item)) qualified.add(key); });
    return (rows||[]).filter(r=>qualified.has(personKeyFromRow(r,item.source)||normalizeIdentityName(researchRowRepName(r,item.source))));
  }
  return (rows||[]).filter(r=>guidedConditionsMatchRows([r],item));
}
async function applyGuidedConditionsToRowsAsync(rows,item,progress={}){
  const conditions=(item.guidedConditions||[]).filter(guidedValidCondition), input=rows||[], report=progress.report||(()=>{}), batch=Math.max(100,Number(progress.batchSize)||500);
  if(!conditions.length) return input;
  if(item.guidedSubject==='representatives'&&['show','count','compare'].includes(item.guidedQuestion)){
    const grouped=new Map();
    for(let i=0;i<input.length;i++){
      const r=input[i], key=personKeyFromRow(r,item.source)||normalizeIdentityName(researchRowRepName(r,item.source));
      if(key){ if(!grouped.has(key)) grouped.set(key,[]); grouped.get(key).push(r); }
      if((i+1)%Math.max(1000,batch*4)===0){ report(i+1,input.length,'Building the individual population'); await yieldToBrowser(); }
    }
    const entries=[...grouped.entries()], qualified=new Set();
    for(let i=0;i<entries.length;i++){
      const [key,entityRows]=entries[i];
      if(guidedConditionsMatchRows(entityRows,item)) qualified.add(key);
      if((i+1)%Math.max(25,Math.floor(batch/4))===0){ report(i+1,entries.length,'Evaluating conditions for individuals'); await yieldToBrowser(); }
    }
    const out=[];
    for(let i=0;i<input.length;i++){
      const r=input[i], key=personKeyFromRow(r,item.source)||normalizeIdentityName(researchRowRepName(r,item.source));
      if(qualified.has(key)) out.push(r);
      if((i+1)%Math.max(1000,batch*4)===0){ report(i+1,input.length,'Applying qualified individuals'); await yieldToBrowser(); }
    }
    report(entries.length,entries.length,'Individual conditions complete');
    return out;
  }
  const out=[];
  for(let i=0;i<input.length;i++){
    if(guidedConditionsMatchRows([input[i]],item)) out.push(input[i]);
    if((i+1)%batch===0){ report(i+1,input.length,'Evaluating row conditions'); await yieldToBrowser(); }
  }
  report(input.length,input.length,'Row conditions complete');
  return out;
}
function researchItemUsesGuidedPercentage(item){ return item.guidedQuestion==='percentage'||item.valueMode==='percent'||(item.columns||[]).some(c=>c.mode==='percent'); }
function applyGuidedQualificationForNonPercent(rows,item){ return (item.guidedConditions||[]).some(guidedValidCondition)&&!researchItemUsesGuidedPercentage(item)?applyGuidedConditionsToRows(rows,item):(rows||[]); }
async function applyGuidedQualificationForNonPercentAsync(rows,item,progress={}){ return (item.guidedConditions||[]).some(guidedValidCondition)&&!researchItemUsesGuidedPercentage(item)?applyGuidedConditionsToRowsAsync(rows,item,progress):(rows||[]); }
function guidedEntityEntries(rows,item,unit){
  if(unit==='unique_reps') return percentBuilderRepEntries(rows,item.source);
  const map=new Map(); (rows||[]).forEach(r=>{ const raw=unit==='unique_coaches'?(researchRowCoach(r)||researchRowTeam(r,item.source)):(researchRowTeam(r,item.source)||rowTeam(r)), key=normalizeOrgName(raw); if(!key) return; if(!map.has(key)) map.set(key,{key,name:String(raw),team:String(raw),rows:[]}); map.get(key).rows.push(r); }); return [...map.values()];
}
function percentBuilderRepEntries(rows,source){
  const m=new Map(); (rows||[]).forEach(r=>{ const key=personKeyFromRow(r,source)||normalizeIdentityName(researchRowRepName(r,source)); if(!key) return; if(!m.has(key)) m.set(key,{key,name:researchRowRepName(r,source)||key,team:researchRowTeam(r,source)||'',rows:[]}); const e=m.get(key); e.rows.push(r); if(!e.team) e.team=researchRowTeam(r,source)||''; });
  return [...m.values()];
}
function percentBuilderDateScopeSignature(item={},source=''){
  return [source,item.startDate||'',item.endDate||'',source===item.source?(item.dateColumn||''):researchDefaultDateColumn({source})].join('|');
}
function percentBuilderScopedRows(source,item={}){
  const rows=getResearchSourceRows(source)||[];
  if(!item.startDate&&!item.endDate) return rows;
  const opts={start:parseDateOnly(item.startDate),end:parseDateOnly(item.endDate),dateColumn:source===item.source?(item.dateColumn||researchDefaultDateColumn({source})):researchDefaultDateColumn({source}),qaDateMode:els.runQADateSelect?.value||'interaction'};
  return filterRowsForSource(source,rows,opts);
}
function percentBuilderSourceSignature(source){
  const rows=getRowsRaw(source)||[], headers=getHeaders(source)||[];
  return [source,rows.length,headers.length,state.dataIndex?.version||0,state.dataIndex?.lastBuiltAt||0].join('|');
}
function percentBuilderCacheGet(key,build){
  if(!state.percentBuilderCache) state.percentBuilderCache=new Map();
  if(state.percentBuilderCache.has(key)) return state.percentBuilderCache.get(key);
  const value=build();
  state.percentBuilderCache.set(key,value);
  return value;
}
function percentBuilderAddRepAlias(map,key,row){
  key=String(key||'').trim();
  if(!key) return;
  let arr=map.get(key);
  if(!arr){ arr=[]; map.set(key,arr); }
  if(arr[arr.length-1]!==row && !arr.includes(row)) arr.push(row);
}
function percentBuilderRowsByRep(source,item={}){
  const cacheKey='rowsByRep|'+percentBuilderSourceSignature(source)+'|'+percentBuilderDateScopeSignature(item,source);
  return percentBuilderCacheGet(cacheKey,()=>{
    const map=new Map();
    (percentBuilderScopedRows(source,item)||[]).forEach(r=>{
      percentBuilderAddRepAlias(map,r._repKey,r);
      percentBuilderAddRepAlias(map,personKeyFromRow(r,source),r);
      percentBuilderAddRepAlias(map,normalizeIdentityName(researchRowRepName(r,source)),r);
    });
    return map;
  });
}
function percentBuilderAllRepEntries(source,item={}){
  const cacheKey='allRepEntries|'+percentBuilderSourceSignature(source)+'|'+percentBuilderDateScopeSignature(item,source);
  return percentBuilderCacheGet(cacheKey,()=>percentBuilderRepEntries(percentBuilderScopedRows(source,item),source));
}
function percentBuilderRelatedRows(entry,source,item={}){
  const map=percentBuilderRowsByRep(source,item);
  return (map.get(entry.key)||[]).slice();
}
function percentBuilderRuleMatchesRow(row,source,pb,item,warnings=[]){
  if(pb.fromMode==='custom_expression'){ const n=evaluateResearchExpression(row,pb.expression,{source,context:'Percent Builder custom expression',row}); return comparePercentBuilderRuleValue(n,pb.operator,pb.value,pb.value2); }
  const rule=pb.rules?.[0]||{}, field=rule.field||'', ref=parseResearchSourceFieldRef(field), actualSource=ref&&!ref.missingSource?ref.source:source, actualField=ref&&!ref.missingField?ref.field:field;
  if(ref?.missingField && warnings) warnings.push(`Percent Builder missing header: ${field}`);
  return comparePercentBuilderRuleValue(researchFieldValue(row,actualField,actualSource),pb.operator||rule.operator, pb.value??rule.value, pb.value2??rule.value2);
}
function percentBuilderEntryQualifies(entry,pb,item,warnings=[]){
  const source=pb.fromMode==='custom_expression'?(item.source||pb.qualifierSource):pb.qualifierSource;
  const rel=pb.fromMode==='custom_expression'?entry.rows:percentBuilderRelatedRows(entry,source,item);
  if(pb.fromMode==='custom_expression'){
    const n=evaluateResearchExpressionInContext(pb.expression,rel,{...item,source},warnings);
    return {ok:comparePercentBuilderRuleValue(n,pb.operator,pb.value,pb.value2),count:Number.isFinite(toNum(n))?1:0,rows:rel};
  }
  const count=rel.filter(r=>percentBuilderRuleMatchesRow(r,source,pb,item,warnings)).length;
  const mb=pb.unit==='rows'?'item_matches':pb.matchBehavior;
  if(mb==='none') return {ok:count===0,count,rows:rel};
  if(mb==='count_at_least') return {ok:count>=(+pb.minMatches||0),count,rows:rel};
  if(mb==='count_exactly') return {ok:count===(+pb.minMatches||0),count,rows:rel};
  if(mb==='count_between'){ const a=+pb.minMatches||0,b=+pb.maxMatches||0; return {ok:count>=Math.min(a,b)&&count<=Math.max(a,b),count,rows:rel}; }
  return {ok:count>0,count,rows:rel};
}
function percentBuilderQualifiedRepSetKey(pb,item,source){
  return 'qualifiedRepSet|'+percentBuilderSourceSignature(source)+'|'+JSON.stringify({pb:normalizePercentBuilder(pb,item),itemSource:item.source,startDate:item.startDate,endDate:item.endDate,dateColumn:item.dateColumn});
}
function percentBuilderCountRepMatch(count,mb,pb){
  if(mb==='none') return count===0;
  if(mb==='count_at_least') return count>=(+pb.minMatches||0);
  if(mb==='count_exactly') return count===(+pb.minMatches||0);
  if(mb==='count_between'){ const a=+pb.minMatches||0,b=+pb.maxMatches||0; return count>=Math.min(a,b)&&count<=Math.max(a,b); }
  return count>0;
}
function percentBuilderRowAliasMap(rowsByRep){
  const map=new WeakMap();
  rowsByRep.forEach((rel,repKey)=>(rel||[]).forEach(r=>{ let set=map.get(r); if(!set){ set=new Set(); map.set(r,set); } set.add(repKey); }));
  return map;
}
function percentBuilderRepKeysForRow(row,source,rowAliasMap){
  const keys=new Set(rowAliasMap?.get(row)||[]);
  [row?._repKey,personKeyFromRow(row,source),normalizeIdentityName(researchRowRepName(row,source))].filter(Boolean).forEach(k=>keys.add(k));
  return keys;
}
function percentBuilderBuildQualifiedRepSet(pb,item,source,warnings=[]){
  const rowsByRep=percentBuilderRowsByRep(source,item), counts=new Map(), qualified=new Set(), mb=pb.unit==='rows'?'item_matches':pb.matchBehavior;
  const rowAliasMap=percentBuilderRowAliasMap(rowsByRep);
  rowsByRep.forEach((_rel,repKey)=>counts.set(repKey,0));
  (percentBuilderScopedRows(source,item)||[]).forEach(r=>{
    if(!percentBuilderRuleMatchesRow(r,source,pb,item,warnings)) return;
    percentBuilderRepKeysForRow(r,source,rowAliasMap).forEach(k=>counts.set(k,(counts.get(k)||0)+1));
  });
  counts.forEach((count,repKey)=>{ if(percentBuilderCountRepMatch(count,mb,pb)) qualified.add(repKey); });
  return {qualified,counts};
}
function percentBuilderQualifiedRepSet(pb,item,source,warnings=[]){
  const key=percentBuilderQualifiedRepSetKey(pb,item,source);
  return percentBuilderCacheGet(key,()=>percentBuilderBuildQualifiedRepSet(pb,item,source,warnings));
}
async function percentBuilderQualifiedRepSetAsync(pb,item,source,warnings=[],progress={}){
  if(!state.percentBuilderCache) state.percentBuilderCache=new Map();
  const key=percentBuilderQualifiedRepSetKey(pb,item,source);
  if(state.percentBuilderCache.has(key)) return state.percentBuilderCache.get(key);
  const rowsByRep=percentBuilderRowsByRep(source,item), rows=percentBuilderScopedRows(source,item), counts=new Map(), qualified=new Set(), mb=pb.unit==='rows'?'item_matches':pb.matchBehavior;
  const rowAliasMap=percentBuilderRowAliasMap(rowsByRep);
  rowsByRep.forEach((_rel,repKey)=>counts.set(repKey,0));
  const report=progress.report||(()=>{});
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    if(percentBuilderRuleMatchesRow(r,source,pb,item,warnings)){
      percentBuilderRepKeysForRow(r,source,rowAliasMap).forEach(k=>counts.set(k,(counts.get(k)||0)+1));
    }
    if((i+1)%PERCENT_BUILDER_PREP_BATCH_SIZE===0){
      report(i+1,rows.length,progress.stage||'Preparing Percent Builder matches');
      await yieldToBrowser();
    }
  }
  counts.forEach((count,repKey)=>{ if(percentBuilderCountRepMatch(count,mb,pb)) qualified.add(repKey); });
  const out={qualified,counts};
  state.percentBuilderCache.set(key,out);
  report(rows.length,rows.length,progress.stage||'Preparing Percent Builder matches');
  return out;
}
function researchPercentBuilderConfigs(item,outputColumns=[]){
  const configs=[];
  if((item.valueMode||'count')==='percent' && item.percentBuilder) configs.push(item.percentBuilder);
  (outputColumns||[]).forEach(c=>{ if((c.mode||item.valueMode)==='percent' && (c.percentBuilder||item.percentBuilder)) configs.push(c.percentBuilder||item.percentBuilder); });
  const seen=new Set();
  return configs.map(pb=>normalizePercentBuilder(pb,item)).filter(pb=>{
    if(pb.unit!=='unique_reps' || pb.fromMode==='custom_expression') return false;
    const source=pb.qualifierSource||item.source, key=percentBuilderQualifiedRepSetKey(pb,item,source);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function preparePercentBuilderCachesForResearchItem(item,outputColumns,warnings=[],report){
  const configs=researchPercentBuilderConfigs(item,outputColumns);
  for(let i=0;i<configs.length;i++){
    const pb=configs[i], source=pb.qualifierSource||item.source;
    await percentBuilderQualifiedRepSetAsync(pb,item,source,warnings,{report,stage:`Preparing Percent Builder matches ${i+1} of ${configs.length}`});
  }
}
function evaluatePercentBuilder(item,rows,col,ctx={}){
  item=effectiveResearchItem(item||{}); const warnings=ctx.warnings||[], pb=normalizePercentBuilder(col?.percentBuilder||item.percentBuilder,item), source=pb.qualifierSource||item.source, guided=(item.guidedConditions||[]).some(guidedValidCondition);
  if(!['unique_reps','unique_teams','unique_coaches'].includes(pb.unit)){
    const targetSource=pb.unit==='documented_coaching'?'documented_coaching':(pb.unit==='checklist'?'checklist':source), base=percentBuilderScopedRows(targetSource,item), scoped=targetSource===item.source?rows:researchRowsForCohort(targetSource,rows,item.source,item), conditionItem=targetSource===item.source?item:{...item,source:targetSource}, matched=guided?applyGuidedConditionsToRows(scoped,conditionItem):scoped.filter(r=>percentBuilderRuleMatchesRow(r,targetSource,pb,item,warnings));
    if(pb.unit==='numeric_total'){
      const field=item.guidedMeasureField||pb.rules?.[0]?.field||item.valueField, total=rs=>(rs||[]).reduce((sum,r)=>{ const n=evaluateResearchNumericField(r,field,source); return sum+(Number.isFinite(n)?n:0); },0), num=total(matched), den=total(pb.denominator==='all_source_rows'?base:scoped);
      ctx.percentBuilderTrace={numerator:num,denominator:den,unit:pb.unit,qualifierSource:source,denominatorType:pb.denominator}; return den?num/den*100:(pb.zeroDenominator==='blank'?null:0);
    }
    const num=matched.length, den=pb.denominator==='all_source_rows'?base.length:scoped.length;
    ctx.percentBuilderTrace={numerator:num,denominator:den,unit:pb.unit,qualifierSource:source,denominatorType:pb.denominator};
    return den?num/den*100:(pb.zeroDenominator==='blank'?null:0);
  }
  const groupEntries=guidedEntityEntries(rows,item,pb.unit), allEntries=guidedEntityEntries(percentBuilderScopedRows(item.source,item),item,pb.unit), groupTeams=new Set(groupEntries.map(e=>normalizeOrgName(e.team)).filter(Boolean));
  let denomEntries=groupEntries;
  if(pb.denominator==='coach_full_team'&&pb.unit==='unique_reps') denomEntries=allEntries.filter(e=>groupTeams.has(normalizeOrgName(e.team)));
  else if(pb.denominator==='all_reps') denomEntries=allEntries;
  let qualified;
  if(guided) qualified=denomEntries.filter(e=>guidedConditionsMatchRows(e.rows,item));
  else if(pb.unit==='unique_reps'&&pb.fromMode!=='custom_expression'){ const qualifiedSet=percentBuilderQualifiedRepSet(pb,item,source,warnings).qualified; qualified=denomEntries.filter(e=>qualifiedSet.has(e.key)); }
  else qualified=denomEntries.filter(e=>percentBuilderEntryQualifies(e,pb,item,warnings).ok);
  const den=denomEntries.length, num=qualified.length;
  ctx.percentBuilderTrace={numerator:num,denominator:den,unit:pb.unit,qualifierSource:source,denominatorType:pb.denominator,matchingReps:qualified.slice(0,50).map(e=>e.name||e.key)};
  return den?num/den*100:(pb.zeroDenominator==='blank'?null:0);
}
function evaluatePercentOf(item, rows){ const numRows=item.numeratorExpression?rows.filter(r=>!!evaluateResearchExpression(r,item.numeratorExpression,{source:item.source,context:'Numerator expression',row:r})):rows; let num=item.numeratorCount==='unique'?uniqueCount(numRows):numRows.length; let den=rows.length; if(item.denominator==='unique') den=uniqueCount(rows); if(item.denominator==='teamReps'){ const team=rows[0]?researchGroupKey(item,rows[0]):'', key=coachNameKey(team); let teamReps=(currentTeamIndex().repsByTeam?.get(team)||[]); if(!teamReps.length){ for(const [candidate,reps] of (currentTeamIndex().repsByTeam||new Map()).entries()){ if(coachNameKey(candidate)===key){ teamReps=reps; break; } } } den=teamReps.length||uniqueCount(rows); } if(item.denominator==='custom'&&item.denominatorExpression) den=rows.filter(r=>!!evaluateResearchExpression(r,item.denominatorExpression,{source:item.source,context:'Denominator expression',row:r})).length; return den?num/den*100:(item.zeroDenominator==='blank'?null:0); }
function evaluateModelCriteriaResearchValue(item, rows){ const m=findModel(item.modelId), c=(m?.criteria||[]).find(x=>x.id===item.criteriaId); if(!m) throw new Error('Missing model'); if(!c) throw new Error('Missing model/criteria'); const opts={start:parseDateOnly(item.startDate),end:parseDateOnly(item.endDate),qaDateMode:els.runQADateSelect?.value||'interaction',_sourceRowsCache:new Map(),_entryRowsCache:new Map()}; const entries=new Map(); rows.forEach(r=>{ const k=personKeyFromRow(r); if(k) entries.set(k,{kind:'rep',key:k,name:r._rep||r['Agent Name']||r['Associate Name']||k,team:r._team||r.Team||''}); }); const vals=[...entries.values()].map(e=>criterionValue(c,e,opts)).filter(Number.isFinite); if(item.modelResult==='percentage') return entries.size?vals.filter(v=>v>0).length/entries.size*100:0; if(item.modelResult==='average') return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0; return vals.filter(v=>v>0).length; }
function researchDateWithinCount(item,rows,field,compareField,days,warnings=[]){ const bounds=withinBoundsForConfig({...item,withinDays:item.withinDays||days}); return withinStatsForRows(rows,item.source,field,compareField,'date',bounds.low,bounds.high,warnings).within; }
function evaluateResearchPercentItem(item,rows,field,denominatorField,warnings=[]){
  const num=researchAggregateColumnValue(rows,item,field,'sum',warnings);
  const den=denominatorField?researchAggregateColumnValue(rows,item,denominatorField,'sum',warnings):0;
  if(!den && warnings && !warnings.includes('Percent of item denominator is zero or missing.')) warnings.push('Percent of item denominator is zero or missing.');
  return den?num/den*100:(item.zeroDenominator==='blank'?null:0);
}
function expandedResearchColumns(item){ const cols=item.outputType==='table'?(item.columns||[]):[{label:researchColumnLabel(item),field:item.valueField,mode:item.valueMode,measureId:item.measureId||researchMeasureIdFromRef(item.valueField),missingBehavior:item.missingBehavior||'missing'}]; const out=[]; cols.forEach((c,i)=>{ const cfg=researchGearGetForItem(item,'columnField:'+i); const selected=Array.isArray(cfg.selected)?cfg.selected:[]; const mref=parseModelRef(c.field); const msel=Array.isArray(cfg.modelCriteria)?cfg.modelCriteria:[]; if(mref && cfg.valueLevel==='level2' && msel.length>1){ msel.forEach(v=>out.push({...c,field:`model(${JSON.stringify(mref.model)},${JSON.stringify(v)})`,label:(c.label&&c.label!==c.field?c.label+' - '+v:`${mref.model} - ${v}`),_modelCriteriaExpanded:true})); return; } const canExpand=cfg.valueLevel==='level2' && selected.length>1 && c.field; if(canExpand) selected.forEach(v=>out.push({...c,_level2Field:c.field,_level2Value:v,label:(c.label&&c.label!==c.field?c.label+' - '+v:v)})); else out.push(c); }); return out.map(c=>({...c,label:researchColumnLabel(item,c)})); }
function aggregateResearchValue(item, rows, col, ctx={}){
  const mode=col?.mode||item.valueMode||'count', field=col?.field||item.valueField, typed=researchTypedMeasureDefinition(col?.measureId||researchMeasureIdFromRef(field)||item.measureId); if(typed) return evaluateResearchTypedMeasure(typed,rows,item,col||{},ctx); const metric=findMetricByRef(field); if(metric){ const metricSource=metric.source||item.source; const metricRows=researchRowsForCohort(metricSource,rows,item.source,item); if(metricSource!==item.source&&!metricRows.length&&item.unmatchedBehavior==='blank') return null; return evaluateResearchMetricCached(metric,metricRows,metricSource,ctx.warnings||[],{item,col}); } const modelRef=parseModelRef(field); if(modelRef){ const cfgKey=col&&item.columns?('columnField:'+Math.max(0,(item.columns||[]).indexOf(col))):''; return evaluateModelReferenceValue(modelRef,rows,item,mode,ctx.warnings||[]); } if(col?._level2Field) rows=rows.filter(r=>String(researchFieldValue(r,col._level2Field,item.source)??'(blank)')===String(col._level2Value));
  let bang=parseResearchBangField(field); const inferred=!bang?researchUniqueSourceForHeader(field,item.source):null; if(inferred && inferred.source!==item.source) bang=inferred;
  if(bang && bang.source && bang.source!==item.source){ const crossRows=researchRowsForCohort(bang.source,rows,item.source,item); if(!crossRows.length&&item.unmatchedBehavior==='blank') return null; if(mode==='count_by') return researchRowsWithFieldValue(crossRows,bang.field,bang.source).length; if(mode==='count') return crossRows.filter(r=>String(researchFieldValue(r,bang.field,bang.source)??'').trim()!=='').length; if(mode==='unique') return uniqueCount(crossRows,bang.field,bang.source); if(['sum','avg','min','max'].includes(mode)){ const vals=crossRows.map(r=>evaluateResearchNumericField(r,bang.field,bang.source)).filter(Number.isFinite); if(!vals.length) return 0; if(mode==='avg') return vals.reduce((a,b)=>a+b,0)/vals.length; if(mode==='min') return Math.min(...vals); if(mode==='max') return Math.max(...vals); return vals.reduce((a,b)=>a+b,0); } if(mode==='direct'||mode==='display') return crossRows[0]?researchFieldValue(crossRows[0],bang.field,bang.source):''; }
  if(mode==='percent') return (col?.percentBuilder||item.percentBuilder)?evaluatePercentBuilder(item,rows,col,ctx):evaluatePercentOf(item,rows);
  if(mode==='percent_item') return evaluateResearchPercentItem(item,rows,field,col?.percentOfField||item.percentOfField,ctx.warnings||[]);
  if(mode==='model') return evaluateModelCriteriaResearchValue(item,rows);
  if(mode==='count_by') return researchRowsWithFieldValue(rows,field,item.source).length;
  if(mode==='count') return rows.length;
  if(mode==='unique') return uniqueCount(rows,field,item.source);
  if(mode==='percent_total') return rows.length/(ctx.total||rows.length||1)*100;
  if(mode==='percent_parent') return rows.length/(ctx.parentTotal||ctx.total||rows.length||1)*100;
  if(['date_within','date_percent_within','value_within','value_percent_within'].includes(mode)){ const sourceCfg=col&&(col.withinCompareField||col.withinDays||col.withinRangeMin||col.withinRangeMax||col.withinUseRange!==undefined)?col:item; const bounds=withinBoundsForConfig(sourceCfg); const stats=withinStatsForRows(rows,item.source,field,col?.withinCompareField||item.withinCompareField,withinModeKind(mode),bounds.low,bounds.high,ctx.warnings); return withinModeIsPercent(mode)?stats.percent:stats.within; }
  if(mode==='expression'){ const out=evaluateResearchExpressionInContext(field,rows,item,ctx.warnings||[]); warnIfNumericText(out,ctx.warnings||[],{source:item.source,context:'Research value expression'}); return out; }
  if(mode==='direct'||mode==='display') return rows[0]?researchFieldValue(rows[0],field,item.source):'';
  const vals=rows.map(r=>evaluateResearchNumericField(r,field,item.source)).filter(Number.isFinite);
  if(!vals.length) return 0;
  if(mode==='avg') return vals.reduce((a,b)=>a+b,0)/vals.length;
  if(mode==='min') return Math.min(...vals);
  if(mode==='max') return Math.max(...vals);
  return vals.reduce((a,b)=>a+b,0);
}
function researchHashText(value){
  const text=String(value??''); let h=2166136261;
  for(let i=0;i<text.length;i++){ h^=text.charCodeAt(i); h=Math.imul(h,16777619); }
  return (h>>>0).toString(36);
}
function researchSourceCacheSignature(){
  if(state.dataIndex?.signature) return `dataV${state.versions?.data||0}:indexV${state.dataIndex.version}:sig${researchHashText(state.dataIndex.signature)}`;
  const raw=allSourceKeys().map(src=>{
    const rows=getRowsRaw(src)||[], headers=getHeaders(src)||[], cs=isCustomSource(src)?customSource(src):null;
    const fn=cs?.fileName || (src.startsWith('retail')?state.data.retail.fileName:src.startsWith('referral')?state.data.referral.fileName:(state.data[src]?.fileName||''));
    return [src,rows.length,headers.join('~'),fn].join(':');
  }).join('|');
  return 'raw:'+researchHashText(raw);
}
function researchExecutionDataSignature(item){
  const sources=researchExecutionSources(item);
  return 'used:'+researchHashText(sources.sort().map(source=>researchSourceIndexSignature(source)).join('\u001d'));
}
function researchAnalysisCacheItem(item,kind){
  const copy={...item}; ['title','cardSize','collapsed','renderedResult','textWrap','rowDensity','decimals','showPercent','showValues','showDateLabels','axisMin','axisMax','graphSort','topN','showSummaryLine','goalValue','rotateLabels','wrapLabels','showLegend','showGridlines','smoothLine','useDots','barOrientation','stackedBars','groupedBars','hideZeroGroups','highlightBest','highlightWorst','guidedDisplay'].forEach(key=>delete copy[key]);
  if(kind==='agg'&&copy.groupField&&!copy.groupMultiAdd&&['bar','line','pie','heatmap'].includes(copy.outputType)) copy.outputType='grouped_chart';
  if(kind==='agg'&&Array.isArray(copy.columns)) copy.columns=copy.columns.map(col=>{ const c={...col}; ['customTitle','displayTitle','width','formatRules','displayRules'].forEach(key=>delete c[key]); return c; });
  return copy;
}
function researchItemCacheKey(item,kind){
  const normItem=normalizeResearchItem(item); const src=resolveDynamicResearchSource(normItem); const keyItem=src&&src!==normItem.source?{...normItem,source:src,_dynamicSource:normItem.source}:normItem;
  const orgSignature=researchHashText(stableSerialize((state.orgs||[]).map(o=>({id:o.id||'',name:o.name||'',coachNames:[...(o.coachNames||[])].map(canonicalCoachName).sort()})).sort((a,b)=>String(a.id).localeCompare(String(b.id)))));
  return ['researchCacheV3',kind,researchExecutionDataSignature(keyItem),stableSerialize(researchAnalysisCacheItem(keyItem,kind)),'aliasesV'+(state.versions?.aliases||0),'teamsV'+(state.versions?.teams||0),'mappingsV'+(state.versions?.mappings||0),'metricsV'+(state.versions?.metrics||0),'modelsV'+(state.versions?.models||0),'orgsV'+orgSignature,keyItem.startDate||'',keyItem.endDate||'',keyItem.dateColumn||''].join('\u001f');
}
function loadResearchResultCache(){
  try{ state.researchPersistentCache=JSON.parse(localStorage.getItem(RESEARCH_CACHE_KEY)||'{}')||{}; }catch(_){ state.researchPersistentCache={}; }
  updateResearchCacheBadge();
}
function saveResearchResultCache(){
  try{
    const entries=Object.entries(state.researchPersistentCache||{}).sort((a,b)=>(b[1].savedAt||0)-(a[1].savedAt||0)).slice(0,RESEARCH_CACHE_LIMIT);
    localStorage.setItem(RESEARCH_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    state.researchPersistentCache=Object.fromEntries(entries);
  }catch(e){
    const entries=Object.entries(state.researchPersistentCache||{}).sort((a,b)=>(b[1].savedAt||0)-(a[1].savedAt||0)).slice(0,Math.max(5,Math.floor(RESEARCH_CACHE_LIMIT/3)));
    state.researchPersistentCache=Object.fromEntries(entries);
    try{ localStorage.setItem(RESEARCH_CACHE_KEY, JSON.stringify(state.researchPersistentCache)); }catch(_){ localStorage.removeItem(RESEARCH_CACHE_KEY); state.researchPersistentCache={}; }
  }
  updateResearchCacheBadge();
}

function selectiveResearchInvalidation(dep={}){
  state.perfCounters.selectiveInvalidations++;
  const reason=dep.reason||'selective invalidation';
  if(dep.full) return clearResearchComputedCaches(reason);
  if(dep.researchDefinitions && !dep.source && !dep.metrics && !dep.models && !dep.aliases && !dep.teams && !dep.mappings){
    console.info('[All Star Perf] research definition changed; keyed results retained',{reason});
    if(!dep.silent) updateResearchCacheBadge(); return;
  }
  state.researchResultCache=new Map();
  if(dep.source || dep.aliases || dep.teams || dep.mappings || dep.models) state.researchFilterResultCache=new Map();
  if(dep.metrics || dep.source){ state.researchMetricCache=new Map(); state.metricCache=new Map(); }
  if(dep.aliases || dep.teams || dep.mappings || dep.source){ state.researchDuplicateRepCache=new Map(); state.researchCohortCache=new Map(); }
  if(dep.source || dep.metrics || dep.aliases || dep.teams || dep.mappings) state.percentBuilderCache=new Map();
  console.info('[All Star Perf] selective invalidation',{reason,dep,versions:state.versions});
  if(!dep.silent) updateResearchCacheBadge();
}
function clearResearchComputedCaches(reason='cache cleared'){
  if(state.researchWarmToken) state.researchWarmToken.cancelled=true;
  state.researchResultCache=new Map();
  state.metricCache=new Map();
  state.researchMetricCache=new Map();
  state.researchDuplicateRepCache=new Map();
  state.researchCohortCache=new Map();
  state.researchFilterResultCache=new Map();
  state.researchCohortRowSignatures=new WeakMap(); state.researchCohortSequence=0;
  state.percentBuilderCache=new Map();
  state.researchPersistentCache={};
  state.researchCacheStats={hits:0,writes:0,warmed:0};
  try{ localStorage.removeItem(RESEARCH_CACHE_KEY); }catch(_){}
  updateResearchCacheBadge();
}
function compactResearchResultForStorage(key,out){
  if(!String(key).startsWith('researchCacheV3\u001fagg\u001f') || !Array.isArray(out.data)) return null;
  if(out.data.length>RESEARCH_PERSIST_MAX_GROUPS) return null;
  const data=out.data.map(r=>({label:r.label??'',secondary:r.secondary??'',panel:r.panel??'',values:[...(r.values||[])],xValue:r.xValue,box:r.box?{...r.box}:undefined,rows:Number(r.rows||0),dateValue:r.dateValue||0}));
  return {valueOnly:true,data,warnings:out.warnings||[],columns:out.columns||[],hasSecondary:!!out.hasSecondary,totalValues:out.totalValues||[],totalRowCount:out.totalRowCount||0,joinDiagnostics:out.joinDiagnostics||null,reconciliation:out.reconciliation||null,perf:{...(out.perf||{}),cacheUsed:true,persistent:true},savedAt:Date.now()};
}
function researchCacheGet(key){
  const v=state.researchResultCache?.get(key);
  if(v){ state.researchCacheStats.hits++; state.perfCounters.researchResultCacheHits++; const out={...v,perf:{...(v.perf||{}),timings:{...(v.perf?.timings||{})},cacheUsed:true}}; updateResearchCacheBadge(); return out; }
  const pv=state.researchPersistentCache?.[key];
  if(pv){ state.researchCacheStats.hits++; state.perfCounters.researchResultCacheHits++; const out={...pv,perf:{...(pv.perf||{}),timings:{...(pv.perf?.timings||{})},cacheUsed:true,persistent:true}}; if(!state.researchResultCache) state.researchResultCache=new Map(); boundedMapSet(state.researchResultCache,key,out,RESEARCH_CACHE_LIMIT); updateResearchCacheBadge(); return out; }
  return null;
}
function researchHasCache(key){ return !!(state.researchResultCache?.has(key) || state.researchPersistentCache?.[key]); }
function researchCacheSet(key,value,perf){
  if(!state.researchResultCache) state.researchResultCache=new Map();
  const out={...value,perf:{...(value.perf||{}),...(perf||{}),cacheUsed:false}};
  boundedMapSet(state.researchResultCache,key,out,RESEARCH_CACHE_LIMIT);
  const compact=compactResearchResultForStorage(key,out);
  if(compact){ state.researchPersistentCache[key]=compact; state.researchCacheStats.writes++; saveResearchResultCache(); }
  else updateResearchCacheBadge();
  return out;
}
function researchCacheCount(){ return (state.researchResultCache?.size||0)+Object.keys(state.researchPersistentCache||{}).length; }
function updateResearchCacheBadge(){
  if(!els?.researchCacheBadge) return;
  const prepared=dataIndexReady()?allSourceKeys().length:(state.researchSourceIndexes?.size||0), cached=researchCacheCount();
  els.researchCacheBadge.textContent=`${prepared.toLocaleString()} source${prepared===1?'':'s'} ready · ${cached} cached`;
}
async function ensureResearchDataIndexReady(opts={}){
  if(!researchHasAnyData()) return;
  if(dataIndexReady()){ updateResearchCacheBadge(); return; }
  if(opts.background) setResearchCanvasStatus('Building fast Research index in safe chunks...');
  else showProgress('Building fast Research index...', 4);
  await rebuildDataIndexAsync(opts.reason||'Building fast Research index', {start:6,end:94,chunkSize:1500});
  if(!opts.background) hideProgress();
  updateResearchCacheBadge();
}
function researchIdle(){ return new Promise(resolve=>{ if(window.requestIdleCallback) requestIdleCallback(resolve,{timeout:250}); else setTimeout(resolve,25); }); }
function scheduleResearchCacheWarm(reason='background'){
  if(state.researchWarmToken) state.researchWarmToken.cancelled=true;
  const token={cancelled:false,id:Date.now()+Math.random(),reason};
  state.researchWarmToken=token;
  setTimeout(()=>warmResearchCacheInBackground(token),60);
}
async function warmResearchCacheInBackground(token){
  if(!researchHasAnyData()) return;
  try{
    const prepared=await ensureResearchItemsExecutionIndexes(state.researchItems||[],{token});
    if(!token.cancelled) setResearchCanvasStatus(`${prepared.sources.length.toLocaleString()} source${prepared.sources.length===1?'':'s'} used by saved items prepared. Outputs still change only when you click Refresh or Render All.`);
  }catch(e){ console.warn('[Research Builder] background cache failed', e); if(!token.cancelled) setResearchCanvasStatus('Research background cache stopped. You can still render cards one at a time.'); }
  updateResearchCacheBadge();
}

function researchDefaultDateColumn(item){ item=effectiveResearchItem(item||{}); const hs=getResearchHeaders(item.source); if(item.source===DATED_SOURCE) return findHeader(hs,['Date'])||'Date'; if(item.source===NONDATED_SOURCE) return ''; if(isCustomSource(item.source)){ const c=customSource(item.source)||{}, cols=c.columns||{}; return findHeader(hs,[cols.date,cols.week,cols.month,'Date','Week','Month','Interaction Start Time','Assigned Date','Created Date'].filter(Boolean))||''; } const opts=item.source==='qa'?['Interaction Start Time','Assigned Date','Date']:checklistLikeDefaultDateHeaders(item.source); return findHeader(hs,opts)||''; }
function researchSortDateValue(item, rows){ item=effectiveResearchItem(item||{}); const idx=sourceIndex(item.source); if((rows||[]).length===1){ const ms=idx?.rowMeta?.get?.(rows[0])?.dateMs; if(Number.isFinite(ms)) return ms; } const col=item.dateColumn||researchDefaultDateColumn(item); const vals=(rows||[]).map(r=>idx?.rowMeta?.get?.(r)?.dateMs||parseDateOnly(researchFieldValue(r,col,item.source))?.getTime()).filter(Number.isFinite); return vals.length?Math.min(...vals):0; }
function researchGroupLabel(item,r){ const gcfg=researchGearGetForItem(item,'groupField'); if(gcfg.valueLevel==='level1' && item.groupField) return item.groupExpression||researchDisplayFieldLabel(item.groupField,item.groupField); if(!item.groupField&&!item.groupExpression){ const grain=researchAnalysisGrain(item,[r]); if(grain==='teams') return researchRowTeam(r,item.source)||'(blank team)'; if(grain==='representatives') return researchRowRepName(r,item.source)||'(blank representative)'; } return researchGroupKey(item,r); }
function researchGearGetForItem(item,key){ return {...researchGearDefault(),...((item.gearFilters||{})[key]||{})}; }
function researchColumnDisplayTitle(item,c){ return String(c?.customTitle||c?.displayTitle||'').trim() || researchColumnLabel(item,c); }
function researchColumnLabel(item,c){ const m=c?.mode||item.valueMode||'count'; const field=c?.field||item.valueField||'', typed=researchTypedMeasureDefinition(c?.measureId||researchMeasureIdFromRef(field)||item.measureId); if(typed) return (c?.label&&c.label!=='Value'&&c.label!==field)?c.label:typed.label; const metric=findMetricByRef(field); if(metric && (!c?.label || c.label==='Value' || c.label===field)) return metric.name; if(m==='count_by') return 'Count By'; if(m==='unique') return 'Unique Individual'; if(m==='percent_total') return '% of total'; if(m==='percent_parent') return '% of parent'; if(m==='percent_item') return 'Weighted Rate / % of item'; if(m==='percent') return 'Percent Builder'; if(m==='date_within') return 'Dates within'; if(m==='date_percent_within') return 'Dates within %'; if(m==='value_within') return 'Values within'; if(m==='value_percent_within') return 'Values within %'; return c?.label||researchDisplayFieldLabel(field,m||'Value')||m||'Value'; }
function addTeamFilterWarningsForItem(item,warnings=[]){ (item.filters||[]).filter(f=>f.type==='team_is'||f.fieldType==='team_is').forEach(f=>resolveTeamFilterSelection(f.teamInput||f.rawTeamInput||f.value||'').warnings.forEach(w=>researchExpressionAddWarning(warnings,'Team filter warning: '+w))); return warnings; }
function researchQuantile(sorted,p){
  if(!sorted.length) return 0; const pos=(sorted.length-1)*p, lo=Math.floor(pos), hi=Math.ceil(pos); return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo);
}
function buildResearchAnalysisGroups(item,rows,universeRows){
  const grain=researchAnalysisGrain(item,rows), groups=new Map(), parentTotals=new Map();
  const add=(r,i,target)=>{
    let key,label;
    if(grain==='teams'){ const x=getCoachIdentity(r,item.source); key=x.normalizedName||'(blank team)'; label=x.displayName||'(blank team)'; }
    else if(grain==='rows'){ key='row:'+String(researchRowSourceIndex(item.source,r)??i); label=researchRowRepName(r,item.source)||researchRowTeam(r,item.source)||('Row '+(i+1)); }
    else { const x=getRepIdentity(r,item.source); key=x.normalizedName||'(blank representative)'; label=x.displayName||'(blank representative)'; }
    const sec=item.useSecondaryGroup&&item.secondaryGroupField?researchSecondaryKey(item,r):'', panel=researchPanelKey(item,r);
    const mapKey=key+'\u0000'+sec+'\u0000'+panel;
    if(!target.has(mapKey)) target.set(mapKey,{primary:label,secondary:sec,panel,rows:[],dateValue:researchSortDateValue(item,[r])});
    target.get(mapKey).rows.push(r);
  };
  (universeRows||[]).forEach((r,i)=>{ let label=grain==='teams'?researchRowTeam(r,item.source):grain==='rows'?'Rows':researchRowRepName(r,item.source); parentTotals.set(label,(parentTotals.get(label)||0)+1); });
  (rows||[]).forEach((r,i)=>add(r,i,groups));
  return {groups,parentTotals};
}
function researchApplyCalculationScope(groups,item,warnings=[]){
  const limit=Math.max(0,Math.floor(Number(item.calculationGroupLimit)||0));
  if(!limit || groups.length<=limit) return groups;
  const scoped=groups.slice().sort((a,b)=>(b.rows?.length||0)-(a.rows?.length||0)||String(a.primary||'').localeCompare(String(b.primary||''))||String(a.secondary||'').localeCompare(String(b.secondary||''))).slice(0,limit);
  warnings.push(`Calculation scope limited to the ${limit.toLocaleString()} largest groups before measure evaluation; ${Math.max(0,groups.length-limit).toLocaleString()} smaller groups were not calculated.`);
  return scoped;
}
function researchApplyUnmatchedGroupBehavior(groups,item,warnings=[]){
  if(item.unmatchedBehavior!=='exclude') return groups;
  const targets=researchExecutionSources(item).filter(source=>source!==item.source); if(!targets.length) return groups;
  const kept=groups.filter(group=>targets.every(source=>researchRowsForCohort(source,group.rows||[],item.source,item).length>0));
  if(kept.length<groups.length) warnings.push(`${(groups.length-kept.length).toLocaleString()} group${groups.length-kept.length===1?' was':'s were'} excluded because a required cross-source join had no match.`);
  return kept;
}
function researchBoundedTopN(data,limit,compare){
  limit=Math.max(0,Math.floor(Number(limit)||0)); if(!limit||data.length<=limit) return data.slice().sort(compare);
  const heap=[], worse=(a,b)=>compare(a,b)>0;
  const down=i=>{ for(;;){ let worst=i,l=i*2+1,r=l+1; if(l<heap.length&&worse(heap[l],heap[worst])) worst=l; if(r<heap.length&&worse(heap[r],heap[worst])) worst=r; if(worst===i) break; [heap[i],heap[worst]]=[heap[worst],heap[i]]; i=worst; } };
  const up=i=>{ while(i){ const p=(i-1)>>1; if(!worse(heap[i],heap[p])) break; [heap[i],heap[p]]=[heap[p],heap[i]]; i=p; } };
  data.forEach(value=>{ if(heap.length<limit){ heap.push(value); up(heap.length-1); } else if(compare(value,heap[0])<0){ heap[0]=value; down(0); } });
  return heap.sort(compare);
}
function researchSortAndLimitData(data,item,hasSecondary){
  const sort=item.sort||'default', limit=Math.max(0,Math.floor(Number(item.rowLimit)||0)); let compare=null;
  if(hasSecondary&&sort==='default') compare=(a,b)=>String(a.label).localeCompare(String(b.label))||String(a.secondary).localeCompare(String(b.secondary))||String(a.panel||'').localeCompare(String(b.panel||''));
  else if(sort==='xAsc') compare=(a,b)=>(String(a.label)+String(a.secondary)).localeCompare(String(b.label)+String(b.secondary));
  else if(sort==='xDesc') compare=(a,b)=>(String(b.label)+String(b.secondary)).localeCompare(String(a.label)+String(a.secondary));
  else if(sort==='yAsc') compare=(a,b)=>(+a.values[0]||0)-(+b.values[0]||0);
  else if(sort==='yDesc') compare=(a,b)=>(+b.values[0]||0)-(+a.values[0]||0);
  else if(sort==='dateAsc') compare=(a,b)=>(a.dateValue||0)-(b.dateValue||0);
  else if(sort==='dateDesc') compare=(a,b)=>(b.dateValue||0)-(a.dateValue||0);
  if(!compare) return limit?data.slice(0,limit):data;
  return limit?researchBoundedTopN(data,limit,compare):data.sort(compare);
}
function buildResearchHistogramGroups(item,rows,universeRows,warnings=[]){
  const field=item.valueField||item.groupField, pairs=(rows||[]).map(r=>({r,n:evaluateResearchNumericField(r,field,item.source)})).filter(x=>Number.isFinite(x.n)), groups=new Map(), parentTotals=new Map();
  if(!pairs.length){ warnings.push('Histogram requires a numeric value field.'); return {groups,parentTotals}; }
  const values=pairs.map(x=>x.n), min=Math.min(...values), max=Math.max(...values), auto=(max-min)/Math.max(1,Math.min(20,Math.ceil(Math.sqrt(values.length)))), size=Number(item.bucketSize)>0?Number(item.bucketSize):(auto||1), origin=Math.floor(min/size)*size;
  pairs.forEach(({r,n})=>{ const index=Math.floor((n-origin)/size), low=origin+index*size, high=low+size, label=`${Number(low.toFixed(6))} – ${Number(high.toFixed(6))}`; if(!groups.has(label)) groups.set(label,{primary:label,secondary:'',rows:[],dateValue:low,binLow:low,binHigh:high}); groups.get(label).rows.push(r); });
  [...groups.values()].sort((a,b)=>a.binLow-b.binLow).forEach(g=>parentTotals.set(g.primary,g.rows.length));
  return {groups:new Map([...groups.entries()].sort((a,b)=>a[1].binLow-b[1].binLow)),parentTotals};
}
function researchGroupOutput(item,g,outputColumns,ctx){
  if(item.outputType==='table') return {values:outputColumns.map(c=>aggregateResearchValue(item,g.rows,c,ctx))};
  if(item.outputType==='histogram') return {values:[g.rows.length]};
  if(item.outputType==='scatter'){
    const x=researchAggregateColumnValue(g.rows,item,item.groupField,'avg',ctx.warnings||[]), y=aggregateResearchValue(item,g.rows,null,ctx);
    return {values:[y],xValue:x};
  }
  if(item.outputType==='box'){
    const nums=g.rows.map(r=>evaluateResearchNumericField(r,item.valueField,item.source)).filter(Number.isFinite).sort((a,b)=>a-b);
    const box=nums.length?{min:nums[0],q1:researchQuantile(nums,.25),median:researchQuantile(nums,.5),q3:researchQuantile(nums,.75),max:nums[nums.length-1],count:nums.length}:{min:0,q1:0,median:0,q3:0,max:0,count:0};
    return {values:[box.median],box};
  }
  return {values:[aggregateResearchValue(item,g.rows,null,ctx)]};
}
function researchReconciliationResult(item,universeRows,outputColumns,groupList,warnings=[]){
  if(!item.reconcile) return null;
  const columns=(outputColumns||[]).map((col,index)=>{
    const field=col?.field||item.valueField, mode=col?.mode||item.valueMode||'count', typed=researchTypedMeasureDefinition(col?.measureId||researchMeasureIdFromRef(field)||item.measureId), resolved=resolveResearchTypedMeasure(typed,item.source);
    const direct=aggregateResearchValue(item,universeRows,col,{total:universeRows.length||1,parentTotal:universeRows.length||1,warnings});
    let rolled=null, method='', comparable=false;
    if(typed&&resolved?.aggregation==='weighted_rate'){
      const parts=(groupList||[]).map(g=>researchTypedMeasureStats(resolved,g.rows,item,col?.missingBehavior||item.missingBehavior));
      const numerator=parts.reduce((sum,x)=>sum+(Number(x.numerator)||0),0), denominator=parts.reduce((sum,x)=>sum+(Number(x.denominator)||0),0);
      rolled=denominator?numerator/denominator*100:(item.zeroDenominator==='blank'?null:0); method='group numerators ÷ group denominators'; comparable=true;
    }else if((typed&&['count','sum'].includes(resolved?.aggregation)) || (!typed&&['count','count_by','sum'].includes(mode))){
      rolled=(groupList||[]).reduce((sum,g)=>sum+(Number(aggregateResearchValue(item,g.rows,col,{total:universeRows.length||1,parentTotal:g.rows.length||1,warnings}))||0),0); method='sum of calculated groups'; comparable=true;
    }else method='non-additive measure; independent total shown';
    const difference=comparable&&Number.isFinite(Number(direct))&&Number.isFinite(Number(rolled))?Number(rolled)-Number(direct):null;
    return {index,label:researchColumnLabel(item,col||{}),direct,rolled,method,comparable,difference,ok:difference==null||Math.abs(difference)<1e-8};
  });
  return {enabled:true,columns,sourceRows:universeRows.length,calculatedGroups:(groupList||[]).length,ok:columns.every(c=>c.ok)};
}
function researchReconciliationHtml(reconciliation){
  if(!reconciliation?.enabled) return '';
  return `<details class="researchReconciliation ${reconciliation.ok?'good':'warn'}"><summary>Reconciliation · ${reconciliation.ok?'passed':'review differences'}</summary><div class="researchTableWrap"><table><thead><tr><th>Measure</th><th>Independent overall</th><th>Grouped roll-up</th><th>Difference</th><th>Method</th></tr></thead><tbody>${reconciliation.columns.map(c=>`<tr><td>${esc(c.label)}</td><td>${esc(c.direct==null?'blank':Number.isFinite(Number(c.direct))?Number(c.direct).toLocaleString(undefined,{maximumFractionDigits:6}):c.direct)}</td><td>${esc(c.rolled==null?(c.comparable?'blank':'not additive'):Number(c.rolled).toLocaleString(undefined,{maximumFractionDigits:6}))}</td><td class="${c.ok?'good':'warn'}">${c.difference==null?'—':esc(Number(c.difference).toLocaleString(undefined,{maximumFractionDigits:8}))}</td><td>${esc(c.method)}</td></tr>`).join('')}</tbody></table></div><div class="hint">${reconciliation.sourceRows.toLocaleString()} independently scoped rows · ${reconciliation.calculatedGroups.toLocaleString()} calculated groups.</div></details>`;
}
function recordResearchPerformance(item,perf={}){
  const run={itemId:item?.id||'',title:item?.title||'Research item',at:Date.now(),...perf,timings:{...(perf.timings||{})}};
  state.researchPerformanceRuns=Array.isArray(state.researchPerformanceRuns)?state.researchPerformanceRuns:[];
  state.researchPerformanceRuns.unshift(run); state.researchPerformanceRuns=state.researchPerformanceRuns.slice(0,30);
  renderResearchDiagnosticsDrawer();
  return run;
}
function researchTimingCardsHtml(perf={}){
  const labels={sourcePreparationMs:'Source preparation',queryPlanMs:'Query plan',cohortFilterMs:'Cohort/filtering',groupingMs:'Grouping',calculationMs:'Measures',sortingMs:'Sorting',renderMs:'Rendering',persistenceMs:'Persistence',workerMs:'Worker'};
  const values={sourcePreparationMs:perf.sourcePreparationMs,...(perf.timings||{})};
  return Object.entries(labels).filter(([key])=>Number.isFinite(Number(values[key]))).map(([key,label])=>`<div class="researchTimingCard"><span>${esc(label)}</span><strong>${Number(values[key]).toLocaleString()} ms</strong></div>`).join('');
}
function attachResearchPreparationPerf(perf={},item={}){
  const prep=state.researchLastPreparation?.itemId===item.id?state.researchLastPreparation:null;
  const fallback=researchExecutionSources(item).map(source=>({source,rows:(getRowsRaw(source)||[]).length,reused:!!sourceIndex(source),prepareMs:0}));
  perf.sourcePreparationMs=prep?.totalMs??perf.sourcePreparationMs??0;
  perf.preparedSources=prep?.sources||perf.preparedSources||fallback.map(x=>x.source);
  perf.sourceDetails=prep?.sourceDetails||perf.sourceDetails||fallback;
  perf.totalSourceRows=prep?.totalRows||perf.totalSourceRows||perf.sourceDetails.reduce((n,x)=>n+(Number(x.rows)||0),0);
  return perf;
}
function researchSourceUsageLabels(item,source){
  const labels=[], add=label=>{ if(label&&!labels.includes(label)) labels.push(label); }, primary=resolveDynamicResearchSource(item);
  if(source===primary) add('Primary population');
  if((item.guidedEvidenceSources||[]).includes(source)) add('Selected evidence');
  (item.guidedConditions||[]).forEach(c=>{ if(c.source===source) add(c.expression?'Condition cohort':'Condition column'); if(researchFieldReferencedSources(c.field,c.source||primary).includes(source)) add(c.expression?'Condition expression':'Condition reference'); });
  [item.groupField,item.groupExpression,item.valueField,item.percentOfField,item.numeratorExpression,item.denominatorExpression,item.withinCompareField,...(item.columns||[]).flatMap(c=>[c.field,c.percentOfField,c.withinCompareField])].filter(Boolean).forEach(field=>{ if(researchFieldReferencedSources(field,primary).includes(source)) add('Calculation or breakdown'); });
  (item.filters||[]).forEach(f=>{ if(f.targetSource===source||researchFieldReferencedSources(f.field,primary).includes(source)||researchFieldReferencedSources(f.value,primary).includes(source)) add('Population filter'); });
  if(!labels.length) add('Referenced analytical source');
  return labels;
}
function researchSourceAuditHtml(item,perf={},joinDiagnostics=null){
  attachResearchPreparationPerf(perf,item);
  const details=perf.sourceDetails||[], plan=perf.queryPlan||{}, joinBy=new Map((joinDiagnostics?.bySource||[]).map(x=>[x.source,x]));
  if(!details.length) return '';
  const primary=resolveDynamicResearchSource(item), candidate=Number(plan.candidateRows??plan.finalRows??0), initial=Number(plan.initialRows||((getRowsRaw(primary)||[]).length)), total=Number(perf.totalSourceRows||details.reduce((n,x)=>n+(Number(x.rows)||0),0)), rosterRows=(controlRosterRows()||[]).length, mappedReps=state.repTeams instanceof Map?state.repTeams.size:Object.keys(state.repTeams||{}).length;
  let cards=details.map(detail=>{ const joined=joinBy.get(detail.source), isPrimary=detail.source===primary, roles=researchSourceUsageLabels(item,detail.source), line=isPrimary?`${candidate.toLocaleString()} candidate rows after population/date filters`:joined?`${Number(joined.matchedRows||0).toLocaleString()} cohort rows returned across ${Number(joined.calls||0).toLocaleString()} join${joined.calls===1?'':'s'}`:'Referenced source; no cross-source cohort rows were required'; return `<div class="researchJoinPreviewCard"><strong>${esc(labelSource(detail.source)||detail.source)}</strong><span>${Number(detail.rows||0).toLocaleString()} imported rows</span><br><span class="hint">${esc(roles.join(' · '))}</span><br><span class="${isPrimary||joined?.matchedRows?'good':''}">${esc(line)}</span><br><span class="hint">${detail.reused?'Prepared index reused':'Index prepared for this run'}${Number(detail.prepareMs)>0?` · ${Number(detail.prepareMs).toLocaleString()} ms`:''}</span></div>`; }).join('');
  if(rosterRows||mappedReps) cards+=`<div class="researchJoinPreviewCard"><strong>Roster & identity support</strong><span>${rosterRows.toLocaleString()} control-roster rows · ${mappedReps.toLocaleString()} representative/team mappings</span><br><span class="hint">Used only to connect people to coaches/teams; not included in the analytical row total.</span></div>`;
  return `<div class="researchJoinPreview"><strong>Data reviewed for this result</strong><div class="researchPreviewSummary"><span class="badge">${details.length.toLocaleString()} analytical source${details.length===1?'':'s'}</span><span class="badge">${total.toLocaleString()} analytical rows across used sources</span>${rosterRows?`<span class="badge">${rosterRows.toLocaleString()} roster rows for identity matching</span>`:''}<span class="badge">Primary reduced: ${initial.toLocaleString()} → ${candidate.toLocaleString()}</span></div><div class="researchJoinPreviewGrid">${cards}</div></div>`;
}
function researchPerformanceHtml(item,perf={},reconciliation=null){
  const cards=researchTimingCardsHtml(perf), plan=perf.queryPlan||{};
  const rowsScanned=plan.cacheHit?0:Number(plan.rowsScanned??perf.rowsScanned??plan.initialRows??0), indexes=[...new Set([...(plan.indexesUsed||[]),...(perf.indexesUsed||[])])];
  return `<details class="researchDiagnostics"><summary>Execution diagnostics${perf.cacheUsed?' · cached':''}</summary><div class="researchTimingGrid">${cards||'<div class="researchTimingCard"><span>Total calculation</span><strong>'+Number(perf.totalComputeMs||0).toLocaleString()+' ms</strong></div>'}</div><div class="researchPreviewSummary"><span class="badge">Source rows: ${Number(plan.initialRows||0).toLocaleString()}</span><span class="badge">Candidates: ${Number(plan.candidateRows??plan.finalRows??0).toLocaleString()}</span><span class="badge">Rows actually scanned: ${rowsScanned.toLocaleString()}</span><span class="badge">Filter cache: ${plan.cacheHit?'hit':'miss'}</span><span class="badge">Groups: ${Number(perf.groupsCalculated||0).toLocaleString()}</span><span class="badge">Expression evaluations: ${Number(perf.expressionEvaluations??state.expressionStats?.evaluated??0).toLocaleString()}</span><span class="badge">Renderer: ${esc(perf.renderer||'automatic')}</span></div>${indexes.length?`<div class="hint">Indexes used: ${indexes.map(esc).join(' · ')}</div>`:''}${perf.preparedSources?.length?`<div class="hint">Prepared sources: ${perf.preparedSources.map(s=>esc(labelSource(s)||s)).join(', ')}</div>`:''}</details>${researchReconciliationHtml(reconciliation)}`;
}
function renderResearchDiagnosticsDrawer(){
  if(!els?.researchDiagnosticsBody) return;
  const runs=state.researchPerformanceRuns||[];
  els.researchDiagnosticsBody.innerHTML=runs.length?runs.slice(0,10).map(run=>`<div class="researchDiagnosticsRun"><strong>${esc(run.title)}</strong><span class="hint">${new Date(run.at).toLocaleTimeString()} · ${Number(run.totalComputeMs||0).toLocaleString()} ms${run.cacheUsed?' · cached':''}</span><div class="researchTimingGrid">${researchTimingCardsHtml(run)}</div></div>`).join(''):'Run or refresh a Research item to see source preparation, cohort filtering, joining, grouping, calculation, sorting, rendering, and persistence timings.';
}

function evaluateResearchRawRows(item){ item=effectiveResearchItem(normalizeResearchItem(item)); const cacheKey=researchItemCacheKey(item,'raw'), cached=researchCacheGet(cacheKey); if(cached) return cached; const t0=performance.now(), perf={rowsScanned:0,indexesUsed:[],filters:[],cacheUsed:false,timings:{}}; const warnings=[]; perf.warnings=warnings; attachResearchRuntime(item,warnings); let planned=buildQueryPlan(item.source,{dateColumn:item.dateColumn,startDate:item.startDate,endDate:item.endDate,filters:item.filters||[],item,groupFields:[item.groupField,item.secondaryGroupField,item.panelField],valueFields:[...(item.columns||[]).flatMap(c=>[c.field,c.percentOfField,c.withinCompareField]).filter(Boolean)],customExpressions:[item.groupExpression,item.valueField,item.percentOfField]}); let rows=planned.rows; perf.queryPlan=planned.plan; perf.rowsScanned=planned.plan.initialRows||0; perf.indexesUsed.push(...(planned.plan.steps||[]).filter(s=>s.usedIndex).map(s=>s.name)); if(!rows.length && !getRowsRaw(item.source).length) warnings.push('No imported rows for selected source.'); addTeamFilterWarningsForItem(item,warnings); const hs=getResearchHeaders(item.source); if(item.dateColumn && researchFieldNeedsHeaderWarning(item,item.dateColumn)) warnings.push('Missing header: '+item.dateColumn); rows=applyResearchGearRowFilters(rows,item,warnings); const duplicateMap=buildResearchDuplicateRepMap(researchDuplicateRowsBySource(item,rows),item,{warnings}); rows=applyDuplicateRepFilterToRows(rows,item.source,duplicateMap,{item}); rows=applyGuidedQualificationForNonPercent(rows,item); const dupWarn=researchDuplicateWarning(duplicateMap); if(dupWarn) warnings.push(dupWarn); const cols=(item.columns||[]).filter(c=>c.field).map(c=>({label:c.label||c.field,field:c.field})); const displayCols=cols.length?cols:hs.slice(0,8).map(h=>({label:h,field:h})); const sort=item.sort||'default'; if(sort==='xAsc') rows.sort((a,b)=>String(a[displayCols[0]?.field]??'').localeCompare(String(b[displayCols[0]?.field]??''))); if(sort==='xDesc') rows.sort((a,b)=>String(b[displayCols[0]?.field]??'').localeCompare(String(a[displayCols[0]?.field]??''))); if(sort==='dateAsc'||sort==='dateDesc'){ const col=item.dateColumn||researchDefaultDateColumn(item); rows.sort((a,b)=>((parseDateOnly(researchFieldValue(a,col,item.source))?.getTime()||0)-(parseDateOnly(researchFieldValue(b,col,item.source))?.getTime()||0))*(sort==='dateDesc'?-1:1)); } if(item.rowLimit) rows=rows.slice(0,item.rowLimit); const prep=state.researchLastPreparation?.itemId===item.id?state.researchLastPreparation:null; perf.sourcePreparationMs=prep?.totalMs||0; perf.preparedSources=prep?.sources||[]; perf.totalComputeMs=Math.round(performance.now()-t0); perf.timings.queryPlanMs=perf.totalComputeMs; console.info('[Research Builder]',perf); return researchCacheSet(cacheKey,{rows,warnings,columns:displayCols,duplicateMap},perf); }
function evaluateResearchItem(item){
  item=effectiveResearchItem(normalizeResearchItem(item));
  const cacheKey=researchItemCacheKey(item,'agg'), cached=researchCacheGet(cacheKey); if(cached) return cached; const t0=performance.now(), perf={rowsScanned:0,indexesUsed:[],filters:[],cacheUsed:false,timings:{}};
  const warnings=[]; perf.warnings=warnings; attachResearchRuntime(item,warnings); let planned=buildQueryPlan(item.source,{dateColumn:item.dateColumn,startDate:item.startDate,endDate:item.endDate,filters:item.filters||[],item,groupFields:[item.groupField,item.secondaryGroupField,item.panelField],valueFields:[item.valueField,item.percentOfField,item.withinCompareField,...(item.columns||[]).flatMap(c=>[c.field,c.percentOfField,c.withinCompareField])].filter(Boolean),customExpressions:[item.groupExpression,item.numeratorExpression,item.denominatorExpression,item.percentOfField]}); let rows=planned.rows; perf.queryPlan=planned.plan; perf.rowsScanned=planned.plan.initialRows||0; perf.timings.queryPlanMs=Math.round(performance.now()-t0); const cohortStart=performance.now(); perf.indexesUsed.push(...(planned.plan.steps||[]).filter(s=>s.usedIndex).map(s=>s.name)); if(!rows.length && !getRowsRaw(item.source).length) warnings.push('No imported rows for selected source.'); addTeamFilterWarningsForItem(item,warnings); const hs=getResearchHeaders(item.source);
  [item.dateColumn,item.groupField,item.secondaryGroupField,item.panelField].filter(Boolean).forEach(h=>{ if(researchFieldNeedsHeaderWarning(item,h)) warnings.push('Missing header: '+h); });
  let universeRows=rows.slice();
  rows=applyResearchGearRowFilters(rows,item,warnings);
  const duplicateMap=buildResearchDuplicateRepMap(researchDuplicateRowsBySource(item,rows),item,{warnings});
  rows=applyDuplicateRepFilterToRows(rows,item.source,duplicateMap,{item});
  universeRows=applyDuplicateRepFilterToRows(universeRows,item.source,duplicateMap,{item});
  if(!researchItemUsesGuidedPercentage(item)){
    rows=applyGuidedQualificationForNonPercent(rows,item);
    universeRows=applyGuidedQualificationForNonPercent(universeRows,item);
  }
  const dupWarn=researchDuplicateWarning(duplicateMap); if(dupWarn) warnings.push(dupWarn);
  const mode=item.valueMode||'count'; if(['date_within','date_percent_within'].includes(mode) && !researchFieldLooksDate(item,item.valueField,rows)) warnings.push('This dates-within mode requires a date field.'); (item.columns||[]).forEach(c=>{ if(['date_within','date_percent_within'].includes(c.mode) && !researchFieldLooksDate(item,c.field,rows) && !warnings.includes('This dates-within mode requires a date field.')) warnings.push('This dates-within mode requires a date field.'); }); if(['sum','avg','min','max','value_within','value_percent_within'].includes(mode)){ const val=researchNumericValidation(item,item.valueField,rows); if(!val.ok) warnings.push(val.message); }
  perf.timings.cohortFilterMs=Math.round(performance.now()-cohortStart); const groupingStart=performance.now();
  const hasSecondary=!!(item.useSecondaryGroup&&item.secondaryGroupField);
  let groups=new Map(), parentTotals=new Map();
  const groupMetric=!item.groupMultiAdd ? findMetricByRef(item.groupField) : null;
  if(item.outputType==='histogram'){
    const built=buildResearchHistogramGroups(item,rows,universeRows,warnings); groups=built.groups; parentTotals=built.parentTotals;
  }else if(item.outputType==='scatter'){
    const built=buildResearchAnalysisGroups(item,rows,universeRows); groups=built.groups; parentTotals=built.parentTotals;
  }else if(item.groupMultiAdd){
    const built=buildResearchMultiAddGroups(item,rows,universeRows,warnings); groups=built.groups; parentTotals=built.parentTotals;
  }else if(groupMetric){
    const cfg=researchGearGetForItem(item,'groupField');
    const counts=getMetricEntityCounts(groupMetric,{item,warnings},cfg);
    const bucketOpts=buildMetricBucketOptions(groupMetric,{item,warnings},cfg), selectedBuckets=selectedMetricBucketSet(cfg,bucketOpts.buckets), rowSet=new Set(rows), universeSet=new Set(universeRows);
    counts.entitiesByBucket.forEach((entities,bucket)=>{
      const bucketSelected=selectedBuckets.has(String(bucket)); if(!conditionResultIsTrue(cfg.conditionResult) ? bucketSelected : !bucketSelected) return;
      const bucketRows=metricEntityRowsForBucket(item.source,entities,counts.entityMode,counts.coachMethod,item).filter(r=>rowSet.has(r));
      const bucketUniverse=metricEntityRowsForBucket(item.source,entities,counts.entityMode,counts.coachMethod,item).filter(r=>universeSet.has(r));
      parentTotals.set(bucket,bucketUniverse.length||bucketRows.length||0);
      bucketRows.forEach(r=>{ const sec=hasSecondary?researchSecondaryKey(item,r):'', panel=researchPanelKey(item,r), key=bucket+'\u0000'+sec+'\u0000'+panel; if(!groups.has(key)) groups.set(key,{primary:bucket,secondary:sec,panel,rows:[],dateValue:researchSortDateValue(item,[r])}); groups.get(key).rows.push(r); groups.get(key).dateValue=Math.min(groups.get(key).dateValue||Infinity,researchSortDateValue(item,[r])||Infinity); });
    });
  }else{
    universeRows.forEach(r=>{ const p=researchGroupLabel(item,r); parentTotals.set(p,(parentTotals.get(p)||0)+1); });
    rows.forEach(r=>{ const p=researchGroupLabel(item,r), sec=hasSecondary?researchSecondaryKey(item,r):'', panel=researchPanelKey(item,r), key=p+'\u0000'+sec+'\u0000'+panel; if(!groups.has(key)) groups.set(key,{primary:p,secondary:sec,panel,rows:[],dateValue:researchSortDateValue(item,[r])}); groups.get(key).rows.push(r); groups.get(key).dateValue=Math.min(groups.get(key).dateValue||Infinity,researchSortDateValue(item,[r])||Infinity); });
  }
  perf.timings.groupingMs=Math.round(performance.now()-groupingStart); const calculationStart=performance.now();
  const total=universeRows.length||1;
  let groupList=[...groups.values()].filter(g=>Object.keys(item.gearFilters||{}).every(key=>{ const cfg={...researchGearDefault(),...(item.gearFilters||{})[key]}; if(key.startsWith('columnField:') && cfg.valueLevel==='level2') return true; if(!cfg.customValueEnabled||cfg.customValueMetric==='each') return true; const field=researchGearFieldForKey(item,key,+(key.split(':')[1]||0)); if(!field) return true; const bad=researchGearNumericInvalid(cfg,item,field,g.rows); if(bad){ if(!warnings.includes(bad)) warnings.push(bad); return true; } return researchGearGroupPass(g.rows,cfg,item,field); }));
  groupList=researchApplyCalculationScope(groupList,item,warnings); groupList=researchApplyUnmatchedGroupBehavior(groupList,item,warnings);
  const outputColumns=expandedResearchColumns(item); let data=groupList.map(g=>{ const ctx={total,parentTotal:(parentTotals.get(g.primary)||g.rows.length||1),warnings}, computed=researchGroupOutput(item,g,outputColumns,ctx); return {label:g.primary,secondary:g.secondary,panel:g.panel||'',values:computed.values,xValue:computed.xValue,box:computed.box,rows:g.rows.length,dateValue:Number.isFinite(g.dateValue)?g.dateValue:researchSortDateValue(item,g.rows)}; });
  if(item.outputType==='table') data=data.filter(d=>outputColumns.every((c,i)=>{ const v=toNum(d.values?.[i]), hasMin=String(c.resultMin??'').trim()!=='', hasMax=String(c.resultMax??'').trim()!==''; if(hasMin&&(!Number.isFinite(v)||v<Number(c.resultMin))) return false; if(hasMax&&(!Number.isFinite(v)||v>Number(c.resultMax))) return false; return true; }));
  perf.timings.calculationMs=Math.round(performance.now()-calculationStart); const sortingStart=performance.now();
  data=researchSortAndLimitData(data,item,hasSecondary); perf.timings.sortingMs=Math.round(performance.now()-sortingStart);
  const totalValues=(item.outputType==='table'&&item.totals)?outputColumns.map(c=>aggregateResearchValue(item,universeRows,c,{total:universeRows.length||1,parentTotal:universeRows.length||1,warnings})):[];
  const effectiveHasSecondary=hasSecondary || (item.outputType==='line' && item.groupMultiAdd);
  const reconciliation=researchReconciliationResult(item,universeRows,outputColumns,groupList,warnings), prep=state.researchLastPreparation?.itemId===item.id?state.researchLastPreparation:null; perf.groupsCalculated=groupList.length; perf.sourcePreparationMs=prep?.totalMs||0; perf.preparedSources=prep?.sources||[]; perf.totalComputeMs=Math.round(performance.now()-t0); console.info('[Research Builder]',perf); return researchCacheSet(cacheKey,{valueOnly:true,data,warnings,columns:outputColumns,hasSecondary:effectiveHasSecondary,totalValues,totalRowCount:universeRows.length,duplicateMap,joinDiagnostics:researchJoinStatsSnapshot(item),reconciliation},perf);
}

function researchRowSourceIndex(source,row){ const building=state.researchBuildingRowMeta?.get?.(row); if(Number.isInteger(building?.rowId)&&(!source||building.source===source)) return building.rowId; const idx=sourceIndex(source), meta=idx?.rowMeta?.get?.(row); if(Number.isInteger(meta?.rowId)) return meta.rowId; const stored=row?._rowIndex??row?._sourceRow??row?._row; if(Number.isInteger(stored)) return stored; const rows=getRowsRaw(source)||[], i=rows.indexOf(row); return i>=0?i:null; }
function researchTraceRepName(row){ return row?._rep||row?.['Agent Name']||row?.['Associate Name']||row?.['Associate name']||row?.Representative||row?.Associate||''; }
function researchEvidenceFieldsForTrace(item,col,source){
  const fields=[], add=f=>{ f=String(f||'').trim(); if(f && !fields.includes(f) && !f.startsWith('@') && !parseModelRef(f)) fields.push(f); };
  const mode=col?.mode||item?.valueMode||'count', field=col?.field||item?.valueField||'';
  const typed=researchTypedMeasureDefinition(col?.measureId||researchMeasureIdFromRef(field)||item?.measureId), resolved=resolveResearchTypedMeasure(typed,item?.source||source); if(typed&&resolved?.source===source){ add(resolved.numeratorField); add(resolved.denominatorField); add(resolved.valueField); }
  [item?.groupField,item?.secondaryGroupField].forEach(add);
  if(item?.dateColumn) add(item.dateColumn);
  if(mode==='expression') researchExpressionFieldRefs(field,item?.source||source).filter(r=>!r.source||r.source===source).forEach(r=>add(r.field||r.column)); else add(field);
  if(['percent_item','value_percent_within','date_percent_within'].includes(mode)) add(col?.percentOfField||item?.percentOfField);
  if(['date_within','date_percent_within','value_within','value_percent_within'].includes(mode)) add(col?.withinCompareField||item?.withinCompareField);
  (col?.formatRules||[]).forEach(r=>add(r.field)); (col?.displayRules||[]).forEach(r=>add(r.field));
  const metric=findMetricByRef(field); if(metric){ add(metric.field); (metric.rules||[]).forEach(r=>add(r.field)); }
  return fields.filter(f=>(getHeaders(source)||[]).includes(f) || f==='_rep' || f==='_team');
}
function researchCompactEvidenceSnapshot(source,row,fields){ const values={}; (fields||[]).forEach(f=>{ values[f]=researchFieldValue(row,f,source); }); return {rep:researchTraceRepName(row),team:researchRowTeam(row)||rowTeam(row)||'',values}; }
function researchTraceRowRefs(source,rows,limit=2000,fields=[]){ return (rows||[]).slice(0,limit).map((r,i)=>({source,index:researchRowSourceIndex(source,r),fallback:i,rep:researchTraceRepName(r),team:researchRowTeam(r)||rowTeam(r)||'',evidence:researchCompactEvidenceSnapshot(source,r,fields)})); }
function researchTraceEntityList(rows,source){ const m=new Map(); (rows||[]).forEach(r=>{ const k=personKeyFromRow(r)||researchRowTeam(r)||'(blank)'; if(!m.has(k)) m.set(k,{entity:k,rep:r._rep||r['Agent Name']||r['Associate Name']||r['Associate name']||r.Representative||k,coach:researchRowTeam(r)||rowTeam(r)||'',source:labelSource(source)||source,count:0}); m.get(k).count++; }); return [...m.values()]; }
function researchTraceSourcesFromField(field,itemSource){ const out=new Set([itemSource].filter(Boolean)), typed=researchTypedMeasureDefinition(researchMeasureIdFromRef(field)), resolved=resolveResearchTypedMeasure(typed,itemSource); if(resolved?.source) out.add(resolved.source); const bang=parseResearchBangField(field); if(bang?.source) out.add(bang.source); String(field||'').replace(/!\[([^\]]+)\]\.\[([^\]]+)\]/g,(_,src)=>{ const key=sourceKeyFromExpressionLabel(src)||src; if(key) out.add(key); }); const metric=findMetricByRef(field); if(metric?.source) out.add(metric.source); return [...out]; }
function researchTraceRowsForValue(item,rows,col){ const field=col?.field||item.valueField, mode=col?.mode||item.valueMode||'count', typed=researchTypedMeasureDefinition(col?.measureId||researchMeasureIdFromRef(field)||item.measureId), resolved=resolveResearchTypedMeasure(typed,item.source); if(typed&&resolved?.source) return {source:resolved.source,rows:researchTypedMeasureRows(resolved,rows,item),typed,resolved}; const metric=findMetricByRef(field); if(metric){ const src=metric.source||item.source; return {source:src,rows:metricRows(metric,researchRowsForCohort(src,rows,item.source,item),src,[]),metric}; } const bang=parseResearchBangField(field)||researchUniqueSourceForHeader(field,item.source); if(bang?.source && bang.source!==item.source){ const matched=researchRowsForCohort(bang.source,rows,item.source,item); return {source:bang.source,rows:mode==='count_by'?researchRowsWithFieldValue(matched,bang.field,bang.source):matched}; } if(mode==='count_by') return {source:item.source,rows:researchRowsWithFieldValue(rows,field,item.source)}; if(mode==='expression'){ const refs=[]; String(field||'').replace(/!\[([^\]]+)\]\.\[([^\]]+)\]/g,(_,src)=>{ const key=sourceKeyFromExpressionLabel(src)||src; refs.push(key); }); if(refs[0]&&refs[0]!==item.source) return {source:refs[0],rows:researchRowsForCohort(refs[0],rows,item.source,item)}; }
  return {source:item.source,rows}; }
function researchTraceCalculation(item,rows,col,value,ctx={}){ const mode=col?.mode||item.valueMode||'count', field=col?.field||item.valueField||'', typed=researchTypedMeasureDefinition(col?.measureId||researchMeasureIdFromRef(field)||item.measureId), resolved=resolveResearchTypedMeasure(typed,item.source); const label=researchColumnLabel(item,col||{}); const lines=[]; let numerator=null, denominator=null; if(typed&&resolved?.compatible){ const stats=researchTypedMeasureStats(resolved,rows,item,col?.missingBehavior||item.missingBehavior); numerator=stats.numerator; denominator=stats.denominator; lines.push(`${label}`,`Formula: ${researchTypedMeasureFormula(resolved)}`,`Source: ${labelSource(resolved.source)||resolved.source}`,`Scoped source rows: ${stats.sourceRows}`,`Contributing values: ${stats.count||stats.sourceRows}`,`Missing/non-numeric inputs: ${stats.missingNumerator+stats.missingDenominator+stats.missingValue}`,`Missing-value behavior: ${stats.behavior}`,resolved.aggregation==='weighted_rate'?`Numerator ${stats.numerator} ÷ denominator ${stats.denominator} = ${value==null?'blank':formatResearchValue(value,item,col)}`:`Result: ${value==null?'blank':formatResearchValue(value,item,col)}`); return {lines,numerator,denominator}; } if(mode==='percent'){ if(col?.percentBuilder||item.percentBuilder){ const traceCtx={warnings:[]}; evaluatePercentBuilder(item,rows,col,traceCtx); const t=traceCtx.percentBuilderTrace||{}; numerator=t.numerator; denominator=t.denominator; const pb=normalizePercentBuilder(col?.percentBuilder||item.percentBuilder,item), rule=pb.rules?.[0]||{}; lines.push(`${label}`,`Numerator count: ${numerator??0}`,`Denominator count: ${denominator??0}`,`Percent result: ${value==null?'blank':formatResearchValue(value,item,col)}`,`Unit counted: ${pb.unit}`,`Qualifier source: ${labelSource(t.qualifierSource||pb.qualifierSource)}`,pb.fromMode==='custom_expression'?`Expression: ${pb.expression}`:`Rule: ${rule.field||'(field)'} ${pb.operator||rule.operator} ${pb.value||rule.value||''}${pb.value2?' / '+pb.value2:''}`,`Denominator type: ${pb.denominator}`,...((t.matchingReps||[]).length?[`Matching reps/items: ${(t.matchingReps||[]).join(', ')}`]:[]),...(traceCtx.warnings||[])); } else { const numRows=item.numeratorExpression?rows.filter(r=>!!evaluateResearchExpression(r,item.numeratorExpression,{source:item.source,context:'Trace numerator',row:r})):rows; numerator=item.numeratorCount==='unique'?uniqueCount(numRows):numRows.length; denominator=item.denominator==='unique'?uniqueCount(rows):(item.denominator==='custom'&&item.denominatorExpression?rows.filter(r=>!!evaluateResearchExpression(r,item.denominatorExpression,{source:item.source,context:'Trace denominator',row:r})).length:rows.length); lines.push(`${label}`,`${numerator} / ${denominator} = ${value==null?'blank':formatResearchValue(value,item,col)}`); } }
  else if(mode==='percent_item'){ numerator=researchAggregateColumnValue(rows,item,field,'sum',[]); denominator=researchAggregateColumnValue(rows,item,col?.percentOfField||item.percentOfField,'sum',[]); lines.push(`${label}`,`${field}: ${numerator}`,`${col?.percentOfField||item.percentOfField}: ${denominator}`,`${numerator} / ${denominator} = ${value==null?'blank':formatResearchValue(value,item,col)}`); }
  else if(['date_within','date_percent_within','value_within','value_percent_within'].includes(mode)){ const sourceCfg=col&&(col.withinCompareField||col.withinDays||col.withinRangeMin||col.withinRangeMax||col.withinUseRange!==undefined)?col:item; const bounds=withinBoundsForConfig(sourceCfg); const stats=withinStatsForRows(rows,item.source,field,col?.withinCompareField||item.withinCompareField,withinModeKind(mode),bounds.low,bounds.high,[]); numerator=stats.within; denominator=stats.compared; lines.push(`${label}`,`Within count: ${numerator}`,`Compared rows: ${denominator}`,`Result: ${formatResearchValue(value,item,col)}`); }
  else if(mode==='expression'){ lines.push(field,`Result: ${formatResearchValue(value,item,col)}`); const m=String(field).match(/sum\(!\[([^\]]+)\]\.\[([^\]]+)\]\)\s*\/\s*sum\(!\[([^\]]+)\]\.\[([^\]]+)\]\)/i); if(m){ const s1=sourceKeyFromExpressionLabel(m[1])||m[1], s2=sourceKeyFromExpressionLabel(m[3])||m[3], r1=researchRowsForCohort(s1,rows,item.source,item), r2=researchRowsForCohort(s2,rows,item.source,item); numerator=r1.reduce((a,r)=>a+(evaluateResearchNumericField(r,m[2],s1)||0),0); denominator=r2.reduce((a,r)=>a+(evaluateResearchNumericField(r,m[4],s2)||0),0); lines.push(`${m[2]} total: ${numerator}`,`${m[4]} total: ${denominator}`, denominator?`${numerator} / ${denominator} = ${formatResearchValue(value,item,col)}`:`Denominator ${m[4]} was 0 for this cohort.`); } }
  else if(mode==='count') lines.push(`Count of matching rows: ${(rows||[]).length}`);
  else if(mode==='count_by'){ const sourceRows=researchTraceRowsForValue(item,rows,col); numerator=(sourceRows.rows||[]).length; lines.push(`Count By [${field||'field'}]`,`Rows with a value in the selected Y field: ${numerator}`); }
  else if(mode==='unique') lines.push(`Unique count of ${field||'entities'}: ${value}`);
  else if(['sum','avg','min','max'].includes(mode)){ const vals=(rows||[]).map(r=>evaluateResearchNumericField(r,field,item.source)).filter(Number.isFinite), total=vals.reduce((a,b)=>a+b,0); lines.push(`${mode.toUpperCase()} of [${field}]`,`Total: ${total}`,`Count: ${vals.length}`,`Result: ${formatResearchValue(value,item,col)}`); }
  else lines.push(`Mode: ${mode}`,`Result: ${formatResearchValue(value,item,col)}`); return {lines,numerator,denominator}; }
function researchTraceTeamFilters(item){ return (item.filters||[]).filter(f=>f.type==='team_is'||f.fieldType==='team_is').map(f=>{ const resolved=resolveTeamFilterSelection(f.teamInput||f.rawTeamInput||f.value||''); return {rawInput:f.teamInput||f.rawTeamInput||f.value||'',conditionResult:conditionResultIsTrue(f.conditionResult),selectedTeams:resolved.teamNames,orgNames:resolved.orgNames,expandedTeams:resolved.expandedTeams,warnings:resolved.warnings}; }); }
function researchTraceMultiPhraseFilters(item){ return (item.filters||[]).filter(f=>isMultiPhraseTextOperator(f.op||'')&&filterPhrases(f).length).map(f=>({field:f.field||'',operator:f.op||'contains',phrases:filterPhrases(f),valueLogic:normalizedTextOperator(f.op)==='does not contain'?'none':'any',conditionResult:conditionResultIsTrue(f.conditionResult)})); }
function createResearchCellTrace(args){ if(!state.researchTraceStore) state.researchTraceStore=new Map(); const traceId='rt_'+id(); const item=args.item||{}, col=args.col||{}, sourceRows=researchTraceRowsForValue(item,args.rows||[],col), typed=researchTypedMeasureDefinition(col.measureId||researchMeasureIdFromRef(col.field||item.valueField)||item.measureId), typedResolved=resolveResearchTypedMeasure(typed,item.source), calc=researchTraceCalculation(item,args.rows||[],col,args.displayValueRaw,args.ctx||{}), entities=researchTraceEntityList(args.rows||[],item.source); const sourceKeys=[...new Set([...researchTraceSourcesFromField(col.field||item.valueField,item.source),sourceRows.source].filter(Boolean))]; const warnings=[...(args.warnings||[])], teamFilters=researchTraceTeamFilters(item), multiPhraseFilters=researchTraceMultiPhraseFilters(item); if(calc.denominator===0) warnings.push(`Denominator was 0 for this cohort.`); if((args.rows||[]).length && !sourceRows.rows.length && sourceRows.source!==item.source) warnings.push(`No ${labelSource(sourceRows.source)||sourceRows.source} rows matched the entities in this cohort.`); if(sourceRows.source&&sourceRows.source!==item.source){ const link=resolveRowsForCohort(sourceRows.source,{rows:args.rows||[],baseRows:args.rows||[],baseSource:item.source,item},{item}); warnings.push(...(link.warnings||[])); if(link.missingRepIdentities?.length) warnings.push(`${link.missingRepIdentities.length} reps had no ${labelSource(sourceRows.source)||sourceRows.source} match: ${link.missingRepIdentities.slice(0,25).join(', ')}${link.missingRepIdentities.length>25?'…':''}`); } const metric=findMetricByRef(col.field||item.valueField); const trace={traceId,researchItemId:item.id,title:item.title||'Research item',rowKey:args.rowKey,columnKey:args.columnKey,displayValue:args.displayValue,displayValueRaw:args.displayValueRaw,valueMode:col.mode||item.valueMode||'count',formula:typedResolved?researchTypedMeasureFormula(typedResolved):(col.field||item.valueField||''),sourceKeys,groupContext:{rowLabel:args.rowLabel,secondaryLabel:args.secondaryLabel,columnLabel:args.columnLabel},cohortContext:{rowCount:(args.rows||[]).length,total:args.ctx?.total,parentTotal:args.ctx?.parentTotal,inverse:args.inverse||false},metricContext:metric?{name:metric.name,source:metric.source,mode:metric.mode,field:metric.field,rules:metric.rules,entityMode:(item.gearFilters||{}).groupField?.entityMode||''}:null,numerator:calc.numerator,denominator:calc.denominator,result:args.displayValueRaw,calculationLines:calc.lines,matchedRows:researchTraceRowRefs(sourceRows.source,sourceRows.rows,2000,researchEvidenceFieldsForTrace(item,col,sourceRows.source)),evidenceFields:researchEvidenceFieldsForTrace(item,col,sourceRows.source),matchedEntities:entities,excludedEntities:[],teamFilters,multiPhraseFilters,warnings,duplicateRepFilter:item.filterDuplicateReps?buildResearchDuplicateRepMap(researchDuplicateRowsBySource(item,args.rows||[]),item,{}):null}; state.researchTraceStore.set(traceId,trace); return traceId; }
function researchRowByRef(ref){ const rows=getRowsRaw(ref.source)||[]; return Number.isInteger(ref.index)?rows[ref.index]:null; }
function hydrateTraceRows(trace,limit=50,offset=0){ return (trace?.matchedRows||[]).slice(offset,offset+limit).map((ref,i)=>({ref,row:researchRowByRef(ref),num:offset+i+1})).filter(x=>x.row||x.ref?.evidence); }
function traceRelevantColumns(source,row,trace){ const fields=(trace?.evidenceFields||[]).filter(Boolean); if(fields.length) return fields; return []; }
function traceEvidenceValue(x,col){ if(x.ref?.evidence?.values && Object.prototype.hasOwnProperty.call(x.ref.evidence.values,col)) return x.ref.evidence.values[col]; return researchFieldValue(x.row,col,x.ref.source); }
function traceEvidenceRep(x){ return x.ref?.evidence?.rep||x.ref?.rep||researchTraceRepName(x.row); }
function traceEvidenceTeam(x){ return x.ref?.evidence?.team||x.ref?.team||researchRowTeam(x.row)||rowTeam(x.row)||''; }
function researchTracePhrases(trace){ const phrases=[]; String(trace.formula||'').replace(/contains\s+["']?([^"']+)["']?/ig,(_,p)=>phrases.push(p.trim())); (trace.multiPhraseFilters||[]).forEach(f=>phrases.push(...(f.phrases||[]))); (trace.metricContext?.rules||[]).forEach(r=>{ if((r.op||'').includes('contains')) phrases.push(...filterPhrases(r)); }); return [...new Set(phrases.filter(Boolean))]; }
function renderResearchCellFeedback(trace){ const shown=state.researchFeedbackState[trace.traceId]?.shown||50, rows=hydrateTraceRows(trace,shown,0), phrases=researchTracePhrases(trace), isModelTrace=String(trace.traceId||'').startsWith('mt_'); const cards={ 'Cell value':trace.displayValue, [isModelTrace?'Model':'Research item']:trace.title, 'Row/group':trace.groupContext?.rowLabel, 'Column':trace.groupContext?.columnLabel, 'Source(s)':(trace.sourceKeys||[]).map(s=>labelSource(s)||s).join(', '), 'Value mode':trace.valueMode, 'Rows used':trace.matchedRows?.length||0, 'Entities used':trace.matchedEntities?.length||0 };
  const legacyEvidenceMissing=!(trace.evidenceFields||[]).length && !(trace.matchedRows||[]).some(r=>r.evidence); const evidence=legacyEvidenceMissing?'':rows.map(x=>{ const src=x.ref.source, cols=traceRelevantColumns(src,x.row,trace); return `<tr><td>${x.num}</td><td>${esc(traceEvidenceRep(x))}</td><td>${esc(traceEvidenceTeam(x))}</td><td>${esc(labelSource(src)||src)}</td><td>${x.ref.index!=null?x.ref.index+1:''}</td>${cols.map(c=>`<td><div class="researchEvidenceSnippet">${highlightResearchConversationValue(traceEvidenceValue(x,c),phrases)}</div></td>`).join('')}</tr>`; }).join(''); const first=rows[0], cols=legacyEvidenceMissing?[]:(first?traceRelevantColumns(first.ref.source,first.row,trace):[]);
  return `<div class="researchFeedbackHead"><div><strong>${isModelTrace?'Model Result Calculation Details':'Research Table Calculation Details'}</strong><div class="hint" style="color:#cbd5e1">${esc(trace.title)} · ${esc(trace.groupContext?.rowLabel||'')} · ${esc(trace.groupContext?.columnLabel||'')}</div></div><button class="dark" data-research-feedback-close>Close</button></div><div class="researchFeedbackBody"><div class="researchFeedbackGrid">${Object.entries(cards).map(([k,v])=>`<div class="researchFeedbackCard"><strong>${esc(k)}</strong>${esc(v??'')}</div>`).join('')}</div>${(trace.multiPhraseFilters||[]).length?`<div class="researchFeedbackSection"><h4>Multi-phrase text filters</h4>${trace.multiPhraseFilters.map(f=>`<div class="researchCalcCode">Filter: ${esc(f.field)} ${esc(f.operator)} ${f.valueLogic==='none'?'NONE of':'ANY of'}:
${(f.phrases||[]).map(p=>'- '+p).join('\n')}
Condition result: ${f.conditionResult?'True':'False'}</div>`).join('')}</div>`:''}${(trace.teamFilters||[]).length?`<div class="researchFeedbackSection"><h4>Team filter applied</h4>${(trace.teamFilters||[]).map(tf=>`<div class="researchCalcCode">Raw input: ${esc(tf.rawInput)}
Selected teams: ${esc((tf.selectedTeams||[]).join(", "))}
Expanded orgs: ${esc((tf.orgNames||[]).map(o=>"$"+o).join(", "))}
Final expanded team list: ${esc((tf.expandedTeams||[]).join(", "))}
Condition result: ${tf.conditionResult?"True / Matches criteria":"False / Does not match criteria"}</div>`).join("")}</div>`:""}${trace.metricContext?`<div class="researchFeedbackSection"><h4>Metric</h4><div class="researchCalcCode">Metric: ${esc(trace.metricContext.name)}\nSource: ${esc(labelSource(trace.metricContext.source)||trace.metricContext.source||'')}\nMode: ${esc(trace.metricContext.mode||'')}\nField: ${esc(trace.metricContext.field||'')}</div></div>`:''}${trace.duplicateRepFilter?.enabled&&trace.duplicateRepFilter.duplicateGroups?.length?`<div class="researchFeedbackSection"><h4>Duplicate rep filter applied</h4><div class="researchCalcCode">${esc(trace.duplicateRepFilter.duplicateGroups.map(g=>`${g.normalizedName} appeared ${1+(g.excluded||[]).length} times.\nKept: ${g.winner.displayName||g.winnerRepKey} — score ${g.winner.score}, ${g.winner.currentSourceRowCount+g.winner.referencedSourceRowCount} linked rows\nExcluded: ${(g.excluded||[]).map(x=>`${x.displayName||x.repKey} — score ${x.score}, ${x.currentSourceRowCount+x.referencedSourceRowCount} linked rows`).join('; ')}\nReason: ${g.reason}`).join('\n\n'))}</div></div>`:''}<div class="researchFeedbackSection"><h4>Calculation Breakdown</h4><div class="researchCalcCode">${esc((trace.calculationLines||[]).join('\n'))}</div></div>${legacyEvidenceMissing?`<div class="researchDiag">Evidence details were not saved for this rendered result. Click Refresh to regenerate compact evidence.</div>`:''}${(trace.warnings||[]).length?`<div class="researchFeedbackSection"><h4>Diagnostics</h4>${trace.warnings.map(w=>`<div class="researchDiag">${esc(w)}</div>`).join('')}</div>`:''}<div class="researchFeedbackSection"><h4>Matching Rows / Evidence</h4><div class="researchFeedbackControls"><button class="smallBtn" data-research-trace-next="${esc(trace.traceId)}">Show next 50</button><button class="smallBtn" data-research-trace-all="${esc(trace.traceId)}">Show all</button><button class="smallBtn" data-research-trace-collapse="${esc(trace.traceId)}">Collapse</button><button class="smallBtn green" data-research-trace-export="${esc(trace.traceId)}">Export evidence to CSV</button></div><div class="researchTableWrap"><table class="researchFeedbackTable"><thead><tr><th>#</th><th>Rep Name</th><th>Coach/Team</th><th>Source</th><th>Source row</th>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${evidence||'<tr><td colspan="5">No compact evidence rows were saved for this exact value.</td></tr>'}</tbody></table></div><div class="hint">Showing ${Math.min(shown,trace.matchedRows?.length||0).toLocaleString()} of ${(trace.matchedRows?.length||0).toLocaleString()} rows.</div></div><div class="researchFeedbackSection"><h4>Included Entities</h4><div class="researchTableWrap"><table class="researchFeedbackTable"><thead><tr><th>Rep / entity</th><th>Coach / team</th><th>Rows</th><th>Source</th></tr></thead><tbody>${(trace.matchedEntities||[]).slice(0,300).map(e=>`<tr><td>${esc(e.rep||e.entity)}</td><td>${esc(e.coach||'')}</td><td>${esc(e.count)}</td><td>${esc(e.source||'')}</td></tr>`).join('')||'<tr><td colspan="4">No included entities.</td></tr>'}</tbody></table></div></div></div>`; }
function openResearchCellFeedback(traceId){ const trace=state.researchTraceStore?.get(traceId); if(!trace) return alert('Calculation details are no longer available. Re-render the Research table and try again.'); state.researchFeedbackState[traceId]=state.researchFeedbackState[traceId]||{shown:50}; let wrap=document.getElementById('researchCellFeedbackModal'); if(!wrap){ wrap=document.createElement('div'); wrap.id='researchCellFeedbackModal'; wrap.className='researchFeedbackBackdrop'; wrap.onclick=e=>{ if(e.target===wrap) wrap.remove(); }; document.body.appendChild(wrap); } wrap.innerHTML=`<div class="researchFeedbackModal">${renderResearchCellFeedback(trace)}</div>`; bindResearchFeedbackActions(wrap); }
function bindResearchFeedbackActions(root){ root.querySelector('[data-research-feedback-close]')?.addEventListener('click',()=>root.remove()); root.querySelectorAll('[data-research-trace-next]').forEach(b=>b.onclick=()=>{ const id=b.dataset.researchTraceNext; state.researchFeedbackState[id].shown=(state.researchFeedbackState[id].shown||50)+50; openResearchCellFeedback(id); }); root.querySelectorAll('[data-research-trace-all]').forEach(b=>b.onclick=()=>{ const id=b.dataset.researchTraceAll, tr=state.researchTraceStore.get(id); state.researchFeedbackState[id].shown=tr?.matchedRows?.length||50; openResearchCellFeedback(id); }); root.querySelectorAll('[data-research-trace-collapse]').forEach(b=>b.onclick=()=>{ const id=b.dataset.researchTraceCollapse; state.researchFeedbackState[id].shown=50; openResearchCellFeedback(id); }); root.querySelectorAll('[data-research-trace-export]').forEach(b=>b.onclick=()=>exportResearchTrace(b.dataset.researchTraceExport)); }
function exportResearchTrace(traceId){ const trace=state.researchTraceStore?.get(traceId); if(!trace) return; const rows=hydrateTraceRows(trace,trace.matchedRows?.length||0,0); const allCols=[...new Set(rows.flatMap(x=>traceRelevantColumns(x.ref.source,x.row,trace)))]; const lines=[['Research item',trace.title],['Cell value',trace.displayValue],['Row/group',trace.groupContext?.rowLabel],['Column',trace.groupContext?.columnLabel],['Formula',trace.formula],[],['#','Rep Name','Coach/Team','Source','Source row',...allCols].map(csvEscape).join(',')]; rows.forEach(x=>lines.push([x.num,traceEvidenceRep(x),traceEvidenceTeam(x),labelSource(x.ref.source)||x.ref.source,x.ref.index!=null?x.ref.index+1:'',...allCols.map(c=>traceEvidenceValue(x,c))].map(csvEscape).join(','))); const name=String(`${trace.title||'research'}-${trace.groupContext?.rowLabel||'row'}-${trace.groupContext?.columnLabel||'value'}-${new Date().toISOString().slice(0,19)}.csv`).replace(/[\/:*?"<>|]+/g,'-'); downloadText(name,lines.join('\n')); }


function researchDrilldownFields(item,col){
  const typed=researchTypedMeasureDefinition(col?.measureId||researchMeasureIdFromRef(col?.field||item.valueField)||item.measureId), resolved=resolveResearchTypedMeasure(typed,item.source);
  const fields=[item.groupField,item.secondaryGroupField,item.panelField,item.dateColumn,col?.field||item.valueField,col?.percentOfField||item.percentOfField,col?.withinCompareField||item.withinCompareField,resolved?.numeratorField,resolved?.denominatorField,resolved?.valueField];
  (item.filters||[]).forEach(f=>{ fields.push(f.field,f.targetValueColumn,f.withinRightField); });
  return [...new Set(fields.filter(Boolean))].slice(0,18);
}
async function openResearchCellDrilldown(tokenId){
  const meta=state.researchDrilldownStore?.get(tokenId); if(!meta) return alert('Drilldown context is no longer available. Reopen the Research page and try again.');
  const item=effectiveResearchItem(normalizeResearchItem((state.researchItems||[]).find(x=>x.id===meta.itemId)||{})); if(!item.id) return alert('Research item was not found.');
  let wrap=document.getElementById('researchCellFeedbackModal'); if(!wrap){ wrap=document.createElement('div'); wrap.id='researchCellFeedbackModal'; wrap.className='researchFeedbackBackdrop'; wrap.onclick=e=>{ if(e.target===wrap) wrap.remove(); }; document.body.appendChild(wrap); }
  wrap.innerHTML=`<div class="researchFeedbackModal"><div class="researchFeedbackHead"><div><strong>Research value drilldown</strong><div class="hint" style="color:#cbd5e1">${esc(item.title||'Research item')} · ${esc(meta.rowLabel)} · ${esc(meta.columnLabel)}</div></div><button class="dark" data-research-feedback-close>Close</button></div><div class="researchFeedbackBody"><div class="researchPreviewSummary"><span class="badge">Preparing focused query…</span></div><div style="height:8px;background:#334155;border-radius:99px;overflow:hidden"><div data-drilldown-progress style="height:100%;width:2%;background:#22c55e"></div></div></div></div>`;
  wrap.querySelector('[data-research-feedback-close]')?.addEventListener('click',()=>wrap.remove());
  try{
    await ensureResearchExecutionIndexes(item);
    const planned=buildQueryPlan(item.source,{dateColumn:item.dateColumn,startDate:item.startDate,endDate:item.endDate,filters:item.filters||[],item}), col=expandedResearchColumns(item)[meta.columnIndex]||{}, fields=researchDrilldownFields(item,col), rows=[], sourceRows=planned.rows||[], bar=wrap.querySelector('[data-drilldown-progress]');
    let histogramRows=null; if(item.outputType==='histogram'){ const built=buildResearchHistogramGroups(item,sourceRows,sourceRows,[]); histogramRows=new Set(built.groups.get(meta.rowLabel)?.rows||[]); }
    const scatterLabel=r=>{ const grain=researchAnalysisGrain(item,[r]); return grain==='teams'?(getCoachIdentity(r,item.source).displayName||'(blank team)'):grain==='rows'?(researchRowRepName(r,item.source)||researchRowTeam(r,item.source)||'Row'):(getRepIdentity(r,item.source).displayName||'(blank representative)'); };
    for(let i=0;i<sourceRows.length;i+=500){
      const chunk=sourceRows.slice(i,i+500);
      chunk.forEach(r=>{ const primary=item.outputType==='scatter'?scatterLabel(r):researchGroupLabel(item,r), secondary=item.useSecondaryGroup&&item.secondaryGroupField?researchSecondaryKey(item,r):'', panel=researchPanelKey(item,r), match=histogramRows?histogramRows.has(r):(String(primary)===String(meta.rowLabel)&&(!meta.secondaryLabel||String(secondary)===String(meta.secondaryLabel))&&(!meta.panelLabel||String(panel)===String(meta.panelLabel))); if(match) rows.push(r); });
      if(bar) bar.style.width=(5+90*Math.min(1,(i+500)/Math.max(1,sourceRows.length)))+'%'; await yieldToBrowser();
    }
    const traced=researchTraceRowsForValue(item,rows,col), evidenceRows=traced?.rows||rows, evidenceSource=traced?.source||item.source, dataChanged=(item.renderedResult?.dataVersion&&meta.renderedDataSignature&&item.renderedResult.dataVersion!==meta.renderedDataSignature), shown=evidenceRows.slice(0,250), head=['Rep name','Coach/team','Source','Source row',...fields], calc=researchTraceCalculation(item,rows,col,meta.value,{total:sourceRows.length,parentTotal:rows.length}), typed=researchTypedMeasureDefinition(col.measureId||researchMeasureIdFromRef(col.field||item.valueField)||item.measureId), resolved=resolveResearchTypedMeasure(typed,item.source), formula=resolved?researchTypedMeasureFormula(resolved):(col.field||item.valueField||col.mode||item.valueMode);
    const body=shown.map((r,idx)=>`<tr><td>${esc(researchRowRepName(r,evidenceSource)||'')}</td><td>${esc(researchRowTeam(r,evidenceSource)||'')}</td><td>${esc(labelSource(evidenceSource)||evidenceSource)}</td><td>${esc((researchRowSourceIndex(evidenceSource,r)??idx)+1)}</td>${fields.map(f=>`<td><div class="researchEvidenceSnippet">${esc(researchFieldValue(r,f,evidenceSource)??'')}</div></td>`).join('')}</tr>`).join('');
    wrap.innerHTML=`<div class="researchFeedbackModal"><div class="researchFeedbackHead"><div><strong>Research value drilldown</strong><div class="hint" style="color:#cbd5e1">${esc(item.title||'Research item')} · ${esc(meta.rowLabel)}${meta.panelLabel?` · ${esc(meta.panelLabel)}`:''} · ${esc(meta.columnLabel)} · ${esc(meta.display??meta.value??'')}</div></div><button class="dark" data-research-feedback-close>Close</button></div><div class="researchFeedbackBody">${dataChanged?'<div class="researchWarn">Data has changed since this value was rendered; drilldown is using current imported data.</div>':''}${queryPlanBadge(planned.plan)}<div class="researchFeedbackSection"><h4>Formula and calculation</h4><div class="researchCalcCode">Formula: ${esc(formula)}\n${esc((calc.lines||[]).join('\n'))}</div></div><div class="researchPreviewSummary"><span class="badge">Base group rows: ${rows.length.toLocaleString()}</span><span class="badge">Evidence rows: ${evidenceRows.length.toLocaleString()}</span><span class="badge">Showing ${shown.length.toLocaleString()}</span></div><div class="researchTableWrap"><table class="researchFeedbackTable"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body||`<tr><td colspan="${head.length}">No current rows matched this clicked value.</td></tr>`}</tbody></table></div><div class="hint">Drilldown evidence is calculated only when clicked, keeping normal Research rendering fast.</div></div></div>`;
    wrap.querySelector('[data-research-feedback-close]')?.addEventListener('click',()=>wrap.remove());
  }catch(e){ wrap.querySelector('.researchFeedbackBody').innerHTML=`<div class="researchWarn">${esc(e.message||e)}</div>`; }
}

function formatResearchValue(v,item,col){ if(v==null) return ''; if(typeof v==='number'){ const mode=col?.mode||item?.valueMode||'', typed=researchTypedMeasureDefinition(col?.measureId||researchMeasureIdFromRef(col?.field||item?.valueField)||item?.measureId), pct=!!(col&&col.showAsPercent)||typed?.valueType==='percentage'||['percent','percent_total','percent_parent','percent_item','date_percent_within','value_percent_within'].includes(mode); const n=pct && Math.abs(v)<=1 && typed?.aggregation!=='weighted_rate' ? v*100 : v; return n.toFixed(item.decimals??1)+((item.showPercent||pct)?'%':''); } return esc(v); }
function researchTableId(item){ return 'rtv_'+String(item.id||id()).replace(/[^a-z0-9_-]/gi,'_'); }
function researchTableHeaderHtml(item,result,sec){ const grainLabel=researchAnalysisGrain(item,[])==='teams'?'Team':researchAnalysisGrain(item,[])==='representatives'?'Representative':'Group'; return `<thead><tr><th>${esc(item.groupMultiAdd?'Multi-add group':(findMetricByRef(item.groupField)?.name||researchDisplayFieldLabel(item.groupField,grainLabel)))}</th>${sec?`<th>${esc(item.secondaryGroupField||'Secondary')}</th>`:''}${(result.columns||[]).map(c=>`<th>${esc(researchColumnDisplayTitle(item,c)||c.label||c.mode||'Value')}</th>`).join('')}</tr></thead>`; }
function researchDrilldownToken(item,row,colIndex,col,value,display){
  if(!state.researchDrilldownStore) state.researchDrilldownStore=new Map();
  const token='rd_'+id();
  state.researchDrilldownStore.set(token,{itemId:item.id,rowLabel:row.label||'',secondaryLabel:row.secondary||'',panelLabel:row.panel||'',columnIndex:colIndex,columnLabel:researchColumnDisplayTitle(item,col)||col.label||col.mode||'Value',value,display,renderedDataSignature:item.renderedResult?.dataVersion||item.renderedResult?.renderedAt||''});
  return token;
}
function researchTableTraceCell(viewer,r,v,i){ const item=viewer.item, result=viewer.result, col=result.columns[i]||{}, saved=(r.cells||[])[i]; const display=saved?(saved.html??esc(saved.text??saved.display??v??'')):null; const drill=researchDrilldownToken(item,r,i,col,v,display); if(saved) return `<td class="right researchTraceCell" data-drilldown-id="${esc(drill)}" style="${esc(saved.style||'')}" title="Click to drill into this saved value">${display}</td>`; const t=r.traces?.[i]||{}, rowObjs=(t.rowRefs||[]).map(researchRowByRef).filter(Boolean), pres=researchColumnCellPresentation(v,item,col,rowObjs,t.ctx||{},result.warnings||[]); if(result.valueOnly) return `<td class="right researchTraceCell" data-drilldown-id="${esc(drill)}" style="${esc(pres.style)}" title="Click to drill into this saved value">${pres.html}</td>`; const traceId=createResearchCellTrace({item,rows:rowObjs,col,rowKey:r.label,columnKey:researchColumnDisplayTitle(item,col)||col.label||i,rowLabel:r.label,secondaryLabel:r.secondary,columnLabel:researchColumnDisplayTitle(item,col)||col.label||col.mode||'Value',displayValue:pres.html,displayValueRaw:v,ctx:t.ctx||{},warnings:result.warnings||[]}); return `<td class="right researchTraceCell" data-trace-id="${esc(traceId)}" data-drilldown-id="${esc(drill)}" style="${esc(pres.style)}" title="Click to view calculation details">${pres.html}</td>`; }
function researchTableRowHtml(viewer,start,end){ const sec=!!viewer.result.hasSecondary; return (viewer.rows||[]).slice(start,end).map(r=>`<tr><td>${esc(r.label)}</td>${sec?`<td>${esc(r.secondary||'')}</td>`:''}${r.values.map((v,i)=>researchTableTraceCell(viewer,r,v,i)).join('')}</tr>`).join(''); }
function researchTableTotalRowHtml(viewer){ const item=viewer.item, result=viewer.result, sec=!!result.hasSecondary; if(!item.totals||!viewer.rows.length) return ''; const totalVals=Array.isArray(result.totalValues)?result.totalValues:[], totalCells=Array.isArray(result.totalCells)?result.totalCells:[]; return `<tr><td><strong>Total</strong></td>${sec?'<td></td>':''}${result.columns.map((c,i)=>{ const saved=totalCells[i]; if(saved) return `<td class="right" style="${esc(saved.style||'')}"><strong>${saved.html??esc(saved.text??saved.display??totalVals[i]??'')}</strong></td>`; const pres=researchColumnCellPresentation(totalVals[i],item,c,[],{},result.warnings||[]); return `<td class="right" style="${esc(pres.style)}"><strong>${pres.html}</strong></td>`; }).join('')}</tr>`; }
function researchVirtualSpacer(height,colspan){ return height>0 ? `<tr class="researchVirtualSpacer" aria-hidden="true"><td colspan="${colspan}" style="height:${Math.max(0,Math.round(height))}px"></td></tr>` : ''; }
function renderResearchVirtualWindow(id){ const viewer=state.researchVirtualTables?.get(id), root=els.researchCanvas?.querySelector(`[data-virtual-table="${CSS.escape(id)}"]`); if(!viewer||!root) return; const tbody=root.querySelector('tbody'); if(!tbody) return; const rowH=viewer.rowHeight||VIRTUAL_TABLE_ESTIMATED_ROW_HEIGHT, viewRows=Math.ceil(root.clientHeight/rowH), first=Math.max(0,Math.floor(root.scrollTop/rowH)-VIRTUAL_TABLE_BUFFER_ROWS), count=viewRows+(VIRTUAL_TABLE_BUFFER_ROWS*2), end=Math.min(viewer.rows.length,first+count), top=first*rowH, bottom=Math.max(0,(viewer.rows.length-end)*rowH), colspan=1+(viewer.result.hasSecondary?1:0)+(viewer.result.columns||[]).length; tbody.innerHTML=researchVirtualSpacer(top,colspan)+researchTableRowHtml(viewer,first,end)+researchVirtualSpacer(bottom,colspan)+researchTableTotalRowHtml(viewer); root.querySelectorAll('[data-trace-id]').forEach(c=>c.onclick=e=>{ e.stopPropagation(); openResearchCellFeedback(c.dataset.traceId); }); root.querySelectorAll('[data-drilldown-id]:not([data-trace-id])').forEach(c=>c.onclick=e=>{ e.stopPropagation(); openResearchCellDrilldown(c.dataset.drilldownId); }); const firstRow=tbody.querySelector('tr:not(.researchVirtualSpacer)'); if(firstRow){ const h=firstRow.getBoundingClientRect().height; if(h>0 && Math.abs(h-rowH)>2) viewer.rowHeight=h; } }
function bindResearchVirtualTables(root=document){ root.querySelectorAll('[data-virtual-table]').forEach(wrap=>{ const id=wrap.dataset.virtualTable; if(wrap.dataset.virtualBound==='1') return; wrap.dataset.virtualBound='1'; wrap.addEventListener('scroll',()=>requestAnimationFrame(()=>renderResearchVirtualWindow(id)),{passive:true}); renderResearchVirtualWindow(id); }); }
function renderResearchTable(item,result){
  const sec=!!result.hasSecondary, allData=result.data||[], tall=allData.length>35, virtual=allData.length>VIRTUAL_TABLE_THRESHOLD;
  const viewer={item,result,rows:allData,rowHeight:VIRTUAL_TABLE_ESTIMATED_ROW_HEIGHT};
  if(virtual){ const tableId=researchTableId(item); state.researchVirtualTables.set(tableId,viewer); const countNote=`<div class="hint">Virtualized table: rendering visible rows from ${allData.length.toLocaleString()} groups.</div>`; return `${countNote}<div class="researchTableWrap tall" data-virtual-table="${esc(tableId)}"><table>${researchTableHeaderHtml(item,result,sec)}<tbody></tbody></table></div>`; }
  const rows=researchTableRowHtml(viewer,0,allData.length)+researchTableTotalRowHtml(viewer);
  return `<div class="researchTableWrap ${tall?'tall':''}"><table>${researchTableHeaderHtml(item,result,sec)}<tbody>${rows}</tbody></table></div>`;
}
function csvEscape(v){ const s=String(v??''); return /[",\n\r]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }
function researchConversationFilename(item,suffix){ return String((item.title||'conversation-viewer')+'-'+suffix+'.csv').replace(/[\\/:*?"<>|]+/g,'-'); }
function researchConversationHighlightPhrases(item){
  const phrases=[];
  (item.filters||[]).forEach(f=>{ const include=f.include||'include', op=f.op||'contains'; if(include==='include' && op==='contains' && String(f.value||'').trim()) phrases.push(String(f.value).trim()); });
  Object.values(item.gearFilters||{}).forEach(cfg=>{ if(cfg?.customTextEnabled && (cfg.customTextOp||'contains')==='contains' && String(cfg.customText||'').trim()) phrases.push(...parseResearchTextPhrases(cfg.customText)); });
  return [...new Set(phrases)].filter(Boolean).slice(0,12).sort((a,b)=>b.length-a.length);
}
function highlightResearchConversationValue(value,phrases){
  let html=esc(value??'');
  (phrases||[]).forEach(p=>{ const q=String(p||'').trim(); if(!q) return; const re=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'); html=html.replace(re,m=>`<mark class="researchMatch">${m}</mark>`); });
  return html;
}
function researchConversationCellValue(row,col,item){ return researchFieldValue(row,col.field,item.source); }
function researchConversationRowHtml(viewer,start,end){
  const rows=viewer.rows.slice(start,end), cols=viewer.columns, phrases=viewer.phrases, item=viewer.item;
  return rows.map((r,i)=>`<tr><td class="rowNum">${start+i+1}</td>${cols.map(c=>`<td><div class="cellScroll">${highlightResearchConversationValue(researchConversationCellValue(r,c,item),phrases)}</div></td>`).join('')}</tr>`).join('');
}
function researchConversationCsv(viewer,visibleOnly){
  const count=visibleOnly ? viewer.rendered : viewer.rows.length;
  const rows=viewer.rows.slice(0,count);
  const header=['#',...viewer.columns.map(c=>researchColumnDisplayTitle(viewer.item,c)||c.label||c.field)];
  return [header.map(csvEscape).join(','),...rows.map((r,i)=>[i+1,...viewer.columns.map(c=>researchConversationCellValue(r,c,viewer.item))].map(csvEscape).join(','))].join('\n');
}

async function exportAllResearchConversationCsv(id){
  const viewer=state.researchConversationViewers?.get(id); if(!viewer) return;
  if(viewer.rows.length<1000){ downloadText(researchConversationFilename(viewer.item,'all-matching-rows'), researchConversationCsv(viewer,false)); return; }
  showProgress('Conversation Viewer: preparing all matching rows CSV...',5);
  const lines=[['#',...viewer.columns.map(c=>researchColumnDisplayTitle(viewer.item,c)||c.label||c.field)].map(csvEscape).join(',')], chunk=1000;
  for(let i=0;i<viewer.rows.length;i+=chunk){
    const part=viewer.rows.slice(i,i+chunk).map((r,j)=>[i+j+1,...viewer.columns.map(c=>researchConversationCellValue(r,c,viewer.item))].map(csvEscape).join(','));
    lines.push(...part); updateProgress(`Conversation Viewer: exporting ${(Math.min(i+chunk,viewer.rows.length)).toLocaleString()} of ${viewer.rows.length.toLocaleString()} rows`, 5+90*Math.min(1,(i+chunk)/Math.max(1,viewer.rows.length)));
    await yieldToBrowser();
  }
  downloadText(researchConversationFilename(viewer.item,'all-matching-rows'), lines.join('\n'));
  updateProgress('Conversation Viewer CSV export complete',100); await yieldToBrowser(); hideProgress();
}
function researchConversationCopyVisible(id){
  const viewer=state.researchConversationViewers?.get(id); if(!viewer) return;
  const text=researchConversationCsv(viewer,true);
  if(navigator.clipboard?.writeText) navigator.clipboard.writeText(text); else { const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
}
function updateResearchConversationControls(id){
  const viewer=state.researchConversationViewers?.get(id), root=els.researchCanvas?.querySelector(`[data-conv-viewer="${CSS.escape(id)}"]`); if(!viewer||!root) return;
  const shown=Math.min(viewer.rendered,viewer.rows.length), total=viewer.rows.length;
  const count=root.querySelector('[data-conv-count]'); if(count) count.textContent=`Showing ${shown.toLocaleString()} of ${total.toLocaleString()} matching rows`;
  const btn=root.querySelector('[data-conv-load]'); if(btn){ btn.disabled=shown>=total; btn.classList.toggle('hidden', shown>=total); }
}
function appendResearchConversationRows(id){
  const viewer=state.researchConversationViewers?.get(id), root=els.researchCanvas?.querySelector(`[data-conv-viewer="${CSS.escape(id)}"]`); if(!viewer||!root) return;
  const tbody=root.querySelector('tbody'), start=viewer.rendered, end=Math.min(start+100,viewer.rows.length); if(!tbody || start>=end) return updateResearchConversationControls(id);
  const holder=document.createElement('tbody'); holder.innerHTML=researchConversationRowHtml(viewer,start,end);
  const frag=document.createDocumentFragment(); while(holder.firstChild) frag.appendChild(holder.firstChild);
  tbody.appendChild(frag); viewer.rendered=end; updateResearchConversationControls(id);
}
function bindResearchConversationViewerActions(root=document){
  root.querySelectorAll('[data-conv-load]').forEach(b=>b.onclick=()=>appendResearchConversationRows(b.dataset.convLoad));
  root.querySelectorAll('[data-conv-export-visible]').forEach(b=>b.onclick=()=>{ const v=state.researchConversationViewers?.get(b.dataset.convExportVisible); if(v) downloadText(researchConversationFilename(v.item,'visible-rows'), researchConversationCsv(v,true)); });
  root.querySelectorAll('[data-conv-export-all]').forEach(b=>b.onclick=()=>exportAllResearchConversationCsv(b.dataset.convExportAll));
  root.querySelectorAll('[data-conv-copy-visible]').forEach(b=>b.onclick=()=>researchConversationCopyVisible(b.dataset.convCopyVisible));
}
function researchConversationTopSummary(item,result){
  const rows=result.rows||[], dateCol=item.dateColumn||researchDefaultDateColumn(item), dates=rows.map(r=>parseDateOnly(researchFieldValue(r,dateCol,item.source))).filter(Boolean).map(d=>d.getTime()), reps=[...new Set(rows.map(r=>r._rep||r['Agent Name']||r['Associate Name']||r['Associate name']||r['Representative']).filter(Boolean))], teams=[...new Set(rows.map(researchRowTeam).filter(Boolean))];
  const bits=[`Source: ${labelSource(item.source)||item.source}`];
  if(dates.length) bits.push(`Date: ${new Date(Math.min(...dates)).toLocaleDateString()} – ${new Date(Math.max(...dates)).toLocaleDateString()}`);
  if(reps.length) bits.push(`Person: ${reps.slice(0,3).join(', ')}${reps.length>3?' +'+(reps.length-3)+' more':''}`);
  if(teams.length) bits.push(`Team: ${teams.slice(0,3).join(', ')}${teams.length>3?' +'+(teams.length-3)+' more':''}`);
  return `<div class="researchConversationSummary">${bits.map(b=>`<span class="badge">${esc(b)}</span>`).join('')}</div>`;
}
function renderResearchConversationViewer(item,result){
  const id=item.id||('conv-'+Date.now()), cls=`researchConversationTable ${item.textWrap===false?'noWrap':'wrapText'} ${item.rowDensity==='compact'?'compact':'comfortable'}`;
  const viewer={item,rows:result.rows||[],columns:result.columns||[],phrases:researchConversationHighlightPhrases(item),rendered:Math.min(100,(result.rows||[]).length)};
  state.researchConversationViewers.set(id,viewer);
  const rows=researchConversationRowHtml(viewer,0,viewer.rendered), total=viewer.rows.length, more=viewer.rendered<total;
  return `<div data-conv-viewer="${esc(id)}"><div class="researchConversationBadge" data-conv-count>Showing ${viewer.rendered.toLocaleString()} of ${total.toLocaleString()} matching rows</div>${researchConversationTopSummary(item,result)}<div class="researchConversationControls"><button class="smallBtn" type="button" data-conv-export-visible="${esc(id)}">Export Visible Rows CSV</button><button class="smallBtn" type="button" data-conv-export-all="${esc(id)}">Export All Matching Rows CSV</button><button class="smallBtn" type="button" data-conv-copy-visible="${esc(id)}">Copy Visible Rows</button></div><div class="researchTableWrap"><table class="${cls}"><thead><tr><th>#</th>${viewer.columns.map(c=>`<th>${esc(c.label||c.field)}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${viewer.columns.length+1}">No rows matched.</td></tr>`}</tbody></table></div>${more?`<div class="researchConversationControls"><button class="smallBtn green" type="button" data-conv-load="${esc(id)}">Load Next 100</button></div>`:''}</div>`;
}
function researchChartData(item,result){
  let data=(result.data||[]).slice();
  if(item.hideZeroGroups) data=data.filter(d=>Math.abs(+d.values?.[0]||0)>0);
  const sort=item.graphSort&&item.graphSort!=='inherit'?item.graphSort:(item.sort||'default');
  let compare=null; if(sort==='xAsc') compare=(a,b)=>(a.label+a.secondary).localeCompare(b.label+b.secondary); if(sort==='xDesc') compare=(a,b)=>(b.label+b.secondary).localeCompare(a.label+a.secondary); if(sort==='yAsc') compare=(a,b)=>(+a.values[0]||0)-(+b.values[0]||0); if(sort==='yDesc') compare=(a,b)=>(+b.values[0]||0)-(+a.values[0]||0); if(sort==='dateAsc') compare=(a,b)=>(a.dateValue||0)-(b.dateValue||0); if(sort==='dateDesc') compare=(a,b)=>(b.dateValue||0)-(a.dateValue||0);
  const topN=Math.max(0,Math.floor(Number(item.topN)||0)); if(compare) data=topN?researchBoundedTopN(data,topN,compare):data.sort(compare); else if(topN) data=data.slice(0,topN);
  const limit=Math.max(50,Number(item.visibleChartLimit)||RESEARCH_CHART_POINT_LIMIT);
  if(data.length>limit){
    const source=data, sampled=[], step=(source.length-1)/Math.max(1,limit-1);
    for(let i=0;i<limit;i++) sampled.push(source[Math.min(source.length-1,Math.round(i*step))]);
    data=sampled; data._clipped=true; data._downsampled=true; data._total=source.length;
  }
  return data;
}
function researchChartClipNote(data){ return data?._clipped ? `<div class="researchWarn">Downsampled ${Number(data._total||0).toLocaleString()} marks to ${data.length.toLocaleString()} representative marks. Use Sort/Top N or Export Data for the full result.</div>` : ''; }
function researchChartLabels(data){ return [...new Set((data||[]).map(d=>d.label))]; }
function researchChartSeries(data){ return [...new Set((data||[]).map(d=>d.secondary||''))]; }
function researchShortLabel(label,item,limit=14){ const s=String(label??''); if(item.wrapLabels && s.length>limit) return s.slice(0,limit)+'…'; return s; }
function researchAxisLabelSvg(x,y,label,item,anchor='middle'){
  const rot=item.rotateLabels?` transform="rotate(-35 ${x} ${y})"`:'';
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="10"${rot}>${esc(researchShortLabel(label,item,item.rotateLabels?18:12))}</text>`;
}
function researchDateLikeLabel(v){ return /\b\d{1,4}[-/]\d{1,2}([-/]\d{1,4})?\b/.test(String(v||'')) || /^[A-Za-z]{3,9}\s+\d{1,2}/.test(String(v||'')); }
function researchLinePath(pts,smooth){ if(!pts.length) return ''; if(!smooth) return 'M '+pts.map(p=>p[0]+','+p[1]).join(' L '); let d=`M ${pts[0][0]},${pts[0][1]}`; for(let i=1;i<pts.length;i++){ const [x0,y0]=pts[i-1], [x1,y1]=pts[i], mx=(x0+x1)/2; d+=` C ${mx},${y0} ${mx},${y1} ${x1},${y1}`; } return d; }
function researchReferenceLines(item,vals,x1,x2,yFor,color='#64748b'){
  let out=''; if(item.showSummaryLine && vals.length){ const avg=vals.reduce((a,b)=>a+(+b||0),0)/vals.length, y=yFor(avg); out+=`<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="${color}" stroke-dasharray="5 4"/><text x="${x2-4}" y="${y-5}" text-anchor="end" font-size="11" font-weight="700" fill="${color}">Avg: ${formatResearchValue(avg,item)}</text>`; }
  const goal=String(item.goalValue??'').trim()===''?NaN:+item.goalValue; if(Number.isFinite(goal)){ const y=yFor(goal); out+=`<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="#dc2626" stroke-width="2" stroke-dasharray="7 4"/><text x="${x2-4}" y="${y-6}" text-anchor="end" font-size="12" font-weight="900" fill="#dc2626">Goal: ${formatResearchValue(goal,item)}</text>`; } return out;
}
function researchGridlines(item,p,h,x1,x2,yFor,min,max){ if(!item.showGridlines) return ''; return [0,.25,.5,.75,1].map(t=>{ const v=min+(max-min)*t, y=yFor(v); return `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="#e5e7eb"/><text x="${p-6}" y="${y+4}" text-anchor="end" font-size="10" fill="#64748b">${formatResearchValue(v,item)}</text>`; }).join(''); }

function researchChartTraceAttrs(item,result,d){
  const raw=d?.values?.[0], display=formatResearchValue(raw,item);
  if(result?.valueOnly){
    const col=(result.columns||[])[0]||{}, token=researchDrilldownToken(item,d,0,col,raw,display);
    return ` class="researchTraceCell" data-drilldown-id="${esc(token)}" style="cursor:pointer"`;
  }
  const t=d?.traces?.[0]||{}, rowObjs=(t.rowRefs||[]).map(researchRowByRef).filter(Boolean);
  const traceId=createResearchCellTrace({item,rows:rowObjs,col:null,rowKey:d?.label,columnKey:d?.secondary||'Value',rowLabel:d?.label,secondaryLabel:d?.secondary,columnLabel:d?.secondary||researchColumnLabel(item,{}),displayValue:display,displayValueRaw:raw,ctx:t.ctx||{},warnings:result?.warnings||[]});
  return ` class="researchTraceCell" data-trace-id="${esc(traceId)}" style="cursor:pointer"`;
}
function renderResearchBarChart(item,result){
  const data=researchChartData(item,result); if(data.length>20 && !item.rotateLabels) item={...item,rotateLabels:true};
  const w=900,h=360,p=52, colors=['#b91c1c','#2563eb','#059669','#d97706','#7c3aed','#0891b2','#db2777','#65a30d'], labels=researchChartLabels(data), series=researchChartSeries(data), hasSecondary=!!result.hasSecondary&&series.length>1, stacked=hasSecondary&&item.stackedBars&&!item.groupedBars, vals=data.map(d=>+d.values[0]||0), totals=labels.map(l=>data.filter(d=>d.label===l).reduce((a,d)=>a+(+d.values[0]||0),0)), domainVals=stacked?totals:vals, min=item.axisMin!==''?+item.axisMin:Math.min(0,...domainVals), max=item.axisMax!==''?+item.axisMax:Math.max(1,...domainVals), plotRight=w-(item.showLegend&&hasSecondary?170:20), plotBottom=h-p, yFor=v=>plotBottom-(((+v||0)-min)/(max-min||1))*(h-p*2), xStep=(plotRight-p)/Math.max(1,labels.length), best=Math.max(...vals), worst=Math.min(...vals);
  let bars='';
  if(item.barOrientation==='horizontal'){
    const xFor=v=>p+(((+v||0)-min)/(max-min||1))*(plotRight-p-10), rowH=(h-p*2)/Math.max(1,data.length); bars=data.map((d,i)=>{ const v=+d.values[0]||0, y=p+i*rowH+3, bw=Math.max(0,xFor(v)-p), c=(item.highlightBest&&v===best)?'#16a34a':(item.highlightWorst&&v===worst)?'#dc2626':colors[Math.max(0,series.indexOf(d.secondary||''))%colors.length]; return `<rect${researchChartTraceAttrs(item,result,d)} x="${p}" y="${y}" width="${bw}" height="${Math.max(6,rowH-6)}" fill="${c}"><title>${esc(d.secondary?d.label+' / '+d.secondary:d.label)}: ${formatResearchValue(v,item)}</title></rect><text x="${p-6}" y="${y+rowH/2}" text-anchor="end" font-size="10">${esc(researchShortLabel(d.label,item,18))}</text>${item.showValues?`<text x="${p+bw+4}" y="${y+rowH/2}" font-size="11" font-weight="700">${formatResearchValue(v,item)}</text>`:''}`; }).join('');
    return `${researchChartClipNote(data)}<div class="researchChartWrap"><svg class="researchChart" viewBox="0 0 ${w} ${h}" data-research-svg="${item.id}">${researchGridlines(item,p,h,p,plotRight,yFor,min,max)}<line x1="${p}" y1="${h-p}" x2="${plotRight}" y2="${h-p}" stroke="#111827"/><line x1="${p}" y1="${p}" x2="${p}" y2="${h-p}" stroke="#111827"/>${bars}${researchReferenceLines(item,vals,p,plotRight,yFor)}</svg></div>`;
  }
  labels.forEach((lab,li)=>{ let stackY=plotBottom; const group=data.filter(d=>d.label===lab), bw=Math.max(8,(xStep-12)/(stacked?1:Math.max(1,group.length))); group.forEach((d,si)=>{ const v=+d.values[0]||0, bh=((v-min)/(max-min||1))*(h-p*2), bx=p+li*xStep+6+(stacked?0:si*bw), y=stacked?stackY-bh:yFor(v), c=(item.highlightBest&&v===best)?'#16a34a':(item.highlightWorst&&v===worst)?'#dc2626':colors[Math.max(0,series.indexOf(d.secondary||''))%colors.length]; if(stacked) stackY=y; bars+=`<rect${researchChartTraceAttrs(item,result,d)} x="${bx}" y="${y}" width="${bw-3}" height="${Math.max(0,bh)}" fill="${c}"><title>${esc(d.secondary?d.label+' / '+d.secondary:d.label)}: ${formatResearchValue(v,item)}</title></rect>${item.showValues?`<text x="${bx+(bw-3)/2}" y="${Math.max(14,y-4)}" text-anchor="middle" font-size="11" font-weight="700">${formatResearchValue(v,item)}</text>`:''}${item.showDateLabels&&researchDateLikeLabel(lab)?`<text x="${bx+(bw-3)/2}" y="${Math.max(14,y+14)}" text-anchor="middle" font-size="9" fill="#334155">${esc(researchShortLabel(lab,item,12))}</text>`:''}`; }); bars+=researchAxisLabelSvg(p+li*xStep+xStep/2,h-14,lab,item); });
  const legend=(item.showLegend&&hasSecondary)?`<g transform="translate(${plotRight+12},34)"><text x="0" y="-14" font-size="12" font-weight="700">${esc(item.secondaryGroupField||'Legend')}</text>${series.map((s,i)=>`<rect x="0" y="${i*18}" width="11" height="11" fill="${colors[i%colors.length]}"/><text x="17" y="${i*18+10}" font-size="11">${esc(researchShortLabel(s,item,24))}</text>`).join('')}</g>`:'';
  return `${researchChartClipNote(data)}<div class="researchChartWrap"><svg class="researchChart" viewBox="0 0 ${w} ${h}" data-research-svg="${item.id}">${researchGridlines(item,p,h,p,plotRight,yFor,min,max)}<line x1="${p}" y1="${h-p}" x2="${plotRight}" y2="${h-p}" stroke="#111827"/><line x1="${p}" y1="${p}" x2="${p}" y2="${h-p}" stroke="#111827"/>${bars}${researchReferenceLines(item,vals,p,plotRight,yFor)}${legend}</svg></div>`;
}
function renderResearchLineChart(item,result){
  const data=researchChartData(item,result); if(researchChartLabels(data).length>20 && !item.rotateLabels) item={...item,rotateLabels:true};
  const w=900,h=360,p=52, colors=['#b91c1c','#2563eb','#059669','#d97706','#7c3aed','#0891b2','#db2777','#65a30d'], labels=researchChartLabels(data), series=result.hasSecondary?researchChartSeries(data):[''], vals=data.map(d=>+d.values[0]||0), plotRight=w-(item.showLegend&&series.length>1?170:20), max=item.axisMax!==''?+item.axisMax:Math.max(1,...vals), min=item.axisMin!==''?+item.axisMin:Math.min(0,...vals), xFor=i=>p+(i*(plotRight-p)/Math.max(1,labels.length-1)), yFor=v=>h-p-(((+v||0)-min)/(max-min||1))*(h-p*2), best=Math.max(...vals), worst=Math.min(...vals);
  const lines=series.map((sec,si)=>{ const pts=labels.map((lab,li)=>{ const d=result.hasSecondary?data.find(x=>x.label===lab && (x.secondary||'')===sec):data[li]; return [xFor(li),yFor(d?d.values[0]:0),d]; }); const color=colors[si%colors.length]; return `<path fill="none" stroke="${color}" stroke-width="3" d="${researchLinePath(pts,item.smoothLine)}"/>${pts.map(([x,y,d])=>{ const v=+(d?.values?.[0]||0), fill=(item.highlightBest&&v===best)?'#16a34a':(item.highlightWorst&&v===worst)?'#dc2626':color; return `${item.useDots?`<circle${d?researchChartTraceAttrs(item,result,d):''} cx="${x}" cy="${y}" r="4" fill="${fill}"><title>${esc((sec?sec+' / ':'')+(d?.label||''))}: ${d?formatResearchValue(d.values[0],item):''}</title></circle>`:''}${item.showValues&&d?`<text x="${x}" y="${Math.max(14,y-8)}" text-anchor="middle" font-size="11" font-weight="700">${formatResearchValue(d.values[0],item)}</text>`:''}${item.showDateLabels&&d&&researchDateLikeLabel(d.label)?`<text x="${x+6}" y="${y+14}" font-size="9" fill="#334155">${esc(researchShortLabel(d.label,item,12))}</text>`:''}`; }).join('')}`; }).join('');
  const labelSvg=labels.map((lab,i)=>researchAxisLabelSvg(xFor(i),h-14,lab,item)).join('');
  const legend=(item.showLegend&&series.length>1)?`<g transform="translate(${plotRight+12},34)"><text x="0" y="-14" font-size="12" font-weight="700">${esc(item.secondaryGroupField||'Legend')}</text>${series.map((s,i)=>`<line x1="0" x2="13" y1="${i*18+6}" y2="${i*18+6}" stroke="${colors[i%colors.length]}" stroke-width="3"/><text x="18" y="${i*18+10}" font-size="11">${esc(researchShortLabel(s,item,24))}</text>`).join('')}</g>`:'';
  return `${researchChartClipNote(data)}<div class="researchChartWrap"><svg class="researchChart" viewBox="0 0 ${w} ${h}" data-research-svg="${item.id}">${researchGridlines(item,p,h,p,plotRight,yFor,min,max)}<line x1="${p}" y1="${h-p}" x2="${plotRight}" y2="${h-p}" stroke="#111827"/><line x1="${p}" y1="${p}" x2="${p}" y2="${h-p}" stroke="#111827"/>${lines}${labelSvg}${researchReferenceLines(item,vals,p,plotRight,yFor)}${legend}</svg></div>`;
}

function researchCorrelation(points){
  if(points.length<2) return {r:0,slope:0,intercept:0};
  const mx=points.reduce((a,p)=>a+p.x,0)/points.length, my=points.reduce((a,p)=>a+p.y,0)/points.length;
  let cov=0,vx=0,vy=0; points.forEach(p=>{ const dx=p.x-mx,dy=p.y-my; cov+=dx*dy; vx+=dx*dx; vy+=dy*dy; });
  const slope=vx?cov/vx:0; return {r:vx&&vy?cov/Math.sqrt(vx*vy):0,slope,intercept:my-slope*mx};
}
function renderResearchScatterChart(item,result){
  let data=researchChartData(item,result).filter(d=>Number.isFinite(+d.xValue)&&Number.isFinite(+d.values?.[0])).map(d=>({...d,x:+d.xValue,y:+d.values[0]}));
  if(!data.length) return '<div class="researchWarn">Scatter plots require a numeric Group / X axis field and numeric Y axis result.</div>';
  const w=900,h=390,p=58,minX=Math.min(...data.map(d=>d.x)),maxX=Math.max(...data.map(d=>d.x)),minY=Math.min(...data.map(d=>d.y)),maxY=Math.max(...data.map(d=>d.y)),x=v=>p+(v-minX)/(maxX-minX||1)*(w-p-25),y=v=>h-p-(v-minY)/(maxY-minY||1)*(h-p-25),fit=researchCorrelation(data), colors=['#b91c1c','#2563eb','#059669','#d97706','#7c3aed','#0891b2'], series=researchChartSeries(data), colorFor=d=>colors[Math.max(0,series.indexOf(d.secondary||''))%colors.length];
  const grid=[0,.25,.5,.75,1].map(t=>{ const xx=p+t*(w-p-25), yy=h-p-t*(h-p-25); return `<line x1="${xx}" x2="${xx}" y1="20" y2="${h-p}" stroke="#e5e7eb"/><line x1="${p}" x2="${w-25}" y1="${yy}" y2="${yy}" stroke="#e5e7eb"/>`; }).join('');
  const points=data.map(d=>`<circle cx="${x(d.x)}" cy="${y(d.y)}" r="5" fill="${colorFor(d)}" opacity=".82" ${researchChartTraceAttrs(item,result,d)}><title>${esc(d.label)}: ${d.x}, ${formatResearchValue(d.y,item)}</title></circle>`).join('');
  const trend=data.length>1?`<line x1="${x(minX)}" y1="${y(fit.intercept+fit.slope*minX)}" x2="${x(maxX)}" y2="${y(fit.intercept+fit.slope*maxX)}" stroke="#111827" stroke-width="2" stroke-dasharray="7 5"/>`:'';
  return `<div class="researchChartStat"><span class="badge">Points: ${data.length.toLocaleString()}</span><span class="badge">Correlation r: ${fit.r.toFixed(3)}</span><span class="badge">Trend slope: ${fit.slope.toFixed(3)}</span></div>${researchChartClipNote(data)}<div class="researchChartWrap"><svg class="researchChart" data-research-svg="${esc(item.id)}" viewBox="0 0 ${w} ${h}">${grid}<line x1="${p}" x2="${w-25}" y1="${h-p}" y2="${h-p}" stroke="#111827"/><line x1="${p}" x2="${p}" y1="20" y2="${h-p}" stroke="#111827"/>${trend}${points}<text x="${w/2}" y="${h-12}" text-anchor="middle" font-size="12" font-weight="800">${esc(researchDisplayFieldLabel(item.groupField,'X value'))}</text><text x="15" y="${h/2}" transform="rotate(-90 15 ${h/2})" text-anchor="middle" font-size="12" font-weight="800">${esc(researchColumnLabel(item,{}))}</text></svg></div>`;
}
function renderResearchHeatmapChart(item,result){
  const data=researchChartData(item,result), xs=researchChartLabels(data), ys=[...new Set(data.map(d=>d.secondary||'(none)'))];
  if(!data.length||!ys.length||ys.length===1&&ys[0]==='(none)') return '<div class="researchWarn">Heatmaps require a secondary group / series field.</div>';
  const values=data.map(d=>+d.values[0]||0), min=Math.min(...values), max=Math.max(...values), cellW=Math.max(42,Math.min(100,760/Math.max(1,xs.length))),cellH=34,pL=150,pT=50,w=pL+xs.length*cellW+25,h=pT+ys.length*cellH+45,shade=v=>{ const t=(v-min)/(max-min||1), b=Math.round(245-150*t), g=Math.round(248-115*t); return `rgb(${Math.round(239-209*t)},${g},${b})`; };
  const cells=data.map(d=>{ const xi=xs.indexOf(d.label),yi=ys.indexOf(d.secondary||'(none)'),v=+d.values[0]||0; return `<g ${researchChartTraceAttrs(item,result,d)}><rect x="${pL+xi*cellW}" y="${pT+yi*cellH}" width="${cellW-2}" height="${cellH-2}" rx="4" fill="${shade(v)}"/><text x="${pL+xi*cellW+(cellW-2)/2}" y="${pT+yi*cellH+21}" text-anchor="middle" font-size="11" fill="${(v-min)/(max-min||1)>.55?'#fff':'#111827'}">${esc(formatResearchValue(v,item))}</text></g>`; }).join('');
  const xLabels=xs.map((v,i)=>`<text x="${pL+i*cellW+cellW/2}" y="42" text-anchor="end" transform="rotate(-35 ${pL+i*cellW+cellW/2} 42)" font-size="10">${esc(researchShortLabel(v,item,18))}</text>`).join(''), yLabels=ys.map((v,i)=>`<text x="${pL-8}" y="${pT+i*cellH+21}" text-anchor="end" font-size="11">${esc(researchShortLabel(v,item,22))}</text>`).join('');
  return `<div class="researchHeatLegend"><span>${formatResearchValue(min,item)}</span><span class="researchHeatRamp"></span><span>${formatResearchValue(max,item)}</span></div>${researchChartClipNote(data)}<div class="researchChartWrap"><svg class="researchChart" data-research-svg="${esc(item.id)}" viewBox="0 0 ${w} ${h}" style="min-width:${Math.max(760,w)}px;height:${Math.max(360,h)}px">${xLabels}${yLabels}${cells}</svg></div>`;
}
function renderResearchBoxChart(item,result){
  const data=researchChartData(item,result).filter(d=>d.box?.count);
  if(!data.length) return '<div class="researchWarn">Box plots require a numeric Y axis field.</div>';
  const w=900,h=390,p=55,min=Math.min(...data.map(d=>d.box.min)),max=Math.max(...data.map(d=>d.box.max)),y=v=>h-p-(v-min)/(max-min||1)*(h-p-25),step=(w-p-20)/Math.max(1,data.length),boxes=data.map((d,i)=>{ const cx=p+i*step+step/2,b=d.box,bw=Math.min(38,step*.55); return `<g ${researchChartTraceAttrs(item,result,d)}><line x1="${cx}" x2="${cx}" y1="${y(b.min)}" y2="${y(b.max)}" stroke="#334155"/><line x1="${cx-bw/3}" x2="${cx+bw/3}" y1="${y(b.min)}" y2="${y(b.min)}" stroke="#334155"/><line x1="${cx-bw/3}" x2="${cx+bw/3}" y1="${y(b.max)}" y2="${y(b.max)}" stroke="#334155"/><rect x="${cx-bw/2}" y="${y(b.q3)}" width="${bw}" height="${Math.max(2,y(b.q1)-y(b.q3))}" fill="#bfdbfe" stroke="#1d4ed8"/><line x1="${cx-bw/2}" x2="${cx+bw/2}" y1="${y(b.median)}" y2="${y(b.median)}" stroke="#991b1b" stroke-width="2"/><title>${esc(d.label)}: min ${b.min}, Q1 ${b.q1}, median ${b.median}, Q3 ${b.q3}, max ${b.max}</title><text x="${cx}" y="${h-18}" text-anchor="end" transform="rotate(-35 ${cx} ${h-18})" font-size="10">${esc(researchShortLabel(d.label,item,16))}</text></g>`; }).join('');
  return `${researchChartClipNote(data)}<div class="researchChartWrap"><svg class="researchChart" data-research-svg="${esc(item.id)}" viewBox="0 0 ${w} ${h}"><line x1="${p}" x2="${p}" y1="20" y2="${h-p}" stroke="#111827"/><line x1="${p}" x2="${w-20}" y1="${h-p}" y2="${h-p}" stroke="#111827"/>${boxes}</svg></div>`;
}
function renderResearchPieChart(item,result){
  let data=researchChartData(item,result).filter(d=>(+d.values[0]||0)>0); if(data.length>18) data=data.slice(0,18);
  const total=data.reduce((a,d)=>a+(+d.values[0]||0),0); if(!total) return '<div class="researchWarn">Pie charts require positive grouped values.</div>';
  const colors=['#b91c1c','#2563eb','#059669','#d97706','#7c3aed','#0891b2','#db2777','#65a30d','#475569'],cx=230,cy=190,r=145; let angle=-Math.PI/2;
  const slices=data.map((d,i)=>{ const value=+d.values[0]||0,start=angle,end=angle+value/total*Math.PI*2; angle=end; const x1=cx+r*Math.cos(start),y1=cy+r*Math.sin(start),x2=cx+r*Math.cos(end),y2=cy+r*Math.sin(end),large=end-start>Math.PI?1:0,path=`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`; return `<path d="${path}" fill="${colors[i%colors.length]}" stroke="#fff" stroke-width="2" ${researchChartTraceAttrs(item,result,d)}><title>${esc(d.label)}: ${formatResearchValue(value,item)} (${(value/total*100).toFixed(1)}%)</title></path>`; }).join('');
  const legend=data.map((d,i)=>`<g><rect x="470" y="${35+i*18}" width="12" height="12" fill="${colors[i%colors.length]}"/><text x="489" y="${46+i*18}" font-size="11">${esc(researchShortLabel(d.label,item,28))} (${((+d.values[0]||0)/total*100).toFixed(1)}%)</text></g>`).join('');
  return `<div class="researchChartWrap"><svg class="researchChart" data-research-svg="${esc(item.id)}" viewBox="0 0 900 390">${slices}${legend}</svg></div>`;
}
function renderResearchHistogramChart(item,result){
  return `<div class="researchChartStat"><span class="badge">Histogram of ${esc(researchDisplayFieldLabel(item.valueField||item.groupField,'Value'))}</span><span class="badge">Buckets: ${(result.data||[]).length.toLocaleString()}</span></div>`+renderResearchBarChart({...item,barOrientation:'vertical',rotateLabels:true,showValues:true},result);
}
function registerResearchCanvasChart(item,result,data){
  const token='rc_'+id(); state.researchCanvasCharts=state.researchCanvasCharts instanceof Map?state.researchCanvasCharts:new Map();
  boundedMapSet(state.researchCanvasCharts,token,{item:{...item},result,data:[...data]},80);
  if(result.perf) result.perf.renderer='Canvas';
  return `<span class="researchRendererBadge">Canvas · ${data.length.toLocaleString()} marks</span>${researchChartClipNote(data)}<div class="researchChartWrap"><canvas class="researchCanvasChart" data-research-canvas="${esc(token)}" data-research-canvas-item="${esc(item.id||'')}" role="img" aria-label="${esc(item.title||item.outputType+' chart')}"></canvas></div><div class="hint">Hover for exact values; click a mark for its calculation drilldown.</div>`;
}
function researchCanvasColor(index){ return ['#b91c1c','#2563eb','#059669','#d97706','#7c3aed','#0891b2','#db2777','#65a30d'][Math.max(0,index)%8]; }
function drawResearchCanvasChart(canvas,config){
  const {item,result}=config, data=config.data||[], rect=canvas.getBoundingClientRect(), width=Math.max(760,Math.round(rect.width||900)), height=390, ratio=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  canvas.width=Math.round(width*ratio); canvas.height=Math.round(height*ratio); const ctx=canvas.getContext('2d'); if(!ctx) return; ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,width,height); ctx.fillStyle='#fff'; ctx.fillRect(0,0,width,height);
  const pL=58,pR=24,pT=24,pB=55,plotW=width-pL-pR,plotH=height-pT-pB, values=data.map(d=>Number(d.values?.[0])||0), minY=item.axisMin!==''?Number(item.axisMin):Math.min(0,...values), maxY=item.axisMax!==''?Number(item.axisMax):Math.max(1,...values), yFor=v=>pT+plotH-(Number(v)-minY)/(maxY-minY||1)*plotH, hits=[], series=researchChartSeries(data);
  ctx.strokeStyle='#e5e7eb'; ctx.fillStyle='#64748b'; ctx.font='10px system-ui'; ctx.textAlign='right';
  for(let i=0;i<=4;i++){ const y=pT+i*plotH/4,v=maxY-(maxY-minY)*i/4; ctx.beginPath(); ctx.moveTo(pL,y); ctx.lineTo(width-pR,y); ctx.stroke(); ctx.fillText(formatResearchValue(v,item),pL-6,y+3); }
  ctx.strokeStyle='#111827'; ctx.beginPath(); ctx.moveTo(pL,pT); ctx.lineTo(pL,height-pB); ctx.lineTo(width-pR,height-pB); ctx.stroke();
  if(item.outputType==='scatter'){
    const points=data.map(d=>({d,x:Number(d.xValue),y:Number(d.values?.[0])})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)), minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),xFor=v=>pL+(v-minX)/(maxX-minX||1)*plotW;
    points.forEach(point=>{ const x=xFor(point.x),y=yFor(point.y); ctx.fillStyle=researchCanvasColor(series.indexOf(point.d.secondary||'')); ctx.beginPath(); ctx.arc(x,y,3.5,0,Math.PI*2); ctx.fill(); hits.push({x:x-6,y:y-6,w:12,h:12,d:point.d}); });
  }else if(item.outputType==='heatmap'){
    const xs=researchChartLabels(data),ys=[...new Set(data.map(d=>d.secondary||'(none)'))],cellW=plotW/Math.max(1,xs.length),cellH=plotH/Math.max(1,ys.length),lo=Math.min(...values),hi=Math.max(...values);
    data.forEach(d=>{ const x=pL+xs.indexOf(d.label)*cellW,y=pT+ys.indexOf(d.secondary||'(none)')*cellH,t=((Number(d.values?.[0])||0)-lo)/(hi-lo||1); ctx.fillStyle=`rgb(${Math.round(239-209*t)},${Math.round(248-115*t)},${Math.round(245-150*t)})`; ctx.fillRect(x,y,Math.max(1,cellW-.5),Math.max(1,cellH-.5)); hits.push({x,y,w:cellW,h:cellH,d}); });
  }else if(item.outputType==='line'){
    const labels=researchChartLabels(data), xFor=i=>pL+i*plotW/Math.max(1,labels.length-1), lines=result.hasSecondary?series:[''];
    lines.forEach((seriesName,si)=>{ ctx.strokeStyle=researchCanvasColor(si); ctx.lineWidth=2; ctx.beginPath(); let started=false; labels.forEach((label,i)=>{ const d=result.hasSecondary?data.find(v=>v.label===label&&(v.secondary||'')===seriesName):data.find(v=>v.label===label),x=xFor(i),y=yFor(d?.values?.[0]||0); if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y); if(d) hits.push({x:x-5,y:y-5,w:10,h:10,d}); }); ctx.stroke(); });
  }else{
    const step=plotW/Math.max(1,data.length),barW=Math.max(1,step*.78),zero=yFor(0); data.forEach((d,i)=>{ const v=Number(d.values?.[0])||0,x=pL+i*step+(step-barW)/2,y=yFor(v),top=Math.min(y,zero),h=Math.max(1,Math.abs(zero-y)); ctx.fillStyle=researchCanvasColor(series.indexOf(d.secondary||'')); ctx.fillRect(x,top,barW,h); hits.push({x,y:top,w:barW,h,d}); });
  }
  const locate=e=>{ const b=canvas.getBoundingClientRect(),x=(e.clientX-b.left)*(width/b.width),y=(e.clientY-b.top)*(height/b.height); return hits.find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h); };
  canvas.onmousemove=e=>{ const hit=locate(e); canvas.title=hit?`${hit.d.panel?hit.d.panel+' · ':''}${hit.d.secondary?hit.d.label+' / '+hit.d.secondary:hit.d.label}: ${formatResearchValue(hit.d.values?.[0],item)}`:''; canvas.style.cursor=hit?'pointer':'default'; };
  canvas.onclick=e=>{ const hit=locate(e); if(!hit) return; const col=(result.columns||[])[0]||{}, token=researchDrilldownToken(item,hit.d,0,col,hit.d.values?.[0],formatResearchValue(hit.d.values?.[0],item)); openResearchCellDrilldown(token); };
}
function bindResearchCanvasCharts(root=els.researchCanvas){
  root?.querySelectorAll?.('[data-research-canvas]').forEach(canvas=>{ const config=state.researchCanvasCharts?.get(canvas.dataset.researchCanvas); if(config) drawResearchCanvasChart(canvas,config); });
}
function renderResearchVisualization(item,result){
  if(item.panelField){
    const panels=[...new Set((result.data||[]).map(d=>d.panel||'(blank)'))];
    if(panels.length>1){ const html=`<div class="researchSmallMultiples">${panels.map(panel=>`<section class="researchPanelChart"><h4>${esc(panel)}</h4>${renderResearchVisualization({...item,panelField:''},{...result,data:(result.data||[]).filter(d=>(d.panel||'(blank)')===panel)})}</section>`).join('')}</div>`; if(result.perf) result.perf.renderer=`Small multiples / ${panels.some(panel=>(result.data||[]).filter(d=>(d.panel||'(blank)')===panel).length>RESEARCH_SVG_MARK_LIMIT)?'Canvas':'SVG'}`; return html; }
  }
  const chartData=researchChartData(item,result), canvasTypes=['bar','line','scatter','heatmap','histogram'];
  if(canvasTypes.includes(item.outputType)&&chartData.length>RESEARCH_SVG_MARK_LIMIT) return registerResearchCanvasChart(item,result,chartData);
  if(result.perf) result.perf.renderer='SVG';
  if(item.outputType==='scatter') return renderResearchScatterChart(item,result);
  if(item.outputType==='histogram') return renderResearchHistogramChart(item,result);
  if(item.outputType==='heatmap') return renderResearchHeatmapChart(item,result);
  if(item.outputType==='box') return renderResearchBoxChart(item,result);
  if(item.outputType==='pie') return renderResearchPieChart(item,result);
  if(item.outputType==='line') return renderResearchLineChart(item,result);
  return renderResearchBarChart(item,result);
}

async function renderResearchFoundPreview(){
  if(!els.researchFoundPreview) return;
  const item=effectiveResearchItem(currentResearchItemFromEditor());
  const chunkSize=900;
  const cancelToken=state.researchPreviewCancel={cancelled:false,scanned:0};
  els.researchFoundPreview.classList.remove('hidden');
  els.researchFoundPreview.innerHTML='<div class="researchPreviewSummary"><span class="badge">Preview Found is scanning in chunks...</span><button class="smallBtn red" type="button" data-research-preview-stop>End Here</button></div>';
  els.researchFoundPreview.querySelector('[data-research-preview-stop]').onclick=()=>{ cancelToken.cancelled=true; };
  try{
    showProgress('Preview Found: preparing only the required sources...', 2);
    if(!cancelToken.cancelled) await ensureResearchExecutionIndexes(item,{token:cancelToken});
    const raw=researchSourceRowsForItem(item); const hs=getResearchHeaders(item.source);
    const planned=buildQueryPlan(item.source,{dateColumn:item.dateColumn,startDate:item.startDate,endDate:item.endDate,filters:item.filters||[],item,groupFields:[item.groupField,item.secondaryGroupField,item.panelField],valueFields:[item.valueField,...(item.columns||[]).map(c=>c.field)],customExpressions:[item.groupExpression,item.numeratorExpression,item.denominatorExpression]});
    let rows=[]; const plannedRows=planned.rows||[]; cancelToken.scanned=planned.plan?.initialRows||raw.length;
    for(let i=0;i<plannedRows.length;i+=chunkSize){
      if(cancelToken.cancelled) break;
      rows.push(...plannedRows.slice(i,i+chunkSize));
      updateProgress(`Preview Found: preparing optimized candidates (${Math.min(i+chunkSize,plannedRows.length).toLocaleString()}/${plannedRows.length.toLocaleString()})`, 35 + 55*Math.min(1,(i+chunkSize)/Math.max(1,plannedRows.length)));
      await yieldToBrowser();
    }
    if(!cancelToken.cancelled){
      rows=applyResearchGearRowFilters(rows,item,[]);
      if((item.guidedConditions||[]).some(guidedValidCondition)) rows=applyGuidedConditionsToRows(rows,item);
    }
    updateProgress('Preview Found: preparing preview table', 96);
    await yieldToBrowser();
    const active=(item.filters||[]).filter(f=>f.expression||f.field||f.targetValue||f.include==='includeWithin'||f.include==='excludeWithin').length;
    const activeConditions=(item.guidedConditions||[]).filter(guidedValidCondition);
    const outCols=(item.columns||[]).filter(c=>c.field).map(c=>c.field);
    const base=[item.source==='documented_coaching'?'Associate name':'Associate Name','Agent Name','Representative','Job Coach','Coach Assigned','Team',item.dateColumn,'Date','Interaction Start Time','Assigned Date'].filter(Boolean);
    const filterCols=[...(item.filters||[]).map(f=>f.field||f.targetValueColumn),...activeConditions.map(c=>c.field)].filter(Boolean);
    const cols=[]; [...base,'Source','Matched / filter column','Matched value',...filterCols,...outCols].forEach(c=>{ if(c&&!cols.includes(c)) cols.push(c); });
    const shown=rows.slice(0,100);
    const repVals=[...new Set(rows.map(r=>r._rep||r['Agent Name']||r['Associate Name']||r['Associate name']).filter(Boolean))].slice(0,25);
    const teamVals=[...new Set(rows.map(researchRowTeam).filter(Boolean))].slice(0,25);
    const rowHtml=shown.map(r=>`<tr>${cols.map(c=>{ let v=''; if(c==='Source') v=labelSource(item.source); else if(c==='Matched / filter column') v=filterCols.join(', '); else if(c==='Matched value') v=filterCols.map(fc=>researchFieldValue(r,fc,item.source)).filter(x=>String(x).trim()).join(' | '); else v=researchFieldValue(r,c,item.source); return `<td><div class="cellScroll">${esc(v??'')}</div></td>`; }).join('')}</tr>`).join('');
    els.researchFoundPreview.classList.remove('hidden');
    els.researchFoundPreview.innerHTML=`${cancelToken.cancelled?'<div class="researchWarn">Preview stopped early. Showing partial results found so far.</div>':''}${queryPlanBadge(planned.plan)}<div class="researchPreviewSummary"><span class="badge">Rows scanned: ${(cancelToken.scanned||raw.length).toLocaleString()}</span><span class="badge">Matching rows: ${rows.length}</span><span class="badge">Showing first ${shown.length}${rows.length>100?' of 100':''}</span><span class="badge">Source: ${esc(labelSource(item.source))}</span><span class="badge">Population filters: ${active}</span><span class="badge">Qualifying conditions: ${activeConditions.length}</span></div><div class="hint"><strong>Coach/team preview:</strong> ${esc(teamVals.join(', ')||'none')}<br><strong>Representative preview:</strong> ${esc(repVals.join(', ')||'none')}</div><div class="researchTableWrap"><table class="researchConversationTable compact wrapText"><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rowHtml||`<tr><td colspan="${cols.length||1}">No rows matched.</td></tr>`}</tbody></table></div>`;
    updateProgress('Preview Found complete',100);
    await yieldToBrowser();
  }catch(e){
    els.researchFoundPreview.classList.remove('hidden');
    els.researchFoundPreview.innerHTML=`<div class="researchWarn">${esc(e.message||e)}</div>`;
  }finally{
    hideProgress();
  }
}

function researchProcessingStepCount(item){
  let n=0;
  if(item.dateColumn&&(item.startDate||item.endDate)) n++;
  n+=(item.filters||[]).filter(f=>f.expression||f.field||f.targetValue||f.include==='includeWithin'||f.include==='excludeWithin').length;
  n+=(item.guidedConditions||[]).filter(guidedValidCondition).length;
  if(Object.keys(item.gearFilters||{}).length) n++;
  if(item.useSecondaryGroup&&item.secondaryGroupField) n++;
  if((item.columns||[]).length>1 || (item.columns||[]).some(c=>['percent_total','percent_parent','percent_item','date_within','date_percent_within','value_within','value_percent_within','percent','sum','avg','min','max','model','expression'].includes(c.mode))) n++;
  if(['percent_total','percent_parent','percent_item','date_within','date_percent_within','value_within','value_percent_within','percent','model'].includes(item.valueMode)) n++;
  if(item.outputType==='bar'||item.outputType==='line') n++;
  return n;
}
function shouldChunkResearchQuery(item,rowCount){ return Number(rowCount)>1000 && researchProcessingStepCount(item)>1; }
function researchStoredResultValid(item){ return !!(item&&item.renderedResult&&item.renderedResult.outputType===item.outputType&&(item.renderedResult.result||item.renderedResult.storedIn==='indexedDB'||item.renderedResult.id)); }
function researchNoStoredResultBody(item){ return `<div class="researchEmpty"><strong>No rendered result saved. Click Refresh or Render All to calculate this output.</strong><div class="hint">Research formulas will not run automatically while opening, switching tabs, or selecting this saved item.</div><button class="smallBtn green" data-research-refresh="${esc(item.id)}">Refresh / Re-run</button></div>`; }
function researchLoadingStoredBody(label='Rendering output...', detail=''){ return `<div class="researchEmpty"><div class="loadingTitle">${esc(label)}</div><div class="hint">${esc(detail)}</div></div>`; }

function researchCompactColumnForStorage(item,c){ return {label:c?.label||'',displayTitle:researchColumnDisplayTitle(item,c)||c?.label||c?.mode||'Value',mode:c?.mode||'',field:c?.field||'',measureId:c?.measureId||researchMeasureIdFromRef(c?.field),missingBehavior:c?.missingBehavior||item.missingBehavior||'missing',showAsPercent:!!c?.showAsPercent,formatRules:c?.formatRules||[],displayRules:c?.displayRules||[],elseDisplay:c?.elseDisplay||''}; }
function researchCellPresentationSnapshot(value,item,col,rows=[],ctx={},warnings=[]){ const pres=researchColumnCellPresentation(value,item,col,rows,ctx,warnings); return {raw:value,text:pres.text,html:pres.html,style:pres.style||''}; }
function researchCompactRenderedResult(item,result){
  console.time('[Research Builder] compact result save');
  const source=clonePlain(result||{}), renderedAt=new Date().toISOString(), columns=(source.columns||[]).map(c=>researchCompactColumnForStorage(item,c));
  const compact={valueOnly:true,version:4,outputType:item.outputType,title:item.title||'',renderedAt,joinDiagnostics:source.joinDiagnostics||null,reconciliation:source.reconciliation||null,perf:source.perf?{...source.perf,warnings:undefined}:null,warnings:(source.warnings||[]).map(String).slice(0,25),columns,hasSecondary:!!source.hasSecondary,rowCount:0,columnCount:columns.length,display:{showValues:!!item.showValues,showLegend:item.showLegend!==false,showGridlines:item.showGridlines!==false,barOrientation:item.barOrientation||'vertical',stackedBars:!!item.stackedBars,groupedBars:item.groupedBars!==false,axisMin:item.axisMin??'',axisMax:item.axisMax??'',rotateLabels:!!item.rotateLabels,wrapLabels:item.wrapLabels!==false,smoothLine:!!item.smoothLine,useDots:item.useDots!==false,showPercent:!!item.showPercent,decimals:item.decimals??1,panelField:item.panelField||''}};
  if(item.outputType==='table'){
    compact.data=(source.data||[]).map(r=>({label:r.label??'',secondary:r.secondary??'',panel:r.panel??'',values:[...(r.values||[])],cells:(r.values||[]).map((v,i)=>researchCellPresentationSnapshot(v,item,(source.columns||[])[i]||{},[],{},source.warnings||[])),rows:Number(r.rows||0),dateValue:r.dateValue||0}));
    compact.totalValues=Array.isArray(source.totalValues)?[...source.totalValues]:[];
    compact.totalCells=compact.totalValues.map((v,i)=>researchCellPresentationSnapshot(v,item,(source.columns||[])[i]||{},[],{},source.warnings||[]));
    compact.rowCount=compact.data.length;
  }else if(item.outputType==='conversation'){
    compact.rows=[]; compact.rowCount=0; compact.message='Conversation Viewer results are not stored as row payloads. Click Refresh to regenerate.';
  }else{
    compact.data=(source.data||[]).map(r=>({label:r.label??'',secondary:r.secondary??'',panel:r.panel??'',values:[...(r.values||[])],xValue:r.xValue,box:r.box?{...r.box}:undefined,rows:Number(r.rows||0),dateValue:r.dateValue||0}));
    compact.labels=[...new Set(compact.data.map(d=>d.label))];
    compact.series=[...new Set(compact.data.map(d=>d.secondary||''))]; compact.panels=[...new Set(compact.data.map(d=>d.panel||''))];
    compact.chartType=item.outputType; compact.rowCount=compact.data.length;
  }
  console.timeEnd('[Research Builder] compact result save');
  return compact;
}

function researchSerializableResult(result){ return clonePlain(result||{}); }
function researchRenderedDb(){
  if(!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  if(state.researchRenderedDbPromise) return state.researchRenderedDbPromise;
  state.researchRenderedDbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(RESEARCH_RENDER_DB,1);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(RESEARCH_RENDER_META_STORE)) db.createObjectStore(RESEARCH_RENDER_META_STORE,{keyPath:'itemId'}); if(!db.objectStoreNames.contains(RESEARCH_RENDER_CHUNK_STORE)) db.createObjectStore(RESEARCH_RENDER_CHUNK_STORE,{keyPath:'id'}); };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Unable to open Research rendered results storage.'));
  });
  return state.researchRenderedDbPromise;
}
function researchIdbReq(req){ return new Promise((resolve,reject)=>{ req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function researchRenderedResultPut(item,result,renderedAt){
  const db=await researchRenderedDb(), itemId=item.id, data=clonePlain(result||{}), rows=Array.isArray(data.data)?data.data:(Array.isArray(data.rows)?data.rows:[]);
  let oldMeta=null; try{ const oldTx=db.transaction(RESEARCH_RENDER_META_STORE,'readonly'); oldMeta=await researchIdbReq(oldTx.objectStore(RESEARCH_RENDER_META_STORE).get(itemId)); }catch(_){ oldMeta=null; }
  const rowProp=Array.isArray(data.data)?'data':(Array.isArray(data.rows)?'rows':'');
  if(rowProp) data[rowProp]=[];
  const meta={itemId,version:2,outputType:item.outputType,resultType:item.outputType,renderedAt,rowCount:rows.length,chunkSize:RESEARCH_RENDER_CHUNK_SIZE,rowProp,columns:data.columns||[],customColumnTitles:(data.columns||[]).map(c=>c.customTitle||c.displayTitle||''),displayColumnNames:(data.columns||[]).map(c=>researchColumnDisplayTitle(item,c)),formatting:(data.columns||[]).map(c=>({formatRules:c.formatRules||[],displayRules:c.displayRules||[],elseDisplay:c.elseDisplay||''})),chartConfig:{outputType:item.outputType,groupField:item.groupField,secondaryGroupField:item.secondaryGroupField,panelField:item.panelField,valueMode:item.valueMode,measureId:item.measureId||researchMeasureIdFromRef(item.valueField)},dataVersion:researchItemCacheKey(item,item.outputType==='conversation'?'raw':'agg'),result:data};
  const tmpId=`${itemId}::tmp::${Date.now()}`;
  let tx=db.transaction([RESEARCH_RENDER_META_STORE,RESEARCH_RENDER_CHUNK_STORE],'readwrite'), metaStore=tx.objectStore(RESEARCH_RENDER_META_STORE), chunkStore=tx.objectStore(RESEARCH_RENDER_CHUNK_STORE);
  await researchIdbReq(metaStore.put({...meta,itemId:tmpId,stagingFor:itemId}));
  for(let i=0;i<rows.length;i+=RESEARCH_RENDER_CHUNK_SIZE){ await researchIdbReq(chunkStore.put({id:`${tmpId}::${Math.floor(i/RESEARCH_RENDER_CHUNK_SIZE)}`,itemId:tmpId,index:Math.floor(i/RESEARCH_RENDER_CHUNK_SIZE),rows:rows.slice(i,i+RESEARCH_RENDER_CHUNK_SIZE)})); }
  await new Promise((resolve,reject)=>{ tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error); });
  tx=db.transaction([RESEARCH_RENDER_META_STORE,RESEARCH_RENDER_CHUNK_STORE],'readwrite'); metaStore=tx.objectStore(RESEARCH_RENDER_META_STORE); const finalChunkStore=tx.objectStore(RESEARCH_RENDER_CHUNK_STORE);
  await researchIdbReq(metaStore.put({...meta,chunkPrefix:tmpId}));
  metaStore.delete(tmpId);
  if(oldMeta?.chunkPrefix && oldMeta.chunkPrefix!==tmpId){ for(let i=0;i<Math.ceil((oldMeta.rowCount||0)/(oldMeta.chunkSize||RESEARCH_RENDER_CHUNK_SIZE));i++) finalChunkStore.delete(`${oldMeta.chunkPrefix}::${i}`); }
  await new Promise((resolve,reject)=>{ tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error); });
}
async function researchRenderedResultGet(itemId){
  console.time('[Research Builder] saved result load');
  try{
    const db=await researchRenderedDb(), tx=db.transaction([RESEARCH_RENDER_META_STORE,RESEARCH_RENDER_CHUNK_STORE],'readonly'), meta=await researchIdbReq(tx.objectStore(RESEARCH_RENDER_META_STORE).get(itemId));
    if(!meta){ console.timeEnd('[Research Builder] saved result load'); return null; }
    const rows=[], chunks=Math.ceil((meta.rowCount||0)/(meta.chunkSize||RESEARCH_RENDER_CHUNK_SIZE)), store=tx.objectStore(RESEARCH_RENDER_CHUNK_STORE), prefix=meta.chunkPrefix||itemId;
    for(let i=0;i<chunks;i++){ const c=await researchIdbReq(store.get(`${prefix}::${i}`)); if(c?.rows) rows.push(...c.rows); }
    const result={...(meta.result||{})}; if(meta.rowProp) result[meta.rowProp]=rows; console.timeEnd('[Research Builder] saved result load'); return result;
  }catch(e){ console.timeEnd('[Research Builder] saved result load'); console.warn('[Research Builder] unable to load rendered result',e); return null; }
}
async function clearStoredResearchRenderedResults(){
  if(!confirm('Clear stored rendered Research results? Formulas and item settings will be kept.')) return;
  const db=await researchRenderedDb(), tx=db.transaction([RESEARCH_RENDER_META_STORE,RESEARCH_RENDER_CHUNK_STORE],'readwrite');
  tx.objectStore(RESEARCH_RENDER_META_STORE).clear(); tx.objectStore(RESEARCH_RENDER_CHUNK_STORE).clear();
  await new Promise((resolve,reject)=>{ tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); });
  (state.researchItems||[]).forEach(i=>delete i.renderedResult); saveResearchItems(); renderResearchCanvasAsync({reason:'clear-rendered'});
}
async function migrateLegacyResearchRenderedResults(){
  let changed=false;
  for(const item of (state.researchItems||[])){
    if(item.renderedResult?.version===1&&item.renderedResult.result){
      await researchRenderedResultPut(item,item.renderedResult.result,item.renderedResult.renderedAt||new Date().toISOString());
      item.renderedResult={version:2,outputType:item.outputType,renderedAt:item.renderedResult.renderedAt,id:item.id,storedIn:'indexedDB'};
      changed=true;
    }
  }
  if(changed) persistResearchItemsToLocalStorage();
}
async function researchSaveRenderedResult(item,result){
  const idx=(state.researchItems||[]).findIndex(x=>x.id===item.id);
  if(idx<0) return false;
  const renderedAt=new Date().toISOString();
  try{ await researchRenderedResultPut(item,researchCompactRenderedResult(item,result),renderedAt); state.researchItems[idx].renderedResult={version:2,outputType:item.outputType,renderedAt,id:item.id,storedIn:'indexedDB'}; persistResearchItemsToLocalStorage(); return true; }
  catch(e){ console.error('[Research Builder] rendered result storage failed',e); persistResearchItemsToLocalStorage(); return false; }
}
async function researchStoredResultBodyAsync(item){
  if(!researchStoredResultValid(item)) return researchNoStoredResultBody(item);
  const result=item.renderedResult?.result || await researchRenderedResultGet(item.id);
  if(!result) return researchNoStoredResultBody(item);
  return researchStoredResultBody({...item,renderedResult:{...item.renderedResult,result}});
}
function renderGuidedSummaryCards(item,res){
  const col=res.columns?.[0]||{}, data=(res.data||[]).slice(0,item.rowLimit||24);
  return `<div class="guidedSummaryCards">${data.map(d=>`<div class="guidedSummaryCard"><strong>${esc(d.label||'Overall')}${d.secondary?` • ${esc(d.secondary)}`:''}</strong><span>${formatResearchValue(d.values?.[0],item,col)}</span></div>`).join('')||'<div class="researchWarn">No matching results.</div>'}</div>`;
}
function renderResearchResultByDisplay(item,res){
  if(item.guidedDisplay==='summary_cards') return renderGuidedSummaryCards(item,res);
  if(item.guidedDisplay==='table_chart') return `${renderResearchVisualization(item,res)}<div style="margin-top:12px">${renderResearchTable(item,res)}</div>`;
  return item.outputType==='conversation'?renderResearchConversationViewer(item,res):(item.outputType==='table'?renderResearchTable(item,res):renderResearchVisualization(item,res));
}
function researchStoredResultBody(item){
  if(!researchStoredResultValid(item)) return researchNoStoredResultBody(item);
  try{
    resetExpressionRunStats();
    const domStart=performance.now(), stored=item.renderedResult.result||{}, warns=(stored.warnings||[]).map(w=>`<div class="researchWarn">${esc(w)}</div>`).join('');
    const dup=stored.duplicateMap, dupBadge=(dup?.enabled&&(dup.excludedCount||dup.excludedRepKeys?.length))?`<div class="researchDiag">Duplicate rep filter applied: ${Number(dup.excludedCount||dup.excludedRepKeys?.length||0).toLocaleString()} duplicate records excluded</div>`:'';
    const stamp=item.renderedResult.renderedAt?`<div class="hint">Loaded from saved rendered results (${new Date(item.renderedResult.renderedAt).toLocaleString()}).</div>`:'';
    const html=stamp+warns+dupBadge+researchJoinSummaryHtml(stored.joinDiagnostics)+researchPerformanceHtml(item,{...(stored.perf||{}),cacheUsed:true},stored.reconciliation)+renderResearchResultByDisplay(item,stored); console.info('[Research Builder] DOM render time',{item:item.title,ms:Math.round(performance.now()-domStart),valueOnly:!!stored.valueOnly}); return html;
  }catch(e){ return researchFailedBody(e); }
}
function researchCardShell(item,body){
  const size=item.cardSize||'medium';
  return `<div class="researchCard ${item.collapsed?'collapsed':''}" data-size="${esc(size)}" data-research-card="${item.id}"><div class="researchCardHead"><div><div class="researchCardTitle">${esc(item.title)}</div><div class="researchBadges"><span class="badge">${esc(item.outputType)}</span><span class="badge">${esc(labelSource(item.source)||item.source)}</span><span class="badge">${esc(item.mode||'direct')}</span><span class="badge">${esc(size)}</span></div></div><div class="researchActions"><button class="smallBtn green" data-research-refresh="${item.id}">Refresh / Re-run</button><button class="smallBtn" data-research-size="${item.id}" data-size="large">Expand</button><button class="smallBtn" data-research-size="${item.id}" data-size="small">Shrink</button><button class="smallBtn" data-research-size="${item.id}" data-size="full">Full Width</button><button class="smallBtn" data-research-collapse="${item.id}">${item.collapsed?'Show Body':'Collapse Body'}</button><button class="smallBtn" data-research-move="${item.id}" data-dir="up">↑</button><button class="smallBtn" data-research-move="${item.id}" data-dir="down">↓</button><button class="smallBtn" data-research-move="${item.id}" data-dir="left">←</button><button class="smallBtn" data-research-move="${item.id}" data-dir="right">→</button><button class="smallBtn" data-research-edit="${item.id}">Edit</button><button class="smallBtn" data-research-data="${item.id}">Export Data</button>${['line','bar','scatter','histogram','heatmap','box','pie'].includes(item.outputType)?`<button class="smallBtn" data-research-image="${item.id}">Export Image</button>`:''}<button class="smallBtn red" data-research-delete="${item.id}">Delete</button></div></div><div class="researchCardBody">${body}</div></div>`;
}
function researchLargePlaceholder(item){ return `<div class="researchEmpty"><strong>Large research item — click Render to calculate.</strong><div class="hint">This card uses ${researchSourceRowsForItem(item).length.toLocaleString()} primary-source rows and multiple processing steps, so it will not auto-render when Research opens. Clicking Render prepares only the sources referenced by this item.</div><button class="smallBtn green" data-research-render="${esc(item.id)}">Render</button></div>`; }
function researchCachedPlaceholder(item){ return `<div class="researchEmpty"><strong>Pre-indexed and ready.</strong><div class="hint">This large research item was calculated in the background. Click Render to display it from cache without re-scanning the source data.</div><button class="smallBtn green" data-research-render="${esc(item.id)}">Render from Cache</button></div>`; }
function researchQueuedPlaceholder(item){ return `<div class="researchEmpty"><strong>Research item not rendered.</strong><div class="hint">Render All was stopped before this card finished. Click Render to calculate this card only.</div><button class="smallBtn green" data-research-render="${esc(item.id)}">Render</button></div>`; }
function researchLoadingBody(){ return '<div class="researchPreviewSummary"><span class="badge">Queued for safe render...</span></div>'; }
function researchCanvasStatus(message){ return `<div class="researchPreviewSummary" data-research-status><span class="badge">${esc(message)}</span></div>`; }
function setResearchCanvasStatus(message){ const box=els.researchCanvas?.querySelector('[data-research-status]'); if(box) box.innerHTML=`<span class="badge">${esc(message)}</span>`; else if(els.researchCanvas) els.researchCanvas.insertAdjacentHTML('afterbegin', researchCanvasStatus(message)); }
function setResearchRenderAllRunning(running){ if(els.renderAllResearchBtn){ els.renderAllResearchBtn.classList.toggle('hidden', !!running); els.renderAllResearchBtn.disabled=!!running; } if(els.stopResearchRenderBtn) els.stopResearchRenderBtn.classList.toggle('hidden', !running); }
function cancelResearchRenderAll(message){ if(state.researchRenderAllToken) state.researchRenderAllToken.cancelled=true; setResearchRenderAllRunning(false); if(message) setResearchCanvasStatus(message); }
async function waitResearchRenderCheckpoints(item,token,idx,total){ const rowCount=researchSourceRowsForItem(item).length, chunkSize=1000, chunks=Math.max(1,Math.ceil(rowCount/chunkSize)); if(rowCount<=1000){ setResearchCanvasStatus(`Rendering ${idx+1} of ${total}...`); await yieldToBrowser(); return; } for(let c=0;c<chunks;c++){ if(token.cancelled) return; setResearchCanvasStatus(`Rendering ${idx+1} of ${total}… chunk ${c+1} of ${chunks}`); await yieldToBrowser(); } }
function researchFailedBody(err){ return `<div class="researchPreviewSummary"><span class="badge red">Render failed</span></div><div class="researchWarn">${esc(err?.message||err)}</div>`; }
function newResearchRenderToken(reason){ if(state.researchRenderToken) state.researchRenderToken.cancelled=true; const token={cancelled:false,id:Date.now()+Math.random(),reason:reason||'render'}; state.researchRenderToken=token; return token; }
function currentResearchItemsNormalized(){ const items=(state.researchItems||[]).map(normalizeResearchItem); state.researchItems=items; return items; }
function renderResearchCanvasShell(message){
  if(!els.researchCanvas) return [];
  const items=currentResearchItemsNormalized();
  if(!researchHasAnyData()){ els.researchCanvas.innerHTML='<div class="researchEmpty">No data is imported yet. Import Retail, Referral, QA, Checklist Items, Documented Coaching, or Comp Calls data, then add research items here.</div>'; return []; }
  if(!items.length){ els.researchCanvas.innerHTML='<div class="researchEmpty">No saved research items yet. Click <strong>Add New Item</strong> to create a table, conversation viewer, line graph, or bar graph.</div>'; return []; }
  els.researchCanvas.innerHTML=researchCanvasStatus(message||'Loading research items...')+items.map(item=>researchCardShell(item,researchLoadingBody())).join('');
  bindResearchCanvasActions();
  return items;
}
function renderResearchItemBody(item){
  try{ resetExpressionRunStats(); const computeStart=performance.now(), res=item.outputType==='conversation'?evaluateResearchRawRows(item):evaluateResearchItem(item), renderStart=performance.now(), resultHtml=renderResearchResultByDisplay(item,res); res.perf=res.perf||{}; res.perf.timings=res.perf.timings||{}; res.perf.timings.renderMs=Math.round(performance.now()-renderStart); const warns=(res.warnings||[]).map(w=>`<div class="researchWarn">${esc(w)}</div>`).join(''), dupBadge=(res.duplicateMap?.enabled&&res.duplicateMap.excludedRepKeys?.size)?`<div class="researchDiag" title="Click calculated cells for duplicate details.">Duplicate rep filter applied: ${res.duplicateMap.excludedRepKeys.size.toLocaleString()} duplicate records excluded</div>`:'', html=warns+dupBadge+researchJoinSummaryHtml(res.joinDiagnostics)+queryPlanBadge(res.perf?.queryPlan)+researchPerformanceHtml(item,res.perf,res.reconciliation)+resultHtml+expressionSummaryPanel('Research expression diagnostics'); researchSaveRenderedResult(item,res); recordResearchPerformance(item,res.perf); console.info('[Research Builder]',{item:item.title,cacheUsed:!!res.perf?.cacheUsed,totalComputeTime:res.perf?.totalComputeMs ?? Math.round(renderStart-computeStart),renderTime:res.perf.timings.renderMs,rowsScanned:res.perf?.rowsScanned,indexesUsed:res.perf?.indexesUsed}); return html; }
  catch(e){ return researchFailedBody(e); }
}

function researchWorkerMeasurePlan(item,outputColumns,groupList){
  if(typeof Worker==='undefined'||typeof Blob==='undefined'||!sourceIndex(item.source)?.compact||item.groupMultiAdd||findMetricByRef(item.groupField)||['scatter','histogram','box','conversation'].includes(item.outputType)) return null;
  const rowCount=(groupList||[]).reduce((sum,g)=>sum+(g.rows?.length||0),0); if(rowCount<1200) return null;
  const measures=(outputColumns||[]).map(col=>{ const def=researchTypedMeasureDefinition(col?.measureId||researchMeasureIdFromRef(col?.field)||item.measureId), resolved=resolveResearchTypedMeasure(def,item.source); return {col,def,resolved}; });
  if(!measures.length||measures.some(m=>!m.def||!m.resolved?.compatible||m.resolved.source!==item.source)) return null;
  return {rowCount,measures};
}
async function evaluateResearchTypedWorker(item,groupList,outputColumns,warnings=[]){
  const plan=researchWorkerMeasurePlan(item,outputColumns,groupList); if(!plan) return null;
  const groupIndex=new Uint32Array(plan.rowCount), entityNumbers=new Uint32Array(plan.rowCount), columns=plan.measures.map(({col,resolved})=>{ const a=new Float64Array(plan.rowCount),b=resolved.aggregation==='weighted_rate'?new Float64Array(plan.rowCount):null; a.fill(NaN); if(b)b.fill(NaN); return {aggregation:resolved.aggregation,behavior:col?.missingBehavior||item.missingBehavior||resolved.missingBehavior||'missing',label:resolved.label,a,b,resolved}; }), metas=groupList.map(g=>({label:g.primary,secondary:g.secondary||'',panel:g.panel||'',rows:g.rows?.length||0,dateValue:Number.isFinite(g.dateValue)?g.dateValue:researchSortDateValue(item,g.rows||[])}));
  const idx=sourceIndex(item.source); let offset=0;
  for(let gi=0;gi<groupList.length;gi++) for(const row of (groupList[gi].rows||[])){ groupIndex[offset]=gi; entityNumbers[offset]=idx?.rowMeta?.get?.(row)?.entityNumber||0; columns.forEach(col=>{ if(['sum','avg','min','max'].includes(col.aggregation)) col.a[offset]=evaluateResearchNumericField(row,col.resolved.valueField,item.source); else if(col.aggregation==='weighted_rate'){ col.a[offset]=evaluateResearchNumericField(row,col.resolved.numeratorField,item.source); col.b[offset]=evaluateResearchNumericField(row,col.resolved.denominatorField,item.source); } }); offset++; if(offset%2000===0) await yieldToBrowser(); }
  const workerSource=`self.onmessage=e=>{const p=e.data,acc=p.metas.map(()=>({rows:0,cols:p.defs.map(()=>({sum:0,count:0,num:0,den:0,missing:0,unique:new Set()}))}));for(let i=0;i<p.groupIndex.length;i++){const g=acc[p.groupIndex[i]];g.rows++;for(let c=0;c<p.defs.length;c++){const d=p.defs[c],s=g.cols[c],a=p.a[c][i],b=p.b[c]?p.b[c][i]:NaN;if(d.aggregation==='count'){s.count++;continue}if(d.aggregation==='unique_rep'){const u=p.entityNumbers[i];if(u)s.unique.add(u);else s.missing++;continue}if(d.aggregation==='weighted_rate'){if(Number.isFinite(a))s.num+=a;else s.missing++;if(Number.isFinite(b))s.den+=b;else s.missing++;continue}if(Number.isFinite(a)){s.sum+=a;s.count++}else{s.missing++;if(d.behavior==='zero')s.count++}}}const data=p.metas.map((m,g)=>{const values=p.defs.map((d,c)=>{const s=acc[g].cols[c];if(d.aggregation==='count')return s.count;if(d.aggregation==='unique_rep')return s.unique.size;if(d.aggregation==='weighted_rate')return s.den?s.num/s.den*100:(p.zeroBlank?null:0);if(d.aggregation==='avg')return s.count?s.sum/s.count:(d.behavior==='missing'?null:0);return s.sum});return {...m,values}}),missing=p.defs.map((d,c)=>acc.reduce((n,g)=>n+g.cols[c].missing,0));self.postMessage({data,missing})}`;
  const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})), worker=new Worker(url), started=performance.now();
  try{
    const transfer=[groupIndex.buffer,entityNumbers.buffer], a=columns.map(c=>{transfer.push(c.a.buffer);return c.a;}), b=columns.map(c=>{if(c.b)transfer.push(c.b.buffer);return c.b;});
    const result=await new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error('Research worker timed out and will fall back.')),60000); worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);}; worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message||'Research worker failed'));}; worker.postMessage({groupIndex,entityNumbers,a,b,metas,defs:columns.map(c=>({aggregation:c.aggregation,behavior:c.behavior})),zeroBlank:item.zeroDenominator==='blank'},transfer); });
    result.missing.forEach((count,i)=>{ if(count&&columns[i].behavior==='warn') warnings.push(`${columns[i].label}: ${count.toLocaleString()} blank/non-numeric inputs were excluded by the worker aggregation.`); });
    return {data:result.data,workerMs:Math.round(performance.now()-started)};
  }catch(error){ console.warn('[Research Builder] Worker aggregation fell back to the main thread',error); return null; }
  finally{ worker.terminate(); URL.revokeObjectURL(url); }
}

async function evaluateResearchItemAsync(item, progress={}){
  progress={start:0,end:100,status:false,...progress};
  item=effectiveResearchItem(normalizeResearchItem(item));
  const cacheKey=researchItemCacheKey(item,'agg'), cached=researchCacheGet(cacheKey); if(cached) return cached;
  const t0=performance.now(), perf={rowsScanned:0,indexesUsed:[],filters:[],cacheUsed:false,timings:{}};
  const warnings=[]; perf.warnings=warnings; attachResearchRuntime(item,warnings);
  const report=(done,total,stage='Processing research table',stageStart=.34,stageEnd=.94,unit='rows')=>{
    const safeTotal=Math.max(1,total||0), fraction=Math.min(1,Math.max(0,(done||0)/safeTotal)), local=stageStart+(stageEnd-stageStart)*fraction, pct=progress.start+(progress.end-progress.start)*local, text=`${stage}... ${(done||0).toLocaleString()} / ${(total||0).toLocaleString()} ${unit}`;
    if(progress.token) updateResearchProgress(progress.token,text,pct,{force:true});
    else updateProgress(text,pct,{force:true});
    if(progress.status) setResearchCanvasStatus(text);
  };
  const primaryImported=(getRowsRaw(item.source)||[]).length;
  report(0,primaryImported,`Filtering primary source ${labelSource(item.source)}`,0,.10);
  let planned=buildQueryPlan(item.source,{dateColumn:item.dateColumn,startDate:item.startDate,endDate:item.endDate,filters:item.filters||[],item,groupFields:[item.groupField,item.secondaryGroupField,item.panelField],valueFields:[item.valueField,item.percentOfField,item.withinCompareField,...(item.columns||[]).flatMap(c=>[c.field,c.percentOfField,c.withinCompareField])].filter(Boolean),customExpressions:[item.groupExpression,item.numeratorExpression,item.denominatorExpression,item.percentOfField]});
  let rows=planned.rows; perf.queryPlan=planned.plan; perf.rowsScanned=planned.plan.initialRows||0; perf.timings.queryPlanMs=Math.round(performance.now()-t0); const cohortStart=performance.now(); perf.indexesUsed.push(...(planned.plan.steps||[]).filter(s=>s.usedIndex).map(s=>s.name)); if(!rows.length && !getRowsRaw(item.source).length) warnings.push('No imported rows for selected source.'); addTeamFilterWarningsForItem(item,warnings); const hs=getResearchHeaders(item.source);
  report(primaryImported,primaryImported,`Primary source filtered to ${rows.length.toLocaleString()} candidate rows`,0,.10);
  [item.dateColumn,item.groupField,item.secondaryGroupField,item.panelField].filter(Boolean).forEach(h=>{ if(researchFieldNeedsHeaderWarning(item,h)) warnings.push('Missing header: '+h); });
  let universeRows=rows.slice();
  rows=applyResearchGearRowFilters(rows,item,warnings);
  const duplicateMap=buildResearchDuplicateRepMap(researchDuplicateRowsBySource(item,rows),item,{warnings});
  rows=applyDuplicateRepFilterToRows(rows,item.source,duplicateMap,{item});
  universeRows=applyDuplicateRepFilterToRows(universeRows,item.source,duplicateMap,{item});
  if(!researchItemUsesGuidedPercentage(item)){
    rows=await applyGuidedQualificationForNonPercentAsync(rows,item,{report:(done,total,stage)=>report(done,total,stage,.10,.23,'individuals/rows')});
    universeRows=await applyGuidedQualificationForNonPercentAsync(universeRows,item,{report:(done,total,stage)=>report(done,total,stage,.23,.34,'individuals/rows')});
  }
  const dupWarn=researchDuplicateWarning(duplicateMap); if(dupWarn) warnings.push(dupWarn);
  const mode=item.valueMode||'count'; if(['date_within','date_percent_within'].includes(mode) && !researchFieldLooksDate(item,item.valueField,rows)) warnings.push('This dates-within mode requires a date field.'); (item.columns||[]).forEach(c=>{ if(['date_within','date_percent_within'].includes(c.mode) && !researchFieldLooksDate(item,c.field,rows) && !warnings.includes('This dates-within mode requires a date field.')) warnings.push('This dates-within mode requires a date field.'); }); if(['sum','avg','min','max','value_within','value_percent_within'].includes(mode)){ const val=researchNumericValidation(item,item.valueField,rows); if(!val.ok) warnings.push(val.message); }
  perf.timings.cohortFilterMs=Math.round(performance.now()-cohortStart); const groupingStart=performance.now();
  const hasSecondary=!!(item.useSecondaryGroup&&item.secondaryGroupField);
  let groups=new Map(), parentTotals=new Map();
  const groupMetric=!item.groupMultiAdd ? findMetricByRef(item.groupField) : null;
  if(item.outputType==='histogram'){
    const built=buildResearchHistogramGroups(item,rows,universeRows,warnings); groups=built.groups; parentTotals=built.parentTotals;
  }else if(item.outputType==='scatter'){
    const built=buildResearchAnalysisGroups(item,rows,universeRows); groups=built.groups; parentTotals=built.parentTotals;
  }else if(item.groupMultiAdd){
    report(0,rows.length,'Grouping research rows',.34,.58);
    const built=buildResearchMultiAddGroups(item,rows,universeRows,warnings); groups=built.groups; parentTotals=built.parentTotals;
    report(rows.length,rows.length,'Grouping research rows',.34,.58); await yieldToBrowser();
  }else if(groupMetric){
    const cfg=researchGearGetForItem(item,'groupField');
    const counts=getMetricEntityCounts(groupMetric,{item,warnings},cfg);
    const bucketOpts=buildMetricBucketOptions(groupMetric,{item,warnings},cfg), selectedBuckets=selectedMetricBucketSet(cfg,bucketOpts.buckets);
    const rowSet=new Set(rows), universeSet=new Set(universeRows);
    let processed=0, totalBuckets=counts.entitiesByBucket.size;
    for(const [bucketEntities,bucket] of [...counts.entitiesByBucket.entries()].map(([bucket,entities])=>[entities,bucket])){
      const bucketSelected=selectedBuckets.has(String(bucket)); if(!conditionResultIsTrue(cfg.conditionResult) ? bucketSelected : !bucketSelected){ processed++; continue; }
      const bucketRows=metricEntityRowsForBucket(item.source,bucketEntities,counts.entityMode,counts.coachMethod,item).filter(r=>rowSet.has(r));
      const bucketUniverse=metricEntityRowsForBucket(item.source,bucketEntities,counts.entityMode,counts.coachMethod,item).filter(r=>universeSet.has(r));
      parentTotals.set(bucket,bucketUniverse.length||bucketRows.length||0);
      for(let i=0;i<bucketRows.length;i++){
        const r=bucketRows[i], sec=hasSecondary?researchSecondaryKey(item,r):'', panel=researchPanelKey(item,r), key=bucket+'\u0000'+sec+'\u0000'+panel; if(!groups.has(key)) groups.set(key,{primary:bucket,secondary:sec,panel,rows:[],dateValue:researchSortDateValue(item,[r])}); groups.get(key).rows.push(r); groups.get(key).dateValue=Math.min(groups.get(key).dateValue||Infinity,researchSortDateValue(item,[r])||Infinity);
        if((i+1)%RESEARCH_BATCH_SIZE===0){ report(i+1,bucketRows.length,`Processing research bucket ${processed+1} of ${totalBuckets}`,.34,.58); await yieldToBrowser(); }
      }
      processed++; report(processed,totalBuckets,'Processing research buckets',.34,.58,'buckets'); await yieldToBrowser();
    }
  }else{
    for(let i=0;i<universeRows.length;i++){ const r=universeRows[i], p=researchGroupLabel(item,r); parentTotals.set(p,(parentTotals.get(p)||0)+1); if((i+1)%RESEARCH_BATCH_SIZE===0){ report(i+1,universeRows.length,'Building group totals',.34,.46); await yieldToBrowser(); } }
    for(let i=0;i<rows.length;i++){ const r=rows[i], p=researchGroupLabel(item,r), sec=hasSecondary?researchSecondaryKey(item,r):'', panel=researchPanelKey(item,r), key=p+'\u0000'+sec+'\u0000'+panel; if(!groups.has(key)) groups.set(key,{primary:p,secondary:sec,panel,rows:[],dateValue:researchSortDateValue(item,[r])}); groups.get(key).rows.push(r); groups.get(key).dateValue=Math.min(groups.get(key).dateValue||Infinity,researchSortDateValue(item,[r])||Infinity); if((i+1)%RESEARCH_BATCH_SIZE===0){ report(i+1,rows.length,'Grouping filtered rows',.46,.58); await yieldToBrowser(); } }
  }
  perf.timings.groupingMs=Math.round(performance.now()-groupingStart); const calculationStart=performance.now();
  const total=universeRows.length||1;
  let groupList=[...groups.values()].filter(g=>Object.keys(item.gearFilters||{}).every(key=>{ const cfg={...researchGearDefault(),...(item.gearFilters||{})[key]}; if(key.startsWith('columnField:') && cfg.valueLevel==='level2') return true; if(!cfg.customValueEnabled||cfg.customValueMetric==='each') return true; const field=researchGearFieldForKey(item,key,+(key.split(':')[1]||0)); if(!field) return true; const bad=researchGearNumericInvalid(cfg,item,field,g.rows); if(bad){ if(!warnings.includes(bad)) warnings.push(bad); return true; } return researchGearGroupPass(g.rows,cfg,item,field); }));
  groupList=researchApplyCalculationScope(groupList,item,warnings); groupList=researchApplyUnmatchedGroupBehavior(groupList,item,warnings);
  const outputColumns=expandedResearchColumns(item);
  await preparePercentBuilderCachesForResearchItem(item,outputColumns,warnings,(done,total,stage)=>report(done,total,stage,.58,.72));
  let data=[], workerResult=await evaluateResearchTypedWorker(item,groupList,outputColumns,warnings);
  if(workerResult){ data=workerResult.data; perf.timings.workerMs=workerResult.workerMs; perf.workerUsed=true; report(groupList.length,groupList.length,'Aggregating typed measures in a Web Worker',.72,.94,'groups'); }
  else for(let i=0;i<groupList.length;i++){
    const g=groupList[i], ctx={total,parentTotal:(parentTotals.get(g.primary)||g.rows.length||1),warnings}, computed=researchGroupOutput(item,g,outputColumns,ctx); data.push({label:g.primary,secondary:g.secondary,panel:g.panel||'',values:computed.values,xValue:computed.xValue,box:computed.box,rows:g.rows.length,dateValue:Number.isFinite(g.dateValue)?g.dateValue:researchSortDateValue(item,g.rows)});
    if((i+1)%RESEARCH_BATCH_SIZE===0){ report(i+1,groupList.length,'Calculating research table groups',.72,.94,'groups'); await yieldToBrowser(); }
  }
  if(item.outputType==='table') data=data.filter(d=>outputColumns.every((c,i)=>{ const v=toNum(d.values?.[i]), hasMin=String(c.resultMin??'').trim()!=='', hasMax=String(c.resultMax??'').trim()!==''; if(hasMin&&(!Number.isFinite(v)||v<Number(c.resultMin))) return false; if(hasMax&&(!Number.isFinite(v)||v>Number(c.resultMax))) return false; return true; }));
  perf.timings.calculationMs=Math.round(performance.now()-calculationStart); const sortingStart=performance.now();
  data=researchSortAndLimitData(data,item,hasSecondary); perf.timings.sortingMs=Math.round(performance.now()-sortingStart);
  const totalValues=(item.outputType==='table'&&item.totals)?outputColumns.map(c=>aggregateResearchValue(item,universeRows,c,{total:universeRows.length||1,parentTotal:universeRows.length||1,warnings})):[];
  const effectiveHasSecondary=hasSecondary || (item.outputType==='line' && item.groupMultiAdd);
  const reconciliation=researchReconciliationResult(item,universeRows,outputColumns,groupList,warnings), prep=state.researchLastPreparation?.itemId===item.id?state.researchLastPreparation:null; perf.groupsCalculated=groupList.length; perf.sourcePreparationMs=prep?.totalMs||0; perf.preparedSources=prep?.sources||[]; perf.totalComputeMs=Math.round(performance.now()-t0); console.info('[Research Builder]',perf); report(1,1,'Finalizing research result',.94,.98,'step'); return researchCacheSet(cacheKey,{valueOnly:true,data,warnings,columns:outputColumns,hasSecondary:effectiveHasSecondary,totalValues,totalRowCount:universeRows.length,duplicateMap,joinDiagnostics:researchJoinStatsSnapshot(item),reconciliation},perf);
}
async function renderResearchItemBodyAsync(item, progress={}){
  try{
    resetExpressionRunStats(); const computeStart=performance.now(), res=item.outputType==='conversation'?evaluateResearchRawRows(item):await evaluateResearchItemAsync(item,progress), renderStart=performance.now(), resultHtml=renderResearchResultByDisplay(item,res);
    res.perf=attachResearchPreparationPerf(res.perf||{},item); res.perf.timings=res.perf.timings||{}; res.perf.timings.renderMs=Math.round(performance.now()-renderStart);
    const persistenceStart=performance.now(), savePromise=researchSaveRenderedResult(item,res);
    const saveWarn='<div class="researchDiag" data-research-save-status>Saving rendered values in the background…</div>', warns=(res.warnings||[]).map(w=>`<div class="researchWarn">${esc(w)}</div>`).join(''), dupBadge=(res.duplicateMap?.enabled&&res.duplicateMap.excludedRepKeys?.size)?`<div class="researchDiag" title="Click calculated cells for duplicate details.">Duplicate rep filter applied: ${res.duplicateMap.excludedRepKeys.size.toLocaleString()} duplicate records excluded</div>`:'', html=saveWarn+warns+dupBadge+researchSourceAuditHtml(item,res.perf,res.joinDiagnostics)+researchJoinSummaryHtml(res.joinDiagnostics)+queryPlanBadge(res.perf?.queryPlan)+researchPerformanceHtml(item,res.perf,res.reconciliation)+resultHtml+expressionSummaryPanel('Research expression diagnostics'), run=recordResearchPerformance(item,res.perf);
    savePromise.then(ok=>{ const ms=Math.round(performance.now()-persistenceStart); run.timings.persistenceMs=ms; res.perf.timings.persistenceMs=ms; renderResearchDiagnosticsDrawer(); document.querySelectorAll(`[data-research-card=\"${CSS.escape(item.id)}\"] [data-research-save-status]`).forEach(n=>n.textContent=ok?`Rendered values saved in ${ms.toLocaleString()} ms.`:'Displayed, but saving rendered values failed.'); });
    console.info('[Research Builder]',{item:item.title,cacheUsed:!!res.perf?.cacheUsed,totalComputeTime:res.perf?.totalComputeMs ?? Math.round(renderStart-computeStart),renderTime:res.perf.timings.renderMs,rowsScanned:res.perf?.rowsScanned,indexesUsed:res.perf?.indexesUsed}); return html;
  }
  catch(e){ return researchFailedBody(e); }
}

function bindResearchCanvasActions(){
  els.researchCanvas.querySelectorAll('[data-research-edit]').forEach(b=>b.onclick=()=>openResearchItemEditor(b.dataset.researchEdit)); els.researchCanvas.querySelectorAll('[data-research-delete]').forEach(b=>b.onclick=()=>deleteResearchItem(b.dataset.researchDelete)); els.researchCanvas.querySelectorAll('[data-research-data]').forEach(b=>b.onclick=()=>exportResearchItemData(b.dataset.researchData)); els.researchCanvas.querySelectorAll('[data-research-image]').forEach(b=>b.onclick=()=>exportResearchItemImage(b.dataset.researchImage)); els.researchCanvas.querySelectorAll('[data-research-size]').forEach(b=>b.onclick=()=>setResearchItemProp(b.dataset.researchSize,{cardSize:b.dataset.size})); els.researchCanvas.querySelectorAll('[data-research-collapse]').forEach(b=>b.onclick=()=>{ const item=state.researchItems.find(x=>x.id===b.dataset.researchCollapse); setResearchItemProp(b.dataset.researchCollapse,{collapsed:!item.collapsed}); }); els.researchCanvas.querySelectorAll('[data-research-move]').forEach(b=>b.onclick=()=>moveResearchItem(b.dataset.researchMove,b.dataset.dir));
  bindResearchConversationViewerActions(els.researchCanvas);
  bindResearchVirtualTables(els.researchCanvas);
  bindResearchCanvasCharts(els.researchCanvas);
  els.researchCanvas.querySelectorAll('[data-trace-id]').forEach(c=>c.onclick=e=>{ e.stopPropagation(); openResearchCellFeedback(c.dataset.traceId); }); els.researchCanvas.querySelectorAll('[data-drilldown-id]:not([data-trace-id])').forEach(c=>c.onclick=e=>{ e.stopPropagation(); openResearchCellDrilldown(c.dataset.drilldownId); });
  els.researchCanvas.querySelectorAll('[data-research-refresh]').forEach(b=>b.onclick=async()=>{ const item=state.researchItems.find(x=>x.id===b.dataset.researchRefresh); if(!item) return; await refreshResearchItem(item.id,b); });
  els.researchCanvas.querySelectorAll('[data-research-render]').forEach(b=>b.onclick=async()=>{ const item=state.researchItems.find(x=>x.id===b.dataset.researchRender); if(!item) return; state.renderedLargeResearchCards.add(item.id); const token={cancelled:false,id:Date.now()+Math.random(),reason:'card-render'}; const card=els.researchCanvas.querySelector(`[data-research-card="${CSS.escape(item.id)}"] .researchCardBody`); const key=researchItemCacheKey(item,item.outputType==='conversation'?'raw':'agg'), cached=researchHasCache(key); if(card) card.innerHTML=`<div class="researchPreviewSummary"><span class="badge">${cached?'Opening cached result...':'Preparing used sources...'}</span></div>`; showProgress(cached?'Opening cached research card...':'Preparing used sources...',5); const prep=await ensureResearchExecutionIndexes(item,{token}); state.researchLastPreparation={itemId:item.id,...prep}; await yieldToBrowser(); updateProgress(cached?'Opening cached result...':'Calculating Research card...',35); await yieldToBrowser(); if(!token.cancelled && card){ const html=await renderResearchItemBodyAsync(item,{start:35,end:85,status:true}); updateProgress('Rendering visible table/chart...',85); await yieldToBrowser(); card.innerHTML=html; } updateProgress('Research card rendered',100); hideProgress(); bindResearchCanvasActions(); updateResearchCacheBadge(); });
}
async function refreshResearchItem(itemId,button){
  const item=state.researchItems.find(x=>x.id===itemId); if(!item) return;
  const card=els.researchCanvas?.querySelector(`[data-research-card="${CSS.escape(item.id)}"] .researchCardBody`);
  const token=beginResearchProgress(`Rendering ${item.outputType}...`,2);
  state.researchRenderToken=token;
  if(button){ button.disabled=true; button.dataset.originalText=button.textContent; button.textContent='⟳ Rendering...'; }
  if(card) card.innerHTML=researchLoadingStoredBody(`Rendering ${item.outputType}...`,'Preparing optimized candidate rows.');
  try{
    updateResearchProgress(token,'Preparing only the sources used by this item...',4);
    const prep=await ensureResearchExecutionIndexes(item,{token,progressToken:token,start:4,end:16});
    state.researchLastPreparation={itemId:item.id,...prep};
    await yieldToBrowser();
    if(!researchProgressActive(token)){ if(card) card.innerHTML=researchQueuedPlaceholder(item); return; }
    const html=await renderResearchItemBodyAsync(item,{start:16,end:92,status:true,token});
    if(!researchProgressActive(token)){ if(card) card.innerHTML=researchQueuedPlaceholder(item); return; }
    updateResearchProgress(token,'Inserting rendered table/chart...',95);
    if(card) card.innerHTML=html;
    bindResearchCanvasActions();
    updateResearchCacheBadge();
    finishResearchProgress(token,'Research item rendered');
    setResearchCanvasStatus(`Refreshed ${item.title||'Research item'} from newly calculated values.`);
    await yieldToBrowser();
  }catch(e){
    if(card) card.innerHTML=researchFailedBody(e);
    setResearchCanvasStatus(`Research refresh failed: ${e.message||e}`);
  }finally{
    if(button){ button.disabled=false; button.textContent=button.dataset.originalText||'Refresh / Re-run'; }
    bindResearchCanvasActions();
    hideResearchProgress(token);
    if(state.researchRenderToken===token) state.researchRenderToken=null;
  }
}
function clearResearchItemsWithConfirm(){ if(!confirm('Clear all saved research items? This cannot be undone.')) return false; if(state.researchRenderToken) state.researchRenderToken.cancelled=true; state.researchItems=[]; saveResearchItems(); clearResearchComputedCaches('research cleared'); if(els.researchCanvas && els.researchModal?.classList.contains('open')) els.researchCanvas.innerHTML='<div class="researchEmpty">No saved research items yet. Click <strong>Add New Item</strong> to create a table, conversation viewer, line graph, or bar graph.</div>'; if(els.topStatus) els.topStatus.textContent='Research was cleared'; return true; }
function setResearchItemProp(itemId,patch){ const item=state.researchItems.find(x=>x.id===itemId); if(!item) return; Object.assign(item,patch); saveResearchItems(); renderResearchCanvasAsync({reason:'update'}); }
function moveResearchItem(itemId,dir){ const a=state.researchItems||[], i=a.findIndex(x=>x.id===itemId); if(i<0) return; const cols=4; let j=i; if(dir==='left') j=i-1; if(dir==='right') j=i+1; if(dir==='up') j=i-cols; if(dir==='down') j=i+cols; if(j<0||j>=a.length) return; [a[i],a[j]]=[a[j],a[i]]; saveResearchItems(); renderResearchCanvasAsync({reason:'move'}); }
async function renderResearchCanvas(){ return renderResearchCanvasAsync({reason:'manual'}); }
async function renderResearchCanvasAsync(opts={}){
  if(!els.researchCanvas) return;
  const token=newResearchRenderToken(opts.reason||'render');
  const items=renderResearchCanvasShell('Loading research items...');
  if(!items.length) return;
  await yieldToBrowser();
  for(let idx=0;idx<items.length;idx++){
    if(token.cancelled) break;
    const item=items[idx];
    setResearchCanvasStatus(`Rendering ${idx+1} of ${items.length}...`);
    const card=els.researchCanvas.querySelector(`[data-research-card="${CSS.escape(item.id)}"] .researchCardBody`);
    if(card) card.innerHTML=researchStoredResultValid(item) ? await researchStoredResultBodyAsync(item) : researchNoStoredResultBody(item);
    bindResearchCanvasActions();
    await yieldToBrowser();
  }
  if(!token.cancelled) setResearchCanvasStatus('Research items loaded from saved rendered results. Use Refresh or Render All to regenerate.');
  bindResearchCanvasActions();
}

async function renderAllResearchItems(){
  if(!els.researchCanvas) return;
  const items=currentResearchItemsNormalized();
  if(!items.length){ setResearchCanvasStatus('No research items to render.'); return; }
  if(!researchHasAnyData()){ setResearchCanvasStatus('No data is imported yet.'); return; }
  if(state.researchRenderToken) state.researchRenderToken.cancelled=true;
  if(state.researchRenderAllToken) state.researchRenderAllToken.cancelled=true;
  const token=beginResearchProgress('Preparing Render All...',1);
  token.reason='render-all'; state.researchRenderAllToken=token;
  setResearchRenderAllRunning(true);
  renderResearchCanvasShell('Preparing Render All...');
  const weights=items.map(estimateResearchItemWork), totalWeight=weights.reduce((a,b)=>a+b,0)||items.length;
  let completedWeight=0, rendered=0, failed=0;
  const renderedThisRun=new Set();
  try{
    for(let idx=0;idx<items.length;idx++){
      if(!researchProgressActive(token)) break;
      const item=items[idx], itemWeight=weights[idx]||1;
      const card=els.researchCanvas.querySelector(`[data-research-card="${CSS.escape(item.id)}"] .researchCardBody`);
      if(card) card.innerHTML=`<div class="researchPreviewSummary"><span class="badge">Rendering ${idx+1} of ${items.length}...</span></div>`;
      const startPct=5+90*(completedWeight/totalWeight), endPct=5+90*((completedWeight+itemWeight)/totalWeight);
      updateResearchProgress(token,`Rendering ${idx+1} of ${items.length}: ${item.title||item.outputType}`,startPct);
      try{
        const prep=await ensureResearchExecutionIndexes(item,{token,progressToken:token,start:startPct,end:Math.min(endPct,startPct+Math.max(1,(endPct-startPct)*.2))});
        state.researchLastPreparation={itemId:item.id,...prep};
        const html=await renderResearchItemBodyAsync(item,{start:startPct,end:Math.max(startPct,endPct-2),status:true,token});
        if(!researchProgressActive(token)){ if(card) card.innerHTML=researchQueuedPlaceholder(item); break; }
        if(card) card.innerHTML=html;
        state.renderedLargeResearchCards.add(item.id); renderedThisRun.add(item.id); rendered++;
        completedWeight+=itemWeight;
        updateResearchProgress(token,`Rendered ${idx+1} of ${items.length}`,5+90*(completedWeight/totalWeight));
      }catch(e){
        if(card) card.innerHTML=researchFailedBody(e); failed++; completedWeight+=itemWeight;
      }
      bindResearchCanvasActions(); updateResearchCacheBadge(); await yieldToBrowser();
    }
    if(token.cancelled){ items.forEach(item=>{ if(renderedThisRun.has(item.id)) return; const card=els.researchCanvas.querySelector(`[data-research-card="${CSS.escape(item.id)}"] .researchCardBody`); if(card) card.innerHTML=researchQueuedPlaceholder(item); }); }
    if(!token.cancelled) finishResearchProgress(token,'Render All complete');
  }finally{
    setResearchRenderAllRunning(false);
    if(state.researchRenderAllToken===token) state.researchRenderAllToken=null;
    if(token.cancelled) setResearchCanvasStatus(`Rendering stopped. ${rendered} of ${items.length} rendered${failed?`, ${failed} failed`:''}.`);
    else setResearchCanvasStatus(`Render All complete. ${rendered} of ${items.length} rendered${failed?`, ${failed} failed`:''}.`);
    bindResearchCanvasActions(); await yieldToBrowser(); hideResearchProgress(token);
  }
}
function deleteResearchItem(itemId){ if(!confirm('Delete this research item?')) return; state.researchItems=state.researchItems.filter(x=>x.id!==itemId); saveResearchItems(); renderResearchCanvasAsync({reason:'delete'}); }
async function exportResearchItemData(itemId){
  const item=normalizeResearchItem(state.researchItems.find(x=>x.id===itemId)||{}); if(!item.id) return;
  try{
    showProgress(item.outputType==='table'?'Preparing research table export...':'Preparing research export...',2);
    const res=await researchRenderedResultGet(item.id);
    if(!res){ alert('No rendered result exists for this item. Click Refresh or Render All before exporting.'); return; }
    await yieldToBrowser();
    if(item.outputType==='table'){
      updateProgress('Preparing export rows...',45); await yieldToBrowser();
      const html=await researchTableExportHtmlAsync(item,res,{start:45,end:96});
      updateProgress('Downloading research table export...',98); await yieldToBrowser();
      downloadText(String((item.title||'research')+'.xls').replace(/[\\/:*?"<>|]+/g,'-'), html);
      updateProgress('Research table export complete',100); await yieldToBrowser();
      return;
    }
    const header=['Label',...(res.hasSecondary?['Series']:[]),...(res.columns||[]).map(c=>c.displayTitle||researchColumnDisplayTitle(item,c)||c.label||c.field||'Value')];
    const aoa=[header,...(res.data||[]).map(r=>[r.label??'',...(res.hasSecondary?[r.secondary??'']:[]),...(r.values||[])])];
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'Research'); XLSX.writeFile(wb,(item.title||'research')+'.xlsx');
    updateProgress('Research export complete',100); await yieldToBrowser();
  }catch(err){
    console.error(err); alert('Research export failed. Check the console for details.');
  }finally{
    hideProgress();
  }
}
function exportResearchItemImage(itemId){ const card=els.researchCanvas.querySelector(`[data-research-card="${CSS.escape(itemId)}"]`), renderedCanvas=card?.querySelector('[data-research-canvas]'); if(renderedCanvas){ const a=document.createElement('a'); a.download='research-chart.png'; a.href=renderedCanvas.toDataURL('image/png'); a.click(); return; } const svg=(card||els.researchCanvas).querySelector(`[data-research-svg="${CSS.escape(itemId)}"]`)||card?.querySelector('[data-research-svg]'); if(!svg) return; const data=new XMLSerializer().serializeToString(svg), img=new Image(), canvas=document.createElement('canvas'); canvas.width=1200; canvas.height=440; img.onload=()=>{ const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height); const a=document.createElement('a'); a.download='research-chart.png'; a.href=canvas.toDataURL('image/png'); a.click(); }; img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(data); }
function exportResearchConfig(){ downloadText('all_star_research.txt', JSON.stringify({version:2,items:state.researchItems||[],metrics:state.metrics||[],customSources:(state.customSources||[]).map(c=>({...clonePlain(c),rows:[],aoaBySheet:{}}))},null,2)); }
async function importResearchConfig(text){ const obj=JSON.parse(text); if(obj&&Array.isArray(obj.customSources)){ obj.customSources.forEach(def=>{ if(def.sourceKey&&!customSource(def.sourceKey)) state.customSources.push({...def,rows:def.rows||[],headers:def.headers||[],aoa:def.aoa||[],aoaBySheet:def.aoaBySheet||{}}); }); renderCustomSourcesList(); } state.researchItems=(Array.isArray(obj)?obj:(obj.items||[])).map(normalizeResearchItem); if(obj.metrics){ state.metrics=(obj.metrics||[]).map(normalizeMetric); await saveMetrics(); } const txt=JSON.stringify(state.researchItems); const refs=txt.match(/@[^\"']+/g)||[]; let missing=''; refs.forEach(r=>{ if(!findMetricByRef(r)) missing=r.slice(1); }); const modelRefs=[...txt.matchAll(/model\(\s*[\"']([^\"']+)[\"']\s*(?:,\s*[\"']([^\"']+)[\"']\s*)?\)/g)]; for(const mr of modelRefs){ const mm=findModelByNameOrId(mr[1]); if(!mm){ missing='model: '+mr[1]; break; } if(mr[2]&&!findCriterionByNameOrId(mm,mr[2])){ missing='model criteria: '+mr[1]+' / '+mr[2]; break; } } if(missing && els.topStatus) els.topStatus.textContent='This Research item references a missing '+missing; saveResearchItems(); if(els.researchModal?.classList.contains('open')){ renderResearchCanvasAsync({reason:'import'}); scheduleResearchCacheWarm('import'); } else if(els.topStatus && !missing) els.topStatus.textContent='Research config imported. Open Research to safely render saved items.'; }
