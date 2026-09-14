'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const idb = require('fake-indexeddb');
const { parseHTML } = require('linkedom');
const { document } = parseHTML('<html><head></head><body><button data-action="clean-upload-data">Clean</button><button data-action="update-data">Update</button><input id="quickDataInput"></body></html>');
const values = new Map();
const context = vm.createContext({ ...idb, document, console, setTimeout, clearTimeout, queueMicrotask, structuredClone,
  XLSX: require('../vendor/xlsx.full.min.js'), location: { protocol: 'file:' },
  localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, CustomEvent: function(type, init) { this.type = type; this.detail = init?.detail; },
  confirm() { throw Error('Clean Upload must not ask for an override confirmation'); }
});
context.window = context; context.parent = context;
for (const file of ['storage', 'import', 'source-scope', 'remembered-scope']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../shared/coachtools-${file}.js`), 'utf8'), context);
}
const api = context.CoachToolsImport;
const data = context.CoachToolsData;
const plain = value => JSON.parse(JSON.stringify(value));
const all = { mode: 'all', label: 'All people' };
function file(name, rows) {
  const wb = context.XLSX.utils.book_new();
  context.XLSX.utils.book_append_sheet(wb, context.XLSX.utils.aoa_to_sheet(rows), 'Data');
  const bytes = context.XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name, size: bytes.byteLength, lastModified: 1, arrayBuffer: async () => bytes };
}
async function clean(files, scope = all) {
  document.querySelector('[data-action="clean-upload-data"]').click();
  const result = await api.analyzeFiles(files);
  assert.equal(result.errors.length, 0);
  for (const entry of result.recognized) await api.saveRecognizedEntry(entry, { scope });
  return result;
}
(async () => {
  await data.ready();
  await clean([
    file('Retail Weekly.xlsx', [['Different columns'], ['Retail new']]),
    file('Referral Weekly.xlsx', [['Different columns'], ['Referral new']]),
    file('MyOne2View 9-14-2026.xlsx', [['Different columns'], ['Coaching new']])
  ]);
  const before = await data.getCurrent('documentedCoaching', { includeRecord: true });
  await clean([file('All Items.xlsx', [['Coach Assigned', 'Action'], ['John Smith', 'A'], ['Other Coach', 'B']])],
    { mode: 'coach', coaches: ['John Smith'], label: 'John Smith' });
  let baseline = context.CoachToolsCleanUploadBaseline.getBaseline();
  assert.deepEqual(plain(baseline.datasetTypes).sort(), ['checklist', 'documentedCoaching', 'weeklyReferral', 'weeklyRetail']);
  assert.equal(baseline.sourceScopes.documentedCoaching.mode, 'all');
  assert.deepEqual(plain(baseline.sourceScopes.checklist.coaches), ['John Smith']);
  assert.equal((await data.getCurrent('documentedCoaching', { includeRecord: true })).id, before.id);
  let status = (await data.getStatus()).find(s => s.id === 'checklist');
  let people = data.renderPeopleSelection(status);
  assert.equal(people.querySelector('summary').textContent, 'People: 1 selected');
  assert.equal(people.querySelector('li').textContent, 'John Smith');
  assert.equal(data.renderPeopleSelection((await data.getStatus()).find(s => s.id === 'weeklyRetail')).textContent, 'People: All');
  await clean([file('MyOne2View 1-1-2020.xlsx', [['Unexpected'], ['Authoritative older file']])]);
  assert.equal((await data.getCurrent('documentedCoaching')).workbook.data.Data.aoa[1][0], 'Authoritative older file');
  assert.equal((await data.getHistory('documentedCoaching')).length, 1);

  // Unknown names and incompatible headers still accept a manual destination.
  document.querySelector('[data-action="clean-upload-data"]').click();
  const analyzing = api.analyzeFiles([file('Mystery.xlsx', [['Anything'], ['New monthly']])]);
  for (let i = 0; i < 100 && !document.querySelector('dialog'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  const dialog = document.querySelector('dialog'); assert(dialog);
  const select = dialog.querySelector('select');
  for (const option of select.options) option.removeAttribute('selected');
  Array.from(select.options).find(o => o.value === 'monthlyRetail').selected = true;
  dialog.querySelector('button').click();
  for (let i = 0; i < 100 && !dialog.textContent.includes('Assigned to'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  Array.from(dialog.querySelectorAll('button')).at(-1).click();
  const manual = await analyzing;
  assert.equal(manual.recognized[0].classification.id, 'monthlyRetail');
  await api.saveRecognizedEntry(manual.recognized[0], { scope: all });
  assert.equal((await data.getCurrent('monthlyRetail')).workbook.data.Data.aoa[1][0], 'New monthly');

  // Failing a people filter cannot veto placement, and coverage is honest.
  await clean([file('QA.xlsx', [['Unknown'], ['Value']])], { mode: 'coach', coaches: ['<John Smith>'], label: '<John Smith>' });
  status = (await data.getStatus()).find(s => s.id === 'qa');
  people = data.renderPeopleSelection(status);
  assert.equal(people.querySelector('li').textContent, '<John Smith>');
  assert.equal(people.querySelector('John'), null);
  assert.match(people.textContent, /All rows included/);

  // Update uses its original processing path with each established dock's scope.
  const updates = [
    file('Retail Weekly.xlsx', [['Sheet', 'Representative'], ['Coach A', 'A']]),
    file('Referral Weekly.xlsx', [['Coach', 'Representative'], ['Coach A', 'B']]),
    file('MyOne2View 9-20-2026.xlsx', [['Job Coach', 'Coaching Date'], ['Coach B', '2026-09-20']]),
    file('All Items.xlsx', [['Coach Assigned', 'Action'], ['John Smith', 'Updated'], ['Other Coach', 'Excluded']])
  ];
  document.querySelector('[data-action="update-data"]').click();
  const update = await api.analyzeFiles(updates);
  assert.equal(update.updateScopeNeedsReview, false);
  assert.equal(update.recognized.length, 4);
  for (const entry of update.recognized) {
    assert.equal(entry._coachtoolsBaselineSkip, false);
    await api.saveRecognizedEntry(entry, { scope: all });
  }
  assert.equal((await data.getCurrent('checklist')).workbook.data.Data.aoa.length, 2);
  assert.equal((await data.getCurrent('checklist')).workbook.data.Data.aoa[1][1], 'Updated');
  assert.equal((await data.getCurrent('documentedCoaching')).workbook.data.Data.aoa[1][0], 'Coach B');
  await clean([file('All Items.xlsx', [['Coach Assigned', 'Action'], ['John Smith', 'A'], ['Other Coach', 'B']])]);
  assert.equal(data.renderPeopleSelection((await data.getStatus()).find(s => s.id === 'checklist')).textContent, 'People: All');
  assert.equal((await data.getCurrent('checklist')).workbook.data.Data.aoa.length, 3);
  // A read failure in one file must not discard another successfully established dock.
  document.querySelector('[data-action="clean-upload-data"]').click();
  const partial = await api.analyzeFiles([
    file('Compliments.xlsx', [['Anything'], ['Accepted']]),
    { name: 'Unreadable.xlsx', arrayBuffer: async () => { throw Error('Read failed'); } }
  ]);
  assert.equal(partial.errors.length, 1);
  await api.saveRecognizedEntry(partial.recognized[0], { scope: all });
  assert(context.CoachToolsCleanUploadBaseline.getBaseline().datasetTypes.includes('compCoaching'));
  await data.removeDataset('checklist');
  baseline = context.CoachToolsCleanUploadBaseline.getBaseline();
  assert(!baseline.datasetTypes.includes('checklist'));
  assert(!baseline.sourceScopes.checklist);
  assert(!baseline.files.some(f => f.datasetType === 'checklist'));
  assert(baseline.datasetTypes.includes('documentedCoaching'));
  console.log('Authoritative Clean Upload: routing, manual assignment, replacement, cumulative docks, per-dock update scopes, people display, and removal passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
