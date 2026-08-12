#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPS_DIR = path.join(ROOT, 'apps');
const JSON_PATH = path.join(ROOT, 'apps.json');
const JS_PATH = path.join(ROOT, 'apps-manifest.js');
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const refreshMetadata = args.has('--refresh-metadata');

function posix(filePath) {
  return filePath.split(path.sep).join('/');
}

function slug(value) {
  return String(value || '')
    .replace(/\.html?$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'application';
}

function titleCase(value) {
  return String(value || '')
    .replace(/\.html?$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
    .trim();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return result;
}

function metadata(html) {
  const result = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (!attrs.name?.toLowerCase().startsWith('coachtools-')) continue;
    result[attrs.name.slice('coachtools-'.length).toLowerCase()] = attrs.content || '';
  }
  return result;
}

function bool(value, fallback) {
  if (value == null || value === '') return fallback;
  return !/^(false|0|no|off)$/i.test(String(value));
}

function list(value, fallback) {
  if (value == null || value === '') return Array.isArray(fallback) ? fallback : [];
  return String(value).split(/[,|]/).map(item => item.trim()).filter(Boolean);
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'dist' || entry.name === 'node_modules') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile() && /\.html?$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function existingManifest() {
  if (!fs.existsSync(JSON_PATH)) return { schemaVersion: 1, suite: {}, apps: [] };
  try { return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')); }
  catch (error) { throw new Error(`Cannot preserve apps.json metadata because it is invalid JSON: ${error.message}`); }
}

const existing = existingManifest();
const existingById = new Map((existing.apps || []).map(app => [app.id, app]));
const candidates = [];
const excluded = [];
const allHtmlFiles = walk(APPS_DIR);

for (const file of allHtmlFiles) {
  const relativeFromApps = posix(path.relative(APPS_DIR, file));
  const parts = relativeFromApps.split('/');
  const html = fs.readFileSync(file, 'utf8');
  const meta = metadata(html);
  const isTopLevel = parts.length === 1;
  const isDirectoryIndex = parts.length === 2 && /^index\.html?$/i.test(parts[1]);
  const explicitlyInstalled = bool(meta.app, false);
  const hasCoachToolsMetadata = Object.keys(meta).length > 0;
  if (!isTopLevel && !isDirectoryIndex && !explicitlyInstalled && !hasCoachToolsMetadata) { excluded.push({ path: relativeFromApps, reason: 'nested support HTML without coachtools metadata' }); continue; }
  if (bool(meta.hidden, false)) { excluded.push({ path: relativeFromApps, reason: 'coachtools-hidden metadata' }); continue; }
  candidates.push({ file, relativeFromApps, html, meta });
}

const discovered = candidates.map((item, index) => {
  const fallbackFileName = path.basename(item.file);
  const fallbackId = slug(item.meta.id || (item.relativeFromApps.includes('/') ? path.dirname(item.relativeFromApps) : fallbackFileName));
  const prior = existingById.get(fallbackId) || {};
  const title = decodeEntities((item.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const pick = (key, metaValue, fallback) => {
    if (!refreshMetadata && Object.prototype.hasOwnProperty.call(prior, key)) return prior[key];
    if (metaValue != null && metaValue !== '') return metaValue;
    if (Object.prototype.hasOwnProperty.call(prior, key)) return prior[key];
    return fallback;
  };
  const file = `apps/${item.relativeFromApps}`;
  const defaultNameSource = /^index\.html?$/i.test(fallbackFileName) ? path.basename(path.dirname(item.file)) : fallbackFileName;
  const name = pick('name', item.meta.name, title || titleCase(defaultNameSource));
  const favorite = bool(pick('favorite', item.meta.favorite, false), false);
  const featured = bool(pick('featured', item.meta.featured, false), false);
  const enabled = bool(pick('enabled', item.meta.enabled, true), true);
  return {
    id: fallbackId,
    name,
    description: pick('description', item.meta.description, `Open ${name}.`),
    file,
    icon: pick('icon', item.meta.icon, 'icons/default-app.png'),
    initials: pick('initials', item.meta.initials, ''),
    category: pick('category', item.meta.category, 'Other'),
    keywords: list(pick('keywords', item.meta.keywords, []), []),
    data: list(pick('data', item.meta.data, []), []),
    favorite,
    featured,
    order: Number(pick('order', item.meta.order, (index + 1) * 10)) || (index + 1) * 10,
    version: String(pick('version', item.meta.version, '1.0')),
    enabled
  };
}).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

if (!discovered.length) throw new Error('No installed HTML applications were discovered under apps/.');

const errors = [];
const duplicateCheck = (items, field, label) => {
  const seen = new Map();
  for (const item of items) {
    const value = item && item[field];
    if (!value) continue;
    if (seen.has(value)) errors.push(`Duplicate ${label} ${value}: ${seen.get(value)} and ${item.file || item.path || item.id}`);
    else seen.set(value, item.file || item.path || item.id);
  }
};
duplicateCheck(discovered, 'id', 'application id');
duplicateCheck(discovered, 'file', 'application path');
duplicateCheck(existing.apps || [], 'id', 'id in existing manifest');
duplicateCheck(existing.apps || [], 'file', 'path in existing manifest');
for (const app of existing.apps || []) {
  if (app.file && !fs.existsSync(path.join(ROOT, app.file))) errors.push(`Manifest entry ${app.id || '(missing id)'} points to missing file ${app.file}.`);
}
const discoveredPaths = new Set(discovered.map(app => app.file.replace(/^apps\//, '')));
for (const item of candidates) if (!discoveredPaths.has(item.relativeFromApps)) errors.push(`HTML application was unexpectedly excluded: apps/${item.relativeFromApps}.`);
if (errors.length) throw new Error(`Application manifest validation failed:\n- ${errors.join('\n- ')}`);

const manifest = {
  schemaVersion: 1,
  suite: {
    name: existing.suite?.name || 'CoachTools',
    subtitle: existing.suite?.subtitle || 'All-Star Coaching Intelligence',
    description: existing.suite?.description || 'A portable desktop for coaching analytics and reporting.',
    version: existing.suite?.version || '1.0',
    storageContract: existing.suite?.storageContract || 'docs/STORAGE-CONTRACT.md'
  },
  apps: discovered
};

const json = JSON.stringify(manifest, null, 2) + '\n';
const javascript = `/* Generated by build/generate-app-manifest.js. */\nwindow.COACHTOOLS_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`;

function checkFile(filePath, expected) {
  return fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === expected;
}

if (checkOnly) {
  const jsonCurrent = checkFile(JSON_PATH, json);
  const jsCurrent = checkFile(JS_PATH, javascript);
  if (!jsonCurrent || !jsCurrent) {
    console.error('Manifest files are out of date. Run: node build/generate-app-manifest.js');
    process.exit(1);
  }
  console.log(`Manifest is current: ${discovered.length} applications. ${excluded.length} nested support file${excluded.length === 1 ? '' : 's'} intentionally excluded.`);
} else {
  fs.writeFileSync(JSON_PATH, json, 'utf8');
  fs.writeFileSync(JS_PATH, javascript, 'utf8');
  console.log(`Generated apps.json and apps-manifest.js for ${discovered.length} applications. ${excluded.length} nested support file${excluded.length === 1 ? '' : 's'} intentionally excluded.`);
}
