'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps.json'), 'utf8'));
const folderSource = fs.readFileSync(path.join(root, 'shared/coachtools-folders.js'), 'utf8');
const folderIcons = [...folderSource.matchAll(/icon:'([^']+)'/g)].map(m => m[1]);
const systems = ['coachtools-home', 'start', 'shared-data', 'backup-restore', 'settings', 'all-apps', 'default-app', 'update-data', 'clean-upload', 'submit-feedback'];
const paths = new Set([...manifest.apps.map(a => a.icon), ...folderIcons, ...systems.map(id => `icons/horizon/${id}.png`)]);
assert.equal(paths.size, 31, 'All app, folder, system, data-action, and feedback roles have Horizon artwork.');
for (const file of paths) {
  assert.match(file, /^icons\/horizon\/[\w-]+\.png$/);
  const png = fs.readFileSync(path.join(root, file));
  assert.equal(png.subarray(1,4).toString(), 'PNG', `${file} is an actual PNG image.`);
  assert.equal(png.readUInt32BE(16), 512, `${file} is 512 pixels wide.`);
  assert.equal(png.readUInt32BE(20), 512, `${file} is 512 pixels high.`);
  assert.ok(png.length > 10000, `${file} contains the rendered artwork.`);
}
for (const app of manifest.apps) {
  const source = fs.readFileSync(path.join(root, app.file), 'utf8');
  assert.ok(source.includes(`content="${app.icon}"`), `${app.id} metadata matches the manifest icon.`);
}
const home=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.match(home,/class="horizon-brand-image" src="graphics\/horizon-logo\.png"/,'The top-left brand uses the new raster wordmark.');
const logo=fs.readFileSync(path.join(root,'graphics/horizon-logo.png'));
assert.equal(logo.subarray(1,4).toString(),'PNG');
assert.ok(logo.readUInt32BE(16)>logo.readUInt32BE(20)*2,'The brand lockup is a wide logo image.');
assert.match(home,/horizon-update[\s\S]*?icons\/horizon\/update-data\.png/);
assert.match(home,/horizon-clean[\s\S]*?icons\/horizon\/clean-upload\.png/);
console.log('Horizon icon family contract tests passed (31 roles).');
