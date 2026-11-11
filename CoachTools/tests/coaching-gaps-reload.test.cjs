'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const suite=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(suite,'apps/coaching-gaps.html'),'utf8');
const helperStart=html.indexOf('const SHARED_DATA_TYPES =');
const helperEnd=html.indexOf('\nfunction aoaToRows(',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart);

function setup(){
  const pending=[],applied=[],timers=new Map(),events=new Map();
  let nextTimer=0,scope='coach:alpha';
  const schedule=(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;};
  const cancel=id=>timers.delete(id);
  const context=vm.createContext({console,setTimeout:schedule,clearTimeout:cancel,
    DOCKS:{retail:{key:'retail',datasetType:'weeklyRetail'}},selectedTeam:null,teams:[],els:{teamSel:{value:''},dockHint:{textContent:''}},
    loadCoachings(){},loadChecklist(){},loadQA(){},buildKpiUI(){},rebuildTeamIndex(){},render(){},
    loadStats(){applied.push(context.api.load('retail'));},
    window:{setTimeout:schedule,clearTimeout:cancel,
      addEventListener(type,callback){events.set(type,callback);},
      CoachToolsAppData:{getScopeKey:()=>scope,getMany(types,options){
        let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
        pending.push({types:Array.from(types),options,resolve,reject});return promise;
      }}}
  });
  const onClose=html.match(/window\.addEventListener\('pagehide',cancelSharedDockRefresh,\{once:true\}\);/);
  assert.ok(onClose,'the real frame lifecycle must release scheduled refreshes');
  vm.runInContext(html.slice(helperStart,helperEnd)+onClose[0]+`
    globalThis.api={schedule:scheduleSharedDockRefresh,refresh:refreshSharedDockData,load:loadDockObjByKey,
      ready(value){coachingGapsReady=value;},get job(){return sharedReloadJob;}};
  `,context);
  return{api:context.api,pending,applied,timers,events,setScope(value){scope=value;},
    async flush(){const queued=[...timers.values()];timers.clear();for(const timer of queued)timer.callback();await Promise.resolve();},
    fire(type,detail){events.get(type)?.({type,detail});}};
}

const batch=id=>({weeklyRetail:{id}});
async function settle(){for(let i=0;i<5;i++)await Promise.resolve();}

test('duplicate background notifications coalesce into one quiet completed refresh',async()=>{
  const h=setup();h.api.ready(true);
  for(let i=0;i<100;i++)h.api.schedule({reason:'identity',identityVersion:i});
  assert.equal(h.pending.length,0,'notification bursts must settle before starting data preparation');
  assert.equal(h.timers.size,1,'only the final notification retains a timer');
  await h.flush();
  assert.equal(h.pending.length,1);
  assert.equal(h.pending[0].options.progressUi,false,'an already open report must not reopen its startup overlay');
  const job=h.api.job,latest=batch('settled');h.pending[0].resolve(latest);await job;
  await h.flush();
  assert.equal(h.pending.length,1,'a completed refresh must remain settled without another notification');
  assert.deepEqual(h.applied,[latest.weeklyRetail]);
});

test('initial opening shows progress and later direct refreshes remain quiet',async()=>{
  const h=setup();let job=h.api.refresh();
  assert.equal(h.pending[0].options.progressUi,true);
  h.pending[0].resolve(batch('first'));await job;
  h.api.ready(true);job=h.api.refresh();
  assert.equal(h.pending[1].options.progressUi,false);
  h.pending[1].resolve(batch('updated'));await job;
});

test('a scope change cancels queued background work and loads the final selection immediately',async()=>{
  const h=setup();h.api.ready(true);
  h.api.schedule({reason:'identity'});assert.equal(h.timers.size,1);
  h.setScope('coach:beta');h.api.schedule({reason:'scope'});
  assert.equal(h.timers.size,0,'the old identity timer must not run after the explicit scope load');
  assert.equal(h.pending.length,1,'scope selection starts immediately');
  const job=h.api.job,beta=batch('beta');h.pending[0].resolve(beta);await job;
  await h.flush();
  assert.equal(h.pending.length,1);assert.equal(h.api.load('retail'),beta.weeklyRetail);
});

test('closing the frame cancels its delayed refresh and ignores later notifications',async()=>{
  const h=setup();h.api.ready(true);h.api.schedule({reason:'identity'});
  h.fire('pagehide');await h.flush();
  assert.equal(h.pending.length,0,'closing must not leave an identity refresh queued');
  h.api.schedule({reason:'identity'});h.api.schedule({reason:'scope'});await h.flush();
  assert.equal(h.pending.length,0,'a closed frame must not start new loads');
});

const shell=fs.readFileSync(path.join(suite,'shared/coachtools-shell.js'),'utf8');
const installStart=shell.indexOf('  async function installIntelligenceSurface()');
const installEnd=shell.indexOf('\n  function scheduleIntelligenceSurface()',installStart);
assert.ok(installStart>=0&&installEnd>installStart);
async function installSurface(parentMode){
  const loaded=[],mounts=[],identity={ready:async()=>true};
  const root={console,CoachToolsIntelligence:{VERSION:'1.1.0'},CoachToolsInsightUI:{mount:app=>mounts.push(app)}};
  if(parentMode==='hosted')root.parent={CoachToolsIdentity:identity};
  else if(parentMode==='opaque')Object.defineProperty(root,'parent',{get(){throw new Error('cross-origin frame');}});
  else root.parent=root;
  const context=vm.createContext({root,app:{id:'coaching-gaps'},intelligenceApps:new Set(['coaching-gaps']),
    async loadSharedScript(name,ready){loaded.push(name);if(name==='coachtools-identity.js')root.CoachToolsIdentity=identity;return !ready||ready();}});
  vm.runInContext(shell.slice(installStart,installEnd)+'\nglobalThis.install=installIntelligenceSurface;',context);
  await context.install();return{root,loaded,mounts,identity};
}

test('hosted Coaching Gaps reuses the desktop identity owner without starting another registry',async()=>{
  const h=await installSurface('hosted');
  assert.equal(h.root.CoachToolsIdentity,h.identity);
  assert.equal(h.loaded.includes('coachtools-identity.js'),false,'one shared registry owns background enrichment');
  assert.deepEqual(h.mounts,['coaching-gaps']);
});

test('standalone and opaque frames retain their own usable identity fallback',async()=>{
  for(const mode of ['standalone','opaque']){
    const h=await installSurface(mode);
    assert.deepEqual(h.loaded,['coachtools-identity.js']);
    assert.equal(h.root.CoachToolsIdentity,h.identity);
    assert.deepEqual(h.mounts,['coaching-gaps']);
  }
});

test('background intelligence reads in standalone Gaps do not rebuild its report parsers',async()=>{
  let scans=0,parsed=0;
  const record={id:'weekly:1',version:1,data:{workbook:{sheets:['Weekly'],data:{Weekly:{aoa:[['Name'],['Selected Agent']]}}}}};
  const context=vm.createContext({console,setTimeout,clearTimeout,
    document:{querySelector:()=>({content:'coaching-gaps'}),getElementById:()=>({value:'retail'})},
    CoachToolsStorage:{getScope:()=>({mode:'all'})},
    CoachToolsData:{DATASET_TYPES:['weeklyRetail'],ready:async()=>true,
      getDatasetVersion:()=>({datasetId:'weekly:1',version:1}),getCurrent:async()=>record},
    extractRowArrays(){scans++;return[{sheetName:'Weekly',rows:[{Name:'Selected Agent'}]}];},
    canonicalizeStatRows(dock){parsed++;return dock.sheets.Weekly.rows;}
  });
  context.window=context;context.parent=context;
  vm.runInContext(fs.readFileSync(path.join(suite,'shared/coachtools-app-data.js'),'utf8'),context);
  const app=context.CoachToolsAppData;
  assert.equal((await app.getMany(['weeklyRetail'],{appId:'coaching-intelligence',progressUi:false})).weeklyRetail,record.data);
  assert.equal(scans,0,'background insights must use their own parsers without preparing the visible report');
  assert.equal(parsed,0);
  await app.getMany(['weeklyRetail'],{appId:'coaching-gaps',progressUi:false});
  assert.equal(scans,1,'the foreground Gaps batch still prepares its real canonical parsers');
  assert.equal(parsed,1);
});
