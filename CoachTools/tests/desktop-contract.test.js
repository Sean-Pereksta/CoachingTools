#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const desktopScript = fs.readFileSync(path.join(root, 'shared', 'coachtools-desktop.js'), 'utf8');
const desktopStyles = fs.readFileSync(path.join(root, 'shared', 'coachtools-theme.css'), 'utf8');
const desktopHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps.json'), 'utf8'));
const storageScript = fs.readFileSync(path.join(root, 'shared', 'coachtools-storage.js'), 'utf8');
const appDataScript = fs.readFileSync(path.join(root, 'shared', 'coachtools-app-data.js'), 'utf8');
const smartImportScript = fs.readFileSync(path.join(root, 'shared', 'coachtools-smart-import.js'), 'utf8');
const rememberedScopeScript = fs.readFileSync(path.join(root, 'shared', 'coachtools-remembered-scope.js'), 'utf8');
const allstarAppScript = fs.readFileSync(path.join(root, 'apps', 'allstar', 'js', 'app.js'), 'utf8');
const allstarImportsScript = fs.readFileSync(path.join(root, 'apps', 'allstar', 'js', 'imports.js'), 'utf8');
const allstarModelsScript = fs.readFileSync(path.join(root, 'apps', 'allstar', 'js', 'models.js'), 'utf8');
const allstarPersistenceScript = fs.readFileSync(path.join(root, 'apps', 'allstar', 'js', 'persistence.js'), 'utf8');
const context = { console, TextEncoder, TextDecoder };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'vendor', 'lz-string.min.js'), 'utf8'), context, { filename: 'lz-string.min.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'shared', 'coachtools-import.js'), 'utf8'), context, { filename: 'coachtools-import.js' });

const imports = context.CoachToolsImport;
assert(imports, 'Shared importer should attach to window.');

const expectedIconFiles = [
  'allstar.png',
  'weekly-data.png',
  'coaching-gaps.png',
  'coach-timeline.png',
  'kpi-impact.png',
  'qa-scores.png',
  'audit-checklist.png',
  'coachtools-home.png',
  'shared-data.png',
  'backup-restore.png',
  'settings.png',
  'all-apps.png',
  'default-app.png'
];
for (const icon of expectedIconFiles) {
  assert(desktopScript.includes(`icons/${icon}`), `Desktop should reference exact icon filename ${icon}.`);
}
for (const icon of expectedIconFiles.slice(0, 11)) {
  assert(fs.existsSync(path.join(root, 'icons', icon)), `Uploaded icon should be available at icons/${icon}.`);
}
assert(desktopScript.includes('appendImageWithFallback'), 'Desktop icons should retain a safe default/initials fallback chain.');
assert(desktopScript.includes('preloadDesktopAssets'), 'The startup splash should run one centralized desktop icon preload.');
assert(/function desktopAssetPaths\(\)[\s\S]*?apps\.map\(app => app\.icon\)/.test(desktopScript), 'Manifest icon paths should join the startup preload automatically.');
assert(desktopScript.includes('new Set(['), 'Duplicate icon paths should collapse before preloading.');
assert(desktopScript.includes('ICON_PRELOAD_CONCURRENCY = 4'), 'Icon decoding should use sensible limited concurrency.');
assert(desktopScript.includes('ICON_PRELOAD_TIMEOUT_MS'), 'One broken image must not hang startup.');
assert(desktopScript.indexOf('app.icon || APP_ICON_PATHS[app.id]') >= 0, 'Manifest app.icon should be authoritative ahead of legacy overrides.');
assert(desktopScript.includes("image.loading = 'eager'"), 'Desktop icon elements should consume the startup cache immediately.');
assert(/Icon diagnostics[\s\S]*?Array\.from\(state\.iconFailures\)/.test(desktopScript), 'Diagnostics should list actual failed icon paths.');
assert(desktopHtml.includes('data-system-icon="coachtools-home"'), 'Desktop controls should use the uploaded CoachTools home icon.');
assert(desktopHtml.includes('data-system-icon="start"'), 'The Start button should use the branded Start graphic role.');
assert(desktopHtml.includes('data-system-icon="shared-data"'), 'Data controls should use the uploaded shared-data icon.');
assert(desktopHtml.includes('id="quickDataInput"'), 'The desktop readiness panel should expose one multi-file data picker.');
assert(desktopHtml.includes('data-action="quick-upload-data"'), 'The desktop should offer rapid all-data upload from Update Data and readiness controls.');
assert(desktopHtml.includes('id="startupSplash"'), 'A startup readiness bar should be present before the desktop opens.');
assert(desktopHtml.includes('rel="preload" as="image" href="graphics/loading.png"'), 'The loading artwork should be requested immediately from index.html.');
assert(!desktopHtml.includes('startup-card'), 'The startup screen should not use a popup-style card.');
for (const script of ['shared/coachtools-dependencies.js', 'shared/coachtools-performance.js', 'shared/coachtools-sync.js', 'shared/coachtools-storage.js', 'shared/coachtools-identity.js', 'shared/coachtools-import.js', 'shared/coachtools-app-data.js']) {
  assert(new RegExp(`<script[^>]+src=["']${script.replace(/\./g, '\\.')}["'][^>]*defer`).test(desktopHtml), `${script} should defer so the startup bar can paint immediately.`);
}
assert(!desktopHtml.includes('vendor/xlsx.full.min.js'), 'The desktop critical path should not load SheetJS.');
assert(desktopScript.includes("image.src = 'graphics/background.png'"), 'The main wallpaper should load from graphics/background.png.');
assert(/\.startup-splash\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?url\(["']?\.\.\/graphics\/loading\.png["']?\)[\s\S]*?background-size:\s*cover;/.test(desktopStyles), 'The full-screen splash should use graphics/loading.png as a cover background.');
assert(!desktopStyles.includes('.startup-card'), 'Startup CSS should not retain the old floating card treatment.');
assert(/\.desktop-wallpaper\s*\{[\s\S]*?z-index:\s*0;/.test(desktopStyles), 'The wallpaper must render above the body background instead of behind the page canvas.');
assert(/\.desktop-shade\s*\{[\s\S]*?z-index:\s*1;/.test(desktopStyles), 'The readability shade should render directly above the wallpaper.');
assert(/\.desktop-shell\s*\{[\s\S]*?z-index:\s*2;/.test(desktopStyles), 'Desktop controls should render above the wallpaper and shade.');
assert(desktopScript.includes('runStartupSequence'), 'Desktop startup should coordinate metadata readiness.');
assert(/runStartupSequence\(\)[\s\S]*?preloadDesktopAssets\(\)[\s\S]*?storage\.ready/.test(desktopScript), 'Icons should decode during the splash before metadata-only IndexedDB readiness completes.');
assert(desktopScript.includes('scanStorage({ startup: true, background: true })'), 'Storage synchronization should run after the desktop opens.');
assert(desktopScript.indexOf('dismissStartupSplash()') < desktopScript.indexOf('scanStorage({ startup: true, background: true })'), 'Desktop visibility must precede storage synchronization.');
assert(!desktopScript.includes('warmApplications'), 'The retired full-suite iframe warm-up must be removed.');
assert(!desktopScript.includes('WARMUP_CONCURRENCY'), 'Startup must not keep a hidden iframe worker pool.');
assert(desktopScript.includes('createDeferredWindow'), 'Remembered windows should restore as lightweight metadata.');
assert(/function restoreOpenWindows\(\)[\s\S]*?createDeferredWindow/.test(desktopScript), 'Restoring taskbar entries must not instantiate every iframe.');
assert(/function activateWindow\(appId\)[\s\S]*?windowState\.deferred[\s\S]*?createWindow/.test(desktopScript), 'A deferred window should create its iframe only when activated.');
assert(desktopScript.includes('isStorageFileUnchanged'), 'Automatic storage sync should compare lightweight file metadata.');
assert(desktopScript.includes('no spreadsheets downloaded'), 'Unchanged storage scans should explicitly skip spreadsheet downloads.');
assert(desktopScript.includes('Changed file parsing'), 'Changed-file parsing should be measured for diagnostics.');
assert(desktopScript.includes('if (background) await yieldLowPriority()'), 'Background changed-file parsing should yield before heavy work.');
assert(appDataScript.includes('getManyProgressive'), 'Applications should share a staged data-loading API.');
assert(appDataScript.includes('loadForApp'), 'Manifest-driven application loading should have a dedicated API.');
assert(!/async function getMany\([\s\S]*?Promise\.all\(requested/.test(appDataScript), 'Large app hydration must not request every dataset with one Promise.all.');
assert(appDataScript.includes('requestIdleCallback') && appDataScript.includes('requestAnimationFrame'), 'Progressive reads should yield through browser scheduling APIs.');
assert(appDataScript.includes('pendingReads'), 'Concurrent requests should retain shared pending-read deduplication.');
assert(appDataScript.includes('coachtools:cancel-data-loads'), 'Closing an app should stop unnecessary secondary hydration where practical.');
const dynamicsChecklist = manifest.apps.find(app => app.id === 'contact-center-checklist');
assert(dynamicsChecklist && dynamicsChecklist.preload === false, 'The Dynamics checklist must never be eagerly warmed.');
for (const app of manifest.apps) assert.strictEqual(app.preload, false, `${app.name} should remain lazy-loaded.`);
assert(!/fetch\s*\(\s*["']apps\.json/i.test(desktopHtml), 'Direct-file startup should keep using the generated JavaScript manifest.');
assert(desktopHtml.includes('id="globalScopeSelect"'), 'The desktop should expose one global person scope selector.');
assert(storageScript.includes("const SCOPE_KEY = 'coachtools.scope.v1'"), 'The global scope should retain a stable persisted storage key.');
assert(/function setScope\(scope\)[\s\S]*?safeSet\(SCOPE_KEY/.test(storageScript), 'Changing scope should persist the selection.');
assert(storageScript.includes('subscribeScope'), 'Applications should be able to subscribe to global scope changes.');
assert(!storageScript.includes('function loadCurrentData'), 'IndexedDB readiness should not hydrate all current datasets.');
assert(storageScript.includes('cacheCurrentRecord'), 'Requested datasets should use the version-aware in-memory cache.');
assert(storageScript.includes('materializeLegacyCompatibility'), 'Legacy localStorage docks should require an explicit compatibility request.');
assert(imports.readWorkbook || fs.readFileSync(path.join(root, 'shared', 'coachtools-import.js'), 'utf8').includes('ensureXlsx'), 'SheetJS should load only when a workbook is actually read.');
assert(desktopScript.includes("type: 'coachtools:scope-updated'"), 'The desktop should relay scope changes to open applications.');
assert(desktopScript.includes("type: 'coachtools:prepare-close'") && desktopScript.includes('APP_CLOSE_DEADLINE_MS'), 'Allstar close should use a bounded prepare/ready handshake.');
assert(storageScript.includes('scopeSnapshot') && storageScript.includes('scopedRowCount') && storageScript.includes('scopeMatchDiagnostics'), 'Current dataset metadata should retain the scope that created it.');
assert(storageScript.includes('storageContract: Object.freeze'), 'The shared data API should expose its schema-7 storage contract.');
assert(desktopScript.includes("coachtools.storage.processed.v2"), 'Processed storage files should be keyed by the scope-aware v2 contract.');
assert(smartImportScript.includes("'weeklyReferral', 'qa'") && smartImportScript.includes('importer.saveRecognizedEntry(entry, { scope })'), 'The smart chooser should route QA and every save through the shared scoped importer.');
assert(!smartImportScript.includes('sheet.aoa = headerRows.concat(selectedRows)'), 'The smart chooser must not retain a second legacy scope-filter implementation.');
assert(rememberedScopeScript.includes('adoptCleanScope') && rememberedScopeScript.includes('cancelPending'), 'Clean Upload should adopt the chooser scope and safely cancel incomplete sessions.');
assert(rememberedScopeScript.includes('inspectDataset(type, prepared.dataset, metadata)') && rememberedScopeScript.includes("['new', 'updated'].includes"), 'Direct-file Auto Update should build a comparison plan before it commits accepted changes.');
assert(smartImportScript.includes('analysis.authoritativeUpdateScope'), 'The smart chooser must preserve the authoritative Auto Update scope instead of asking to widen it.');
assert(allstarImportsScript.includes("const ALLSTAR_SYNC_KEY='allStarCoachToolsSync.v2'"), 'Allstar should use the metadata-rich central sync map.');
assert(allstarImportsScript.includes('directWorkbookFromCoachToolsDataset') && !allstarImportsScript.includes('function sheetJsWorkbookFromCoachToolsDataset'), 'Central datasets should use the direct AOA adapter instead of rebuilding SheetJS workbooks.');
assert(allstarModelsScript.includes('createAllStarStartupJob') && allstarModelsScript.includes('job.preventedRegressions++'), 'Allstar startup progress should have one monotonic owner.');
assert(allstarAppScript.includes('async function startAllStar()') && allstarAppScript.includes("type:'coachtools:close-ready'"), 'Allstar should coordinate startup and acknowledge close preparation.');
assert(!allstarAppScript.includes("flushImportCacheSave('pagehide flush')") && !allstarAppScript.includes("flushImportCacheSave('visibilitychange flush')"), 'Allstar lifecycle events should not perform duplicate full flushes.');
assert(allstarPersistenceScript.includes('dirtyOnly:true,noRender:true,noCompaction:true,lifecycleSave:true') || allstarAppScript.includes('dirtyOnly:true,noRender:true,noCompaction:true,lifecycleSave:true'), 'Close persistence should use the lightweight dirty-record mode.');
assert(desktopStyles.includes('.startup-progress'), 'Startup readiness should include a visible progress bar.');
assert(desktopStyles.includes('.app-card:hover .app-icon'), 'Application icons should respond to pointer hover.');
assert(desktopStyles.includes('scale(1.065)'), 'Application hover should expand icons slightly.');
assert(desktopStyles.includes('drop-shadow(0 0 10px'), 'Application hover should add a visible glow.');

function parsed(fileName, rows) {
  return {
    meta: { fileName, fileSize: 100, totalRows: rows.length },
    workbook: { sheets: ['Data'], data: { Data: { aoa: rows } } }
  };
}

assert.strictEqual(imports.classifyFile({ name: 'Retail Weekly.xlsx' }, parsed('Retail Weekly.xlsx', [['Sheet']])).id, 'weeklyRetail');
assert.strictEqual(imports.classifyFile({ name: 'RETAIL-WEEKLY_8-2-8-8 (1).xlsx' }, parsed('RETAIL-WEEKLY_8-2-8-8 (1).xlsx', [['Sheet']])).id, 'weeklyRetail');
assert.strictEqual(imports.classifyFile({ name: 'Referral Weekly Final.xlsx' }, parsed('Referral Weekly Final.xlsx', [['Sheet']])).id, 'weeklyReferral');
assert.strictEqual(imports.classifyFile({ name: 'August 2026 Appointment Report.xlsx' }, parsed('August 2026 Appointment Report.xlsx', [['Representative']])).id, 'monthlyRetail');
assert.strictEqual(imports.classifyFile({ name: 'Aug KPI Report Copy.xlsx' }, parsed('Aug KPI Report Copy.xlsx', [['Representative']])).id, 'monthlyReferral');
assert.strictEqual(imports.classifyFile({ name: 'Retail Monthly August 2026.xlsx' }, parsed('Retail Monthly August 2026.xlsx', [['Representative']])).id, 'monthlyRetail');
assert.strictEqual(imports.classifyFile({ name: 'Referral Monthly August 2026.xlsx' }, parsed('Referral Monthly August 2026.xlsx', [['Representative']])).id, 'monthlyReferral');
assert.strictEqual(imports.classifyFile({ name: 'Comp Coaching August 2026.xlsx' }, parsed('Comp Coaching August 2026.xlsx', [['CSR/SSR Name', 'Compliment']])).id, 'compCoaching');
assert.strictEqual(imports.classifyFile({ name: 'All Items 8-11.xlsx' }, parsed('All Items 8-11.xlsx', [['Coach Assigned', 'Associate Name', 'Action']])).id, 'checklist');
assert.strictEqual(imports.classifyFile({ name: 'Documented Coaching.csv' }, parsed('Documented Coaching.csv', [['Job Coach', 'Associate Name', 'Coaching Date']])).id, 'documentedCoaching');
assert.strictEqual(imports.classifyFile({ name: 'mystery.xlsx' }, parsed('mystery.xlsx', [['Team', 'Score %'], ['Coach A', 0.9]])).id, 'qa');
assert.strictEqual(imports.classifyFile({ name: 'QA.xlsx' }, parsed('QA.xlsx', [['Team']])).needsReview, true);
assert.deepStrictEqual(Array.from(imports.DATASET_ORDER), ['weeklyRetail', 'weeklyReferral', 'monthlyRetail', 'monthlyReferral', 'qa', 'documentedCoaching', 'checklist', 'compCoaching']);

const ambiguous = imports.classifyFile({ name: 'mystery.xlsx' }, parsed('mystery.xlsx', [['Sheet'], ['Coach A']]));
assert.strictEqual(ambiguous.id, null);
assert.deepStrictEqual(Array.from(ambiguous.candidates).sort(), ['weeklyReferral', 'weeklyRetail']);

const scoped = imports.prepareDataset(parsed('Retail Weekly.xlsx', [
  ['Report title'],
  ['Sheet', 'Metric'],
  ['JOHN DOE', 1],
  ['Jane Doe', 2]
]), 'weeklyRetail', { scope: { mode: 'team', coaches: ['John Doe'] } });
assert.deepStrictEqual(JSON.parse(JSON.stringify(scoped.workbook.data.Data.aoa)), [
  ['Report title'],
  ['Sheet', 'Metric'],
  ['JOHN DOE', 1]
]);

const stableScopeA = imports.normalizeScopeSnapshot({ mode: 'coach', personId: 'coach-1', coaches: ['Sean Pereksta'], capturedAt: '2026-08-20T00:00:00.000Z' });
const stableScopeB = imports.normalizeScopeSnapshot({ mode: 'coach', personId: 'coach-1', coaches: ['Sean Pereksta'], capturedAt: '2026-08-21T00:00:00.000Z' });
assert.strictEqual(stableScopeA.scopeHash, stableScopeB.scopeHash, 'Scope hashes must exclude capturedAt.');
const stableScopeAliasChange = imports.normalizeScopeSnapshot({ mode: 'coach', personId: 'coach-1', coaches: ['S. Pereksta'] });
assert.strictEqual(stableScopeA.scopeHash, stableScopeAliasChange.scopeHash, 'Stable person ids should keep a coach scope hash unchanged when display aliases change.');

const aliasedScope = imports.normalizeScopeSnapshot({ mode: 'coach', personId: 'coach-1', label: 'Sean Pereksta' }, { identityPeople: [{ personId: 'coach-1', role: 'coach', displayName: 'Sean Pereksta', aliases: ['S. Pereksta'], sourceNames: { qa: ['PEREKSTA, SEAN'] } }] });
const qaSource = parsed('QA.xlsx', [
  ['Team', 'Agent Name', 'Score %'],
  ['Sean Pereksta', 'Rep A', 90],
  ['PEREKSTA, SEAN', 'Rep B', 91],
  ['S. Pereksta', 'Rep C', 92],
  ['Other Coach', 'Rep D', 93]
]);
const scopedQa = imports.prepareScopedDataset(qaSource, 'qa', aliasedScope);
assert.strictEqual(scopedQa.valid, true);
assert.strictEqual(scopedQa.matchedRows, 3, 'QA should match canonical names and known aliases through Team.');
assert.strictEqual(scopedQa.diagnostics.outOfScopeRows, 1);
assert.strictEqual(scopedQa.dataset.workbook.data.Data.aoa.length, 4);

const teamScope = imports.normalizeScopeSnapshot({ mode: 'team', team: 'North', label: 'North' }, { identityPeople: [
  { personId: 'coach-1', role: 'coach', displayName: 'Sean Pereksta', currentTeam: 'North', aliases: ['S. Pereksta'] },
  { personId: 'coach-2', role: 'coach', displayName: 'Jamie Smith', currentTeam: 'North', sourceNames: { qa: ['SMITH, JAMIE'] } },
  { personId: 'coach-3', role: 'coach', displayName: 'Other Coach', currentTeam: 'South' }
] });
const teamQa = imports.prepareScopedDataset(parsed('QA Team.xlsx', [
  ['Team', 'Agent Name', 'Score %'],
  ['Sean Pereksta', 'Rep A', 90],
  ['S. Pereksta', 'Rep B', 91],
  ['SMITH, JAMIE', 'Rep C', 92],
  ['Other Coach', 'Rep D', 93]
]), 'qa', teamScope);
assert.strictEqual(teamScope.coachPersonIds.length, 2, 'A saved team scope should expand to all canonical coaches in that team.');
assert.strictEqual(teamQa.matchedRows, 3, 'A multi-coach QA scope should match every selected coach alias and no others.');

const missingQaTeam = imports.prepareScopedDataset(parsed('QA.xlsx', [['Agent Name', 'Score %'], ['Rep A', 90]]), 'qa', aliasedScope);
assert.strictEqual(missingQaTeam.needsReview, true, 'Scoped QA without Team must retain the existing dataset for review.');
assert.match(missingQaTeam.reason, /column not found/i);

const zeroQa = imports.prepareScopedDataset(parsed('QA.xlsx', [['Team', 'Score %'], ['Other Coach', 90]]), 'qa', aliasedScope);
assert.strictEqual(zeroQa.needsReview, true, 'A zero-row scoped collapse must not be accepted automatically.');
const missingOwnership = imports.prepareScopedDataset(parsed('Checklist.xlsx', [['Associate Name', 'Action'], ['Rep A', 'Call']]), 'checklist', { mode: 'coach', coaches: ['Coach A'] });
assert.strictEqual(missingOwnership.needsReview, true, 'A scoped source must never pass through a sheet with no ownership column.');
const tabScoped = { meta: { fileName: 'Retail Monthly.xlsx' }, workbook: { sheets: ['Coach A', 'Coach B'], data: { 'Coach A': { aoa: [['Representative', 'Metric'], ['Rep A', 1]] }, 'Coach B': { aoa: [['Representative', 'Metric'], ['Rep B', 2]] } } } };
const selectedTab = imports.prepareScopedDataset(tabScoped, 'monthlyRetail', { mode: 'coach', coaches: ['Coach A'] });
assert.strictEqual(selectedTab.valid, true);
assert.strictEqual(selectedTab.matchedRows, 1, 'A coach-named worksheet should be treated as explicit ownership.');
assert.deepStrictEqual(JSON.parse(JSON.stringify(selectedTab.dataset.workbook.data['Coach B'].aoa)), [], 'Unowned headerless worksheets must be removed from a scoped dataset.');
const splitQaA = { meta: { fileName: 'QA.xlsx' }, workbook: { sheets: ['Current', 'Other'], data: { Current: { aoa: [['Team', 'Score %'], ['Coach A', 90]] }, Other: { aoa: [['Team', 'Score %'], ['Coach B', 80]] } } } };
const splitQaB = { meta: { fileName: 'QA.xlsx' }, workbook: { sheets: ['Current', 'Other Renamed'], data: { Current: { aoa: [['Team', 'Score %'], ['Coach A', 90]] }, 'Other Renamed': { aoa: [['Team', 'Score %'], ['Coach B', 5]] } } } };
const scopedSplitQaA = imports.prepareScopedDataset(splitQaA, 'qa', { mode: 'coach', coaches: ['Coach A'] });
const scopedSplitQaB = imports.prepareScopedDataset(splitQaB, 'qa', { mode: 'coach', coaches: ['Coach A'] });
assert.strictEqual(scopedSplitQaA.scopedFingerprint, scopedSplitQaB.scopedFingerprint, 'Out-of-scope worksheets and their names must not affect the scoped fingerprint.');
assert.deepStrictEqual(JSON.parse(JSON.stringify(scopedSplitQaB.dataset.workbook.data['Other Renamed'].aoa)), [], 'Worksheets with ownership headers but no selected rows should be dropped from scoped data.');

const qaCoachA1 = imports.prepareScopedDataset(parsed('QA.xlsx', [['Team', 'Score %'], ['Coach A', 90], ['Coach B', 80]]), 'qa', { mode: 'coach', coaches: ['Coach A'] });
const qaCoachA2 = imports.prepareScopedDataset(parsed('QA.xlsx', [['Team', 'Score %'], ['Coach A', 90], ['Coach B', 10]]), 'qa', { mode: 'coach', coaches: ['Coach A'] });
const qaCoachA3 = imports.prepareScopedDataset(parsed('QA.xlsx', [['Team', 'Score %'], ['Coach A', 95], ['Coach B', 10]]), 'qa', { mode: 'coach', coaches: ['Coach A'] });
const qaCoachAAdded = imports.prepareScopedDataset(parsed('QA.xlsx', [['Team', 'Score %'], ['Coach A', 90], ['Coach A', 91], ['Coach B', 80]]), 'qa', { mode: 'coach', coaches: ['Coach A'] });
assert.strictEqual(qaCoachA1.scopedFingerprint, qaCoachA2.scopedFingerprint, 'Out-of-scope changes must not change the active coach fingerprint.');
assert.notStrictEqual(qaCoachA2.scopedFingerprint, qaCoachA3.scopedFingerprint, 'In-scope changes must change the active coach fingerprint.');
assert.strictEqual(qaCoachAAdded.matchedRows, 2, 'Adding an in-scope row must update the scoped row count.');
assert.notStrictEqual(qaCoachA1.scopedFingerprint, qaCoachAAdded.scopedFingerprint, 'Adding an in-scope row must change the scoped fingerprint.');
const qaCoachB = imports.prepareScopedDataset(parsed('QA.xlsx', [['Team', 'Score %'], ['Coach A', 90], ['Coach B', 80]]), 'qa', { mode: 'coach', coaches: ['Coach B'] });
assert.notStrictEqual(qaCoachA1.scopeHash, qaCoachB.scopeHash, 'The same physical file must be re-evaluated when scope changes.');
const allQa = imports.prepareScopedDataset(qaSource, 'qa', { mode: 'all', label: 'All people' });
assert.strictEqual(allQa.valid, true);
assert.strictEqual(allQa.dataset.workbook.data.Data.aoa.length, 5, 'All People should retain department-wide QA.');

const coaching = imports.prepareDataset(parsed('Documented Coaching.xlsx', [
  ['Job Coach', 'Coaching Date'],
  ['John Doe', '2026-08-11']
]), 'documentedCoaching', { scope: { mode: 'all' } });
assert.strictEqual(coaching.workbook.data.Data.aoa[0][1], 'Date');

assert.deepStrictEqual(JSON.parse(JSON.stringify(imports.detectPeriod('Retail Weekly 7-19-7-25.xlsx', 'weeklyRetail'))), {
  startDate: `${new Date().getFullYear()}-07-19`,
  endDate: `${new Date().getFullYear()}-07-25`,
  label: `${new Date().getFullYear()}-07-19 – ${new Date().getFullYear()}-07-25`,
  periodKey: `${new Date().getFullYear()}-07-19`,
  sortKey: `${new Date().getFullYear()}-07-19`
});

const packed = imports.packDataset(scoped);
assert.strictEqual(JSON.parse(context.LZString.decompressFromUTF16(packed)).meta.source, 'weeklyRetail');

console.log('CoachTools desktop/import contract tests passed.');
