(function bootstrapPerformanceScorecardUploadMode(root) {
  'use strict';

  const doc = root.document || null;
  const CORE_FILE = 'performance-scorecard-upload-mode-core.js';
  const HEADER_SCAN_LIMIT = 250;
  const SYSTEM_COLUMN_PREF_KEY = 'coachtools.performanceScorecard.systemColumns.v1';
  const DIRECT_NAME_HEADERS = new Set([
    'agentname', 'representative', 'representativename', 'associatename', 'associate',
    'employeename', 'employee', 'repname', 'rep', 'csrname', 'ssrname', 'name'
  ]);
  const KPI_HEADER_ALIASES = Object.freeze({
    cashappts: 'Cash Apps', cashappt: 'Cash Apps', cashapp: 'Cash Apps', cashappointment: 'Cash Apps', cashappointmentcount: 'Cash Apps',
    consumerappts: 'Consumer Apps', consumerappt: 'Consumer Apps', consumerapp: 'Consumer Apps', consumerappointment: 'Consumer Apps', consumerappointmentcount: 'Consumer Apps',
    insuranceappts: 'Insurance Apps', insuranceappt: 'Insurance Apps', insuranceapp: 'Insurance Apps', insuranceappointment: 'Insurance Apps', insuranceappointmentcount: 'Insurance Apps',
    commercialappts: 'Commercial Apps', commercialappt: 'Commercial Apps', commercialapp: 'Commercial Apps', commercialappointment: 'Commercial Apps', commercialappointmentcount: 'Commercial Apps',
    referralappts: 'Referral Apps', referralappt: 'Referral Apps', referralapp: 'Referral Apps', referralappointment: 'Referral Apps', referralappointmentcount: 'Referral Apps',
    cashopp: 'Cash Opps', cashopportunity: 'Cash Opps', cashoppscount: 'Cash Opps', cashopportunitycount: 'Cash Opps',
    consumeropp: 'Consumer Opps', consumeropportunity: 'Consumer Opps', consumeroppscount: 'Consumer Opps', consumeropportunitycount: 'Consumer Opps',
    insuranceopp: 'Insurance Opps', insuranceopportunity: 'Insurance Opps', insuranceoppscount: 'Insurance Opps', insuranceopportunitycount: 'Insurance Opps',
    commercialopp: 'Commercial Opps', commercialopportunity: 'Commercial Opps', commercialoppscount: 'Commercial Opps', commercialopportunitycount: 'Commercial Opps',
    referralopp: 'Referral Opps', referralopportunity: 'Referral Opps', referraloppscount: 'Referral Opps', referralopportunitycount: 'Referral Opps'
  });
  const workbookCompareState = { baseline: new Map(), label: '', capturedAt: 0 };
  let systemColumnPrefs = loadSystemColumnPrefs();
  let systemColumnApplyQueued = false;
  let workbookCompareQueued = false;
  let systemColumnObserverInstalled = false;
  let workbookCompareObserverInstalled = false;
  let runtimeClickCaptureInstalled = false;

  function clean(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }
  function normalizeHeader(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9%]/g, '');
  }
  function normalizeId(value) {
    return clean(value).toLowerCase().replace(/\.0+$/, '').replace(/[^a-z0-9]/g, '');
  }
  function normalizePersonDisplay(value) {
    const raw = clean(value);
    if (!raw) return '';
    const noEmail = raw.includes('@') && !raw.includes(' ') ? raw.split('@')[0].replace(/[._-]+/g, ' ') : raw;
    const comma = noEmail.match(/^\s*([^,]+),\s*(.+?)\s*$/);
    return clean(comma ? `${comma[2]} ${comma[1]}` : noEmail);
  }
  function normalizePersonKey(value) {
    return normalizePersonDisplay(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function localDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function monthWindowBounds(which, now) {
    const anchor = now instanceof Date && !Number.isNaN(now.getTime()) ? new Date(now) : new Date();
    const offset = which === 'last' ? -1 : 0;
    const first = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const firstSunday = new Date(first);
    firstSunday.setDate(first.getDate() + ((7 - first.getDay()) % 7));
    const lastSunday = new Date(last);
    lastSunday.setDate(last.getDate() - last.getDay());
    const weekEnd = new Date(lastSunday);
    weekEnd.setDate(lastSunday.getDate() + 6);
    return {
      start: localDateKey(firstSunday),
      end: localDateKey(last),
      weekEnd: localDateKey(weekEnd),
      monthKey: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`
    };
  }
  function headerIndexes(values) {
    const normalized = (values || []).map(normalizeHeader);
    const indexes = new Map();
    normalized.forEach((value, index) => { if (value && !indexes.has(value)) indexes.set(value, index); });
    return { normalized, indexes };
  }
  function matchingIndex(normalized, patterns) {
    for (let i = 0; i < normalized.length; i++) if (patterns.some(pattern => pattern.test(normalized[i]))) return i;
    return -1;
  }
  function nameColumns(values) {
    const { normalized } = headerIndexes(values);
    const direct = normalized.findIndex(value => DIRECT_NAME_HEADERS.has(value));
    const first = matchingIndex(normalized, [/^(agent)?first(name)?$/, /^given(name)?$/]);
    const last = matchingIndex(normalized, [/^(agent)?last(name)?$/, /^(agent)?surname$/, /^family(name)?$/]);
    return { direct, first, last, hasName: direct >= 0 || (first >= 0 && last >= 0) };
  }
  function nameFromCells(headers, values) {
    const cols = nameColumns(headers);
    if (cols.direct >= 0) return normalizePersonDisplay(values && values[cols.direct]);
    if (cols.first >= 0 && cols.last >= 0) return normalizePersonDisplay(clean([values && values[cols.first], values && values[cols.last]].filter(value => clean(value)).join(' ')));
    return '';
  }
  function idColumns(values) {
    const { normalized } = headerIndexes(values);
    return {
      employee: matchingIndex(normalized, [/^emplid$/, /^employeeid$/, /^employeeidentifier$/, /^agentid$/, /^associateid$/, /^personid$/]),
      phone: matchingIndex(normalized, [/^phoneid$/, /^avayaid$/, /^avaya$/, /^agentphoneid$/, /^telephoneid$/])
    };
  }
  function identityHeaderScore(values) {
    const headers = (values || []).map(normalizeHeader).filter(Boolean);
    if (!headers.length) return -1;
    const has = pattern => headers.some(value => pattern.test(value));
    const hasDirect = headers.some(value => DIRECT_NAME_HEADERS.has(value));
    const hasFirst = has(/^(agent)?first(name)?$|^given(name)?$/);
    const hasLast = has(/^(agent)?last(name)?$|^(agent)?surname$|^family(name)?$/);
    const hasPair = hasFirst && hasLast;
    if (!hasPair && !(hasDirect && headers.length >= 3)) return -1;

    let score = hasPair ? 100 : 80;
    if (has(/emplid|employeeid|agentid|phoneid|avayaid/)) score += 8;
    if (has(/date|week|period/)) score += 5;
    if (has(/cash|consumer/)) score += 6;
    if (has(/insurance/)) score += 6;
    if (has(/commercial/)) score += 6;
    if (has(/wiper|accept|declin|asked|jobs|count/)) score += 4;
    score += Math.min(headers.length, 25) / 10;
    return score;
  }
  function workbookHeaderScore(values, sheetName) {
    const headers = (values || []).map(normalizeHeader).filter(Boolean);
    if (!headers.length) return -1;
    const has = pattern => headers.some(value => pattern.test(value));
    const identity = identityHeaderScore(values);
    let score = identity >= 0 ? identity : 0;
    const sheet = normalizeHeader(sheetName);
    if (has(/^emplid$|^employeeid$|^phoneid$|^avayaid$/)) score += 10;
    if (sheet.includes('sv2') || sheet.includes('salesview')) {
      if (has(/^(cash|consumer).*(opps|opp|opportunities|opportunity|apps|app|appts|appt|appointments|appointment)$/)) score += 24;
      if (has(/^insurance.*(opps|opp|opportunities|opportunity|apps|app|appts|appt|appointments|appointment)$/)) score += 20;
      if (has(/^commercial.*(opps|opp|opportunities|opportunity|apps|app|appts|appt|appointments|appointment)$/)) score += 20;
    }
    if (sheet.includes('phone') && has(/avaya|phone|agent|first|last|surname/)) score += 14;
    if (sheet.includes('wiper') && has(/wiper|accept|declin|asked|jobs|count/)) score += 18;
    if (has(/date|week|period/)) score += 3;
    return score;
  }
  function scanLimit(matrix) {
    return Math.min(HEADER_SCAN_LIMIT, (matrix || []).length);
  }
  function findIdentityHeaderRow(matrix) {
    let bestIndex = -1;
    let bestScore = -1;
    const limit = scanLimit(matrix);
    for (let i = 0; i < limit; i++) {
      const score = identityHeaderScore(matrix[i]);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    return bestIndex;
  }
  function findWorkbookHeaderRow(matrix, sheetName) {
    let bestIndex = -1;
    let bestScore = -1;
    const limit = scanLimit(matrix);
    for (let i = 0; i < limit; i++) {
      const score = workbookHeaderScore(matrix[i], sheetName);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    return bestIndex;
  }
  function trimMatrixToIdentityHeader(matrix) {
    if (!Array.isArray(matrix) || !matrix.length) return matrix;
    const headerIndex = findIdentityHeaderRow(matrix);
    return headerIndex > 0 ? matrix.slice(headerIndex) : matrix;
  }
  function buildIdentityFromMatrices(sheets) {
    const identity = { employee: new Map(), phone: new Map() };
    for (const matrix of Object.values(sheets || {})) {
      if (!Array.isArray(matrix) || !matrix.length) continue;
      const headerIndex = findIdentityHeaderRow(matrix);
      if (headerIndex < 0) continue;
      const headers = matrix[headerIndex] || [];
      const ids = idColumns(headers);
      if (ids.employee < 0 && ids.phone < 0) continue;
      for (let r = headerIndex + 1; r < matrix.length; r++) {
        const values = matrix[r] || [];
        const name = nameFromCells(headers, values);
        if (!name) continue;
        if (ids.employee >= 0) {
          const key = normalizeId(values[ids.employee]);
          if (key && !identity.employee.has(key)) identity.employee.set(key, name);
        }
        if (ids.phone >= 0) {
          const key = normalizeId(values[ids.phone]);
          if (key && !identity.phone.has(key)) identity.phone.set(key, name);
        }
      }
    }
    return identity;
  }
  function buildWorkbookIdentity(workbook, sheetToJson) {
    const matrices = {};
    for (const name of (workbook && workbook.SheetNames) || []) {
      try {
        matrices[name] = sheetToJson(workbook.Sheets[name], { header: 1, defval: '', raw: true, blankrows: false });
      } catch (_) {}
    }
    return buildIdentityFromMatrices(matrices);
  }
  function enrichMatrixWithIdentity(matrix, sheetName, identity) {
    if (!Array.isArray(matrix) || !matrix.length) return matrix;
    const out = matrix.map(row => Array.isArray(row) ? row.slice() : []);
    const headerIndex = findWorkbookHeaderRow(out, sheetName);
    if (headerIndex < 0) return out;
    const headers = out[headerIndex];
    const normalized = headers.map(normalizeHeader);

    const aliasCopies = [];
    for (let c = 0; c < normalized.length; c++) {
      const canonical = KPI_HEADER_ALIASES[normalized[c]];
      if (!canonical || normalized.includes(normalizeHeader(canonical))) continue;
      aliasCopies.push({ source: c, target: headers.length + aliasCopies.length, canonical });
    }
    for (const alias of aliasCopies) headers[alias.target] = alias.canonical;
    for (let r = headerIndex + 1; r < out.length; r++) {
      for (const alias of aliasCopies) out[r][alias.target] = out[r][alias.source];
    }

    const cols = nameColumns(headers);
    const ids = idColumns(headers);
    const hasLookup = identity && ((identity.employee && identity.employee.size) || (identity.phone && identity.phone.size));
    if (!cols.hasName && hasLookup && (ids.employee >= 0 || ids.phone >= 0)) {
      const target = headers.length;
      headers[target] = 'Representative Name';
      for (let r = headerIndex + 1; r < out.length; r++) {
        const values = out[r] || [];
        let name = '';
        if (ids.employee >= 0 && identity.employee) name = identity.employee.get(normalizeId(values[ids.employee])) || '';
        if (!name && ids.phone >= 0 && identity.phone) name = identity.phone.get(normalizeId(values[ids.phone])) || '';
        values[target] = name;
      }
    }
    return out;
  }
  function hasDateHeader(headers) {
    return (headers || []).map(normalizeHeader).some(value => /(^date$|date$|^week(start|starting|beginning|end|ending)?$|^period(start|end)$)/.test(value));
  }
  function prepareWorkbookMatrix(matrix, sheetName, identity, manualDate) {
    const out = enrichMatrixWithIdentity(matrix, sheetName, identity);
    const headerIndex = findWorkbookHeaderRow(out, sheetName);
    if (headerIndex < 0) return out;
    const headers = out[headerIndex] || [];
    const assignedDate = clean(manualDate);
    if (assignedDate && /^\d{4}-\d{2}-\d{2}$/.test(assignedDate) && !hasDateHeader(headers)) {
      const target = headers.length;
      headers[target] = 'Week Start';
      for (let r = headerIndex + 1; r < out.length; r++) out[r][target] = assignedDate;
    }
    return headerIndex > 0 ? out.slice(headerIndex) : out;
  }
  function manualWorkbookDate() {
    return clean(doc && doc.getElementById('psUploadAsOfDate')?.value);
  }
  function patchXlsx(XLSX) {
    if (!XLSX || !XLSX.utils || typeof XLSX.utils.sheet_to_json !== 'function' || typeof XLSX.read !== 'function') return false;
    if (XLSX.__coachtoolsWorkbookAware) return true;
    const originalSheetToJson = XLSX.utils.sheet_to_json;
    const originalRead = XLSX.read;
    let workbookIdentity = { employee: new Map(), phone: new Map() };

    XLSX.read = function coachtoolsWorkbookRead() {
      const workbook = originalRead.apply(this, arguments);
      try {
        for (const name of workbook.SheetNames || []) {
          const sheet = workbook.Sheets && workbook.Sheets[name];
          if (sheet) Object.defineProperty(sheet, '__coachtoolsSheetName', { configurable: true, value: name });
        }
        workbookIdentity = buildWorkbookIdentity(workbook, originalSheetToJson);
      } catch (_) {
        workbookIdentity = { employee: new Map(), phone: new Map() };
      }
      return workbook;
    };
    XLSX.utils.sheet_to_json = function coachtoolsSheetToJson(sheet, options) {
      const result = originalSheetToJson.call(this, sheet, options);
      if (!options || options.header !== 1 || !Array.isArray(result)) return result;
      return prepareWorkbookMatrix(result, sheet && sheet.__coachtoolsSheetName || '', workbookIdentity, manualWorkbookDate());
    };
    XLSX.__coachtoolsWorkbookAware = true;
    return true;
  }
  function watchForLazyXlsx() {
    if (!doc) return;
    if (patchXlsx(root.XLSX)) return;
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) for (const node of mutation.addedNodes || []) {
        if (!node || node.tagName !== 'SCRIPT') continue;
        node.addEventListener('load', () => { if (patchXlsx(root.XLSX)) observer.disconnect(); }, { once: true });
      }
      if (patchXlsx(root.XLSX)) observer.disconnect();
    });
    observer.observe(doc.documentElement || doc, { childList: true, subtree: true });
  }
  function coreSource() {
    if (!doc) return '';
    let source = CORE_FILE;
    try {
      const current = doc.currentScript;
      if (current && current.src) source = new URL(CORE_FILE, current.src).href;
    } catch (_) {}
    return source;
  }
  function loadCore() {
    if (!doc) {
      if (typeof require === 'function') require('./performance-scorecard-upload-mode-core.js');
      return;
    }
    if (root.CoachToolsPerformanceScorecardUploadMode) return;
    const source = coreSource();
    if ([...doc.scripts].some(script => script.src === source || script.dataset.scorecardWorkbookCore === 'true')) return;
    const script = doc.createElement('script');
    script.src = source;
    script.async = false;
    script.dataset.scorecardWorkbookCore = 'true';
    script.addEventListener('load', () => installRuntimeEnhancements(), { once: true });
    script.addEventListener('error', () => console.error('[Performance Scorecard] workbook core failed to load.'), { once: true });
    doc.head.appendChild(script);
  }

  function installMonthWindows() {
    if (!doc) return;
    const select = doc.getElementById('windowSel');
    if (!select || select.dataset.monthWindowsInstalled === 'true') return;
    const custom = [...select.options].find(option => option.value === 'custom' && !option.dataset.monthWindow);
    if (!custom) return;
    const thisMonth = doc.createElement('option');
    thisMonth.value = 'custom'; thisMonth.textContent = 'This month'; thisMonth.dataset.monthWindow = 'this';
    const lastMonth = doc.createElement('option');
    lastMonth.value = 'custom'; lastMonth.textContent = 'Last month'; lastMonth.dataset.monthWindow = 'last';
    const fourWeek = [...select.options].find(option => option.value === '4');
    select.insertBefore(thisMonth, fourWeek || custom);
    select.insertBefore(lastMonth, fourWeek || custom);
    select.dataset.monthWindowsInstalled = 'true';
    select.addEventListener('change', () => {
      const option = select.options[select.selectedIndex];
      const monthMode = option && option.dataset.monthWindow;
      if (!monthMode) return;
      const bounds = monthWindowBounds(monthMode, new Date());
      const start = doc.getElementById('windowStart');
      const end = doc.getElementById('windowEnd');
      if (start) start.value = bounds.start;
      if (end) end.value = bounds.end;
    }, true);
  }

  function loadSystemColumnPrefs() {
    if (!doc || !root.localStorage) return { rank: true, status: true };
    try {
      const saved = JSON.parse(root.localStorage.getItem(SYSTEM_COLUMN_PREF_KEY) || '{}') || {};
      return { rank: saved.rank !== false, status: saved.status !== false };
    } catch (_) { return { rank: true, status: true }; }
  }
  function saveSystemColumnPrefs() {
    if (!doc || !root.localStorage) return;
    try { root.localStorage.setItem(SYSTEM_COLUMN_PREF_KEY, JSON.stringify(systemColumnPrefs)); } catch (_) {}
  }
  function systemColumnRow(key, label, description) {
    const checked = systemColumnPrefs[key] !== false;
    return `<div class="columnRow" data-scorecard-system-column="${key}"><input type="checkbox" data-system-col-toggle="${key}" ${checked ? 'checked' : ''}/><label>${label}<small>${description}</small></label><div class="moveBtns"><button type="button" data-system-col-remove="${key}" ${checked ? '' : 'disabled'}>×</button></div></div>`;
  }
  function installSystemColumnControls() {
    if (!doc || doc.getElementById('scorecardSystemColumnsBox')) return;
    const visibleBox = doc.querySelector('#drawer .drawerBody .box');
    if (!visibleBox || !visibleBox.parentNode) return;
    const box = doc.createElement('section');
    box.className = 'box';
    box.id = 'scorecardSystemColumnsBox';
    box.innerHTML = `<h3>Rank & status columns</h3><div class="columnList" id="scorecardSystemColumnsList"></div>`;
    visibleBox.parentNode.insertBefore(box, visibleBox.nextSibling);
    const render = () => {
      const list = doc.getElementById('scorecardSystemColumnsList');
      if (!list) return;
      list.innerHTML = systemColumnRow('rank', 'Overall Rank', 'Ranking Scorecard overall position') + systemColumnRow('status', 'Status', 'Performance status and reason');
    };
    render();
    box.addEventListener('change', event => {
      const input = event.target.closest('[data-system-col-toggle]');
      if (!input) return;
      systemColumnPrefs[input.dataset.systemColToggle] = Boolean(input.checked);
      saveSystemColumnPrefs(); render(); scheduleSystemColumnVisibility();
    });
    box.addEventListener('click', event => {
      const remove = event.target.closest('[data-system-col-remove]');
      if (!remove || remove.disabled) return;
      systemColumnPrefs[remove.dataset.systemColRemove] = false;
      saveSystemColumnPrefs(); render(); scheduleSystemColumnVisibility();
    });
  }
  function setTableColumnVisible(header, visible) {
    if (!header) return;
    const row = header.parentElement;
    if (!row) return;
    const index = [...row.children].indexOf(header);
    if (index < 0) return;
    header.style.display = visible ? '' : 'none';
    for (const bodyRow of doc.querySelectorAll('#tableBody tr')) {
      const cell = bodyRow.children[index];
      if (cell) cell.style.display = visible ? '' : 'none';
    }
  }
  function applySystemColumnVisibility() {
    if (!doc) return;
    const rankingActive = doc.getElementById('rankingViewBtn')?.getAttribute('aria-pressed') === 'true';
    const rankHeader = doc.querySelector('#tableHead [data-normal-rank-sort]');
    const statusHeader = doc.querySelector('#tableHead [data-sort="status"]');
    setTableColumnVisible(rankHeader, systemColumnPrefs.rank !== false);
    setTableColumnVisible(statusHeader, systemColumnPrefs.status !== false);
    const sort = doc.getElementById('sortSel');
    if (sort && !rankingActive) {
      const rankOption = [...sort.options].find(option => option.value === 'rank-overall');
      const statusOption = [...sort.options].find(option => option.value === 'status');
      if (rankOption) rankOption.hidden = systemColumnPrefs.rank === false;
      if (statusOption) statusOption.hidden = systemColumnPrefs.status === false;
      if ((sort.value === 'rank-overall' && systemColumnPrefs.rank === false) || (sort.value === 'status' && systemColumnPrefs.status === false)) {
        const rep = [...sort.options].find(option => option.value === 'representative');
        if (rep) {
          sort.value = 'representative';
          sort.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  }
  function scheduleSystemColumnVisibility() {
    if (!doc || systemColumnApplyQueued) return;
    systemColumnApplyQueued = true;
    const run = () => { systemColumnApplyQueued = false; applySystemColumnVisibility(); };
    if (root.requestAnimationFrame) root.requestAnimationFrame(run); else root.setTimeout(run, 0);
  }
  function watchSystemColumnVisibility() {
    if (!doc || systemColumnObserverInstalled) return;
    const head = doc.getElementById('tableHead');
    const body = doc.getElementById('tableBody');
    if (!head || !body) return;
    const observer = new MutationObserver(scheduleSystemColumnVisibility);
    observer.observe(head, { childList: true, subtree: true });
    observer.observe(body, { childList: true, subtree: true });
    systemColumnObserverInstalled = true;
    scheduleSystemColumnVisibility();
  }

  function parsePercentText(value) {
    const match = clean(value).match(/(-?\d+(?:\.\d+)?)\s*%/);
    return match ? Number(match[1]) / 100 : NaN;
  }
  function metricKeyForHeader(value) {
    const key = normalizeHeader(value);
    if (key === 'consumerar' || key === 'consumerappointmentrate') return 'consumer';
    if (key === 'insurancear' || key === 'insuranceappointmentrate') return 'insurance';
    if (key === 'commercialar' || key === 'commercialappointmentrate') return 'commercial';
    if (key === 'wipers' || key === 'wiperrate') return 'wiper';
    return '';
  }
  function captureScorecardBaseline() {
    if (!doc) return workbookCompareState;
    const head = doc.querySelector('#tableHead tr');
    if (!head || doc.getElementById('rankingViewBtn')?.getAttribute('aria-pressed') === 'true') return workbookCompareState;
    const headers = [...head.children], metricIndexes = [];
    headers.forEach((header, index) => {
      const metric = metricKeyForHeader(header.textContent);
      if (metric) metricIndexes.push({ metric, index });
    });
    if (!metricIndexes.length) return workbookCompareState;
    const baseline = new Map();
    for (const row of doc.querySelectorAll('#tableBody tr')) {
      const name = clean(row.querySelector('.repBtn')?.textContent);
      const personKey = normalizePersonKey(name);
      if (!personKey) continue;
      const metrics = {};
      for (const { metric, index } of metricIndexes) {
        const cell = row.children[index];
        const value = parsePercentText(cell?.querySelector('.metricMain')?.textContent || cell?.textContent);
        if (Number.isFinite(value)) metrics[metric] = value;
      }
      if (Object.keys(metrics).length) baseline.set(personKey, metrics);
    }
    if (baseline.size) {
      workbookCompareState.baseline = baseline;
      workbookCompareState.label = clean(doc.getElementById('workspaceMeta')?.textContent) || 'current Scorecard window';
      workbookCompareState.capturedAt = Date.now();
    }
    return workbookCompareState;
  }
  function installWorkbookComparisonUi() {
    if (!doc) return false;
    const overlay = doc.getElementById('psUploadOverlay');
    const actions = overlay?.querySelector('.psUploadActions');
    if (!overlay || !actions) return false;
    if (!doc.getElementById('psUploadAsOfDate')) {
      const dateCtl = doc.createElement('div');
      dateCtl.className = 'psUploadCtl';
      dateCtl.innerHTML = '<label>Workbook Date</label><input id="psUploadAsOfDate" type="date" />';
      const compareCtl = doc.createElement('div');
      compareCtl.className = 'psUploadCtl';
      compareCtl.innerHTML = '<label>Compare</label><select id="psUploadCompareMode"><option value="recent" selected>Recent Scorecard</option><option value="none">No comparison</option></select>';
      const chooseButton = doc.getElementById('psUploadChoose');
      actions.insertBefore(dateCtl, chooseButton || actions.firstChild);
      actions.insertBefore(compareCtl, chooseButton || actions.firstChild);
      doc.getElementById('psUploadAsOfDate').value = localDateKey(new Date());
      doc.getElementById('psUploadCompareMode').addEventListener('change', scheduleWorkbookComparison);
    }
    captureScorecardBaseline();
    scheduleWorkbookComparison();
    return true;
  }
  function ensureCompareHint() {
    if (!doc) return null;
    const notice = doc.getElementById('psUploadNotice');
    if (!notice) return null;
    let hint = doc.getElementById('psUploadCompareHint');
    if (!hint) {
      hint = doc.createElement('div');
      hint.id = 'psUploadCompareHint';
      hint.style.marginTop = '5px';
      notice.appendChild(hint);
    }
    return hint;
  }
  function comparisonMode() {
    return clean(doc && doc.getElementById('psUploadCompareMode')?.value) || 'recent';
  }
  function applyWorkbookComparison() {
    if (!doc) return;
    const hint = ensureCompareHint();
    for (const old of doc.querySelectorAll('.psUploadRecentCompare')) old.remove();
    if (comparisonMode() !== 'recent') {
      if (hint) hint.textContent = 'Recent-week comparison is off.';
      return;
    }
    if (!workbookCompareState.baseline.size) {
      if (hint) hint.textContent = 'No recent Scorecard baseline is available yet. Return to the normal Scorecard view, choose the recent-week window you want, then reopen Workbook Mode.';
      return;
    }
    const head = doc.querySelector('#psUploadTableHead tr');
    if (!head) return;
    const headers = [...head.children], metricIndexes = [];
    headers.forEach((header, index) => {
      const metric = metricKeyForHeader(header.textContent);
      if (metric) metricIndexes.push({ metric, index });
    });
    let compared = 0;
    for (const row of doc.querySelectorAll('#psUploadTableBody tr')) {
      const personKey = normalizePersonKey(row.children[0]?.querySelector('b')?.textContent || row.children[0]?.textContent);
      const baseline = workbookCompareState.baseline.get(personKey);
      if (!baseline) continue;
      for (const { metric, index } of metricIndexes) {
        const recent = baseline[metric];
        const cell = row.children[index];
        const current = parsePercentText(cell?.querySelector('.psUploadMetricMain')?.textContent || cell?.textContent);
        if (!Number.isFinite(current) || !Number.isFinite(recent) || !cell) continue;
        const delta = current - recent;
        const note = doc.createElement('div');
        note.className = `psUploadMetricSub psUploadRecentCompare ${delta >= 0 ? 'good' : 'bad'}`;
        note.textContent = `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta * 100).toFixed(1)} pp vs recent`;
        cell.appendChild(note);
        compared += 1;
      }
    }
    if (hint) hint.textContent = compared
      ? `Compared with ${workbookCompareState.label}. Workbook Date is used as the week date when the sheet itself has no usable date column.`
      : `Recent Scorecard baseline captured (${workbookCompareState.label}), but no matching representative KPI cells were available to compare.`;
  }
  function scheduleWorkbookComparison() {
    if (!doc || workbookCompareQueued) return;
    workbookCompareQueued = true;
    const run = () => { workbookCompareQueued = false; applyWorkbookComparison(); };
    if (root.requestAnimationFrame) root.requestAnimationFrame(run); else root.setTimeout(run, 0);
  }
  function watchWorkbookComparison() {
    if (!doc || workbookCompareObserverInstalled) return;
    const head = doc.getElementById('psUploadTableHead');
    const body = doc.getElementById('psUploadTableBody');
    if (!head || !body) return;
    const observer = new MutationObserver(scheduleWorkbookComparison);
    observer.observe(head, { childList: true, subtree: true });
    observer.observe(body, { childList: true, subtree: true });
    workbookCompareObserverInstalled = true;
  }

  function installRuntimeEnhancements() {
    if (!doc) return;
    installMonthWindows();
    installSystemColumnControls();
    watchSystemColumnVisibility();
    installWorkbookComparisonUi();
    watchWorkbookComparison();
    if (!runtimeClickCaptureInstalled) {
      doc.addEventListener('click', event => {
        if (event.target.closest('#psUploadModeBtn')) captureScorecardBaseline();
      }, true);
      runtimeClickCaptureInstalled = true;
    }
  }

  root.CoachToolsPerformanceScorecardHeaderDetector = Object.freeze({
    normalizeHeader,
    normalizeId,
    normalizePersonDisplay,
    identityHeaderScore,
    workbookHeaderScore,
    findIdentityHeaderRow,
    findWorkbookHeaderRow,
    trimMatrixToIdentityHeader,
    buildIdentityFromMatrices,
    enrichMatrixWithIdentity,
    prepareWorkbookMatrix,
    monthWindowBounds,
    patchXlsx
  });

  watchForLazyXlsx();
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => { installMonthWindows(); installSystemColumnControls(); watchSystemColumnVisibility(); }, { once: true });
    else { installMonthWindows(); installSystemColumnControls(); watchSystemColumnVisibility(); }
  }
  loadCore();
  if (doc && root.CoachToolsPerformanceScorecardUploadMode) installRuntimeEnhancements();
})(typeof window !== 'undefined' ? window : globalThis);
