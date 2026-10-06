/* Entity and entity-period eligibility for Research. Display grouping is separate
 * from eligibility: a coach chart can still examine individual rep/weeks. */
'use strict';

function normalizeResearchPopulationBehavior(item={}){
  return {
    populationFilterMode:item.populationFilterMode==='dynamic'?'dynamic':'static',
    populationFilterPeriod:['daily','weekly','monthly','period'].includes(item.populationFilterPeriod)?item.populationFilterPeriod:'auto',
    populationFilterGrain:['representatives','teams','items'].includes(item.populationFilterGrain)?item.populationFilterGrain:'auto',
    populationFilterEntityField:String(item.populationFilterEntityField||'').trim(),
    // Old single-field row filters keep their behavior until the user changes
    // population behavior. Calculated filters always use the corrected path.
    populationFilterVersion:Number(item.populationFilterVersion)||(item.populationFilterMode?2:1)
  };
}
function researchPopulationPeriod(item={}){
  if(['daily','weekly','monthly','period'].includes(item.populationFilterPeriod))return item.populationFilterPeriod;
  if(item.guidedEnabled&&item.guidedTimeGrouping)return item.guidedTimeGrouping==='quarterly'?'monthly':item.guidedTimeGrouping;
  const weekly=isDatedStatsSource(item.source)||isCustomWeeklyStatSource(item.source)||(item.filters||[]).some(f=>researchFieldReferencedSources(f.field,item.source).some(s=>isDatedStatsSource(s)||isCustomWeeklyStatSource(s)));
  if(weekly)return ['weekly','monthly'].includes(item.dateGrouping)?item.dateGrouping:'weekly';
  return ['daily','weekly','monthly'].includes(item.dateGrouping)?item.dateGrouping:'daily';
}
function researchPopulationGrain(item={},rows=[]){
  if(item.populationFilterGrain&&item.populationFilterGrain!=='auto')return item.populationFilterGrain;
  if(item.guidedEnabled&&item.guidedSubject==='representatives')return 'representatives';
  if(item.guidedEnabled&&item.guidedSubject==='teams')return 'teams';
  const grain=researchAnalysisGrain(item,rows);
  return grain==='rows'?'items':grain;
}
function researchPopulationWeekStart(item={}){return customSource(item.source)?.columns?.weekStart||'sunday';}
function researchPopulationRowPeriod(row,source,item={},period=researchPopulationPeriod(item)){
  if(period==='period')return 'Research Period';
  const field=source===item.source?(item.dateColumn||researchDefaultDateColumn({source})):researchDefaultDateColumn({source});
  const raw=isDatedStatsSource(source)?weeklySourceRowIdentity(row,source).date:(field?researchFieldValue(row,field,source):row?._date);
  return researchBucketDate(raw,period,researchPopulationWeekStart(item));
}
function researchPopulationEntity(row,source,item,grain,position=0){
  if(grain==='representatives'){const p=getRepIdentity(row,source);return {key:p.normalizedName,name:p.displayName};}
  if(grain==='teams'){const p=getCoachIdentity(row,source);return {key:p.normalizedName,name:p.displayName};}
  const field=item.populationFilterEntityField||(!researchGroupDateField(item)?item.groupField:'')||researchExactHeader(source,['Item ID','Entity ID','Record ID','ID']);
  const value=field?researchFieldValue(row,field,source):'';
  return {key:String(value??'').trim()||(!field?'row:'+position:''),name:String(value??'').trim()||'Item '+(position+1)};
}
function researchPopulationTuple(entity,period){return JSON.stringify([entity,period]);}
function researchHasDynamicPopulation(item={}){return item.populationFilterMode==='dynamic'&&(item.filters||[]).length>0;}
function researchPopulationIsCalculation(field,item={}){
  const raw=normalizeResearchLooseSourceReferences(String(field||'').trim());
  if(getResearchHeaders(item.source).some(h=>normalizeResearchText(h)===normalizeResearchText(raw))||parseModelRef(raw)||findMetricByRef(raw)||researchMeasureIdFromRef(raw))return false;
  return researchExpressionHasMath(raw)||/\b(sum|avg|count|unique|min|max)\s*\(/i.test(raw);
}
function researchPopulationFilterHandled(filter,item={}){
  if(item._populationFilterEvaluating||['includeWithin','excludeWithin'].includes(filter.include)||filter.op==='within days of')return false;
  return researchPopulationIsCalculation(filter.field,item)||item.populationFilterMode==='dynamic'||Number(item.populationFilterVersion)>=2;
}
function researchPopulationNumber(raw,source='',field=''){
  if(raw==null||typeof raw==='boolean'||String(raw).trim()==='')return NaN;
  if(typeof raw!=='number'&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*%?$/i.test(String(raw).replace(/,/g,'').trim()))return NaN;
  const percent=typeof raw==='string'&&/%\s*$/.test(raw),n=Number(String(raw).replace(/[,\s%]/g,''));
  if(!Number.isFinite(n))return NaN;
  if(percent)return n/100;
  const cfg=state.data[source]?.config?.fields?.[field];
  if(cfg?.kind==='percentage')return cfg.inputUnit==='fraction'?n:cfg.inputUnit==='percentage-points'?n/100:NaN;
  return n;
}
function researchPopulationCompare(value,filter){
  const aliases={'equals':'is','equal':'is','equal to':'is','not equals':'is not','greater than or equal to':'greater/equal','less than or equal to':'less/equal','less_than':'less than','greater_than':'greater than','greater_equal':'greater/equal','less_equal':'less/equal'};
  const op=aliases[filter.op]||filter.op||'contains',a=researchPopulationNumber(value),b=researchPopulationNumber(filter.value),c=researchPopulationNumber(filter.value2);
  if(['greater than','greater/equal','less than','less/equal','between'].includes(op)||(Number.isFinite(a)&&Number.isFinite(b)&&['is','is not'].includes(op))){
    if(!Number.isFinite(a)||!Number.isFinite(b))return false;
    if(op==='is')return Math.abs(a-b)<=1e-12;
    if(op==='is not')return Math.abs(a-b)>1e-12;
    if(op==='greater than')return a>b;if(op==='greater/equal')return a>=b;
    if(op==='less than')return a<b;if(op==='less/equal')return a<=b;
    return Number.isFinite(c)&&a>=Math.min(b,c)&&a<=Math.max(b,c);
  }
  return compareFilter(value,op,filter.value,filter.value2);
}
function researchPopulationOperand(token,item){
  const raw=String(token||'').trim().replace(/^sum\s*\((.*)\)$/i,'$1').trim();
  const ref=parseResearchSourceFieldRef(raw);
  if(ref)return ref.missingSource||ref.missingField||normalizeResearchText(ref.rawField)!==normalizeResearchText(ref.field)?null:{source:ref.source,field:ref.field};
  const bracket=raw.match(/^\[([^\]]+)\]$/),row=raw.match(/^row\s*\[\s*["']([^"']+)["']\s*\]$/i);
  if(!bracket&&!row&&/[\[\]()!+*/]/.test(raw))return null;
  const name=bracket?.[1]||row?.[1]||raw;
  const local=researchExactHeader(item.source,[name]);
  if(local)return {source:item.source,field:local};
  const inferred=researchUniqueSourceForHeader(name,item.source);
  return inferred?{source:inferred.source,field:inferred.field}:null;
}
function researchPopulationSourceRows(context,group,source){
  if(source===context.item.source)return group.rows;
  if(context.sample)return [];
  if(!context.sources.has(source)){
    const map=new Map(),item=context.item;
    const opts={start:parseDateOnly(item.startDate),end:parseDateOnly(item.endDate),dateColumn:researchDefaultDateColumn({source}),qaDateMode:els.runQADateSelect?.value||'interaction'};
    const rows=researchApplyPopulationScope(filterRowsForSource(source,getRowsRaw(source),opts),{...item,source});
    rows.forEach((row,i)=>{
      const entity=researchPopulationEntity(row,source,item,context.grain,i),period=context.dynamic?researchPopulationRowPeriod(row,source,item):'';
      if(!entity.key||(context.dynamic&&!period))return;
      const key=researchPopulationTuple(entity.key,period);if(!map.has(key))map.set(key,[]);map.get(key).push(row);
    });
    context.sources.set(source,map);
  }
  return context.sources.get(source).get(group.key)||[];
}
function researchPopulationRatio(left,right,context,group){
  const item=context.item,aRows=researchPopulationSourceRows(context,group,left.source),bRows=researchPopulationSourceRows(context,group,right.source);
  let numerator=0,denominator=0,pairs=0,missingNumerator=0,missingDenominator=0,zeroDenominator=0;
  const add=(a,b)=>{
    if(!Number.isFinite(a))missingNumerator++;
    if(!Number.isFinite(b))missingDenominator++;
    else if(b<=0)zeroDenominator++;
    if(Number.isFinite(a)&&Number.isFinite(b)&&b>0){numerator+=a;denominator+=b;pairs++;}
  };
  if(left.source===right.source){
    if(!aRows.length)missingDenominator++;
    // Keep each pair together; a missing appointment count cannot borrow another
    // row's opportunity count or silently dilute the result.
    aRows.forEach(row=>add(researchPopulationNumber(row[left.field],left.source,left.field),researchPopulationNumber(row[right.field],right.source,right.field)));
  }else{
    const matchPeriod=context.dynamic?researchPopulationPeriod(item):([left.source,right.source].some(s=>isDatedStatsSource(s)||isCustomWeeklyStatSource(s))?'weekly':researchPopulationPeriod(item));
    const buckets=(rows,ref)=>{
      const map=new Map();rows.forEach((row,i)=>{
        const entity=researchPopulationEntity(row,ref.source,item,context.grain==='teams'?'representatives':context.grain,i),period=researchPopulationRowPeriod(row,ref.source,item,matchPeriod);
        if(!entity.key||!period)return;
        const key=researchPopulationTuple(entity.key,period),n=researchPopulationNumber(row[ref.field],ref.source,ref.field);
        if(!map.has(key))map.set(key,{sum:0,count:0});const value=map.get(key);if(Number.isFinite(n)){value.sum+=n;value.count++;}
      });return map;
    };
    const a=buckets(aRows,left),b=buckets(bRows,right),keys=new Set([...a.keys(),...b.keys()]);
    if(!keys.size)missingDenominator++;
    keys.forEach(key=>add(a.get(key)?.count?a.get(key).sum:NaN,b.get(key)?.count?b.get(key).sum:NaN));
  }
  const reason=pairs?'':missingDenominator?'missing denominator':zeroDenominator?'zero denominator':'missing numerator';
  return {value:pairs?numerator/denominator:null,numerator,denominator,rate:true,usable:pairs>0,reason,missingNumerator,missingDenominator,zeroDenominator};
}
function researchPopulationCalculation(field,context,group){
  const item=context.item,raw=normalizeResearchLooseSourceReferences(String(field||'')),ratio=raw.match(/^(.+?)\s*\/\s*(.+)$/);
  const left=ratio&&researchPopulationOperand(ratio[1],item),right=ratio&&researchPopulationOperand(ratio[2],item);
  if(left&&right)return researchPopulationRatio(left,right,context,group);
  const sourceFields=new Map(),add=ref=>{if(!ref)return;if(!sourceFields.has(ref.source))sourceFields.set(ref.source,new Set());sourceFields.get(ref.source).add(ref.field);};
  splitCrossExpressionRefs(raw).forEach(ref=>{if(!ref.missingSource&&!ref.missingField)add({source:ref.source,field:ref.field});});
  expressionColumnsForSource(raw,item.source).forEach(name=>add(researchPopulationOperand(name,item)));
  const alignedRows=new Map(),rowsFor=source=>{
    if(!alignedRows.has(source)){
      const fields=[...(sourceFields.get(source)||[])],rows=researchPopulationSourceRows(context,group,source);
      alignedRows.set(source,fields.length>1?rows.filter(row=>fields.every(f=>Number.isFinite(researchPopulationNumber(row[f],source,f)))):rows);
    }
    return alignedRows.get(source);
  };
  const refs=[],warnings=[],resolver=(name,_item,_rows,_warnings,fn='sum')=>{
    const ref=researchPopulationOperand(name,item);
    if(!ref){
      const result=resolveResearchAggregateReference(name,group.item,group.rows,warnings,fn);
      const value=researchPopulationNumber(result.value);
      refs.push({value,raw:name});return {...result,value:Number.isFinite(value)?value:NaN};
    }
    const rows=rowsFor(ref.source),present=rows.map(row=>row[ref.field]).filter(v=>v!=null&&String(v).trim()!==''),values=present.map(v=>researchPopulationNumber(v,ref.source,ref.field)).filter(Number.isFinite);
    let value=values.length?values.reduce((a,b)=>a+b,0):NaN;
    if(fn==='count')value=present.length;else if(fn==='unique')value=new Set(present.map(String)).size;
    else if(fn==='avg')value=values.length?value/values.length:NaN;
    else if(fn==='min')value=values.length?researchMin(values):NaN;else if(fn==='max')value=values.length?researchMax(values):NaN;
    refs.push({value,raw:name});return {found:true,value,kind:'column'};
  };
  const expr=replaceResearchAggregateReferences(raw,group.item,group.rows,warnings,null,resolver);
  let value=null;
  try{if(!warnings.some(w=>/^Unknown|Missing/.test(w)))value=Function('Math','return ('+expr+');')(Math);}catch(error){warnings.push(error.message);}
  warnings.forEach(w=>researchExpressionAddWarning(researchRuntimeWarnings(item),w));
  const usable=typeof value==='number'&&Number.isFinite(value)&&refs.every(r=>Number.isFinite(r.value));
  return {value:usable?value:null,usable,reason:usable?'':raw.includes('/')?'zero or missing denominator':'missing or non-numeric value'};
}
function researchPopulationCondition(filter,context,group){
  const item=context.item,field=filter.field||'';
  let result;
  if(researchPopulationIsCalculation(field,item))result=researchPopulationCalculation(field,context,group);
  else if(filter.type==='team_is'||filter.fieldType==='team_is'||filter.expression){
    const rows=applyResearchFilters(group.rows,[{...filter,include:'include',conditionResult:'true'}],{...group.item,_populationFilterEvaluating:true});
    result={value:rows.length>0,matched:rows.length>0,usable:group.rows.length>0};
  }else{
    const typed=researchTypedMeasureDefinition(researchMeasureIdFromRef(field)),metric=findMetricByRef(field),model=parseModelRef(field);
    if(typed||metric||model){
      const source=metric?.source||resolveResearchTypedMeasure(typed,item.source)?.source||item.source,rows=researchPopulationSourceRows(context,group,source);
      const value=typed?evaluateResearchTypedMeasure(typed,rows,{...group.item,source,groupAggregation:'weighted',zeroDenominator:'blank'}):metric?evaluateMetric(metric,rows,source,[]):evaluateModelReferenceValue(model,group.rows,group.item,'sum',[]);
      const fraction=typed?.valueType==='percentage'?researchPopulationNumber(value)/100:researchPopulationNumber(value);
      result={value:fraction,usable:rows.length>0&&Number.isFinite(fraction),reason:'missing or non-numeric value'};
    }else{
      const ref=researchPopulationOperand(field,item),source=ref?.source||item.source,actual=ref?.field||field,rows=researchPopulationSourceRows(context,group,source),all=rows.map(row=>researchFieldValue(row,actual,source)),values=all.filter(v=>v!=null&&String(v).trim()!=='');
      const numbers=values.map(v=>researchPopulationNumber(v,source,actual)).filter(Number.isFinite),numeric=['greater than','greater/equal','less than','less/equal','between','greater than or equal to','less than or equal to','less_than','greater_than','greater_equal','less_equal'].includes(filter.op)||(['is','is not','equals','not equals'].includes(filter.op)&&Number.isFinite(researchPopulationNumber(filter.value)));
      if(numeric){
        const percentage=state.data[source]?.config?.fields?.[actual]?.kind==='percentage'||/rate|percent|%/i.test(actual);
        result={value:numbers.length?numbers.reduce((a,b)=>a+b,0)/(percentage?numbers.length:1):null,usable:numbers.length>0,reason:'missing or non-numeric value'};
      }else if(['is blank','is not blank'].includes(filter.op))result={value:all[0],matched:all.some(v=>researchPopulationCompare(v,filter)),usable:rows.length>0};
      else result={value:values[0],matched:values.some(v=>researchPopulationCompare(v,filter)),usable:values.length>0,reason:'missing value'};
    }
  }
  if(result.usable){const matched=result.matched??researchPopulationCompare(result.value,filter);result.matched=conditionResultIsTrue(filter.conditionResult)?matched:!matched;result.reason='';}
  else result.matched=false;
  return result;
}
function researchApplyEntityPopulationFilters(input,filters,item,plan={},options={}){
  let rows=input||[];
  plan.populationFilters=plan.populationFilters||[];
  filters.forEach((filter,index)=>{
    const grain=researchPopulationGrain(item,rows),dynamic=item.populationFilterMode==='dynamic',period=dynamic?researchPopulationPeriod(item):'',groups=new Map(),entities=new Set();
    let missingPeriod=0;
    rows.forEach((row,i)=>{
      const entity=researchPopulationEntity(row,item.source,item,grain,i),bucket=dynamic?researchPopulationRowPeriod(row,item.source,item):'';
      if(!entity.key)return;entities.add(entity.key);if(dynamic&&!bucket){missingPeriod++;return;}
      const key=researchPopulationTuple(entity.key,bucket);
      if(!groups.has(key))groups.set(key,{key,entity:entity.key,name:entity.name,period:bucket,rows:[],item:researchPopulationGroupItem(item,bucket)});groups.get(key).rows.push(row);
    });
    const context={item,grain,dynamic,sources:new Map(),sample:!!options.sample},accepted=new Set(),qualified=new Set(),samples=[],sampleKinds=new Set();
    const diag={filter:(item.filters||[]).indexOf(filter)+1||index+1,field:filter.field||filter.expression||filter.teamInput,mode:dynamic?'dynamic':'static',period:period||'Research Period',grain,startingEntities:entities.size,checked:groups.size,usable:0,matching:0,retained:0,excluded:0,notEvaluated:0,missingDenominator:0,zeroDenominator:0,missingNumerator:0,missingPeriod,samples};
    groups.forEach(group=>{
      const result=researchPopulationCondition(filter,context,group),exclude=filter.include==='exclude',keep=exclude?!result.matched:result.matched;
      if(result.usable)diag.usable++;else diag.notEvaluated++;
      if(result.matched){diag.matching++;qualified.add(group.entity);}
      if(keep){accepted.add(group.key);diag.retained++;}else diag.excluded++;
      if(result.missingDenominator)diag.missingDenominator++;
      if(result.zeroDenominator||/zero/.test(result.reason||''))diag.zeroDenominator++;
      if(result.missingNumerator)diag.missingNumerator++;
      const kind=result.usable?(result.matched?'match':'no match'):result.reason;
      const sample={name:group.name,period:group.period||'Research Period',value:result.value,numerator:result.numerator,denominator:result.denominator,rate:!!result.rate,matched:result.matched,usable:result.usable,reason:result.reason};
      if(samples.length<6){samples.push(sample);sampleKinds.add(kind);}else if(!sampleKinds.has(kind)){
        const kindOf=s=>s.usable?(s.matched?'match':'no match'):s.reason;
        const duplicate=samples.findLastIndex(s=>samples.filter(v=>kindOf(v)===kindOf(s)).length>1);
        if(duplicate>=0){samples[duplicate]=sample;sampleKinds.add(kind);}
      }
    });
    diag.uniqueQualifyingEntities=qualified.size;
    rows=rows.filter((row,i)=>{const entity=researchPopulationEntity(row,item.source,item,grain,i),bucket=dynamic?researchPopulationRowPeriod(row,item.source,item):'';if(dynamic&&!bucket)return filter.include==='exclude';return accepted.has(researchPopulationTuple(entity.key,bucket));});
    plan.populationFilters.push(diag);
  });
  return rows;
}

function researchPopulationGroupItem(item,period){
  if(item.populationFilterMode!=='dynamic'||researchPopulationPeriod(item)==='period')return item;
  const date=parseDateOnly(period+(researchPopulationPeriod(item)==='monthly'?'-01':''));if(!date)return item;
  const end=new Date(date.getTime());
  if(researchPopulationPeriod(item)==='weekly')end.setDate(end.getDate()+6);
  if(researchPopulationPeriod(item)==='monthly')end.setMonth(end.getMonth()+1,0);
  return {...item,startDate:item.startDate&&item.startDate>ymd(date)?item.startDate:ymd(date),endDate:item.endDate&&item.endDate<ymd(end)?item.endDate:ymd(end)};
}

// A cohort may contain Alice in week 1 and Bob in week 2. Checking a set of
// people and a separate set of dates would admit Alice/week 2 and Bob/week 1.
function researchPopulationPeriodKeys(rows,source,item,grain=researchPopulationGrain(item,rows)){
  const keys=new Set();(rows||[]).forEach((row,i)=>{const e=researchPopulationEntity(row,source,item,grain,i),p=researchPopulationRowPeriod(row,source,item);if(e.key&&p)keys.add(researchPopulationTuple(e.key,p));});return keys;
}
function researchRestrictPopulationPeriods(target,source,base,baseSource,item){
  if(!researchHasDynamicPopulation(item))return target;
  const grain=researchPopulationGrain(item,base),keys=researchPopulationPeriodKeys(base,baseSource,item,grain);
  return target.filter((row,i)=>{const e=researchPopulationEntity(row,source,item,grain,i),p=researchPopulationRowPeriod(row,source,item);return p&&keys.has(researchPopulationTuple(e.key,p));});
}
function researchPopulationJoinedRows(target,source,base,baseSource,item){
  if(item.populationFilterEntityField&&researchPopulationGrain(item,base)==='items'){
    const dynamic=researchHasDynamicPopulation(item),key=(row,src,i)=>{const e=researchPopulationEntity(row,src,item,'items',i),p=dynamic?researchPopulationRowPeriod(row,src,item):'';return e.key&&(!dynamic||p)?researchPopulationTuple(e.key,p):'';};
    const keys=new Set(base.map((row,i)=>key(row,baseSource,i)).filter(Boolean));
    return getRowsRaw(source).filter((row,i)=>keys.has(key(row,source,i)));
  }
  return researchRestrictPopulationPeriods(target,source,base,baseSource,item);
}
function researchDynamicPercentEntries(rows,item,unit){
  const periodRows=new Map();(rows||[]).forEach(row=>{const period=researchPopulationRowPeriod(row,item.source,item);if(period){if(!periodRows.has(period))periodRows.set(period,[]);periodRows.get(period).push(row);}});
  return [...periodRows].flatMap(([period,rs])=>guidedEntityEntries(rs,item,unit).map(entry=>({...entry,period})));
}
function researchDynamicPercentPopulation(rows,item,pb){
  if(!['coach_full_team','all_reps'].includes(pb.denominator))return rows;
  const eligible=buildQueryPlan(item.source,{item,filters:item.filters,dateColumn:item.dateColumn,startDate:item.startDate,endDate:item.endDate}).rows;
  const periods=new Set(rows.map(row=>researchPopulationRowPeriod(row,item.source,item))),teams=new Set(rows.map(row=>getCoachIdentity(row,item.source).normalizedName));
  return eligible.filter(row=>periods.has(researchPopulationRowPeriod(row,item.source,item))&&(pb.denominator!=='coach_full_team'||teams.has(getCoachIdentity(row,item.source).normalizedName)));
}
function researchPopulationPreviewHtml(diagnostics,sample=false){
  if(!diagnostics?.length)return '';
  const number=v=>Number(v||0).toLocaleString(),label={representatives:'reps',teams:'coaches',items:'items'};
  return `<details class="researchPopulationPreview"><summary>Population Preview${sample?' · sample':''}</summary>${diagnostics.map(d=>`<div class="researchPopulationPreviewFilter"><strong>Filter ${d.filter} · ${d.mode==='dynamic'?'Dynamic by '+({daily:'day',weekly:'week',monthly:'month',period:'research period'}[d.period]||'period'):'Static'}</strong><div class="hint">${esc(d.field||'Team filter')}</div><div class="researchPreviewSummary"><span class="badge">Starting ${label[d.grain]}: ${number(d.startingEntities)}</span><span class="badge">${d.mode==='dynamic'?'Entity-periods checked':'Entities checked'}: ${number(d.checked)}</span><span class="badge">Usable: ${number(d.usable)}</span><span class="badge">Matching: ${number(d.matching)}</span><span class="badge">Excluded: ${number(d.excluded)}</span>${d.mode==='dynamic'?`<span class="badge">Unique qualifying ${label[d.grain]}: ${number(d.uniqueQualifyingEntities)}</span>`:''}${d.notEvaluated?`<span class="badge">Not evaluated: ${number(d.notEvaluated)}</span>`:''}${d.missingDenominator?`<span class="badge">Missing denominator: ${number(d.missingDenominator)}</span>`:''}${d.zeroDenominator?`<span class="badge">Zero denominator: ${number(d.zeroDenominator)}</span>`:''}${d.missingNumerator?`<span class="badge">Missing numerator: ${number(d.missingNumerator)}</span>`:''}${d.missingPeriod?`<span class="badge">Missing date: ${number(d.missingPeriod)}</span>`:''}</div>${d.samples.map(s=>`<div class="researchPopulationSample">${esc(s.name)} | ${esc(s.period)} | ${s.usable?`${s.rate?esc(s.numerator)+' / '+esc(s.denominator)+' = ':''}${esc(s.rate?(s.value*100).toFixed(1)+'%':typeof s.value==='number'?s.value.toLocaleString(undefined,{maximumFractionDigits:4}):s.value)} | ${s.matched?'MATCH':'NO MATCH'}`:esc(s.reason||'missing data')+' | NOT EVALUATED'}</div>`).join('')}</div>`).join('')}${sample?'<p class="hint">Sample counts only. Static calculations may contain only part of an entity’s selected period; run Research for complete eligibility.</p>':''}</details>`;
}

function readResearchPopulationBehaviorEditor(){
  return normalizeResearchPopulationBehavior({populationFilterMode:el('researchPopulationFilterMode')?.value,populationFilterPeriod:el('researchPopulationFilterPeriod')?.value,populationFilterGrain:el('researchPopulationFilterGrain')?.value,populationFilterEntityField:el('researchPopulationFilterEntityField')?.value,populationFilterVersion:state.editingResearchPopulationFilterVersion||2});
}
function renderResearchPopulationBehaviorEditor(item){
  const mode=el('researchPopulationFilterMode');if(!mode)return;
  if(item){const b=normalizeResearchPopulationBehavior(item);mode.value=b.populationFilterMode;el('researchPopulationFilterPeriod').value=b.populationFilterPeriod;el('researchPopulationFilterGrain').value=b.populationFilterGrain;el('researchPopulationFilterEntityField').value=b.populationFilterEntityField;state.editingResearchPopulationFilterVersion=b.populationFilterVersion;}
  const config={...currentResearchItemFromEditor(),...readResearchPopulationBehaviorEditor()},period=researchPopulationPeriod(effectiveResearchItem(config)),select=el('researchPopulationFilterPeriod');
  select.querySelector('[value="auto"]').textContent='Match research ('+({daily:'Day',weekly:'Week',monthly:'Month',period:'Research Period'}[period]||'Week')+')';
  el('researchPopulationFilterPeriodWrap').classList.toggle('hidden',mode.value!=='dynamic');
  el('researchPopulationFilterEntityWrap').classList.toggle('hidden',el('researchPopulationFilterGrain').value!=='items');
  el('researchPopulationFilterDescription').textContent=mode.value==='dynamic'?'Re-evaluate eligibility for each rep, coach, or item during every week/date period.':'Evaluate each rep, coach, or item across the selected research population.';
  for(const id of ['researchPopulationFilterMode','researchPopulationFilterPeriod','researchPopulationFilterGrain','researchPopulationFilterEntityField'])el(id).onchange=()=>{state.editingResearchPopulationFilterVersion=2;renderResearchPopulationBehaviorEditor();scheduleResearchJoinPreview();updateGuidedResearchUi();};
}
