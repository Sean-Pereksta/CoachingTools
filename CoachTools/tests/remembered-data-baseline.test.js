#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const handlers = new Map();
const context = {
  console,
  document: {
    readyState: 'loading',
    addEventListener(type, fn) { handlers.set(type, fn); },
    getElementById() { return null; }
  },
  location: { protocol: 'file:' },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  setTimeout,
  clearTimeout,
  addEventListener() {}
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'shared', 'coachtools-remembered-data.js'), 'utf8'), context);

const test = context.CoachToolsRememberedData._test;
assert.strictEqual(test.normalizeFamily('Retail_SV2_8-17-2026.xlsx'), 'retail sv2');
assert.strictEqual(test.normalizeFamily('Retail SV2 8-24-2026 FINAL.xlsx'), 'retail sv2');
assert.strictEqual(test.nameMatchScore('Retail_SV2_8-24-2026.xlsx', 'Retail_SV2_8-17-2026.xlsx'), 100);

const baseline = {
  files: [
    { name: 'Retail_SV2_8-17-2026.xlsx' },
    { name: 'Referral_SV2_8-17-2026.xlsx' },
    { name: 'All Items 8-17-2026.xlsx' }
  ]
};
const records = [
  { path: 'old/Retail_SV2_8-17-2026.xlsx', file: { name: 'Retail_SV2_8-17-2026.xlsx', lastModified: 1, size: 100 } },
  { path: 'new/Retail_SV2_8-24-2026.xlsx', file: { name: 'Retail_SV2_8-24-2026.xlsx', lastModified: 5, size: 105 } },
  { path: 'new/Referral_SV2_8-24-2026.xlsx', file: { name: 'Referral_SV2_8-24-2026.xlsx', lastModified: 6, size: 105 } },
  { path: 'new/All Items 8-24-2026.xlsx', file: { name: 'All Items 8-24-2026.xlsx', lastModified: 7, size: 105 } },
  { path: 'junk/Budget.xlsx', file: { name: 'Budget.xlsx', lastModified: 9, size: 999 } }
];
const selected = test.selectBaselineCandidates(records, baseline, {});
assert.strictEqual(
  JSON.stringify(Array.from(selected, item => item.file.name).sort()),
  JSON.stringify(['All Items 8-24-2026.xlsx', 'Referral_SV2_8-24-2026.xlsx', 'Retail_SV2_8-24-2026.xlsx'].sort())
);
assert.strictEqual(selected.some(item => item.file.name === 'Budget.xlsx'), false);

const newest = test.newestEntriesByType([
  { file: { name: 'old.xlsx', lastModified: 1 }, classification: { id: 'qa', detectedPeriod: { sortKey: '2026-07-01' } } },
  { file: { name: 'new.xlsx', lastModified: 2 }, classification: { id: 'qa', detectedPeriod: { sortKey: '2026-08-01' } } }
]);
assert.strictEqual(newest[0].file.name, 'new.xlsx');

console.log('Remembered Data baseline replay tests passed.');
