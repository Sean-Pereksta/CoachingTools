'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const idb = require('fake-indexeddb');

async function setup(withIdentity = true) {
  const values = new Map(), handlers = new Map();
  const context = vm.createContext({...idb,indexedDB:new idb.IDBFactory(),console,setTimeout,clearTimeout,queueMicrotask,structuredClone,TextEncoder,TextDecoder,
    localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)},
    addEventListener(type,handler){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(handler);},
    removeEventListener(type,handler){handlers.get(type)?.delete(handler);},
    dispatchEvent(event){for(const handler of handlers.get(event.type)||[])handler(event);},
    CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;}});
  context.window=context;context.parent=context;
  const load = name => vm.runInContext(fs.readFileSync(path.join(__dirname,'../shared',name),'utf8'),context,{filename:name});
  load('coachtools-storage.js');
  const data=context.CoachToolsData,storage=context.CoachToolsStorage;
  await data.ready();
  const save=async(type,rows,period='2026-10-01')=>data.importDataset(type,{meta:{fileName:type+'.csv'},workbook:{sheets:['Data'],data:{Data:{aoa:rows}}}},{originalFileName:type+'.csv',rowCount:rows.length-1,detectedPeriod:{periodKey:period,sortKey:period,label:period},scopeSnapshot:{mode:'all'}});
  await save('weeklyRetail',[['Date','Sheet','Name','Wipers Accepted','Wipers Offered'],['10/1/2026','Coach Alpha','River Example',5,10],['10/1/2026','Coach Beta','Morgan Sample',2,10],['10/1/2026','Coach Alpha','Morgan Sample',1,10]]);
  await save('qa',[['Agent Name','Supervisor','Score','Date'],['River Example','Coach Beta',99,'10/1/2026'],['Morgan Sample','Coach Alpha',80,'10/1/2026']], '2026-10-01');
  await save('qa',[['Agent Name','Supervisor','Score','Date'],['River Example','Coach Beta',97,'10/8/2026'],['Morgan Sample','Coach Alpha',82,'10/8/2026']], '2026-10-08');
  await save('checklist',[['Representative','Supervisor','Incident','Corrective','Date'],['River Example','Coach Beta','Tardy','Verbal','10/2/2026'],['Morgan Sample','Coach Alpha','Absence','Final','10/2/2026']]);
  await save('documentedCoaching',[['Representative','Coach Assigned','Date','Type'],['River Example','Coach Alpha','10/2/2026','1:1'],['Morgan Sample','Coach Beta','10/2/2026','1:1']]);
  let alpha,beta,river,morgan;
  if(withIdentity){
    load('coachtools-identity.js');
    const identity=context.CoachToolsIdentity;
    await identity.ready();
    alpha=await identity.learn('Coach Alpha',{role:'coach',team:'Same Team',source:'scope-test'});
    beta=await identity.learn('Coach Beta',{role:'coach',team:'Same Team',source:'scope-test'});
    river=await identity.learn('River Example',{role:'representative',currentCoachId:alpha.personId,team:'Same Team',source:'scope-test'});
    morgan=await identity.learn('Morgan Sample',{role:'representative',currentCoachId:beta.personId,team:'Same Team',source:'scope-test'});
  }
  load('coachtools-app-data.js');
  const alphaScope={mode:'coach',label:'Coach Alpha',coaches:['Coach Alpha'],personId:alpha?.personId||''};
  const betaScope={mode:'coach',label:'Coach Beta',coaches:['Coach Beta'],personId:beta?.personId||''};
  return {context,data,storage,app:context.CoachToolsAppData,save,alphaScope,betaScope,alpha,beta,river,morgan};
}
function names(dock,column=0){return Array.from(dock.workbook.data.Data.aoa).slice(1).map(row=>row[column]);}

test('consumer reads isolate current coach stats, names-only QA/checklist, history and people without changing stored data',async()=>{
  const {context,data,storage,app,alphaScope}=await setup();
  storage.setScope(alphaScope);
  const all=await app.getMany(['weeklyRetail','qa','checklist','documentedCoaching']);
  assert.deepEqual(names(all.weeklyRetail,2),['River Example']);
  assert.deepEqual(names(all.qa),['River Example']);
  assert.deepEqual(names(all.checklist),['River Example']);
  assert.deepEqual(names(all.documentedCoaching),['River Example']);
  assert.equal((await data.getCurrent('qa')).workbook.data.Data.aoa.length,3,'management source remains whole');
  assert.equal((await app.get('qa',{unscoped:true})).workbook.data.Data.aoa.length,3,'explicit management read remains available');
  assert.deepEqual(Array.from(await app.getHistory('qa')).flatMap(record=>names(record.data)),['River Example','River Example']);
  const people=await app.filterPeople(await context.CoachToolsIdentity.getAllPeople());
  assert.deepEqual(Array.from(people,p=>p.displayName).sort(),['Coach Alpha','River Example']);
});

test('scope switches invalidate cached/peek views and notify dataset subscribers; zero matches stay empty',async()=>{
  const {storage,app,alphaScope,betaScope}=await setup();
  await app.get('qa');
  const notifications=[];
  const stop=app.subscribe(['qa'],detail=>notifications.push(detail));
  storage.setScope(alphaScope);
  assert.equal(app.peek('qa'),null);
  assert.deepEqual(names(await app.get('qa')),['River Example']);
  assert.deepEqual(names(app.peek('qa')),['River Example']);
  storage.setScope(betaScope);
  assert.equal(app.peek('qa'),null);
  assert.deepEqual(names(await app.get('qa')),['Morgan Sample']);
  storage.setScope({mode:'coach',label:'Missing Coach',coaches:['Missing Coach']});
  assert.deepEqual(names(await app.get('qa')),[]);
  assert.deepEqual(names(await app.get('checklist')),[]);
  assert.equal(notifications.filter(event=>event.reason==='scope').length,3);
  stop();
});

test('streaming an explicit all scope cannot widen the global view, including retained dataset IDs',async()=>{
  const {storage,app,alphaScope}=await setup();
  storage.setScope(alphaScope);
  const history=await app.getHistory('qa',{metadataOnly:true});
  for(const record of history){
    const chunks=[];
    for await(const chunk of app.streamRows('qa',{datasetId:record.id||record.datasetId,scope:{mode:'all'},coachNames:['Coach Beta']}))chunks.push(...chunk.rows);
    assert.deepEqual(chunks.slice(1).map(row=>row[0]),['River Example']);
  }
  const narrowed=[];
  for await(const chunk of app.streamRows('qa',{personNames:['Morgan Sample']}))narrowed.push(...chunk.rows);
  assert.equal(narrowed.length,1,'an additional person filter intersects the coach scope');
});

test('ownership-derived roster handles names-only records when identity registry is unavailable',async()=>{
  const {storage,app,betaScope}=await setup(false);
  storage.setScope(betaScope);
  assert.deepEqual(names(await app.get('qa')),['Morgan Sample']);
  assert.deepEqual(names(await app.get('checklist')),['Morgan Sample']);
});

test('a scope changed during an asynchronous read cannot publish its previous dataset',async()=>{
  const {storage,app,alphaScope,betaScope}=await setup();
  storage.setScope(alphaScope);
  const pending=app.get('qa');
  storage.setScope(betaScope);
  // get captures the scope after readiness, so it either returns the new view or aborts.
  const result=await pending.catch(error=>{assert.equal(error.name,'AbortError');return null;});
  if(result)assert.deepEqual(names(result),['Morgan Sample']);
  assert.deepEqual(names(await app.get('qa')),['Morgan Sample']);
});

test('scope identity keys ignore timestamps and representative scope matches names without a coach field',async()=>{
  const {storage,app,data,river}=await setup();
  const scope={mode:'representative',label:'River Example',personId:river.personId,representatives:['River Example']};
  assert.equal(data.getScopeKey({...scope,updatedAt:'one'}),data.getScopeKey({...scope,updatedAt:'two'}));
  storage.setScope(scope);
  assert.deepEqual(names(await app.get('qa')),['River Example']);
});

test('explicit narrower requests intersect the selected coach instead of replacing it',async()=>{
  const {storage,app,alphaScope,betaScope}=await setup();
  storage.setScope(alphaScope);
  assert.deepEqual(names(await app.get('qa',{scope:betaScope})),[]);
  const rows=[];
  for await(const chunk of app.streamRows('qa',{scope:betaScope}))rows.push(...chunk.rows);
  assert.equal(rows.length,1,'only the header survives the empty scope intersection');
});

test('multiple selected coaches load their combined current and historical data while excluding other coaches and preserving sources',async()=>{
  const {context,data,storage,app,save,alpha,beta,alphaScope}=await setup();
  const identity=context.CoachToolsIdentity;
  const gamma=await identity.learn('Coach Gamma',{role:'coach',team:'Same Team',source:'scope-test'});
  await identity.learn('Casey Outside',{role:'representative',currentCoachId:gamma.personId,team:'Same Team',source:'scope-test'});
  await save('weeklyRetail',[['Date','Sheet','Name','Wipers Accepted','Wipers Offered'],
    ['10/15/2026','Coach Alpha','River Example',5,10],
    ['10/15/2026','Coach Beta','Morgan Sample',2,10],
    ['10/15/2026','Coach Gamma','Casey Outside',7,10]],'2026-10-15');
  for(const period of ['2026-10-15','2026-10-22'])await save('qa',[['Agent Name','Supervisor','Score','Date'],
    ['River Example','Coach Beta',99,period],
    ['Morgan Sample','Coach Alpha',80,period],
    ['Casey Outside','Coach Alpha',75,period]],period);
  await save('checklist',[['Representative','Supervisor','Incident','Corrective','Date'],
    ['River Example','Coach Beta','Tardy','Verbal','10/15/2026'],
    ['Morgan Sample','Coach Alpha','Absence','Final','10/15/2026'],
    ['Casey Outside','Coach Alpha','Tardy','Verbal','10/15/2026']],'2026-10-15');
  await save('documentedCoaching',[['Representative','Coach Assigned','Date','Type'],
    ['River Example','Coach Alpha','10/15/2026','1:1'],
    ['Morgan Sample','Coach Beta','10/15/2026','1:1'],
    ['Casey Outside','Coach Gamma','10/15/2026','1:1']],'2026-10-15');

  storage.setScope(alphaScope);
  await app.get('qa');
  const scope={mode:'team',label:'2 selected coaches',coaches:['Coach Alpha','Coach Beta'],
    coachPersonIds:[alpha.personId,beta.personId],personId:'',team:'',department:'',coordinator:''};
  storage.setScope(scope);
  assert.equal(app.peek('qa'),null,'changing to a combined scope invalidates the previous single-coach view');
  assert.equal(data.getScopeKey(scope),data.getScopeKey({...scope,coaches:[...scope.coaches].reverse(),coachPersonIds:[...scope.coachPersonIds].reverse()}));
  const selectedNames=['River Example','Morgan Sample'];
  const views=await app.getMany(['weeklyRetail','qa','checklist','documentedCoaching']);
  for(const type of Object.keys(views)){
    assert.deepEqual(names(views[type],type==='weeklyRetail'?2:0),selectedNames,type+' includes both selected teams only');
    assert.equal((await data.getCurrent(type)).workbook.data.Data.aoa.length,4,type+' source remains complete');
  }
  const history=await app.getHistory('qa');
  assert.equal(history.length,4);
  for(const record of history){
    assert.deepEqual(names(record.data),selectedNames,'each historical period follows the combined scope');
    const streamed=[];
    for await(const chunk of app.streamRows('qa',{datasetId:record.id||record.datasetId}))streamed.push(...chunk.rows);
    assert.deepEqual(streamed.slice(1).map(row=>row[0]),selectedNames,'streaming retained dataset IDs follows the same union');
  }
  assert.equal((await app.get('qa',{unscoped:true})).workbook.data.Data.aoa.length,4);
  const people=await app.filterPeople(await identity.getAllPeople());
  assert.deepEqual(Array.from(people,person=>person.displayName).sort(),['Coach Alpha','Coach Beta','Morgan Sample','River Example']);
});
