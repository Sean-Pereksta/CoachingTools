#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const desktopScript = fs.readFileSync(path.join(__dirname, '..', 'shared', 'coachtools-desktop.js'), 'utf8');
const exposedScript = desktopScript.replace(/\}\)\(window\);\s*$/, `
  root.desktopPrefetchTest = { backgroundDataPlan, prefetchAppData, startBackgroundDataPrefetch, restartScopedDataPrefetch, state, openWindows };
})(window);`);
const MiB = 1024 * 1024;

function runtime(options = {}) {
  const calls = [];
  const idle = [];
  const appData = options.appData || {
    peek: type => options.cached && options.cached.has(type) ? { stored: true } : null,
    async prefetch(types, prefetchOptions) {
      calls.push({ types: Array.from(types), options: prefetchOptions });
      return { ready: Array.from(types), failed: [] };
    }
  };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    location: { protocol: 'http:' },
    document: { readyState: 'loading', addEventListener() {} },
    COACHTOOLS_MANIFEST: { apps: options.apps || [] },
    CoachToolsStorage: { getDatasetStatus: () => options.statuses || [] },
    CoachToolsAppData: appData,
    requestIdleCallback(callback) { idle.push(callback); },
    requestAnimationFrame(callback) { callback(); }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(exposedScript, context, { filename: 'coachtools-desktop.js' });
  return { ...context.desktopPrefetchTest, calls, idle, context };
}

function status(id, overrides = {}) {
  return { id, ready: true, bytes: MiB, rowCount: 1000, ...overrides };
}

function nextTurn() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function run() {
  {
    const app = runtime({
      apps: [
        { id: 'restored', data: ['qa', 'weeklyRetail'] },
        { id: 'recent', data: ['weeklyRetail', 'documentedCoaching'] },
        { id: 'favorite', data: ['checklist'] }
      ],
      statuses: ['compCoaching', 'checklist', 'documentedCoaching', 'weeklyRetail', 'qa'].map(id => status(id))
    });
    app.state.pendingRestoreActiveId = 'restored';
    app.state.recent = ['recent', 'missing-app'];
    app.state.favorites = new Set(['favorite']);
    assert.deepStrictEqual(Array.from(app.backgroundDataPlan()), ['qa', 'weeklyRetail', 'documentedCoaching', 'checklist', 'compCoaching'], 'Restored, recent and favorite tools should receive data before the remaining sources, without duplicate reads.');
    assert.strictEqual(app.openWindows.size, 0, 'Planning data reads must not open hidden tools.');
  }

  {
    const app = runtime({
      cached: new Set(['qa']),
      statuses: [
        status('qa'),
        status('not-ready', { ready: false }),
        status('unknown', { bytes: 0, rowCount: 0 }),
        status('too-many-bytes', { bytes: 8 * MiB + 1 }),
        status('too-many-rows', { rowCount: 25001 }),
        status('known-rows', { bytes: 0 }),
        status('known-bytes', { rowCount: 0 })
      ]
    });
    assert.deepStrictEqual(Array.from(app.backgroundDataPlan()), ['known-rows', 'known-bytes'], 'Background reads should skip cached, unavailable, unknown-size and oversized sources.');
  }

  {
    const app = runtime({ statuses: ['one', 'two', 'three', 'four'].map(id => status(id, { bytes: 8 * MiB })) });
    assert.deepStrictEqual(Array.from(app.backgroundDataPlan()), ['one', 'two', 'three'], 'Background preparation must respect the total workbook byte budget.');
  }

  {
    const app = runtime({ statuses: [status('one', { rowCount: 25000 }), status('two', { rowCount: 25000 }), status('three', { rowCount: 25000 }), status('small', { rowCount: 10000 })] });
    assert.deepStrictEqual(Array.from(app.backgroundDataPlan()), ['one', 'two', 'small'], 'Sources that exceed the remaining row budget should leave room for a later small source.');
  }

  {
    const app = runtime({
      cached: new Set(['one', 'two', 'three']),
      statuses: ['one', 'two', 'three', 'four'].map(id => status(id, { bytes: 8 * MiB }))
    });
    assert.deepStrictEqual(Array.from(app.backgroundDataPlan()), [], 'Repeated background runs must count already cached workbooks against the byte budget.');
  }

  {
    const app = runtime({
      cached: new Set(['one', 'two']),
      statuses: [status('one', { rowCount: 25000 }), status('two', { rowCount: 25000 }), status('large', { rowCount: 15000 }), status('small', { rowCount: 10000 })]
    });
    assert.deepStrictEqual(Array.from(app.backgroundDataPlan()), ['small'], 'Repeated background runs must count cached rows and prepare only what fits the remaining row budget.');
  }

  {
    const app = runtime({
      statuses: [status('selected-scope'), status('other-scope')],
      appData: { peek: () => null, canPrefetch: type => type === 'selected-scope' }
    });
    assert.deepStrictEqual(Array.from(app.backgroundDataPlan()), ['selected-scope'], 'Only sources eligible for the selected person scope may enter the background plan.');
  }

  {
    const app = runtime();
    app.prefetchAppData({ id: 'opening', data: ['qa', 'weeklyRetail'] });
    await Promise.resolve();
    assert.strictEqual(app.calls.length, 1);
    assert.deepStrictEqual(app.calls[0].types, ['qa', 'weeklyRetail']);
    assert.strictEqual(app.calls[0].options.priority, 'normal', 'Opening a tool should start its reads promptly instead of waiting for idle background work.');
  }

  {
    const app = runtime({ appData: { peek: () => null, prefetch: async () => { throw new Error('Storage unavailable'); } } });
    await assert.doesNotReject(async () => app.prefetchAppData({ id: 'opening', data: ['qa'] }));
  }

  {
    let resolveRead;
    let readSignal;
    const app = runtime({ appData: { peek: () => null, prefetch: (types, options) => { readSignal = options.signal; return new Promise(resolve => { resolveRead = resolve; }); } } });
    const opening = app.prefetchAppData({ id: 'opening', data: ['qa'] });
    assert(!opening || typeof opening.then !== 'function', 'A tool must navigate immediately while its data read is still pending.');
    assert.strictEqual(typeof resolveRead, 'function');
    assert.strictEqual(readSignal.aborted, false);
    opening.abort();
    assert.strictEqual(readSignal.aborted, true, 'The caller must be able to stop optional reads when a tool closes.');
    resolveRead({ ready: ['qa'], failed: [] });
  }

  {
    const reads = [];
    const release = [];
    const app = runtime({
      statuses: [status('qa'), status('documentedCoaching')],
      appData: {
        peek: () => null,
        prefetch: types => new Promise(resolve => { reads.push(Array.from(types)); release.push(resolve); })
      }
    });
    const first = app.startBackgroundDataPrefetch();
    assert.strictEqual(app.startBackgroundDataPrefetch(), first, 'Overlapping startup and storage-sync requests should share one background queue.');
    assert.strictEqual(reads.length, 0, 'Background data must wait for an idle turn before reading.');
    assert.strictEqual(app.idle.length, 1);
    app.idle.shift()();
    await nextTurn();
    assert.deepStrictEqual(reads, [['qa']], 'Only the first source may read while it is pending.');
    release.shift()({ ready: ['qa'], failed: [] });
    await nextTurn();
    assert.deepStrictEqual(reads, [['qa'], ['documentedCoaching']], 'The next source should start only when the prior source finishes.');
    release.shift()({ ready: ['documentedCoaching'], failed: [] });
    assert.strictEqual(await first, true);
    assert.strictEqual(app.state.dataPrefetchPromise, null, 'A finished background run must release its single-flight marker.');
    assert.strictEqual(app.openWindows.size, 0, 'Background preparation must not instantiate application frames.');
  }

  {
    const app = runtime({ statuses: [status('qa')] });
    app.state.autoScanRunning = true;
    const pending = app.startBackgroundDataPrefetch();
    app.idle.shift()();
    await pending;
    assert.strictEqual(app.calls.length, 0, 'A storage update should receive the disk turn before optional background preparation.');
  }

  {
    const reads = [];
    const cached = new Set();
    let releaseRead;
    const app = runtime({
      statuses: [status('one', { bytes: 8 * MiB }), status('two', { bytes: 8 * MiB }), status('three', { bytes: 8 * MiB }), status('foreground', { bytes: 16 * MiB })],
      appData: {
        peek: type => cached.has(type) ? {} : null,
        prefetch: types => new Promise(resolve => {
          reads.push(Array.from(types));
          releaseRead = () => { cached.add(types[0]); resolve({ ready: Array.from(types), failed: [] }); };
        })
      }
    });
    const pending = app.startBackgroundDataPrefetch();
    app.idle.shift()();
    await nextTurn();
    cached.add('foreground');
    releaseRead();
    await pending;
    assert.deepStrictEqual(reads, [['one']], 'Foreground reads that consume the remaining cache budget must prevent later optional reads from a previously built plan.');
  }

  {
    const reads = [];
    const eligible = new Set(['former-one', 'former-two']);
    let formerSignal;
    let releaseFormerRead;
    const app = runtime({
      statuses: [status('former-one'), status('former-two'), status('new-scope')],
      appData: {
        peek: () => null,
        canPrefetch: type => eligible.has(type),
        prefetch(types, options) {
          reads.push(Array.from(types));
          if (types[0] === 'former-one') {
            formerSignal = options.signal;
            return new Promise((resolve, reject) => {
              releaseFormerRead = () => {
                if (options.signal.aborted) {
                  const error = new Error('Scope changed');
                  error.name = 'AbortError';
                  reject(error);
                } else resolve({ ready: Array.from(types), failed: [] });
              };
            });
          }
          return Promise.resolve({ ready: Array.from(types), failed: [] });
        }
      }
    });
    const formerQueue = app.startBackgroundDataPrefetch();
    app.idle.shift()();
    await nextTurn();
    assert.deepStrictEqual(reads, [['former-one']]);
    eligible.clear();
    eligible.add('new-scope');
    app.restartScopedDataPrefetch();
    assert.strictEqual(formerSignal.aborted, true, 'A scope change must cancel the former scope queue.');
    assert.strictEqual(reads.length, 1, 'The replacement queue must wait for the in-flight former read to settle.');
    releaseFormerRead();
    await formerQueue;
    await nextTurn();
    assert.strictEqual(app.idle.length, 1, 'A scope change must schedule a fresh background turn after cancellation.');
    const replacementQueue = app.state.dataPrefetchPromise;
    app.idle.shift()();
    await replacementQueue;
    assert.deepStrictEqual(reads, [['former-one'], ['new-scope']], 'The restarted queue must use current scope eligibility and never continue to other former-scope sources.');
  }

  {
    const app = runtime({ statuses: [] });
    const oldController = new AbortController();
    const windowState = { app: { id: 'open-tool', data: ['qa'] }, deferred: false, loaded: true, dataPrefetchController: oldController };
    app.openWindows.set('open-tool', windowState);
    app.restartScopedDataPrefetch();
    assert.strictEqual(oldController.signal.aborted, true, 'An open tool must stop its previous scope prefetch.');
    assert.notStrictEqual(windowState.dataPrefetchController, oldController, 'An open tool must receive a fresh scope prefetch controller.');
    assert.strictEqual(app.calls.length, 1);
    assert.strictEqual(app.calls[0].options.signal, windowState.dataPrefetchController.signal);
    await nextTurn();
    const pending = app.state.dataPrefetchPromise;
    app.idle.shift()();
    await pending;
  }

  {
    const reads = [];
    let releaseRead;
    const app = runtime({
      statuses: [status('qa'), status('checklist')],
      appData: {
        peek: () => null,
        prefetch: types => new Promise(resolve => { reads.push(Array.from(types)); releaseRead = resolve; })
      }
    });
    const pending = app.startBackgroundDataPrefetch();
    app.idle.shift()();
    await nextTurn();
    app.openWindows.set('foreground', { deferred: false, loaded: false, minimized: false });
    releaseRead({ ready: ['qa'], failed: [] });
    await pending;
    assert.deepStrictEqual(reads, [['qa']], 'Opening a foreground tool should stop secondary background reads after the current source finishes.');
  }

  console.log('CoachTools desktop data prefetch tests passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
