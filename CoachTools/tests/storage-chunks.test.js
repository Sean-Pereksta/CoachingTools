#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const storageScript = fs.readFileSync(path.join(root, 'shared', 'coachtools-storage.js'), 'utf8');
const values = new Map();
const localStorage = {
  get length() { return values.size; },
  key(index) { return Array.from(values.keys())[index] || null; },
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(String(key), String(value)); },
  removeItem(key) { values.delete(String(key)); }
};
const context = {
  console: { log: console.log, warn() {}, error: console.error },
  setTimeout,
  clearTimeout,
  structuredClone,
  localStorage,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
  window: null,
  parent: null
};
context.window = context;
context.parent = context;
vm.createContext(context);
vm.runInContext(storageScript, context, { filename: 'coachtools-storage.js' });

const format = context.CoachToolsData && context.CoachToolsData.storageFormat;
assert(format, 'Chunk storage helpers should be available.');
assert.strictEqual(format.CHUNK_ROWS, 2000);

const retailRows = Array.from({ length: 4505 }, (_, index) => [`Rep ${index}`, index, index % 2 === 0]);
const qaRows = Array.from({ length: 2011 }, (_, index) => [`QA ${index}`, 80 + index % 20]);
const original = {
  meta: { fileName: 'Large workbook.xlsx', totalRows: retailRows.length + qaRows.length },
  workbook: {
    sheets: ['Retail', 'QA'],
    data: {
      Retail: { aoa: retailRows, merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }] },
      QA: { aoa: qaRows }
    }
  }
};

const split = format.splitDataIntoChunks(original, 'weeklyRetail:test');
assert.strictEqual(split.chunks.length, 5, 'Rows should use a manageable number of chunks across sheets.');
assert.strictEqual(split.chunks[0].rows.length, 2000);
assert.strictEqual(split.chunks[2].rows.length, 505);
assert.strictEqual(split.chunks[4].rows.length, 11);
assert.deepStrictEqual(Array.from(split.skeleton.workbook.data.Retail.aoa), []);
assert.deepStrictEqual(Array.from(split.skeleton.workbook.data.QA.aoa), []);
const assembled = format.assembleDataFromChunks(split.skeleton, split.chunks);
assert.deepStrictEqual(JSON.parse(JSON.stringify(assembled)), original, 'Chunks must reassemble in their original sheet and row order.');

assert(storageScript.includes('if (!record || !record.chunked) return record;'), 'Legacy single-record datasets must remain directly readable.');
assert(storageScript.includes('data: storedData.data'), 'Chunked records should store a data skeleton instead of the giant dataset payload.');
assert(storageScript.includes('chunks.length !== Number(record.chunkCount)'), 'Interrupted or incomplete chunk reads should fail safely.');
assert(storageScript.includes("DATASET_CHUNK_STORE = 'coachtoolsDatasetChunks'"), 'Large rows should use their own IndexedDB object store.');

console.log('CoachTools chunk storage tests passed.');
