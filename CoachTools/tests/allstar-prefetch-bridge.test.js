#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

(async () => {
  {
    let storeReads = 0, localReads = 0;
    const record = { id: 'qa:1', version: 1, data: { rows: [[95]] } };
    const parent = {
      console, setTimeout, clearTimeout,
      requestIdleCallback: callback => setTimeout(callback, 0),
      CoachToolsData: {
        DATASET_TYPES: ['qa'],
        ready: async () => true,
        getDatasetVersion: () => ({ datasetId: 'qa:1', version: 1, fingerprint: 'one' }),
        getCurrent: async () => { storeReads += 1; return record; }
      }
    };
    parent.window = parent;
    parent.parent = parent;
    vm.createContext(parent);
    vm.runInContext(fs.readFileSync(path.join(root, 'shared', 'coachtools-app-data.js'), 'utf8'), parent);
    await parent.CoachToolsAppData.prefetch(['qa']);
    const read = bridge({ parent, structuredClone, CoachToolsData: { getCurrent() { localReads += 1; throw new Error('Unnecessary iframe read'); } } });
    const localRecord = await read('qa');
    assert.deepStrictEqual(localRecord, record);
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

  const sync = imports.slice(end, imports.indexOf('\nasync function ', end + 1));
  assert(sync.includes('await readAllStarCentralRecord(change.datasetType)'), 'Changed shared sources must use the parent-aware helper.');
  assert(sync.includes('await readAllStarCentralRecord(peerType)'), 'Paired monthly data must use the same shared read path.');
  assert(sync.includes('window.CoachToolsData.getDatasetVersion(datasetType)'), 'Shared-source identity planning must keep its existing metadata path.');
  console.log('All-Star parent prefetch bridge tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
