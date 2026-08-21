#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const values = new Map();
const context = {
  console,
  CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options && options.detail; } },
  document: { querySelector() { return null; } },
  location: { pathname: '/index.html' },
  localStorage: {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  },
  addEventListener() {},
  dispatchEvent() {},
  setTimeout
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'shared', 'coachtools-sync.js'), 'utf8'), context, { filename: 'coachtools-sync.js' });

const compare = context.CoachToolsSync.compareCandidate;
const current = { datasetType: 'qa', datasetId: 'qa-current', fingerprint: 'scope-a-v1', scopeHash: 'scope-a', scopedRowCount: 52, periodKey: '2026-08', periodSort: '2026-08-01' };
const history = [current];
const candidate = overrides => ({ datasetType: 'qa', fingerprint: 'scope-a-v1', scopeHash: 'scope-a', scopedRowCount: 52, periodKey: '2026-08', periodSort: '2026-08-01', ...overrides });

assert.strictEqual(compare(candidate({}), current, history).status, 'current', 'Same period and scoped fingerprint should remain current.');
assert.strictEqual(compare(candidate({ fingerprint: 'scope-a-v2' }), current, history).status, 'updated', 'Same-period in-scope changes should update.');
assert.strictEqual(compare(candidate({ periodKey: '2026-09', periodSort: '2026-09-01' }), current, history).status, 'new', 'A newer period should become current even when row contents match.');
assert.strictEqual(compare(candidate({ periodKey: '2026-07', periodSort: '2026-07-01', fingerprint: 'scope-a-old' }), current, history).status, 'older', 'An older period should not replace current data.');
const historical = [current, candidate({ datasetId: 'qa-old', periodKey: '2026-07', periodSort: '2026-07-01', fingerprint: 'scope-a-old' })];
assert.strictEqual(compare(candidate({ periodKey: '2026-07', periodSort: '2026-07-01', fingerprint: 'scope-a-old' }), current, historical).status, 'older', 'An exact historical match must still be labeled older than the active period.');
assert.strictEqual(compare(candidate({ scopeHash: 'scope-b', fingerprint: 'scope-b-v1' }), current, history).status, 'new', 'A new scope should be evaluated independently.');
const otherScopeHistory = [...history, candidate({ datasetId: 'qa-scope-b', scopeHash: 'scope-b', fingerprint: 'scope-b-v1' })];
assert.strictEqual(compare(candidate({ scopeHash: 'scope-b', fingerprint: 'scope-b-v1' }), current, otherScopeHistory).status, 'new', 'Changing scope must reactivate that scope even when its subset already exists in history.');
assert.strictEqual(compare(candidate({ scopedRowCount: 0, fingerprint: 'scope-a-empty' }), current, history).status, 'needs-review', 'Automatic zero-row collapse should retain current scoped data.');
assert.strictEqual(compare(candidate({ scopedRowCount: 0 }), current, history).status, 'needs-review', 'Zero-row safety must run before historical duplicate detection.');

console.log('CoachTools scope-aware synchronization tests passed.');
