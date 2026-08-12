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
assert(desktopScript.includes('preloadIconAssets'), 'Desktop should preload its icon set at startup.');
assert(desktopHtml.includes('data-system-icon="coachtools-home"'), 'Desktop controls should use the uploaded CoachTools home icon.');
assert(desktopHtml.includes('data-system-icon="start"'), 'The Start button should use the branded Start graphic role.');
assert(desktopHtml.includes('data-system-icon="shared-data"'), 'Data controls should use the uploaded shared-data icon.');
assert(desktopHtml.includes('id="quickDataInput"'), 'The desktop readiness panel should expose one multi-file data picker.');
assert(desktopHtml.includes('data-action="quick-upload-data"'), 'The desktop should offer rapid all-data upload from Update Data and readiness controls.');
assert(desktopHtml.includes('id="startupSplash"'), 'A startup readiness bar should be present before the desktop opens.');
assert(desktopHtml.includes('rel="preload" as="image" href="graphics/loading.png"'), 'The loading artwork should be requested immediately from index.html.');
assert(!desktopHtml.includes('startup-card'), 'The startup screen should not use a popup-style card.');
for (const script of ['vendor/xlsx.full.min.js', 'vendor/lz-string.min.js', 'shared/coachtools-sync.js', 'shared/coachtools-storage.js', 'shared/coachtools-identity.js', 'shared/coachtools-import.js']) {
  assert(new RegExp(`<script[^>]+src=["']${script.replace(/\./g, '\\.')}["'][^>]*defer`).test(desktopHtml), `${script} should defer so the startup bar can paint immediately.`);
}
assert(desktopScript.includes("image.src = 'graphics/background.png'"), 'The main wallpaper should load from graphics/background.png.');
assert(/\.startup-splash\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?url\(["']?\.\.\/graphics\/loading\.png["']?\)[\s\S]*?background-size:\s*cover;/.test(desktopStyles), 'The full-screen splash should use graphics/loading.png as a cover background.');
assert(!desktopStyles.includes('.startup-card'), 'Startup CSS should not retain the old floating card treatment.');
assert(/\.desktop-wallpaper\s*\{[\s\S]*?z-index:\s*0;/.test(desktopStyles), 'The wallpaper must render above the body background instead of behind the page canvas.');
assert(/\.desktop-shade\s*\{[\s\S]*?z-index:\s*1;/.test(desktopStyles), 'The readability shade should render directly above the wallpaper.');
assert(/\.desktop-shell\s*\{[\s\S]*?z-index:\s*2;/.test(desktopStyles), 'Desktop controls should render above the wallpaper and shade.');
assert(desktopScript.includes('runStartupSequence'), 'Desktop startup should coordinate readiness and automatic loading.');
assert(desktopScript.includes("scanStorage({ startup: true })"), 'Startup should safely attempt to load missing data from storage.');
assert(desktopScript.indexOf('await scanStorage({ startup: true })') < desktopScript.indexOf('await refreshGlobalScope();'), 'Identity and scope should refresh after the startup data check.');
assert(desktopScript.indexOf('await refreshGlobalScope();') < desktopScript.indexOf('await warmApplications();'), 'Applications should warm only after identity and scope are ready.');
assert(desktopScript.indexOf('await warmApplications();') < desktopScript.lastIndexOf('restoreOpenWindows();'), 'Remembered app sessions should restore after application warm-up.');
assert(desktopScript.includes('const WARMUP_CONCURRENCY = 2'), 'Application warming should use a controlled two-app concurrency pool.');
assert(desktopScript.includes('apps.filter(app => app.preload === true)'), 'Warm-up eligibility should come from the application manifest.');
assert(desktopScript.includes('readyPromise'), 'Warm-up should wait for an actual iframe readiness signal or timeout.');
assert(desktopScript.includes("windowState.warmState = success ? (windowState.userOpened ? 'ready' : 'warmed') : 'failed'"), 'Live windows should distinguish warmed and user-opened lifecycle states.');
assert(/function persistOpenWindows\(\)[\s\S]*?filter\(item => item\.userOpened\)[\s\S]*?ids: userOpened\.map/.test(desktopScript), 'Warmed applications must not be persisted as user-opened sessions.');
assert(/function renderTaskbar\(\)[\s\S]*?filter\(windowState => windowState\.userOpened\)/.test(desktopScript), 'Warmed applications must not appear on the taskbar.');
assert(/function openApp\(app\)[\s\S]*?const existing = openWindows\.get\(app\.id\);[\s\S]*?promoteWindowState\(existing\)[\s\S]*?else createWindow\(app\)/.test(desktopScript), 'Opening a warmed app should promote its existing iframe and only lazy-load when none exists.');
assert(/function createWindow\(app, options\)[\s\S]*?if \(openWindows\.has\(app\.id\)\)[\s\S]*?return preload \? existing : promoteWindowState\(existing, options\)/.test(desktopScript), 'Window creation and session restoration should reuse one live iframe per app ID.');
assert(/!success && !windowState\.userOpened[\s\S]*?openWindows\.delete\(windowState\.app\.id\)/.test(desktopScript), 'Failed warm-ups should be discarded so a later open can use normal lazy loading.');
const dynamicsChecklist = manifest.apps.find(app => app.id === 'contact-center-checklist');
assert(dynamicsChecklist && dynamicsChecklist.preload === false, 'The Dynamics checklist must never be eagerly warmed.');
for (const app of manifest.apps.filter(app => app.id !== 'contact-center-checklist')) assert.strictEqual(app.preload, true, `${app.name} should be explicitly eligible for startup warming.`);
assert(!/fetch\s*\(\s*["']apps\.json/i.test(desktopHtml), 'Direct-file startup should keep using the generated JavaScript manifest.');
assert(desktopHtml.includes('id="globalScopeSelect"'), 'The desktop should expose one global person scope selector.');
assert(storageScript.includes("const SCOPE_KEY = 'coachtools.scope.v1'"), 'The global scope should retain a stable persisted storage key.');
assert(/function setScope\(scope\)[\s\S]*?safeSet\(SCOPE_KEY/.test(storageScript), 'Changing scope should persist the selection.');
assert(storageScript.includes('subscribeScope'), 'Applications should be able to subscribe to global scope changes.');
assert(desktopScript.includes("type: 'coachtools:scope-updated'"), 'The desktop should relay scope changes to open applications.');
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
