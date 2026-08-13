#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shellScript = fs.readFileSync(path.join(root, 'shared', 'coachtools-shell.js'), 'utf8');
const loaderScript = fs.readFileSync(path.join(root, 'shared', 'coachtools-dock-chunk-loader.js'), 'utf8');

assert.doesNotThrow(() => new Function(shellScript), 'coachtools-shell.js should remain valid JavaScript.');
assert.doesNotThrow(() => new Function(loaderScript), 'coachtools-dock-chunk-loader.js should be valid JavaScript.');
assert(shellScript.includes("coachtools-dock-chunk-loader.js"), 'The shared shell should synchronously load the Timeline/Audit chunk helper.');
assert(loaderScript.includes("new Set(['coach-timeline', 'audit-checklist'])"), 'Chunked dock startup must be scoped to Coach Timeline and Audit / Checklist.');
assert(loaderScript.includes("const CHUNK_STORE = 'coachtoolsDatasetChunks'"), 'The loader should read the existing IndexedDB chunk store directly.');
assert(loaderScript.includes('const ROW_BATCH = 250'), 'Stored rows should be prepared in small browser-friendly batches.');
assert(loaderScript.includes("await yieldToBrowser('low')"), 'Chunk and row processing should yield to the browser between batches.');
assert(loaderScript.includes('Chunk ${index + 1} of ${totalChunks}'), 'The progress UI should report real IndexedDB chunk progress.');
assert(loaderScript.includes('Applying filters, summaries, and timeline views'), 'The progress overlay should remain visible through the first app view build.');
assert(loaderScript.includes('sheets: {}'), 'The loader should materialize lightweight sheet row objects for the existing app parsers.');

console.log('Coach Timeline / Audit chunk-loading checks passed.');
