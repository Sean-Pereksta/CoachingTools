(function bootstrapPerformanceScorecardUploadMode(root) {
  'use strict';

  const doc = root.document || null;
  const CORE_FILE = 'performance-scorecard-upload-mode-core.js';
  const DIRECT_NAME_HEADERS = new Set([
    'agentname', 'representative', 'representativename', 'associatename', 'associate',
    'employeename', 'employee', 'repname', 'rep', 'csrname', 'ssrname', 'name'
  ]);
  const KPI_HEADER_ALIASES = Object.freeze({
    cashappts: 'Cash Apps', cashappt: 'Cash Apps', cashappointmentcount: 'Cash Apps',
    consumerappts: 'Consumer Apps', consumerappt: 'Consumer Apps', consumerappointmentcount: 'Consumer Apps',
    insuranceappts: 'Insurance Apps', insuranceappt: 'Insurance Apps', insuranceappointmentcount: 'Insurance Apps',
    commercialappts: 'Commercial Apps', commercialappt: 'Commercial Apps', commercialappointmentcount: 'Commercial Apps',
    referralappts: 'Referral Apps', referralappt: 'Referral Apps', referralappointmentcount: 'Referral Apps',
    cashopportunitycount: 'Cash Opps', consumeropportunitycount: 'Consumer Opps',
    insuranceopportunitycount: 'Insurance Opps', commercialopportunitycount: 'Commercial Opps',
    referralopportunitycount: 'Referral Opps'
  });

  function clean(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }
  function normalizeHeader(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9%]/g, '');
  }
  function normalizeId(value) {
    return clean(value).toLowerCase().replace(/\.0+$/, '').replace(/[^a-z0-9]/g, '');
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
    if (cols.direct >= 0) return clean(values && values[cols.direct]);
    if (cols.first >= 0 && cols.last >= 0) return clean([values && values[cols.first], values && values[cols.last]].filter(value => clean(value)).join(' '));
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
      if (has(/^(cash|consumer).*(opps|opportunities|apps|appts|appointments)$/)) score += 24;
      if (has(/^insurance.*(opps|opportunities|apps|appts|appointments)$/)) score += 20;
      if (has(/^commercial.*(opps|opportunities|apps|appts|appointments)$/)) score += 20;
    }
    if (sheet.includes('phone') && has(/avaya|phone|agent|first|last|surname/)) score += 14;
    if (sheet.includes('wiper') && has(/wiper|accept|declin|asked|jobs|count/)) score += 18;
    if (has(/date|week|period/)) score += 3;
    return score;
  }
  function findIdentityHeaderRow(matrix) {
    let bestIndex = -1;
    let bestScore = -1;
    const limit = Math.min(120, (matrix || []).length);
    for (let i = 0; i < limit; i++) {
      const score = identityHeaderScore(matrix[i]);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    return bestIndex;
  }
  function findWorkbookHeaderRow(matrix, sheetName) {
    let bestIndex = -1;
    let bestScore = -1;
    const limit = Math.min(120, (matrix || []).length);
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
      return enrichMatrixWithIdentity(result, sheet && sheet.__coachtoolsSheetName || '', workbookIdentity);
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
    script.addEventListener('error', () => console.error('[Performance Scorecard] workbook core failed to load.'), { once: true });
    doc.head.appendChild(script);
  }

  root.CoachToolsPerformanceScorecardHeaderDetector = Object.freeze({
    normalizeHeader,
    normalizeId,
    identityHeaderScore,
    workbookHeaderScore,
    findIdentityHeaderRow,
    findWorkbookHeaderRow,
    trimMatrixToIdentityHeader,
    buildIdentityFromMatrices,
    enrichMatrixWithIdentity,
    patchXlsx
  });

  watchForLazyXlsx();
  loadCore();
})(typeof window !== 'undefined' ? window : globalThis);
