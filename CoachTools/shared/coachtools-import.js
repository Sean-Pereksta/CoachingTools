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
    if (root.CoachToolsIdentity && typeof root.CoachToolsIdentity.normalizeName === 'function') {
      return root.CoachToolsIdentity.normalizeName(value);
    }
    let normalized = display(value);
    if (normalized.includes(',')) {
      const parts = normalized.split(','), last = parts.shift().trim(), given = parts.join(' ').trim();
      if (last && given) normalized = `${given} ${last}`;
    }
    return normalized.normalize ? normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[.’'`]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase() : normalized.replace(/,/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  }

  function stableHash(value) {
    let hash = 2166136261;
    const text = String(value == null ? '' : value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function uniqueDisplay(values) {
    const seen = new Set(), result = [];
    for (const value of values || []) {
      const raw = display(value), key = normalizeName(raw);
      if (!raw || !key || seen.has(key)) continue;
      seen.add(key);
      result.push(raw);
    }
    return result;
  }

  function personIdentityNames(person) {
    const sourceNames = person && person.sourceNames && typeof person.sourceNames === 'object'
      ? Object.values(person.sourceNames).flatMap(value => Array.isArray(value) ? value : value ? [value] : [])
      : [];
    return uniqueDisplay([person && person.displayName, person && person.normalizedName, ...(person && person.aliases || []), ...sourceNames]);
  }

  function normalizeScopeSnapshot(scope, options) {
    const raw = scope && typeof scope === 'object' ? scope : {};
    const mode = String(raw.mode || 'all').trim().toLowerCase() || 'all';
    const people = Array.isArray(options && options.identityPeople) ? options.identityPeople : [];
    const peopleById = new Map(people.map(person => [person.personId, person]));
    const explicitCoachPersonIds = new Set(raw.coachPersonIds || []);
    const explicitCoachKeys = new Set([...(raw.coachKeys || []), ...(raw.coaches || [])].map(normalizeName).filter(Boolean));
    const selectedPeople = [];
    const addPerson = person => {
      if (!person || selectedPeople.some(candidate => candidate.personId === person.personId)) return;
      selectedPeople.push(person);
    };

    if (mode !== 'all') {
      if (mode === 'coach' && raw.personId) addPerson(peopleById.get(raw.personId));
      explicitCoachPersonIds.forEach(personId => addPerson(peopleById.get(personId)));
      if (mode === 'representative' && raw.personId) {
        const representative = peopleById.get(raw.personId);
        if (representative && representative.currentCoachId) addPerson(peopleById.get(representative.currentCoachId));
      }
      for (const person of people) {
        if (!person || person.role !== 'coach') continue;
        const identityKeys = personIdentityNames(person).map(normalizeName);
        if (explicitCoachKeys.size && identityKeys.some(key => explicitCoachKeys.has(key))) addPerson(person);
        if (mode === 'team' && normalizeName(person.currentTeam || person.team) === normalizeName(raw.team || raw.label)) addPerson(person);
        if (mode === 'department' && normalizeName(person.department) === normalizeName(raw.department || raw.label)) addPerson(person);
        if (mode === 'coordinator' && normalizeName(person.coordinator) === normalizeName(raw.coordinator || raw.label)) addPerson(person);
      }
    }

    const canonicalCoachNames = mode === 'all' ? [] : uniqueDisplay([
      ...(selectedPeople.length ? selectedPeople.map(person => person.displayName) : (raw.coaches || [])),
      mode === 'coach' && !raw.personId ? raw.label : ''
    ]);
    const coachKeys = mode === 'all' ? [] : Array.from(new Set([
      ...(raw.coachKeys || []).map(normalizeName),
      ...canonicalCoachNames.map(normalizeName),
      ...selectedPeople.flatMap(person => personIdentityNames(person).map(normalizeName))
    ].filter(Boolean))).sort();
    const representatives = mode === 'all' ? [] : uniqueDisplay(raw.representatives || []);
    const personId = mode === 'all' ? '' : display(raw.personId);
    const coachPersonIds = mode === 'all' ? [] : Array.from(new Set([...(raw.coachPersonIds || []), ...selectedPeople.map(person => person.personId)].filter(Boolean))).sort();
    const stableIdentity = JSON.stringify({ mode, personId, coachPersonIds, coachKeys: personId || coachPersonIds.length ? [] : canonicalCoachNames.map(normalizeName).filter(Boolean).sort() });
    const snapshot = {
      schemaVersion: 1,
      mode,
      label: display(raw.label) || (mode === 'all' ? 'All people' : canonicalCoachNames.length === 1 ? canonicalCoachNames[0] : display(raw[mode]) || mode),
      personId,
      coaches: canonicalCoachNames,
      coachPersonIds,
      coachKeys,
      representatives,
      team: display(raw.team),
      department: display(raw.department),
      coordinator: display(raw.coordinator),
      scopeHash: `scope-v1-${stableHash(stableIdentity)}`,
      capturedAt: display(raw.capturedAt) || new Date().toISOString()
    };
    return snapshot;
  }

  async function resolveScopeSnapshot(scope) {
    const diagnostics = root.CoachToolsDiagnostics;
    if (diagnostics) diagnostics.start('Scope resolution');
    let identityPeople = [];
    const identity = root.CoachToolsIdentity;
    if (identity && typeof identity.getAllPeople === 'function') {
      try {
        if (typeof identity.ready === 'function') await identity.ready();
        identityPeople = await identity.getAllPeople();
      } catch (_) { identityPeople = []; }
    }
    const resolved = normalizeScopeSnapshot(scope, { identityPeople });
    if (diagnostics) diagnostics.end('Scope resolution', { mode: resolved.mode, coaches: resolved.coachPersonIds.length || resolved.coaches.length });
    return resolved;
  }

  function isNarrowScope(scope) {
    return Boolean(scope && scope.mode && scope.mode !== 'all');
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

  function trimAOAInPlace(aoa) {
    if (!Array.isArray(aoa) || !aoa.length) return Array.isArray(aoa) ? aoa : [];
    let lastRow = aoa.length - 1, lastColumn = -1;
    while (lastRow >= 0 && !(aoa[lastRow] || []).some(cell => !isBlank(cell))) lastRow -= 1;
    if (lastRow < 0) { aoa.length = 0; return aoa; }
    aoa.length = lastRow + 1;
    for (const row of aoa) {
      for (let column = (row || []).length - 1; column >= 0; column -= 1) {
        if (!isBlank(row[column])) { lastColumn = Math.max(lastColumn, column); break; }
      }
    }
    if (lastColumn < 0) { aoa.length = 0; return aoa; }
    for (const row of aoa) if (Array.isArray(row) && row.length > lastColumn + 1) row.length = lastColumn + 1;
    return aoa;
  }

  async function readWorkbook(file) {
    if (!root.XLSX && root.CoachToolsDependencies) await root.CoachToolsDependencies.ensureXlsx();
    if (!root.XLSX) throw new Error('SheetJS could not load.');
    if (!file || !isSupportedFile(file)) throw new Error('Choose an XLSX, XLS, or CSV file.');
    const extension = extensionOf(file);
    const diagnostics = root.CoachToolsDiagnostics;
    if (diagnostics) diagnostics.start('File read', { fileName: file.name, fileSize: Number(file.size) || 0 });
    let payload;
    if (extension === '.csv' || file.type === 'text/csv') {
      try { payload = await file.text(); }
      finally { if (diagnostics) diagnostics.end('File read', { fileName: file.name }); }
      if (diagnostics) diagnostics.start('XLSX parse', { fileName: file.name, format: 'csv' });
      try { return root.XLSX.read(payload, { type: 'string' }); }
      finally { if (diagnostics) diagnostics.end('XLSX parse', { fileName: file.name }); }
    }
    try { payload = await file.arrayBuffer(); }
    finally { if (diagnostics) diagnostics.end('File read', { fileName: file.name }); }
    if (diagnostics) diagnostics.start('XLSX parse', { fileName: file.name, format: extension.slice(1) });
    try { return root.XLSX.read(payload, { type: 'array' }); }
    finally { if (diagnostics) diagnostics.end('XLSX parse', { fileName: file.name }); }
  }

  async function parseFile(file, options) {
    const workbook = await readWorkbook(file);
    const sheets = workbook.SheetNames || [];
    const data = {};
    let totalRows = 0;
    const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : null;
    for (let index = 0; index < sheets.length; index += 1) {
      const name = sheets[index];
      const aoa = trimAOAInPlace(root.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }));
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

  function decodedSheetRange(sheet) {
    try {
      if (!sheet || !sheet['!ref'] || !root.XLSX || !root.XLSX.utils || typeof root.XLSX.utils.decode_range !== 'function') return null;
      return root.XLSX.utils.decode_range(sheet['!ref']);
    } catch (_) { return null; }
  }

  function cellValue(sheet, rowIndex, columnIndex) {
    try {
      const address = root.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet && sheet[address];
      return cell && Object.prototype.hasOwnProperty.call(cell, 'v') ? cell.v : '';
    } catch (_) { return ''; }
  }

  function rowFromSheet(sheet, rowIndex, lastColumn) {
    const row = new Array(Math.max(0, lastColumn) + 1);
    for (let column = 0; column <= lastColumn; column += 1) row[column] = cellValue(sheet, rowIndex, column);
    return row;
  }

  async function discoverFile(file, options) {
    const workbook = await readWorkbook(file);
    const sheets = workbook.SheetNames || [];
    const data = {};
    const ranges = {};
    let totalRows = 0;
    const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : null;
    for (let index = 0; index < sheets.length; index += 1) {
      const name = sheets[index], sheet = workbook.Sheets[name], range = decodedSheetRange(sheet);
      ranges[name] = range;
      let preview;
      if (range) {
        const previewRange = { s: { r: 0, c: 0 }, e: { r: Math.min(range.e.r, 59), c: Math.min(range.e.c, 1023) } };
        preview = root.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', range: previewRange });
        totalRows += Math.max(0, range.e.r - range.s.r + 1);
      } else {
        // Older SheetJS-compatible test doubles cannot address ranges. Preserve
        // functional behavior there; current browsers use the lightweight path.
        preview = root.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        totalRows += preview.length;
      }
      data[name] = { aoa: trimAOAInPlace(preview) };
      if (onProgress) onProgress({ phase: 'reading-sheet', fileName: file.name, sheetName: name, current: index + 1, total: sheets.length });
      await new Promise(resolve => root.setTimeout(resolve, 0));
    }
    const parsed = {
      meta: {
        fileName: file.name,
        fileSize: Number(file.size) || 0,
        fileModifiedDate: file.lastModified ? new Date(file.lastModified).toISOString() : '',
        fileType: file.type || '',
        loadedAt: new Date().toISOString(),
        sheetsCount: sheets.length,
        totalRows,
        discoveryOnly: true
      },
      workbook: { sheets, data }
    };
    const diagnostics = root.CoachToolsDiagnostics;
    if (diagnostics) diagnostics.start('File classification', { fileName: file.name });
    let classification;
    const requestedType = options && options.datasetType;
    if (requestedType && SOURCES[requestedType]) {
      const validation = validateClassification(requestedType, parsed);
      classification = validation.valid
        ? { id: requestedType, confidence: 'high', reason: 'manual+headers', classificationMethod: 'manual+headers', candidates: [requestedType], validation, detectedPeriod: detectPeriod(file, requestedType) }
        : { id: null, predictedId: requestedType, confidence: 'needs-review', reason: 'header-validation-failed', classificationMethod: 'manual', candidates: [requestedType], validation, needsReview: true, detectedPeriod: detectPeriod(file, requestedType) };
    } else classification = classifyFile(file, parsed);
    if (diagnostics) diagnostics.end('File classification', { fileName: file.name, datasetType: classification.id || classification.predictedId || '' });
    const ownershipByKey = new Map();
    const source = classification.id;
    if (source) {
      for (const sheetName of sheets) {
        const preview = data[sheetName] && data[sheetName].aoa || [];
        const header = findHeader(preview, SOURCES[source].header) || findOwnershipHeader(preview, source);
        if (!header) continue;
        const sheet = workbook.Sheets[sheetName], range = ranges[sheetName];
        const lastRow = range ? range.e.r : preview.length - 1;
        for (let rowIndex = header.headerRow + 1; rowIndex <= lastRow; rowIndex += 1) {
          const value = range ? cellValue(sheet, rowIndex, header.colIndex) : preview[rowIndex] && preview[rowIndex][header.colIndex];
          if (!isBlank(value)) {
            const shown = display(value), key = normalizeName(shown);
            if (key) {
              const existing = ownershipByKey.get(key);
              if (existing) existing.count += 1;
              else ownershipByKey.set(key, { value: shown, sheetName, rowIndex, count: 1 });
            }
          }
          if (rowIndex > header.headerRow && rowIndex % 4000 === 0) await new Promise(resolve => root.setTimeout(resolve, 0));
        }
      }
    }
    if (onProgress) onProgress({ phase: 'classified', fileName: file.name, datasetType: source || '', current: 1, total: 1 });
    return { file, parsed, classification, discovery: { ownershipValues: Array.from(ownershipByKey.values()), ranges }, rawWorkbook: workbook };
  }

  async function materializeDiscoveredEntry(entry, scope, options) {
    if (!entry || !entry.rawWorkbook) return entry && entry.parsed;
    const source = entry.classification && entry.classification.id;
    if (!source) throw new Error('The file has not been safely classified.');
    const snapshot = normalizeScopeSnapshot(scope || { mode: 'all', label: 'All people' }, options);
    const narrow = isNarrowScope(snapshot), selectedNames = new Set(scopeNames(snapshot));
    const corrections = new Map((options && options.nameCorrections || []).map(item => [normalizeName(item && item.from), display(item && item.to)]).filter(item => item[0] && item[1]));
    const corrected = value => corrections.get(normalizeName(value)) || value;
    const workbook = entry.rawWorkbook, sheets = workbook.SheetNames || [];
    const data = {};
    let totalRows = 0;
    const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : null;
    for (let index = 0; index < sheets.length; index += 1) {
      const sheetName = sheets[index], sheet = workbook.Sheets[sheetName], range = decodedSheetRange(sheet);
      let aoa = [];
      const preview = entry.parsed && entry.parsed.workbook && entry.parsed.workbook.data[sheetName] && entry.parsed.workbook.data[sheetName].aoa || [];
      // Preserve the worksheet's used width after selection. The bounded
      // discovery preview may not contain values from a later metric column.
      const lastColumn = range ? Math.min(range.e.c, 1023) : 0;
      if (!range) {
        aoa = trimAOAInPlace(root.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }));
      } else if (!narrow || selectedNames.has(normalizeName(corrected(sheetName)))) {
        aoa = trimAOAInPlace(root.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', range: { s: { r: 0, c: 0 }, e: { r: range.e.r, c: lastColumn } } }));
      } else {
        const header = findOwnershipHeader(preview, source);
        if (header) {
          for (let rowIndex = 0; rowIndex <= header.headerRow; rowIndex += 1) aoa.push(rowFromSheet(sheet, rowIndex, lastColumn));
          for (let rowIndex = header.headerRow + 1; rowIndex <= range.e.r; rowIndex += 1) {
            const owner = cellValue(sheet, rowIndex, header.colIndex);
            if (selectedNames.has(normalizeName(corrected(owner)))) aoa.push(rowFromSheet(sheet, rowIndex, lastColumn));
            if (rowIndex > header.headerRow && rowIndex % 2000 === 0) await new Promise(resolve => root.setTimeout(resolve, 0));
          }
          trimAOAInPlace(aoa);
        } else {
          // Retain only the tiny preview so scoped validation can explain the
          // missing ownership column without materializing the worksheet.
          aoa = preview.map(row => Array.isArray(row) ? row.slice() : []);
        }
      }
      data[sheetName] = { aoa };
      totalRows += aoa.length;
      if (onProgress) onProgress({ phase: 'materializing-scope', fileName: entry.file && entry.file.name || '', sheetName, current: index + 1, total: sheets.length });
      await new Promise(resolve => root.setTimeout(resolve, 0));
    }
    return {
      meta: { ...(entry.parsed && entry.parsed.meta || {}), discoveryOnly: false, sourceTotalRows: entry.parsed && entry.parsed.meta && entry.parsed.meta.totalRows || 0, totalRows },
      workbook: { sheets: sheets.slice(), data }
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
    for (const source of DATASET_ORDER) {
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
      ['monthlyRetail', /\bappointment\b.*\breport\b|\bretail\b.*\bmonthly\b|\bmonthly\b.*\bretail\b/],
      ['monthlyReferral', /\bkpi\b.*\breport\b|\breferral\b.*\bmonthly\b|\bmonthly\b.*\breferral\b/],
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
    const candidates = DATASET_ORDER.filter(id => found.has(id));
    if (candidates.length === 1) return headerClassification(candidates[0]);
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

  const OWNERSHIP_HEADERS = Object.freeze({
    documentedCoaching: Object.freeze(['Job Coach', 'Coach Assigned', 'Coach', 'Team']),
    weeklyRetail: Object.freeze(['Sheet', 'Team', 'Coach', 'Job Coach']),
    weeklyReferral: Object.freeze(['Sheet', 'Team', 'Coach', 'Job Coach']),
    qa: Object.freeze(['Team']),
    checklist: Object.freeze(['Coach Assigned', 'Coach', 'Job Coach', 'Team']),
    monthlyRetail: Object.freeze(['Sheet', 'Team', 'Coach', 'Job Coach']),
    monthlyReferral: Object.freeze(['Sheet', 'Team', 'Coach', 'Job Coach']),
    compCoaching: Object.freeze(['CSR Team/Coach', 'Coach Assigned', 'Coach', 'Team'])
  });

  function scopeNames(scope) {
    if (!scope || scope.mode === 'all') return [];
    const keys = Array.isArray(scope.coachKeys) && scope.coachKeys.length ? scope.coachKeys : scope.coaches;
    return Array.from(new Set((keys || []).map(normalizeName).filter(Boolean)));
  }

  function findOwnershipHeader(aoa, source) {
    for (const headerName of OWNERSHIP_HEADERS[source] || [SOURCES[source] && SOURCES[source].header]) {
      const found = headerName && findHeader(aoa, headerName);
      if (found) return { ...found, headerName };
    }
    return null;
  }

  function createDatasetHash(prefix) {
    let hash = 2166136261;
    let parts = 0;
    return Object.freeze({
      update(part) {
        const text = typeof part === 'string' ? part : JSON.stringify(part);
        for (let index = 0; index < text.length; index += 1) {
          hash ^= text.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
        hash ^= 31;
        hash = Math.imul(hash, 16777619);
        parts += 1;
        return this;
      },
      finish() { return `${prefix || 'scoped-fnv1a'}-${(hash >>> 0).toString(16).padStart(8, '0')}`; },
      get parts() { return parts; }
    });
  }

  function fingerprintRows(parts) {
    const hash = createDatasetHash('scoped-fnv1a');
    for (const part of parts || []) hash.update(part);
    return hash.finish();
  }

  function scopeValidationError(message, diagnostics) {
    const error = new Error(message);
    error.name = 'CoachToolsScopeValidationError';
    error.code = 'COACHTOOLS_SCOPE_REVIEW';
    error.scopeMatchDiagnostics = diagnostics || null;
    return error;
  }

  function prepareScopedDataset(parsed, source, scope, options) {
    const aliases = { retail: 'weeklyRetail', referral: 'weeklyReferral', coaching: 'documentedCoaching' };
    source = aliases[source] || source;
    if (!SOURCES[source]) throw new Error('Unknown CoachTools source: ' + source);
    const diagnosticsApi = root.CoachToolsDiagnostics;
    if (diagnosticsApi) {
      diagnosticsApi.start('Scope filtering', { datasetType: source });
      diagnosticsApi.start('Fingerprint generation', { datasetType: source, strategy: 'incremental' });
    }
    const finish = result => {
      if (diagnosticsApi) {
        diagnosticsApi.end('Fingerprint generation', { datasetType: source, fingerprint: result && result.scopedFingerprint || '' });
        diagnosticsApi.end('Scope filtering', { datasetType: source, matchedRows: result && result.matchedRows || 0 });
      }
      return result;
    };
    const scopeSnapshot = normalizeScopeSnapshot(scope || { mode: 'all', label: 'All people' }, options);
    const narrow = isNarrowScope(scopeSnapshot);
    const selectedNames = new Set(scopeNames(scopeSnapshot));
    const corrections = new Map((options && options.nameCorrections || []).map(item => [normalizeName(item && item.from), display(item && item.to)]).filter(item => item[0] && item[1]));
    const correctedOwnership = value => corrections.get(normalizeName(value)) || value;
    const copyWithCorrection = (row, columnIndex) => {
      if (!Array.isArray(row) || columnIndex == null || columnIndex < 0) return row;
      const corrected = correctedOwnership(row[columnIndex]);
      if (corrected === row[columnIndex]) return row;
      const copy = row.slice();
      copy[columnIndex] = corrected;
      return copy;
    };
    if (source === 'documentedCoaching') convertCoachingDateHeader(parsed);
    const sourceWorkbook = parsed && parsed.workbook || { sheets: [], data: {} };
    const prepared = {
      ...(parsed || {}),
      meta: { ...(parsed && parsed.meta || {}) },
      workbook: { ...sourceWorkbook, sheets: Array.from(sourceWorkbook.sheets || []), data: {} }
    };
    let matchedRows = 0;
    let sourceRows = 0;
    let totalRows = 0;
    let headerFound = false;
    let ownershipColumn = '';
    const sheetsChecked = [];
    const warnings = [];
    const fingerprint = createDatasetHash('scoped-fnv1a');
    fingerprint.update(`source:${source}`).update(`scope:${scopeSnapshot.scopeHash}`);

    if (narrow && !selectedNames.size) {
      const diagnostics = { headerFound: false, ownershipColumn: '', matchedCoachKeys: [], unmatchedCoachKeys: [], sheetsChecked: [], warnings: ['The selected scope did not resolve to a canonical coach identity.'] };
      return finish({ valid: false, needsReview: true, reason: 'Update needs review — the selected scope could not be safely restored.', dataset: null, scopeSnapshot, scopeHash: scopeSnapshot.scopeHash, matchedRows: 0, sourceRows: 0, scopedFingerprint: '', diagnostics });
    }

    for (const sheetName of sourceWorkbook.sheets || []) {
      const sourceSheet = sourceWorkbook.data && sourceWorkbook.data[sheetName];
      const aoa = sourceSheet && sourceSheet.aoa;
      prepared.workbook.data[sheetName] = { ...(sourceSheet || {}), aoa: [] };
      if (!Array.isArray(aoa)) continue;
      if (!narrow) {
        const ownership = corrections.size ? findOwnershipHeader(aoa, source) : null;
        prepared.workbook.data[sheetName].aoa = ownership
          ? aoa.map((row, index) => index > ownership.headerRow ? copyWithCorrection(row, ownership.colIndex) : row)
          : aoa;
        totalRows += aoa.length;
        const dataHeader = findHeader(aoa, SOURCES[source] && SOURCES[source].header);
        sourceRows += dataHeader
          ? aoa.slice(dataHeader.headerRow + 1).filter(row => Array.isArray(row) && row.some(cell => !isBlank(cell))).length
          : aoa.filter(row => Array.isArray(row) && row.some(cell => !isBlank(cell))).length;
        fingerprint.update(`sheet:${sheetName}`);
        for (const row of aoa) fingerprint.update(row);
        sheetsChecked.push({ sheetName, headerFound: Boolean(findOwnershipHeader(aoa, source)), rows: aoa.length, passthrough: true });
        continue;
      }
      const nonEmptySheetRows = aoa.filter(row => Array.isArray(row) && row.some(cell => !isBlank(cell)));
      if (selectedNames.has(normalizeName(correctedOwnership(sheetName)))) {
        const dataHeader = findHeader(aoa, SOURCES[source] && SOURCES[source].header);
        const ownedRows = dataHeader
          ? aoa.slice(dataHeader.headerRow + 1).filter(row => Array.isArray(row) && row.some(cell => !isBlank(cell))).length
          : nonEmptySheetRows.length;
        headerFound = true;
        ownershipColumn = ownershipColumn || 'Worksheet name';
        sourceRows += ownedRows;
        matchedRows += ownedRows;
        totalRows += aoa.length;
        prepared.workbook.data[sheetName].aoa = aoa;
        fingerprint.update(`sheet:${sheetName}`);
        for (const row of aoa) fingerprint.update(row);
        sheetsChecked.push({ sheetName, headerFound: true, ownershipColumn: 'Worksheet name', sourceRows: ownedRows, matchedRows: ownedRows, passthrough: false });
        continue;
      }
      const header = findOwnershipHeader(aoa, source);
      if (!header) {
        sourceRows += nonEmptySheetRows.length;
        sheetsChecked.push({ sheetName, headerFound: false, rows: aoa.length, sourceRows: nonEmptySheetRows.length, matchedRows: 0, dropped: true, passthrough: false });
        continue;
      }
      headerFound = true;
      ownershipColumn = ownershipColumn || header.headerName;
      const headerRows = aoa.slice(0, header.headerRow + 1);
      const candidateRows = aoa.slice(header.headerRow + 1).filter(row => Array.isArray(row) && row.some(cell => !isBlank(cell)));
      sourceRows += candidateRows.length;
      const selectedRows = [];
      for (const row of candidateRows) {
        if (!selectedNames.has(normalizeName(correctedOwnership(row[header.colIndex])))) continue;
        matchedRows += 1;
        selectedRows.push(copyWithCorrection(row, header.colIndex));
      }
      prepared.workbook.data[sheetName].aoa = selectedRows.length ? headerRows.concat(selectedRows) : [];
      totalRows += prepared.workbook.data[sheetName].aoa.length;
      if (selectedRows.length) {
        fingerprint.update(`sheet:${sheetName}`);
        for (const row of headerRows) fingerprint.update(row);
        for (const row of selectedRows) fingerprint.update(row);
      }
      sheetsChecked.push({ sheetName, headerFound: true, ownershipColumn: header.headerName, sourceRows: candidateRows.length, matchedRows: selectedRows.length, passthrough: false });
    }

    const diagnostics = {
      headerFound: narrow ? headerFound : true,
      ownershipColumn,
      matchedCoachKeys: narrow && matchedRows ? Array.from(selectedNames) : [],
      unmatchedCoachKeys: narrow && !matchedRows ? Array.from(selectedNames) : [],
      sheetsChecked,
      warnings,
      sourceRows,
      matchedRows: narrow ? matchedRows : sourceRows,
      outOfScopeRows: narrow ? Math.max(0, sourceRows - matchedRows) : 0
    };
    if (narrow && !headerFound) {
      diagnostics.warnings.push(`Required scope column not found. Expected ${source === 'qa' ? 'Team' : (OWNERSHIP_HEADERS[source] || []).join(', ')}.`);
      return finish({ valid: false, needsReview: true, reason: `Scoped import failed validation: required ${source === 'qa' ? 'Team' : 'ownership'} column not found. No replacement was performed.`, dataset: null, scopeSnapshot, scopeHash: scopeSnapshot.scopeHash, matchedRows, sourceRows, scopedFingerprint: '', diagnostics });
    }
    if (narrow && matchedRows === 0 && !(options && options.allowZeroRows)) {
      diagnostics.warnings.push('The scoped source contained zero matching rows. The existing dataset must be retained until the scope is reviewed.');
      return finish({ valid: false, needsReview: true, reason: `Update needs review — no rows matched ${scopeSnapshot.label || 'the selected scope'}.`, dataset: null, scopeSnapshot, scopeHash: scopeSnapshot.scopeHash, matchedRows, sourceRows, scopedFingerprint: '', diagnostics });
    }

    const scopedFingerprint = fingerprint.finish();

    prepared.meta = {
      ...(prepared.meta || {}),
      source,
      sourceLabel: SOURCES[source].label,
      detectedPeriod: options && options.detectedPeriod || detectPeriod(prepared.meta && prepared.meta.fileName, source),
      totalRows,
      automaticImport: true,
      automaticImportScope: narrow ? Array.from(selectedNames) : [],
      automaticImportMatchedRows: narrow ? matchedRows : sourceRows,
      scopeSnapshot,
      scopeHash: scopeSnapshot.scopeHash,
      scopeMode: scopeSnapshot.mode,
      scopedRowCount: narrow ? matchedRows : sourceRows,
      scopeMatchDiagnostics: diagnostics,
      scopedFingerprint
    };
    return finish({ valid: true, needsReview: false, reason: '', dataset: prepared, scopeSnapshot, scopeHash: scopeSnapshot.scopeHash, matchedRows: narrow ? matchedRows : sourceRows, sourceRows, scopedFingerprint, diagnostics });
  }

  function prepareDataset(parsed, source, options) {
    const prepared = prepareScopedDataset(parsed, source, options && options.scope, options);
    if (!prepared.valid) throw scopeValidationError(prepared.reason, prepared.diagnostics);
    return prepared.dataset;
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
        const entry = await discoverFile(file, options && options.onProgress ? { onProgress: progress => options.onProgress({ ...progress, fileIndex: index, fileCount: list.length }) } : null);
        if (entry.classification.id) recognized.push(entry);
        else needsReview.push(entry);
      } catch (error) { errors.push({ file, error }); }
    }
    return { recognized, needsReview, errors };
  }

  async function saveRecognizedEntry(entry, options) {
    if (!entry || !entry.classification || !entry.classification.id) throw new Error('The file has not been safely classified.');
    if (!root.CoachToolsData || typeof root.CoachToolsData.importDataset !== 'function') throw new Error('The central CoachTools data API is unavailable.');
    const type = entry.classification.id;
    const requestedScope = options && Object.prototype.hasOwnProperty.call(options, 'scope') && options.scope
      ? options.scope
      : root.CoachToolsStorage && typeof root.CoachToolsStorage.getScope === 'function' ? root.CoachToolsStorage.getScope() : { mode: 'all', label: 'All people' };
    const scopeSnapshot = await resolveScopeSnapshot(requestedScope || { mode: 'all', label: 'All people' });
    const parsed = entry.rawWorkbook ? await materializeDiscoveredEntry(entry, scopeSnapshot, options) : entry.parsed;
    entry.parsed = parsed;
    entry.rawWorkbook = null;
    const prepared = prepareScopedDataset(parsed, type, scopeSnapshot, { ...(options || {}), detectedPeriod: entry.classification.detectedPeriod });
    if (!prepared.valid) throw scopeValidationError(prepared.reason, prepared.diagnostics);
    const dataset = prepared.dataset;
    return root.CoachToolsData.importDataset(type, dataset, {
      originalFileName: entry.file && entry.file.name || dataset.meta && dataset.meta.fileName || '',
      fileSize: entry.file && entry.file.size || dataset.meta && dataset.meta.fileSize || 0,
      fileModifiedDate: entry.file && entry.file.lastModified ? new Date(entry.file.lastModified).toISOString() : dataset.meta && dataset.meta.fileModifiedDate || '',
      rowCount: dataset.meta && dataset.meta.totalRows || 0,
      detectedPeriod: entry.classification.detectedPeriod,
      classificationMethod: entry.classification.classificationMethod || entry.classification.reason || 'filename+headers',
      validationStatus: entry.classification.validation && entry.classification.validation.valid === false ? 'needs-review' : 'ready',
      scopeSnapshot: prepared.scopeSnapshot,
      scopeHash: prepared.scopeHash,
      scopeMode: prepared.scopeSnapshot.mode,
      scopedRowCount: prepared.matchedRows,
      scopeMatchDiagnostics: prepared.diagnostics,
      scopedFingerprint: prepared.scopedFingerprint
    });
  }

  async function saveRecognizedFiles(files, options) {
    const analysis = await analyzeFiles(files, options);
    const results = [];
    for (const entry of analysis.recognized) results.push({ entry, result: await saveRecognizedEntry(entry, options) });
    return { ...analysis, results };
  }

  root.CoachToolsImport = Object.freeze({
    VERSION: '2.0.0',
    SOURCE_ORDER,
    DATASET_ORDER,
    SOURCES,
    SUPPORTED_EXTENSIONS,
    display,
    normalizeName,
    stableHash,
    normalizeScopeSnapshot,
    resolveScopeSnapshot,
    isNarrowScope,
    normalizeHeader,
    normalizedFileName,
    isBlank,
    extensionOf,
    isSupportedFile,
    clone,
    trimAOA,
    readWorkbook,
    parseFile,
    discoverFile,
    materializeDiscoveredEntry,
    findHeader,
    inspectSourceHeaders,
    workbookHeaderSet,
    validateClassification,
    detectPeriod,
    classifyFile,
    convertCoachingDateHeader,
    OWNERSHIP_HEADERS,
    scopeNames,
    findOwnershipHeader,
    createDatasetHash,
    fingerprintRows,
    prepareScopedDataset,
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
