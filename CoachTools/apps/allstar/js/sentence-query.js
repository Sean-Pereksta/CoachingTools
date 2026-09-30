/* Sentence conditions: same physical row first, distinct event count second.
 * Three-valued results intentionally distinguish false from unknown coverage.
 * No imported rows or legacy definitions are mutated. */
(function(root){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  const text=x=>String(x??'').normalize('NFKC').trim().toLowerCase();
  const OPS=['contains','not_contains','eq','neq','gt','gte','lt','lte','blank','not_blank','before','after'];
  const numeric=x=>x!==null&&x!==undefined&&String(x).trim()!==''&&Number.isFinite(Number(x))?Number(x):null;
  function combine(mode,values){
    if(mode==='not')return values[0]===null?null:!values[0];
    if(mode==='all')return values.includes(false)?false:values.includes(null)?null:true;
    if(mode==='any')return values.includes(true)?true:values.includes(null)?null:false;
    throw new Error('Choose all, any, or not for this condition group.');
  }
  function predicate(row,node){
    if(node.kind==='group')return combine(node.mode,node.children.map(n=>predicate(row,n)));
    if(!Object.prototype.hasOwnProperty.call(row,node.field))return null;
    const raw=row[node.field],empty=raw===null||raw===undefined||String(raw).trim()==='';
    if(node.op==='blank')return empty;
    if(node.op==='not_blank')return !empty;
    if(empty)return null;
    const a=text(raw),b=text(node.value);
    switch(node.op){
      case 'contains':return a.includes(b);case 'not_contains':return !a.includes(b);
      case 'eq':return a===b;case 'neq':return a!==b;
      case 'before':case 'after':{
        // Dates must be ISO calendar dates; ambiguous text never gets guessed.
        if(!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))||!/^\d{4}-\d{2}-\d{2}$/.test(String(node.value)))return null;
        return node.op==='before'?raw<node.value:raw>node.value;
      }
      default:{const x=numeric(raw),y=numeric(node.value);if(x===null||y===null)return null;return ({gt:x>y,gte:x>=y,lt:x<y,lte:x<=y})[node.op]??null;}
    }
  }
  function countVerdict(low,high,op,target){
    if(op==='gte')return low>=target?true:high<target?false:null;
    if(op==='gt')return low>target?true:high<=target?false:null;
    if(op==='lt')return high<target?true:low>=target?false:null;
    if(op==='lte')return high<=target?true:low>target?false:null;
    if(op==='eq')return low===target&&high===target?true:low>target||high<target?false:null;
    if(op==='neq'){const v=countVerdict(low,high,'eq',target);return v===null?null:!v;}
    throw new Error('Unsupported event count comparison.');
  }
  function evaluate(node,context){
    if(node.kind==='group'){
      const children=node.children.map(n=>evaluate(n,context));
      return {kind:'group',mode:node.mode,value:combine(node.mode,children.map(x=>x.value)),children};
    }
    if(node.kind==='stat')return context.stat(node);
    const window={start:node.startDate||context.window.start,end:node.endDate||context.window.end};
    if(!window.start||!window.end||window.start>window.end)throw new Error('Choose an event window with a valid start and end.');
    const source=context.sources[node.source],coverage=context.coverage[node.source]||{};
    if(!source)return {kind:'event',source:node.source,value:null,reason:'Event source is not loaded',observed:0,evidence:[]};
    const records=source.byRep.get(context.repId)||[],yes=new Map(),unknown=new Set(),no=[];
    for(const record of records){
      if(record.date<window.start||record.date>window.end)continue;
      const value=predicate(record.fields,node.where);
      if(value===true)yes.set(record.id,record);else if(value===null)unknown.add(record.id);else if(no.length<2)no.push(record);
    }
    for(const id of yes.keys())unknown.delete(id);
    const covered=coverage.complete===true&&!source.invalidRows&&coverage.start<=window.start&&coverage.end>=window.end&&(!coverage.repIds||coverage.repIds.includes(context.repId));
    const value=countVerdict(yes.size,covered?yes.size+unknown.size:Infinity,node.op,Number(node.value));
    return {kind:'event',source:node.source,value,window,observed:yes.size,uncertain:unknown.size,covered,
      reason:value===null?'Insufficient source coverage or missing row values':value?'Matching distinct sessions satisfy the condition':'Session count does not satisfy the condition',
      evidence:[...yes.values()].slice(0,3).map(r=>({date:r.date,row:r.row,id:r.id,fields:copy(r.fields)})),
      nonmatches:no.map(r=>({date:r.date,row:r.row,id:r.id,fields:copy(r.fields)}))};
  }
  function validate(node,catalog,depth=0,rowSource=null){
    if(depth>24)throw new Error('Condition nesting is too deep (maximum 24 levels).');
    if(!node||typeof node!=='object')throw new Error('A condition is missing.');
    if(node.kind==='group'){
      if(!['all','any','not'].includes(node.mode)||!Array.isArray(node.children))throw new Error('Invalid condition group.');
      if(node.mode==='not'&&node.children.length!==1)throw new Error('A NOT group needs exactly one condition.');
      if(node.mode==='any'&&!node.children.length)throw new Error('Add a condition to this ANY group.');
      node.children.forEach(n=>validate(n,catalog,depth+1,rowSource));return;
    }
    if(rowSource!==null){
      if(node.kind!=='field'||!OPS.includes(node.op))throw new Error('Choose a valid same-row modifier.');
      if(!catalog[rowSource]?.includes(node.field))throw new Error('Choose an available field in '+rowSource+'.');
      if(!['blank','not_blank'].includes(node.op)&&String(node.value??'').trim()==='')throw new Error('Enter a value for '+node.field+'.');
      if(['gt','gte','lt','lte'].includes(node.op)&&numeric(node.value)===null)throw new Error('Enter a valid number for '+node.field+'.');
      return;
    }
    if(node.kind==='stat'){
      if(!node.metricId)throw new Error('Choose a metric for this numerical condition.');
      if(!['gt','gte','lt','lte','eq','between'].includes(node.operator)||numeric(node.threshold)===null)throw new Error('Choose a valid numerical comparison.');
      if(node.operator==='between'&&(numeric(node.threshold2)===null||Number(node.threshold2)<Number(node.threshold)))throw new Error('Enter an upper threshold at least as large as the lower threshold.');
      return;
    }
    if(node.kind!=='event'||!Object.prototype.hasOwnProperty.call(catalog,node.source))throw new Error('Choose an available event source.');
    if(!['gt','gte','lt','lte','eq','neq'].includes(node.op)||!Number.isInteger(Number(node.value))||Number(node.value)<0)throw new Error('Enter a nonnegative whole session count.');
    if(!!node.startDate!==!!node.endDate||node.startDate>node.endDate)throw new Error('An event window needs both dates in order.');
    validate(node.where,catalog,depth+1,node.source);
  }
  function sources(node){return [...new Set(node.kind==='group'?node.children.flatMap(sources):node.kind==='event'?[node.source]:[])];}
  const labels={contains:'contains',not_contains:'does not contain',eq:'equals',neq:'does not equal',gt:'is above',gte:'is at least',lt:'is below',lte:'is at most',blank:'is blank',not_blank:'is not blank',before:'is before',after:'is after'};
  function describe(node,label=x=>x){
    if(node.kind==='group'){
      if(!node.children.length)return 'no additional conditions';
      const parts=node.children.map(n=>describe(n,label));
      return node.mode==='not'?'NOT ('+parts[0]+')':'('+parts.join(node.mode==='all'?' AND ':' OR ')+')';
    }
    if(node.kind==='field')return node.field+' '+labels[node.op]+(['blank','not_blank'].includes(node.op)?'':' “'+node.value+'”');
    if(node.kind==='stat')return label(node.metricId)+' '+(labels[node.operator]||node.operator)+' '+node.threshold;
    return label(node.source)+' has '+node.value+' matching sessions ('+node.op+'), where the SAME ROW matches '+describe(node.where,label)+(node.startDate?' during '+node.startDate+'–'+node.endDate:' during the selected qualifying window');
  }
  function installResearch(E,adapter){
    const original=E.research;
    E.research=async function(observations,metric,settings={},events=[],options={}){
      const question=settings.sentenceQuery;
      if(!question)return original.call(this,observations,metric,settings,events,options);
      if(question.version!==1)throw new Error('Unsupported sentence definition version. The saved item has not been changed.');
      if(!['fixed','changing'].includes(settings.mode||'fixed'))throw new Error('Sentence conditions currently support fixed groups or qualification each period. Keep before/after studies in the existing editor.');
      const catalog=adapter.catalog(),data=adapter.sources(metric.source,sources(question.root)),byRep=new Map();
      validate(question.root,catalog);
      for(const o of observations){if(!byRep.has(o.repId))byRep.set(o.repId,[]);byRep.get(o.repId).push(o);}
      const periods=E.series(observations,metric).map(p=>p.period);
      const windows=settings.mode==='changing'?periods:[{start:settings.anchorStart||metric.startDate,end:settings.anchorEnd||metric.endDate}];
      if(windows.some(w=>!w.start||!w.end||w.start>w.end))throw new Error('Choose the qualifying dates for this question.');
      const virtualSource='__allstar_sentence_v1',virtual=[],examples=[],counts={included:0,excluded:0,unknown:0},sampleCounts={included:0,excluded:0,unknown:0};
      let checks=0;
      for(const w of windows)for(const [repId,history] of byRep){
        if(settings.repIds&&!settings.repIds.includes(repId))continue;
        if(options.cancelled?.())throw Object.assign(new Error('Sentence preview cancelled.'),{name:'AbortError'});
        const verdict=evaluate(question.root,{repId,window:w,sources:data,coverage:settings.coverage||{},stat:n=>{
          const def=adapter.metric(n.metricId);
          if(!def||def.source!==metric.source)throw new Error('Choose a numerical condition from the same reporting source.');
          const r=E.criterion(history,def,{...n,startDate:n.startDate||w.start,endDate:n.endDate||w.end});
          return {kind:'stat',metric:def.name,value:r.value==null?null:r.pass,result:r.value,unit:r.unit,reason:r.value==null?'Required numerical periods are unavailable':'Numerical condition evaluated by the existing engine'};
        }});
        const status=verdict.value===true?'included':verdict.value===false?'excluded':'unknown';counts[status]++;
        if(sampleCounts[status]++<20)examples.push({rep:history[0].rep,repId,window:w,verdict});
        if(verdict.value===true)virtual.push({source:virtualSource,repId,id:repId+'|'+w.start,date:w.start,text:'Sentence eligibility',topics:[]});
        if(++checks%200===0)await (options.yield?.()||Promise.resolve());
      }
      // The legacy engine still controls scope, weighting, period selection,
      // missing values and aggregation. Virtual events qualify people, never
      // duplicate numerical observations. They are never persisted as imports.
      const compiled={...settings,eventConditions:[...(settings.eventConditions||[]),{source:virtualSource,operator:'gte',threshold:1}]};
      const result=await original.call(this,observations,metric,compiled,[...events,...virtual],options);
      result.definition={...result.definition,settings:copy(settings)};
      result.sentenceEvidence={counts,examples,totalChecks:checks,description:describe(question.root,adapter.label),invalidRows:Object.fromEntries(Object.entries(data).map(([s,d])=>[s,d.invalidRows||0]))};
      return result;
    };
    return ()=>{E.research=original;};
  }
  const api={installResearch,copy,OPS,labels,numeric,combine,predicate,countVerdict,evaluate,validate,sources,describe};
  root.AllStarSentenceQuery=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
