'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const source = fs.readFileSync(path.join(__dirname, '../shared/kpi-impact-table.js'), 'utf8');
function harness(saved = {}) {
  const { window: domWindow, document } = parseHTML('<html><body><div class="impactToolbar"><label class="sortWrap">Sort</label></div><div id="impactGrid"></div></body></html>');
  const window = { Event: domWindow.Event };
  const storage = new Map(Object.entries(saved));
  window.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };
  const context = vm.createContext({ window, document });
  vm.runInContext(source, context);
  const select = document.getElementById('impactLayout');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return [...this.options].find(option => option.selected)?.value || this.firstElementChild.value; },
    set(value) { for (const option of this.options) option.selected = option.value === value; }
  });
  return { window, document, storage, context, select, api: window.KpiImpactTable };
}

test('renders weighted KPI values and removal impact in percentage points without treating names as markup', () => {
  const h = harness();
  h.api.render([
    { rep:'<img src=x onerror=alert(1)>', apps:10, opps:40, repRate:.25, impact:.0123 },
    { rep:'Lift Rep', apps:90, opps:100, repRate:.9, impact:-.0234 },
    { rep:'Excluded Rep', isExcluded:true, apps:NaN, opps:NaN, repRate:NaN, impact:NaN }
  ]);
  const table = h.document.getElementById('impactTable');
  assert.equal(table.querySelectorAll('tbody tr').length, 3);
  assert.equal(table.querySelector('img'), null);
  assert.equal(table.querySelector('button').textContent, '<img src=x onerror=alert(1)>');
  const first = [...table.querySelectorAll('tbody tr')[0].querySelectorAll('td')];
  assert.equal(first[0].textContent, '25.0%');
  assert.equal(first[1].textContent, '10');
  assert.equal(first[2].textContent, '40');
  assert.equal(first[3].textContent, 'Drag 1.23 pp');
  assert.equal(table.querySelector('.impactTableLift').textContent, 'Lift 2.34 pp');
  assert.equal(table.querySelector('.impactTableExcluded input').checked, false);
});

test('keeps Cards/Table choice across renders and reloads, and initialization is idempotent', () => {
  const h = harness({ 'impactTool.layout.v1':'table' });
  assert.equal(h.document.getElementById('impactGrid').hidden, true);
  assert.equal(h.document.getElementById('impactTable').hidden, false);
  h.api.render([]);
  assert.equal(h.document.querySelector('tbody td').colSpan, 6);
  assert.match(h.document.querySelector('tbody').textContent, /No representatives/);
  h.select.value = 'cards';
  h.select.dispatchEvent(new h.window.Event('change'));
  assert.equal(h.storage.get('impactTool.layout.v1'), 'cards');
  assert.equal(h.document.getElementById('impactGrid').hidden, false);
  assert.equal(h.document.getElementById('impactTable').hidden, true);
  h.api.render([{ rep:'One', apps:1, opps:2, repRate:.5, impact:0 }]);
  h.api.init();
  vm.runInContext(source, h.context);
  assert.equal(h.document.querySelectorAll('#impactLayout').length, 1);
  assert.equal(h.document.querySelectorAll('#impactTable').length, 1);
  assert.equal(h.document.querySelector('#impactLayout').parentElement.nextElementSibling.className, 'sortWrap');
  const reloaded = harness(Object.fromEntries(h.storage));
  assert.equal(reloaded.document.getElementById('impactTable').hidden, true);
});

test('row controls use the latest callbacks and empty renders remove stale representatives', () => {
  const h = harness();
  const calls = [];
  const row = { rep:'Example', apps:4, opps:10, repRate:.4, impact:0 };
  h.api.render([row], { onOpen: () => calls.push('old') });
  h.api.render([row], { onOpen: rep => calls.push(['open', rep]), onInclude: (rep, included) => calls.push(['include', rep, included]) });
  h.document.querySelector('.impactTableName').click();
  const input = h.document.querySelector('.impactTableInclusion input');
  input.checked = false;
  input.dispatchEvent(new h.window.Event('change'));
  assert.deepEqual(calls, [['open', 'Example'], ['include', 'Example', false]]);
  h.api.render([]);
  assert.equal(h.document.querySelector('.impactTableName'), null);
});
