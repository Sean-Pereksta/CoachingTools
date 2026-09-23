/* Shared, memory-bounded derived analysis. Source data and stored definitions remain authoritative.
 * Classic script: no server, module loader, network, or persistent schema changes required. */
'use strict';
const AllStarAnalysis=(()=>{
  const stores=new Map(), rowIds=new WeakMap(), sourceEpochs=new Map();
  const limits={modelPlans:80,criterionResults:40000,numericColumns:32};
  const maxWeight=32*1024*1024;
  let sequence=0, epoch=0, weight=0, clock=0;
  const stats={hits:0,misses:0,writes:0,evictions:0,invalidations:0,stages:{},recent:[]};
  const now=()=>typeof performance!=='undefined'?performance.now():Date.now();
  function encode(value){
    if(value instanceof Date) return JSON.stringify(value.toISOString());
    if(value===undefined) return 'undefined';
    if(typeof value==='number'&&!Number.isFinite(value)) return String(value);
    if(Array.isArray(value)) return '['+value.map(encode).join(',')+']';
    if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+encode(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  function objectId(value){ if(!value||typeof value!=='object') return 0; if(!rowIds.has(value)) rowIds.set(value,++sequence); return rowIds.get(value); }
  function namespace(name){ if(!stores.has(name)) stores.set(name,new Map()); return stores.get(name); }
  function depKey(dep){ return typeof dep==='string'?dep:encode(dep||{}); }
  function remove(store,key){ const entry=store.get(key); if(entry){ weight-=entry.weight; store.delete(key); } }
  function record(stage,kind,ms=0,details={}){
    const counter=stats.stages[stage]||(stats.stages[stage]={calls:0,hits:0,misses:0,totalMs:0,maxMs:0});
    counter.calls++; if(kind==='cache hit') counter.hits++; else counter.misses++;
    counter.totalMs+=Math.max(0,ms); counter.maxMs=Math.max(counter.maxMs,ms);
    // Keep aggregate counters for hot-path cache reads; retain only actual work in the timeline.
    if(kind!=='cache hit'){ stats.recent.push({stage,kind,ms:Math.round(ms*100)/100,at:Date.now(),...details}); if(stats.recent.length>80) stats.recent.shift(); }
  }
  function get(name,key,dependencies){
    const store=namespace(name), entry=store.get(key);
    if(!entry||entry.dependencies!==depKey(dependencies)){ if(entry) remove(store,key); stats.misses++; return undefined; }
    store.delete(key); store.set(key,entry); entry.access=++clock; stats.hits++; record(name,'cache hit'); return entry.value;
  }
  function set(name,key,dependencies,value,options={}){
    const store=namespace(name), bytes=Math.max(1,Number(options.weight)||96)+String(key).length*2+depKey(dependencies).length*2;
    remove(store,key); if(bytes>maxWeight) return value;
    store.set(key,{value,dependencies:depKey(dependencies),dep:dependencies||{},weight:bytes,access:++clock}); weight+=bytes; stats.writes++;
    while(store.size>(limits[name]||120)){ remove(store,store.keys().next().value); stats.evictions++; }
    while(weight>maxWeight){
      let oldestStore=null,oldestKey='',oldest=Infinity;
      stores.forEach(candidate=>{ const pair=candidate.entries().next().value; if(pair&&pair[1].access<oldest){ oldest=pair[1].access; oldestStore=candidate; oldestKey=pair[0]; } });
      if(!oldestStore) break; remove(oldestStore,oldestKey); stats.evictions++;
    }
    return value;
  }
  function sourceSignature(source){
    const rows=getRowsRaw(source)||[], headers=getHeaders(source)||[], meta=state.sourceMeta?.[source]||{}, v=state.versions||{};
    const custom=typeof customSource==='function'?customSource(source):null;
    const importModel=typeof activeModelForImport==='function'?activeModelForImport():null;
    return encode({source,epoch,local:sourceEpochs.get(source)||0,rows:objectId(rows),count:rows.length,version:meta.sourceVersion??meta.version??0,headers,
      settings:custom?.columns||null,headerMapping:state.sourceMappings?.[source]||custom?.mappings||custom?.fieldMappings||null,sourceSettings:importModel?.sourceSettings?.[source]||null,updated:custom?.updatedAt||'',aliases:v.aliases||0,teams:v.teams||0,roster:v.roster||0,mappings:v.mappings||0});
  }
  function dependencySignature(sources,extra={}){
    const v=state.versions||{};
    return encode({sources:[...new Set(sources||[])].filter(Boolean).sort().map(sourceSignature),
      identity:[v.aliases||0,v.teams||0,v.roster||0,v.mappings||0],orgs:state.orgs||[],extra});
  }
  function optionsSignature(options={}){
    const publicOptions={rowCachePolicy:[!!options._sourceRowsCache,!!options._entryRowsCache]};
    Object.keys(options).forEach(key=>{ if(key.startsWith('_')||['runId','trueValueDiagnostics','token','onProgress','progressToken'].includes(key)) return; const value=options[key];
      if(value===null||['string','number','boolean','undefined'].includes(typeof value)||value instanceof Date||Array.isArray(value)) publicOptions[key]=value;
    });
    return encode(publicOptions);
  }
  function criterionSources(c,opts={}){
    const sources=new Set(); const add=source=>{if(source) sources.add(source);};
    if(c.calcType==='multi'){ add(c.leftSource); add(c.rightSource); }
    else add(c.calcType==='custom'?(c.customSource||c.source):c.source);
    if(typeof isRowPullCriterion==='function'&&isRowPullCriterion(c)) add(rowPullSourceForCriterion(c));
    if(c.trueValueEnabled) add(c.trueValueSource);
    if(opts.qaTeamScoreMode==='sheetTeam'&&typeof activeDirectQASource==='function') add(activeDirectQASource());
    const expressions=[c.expression];
    (c.filters||[]).forEach(f=>{ add(f.source); if(['includeWithin','excludeWithin'].includes(f.action||f.mode)) add(f.targetSource); expressions.push(f.expression,f.columnExpression); });
    if(typeof expressionRefsForSource==='function') expressions.filter(Boolean).forEach(expression=>{
      expressionRefsForSource(expression,c.customSource||c.source).forEach(ref=>add(ref.source));
    });
    return [...sources];
  }
  function modelPlan(model,opts,build){
    const sources=[...new Set((model?.criteria||[]).flatMap(c=>criterionSources(c,opts)))];
    const key=encode({model,options:optionsSignature(opts)}), deps={sources,identity:true,signature:dependencySignature(sources)};
    const hit=get('modelPlans',key,deps);
    // Editors mutate working definitions. A retained plan must still describe its live criterion references.
    if(hit!==undefined && encode({model:hit.model,options:optionsSignature(opts)})===key) return hit;
    const started=now(), value=build(); record('Model compilation','full calculation',now()-started,{model:model?.name||model?.id||''});
    return set('modelPlans',key,deps,value,{weight:1024+(model?.criteria?.length||0)*512});
  }
  function criterionValue(criterion,entry,opts,compute){
    opts=opts||{};
    // True team values emit per-run lineage; calculated display dates depend on the wall clock.
    if(opts.disableAnalysisCache || (entry?.kind==='team'&&criterion.trueValueEnabled) ||
      (criterion.calcType==='displayColumn'&&['daysSince','monthsSince','yearsSince'].includes(criterion.displayCalculation))) return compute();
    const sources=criterionSources(criterion,opts), key=encode({criterion,entry,options:optionsSignature(opts)});
    const dependencies={sources,identity:true,signature:dependencySignature(sources)};
    const hit=get('criterionResults',key,dependencies); if(hit!==undefined) return hit;
    const started=now(), value=compute(); record('Model execution','partial recalculation',now()-started,{criterion:criterion.name||criterion.id||'',sources});
    return set('criterionResults',key,dependencies,value);
  }
  function numberReader(source,column){
    const dependencies={sources:[source],signature:sourceSignature(source)}, key=source+'\u001f'+column;
    let cache=get('numericColumns',key,dependencies);
    if(!cache){ cache=new WeakMap(); set('numericColumns',key,dependencies,cache,{weight:Math.max(256,(getRowsRaw(source)||[]).length*24)}); }
    return row=>{ if(cache.has(row)) return cache.get(row); const value=toNum(row[column]); cache.set(row,value); return value; };
  }
  function invalidate(dep={}){
    const known=typeof allSourceKeys==='function'?new Set(allSourceKeys()):null;
    const sources=(Array.isArray(dep.sources)?dep.sources:String(dep.source||'').split(',')).filter(Boolean);
    const unknownSource=sources.some(source=>known&&!known.has(source));
    const full=!!dep.full||unknownSource;
    if(full){ epoch++; stores.forEach(store=>store.clear()); weight=0; }
    else {
      sources.forEach(source=>sourceEpochs.set(source,(sourceEpochs.get(source)||0)+1));
      stores.forEach(store=>{ for(const [key,entry] of store){ const d=entry.dep;
        if((sources.length&&(d.sources||[]).some(source=>sources.includes(source))) ||
          ((dep.aliases||dep.teams||dep.mappings||dep.roster)&&d.identity!==false)) remove(store,key);
      } });
    }
    // Model/metric edits are definition-keyed. Unrelated derived entries remain reusable.
    stats.invalidations++; record('Invalidation',full?'full calculation':'partial recalculation',0,{sources,reason:dep.reason||''});
  }
  function diagnostics(){ return {hits:stats.hits,misses:stats.misses,writes:stats.writes,evictions:stats.evictions,invalidations:stats.invalidations,
    estimatedBytes:weight,maxBytes:maxWeight,entries:Object.fromEntries([...stores].map(([name,store])=>[name,store.size])),stages:JSON.parse(JSON.stringify(stats.stages)),recent:stats.recent.slice()}; }
  return {get,set,invalidate,record,diagnostics,sourceSignature,dependencySignature,optionsSignature,criterionSources,modelPlan,criterionValue,numberReader};
})();
if(typeof globalThis!=='undefined') globalThis.AllStarAnalysis=AllStarAnalysis;
