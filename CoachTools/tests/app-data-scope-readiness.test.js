'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const idb = require('fake-indexeddb');

async function setup() {
  const values = new Map(), handlers = new Map();
  const context = vm.createContext({
    ...idb, indexedDB: new idb.IDBFactory(), console, setTimeout, clearTimeout,
    queueMicrotask, structuredClone, TextEncoder, TextDecoder,
    // Keep unrelated background enrichment pending; each test controls the
    // identity change that the foreground application must reconcile.
    requestIdleCallback() { return 1; },
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key)
    },
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
    dispatchEvent(event) { for (const handler of handlers.get(event.type) || []) handler(event); },
    CustomEvent: function(type, init) { this.type = type; this.detail = init?.detail; }
  });
  context.window = context;
  context.parent = context;
  const load = name => vm.runInContext(fs.readFileSync(path.join(__dirname, '../shared', name), 'utf8'), context, {filename: name});
  load('coachtools-storage.js');
  await context.CoachToolsData.ready();
  const save = async (type, rows) => context.CoachToolsData.importDataset(type, {
    meta: {fileName: type + '.csv'},
    workbook: {sheets: ['Data'], data: {Data: {aoa: rows}}}
  }, {originalFileName: type + '.csv', rowCount: rows.length - 1, scopeSnapshot: {mode: 'all'}});
  await save('weeklyRetail', [
    ['Date', 'Sheet', 'Name', 'Wipers Accepted', 'Wipers Offered'],
    ['10/1/2026', 'Coach Alpha', 'River Example', 5, 10],
    ['10/1/2026', 'Coach Beta', 'Morgan Sample', 2, 10],
    ['10/1/2026', 'Coach Gamma', 'Jordan Example', 3, 10],
    ['10/1/2026', 'Coach Other', 'Casey Sample', 1, 10]
  ]);
  await save('qa', [
    ['Agent Name', 'Score', 'Date'],
    ['River Example', 99, '10/1/2026'],
    ['Morgan Sample', 90, '10/1/2026'],
    ['Jordan Example', 95, '10/1/2026'],
    ['Casey Sample', 80, '10/1/2026']
  ]);
  const scope = {mode: 'team', label: '3 selected coaches', coaches: ['Coach Alpha', 'Coach Beta', 'Coach Gamma']};
  context.CoachToolsStorage.setScope(scope);
  return {context, load, save, scope, data: context.CoachToolsData};
}

function names(dataset, column = 0) {
  assert.ok(dataset, 'a completed application read must remain available to synchronous consumers');
  return Array.from(dataset.workbook.data.Data.aoa).slice(1).map(row => row[column]);
}

test('a cold identity registry keeps selected-coach data available to Coaching Gaps peek consumers', async () => {
  const {context, load, data} = await setup();
  load('coachtools-identity.js');
  assert.equal(context.CoachToolsIdentity.getIdentityVersion(), 0, 'start before the registry has hydrated');
  load('coachtools-app-data.js');
  const app = context.CoachToolsAppData;
  const result = await app.getMany(['weeklyRetail', 'qa']);
  assert.deepEqual(names(result.weeklyRetail, 2), ['River Example', 'Morgan Sample', 'Jordan Example']);
  assert.deepEqual(names(app.peek('weeklyRetail'), 2), ['River Example', 'Morgan Sample', 'Jordan Example']);
  assert.deepEqual(names(app.peek('qa')), ['River Example', 'Morgan Sample', 'Jordan Example']);
  assert.equal((await data.getCurrent('weeklyRetail')).workbook.data.Data.aoa.length, 5, 'scope never removes backing data');
});

test('identity enrichment between progressive datasets leaves the complete requested batch current', async () => {
  const {context, load} = await setup();
  let version = 1, changed = false;
  context.CoachToolsIdentity = {
    ready: async () => true,
    getIdentityVersion: () => version,
    getRepresentatives: async () => []
  };
  load('coachtools-app-data.js');
  const app = context.CoachToolsAppData;
  await app.getMany(['weeklyRetail', 'qa'], {onProgress(detail) {
    if (!changed && detail.type === 'weeklyRetail' && ['ready', 'cached'].includes(detail.status)) {
      changed = true;
      version += 1;
    }
  }});
  assert.ok(changed, 'the registry changed after the first dataset completed');
  assert.deepEqual(names(app.peek('weeklyRetail'), 2), ['River Example', 'Morgan Sample', 'Jordan Example']);
  assert.deepEqual(names(app.peek('qa')), ['River Example', 'Morgan Sample', 'Jordan Example']);
});

test('a roster changing during filtering is recomputed before publishing names-only data', async () => {
  const {context, load, save} = await setup();
  // Use identity membership alone so a stale filter cannot be hidden by the
  // weekly source's explicit ownership roster.
  await save('weeklyRetail', [['Date', 'Sheet', 'Name', 'Wipers Accepted', 'Wipers Offered']]);
  let version = 1, changed = false;
  const representative = name => ({role: 'representative', displayName: name});
  context.CoachToolsIdentity = {
    ready: async () => true,
    getIdentityVersion: () => version,
    resolveName: async () => ({confidence: 'exact', person: {personId: 'alpha', role: 'coach', displayName: 'Coach Alpha'}}),
    getRepsForCoach: async () => [representative(changed ? 'Morgan Sample' : 'River Example')],
    getRepresentatives: async () => {
      if (!changed) { changed = true; version += 1; }
      return [];
    }
  };
  load('coachtools-app-data.js');
  const app = context.CoachToolsAppData;
  assert.deepEqual(names(await app.get('qa')), ['Morgan Sample']);
  assert.deepEqual(names(app.peek('qa')), ['Morgan Sample']);
});

test('all-people and explicit management reads do not wait for an unrelated identity registry', async () => {
  const {context, load} = await setup();
  let readinessReads = 0;
  context.CoachToolsIdentity = {
    ready: async () => { readinessReads += 1; throw new Error('unexpected identity read'); },
    getIdentityVersion: () => 1
  };
  load('coachtools-app-data.js');
  const app = context.CoachToolsAppData;
  assert.equal(names(await app.get('qa', {unscoped: true})).length, 4);
  const history = await app.getHistory('qa', {unscoped: true});
  assert.equal(history.length, 1);
  assert.equal(names(history[0].data).length, 4);
  context.CoachToolsStorage.setScope({mode: 'all', label: 'All people'});
  assert.equal(names(await app.get('qa')).length, 4);
  assert.equal(readinessReads, 0, 'All-Star management and unrestricted startup stay independent of identity work');
});

test('identity updates invalidate and notify a restricted application without changing source versions', async () => {
  const {context, load} = await setup();
  let version = 1;
  context.CoachToolsIdentity = {
    ready: async () => true,
    getIdentityVersion: () => version,
    getRepresentatives: async () => []
  };
  load('coachtools-app-data.js');
  const app = context.CoachToolsAppData, updates = [];
  await app.getMany(['weeklyRetail', 'qa']);
  const stop = app.subscribe(['weeklyRetail', 'qa'], detail => updates.push(detail));
  version += 1;
  const notify = () => context.dispatchEvent(new context.CustomEvent('coachtools:identity-updated', {
    detail: {reason: 'dataset-ingested', datasetType: 'qa', identityVersion: version}
  }));
  notify();
  assert.equal(updates.length, 1, 'an open tool must reload after membership or aliases change');
  assert.equal(updates[0].reason, 'identity');
  assert.deepEqual(Array.from(updates[0].changedTypes).sort(), ['qa', 'weeklyRetail']);
  assert.equal(app.peek('weeklyRetail'), null, 'the old membership view cannot remain cached');
  await app.getMany(['weeklyRetail', 'qa']);
  assert.deepEqual(names(app.peek('weeklyRetail'), 2), ['River Example', 'Morgan Sample', 'Jordan Example']);
  stop();
  notify();
  assert.equal(updates.length, 1, 'closing a tool releases its identity subscription');
});
