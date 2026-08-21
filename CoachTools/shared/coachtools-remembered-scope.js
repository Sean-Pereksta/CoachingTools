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
  let cleanSession = null;

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
    try { root.localStorage && root.localStorage.setItem(BASELINE_KEY, JSON.stringify(value)); } catch (_) {}
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

  async function beginCleanSession(result) {
    const recognized = Array.isArray(result && result.recognized) ? result.recognized : [];
    const needsReview = Array.isArray(result && result.needsReview) ? result.needsReview : [];
    const errors = Array.isArray(result && result.errors) ? result.errors : [];
    const datasetTypes = Array.from(new Set(recognized.map(entry => entry && entry.classification && entry.classification.id).filter(Boolean)));
    if (!recognized.length) {
      cleanSession = null;
      pendingFiles = [];
      pendingScope = null;
      return null;
    }
    const scope = typeof importer.resolveScopeSnapshot === 'function'
      ? await importer.resolveScopeSnapshot(pendingScope || currentScope() || { mode: 'all', label: 'All people' })
      : clone(pendingScope || currentScope());
    cleanSession = {
      version: 3,
      scope,
      remaining: recognized.length,
      successfulTypes: new Set(),
      failed: needsReview.length > 0 || errors.length > 0,
      datasetTypes,
      files: (pendingFiles.length ? pendingFiles : recognized.map(entry => entry.file).filter(Boolean)).map(file => ({
        name: file.name,
        size: Number(file.size) || 0,
        lastModified: Number(file.lastModified) || 0
      }))
    };
    return cleanSession;
  }

  function finalizeCleanSession() {
    const session = cleanSession;
    if (!session || session.remaining > 0) return null;
    cleanSession = null;
    pendingFiles = [];
    pendingScope = null;
    if (session.failed || session.successfulTypes.size !== session.datasetTypes.length) {
      showToast('Clean Upload needs review · the previous authoritative scope was retained because one or more sources did not save.', 7000);
      return null;
    }
    const baseline = {
      version: 3,
      createdAt: new Date().toISOString(),
      scope: clone(session.scope),
      scopeHash: session.scope && session.scope.scopeHash || '',
      datasetTypes: Array.from(session.successfulTypes),
      files: session.files,
      completedWithWarnings: Boolean(session.failed)
    };
    writeBaseline(baseline);
    const storage = root.CoachToolsStorage;
    if (storage && typeof storage.setScope === 'function') storage.setScope(baseline.scope);
    if (storage && typeof storage.setLastCleanScope === 'function') storage.setLastCleanScope(baseline.scope);
    root.dispatchEvent(new CustomEvent('coachtools:clean-upload-baseline', { detail: clone(baseline) }));
    showToast(`Clean Upload saved · ${baseline.datasetTypes.length} data source${baseline.datasetTypes.length === 1 ? '' : 's'} · ${scopeLabel(baseline.scope)}. Update Data will follow this baseline.`);
    return baseline;
  }

  async function adoptCleanScope(scope) {
    if (!cleanSession || !scope) return scope;
    const normalized = typeof importer.resolveScopeSnapshot === 'function' ? await importer.resolveScopeSnapshot(scope) : clone(scope);
    if (cleanSession.successfulTypes.size && cleanSession.scope && cleanSession.scope.scopeHash !== normalized.scopeHash) {
      cleanSession.failed = true;
      throw new Error('Clean Upload used more than one scope. The previous authoritative scope was retained.');
    }
    cleanSession.scope = normalized;
    return normalized;
  }

  function cancelPendingCleanSession() {
    cleanSession = null;
    updateSession = null;
    pendingFiles = [];
    pendingScope = null;
    mode = '';
  }

  async function prepareUpdateSession(result) {
    const baseline = readBaseline();
    const recognized = Array.isArray(result && result.recognized) ? result.recognized : [];
    if (!recognized.length) {
      updateSession = null;
      return;
    }
    const selected = baseline && Array.isArray(baseline.datasetTypes) && baseline.datasetTypes.length
      ? new Set(baseline.datasetTypes)
      : null;
    const resolution = root.CoachToolsData && typeof root.CoachToolsData.resolveUpdateScope === 'function'
      ? await root.CoachToolsData.resolveUpdateScope(selected ? Array.from(selected) : undefined)
      : { needsReview: false, scope: reusableScope(baseline && baseline.scope) || reusableScope(currentScope()), source: baseline ? 'clean-baseline' : 'global-scope' };
    updateSession = { baseline: baseline || null, resolution, remaining: recognized.length, plannedAt: new Date().toISOString() };

    for (const entry of recognized) {
      const type = entry && entry.classification && entry.classification.id;
      entry._coachtoolsBaselineSkip = Boolean(selected && !selected.has(type));
      entry._coachtoolsUpdatePlan = null;
      if (entry._coachtoolsBaselineSkip) entry.parsed = null;
    }
    if (resolution.needsReview) return;

    const plansByType = new Map();
    for (const entry of recognized) {
      if (entry._coachtoolsBaselineSkip) continue;
      const type = entry.classification.id;
      try {
        const prepared = await prepareUpdateDataset(entry, { scope: resolution.scope });
        const metadata = updateMetadata(entry, prepared);
        const inspection = root.CoachToolsData && typeof root.CoachToolsData.inspectDataset === 'function'
          ? await root.CoachToolsData.inspectDataset(type, prepared.dataset, metadata)
          : { status: 'new', reason: 'No comparison service was available.', becomesCurrent: true, candidate: { periodSort: entry.classification.detectedPeriod && entry.classification.detectedPeriod.sortKey || '' } };
        const plan = { prepared, metadata, inspection, selected: false };
        entry._coachtoolsUpdatePlan = plan;
        if (!plansByType.has(type)) plansByType.set(type, []);
        plansByType.get(type).push({ entry, plan });
      } catch (error) {
        entry._coachtoolsUpdatePlan = {
          error,
          selected: false,
          inspection: { status: 'needs-review', reason: error && error.message || String(error), becomesCurrent: false }
        };
      }
      await yieldMainThread();
    }

    for (const plans of plansByType.values()) {
      const actionable = plans
        .filter(item => ['new', 'updated'].includes(item.plan.inspection && item.plan.inspection.status))
        .sort((left, right) => {
          const leftPeriod = String(left.plan.inspection.candidate && left.plan.inspection.candidate.periodSort || '');
          const rightPeriod = String(right.plan.inspection.candidate && right.plan.inspection.candidate.periodSort || '');
          return rightPeriod.localeCompare(leftPeriod)
            || (Number(right.entry.file && right.entry.file.lastModified) || 0) - (Number(left.entry.file && left.entry.file.lastModified) || 0)
            || String(right.entry.file && right.entry.file.name || '').localeCompare(String(left.entry.file && left.entry.file.name || ''));
        });
      if (actionable[0]) actionable[0].plan.selected = true;
    }
  }

  async function prepareUpdateDataset(entry, options) {
    if (!entry || !entry.parsed || !entry.classification || !entry.classification.id) {
      throw new Error('The file has not been safely classified.');
    }
    const type = entry.classification.id;
    const scopeSnapshot = typeof importer.resolveScopeSnapshot === 'function'
      ? await importer.resolveScopeSnapshot(options && options.scope || { mode: 'all', label: 'All people' })
      : options && options.scope;
    await yieldMainThread();
    const result = importer.prepareScopedDataset(entry.parsed, type, scopeSnapshot, { ...(options || {}), clone: false, detectedPeriod: entry.classification.detectedPeriod });
    if (!result.valid) {
      const error = new Error(result.reason);
      error.name = 'CoachToolsScopeValidationError';
      error.code = 'COACHTOOLS_SCOPE_REVIEW';
      error.scopeMatchDiagnostics = result.diagnostics;
      throw error;
    }
    return result;
  }

  function updateMetadata(entry, prepared) {
    const dataset = prepared.dataset;
    return {
      originalFileName: entry.file && entry.file.name || dataset.meta && dataset.meta.fileName || '',
      fileSize: entry.file && entry.file.size || dataset.meta && dataset.meta.fileSize || 0,
      fileModifiedDate: entry.file && entry.file.lastModified ? new Date(entry.file.lastModified).toISOString() : dataset.meta && dataset.meta.fileModifiedDate || '',
      rowCount: dataset.meta && dataset.meta.totalRows || 0,
      detectedPeriod: entry.classification.detectedPeriod,
      classificationMethod: entry.classification.classificationMethod || entry.classification.reason || 'filename+headers',
      validationStatus: entry.classification.validation && entry.classification.validation.valid === false ? 'needs-review' : 'ready',
      automaticImport: true,
      scopeSnapshot: prepared.scopeSnapshot,
      scopeHash: prepared.scopeHash,
      scopeMode: prepared.scopeSnapshot.mode,
      scopedRowCount: prepared.matchedRows,
      scopeMatchDiagnostics: prepared.diagnostics,
      scopedFingerprint: prepared.scopedFingerprint
    };
  }

  async function saveUpdateEntryResponsive(entry, options) {
    if (!root.CoachToolsData || typeof root.CoachToolsData.importDataset !== 'function') {
      throw new Error('The central CoachTools data API is unavailable.');
    }
    const type = entry.classification.id;
    const plan = entry._coachtoolsUpdatePlan;
    if (plan && plan.inspection && plan.inspection.status === 'needs-review') {
      throw plan.error || new Error(plan.inspection.reason || 'Update needs review. The existing dataset was retained.');
    }
    if (plan && !plan.selected) {
      entry.parsed = null;
      return {
        status: 'duplicate',
        comparisonStatus: plan.inspection && plan.inspection.status || 'current',
        skippedByUpdatePlan: true,
        dataset: plan.inspection && (plan.inspection.current || plan.inspection.candidate) || null
      };
    }
    const prepared = plan && plan.prepared || await prepareUpdateDataset(entry, options);
    const dataset = prepared.dataset;
    await nextPaint();
    const result = await root.CoachToolsData.importDataset(type, dataset, plan && plan.metadata || updateMetadata(entry, prepared));
    // Once IndexedDB owns the update, release the parsed workbook before the next
    // file is prepared. This keeps multi-file updates from accumulating huge trees.
    entry.parsed = null;
    return { ...result, comparisonStatus: plan && plan.inspection && plan.inspection.status || result.status };
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
        await beginCleanSession(result);
        mode = '';
      } else if (mode === 'update') {
        await prepareUpdateSession(result);
        result.updateMode = true;
        result.authoritativeUpdateScope = updateSession && updateSession.resolution && clone(updateSession.resolution.scope);
        result.updateScopeNeedsReview = Boolean(updateSession && updateSession.resolution && updateSession.resolution.needsReview);
        result.updateScopeReason = updateSession && updateSession.resolution && updateSession.resolution.reason || '';
        mode = '';
      }
      return result;
    },
    async saveRecognizedEntry(entry, options) {
      const nextOptions = { ...(options || {}) };
      const session = updateSession;
      const baselineScope = session && session.resolution && reusableScope(session.resolution.scope);
      const savedBaseline = readBaseline();
      const cleanScope = reusableScope(savedBaseline && savedBaseline.scope);
      if (session && baselineScope) {
        nextOptions.scope = baselineScope;
      } else if (Object.prototype.hasOwnProperty.call(nextOptions, 'scope') && nextOptions.scope === null) {
        nextOptions.scope = cleanSession && cleanSession.scope || baselineScope || cleanScope || reusableScope(currentScope());
      }

      let result = null;
      try {
        if (cleanSession && nextOptions.scope) nextOptions.scope = await adoptCleanScope(nextOptions.scope);
        if (session && session.resolution && session.resolution.needsReview) throw new Error(session.resolution.reason || 'Update needs scope review.');
        if (entry && entry._coachtoolsBaselineSkip) {
          result = { status: 'duplicate', comparisonStatus: 'skipped', skippedByCleanUploadBaseline: true };
          return result;
        }
        if (session) {
          // Give the progress UI a frame before each expensive persistence stage,
          // then use the update-specific preparation path that filters in chunks
          // instead of JSON-cloning the entire parsed workbook first.
          await nextPaint();
          result = await saveUpdateEntryResponsive(entry, nextOptions);
          return result;
        }
        result = await originalSaveRecognizedEntry(entry, nextOptions);
        return result;
      } catch (error) {
        if (cleanSession) cleanSession.failed = true;
        throw error;
      } finally {
        if (cleanSession && cleanSession.remaining > 0) {
          if (result && entry && entry.classification && entry.classification.id) cleanSession.successfulTypes.add(entry.classification.id);
          cleanSession.remaining -= 1;
          if (cleanSession.remaining <= 0) finalizeCleanSession();
        }
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
    if (input) input.addEventListener('cancel', () => {
      if (mode === 'clean') cancelPendingCleanSession();
      else if (mode === 'update') { mode = ''; updateSession = null; }
    }, true);
  }

  root.CoachToolsCleanUploadBaseline = Object.freeze({
    VERSION: '3.0.0',
    getBaseline: readBaseline,
    clearBaseline() {
      try { root.localStorage.removeItem(BASELINE_KEY); } catch (_) {}
      updateSession = null;
      cancelPendingCleanSession();
    },
    cancelPending: cancelPendingCleanSession,
    hasPending: () => Boolean(cleanSession)
  });

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})(window);
