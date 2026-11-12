'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../shared/coachtools-dock-chunk-loader.js'), 'utf8');

function setup(appId = 'coach-timeline') {
  let scope = 'all', created = 0, opens = 0, reads = 0, onRead = null, onReady = null;
  const versions = new Map(), records = new Map(), chunks = new Map(), handlers = new Map();
  const calls = [], scopedBatch = {checklist: {scoped: true}, documentedCoaching: {scoped: true}};
  const forwarded = [], timers = [];
  const node = () => ({style: {}, dataset: {}, children: [], isConnected: true,
    setAttribute() {}, append(...values) {this.children.push(...values);}, appendChild(value) {this.children.push(value);},
    remove() {this.isConnected = false;}, querySelector() {return this.children.find(value => value.dataset.status);}});
  const base = {
    VERSION: 'test',
    async ready() {if (onReady) {const callback = onReady; onReady = null; callback();}},
    getScopeKey: () => scope, getScope: () => scope === 'all' ? {mode: 'all'} : {mode: 'coaches', coaches: [scope]},
    getVersion: type => versions.get(type) && {...versions.get(type), readScopeKey: scope === 'all' ? '' : scope},
    async getManyProgressive(types, options) {calls.push({method: 'many', types, options}); return scopedBatch;},
    async get(type, options) {calls.push({method: 'get', type, options}); return scopedBatch[type];},
    peek(type) {return scopedBatch[type];},
    subscribe(types, callback) {handlers.set('data', callback); return () => handlers.delete('data');},
    subscribeScope() {}, invalidate() {}
  };
  for (const method of ['prefetch', 'canPrefetch', 'streamRows', 'getHistory', 'filterDataset', 'filterPeople']) {
    base[method] = (...args) => {forwarded.push({method, args}); return method;};
  }
  const context = vm.createContext({console, structuredClone, AbortController,
    document: {title: appId, body: node(), querySelector: selector => ({content: selector.includes('-id') ? appId : 'Test Tool'}),
      getElementById() {return null;}, createElement() {created++; return node();}},
    CoachToolsAppData: base,
    addEventListener(type, callback) {handlers.set(type, callback);}, dispatchEvent() {},
    setTimeout(callback) {timers.push(callback); return timers.length;},
    requestAnimationFrame(callback) {queueMicrotask(callback);}, requestIdleCallback(callback) {queueMicrotask(callback);},
    indexedDB: {open() {
      opens++;
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction(store) {
            return {objectStore() {
              return {get(key) {
                const getRequest = {};
                reads++;
                queueMicrotask(() => {
                  getRequest.result = (store === 'coachtoolsDatasets' ? records : chunks).get(key);
                  if (onRead) onRead(store, key);
                  getRequest.onsuccess();
                });
                return getRequest;
              }};
            }};
          }
        };
        request.onsuccess();
      });
      return request;
    }}
  });
  context.window = context;
  vm.runInContext(source, context, {filename: 'coachtools-dock-chunk-loader.js'});
  return {
    app: context.CoachToolsAppData, base, context, calls, scopedBatch, forwarded, handlers,
    setScope(value) {scope = value;}, onReady(callback) {onReady = callback;}, onRead(callback) {onRead = callback;},
    seed(type, id = type + ':1', values = [['Representative'], ['Selected Person'], ['Other Person']]) {
      versions.set(type, {datasetId: id, version: 1, fingerprint: id});
      records.set(id, {id, chunked: true, chunkCount: 2, dataShape: {meta: {fileName: type + '.xlsx'}}});
      chunks.set(id + ':000000', {sheetName: 'Data', rows: values.slice(0, 2)});
      chunks.set(id + ':000001', {sheetName: 'Data', rows: values.slice(2)});
    },
    get created() {return created;}, get opens() {return opens;}, get reads() {return reads;}
  };
}

test('restricted Timeline and Audit reads hand the complete batch to the shared scoped reader', async () => {
  for (const id of ['coach-timeline', 'audit-checklist']) {
    for (const scope of ['coach:alpha', 'coaches:alpha,beta', 'representative:river']) {
      const h = setup(id); h.seed('checklist'); h.setScope(scope);
      const loaded = await h.app.getMany(['checklist', 'documentedCoaching'], {progressUi: false});
      assert.equal(loaded, h.scopedBatch, 'preserve the returned scoped handoff for synchronous consumers');
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0].method, 'many');
      assert.equal(h.calls[0].options.progressUi, false);
      assert.equal(h.opens, 0, 'selected coaches must never use unfiltered direct IndexedDB reads');
      assert.equal(h.created, 0);
    }
  }
});

test('scope readiness, explicit intersecting scopes, unscoped management, and record reads use the shared reader', async () => {
  const cold = setup(); cold.onReady(() => cold.setScope('coaches:alpha,beta'));
  assert.equal(await cold.app.getMany(['checklist']), cold.scopedBatch);
  assert.equal(cold.opens, 0, 'routing must use the scope after shared readiness settles');
  for (const options of [{scope: {mode: 'coach', label: 'Alpha'}}, {unscoped: true}, {includeRecord: true}]) {
    const h = setup();
    assert.equal(await h.app.getMany(['checklist'], options), h.scopedBatch);
    assert.equal(h.calls[0].options.scope, options.scope);
    assert.equal(h.opens, 0);
  }
});

test('All people retains chunk preparation and quiet cache reuse without mounting progress', async () => {
  const h = setup(); h.seed('checklist');
  const first = await h.app.getMany(['checklist'], {progressUi: false});
  assert.deepEqual(JSON.parse(JSON.stringify(first.checklist.sheets.Data.rows)), [
    {Representative: 'Selected Person'}, {Representative: 'Other Person'}
  ]);
  assert.equal(h.calls.length, 0, 'ordinary All people reads retain direct chunk optimization');
  assert.equal(h.opens, 1);
  const reads = h.reads;
  assert.equal((await h.app.getMany(['checklist'], {progressUi: false})).checklist, first.checklist);
  assert.equal(h.reads, reads, 'unchanged sources reuse their prepared rows');
  assert.equal(h.created, 0, 'background refreshes must not reopen the loading mask');
});

test('a direct all-people cache cannot appear in restricted peek or after source replacement without notifications', async () => {
  const h = setup(); h.seed('checklist');
  const first = await h.app.get('checklist', {progressUi: false});
  assert.equal(h.app.peek('checklist'), first);
  h.setScope('coaches:alpha,beta');
  assert.equal(h.app.peek('checklist'), h.scopedBatch.checklist, 'never publish the old complete source under selected coaches');
  h.setScope('all'); h.seed('checklist', 'checklist:replacement');
  assert.equal(h.app.peek('checklist'), h.scopedBatch.checklist, 'source identity is checked even before a notification arrives');
  assert.notEqual(await h.app.get('checklist', {progressUi: false}), first);
});

test('a scope changed during chunk loading aborts the obsolete batch and cannot poison the next scoped read', async () => {
  const h = setup(); h.seed('checklist');
  h.onRead(store => {if (store === 'coachtoolsDatasetChunks') h.setScope('coaches:alpha,beta');});
  await assert.rejects(h.app.getMany(['checklist'], {progressUi: false}), {name: 'AbortError'});
  assert.equal(h.app.peek('checklist'), h.scopedBatch.checklist);
  assert.equal(await h.app.getMany(['checklist'], {progressUi: false}), h.scopedBatch);
  assert.equal(h.calls.length, 1);
});

test('a replaced source during a chunk read uses the current shared result and never caches old rows under the new pointer', async () => {
  const h = setup(); h.seed('checklist');
  let replaced = false;
  h.onRead(store => {
    if (!replaced && store === 'coachtoolsDatasetChunks') {replaced = true; h.seed('checklist', 'checklist:replacement');}
  });
  assert.equal(await h.app.get('checklist', {progressUi: false}), h.scopedBatch.checklist);
  assert.equal(h.calls[0].method, 'get');
  assert.equal(h.app.peek('checklist'), h.scopedBatch.checklist);
  const next = await h.app.get('checklist', {progressUi: false});
  assert.equal(next.meta.fileName, 'checklist.xlsx');
  assert.equal(h.opens, 2, 'a superseded request must release its pending entry');
});

test('the chunk facade preserves the full shared data API and scope key', () => {
  const h = setup(); h.setScope('coaches:alpha,beta');
  assert.equal(h.app.getScopeKey(), 'coaches:alpha,beta');
  for (const method of ['prefetch', 'canPrefetch', 'streamRows', 'getHistory', 'filterDataset', 'filterPeople']) {
    assert.equal(h.app[method]('checklist', {test: true}), method);
  }
  assert.equal(h.forwarded.length, 6);
});

test('initial loading still shows progress and closing aborts work and removes its mask', async () => {
  const h = setup(); h.seed('checklist');
  h.onRead(store => {if (store === 'coachtoolsDatasetChunks') h.handlers.get('pagehide')();});
  await assert.rejects(h.app.getMany(['checklist']), {name: 'AbortError'});
  assert.ok(h.created > 0, 'opening retains its initial progress display');
  assert.equal(h.context.document.body.children[0].isConnected, false, 'a cancelled opening must not strand its loading mask');
});
