'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const planner = require('../shared/kpi-target-planner.js');

test('team totals are weighted by opportunities and allocations hit the target', () => {
  const result = planner.plan([{rep:'A',apps:1,opps:10},{rep:'B',apps:81,opps:90}], 90);
  assert.equal(result.ok, true);
  assert.equal(result.totalApps, 82);
  assert.equal(result.totalOpps, 100);
  assert.equal(result.currentRate, .82);
  assert.equal(result.needed, 8);
  assert.equal(result.allocated, 8);
  assert.deepEqual(result.rows.map(row => row.extra), [1,7]);
  assert.equal(result.projectedRate, .9);
  assert.equal(result.possible, true);
});

test('capacity caps redistribute the plan instead of suggesting rates over 100%', () => {
  const result = planner.plan([{rep:'Large',apps:99,opps:100},{rep:'Small',apps:0,opps:10}], 100);
  assert.equal(result.needed, 11);
  assert.deepEqual(result.rows.map(row => row.extra), [1,10]);
  assert.ok(result.rows.every(row => row.targetRate <= 1));
  assert.equal(result.projectedRate, 1);
});

test('only selected representatives improve; others remain in the team denominator', () => {
  const result = planner.plan([{rep:'A',apps:8,opps:10},{rep:'B',apps:0,opps:90}], 50, new Set(['A']));
  assert.equal(result.totalOpps, 100);
  assert.equal(result.needed, 42);
  assert.equal(result.capacity, 2);
  assert.equal(result.allocated, 2);
  assert.equal(result.shortfall, 40);
  assert.equal(result.possible, false);
  assert.equal(result.projectedRate, .1);
  assert.equal(result.rows[1].targetApps, 0);
});

test('round up whole outcomes without adding one at floating point boundaries', () => {
  assert.equal(planner.plan([{rep:'A',apps:0,opps:100}], 28.000000000000004).needed, 28);
  assert.equal(planner.plan([{rep:'A',apps:0,opps:3}], 50).needed, 2);
  assert.equal(planner.plan([{rep:'A',apps:47,opps:100}], 47).needed, 0);
  assert.equal(planner.plan([{rep:'A',apps:.3,opps:.6}], 50).needed, 0);
});

test('empty selection and an already met target are explicit', () => {
  const rows = [{rep:'A',apps:4,opps:10}];
  const unmet = planner.plan(rows, 50, []);
  assert.equal(unmet.allocated, 0);
  assert.equal(unmet.shortfall, 1);
  assert.equal(unmet.selectedCount, 0);
  const met = planner.plan(rows, 30, []);
  assert.equal(met.needed, 0);
  assert.equal(met.possible, true);
  assert.equal(met.projectedRate, .4);
});

test('invalid targets and unsupported data return useful errors without throwing', () => {
  const rows = [{rep:'A',apps:4,opps:10}];
  for(const target of ['', null, NaN, Infinity, -1, 101, false]) assert.equal(planner.plan(rows,target).code, 'invalid-target');
  assert.equal(planner.plan([], 50).code, 'no-opportunities');
  assert.equal(planner.plan([{rep:'A',apps:0,opps:0}], 50).code, 'no-opportunities');
  assert.equal(planner.plan([{rep:'A',apps:11,opps:10}], 50).code, 'unsupported-ratio');
  assert.equal(planner.plan([{rep:'A',apps:-1,opps:10}], 50).code, 'invalid-data');
  assert.equal(planner.plan([{rep:'A',apps:NaN,opps:10}], 50).code, 'invalid-data');
  assert.equal(planner.plan([...rows,...rows], 50).code, 'invalid-data');
});

test('allocation is deterministic, whole, bounded, and preserves input data', () => {
  const rows = Object.freeze([{rep:'A',apps:0,opps:3},{rep:'B',apps:0,opps:3},{rep:'C',apps:0,opps:3}].map(Object.freeze));
  const selected = Object.freeze(['A','B','C']);
  const first = planner.plan(rows, 50, selected);
  assert.deepEqual(first.rows.map(row => row.extra), [2,2,1]);
  assert.deepEqual(first, planner.plan(rows, 50, selected));
  assert.equal(rows[0].apps, 0);
  for(let target = 0; target <= 100; target++){
    const result = planner.plan([{rep:'A',apps:96,opps:100},{rep:'B',apps:3,opps:14},{rep:'C',apps:1,opps:7}], target);
    assert.ok(result.rows.every(row => Number.isInteger(row.extra) && row.extra >= 0 && row.extra <= row.capacity));
    assert.equal(result.allocated + result.shortfall, result.needed);
    if(result.possible) assert.ok(result.projectedRate + 1e-12 >= result.targetRate);
  }
});

test('browser entry point exposes the same planner API', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../shared/kpi-target-planner.js'), 'utf8'), browser);
  assert.equal(typeof browser.KpiTargetPlanner.plan, 'function');
  assert.equal(browser.KpiTargetPlanner.plan([{rep:'A',apps:0,opps:10}], 50).needed, 5);
});
