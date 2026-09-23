'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const XLSX=require('../../../vendor/xlsx.full.min.js');
const root=path.resolve(__dirname,'..');

// Exercise the actual classic-script order and persisted data contracts. Each
// manual fixture gets an isolated app so fixture state cannot leak between cases.
function createHarness(storage=new Map(),db=new IDBFactory()){
  const html=fs.readFileSync(path.join(root,'allstar.html'),'utf8');
  const {document,window:dom}=parseHTML(html);
  Object.defineProperty(dom.HTMLSelectElement.prototype,'value',{configurable:true,
    get(){return [...this.options].find(option=>option.selected)?.value||this.options[0]?.value||'';},
    set(value){const options=[...this.options],selected=options.find(option=>option.value===String(value));options.forEach(option=>option.removeAttribute('selected'));if(selected)selected.setAttribute('selected','');}
  });
  Object.defineProperty(dom.HTMLSelectElement.prototype,'selectedOptions',{configurable:true,get(){return [...this.options].filter(option=>option.selected);}});
  Object.defineProperty(dom.HTMLInputElement.prototype,'checked',{configurable:true,get(){return this.hasAttribute('checked');},set(value){if(value)this.setAttribute('checked','');else this.removeAttribute('checked');}});
  Object.defineProperty(dom.HTMLTextAreaElement.prototype,'value',{configurable:true,get(){if(Object.prototype.hasOwnProperty.call(this,'_fixtureValue'))return this._fixtureValue;const text=document.createElement('span');text.innerHTML=this.textContent.replace(/</g,'&lt;');return text.textContent;},set(value){this._fixtureValue=String(value??'');}});
  const timers=new Set(),errors=[];
  const later=(callback,delay,...args)=>{const timer=setTimeout(()=>{timers.delete(timer);callback(...args);},delay);timers.add(timer);return timer;};
  const cancel=timer=>{timers.delete(timer);clearTimeout(timer);};
  const noop=()=>{};
  const location={search:'',protocol:'file:',href:'file:///All-Star.html'};
  const window={document,indexedDB:db,addEventListener:noop,removeEventListener:noop,location,dispatchEvent:noop};
  const context=vm.createContext({document,window,indexedDB:db,IDBKeyRange,XLSX,
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
    console:{log:noop,info:noop,warn:noop,error:(...args)=>errors.push(args),table:noop,time:noop,timeEnd:noop,groupCollapsed:noop,groupEnd:noop},
    performance,setTimeout:later,clearTimeout:cancel,setInterval,clearInterval,requestAnimationFrame:callback=>later(callback,0),
    structuredClone,URL,URLSearchParams,TextEncoder,TextDecoder,Blob,Event:dom.Event,CustomEvent:dom.CustomEvent,
    CSS:{escape:value=>String(value)},navigator:{},location,alert:message=>errors.push([message]),confirm:()=>true});
  const scripts=[...html.matchAll(/<script\s+src="(js\/[^"?]+)(?:\?[^\"]*)?"><\/script>/g)].map(match=>match[1]).filter(name=>name!=='js/app.js');
  vm.runInContext(scripts.map(name=>fs.readFileSync(path.join(root,name),'utf8')).join('\n'),context);
  // The callable historical fixture uses the former helper name.
  vm.runInContext('const buildDataIndex=rebuildDataIndexSync; if(typeof AllStarAnalysis!=="undefined")window.AllStarAnalysis=AllStarAnalysis; state.startup.running=false; state.lifecycle.hidden=false; loadModels();',context);
  return {context,storage,db,errors,run:code=>vm.runInContext(code,context),close(){for(const timer of timers)clearTimeout(timer);timers.clear();}};
}
const plain=value=>JSON.parse(JSON.stringify(value));

async function manualFixtures(){
  for(const name of ['runDocumentedCoachingDescriptionPipelineRegressionTests','runRunIndexRegressionTests','runFinalRunPerformanceRegressionTests','runResearchArchitectureV4RegressionTests','runWorkflowModernizationRegressionTests','runLookupPackagePerformanceRegressionTests','runImportCachePersistenceRegressionTests','runAllStarStartupLifecycleRegressionTests']){
    const h=createHarness();
    try{
      h.run(fs.readFileSync(path.join(root,'tests/regression-tests.js'),'utf8'));
      const results=await h.run(`window.${name}()`);
      if(Array.isArray(results))assert.deepEqual(plain(results.filter(result=>result.pass===false)),[],name);
      else assert.equal(results,true,name);
      console.log(`PASS compatibility fixture: ${name}`);
    }finally{h.close();}
  }
}

async function scoringAndResearch(){
  const h=createHarness();
  try{
    h.run(`
      state.data.retail.headers.sv2=['Representative','Team','Metric','Points','Label','Date'];
      state.data.retail.sv2=[
        {Representative:'Alice Able',Team:'Alpha',Metric:20,Points:2,Label:'A',Date:'2026-09-01'},
        {Representative:'Alice Able',Team:'Alpha',Metric:10,Points:1,Label:'A',Date:'2026-09-08'},
        {Representative:'Bob Baker',Team:'Alpha',Metric:10,Points:1,Label:'B',Date:'2026-09-01'},
        {Representative:'Cara Clark',Team:'Beta',Metric:30,Points:0,Label:'C',Date:'2026-09-01'}
      ].map(row=>({...row,_rep:row.Representative,_repKey:fullNameIdentityKey(row.Representative),_team:row.Team,_sourceKey:'retail_sv2'}));
      state.sourceMeta.retail_sv2={sourceVersion:1};
      markDataIndexDirty('compatibility fixture',{sources:['retail_sv2']});
      buildDataIndex('compatibility fixture');
      const fixtureModel=normalizeModelForStorage({id:'compat-model',name:'Compatibility Model',type:'both',criteria:[
        {...emptyCriterion(),id:'metric',name:'Metric Rank',column:'Metric',aggregate:'sum',scoreType:'rank',direction:'higher'},
        {...emptyCriterion(),id:'points',name:'Points',column:'Points',aggregate:'sum',scoreType:'points',points:2,zeroCanWin:true},
        {...emptyCriterion(),id:'label',name:'Label',calcType:'displayColumn',lookupMatchColumn:'Representative',lookupReturnColumn:'Label',lookupSelection:'first'}
      ]});
      const fixtureEntries=['Alice Able','Bob Baker','Cara Clark'].map(name=>({kind:'rep',name,key:fullNameIdentityKey(name),team:name==='Cara Clark'?'Beta':'Alpha'}));
      const fixtureOptions=()=>({_sourceRowsCache:new Map(),_entryRowsCache:new Map(),_criterionPlan:compileRunCriterionPlan(fixtureModel,{})});
      const fixturePack=computeEntries(fixtureModel,fixtureEntries,'rep',fixtureOptions());
      const scoringSummary=pack=>pack.rows.map(row=>({name:row.entry.name,values:row.values,score:row.overallScore,rank:row.overallRank,eligible:row.eligible}));
    `);
    const golden=[
      {name:'Cara Clark',values:{metric:30,points:0,label:'C'},score:1,rank:1,eligible:true},
      {name:'Bob Baker',values:{metric:10,points:1,label:'B'},score:5,rank:2,eligible:true},
      {name:'Alice Able',values:{metric:30,points:3,label:'A'},score:7,rank:3,eligible:true}
    ];
    assert.deepEqual(plain(h.run('scoringSummary(fixturePack)')),golden);
    assert.deepEqual(plain(await h.run('computeEntriesAsync(fixtureModel,fixtureEntries,"rep",fixtureOptions()).then(scoringSummary)')),golden);
    const teams=plain(h.run('scoringSummary(computeEntries(fixtureModel,teamEntries(["Alpha","Beta"]),"team",fixtureOptions()))'));
    assert.deepEqual(teams.map(row=>({name:row.name,metric:row.values.metric,score:row.score,rank:row.rank})),[{name:'Beta',metric:30,score:2,rank:1},{name:'Alpha',metric:40,score:9,rank:2}]);
    console.log('PASS golden representative points, ties, ranks, zero values, display fields, and team scores');
    h.run(`const fixtureResearch=normalizeResearchItem({id:'compat-research',title:'Team totals',source:'retail_sv2',analysisGrain:'rows',outputType:'table',groupField:'Team',valueMode:'sum',valueField:'Metric',columns:[{id:'metric',label:'Metric',mode:'sum',field:'Metric'}],sort:'default',totals:true});`);
    const cold=await h.run('evaluateResearchItemAsync(fixtureResearch)');
    const warm=await h.run('evaluateResearchItemAsync(fixtureResearch)');
    assert.deepEqual(plain(cold.data.map(row=>({label:row.label,values:row.values}))),[{label:'Alpha',values:[40]},{label:'Beta',values:[30]}]);
    assert.deepEqual(plain(cold.data),plain(warm.data));
    assert.equal(warm.perf.cacheUsed,true);
    assert.deepEqual(plain(cold.totalValues),[70]);
    h.context.resultForStorage=cold;
    await h.run('researchRenderedResultPut(fixtureResearch,resultForStorage,"2026-09-23T00:00:00.000Z")');
    const restored=createHarness(h.storage,h.db);
    try{assert.deepEqual(plain((await restored.run('researchRenderedResultGet("compat-research")')).data),plain(cold.data));}finally{restored.close();}
    console.log('PASS golden Research aggregation, cold/warm equality, totals, and saved-result reopening');
  }finally{h.close();}
}

async function persistenceCompatibility(){
  const legacyModel={id:'legacy-model',name:'Saved model',criteria:[{id:'legacy-criterion',source:'retail_sv2',calcType:'single',column:'Metric',aggregate:'sum',audience:'both',scoreType:'rank'}]};
  const legacyItem={id:'legacy-research',title:'Saved research',source:'retail_sv2',groupField:'Team',outputType:'table',valueMode:'countBy',columns:[{id:'legacy-column',label:'Old label',mode:'count',field:'Metric'}],filters:[{id:'legacy-filter',field:'Metric',operator:'greater_than',value:'0'}]};
  const storage=new Map([
    ['allStarStandaloneModels.v1',JSON.stringify([legacyModel])],
    ['allStarResearchItems.v1',JSON.stringify([legacyItem])],
    ['allStarOrgBuilder.v1',JSON.stringify([{id:'legacy-org',name:'Legacy Org',coachNames:['Alpha']}])],
    ['allStarRepAliases.v1',JSON.stringify({'alice a':'Alice Able'})]
  ]);
  const h=createHarness(storage);
  try{
    h.run('loadResearchItems({definitionsOnly:true});loadOrgs();');
    assert.equal(h.run('state.models[0].id'),'legacy-model');
    assert.equal(h.run('state.models[0].criteria[0].id'),'legacy-criterion');
    assert.equal(h.run('state.models[0].criteria[0].aggregate'),'sum');
    assert.equal(h.run('state.researchItems[0].id'),'legacy-research');
    assert.equal(h.run('state.researchItems[0].valueMode'),'count_by');
    assert.equal(h.run('state.researchItems[0].filters[0].value'),'0');
    assert.equal(h.run('state.researchItems[0].columns[0].label'),'Old label');
    assert.equal(h.run('state.orgs[0].id'),'legacy-org');
    h.run('saveModels();persistResearchItemsToLocalStorage();');
    assert.equal(JSON.parse(storage.get('allStarStandaloneModels.v1'))[0].id,'legacy-model');
    assert.equal(JSON.parse(storage.get('allStarResearchItems.v1'))[0].id,'legacy-research');
    assert.equal(storage.get('allStarRepAliases.v1'),JSON.stringify({'alice a':'Alice Able'}));
    console.log('PASS legacy models, Research definitions, organizations, IDs, and storage keys');
  }finally{h.close();}
}

async function joinsDatesAndInvalidation(){
  const h=createHarness();
  try{
    h.run(`
      const fixtureRow=(name,team,metric,date)=>({Representative:name,Team:team,Metric:metric,Date:date,_rep:name,_repKey:fullNameIdentityKey(name),_team:team});
      state.data.retail.headers.sv2=state.data.referral.headers.sv2=['Representative','Team','Metric','Date'];
      state.data.retail.sv2=[fixtureRow('Alice Able','Alpha',10,'2026-09-01'),fixtureRow('Bob Baker','Alpha',20,'2026-09-02'),fixtureRow('Cara Clark','Beta',30,'2026-09-03')];
      state.data.referral.sv2=[fixtureRow('Alice Able','Alpha',5,'2026-09-01'),fixtureRow('Bob Baker','Alpha',7,'2026-09-02'),fixtureRow('Dan Delta','Beta',11,'2026-09-03')];
      state.sourceMeta.retail_sv2={sourceVersion:1};state.sourceMeta.referral_sv2={sourceVersion:1};
      markDataIndexDirty('compatibility joins',{sources:['retail_sv2','referral_sv2']});rebuildDataIndexSync('compatibility joins');
      const joinItem={source:'retail_sv2',analysisGrain:'representatives',crossSourceJoinMode:'strict_rep'};
      const aliceRows=[state.data.retail.sv2[0]],caraRows=[state.data.retail.sv2[2]];
    `);
    assert.deepEqual(plain(h.run('resolveRowsForCohort("referral_sv2",{baseRows:aliceRows,baseSource:"retail_sv2",item:joinItem}).rows.map(row=>row.Metric)')),[5]);
    assert.deepEqual(plain(h.run('resolveRowsForCohort("referral_sv2",{baseRows:caraRows,baseSource:"retail_sv2",item:joinItem}).rows.map(row=>row.Metric)')),[]);
    assert.deepEqual(plain(h.run('resolveRowsForCohort("referral_sv2",{baseRows:caraRows,baseSource:"retail_sv2",item:{...joinItem,crossSourceJoinMode:"rep_then_team"}}).rows.map(row=>row.Metric)')),[11]);
    h.run(`const datedItem=normalizeResearchItem({id:'dates-fixture',source:'retail_sv2',analysisGrain:'rows',outputType:'table',groupField:'Team',dateColumn:'Date',startDate:'2026-09-02',endDate:'2026-09-03',columns:[{label:'Total',mode:'sum',field:'Metric'}],totals:true});`);
    const dated=await h.run('evaluateResearchItemAsync(datedItem)');
    assert.deepEqual(plain(dated.data.map(row=>({label:row.label,values:row.values}))),[{label:'Alpha',values:[20]},{label:'Beta',values:[30]}]);
    assert.deepEqual(plain(dated.totalValues),[50]);
    h.run('state.data.retail.sv2[1].Metric=200;markDataIndexDirty("authoritative replacement",{sources:["retail_sv2"]});');
    const replaced=await h.run('evaluateResearchItemAsync(datedItem)');
    assert.deepEqual(plain(replaced.totalValues),[230],'explicit source invalidation must reject same-size stale totals');
    console.log('PASS strict and disclosed fallback joins, inclusive dates, and same-size source invalidation');
    h.run(`
      state.models.push(normalizeModelForStorage({id:'dependency-model',name:'Dependency Model',criteria:[{...emptyCriterion(),id:'ratio',name:'Ratio',calcType:'multi',leftSource:'retail_sv2',leftColumn:'Metric',rightSource:'referral_sv2',rightColumn:'Metric',operator:'divide'}]}));
      const dependencyItem=normalizeResearchItem({id:'dependency-research',source:'retail_sv2',analysisGrain:'representatives',outputType:'table',groupField:'Representative',columns:[{label:'Ratio',mode:'expression',field:'model("Dependency Model","Ratio") * 100'}]});
    `);
    const before=await h.run('evaluateResearchItemAsync(dependencyItem)');
    const bobBefore=before.data.find(row=>row.label==='Bob Baker').values[0];
    assert.ok(Math.abs(bobBefore-200/7*100)<1e-7,JSON.stringify({bobBefore,warnings:before.warnings}));
    h.run('state.data.referral.sv2[1].Metric=14;state.sourceMeta.referral_sv2.sourceVersion++;markDataIndexDirty("referral update",{sources:["referral_sv2"]});');
    const after=await h.run('evaluateResearchItemAsync(dependencyItem)');
    const bobAfter=after.data.find(row=>row.label==='Bob Baker').values[0];
    assert.ok(Math.abs(bobAfter-200/14*100)<1e-7,'formulas must invalidate transitive model source dependencies');
    console.log('PASS Research formulas invalidate indirect model source dependencies');
  }finally{h.close();}
}

async function main(){await manualFixtures();await scoringAndResearch();await persistenceCompatibility();await joinsDatesAndInvalidation();}
module.exports={createHarness,plain,runCompatibilityTests:main};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
