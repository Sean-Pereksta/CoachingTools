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
  'shared/coachtools-storage.js',
  'shared/coachtools-shell.js',
  'shared/coachtools-theme.css',
  'shared/coachtools-desktop.js',
  'docs/STORAGE-CONTRACT.md',
  'docs/APP-MANIFEST.md'
];
for (const file of required) if (!exists(file)) fail(`Missing required suite file: ${file}`);

let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps.json'), 'utf8')); }
catch (error) { fail(`apps.json is invalid: ${error.message}`); }

if (manifest) {
  if (Number(manifest.schemaVersion) !== 1) fail(`Unsupported manifest schema: ${manifest.schemaVersion}`);
  const ids = new Set();
  const files = new Set();
  const validData = new Set(['retail', 'referral', 'qa', 'coaching', 'checklist']);
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
    for (const source of app.data || []) if (!validData.has(source)) fail(`${app.id}: unknown data requirement ${source}`);
  }
  if ((manifest.apps || []).length < 7) fail(`Expected at least 7 applications, found ${(manifest.apps || []).length}.`);
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
  'weekly-data': ['id="btnImportMany"', 'id="btnGenerate"', 'myone2.dock.retail'],
  'coaching-gaps': ['myone2', '.dock.coaching', '.dock.retail'],
  'coach-timeline': ['coachSpeed.columnMap', '.dock.checklist', '.dock.coaching'],
  'kpi-impact': ['impactTool.activeTab', '.dock.coaching'],
  'qa-scores': ['qaOnlyDash.settings.v6', '.dock.qa'],
  'audit-checklist': ['.dock.checklist', '.dock.coaching']
};

if (manifest) {
  for (const app of manifest.apps || []) {
    if (!exists(app.file)) continue;
    const filePath = path.join(ROOT, app.file);
    const html = fs.readFileSync(filePath, 'utf8');
    validateInlineScripts(filePath, html);
    if (/\/(?:workspace|mnt\/data)\/|[A-Z]:\\Users\\/i.test(html)) fail(`${app.file}: contains an absolute developer-machine path.`);
    for (const marker of expectedMarkers[app.id] || []) if (!html.includes(marker)) fail(`${app.id}: expected capability marker is missing: ${marker}`);
    const attributes = [...html.matchAll(/<(?:script|link|iframe)\b[^>]*?\b(?:src|href|data-src)=(?:"([^"]+)"|'([^']+)')/gi)].map(match => match[1] || match[2]);
    for (const target of attributes) {
      if (!target || /^(?:https?:|data:|blob:|about:|#)/i.test(target)) {
        if (/^https?:/i.test(target)) fail(`${app.file}: active runtime dependency is still remote: ${target}`);
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

const index = exists('index.html') ? fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') : '';
if (!index.includes('apps-manifest.js')) fail('index.html must load the file://-safe JavaScript manifest.');
if (/fetch\s*\(\s*["']apps\.json/i.test(index)) fail('index.html must not require fetch(apps.json) for local-file startup.');
const desktopScript = exists('shared/coachtools-desktop.js') ? fs.readFileSync(path.join(ROOT, 'shared/coachtools-desktop.js'), 'utf8') : '';
if (!desktopScript.includes('elements.appFrame.src = app.file')) fail('Desktop app opening must use direct iframe navigation.');

const storageScript = exists('shared/coachtools-storage.js') ? fs.readFileSync(path.join(ROOT, 'shared/coachtools-storage.js'), 'utf8') : '';
for (const key of ['myone2.dock.retail', 'myone2.dock.referral', 'myone2.dock.qa', 'myone2.dock.coaching', 'myone2.dock.checklist']) {
  if (!storageScript.includes(key)) fail(`Shared storage helper is missing compatibility key ${key}`);
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
