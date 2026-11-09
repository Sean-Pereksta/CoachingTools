#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'shared', 'coachtools-app-data.js'), 'utf8');
const identity = (type, version) => ({ datasetId: `${type}:${version}`, version, fingerprint: `v${version}` });
const record = (type, version) => ({ id: `${type}:${version}`, datasetType: type, version, data: { value: version } });

function harness(options = {}) {
  const versions = { qa: identity('qa', 1), documentedCoaching: identity('documentedCoaching', 1), broken: identity('broken', 1) };
  const records = { qa: record('qa', 1), documentedCoaching: record('documentedCoaching', 1) };
  const scope = { current: { mode: 'all' } };
  const statuses = Object.fromEntries(Object.keys(versions).map(id => [id, { id, ready: true, scopeMode: 'all', scopeSnapshot: { mode: 'all' } }]));
  const stats = { reads: 0, activeReads: 0, peakReads: 0, idleYields: 0, normalYields: 0 };
  const context = {
    console, setTimeout, clearTimeout, AbortController,
    requestIdleCallback(callback) { stats.idleYields += 1; setTimeout(callback, 0); },
    requestAnimationFrame(callback) { stats.normalYields += 1; setTimeout(callback, 0); },
    CoachToolsData: {
      DATASET_TYPES: Object.keys(versions),
      ready: async () => true,
      getDatasetVersion: type => versions[type] || null,
      async getCurrent(type) {
        stats.reads += 1;
        stats.activeReads += 1;
        stats.peakReads = Math.max(stats.peakReads, stats.activeReads);
        try {
          if (options.read) return await options.read(type, { versions, records, stats });
          await new Promise(resolve => setTimeout(resolve, 1));
          if (type === 'broken') throw new Error('Unreadable stored source');
          return records[type] || null;
        } finally { stats.activeReads -= 1; }
      },
      subscribe: () => () => {},
      subscribeScope: () => () => {}
    },
    CoachToolsStorage: { getScope: () => scope.current, getDatasetStatus: () => Object.values(statuses) },
    ...(options.context || {})
  };
  context.window = context;
  context.parent = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  return { adapter: context.CoachToolsAppData, versions, records, stats, context, scope, statuses };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

(async () => {
  {
    const h = harness();
    h.scope.current = { mode: 'coach', label: 'Coach A', coaches: ['Coach A'] };
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'A single coach must not warm an all-coach stored workbook.');
    const skipped = await h.adapter.prefetch(['qa']);
    assert.deepStrictEqual(Array.from(skipped.skipped), ['qa']);
    assert.strictEqual(h.stats.reads, 0, 'Scope-incompatible warm-up must not read a workbook.');
    h.statuses.qa.scopeSnapshot = { mode: 'coach', coaches: [' coach   a '] };
    h.statuses.qa.scopeMode = 'coach';
    assert.strictEqual(h.adapter.canPrefetch('qa'), true, 'Matching name-only coach scopes can warm without identity IDs.');
    h.statuses.qa.scopeSnapshot.coaches.push('Coach B');
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'A multi-coach workbook must not warm for one coach.');
    h.statuses.qa.scopeSnapshot = { mode: 'coach', coaches: ['Coach B'] };
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'Unrelated coach workbooks must remain cold.');
    assert.strictEqual((await h.adapter.get('qa')).value, 1, 'Ordinary application reads retain their existing contract when warming is skipped.');
    h.scope.current = null;
    assert.strictEqual(h.adapter.canPrefetch('qa'), true, 'An unset global scope preserves current-data warming.');
    h.scope.current = { mode: 'all' };
    assert.strictEqual(h.adapter.canPrefetch('qa'), true);
  }

  {
    const h = harness();
    h.scope.current = { mode: 'coach', personId: 'coach-a', coaches: ['Coach A'] };
    h.statuses.qa.scopeSnapshot = { mode: 'coach', coachPersonIds: ['coach-a'], coaches: ['Coach A'] };
    assert.strictEqual(h.adapter.canPrefetch('qa'), true, 'Persisted coach IDs should match a selected person ID.');
    h.statuses.qa.scopeSnapshot.coachPersonIds = ['coach-b'];
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'Matching names cannot override conflicting coach IDs.');
    h.statuses.qa.scopeSnapshot.coachPersonIds = ['coach-a', 'coach-b'];
    assert.strictEqual(h.adapter.canPrefetch('qa'), false);
    h.statuses.qa.scopeSnapshot = null;
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'Legacy scope metadata is insufficient for a narrow warm-up.');
    h.statuses.qa.scopeSnapshot = { mode: 'unknown', personId: 'coach-a' };
    assert.strictEqual(h.adapter.canPrefetch('qa'), false);
    h.statuses.qa.scopeSnapshot = { mode: 'coach', personId: 'coach-a', scopeHash: 'same' };
    h.scope.current.scopeHash = 'same';
    assert.strictEqual(h.adapter.canPrefetch('qa'), true);
    h.statuses.qa.scopeSnapshot.coachPersonIds = ['coach-a', 'coach-b'];
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'A matching person ID or hash must not conceal extra stored coach IDs.');
    delete h.statuses.qa.scopeSnapshot.coachPersonIds;
    h.statuses.qa.scopeSnapshot.coaches = ['Coach A', 'Coach B'];
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'A matching person ID or hash must not conceal extra stored coach names.');
    h.statuses.qa.scopeSnapshot.coaches = ['Coach A'];
    h.statuses.qa.scopeSnapshot.coachKeys = ['coach a', 'coach b'];
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'Matching IDs and hashes must not conceal additional coachKeys population filters.');
    h.statuses.qa.scopeSnapshot.coachKeys = ['coach a'];
    assert.strictEqual(h.adapter.canPrefetch('qa'), true);
    h.statuses.qa.scopeSnapshot.coachKeys = ['coach a', 'unverified alias'];
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'Unknown stored alias keys must remain cold until the active scope establishes them.');
    delete h.statuses.qa.scopeSnapshot.coachKeys;
    h.statuses.qa.scopeSnapshot.sourceSelections = { qa: ['Coach A', 'Coach B'] };
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'Snapshot per-source selections must be checked even without sourceScoped diagnostics.');
    delete h.statuses.qa.scopeSnapshot.sourceSelections;
    h.statuses.qa.scopeMatchDiagnostics = { peopleFilterFallback: true };
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'A filter fallback must not be mistaken for a physically narrow workbook.');
    h.statuses.qa.scopeMatchDiagnostics = { uploadPeopleSelection: { includesAllRows: true } };
    assert.strictEqual(h.adapter.canPrefetch('qa'), false);
    h.statuses.qa.scopeMatchDiagnostics = { uploadPeopleSelection: { mode: 'selected', names: ['Coach A', 'Coach B'], includesAllRows: false } };
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'Explicit upload selections also describe the physical population.');
    h.statuses.qa.scopeMatchDiagnostics = { sourceScoped: true, selectedSourceValues: ['Coach A', 'Coach B'] };
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'Broad per-source selections must not hide behind a matching master scope hash.');
    h.statuses.qa.scopeMatchDiagnostics.selectedSourceValues = ['Coach A'];
    assert.strictEqual(h.adapter.canPrefetch('qa'), true);
  }

  {
    const h = harness();
    for (const mode of ['team', 'department', 'coordinator']) {
      h.scope.current = { mode, [mode]: 'North' };
      h.statuses.qa.scopeSnapshot = { mode, [mode]: 'north', coachPersonIds: ['coach-a'] };
      assert.strictEqual(h.adapter.canPrefetch('qa'), true, `Matching ${mode} scope should be eligible.`);
      h.statuses.qa.scopeSnapshot[mode] = 'South';
      assert.strictEqual(h.adapter.canPrefetch('qa'), false);
    }
    h.scope.current = { mode: 'representative', personId: 'rep-a', coachPersonIds: ['coach-a'] };
    h.statuses.qa.scopeSnapshot = { mode: 'coach', personId: 'coach-a', coachPersonIds: ['coach-a'] };
    assert.strictEqual(h.adapter.canPrefetch('qa'), false, 'A representative must not warm their coach\'s complete population.');
    h.statuses.qa.scopeSnapshot = { mode: 'representative', personId: 'rep-a' };
    assert.strictEqual(h.adapter.canPrefetch('qa'), true);
  }

  {
    const started = deferred(), release = deferred();
    const h = harness({ read: async (type, state) => { started.resolve(); await release.promise; return state.records[type]; } });
    h.scope.current = { mode: 'coach', coaches: ['Coach A'] };
    for (const status of Object.values(h.statuses)) status.scopeSnapshot = { mode: 'coach', coaches: ['Coach A'] };
    const warming = h.adapter.prefetch(['qa', 'documentedCoaching']);
    await started.promise;
    h.scope.current = { mode: 'coach', coaches: ['Coach B'] };
    release.resolve();
    const result = await warming;
    assert.deepStrictEqual(Array.from(result.skipped), ['documentedCoaching']);
    assert.strictEqual(h.stats.reads, 1, 'The next queued source must recheck the active scope after a selection change.');
  }

  {
    const h = harness();
    let progressCalls = 0;
    const result = await h.adapter.prefetch(['qa', 'qa', 'coaching', 'missing'], { onProgress() { progressCalls += 1; } });
    assert.deepStrictEqual(Array.from(result.ready), ['qa', 'documentedCoaching']);
    assert.deepStrictEqual(Array.from(result.skipped), ['missing']);
    assert.strictEqual(result.failed.length, 0);
    assert.strictEqual(h.stats.reads, 2);
    assert.strictEqual(h.stats.peakReads, 1, 'Background source reads must remain sequential.');
    assert.strictEqual(h.stats.idleYields, 3, 'Warming must yield before its first read and between sources.');
    assert.strictEqual(progressCalls, 0, 'Background warming must not display app loading progress.');
    assert.strictEqual((await h.adapter.get('qa')).value, 1);
    assert.strictEqual(h.stats.reads, 2, 'Opening a warmed source should reuse the shared memory record.');
    const isolated = await h.adapter.prefetch(['broken', 'qa']);
    assert.strictEqual(isolated.failed[0].type, 'broken');
    assert.deepStrictEqual(Array.from(isolated.ready), ['qa'], 'One broken source must not prevent the next source warming.');
  }

  {
    const started = deferred(), release = deferred();
    const h = harness({ read: async (type, state) => { started.resolve(); await release.promise; return state.records[type]; } });
    const warming = h.adapter.prefetch(['qa']);
    await started.promise;
    const opening = h.adapter.get('qa', { includeRecord: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    release.resolve();
    assert.strictEqual((await opening).id, 'qa:1');
    await warming;
    assert.strictEqual(h.stats.reads, 1, 'Opening while prefetch runs must join its existing read.');
  }

  {
    const h = harness();
    await h.adapter.prefetch(['qa']);
    h.versions.qa = identity('qa', 2);
    h.records.qa = record('qa', 2);
    assert.strictEqual(h.adapter.peek('qa'), null, 'peek must reject an obsolete warm cache without requiring a subscriber.');
    const fresh = await h.adapter.getManyProgressive(['qa']);
    assert.strictEqual(fresh.qa.value, 2, 'Progressive opening must read a replacement instead of taking an obsolete peek shortcut.');
    delete h.versions.qa;
    delete h.records.qa;
    assert.strictEqual(h.adapter.peek('qa'), null, 'Removing a source must invalidate its warmed record.');
  }

  {
    const started = deferred(), release = deferred();
    const h = harness({ read: async (type, state) => { started.resolve(); await release.promise; return state.records[type]; } });
    const controller = new AbortController();
    const warming = h.adapter.prefetch(['qa', 'documentedCoaching'], { signal: controller.signal });
    await started.promise;
    const opening = h.adapter.get('qa');
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    release.resolve();
    await assert.rejects(warming, error => error.name === 'AbortError');
    assert.strictEqual((await opening).value, 1, 'Cancelling background warming must not cancel another app sharing its read.');
    assert.strictEqual(h.stats.reads, 1, 'A cancelled warm-up must stop before its next source.');
  }

  {
    const started = deferred(), release = deferred();
    const h = harness({ read: async (type, state) => {
      const captured = state.records[type];
      if (state.stats.reads === 1) { started.resolve(); await release.promise; }
      return captured || null;
    } });
    const reading = h.adapter.get('qa', { includeRecord: true });
    await started.promise;
    h.versions.qa = identity('qa', 2);
    h.records.qa = record('qa', 2);
    release.resolve();
    assert.strictEqual((await reading).id, 'qa:2', 'A replacement committed mid-read must trigger a fresh read.');
    assert.strictEqual(h.adapter.peek('qa', { includeRecord: true }).id, 'qa:2');
    assert.strictEqual(h.stats.reads, 2);
  }

  {
    const started = deferred(), release = deferred();
    const h = harness({ read: async (type, state) => {
      const captured = state.records[type];
      if (state.stats.reads === 1) { started.resolve(); await release.promise; }
      return captured || null;
    } });
    const reading = h.adapter.get('qa');
    await started.promise;
    delete h.versions.qa;
    delete h.records.qa;
    release.resolve();
    assert.strictEqual(await reading, null, 'Removal during a read must not put the removed data back into memory.');
    assert.strictEqual(h.adapter.peek('qa'), null);
  }

  {
    const h = harness({ read: async (type, state) => {
      state.versions[type] = identity(type, 2);
      state.records[type] = record(type, 2);
      return state.records[type];
    } });
    delete h.versions.qa;
    const migrated = await h.adapter.get('qa', { includeRecord: true });
    assert.strictEqual(migrated.id, 'qa:2', 'Explicit app reads must still accept a matching pointer created by legacy migration.');
    assert.strictEqual(h.stats.reads, 1);
  }

  {
    const idle = deferred(), release = deferred();
    const h = harness({ context: { requestIdleCallback(callback) { idle.resolve(); release.promise.then(callback); } } });
    const controller = new AbortController();
    const warming = h.adapter.prefetch(['qa'], { signal: controller.signal });
    await idle.promise;
    controller.abort();
    release.resolve();
    await assert.rejects(warming, error => error.name === 'AbortError');
    assert.strictEqual(h.stats.reads, 0, 'Aborting during the initial idle yield must prevent the first heavy read.');
  }

  {
    const h = harness();
    delete h.records.qa;
    const result = await h.adapter.prefetch(['qa'], { priority: 'normal' });
    assert.strictEqual(result.ready.length, 0, 'A missing or removed record must not be reported ready.');
    assert.deepStrictEqual(Array.from(result.skipped), ['qa']);
    assert.strictEqual(h.stats.normalYields, 1, 'Opening can request ordinary priority instead of idle warming.');
  }

  {
    const h = harness({ read: async (type, state) => {
      const captured = state.records[type];
      const version = state.versions[type].version + 1;
      state.versions[type] = identity(type, version);
      state.records[type] = record(type, version);
      return captured;
    } });
    await assert.rejects(() => h.adapter.get('qa'), /changed while loading/);
    assert.strictEqual(h.stats.reads, 3, 'Repeated replacements should fail recoverably rather than loop forever.');
    assert.strictEqual(h.adapter.peek('qa'), null);
  }

  {
    let forwarded;
    const parent = { CoachToolsAppData: { VERSION: 'test', canPrefetch: type => type === 'qa', prefetch: (...args) => { forwarded = args; return Promise.resolve({ ready: ['qa'] }); } } };
    const context = { parent, addEventListener() {}, console };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(script, context);
    const types = ['qa'], options = { priority: 'normal' };
    await context.CoachToolsAppData.prefetch(types, options);
    assert.strictEqual(forwarded[0], types);
    assert.strictEqual(forwarded[1], options, 'Embedded tools must warm the existing parent cache.');
    assert.strictEqual(context.CoachToolsAppData.canPrefetch('qa'), true);
  }

  console.log('CoachTools app data prefetch and cache freshness tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
