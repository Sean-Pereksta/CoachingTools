'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const { window, document } = parseHTML('<html><body><div id="appGrid"></div></body></html>');
const grid = document.getElementById('appGrid');
const observers = [];
class Observer {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe() {}
  disconnect() {}
}
function tile(id) {
  const node = document.createElement('button');
  node.dataset.appId = id;
  node.textContent = id;
  return node;
}
grid.append(tile('allstar'), tile('verification-all-star'), tile('weekly-data'));
window.COACHTOOLS_MANIFEST = { apps: ['allstar', 'verification-all-star', 'weekly-data'].map(id => ({ id, enabled: true })) };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/coachtools-folders.js'), 'utf8'), {
  window, document, MutationObserver: Observer
});
document.dispatchEvent(new window.Event('DOMContentLoaded'));

const folder = () => grid.querySelector('[data-folder-id="all-star-tools"]');
const folderGrid = document.querySelector('[data-folder-grid="all-star-tools"]');
assert.ok(folder(), 'The home page shows the All Star Tools folder.');
assert.match(folder().textContent, /\(2\) All Star Tools/);
assert.deepEqual([...folderGrid.querySelectorAll('[data-app-id]')].map(n => n.dataset.appId), ['allstar', 'verification-all-star']);
assert.equal(grid.querySelector('[data-app-id="allstar"]'), null, 'All-Star Report moves into the folder.');
assert.ok(grid.querySelector('[data-app-id="weekly-data"]'), 'Unrelated home-page tools stay in place.');

const keyboard = new window.Event('keydown');
keyboard.key = 'Enter';
folder().dispatchEvent(keyboard);
assert.ok(document.querySelector('dialog[data-folder-id="all-star-tools"]').hasAttribute('open'), 'Enter opens the folder.');

// Desktop search rebuilds the app grid from matching apps. The folder must keep
// the matching tool reachable and correctly update its visible count.
grid.replaceChildren(tile('verification-all-star'));
observers[0].callback();
assert.match(folder().textContent, /\(1\) All Star Tools/);
assert.deepEqual([...folderGrid.querySelectorAll('[data-app-id]')].map(n => n.dataset.appId), ['verification-all-star']);
for (const icon of ['all-star-tools.png', 'verification-all-star.png']) {
  const bytes = fs.readFileSync(path.join(__dirname, '../icons', icon));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG', `${icon} is a bundled PNG asset.`);
}
console.log('All Star Tools folder navigation tests passed.');
