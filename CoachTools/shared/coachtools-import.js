(function attachCoachToolsImport(root) {
  'use strict';

  const SOURCE_ORDER = Object.freeze(['documentedCoaching', 'weeklyRetail', 'weeklyReferral', 'qa', 'checklist']);
  const DATASET_ORDER = Object.freeze(['weeklyRetail', 'weeklyReferral', 'monthlyRetail', 'monthlyReferral', 'qa', 'documentedCoaching', 'checklist', 'compCoaching']);
  const sourceDefinitions = {
    documentedCoaching: Object.freeze({
      id: 'documentedCoaching',
      label: 'Documented Coaching',
      key: 'myone2.dock.coaching',
      header: 'Job Coach'
    }),
    weeklyRetail: Object.freeze({
      id: 'weeklyRetail',
      label: 'Retail Weekly',
      key: 'myone2.dock.retail',
      header: 'Sheet'
    }),
    weeklyReferral: Object.freeze({
      id: 'weeklyReferral',
      label: 'Referral Weekly',
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
    }),
    monthlyRetail: Object.freeze({ id: 'monthlyRetail', label: 'Retail Monthly', key: '', header: 'Representative' }),
    monthlyReferral: Object.freeze({ id: 'monthlyReferral', label: 'Referral Monthly', key: '', header: 'Representative' }),
    compCoaching: Object.freeze({ id: 'compCoaching', label: 'Comp Coaching', key: '', header: 'CSR/SSR Name' })
  };
  // Legacy aliases remain available to old generated loaders, but all new
  // classification and persistence uses the explicit central dataset names.
  sourceDefinitions.coaching = sourceDefinitions.documentedCoaching;
  sourceDefinitions.retail = sourceDefinitions.weeklyRetail;
  sourceDefinitions.referral = sourceDefinitions.weeklyReferral;
  const SOURCES = Object.freeze(sourceDefinitions);
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

  function normalizedFileName(value) {
    return display(value).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[_-]+/g, ' ').replace(/\b(?:final|copy)\b/g, ' ').replace(/\s+/g, ' ').trim();
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
        fileModifiedDate: file.lastModified ? new Date(file.lastModified).toISOString() : '',
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

  function workbookHeaderSet(parsed) {
    const headers = new Set();
    for (const sheetName of parsed && parsed.workbook && parsed.workbook.sheets || []) {
      const aoa = parsed.workbook.data[sheetName] && parsed.workbook.data[sheetName].aoa || [];
      for (let rowIndex = 0; rowIndex < Math.min(50, aoa.length); rowIndex += 1) {
        for (const cell of Array.isArray(aoa[rowIndex]) ? aoa[rowIndex] : []) {
          const normalized = normalizeHeader(cell);
          if (normalized) headers.add(normalized);
        }
      }
    }
    return headers;
  }

  function hasAny(headers, names) {
    return names.some(name => headers.has(normalizeHeader(name)));
  }

  function validateClassification(datasetType, parsed) {
    const headers = workbookHeaderSet(parsed);
    const rows = Number(parsed && parsed.meta && parsed.meta.totalRows) || 0;
    if (!rows || !headers.size) return { valid: false, reason: 'The workbook did not contain readable rows and headers.' };
    const identity = hasAny(headers, ['Sheet', 'Representative', 'Associate Name', 'Associate name', 'Agent Name', 'AgentName', 'Job Coach', 'Coach Assigned', 'Team']);
    const validators = {
      weeklyRetail: () => identity && (hasAny(headers, ['Sheet']) || hasAny(headers, ['Representative', 'Associate Name', 'Agent Name'])),
      weeklyReferral: () => identity && (hasAny(headers, ['Sheet']) || hasAny(headers, ['Representative', 'Associate Name', 'Agent Name'])),
      monthlyRetail: () => identity || hasAny(headers, ['Appt Summary', 'Cash Appointment Rate', 'Phone_ID']),
      monthlyReferral: () => identity || hasAny(headers, ['KPI Summary', 'Referral', 'Phone_ID']),
      qa: () => hasAny(headers, ['Team', 'Agent Name', 'AgentName']) && hasAny(headers, ['Score %', 'Score%', 'Evaluation Score', 'Assigned Date', 'Interaction Start Time']),
      documentedCoaching: () => hasAny(headers, ['Job Coach', 'Coach Assigned', 'Coach']) && hasAny(headers, ['Associate name', 'Associate Name', 'Representative', 'Agent Name', 'Coaching Date', 'Date']),
      checklist: () => hasAny(headers, ['Coach Assigned', 'Coach', 'Job Coach']) && hasAny(headers, ['Associate Name', 'Representative', 'Agent Name', 'Action', 'Item', 'Status']),
      compCoaching: () => hasAny(headers, ['CSR/SSR Name', 'CSR/SSR Name (This is the person being complimented)', 'Representative', 'Associate Name']) && hasAny(headers, ['Compliment', 'Comments', 'Notes', 'CSR Team/Coach', 'Coach Assigned'])
    };
    const valid = validators[datasetType] ? Boolean(validators[datasetType]()) : false;
    return { valid, reason: valid ? '' : `Expected ${SOURCES[datasetType] && SOURCES[datasetType].label || datasetType} fields were not found.` };
  }

  function datePartsFromName(fileName, fallbackYear) {
    const name = String(fileName || '');
    const yearMatch = name.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : Number(fallbackYear) || new Date().getFullYear();
    const range = name.match(/(?:^|\D)(1[0-2]|0?[1-9])[\s_.-]+(3[01]|[12]\d|0?[1-9])[\s]*(?:to|through|thru|-)[\s]*(1[0-2]|0?[1-9])[\s_.-]+(3[01]|[12]\d|0?[1-9])(?:\D|$)/i);
    if (!range) return null;
    const startMonth = Number(range[1]), startDay = Number(range[2]), endMonth = Number(range[3]), endDay = Number(range[4]);
    let startYear = year, endYear = year;
    if (endMonth < startMonth) endYear += 1;
    const ymd = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { startDate: ymd(startYear, startMonth, startDay), endDate: ymd(endYear, endMonth, endDay) };
  }

  function detectPeriod(fileOrName, datasetType) {
    const name = typeof fileOrName === 'string' ? fileOrName : fileOrName && fileOrName.name || '';
    const fallbackYear = typeof fileOrName === 'object' && fileOrName && fileOrName.lastModified ? new Date(fileOrName.lastModified).getFullYear() : new Date().getFullYear();
    const range = datePartsFromName(name, fallbackYear);
    if (range) return { ...range, label: `${range.startDate} – ${range.endDate}`, periodKey: range.startDate, sortKey: range.startDate };
    const singleDate = String(name).match(/(?:^|\D)(1[0-2]|0?[1-9])[\s_.-]+(3[01]|[12]\d|0?[1-9])(?:[\s_.-]+(20\d{2}))?(?:\D|$)/);
    if (singleDate && ['qa', 'documentedCoaching', 'checklist', 'compCoaching'].includes(datasetType)) {
      const year = Number(singleDate[3]) || fallbackYear;
      const key = `${year}-${String(Number(singleDate[1])).padStart(2, '0')}-${String(Number(singleDate[2])).padStart(2, '0')}`;
      return { startDate: key, endDate: key, label: key, periodKey: key, sortKey: key };
    }
    const months = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
    const monthMatch = normalizedFileName(name).match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/);
    if (monthMatch && ['monthlyRetail', 'monthlyReferral', 'compCoaching'].includes(datasetType)) {
      const explicitYear = String(name).match(/\b(20\d{2})\b/);
      const year = explicitYear ? Number(explicitYear[1]) : fallbackYear;
      const month = months[monthMatch[1]];
      const key = `${year}-${String(month).padStart(2, '0')}`;
      return { month: key, label: new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), periodKey: key, sortKey: key };
    }
    return { label: ['qa', 'documentedCoaching', 'checklist'].includes(datasetType) ? 'Current' : '', periodKey: 'current', sortKey: '' };
  }

  function classifyFile(file, parsed) {
    const originalName = String(file && file.name || parsed && parsed.meta && parsed.meta.fileName || '');
    const name = normalizedFileName(originalName);
    const filenameHints = [
      ['weeklyRetail', /\bretail\b.*\bweekly\b|\bweekly\b.*\bretail\b/],
      ['weeklyReferral', /\breferral\b.*\bweekly\b|\bweekly\b.*\breferral\b/],
      ['monthlyRetail', /\bappointment\b.*\breport\b/],
      ['monthlyReferral', /\bkpi\b.*\breport\b/],
      ['compCoaching', /\bcomp\s*(?:calls?|coaching)\b|\bcomp(?:liment)?\b.*\bcoach(?:ing)?\b|\bcompliments?\b/],
      ['documentedCoaching', /\bmyone\b|\bdocumented\b.*\bcoach(?:ing)?\b|\bcoach(?:ing)?\b.*\bdocumented\b|\bcoaching\b/],
      ['checklist', /\bcheck\s*list\b|\bchecklist\b|\ball\s+items\b/],
      ['qa', /(?:^|[^a-z])qa(?:[^a-z]|$)|\bquality\b|\b90\s*day\b|\bevaluations?\b/]
    ];
    for (const [id, pattern] of filenameHints) {
      if (pattern.test(name)) {
        const validation = validateClassification(id, parsed);
        return validation.valid
          ? { id, confidence: 'high', reason: 'filename+headers', classificationMethod: 'filename+headers', candidates: [id], validation, detectedPeriod: detectPeriod(originalName, id) }
          : { id: null, predictedId: id, confidence: 'needs-review', reason: 'header-validation-failed', classificationMethod: 'filename', candidates: [id], validation, needsReview: true, detectedPeriod: detectPeriod(originalName, id) };
      }
    }

    const headerClassification = id => {
      const validation = validateClassification(id, parsed);
      return validation.valid
        ? { id, confidence: 'high', reason: 'header', classificationMethod: 'headers', candidates: [id], validation, detectedPeriod: detectPeriod(originalName, id) }
        : { id: null, predictedId: id, confidence: 'needs-review', reason: 'header-validation-failed', classificationMethod: 'headers', candidates: [id], validation, needsReview: true, detectedPeriod: detectPeriod(originalName, id) };
    };
    const found = inspectSourceHeaders(parsed);
    if (found.has('documentedCoaching')) return headerClassification('documentedCoaching');
    if (found.has('checklist')) return headerClassification('checklist');
    if (found.has('qa') && !found.has('weeklyRetail') && !found.has('weeklyReferral')) {
      return headerClassification('qa');
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
    const aliases = { retail: 'weeklyRetail', referral: 'weeklyReferral', coaching: 'documentedCoaching' };
    source = aliases[source] || source;
    if (!SOURCES[source]) throw new Error('Unknown CoachTools source: ' + source);
    const prepared = clone(parsed);
    if (source === 'documentedCoaching') convertCoachingDateHeader(prepared);
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
      detectedPeriod: options && options.detectedPeriod || detectPeriod(prepared.meta && prepared.meta.fileName, source),
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

  async function analyzeFiles(files, options) {
    const recognized = [], needsReview = [], errors = [];
    const list = Array.from(files || []);
    for (let index = 0; index < list.length; index += 1) {
      const file = list[index];
      try {
        const parsed = await parseFile(file, options && options.onProgress ? { onProgress: progress => options.onProgress({ ...progress, fileIndex: index, fileCount: list.length }) } : null);
        const classification = classifyFile(file, parsed);
        const entry = { file, parsed, classification };
        if (classification.id) recognized.push(entry);
        else needsReview.push(entry);
      } catch (error) { errors.push({ file, error }); }
    }
    return { recognized, needsReview, errors };
  }

  async function saveRecognizedEntry(entry, options) {
    if (!entry || !entry.classification || !entry.classification.id) throw new Error('The file has not been safely classified.');
    if (!root.CoachToolsData || typeof root.CoachToolsData.importDataset !== 'function') throw new Error('The central CoachTools data API is unavailable.');
    const type = entry.classification.id;
    const dataset = prepareDataset(entry.parsed, type, { ...(options || {}), detectedPeriod: entry.classification.detectedPeriod });
    return root.CoachToolsData.importDataset(type, dataset, {
      originalFileName: entry.file && entry.file.name || dataset.meta && dataset.meta.fileName || '',
      fileSize: entry.file && entry.file.size || dataset.meta && dataset.meta.fileSize || 0,
      fileModifiedDate: entry.file && entry.file.lastModified ? new Date(entry.file.lastModified).toISOString() : dataset.meta && dataset.meta.fileModifiedDate || '',
      rowCount: dataset.meta && dataset.meta.totalRows || 0,
      detectedPeriod: entry.classification.detectedPeriod,
      classificationMethod: entry.classification.classificationMethod || entry.classification.reason || 'filename+headers',
      validationStatus: entry.classification.validation && entry.classification.validation.valid === false ? 'needs-review' : 'ready'
    });
  }

  async function saveRecognizedFiles(files, options) {
    const analysis = await analyzeFiles(files, options);
    const results = [];
    for (const entry of analysis.recognized) results.push({ entry, result: await saveRecognizedEntry(entry, options) });
    return { ...analysis, results };
  }

  root.CoachToolsImport = Object.freeze({
    VERSION: '1.0.0',
    SOURCE_ORDER,
    DATASET_ORDER,
    SOURCES,
    SUPPORTED_EXTENSIONS,
    display,
    normalizeName,
    normalizeHeader,
    normalizedFileName,
    isBlank,
    extensionOf,
    isSupportedFile,
    clone,
    trimAOA,
    readWorkbook,
    parseFile,
    findHeader,
    inspectSourceHeaders,
    workbookHeaderSet,
    validateClassification,
    detectPeriod,
    classifyFile,
    convertCoachingDateHeader,
    scopeNames,
    prepareDataset,
    packDataset,
    analyzeFiles,
    saveRecognizedEntry,
    saveRecognizedFiles
  });

  // Non-All-Star apps can keep their existing import handlers. A successful,
  // confidently classified spreadsheet selection is also recorded in the shared
  // IndexedDB, so uploading QA in QA Scores or Checklist in Audit updates the
  // whole suite. All-Star uses an explicit success hook to avoid saving a file
  // before its more sophisticated import validation completes.
  if (root.document) {
    const enableObserver = () => {
      const appId = root.document.querySelector('meta[name="coachtools-id"]')?.content || '';
      if (appId === 'allstar') return;
      root.document.addEventListener('change', event => {
        const input = event.target;
        if (!input || input.type !== 'file' || input.dataset.coachtoolsAutoImport === 'false' || !input.files || !input.files.length) return;
        saveRecognizedFiles(input.files).catch(error => console.warn('[CoachToolsImport] Central import observation skipped.', error));
      });
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', enableObserver, { once: true });
    else enableObserver();
  }
})(window);
