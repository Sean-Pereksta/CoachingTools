(function installCoachTimelineCoordinatorRangeColumns(root) {
  const FEATURE_KEY = '__coachTimelineCoordinatorRangeColumns';
  const PANEL_ID = 'coordSpeedRangePanel';
  const BUILDER_ID = 'coordSpeedRangeBuilder';
  let attempts = 0;
  let observer = null;
  let renderQueued = false;

  if (root[FEATURE_KEY]) return;

  function api() {
    return root.CoachTimelineCoordinatorRangesAPI || null;
  }

  function ready() {
    const bridge = api();
    return Boolean(
      bridge
      && typeof bridge.getRangeBands === 'function'
      && typeof bridge.setRangeBands === 'function'
      && typeof bridge.getRangeRows === 'function'
      && typeof bridge.render === 'function'
      && document.getElementById('coordRankingColumnBuilder')
      && document.getElementById('coordRankingTable')
    );
  }

  function bands() {
    const bridge = api();
    const value = bridge ? bridge.getRangeBands() : [];
    return Array.isArray(value) ? value : [];
  }

  function safeLabel(band, index) {
    const label = String(band && band.label || '').trim();
    return label || `Custom range ${index + 1}`;
  }

  function boundsFor(band) {
    let min = Number(band && band.min);
    let max = Number(band && band.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    min = Math.max(0, min);
    max = Math.max(0, max);
    if (min > max) [min, max] = [max, min];
    return { min, max };
  }

  function notify(title, detail) {
    const bridge = api();
    if (bridge && typeof bridge.toast === 'function') bridge.toast(title, detail);
  }

  function saveBands(nextBands, rerender) {
    const bridge = api();
    if (!bridge) return;
    bridge.setRangeBands(nextBands);
    renderBuilder();
    if (rerender !== false) bridge.render();
    queueRangeColumns();
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    const builtInBuilder = document.getElementById('coordRankingColumnBuilder');
    const builtInPanel = builtInBuilder && builtInBuilder.closest('.panelSoft');
    if (!builtInPanel) return null;

    panel = document.createElement('div');
    panel.className = 'panelSoft';
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="panelTitle">
        <b>Custom speed range columns</b>
        <span class="mini">Build percentage columns for coordinator items completed inside any inclusive day range. Existing Coordinator Speed Ranking columns stay unchanged.</span>
      </div>
      <div class="bandBuilder" id="${BUILDER_ID}"></div>
      <div class="row" style="margin-top:8px">
        <button class="btn secondary" id="btnAddCoordSpeedRange" type="button">Add column</button>
        <button class="btn ghost" id="btnClearCoordSpeedRanges" type="button">Clear custom columns</button>
      </div>`;
    builtInPanel.insertAdjacentElement('afterend', panel);

    panel.querySelector('#btnAddCoordSpeedRange').addEventListener('click', () => {
      const next = bands();
      const number = next.length + 1;
      next.push({
        id: `coord_range_${Date.now()}_${number}`,
        label: `Custom range ${number}`,
        min: 0,
        max: 3
      });
      saveBands(next);
    });

    panel.querySelector('#btnClearCoordSpeedRanges').addEventListener('click', () => {
      if (!bands().length) return;
      saveBands([]);
      notify('Custom columns cleared', 'Existing Coordinator Speed Ranking columns were left unchanged.');
    });

    return panel;
  }

  function renderBuilder() {
    const panel = ensurePanel();
    const wrap = panel && panel.querySelector(`#${BUILDER_ID}`);
    if (!wrap) return;
    const current = bands();
    wrap.innerHTML = '';

    if (!current.length) {
      const empty = document.createElement('div');
      empty.className = 'mini';
      empty.textContent = 'No custom speed columns yet. Add a column, then set its name, minimum days, and maximum days.';
      wrap.appendChild(empty);
      return;
    }

    current.forEach((band, index) => {
      const row = document.createElement('div');
      row.className = 'bandRow';
      row.dataset.coordRangeId = band.id;
      row.innerHTML = `
        <div class="bandName"><label>Column name</label><input data-coord-range-field="label" type="text"></div>
        <div><label>Minimum days</label><input data-coord-range-field="min" type="number" min="0" step="1"></div>
        <div><label>Maximum days</label><input data-coord-range-field="max" type="number" min="0" step="1"></div>
        <button class="btn danger" data-delete-coord-range type="button">Delete</button>`;
      row.querySelector('[data-coord-range-field="label"]').value = safeLabel(band, index);
      row.querySelector('[data-coord-range-field="min"]').value = Number.isFinite(Number(band.min)) ? band.min : 0;
      row.querySelector('[data-coord-range-field="max"]').value = Number.isFinite(Number(band.max)) ? band.max : 3;
      wrap.appendChild(row);
    });

    wrap.querySelectorAll('input[data-coord-range-field]').forEach(input => {
      input.addEventListener('change', () => {
        const row = input.closest('[data-coord-range-id]');
        const next = bands();
        const band = next.find(item => item.id === row.dataset.coordRangeId);
        if (!band) return;
        const field = input.dataset.coordRangeField;
        if (field === 'label') {
          band.label = input.value.trim() || safeLabel(band, next.indexOf(band));
        } else {
          band[field] = Math.max(0, Number(input.value) || 0);
        }
        saveBands(next);
      });
    });

    wrap.querySelectorAll('[data-delete-coord-range]').forEach(button => {
      button.addEventListener('click', () => {
        const row = button.closest('[data-coord-range-id]');
        saveBands(bands().filter(item => item.id !== row.dataset.coordRangeId));
      });
    });
  }

  function formatPercent(value) {
    return Number.isFinite(value) ? `${Math.round(value)}%` : '—';
  }

  function clearCustomCells(table) {
    table.querySelectorAll('[data-coord-custom-range]').forEach(node => node.remove());
  }

  function appendRangeColumns() {
    renderQueued = false;
    const bridge = api();
    const current = bands();
    const table = document.getElementById('coordRankingTable');
    if (!bridge || !table) return;

    clearCustomCells(table);
    if (!current.length) return;

    const headRow = table.querySelector('thead tr');
    const body = table.querySelector('tbody');
    if (!headRow || !body) return;
    const rangeRows = bridge.getRangeRows(current, false) || [];

    current.forEach((band, index) => {
      const th = document.createElement('th');
      th.dataset.coordCustomRange = band.id;
      th.textContent = `${safeLabel(band, index)} %`;
      const bounds = boundsFor(band);
      th.title = bounds ? `${bounds.min} to ${bounds.max} days, inclusive` : 'Set both minimum and maximum days';
      headRow.appendChild(th);
    });

    if (!rangeRows.length) {
      const emptyCell = body.querySelector('tr td[colspan]');
      if (emptyCell) emptyCell.colSpan = headRow.children.length;
      return;
    }

    const bodyRows = [...body.querySelectorAll('tr')];
    rangeRows.forEach((entry, rowIndex) => {
      const tr = bodyRows[rowIndex];
      if (!tr) return;
      (entry.metrics || []).forEach((metric, bandIndex) => {
        const band = current[bandIndex];
        const td = document.createElement('td');
        td.className = 'rankingCell';
        td.dataset.coordCustomRange = band && band.id || String(bandIndex);

        const pct = document.createElement('div');
        pct.className = 'rankingPct';
        pct.textContent = formatPercent(metric.pct);
        const detail = document.createElement('div');
        detail.className = 'mini';
        detail.textContent = `${metric.count} of ${metric.total} item(s)`;
        const bar = document.createElement('div');
        bar.className = 'rankingBar';
        const fill = document.createElement('span');
        fill.style.width = `${Math.max(0, Math.min(100, Number.isFinite(metric.pct) ? metric.pct : 0))}%`;
        bar.appendChild(fill);
        td.append(pct, detail, bar);
        tr.appendChild(td);
      });
    });
  }

  function queueRangeColumns() {
    if (renderQueued) return;
    renderQueued = true;
    root.requestAnimationFrame ? root.requestAnimationFrame(appendRangeColumns) : root.setTimeout(appendRangeColumns, 0);
  }

  function watchRankingTable() {
    const table = document.getElementById('coordRankingTable');
    if (!table || observer) return;
    observer = new MutationObserver(mutations => {
      const appChangedTable = mutations.some(mutation => {
        const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return nodes.some(node => {
          if (node.nodeType !== 1) return false;
          return !node.hasAttribute('data-coord-custom-range');
        });
      });
      if (appChangedTable) queueRangeColumns();
    });
    observer.observe(table, { childList: true, subtree: true });
  }

  function exportWithRanges() {
    const bridge = api();
    const current = bands();
    if (!bridge || !current.length) return false;
    const rangeRows = bridge.getRangeRows(current, true) || [];
    if (!rangeRows.length) {
      notify('Nothing to export', 'No coordinators meet the ranking definition.');
      return true;
    }
    if (!root.XLSX) {
      notify('Excel unavailable', 'Refresh the page so the XLSX library can load.');
      return true;
    }

    const config = bridge.getConfig();
    const defs = bridge.getColumnDefs();
    const visible = (config.visibleColumns || []).filter(id => defs.some(column => column.id === id));
    const builtInHeaders = visible.map(id => defs.find(column => column.id === id).label);
    const header = [...builtInHeaders, ...current.map((band, index) => `${safeLabel(band, index)} %`)];
    const builtInValue = (row, id) => {
      if (['avg', 'median', 'fastest', 'slowest'].includes(id)) return row[id];
      if (id === 'earlyDate' || id === 'lateDate') return bridge.formatDate(row[id]);
      return row[id];
    };
    const aoa = [header];
    rangeRows.forEach(entry => {
      aoa.push([
        ...visible.map(id => builtInValue(entry.row, id)),
        ...(entry.metrics || []).map(metric => metric.pct)
      ]);
    });

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
    sheet['!cols'] = header.map((label, index) => ({
      wch: index === 1 ? 28 : Math.max(12, Math.min(28, String(label).length + 3))
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, 'Coordinator Rankings');

    const metaRows = [
      ['Early source', config.early && config.early.source || ''],
      ['Early field', config.early && config.early.field || ''],
      ['Late source', config.late && config.late.source || ''],
      ['Late field', config.late && config.late.field || ''],
      ['Rank by', config.rankBy || ''],
      ['Timeframe', bridge.getTimeframeLabel()],
      ...current.map((band, index) => {
        const bounds = boundsFor(band);
        return [`Custom column: ${safeLabel(band, index)}`, bounds ? `${bounds.min}–${bounds.max} days inclusive` : 'Invalid range'];
      }),
      ['Exported', new Date().toLocaleString()]
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(metaRows), 'Definition');
    XLSX.writeFile(workbook, `coordinator_speed_rankings_${new Date().toISOString().slice(0, 10)}.xlsx`);
    notify('Exported', 'Coordinator ranking workbook downloaded with custom speed range percentages.');
    return true;
  }

  function installExportIntercept() {
    const button = document.getElementById('btnExportCoordinatorRankings');
    if (!button || button.dataset.coordRangeExportIntercept === '1') return;
    button.dataset.coordRangeExportIntercept = '1';
    button.addEventListener('click', event => {
      if (!bands().length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      exportWithRanges();
    }, true);
  }

  function install() {
    if (!ready()) return false;
    ensurePanel();
    renderBuilder();
    watchRankingTable();
    installExportIntercept();
    queueRangeColumns();
    root[FEATURE_KEY] = Object.freeze({ refresh: queueRangeColumns });
    return true;
  }

  function tryInstall() {
    if (install()) return;
    attempts += 1;
    if (attempts < 1200) root.setTimeout(tryInstall, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => root.setTimeout(tryInstall, 0), { once: true });
  } else {
    root.setTimeout(tryInstall, 0);
  }
})(window);
