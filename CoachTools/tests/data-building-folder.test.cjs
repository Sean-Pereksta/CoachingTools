'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

test('Data Building keeps both builders reachable after desktop search rebuilds', () => {
  const { window, document } = parseHTML('<html><body><div id="appGrid"></div></body></html>');
  const grid = document.getElementById('appGrid');
  const observers = [], launches = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  }
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const element = createElement(tag);
    if (tag === 'dialog') {
      Object.defineProperty(element, 'open', { get: () => element.hasAttribute('open') });
      element.showModal = () => element.setAttribute('open', '');
      element.close = () => element.removeAttribute('open');
    }
    return element;
  };
  function tile(id) {
    const node = document.createElement('button');
    node.dataset.appId = id;
    const label = document.createElement('span');
    label.textContent = id;
    node.append(label);
    node.addEventListener('click', () => launches.push(id));
    return node;
  }
  grid.append(tile('weekly-data-builder'), tile('qa-eval-builder'), tile('weekly-data'));
  window.COACHTOOLS_MANIFEST = {
    apps: ['weekly-data-builder', 'qa-eval-builder', 'weekly-data'].map(id => ({ id, enabled: true }))
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/coachtools-folders.js'), 'utf8'), {
    window, document, MutationObserver: Observer
  });
  document.dispatchEvent(new window.Event('DOMContentLoaded'));

  const folder = () => grid.querySelector('[data-folder-id="data-building"]');
  const dialog = document.querySelector('dialog[data-folder-id="data-building"]');
  const folderGrid = document.querySelector('[data-folder-grid="data-building"]');
  const members = () => [...folderGrid.querySelectorAll('[data-app-id]')].map(node => node.dataset.appId);
  assert.ok(folder(), 'The desktop offers the Data Building folder.');
  assert.match(folder().getAttribute('aria-label'), /Data Building, 2 tools/);
  assert.deepEqual(members(), ['weekly-data-builder', 'qa-eval-builder']);
  assert.equal(grid.querySelector('[data-app-id="qa-eval-builder"]'), null);
  assert.ok(grid.querySelector('[data-app-id="weekly-data"]'), 'Unrelated tools remain on the desktop.');

  folder().click();
  assert.equal(dialog.open, true, 'Clicking the folder opens its contents.');
  folderGrid.querySelector('[data-app-id="qa-eval-builder"] span').click();
  assert.deepEqual(launches, ['qa-eval-builder'], 'Moving an app into a folder preserves its launch action.');
  assert.equal(dialog.open, false, 'Launching a tool closes the folder.');

  grid.replaceChildren(tile('weekly-data-builder'));
  observers[0].callback();
  assert.deepEqual(members(), ['weekly-data-builder']);
  assert.match(folder().getAttribute('aria-label'), /Data Building, 1 tools/);
  const keyboard = new window.Event('keydown');
  keyboard.key = 'Enter';
  folder().dispatchEvent(keyboard);
  assert.equal(dialog.open, true, 'The filtered folder remains keyboard accessible.');
  folderGrid.querySelector('[data-app-id="weekly-data-builder"]').click();
  assert.deepEqual(launches, ['qa-eval-builder', 'weekly-data-builder']);

  grid.replaceChildren(tile('qa-eval-builder'));
  observers[0].callback();
  assert.deepEqual(members(), ['qa-eval-builder'], 'A later search replaces the previous search results.');
  folder().click();
  grid.replaceChildren(tile('weekly-data'));
  observers[0].callback();
  assert.equal(folder(), null, 'Searches with no builders omit the folder.');
  assert.deepEqual(members(), []);
  assert.equal(dialog.open, false, 'An empty folder does not remain open.');
});
