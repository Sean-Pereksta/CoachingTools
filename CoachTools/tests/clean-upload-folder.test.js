'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BASELINE_KEY = 'coachtools.desktop.cleanUploadBaseline.v1';
const baseline = { scope: { mode: 'all' }, datasetTypes: ['qa'], files: [{ name: 'QA.csv' }] };
const tick = () => new Promise(resolve => setImmediate(resolve));
function events(target = {}) {
  const listeners = new Map();
  target.addEventListener = (type, fn, options) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push({ fn, once: options?.once });
  };
  target.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(item => item.fn !== fn));
  target.dispatchEvent = event => {
    for (const item of [...(listeners.get(event.type) || [])]) {
      if (item.once) target.removeEventListener(event.type, item.fn);
      item.fn(event);
    }
  };
  return target;
}
function folder(name, fileName = 'QA.csv') {
  const file = { name: fileName, size: 5, lastModified: 1 };
  const fileHandle = { kind: 'file', getFile: async () => file };
  return {
    kind: 'directory', name, file, fileHandle,
    queryPermission: async () => 'granted',
    resolve: async handle => handle === fileHandle ? [fileName] : null,
    async *entries() { yield [fileName, fileHandle]; },
    getDirectoryHandle() { throw Error('Do not substitute a storage subfolder for the selected folder'); }
  };
}
function harness(options = {}) {
  const selected = options.selected || folder('Selected exports');
  const disk = options.disk || { handle: null };
  const calls = { folders: 0, filePickers: [], imported: [], analyzed: [], saved: [], input: 0, scans: 0 };
  const local = new Map([[BASELINE_KEY, JSON.stringify(baseline)]]);
  const input = { removeAttribute() {}, click() { calls.input++; }, addEventListener() {} };
  const document = events({ readyState: 'complete',
    getElementById: id => id === 'quickDataInput' ? input : null,
    querySelector: () => ({}),
    createElement: () => ({ dataset: {}, click() { calls.scans++; }, remove() {} }),
    body: { appendChild() {} }
  });
  const context = events({ document, console, setTimeout, clearTimeout,
    location: { protocol: options.protocol || 'file:' },
    localStorage: { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value) },
    indexedDB: { open() {
      const request = {};
      const open = () => {
        request.result = { close() {}, transaction(store, mode) {
          const tx = { objectStore: () => ({
            get() { const read = {}; queueMicrotask(() => { read.result = disk.handle; read.onsuccess(); }); return read; },
            put(handle) { queueMicrotask(() => { disk.handle = handle; tx.oncomplete(); }); },
            delete() { queueMicrotask(() => { disk.handle = null; tx.oncomplete(); }); }
          }) };
          return tx;
        } };
        request.onsuccess();
      };
      if (options.delayLoad && !calls.releaseLoad) calls.releaseLoad = open;
      else queueMicrotask(open);
      return request;
    } },
    showDirectoryPicker: async () => { calls.folders++; if (options.abortFolder) throw { name: 'AbortError' }; return selected; },
    showOpenFilePicker: async pickerOptions => {
      calls.filePickers.push(pickerOptions);
      if (options.abortFiles) throw { name: 'AbortError' };
      return [options.outsideFile || selected.fileHandle];
    },
    CoachToolsImport: {
      analyzeFiles: async files => { calls.analyzed.push(...files); return { recognized: files.map(file => ({ file, classification: { id: 'qa' } })), errors: [], needsReview: [] }; },
      saveRecognizedEntry: async entry => { calls.saved.push(entry.file); return { status: 'saved' }; }
    },
    CoachToolsSmartImport: { async importFiles(files) {
      calls.imported.push(...files);
      if (!options.cancelImport) context.dispatchEvent({ type: 'coachtools:clean-upload-baseline' });
    } }
  });
  context.window = context;
  vm.createContext(context);
  for (const file of ['coachtools-remembered-scope.js', 'coachtools-remembered-data.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../shared', file), 'utf8'), context);
  }
  // Folder behavior is tested against the import service contract; scope replay
  // and authoritative import behavior have separate existing integration tests.
  context.CoachToolsImport = {
    analyzeFiles: async files => { calls.analyzed.push(...files); return { recognized: files.map(file => ({ file, classification: { id: 'qa' } })), errors: [], needsReview: [] }; },
    saveRecognizedEntry: async entry => { calls.saved.push(entry.file); return { status: 'saved' }; }
  };
  return { context, calls, selected, disk, api: context.CoachToolsRememberedData,
    click(action) { document.dispatchEvent({ type: 'click', target: { closest: () => ({ dataset: { action } }) }, preventDefault() {}, stopImmediatePropagation() {} }); }
  };
}

test('Clean Upload click remembers the exact folder; first Update reads it without a second picker', async () => {
  const h = harness();
  h.click('clean-upload-data');
  await tick();
  assert.equal(h.calls.folders, 1);
  assert.equal(h.calls.input, 0);
  assert.equal(h.calls.filePickers[0].startIn, h.selected);
  assert.equal(h.calls.filePickers[0].multiple, true);
  assert.deepEqual(h.calls.imported, [h.selected.file]);
  assert.equal(h.disk.handle, h.selected);
  await h.api.runUpdate();
  assert.equal(h.calls.folders, 1);
  assert.deepEqual(h.calls.saved, [h.selected.file]);
});

test('successful later Clean Upload replaces the folder and survives reload', async () => {
  const old = folder('Old exports');
  const h = harness({ disk: { handle: old } });
  await tick();
  await h.api.cleanUploadFromDirectory();
  const reload = harness({ disk: h.disk });
  await reload.api.runUpdate();
  assert.equal(reload.calls.folders, 0);
  assert.deepEqual(reload.calls.saved, [h.selected.file]);
});

for (const option of ['abortFolder', 'abortFiles', 'cancelImport']) {
  test(`${option} preserves the previous folder`, async () => {
    const old = folder('Old exports');
    const h = harness({ disk: { handle: old }, [option]: true });
    await tick();
    await h.api.cleanUploadFromDirectory();
    assert.equal(h.disk.handle, old);
    await h.api.runUpdate();
    assert.deepEqual(h.calls.saved, [old.file]);
  });
}

test('files outside the chosen directory are rejected before import', async () => {
  const old = folder('Old exports');
  const h = harness({ disk: { handle: old }, outsideFile: folder('Other folder').fileHandle });
  await tick();
  await h.api.cleanUploadFromDirectory();
  assert.equal(h.calls.imported.length, 0);
  assert.equal(h.disk.handle, old);
});

test('late startup folder read cannot overwrite the newly connected folder', async () => {
  const h = harness({ delayLoad: true });
  await h.api.cleanUploadFromDirectory();
  h.disk.handle = folder('Stale startup handle');
  h.calls.releaseLoad();
  await tick();
  await h.api.runUpdate();
  assert.deepEqual(h.calls.saved, [h.selected.file]);
});

test('localhost Update uses the selected folder instead of launcher storage', async () => {
  const h = harness({ protocol: 'http:' });
  await h.api.cleanUploadFromDirectory();
  await h.api.runUpdate();
  assert.equal(h.calls.scans, 0);
  assert.deepEqual(h.calls.saved, [h.selected.file]);
});

test('localhost without a saved folder retains the launcher scanner', async () => {
  const h = harness({ protocol: 'http:' });
  await h.api.runUpdate();
  assert.equal(h.calls.scans, 1);
});

test('unsupported browsers and ordinary Upload retain manual selection', async () => {
  const h = harness();
  h.click('quick-upload-data');
  assert.equal(h.calls.input, 1);
  delete h.context.showOpenFilePicker;
  h.click('clean-upload-data');
  assert.equal(h.calls.input, 2);
  assert.equal(h.calls.folders, 0);
});

test('permission can be reauthorized without selecting the folder again', async () => {
  const selected = folder('Saved exports');
  selected.queryPermission = async () => 'prompt';
  let requests = 0;
  selected.requestPermission = async () => { requests++; return 'granted'; };
  const h = harness({ disk: { handle: selected } });
  await h.api.runUpdate();
  assert.equal(requests, 1);
  assert.equal(h.calls.folders, 0);
  assert.deepEqual(h.calls.saved, [selected.file]);
});
