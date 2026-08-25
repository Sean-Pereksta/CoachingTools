(function attachCoachToolsRememberedData(root) {
  'use strict';

  const HANDLE_DB = 'coachtools.desktop.directory.v1';
  const HANDLE_STORE = 'handles';
  const HANDLE_KEY = 'storage-directory';
  const BASELINE_KEY = 'coachtools.desktop.cleanUploadBaseline.v1';
  const SOURCE_NAMES_KEY = 'coachtools.desktop.updateSourceNames.v1';
  const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
  const MAX_NAME_HISTORY = 4;

  let cachedDirectoryHandle = null;
  let handleLoaded = false;
  let updateRunning = false;

  function $(id) { return root.document && root.document.getElementById(id); }
  function clone(value) {
    try { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  }
  function readJson(key, fallback) {
    try {
      const raw = root.localStorage && root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }
  function writeJson(key, value) {
    try { root.localStorage && root.localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }
  function extensionOf(name) {
    const match = String(name || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
    return match ? match[1] : '';
  }
  function isSupported(name) {
    const importer = root.CoachToolsImport;
    if (importer && typeof importer.isSupportedFile === 'function') return importer.isSupportedFile(name);
    return SUPPORTED_EXTENSIONS.has(extensionOf(name));
  }
  function display(value) { return String(value == null ? '' : value).trim().replace(/\s+/g, ' '); }
  function normalizeFamily(name) {
    return display(name)
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[_\-./]+/g, ' ')
      .replace(/\b(?:final|copy|download|export|new|updated|current)\b/g, ' ')
      .replace(/\b\d+\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function familyTokens(name) {
    return normalizeFamily(name).split(' ').filter(token => token.length > 1);
  }
  function nameMatchScore(candidateName, templateName) {
    const candidate = normalizeFamily(candidateName);
    const template = normalizeFamily(templateName);
    if (!candidate || !template) return 0;
    if (candidate === template) return 100;
    const a = new Set(familyTokens(candidateName));
    const b = new Set(familyTokens(templateName));
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection += 1;
    if (!intersection) return 0;
    const union = new Set([...a, ...b]).size;
    const jaccard = intersection / Math.max(1, union);
    const coverage = intersection / Math.max(1, Math.min(a.size, b.size));
    return Math.round((jaccard * 70 + coverage * 30) * 100) / 100;
  }
  function candidateTemplates(baseline, rememberedNames) {
    const names = [];
    for (const file of baseline && Array.isArray(baseline.files) ? baseline.files : []) {
      if (file && file.name) names.push(file.name);
    }
    for (const values of Object.values(rememberedNames || {})) {
      if (Array.isArray(values)) names.push(...values);
    }
    return Array.from(new Set(names.map(display).filter(Boolean)));
  }
  function selectBaselineCandidates(records, baseline, rememberedNames) {
    const templates = candidateTemplates(baseline, rememberedNames);
    if (!templates.length) return [];
    const selected = new Map();
    for (const template of templates) {
      const ranked = records
        .map(record => ({ record, score: nameMatchScore(record.file && record.file.name, template) }))
        .filter(item => item.score >= 60)
        .sort((left, right) =>
          right.score - left.score
          || (Number(right.record.file && right.record.file.lastModified) || 0) - (Number(left.record.file && left.record.file.lastModified) || 0)
          || (Number(right.record.file && right.record.file.size) || 0) - (Number(left.record.file && left.record.file.size) || 0)
          || String(left.record.path || '').localeCompare(String(right.record.path || ''))
        );
      if (!ranked.length) continue;

      // Files with the same normalized family are the same export family. Prefer
      // the newest one rather than clinging to the exact old Clean Upload filename.
      const bestScore = ranked[0].score;
      const closeMatches = ranked.filter(item => item.score >= Math.max(60, bestScore - 8));
      closeMatches.sort((left, right) =>
        (Number(right.record.file && right.record.file.lastModified) || 0) - (Number(left.record.file && left.record.file.lastModified) || 0)
        || right.score - left.score
      );
      const record = closeMatches[0].record;
      selected.set(record.path, record);
    }
    return Array.from(selected.values());
  }
  function newestEntriesByType(entries) {
    const selected = new Map();
    for (const entry of entries || []) {
      const type = entry && entry.classification && entry.classification.id;
      if (!type) continue;
      const existing = selected.get(type);
      if (!existing) {
        selected.set(type, entry);
        continue;
      }
      const currentPeriod = String(entry.classification.detectedPeriod && entry.classification.detectedPeriod.sortKey || '');
      const savedPeriod = String(existing.classification.detectedPeriod && existing.classification.detectedPeriod.sortKey || '');
      const newer = currentPeriod.localeCompare(savedPeriod)
        || (Number(entry.file && entry.file.lastModified) || 0) - (Number(existing.file && existing.file.lastModified) || 0)
        || String(entry.file && entry.file.name || '').localeCompare(String(existing.file && existing.file.name || ''));
      if (newer > 0) selected.set(type, entry);
    }
    return Array.from(selected.values());
  }
  function rememberSourceName(datasetType, fileName) {
    if (!datasetType || !fileName) return;
    const remembered = readJson(SOURCE_NAMES_KEY, {});
    const list = Array.isArray(remembered[datasetType]) ? remembered[datasetType] : [];
    remembered[datasetType] = [fileName, ...list.filter(name => normalizeFamily(name) !== normalizeFamily(fileName))]
      .slice(0, MAX_NAME_HISTORY);
    writeJson(SOURCE_NAMES_KEY, remembered);
  }

  function openHandleDb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error('IndexedDB is unavailable.'));
        return;
      }
      const request = root.indexedDB.open(HANDLE_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open remembered-folder storage.'));
    });
  }
  async function loadSavedHandle() {
    try {
      const db = await openHandleDb();
      const handle = await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readonly');
        const request = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Could not read the saved folder.'));
      });
      db.close();
      cachedDirectoryHandle = handle && handle.kind === 'directory' ? handle : null;
    } catch (_) {
      cachedDirectoryHandle = null;
    } finally {
      handleLoaded = true;
      refreshAvailabilityNote();
    }
    return cachedDirectoryHandle;
  }
  async function saveHandle(handle) {
    cachedDirectoryHandle = handle || null;
    if (!handle || !root.indexedDB) return;
    try {
      const db = await openHandleDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readwrite');
        tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not remember the folder.'));
        tx.onabort = () => reject(tx.error || new Error('Could not remember the folder.'));
      });
      db.close();
    } catch (error) {
      console.warn('[CoachToolsRememberedData] Folder works for this session but could not be persisted.', error);
    }
    refreshAvailabilityNote();
  }
  async function clearSavedHandle() {
    cachedDirectoryHandle = null;
    try {
      const db = await openHandleDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readwrite');
        tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not clear the saved folder.'));
      });
      db.close();
    } catch (_) {}
    refreshAvailabilityNote();
  }
  async function permissionGranted(handle, requestIfNeeded) {
    if (!handle) return false;
    const options = { mode: 'read' };
    try {
      if (typeof handle.queryPermission === 'function') {
        const current = await handle.queryPermission(options);
        if (current === 'granted') return true;
        if (!requestIfNeeded || current === 'denied') return false;
      }
      if (requestIfNeeded && typeof handle.requestPermission === 'function') {
        return await handle.requestPermission(options) === 'granted';
      }
    } catch (_) {}
    return false;
  }
  async function normalizePickedDirectory(handle) {
    if (!handle || handle.kind !== 'directory') return handle;
    if (String(handle.name || '').toLowerCase() === 'storage') return handle;
    try {
      const storage = await handle.getDirectoryHandle('storage', { create: false });
      if (storage && storage.kind === 'directory') return storage;
    } catch (_) {}
    return handle;
  }
  async function chooseDirectory() {
    if (typeof root.showDirectoryPicker !== 'function') return null;
    const picked = await root.showDirectoryPicker({ id: 'coachtools-storage', mode: 'read' });
    const normalized = await normalizePickedDirectory(picked);
    await saveHandle(normalized);
    return normalized;
  }
  async function resolveDirectoryForClick() {
    if (cachedDirectoryHandle) {
      if (await permissionGranted(cachedDirectoryHandle, true)) return cachedDirectoryHandle;
      await clearSavedHandle();
    }
    if (!handleLoaded && typeof root.showDirectoryPicker === 'function') return chooseDirectory();
    if (typeof root.showDirectoryPicker === 'function') return chooseDirectory();
    return null;
  }
  async function walkDirectory(directory, prefix, depth, output) {
    if (!directory || depth > 4) return output;
    for await (const [name, handle] of directory.entries()) {
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'file' && isSupported(name)) {
        const file = await handle.getFile();
        output.push({ path: relativePath, file });
      } else if (handle.kind === 'directory' && depth < 4) {
        await walkDirectory(handle, relativePath, depth + 1, output);
      }
    }
    return output;
  }

  function showToast(message, duration) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    root.clearTimeout(showToast.timer);
    showToast.timer = root.setTimeout(() => { toast.hidden = true; }, duration || 4500);
  }
  function setProgress(percent, source, fileName, count, summary) {
    const panel = $('importProgress');
    const close = $('importClose');
    const review = $('importReview');
    const fill = $('importProgressFill');
    const sourceElement = $('importCurrentSource');
    const fileElement = $('importCurrentFile');
    const countElement = $('importCount');
    const summaryElement = $('importSummary');
    if (panel) panel.hidden = false;
    if (close) close.hidden = true;
    if (review) review.hidden = true;
    if (fill) {
      const value = Math.max(0, Math.min(100, Number(percent) || 0));
      fill.style.width = `${value}%`;
      if (fill.parentElement) fill.parentElement.setAttribute('aria-valuenow', String(Math.round(value)));
    }
    if (sourceElement && source != null) sourceElement.textContent = source;
    if (fileElement && fileName != null) fileElement.textContent = fileName;
    if (countElement && count != null) countElement.textContent = count;
    if (summaryElement && summary != null) summaryElement.textContent = summary;
  }
  function setSteps(steps) {
    const list = $('importSteps');
    if (!list) return;
    list.replaceChildren(...steps.map(step => {
      const item = root.document.createElement('li');
      item.className = `progress-step ${step.status || 'active'}`;
      item.textContent = step.label;
      return item;
    }));
  }
  function finishProgress(summary, options) {
    setProgress(100, options && options.warning ? 'Review needed' : 'Ready', '', options && options.count || '', summary);
    const close = $('importClose');
    if (close) close.hidden = false;
  }
  function currentReadyCount() {
    const storage = root.CoachToolsStorage;
    const statuses = storage && typeof storage.getDatasetStatus === 'function' ? storage.getDatasetStatus() : [];
    return { ready: statuses.filter(item => item.ready).length, total: statuses.length || 8 };
  }
  function sourceLabel(type) {
    const importer = root.CoachToolsImport;
    return importer && importer.SOURCES && importer.SOURCES[type] ? importer.SOURCES[type].label : type;
  }
  function refreshAvailabilityNote() {
    const note = $('storageAvailability');
    if (!note || root.location.protocol !== 'file:') return;
    const baseline = readJson(BASELINE_KEY, null);
    if (cachedDirectoryHandle && baseline && baseline.scope) {
      note.textContent = `Update Data replays the last successful Clean Upload scope from ${cachedDirectoryHandle.name || 'your saved storage folder'} and automatically finds the matching export names.`;
    } else if (cachedDirectoryHandle) {
      note.textContent = 'Folder connected. Run Clean Upload once to establish the authoritative scope and source-name baseline that Update Data should replay.';
    } else if (typeof root.showDirectoryPicker === 'function') {
      note.textContent = 'Run Clean Upload once, then click Update Data to connect the folder containing those exports. CoachTools will reuse that folder after permission is granted.';
    } else {
      note.textContent = 'This browser cannot remember a local folder. Use Chrome or Edge, or use Clean Upload / Data Manager for manual file selection.';
    }
  }
  function delegateToLauncherScanner() {
    const proxy = root.document.createElement('button');
    proxy.type = 'button';
    proxy.hidden = true;
    proxy.dataset.action = 'scan-storage';
    root.document.body.appendChild(proxy);
    proxy.click();
    proxy.remove();
  }

  async function updateFromRememberedDirectory() {
    const importer = root.CoachToolsImport;
    const baselineApi = root.CoachToolsCleanUploadBaseline;
    if (!importer || typeof importer.analyzeFiles !== 'function' || typeof importer.saveRecognizedEntry !== 'function') {
      showToast('CoachTools shared import services are not ready yet. Try Update Data again.', 5600);
      return;
    }

    // remembered-scope sees the same Update Data click first. Cancel its older
    // planning mode so this path can literally replay the Clean Upload contract
    // instead of resolving a second, potentially conflicting "active" scope.
    if (baselineApi && typeof baselineApi.cancelPending === 'function') baselineApi.cancelPending();

    const baseline = baselineApi && typeof baselineApi.getBaseline === 'function'
      ? baselineApi.getBaseline()
      : readJson(BASELINE_KEY, null);
    if (!baseline || !baseline.scope || !Array.isArray(baseline.datasetTypes) || !baseline.datasetTypes.length) {
      finishProgress('Update Data needs one successful Clean Upload first. No existing data was changed.', { warning: true });
      showToast('Run Clean Upload once first. Update Data will then reuse that exact scope and source set.', 6500);
      return;
    }

    const directory = await resolveDirectoryForClick();
    if (!directory) {
      const manualInput = $('quickDataInput');
      showToast('Remembered folders are not supported here. Opening manual file selection instead.', 5200);
      if (manualInput) manualInput.click();
      return;
    }

    const scope = clone(baseline.scope);
    if (baseline.scopeHash && !scope.scopeHash) scope.scopeHash = baseline.scopeHash;
    const scopeName = scope.label || scope.mode || 'All people';
    const allowedTypes = new Set(baseline.datasetTypes);

    // Reassert the Clean Upload scope for the desktop as well as the import.
    const storage = root.CoachToolsStorage;
    if (storage && typeof storage.setScope === 'function') storage.setScope(scope);
    if (storage && typeof storage.setLastCleanScope === 'function') storage.setLastCleanScope(scope);

    setSteps([{ label: 'Finding Clean Upload source files', status: 'active' }]);
    setProgress(4, `Replaying Clean Upload: ${scopeName}`, directory.name || 'storage', '', 'Scanning for the same export-name families used by the last successful Clean Upload…');

    const records = await walkDirectory(directory, '', 0, []);
    if (!records.length) {
      finishProgress('No XLSX, XLS, or CSV files were found in the remembered folder. Existing data was retained.', { warning: true });
      showToast('No supported data files were found in the remembered folder.', 5200);
      return;
    }

    const rememberedNames = readJson(SOURCE_NAMES_KEY, {});
    const matched = selectBaselineCandidates(records, baseline, rememberedNames);
    if (!matched.length) {
      const expected = candidateTemplates(baseline, rememberedNames).slice(0, 5).join(', ');
      finishProgress(`No files matched the Clean Upload source names${expected ? ` (${expected})` : ''}. Existing data was retained.`, { warning: true });
      showToast('No matching Clean Upload exports were found in the selected folder.', 6500);
      return;
    }

    setSteps([
      { label: 'Finding Clean Upload source files', status: 'success' },
      { label: 'Reading matched files', status: 'active' }
    ]);

    const analysis = await importer.analyzeFiles(matched.map(record => record.file), {
      onProgress(progress) {
        const fileIndex = Math.max(0, Number(progress.fileIndex) || 0);
        const sheetFraction = progress.total ? Number(progress.current || 0) / Number(progress.total) : 0;
        const fraction = (fileIndex + sheetFraction) / Math.max(1, matched.length);
        setProgress(
          10 + fraction * 46,
          'Reading matched Clean Upload files',
          `${progress.fileName || ''}${progress.sheetName ? ` · ${progress.sheetName}` : ''}`,
          `${Math.min(matched.length, fileIndex + 1)} of ${matched.length}`,
          'Only files matching the Clean Upload source-name families are being analyzed.'
        );
      }
    });

    const recognizedAllowed = analysis.recognized.filter(entry => allowedTypes.has(entry.classification && entry.classification.id));
    const entries = newestEntriesByType(recognizedAllowed);
    const recognizedTypes = new Set(entries.map(entry => entry.classification.id));
    const missingTypes = baseline.datasetTypes.filter(type => !recognizedTypes.has(type));

    setSteps([
      { label: 'Finding Clean Upload source files', status: 'success' },
      { label: 'Reading matched files', status: analysis.errors.length ? 'warning' : 'success' },
      { label: 'Saving with Clean Upload scope', status: 'active' }
    ]);

    const imported = [];
    const errors = analysis.errors.map(item => `${item.file && item.file.name || 'File'}: ${item.error && item.error.message || item.error}`);
    const ignoredReview = analysis.needsReview.length;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const type = entry.classification.id;
      const label = sourceLabel(type);
      setProgress(
        62 + ((index + 1) / Math.max(1, entries.length)) * 34,
        `Saving ${label}`,
        entry.file.name,
        `${index + 1} of ${entries.length}`,
        `Applying the same Clean Upload scope: ${scopeName}.`
      );
      try {
        const result = await importer.saveRecognizedEntry(entry, { scope });
        imported.push({ type, fileName: entry.file.name, status: result && result.status || 'saved' });
        rememberSourceName(type, entry.file.name);
      } catch (error) {
        errors.push(`${entry.file.name}: ${error && error.message || error}`);
      }
    }

    const counts = currentReadyCount();
    const savedCount = imported.filter(item => !['duplicate', 'current'].includes(item.status)).length;
    const currentCount = imported.length - savedCount;
    const warning = Boolean(errors.length || missingTypes.length || ignoredReview);
    const parts = [
      `Clean Upload scope preserved: ${scopeName}`,
      `${counts.ready} of ${counts.total} data sources ready`,
      savedCount ? `${savedCount} source${savedCount === 1 ? '' : 's'} refreshed` : '',
      currentCount ? `${currentCount} already current` : '',
      missingTypes.length ? `missing: ${missingTypes.map(sourceLabel).join(', ')}` : '',
      ignoredReview ? `${ignoredReview} matched file${ignoredReview === 1 ? '' : 's'} could not be classified` : '',
      errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : ''
    ].filter(Boolean);

    setSteps([
      { label: 'Finding Clean Upload source files', status: 'success' },
      { label: 'Reading matched files', status: analysis.errors.length || ignoredReview ? 'warning' : 'success' },
      { label: 'Saving with Clean Upload scope', status: errors.length ? 'warning' : 'success' },
      { label: 'Ready', status: warning ? 'warning' : 'success' }
    ]);
    finishProgress(`${parts.join(' · ')}.`, { warning, count: `${counts.ready} of ${counts.total}` });
    showToast(warning ? 'Update finished with a source to review.' : 'Update Data replayed the Clean Upload successfully.', 5400);
    refreshAvailabilityNote();
  }

  async function runUpdate() {
    if (updateRunning) {
      showToast('A data update is already running.');
      return;
    }
    updateRunning = true;
    try {
      if (root.location.protocol !== 'file:') {
        delegateToLauncherScanner();
        return;
      }
      await updateFromRememberedDirectory();
    } catch (error) {
      if (error && error.name === 'AbortError') {
        showToast('Data update cancelled.');
      } else {
        console.error('[CoachToolsRememberedData] Update failed.', error);
        finishProgress(`Update failed: ${error && error.message || error}`, { warning: true });
        showToast(`Update failed: ${error && error.message || error}`, 6500);
      }
    } finally {
      updateRunning = false;
      const baselineApi = root.CoachToolsCleanUploadBaseline;
      if (baselineApi && typeof baselineApi.cancelPending === 'function') baselineApi.cancelPending();
    }
  }

  function bind() {
    root.document.addEventListener('click', event => {
      const actionElement = event.target && event.target.closest && event.target.closest('[data-action]');
      const action = actionElement && actionElement.dataset.action;
      if (action === 'update-data') {
        event.preventDefault();
        runUpdate();
      }
      if (action === 'toggle-data-panel') root.setTimeout(refreshAvailabilityNote, 0);
    }, true);

    root.addEventListener('coachtools:data-updated', () => root.setTimeout(refreshAvailabilityNote, 0));
    root.addEventListener('coachtools:clean-upload-baseline', () => root.setTimeout(refreshAvailabilityNote, 0));
    root.addEventListener('focus', refreshAvailabilityNote);
    loadSavedHandle();
    refreshAvailabilityNote();
  }

  root.CoachToolsRememberedData = Object.freeze({
    VERSION: '2.0.0',
    runUpdate,
    refreshAvailabilityNote,
    clearSavedHandle,
    _test: Object.freeze({ normalizeFamily, nameMatchScore, selectBaselineCandidates, newestEntriesByType })
  });

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})(window);
