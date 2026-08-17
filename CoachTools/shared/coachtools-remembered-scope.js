(function attachCoachToolsRememberedScope(root) {
  'use strict';

  const importer = root.CoachToolsImport;
  if (!importer || typeof importer.saveRecognizedEntry !== 'function' || typeof importer.analyzeFiles !== 'function') return;

  const BASELINE_KEY = 'coachtools.desktop.cleanUploadBaseline.v1';
  const ROW_YIELD_INTERVAL = 1200;
  let mode = '';
  let pendingScope = null;
  let pendingFiles = [];
  let updateSession = null;

  function $(id) { return root.document && root.document.getElementById(id); }

  function readBaseline() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(BASELINE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeBaseline(value) {
    try { root.localStorage && root.localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function clone(value) {
    try { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  }

  function currentScope() {
    const storage = root.CoachToolsStorage;
    if (!storage || typeof storage.getScope !== 'function') return null;
    try { return clone(storage.getScope()); } catch (_) { return null; }
  }

  function reusableScope(scope) {
    if (!scope) return null;
    if (scope.mode === 'all') return scope;
    return Array.isArray(scope.coaches) && scope.coaches.length ? scope : null;
  }

  function scopeLabel(scope) {
    if (!scope || scope.mode === 'all') return 'All people';
    if (scope.label) return scope.label;
    if (Array.isArray(scope.coaches) && scope.coaches.length === 1) return scope.coaches[0];
    if (Array.isArray(scope.coaches) && scope.coaches.length > 1) return `${scope.coaches.length} coaches`;
    return scope.team || scope.coordinator || scope.department || scope.mode || 'saved scope';
  }

  function showToast(message, duration) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    root.clearTimeout(showToast.timer);
    showToast.timer = root.setTimeout(() => { toast.hidden = true; }, duration || 5000);
  }

  function nextPaint() {
    return new Promise(resolve => {
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(() => resolve());
      else root.setTimeout(resolve, 0);
    });
  }

  function yieldMainThread() {
    if (root.scheduler && typeof root.scheduler.yield === 'function') {
      try { return root.scheduler.yield(); } catch (_) {}
    }
    return new Promise(resolve => root.setTimeout(resolve, 0));
  }

  function isBlank(value) {
    if (typeof importer.isBlank === 'function') return importer.isBlank(value);
    return value == null || (typeof value === 'string' && !value.trim());
  }

  async function trimAOAResponsive(aoa) {
    if (!Array.isArray(aoa) || !aoa.length) return Array.isArray(aoa) ? aoa : [];

    let lastRow = aoa.length - 1;
    let steps = 0;
    while (lastRow >= 0 && !(aoa[lastRow] || []).some(cell => !isBlank(cell))) {
      lastRow -= 1;
      steps += 1;
      if (steps % ROW_YIELD_INTERVAL === 0) await yieldMainThread();
    }
    if (lastRow < 0) return [];

    let lastColumn = -1;
    for (let rowIndex = 0; rowIndex <= lastRow; rowIndex += 1) {
      const row = Array.isArray(aoa[rowIndex]) ? aoa[rowIndex] : [];
      for (let column = row.length - 1; column >= 0; column -= 1) {
        if (!isBlank(row[column])) {
          lastColumn = Math.max(lastColumn, column);
          break;
        }
      }
      if (rowIndex > 0 && rowIndex % ROW_YIELD_INTERVAL === 0) await yieldMainThread();
    }
    if (lastColumn < 0) return [];

    const rows = new Array(lastRow + 1);
    for (let rowIndex = 0; rowIndex <= lastRow; rowIndex += 1) {
      const row = Array.isArray(aoa[rowIndex]) ? aoa[rowIndex] : [];
      rows[rowIndex] = row.slice(0, lastColumn + 1);
      if (rowIndex > 0 && rowIndex % ROW_YIELD_INTERVAL === 0) await yieldMainThread();
    }
    return rows;
  }

  async function parseFileResponsive(file, options) {
    await nextPaint();
    const workbook = await importer.readWorkbook(file);
    const sheets = workbook.SheetNames || [];
    const data = {};
    let totalRows = 0;
    const onProgress = options && typeof options.onProgress === 'function' ? options.onProgress : null;

    for (let index = 0; index < sheets.length; index += 1) {
      if (index > 0) await yieldMainThread();
      const name = sheets[index];
      const rawRows = root.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' });
      await yieldMainThread();
      const aoa = await trimAOAResponsive(rawRows);
      data[name] = { aoa };
      totalRows += aoa.length;
      if (onProgress) onProgress({ phase: 'reading-sheet', fileName: file.name, sheetName: name, current: index + 1, total: sheets.length });
      await nextPaint();
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

  async function analyzeFilesResponsive(files, options) {
    const recognized = [], needsReview = [], errors = [];
    const list = Array.from(files || []);
    for (let index = 0; index < list.length; index += 1) {
      if (index > 0) await yieldMainThread();
      const file = list[index];
      try {
        const parsed = await parseFileResponsive(file, options && options.onProgress ? {
          onProgress: progress => options.onProgress({ ...progress, fileIndex: index, fileCount: list.length })
        } : null);
        const classification = importer.classifyFile(file, parsed);
        const entry = { file, parsed, classification };
        if (classification.id) recognized.push(entry);
        else needsReview.push(entry);
      } catch (error) {
        errors.push({ file, error });
      }
      await yieldMainThread();
    }
    return { recognized, needsReview, errors };
  }

  function newestEntry(entries) {
    return (entries || []).slice().sort((left, right) => {
      const leftTime = Number(left && left.file && left.file.lastModified) || 0;
      const rightTime = Number(right && right.file && right.file.lastModified) || 0;
      return rightTime - leftTime || String(right && right.file && right.file.name || '').localeCompare(String(left && left.file && left.file.name || ''));
    })[0] || null;
  }

  function captureCleanBaseline(result) {
    const recognized = Array.isArray(result && result.recognized) ? result.recognized : [];
    const datasetTypes = Array.from(new Set(recognized.map(entry => entry && entry.classification && entry.classification.id).filter(Boolean)));
    const baseline = {
      version: 2,
      createdAt: new Date().toISOString(),
      scope: clone(pendingScope || currentScope()),
      datasetTypes,
      files: pendingFiles.map(file => ({
        name: file.name,
        size: Number(file.size) || 0,
        lastModified: Number(file.lastModified) || 0
      }))
    };
    writeBaseline(baseline);
    root.dispatchEvent(new CustomEvent('coachtools:clean-upload-baseline', { detail: clone(baseline) }));
    showToast(`Clean Upload saved · ${datasetTypes.length} data source${datasetTypes.length === 1 ? '' : 's'} · ${scopeLabel(baseline.scope)}. Update Data will follow this baseline.`);
    return baseline;
  }

  function prepareUpdateSession(result) {
    const baseline = readBaseline();
    const recognized = Array.isArray(result && result.recognized) ? result.recognized : [];
    if (!recognized.length) {
      updateSession = null;
      return;
    }
    if (!baseline || !Array.isArray(baseline.datasetTypes) || !baseline.datasetTypes.length) {
      updateSession = { baseline: null, remaining: recognized.length };
      return;
    }

    const selected = new Set(baseline.datasetTypes);
    // Checklist / All Items and Documented Coaching / MyOne2View are rotating
    // exports. If several changed copies are present, only the newest one should
    // become the current replacement. Exact filename continuity is not required.
    const newestChecklist = selected.has('checklist') ? newestEntry(recognized.filter(entry => entry.classification && entry.classification.id === 'checklist')) : null;
    const newestMyOne = selected.has('documentedCoaching') ? newestEntry(recognized.filter(entry => entry.classification && entry.classification.id === 'documentedCoaching')) : null;

    for (const entry of recognized) {
      const type = entry && entry.classification && entry.classification.id;
      entry._coachtoolsBaselineSkip = !selected.has(type)
        || (type === 'checklist' && newestChecklist && entry !== newestChecklist)
        || (type === 'documentedCoaching' && newestMyOne && entry !== newestMyOne);
      // Do not keep giant parsed workbooks alive when this update will skip them.
      if (entry._coachtoolsBaselineSkip) entry.parsed = null;
    }

    updateSession = { baseline, remaining: recognized.length };
  }

  async function prepareUpdateDataset(entry, options) {
    if (!entry || !entry.parsed || !entry.classification || !entry.classification.id) {
      throw new Error('The file has not been safely classified.');
    }
    const type = entry.classification.id;
    const prepared = entry.parsed;
    if (type === 'documentedCoaching') importer.convertCoachingDateHeader(prepared);

    const selectedNames = new Set(type === 'qa' ? [] : importer.scopeNames(options && options.scope));
    let matchedRows = 0;
    let totalRows = 0;

    for (let sheetIndex = 0; sheetIndex < (prepared.workbook.sheets || []).length; sheetIndex += 1) {
      if (sheetIndex > 0) await yieldMainThread();
      const sheetName = prepared.workbook.sheets[sheetIndex];
      const sheet = prepared.workbook.data[sheetName];
      const aoa = sheet && sheet.aoa;
      if (!Array.isArray(aoa)) continue;
      if (!selectedNames.size) {
        totalRows += aoa.length;
        continue;
      }

      const header = importer.findHeader(aoa, importer.SOURCES[type].header);
      if (!header) {
        totalRows += aoa.length;
        continue;
      }

      const selectedRows = [];
      for (let rowIndex = header.headerRow + 1; rowIndex < aoa.length; rowIndex += 1) {
        const row = aoa[rowIndex];
        const matches = Array.isArray(row) && selectedNames.has(importer.normalizeName(row[header.colIndex]));
        if (matches) {
          matchedRows += 1;
          selectedRows.push(row);
        }
        if ((rowIndex - header.headerRow) % ROW_YIELD_INTERVAL === 0) await yieldMainThread();
      }

      const filtered = aoa.slice(0, header.headerRow + 1);
      for (const row of selectedRows) filtered.push(row);
      sheet.aoa = filtered;
      totalRows += filtered.length;
      await yieldMainThread();
    }

    prepared.meta = {
      ...(prepared.meta || {}),
      source: type,
      sourceLabel: importer.SOURCES[type].label,
      detectedPeriod: entry.classification.detectedPeriod || importer.detectPeriod(prepared.meta && prepared.meta.fileName, type),
      totalRows,
      automaticImport: true,
      automaticImportScope: selectedNames.size ? Array.from(selectedNames) : [],
      automaticImportMatchedRows: matchedRows
    };
    return prepared;
  }

  async function saveUpdateEntryResponsive(entry, options) {
    if (!root.CoachToolsData || typeof root.CoachToolsData.importDataset !== 'function') {
      throw new Error('The central CoachTools data API is unavailable.');
    }
    const type = entry.classification.id;
    const dataset = await prepareUpdateDataset(entry, options);
    await nextPaint();
    const result = await root.CoachToolsData.importDataset(type, dataset, {
      originalFileName: entry.file && entry.file.name || dataset.meta && dataset.meta.fileName || '',
      fileSize: entry.file && entry.file.size || dataset.meta && dataset.meta.fileSize || 0,
      fileModifiedDate: entry.file && entry.file.lastModified ? new Date(entry.file.lastModified).toISOString() : dataset.meta && dataset.meta.fileModifiedDate || '',
      rowCount: dataset.meta && dataset.meta.totalRows || 0,
      detectedPeriod: entry.classification.detectedPeriod,
      classificationMethod: entry.classification.classificationMethod || entry.classification.reason || 'filename+headers',
      validationStatus: entry.classification.validation && entry.classification.validation.valid === false ? 'needs-review' : 'ready'
    });
    // Once IndexedDB owns the update, release the parsed workbook before the next
    // file is prepared. This keeps multi-file updates from accumulating huge trees.
    entry.parsed = null;
    return result;
  }

  const originalAnalyzeFiles = importer.analyzeFiles.bind(importer);
  const originalSaveRecognizedEntry = importer.saveRecognizedEntry.bind(importer);

  const enhancedImporter = {
    ...importer,
    async analyzeFiles(files, options) {
      const updateMode = mode === 'update';
      const result = updateMode
        ? await analyzeFilesResponsive(files, options)
        : await originalAnalyzeFiles(files, options);
      if (mode === 'clean') {
        captureCleanBaseline(result);
        mode = '';
        pendingFiles = [];
      } else if (mode === 'update') {
        prepareUpdateSession(result);
        mode = '';
      }
      return result;
    },
    async saveRecognizedEntry(entry, options) {
      const nextOptions = { ...(options || {}) };
      const session = updateSession;
      const baselineScope = session && session.baseline && reusableScope(session.baseline.scope);
      const savedBaseline = readBaseline();
      const cleanScope = reusableScope(savedBaseline && savedBaseline.scope);
      if (Object.prototype.hasOwnProperty.call(nextOptions, 'scope') && nextOptions.scope === null) {
        nextOptions.scope = baselineScope || cleanScope || reusableScope(currentScope());
      }

      try {
        if (entry && entry._coachtoolsBaselineSkip) {
          return { status: 'duplicate', skippedByCleanUploadBaseline: true };
        }
        if (session) {
          // Give the progress UI a frame before each expensive persistence stage,
          // then use the update-specific preparation path that filters in chunks
          // instead of JSON-cloning the entire parsed workbook first.
          await nextPaint();
          return await saveUpdateEntryResponsive(entry, nextOptions);
        }
        return await originalSaveRecognizedEntry(entry, nextOptions);
      } finally {
        if (updateSession && updateSession.remaining > 0) {
          updateSession.remaining -= 1;
          if (updateSession.remaining <= 0) updateSession = null;
        }
      }
    }
  };

  root.CoachToolsImport = Object.freeze(enhancedImporter);

  function addCleanUploadButtons() {
    if (root.document.querySelector('[data-action="clean-upload-data"]')) return;

    const topUpdate = root.document.querySelector('.command-bar [data-action="update-data"]');
    if (topUpdate) {
      const button = root.document.createElement('button');
      button.type = 'button';
      button.className = 'command-button secondary';
      button.dataset.action = 'clean-upload-data';
      button.textContent = 'Clean Upload';
      topUpdate.insertAdjacentElement('afterend', button);
    }

    const panelUpdate = root.document.querySelector('#dataPanel [data-action="update-data"]');
    if (panelUpdate) {
      const button = root.document.createElement('button');
      button.type = 'button';
      button.className = 'command-button secondary';
      button.dataset.action = 'clean-upload-data';
      button.textContent = 'Clean Upload';
      panelUpdate.insertAdjacentElement('afterend', button);
    }
  }

  function bind() {
    addCleanUploadButtons();

    root.document.addEventListener('click', event => {
      const actionElement = event.target && event.target.closest && event.target.closest('[data-action]');
      const action = actionElement && actionElement.dataset.action;
      if (action === 'clean-upload-data') {
        event.preventDefault();
        mode = 'clean';
        pendingScope = currentScope();
        pendingFiles = [];
        const input = $('quickDataInput');
        if (input) input.click();
      } else if (action === 'update-data' && root.location.protocol === 'file:') {
        mode = 'update';
      }
    }, true);

    const input = $('quickDataInput');
    if (input) input.addEventListener('change', event => {
      if (mode !== 'clean') return;
      pendingFiles = Array.from(event.target && event.target.files || []);
      if (!pendingFiles.length) {
        mode = '';
        pendingScope = null;
      }
    }, true);
  }

  root.CoachToolsCleanUploadBaseline = Object.freeze({
    VERSION: '2.1.0',
    getBaseline: readBaseline,
    clearBaseline() {
      try { root.localStorage.removeItem(BASELINE_KEY); } catch (_) {}
      updateSession = null;
    }
  });

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})(window);
