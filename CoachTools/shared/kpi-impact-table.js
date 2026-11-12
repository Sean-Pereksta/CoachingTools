(function () {
  'use strict';

  if (window.KpiImpactTable) {
    window.KpiImpactTable.init();
    return;
  }

  const STORAGE_KEY = 'impactTool.layout.v1';
  let layout = 'cards';
  let currentRows = [];
  let callbacks = {};
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === 'table') layout = 'table';
  } catch (_) {}

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = String(value);
    return element;
  }

  function applyLayout() {
    const grid = document.getElementById('impactGrid');
    const container = document.getElementById('impactTable');
    if (grid) grid.hidden = layout === 'table';
    if (container) container.hidden = layout !== 'table';
    const select = document.getElementById('impactLayout');
    if (select) {
      for (const option of select.options) option.selected = option.value === layout;
    }
  }

  function init() {
    const toolbar = document.querySelector('.impactToolbar');
    const grid = document.getElementById('impactGrid');
    if (!toolbar || !grid) return false;

    if (!document.getElementById('impactLayout')) {
      const label = node('label', 'impactLayoutControl');
      label.htmlFor = 'impactLayout';
      label.appendChild(node('span', '', 'View'));
      const select = node('select');
      select.id = 'impactLayout';
      select.setAttribute('aria-label', 'Team member view');
      for (const [value, text] of [['cards', 'Cards'], ['table', 'Table']]) {
        const option = node('option', '', text);
        option.value = value;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        layout = select.value === 'table' ? 'table' : 'cards';
        try { window.localStorage.setItem(STORAGE_KEY, layout); } catch (_) {}
        applyLayout();
      });
      label.appendChild(select);
      toolbar.insertBefore(label, toolbar.querySelector('.sortWrap'));
    }

    if (!document.getElementById('impactTable')) {
      const container = node('div', 'impactTableWrap');
      container.id = 'impactTable';
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'Team member impact table');
      container.tabIndex = 0;
      grid.after(container);
    }
    applyLayout();
    return true;
  }

  function number(value) {
    return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
  }

  function render(rows, handlers) {
    currentRows = Array.isArray(rows) ? rows : [];
    callbacks = handlers || {};
    if (!init()) return;
    const container = document.getElementById('impactTable');
    container.replaceChildren();
    const table = node('table', 'impactTable');
    table.appendChild(node('caption', '', 'Team members in the current search, filter and sort order. Team impact shows the rate change if a person is removed.'));
    const head = node('thead');
    const headings = node('tr');
    for (const title of ['Representative', 'KPI rate', 'Numerator', 'Opportunities', 'Team impact', 'Included']) {
      const heading = node('th', '', title);
      heading.scope = 'col';
      headings.appendChild(heading);
    }
    head.appendChild(headings);
    table.appendChild(head);
    const body = node('tbody');
    if (!currentRows.length) {
      const row = node('tr');
      const empty = node('td', 'impactTableEmpty', 'No representatives match the current filters.');
      empty.colSpan = 6;
      row.appendChild(empty);
      body.appendChild(row);
    }
    for (const entry of currentRows) {
      const rep = String(entry.rep || 'Unnamed representative');
      const off = !!entry.isExcluded;
      const row = node('tr', off ? 'impactTableExcluded' : '');
      const identity = node('th', 'impactTableIdentity');
      identity.scope = 'row';
      const open = node('button', 'impactTableName', rep);
      open.type = 'button';
      open.setAttribute('aria-label', 'Open coaching history for ' + rep);
      open.addEventListener('click', () => {
        if (typeof callbacks.onOpen === 'function') callbacks.onOpen(rep);
      });
      identity.appendChild(open);
      if (off) identity.appendChild(node('span', 'impactTableExcludedLabel', 'Excluded'));
      row.appendChild(identity);
      row.appendChild(node('td', 'impactTableNumber', Number.isFinite(entry.repRate) ? (entry.repRate * 100).toFixed(1) + '%' : '—'));
      row.appendChild(node('td', 'impactTableNumber', number(entry.apps)));
      row.appendChild(node('td', 'impactTableNumber', number(entry.opps)));
      const impact = node('td', 'impactTableNumber');
      if (off || !Number.isFinite(entry.impact)) {
        impact.textContent = '—';
      } else {
        const points = Math.abs(entry.impact * 100);
        const text = points < 0.005 ? 'Neutral 0.00 pp' : (entry.impact > 0 ? 'Drag ' : 'Lift ') + points.toFixed(2) + ' pp';
        impact.appendChild(node('span', points < 0.005 ? '' : entry.impact > 0 ? 'impactTableDrag' : 'impactTableLift', text));
        impact.title = points < 0.005 ? 'Removing this person leaves the team rate unchanged to two decimal places.'
          : 'Removing this person would ' + (entry.impact > 0 ? 'raise' : 'lower') + ' the team rate by ' + points.toFixed(2) + ' percentage points.';
      }
      row.appendChild(impact);
      const inclusion = node('td', 'impactTableInclusion');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !off;
      checkbox.setAttribute('aria-label', 'Include ' + rep + ' in the team calculation');
      checkbox.addEventListener('change', () => {
        if (typeof callbacks.onInclude === 'function') callbacks.onInclude(rep, checkbox.checked);
      });
      inclusion.appendChild(checkbox);
      row.appendChild(inclusion);
      body.appendChild(row);
    }
    table.appendChild(body);
    container.appendChild(table);
    applyLayout();
  }

  window.KpiImpactTable = Object.freeze({ init, render });
  init();
})();
