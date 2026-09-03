(function installCoachTimelineCoordinatorRangeColumns(root) {
  const FEATURE_ID = 'coach-timeline-coordinator-range-columns';
  const BUILDER_ID = 'coordSpeedRangeBuilder';
  const PANEL_ID = 'coordSpeedRangePanel';
  let installed = false;
  let attempts = 0;

  function ready() {
    try {
      return typeof S !== 'undefined'
        && S
        && S.coordinatorConfig
        && typeof renderCoordinatorSpeedRankings === 'function'
        && typeof getCoordinatorRankingRows === 'function'
        && typeof coordinatorRankingAggregate === 'function'
        && typeof saveCoordinatorConfig === 'function'
        && typeof COORD_RANK_COLUMN_DEFS !== 'undefined'
        && document.getElementById('coordRankingColumnBuilder')
        && document.getElementById('coordRankingTable');
    } catch (_) {
      return false;
    }
  }

  function coordinatorBands() {
    if (!Array.isArray(S.coordinatorConfig.rangeBands)) S.coordinatorConfig.rangeBands = [];
    return S.coordinatorConfig.rangeBands;
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

  function rowKey(name, initial) {
    const normalizedName = typeof normCoachKey === 'function'
      ? normCoachKey(name)
      : String(name || '').trim().toLowerCase();
    return `${normalizedName}|${String(initial || '').trim().toUpperCase()}`;
  }

  function preferredInitial(name) {
    try {
      return typeof preferredInitialForName === 'function' ? preferredInitialForName(name) : '';
    } catch (_) {
      return '';
    }
  }

  function pairValuesByCoordinator(pairs) {
    const grouped = new Map();
    (pairs || []).forEach(pair => {
      const initial = pair.initial || preferredInitial(pair.coordinator);
      const key = rowKey(pair.coordinator, initial);
      const list = grouped.get(key) || [];
      const value = Number(pair.days);
      if (Number.isFinite(value) && value >= 0) list.push(value);
      grouped.set(key, list);
    });
    return grouped;
  }

  function rangeMetric(row, band, grouped) {
    const values = grouped.get(rowKey(row.name, row.initial)) || [];
    const bounds = boundsFor(band);
    if (!bounds || !values.length) return { count: 0, total: values.length, pct: NaN };
    const count = values.filter(value => value >= bounds.min && value <= bounds.max).length;
    return { count, total: values.length, pct: count / values.length * 100 };
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return '—';
    if (typeof fmtPct === 'function') return fmtPct(value, 0);
    return `${Math.round(value)}%`;
  }

  function showToast(title, detail) {
    try {
      if (typeof toast === 'function') toast(title, detail);
    } catch (_) {}
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
        <span class="mini">Add percentage columns for coordinator items completed inside any inclusive day range. Existing ranking columns stay unchanged.</span>
      </div>
      <div class="bandBuilder" id="${BUILDER_ID}"></div>
      <div class="row" style="margin-top:8px">
        <button class="btn secondary" id="btnAddCoordSpeedRange" type="button">Add column</button>
        <button class="btn ghost" id="btnClearCoordSpeedRanges" type="button">Clear custom columns</button>
      </div>`;
    builtInPanel.insertAdjacentElement('afterend', panel);

    panel.querySelector('#btnAddCoordSpeedRange').addEventListener('click', () => {
      const bands = coordinatorBands();
      const number = bands.length + 1;
      bands.push({
        id: `coord_range_${Date.now()}_${number}`,
        label: `Custom range ${number}`,
        min: 0,
        max: 3
      });
      saveCoordinatorConfig();
      renderCoordinatorSpeedRankings();
    });

    panel.querySelector('#btnClearCoordSpeedRanges').addEventListener('click', () => {
      if (!coordinatorBands().length) return;
      S.coordinatorConfig.rangeBands = [];
      saveCoordinatorConfig();
      renderCoordinatorSpeedRankings();
      showToast('Custom columns cleared', 'Existing Coordinator Speed Ranking columns were left unchanged.');
    });

    return panel;
  }

  function renderBuilder() {
    const panel = ensurePanel();
    const wrap = panel && panel.querySelector(`#${BUILDER_ID}`);
    if (!wrap) return;
    const bands = coordinatorBands();
    wrap.innerHTML = '';

    if (!bands.length) {
      const empty = document.createElement('div');
      empty.className = 'mini';
      empty.textContent = 'No custom speed columns yet. Add a column, then set its name, minimum days, and maximum days.';
      wrap.appendChild(empty);
      return;
    }

    bands.forEach((band, index) => {
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
        const band = coordinatorBands().find(item => item.id === row.dataset.coordRangeId);
        if (!band) return;
        const field = input.dataset.coordRangeField;
        if (field === 'label') band.label = input.value.trim() || safeLabel(band, coordinatorBands().indexOf(band));
        else band[field] = Math.max(0, Number(input.value) || 0);
        saveCoordinatorConfig();
        renderCoordinatorSpeedRankings();
      });
    });

    wrap.querySelectorAll('[data-delete-coord-range]').forEach(button => {
      button.addEventListener('click', () => {
        const row = button.closest('[data-coord-range-id]');
        S.coordinatorConfig.rangeBands = coordinatorBands().filter(item => item.id !== row.dataset.coordRangeId);
        saveCoordinatorConfig();
        renderCoordinatorSpeedRankings();
      });
    });
  }

  function appendRangeColumns() {
    const bands = coordinatorBands();
    if (!bands.length) return;
    const table = document.getElementById('coordRankingTable');
    const headRow = table && table.querySelector('thead tr');
    const body = table && table.querySelector('tbody');
    if (!headRow || !body) return;

    const result = getCoordinatorRankingRows();
    const grouped = pairValuesByCoordinator(result.quality && result.quality.pairs);

    bands.forEach((band, index) => {
      const th = document.createElement('th');
      th.textContent = `${safeLabel(band, index)} %`;
      th.title = boundsFor(band)
        ? `${boundsFor(band).min} to ${boundsFor(band).max} days, inclusive`
        : 'Set both minimum and maximum days';
      headRow.appendChild(th);
    });

    if (!result.rows.length) {
      const emptyCell = body.querySelector('tr td[colspan]');
      if (emptyCell) emptyCell.colSpan = headRow.children.length;
      return;
    }

    const bodyRows = [...body.querySelectorAll('tr')];
    result.rows.forEach((row, rowIndex) => {
      const tr = bodyRows[rowIndex];
      if (!tr) return;
      bands.forEach(band => {
        const metric = rangeMetric(row, band, grouped);
        const td = document.createElement('td');
        td.className = 'rankingCell';

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

  function installRenderPatch() {
    const originalRender = renderCoordinatorSpeedRankings;
    renderCoordinatorSpeedRankings = function renderCoordinatorSpeedRankingsWithRanges() {
      const result = originalRender.apply(this, arguments);
      renderBuilder();
      appendRangeColumns();
      return result;
    };
  }

  function installExportPatch() {
    const originalExport = exportCoordinatorRankings;
    exportCoordinatorRankings = function exportCoordinatorRankingsWithRanges() {
      const bands = coordinatorBands();
      if (!bands.length) return originalExport.apply(this, arguments);

      const rows = S.lastCoordinatorRankingRows.length
        ? S.lastCoordinatorRankingRows
        : getCoordinatorRankingRows().rows;
      if (!rows.length) {
        showToast('Nothing to export', 'No coordinators meet the ranking definition.');
        return;
      }
      if (!root.XLSX) {
        showToast('Excel unavailable', 'Refresh the page so the XLSX library can load.');
        return;
      }

      const visible = (S.coordinatorConfig.visibleColumns || [])
        .filter(id => COORD_RANK_COLUMN_DEFS.some(column => column.id === id));
      const builtInHeaders = visible.map(id => COORD_RANK_COLUMN_DEFS.find(column => column.id === id).label);
      const customHeaders = bands.map((band, index) => `${safeLabel(band, index)} %`);
      const header = [...builtInHeaders, ...customHeaders];
      const aggregate = coordinatorRankingAggregate();
      const grouped = pairValuesByCoordinator(aggregate.quality && aggregate.quality.pairs);
      const builtInValue = (row, id) => {
        if (['avg', 'median', 'fastest', 'slowest'].includes(id)) return row[id];
        if (id === 'earlyDate' || id === 'lateDate') return typeof fmtDate === 'function' ? fmtDate(row[id]) : row[id];
        return row[id];
      };
      const aoa = [header];
      rows.forEach(row => {
        aoa.push([
          ...visible.map(id => builtInValue(row, id)),
          ...bands.map(band => rangeMetric(row, band, grouped).pct)
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
        ['Early source', S.coordinatorConfig.early.source],
        ['Early field', S.coordinatorConfig.early.field],
        ['Late source', S.coordinatorConfig.late.source],
        ['Late field', S.coordinatorConfig.late.field],
        ['Rank by', S.coordinatorConfig.rankBy],
        ['Timeframe', typeof getTimeframe === 'function' ? getTimeframe().label : ''],
        ...bands.map((band, index) => {
          const bounds = boundsFor(band);
          return [
            `Custom column: ${safeLabel(band, index)}`,
            bounds ? `${bounds.min}–${bounds.max} days inclusive` : 'Invalid range'
          ];
        }),
        ['Exported', new Date().toLocaleString()]
      ];
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(metaRows), 'Definition');
      XLSX.writeFile(workbook, `coordinator_speed_rankings_${new Date().toISOString().slice(0, 10)}.xlsx`);
      showToast('Exported', 'Coordinator ranking workbook downloaded with custom speed range percentages.');
    };
  }

  function install() {
    if (installed || !ready()) return false;
    installed = true;
    coordinatorBands();
    ensurePanel();
    installRenderPatch();
    installExportPatch();
    renderCoordinatorSpeedRankings();
    return true;
  }

  function tryInstall() {
    if (install()) return;
    attempts += 1;
    if (attempts < 80) root.setTimeout(tryInstall, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => root.setTimeout(tryInstall, 0), { once: true });
  } else {
    root.setTimeout(tryInstall, 0);
  }

  root[FEATURE_ID] = Object.freeze({ install: tryInstall });
})(window);
