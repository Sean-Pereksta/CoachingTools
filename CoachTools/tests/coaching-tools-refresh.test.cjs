'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../shared/coachtools-scoped-loader.js'), 'utf8');
const types = ['weeklyRetail', 'weeklyReferral', 'qa', 'documentedCoaching', 'checklist'];
const batch = id => Object.fromEntries(types.map(type => [type, {id: id + ':' + type}]));
const abortError = () => Object.assign(new Error('Preparation cancelled'), {name:'AbortError'});
async function settle(){ for(let index=0;index<8;index++) await Promise.resolve(); }

function setup(){
  let scope = 'team:alpha', subscribed = null, unsubscribeCount = 0, nextTimer = 0, sharedPeek = null;
  const pending = [], applied = [], errors = [], timers = new Map(), events = new Map();
  const root = {
    setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{callback,delay});return id;},
    clearTimeout(id){timers.delete(id);},
    addEventListener(type,callback){events.set(type,callback);},
    removeEventListener(type,callback){if(events.get(type)===callback)events.delete(type);},
    CoachToolsAppData:{
      getScopeKey:()=>scope,
      peek:()=>sharedPeek,
      subscribe(requested,callback){
        subscribed={types:Array.from(requested),callback};
        return ()=>{unsubscribeCount++;};
      },
      getMany(requested,options){
        let resolve,reject;
        const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
        pending.push({types:Array.from(requested),options,scope,resolve,reject});
        return promise;
      }
    }
  };
  const context=vm.createContext({window:root});
  vm.runInContext(source,context);
  let loader;
  loader=root.CoachToolsScopedLoader.create({types,
    apply(){applied.push(types.map(type=>loader.peek(type)));},
    onError(error){errors.push(error);}
  });
  return {loader,pending,applied,errors,timers,events,
    get subscribed(){return subscribed;},get unsubscribeCount(){return unsubscribeCount;},
    notify(detail){subscribed.callback(detail);},
    setScope(value){scope=value;},setSharedPeek(value){sharedPeek=value;},
    fire(type){events.get(type)?.();},
    async flush(){const queued=[...timers.values()];timers.clear();for(const timer of queued)timer.callback();await settle();}
  };
}

test('subscribes before initial preparation, shows startup progress once, and retains completed handoffs',async()=>{
  const h=setup();
  assert.deepEqual(h.subscribed.types,types);
  assert.equal(h.pending.length,0,'creation subscribes without starting a second independent boot load');
  const first=batch('first'),job=h.loader.refresh();
  assert.deepEqual(h.pending[0].types,types);
  assert.equal(h.pending[0].options.progressUi,true);
  h.setSharedPeek(first.weeklyRetail);
  h.pending[0].resolve(first);await job;
  assert.equal(h.applied.length,0,'boot controls the first render before activation');
  h.setSharedPeek(null);
  for(const type of types)assert.equal(h.loader.peek(type),first[type],'completed batch survives shared peek invalidation');
  assert.equal(h.loader.peek('unknown'),null);
  h.loader.activate();
  const next=batch('updated'),update=h.loader.refresh();
  assert.equal(h.pending[1].options.progressUi,false);
  h.pending[1].resolve(next);await update;
  assert.equal(h.applied.length,1);
  assert.equal(h.applied[0][0],next.weeklyRetail);
});

test('serializes concurrent refreshes and only publishes the latest requested source generation',async()=>{
  const h=setup();h.loader.activate();
  const job=h.loader.refresh();
  assert.equal(h.loader.refresh(),job);
  assert.equal(h.loader.refresh(),job);
  assert.equal(h.pending.length,1,'concurrent callers share one active read');
  h.pending[0].resolve(batch('superseded'));await settle();
  assert.equal(h.pending.length,2,'a superseded read is followed by one latest-generation read');
  assert.equal(h.applied.length,0);
  assert.equal(h.loader.peek('weeklyRetail'),null);
  const latest=batch('latest');h.pending[1].resolve(latest);await job;
  assert.equal(h.pending.length,2);
  assert.equal(h.applied.length,1);
  assert.equal(h.loader.peek('weeklyRetail'),latest.weeklyRetail);
});

test('a notification burst coalesces into one quiet background refresh',async()=>{
  const h=setup();h.loader.activate();
  for(let index=0;index<100;index++)h.notify({reason:'identity',identityVersion:index});
  assert.equal(h.pending.length,0);
  assert.equal(h.timers.size,1);
  assert.equal([...h.timers.values()][0].delay,120);
  await h.flush();
  assert.equal(h.pending.length,1);
  assert.equal(h.pending[0].options.progressUi,false);
  const latest=batch('settled');h.pending[0].resolve(latest);await settle();await h.flush();
  assert.equal(h.pending.length,1,'a completed background refresh remains settled');
  assert.equal(h.applied.length,1);
  assert.equal(h.loader.peek('qa'),latest.qa);
  assert.deepEqual(h.errors,[]);
});

test('notifications during an active read settle into one replacement without a trailing duplicate',async()=>{
  const h=setup();h.loader.activate();const job=h.loader.refresh();
  for(let index=0;index<100;index++)h.notify({reason:'source',sourceRevision:index});
  h.pending[0].resolve(batch('before-source-change'));await settle();
  const latest=batch('after-source-change');
  // A loader may either wait for debounce or begin its replacement immediately.
  // Completing an early replacement before debounce expires must not cause a
  // third full read when the quiet-period timer runs.
  const earlyReplacement=h.pending[1];
  if(earlyReplacement){earlyReplacement.resolve(latest);await settle();}
  await h.flush();
  assert.equal(h.pending.length,2,'one active read plus one replacement, without a trailing timer reload');
  if(!earlyReplacement)h.pending[1].resolve(latest);
  await job;await settle();
  assert.equal(h.loader.peek('weeklyRetail'),latest.weeklyRetail);
  assert.equal(h.pending[1].options.progressUi,false);
});

test('scope changes clear visible data immediately and replace pending work with the newest scope',async()=>{
  const h=setup(),initial=batch('alpha');
  let job=h.loader.refresh();h.pending[0].resolve(initial);await job;h.loader.activate();
  h.notify({reason:'source'});assert.equal(h.timers.size,1);
  h.setScope('team:beta');h.notify({reason:'scope'});
  assert.equal(h.timers.size,0,'the queued source refresh is cancelled');
  assert.equal(h.pending.length,2,'the new scope starts without the debounce delay');
  assert.equal(h.pending[1].scope,'team:beta');
  assert.equal(h.loader.peek('weeklyRetail'),null);
  assert.ok(h.applied[0].every(value=>value===null),'the report is cleared before the scoped read completes');
  job=h.loader.refresh();
  h.setScope('team:gamma');h.notify({reason:'scope'});
  assert.equal(h.pending.length,2,'scope changes remain serialized');
  h.pending[1].resolve(batch('stale-beta'));await settle();
  assert.equal(h.pending.length,3);
  assert.equal(h.pending[2].scope,'team:gamma');
  assert.equal(h.loader.peek('weeklyRetail'),null);
  const latest=batch('gamma');h.pending[2].resolve(latest);await job;
  assert.equal(h.applied.length,3,'two immediate clears and one final populated render');
  assert.equal(h.applied[2][0],latest.weeklyRetail);
  assert.equal(h.loader.peek('checklist'),latest.checklist);
});

test('the initial subscription catches a scope change while boot preparation is pending',async()=>{
  const h=setup(),job=h.loader.refresh();
  h.setScope('team:beta');h.notify({reason:'scope'});
  h.pending[0].resolve(batch('stale-alpha'));await settle();
  assert.equal(h.pending.length,2);
  assert.equal(h.pending[1].scope,'team:beta');
  const beta=batch('beta');h.pending[1].resolve(beta);await job;
  assert.equal(h.loader.peek('documentedCoaching'),beta.documentedCoaching);
  assert.equal(h.applied.length,0,'activation still controls initial report rendering');
});

test('same-scope aborts are reported once without an automatic retry loop',async()=>{
  const h=setup();h.loader.activate();h.notify({reason:'source'});await h.flush();
  const error=abortError();h.pending[0].reject(error);await settle();await h.flush();
  assert.equal(h.pending.length,1);
  assert.equal(h.applied.length,0);
  assert.deepEqual(h.errors,[error]);
  assert.equal(h.loader.peek('weeklyRetail'),null);
  const retry=h.loader.refresh(),latest=batch('manual-retry');
  h.pending[1].resolve(latest);await retry;
  assert.equal(h.loader.peek('weeklyRetail'),latest.weeklyRetail);
});

test('an abort from a changed scope retries serially and publishes only the new scope',async()=>{
  const h=setup();h.loader.activate();const job=h.loader.refresh();
  h.setScope('team:beta');h.notify({reason:'scope'});
  h.pending[0].reject(abortError());await settle();
  assert.equal(h.pending.length,2);
  assert.equal(h.pending[1].scope,'team:beta');
  const latest=batch('beta');h.pending[1].resolve(latest);await job;
  assert.deepEqual(h.errors,[]);
  assert.equal(h.loader.peek('weeklyReferral'),latest.weeklyReferral);
  assert.equal(h.applied.length,2,'immediate empty render and final scoped render');
});

test('closing cancels timers, unsubscribes, and prevents new reads or late publication',async()=>{
  const h=setup();h.loader.activate();const job=h.loader.refresh();
  h.notify({reason:'source'});assert.equal(h.timers.size,1);
  h.loader.close();
  assert.equal(h.unsubscribeCount,1);
  assert.equal(h.timers.size,0);
  h.pending[0].resolve(batch('late'));await job;
  h.notify({reason:'source'});h.setScope('team:beta');h.notify({reason:'scope'});
  await h.loader.refresh();await h.flush();
  assert.equal(h.pending.length,1);
  assert.equal(h.applied.length,0);
  assert.equal(h.loader.peek('weeklyRetail'),null);
  assert.deepEqual(h.errors,[]);
});

test('pagehide performs the same timer and subscription cleanup',async()=>{
  const h=setup();h.loader.activate();h.notify({reason:'identity'});
  h.fire('pagehide');await h.flush();
  assert.equal(h.unsubscribeCount,1);
  assert.equal(h.timers.size,0);
  assert.equal(h.pending.length,0);
  await h.loader.refresh();assert.equal(h.pending.length,0);
});
