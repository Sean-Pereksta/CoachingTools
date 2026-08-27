#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const index = read('index.html');
const dependencies = read('shared/coachtools-dependencies.js');
const recovery = read('shared/coachtools-data-recovery.js');
const manager = read('shared/coachtools-data-manager-controls.js');
const storage = read('shared/coachtools-storage.js');

new vm.Script(recovery, { filename: 'shared/coachtools-data-recovery.js' });
new vm.Script(manager, { filename: 'shared/coachtools-data-manager-controls.js' });
new vm.Script(dependencies, { filename: 'shared/coachtools-dependencies.js' });

assert(index.includes('shared/coachtools-data-recovery.js'), 'Desktop must load the data recovery layer.');
assert(
  index.indexOf('shared/coachtools-data-recovery.js') < index.indexOf('shared/coachtools-storage.js'),
  'Data recovery must install before the central storage API so writes can be observed without changing upload flow.'
);
assert(
  index.indexOf('shared/coachtools-data-recovery.js') < index.indexOf('shared/coachtools-import.js'),
  'Data recovery must install before the shared importer.'
);

assert(dependencies.includes("appId !== 'weekly-data'"), 'Data Manager controls must only load inside weekly-data.');
assert(dependencies.includes('coachtools-data-manager-controls.js'), 'Data Manager must load its standalone IndexedDB controls.');

for (const marker of [
  "const RECOVERY_KEY = 'coachtools.data.recovery.v1'",
  'CoachToolsData',
  'CoachToolsImport',
  'reportIssue',
  "action === 'update-data'",
  "action === 'quick-upload-data'",
  "'Clean Upload'",
  "'Update Data'",
  "createElement(doc, 'button', 'Open')",
  'datasetLabel',
  'errorCode',
  'storageDetails'
]) {
  assert(recovery.includes(marker), `Recovery layer is missing ${marker}.`);
}

for (const marker of [
  'IndexedDB data controls',
  'Delete All Data',
  'removeDataset(type)',
  "display(answer).toUpperCase() !== 'YES'",
  'Upload error recovery suggested',
  'Identity Manager data, teams, settings, and All-Star stores will be preserved',
  'coachtoolsDatasets',
  'coachtoolsDatasetChunks',
  'coachtoolsCurrent',
  'coachtoolsImports'
]) {
  assert(manager.includes(marker), `Data Manager recovery controls are missing ${marker}.`);
}

assert(storage.includes('async function removeDataset(type, datasetId)'), 'Central storage must keep per-source history deletion support.');
assert(storage.includes("const DB_NAME = 'allStarImportedDataCache.v1'"), 'Recovery details must stay aligned with the authoritative IndexedDB database.');
assert(storage.includes("const DATASET_STORE = 'coachtoolsDatasets'"), 'Recovery details must stay aligned with the dataset store.');
assert(storage.includes("const DATASET_CHUNK_STORE = 'coachtoolsDatasetChunks'"), 'Recovery details must stay aligned with the chunk store.');
assert(storage.includes("const CURRENT_STORE = 'coachtoolsCurrent'"), 'Recovery details must stay aligned with the current-pointer store.');
assert(storage.includes("const IMPORT_STORE = 'coachtoolsImports'"), 'Recovery details must stay aligned with the import audit store.');

console.log('Data recovery controls contract passed.');
