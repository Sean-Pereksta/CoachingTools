(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.WeeklyBuilderNames = api;
    api.mount(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MODES = ['preserve', 'title', 'lower'];
  const STORAGE_KEY = 'coachtools.weeklyBuilder.nameCapitalization.v1';
  function modeOf(mode) {
    if (mode == null || mode === '') return 'preserve';
    if (!MODES.includes(mode)) throw new Error('Choose Preserve, Title Case, or lowercase for names.');
    return mode;
  }
  function formatName(value, mode) {
    mode = modeOf(mode);
    // Do not interpret formulas, strip their escaping, reorder names, or change spelling.
    if (mode === 'preserve' || typeof value !== 'string' || !value.trim() || /^\s*'?\s*[=+@-]/.test(value)) return value;
    const lower = value.toLowerCase();
    return mode === 'lower' ? lower : lower.replace(/\p{L}[\p{L}\p{M}]*/gu, word => {
      const letters = Array.from(word);
      return letters[0].toUpperCase() + letters.slice(1).join('');
    });
  }
  function normalizeResult(result, requestedMode) {
    const mode = modeOf(requestedMode);
    if (mode === 'preserve') return result;
    if (!result || !Array.isArray(result.allRows) || !result.analyses?.weekly) throw new Error('Build a valid weekly preview before formatting names.');
    const dims = result.analyses.weekly.dims;
    const columns = [...new Set([dims.name, dims.coach].filter(i => Number.isInteger(i) && i >= 0))];
    const allRows = result.allRows.map(row => row.slice());
    const countNew = result.newRows.length;
    const firstNew = countNew ? result.stats.firstNewRow - 1 : -1;
    const isNew = index => firstNew >= 0 && index >= firstNew && index < firstNew + countNew;
    const normalization = { mode, rows: 0, cells: 0, historyRows: 0, historyCells: 0, examples: [] };
    const caseChanges = new Map();
    for (let i = result.headerRow + 1; i < allRows.length; i++) {
      const changes = [];
      for (const index of columns) {
        const oldValue = allRows[i][index];
        const newValue = formatName(oldValue, mode);
        if (newValue === oldValue) continue;
        allRows[i][index] = newValue;
        const change = { index, column: result.header[index] || 'Name', oldValue, newValue, source: 'Name capitalization' };
        changes.push(change);
        normalization.cells++;
        if (!isNew(i)) normalization.historyCells++;
        if (normalization.examples.length < 100) normalization.examples.push({ ...change, rowNumber: i + 1, date: allRows[i][dims.date] ?? '' });
      }
      if (changes.length) {
        caseChanges.set(i + 1, changes);
        normalization.rows++;
        if (!isNew(i)) normalization.historyRows++;
      }
    }
    function displayRecord(record, values) {
      return { ...record, values, name: values[dims.name] ?? '', coach: dims.coach >= 0 ? values[dims.coach] ?? '' : '' };
    }
    const newRecords = result.newRecords.map((record, i) => {
      const updated = displayRecord(record, allRows[firstNew + i]);
      if (record.changes) updated.changes = record.changes.map(c => ({ ...c, newValue: updated.values[c.index] }));
      return updated;
    });
    const next = { ...result, allRows, newRecords, newRows: newRecords.map(r => r.values), stats: { ...result.stats }, nameNormalization: normalization };
    if (result.mode === 'modify') {
      const impacts = new Map();
      for (const record of result.impactRecords || []) {
        if (record.kind === 'modify-new') continue;
        impacts.set(record.rowNumber, { ...displayRecord(record, allRows[record.rowNumber - 1]), changes: record.changes.map(c => ({ ...c })) });
      }
      for (const [rowNumber, changes] of caseChanges) {
        if (isNew(rowNumber - 1)) continue;
        let record = impacts.get(rowNumber);
        if (!record) {
          record = { ...displayRecord({ kind: 'modified', rowNumber }, allRows[rowNumber - 1]), changes: [] };
          impacts.set(rowNumber, record);
        }
        for (const change of changes) if (!record.changes.some(c => c.index === change.index)) record.changes.push(change);
      }
      // Combine source edits and case edits into one original -> final change per cell.
      const modified = [...impacts.values()].map(record => ({
        ...record,
        changes: record.changes.map(c => ({ ...c, newValue: record.values[c.index] })).filter(c => c.oldValue !== c.newValue)
      })).filter(record => record.changes.length);
      next.impactRecords = [...modified, ...newRecords].sort((a, b) => a.rowNumber - b.rowNumber);
      next.stats.modifiedRows = modified.length;
      next.stats.modifiedCells = modified.reduce((sum, record) => sum + record.changes.length, 0);
    }
    const label = mode === 'title' ? 'Title Case' : 'lowercase';
    next.mapping = result.mapping.map(m => columns.includes(m.index) ? {
      ...m, description: m.description + ' Output capitalization: ' + label + ' across every date, including history.'
    } : m);
    next.warnings = result.warnings.filter(w => !(next.impactRecords?.length && w === 'No values would change for the selected date with the supplied source file(s).'));
    next.warnings.push('Whole-file name formatting: ' + normalization.cells + ' coach / representative cells in ' + normalization.rows + ' rows changed to ' + label + ' (' + normalization.historyRows + ' historical rows). Dates, statistics, row order, and source files are unchanged by this formatting step. In Modify mode, name-only changes outside the selected date are also included in the impact preview.');
    return next;
  }
  function wrapCore(core, getMode, onResult) {
    if (core.assemble.__weeklyNameFormatting) return;
    for (const method of ['assemble', 'assembleModify']) {
      const original = core[method];
      if (typeof original !== 'function') continue;
      const wrapped = function (input) {
        const mode = modeOf(input?.options?.nameCapitalization ?? getMode());
        const result = normalizeResult(original.apply(this, arguments), mode);
        if (onResult) onResult(result);
        return result;
      };
      wrapped.__weeklyNameFormatting = true;
      core[method] = wrapped;
    }
  }
  function mount(root) {
    const doc = root.document, core = root.WeeklyCore, builder = root.WeeklyBuilder;
    if (!doc || !core || !builder || doc.getElementById('nameCapitalization')) return;
    const controls = doc.querySelector('.controls');
    if (!controls) return;
    const panel = doc.createElement('section');
    panel.className = 'panel';
    panel.style.cssText = 'padding:18px 21px;margin-top:16px';
    panel.setAttribute('aria-label', 'Whole-file name capitalization');
    panel.innerHTML = '<h3>Name capitalization — entire weekly file</h3>' +
      '<label class="field-label" for="nameCapitalization" style="margin-top:10px">Coach and representative names</label>' +
      '<select id="nameCapitalization"><option value="preserve">Preserve original capitalization</option><option value="title">Title Case — John Doe</option><option value="lower">lowercase — john doe</option></select>' +
      '<p class="hint">Applies to every output row, including older weeks, after saved name replacements. Only capitalization changes; names are not merged, reordered, or respelled. Title Case capitalizes each word and hyphen/apostrophe segment. Original uploads and statistics stay unchanged.</p>' +
      '<p id="nameCapitalizationStatus" class="hint" role="status" aria-live="polite"></p>' +
      '<details id="nameCapitalizationReview" hidden><summary>Review capitalization changes (first 100 cells)</summary><div style="overflow:auto;max-height:280px"><table id="nameCapitalizationTable"></table></div></details>';
    controls.after(panel);
    const select = doc.getElementById('nameCapitalization');
    const status = doc.getElementById('nameCapitalizationStatus');
    let storageWarning = '';
    try { select.value = modeOf(root.localStorage.getItem(STORAGE_KEY)); }
    catch (_) { select.value = 'preserve'; storageWarning = 'Preference could not be restored; it will apply to this session.'; }
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function renderSummary(result) {
      if (builder.getResult() !== result || builder.isStale()) return;
      const n = result.nameNormalization;
      status.textContent = n ? n.cells + ' cells across ' + n.rows + ' rows normalized; ' + n.historyRows + ' historical rows included. ' + storageWarning : 'Capitalization is preserved. ' + storageWarning;
      doc.getElementById('nameCapitalizationReview').hidden = !n?.examples.length;
      doc.getElementById('nameCapitalizationTable').innerHTML = n?.examples.length ? '<thead><tr><th>Row</th><th>Date</th><th>Column</th><th>Before</th><th>After</th></tr></thead><tbody>' + n.examples.map(c => '<tr><td>' + c.rowNumber + '</td><td>' + esc(c.date) + '</td><td>' + esc(c.column) + '</td><td>' + esc(c.oldValue) + '</td><td>' + esc(c.newValue) + '</td></tr>').join('') + '</tbody>' : '';
      if (n) for (const label of doc.querySelectorAll('#kpis .k-label')) {
        if (label.textContent === 'History preserved') {
          label.textContent = 'Historical statistics preserved';
          const sub = label.parentElement.querySelector('.sub');
          if (sub) sub.textContent = 'Name capitalization applied across history';
        }
        if (label.textContent === 'Cells changing') {
          const sub = label.parentElement.querySelector('.sub');
          if (sub) sub.textContent = 'Source updates + whole-file name formatting';
        }
      }
    }
    wrapCore(core, () => select.value, result => root.queueMicrotask(() => renderSummary(result)));
    select.addEventListener('change', () => {
      try { root.localStorage.setItem(STORAGE_KEY, modeOf(select.value)); storageWarning = ''; }
      catch (_) { storageWarning = 'This preference is session-only because browser storage is unavailable.'; }
      // Use the builder's existing invalidation path without changing the date itself.
      doc.getElementById('publicationDate').dispatchEvent(new root.Event('input', { bubbles: true }));
      doc.getElementById('nameCapitalizationReview').hidden = true;
      status.textContent = 'Rebuild the preview to apply this option across the entire output file. ' + storageWarning;
    });
    status.textContent = 'Choose an option, then build the preview. ' + storageWarning;
  }
  return { formatName, normalizeResult, wrapCore, mount, modeOf, STORAGE_KEY };
});
