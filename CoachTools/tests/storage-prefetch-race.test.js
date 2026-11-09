'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const idb = require('fake-indexeddb');
const source = fs.readFileSync(path.join(__dirname, '../shared/coachtools-storage.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function createWindow() {
  const values = new Map();
  const listeners = new Map();
  const context = vm.createContext({
    ...idb, console, setTimeout, clearTimeout, queueMicrotask, structuredClone,
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
      get length() { return values.size; },
      key: index => [...values.keys()][index]
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) || []) handler(event);
    },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; }
  });
  context.window = context;
  context.parent = context;
  vm.runInContext(source, context, { filename: 'coachtools-storage.js' });
  return context;
}

const dataset = score => ({
  meta: { totalRows: 2 },
  workbook: { sheets: ['QA'], data: { QA: { aoa: [['Score'], [score]] } } }
});
const metadata = fingerprint => ({
  originalFileName: 'QA.xlsx', scopedFingerprint: fingerprint,
  scopeHash: 'all', scopeMode: 'all',
  detectedPeriod: { periodKey: '2026-11-09', sortKey: '2026-11-09' }
});

(async () => {
  const writer = createWindow();
  await writer.CoachToolsData.ready();
  const first = await writer.CoachToolsData.importDataset('qa', dataset(90), metadata('one'));
  const reader = createWindow();
  const api = reader.CoachToolsData;
  await api.ready();

  // Hold the old record's delivery after its readonly transaction completes.
  // This reproduces a slow background read overlapping a committed upload.
  const started = deferred();
  const release = deferred();
  const originalGet = idb.IDBObjectStore.prototype.get;
  let hold = true;
  idb.IDBObjectStore.prototype.get = function get(key) {
    const request = originalGet.call(this, key);
    if (!hold || this.name !== 'coachtoolsDatasets' || key !== first.dataset.id) return request;
    hold = false;
    return {
      get result() { return request.result; },
      get error() { return request.error; },
      set onsuccess(handler) {
        request.onsuccess = event => {
          started.resolve();
          release.promise.then(() => handler(event));
        };
      },
      set onerror(handler) { request.onerror = handler; }
    };
  };

  try {
    const warming = api.getCurrent('qa', { includeRecord: true });
    await started.promise;
    const second = await api.importDataset('qa', dataset(95), metadata('two'));
    release.resolve();
    const loaded = await warming;
    assert.equal(loaded.id, second.dataset.id, 'An in-flight prefetch must resolve to the newly committed version.');
    assert.equal(loaded.data.workbook.data.QA.aoa[1][0], 95);
    const cached = await api.getCurrent('qa', { includeRecord: true });
    assert.equal(cached.id, second.dataset.id, 'The old read must not poison the replacement cache.');
    assert.equal(cached.data.workbook.data.QA.aoa[1][0], 95);
  } finally {
    release.resolve();
    idb.IDBObjectStore.prototype.get = originalGet;
  }

  const third = await writer.CoachToolsData.importDataset('qa', dataset(99), metadata('three'));
  const notified = deferred();
  const unsubscribe = api.subscribe(detail => {
    if (!detail.relayed) return;
    assert.equal(api.getDatasetVersion('qa').datasetId, third.dataset.id, 'External metadata must refresh before subscribers run.');
    notified.resolve();
  });
  reader.dispatchEvent({ type: 'message', data: { type: 'coachtools:data-updated', detail: { source: 'qa', reason: 'replacement' } } });
  await notified.promise;
  unsubscribe();
  assert.equal(reader.CoachToolsStorage.getQA(), null, 'The legacy synchronous facade must not expose an obsolete warmed record.');
  const external = await api.getCurrent('qa', { includeRecord: true });
  assert.equal(external.id, third.dataset.id);
  assert.equal(external.data.workbook.data.QA.aoa[1][0], 99, 'A second window upload must invalidate warmed data.');
  console.log('Storage prefetch race tests passed: replacement overlap and external refresh.');
})().catch(error => { console.error(error); process.exitCode = 1; });
