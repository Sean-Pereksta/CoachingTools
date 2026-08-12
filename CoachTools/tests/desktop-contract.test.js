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
assert(desktopHtml.includes('id="startupSplash"'), 'A startup readiness bar should be present before the desktop opens.');
for (const script of ['vendor/xlsx.full.min.js', 'vendor/lz-string.min.js', 'shared/coachtools-storage.js', 'shared/coachtools-import.js']) {
  assert(new RegExp(`<script[^>]+src=["']${script.replace(/\./g, '\\.')}["'][^>]*defer`).test(desktopHtml), `${script} should defer so the startup bar can paint immediately.`);
}
assert(desktopScript.includes("image.src = 'graphics/background.png'"), 'The main wallpaper should load from graphics/background.png.');
assert(/\.desktop-wallpaper\s*\{[\s\S]*?z-index:\s*0;/.test(desktopStyles), 'The wallpaper must render above the body background instead of behind the page canvas.');
assert(/\.desktop-shade\s*\{[\s\S]*?z-index:\s*1;/.test(desktopStyles), 'The readability shade should render directly above the wallpaper.');
assert(/\.desktop-shell\s*\{[\s\S]*?z-index:\s*2;/.test(desktopStyles), 'Desktop controls should render above the wallpaper and shade.');
assert(desktopScript.includes('runStartupSequence'), 'Desktop startup should coordinate readiness and automatic loading.');
assert(desktopScript.includes("scanStorage({ startup: true })"), 'Startup should safely attempt to load missing data from storage.');
assert(desktopScript.indexOf('await scanStorage({ startup: true })') < desktopScript.lastIndexOf('restoreOpenWindows();'), 'Remembered app sessions should restore after the startup data check.');
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
assert.strictEqual(imports.classifyFile({ name: 'All Items 8-11.xlsx' }, parsed('All Items 8-11.xlsx', [['Coach Assigned', 'Associate Name', 'Action']])).id, 'checklist');
assert.strictEqual(imports.classifyFile({ name: 'Documented Coaching.csv' }, parsed('Documented Coaching.csv', [['Job Coach', 'Associate Name', 'Coaching Date']])).id, 'documentedCoaching');
assert.strictEqual(imports.classifyFile({ name: 'mystery.xlsx' }, parsed('mystery.xlsx', [['Team', 'Score %'], ['Coach A', 0.9]])).id, 'qa');
assert.strictEqual(imports.classifyFile({ name: 'QA.xlsx' }, parsed('QA.xlsx', [['Team']])).needsReview, true);

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
