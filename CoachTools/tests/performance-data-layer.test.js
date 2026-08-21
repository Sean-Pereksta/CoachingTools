'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const importScript = read('shared/coachtools-import.js');
const storageScript = read('shared/coachtools-storage.js');
const identityScript = read('shared/coachtools-identity.js');
const appDataScript = read('shared/coachtools-app-data.js');
const rememberedScopeScript = read('shared/coachtools-remembered-scope.js');
const smartImportScript = read('shared/coachtools-smart-import.js');
const weeklyDataHtml = read('apps/weekly-data.html');
const XLSX = require(path.join(root, 'vendor', 'xlsx.full.min.js'));

const storage = new Map();
const context = {
  console,
  setTimeout,
  clearTimeout,
  structuredClone,
  localStorage: {
    get length() { return storage.size; },
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
    key(index) { return Array.from(storage.keys())[index] || null; }
  },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
};
context.XLSX = XLSX;
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(importScript, context, { filename: 'coachtools-import.js' });
vm.runInContext(identityScript, context, { filename: 'coachtools-identity.js' });

async function run() {
  const importer = context.CoachToolsImport;
  const identity = context.CoachToolsIdentity;
  await identity.ready();

  const discoveryRows = [['Team', 'Agent Name', 'Score %', 'Metric A', 'Metric B']];
  for (let index = 0; index < 120; index += 1) discoveryRows.push([index % 2 ? 'Coach B' : 'Coach A', `Rep ${index}`, 80 + index % 20, index, index * 2]);
  discoveryRows[101][6] = 'Trailing detail';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(discoveryRows), 'QA Data');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const file = {
    name: 'QA.xlsx', size: bytes.length, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', lastModified: Date.now(),
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
  };
  const discovery = await importer.discoverFile(file);
  assert.strictEqual(discovery.classification.id, 'qa');
  assert(discovery.parsed.workbook.data['QA Data'].aoa.length <= 60, 'Discovery should retain only a small header preview, not every worksheet row.');
  assert.strictEqual(discovery.discovery.ownershipValues.length, 2, 'Discovery should retain only unique ownership values for the selector.');
  assert.strictEqual(discovery.discovery.ownershipValues.reduce((sum, item) => sum + item.count, 0), 120, 'Lightweight discovery should preserve basic ownership counts.');
  const materialized = await importer.materializeDiscoveredEntry(discovery, { mode: 'coach', coaches: ['Coach A'] });
  assert.strictEqual(materialized.workbook.data['QA Data'].aoa.length, 61, 'Post-selection materialization should construct only headers plus matching rows.');
  assert.strictEqual(materialized.workbook.data['QA Data'].aoa.some(row => row[0] === 'Coach B'), false);
  assert.strictEqual(materialized.workbook.data['QA Data'].aoa.some(row => row[6] === 'Trailing detail'), true, 'Materialization should retain used columns that only appear after the discovery preview.');

  const hash = importer.createDatasetHash();
  hash.update(['Coach', 'Score']).update(['Coach A', 91]);
  assert.strictEqual(hash.finish(), importer.fingerprintRows([['Coach', 'Score'], ['Coach A', 91]]), 'Incremental and compatibility fingerprints should be identical.');

  const sourceRows = [['Team', 'Score %'], ['Coach A', 91], ['Coach B', 82]];
  const parsed = { meta: { fileName: 'QA.xlsx', totalRows: sourceRows.length }, workbook: { sheets: ['Data'], data: { Data: { aoa: sourceRows } } } };
  const all = importer.prepareScopedDataset(parsed, 'qa', { mode: 'all', label: 'All people' });
  assert.strictEqual(all.dataset.workbook.data.Data.aoa, sourceRows, 'All-people preparation should reuse source rows rather than deep-cloning a large workbook.');
  const selected = importer.prepareScopedDataset(parsed, 'qa', { mode: 'coach', coaches: ['Coach A'] });
  assert.deepStrictEqual(Array.from(selected.dataset.workbook.data.Data.aoa[1]), ['Coach A', 91]);
  assert.strictEqual(selected.dataset.workbook.data.Data.aoa[1], sourceRows[1], 'Scoped preparation should retain matching rows without cloning unrelated rows.');
  assert.strictEqual(selected.dataset.workbook.data.Data.aoa.some(row => row[0] === 'Coach B'), false, 'Unrelated rows should never enter the compact scoped dataset.');
  const corrected = importer.prepareScopedDataset(parsed, 'qa', { mode: 'coach', coaches: ['Coach Alpha'] }, { nameCorrections: [{ from: 'Coach A', to: 'Coach Alpha' }] });
  assert.strictEqual(corrected.dataset.workbook.data.Data.aoa[1][0], 'Coach Alpha', 'Name corrections should be applied while copying only selected rows.');
  assert.strictEqual(sourceRows[1][0], 'Coach A', 'Scoped corrections must not mutate the parsed source workbook.');

  const coach = await identity.learn('Coach Alpha', { role: 'coach', department: 'Retail', team: 'East', source: 'test' });
  const rep = await identity.learn('Representative One', { role: 'representative', currentCoachId: coach.personId, team: 'East', source: 'test' });
  const version = identity.getIdentityVersion();
  assert.strictEqual((await identity.resolveName('Coach Alpha')).person.personId, coach.personId);
  assert.strictEqual((await identity.getCoach(coach.personId)).personId, coach.personId);
  assert.strictEqual((await identity.getCoachesByDepartment('Retail'))[0].personId, coach.personId);
  assert.strictEqual((await identity.getCoachesByTeam('East'))[0].personId, coach.personId);
  assert.strictEqual((await identity.getRepsForCoach(coach.personId))[0].personId, rep.personId);
  assert.strictEqual((await identity.getPeopleForTeam('East')).length, 2);
  assert.strictEqual(identity.getIdentityVersion(), version, 'Read-only memory lookups must not invalidate the identity generation.');

  for (const index of ['datasetTypePeriodSortImportedAt', 'datasetTypeImportedAt', 'datasetScopePeriod', 'datasetScopePeriodFingerprint']) {
    assert(storageScript.includes(index), `Schema 8 should include the ${index} index.`);
  }
  assert(storageScript.includes('async function* streamRows'), 'The data layer should expose an async row-chunk stream.');
  assert(storageScript.includes('values.length >= limit'), 'IndexedDB cursor reads should stop at the requested limit.');
  assert(storageScript.includes('getPeopleByIds(ids)'), 'Scope-aware streams should expand canonical identities through the memory registry.');
  assert(appDataScript.includes('streamRows(type, options)'), 'Applications should receive the shared streaming API through CoachToolsAppData.');

  const stageFileBody = weeklyDataHtml.match(/async function stageFile[\s\S]*?\n}\nfunction registryScope/)?.[0] || '';
  assert(stageFileBody.includes("status:'staged'"), 'Data Manager files should stop at the staged state before scope selection.');
  assert(!stageFileBody.includes('getScope'), 'Clean Upload staging must not resolve or apply the previous scope.');
  assert(!stageFileBody.includes('importDataset'), 'Clean Upload staging must not write before the user chooses a scope.');
  assert(weeklyDataHtml.includes('showEarlyScopeSelector') && weeklyDataHtml.includes('FILE SELECTION → COACH SELECTOR INTERACTIVE'), 'Data Manager should expose and instrument its early selector.');
  assert(rememberedScopeScript.includes('scope: null'), 'A Clean Upload session should begin without inheriting an authoritative scope.');
  assert(smartImportScript.includes("if (!analysis.updateMode) {"), 'Every non-update import should show an explicit selector, even when no coach values were discovered.');

  console.log('CoachTools performance data-layer tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
