(function bootstrapPerformanceScorecardUploadMode(root) {
  'use strict';

  const doc = root.document || null;
  const CORE_FILE = 'performance-scorecard-upload-mode-core.js';
  const DIRECT_NAME_HEADERS = new Set([
    'agentname', 'representative', 'representativename', 'associatename', 'associate',
    'employeename', 'employee', 'repname', 'rep', 'csrname', 'ssrname', 'name'
  ]);

  function clean(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }
  function normalizeHeader(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9%]/g, '');
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
  function findIdentityHeaderRow(matrix) {
    let bestIndex = -1;
    let bestScore = -1;
    const limit = Math.min(120, (matrix || []).length);
    for (let i = 0; i < limit; i++) {
      const score = identityHeaderScore(matrix[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return bestIndex;
  }
  function trimMatrixToIdentityHeader(matrix) {
    if (!Array.isArray(matrix) || !matrix.length) return matrix;
    const headerIndex = findIdentityHeaderRow(matrix);
    return headerIndex > 0 ? matrix.slice(headerIndex) : matrix;
  }
  function patchXlsx(XLSX) {
    if (!XLSX || !XLSX.utils || typeof XLSX.utils.sheet_to_json !== 'function') return false;
    const original = XLSX.utils.sheet_to_json;
    if (original.__coachtoolsIdentityHeaderAware) return true;
    function headerAwareSheetToJson(sheet, options) {
      const result = original.call(this, sheet, options);
      if (!options || options.header !== 1 || !Array.isArray(result)) return result;
      return trimMatrixToIdentityHeader(result);
    }
    headerAwareSheetToJson.__coachtoolsIdentityHeaderAware = true;
    headerAwareSheetToJson.__coachtoolsOriginal = original;
    XLSX.utils.sheet_to_json = headerAwareSheetToJson;
    return true;
  }
  function watchForLazyXlsx() {
    if (root.XLSX) {
      patchXlsx(root.XLSX);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(root, 'XLSX');
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
    try {
      Object.defineProperty(root, 'XLSX', {
        configurable: true,
        enumerable: true,
        get() { return stored; },
        set(value) {
          stored = value;
          patchXlsx(value);
          try {
            Object.defineProperty(root, 'XLSX', { configurable: true, enumerable: true, writable: true, value });
          } catch (_) {}
        }
      });
    } catch (_) {}
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
    identityHeaderScore,
    findIdentityHeaderRow,
    trimMatrixToIdentityHeader,
    patchXlsx
  });

  watchForLazyXlsx();
  loadCore();
})(typeof window !== 'undefined' ? window : globalThis);
