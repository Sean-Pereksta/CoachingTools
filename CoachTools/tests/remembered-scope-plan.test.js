#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const handlers = new Map();
const calls = [];
const storageValues = new Map();
const storedScopes = [];
let needsScopeReview = false;
let originalAnalysis = { recognized: [], needsReview: [], errors: [] };
const authoritativeScope = { mode: 'coach', label: 'Coach A', coaches: ['Coach A'], coachKeys: ['coach a'], scopeHash: 'scope-a' };

function on(type, listener) {
  if (!handlers.has(type)) handlers.set(type, []);
  handlers.get(type).push(listener);
}

const qaClassification = { id: 'qa', detectedPeriod: { periodKey: '2026-08', sortKey: '2026-08-01' }, classificationMethod: 'test' };
const currentFile = { name: 'QA current.xlsx', size: 10, lastModified: 1, aoa: [['Team'], ['Coach A']], classification: qaClassification };
const updatedFile = { name: 'QA updated.xlsx', size: 11, lastModified: 2, aoa: [['Team'], ['Coach A'], ['Coach A']], classification: qaClassification };

const importer = {
  SOURCES: { qa: { label: 'QA', header: 'Team' } },
  isBlank(value) { return value == null || value === ''; },
  async analyzeFiles() { return originalAnalysis; },
  async readWorkbook(file) { return { SheetNames: ['Data'], Sheets: { Data: { aoa: file.aoa } } }; },
  classifyFile(file) { return file.classification; },
  async saveRecognizedEntry() { calls.push('original-save'); return { status: 'imported', dataset: { scopeHash: authoritativeScope.scopeHash, scopedRowCount: 1 } }; },
  async resolveScopeSnapshot(scope) { return { ...authoritativeScope, ...(scope || {}), scopeHash: authoritativeScope.scopeHash }; },
  prepareScopedDataset(parsed, type, scope) {
    const tag = /current/i.test(parsed.meta.fileName) ? 'current' : 'updated';
    calls.push(`prepare:${tag}:${scope.scopeHash}`);
    const dataset = { ...parsed, tag, meta: { ...parsed.meta, scopedRowCount: tag === 'updated' ? 2 : 1 } };
    return {
      valid: true,
      dataset,
      scopeSnapshot: { ...authoritativeScope },
      scopeHash: authoritativeScope.scopeHash,
      matchedRows: dataset.meta.scopedRowCount,
      diagnostics: { headerFound: true, ownershipColumn: 'Team' },
      scopedFingerprint: `fingerprint-${parsed.tag}`
    };
  }
};

const context = {
  console,
  CoachToolsImport: importer,
  CoachToolsStorage: {
    getScope() { return { mode: 'all', label: 'All people' }; },
    setScope(scope) { storedScopes.push(['global', scope]); },
    setLastCleanScope(scope) { storedScopes.push(['clean', scope]); }
  },
  CoachToolsData: {
    async resolveUpdateScope() {
      return needsScopeReview
        ? { needsReview: true, scope: null, reason: 'Scoped identity is unavailable.' }
        : { needsReview: false, scope: { ...authoritativeScope }, source: 'active-dataset' };
    },
    async inspectDataset(type, dataset, metadata) {
      calls.push(`inspect:${dataset.tag}:${metadata.scopeHash}`);
      return {
        status: dataset.tag,
        candidate: { periodSort: '2026-08-01', scopedRowCount: metadata.scopedRowCount },
        current: { datasetId: 'qa-current', scopedRowCount: 1 }
      };
    },
    async importDataset(type, dataset, metadata) {
      calls.push(`import:${dataset.tag}:${metadata.scopeHash}`);
      return { status: 'replacement', dataset: { datasetId: 'qa-next', scopedRowCount: metadata.scopedRowCount, scopeHash: metadata.scopeHash } };
    }
  },
  document: {
    readyState: 'complete',
    querySelector() { return null; },
    getElementById() { return null; },
    addEventListener: on
  },
  XLSX: { utils: { sheet_to_json(sheet) { return sheet.aoa; } } },
  location: { protocol: 'file:' },
  localStorage: {
    getItem(key) { return storageValues.has(key) ? storageValues.get(key) : null; },
    setItem(key, value) { storageValues.set(key, String(value)); },
    removeItem(key) { storageValues.delete(key); }
  },
  requestAnimationFrame(callback) { callback(); },
  setTimeout,
  clearTimeout,
  addEventListener: on,
  dispatchEvent() {},
  CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options && options.detail; } }
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'shared', 'coachtools-remembered-scope.js'), 'utf8'), context, { filename: 'coachtools-remembered-scope.js' });

function clickAction(action) {
  const click = (handlers.get('click') || [])[0];
  assert(click, 'The remembered-scope update listener should be installed.');
  click({ preventDefault() {}, target: { closest() { return { dataset: { action } }; } } });
}

(async () => {
  clickAction('update-data');
  const analysis = await context.CoachToolsImport.analyzeFiles([currentFile, updatedFile]);
  assert.strictEqual(analysis.updateMode, true);
  assert.strictEqual(analysis.authoritativeUpdateScope.scopeHash, 'scope-a');
  assert.deepStrictEqual(calls.slice(0, 4), [
    'prepare:current:scope-a',
    'inspect:current:scope-a',
    'prepare:updated:scope-a',
    'inspect:updated:scope-a'
  ], 'Every candidate should be scoped and inspected before any write.');
  assert.strictEqual(calls.some(call => call.startsWith('import:')), false, 'Planning must not commit data.');

  const currentResult = await context.CoachToolsImport.saveRecognizedEntry(analysis.recognized[0], { scope: { mode: 'all', label: 'All people' } });
  assert.strictEqual(currentResult.status, 'duplicate');
  assert.strictEqual(currentResult.comparisonStatus, 'current');
  const updatedResult = await context.CoachToolsImport.saveRecognizedEntry(analysis.recognized[1], { scope: { mode: 'all', label: 'All people' } });
  assert.strictEqual(updatedResult.status, 'replacement');
  assert.strictEqual(updatedResult.comparisonStatus, 'updated');
  assert.deepStrictEqual(calls.filter(call => call.startsWith('import:')), ['import:updated:scope-a'], 'Only the accepted update should commit, using the authoritative scope.');
  assert.strictEqual(calls.includes('original-save'), false);

  needsScopeReview = true;
  const reviewFile = { name: 'QA review.xlsx', size: 12, lastModified: 3, aoa: [['Team'], ['Coach A']], classification: qaClassification };
  clickAction('update-data');
  const reviewAnalysis = await context.CoachToolsImport.analyzeFiles([reviewFile]);
  assert.strictEqual(reviewAnalysis.updateScopeNeedsReview, true);
  await assert.rejects(() => context.CoachToolsImport.saveRecognizedEntry(reviewAnalysis.recognized[0], { scope: { mode: 'all' } }), /Scoped identity is unavailable/);

  needsScopeReview = false;
  const cleanFile = { name: 'QA clean.xlsx', size: 13, lastModified: 4, aoa: [['Team'], ['Coach A']], classification: qaClassification };
  const cleanEntry = {
    file: cleanFile,
    parsed: { meta: { fileName: 'QA clean.xlsx', totalRows: 2 }, workbook: { sheets: ['Data'], data: { Data: { aoa: [['Team'], ['Coach A']] } } } },
    classification: qaClassification
  };
  originalAnalysis = { recognized: [cleanEntry], needsReview: [], errors: [] };
  clickAction('clean-upload-data');
  const cleanAnalysis = await context.CoachToolsImport.analyzeFiles([cleanFile]);
  assert.strictEqual(storageValues.has('coachtools.desktop.cleanUploadBaseline.v1'), false, 'Clean scope must not become authoritative before every recognized source saves.');
  await context.CoachToolsImport.saveRecognizedEntry(cleanAnalysis.recognized[0], { scope: { ...authoritativeScope } });
  const baseline = JSON.parse(storageValues.get('coachtools.desktop.cleanUploadBaseline.v1'));
  assert.strictEqual(baseline.scopeHash, 'scope-a');
  assert.deepStrictEqual(storedScopes.map(([kind, scope]) => [kind, scope.scopeHash]), [['global', 'scope-a'], ['clean', 'scope-a']], 'A successful Clean Update should persist the same authoritative scope globally and as the last-clean scope.');

  console.log('CoachTools direct-file update planning tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
