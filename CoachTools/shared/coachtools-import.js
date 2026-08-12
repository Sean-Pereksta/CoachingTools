(function attachCoachToolsImport(root) {
  'use strict';

  const SOURCE_ORDER = Object.freeze(['coaching', 'retail', 'referral', 'qa', 'checklist']);
  const SOURCES = Object.freeze({
    coaching: Object.freeze({
      id: 'coaching',
      label: 'Documented Coaching',
      key: 'myone2.dock.coaching',
      header: 'Job Coach'
    }),
    retail: Object.freeze({
      id: 'retail',
      label: 'Retail Stats',
      key: 'myone2.dock.retail',
      header: 'Sheet'
    }),
    referral: Object.freeze({
      id: 'referral',
      label: 'Referral Stats',
      key: 'myone2.dock.referral',
      header: 'Sheet'
    }),
    qa: Object.freeze({
      id: 'qa',
      label: 'QA',
      key: 'myone2.dock.qa',
      header: 'Team'
    }),
    checklist: Object.freeze({
      id: 'checklist',
      label: 'Checklist',
      key: 'myone2.dock.checklist',
      header: 'Coach Assigned'
    })
  });
  const SUPPORTED_EXTENSIONS = Object.freeze(['.xlsx', '.xls', '.csv']);

  function display(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function normalizeName(value) {
    return display(value).replace(/,/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  }

  function normalizeHeader(value) {
    return display(value).toLowerCase();
  }

  function isBlank(value) {
    return value == null || (typeof value === 'string' && !value.trim());
  }

  function extensionOf(fileOrName) {
    const name = typeof fileOrName === 'string' ? fileOrName : fileOrName && fileOrName.name;
    const match = String(name || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
    return match ? match[1] : '';
  }

  function isSupportedFile(fileOrName) {
    return SUPPORTED_EXTENSIONS.includes(extensionOf(fileOrName));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function trimAOA(aoa) {
    if (!Array.isArray(aoa) || !aoa.length) return Array.isArray(aoa) ? aoa : [];
    let lastRow = aoa.length - 1;
    while (lastRow >= 0 && !(aoa[lastRow] || []).some(cell => !isBlank(cell))) lastRow -= 1;
    const rows = aoa.slice(0, lastRow + 1);
    let lastColumn = -1;
    for (const row of rows) {
      for (let column = (row || []).length - 1; column >= 0; column -= 1) {
        if (!isBlank(row[column])) {
          lastColumn = Math.max(lastColumn, column);
          break;
        }
      }
    }
    return lastColumn < 0 ? [] : rows.map(row => Array.isArray(row) ? row.slice(0, lastColumn + 1) : []);
  }

  async function readWorkbook(file) {
    if (!root.XLSX) throw new Error('SheetJS could not load.');
    if (!file || !isSupportedFile(file)) throw new Error('Choose an XLSX, XLS, or CSV file.');
    const extension = extensionOf(file);
    if (extension === '.csv' || file.type === 'text/csv') {
      return root.XLSX.read(await file.text(), { type: 'string' });
    }
    return root.XLSX.read(await file.arrayBuffer(), { type: 'array' });
  }

  async function parseFile(file, options) {
    const workbook = await readWorkbook(file);
    const sheets = workbook.SheetNames || [];
    const data = {};
    let totalRows = 0;
    const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : null;
    for (let index = 0; index < sheets.length; index += 1) {
      const name = sheets[index];
      const aoa = trimAOA(root.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }));
      data[name] = { aoa };
      totalRows += aoa.length;
      if (onProgress) onProgress({ phase: 'reading-sheet', fileName: file.name, sheetName: name, current: index + 1, total: sheets.length });
    }
    return {
      meta: {
        fileName: file.name,
        fileSize: Number(file.size) || 0,
        fileType: file.type || '',
        loadedAt: new Date().toISOString(),
        sheetsCount: sheets.length,
        totalRows
      },
      workbook: { sheets, data }
    };
  }

  function findHeader(aoa, wanted) {
    const normalizedWanted = normalizeHeader(wanted);
    for (let rowIndex = 0; rowIndex < Math.min(50, aoa && aoa.length || 0); rowIndex += 1) {
      const row = aoa[rowIndex];
      if (!Array.isArray(row)) continue;
      for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
        if (normalizeHeader(row[columnIndex]) === normalizedWanted) return { headerRow: rowIndex, colIndex: columnIndex };
      }
    }
    return null;
  }

  function inspectSourceHeaders(parsed) {
    const found = new Set();
    for (const source of SOURCE_ORDER) {
      const header = SOURCES[source].header;
      for (const sheetName of parsed && parsed.workbook && parsed.workbook.sheets || []) {
        if (findHeader(parsed.workbook.data[sheetName] && parsed.workbook.data[sheetName].aoa, header)) {
          found.add(source);
          break;
        }
      }
    }
    return found;
  }

  function classifyFile(file, parsed) {
    const name = String(file && file.name || parsed && parsed.meta && parsed.meta.fileName || '').toLowerCase();
    const filenameHints = [
      ['coaching', /documented[\s_.-]*coach|coach(?:ing)?[\s_.-]*documented|\bcoaching\b/],
      ['checklist', /\bcheck[\s_.-]*list\b|\bchecklist\b/],
      ['referral', /\breferral\b/],
      ['retail', /\bretail\b/],
      ['qa', /(?:^|[^a-z])qa(?:[^a-z]|$)|\bquality\b/]
    ];
    for (const [id, pattern] of filenameHints) {
      if (pattern.test(name)) {
        return { id, confidence: 'high', reason: 'filename', candidates: [id] };
      }
    }

    const found = inspectSourceHeaders(parsed);
    if (found.has('coaching')) return { id: 'coaching', confidence: 'high', reason: 'header', candidates: ['coaching'] };
    if (found.has('checklist')) return { id: 'checklist', confidence: 'high', reason: 'header', candidates: ['checklist'] };
    if (found.has('qa') && !found.has('retail') && !found.has('referral')) {
      return { id: 'qa', confidence: 'high', reason: 'header', candidates: ['qa'] };
    }
    const candidates = SOURCE_ORDER.filter(id => found.has(id));
    return {
      id: null,
      confidence: candidates.length ? 'ambiguous' : 'unknown',
      reason: candidates.length ? 'multiple-compatible-headers' : 'no-compatible-header',
      candidates
    };
  }

  function convertCoachingDateHeader(parsed) {
    for (const name of parsed && parsed.workbook && parsed.workbook.sheets || []) {
      const aoa = parsed.workbook.data[name] && parsed.workbook.data[name].aoa;
      if (!Array.isArray(aoa)) continue;
      for (let rowIndex = 0; rowIndex < aoa.length; rowIndex += 1) {
        const row = aoa[rowIndex];
        if (!Array.isArray(row) || !row.some(cell => !isBlank(cell))) continue;
        for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
          if (normalizeHeader(row[columnIndex]) === 'coaching date') row[columnIndex] = 'Date';
        }
        break;
      }
    }
    return parsed;
  }

  function scopeNames(scope) {
    if (!scope || scope.mode === 'all') return [];
    return Array.isArray(scope.coaches) ? scope.coaches.map(normalizeName).filter(Boolean) : [];
  }

  function prepareDataset(parsed, source, options) {
    if (!SOURCES[source]) throw new Error('Unknown CoachTools source: ' + source);
    const prepared = clone(parsed);
    if (source === 'coaching') convertCoachingDateHeader(prepared);
    const selectedNames = new Set(scopeNames(options && options.scope));
    let matchedRows = 0;
    let totalRows = 0;

    for (const sheetName of prepared.workbook.sheets) {
      const sheet = prepared.workbook.data[sheetName];
      const aoa = sheet && sheet.aoa;
      if (!Array.isArray(aoa)) continue;
      if (!selectedNames.size) {
        totalRows += aoa.length;
        continue;
      }
      const header = findHeader(aoa, SOURCES[source].header);
      if (!header) {
        totalRows += aoa.length;
        continue;
      }
      const headerRows = aoa.slice(0, header.headerRow + 1);
      const selectedRows = aoa.slice(header.headerRow + 1).filter(row => {
        const matches = Array.isArray(row) && selectedNames.has(normalizeName(row[header.colIndex]));
        if (matches) matchedRows += 1;
        return matches;
      });
      sheet.aoa = headerRows.concat(selectedRows);
      totalRows += sheet.aoa.length;
    }

    prepared.meta = {
      ...(prepared.meta || {}),
      source,
      sourceLabel: SOURCES[source].label,
      totalRows,
      automaticImport: true,
      automaticImportScope: selectedNames.size ? Array.from(selectedNames) : [],
      automaticImportMatchedRows: matchedRows
    };
    return prepared;
  }

  function packDataset(dataset) {
    if (!root.LZString || typeof root.LZString.compressToUTF16 !== 'function') {
      throw new Error('LZ-String could not load.');
    }
    return root.LZString.compressToUTF16(JSON.stringify(dataset));
  }

  root.CoachToolsImport = Object.freeze({
    VERSION: '1.0.0',
    SOURCE_ORDER,
    SOURCES,
    SUPPORTED_EXTENSIONS,
    display,
    normalizeName,
    normalizeHeader,
    isBlank,
    extensionOf,
    isSupportedFile,
    clone,
    trimAOA,
    readWorkbook,
    parseFile,
    findHeader,
    inspectSourceHeaders,
    classifyFile,
    convertCoachingDateHeader,
    scopeNames,
    prepareDataset,
    packDataset
  });
})(window);
