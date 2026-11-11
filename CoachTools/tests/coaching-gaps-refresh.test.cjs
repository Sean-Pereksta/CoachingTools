'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../apps/coaching-gaps.html'), 'utf8');
const start = html.indexOf('const SHARED_DATA_TYPES =');
const end = html.indexOf('\nfunction aoaToRows(', start);
assert.ok(start >= 0 && end > start, 'the real shared-data helpers must be present');
const helpers = html.slice(start, end);

function setup() {
  const pending = [], applied = [];
  let scopeKey = 'coach:alpha', active = 0, peak = 0, peekReads = 0;
  const context = vm.createContext({
    console,
    DOCKS: {retail: {key: 'myone2.dock.retail', datasetType: 'weeklyRetail'}},
    selectedTeam: null,
    teams: [],
    els: {teamSel: {value: ''}},
    loadCoachings() {}, loadChecklist() {}, loadQA() {}, buildKpiUI() {}, rebuildTeamIndex() {},
    loadStats() { applied.push(context.api.load('myone2.dock.retail')); },
    render() {},
    window: {CoachToolsAppData: {
      getScopeKey: () => scopeKey,
      // Synchronous consumers must use the completed handoff even when a
      // background identity event has invalidated the owner's transient cache.
      peek() { peekReads += 1; return null; },
      getMany(types) {
        assert.deepEqual(Array.from(types), ['weeklyRetail', 'weeklyReferral', 'qa', 'documentedCoaching', 'checklist']);
        active += 1;
        peak = Math.max(peak, active);
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        pending.push({resolve, reject});
        return promise.finally(() => { active -= 1; });
      }
    }}
  });
  vm.runInContext(helpers + `
    globalThis.api = {
      refresh: refreshSharedDockData,
      load: loadDockObjByKey,
      setReady(value) { coachingGapsReady = value; },
      get job() { return sharedReloadJob; },
      get current() { return sharedDockData; }
    };
  `, context, {filename: 'coaching-gaps.html:shared-data-helpers'});
  return {
    api: context.api, pending, applied,
    setScope(value) { scopeKey = value; },
    get peak() { return peak; },
    get peekReads() { return peekReads; }
  };
}

const batch = id => ({weeklyRetail: {id}, qa: {id: 'qa-' + id}});
const abort = () => Object.assign(new Error('Application data loading was cancelled.'), {name: 'AbortError'});
async function nextRead(harness, count) {
  for (let turn = 0; turn < 10 && harness.pending.length < count; turn += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(harness.pending.length, count, 'the queued latest generation should start exactly one new read');
}

test('coalesced source updates serialize reads and publish only the latest complete batch', async () => {
  const harness = setup(), {api} = harness;
  api.setReady(true);
  const job = api.refresh();
  assert.equal(api.refresh(), job);
  assert.equal(api.refresh(), job);
  assert.equal(harness.pending.length, 1, 'updates share the in-flight loader');
  harness.pending[0].resolve(batch('superseded'));
  await nextRead(harness, 2);
  assert.deepEqual(harness.applied, [], 'an obsolete success cannot repaint the tool');
  const latest = batch('latest');
  harness.pending[1].resolve(latest);
  await job;
  assert.equal(api.current, latest);
  assert.deepEqual(harness.applied, [latest.weeklyRetail]);
  assert.equal(harness.peak, 1);
  assert.equal(api.job, null);
});

test('a failed old generation still retries the already queued source update', async () => {
  const harness = setup(), {api} = harness;
  api.setReady(true);
  const job = api.refresh();
  assert.equal(api.refresh(), job);
  harness.pending[0].reject(new Error('Shared team assignments changed while loading. Please retry the application.'));
  await nextRead(harness, 2);
  const latest = batch('replacement');
  harness.pending[1].resolve(latest);
  await job;
  assert.equal(api.current, latest);
  assert.deepEqual(harness.applied, [latest.weeklyRetail]);
  assert.equal(harness.peak, 1);
});

test('an abort caused by a scope switch retries and loads the current selection', async () => {
  const harness = setup(), {api} = harness;
  const job = api.refresh();
  harness.setScope('coach:beta');
  // The adapter can observe the changed scope before the corresponding
  // notification has reached this frame; the scope key still permits retry.
  harness.pending[0].reject(abort());
  await nextRead(harness, 2);
  const beta = batch('beta');
  harness.pending[1].resolve(beta);
  await job;
  assert.equal(api.load('myone2.dock.retail'), beta.weeklyRetail);
  assert.equal(harness.peak, 1);
});

test('an explicit close or cancellation with unchanged scope does not restart loading', async () => {
  const harness = setup(), {api} = harness;
  const job = api.refresh();
  const rejected = assert.rejects(job, {name: 'AbortError'});
  harness.pending[0].reject(abort());
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.pending.length, 1, 'a cancelled frame must not create more source reads');
  assert.equal(api.job, null);
  assert.deepEqual(harness.applied, []);
});

test('completed data stays available after the shared peek cache has been invalidated', async () => {
  const harness = setup(), {api} = harness;
  const job = api.refresh(), completed = batch('completed');
  harness.pending[0].resolve(completed);
  await job;
  assert.equal(api.load('myone2.dock.retail'), completed.weeklyRetail);
  assert.equal(api.load('myone2.dock.retail'), completed.weeklyRetail, 'mode changes and reload controls can reuse the handoff');
  assert.equal(api.load('unknown-dock'), null);
  assert.equal(harness.peekReads, 0, 'parsing does not depend on the independently invalidated owner cache');
});
