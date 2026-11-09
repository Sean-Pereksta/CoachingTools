'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseHTML } = require('linkedom');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps.json'), 'utf8'));
const folderSource = fs.readFileSync(path.join(root, 'shared/coachtools-folders.js'), 'utf8');
const folderIcons = [...folderSource.matchAll(/icon:'([^']+)'/g)].map(m => m[1]);
const systems = ['coachtools-home', 'start', 'shared-data', 'backup-restore', 'settings', 'all-apps', 'default-app'];
const paths = new Set([...manifest.apps.map(a => a.icon), ...folderIcons, ...systems.map(id => `icons/horizon/${id}.png`)]);
assert.equal(paths.size, 26, 'All app, folder, and system roles have Horizon artwork.');
for (const file of paths) {
  assert.match(file, /^icons\/horizon\/[\w-]+\.png$/);
  const png = fs.readFileSync(path.join(root, file));
  assert.equal(png.subarray(1,4).toString(), 'PNG', `${file} is an actual PNG image.`);
  assert.equal(png.readUInt32BE(16), 512, `${file} is 512 pixels wide.`);
  assert.equal(png.readUInt32BE(20), 512, `${file} is 512 pixels high.`);
  const content = fs.readFileSync(path.join(root, file.replace(/\.png$/,'.svg')), 'utf8');
  const { document } = parseHTML(content);
  const svg = document.querySelector('svg');
  assert.ok(svg, `${file} has an SVG root.`);
  assert.equal(svg.getAttribute('viewBox'), '0 0 128 128');
  assert.ok(svg.querySelector('title')?.textContent, `${file} has an accessible title.`);
  assert.ok(svg.querySelectorAll('path').length > 0, `${file} has vector artwork.`);
  assert.doesNotMatch(content, /<(?:script|image|foreignObject)\b|(?:href|src)=|@import/i, `${file} is self-contained.`);
  for (const match of content.matchAll(/url\(#([^)]+)\)/g)) assert.ok(svg.querySelector(`[id="${match[1]}"]`), `${file} has no unresolved paint references.`);
}
for (const app of manifest.apps) {
  const source = fs.readFileSync(path.join(root, app.file), 'utf8');
  assert.ok(source.includes(`content="${app.icon}"`), `${app.id} metadata matches the manifest icon.`);
}
console.log('Horizon icon family contract tests passed (26 roles).');
