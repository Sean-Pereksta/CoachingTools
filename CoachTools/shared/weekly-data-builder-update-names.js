/* Standalone, non-destructive name formatting. Never calls either stats assembler. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.WeeklyBuilderUpdateNames = api; api.mount(root); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MODE = 'update-names';
  const PAGE_SIZE = 50;
  function normalizeWeekly(source, mode, formatName) {
    if (!['title', 'lower'].includes(mode)) throw new Error('Choose Title Case or lowercase to update names.');
    if (!source || source.loading || source.error || !Array.isArray(source.rows) || !source.analysis) {
      throw new Error(source?.error || 'Load the built stats file first. No other reports or publication date are required.');
    }
    if (typeof formatName !== 'function') throw new Error('The existing name formatter is unavailable. Reload the workspace.');
    const { rows, analysis } = source;
    const { headerRow, dims } = analysis;
    if (!Number.isInteger(headerRow) || headerRow < 0 || headerRow >= rows.length || !rows.every(Array.isArray)) {
      throw new Error('Choose a valid header row in the built stats file.');
    }
    const header = rows[headerRow].slice();
    const columns = [...new Set(['name', 'coach', 'manager'].map(role => dims?.[role])
      .filter(index => Number.isInteger(index) && index >= 0 && index < header.length))];
    if (!columns.length) throw new Error('Select the name columns under Source columns before previewing.');
    if (columns.includes(dims?.date)) throw new Error('A name column cannot also be the Date column. Check Source columns.');
    // Clone every row, including empty, duplicate, ragged and historical rows.
    // Do not use sourceRecords, assemble, saved replacements, sorting or date filtering.
    const allRows = rows.map(row => row.slice());
    const changes = [];
    let changedRows = 0;
    for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex++) {
      let changed = false;
      for (const index of columns) {
        if (!(index in rows[rowIndex])) continue; // Do not extend short/sparse rows.
        const oldValue = rows[rowIndex][index];
        const newValue = formatName(oldValue, mode);
        if (Object.is(oldValue, newValue)) continue;
        allRows[rowIndex][index] = newValue;
        changes.push({ rowNumber: rowIndex + 1, index, column: header[index],
          date: rows[rowIndex][dims.date] ?? '', oldValue, newValue });
        changed = true;
      }
      if (changed) changedRows++;
    }
    return { mode: MODE, capitalization: mode, header, headerRow, columns, allRows, changes,
      stats: { changedCells: changes.length, changedRows, totalRows: rows.length,
        addedRows: 0, removedRows: 0, statisticChanges: 0 } };
  }
  function createSession(getSource, getMode, formatName) {
    let result = null, snapshot = null, invalidated = true;
    function invalidate() { invalidated = true; }
    function isStale() {
      const source = getSource();
      return invalidated || !result || !snapshot || source !== snapshot.source ||
        source?.rows !== snapshot.rows || source?.analysis !== snapshot.analysis ||
        source?.version !== snapshot.version || source?.sheet !== snapshot.sheet ||
        source?.fileName !== snapshot.fileName || source?.loading || !!source?.error || getMode() !== snapshot.mode;
    }
    function preview() {
      invalidate();
      const source = getSource(), mode = getMode();
      const next = normalizeWeekly(source, mode, formatName);
      snapshot = { source, rows: source.rows, analysis: source.analysis, version: source.version,
        sheet: source.sheet, fileName: source.fileName, mode };
      result = next; invalidated = false;
      return result;
    }
    function exportRows() {
      if (isStale()) throw new Error('The file or name option changed. Preview the name changes again before exporting.');
      return result.allRows;
    }
    return { preview, invalidate, isStale, exportRows, getResult: () => result,
      reset: () => { result = null; snapshot = null; invalidate(); } };
  }
  function mount(root) {
    const doc = root.document, core = root.WeeklyCore, builder = root.WeeklyBuilder, names = root.WeeklyBuilderNames;
    if (!doc || !core || !builder || !names || doc.getElementById('updateNamesWorkspace')) return;
    const $ = id => doc.getElementById(id);
    const modeSelect = $('updateMode'), capitalization = $('nameCapitalization');
    if (!modeSelect || !capitalization) return;
    const option = doc.createElement('option'); option.value = MODE; option.textContent = 'Update Names'; modeSelect.appendChild(option);
    const panel = doc.createElement('section'); panel.id = 'updateNamesWorkspace'; panel.className = 'panel'; panel.hidden = true;
    panel.setAttribute('aria-label', 'Update names only');
    panel.innerHTML = `<style>
      [data-weekly-update-names] #card-appointments,[data-weekly-update-names] #card-wipers,
      [data-weekly-update-names] .controls .date-field,[data-weekly-update-names] .controls>div:nth-child(3),
      [data-weekly-update-names] .controls .build-group,[data-weekly-update-names] #results,
      [data-weekly-update-names] #emptyState,[data-weekly-update-names] .stats-settings,
      [data-weekly-update-names] #demoBtn,[data-weekly-update-names] #globalStatus,
      [data-weekly-update-names] #nameCapitalizationReview,[data-weekly-update-names] #nameCapitalizationStatus {display:none!important}
      [data-weekly-update-names] .upload-grid,[data-weekly-update-names] .controls {grid-template-columns:1fr}
      #updateNamesWorkspace {padding:21px;margin-top:16px}
      #updateNamesWorkspace .names-actions {display:flex;flex-wrap:wrap;gap:10px;margin:16px 0;align-items:center}
      #updateNamesWorkspace .names-scroll {overflow:auto;max-height:440px;margin-top:12px}
      #updateNamesWorkspace td {white-space:pre-wrap;overflow-wrap:anywhere}
      #updateNamesWorkspace .names-pages {display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:12px}
    </style>
    <h2>Update Names — capitalization only</h2>
    <p class="hint">Upload only your existing built stats file above and choose Title Case or lowercase. Every date is included. Coach / Sheet, representative, and manager names (when mapped) use the existing capitalization rules.</p>
    <p class="hint"><strong>No rows are added, removed, merged, or reordered.</strong> Dates, statistics, blanks, name spelling, punctuation, and spacing stay unchanged. Saved name replacements and manager assignments are not applied.</p>
    <div class="names-actions"><button type="button" class="primary" id="updateNamesPreview" disabled>Preview name changes</button><button type="button" id="updateNamesExport" disabled>Export names-updated CSV</button></div>
    <p id="updateNamesStatus" class="notice" role="status" aria-live="polite"></p>
    <div id="updateNamesReview" hidden><p id="updateNamesSummary" style="margin-top:14px"></p><p id="updateNamesColumns" class="hint"></p>
      <div class="names-scroll"><table aria-label="Name capitalization changes"><thead><tr><th>File row</th><th>Date</th><th>Name column</th><th>Before</th><th>After</th></tr></thead><tbody id="updateNamesChanges"></tbody></table></div>
      <div class="names-pages"><button type="button" id="updateNamesPrevious">Previous</button><span id="updateNamesPage"></span><button type="button" id="updateNamesNext">Next</button></div>
    </div>
    <p class="hint">The export contains the entire selected worksheet, not just changed rows. The original upload is never overwritten. As with Add and Modify, XLSX imports export saved cell values as CSV; workbook formatting and other worksheets are not included.</p>`;
    const capitalizationPanel = capitalization.closest('section');
    capitalizationPanel.after(panel);
    const session = createSession(() => builder.getSources().weekly, () => capitalization.value, names.formatName);
    let active = false, page = 1, previousHint = '';
    const formatHint = capitalizationPanel.querySelector('p.hint');
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = value => Number(value).toLocaleString('en-US');
    function message(text, error = false) {
      $('updateNamesStatus').textContent = text;
      $('updateNamesStatus').className = 'notice' + (error ? ' error' : '');
    }
    function refresh() {
      if (!active) return;
      const source = builder.getSources().weekly;
      const ready = !!(source?.rows && source.analysis && !source.loading && !source.error);
      const selected = ['title', 'lower'].includes(capitalization.value);
      $('updateNamesPreview').disabled = !ready || !selected;
      $('updateNamesExport').disabled = session.isStale();
      // Reset can recreate the cards and restore the legacy mode label.
      modeSelect.value = MODE;
      $('modeTag').textContent = 'UPDATE NAMES';
      $('modeHint').textContent = 'Only the built stats file. No source reports or publication date.';
      if (source?.loading) message('Reading the built stats file. Export is locked until you preview this file.');
      else if (source?.error) message(source.error, true);
      else if (!ready) message('Upload the existing built stats file above. No opportunity or wiper file is needed.');
      else if (!selected) message('Choose Title Case or lowercase in Name capitalization above.');
      else if (session.isStale()) message(session.getResult() ? 'Inputs changed. Preview name changes again before exporting.' : 'Ready to preview every name across the entire file.');
      else message('Preview ready. ' + fmt(session.getResult().stats.changedCells) + ' name cells would change. No statistics or row counts change.');
    }
    function render() {
      const result = session.getResult();
      $('updateNamesReview').hidden = !result;
      if (!result) return;
      const stats = result.stats, pages = Math.max(1, Math.ceil(result.changes.length / PAGE_SIZE));
      page = Math.max(1, Math.min(page, pages));
      $('updateNamesSummary').textContent = fmt(stats.changedCells) + ' name cells in ' + fmt(stats.changedRows) + ' rows · 0 rows added · 0 rows removed · 0 statistics changed.';
      $('updateNamesColumns').textContent = 'Name columns: ' + result.columns.map(index => result.header[index]).join(', ') + '. All ' + fmt(stats.totalRows) + ' file rows, including headers and blank rows, are retained.';
      $('updateNamesChanges').innerHTML = result.changes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(change =>
        '<tr><td>' + change.rowNumber + '</td><td>' + esc(change.date) + '</td><td>' + esc(change.column) + '</td><td>' + esc(change.oldValue) + '</td><td>' + esc(change.newValue) + '</td></tr>').join('') ||
        '<tr><td colspan="5">No capitalization changes are needed. The complete file is unchanged.</td></tr>';
      $('updateNamesPage').textContent = 'Page ' + page + ' / ' + pages + ' · ' + fmt(result.changes.length) + ' changes';
      $('updateNamesPrevious').disabled = page <= 1; $('updateNamesNext').disabled = page >= pages;
    }
    function invalidate() { session.invalidate(); refresh(); }
    function setActive(value) {
      if (value === active) { refresh(); return; }
      active = value; panel.hidden = !active;
      doc.documentElement.toggleAttribute('data-weekly-update-names', active);
      session.reset(); page = 1; render();
      if (active) {
        if (formatHint) { previousHint = formatHint.textContent; formatHint.textContent = 'Update Names changes capitalization only, across every week. Saved name replacements are NOT applied in this mode.'; }
        // Invalidate any earlier stats preview without changing its date or inputs.
        $('publicationDate').dispatchEvent(new root.Event('input', { bubbles: true }));
        refresh();
      } else if (formatHint) formatHint.textContent = previousHint;
    }
    // Capture the new value before the legacy two-mode handler coerces it to Add.
    // Add and Modify continue to use their original handlers and validation.
    modeSelect.addEventListener('change', event => {
      if (modeSelect.value === MODE) { event.stopImmediatePropagation(); setActive(true); }
      else if (active) setActive(false);
    }, true);
    capitalization.addEventListener('change', () => { if (active) invalidate(); });
    $('updateNamesPreview').addEventListener('click', () => {
      if (!active) return;
      try { session.preview(); page = 1; render(); refresh(); }
      catch (error) { refresh(); message(error.message, true); }
    });
    $('updateNamesExport').addEventListener('click', () => {
      if (!active) return;
      let url;
      try {
        const rows = session.exportRows();
        const filename = builder.getExportFileName();
        url = root.URL.createObjectURL(new root.Blob([core.csv(rows)], { type: 'text/csv;charset=utf-8;' }));
        const link = doc.createElement('a'); link.href = url; link.download = filename;
        doc.body.appendChild(link); link.click(); link.remove();
        message('CSV prepared: ' + filename + '. Full file included; only name capitalization changed.');
      } catch (error) { refresh(); message(error.message, true); }
      finally { if (url) root.setTimeout(() => root.URL.revokeObjectURL(url), 30000); }
    });
    $('updateNamesPrevious').addEventListener('click', () => { page--; render(); });
    $('updateNamesNext').addEventListener('click', () => { page++; render(); });
    // Lock export immediately, including while an asynchronous replacement file is reading.
    for (const type of ['input', 'change', 'drop']) $('uploadGrid').addEventListener(type, event => {
      if (active && event.target.closest('#card-weekly')) invalidate();
    }, true);
    root.addEventListener('weekly-builder-sources-change', () => root.queueMicrotask(refresh));
    // Observe the existing reader's completion/error state; no polling or second file parser.
    const observer = new root.MutationObserver(() => { if (active) refresh(); });
    observer.observe($('uploadGrid'), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    $('resetBtn').addEventListener('click', () => {
      if (active) { session.reset(); page = 1; render(); root.queueMicrotask(refresh); }
    }, true);
    // Keep the builder's public inspection surface truthful in all three modes.
    const original = { getMode: builder.getMode, getResult: builder.getResult, getStats: builder.getStats,
      isStale: builder.isStale, isModifyFinalized: builder.isModifyFinalized };
    builder.getMode = () => active ? MODE : original.getMode();
    builder.getResult = () => active ? session.getResult() : original.getResult();
    builder.getStats = () => active ? session.getResult()?.stats || null : original.getStats();
    builder.isStale = () => active ? session.isStale() : original.isStale();
    builder.isModifyFinalized = () => active ? false : original.isModifyFinalized();
  }
  return { MODE, normalizeWeekly, createSession, mount };
});
