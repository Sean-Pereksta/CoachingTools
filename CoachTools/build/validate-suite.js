#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];

function relative(filePath) { return path.relative(ROOT, filePath).split(path.sep).join('/'); }
function exists(filePath) { return fs.existsSync(path.join(ROOT, filePath)); }
function isDirectory(filePath) { return exists(filePath) && fs.statSync(path.join(ROOT, filePath)).isDirectory(); }
function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function validateInlineScripts(filePath, html) {
  let index = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    index += 1;
    const attrs = match[1] || '';
    const code = match[2] || '';
    if (/\bsrc\s*=/i.test(attrs) || !code.trim()) continue;
    const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || 'text/javascript';
    if (!/(?:java|ecma)script|module/i.test(type)) continue;
    try { new vm.Script(code, { filename: `${relative(filePath)}#inline-${index}` }); }
    catch (error) { fail(`${relative(filePath)}: inline script ${index} does not parse: ${error.message}`); }
  }
}

const required = [
  'index.html',
  'apps.json',
  'apps-manifest.js',
  'README.md',
  'graphics/background.png',
  'graphics/loading.png',
  'shared/coachtools-storage.js',
  'shared/coachtools-app-data.js',
  'shared/coachtools-dependencies.js',
  'shared/coachtools-performance.js',
  'shared/coachtools-sync.js',
  'shared/coachtools-identity.js',
  'shared/coachtools-profile-data.js',
  'shared/coachtools-import.js',
  'shared/coachtools-shell.js',
  'shared/coachtools-theme.css',
  'shared/coachtools-desktop.js',
  'docs/STORAGE-CONTRACT.md',
  'docs/APP-MANIFEST.md'
];
for (const file of required) if (!exists(file)) fail(`Missing required suite file: ${file}`);
for (const directory of ['graphics', 'storage']) if (!isDirectory(directory)) fail(`Missing required suite directory: ${directory}/`);
for (const asset of ['graphics/background.png', 'graphics/loading.png']) {
  if (exists(asset) && !fs.statSync(path.join(ROOT, asset)).isFile()) fail(`${asset} must be a file.`);
}
for (const icon of ['coachtools-home.png', 'shared-data.png', 'backup-restore.png', 'settings.png']) {
  if (!exists(`icons/${icon}`)) fail(`Missing desktop control icon: icons/${icon}`);
}
for (const icon of ['all-apps.png', 'default-app.png']) {
  if (!exists(`icons/${icon}`)) warn(`icons/${icon} is not present; the built-in symbol fallback will be used.`);
}

let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps.json'), 'utf8')); }
catch (error) { fail(`apps.json is invalid: ${error.message}`); }

if (manifest) {
  if (Number(manifest.schemaVersion) !== 1) fail(`Unsupported manifest schema: ${manifest.schemaVersion}`);
  const ids = new Set();
  const files = new Set();
  const validData = new Set(['weeklyRetail', 'weeklyReferral', 'monthlyRetail', 'monthlyReferral', 'qa', 'documentedCoaching', 'checklist', 'compCoaching', 'retail', 'referral', 'coaching']);
  for (const app of manifest.apps || []) {
    if (!app.id) fail('An application is missing its id.');
    if (ids.has(app.id)) fail(`Duplicate application id: ${app.id}`);
    ids.add(app.id);
    if (!app.file || !/\.html?$/i.test(app.file)) fail(`${app.id}: invalid HTML file path.`);
    if (files.has(app.file)) fail(`Duplicate application file: ${app.file}`);
    files.add(app.file);
    if (!exists(app.file)) fail(`${app.id}: missing HTML file ${app.file}`);
    if (/^(?:[a-z]+:|\/|\\)/i.test(app.file)) fail(`${app.id}: application path must be relative: ${app.file}`);
    if (app.icon && /^(?:[a-z]+:|\/|\\)/i.test(app.icon)) fail(`${app.id}: icon path must be relative: ${app.icon}`);
    if (app.icon && !exists(app.icon)) warn(`${app.id}: ${app.icon} is not present; the CSS initials fallback will be used.`);
    if (app.preload != null && typeof app.preload !== 'boolean') fail(`${app.id}: preload must be true or false when provided.`);
    for (const source of app.data || []) if (!validData.has(source)) fail(`${app.id}: unknown data requirement ${source}`);
  }
  if ((manifest.apps || []).length < 7) fail(`Expected at least 7 applications, found ${(manifest.apps || []).length}.`);
  for (const requiredApp of ['contact-center-checklist', 'people-profiles']) if (!(manifest.apps || []).some(app => app.id === requiredApp)) fail(`Required desktop application is missing from the manifest: ${requiredApp}`);
  const dynamicsChecklist = (manifest.apps || []).find(app => app.id === 'contact-center-checklist');
  if (dynamicsChecklist && dynamicsChecklist.preload !== false) fail('contact-center-checklist must remain lazy-loaded so startup does not contact Dynamics.');
  const blockingPreloads = (manifest.apps || []).filter(app => app.preload === true);
  if (blockingPreloads.length) fail(`Applications must be lazy-loaded; preload:true remains on ${blockingPreloads.map(app => app.id).join(', ')}.`);
}

const vendorFiles = [
  'vendor/xlsx.full.min.js',
  'vendor/lz-string.min.js',
  'vendor/chart.umd.js',
  'vendor/html2canvas.min.js',
  'vendor/jspdf.umd.min.js',
  'vendor/html2pdf.bundle.min.js',
  'vendor/jszip.min.js'
];
for (const file of vendorFiles) if (!exists(file)) fail(`Missing vendored browser dependency: ${file}`);

const expectedMarkers = {
  'allstar': ['id="runBtn"', 'id="packagedFile"', 'js/core.js'],
  'weekly-data': ['id="btnImportMany"', 'id="btnGenerate"', 'IMPORT.SOURCES'],
  'coaching-gaps': ['gaps.prefs', 'CoachToolsAppData', 'weeklyRetail', 'weeklyReferral', 'documentedCoaching', 'checklist', 'qa'],
  'coach-timeline': ['coachSpeed.columnMap', 'CoachToolsAppData', 'checklist', 'documentedCoaching'],
  'kpi-impact': ['impactTool.activeTab', 'CoachToolsAppData', 'weeklyRetail', 'weeklyReferral', 'documentedCoaching'],
  'qa-scores': ['qaOnlyDash.settings.v6', 'CoachToolsAppData', 'qa', 'documentedCoaching'],
  'audit-checklist': ['CoachToolsAppData', 'checklist', 'documentedCoaching'],
  'people-profiles': ['CoachToolsIdentity', 'CoachToolsProfiles', 'CoachToolsAppData', 'Set as CoachTools Scope'],
  'contact-center-checklist': ['data-coachtools-remote-app="true"']
};

if (manifest) {
  for (const app of manifest.apps || []) {
    if (!exists(app.file)) continue;
    const filePath = path.join(ROOT, app.file);
    const html = fs.readFileSync(filePath, 'utf8');
    validateInlineScripts(filePath, html);
    if (/\/(?:workspace|mnt\/data)\/|[A-Z]:\\Users\\/i.test(html)) fail(`${app.file}: contains an absolute developer-machine path.`);
    for (const marker of expectedMarkers[app.id] || []) if (!html.includes(marker)) fail(`${app.id}: expected capability marker is missing: ${marker}`);
    if (['coaching-gaps', 'coach-timeline', 'kpi-impact', 'qa-scores', 'audit-checklist'].includes(app.id)) {
      if (!html.includes('../shared/coachtools-import.js')) fail(`${app.id}: must route spreadsheet uploads through the shared classifier.`);
      if (!html.includes('../shared/coachtools-app-data.js')) fail(`${app.id}: must load the shared IndexedDB application adapter.`);
      if (/getByCompatibilityKey|listCompatibilityKeys|CoachToolsStorage\.(?:getRetail|getReferral|getQA|getCoaching|getChecklist)|\.dock\./.test(html)) fail(`${app.id}: still contains a legacy compatibility-dock reader.`);
    }
    if ((app.data || []).length) {
      if (!html.includes('CoachToolsAppData')) fail(`${app.id}: declares shared datasets but does not use CoachToolsAppData.`);
      for (const datasetType of app.data) if (!html.includes(datasetType)) fail(`${app.id}: manifest requires ${datasetType}, but the app does not declare it to the shared adapter.`);
    }
    const dependencies = [...html.matchAll(/<(script|link|iframe)\b([^>]*?)\b(?:src|href|data-src)=(?:"([^"]+)"|'([^']+)')([^>]*)>/gi)].map(match => ({
      tag: match[1].toLowerCase(),
      attributes: `${match[2] || ''} ${match[5] || ''}`,
      target: match[3] || match[4]
    }));
    for (const dependency of dependencies) {
      const { tag, attributes, target } = dependency;
      if (!target || /^(?:https?:|data:|blob:|about:|#)/i.test(target)) {
        const approvedRemoteApp = tag === 'iframe' && /\bdata-coachtools-remote-app\s*=\s*["']true["']/i.test(attributes);
        if (/^https?:/i.test(target) && !approvedRemoteApp) fail(`${app.file}: active runtime dependency is still remote: ${target}`);
        continue;
      }
      const clean = target.split(/[?#]/)[0];
      const resolved = path.resolve(path.dirname(filePath), clean);
      if (!fs.existsSync(resolved)) fail(`${app.file}: missing relative runtime dependency ${target}`);
      if (!resolved.startsWith(ROOT + path.sep)) fail(`${app.file}: runtime dependency escapes CoachTools: ${target}`);
    }
  }
}

for (const supportFile of ['apps/allstar/qualtrics/generator.html']) {
  if (!exists(supportFile)) fail(`Missing support application file: ${supportFile}`);
  else validateInlineScripts(path.join(ROOT, supportFile), fs.readFileSync(path.join(ROOT, supportFile), 'utf8'));
}
for (const supportFile of ['apps/allstar/qualtrics/individual-messages.js', 'apps/allstar/qualtrics/individual-ui.js']) {
  if (!exists(supportFile)) fail(`Missing support application file: ${supportFile}`);
  else {
    try { new Function(fs.readFileSync(path.join(ROOT, supportFile), 'utf8')); }
    catch (error) { fail(`${supportFile}: JavaScript parse failed: ${error.message}`); }
  }
}

const index = exists('index.html') ? fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') : '';
if (!index.includes('apps-manifest.js')) fail('index.html must load the file://-safe JavaScript manifest.');
if (!index.includes('shared/coachtools-import.js')) fail('index.html must load the shared Weekly Data importer.');
for (const script of ['shared/coachtools-sync.js', 'shared/coachtools-identity.js']) if (!index.includes(script)) fail(`index.html must load ${script}.`);
for (const script of ['shared/coachtools-dependencies.js', 'shared/coachtools-performance.js', 'shared/coachtools-app-data.js']) if (!index.includes(script)) fail(`index.html must load ${script}.`);
if (index.includes('vendor/xlsx.full.min.js')) fail('index.html must not load SheetJS on the desktop critical path.');
if (!index.includes('id="globalScopeSelect"')) fail('index.html must expose the global CoachTools scope selector.');
for (const marker of ['id="startupSplash"', 'id="startupProgressFill"', 'id="startupDatasets"']) {
  if (!index.includes(marker)) fail(`index.html is missing startup readiness marker ${marker}.`);
}
if (!/<link\b[^>]*rel=["']preload["'][^>]*href=["']graphics\/loading\.png["'][^>]*>/i.test(index)) fail('index.html must preload graphics/loading.png before deferred startup scripts.');
if (index.includes('startup-card')) fail('The startup screen must not use the retired popup-style startup-card.');
if (/fetch\s*\(\s*["']apps\.json/i.test(index)) fail('index.html must not require fetch(apps.json) for local-file startup.');
const desktopScript = exists('shared/coachtools-desktop.js') ? fs.readFileSync(path.join(ROOT, 'shared/coachtools-desktop.js'), 'utf8') : '';
if (!desktopScript.includes('const openWindows = new Map()')) fail('Desktop must retain one live window state per opened application.');
if (!desktopScript.includes('iframe.src = app.file')) fail('Desktop app opening must use direct iframe navigation.');
if (!desktopScript.includes('coachtools.desktop.openApps.v1')) fail('Desktop must persist the lightweight open-application list.');
if (!desktopScript.includes("fetch('/api/storage'")) fail('Desktop must use the constrained local storage API for automatic loading.');
if (!desktopScript.includes('runStartupSequence')) fail('Desktop must coordinate metadata readiness before revealing remembered sessions.');
for (const marker of ['preloadDesktopAssets', 'desktopAssetPaths', 'ICON_PRELOAD_CONCURRENCY', 'ICON_PRELOAD_TIMEOUT_MS']) {
  if (!desktopScript.includes(marker)) fail(`Desktop icon startup is missing ${marker}.`);
}
if (!desktopScript.includes("image.src = 'graphics/background.png'")) fail('Desktop wallpaper path must remain graphics/background.png.');
for (const marker of ['createDeferredWindow', 'deferred: true', 'restoreOpenWindows', 'dismissStartupSplash()', 'scanStorage({ startup: true, background: true })']) {
  if (!desktopScript.includes(marker)) fail(`Desktop-first lazy startup is missing ${marker}.`);
}
for (const retired of ['warmApplications', 'WARMUP_CONCURRENCY', 'app.preload === true', 'await state.wallpaperReady']) {
  if (desktopScript.includes(retired)) fail(`Desktop still contains retired blocking startup behavior: ${retired}.`);
}
if (!(desktopScript.indexOf('dismissStartupSplash()') < desktopScript.indexOf('scanStorage({ startup: true, background: true })'))) fail('The desktop must be visible before background storage synchronization starts.');
if (!desktopScript.includes('STORAGE_FILES_KEY') || !desktopScript.includes('isStorageFileUnchanged') || !desktopScript.includes('no spreadsheets downloaded')) fail('Storage synchronization must skip unchanged spreadsheet bodies using lightweight file metadata.');
const desktopStyles = exists('shared/coachtools-theme.css') ? fs.readFileSync(path.join(ROOT, 'shared/coachtools-theme.css'), 'utf8') : '';
if (!/\.startup-splash\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?url\(["']?\.\.\/graphics\/loading\.png["']?\)[\s\S]*?background-size:\s*cover;/.test(desktopStyles)) fail('Startup splash must fill the viewport with graphics/loading.png using background-size: cover.');
if (desktopStyles.includes('.startup-card')) fail('Desktop styles must not retain the popup-style startup-card.');
if (!/\.desktop-wallpaper\s*\{[\s\S]*?z-index:\s*0;/.test(desktopStyles)) fail('Desktop wallpaper must render above the body background at z-index 0.');
if (!/\.desktop-shade\s*\{[\s\S]*?z-index:\s*1;/.test(desktopStyles)) fail('Desktop shade must render above the wallpaper at z-index 1.');
if (!/\.desktop-shell\s*\{[\s\S]*?z-index:\s*2;/.test(desktopStyles)) fail('Desktop shell must render above the wallpaper layers at z-index 2.');

const importerScript = exists('shared/coachtools-import.js') ? fs.readFileSync(path.join(ROOT, 'shared/coachtools-import.js'), 'utf8') : '';
for (const marker of ['classifyFile', 'prepareDataset', 'packDataset', 'weeklyRetail', 'weeklyReferral', 'validateClassification', 'detectPeriod', 'myone2.dock.retail', 'myone2.dock.checklist']) {
  if (!importerScript.includes(marker)) fail(`Shared importer is missing capability marker ${marker}`);
}
try { if (importerScript) new vm.Script(importerScript, { filename: 'shared/coachtools-import.js' }); }
catch (error) { fail(`shared/coachtools-import.js does not parse: ${error.message}`); }
try { if (desktopScript) new vm.Script(desktopScript, { filename: 'shared/coachtools-desktop.js' }); }
catch (error) { fail(`shared/coachtools-desktop.js does not parse: ${error.message}`); }
for (const sharedFile of ['shared/coachtools-app-data.js', 'shared/coachtools-dependencies.js', 'shared/coachtools-performance.js']) {
  const source = exists(sharedFile) ? fs.readFileSync(path.join(ROOT, sharedFile), 'utf8') : '';
  try { if (source) new vm.Script(source, { filename: sharedFile }); }
  catch (error) { fail(`${sharedFile} does not parse: ${error.message}`); }
}
const appDataScript = exists('shared/coachtools-app-data.js') ? fs.readFileSync(path.join(ROOT, 'shared/coachtools-app-data.js'), 'utf8') : '';
for (const marker of ['getMany', 'getManyProgressive', 'loadForApp', 'getVersion', 'subscribe', 'trackedVersions', 'pendingReads', 'cache.delete', 'requestAnimationFrame']) if (!appDataScript.includes(marker)) fail(`Shared app data adapter is missing ${marker}.`);

const weeklyData = exists('apps/weekly-data.html') ? fs.readFileSync(path.join(ROOT, 'apps/weekly-data.html'), 'utf8') : '';
if (!weeklyData.includes('../shared/coachtools-import.js') || !weeklyData.includes('IMPORT.classifyFile')) fail('Weekly Data must reuse the shared import and classification utility.');
for (const marker of ['IMPORT.DATASET_ORDER', 'storedStatus', 'CoachToolsData.importDataset', 'Load All Data Files']) {
  if (!weeklyData.includes(marker)) fail(`Data Manager is missing all-data import marker ${marker}.`);
}

const localServer = exists('build/start-local-server.js') ? fs.readFileSync(path.join(ROOT, 'build/start-local-server.js'), 'utf8') : '';
for (const marker of ["url.pathname === '/api/storage'", "path.join(ROOT, 'storage')", "new Set(['.xlsx', '.xls', '.csv'])", "rawPath.startsWith('/storage/')", "fileName.includes('/')", 'path: entry.name', 'fingerprint:']) {
  if (!localServer.includes(marker)) fail(`Local server storage endpoint is missing safety marker ${marker}`);
}
const packageScript = exists('build/package-suite.js') ? fs.readFileSync(path.join(ROOT, 'build/package-suite.js'), 'utf8') : '';
for (const directory of ['CoachTools/graphics/', 'CoachTools/storage/']) {
  if (!packageScript.includes(directory)) fail(`Package script must explicitly include ${directory}`);
}

const storageScript = exists('shared/coachtools-storage.js') ? fs.readFileSync(path.join(ROOT, 'shared/coachtools-storage.js'), 'utf8') : '';
for (const key of ['myone2.dock.retail', 'myone2.dock.referral', 'myone2.dock.qa', 'myone2.dock.coaching', 'myone2.dock.checklist']) {
  if (!storageScript.includes(key)) fail(`Shared storage helper is missing compatibility key ${key}`);
}
for (const marker of ['CoachToolsData', 'getCurrent', 'streamRows', 'getHistory', 'getDatasetVersion', 'getImportHistory', 'inspectDataset', 'subscribeScope', 'coachtoolsDatasets', 'coachtoolsDatasetChunks', 'coachtoolsCurrent', 'coachtoolsImports', 'coachtoolsPeople', "DB_VERSION = 8", 'datasetTypePeriodSortImportedAt']) {
  if (!storageScript.includes(marker)) fail(`Shared IndexedDB data API is missing ${marker}`);
}
if (!/function getDatasetStatus\(\)[\s\S]*?centralStatus\(\)\.map/.test(storageScript)) fail('Desktop readiness must report every central IndexedDB dataset.');
if (!storageScript.includes('const sourcePeriod = meta.detectedPeriod')) fail('IndexedDB candidate inspection must retain the detected source period.');
if (storageScript.includes('function loadCurrentData')) fail('IndexedDB startup must not hydrate every current dataset.');
if (!storageScript.includes('cacheCurrentRecord') || !storageScript.includes('metadataOnly')) fail('IndexedDB storage must expose metadata-first, on-demand record loading.');
if (!storageScript.includes('materializeLegacyCompatibility')) fail('Legacy docks must remain available only through the explicit compatibility bridge.');
for (const marker of ['quickDataInput', 'importSelectedFiles', 'saveRecognizedEntry']) if (!desktopScript.includes(marker)) fail(`Desktop rapid upload is missing ${marker}.`);
for (const sharedFile of ['shared/coachtools-sync.js', 'shared/coachtools-identity.js', 'shared/coachtools-profile-data.js']) {
  const source = exists(sharedFile) ? fs.readFileSync(path.join(ROOT, sharedFile), 'utf8') : '';
  try { if (source) new vm.Script(source, { filename: sharedFile }); }
  catch (error) { fail(`${sharedFile} does not parse: ${error.message}`); }
}

const allStarCore = exists('apps/allstar/js/core.js') ? fs.readFileSync(path.join(ROOT, 'apps/allstar/js/core.js'), 'utf8') : '';
for (const key of ['allStarStandaloneModels.v1', 'allStarResearchItems.v1', 'allStarResearchMetrics.v1', 'allStarResearchResultCache.v3', 'allStarOrgBuilder.v1', 'allStarRepAliases.v1', 'allStarRunSettings.v2']) {
  if (!allStarCore.includes(key)) fail(`All-Star persistence contract is missing ${key}`);
}
const allStarReports = exists('apps/allstar/js/reports.js') ? fs.readFileSync(path.join(ROOT, 'apps/allstar/js/reports.js'), 'utf8') : '';
if (!allStarReports.includes('allStarPdfOptions.v1')) fail('All-Star persistence contract is missing allStarPdfOptions.v1');

const manifestCheck = spawnSync(process.execPath, [path.join(__dirname, 'generate-app-manifest.js'), '--check'], { encoding: 'utf8' });
if (manifestCheck.status !== 0) fail((manifestCheck.stderr || manifestCheck.stdout || 'Manifest check failed.').trim());

for (const message of warnings) console.warn('WARN:', message);
if (errors.length) {
  for (const message of errors) console.error('ERROR:', message);
  console.error(`Validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'} and ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(`CoachTools validation passed: ${(manifest?.apps || []).length} apps, ${vendorFiles.length} vendored libraries, ${warnings.length} icon fallback warning${warnings.length === 1 ? '' : 's'}.`);
