(function attachCoachToolsRememberedData(root) {
  'use strict';

  const HANDLE_DB = 'coachtools.desktop.directory.v1';
  const HANDLE_STORE = 'handles';
  const HANDLE_KEY = 'storage-directory';
  const FILE_SIGNATURES_KEY = 'coachtools.desktop.rememberedFolderFiles.v2';
  const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);

  let cachedDirectoryHandle = null;
  let handleLoaded = false;
  let updateRunning = false;

  function $(id) { return root.document && root.document.getElementById(id); }

  function extensionOf(name) {
    const match = String(name || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
    return match ? match[1] : '';
  }

  function isSupported(name) {
    const importer = root.CoachToolsImport;
    if (importer && typeof importer.isSupportedFile === 'function') return importer.isSupportedFile(name);
    return SUPPORTED_EXTENSIONS.has(extensionOf(name));
  }

  function readJson(key, fallback) {
    try {
      const raw = root.localStorage && root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { root.localStorage && root.localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function scopedFileKey(path, datasetType, scopeHash) {
    return `${String(scopeHash || 'legacy-unscoped')}|${String(datasetType || 'unknown')}|${String(path || '').replace(/\\/g, '/')}`;
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
      console.warn('[CoachToolsRememberedData] Folder will work for this session but could not be persisted.', error);
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

    // The handle is loaded during startup so normal clicks do not need to wait on
    // IndexedDB before asking for permission. If a user clicks immediately during
    // startup, fall back to the picker rather than losing the user gesture.
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
        output.push({ path: relativePath, file, signature: `${Number(file.size) || 0}:${Number(file.lastModified) || 0}` });
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
    showToast.timer = root.setTimeout(() => { toast.hidden = true; }, duration || 4300);
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
    return {
      ready: statuses.filter(item => item.ready).length,
      total: statuses.length || 8
    };
  }

  function refreshAvailabilityNote() {
    const note = $('storageAvailability');
    if (!note || root.location.protocol !== 'file:') return;
    if (cachedDirectoryHandle) {
      note.textContent = `Update Data is connected to ${cachedDirectoryHandle.name || 'your saved storage folder'}. Click Update Data to check for changed Excel/CSV files; you do not need to select them again.`;
    } else if (typeof root.showDirectoryPicker === 'function') {
      note.textContent = 'Click Update Data once to connect your CoachTools storage folder. CoachTools will remember that folder and reuse it on future updates.';
    } else {
      note.textContent = 'This browser cannot remember a local folder. Use Chrome or Edge for one-click Update Data, or use Data Manager for manual file selection.';
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
    const data = root.CoachToolsData;
    if (!importer || !data || typeof importer.analyzeFiles !== 'function' || typeof importer.saveRecognizedEntry !== 'function') {
      showToast('CoachTools shared import services are not ready yet. Try Update Data again.', 5600);
      return;
    }

    const directory = await resolveDirectoryForClick();
    if (!directory) {
      const manualInput = $('quickDataInput');
      showToast('Remembered folders are not supported here. Opening the manual file picker instead.', 5200);
      if (manualInput) manualInput.click();
      return;
    }

    const baseline = root.CoachToolsCleanUploadBaseline && typeof root.CoachToolsCleanUploadBaseline.getBaseline === 'function' ? root.CoachToolsCleanUploadBaseline.getBaseline() : null;
    const resolution = typeof data.resolveUpdateScope === 'function'
      ? await data.resolveUpdateScope(baseline && baseline.datasetTypes)
      : { needsReview: false, scope: root.CoachToolsStorage && root.CoachToolsStorage.getScope ? root.CoachToolsStorage.getScope() : { mode: 'all', label: 'All people' } };
    if (resolution.needsReview) {
      finishProgress(resolution.reason || 'Update needs scope review. Existing data was retained.', { warning: true });
      showToast(resolution.reason || 'Update needs scope review.', 6500);
      return;
    }
    const scope = typeof importer.resolveScopeSnapshot === 'function' ? await importer.resolveScopeSnapshot(resolution.scope) : resolution.scope;
    const scopeHash = scope && scope.scopeHash || 'legacy-unscoped';
    const scopeName = scope && (scope.label || scope.mode) || 'All people';

    setSteps([{ label: 'Checking remembered storage folder', status: 'active' }]);
    setProgress(4, `Updating scope: ${scopeName}`, directory.name || 'storage', '', 'Looking for changed Excel and CSV files inside the authoritative scope…');

    const records = await walkDirectory(directory, '', 0, []);
    if (!records.length) {
      finishProgress('No XLSX, XLS, or CSV files were found in the remembered storage folder.', { warning: true });
      showToast('No supported data files were found in the remembered storage folder.', 5200);
      return;
    }

    const previous = readJson(FILE_SIGNATURES_KEY, {});
    const changed = records.filter(record => {
      const saved = Object.values(previous).find(value => value && value.path === record.path && value.scopeHash === scopeHash && value.fileSignature === record.signature);
      return !saved;
    });
    if (!changed.length) {
      const counts = currentReadyCount();
      setSteps([
        { label: 'Checking remembered storage folder', status: 'success' },
        { label: 'No file changes found', status: 'success' }
      ]);
      finishProgress(`Scope preserved: ${scopeName} · ${records.length} file${records.length === 1 ? '' : 's'} unchanged · existing CoachTools data kept.`, { count: `${counts.ready} of ${counts.total}` });
      showToast(`Update complete · ${records.length} file${records.length === 1 ? '' : 's'} unchanged.`);
      refreshAvailabilityNote();
      return;
    }

    const fileRecords = new WeakMap();
    changed.forEach(record => fileRecords.set(record.file, record));
    setSteps([
      { label: 'Checking remembered storage folder', status: 'success' },
      { label: 'Reading changed files', status: 'active' }
    ]);

    const analysis = await importer.analyzeFiles(changed.map(record => record.file), {
      onProgress(progress) {
        const fileIndex = Math.max(0, Number(progress.fileIndex) || 0);
        const sheetFraction = progress.total ? Number(progress.current || 0) / Number(progress.total) : 0;
        const fraction = (fileIndex + sheetFraction) / Math.max(1, changed.length);
        setProgress(10 + fraction * 52, 'Reading changed files', `${progress.fileName || ''}${progress.sheetName ? ` · ${progress.sheetName}` : ''}`, `${Math.min(changed.length, fileIndex + 1)} of ${changed.length}`, `${changed.length} changed file${changed.length === 1 ? '' : 's'} found.`);
      }
    });

    setSteps([
      { label: 'Checking remembered storage folder', status: 'success' },
      { label: 'Reading changed files', status: analysis.errors.length ? 'warning' : 'success' },
      { label: 'Saving shared data', status: 'active' }
    ]);

    const imported = [];
    const errors = analysis.errors.map(entry => `${entry.file && entry.file.name || 'File'}: ${entry.error && entry.error.message || entry.error}`);
    for (let index = 0; index < analysis.recognized.length; index += 1) {
      const entry = analysis.recognized[index];
      const record = fileRecords.get(entry.file);
      const type = entry.classification && entry.classification.id;
      try {
        const label = importer.SOURCES && importer.SOURCES[type] ? importer.SOURCES[type].label : type || 'data';
        setProgress(66 + ((index + 1) / Math.max(1, analysis.recognized.length)) * 30, `Saving ${label}`, entry.file.name, `${index + 1} of ${analysis.recognized.length}`, 'Writing changed data to CoachTools IndexedDB…');
        const result = await importer.saveRecognizedEntry(entry, { scope });
        imported.push({ type, fileName: entry.file.name, status: result && result.status || 'saved' });
        if (record && !(result && result.skippedByCleanUploadBaseline)) previous[scopedFileKey(record.path, type, scopeHash)] = {
          path: record.path,
          filename: entry.file.name,
          fileSignature: record.signature,
          datasetType: type,
          scopeHash,
          scopedFingerprint: result && result.dataset && (result.dataset.scopedFingerprint || result.dataset.fingerprint) || '',
          scopedRowCount: result && result.dataset && Number(result.dataset.scopedRowCount) || 0,
          datasetId: result && result.dataset && (result.dataset.datasetId || result.dataset.id) || '',
          lastCheckedAt: new Date().toISOString()
        };
      } catch (error) {
        errors.push(`${entry.file.name}: ${error && error.message || error}`);
      }
    }
    writeJson(FILE_SIGNATURES_KEY, previous);

    const needsReview = analysis.needsReview.length;
    const counts = currentReadyCount();
    const savedCount = imported.filter(item => item.status !== 'duplicate').length;
    const duplicateCount = imported.filter(item => item.status === 'duplicate').length;
    const summaryParts = [
      `Scope preserved: ${scopeName}`,
      `${counts.ready} of ${counts.total} data sources ready`,
      savedCount ? `${savedCount} changed file${savedCount === 1 ? '' : 's'} imported` : '',
      duplicateCount ? `${duplicateCount} already current` : '',
      needsReview ? `${needsReview} need review in Data Manager` : '',
      errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : ''
    ].filter(Boolean);

    setSteps([
      { label: 'Checking remembered storage folder', status: 'success' },
      { label: 'Reading changed files', status: analysis.errors.length ? 'warning' : 'success' },
      { label: 'Saving shared data', status: errors.length ? 'warning' : 'success' },
      { label: 'Ready', status: needsReview || errors.length ? 'warning' : 'success' }
    ]);
    finishProgress(`${summaryParts.join(' · ')}.`, { warning: Boolean(needsReview || errors.length), count: `${counts.ready} of ${counts.total}` });
    showToast(needsReview || errors.length ? 'Update finished with items to review.' : 'CoachTools data updated from the remembered folder.', 5200);
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
      if (root.CoachToolsCleanUploadBaseline && typeof root.CoachToolsCleanUploadBaseline.cancelPending === 'function') root.CoachToolsCleanUploadBaseline.cancelPending();
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
    root.addEventListener('focus', refreshAvailabilityNote);
    loadSavedHandle();
    refreshAvailabilityNote();
  }

  root.CoachToolsRememberedData = Object.freeze({
    VERSION: '1.0.0',
    runUpdate,
    refreshAvailabilityNote,
    clearSavedHandle
  });

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})(window);
