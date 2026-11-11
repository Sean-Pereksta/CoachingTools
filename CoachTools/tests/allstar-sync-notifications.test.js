'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../apps/allstar/js/app.js'),'utf8');
const scheduler=app.slice(app.indexOf('let coachToolsCentralSyncTimer='),app.indexOf('\nfunction allStarStartupRowCount('));
const startup=app.slice(app.indexOf('async function runAllStarStartupPipeline('),app.indexOf('\nwindow.addEventListener(\'message\'',app.indexOf('async function runAllStarStartupPipeline(')));
function harness(){
  const timers=new Map(),calls=[];let sequence=0;
  const state={lifecycle:{generation:0},startup:{initialized:true,pipelineCount:0},importCacheStartupPromise:null};
  const context=vm.createContext({state,performance,console,Promise,
    setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    syncAllStarFromCoachToolsData:async options=>{calls.push(options);return {changed:false};},
    createAllStarStartupJob:()=>({}),setAllStarStartupPhase(){},updateAllStarStartupProgress(){},
    measureAllStarStartupStep:async(label,task)=>task(),loadImportCacheOnStartup:async()=>false,
    recoverCoachSavedReportRenames:async()=>{},importCacheHasDirty:()=>false,renderAllStarAfterDataBatch(){},
    finishAllStarStartupProgress(){},clearAllStarStartupDiagnosticPhase(){},allSourceKeys:()=>[],yieldToBrowser:async()=>{},
    window:{AllStarWorkspaceNavigation:{refresh(){}}}
  });
  vm.runInContext(scheduler+'\n'+startup,context);
  return {state,context,calls,run:code=>vm.runInContext(code,context),async flush(){
    const batch=[...timers.values()];timers.clear();batch.forEach(fn=>fn());
    await new Promise(resolve=>setImmediate(resolve));
  },timers};
}
(async()=>{
  {
    const h=harness();let finishReconciliation;
    h.context.syncAllStarFromCoachToolsData=options=>{
      h.calls.push(options);
      return options.job?new Promise(resolve=>{finishReconciliation=resolve;}):Promise.resolve({changed:false});
    };
    const loading=h.run('startAllStar()');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(typeof finishReconciliation,'function');
    h.run("scheduleAllStarCentralSync({reason:'Coach A'});scheduleAllStarCentralSync({reason:'Coach B'});");
    assert.equal(h.timers.size,0,'hydration keeps exclusive data ownership');
    finishReconciliation({changed:false});await loading;await h.flush();
    assert.equal(h.calls.length,2,'coach changes received during startup are reconciled once after startup');
    assert.equal(h.calls[1].reason,'Coach B');
    assert.equal(h.state.startup.pipelineCount,1,'scope notifications do not restart hydration');
  }
  {
    const h=harness();let cancelFirstAttempt;
    h.context.syncAllStarFromCoachToolsData=options=>{
      h.calls.push(options);
      return h.calls.length===1?new Promise(resolve=>{cancelFirstAttempt=resolve;}):Promise.resolve({changed:false});
    };
    const loading=h.run('startAllStar()');await new Promise(resolve=>setImmediate(resolve));
    h.run("scheduleAllStarCentralSync({reason:'coach changed during scope preparation'});");
    cancelFirstAttempt({changed:false,cancelled:true});
    assert.equal(await loading,true,'a scope-cancelled reconciliation must finish startup under the new scope');
    assert.equal(h.state.startup.completed,true,'the loading screen can finish after a mid-startup coach switch');
    assert.equal(h.state.startup.pipelineCount,1,'retry only reconciliation, retaining the single hydration job');
    assert.equal(h.calls.length,2);assert.equal(h.timers.size,0,'the retried reconciliation consumes the pending scope update');
  }
  {
    const h=harness();h.state.activeImportJob={};
    h.run("scheduleAllStarCentralSync({source:'qa'});");await h.flush();
    assert.equal(h.calls.length,0,'a central refresh cannot race the manual import');
    assert.equal(h.timers.size,1,'an update received during import stays pending');
    h.state.activeImportJob=null;await h.flush();
    assert.equal(h.calls.length,1);
    h.run("scheduleAllStarCentralSync({reason:'closing'});");h.state.lifecycle.closing=true;await h.flush();
    assert.equal(h.calls.length,1,'closing prevents queued data work');
  }
  {
    const h=harness();let finishFirst;
    h.context.syncAllStarFromCoachToolsData=options=>{
      h.calls.push(options);
      if(h.calls.length===1)return new Promise(resolve=>{finishFirst=resolve;});
      return Promise.resolve(h.state.activeImportJob?{busy:true}:{changed:false});
    };
    const first=h.run("queueAllStarCentralSync('first')");
    const second=h.run("queueAllStarCentralSync('update while first refresh runs')");
    await new Promise(resolve=>setImmediate(resolve));
    h.state.activeImportJob={};finishFirst({changed:false});await first;await second;
    assert.equal(h.timers.size,1,'a queued refresh that encounters an import remains pending');
    h.state.activeImportJob=null;await h.flush();assert.equal(h.calls.length,3);
  }
  {
    const h=harness();h.run("scheduleAllStarCentralSync({source:'unrelated'});");
    assert.equal(h.timers.size,0,'unrelated app notifications do not trigger full synchronization');
  }
  console.log('All-Star startup and import notification tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
