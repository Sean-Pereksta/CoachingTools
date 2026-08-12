#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'coachtools-manifest-'));

function write(relativePath, contents) {
  const target = path.join(fixture, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
}

function run(expectFailure = false) {
  try {
    execFileSync(process.execPath, [path.join(fixture, 'build', 'generate-app-manifest.js')], { cwd: fixture, stdio: 'pipe' });
    if (expectFailure) assert.fail('Manifest generation should have failed validation.');
    return '';
  } catch (error) {
    if (!expectFailure) throw error;
    return String(error.stderr || error.message || error);
  }
}

try {
  fs.mkdirSync(path.join(fixture, 'build'), { recursive: true });
  fs.copyFileSync(path.join(root, 'build', 'generate-app-manifest.js'), path.join(fixture, 'build', 'generate-app-manifest.js'));
  write('apps.json', JSON.stringify({ schemaVersion: 1, suite: { name: 'Fixture' }, apps: [] }, null, 2));
  write('apps/plain-tool.html', '<!doctype html><title>Plain Tool</title>');
  write('apps/people/index.html', '<!doctype html><title>People Directory</title>');
  write('apps/support/help.html', '<!doctype html><title>Support Fragment</title>');

  run();
  let manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'apps.json'), 'utf8'));
  assert.deepStrictEqual(manifest.apps.map(app => app.id).sort(), ['people', 'plain-tool']);
  assert(manifest.apps.every(app => app.icon === 'icons/default-app.png'), 'New apps should receive the default icon.');
  assert(manifest.apps.every(app => app.category === 'Other' && app.enabled), 'New apps should receive safe manifest defaults.');

  manifest.apps.push({ id: 'missing-app', file: 'apps/missing.html' });
  fs.writeFileSync(path.join(fixture, 'apps.json'), JSON.stringify(manifest, null, 2), 'utf8');
  assert(run(true).includes('points to missing file'), 'A manifest entry whose file disappeared should fail validation.');

  manifest.apps = manifest.apps.filter(app => app.id !== 'missing-app');
  fs.writeFileSync(path.join(fixture, 'apps.json'), JSON.stringify(manifest, null, 2), 'utf8');
  write('apps/duplicate-one.html', '<meta name="coachtools-id" content="same-id"><title>One</title>');
  write('apps/duplicate-two.html', '<meta name="coachtools-id" content="same-id"><title>Two</title>');
  assert(run(true).includes('Duplicate application id same-id'), 'Duplicate discovered app IDs should fail validation.');

  console.log('CoachTools automatic manifest discovery tests passed.');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
