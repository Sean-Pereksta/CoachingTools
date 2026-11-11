'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb'),{parseHTML}=require('linkedom');
const root=path.resolve(__dirname,'..');

function harness(){
  const html=fs.readFileSync(path.join(root,'apps/allstar/allstar.html'),'utf8'),{document}=parseHTML(html),values=new Map(),timers=new Set();
  const later=(fn,delay,...args)=>{const id=setTimeout(()=>{timers.delete(id);fn(...args);},delay);timers.add(id);return id;};
  const context=vm.createContext({document,indexedDB:new IDBFactory(),IDBKeyRange,console:{info(){},warn(){},error(){},groupCollapsed(){},groupEnd(){},table(){}},performance,structuredClone,TextEncoder,TextDecoder,URL,URLSearchParams,Blob,
    XLSX:require('../vendor/xlsx.full.min.js'),AbortController,setTimeout:later,clearTimeout,setInterval,clearInterval,queueMicrotask,requestAnimationFrame:fn=>later(fn,0),
    location:{protocol:'file:',search:'',pathname:'/apps/allstar/allstar.html'},navigator:{},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)},
    addEventListener(){},removeEventListener(){},dispatchEvent(){},CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;},alert(){},confirm:()=>true});
  context.window=context;context.parent=context;
  for(const file of ['coachtools-storage.js','coachtools-app-data.js'])vm.runInContext(fs.readFileSync(path.join(root,'shared',file),'utf8'),context,{filename:file});
  const scripts=[...html.matchAll(/<script\s+src="(js\/[^"?]+)(?:\?[^\"]*)?"><\/script>/g)].map(match=>match[1]).filter(file=>file!=='js/app.js');
  vm.runInContext(scripts.map(file=>fs.readFileSync(path.join(root,'apps/allstar',file),'utf8')).join('\n'),context);
  vm.runInContext(`
    state.startup.running=false;state.lifecycle.hidden=false;loadModels();
    let scopeKeyReads=0,scopeResolutions=0,teamRebuilds=0,yields=0;
    const originalScopeKey=CoachToolsData.getScopeKey,originalResolve=CoachToolsData.resolveReadScope,originalRebuild=rebuildTeams,originalYield=yieldToBrowser;
    CoachToolsData.getScopeKey=(...args)=>{scopeKeyReads++;return originalScopeKey(...args);};
    CoachToolsData.resolveReadScope=(...args)=>{scopeResolutions++;return originalResolve(...args);};
    rebuildTeams=(...args)=>{teamRebuilds++;return originalRebuild(...args);};
    yieldToBrowser=(...args)=>{yields++;return originalYield(...args);};
    function resetCounts(){scopeKeyReads=scopeResolutions=teamRebuilds=yields=0;}
    function seedRows(count=12000){
      state.data.qa.headers=['Agent Name','Team','Score %'];
      state.data.qa.rows=Array.from({length:count},(_,index)=>{const coach=index%2?'Coach B':'Coach A',rep=index%2?'B Rep':'A Rep';return {_sourceKey:'qa',_rep:rep,_repKey:nameKey(rep),_team:coach,'Agent Name':rep,Team:coach,'Score %':90};});
      state.data.retail.controlRoster=[{representative:'A Rep',team:'Coach A'},{representative:'B Rep',team:'Coach B'}];
      state.sourceMeta.qa={status:'ready',version:1};
    }
  `,context);
  return {context,run:code=>vm.runInContext(code,context),close(){for(const id of timers)clearTimeout(id);}};
}

(async()=>{
  const h=harness(),c=h.context;
  try{
    await c.CoachToolsData.ready();h.run('seedRows();');
    // Startup already restored a verified compact team index. An all-people
    // view must not discard it or re-walk 12,000 rows to discover no restriction.
    h.run(`state.teamIndexCache={signature:'restored-index',teamCounts:[{team:'Coach A',count:1}],repsByTeam:new Map()};const restoredTeamIndex=state.teamIndexCache;resetCounts();`);
    await h.run('prepareAllStarGlobalScope({deferTeamRebuild:true})');
    assert.equal(h.run('teamRebuilds'),0,'all-people startup leaves team rebuilding deferred');
    assert.equal(h.run('state.teamIndexCache===restoredTeamIndex'),true,'all-people startup retains the restored compact team index');
    assert.ok(h.run('scopeKeyReads')<12,'all-people preparation reads scope a bounded number of times');
    h.run('resetCounts();');
    await h.run('prepareAllStarGlobalScope({deferTeamRebuild:true})');
    assert.equal(h.run('teamRebuilds'),0,'unchanged startup preparation cannot rebuild teams');
    assert.equal(h.run('scopeResolutions'),0,'unchanged inputs reuse the resolved scope');

    c.CoachToolsStorage.setScope({mode:'coach',label:'Coach A',coaches:['Coach A']});
    h.run('resetCounts();');
    await h.run('prepareAllStarGlobalScope({deferTeamRebuild:true})');
    assert.equal(h.run('teamRebuilds'),0,'coach-scoped startup also leaves full team rebuilding deferred');
    assert.ok(h.run('yields')>0,'large local roster discovery yields to the browser');
    h.run('resetCounts();');
    assert.equal(h.run("getRowsRaw('qa').length"),6000);
    assert.ok(h.run('scopeKeyReads')<=8,'filtering reads scope once per batch instead of once per row');
    assert.equal(h.run('state.data.qa.rows.length'),12000,'view filtering keeps the full backing population');
    assert.equal(h.run("sourceCacheValue('qa').rows.length"),12000,'saving uses the full backing population');
    h.run('resetCounts();');
    await h.run('prepareAllStarGlobalScope({deferTeamRebuild:true})');
    assert.equal(h.run('scopeResolutions'),0,'unchanged coach scope reuses its roster membership');
    assert.equal(h.run('teamRebuilds'),0);

    // Hold a real sliced run-index build at its first yield, switch to an equally
    // sized population, then release it. The old asynchronous job must reject.
    h.run(`
      const runRowsA=getRowsRaw('qa'),runSignatureA=sourceVersionSignature('qa');
      let releaseRunIndex,pauseNextRunYield=true;
      const runIndexGate=new Promise(resolve=>{releaseRunIndex=resolve;});
      yieldToBrowser=()=>{yields++;if(pauseNextRunYield){pauseNextRunYield=false;return runIndexGate;}return originalYield();};
      const obsoleteRunOutcome=ensureRunSourceIndex('qa').then(()=>({resolved:true}),error=>({error:String(error.message)}));
    `);
    // Equal-sized coach populations used to make old run/research indexes look
    // current after a scope switch. Neither population may reuse the other's rows.
    h.run(`state.researchSourceIndexes=new Map([['qa',{sentinel:true}]]);state.researchResultCache=new Map([['old',{dependencies:{sources:['qa']}}]]);`);
    c.CoachToolsStorage.setScope({mode:'coach',label:'Coach B',coaches:['Coach B']});
    assert.equal(h.run("getRowsRaw('qa').length"),0,'stale previous-scope rows stay hidden during preparation');
    await h.run('prepareAllStarGlobalScope({deferTeamRebuild:true})');
    assert.deepEqual(Array.from(h.run("[...new Set(getRowsRaw('qa').map(row=>row._rep))]")),['B Rep']);
    assert.equal(h.run('state.runIndexes.size'),0,'scope switch invalidates prepared run indexes');
    assert.equal(h.run('state.researchSourceIndexes.size'),0,'scope switch invalidates prepared research indexes');
    assert.equal(h.run('state.researchResultCache.size'),0,'scope switch invalidates computed results');
    h.run('releaseRunIndex();');
    const obsolete=await h.run('obsoleteRunOutcome');
    assert.match(obsolete.error,/source|scope.*changed/i,'obsolete asynchronous preparation is rejected');
    assert.equal(h.run('state.runIndexes.size'),0,'old preparation cannot repopulate the new scope cache');
    h.run(`state.runIndexes.set('qa',{rows:runRowsA,signature:runSignatureA});state.indexes={qa:{rows:runRowsA}};`);
    assert.equal(h.run("sourceIndex('qa')"),null,'fallback run and legacy indexes cannot expose a stale population');
    h.run('state.runIndexes.clear();state.indexes=null;');
    const preparedB=await h.run("ensureRunSourceIndex('qa')");
    assert.equal(preparedB.rows.length,6000);
    assert.equal(preparedB.rows[0]._rep,'B Rep','new preparation indexes the current coach');
    assert.notEqual(h.run("sourceVersionSignature('qa')"),h.run('runSignatureA'),'equal-sized populations have scope-specific signatures');

    // Headerless events still join through an authoritative cached local roster.
    h.run(`state.data.checklist.headers=['Associate Name','Incident'];state.data.checklist.rows=[{_sourceKey:'checklist',_rep:'B Rep','Associate Name':'B Rep',Incident:'Absence'},{_sourceKey:'checklist',_rep:'A Rep','Associate Name':'A Rep',Incident:'Absence'}];bumpVersion('data');`);
    await h.run('prepareAllStarGlobalScope({deferTeamRebuild:true})');
    assert.deepEqual(Array.from(h.run("getRowsRaw('checklist').map(row=>row._rep)")),['B Rep'],'names-only events use local roster membership');
    // A changed local roster must invalidate membership even when scope is unchanged.
    h.run(`state.data.retail.controlRoster=[{representative:'A Rep',team:'Coach B'},{representative:'B Rep',team:'Coach A'}];state.data.qa.rows=[];bumpVersion('roster');`);
    await h.run('prepareAllStarGlobalScope({deferTeamRebuild:true})');
    assert.deepEqual(Array.from(h.run("getRowsRaw('checklist').map(row=>row._rep)")),['A Rep']);
    c.CoachToolsStorage.setScope({mode:'all',label:'All people'});
    await h.run('prepareAllStarGlobalScope({deferTeamRebuild:true})');
    assert.equal(h.run("getRowsRaw('checklist').length"),2,'all-people view restores both stored events');
    console.log('All-Star scoped startup work bounds, cache invalidation and full backing population tests passed.');
  }finally{h.close();}
  // Double-clicking All-Star has no parent prefetch adapter. It must use the
  // same full management read as the desktop bridge on its very first import.
  const standalone=harness(),s=standalone.context;
  try{
    await s.CoachToolsData.ready();
    await s.CoachToolsData.importDataset('qa',{workbook:{sheets:['QA'],data:{QA:{aoa:[
      ['Agent Name','Team','Score %','Interaction Start Time','Assigned Date'],
      ['A Rep','Coach A','90%','2026-10-07','2026-10-08'],
      ['B Rep','Coach B','99%','2026-10-07','2026-10-08']
    ]}}}},{originalFileName:'Both coaches QA.csv'});
    s.CoachToolsStorage.setScope({mode:'coach',label:'Coach A',coaches:['Coach A']});
    const synced=await standalone.run("syncAllStarFromCoachToolsData({render:false,persist:false,deferTeamRebuild:true,onlyDatasets:['qa']})");
    assert.equal(synced.changed,true,synced.error||JSON.stringify(synced));
    assert.equal(standalone.run('state.data.qa.rows.length'),2,'standalone first load keeps both coaches in its editable backing source');
    assert.equal(standalone.run("sourceCacheValue('qa').rows.length"),2);
    assert.deepEqual(Array.from(standalone.run("getRowsRaw('qa').map(row=>row._rep)")),['A Rep']);
    s.CoachToolsStorage.setScope({mode:'coach',label:'Coach B',coaches:['Coach B']});
    await standalone.run("syncAllStarFromCoachToolsData({render:false,persist:false,deferTeamRebuild:true,onlyDatasets:['qa']})");
    assert.deepEqual(Array.from(standalone.run("getRowsRaw('qa').map(row=>row._rep)")),['B Rep'],'switching coach exposes the retained standalone source');
    console.log('All-Star standalone scoped first-load management read tests passed.');
  }finally{standalone.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
