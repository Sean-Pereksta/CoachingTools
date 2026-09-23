'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {pages} = require('../shared/performance-scorecard-sharing.js');
test('sections include every row and metric once, repeating representative on each section', () => {
  const result = pages(23, 12, 10, 4, 2), seen = new Set();
  assert.equal(result.length, 9);
  for(const page of result) {
    assert.equal(page.columns[0], 2);
    assert.ok(page.columns.length <= 5);
    assert.ok(page.end - page.start <= 10);
    for(let row = page.start; row < page.end; row++) for(const col of page.columns.slice(1)) {
      const key = `${row}:${col}`; assert.ok(!seen.has(key)); seen.add(key);
    }
  }
  assert.equal(seen.size, 23 * 11);
});
test('empty and representative-only scorecards have bounded pagination', () => {
  assert.deepEqual(pages(0, 5), []);
  assert.deepEqual(pages(1, 1), [{start:0, end:1, columns:[0]}]);
});
