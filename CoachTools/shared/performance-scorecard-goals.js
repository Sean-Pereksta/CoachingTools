(function installPerformanceScorecardGoals(root) {
  'use strict';

  const STORAGE_KEY = 'coachtools.performanceScorecard.goals.v1';
  const EVENT_NAME = 'coachtools:scorecard-goals-changed';
  const DEFAULTS = Object.freeze({
    'consumer-rate': Object.freeze({ id: 'consumer-rate', label: 'Consumer AR', goal: 0.47, direction: 'higher', format: 'percent', step: 0.1 }),
    'insurance-rate': Object.freeze({ id: 'insurance-rate', label: 'Insurance AR', goal: 0.92, direction: 'higher', format: 'percent', step: 0.1 }),
    'commercial-rate': Object.freeze({ id: 'commercial-rate', label: 'Commercial AR', goal: 0.85, direction: 'higher', format: 'percent', step: 0.1 }),
    'referral-rate': Object.freeze({ id: 'referral-rate', label: 'Referral AR', goal: 0.47, direction: 'higher', format: 'percent', step: 0.1 }),
    'wiper-rate': Object.freeze({ id: 'wiper-rate', label: 'Wiper Rate', goal: 0.23, direction: 'higher', format: 'percent', step: 0.1 }),
    'call-quality': Object.freeze({ id: 'call-quality', label: 'Call Quality / QA', goal: 0.85, direction: 'higher', format: 'percent', step: 0.1 }),
    'consumer-opps': Object.freeze({ id: 'consumer-opps', label: 'Consumer Opps', goal: null, direction: 'higher', format: 'count', step: 1 }),
    'insurance-opps': Object.freeze({ id: 'insurance-opps', label: 'Insurance Opps', goal: null, direction: 'higher', format: 'count', step: 1 }),
    'commercial-opps': Object.freeze({ id: 'commercial-opps', label: 'Commercial Opps', goal: null, direction: 'higher', format: 'count', step: 1 }),
    'wiper-volume': Object.freeze({ id: 'wiper-volume', label: 'Wiper Volume', goal: null, direction: 'higher', format: 'count', step: 1 }),
    'qa-monitors': Object.freeze({ id: 'qa-monitors', label: 'QA Monitors', goal: 1, direction: 'higher', format: 'count', step: 1 }),
    'coaching-30': Object.freeze({ id: 'coaching-30', label: 'Coachings 30d', goal: 1, direction: 'higher', format: 'count', step: 1 }),
    'checklist-30': Object.freeze({ id: 'checklist-30', label: 'Checklist 30d', goal: null, direction: 'higher', format: 'count', step: 1 }),
    'open-checklist': Object.freeze({ id: 'open-checklist', label: 'Open Checklist', goal: 0, direction: 'lower', format: 'count', step: 1 }),
    'days-since-coaching': Object.freeze({ id: 'days-since-coaching', label: 'Last Coaching', goal: 7, direction: 'lower', format: 'duration', step: 1 }),
    'kpi-history': Object.freeze({ id: 'kpi-history', label: 'KPI History', goal: 4, direction: 'higher', format: 'count', step: 1 })
  });
  const ALIASES = Object.freeze({
    consumer: 'consumer-rate', insurance: 'insurance-rate', commercial: 'commercial-rate',
    referral: 'referral-rate', wiper: 'wiper-rate', qa: 'call-quality'
  });

  function canonicalId(id) {
    const key = String(id == null ? '' : id).trim();
    return ALIASES[key] || key;
  }
  function load() {
    try {
      const parsed = JSON.parse(root.localStorage?.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  }
  let overrides = load();
  function persist() {
    try { root.localStorage?.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch (_) {}
  }
  function definition(id) {
    const canonical = canonicalId(id), base = DEFAULTS[canonical];
    if (!base) return null;
    const saved = overrides[canonical] && typeof overrides[canonical] === 'object' ? overrides[canonical] : {};
    const goal = saved.goal === null || Number.isFinite(Number(saved.goal)) ? (saved.goal === null ? null : Number(saved.goal)) : base.goal;
    const direction = saved.direction === 'lower' || saved.direction === 'higher' ? saved.direction : base.direction;
    return { ...base, goal, direction };
  }
  function dispatch(id) {
    if (typeof root.dispatchEvent !== 'function' || typeof root.CustomEvent !== 'function') return;
    root.dispatchEvent(new root.CustomEvent(EVENT_NAME, { detail: { id: canonicalId(id), definition: definition(id) } }));
  }
  function set(id, changes) {
    const canonical = canonicalId(id), base = DEFAULTS[canonical];
    if (!base) return null;
    const current = definition(canonical), next = { goal: current.goal, direction: current.direction };
    if (changes && Object.prototype.hasOwnProperty.call(changes, 'goal')) {
      const value = changes.goal;
      next.goal = value === '' || value == null ? null : Number(value);
      if (next.goal !== null && !Number.isFinite(next.goal)) return current;
    }
    if (changes?.direction === 'higher' || changes?.direction === 'lower') next.direction = changes.direction;
    overrides[canonical] = next;
    persist();
    dispatch(canonical);
    return definition(canonical);
  }
  function reset(id) {
    const canonical = canonicalId(id);
    delete overrides[canonical];
    persist();
    dispatch(canonical);
    return definition(canonical);
  }
  function resetAll() {
    overrides = {};
    persist();
    dispatch('*');
  }
  function evaluate(id, value) {
    const config = definition(id), numeric = Number(value);
    if (!config || !Number.isFinite(numeric) || !Number.isFinite(config.goal)) return 'neutral';
    return config.direction === 'lower' ? (numeric <= config.goal ? 'success' : 'opportunity') : (numeric >= config.goal ? 'success' : 'opportunity');
  }
  function inputValue(id) {
    const config = definition(id);
    if (!config || !Number.isFinite(config.goal)) return '';
    return config.format === 'percent' ? String(Math.round(config.goal * 1000) / 10) : String(config.goal);
  }
  function fromInput(id, value) {
    const config = definition(id);
    if (!config || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return NaN;
    return config.format === 'percent' ? numeric / 100 : numeric;
  }
  function format(id, value) {
    const config = definition(id), numeric = value === undefined ? config?.goal : Number(value);
    if (!config || !Number.isFinite(numeric)) return 'No goal';
    if (config.format === 'percent') return `${(numeric * 100).toFixed(1)}%`;
    if (config.format === 'duration') return `${Math.round(numeric)}d`;
    return Number.isInteger(numeric) ? numeric.toLocaleString() : numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  root.CoachToolsPerformanceScorecardGoals = Object.freeze({
    VERSION: '1.0.0', STORAGE_KEY, EVENT_NAME, DEFAULTS, canonicalId, definition, set, reset, resetAll,
    evaluate, inputValue, fromInput, format
  });
})(typeof window !== 'undefined' ? window : globalThis);

(function installPerformanceScorecardMissingColumnFilter(root) {
  'use strict';

  const doc = root.document || null;
  const STORAGE_KEY = 'coachtools.performanceScorecard.missingColumns.v1';
  const CONTROL_ID = 'missingColumnThresholdSel';
  const WRAPPED_FLAG = '__coachtoolsMissingColumnFilterWrapped';
  const INSTALL_RETRY_MS = 100;
  const MAX_INSTALL_ATTEMPTS = 120;
  let threshold = loadThreshold();
  let lastStats = { before: 0, after: 0, columns: 0, threshold: 0 };
  let tableObserver = null;

  function loadThreshold() {
    try {
      const value = Number(root.localStorage?.getItem(STORAGE_KEY));
      return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 0;
    } catch (_) { return 0; }
  }
  function saveThreshold() {
    try {
      if (threshold > 0) root.localStorage?.setItem(STORAGE_KEY, String(threshold));
      else root.localStorage?.removeItem(STORAGE_KEY);
    } catch (_) {}
  }
  function scorecardReady() {
    if (!doc) return false;
    const meta = doc.querySelector('meta[name="coachtools-id"]');
    if (!meta || meta.content !== 'performance-scorecard') return false;
    return typeof getRows === 'function' && typeof render === 'function' && typeof sortValue === 'function' &&
      typeof visibleColumn === 'function' && typeof state === 'object' && Boolean(state && state.config) &&
      Boolean(doc.querySelector('#scorecardWorkspace .workspaceTools'));
  }
  function selectedDataColumns() {
    if (!scorecardReady()) return [];
    const department = doc.getElementById('departmentSel')?.value || 'All';
    return (state.config?.columns || []).filter(id => id && id !== 'representative' && visibleColumn(id, department));
  }
  function columnAppliesToRow(row, id) {
    try {
      const builtin = typeof BUILTINS === 'object' && BUILTINS ? BUILTINS[id] : null;
      const requiredDepartment = builtin?.dept;
      if (!requiredDepartment || typeof personDepartment !== 'function') return true;
      return personDepartment(row.rep) === requiredDepartment;
    } catch (_) { return true; }
  }
  function valueIsPresent(row, id) {
    let value;
    try { value = sortValue(row, id); } catch (_) { return false; }
    if (Number.isFinite(value)) return true;
    return typeof value === 'string' && value.trim() !== '';
  }
  function missingCount(row, columns) {
    return (columns || selectedDataColumns()).reduce((count, id) => {
      if (!columnAppliesToRow(row, id)) return count;
      return count + (valueIsPresent(row, id) ? 0 : 1);
    }, 0);
  }
  function applyFilter(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const columns = selectedDataColumns();
    const active = threshold > 0 && columns.length > 0;
    const filtered = active ? list.filter(row => missingCount(row, columns) < threshold) : list;
    lastStats = { before: list.length, after: filtered.length, columns: columns.length, threshold };
    queueControlSync();
    return filtered;
  }
  function setThreshold(value, rerender = true) {
    const numeric = Number(value);
    threshold = Number.isFinite(numeric) && numeric >= 1 ? Math.floor(numeric) : 0;
    saveThreshold();
    syncControl();
    if (rerender && scorecardReady()) render();
    return threshold;
  }
  function thresholdOptions(columnCount) {
    const max = Math.max(0, Number(columnCount) || 0);
    const values = Array.from({ length: max }, (_, index) => index + 1);
    if (threshold > max && threshold > 0) values.push(threshold);
    return ['<option value="0">Off — show all</option>', ...values.map(value => {
      const selected = value === threshold ? ' selected' : '';
      const suffix = value > max ? ` (${max} columns shown)` : '';
      return `<option value="${value}"${selected}>${value}+ missing${suffix}</option>`;
    })].join('');
  }
  function ensureControl() {
    if (!scorecardReady()) return null;
    const tools = doc.querySelector('#scorecardWorkspace .workspaceTools');
    if (!tools) return null;
    let control = doc.getElementById('missingColumnFilterControl');
    if (!control) {
      control = doc.createElement('div');
      control.id = 'missingColumnFilterControl';
      control.className = 'sortCtl';
      control.title = 'Hide a representative when this many displayed statistic columns have no data. A real zero counts as data. Columns that do not apply to that representative are ignored.';
      control.innerHTML = `Missing columns <select id="${CONTROL_ID}" aria-label="Hide representatives by missing column count"></select><span id="missingColumnFilterMeta" style="font-size:11px;opacity:.72;white-space:nowrap"></span>`;
      const sortControl = tools.querySelector('.sortCtl');
      tools.insertBefore(control, sortControl || null);
      doc.getElementById(CONTROL_ID)?.addEventListener('change', event => setThreshold(event.target.value, true));
    }
    return control;
  }
  function syncControl() {
    const control = ensureControl();
    if (!control) return;
    const select = doc.getElementById(CONTROL_ID);
    const columns = selectedDataColumns();
    if (select) {
      const next = thresholdOptions(columns.length);
      if (select.innerHTML !== next) select.innerHTML = next;
      select.value = String(threshold);
    }
    const meta = doc.getElementById('missingColumnFilterMeta');
    if (meta) {
      const hidden = Math.max(0, (lastStats.before || 0) - (lastStats.after || 0));
      if (threshold <= 0) meta.textContent = `${columns.length} stats`;
      else if (threshold > columns.length) meta.textContent = `0 hidden · only ${columns.length} stats shown`;
      else meta.textContent = `${hidden} hidden`;
    }
  }
  function queueControlSync() {
    if (!doc) return;
    if (typeof root.queueMicrotask === 'function') root.queueMicrotask(syncControl);
    else root.setTimeout(syncControl, 0);
  }
  function wrapRows() {
    if (getRows && getRows[WRAPPED_FLAG]) return;
    const original = getRows;
    const wrapped = function coachtoolsFilteredScorecardRows() {
      return applyFilter(original.apply(this, arguments));
    };
    Object.defineProperty(wrapped, WRAPPED_FLAG, { value: true });
    Object.defineProperty(wrapped, '__coachtoolsOriginalGetRows', { value: original });
    getRows = wrapped;
  }
  function observeScorecard() {
    if (tableObserver || !root.MutationObserver) return;
    const tableBody = doc.getElementById('tableBody');
    if (!tableBody) return;
    tableObserver = new root.MutationObserver(queueControlSync);
    tableObserver.observe(tableBody, { childList: true, subtree: false });
  }
  function install(attempt = 0) {
    if (!scorecardReady()) {
      if (attempt < MAX_INSTALL_ATTEMPTS) root.setTimeout(() => install(attempt + 1), INSTALL_RETRY_MS);
      return;
    }
    wrapRows();
    ensureControl();
    observeScorecard();
    syncControl();
    render();
    root.CoachToolsPerformanceScorecardMissingColumns = Object.freeze({
      STORAGE_KEY,
      getThreshold: () => threshold,
      setThreshold,
      selectedDataColumns: () => selectedDataColumns().slice(),
      missingCount: row => missingCount(row),
      stats: () => ({ ...lastStats })
    });
  }

  if (!doc) return;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => install(), { once: true });
  else install();
})(typeof window !== 'undefined' ? window : globalThis);
