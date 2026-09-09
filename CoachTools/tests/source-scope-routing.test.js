'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(ROOT, 'shared', 'coachtools-source-scope.js'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const routingTag = '<script src="shared/coachtools-source-scope.js" defer></script>';
assert(index.includes(routingTag), 'Desktop index should load the source-specific scope router.');
assert(index.indexOf(routingTag) > index.indexOf('shared/coachtools-import.js'), 'Source scope routing must load after the base importer.');
assert(index.indexOf(routingTag) < index.indexOf('shared/coachtools-smart-import.js'), 'Source scope routing must load before Smart Import builds the chooser scope.');
assert(index.indexOf(routingTag) < index.indexOf('shared/coachtools-remembered-scope.js'), 'Source scope routing must load before Clean Upload / Update Data capture the importer.');

const preparedCalls = [];
let stored = null;
const storage = new Map();
const normalizeName = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toLowerCase();

const baseImporter = {
  VERSION: 'test',
  SOURCES: {
    weeklyRetail: { label: 'Retail Weekly' },
    checklist: { label: 'Checklist' },
    documentedCoaching: { label: 'Documented Coaching' },
    weeklyReferral: { label: 'Referral Weekly' },
    qa: { label: 'QA' }
  },
  normalizeName,
  async resolveScopeSnapshot(scope) {
    return {
      schemaVersion: 1,
      mode: scope && scope.mode || 'coach',
      label: scope && scope.label || 'Angie Johnson',
      personId: 'coach-angie',
      coaches: ['Angie Johnson'],
      coachPersonIds: ['coach-angie'],
      coachKeys: ['angie johnson'],
      representatives: [],
      team: '',
      department: '',
      coordinator: '',
      scopeHash: scope && scope.scopeHash || 'scope-shared'
    };
  },
  validateClassification() { return { valid: true }; },
  detectPeriod() { return { label: 'Current weekly upload', periodKey: 'current', sortKey: '' }; },
  prepareScopedDataset(parsed, type, scope) {
    preparedCalls.push({ type, scope: JSON.parse(JSON.stringify(scope)) });
    return {
      valid: true,
      needsReview: false,
      reason: '',
      dataset: { meta: {}, workbook: parsed.workbook },
      scopeSnapshot: scope,
      scopeHash: `local-${type}`,
      matchedRows: 1,
      sourceRows: 1,
      scopedFingerprint: `fingerprint-${type}`,
      diagnostics: { matchedCoachKeys: scope.coachKeys.slice() }
    };
  },
  async storePreparedEntry(entry, prepared) {
    stored = { entry, prepared };
    return { status: 'updated', dataset: { scopedRowCount: prepared.matchedRows } };
  },
  async parseFile() { throw new Error('parseFile should not be needed in this regression test'); },
  async analyzeFiles() { return { recognized: [], needsReview: [], errors: [] }; }
};

const context = {
  window: {
    CoachToolsImport: Object.freeze(baseImporter),
    CoachToolsData: { importDataset() {} },
    CoachToolsStorage: { getScope: () => null },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    document: { querySelectorAll: () => [] },
    confirm: () => true
  },
  console,
  Date,
  JSON,
  Object,
  Array,
  Set,
  Map,
  String,
  Number,
  Error
};
context.globalThis = context;
vm.runInNewContext(script, context, { filename: 'coachtools-source-scope.js' });

const importer = context.window.CoachToolsImport;
assert.strictEqual(importer.SOURCE_SCOPE_ROUTING_VERSION, '1.0.0');

function entry(type) {
  return {
    file: { name: type === 'weeklyRetail' ? 'Retail Weekly.xlsx' : 'Checklist.xlsx', lastModified: 0 },
    classification: {
      id: type,
      detectedPeriod: type === 'weeklyRetail' ? { label: 'Current weekly upload', periodKey: 'current', sortKey: '' } : null,
      validation: { valid: true }
    },
    parsed: { meta: { totalRows: 2 }, workbook: { sheets: ['Data'], data: { Data: { aoa: [['Header'], ['Row']] } } } },
    rawWorkbook: null
  };
}

const authoritativeScope = {
  mode: 'coach',
  label: 'Angie Johnson',
  scopeHash: 'scope-shared',
  coaches: ['Angie Johnson'],
  sourceSelections: {
    weeklyRetail: ['Angela Johnson'],
    checklist: ['Angie Johnson']
  }
};

(async () => {
  preparedCalls.length = 0;
  const retailPrepared = await importer.prepareRecognizedEntry(entry('weeklyRetail'), { scope: authoritativeScope });
  assert.deepStrictEqual(preparedCalls[0].scope.coaches, ['Angela Johnson'], 'Retail Weekly must filter with the exact Retail Weekly selection.');
  assert.deepStrictEqual(preparedCalls[0].scope.coachKeys, ['angela johnson']);
  assert.strictEqual(retailPrepared.scopeHash, 'scope-shared', 'Retail Weekly should retain the canonical shared scope hash after source filtering.');
  assert.deepStrictEqual(retailPrepared.dataset.meta.sourceScopeSelection, ['Angela Johnson']);
  assert.strictEqual(retailPrepared.dataset.meta.sourceScopeDataset, 'weeklyRetail');

  const checklistPrepared = await importer.prepareRecognizedEntry(entry('checklist'), { scope: authoritativeScope });
  assert.deepStrictEqual(preparedCalls[1].scope.coaches, ['Angie Johnson'], 'Checklist must use its own selected spelling instead of Retail Weekly\'s spelling.');
  assert.deepStrictEqual(checklistPrepared.dataset.meta.sourceScopeSelection, ['Angie Johnson']);
  assert.strictEqual(checklistPrepared.scopeHash, 'scope-shared');

  storage.set('coachtools.desktop.cleanUploadBaseline.v1', JSON.stringify({
    version: 3,
    scopeHash: 'scope-shared',
    scope: authoritativeScope,
    datasetTypes: ['weeklyRetail', 'checklist']
  }));
  const updateScopeWithoutSelections = { mode: 'coach', label: 'Angie Johnson', scopeHash: 'scope-shared', coaches: ['Angie Johnson'] };
  const updatePrepared = await importer.prepareRecognizedEntry(entry('weeklyRetail'), { scope: updateScopeWithoutSelections });
  assert.deepStrictEqual(preparedCalls[2].scope.coaches, ['Angela Johnson'], 'Update Data must replay the source-specific Clean Upload selection from the baseline.');
  assert.deepStrictEqual(updatePrepared.dataset.meta.sourceScopeSelection, ['Angela Johnson']);

  await assert.rejects(
    () => importer.prepareRecognizedEntry(entry('weeklyRetail'), {
      scope: {
        ...authoritativeScope,
        sourceSelections: { weeklyRetail: [], checklist: ['Angie Johnson'] }
      }
    }),
    error => error && error.code === 'COACHTOOLS_SOURCE_SCOPE_EMPTY' && /Retail Weekly/.test(error.message),
    'A blank Retail Weekly selection must not silently substitute a coach selected in another source.'
  );

  stored = null;
  await importer.saveRecognizedEntry(entry('weeklyRetail'), { scope: authoritativeScope });
  assert(stored, 'saveRecognizedEntry should persist the prepared source-routed dataset.');
  assert.deepStrictEqual(stored.prepared.dataset.meta.sourceScopeSelection, ['Angela Johnson']);
  assert.strictEqual(stored.prepared.scopeHash, 'scope-shared');

  console.log('Source-specific coach scope routing regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
