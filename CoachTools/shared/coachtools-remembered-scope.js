(function attachCoachToolsRememberedScope(root) {
  'use strict';

  const importer = root.CoachToolsImport;
  if (!importer || typeof importer.saveRecognizedEntry !== 'function' || typeof importer.analyzeFiles !== 'function') return;

  const BASELINE_KEY = 'coachtools.desktop.cleanUploadBaseline.v1';
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
    }

    updateSession = { baseline, remaining: recognized.length };
  }

  const originalAnalyzeFiles = importer.analyzeFiles.bind(importer);
  const originalSaveRecognizedEntry = importer.saveRecognizedEntry.bind(importer);

  const enhancedImporter = {
    ...importer,
    async analyzeFiles(files, options) {
      const result = await originalAnalyzeFiles(files, options);
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
      const baselineScope = updateSession && updateSession.baseline && reusableScope(updateSession.baseline.scope);
      const savedBaseline = readBaseline();
      const cleanScope = reusableScope(savedBaseline && savedBaseline.scope);
      if (Object.prototype.hasOwnProperty.call(nextOptions, 'scope') && nextOptions.scope === null) {
        nextOptions.scope = baselineScope || cleanScope || reusableScope(currentScope());
      }

      try {
        if (entry && entry._coachtoolsBaselineSkip) {
          return { status: 'duplicate', skippedByCleanUploadBaseline: true };
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
    VERSION: '2.0.1',
    getBaseline: readBaseline,
    clearBaseline() {
      try { root.localStorage.removeItem(BASELINE_KEY); } catch (_) {}
      updateSession = null;
    }
  });

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})(window);
