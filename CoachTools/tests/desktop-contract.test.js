#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = { console, TextEncoder, TextDecoder };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'vendor', 'lz-string.min.js'), 'utf8'), context, { filename: 'lz-string.min.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'shared', 'coachtools-import.js'), 'utf8'), context, { filename: 'coachtools-import.js' });

const imports = context.CoachToolsImport;
assert(imports, 'Shared importer should attach to window.');

function parsed(fileName, rows) {
  return {
    meta: { fileName, fileSize: 100, totalRows: rows.length },
    workbook: { sheets: ['Data'], data: { Data: { aoa: rows } } }
  };
}

assert.strictEqual(imports.classifyFile({ name: 'Retail Weekly.xlsx' }, parsed('Retail Weekly.xlsx', [['Sheet']])).id, 'retail');
assert.strictEqual(imports.classifyFile({ name: 'Documented Coaching.csv' }, parsed('Documented Coaching.csv', [['Job Coach']])).id, 'coaching');
assert.strictEqual(imports.classifyFile({ name: 'mystery.xlsx' }, parsed('mystery.xlsx', [['Team'], ['Coach A']])).id, 'qa');

const ambiguous = imports.classifyFile({ name: 'mystery.xlsx' }, parsed('mystery.xlsx', [['Sheet'], ['Coach A']]));
assert.strictEqual(ambiguous.id, null);
assert.deepStrictEqual(Array.from(ambiguous.candidates).sort(), ['referral', 'retail']);

const scoped = imports.prepareDataset(parsed('Retail Weekly.xlsx', [
  ['Report title'],
  ['Sheet', 'Metric'],
  ['JOHN DOE', 1],
  ['Jane Doe', 2]
]), 'retail', { scope: { mode: 'team', coaches: ['John Doe'] } });
assert.deepStrictEqual(JSON.parse(JSON.stringify(scoped.workbook.data.Data.aoa)), [
  ['Report title'],
  ['Sheet', 'Metric'],
  ['JOHN DOE', 1]
]);

const coaching = imports.prepareDataset(parsed('Documented Coaching.xlsx', [
  ['Job Coach', 'Coaching Date'],
  ['John Doe', '2026-08-11']
]), 'coaching', { scope: { mode: 'all' } });
assert.strictEqual(coaching.workbook.data.Data.aoa[0][1], 'Date');

const packed = imports.packDataset(scoped);
assert.strictEqual(JSON.parse(context.LZString.decompressFromUTF16(packed)).meta.source, 'retail');

console.log('CoachTools desktop/import contract tests passed.');
