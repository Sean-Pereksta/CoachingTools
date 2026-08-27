(function attachCoachToolsDataRecovery(root) {
  'use strict';

  const VERSION = '1.0.0';
  const RECOVERY_KEY = 'coachtools.data.recovery.v1';
  const MAX_ISSUES = 8;
  const DATASET_STORES = Object.freeze([
    'coachtoolsDatasets',
    'coachtoolsDatasetChunks',
    'coachtoolsCurrent',
    'coachtoolsImports'
  ]);
  const FALLBACK_DB = 'allStarImportedDataCache.v1';
  const FALLBACK_LABELS = Object.freeze({
    weeklyRetail: 'Retail Weekly',
    weeklyReferral: 'Referral Weekly',
    monthlyRetail: 'Retail Monthly',
    monthlyReferral: 'Referral Monthly',
    qa: 'QA / 90-Day Evaluations',
    documentedCoaching: 'Documented Coaching',
    checklist: 'Checklist / All Items',
    compCoaching: 'Comp Coaching'
  });
  const TYPE_TO_LEGACY = Object.freeze({
    weeklyRetail: 'retail',
    weeklyReferral: 'referral',
    qa: 'qa',
    documentedCoaching: 'coaching',
    checklist: 'checklist'
  });

  let currentOperation = '';
  let operationTouchedAt = 0;
  let openFromRecovery = false;
  let dataApiBacking = null;
  let importApiBacking = null;
  const recentIssueSignatures = new Map();

  function display(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function readRecovery() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(RECOVERY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.active && Array.isArray(parsed.issues) && parsed.issues.length ? parsed : null;
    } catch (_) { return null; }
  }

  function writeRecovery(state) {
    try {
      if (!state || !state.active || !Array.isArray(state.issues) || !state.issues.length) {
        root.localStorage && root.localStorage.removeItem(RECOVERY_KEY);
        return;
      }
      root.localStorage && root.localStorage.setItem(RECOVERY_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function clearRecovery() {
    writeRecovery(null);
    renderMainRecoveryPrompt();
    refreshInjectedManagers();
  }

  function removeRecoveryForDataset(datasetType) {
    const state = readRecovery();
    if (!state) return;
    const issues = state.issues.filter(issue => issue.datasetType !== datasetType);
    if (!issues.length) {
      clearRecovery();
      return;
    }
    writeRecovery({ ...state, issues, updatedAt: new Date().toISOString() });
    renderMainRecoveryPrompt();
    refreshInjectedManagers();
  }

  function setOperation(name) {
    currentOperation = display(name);
    operationTouchedAt = Date.now();
  }

  function activeOperation() {
    if (!currentOperation || Date.now() - operationTouchedAt > 20 * 60 * 1000) return 'Data upload / update';
    return currentOperation;
  }

  function datasetLabel(datasetType, api) {
    return display(api && api.LABELS && api.LABELS[datasetType]) || FALLBACK_LABELS[datasetType] || (datasetType ? display(datasetType) : 'Source not safely identified');
  }

  function inferDatasetTypeFromFileName(fileName) {
    const name = display(fileName).toLowerCase();
    if (!name) return '';
    if (/comp.*coach|coach.*comp/.test(name)) return 'compCoaching';
    if (/checklist|all\s*items/.test(name)) return 'checklist';
    if (/documented.*coach|coach.*documented/.test(name)) return 'documentedCoaching';
    if (/\bqa\b|90[ -]?day|evaluation/.test(name)) return 'qa';
    if (/monthly/.test(name) && /referral/.test(name)) return 'monthlyReferral';
    if (/monthly/.test(name) && /retail/.test(name)) return 'monthlyRetail';
    if (/referral/.test(name)) return 'weeklyReferral';
    if (/retail/.test(name)) return 'weeklyRetail';
    return '';
  }

  function storageDetails(api) {
    const contract = api && api.storageContract;
    const stores = contract && Array.isArray(contract.stores)
      ? DATASET_STORES.filter(name => contract.stores.includes(name))
      : DATASET_STORES.slice();
    return {
      database: display(contract && contract.dbName) || display(api && api.DB_NAME) || FALLBACK_DB,
      stores: stores.length ? stores : DATASET_STORES.slice()
    };
  }

  function errorCode(error) {
    const name = display(error && error.name);
    const code = error && error.code != null ? display(error.code) : '';
    if (name && code) return `${name} (code ${code})`;
    return name || code || 'UploadError';
  }

  function issueSignature(issue) {
    return [issue.operation, issue.datasetType, issue.fileName, issue.errorCode, issue.message].join('|');
  }

  function reportIssue(datasetType, error, metadata, sourceApi) {
    const api = dataApiBacking || sourceApi || root.CoachToolsData;
    const details = storageDetails(api);
    const fileName = display(metadata && (metadata.originalFileName || metadata.fileName));
    const resolvedType = datasetType || inferDatasetTypeFromFileName(fileName);
    const issue = {
      id: `recovery_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      operation: display(metadata && metadata.operation) || activeOperation(),
      datasetType: resolvedType,
      datasetLabel: datasetLabel(resolvedType, api),
      fileName,
      database: details.database,
      stores: details.stores,
      errorCode: errorCode(error),
      message: display(error && error.message || error) || 'The upload did not complete successfully.'
    };

    const signature = issueSignature(issue);
    const lastSeen = recentIssueSignatures.get(signature) || 0;
    if (Date.now() - lastSeen < 3500) return issue;
    recentIssueSignatures.set(signature, Date.now());
    for (const [key, seenAt] of recentIssueSignatures) if (Date.now() - seenAt > 30000) recentIssueSignatures.delete(key);

    const previous = readRecovery();
    const issues = [issue, ...(previous && previous.issues || []).filter(existing => issueSignature(existing) !== signature)].slice(0, MAX_ISSUES);
    writeRecovery({ version: 1, active: true, updatedAt: issue.createdAt, issues });
    try { root.dispatchEvent(new CustomEvent('coachtools:data-recovery-needed', { detail: issue })); } catch (_) {}
    renderMainRecoveryPrompt();
    refreshInjectedManagers();
    return issue;
  }

  function cloneApi(api) {
    const copy = {};
    for (const key of Reflect.ownKeys(api || {})) {
      try { copy[key] = api[key]; } catch (_) {}
    }
    return copy;
  }

  function wrapDataApi(api) {
    if (!api || api.__coachtoolsRecoveryWrapped) return api;
    const wrapper = cloneApi(api);
    const wrapWrite = methodName => async function wrappedDatasetWrite(type, data, metadata) {
      try {
        return await api[methodName](type, data, metadata);
      } catch (error) {
        reportIssue(type, error, metadata || {}, api);
        throw error;
      }
    };
    if (typeof api.importDataset === 'function') wrapper.importDataset = wrapWrite('importDataset');
    if (typeof api.replaceDataset === 'function') wrapper.replaceDataset = wrapWrite('replaceDataset');
    Object.defineProperty(wrapper, '__coachtoolsRecoveryWrapped', { value: true, enumerable: false });
    return Object.freeze(wrapper);
  }

  function wrapImportApi(api) {
    if (!api || api.__coachtoolsRecoveryWrapped) return api;
    const wrapper = cloneApi(api);
    if (typeof api.analyzeFiles === 'function') {
      wrapper.analyzeFiles = async function wrappedAnalyzeFiles(files, options) {
        try {
          const result = await api.analyzeFiles(files, options);
          for (const item of result && result.errors || []) {
            const fileName = display(item && item.file && item.file.name);
            reportIssue(inferDatasetTypeFromFileName(fileName), item && item.error || new Error('File analysis failed.'), { fileName }, dataApiBacking);
          }
          return result;
        } catch (error) {
          reportIssue('', error, {}, dataApiBacking);
          throw error;
        }
      };
    }
    if (typeof api.saveRecognizedEntry === 'function') {
      wrapper.saveRecognizedEntry = async function wrappedSaveRecognizedEntry(entry, options) {
        const type = entry && entry.classification && entry.classification.id || '';
        const fileName = display(entry && entry.file && entry.file.name);
        try {
          return await api.saveRecognizedEntry(entry, options);
        } catch (error) {
          reportIssue(type || inferDatasetTypeFromFileName(fileName), error, { fileName }, dataApiBacking);
          throw error;
        }
      };
    }
    Object.defineProperty(wrapper, '__coachtoolsRecoveryWrapped', { value: true, enumerable: false });
    return Object.freeze(wrapper);
  }

  function installApiHook(propertyName, wrap, backingSetter) {
    const descriptor = Object.getOwnPropertyDescriptor(root, propertyName);
    if (descriptor && descriptor.configurable === false) {
      const existing = root[propertyName];
      if (existing) backingSetter(wrap(existing));
      return;
    }
    let value = root[propertyName] || null;
    if (value) value = wrap(value);
    backingSetter(value);
    try {
      Object.defineProperty(root, propertyName, {
        configurable: true,
        enumerable: true,
        get() { return propertyName === 'CoachToolsData' ? dataApiBacking : importApiBacking; },
        set(next) {
          const wrapped = wrap(next);
          backingSetter(wrapped);
        }
      });
    } catch (_) {
      if (value) root[propertyName] = value;
    }
  }

  function createElement(doc, tag, text) {
    const element = doc.createElement(tag);
    if (text != null) element.textContent = text;
    return element;
  }

  function latestIssue() {
    const state = readRecovery();
    return state && state.issues && state.issues[0] || null;
  }

  function renderMainRecoveryPrompt() {
    const doc = root.document;
    if (!doc) return;
    const card = doc.querySelector('#importProgress .import-card');
    if (!card) return;
    let prompt = card.querySelector('[data-coachtools-recovery-prompt]');
    const issue = latestIssue();
    if (!issue) {
      if (prompt) prompt.remove();
      return;
    }
    if (!prompt) {
      prompt = createElement(doc, 'section');
      prompt.dataset.coachtoolsRecoveryPrompt = 'true';
      Object.assign(prompt.style, {
        marginTop: '14px', padding: '12px 13px', border: '1px solid rgba(239,68,68,.45)',
        borderRadius: '12px', background: 'rgba(127,29,29,.12)', display: 'grid', gap: '7px'
      });
      card.appendChild(prompt);
    }
    prompt.replaceChildren();
    const title = createElement(doc, 'strong', 'Data storage error detected');
    const ask = createElement(doc, 'div', `${issue.datasetLabel} failed during ${issue.operation}. Please open Data Manager and delete the current stored data before retrying.`);
    const detail = createElement(doc, 'small', `Source: ${issue.datasetLabel}${issue.fileName ? ` · ${issue.fileName}` : ''} · IndexedDB: ${issue.database} · Stores: ${issue.stores.join(', ')} · ${issue.errorCode}: ${issue.message}`);
    Object.assign(detail.style, { opacity: '.78', lineHeight: '1.45' });
    const actions = createElement(doc, 'div');
    Object.assign(actions.style, { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' });
    const open = createElement(doc, 'button', 'Open');
    open.type = 'button';
    open.className = 'command-button';
    open.addEventListener('click', () => {
      openFromRecovery = true;
      const trigger = doc.querySelector('[data-action="open-weekly-data"]');
      if (trigger) trigger.click();
      root.setTimeout(scanForDataManagerFrames, 80);
    });
    actions.appendChild(open);
    prompt.append(title, ask, detail, actions);
  }

  function clearCompatibilityDock(win, datasetType) {
    const legacy = TYPE_TO_LEGACY[datasetType];
    const storage = win.CoachToolsStorage;
    const key = legacy && storage && storage.DOCK_KEYS && storage.DOCK_KEYS[legacy];
    if (!key) return;
    try { win.localStorage.removeItem(key); } catch (_) {}
  }

  async function waitForManagerApi(frame) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const win = frame.contentWindow;
        if (win && win.CoachToolsData && typeof win.CoachToolsData.removeDataset === 'function') return win.CoachToolsData;
      } catch (_) { return null; }
      await new Promise(resolve => root.setTimeout(resolve, 120));
    }
    return null;
  }

  async function injectManagerControls(frame, focusRecovery) {
    if (!frame || !frame.contentWindow) return false;
    let doc, win;
    try { doc = frame.contentDocument; win = frame.contentWindow; } catch (_) { return false; }
    if (!doc || doc.readyState === 'loading') return false;
    const api = await waitForManagerApi(frame);
    if (!api) return false;
    const app = doc.querySelector('.app');
    if (!app) return false;

    let card = doc.getElementById('coachtoolsIndexedDbControls');
    if (!card) {
      card = createElement(doc, 'section');
      card.id = 'coachtoolsIndexedDbControls';
      card.className = 'card';
      const statusCard = doc.querySelector('[data-coachtools-data-status]')?.closest('.card');
      if (statusCard) statusCard.after(card);
      else app.prepend(card);
    }

    async function render() {
      const statuses = typeof api.getStatus === 'function' ? await api.getStatus() : [];
      const byType = new Map((statuses || []).map(status => [status.id || status.datasetType, status]));
      const details = storageDetails(api);
      const recovery = readRecovery();
      card.replaceChildren();

      const heading = createElement(doc, 'div');
      heading.className = 'panelHead';
      const headingTitle = createElement(doc, 'b', 'IndexedDB data controls');
      const headingHint = createElement(doc, 'span', 'Delete one source or clear all current CoachTools source data without changing the existing upload workflow.');
      headingHint.className = 'hint';
      heading.append(headingTitle, headingHint);
      card.appendChild(heading);

      const body = createElement(doc, 'div');
      body.className = 'panelBody';
      const storageLine = createElement(doc, 'div', `Connected IndexedDB: ${details.database} · Dataset stores: ${details.stores.join(', ')}`);
      storageLine.className = 'hint';
      Object.assign(storageLine.style, { marginBottom: '12px' });
      body.appendChild(storageLine);

      if (recovery && recovery.issues.length) {
        const issue = recovery.issues[0];
        const recoveryBox = createElement(doc, 'div');
        Object.assign(recoveryBox.style, {
          border: '1px solid #f0c8c4', background: '#fff6f5', color: '#7f1d1d', borderRadius: '12px',
          padding: '11px 12px', marginBottom: '12px', display: 'grid', gap: '5px'
        });
        recoveryBox.append(
          createElement(doc, 'b', 'Upload error recovery suggested'),
          createElement(doc, 'div', `${issue.operation} reported an error for ${issue.datasetLabel}${issue.fileName ? ` (${issue.fileName})` : ''}. Recommended recovery: use Delete All Data below, confirm YES, then retry the upload.`),
          createElement(doc, 'small', `${issue.errorCode}: ${issue.message} · IndexedDB ${issue.database} · ${issue.stores.join(', ')}`)
        );
        body.appendChild(recoveryBox);
      }

      const list = createElement(doc, 'div');
      Object.assign(list.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '8px' });
      for (const type of api.DATASET_TYPES || Object.keys(FALLBACK_LABELS)) {
        const status = byType.get(type);
        const row = createElement(doc, 'div');
        Object.assign(row.style, {
          border: '1px solid var(--line)', borderRadius: '11px', padding: '9px 10px', background: '#fafafa',
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '8px', alignItems: 'center'
        });
        const copy = createElement(doc, 'div');
        const name = createElement(doc, 'b', datasetLabel(type, api));
        name.style.display = 'block';
        const meta = createElement(doc, 'small', status && status.ready
          ? `${status.fileName || 'Stored source'}${status.period ? ` · ${status.period}` : ''}`
          : 'No current data stored');
        meta.className = 'hint';
        copy.append(name, meta);
        const button = createElement(doc, 'button', 'Delete');
        button.type = 'button';
        button.className = 'btn small danger';
        button.disabled = !(status && status.ready);
        button.addEventListener('click', async () => {
          if (!win.confirm(`Delete all stored ${datasetLabel(type, api)} history and its current pointer from CoachTools IndexedDB?`)) return;
          button.disabled = true;
          button.textContent = 'Deleting…';
          clearCompatibilityDock(win, type);
          try {
            await api.removeDataset(type);
            removeRecoveryForDataset(type);
          } catch (error) {
            reportIssue(type, error, { operation: 'Data Manager delete' }, api);
          }
          await render();
        });
        row.append(copy, button);
        list.appendChild(row);
      }
      body.appendChild(list);

      const allActions = createElement(doc, 'div');
      Object.assign(allActions.style, { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line)', display: 'flex', gap: '9px', alignItems: 'center', flexWrap: 'wrap' });
      const deleteAll = createElement(doc, 'button', 'Delete All Data');
      deleteAll.type = 'button';
      deleteAll.className = 'btn danger';
      const allHint = createElement(doc, 'span', 'Deletes all 8 CoachTools source histories/current pointers. Identity corrections, teams, app settings, and All-Star stores are preserved.');
      allHint.className = 'hint';
      deleteAll.addEventListener('click', async () => {
        const answer = win.prompt('Type YES to delete ALL current and historical CoachTools source data from IndexedDB. Identity Manager data, teams, settings, and All-Star stores will be preserved.');
        if (display(answer).toUpperCase() !== 'YES') return;
        deleteAll.disabled = true;
        deleteAll.textContent = 'Deleting all data…';
        const failures = [];
        for (const type of api.DATASET_TYPES || Object.keys(FALLBACK_LABELS)) {
          clearCompatibilityDock(win, type);
          try { await api.removeDataset(type); }
          catch (error) { failures.push({ type, error }); }
        }
        if (!failures.length) clearRecovery();
        else for (const failure of failures) reportIssue(failure.type, failure.error, { operation: 'Delete All Data' }, api);
        await render();
      });
      allActions.append(deleteAll, allHint);
      body.appendChild(allActions);
      card.appendChild(body);

      if ((focusRecovery || openFromRecovery) && recovery && recovery.issues.length) {
        openFromRecovery = false;
        try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { card.scrollIntoView(); }
      }
    }

    card.__coachtoolsRecoveryRender = render;
    await render();
    return true;
  }

  function scanForDataManagerFrames() {
    const doc = root.document;
    if (!doc) return;
    const frames = Array.from(doc.querySelectorAll('iframe[data-app-id="weekly-data"]'));
    for (const frame of frames) {
      if (!frame.__coachtoolsRecoveryBound) {
        frame.__coachtoolsRecoveryBound = true;
        frame.addEventListener('load', () => injectManagerControls(frame, openFromRecovery));
      }
      injectManagerControls(frame, openFromRecovery);
    }
  }

  function refreshInjectedManagers() {
    const doc = root.document;
    if (!doc) return;
    for (const frame of doc.querySelectorAll('iframe[data-app-id="weekly-data"]')) {
      try {
        const card = frame.contentDocument && frame.contentDocument.getElementById('coachtoolsIndexedDbControls');
        if (card && typeof card.__coachtoolsRecoveryRender === 'function') card.__coachtoolsRecoveryRender();
        else injectManagerControls(frame, false);
      } catch (_) {}
    }
  }

  function bindUi() {
    const doc = root.document;
    if (!doc) return;
    doc.addEventListener('click', event => {
      const action = event.target && event.target.closest && event.target.closest('[data-action]')?.dataset.action;
      if (action === 'update-data') setOperation('Update Data');
      else if (action === 'quick-upload-data') setOperation('Clean Upload');
      else if (action === 'open-weekly-data') root.setTimeout(scanForDataManagerFrames, 80);
    }, true);
    doc.addEventListener('change', event => {
      if (event.target && event.target.id === 'quickDataInput') setOperation('Clean Upload');
    }, true);
    const observer = new MutationObserver(() => scanForDataManagerFrames());
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    renderMainRecoveryPrompt();
    scanForDataManagerFrames();
  }

  installApiHook('CoachToolsData', wrapDataApi, value => { dataApiBacking = value; });
  installApiHook('CoachToolsImport', wrapImportApi, value => { importApiBacking = value; });

  root.CoachToolsDataRecovery = Object.freeze({
    VERSION,
    RECOVERY_KEY,
    DATASET_STORES,
    getState: readRecovery,
    reportIssue,
    clearRecovery,
    removeRecoveryForDataset,
    renderMainRecoveryPrompt,
    scanForDataManagerFrames
  });

  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', bindUi, { once: true });
    else bindUi();
  }
})(window);
