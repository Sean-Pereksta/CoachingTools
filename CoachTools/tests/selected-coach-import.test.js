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
  XLSX: require('../vendor/xlsx.full.min.js'), CoachToolsStatsManagerPicker: {}, location: { protocol: 'file:' },
  localStorage: { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, CustomEvent: function(type, init) { this.type = type; this.detail = init?.detail; },
  confirm() { throw Error('Selected-coach scope failures must not prompt for an override'); }
});
context.window = context; context.parent = context;
for (const name of ['stats-directory', 'storage', 'import', 'source-scope', 'remembered-scope']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../shared/coachtools-${name}.js`), 'utf8'), context);
}
const api = context.CoachToolsImport, data = context.CoachToolsData, directory = context.CoachToolsStatsDirectory;
const plain = value => JSON.parse(JSON.stringify(value));
const selected = names => ({ mode: names.length === 1 ? 'coach' : 'team', coaches: names, label: names.join(', ') });
const all = { mode: 'all', label: 'All people' };
const headers = { weeklyRetail: 'Sheet', weeklyReferral: 'Coach', qa: 'Team', documentedCoaching: 'Job Coach', checklist: 'Coach Assigned' };
const filenames = { weeklyRetail: 'Retail Weekly.xlsx', weeklyReferral: 'Referral Weekly.xlsx', qa: 'QA.xlsx', documentedCoaching: 'MyOne2View.xlsx', checklist: 'All Items.xlsx' };
function file(type, rows, name = filenames[type]) {
  const wb = context.XLSX.utils.book_new();
  const sheet = context.XLSX.utils.aoa_to_sheet(rows);
  // A percent-formatted selected row sits well after the discovery preview.
  if (type.startsWith('weekly')) for (let r = 1; r < rows.length; r++) if (sheet[`C${r + 1}`]) sheet[`C${r + 1}`].z = rows[r][0] === 'Other Coach' ? '0.00' : '0.00%';
  context.XLSX.utils.book_append_sheet(wb, sheet, 'Data');
  const bytes = context.XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  let reads = 0;
  return { name, size: bytes.byteLength, lastModified: 1, arrayBuffer: async () => { reads++; return bytes; }, reads: () => reads };
}
function rows(type, owner = 'Chosen Coach', value = 0.55) {
  return [[headers[type], 'Representative', 'Score %'], ...Array.from({ length: 80 }, (_, i) => ['Other Coach', `Excluded ${i}`, 0.91]), [owner, 'Selected Rep', value]];
}
async function clean(files, scope) {
  document.querySelector('[data-action="clean-upload-data"]').click();
  const analysis = await api.analyzeFiles(files);
  assert.equal(analysis.errors.length, 0);
  for (const entry of analysis.recognized) await api.saveRecognizedEntry(entry, { scope });
  return analysis;
}
async function current(type) { return data.getCurrent(type, { includeRecord: true }); }
async function rejectedClean(type, incomingRows, scope) {
  const before = await current(type), baseline = plain(context.CoachToolsCleanUploadBaseline.getBaseline());
  await assert.rejects(() => clean([file(type, incomingRows)], scope), error => ['COACHTOOLS_SCOPE_REVIEW', 'COACHTOOLS_SOURCE_SCOPE_EMPTY'].includes(error.code));
  assert.equal((await current(type)).id, before.id);
  assert.deepEqual(plain(context.CoachToolsCleanUploadBaseline.getBaseline()), baseline);
}
(async () => {
  await data.ready(); await directory.ready;
  for (const type of Object.keys(headers)) {
    const incoming = file(type, rows(type));
    document.querySelector('[data-action="clean-upload-data"]').click();
    const analysis = await api.analyzeFiles([incoming]), entry = analysis.recognized[0];
    assert(entry.rawWorkbook, 'Discovery must retain a workbook for scope materialization');
    // Import must scan ownership, but never expand unselected metric cells.
    Object.defineProperty(entry.rawWorkbook.Sheets.Data.C2, 'v', { get() { throw Error('An unselected metric was expanded'); } });
    await api.saveRecognizedEntry(entry, { scope: selected(['Chosen Coach']) });
    assert.equal(incoming.reads(), 1, 'Clean Upload must reuse the retained workbook without reparsing the entire file');
    const saved = await current(type), result = saved.data.workbook.data.Data.aoa;
    assert.equal(result.length, 2);
    assert.deepEqual(plain(result[1]).slice(0, 2), ['Chosen Coach', 'Selected Rep']);
    assert.equal(result[1][2], type.startsWith('weekly') ? '55%' : 0.55, 'Selected percentages must use the original source row index');
    assert.equal(saved.scopeMode, 'coach');
    assert.equal(saved.scopedRowCount, 1);
    assert.equal(saved.scopeMatchDiagnostics.uploadPeopleSelection.includesAllRows, false);
    assert.deepEqual(plain(context.CoachToolsCleanUploadBaseline.getBaseline().sourceScopes[type].coaches), ['Chosen Coach']);
  }
  console.log('PASS all five chooser sources store only selected coaches, reuse discovery, and preserve source percentages');

  // Saved aliases apply before weekly filtering, without forcing a full parse.
  await directory.save({ version: 1, revision: 1, aliases: [{ role: 'coach', from: 'Coach Alias', to: 'Chosen Coach', enabled: true }], links: [] });
  for (const type of ['weeklyRetail', 'weeklyReferral']) {
    const incoming = file(type, rows(type, 'Coach Alias', 0.6));
    const analysis = await clean([incoming], selected(['Coach Alias']));
    assert.equal(incoming.reads(), 1);
    const result = (await current(type)).data.workbook.data.Data.aoa;
    assert.deepEqual(plain(result), [[headers[type], 'Representative', 'Score %'], ['Chosen Coach', 'Selected Rep', '60%']]);
    assert.equal(analysis.recognized[0].rawWorkbook, null);
  }
  console.log('PASS weekly name replacements filter before materialization and keep percentage precision');

  // Each source gets its own spelling, even when another file contains that name.
  await clean([file('weeklyRetail', rows('weeklyRetail', 'Weekly Coach')), file('checklist', rows('checklist', 'Checklist Coach'))], {
    mode: 'team', label: 'Selected coaches', coaches: ['Weekly Coach', 'Checklist Coach'],
    sourceSelections: { weeklyRetail: ['Weekly Coach'], checklist: ['Checklist Coach'] }
  });
  for (const type of Object.keys(headers)) {
    await rejectedClean(type, [['Unknown'], ['Any value']], selected(['Chosen Coach']));
    await rejectedClean(type, rows(type), selected(['Missing Coach']));
    await rejectedClean(type, rows(type), { mode: 'team', label: 'Selected coaches', coaches: ['Chosen Coach'], sourceSelections: { [type]: [] } });
  }
  console.log('PASS empty source selections, missing ownership, and zero matches preserve every dock and its baseline');

  // Update must replay each dock's saved selection even if the current UI says All.
  document.querySelector('[data-action="update-data"]').click();
  const updates = await api.analyzeFiles([file('weeklyRetail', rows('weeklyRetail', 'Weekly Coach', 0.7)), file('checklist', rows('checklist', 'Checklist Coach', 0.8))]);
  assert.equal(updates.updateScopeNeedsReview, false);
  for (const entry of updates.recognized) await api.saveRecognizedEntry(entry, { scope: all });
  assert.deepEqual(plain((await current('weeklyRetail')).data.workbook.data.Data.aoa[1]), ['Weekly Coach', 'Selected Rep', '70%']);
  assert.deepEqual(plain((await current('checklist')).data.workbook.data.Data.aoa[1]), ['Checklist Coach', 'Selected Rep', 0.8]);
  const beforeUpdateFailure = (await current('weeklyRetail')).id;
  document.querySelector('[data-action="update-data"]').click();
  const failed = await api.analyzeFiles([file('weeklyRetail', rows('weeklyRetail', 'Missing Coach'))]);
  await assert.rejects(() => api.saveRecognizedEntry(failed.recognized[0], { scope: all }), error => error.code === 'COACHTOOLS_SCOPE_REVIEW');
  assert.equal((await current('weeklyRetail')).id, beforeUpdateFailure);
  console.log('PASS Update Data replays per-source scope and rejects failed weekly matching without an override');

  // Without a baseline, a weekly pointer must still restore its actual scope.
  const resolved = await data.resolveUpdateScope(['weeklyRetail']);
  assert.equal(resolved.scope.mode, 'team');
  assert.deepEqual(plain(resolved.scope.sourceSelections.weeklyRetail), ['Weekly Coach']);

  // A baseline saved by the old fallback must not keep loading everyone.
  const baselineKey = 'coachtools.desktop.cleanUploadBaseline.v1';
  await data.importDataset('weeklyRetail', { meta: { fileName: filenames.weeklyRetail }, workbook: { sheets: ['Data'], data: { Data: { aoa: rows('weeklyRetail') } } } }, {
    forceSourceReplacement: true, scopeSnapshot: all, scopeMode: 'all', scopeHash: 'old-all-scope',
    scopeMatchDiagnostics: { peopleFilterFallback: true, uploadPeopleSelection: { mode: 'selected', names: ['Chosen Coach'], includesAllRows: true } }
  });
  const fallbackBaseline = plain(context.CoachToolsCleanUploadBaseline.getBaseline());
  fallbackBaseline.sourceScopes.weeklyRetail = all;
  values.set(baselineKey, JSON.stringify(fallbackBaseline));
  document.querySelector('[data-action="update-data"]').click();
  const recovered = await api.analyzeFiles([file('weeklyRetail', rows('weeklyRetail', 'Chosen Coach', 0.75))]);
  await api.saveRecognizedEntry(recovered.recognized[0], { scope: all });
  assert.equal((await current('weeklyRetail')).data.workbook.data.Data.aoa.length, 2);
  assert.deepEqual(plain(context.CoachToolsCleanUploadBaseline.getBaseline().sourceScopes.weeklyRetail.sourceSelections.weeklyRetail), ['Chosen Coach']);
  console.log('PASS old all-row fallback metadata restores the requested selection and repairs its update baseline');

  await clean([file('weeklyRetail', rows('weeklyRetail'))], all);
  assert.equal((await current('weeklyRetail')).data.workbook.data.Data.aoa.length, 82);
  assert.equal(context.CoachToolsCleanUploadBaseline.getBaseline().sourceScopes.weeklyRetail.mode, 'all');
  console.log('PASS weekly scope restores from metadata; explicit Upload All Data still imports everyone');
})().catch(error => { console.error(error); process.exitCode = 1; });
