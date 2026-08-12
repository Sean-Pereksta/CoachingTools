#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let listener = null;
let reads = 0;
const versions = {
  qa: { datasetId: 'qa:1', version: 1, fingerprint: 'one' },
  documentedCoaching: { datasetId: 'coaching:1', version: 1, fingerprint: 'one' }
};
const records = {
  qa: { id: 'qa:1', datasetType: 'qa', version: 1, data: { workbook: { sheets: ['QA'], data: { QA: { aoa: [['Score'], [90]] } } } } },
  documentedCoaching: { id: 'coaching:1', datasetType: 'documentedCoaching', version: 1, data: { workbook: { sheets: ['Coaching'], data: { Coaching: { aoa: [['Type'], ['Call Quality']] } } } } }
};

const context = {
  console,
  window: null,
  parent: null,
  CoachToolsData: {
    DATASET_TYPES: ['qa', 'documentedCoaching'],
    ready: async () => true,
    getDatasetVersion: type => versions[type] || null,
    getCurrent: async type => { reads += 1; return records[type] || null; },
    subscribe: callback => { listener = callback; return () => { listener = null; }; },
    subscribeScope: () => () => {}
  },
  CoachToolsStorage: { getScope: () => ({ mode: 'all', label: 'All people' }) }
};
context.window = context;
context.parent = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'shared', 'coachtools-app-data.js'), 'utf8'), context, { filename: 'coachtools-app-data.js' });

(async () => {
  const adapter = context.CoachToolsAppData;
  assert(adapter, 'Shared adapter should attach to window.');
  await adapter.ready();
  assert.strictEqual(reads, 0, 'Metadata readiness must not read a full dataset.');

  const first = await adapter.getMany(['qa', 'documentedCoaching'], { includeRecord: true });
  assert.strictEqual(first.qa.id, 'qa:1');
  assert.strictEqual(reads, 2);
  await adapter.get('qa', { includeRecord: true });
  assert.strictEqual(reads, 2, 'An unchanged dataset version should reuse memory.');
  adapter.invalidate('qa');
  await Promise.all([adapter.get('qa', { includeRecord: true }), adapter.get('qa', { includeRecord: true })]);
  assert.strictEqual(reads, 3, 'Concurrent requests for one version should share one IndexedDB read.');

  let changed = [];
  adapter.subscribe(['qa'], detail => { changed = detail.changedTypes; });
  versions.qa = { datasetId: 'qa:2', version: 2, fingerprint: 'two' };
  records.qa = { ...records.qa, id: 'qa:2', version: 2, data: { workbook: { sheets: ['QA'], data: { QA: { aoa: [['Score'], [95]] } } } } };
  listener({ source: 'qa', reason: 'replacement', version: 2, datasetId: 'qa:2' });
  assert.deepStrictEqual(Array.from(changed), ['qa']);
  const replacement = await adapter.get('qa', { includeRecord: true });
  assert.strictEqual(replacement.id, 'qa:2');
  assert.strictEqual(reads, 4, 'Only the changed dataset should be re-read.');
  assert.strictEqual(adapter.getScope().mode, 'all');
  console.log('CoachTools app data adapter tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
