'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const idb=require('fake-indexeddb'),{parseHTML}=require('linkedom');
const root=path.resolve(__dirname,'..');
function environment(allstar=false){
  const html=allstar?fs.readFileSync(path.join(root,'apps/allstar/allstar.html'),'utf8'):'<html><body></body></html>';
  const {document}=parseHTML(html),values=new Map(),timers=new Set();
  const later=(fn,delay,...args)=>{const id=setTimeout(()=>{timers.delete(id);fn(...args)},delay);timers.add(id);return id;};
  const context=vm.createContext({...idb,indexedDB:new idb.IDBFactory(),document,console,performance,setTimeout:later,clearTimeout,setInterval,clearInterval,queueMicrotask,structuredClone,TextEncoder,TextDecoder,URL,URLSearchParams,Blob,
    XLSX:require('../vendor/xlsx.full.min.js'),location:{search:'',protocol:'file:',pathname:allstar?'/apps/allstar/allstar.html':'/apps/verification-all-star.html'},navigator:{},
    localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)},
    addEventListener(){},removeEventListener(){},dispatchEvent(){},CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;},alert(){},confirm:()=>true,requestAnimationFrame:fn=>later(fn,0)});
  context.window=context;context.parent=context;
  const shared=['coachtools-storage.js','coachtools-app-data.js','weekly-data-builder-core.js','verification-all-star-data.js'];
  for(const file of shared)vm.runInContext(fs.readFileSync(path.join(root,'shared',file),'utf8'),context,{filename:file});
  if(allstar){
    const scripts=[...html.matchAll(/<script\s+src="(js\/[^"?]+)(?:\?[^\"]*)?"><\/script>/g)].map(match=>match[1]).filter(name=>name!=='js/app.js');
    vm.runInContext(scripts.map(file=>fs.readFileSync(path.join(root,'apps/allstar',file),'utf8')).join('\n'),context);
    vm.runInContext('state.startup.running=false;state.lifecycle.hidden=false;loadModels();',context);
  }
  return{context,run:code=>vm.runInContext(code,context),close(){for(const id of timers)clearTimeout(id)}};
}
const dock=rows=>({workbook:{sheets:['Data'],data:{Data:{aoa:rows}}}});

test('Verification uploaded roster, stored history, metrics and uploads stay within Coach A then Coach B',async()=>{
  const h=environment(),c=h.context;try{
    await c.CoachToolsData.ready();
    await c.CoachToolsData.importDataset('weeklyReferral',dock([['Date','Coach','Name','Wipers Accepted','Wipers Offered'],['10/7/2026','Coach A','A Rep',4,20],['10/7/2026','Coach B','B Rep',8,20]]),{detectedPeriod:{periodKey:'2026-10-07',sortKey:'2026-10-07'}});
    await c.CoachToolsData.importDataset('qa',dock([['Agent Name','Team','Interaction Start Time','Score %'],['A Rep','Coach A','10/7/2026','90%'],['B Rep','Coach B','10/7/2026','99%']]));
    await c.CoachToolsData.importDataset('checklist',dock([['Associate Name','Coach Assigned','Incident Date','Incident','Corrective'],['A Rep','Coach A','10/7/2026','Other',''],['B Rep','Coach B','10/7/2026','Absence','Written']]));
    const reps=[{name:'A Rep',coach:'Coach A',lane:1,vaph:10},{name:'B Rep',coach:'Coach B',lane:1,vaph:20}];
    c.CoachToolsStorage.setScope({mode:'coach',label:'Coach A',coaches:['Coach A']});
    let report=await c.VerificationAllStarData.loadMonth('2026-10',reps,{uploads:[{rows:[{name:'B Rep',key:'b rep',date:'2026-10-14',accepted:99,offered:100}]}]});
    assert.deepEqual(Array.from(report.reps,rep=>rep.name),['A Rep']);
    assert.deepEqual(Object.keys(report.metrics),['a rep']);
    assert.equal(report.metrics['a rep'].accepted,4);
    assert.equal(report.metrics['a rep'].quality,0.9);
    assert.equal(report.scopeLabel,'Coach A');
    assert.deepEqual(Array.from(report.weeks),['2026-10-07']);
    c.CoachToolsStorage.setScope({mode:'coach',label:'Coach B',coaches:['Coach B']});
    report=await c.VerificationAllStarData.loadMonth('2026-10',reps);
    assert.deepEqual(Array.from(report.reps,rep=>rep.name),['B Rep']);
    assert.deepEqual(Object.keys(report.metrics),['b rep']);
    assert.equal(report.metrics['b rep'].accepted,8);
    c.CoachToolsStorage.setScope({mode:'all',label:'All people'});
    report=await c.VerificationAllStarData.loadMonth('2026-10',reps);
    assert.equal(report.reps.length,2,'clearing view scope restores the complete source');
    assert.equal((await c.CoachToolsData.getCurrent('weeklyReferral')).workbook.data.Data.aoa.length,3,'source was not destructively scoped');
  }finally{h.close()}
});

test('Allstar cache, team list, report rows and Qualtrics bridge use coach scope without changing stored arrays',async()=>{
  const h=environment(true),c=h.context;try{
    await c.CoachToolsData.ready();
    h.run(`
      const a={_rep:'A Rep',_repKey:'a rep',_team:'Coach A','Agent Name':'A Rep',Team:'Coach A','Score %':'90%'},b={_rep:'B Rep',_repKey:'b rep',_team:'Coach B','Agent Name':'B Rep',Team:'Coach B','Score %':'99%'};
      state.data.qa.rows=[a,b];state.data.qa.headers=['Agent Name','Team','Score %'];
      state.data.retail.sv2=[a,b];state.data.retail.headers.sv2=['Agent Name','Team','Score %'];
      state.data.retail.controlRoster=[{representative:'A Rep',team:'Coach A'},{representative:'B Rep',team:'Coach B'}];
      state.selectedTeams=new Set(['Coach B']);state.teams=['Coach B'];state.teamSelectionInitialized=true;
      state.orgs=[{id:'mixed',name:'Shared group',coachNames:['Coach A','Coach B']},{id:'b-only',name:'Other group',coachNames:['Coach B']}];
    `);
    c.CoachToolsStorage.setScope({mode:'coach',label:'Coach A',coaches:['Coach A']});
    await h.run('prepareAllStarGlobalScope()');
    assert.deepEqual(Array.from(h.run("getRowsRaw('qa').map(row=>row._rep)")),['A Rep']);
    assert.deepEqual(Array.from(h.run('state.teams')),['Coach A']);
    assert.deepEqual(Array.from(h.run('[...state.selectedTeams]')),['Coach A'],'a remembered other coach cannot remain selected');
    assert.deepEqual(Array.from(h.run('controlRosterRows().map(row=>row._rep)')),['A Rep']);
    assert.deepEqual(Array.from(h.run("qualtricsStatRows('combined_sv2').rows.map(row=>row._rep)")),['A Rep']);
    const bridge=await h.run('buildQualtricsCorePayload()');
    assert.deepEqual(Array.from(bridge.files.qa.rows,row=>row['Agent Name']),['A Rep']);
    assert.deepEqual(Array.from(bridge.organizations,org=>({id:org.id,coaches:Array.from(org.coachNames)})),[{id:'mixed',coaches:['Coach A']}]);
    assert.equal(h.run('state.orgs[0].coachNames.length'),2,'saved organization definitions remain intact');
    assert.equal(h.run('state.data.qa.rows.length'),2,'full normalized cache remains intact');
    assert.equal(h.run("sourceCacheValue('qa').rows.length"),2,'persistence serializes the full source');
    c.CoachToolsStorage.setScope({mode:'coach',label:'Coach B',coaches:['Coach B']});
    assert.equal(h.run("getRowsRaw('qa').length"),0,'stale prior-scope data is hidden while scope resolves');
    await h.run('prepareAllStarGlobalScope()');
    assert.deepEqual(Array.from(h.run("getRowsRaw('qa').map(row=>row._rep)")),['B Rep']);
    assert.deepEqual(Array.from(h.run('state.teams')),['Coach B']);
    c.CoachToolsStorage.setScope({mode:'all',label:'All people'});
    await h.run('prepareAllStarGlobalScope()');
    assert.equal(h.run("getRowsRaw('qa').length"),2);
    assert.equal(h.run('state.teams.length'),2);
  }finally{h.close()}
});
