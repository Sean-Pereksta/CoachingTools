'use strict';

// Population conditions are evaluated before measures. A qualifying person-period
// is also the join boundary for evidence, rather than a person across all dates.
function researchPopulationGrain(item, rows=[]){
  if(['representatives','teams','items'].includes(item.populationFilterGrain)) return item.populationFilterGrain;
  if(item.guidedEnabled && (item.guidedPercentageUnit==='unique_reps'||item.guidedSubject==='representatives')) return 'representatives';
  const grain=researchAnalysisGrain(item,rows);
  return grain==='rows'?'items':grain;
}
function researchPopulationPeriod(item){
  if(['daily','weekly','monthly','period'].includes(item.populationFilterPeriod)) return item.populationFilterPeriod;
  if(['daily','weekly','monthly'].includes(item.dateGrouping)) return item.dateGrouping;
  if(item.guidedEnabled && item.outputType==='line' && ['daily','weekly','monthly','period'].includes(item.guidedTimeGrouping)) return item.guidedTimeGrouping;
  const sources=[item.source,...(item.filters||[]).flatMap(f=>researchFieldReferencedSources(f.field,item.source))];
  if(sources.some(isDatedStatsSource)) return 'weekly';
  if(sources.some(s=>/monthly|sv2/.test(s))) return 'monthly';
  return researchDefaultDateColumn(item)?'daily':'period';
}
function researchPopulationWeekStart(item){
  const source=[item.source,...(item.filters||[]).flatMap(f=>researchFieldReferencedSources(f.field,item.source))].find(isDatedStatsSource)||item.source;
  return state.data[source]?.config?.weekStart||customSource(source)?.columns?.weekStart||'sunday';
}
function researchPopulationDate(row,source,item){
  if(isDatedStatsSource(source)) return weeklySourceRowIdentity(row,source).date;
  const field=(source===item.source && item.dateColumn)||researchDefaultDateColumn({source});
  return field?researchFieldValue(row,field,source):'';
}
function researchPopulationEntity(row,source,item,grain){
  if(grain==='teams') return getCoachIdentity(row,source).normalizedName||'';
  if(grain==='representatives') return getRepIdentity(row,source).normalizedName||'';
  const field=item.populationFilterEntityField||item.groupField;
  if(field){
    const actual=resolveResearchExpressionField(field,{...item,source});
    if(actual) return normalizeResearchText(row[actual]);
  }
  // Unkeyed items stay independent. They cannot accidentally join another source.
  return source+':row:'+researchRowSourceIndex(source,row);
}
function researchPopulationKey(row,source,item,grain,period,weekStart=researchPopulationWeekStart(item)){
  const entity=researchPopulationEntity(row,source,item,grain);
  const date=period==='period'?'Research Period':researchBucketDate(researchPopulationDate(row,source,item),period,weekStart);
  return entity&&date?JSON.stringify([entity,date]):'';
}
function researchDynamicPopulationEnabled(item){
  return item.populationFilterMode==='dynamic' && (item.filters||[]).length>0;
}
function researchPopulationJoinRows(targetRows,targetSource,baseRows,baseSource,item){
  if(!researchDynamicPopulationEnabled(item)) return targetRows;
  const grain=researchPopulationGrain(item,baseRows),period=researchPopulationPeriod(item),weekStart=researchPopulationWeekStart(item);
  const keys=new Set(baseRows.map(row=>researchPopulationKey(row,baseSource,item,grain,period,weekStart)).filter(Boolean));
  return targetRows.filter(row=>keys.has(researchPopulationKey(row,targetSource,item,grain,period,weekStart)));
}
function researchPopulationItemCohortRows(targetSource,baseRows,baseSource,item){
  const period=researchDynamicPopulationEnabled(item)?researchPopulationPeriod(item):'period',weekStart=researchPopulationWeekStart(item);
  const options={item,filters:[],startDate:item.startDate,endDate:item.endDate,dateColumn:researchDefaultDateColumn({source:targetSource})};
  const indexKey='itemCohortIndex|'+researchQueryFilterCacheKey(targetSource,options);
  state.researchJoinedPopulationCache=state.researchJoinedPopulationCache||new Map();
  let indexed=researchTouchCache(state.researchJoinedPopulationCache,indexKey);
  if(!indexed){
    indexed={groups:researchPopulationGroups(researchPopulationSourceRows(targetSource,item),targetSource,item,'items',period),dependencies:{sources:[targetSource,baseSource]}};
    researchBoundedRowsCacheSet(state.researchJoinedPopulationCache,indexKey,indexed,60);
  }
  const keys=new Set(baseRows.map(row=>researchPopulationKey(row,baseSource,item,'items',period,weekStart)).filter(Boolean));
  const rows=[...new Set([...keys].flatMap(key=>indexed.groups.get(key)||[]))];
  const signature=indexKey+'|'+researchMetricRowSignature(baseRows,baseSource);
  state.researchCohortRowSignatures=state.researchCohortRowSignatures||new WeakMap();state.researchCohortRowSignatures.set(rows,signature);
  noteResearchJoin(item,signature,{rows,targetSource,joinMode:'item',missingRepIdentities:[],missingCoachIdentities:[],fallbackRows:0});
  return rows;
}
function researchPopulationNumber(value){
  if(typeof value==='number') return Number.isFinite(value)?value:NaN;
  if(value==null||typeof value==='boolean') return NaN;
  const text=String(value).trim().replace(/,/g,'');
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*%?$/i.test(text)) return NaN;
  return Number(text.replace(/%$/,''))/(text.endsWith('%')?100:1);
}
function researchPopulationCalculatedField(filter,item){
  const field=String(filter.field||'').trim();
  if(getResearchHeaders(item.source).some(header=>normalizeResearchText(header)===normalizeResearchText(field))) return false;
  const expression=replaceResearchSourceFieldRefs(normalizeResearchLooseSourceReferences(field),()=> 'FIELD');
  return researchExpressionHasMath(expression)||/\b(sum|avg|min|max|count|unique)\s*\(/i.test(expression);
}
function researchPopulationFilterApplies(filter,item){
  if(filter.expression || filter.type==='team_is' || filter.fieldType==='team_is' || /Within$/.test(filter.include||'') || filter.op==='within days of' || findMetricByRef(filter.field) || parseModelRef(filter.field)) return false;
  return researchPopulationCalculatedField(filter,item)||researchDynamicPopulationEnabled(item)||['representatives','teams','items'].includes(item.populationFilterGrain);
}
function researchPopulationRepresentativePeriodKey(row,item){
  const rep=personKeyFromRow(row,item.source)||normalizeIdentityName(researchRowRepName(row,item.source));
  if(!researchDynamicPopulationEnabled(item))return rep;
  const period=researchPopulationPeriod(item),date=period==='period'?'Research Period':researchBucketDate(researchPopulationDate(row,item.source,item),period,researchPopulationWeekStart(item));
  return rep&&date?JSON.stringify([rep,date]):'';
}

// Parse arithmetic after replacing exact field references. No source-qualified
// formula is passed to the single-field resolver or evaluated as JavaScript.
function researchPopulationExpression(field,item){
  const refs=[];
  const add=ref=>'__pf'+(refs.push(ref)-1)+'__';
  const local=name=>{
    const field=resolveResearchExpressionField(name,item),inferred=field?null:researchUniqueSourceForHeader(name,item.source);
    return add({source:inferred?.source||item.source,field:field||inferred?.field||'',rawField:name,missingField:!field&&!inferred});
  };
  let text=normalizeResearchLooseSourceReferences(String(field||'').trim());
  const single=parseResearchSourceFieldRef(text);
  if(single) text=add(single);
  else{
    text=replaceResearchSourceFieldRefs(text,(_raw,ref)=>add(ref));
    text=text.replace(/\brow\s*\[\s*["']([^"']+)["']\s*\]/gi,(_raw,name)=>local(name));
    text=text.replace(/\[([^\]]+)\]/g,(_raw,name)=>local(name));
    const headers=getResearchHeaders(item.source).slice().sort((a,b)=>b.length-a.length);
    for(const name of headers){
      const rx=new RegExp('(^|[^A-Za-z0-9_])'+escapeResearchRegex(name)+'(?=$|[^A-Za-z0-9_])','gi');
      text=text.replace(rx,(_raw,prefix)=>prefix+local(name));
    }
  }
  const tokens=text.match(/__pf\d+__|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?|[A-Za-z_]+|[()+*/,-]/gi)||[];
  if(tokens.join('')!==text.replace(/\s/g,'')) return {error:'Unrecognized calculation: '+field,refs};
  let position=0;
  const expression=()=>{
    let node=term();
    while(['+','-'].includes(tokens[position])){ const op=tokens[position++];node={op,left:node,right:term()}; }
    return node;
  };
  const term=()=>{
    let node=atom();
    while(['*','/'].includes(tokens[position])){ const op=tokens[position++];node={op,left:node,right:atom()}; }
    return node;
  };
  const atom=()=>{
    const token=tokens[position++];
    if(token==='+'||token==='-') return {op:'unary',sign:token==='-'?-1:1,right:atom()};
    if(token==='('){ const node=expression();if(tokens[position++]!==')')throw new Error('Missing closing parenthesis');return node; }
    if(/^__pf\d+__$/.test(token||'')) return {op:'ref',ref:refs[Number(token.match(/\d+/)[0])],aggregation:'sum'};
    if(/^(sum|avg|min|max|count|unique)$/i.test(token||'')){
      if(tokens[position++]!=='(')throw new Error('Expected a field in '+token);
      const node=atom();if(node.op!=='ref'||tokens[position++]!==')')throw new Error(token+' requires one field');
      return {...node,aggregation:token.toLowerCase()};
    }
    const number=researchPopulationNumber(token);
    if(!Number.isFinite(number))throw new Error('Unknown field or calculation token: '+(token||'(empty)'));
    return {op:'number',value:number};
  };
  try{
    const root=expression();
    if(position!==tokens.length)throw new Error('Unexpected calculation token');
    const missing=refs.find(ref=>!ref||ref.missingField||ref.missingSource);
    return {root,refs,error:missing?'Missing calculation field: '+(missing.rawField||missing.rawSource||field):''};
  }catch(error){ return {refs,error:error.message}; }
}
function researchPopulationGroups(rows,source,item,grain,period){
  const groups=new Map(),weekStart=researchPopulationWeekStart(item);
  for(const row of rows){
    const key=researchPopulationKey(row,source,item,grain,period,weekStart);
    if(!key)continue;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  return groups;
}
function researchPopulationSourceRows(source,item){
  const dateColumn=source===item.source?item.dateColumn:researchDefaultDateColumn({source});
  const rows=filterRowsForSource(source,getRowsRaw(source),{start:parseDateOnly(item.startDate),end:parseDateOnly(item.endDate),dateColumn,qaDateMode:els.runQADateSelect?.value||'interaction'});
  return researchApplyPopulationScope(rows,{...item,source});
}
function researchPopulationAggregate(rows,ref,aggregation='sum'){
  const raw=rows.map(row=>researchFieldValue(row,ref.field,ref.source)).filter(value=>value!=null&&String(value).trim()!=='');
  if(aggregation==='count'||aggregation==='unique')return raw.length?{value:aggregation==='count'?raw.length:new Set(raw.map(String)).size}:{value:null,reason:'missingValue'};
  const values=raw.map(researchPopulationNumber).filter(Number.isFinite);
  if(!values.length)return {value:null,reason:'missingValue'};
  const sum=values.reduce((a,b)=>a+b,0);
  return {value:aggregation==='avg'?sum/values.length:aggregation==='min'?researchMin(values):aggregation==='max'?researchMax(values):sum};
}
function researchPopulationAlignedRatio(left,right,context){
  const numeratorRows=context.rows(left.ref),denominatorRows=context.rows(right.ref);
  let numerator=0,denominator=0,pairs=0,missingNumerator=0,missingDenominator=0,zeroDenominators=0;
  const add=(n,d)=>{
    if(!Number.isFinite(d)){missingDenominator++;return;}
    if(!d){zeroDenominators++;return;}
    if(!Number.isFinite(n)){missingNumerator++;return;}
    numerator+=n;denominator+=d;pairs++;
  };
  if(left.ref.source===right.ref.source){
    for(const row of numeratorRows) add(researchPopulationNumber(researchFieldValue(row,left.ref.field,left.ref.source)),researchPopulationNumber(researchFieldValue(row,right.ref.field,right.ref.source)));
  }else{
    // Coach totals must also pair the same representatives. In Static mode
    // preserve native dates while accumulating the selected research period.
    const nativePeriod=context.dynamic?context.period:
      ([left.ref.source,right.ref.source].some(isDatedStatsSource)?'weekly':'daily');
    const pairGroups=(rows,ref)=>{
      const groups=new Map();
      for(const row of rows){
        const rep=context.grain==='items'?researchPopulationEntity(row,ref.source,context.item,'items'):getRepIdentity(row,ref.source).normalizedName||researchPopulationEntity(row,ref.source,context.item,context.grain);
        const date=researchBucketDate(researchPopulationDate(row,ref.source,context.item),nativePeriod,researchPopulationWeekStart(context.item));
        if(!rep||!date)continue;
        const key=JSON.stringify([rep,date]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
      }
      return groups;
    };
    const ns=pairGroups(numeratorRows,left.ref),ds=pairGroups(denominatorRows,right.ref);
    for(const key of new Set([...ns.keys(),...ds.keys()]))add(researchPopulationAggregate(ns.get(key)||[],left.ref).value??NaN,researchPopulationAggregate(ds.get(key)||[],right.ref).value??NaN);
  }
  const reason=pairs?'':missingDenominator||!denominatorRows.length?'missingDenominator':zeroDenominators?'zeroDenominator':'missingNumerator';
  return {value:pairs&&denominator?numerator/denominator:null,reason:reason||(!denominator?'zeroDenominator':''),numerator,denominator,isRatio:true,missingNumerator,missingDenominator,zeroDenominators};
}
function researchPopulationEvaluate(node,context){
  if(node.op==='number')return {value:node.value};
  if(node.op==='ref')return researchPopulationAggregate(context.rows(node.ref),node.ref,node.aggregation);
  if(node.op==='unary'){const right=researchPopulationEvaluate(node.right,context);return right.reason?right:{value:node.sign*right.value};}
  if(node.op==='/'&&node.left.op==='ref'&&node.right.op==='ref'&&node.left.aggregation==='sum'&&node.right.aggregation==='sum')return researchPopulationAlignedRatio(node.left,node.right,context);
  const left=researchPopulationEvaluate(node.left,context),right=researchPopulationEvaluate(node.right,context);
  if(left.reason||right.reason)return {value:null,reason:node.op==='/'?(right.reason?'missingDenominator':'missingNumerator'):(left.reason||right.reason)};
  if(node.op==='/'&&!right.value)return {value:null,reason:'zeroDenominator',numerator:left.value,denominator:0,isRatio:true};
  const value=node.op==='+'?left.value+right.value:node.op==='-'?left.value-right.value:node.op==='*'?left.value*right.value:left.value/right.value;
  return Number.isFinite(value)?{value,...(node.op==='/'?{numerator:left.value,denominator:right.value,isRatio:true}:{})}:{value:null,reason:'invalidCalculation'};
}
function researchPopulationCompare(value,filter){
  const op=String(filter.op||'is').toLowerCase(),target=researchPopulationNumber(filter.value),high=researchPopulationNumber(filter.value2);
  if(!Number.isFinite(value)||!Number.isFinite(target)||(op==='between'&&!Number.isFinite(high)))return null;
  if(['is','equals','equal','equal to','='].includes(op))return value===target;
  if(['is not','not equals','!='].includes(op))return value!==target;
  if(['less than','<'].includes(op))return value<target;
  if(['less/equal','less than or equal to','<='].includes(op))return value<=target;
  if(['greater than','>'].includes(op))return value>target;
  if(['greater/equal','greater than or equal to','>='].includes(op))return value>=target;
  if(op==='between')return value>=Math.min(target,high)&&value<=Math.max(target,high);
  return compareFilter(value,op,filter.value,filter.value2);
}
function applyResearchPopulationFilter(rows,filter,item,stat){
  const dynamic=item.populationFilterMode==='dynamic',grain=researchPopulationGrain(item,rows),period=dynamic?researchPopulationPeriod(item):'period',weekStart=researchPopulationWeekStart(item);
  const groups=researchPopulationGroups(rows,item.source,item,grain,period),calculated=researchPopulationCalculatedField(filter,item);
  const numeric=calculated||['greater than','greater/equal','less than','less/equal','between','equals','not equals'].includes(filter.op)||(Number.isFinite(researchPopulationNumber(filter.value))&&['is','is not'].includes(filter.op));
  const parsed=numeric?researchPopulationExpression(filter.field,item):null,sourceGroups=new Map([[item.source,groups]]),kept=new Set();
  const summary={mode:dynamic?'dynamic':'static',grain,period,field:filter.field,action:filter.include||'include',conditionResult:conditionResultIsTrue(filter.conditionResult),startingEntities:new Set(rows.map(row=>researchPopulationEntity(row,item.source,item,grain)).filter(Boolean)).size,checked:groups.size,usable:0,matching:0,kept:0,excluded:0,uniqueQualifyingEntities:0,missingDenominator:0,missingNumerator:0,zeroDenominator:0,missingValue:0,missingDate:rows.filter(row=>!researchPopulationKey(row,item.source,item,grain,period,weekStart)).length,samples:[],warnings:parsed?.error?[parsed.error]:[]};
  if(parsed?.error)researchExpressionAddWarning(researchRuntimeWarnings(item),parsed.error);
  for(const ref of parsed?.refs||[]){
    if(ref?.source&&!sourceGroups.has(ref.source)) sourceGroups.set(ref.source,researchPopulationGroups(researchPopulationSourceRows(ref.source,item),ref.source,item,grain,period));
  }
  const matchingEntities=new Set();
  for(const [key,bucket] of groups){
    const [entity,bucketPeriod]=JSON.parse(key);
    const context={item,grain,period,dynamic,rows:ref=>sourceGroups.get(ref.source)?.get(key)||[]};
    let result=parsed?(parsed.error?{value:null,reason:'invalidCalculation'}:researchPopulationEvaluate(parsed.root,context)):{value:null};
    let match;
    if(numeric)match=result.reason?null:researchPopulationCompare(result.value,filter);
    else{
      const ref=parseResearchSourceFieldRef(filter.field),source=ref?.source||item.source,field=ref?.field||filter.field;
      if(!sourceGroups.has(source))sourceGroups.set(source,researchPopulationGroups(researchPopulationSourceRows(source,item),source,item,grain,period));
      const values=(sourceGroups.get(source)?.get(key)||[]).map(row=>researchFieldValue(row,field,source));
      match=values.length?(['is not','does not contain'].includes(filter.op)?values.every(v=>compareFilter(v,filter.op,filter.value,filter.value2)):values.some(v=>compareFilter(v,filter.op||'contains',filter.value,filter.value2))):null;
    }
    if(match!==null)summary.usable++;
    else{result.reason=result.reason||'invalidComparison';if(result.reason in summary)summary[result.reason]++;}
    // Unknown values never become matches when Condition Result is inverted.
    const matches=match!==null&&(summary.conditionResult?match:!match);
    if(matches){summary.matching++;matchingEntities.add(entity);}
    const keep=summary.action==='exclude'?!matches:matches;
    if(keep){kept.add(key);summary.kept++;}else summary.excluded++;
    const status=match===null?'NOT EVALUATED':matches?'MATCH':'NO MATCH';
    if(summary.samples.length<4 || (summary.samples.length<8&&!summary.samples.some(sample=>sample.status===status&&sample.reason===result.reason))){
      const name=grain==='teams'?researchRowTeam(bucket[0],item.source):grain==='representatives'?researchRowRepName(bucket[0],item.source):entity;
      summary.samples.push({entity:name,period:bucketPeriod,...result,status});
    }
  }
  summary.uniqueQualifyingEntities=matchingEntities.size;
  const out=rows.filter(row=>kept.has(researchPopulationKey(row,item.source,item,grain,period,weekStart)));
  stat.populationFilters=stat.populationFilters||[];stat.populationFilters.push(summary);
  stat.filters=stat.filters||[];stat.filters.push({before:rows.length,candidates:rows.length,after:out.length,population:true,mode:summary.mode,period});
  stat.rowsScanned=(stat.rowsScanned||0)+rows.length;
  return out;
}
function researchPopulationDenominatorRows(baseRows,item,targetSource=item.source){
  if(!researchDynamicPopulationEnabled(item))return percentBuilderScopedRows(targetSource,item);
  const opts={item,filters:item.filters,dateColumn:item.dateColumn,startDate:item.startDate,endDate:item.endDate},period=researchPopulationPeriod(item),weekStart=researchPopulationWeekStart(item);
  const dateKey=(row,source)=>period==='period'?'Research Period':researchBucketDate(researchPopulationDate(row,source,item),period,weekStart);
  const key='eligiblePeriodDenominators|'+researchQueryFilterCacheKey(item.source,opts)+'|'+targetSource+'|'+researchSourceIndexSignature(targetSource);
  const byPeriod=percentBuilderCacheGet(key,()=>{
    const primary=buildQueryPlan(item.source,opts).rows;
    const rows=targetSource===item.source?primary:researchRowsForCohort(targetSource,primary,item.source,item),groups=new Map();
    for(const row of rows){const date=dateKey(row,targetSource);if(!date)continue;if(!groups.has(date))groups.set(date,[]);groups.get(date).push(row);}
    return groups;
  });
  const periods=new Set(baseRows.map(row=>dateKey(row,item.source)).filter(Boolean));
  return [...periods].flatMap(date=>byPeriod.get(date)||[]);
}
function researchPopulationPreviewHtml(plan){
  const filters=plan?.populationFilters||[];
  if(!filters.length)return '';
  const label=grain=>grain==='teams'?'coaches':grain==='items'?'items':'reps';
  const number=value=>Number(value||0).toLocaleString();
  const parts=filters.map(summary=>{
    const unit=label(summary.grain),entity=summary.grain==='teams'?'Coach':summary.grain==='items'?'Item':'Rep',counts=summary.mode==='dynamic'?
      [['Starting '+unit,summary.startingEntities],[entity+'-period combinations checked',summary.checked],['Usable '+entity.toLowerCase()+'-periods',summary.usable],['Matching '+entity.toLowerCase()+'-periods',summary.matching],['Unique qualifying '+unit,summary.uniqueQualifyingEntities],['Excluded '+entity.toLowerCase()+'-periods',summary.excluded]]:
      [['Starting '+unit,summary.startingEntities],['With usable calculation data',summary.usable],['Matching population',summary.matching],['Excluded',summary.excluded]];
    counts.push(['Missing denominator',summary.missingDenominator],['Zero denominator',summary.zeroDenominator],['Missing numerator',summary.missingNumerator]);
    if(summary.missingDate)counts.push(['Rows without a usable date',summary.missingDate]);
    const samples=summary.samples.map(sample=>{
      const calculation=sample.reason==='zeroDenominator'?'0 denominator':sample.reason?'Not evaluated: '+sample.reason.replace(/([A-Z])/g,' $1').toLowerCase():sample.isRatio?
        number(sample.numerator)+' / '+number(sample.denominator)+' = '+(sample.value*100).toFixed(1)+'%':sample.value==null?'Condition checked':String(sample.value);
      return '<tr><td>'+esc(sample.entity)+'</td><td>'+esc(sample.period)+'</td><td>'+esc(calculation)+'</td><td>'+esc(sample.status)+'</td></tr>';
    }).join('');
    return '<div class="researchPopulationPreviewFilter"><strong>'+esc(summary.field)+'</strong><div class="hint">'+esc(summary.mode==='dynamic'?'Dynamic · '+summary.period:'Static · selected research period')+'</div><div class="researchPopulationCounts">'+counts.map(([name,value])=>'<span>'+esc(name)+': <strong>'+number(value)+'</strong></span>').join('')+'</div>'+summary.warnings.map(w=>'<div class="researchWarn">'+esc(w)+'</div>').join('')+'<div class="researchTableWrap"><table><thead><tr><th>Entity</th><th>Period</th><th>Calculation</th><th>Result</th></tr></thead><tbody>'+samples+'</tbody></table></div></div>';
  }).join('');
  return '<details class="researchPopulationPreview"><summary>Population Preview</summary>'+parts+'</details>';
}
function readResearchPopulationBehaviorEditor(){
  return {populationFilterMode:el('researchPopulationFilterMode')?.value||'static',populationFilterPeriod:el('researchPopulationFilterPeriod')?.value||'auto',populationFilterGrain:el('researchPopulationFilterGrain')?.value||'auto',populationFilterEntityField:el('researchPopulationFilterEntityField')?.value||''};
}
function updateResearchPopulationBehaviorUi(){
  const dynamic=el('researchPopulationFilterMode')?.value==='dynamic';
  el('researchPopulationPeriodField')?.classList.toggle('hidden',!dynamic);
  el('researchPopulationEntityField')?.classList.toggle('hidden',el('researchPopulationFilterGrain')?.value!=='items');
  const hint=el('researchPopulationBehaviorHint');
  if(hint)hint.textContent=dynamic?'Re-evaluate eligibility for each rep, coach, or item during every week/date period.':'Evaluate each rep, coach, or item across the selected research population.';
  const select=el('researchPopulationFilterPeriod'),option=select?.querySelector('[value="auto"]');
  if(option){
    const item=currentResearchItemFromEditor(),period=researchPopulationPeriod({...item,populationFilterPeriod:'auto'});
    option.textContent='Automatic ('+({daily:'Day',weekly:'Week',monthly:'Month',period:'Research Period'}[period])+')';
    const timeHint=el('researchWeeklyLines')?.querySelector('.hint'),actual=researchPopulationPeriod(item);
    if(timeHint)timeHint.textContent=dynamic?'Time: '+({daily:'Daily',weekly:'Weekly',monthly:'Monthly',period:'Research Period'}[actual])+' · Eligibility checked for each period':'Time: Weekly · One point per imported week';
  }
}
function renderResearchPopulationBehaviorEditor(item){
  for(const [key,value] of Object.entries({Mode:item.populationFilterMode||'static',Period:item.populationFilterPeriod||'auto',Grain:item.populationFilterGrain||'auto',EntityField:item.populationFilterEntityField||''})){
    const input=el('researchPopulationFilter'+key);if(input)input.value=value;
  }
  for(const id of ['Mode','Period','Grain','EntityField']){
    const input=el('researchPopulationFilter'+id);
    if(input)input.onchange=()=>{updateResearchPopulationBehaviorUi();const preview=el('researchPopulationFilterPreview');if(preview)preview.textContent='Population settings changed. Run the preview again.';updateGuidedResearchUi();};
  }
  const button=el('researchPopulationPreviewBtn');
  if(button)button.onclick=async()=>{
    if(button.disabled)return;
    button.disabled=true;const preview=el('researchPopulationFilterPreview');preview.textContent='Checking population…';
    try{
      await yieldToBrowser();syncResearchEditorStateFromDom();
      const item=effectiveResearchItem(currentResearchItemFromEditor());
      await ensureResearchExecutionIndexes(item);
      const planned=buildQueryPlan(item.source,{item,filters:item.filters,dateColumn:item.dateColumn,startDate:item.startDate,endDate:item.endDate});
      preview.innerHTML=researchPopulationPreviewHtml(planned.plan)||'<div class="hint">'+planned.rows.length.toLocaleString()+' source rows after the existing filters. Add a calculation or select Dynamic to inspect eligibility by entity.</div>';
      preview.querySelector('details')?.setAttribute('open','');
    }catch(error){preview.textContent='Population preview failed: '+error.message;}
    finally{button.disabled=false;}
  };
  const preview=el('researchPopulationFilterPreview');if(preview)preview.innerHTML='';
  updateResearchPopulationBehaviorUi();
}
