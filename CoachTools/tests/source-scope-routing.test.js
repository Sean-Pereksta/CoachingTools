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

function checkedInput(value) {
  return {
    closest() {
      return {
        querySelector() { return { textContent: value }; }
      };
    }
  };
}

function sourceSection(label, values) {
  return {
    querySelector(selector) {
      if (selector === '.smart-import-source-heading strong') return { textContent: label };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input[type="checkbox"]:checked') return values.map(checkedInput);
      return [];
    }
  };
}

const chooserSections = [
  sourceSection('Retail Weekly', ['Angela Johnson']),
  sourceSection('Checklist', ['Angie Johnson']),
  sourceSection('Documented Coaching', ['Angie Johnson'])
];

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
    const mode = scope && scope.mode || 'coach';
    return {
      schemaVersion: 1,
      mode,
      label: scope && scope.label || 'Angie Johnson',
      personId: mode === 'coach' ? 'coach-angie' : '',
      coaches: ['Angie Johnson'],
      coachPersonIds: ['coach-angie'],
      coachKeys: ['angie johnson'],
      representatives: [],
      team: '',
      department: '',
      coordinator: '',
      scopeHash: mode === 'team' ? 'scope-team-pass' : 'scope-coach-pass'
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
    document: {
      querySelectorAll(selector) {
        return selector === '#smartImportSources .smart-import-source' ? chooserSections : [];
      }
    },
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
assert.strictEqual(importer.SOURCE_SCOPE_ROUTING_VERSION, '1.0.1');

function entry(type) {
  return {
    file: { name: type === 'weeklyRetail' ? 'Retail Weekly.csv' : 'Checklist.xlsx', lastModified: 0 },
    classification: {
      id: type,
      detectedPeriod: type === 'weeklyRetail' ? { label: 'Current weekly upload', periodKey: 'current', sortKey: '' } : null,
      validation: { valid: true }
    },
    parsed: { meta: { totalRows: 2 }, workbook: { sheets: ['Data'], data: { Data: { aoa: [['Header'], ['Row']] } } } },
    rawWorkbook: null
  };
}

(async () => {
  const firstPass = await importer.resolveScopeSnapshot({
    mode: 'team',
    label: 'Selected coaches',
    coaches: ['Angie Johnson', 'Angela Johnson']
  });
  assert.strictEqual(firstPass.scopeHash, 'scope-team-pass');
  assert.deepStrictEqual(firstPass.sourceSelections.weeklyRetail, ['Angela Johnson']);
  assert.deepStrictEqual(firstPass.sourceSelections.checklist, ['Angie Johnson']);

  const canonicalPass = await importer.resolveScopeSnapshot({
    mode: 'coach',
    personId: 'coach-angie',
    label: 'Angie Johnson',
    coaches: ['Angie Johnson']
  });
  assert.strictEqual(canonicalPass.scopeHash, 'scope-coach-pass');
  assert.deepStrictEqual(canonicalPass.sourceSelections.weeklyRetail, ['Angela Johnson'], 'Canonical second-pass resolution must retain the Retail Weekly spelling chosen in the first pass.');
  assert.deepStrictEqual(canonicalPass.sourceSelections.checklist, ['Angie Johnson']);

  preparedCalls.length = 0;
  const retailPrepared = await importer.prepareRecognizedEntry(entry('weeklyRetail'), { scope: canonicalPass });
  assert.deepStrictEqual(preparedCalls[0].scope.coaches, ['Angela Johnson'], 'Retail Weekly must filter with the exact Retail Weekly selection.');
  assert.deepStrictEqual(preparedCalls[0].scope.coachKeys, ['angela johnson']);
  assert.strictEqual(preparedCalls[0].scope.label, 'Angela Johnson', 'Retail Weekly diagnostics should name the source-specific value, not canonical Angie.');
  assert.strictEqual(retailPrepared.scopeHash, 'scope-coach-pass', 'Retail Weekly should retain the canonical shared scope hash after source filtering.');
  assert.deepStrictEqual(retailPrepared.dataset.meta.sourceScopeSelection, ['Angela Johnson']);

  const checklistPrepared = await importer.prepareRecognizedEntry(entry('checklist'), { scope: canonicalPass });
  assert.deepStrictEqual(preparedCalls[1].scope.coaches, ['Angie Johnson'], 'Checklist must use its own selected spelling instead of Retail Weekly\'s spelling.');
  assert.deepStrictEqual(checklistPrepared.dataset.meta.sourceScopeSelection, ['Angie Johnson']);

  storage.set('coachtools.desktop.cleanUploadBaseline.v1', JSON.stringify({
    version: 3,
    scopeHash: 'scope-coach-pass',
    scope: canonicalPass,
    datasetTypes: ['weeklyRetail', 'checklist']
  }));
  const updateScopeWithoutSelections = { mode: 'coach', label: 'Angie Johnson', scopeHash: 'scope-coach-pass', coaches: ['Angie Johnson'] };
  const updatePrepared = await importer.prepareRecognizedEntry(entry('weeklyRetail'), { scope: updateScopeWithoutSelections });
  assert.deepStrictEqual(preparedCalls[2].scope.coaches, ['Angela Johnson'], 'Update Data must replay the source-specific Clean Upload selection from the baseline.');
  assert.deepStrictEqual(updatePrepared.dataset.meta.sourceScopeSelection, ['Angela Johnson']);

  await assert.rejects(
    () => importer.prepareRecognizedEntry(entry('weeklyRetail'), {
      scope: {
        ...canonicalPass,
        sourceSelections: { weeklyRetail: [], checklist: ['Angie Johnson'] }
      }
    }),
    error => error && error.code === 'COACHTOOLS_SOURCE_SCOPE_EMPTY' && /Retail Weekly/.test(error.message),
    'A blank Retail Weekly selection must not silently substitute a coach selected in another source.'
  );

  stored = null;
  await importer.saveRecognizedEntry(entry('weeklyRetail'), { scope: canonicalPass });
  assert(stored, 'saveRecognizedEntry should persist the prepared source-routed dataset.');
  assert.deepStrictEqual(stored.prepared.dataset.meta.sourceScopeSelection, ['Angela Johnson']);
  assert.strictEqual(stored.prepared.scopeHash, 'scope-coach-pass');

  console.log('Source-specific coach scope routing regression checks passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
