'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const people = fs.readFileSync(path.join(root, 'apps', 'people-profiles.html'), 'utf8');
const command = fs.readFileSync(path.join(root, 'apps', 'coaching-command-center.html'), 'utf8');
const desktop = fs.readFileSync(path.join(root, 'shared', 'coachtools-desktop.js'), 'utf8');
const allstar = fs.readFileSync(path.join(root, 'apps', 'allstar', 'js', 'app.js'), 'utf8');
const closeContext = { Object };
closeContext.globalThis = closeContext;
vm.createContext(closeContext);
vm.runInContext(fs.readFileSync(path.join(root, 'shared', 'coachtools-close-policy.js'), 'utf8'), closeContext);
const closePolicy = closeContext.CoachToolsClosePolicy;

assert(people.includes('snapshotFingerprint') && people.includes('currentVersionFingerprint'), 'People Profiles should capture deterministic source and identity versions.');
assert(people.includes("CoachToolsAppData.subscribe(DATA_TYPES,queueSnapshotChangeCheck)"), 'Background data events should only check for a newer snapshot.');
assert(!people.includes("CoachToolsAppData.subscribe(DATA_TYPES,()=>refresh()"), 'Background data events must not rebuild a visible profile.');
assert(people.includes('New data available · Refresh') && people.includes('state.profileComplete'), 'A completed profile should remain visible until explicit refresh.');
assert(people.includes('if(state.refreshPromise)return state.refreshPromise'), 'Data and identity ingestion refreshes should coalesce into one in-flight rebuild.');
assert(people.includes('state.coachInsightsCache.has(cacheKey)') && people.includes('Cached team intelligence'), 'Coach insights should be cached and reused.');
assert(people.includes('Promise.all([recordsPromise,...historyPromises])'), 'Independent history reads should load concurrently.');
assert(people.includes('state.historySourceIndexes.get(sourceKey)') && people.includes('Reused unchanged source index'), 'QA-only changes should reuse unchanged weekly KPI source indexes.');
assert(people.includes('QA ${fmtPct(item.current)}') && people.includes('Prior ${fmtPct(item.prior)}') && people.includes('${item.sampleSize} evals'), 'QA attention should render current score, prior score, delta context, and evaluation count.');
assert(command.includes('state.runCache.get(initialCacheKey)') && command.includes('state.runCache.size > 10'), 'Command Center should cache several deterministic scope snapshots.');
assert(command.includes('stableSnapshot = before === after'), 'Command Center should reject a report if source versions changed during its build.');
assert(command.includes('Alignment.eligibleCoachCohort({ people })'), 'Command Center scope choices should use the shared current-team coach cohort.');
assert(command.includes("Promise.all(['weeklyRetail', 'weeklyReferral'].map"), 'Command Center histories should load concurrently.');

assert(desktop.includes('allStarReleaseMs || 48'), 'All-Star should have a short nonblocking release cap.');
assert(desktop.includes("closeReleaseReason = 'close-ready'") && desktop.includes("closeReleaseReason = 'nonblocking-release'"), 'All-Star close should support both ready handshakes and bounded nonblocking release.');
assert(desktop.includes("type: 'coachtools:cancel-data-loads'") && desktop.includes("type: 'coachtools:prepare-close'"), 'Closing All-Star should cancel work before requesting close preparation.');
assert(allstar.includes('saveAlreadyRunning=!!state.importCacheSaving') && allstar.includes('saveAlreadyRunning,centralSyncActive'), 'All-Star close diagnostics should snapshot an already-running save before deciding whether to queue persistence.');
assert(allstar.includes("dirtyOnly:true,noRender:true,noCompaction:true,lifecycleSave:true"), 'Dirty close persistence should remain record-based and lightweight.');
assert(!/prepareAllStarClose[\s\S]{0,800}await\s+flushImportCacheSave/.test(allstar), 'Close preparation must not await IndexedDB persistence.');

assert.deepStrictEqual({ ...closePolicy.allStarPersistencePlan({ dirty: false }) }, { dirty: false, saveAlreadyRunning: false, shouldQueueDirtySave: false, waitForPersistence: false }, 'A clean close should release without persistence.');
assert.strictEqual(closePolicy.allStarPersistencePlan({ dirty: true }).shouldQueueDirtySave, true, 'A dirty close should queue one lightweight save.');
assert.strictEqual(closePolicy.allStarPersistencePlan({ dirty: true, saveAlreadyRunning: true }).shouldQueueDirtySave, false, 'A close during an active save must not start a duplicate transaction.');
assert.strictEqual(closePolicy.allStarPersistencePlan({ dirty: true, centralSyncActive: true }).waitForPersistence, false, 'A close during report/import work must never wait for work to finish.');

console.log('People Profiles snapshot and All-Star lifecycle contract tests passed.');
