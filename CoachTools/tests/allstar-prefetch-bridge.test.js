#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const { parseHTML } = require('linkedom');

const root = path.join(__dirname, '..');
const imports = fs.readFileSync(path.join(root, 'apps', 'allstar', 'js', 'imports.js'), 'utf8');
const start = imports.indexOf('function readAllStarCentralRecord(');
const end = imports.indexOf('async function syncAllStarFromCoachToolsData(', start);
assert(start >= 0 && end > start, 'All-Star should have a central read helper before synchronization.');
const helper = imports.slice(start, end);

function bridge(window) {
  const context = vm.createContext({ window });
  vm.runInContext(helper, context);
  return context.readAllStarCentralRecord;
}

async function scopedDesktopAndAllStar(seed) {
  const database = new IDBFactory(), values = new Map(), timers = new Set();
  const localStorage = {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  const later = (fn,delay,...args) => {const id=setTimeout(()=>{timers.delete(id);fn(...args);},delay);timers.add(id);return id;};
  function context(document,parent) {
    const c=vm.createContext({document,indexedDB:database,IDBKeyRange,localStorage,console,performance,structuredClone,TextEncoder,TextDecoder,URL,URLSearchParams,Blob,
      XLSX:require('../vendor/xlsx.full.min.js'),AbortController,setTimeout:later,clearTimeout,setInterval,clearInterval,queueMicrotask,requestAnimationFrame:fn=>later(fn,0),
      location:{protocol:'http:',search:'',pathname:document?'/apps/allstar/allstar.html':'/index.html'},navigator:{},
      addEventListener(){},removeEventListener(){},dispatchEvent(){},CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;},alert(){},confirm:()=>true});
    c.window=c;c.parent=parent||c;
    for(const file of ['coachtools-storage.js','coachtools-app-data.js'])vm.runInContext(fs.readFileSync(path.join(root,'shared',file),'utf8'),c,{filename:file});
    return c;
  }
  const desktop=context();
  await desktop.CoachToolsData.ready();
  if(seed)await seed(desktop);
  const html=fs.readFileSync(path.join(root,'apps/allstar/allstar.html'),'utf8'),{document}=parseHTML(html);
  const child=context(document,desktop);
  const scripts=[...html.matchAll(/<script\s+src="(js\/[^"?]+)(?:\?[^\"]*)?"><\/script>/g)].map(match=>match[1]).filter(file=>file!=='js/app.js');
  vm.runInContext(scripts.map(file=>fs.readFileSync(path.join(root,'apps/allstar',file),'utf8')).join('\n'),child);
  vm.runInContext('state.startup.running=false;state.lifecycle.hidden=false;loadModels();',child);
  return {desktop,child,run:code=>vm.runInContext(code,child),close(){for(const id of timers)clearTimeout(id);}};
}

(async () => {
  {
    let storeReads = 0, localReads = 0, currentCached = false;
    const record = { id: 'qa:1', version: 1, data: { rows: [[95]] } };
    const parent = {
      console, setTimeout, clearTimeout,
      requestIdleCallback: callback => setTimeout(callback, 0),
      CoachToolsData: {
        DATASET_TYPES: ['qa'],
        ready: async () => true,
        getDatasetVersion: () => ({ datasetId: 'qa:1', version: 1, fingerprint: 'one' }),
        getCurrent: async () => { if(!currentCached){storeReads += 1;currentCached=true;} return record; }
      }
    };
    parent.window = parent;
    parent.parent = parent;
    vm.createContext(parent);
    vm.runInContext(fs.readFileSync(path.join(root, 'shared', 'coachtools-app-data.js'), 'utf8'), parent);
    await parent.CoachToolsAppData.prefetch(['qa']);
    const read = bridge({ parent, structuredClone, CoachToolsData: { getCurrent() { localReads += 1; throw new Error('Unnecessary iframe read'); } } });
    const localRecord = await read('qa');
    assert.strictEqual(localRecord.id, record.id);
    assert.strictEqual(localRecord.version, record.version);
    assert.deepStrictEqual(localRecord.data, record.data);
    assert.strictEqual(localRecord.readScopeKey, 'unscoped', 'The editable backing copy uses the explicit management read boundary.');
    assert.notStrictEqual(localRecord, record);
    localRecord.data.rows[0][0] = 0;
    assert.strictEqual(record.data.rows[0][0], 95, 'Editing an All-Star worksheet must not mutate the desktop cache.');
    assert.strictEqual((await read('qa')).data.rows[0][0], 95);
    assert.strictEqual(storeReads, 1, 'All-Star should reuse the record prefetched by the desktop across repeated central reads.');
    assert.strictEqual(localReads, 0, 'A shared parent cache must avoid the iframe storage read.');
  }

  {
    const calls = [];
    const window = { CoachToolsData: { getCurrent(type, options) { calls.push({ type, options }); return Promise.resolve({ id: 'local' }); } } };
    window.parent = window;
    assert.strictEqual((await bridge(window)('qa')).id, 'local');
    assert.strictEqual(calls[0].type, 'qa');
    assert.strictEqual(calls[0].options.includeRecord, true, 'Standalone All-Star should keep requesting full local records.');
    window.parent = {};
    assert.strictEqual((await bridge(window)('qa')).id, 'local', 'A same-origin parent without the adapter must retain local loading.');
    Object.defineProperty(window, 'parent', { get() { throw new Error('Blocked cross-origin parent'); } });
    assert.strictEqual((await bridge(window)('qa')).id, 'local', 'Opaque parent access should safely fall back to iframe storage.');
    assert.strictEqual(calls.length, 3);
  }

  {
    let parentReads = 0;
    const read = bridge({ parent: { CoachToolsAppData: { get() { parentReads += 1; } } }, CoachToolsData: { getCurrent: async () => ({ id: 'local' }) } });
    assert.strictEqual((await read('qa')).id, 'local', 'Browsers without safe structured cloning should retain isolated iframe reads.');
    assert.strictEqual(parentReads, 0);
  }

  {
    let localReads = 0;
    const failure = new Error('Shared source is unreadable');
    const window = {
      structuredClone,
      parent: { CoachToolsAppData: { get: async () => { throw failure; } } },
      CoachToolsData: { getCurrent() { localReads += 1; return Promise.resolve(null); } }
    };
    await assert.rejects(() => bridge(window)('qa'), error => error === failure);
    window.parent.CoachToolsAppData.get = () => { throw failure; };
    assert.throws(() => bridge(window)('qa'), error => error === failure);
    assert.strictEqual(localReads, 0, 'Adapter errors must propagate instead of silently switching to potentially obsolete local data.');
  }

  {
    const h=await scopedDesktopAndAllStar(async desktop=>{
      await desktop.CoachToolsData.importDataset('qa',{
        meta:{fileName:'Two coaches QA.csv'},workbook:{sheets:['QA'],data:{QA:{aoa:[
          ['Agent Name','Team','Score %','Interaction Start Time','Assigned Date'],
          ['A Rep','Coach A','90%','2026-10-07','2026-10-08'],
          ['B Rep','Coach B','99%','2026-10-07','2026-10-08']
        ]}}}
      },{originalFileName:'Two coaches QA.csv',detectedPeriod:{periodKey:'2026-10-08',sortKey:'2026-10-08'}});
    });
    try {
      await h.child.CoachToolsData.ready();
      h.desktop.CoachToolsStorage.setScope({mode:'coach',label:'Coach A',coaches:['Coach A']});
      const siblingA=await h.desktop.CoachToolsAppData.get('qa');
      assert.deepStrictEqual(Array.from(siblingA.workbook.data.QA.aoa.slice(1),row=>row[0]),['A Rep'],'Sibling report reads remain scoped.');
      const seeded=await h.run("syncAllStarFromCoachToolsData({render:false,onlyDatasets:['qa']})");
      assert.strictEqual(seeded.changed,true,seeded.error||JSON.stringify(seeded));
      assert.strictEqual(h.run('state.data.qa.rows.length'),2,'First opening under Coach A must seed the full editable management source.');
      assert.strictEqual(h.run("sourceCacheValue('qa').rows.length"),2,'The persisted source population must stay complete.');
      assert.deepStrictEqual(Array.from(h.run("getRowsRaw('qa').map(row=>row._rep)")),['A Rep']);
      h.desktop.CoachToolsStorage.setScope({mode:'coach',label:'Coach B',coaches:['Coach B']});
      const reused=await h.run("syncAllStarFromCoachToolsData({render:false,onlyDatasets:['qa']})");
      assert.strictEqual(reused.centralRefreshed,0,'An unchanged central source may reuse its full backing data.');
      assert.deepStrictEqual(Array.from(h.run("getRowsRaw('qa').map(row=>row._rep)")),['B Rep'],'Switching to Coach B must not leave an A-only saved source and empty report.');
      h.desktop.CoachToolsStorage.setScope({mode:'all',label:'All people'});
      await h.run("syncAllStarFromCoachToolsData({render:false,onlyDatasets:['qa']})");
      assert.deepStrictEqual(Array.from(h.run("getRowsRaw('qa').map(row=>row._rep)")),['A Rep','B Rep']);
      const editable=await h.run("readAllStarCentralRecord('qa')");
      editable.data.workbook.data.QA.aoa[1][2]='0%';
      const siblingAll=await h.desktop.CoachToolsAppData.get('qa',{unscoped:true});
      assert.strictEqual(siblingAll.workbook.data.QA.aoa[1][2],'90%','Allstar worksheet edits cannot change the parent or sibling cache.');
      assert.strictEqual(siblingA.workbook.data.QA.aoa[1][2],'90%','An already scoped sibling result also remains independent.');
    } finally {h.close();}
  }

  const sync = imports.slice(end, imports.indexOf('\nasync function ', end + 1));
  assert(sync.includes('await readAllStarCentralRecord(change.datasetType)'), 'Changed shared sources must use the parent-aware helper.');
  assert(sync.includes('await readAllStarCentralRecord(peerType)'), 'Paired monthly data must use the same shared read path.');
  assert(sync.includes('window.CoachToolsData.getDatasetVersion(datasetType)'), 'Shared-source identity planning must keep its existing metadata path.');
  console.log('All-Star parent prefetch bridge tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
