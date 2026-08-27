(function attachCoachToolsDataManagerControls(root) {
  'use strict';

  const RECOVERY_KEY = 'coachtools.data.recovery.v1';
  const DATASET_STORES = Object.freeze(['coachtoolsDatasets', 'coachtoolsDatasetChunks', 'coachtoolsCurrent', 'coachtoolsImports']);
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

  let renderControls = null;
  let unsubscribe = null;

  function display(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function element(tag, text) {
    const node = root.document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  }

  function getRecoveryState() {
    try {
      if (root.parent && root.parent !== root && root.parent.CoachToolsDataRecovery && typeof root.parent.CoachToolsDataRecovery.getState === 'function') {
        const parentState = root.parent.CoachToolsDataRecovery.getState();
        if (parentState) return parentState;
      }
    } catch (_) {}
    try {
      const raw = root.localStorage && root.localStorage.getItem(RECOVERY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.active && Array.isArray(parsed.issues) && parsed.issues.length ? parsed : null;
    } catch (_) { return null; }
  }

  function writeRecovery(state) {
    try {
      if (!state || !state.active || !Array.isArray(state.issues) || !state.issues.length) root.localStorage.removeItem(RECOVERY_KEY);
      else root.localStorage.setItem(RECOVERY_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function clearRecovery() {
    try {
      if (root.parent && root.parent !== root && root.parent.CoachToolsDataRecovery && typeof root.parent.CoachToolsDataRecovery.clearRecovery === 'function') {
        root.parent.CoachToolsDataRecovery.clearRecovery();
      }
    } catch (_) {}
    writeRecovery(null);
  }

  function clearRecoveryForType(type) {
    try {
      if (root.parent && root.parent !== root && root.parent.CoachToolsDataRecovery && typeof root.parent.CoachToolsDataRecovery.removeRecoveryForDataset === 'function') {
        root.parent.CoachToolsDataRecovery.removeRecoveryForDataset(type);
      }
    } catch (_) {}
    const state = getRecoveryState();
    if (!state) return;
    const issues = state.issues.filter(issue => issue.datasetType !== type);
    writeRecovery(issues.length ? { ...state, issues, updatedAt: new Date().toISOString() } : null);
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

  function datasetLabel(type, api) {
    return display(api && api.LABELS && api.LABELS[type]) || FALLBACK_LABELS[type] || type;
  }

  function clearCompatibilityDock(type) {
    const legacy = TYPE_TO_LEGACY[type];
    const storage = root.CoachToolsStorage;
    const key = legacy && storage && storage.DOCK_KEYS && storage.DOCK_KEYS[legacy];
    if (!key) return;
    try { root.localStorage.removeItem(key); } catch (_) {}
  }

  function setMessage(card, text, bad) {
    let message = card.querySelector('[data-data-manager-delete-message]');
    if (!message) {
      message = element('div');
      message.dataset.dataManagerDeleteMessage = 'true';
      Object.assign(message.style, { marginTop: '10px', fontSize: '12px', fontWeight: '700' });
      card.querySelector('.panelBody')?.appendChild(message);
    }
    message.textContent = text || '';
    message.style.color = bad ? 'var(--bad)' : 'var(--ok)';
  }

  async function waitForApi() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const api = root.CoachToolsData;
      if (api && typeof api.removeDataset === 'function' && typeof api.getStatus === 'function') return api;
      await new Promise(resolve => root.setTimeout(resolve, 100));
    }
    return null;
  }

  async function mount() {
    if (!root.document || root.document.querySelector('meta[name="coachtools-id"]')?.content !== 'weekly-data') return;
    const api = await waitForApi();
    if (!api) return;
    const app = root.document.querySelector('.app');
    if (!app) return;

    let card = root.document.getElementById('coachtoolsIndexedDbControls');
    if (!card) {
      card = element('section');
      card.id = 'coachtoolsIndexedDbControls';
      card.className = 'card';
      const statusCard = root.document.querySelector('[data-coachtools-data-status]')?.closest('.card');
      if (statusCard) statusCard.after(card);
      else app.prepend(card);
    }

    renderControls = async function render() {
      const statuses = await api.getStatus();
      const byType = new Map((statuses || []).map(status => [status.id || status.datasetType, status]));
      const recovery = getRecoveryState();
      const details = storageDetails(api);
      card.replaceChildren();

      const head = element('div');
      head.className = 'panelHead';
      const headTitle = element('b', 'IndexedDB data controls');
      const headHint = element('span', 'Delete stored data by source, or clear all CoachTools source data before a clean retry.');
      headHint.className = 'hint';
      head.append(headTitle, headHint);
      card.appendChild(head);

      const body = element('div');
      body.className = 'panelBody';
      const dbInfo = element('div', `Connected IndexedDB: ${details.database} · Dataset stores: ${details.stores.join(', ')}`);
      dbInfo.className = 'hint';
      Object.assign(dbInfo.style, { marginBottom: '12px' });
      body.appendChild(dbInfo);

      if (recovery && recovery.issues.length) {
        const issue = recovery.issues[0];
        const recoveryBox = element('div');
        Object.assign(recoveryBox.style, {
          border: '1px solid #f0c8c4', background: '#fff6f5', color: '#7f1d1d', borderRadius: '12px',
          padding: '11px 12px', marginBottom: '12px', display: 'grid', gap: '5px'
        });
        recoveryBox.append(
          element('b', 'Upload error recovery suggested'),
          element('div', `${issue.operation || 'Data upload'} reported an error for ${issue.datasetLabel || 'an unidentified source'}${issue.fileName ? ` (${issue.fileName})` : ''}. Recommended recovery: use Delete All Data below, confirm YES, then retry the upload.`),
          element('small', `${issue.errorCode || 'UploadError'}: ${issue.message || 'The upload failed.'} · IndexedDB ${issue.database || details.database} · ${(issue.stores || details.stores).join(', ')}`)
        );
        body.appendChild(recoveryBox);
      }

      const grid = element('div');
      Object.assign(grid.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '8px' });
      for (const type of api.DATASET_TYPES || Object.keys(FALLBACK_LABELS)) {
        const status = byType.get(type);
        const row = element('div');
        Object.assign(row.style, {
          border: '1px solid var(--line)', borderRadius: '11px', padding: '9px 10px', background: '#fafafa',
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '8px', alignItems: 'center'
        });
        const copy = element('div');
        const name = element('b', datasetLabel(type, api));
        name.style.display = 'block';
        const meta = element('small', status && status.ready
          ? `${status.fileName || 'Stored source'}${status.period ? ` · ${status.period}` : ''}${status.rowCount ? ` · ${Number(status.rowCount).toLocaleString()} rows` : ''}`
          : 'No current data stored');
        meta.className = 'hint';
        copy.append(name, meta);
        const button = element('button', 'Delete');
        button.type = 'button';
        button.className = 'btn small danger';
        button.disabled = !(status && status.ready);
        button.addEventListener('click', async () => {
          if (!root.confirm(`Delete all stored ${datasetLabel(type, api)} history and its current pointer from CoachTools IndexedDB?`)) return;
          button.disabled = true;
          button.textContent = 'Deleting…';
          clearCompatibilityDock(type);
          try {
            await api.removeDataset(type);
            clearRecoveryForType(type);
            await renderControls();
            setMessage(card, `${datasetLabel(type, api)} data deleted.`, false);
          } catch (error) {
            await renderControls();
            setMessage(card, `Could not delete ${datasetLabel(type, api)}: ${error && error.message || error}`, true);
          }
        });
        row.append(copy, button);
        grid.appendChild(row);
      }
      body.appendChild(grid);

      const danger = element('div');
      Object.assign(danger.style, { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line)', display: 'flex', gap: '9px', alignItems: 'center', flexWrap: 'wrap' });
      const deleteAll = element('button', 'Delete All Data');
      deleteAll.type = 'button';
      deleteAll.className = 'btn danger';
      const hint = element('span', 'Deletes all 8 CoachTools source histories/current pointers. Identity corrections, teams, app settings, and All-Star stores are preserved.');
      hint.className = 'hint';
      deleteAll.addEventListener('click', async () => {
        const answer = root.prompt('Type YES to delete ALL current and historical CoachTools source data from IndexedDB. Identity Manager data, teams, settings, and All-Star stores will be preserved.');
        if (display(answer).toUpperCase() !== 'YES') return;
        deleteAll.disabled = true;
        deleteAll.textContent = 'Deleting all data…';
        const failures = [];
        for (const type of api.DATASET_TYPES || Object.keys(FALLBACK_LABELS)) {
          clearCompatibilityDock(type);
          try { await api.removeDataset(type); }
          catch (error) { failures.push({ type, error }); }
        }
        if (!failures.length) clearRecovery();
        await renderControls();
        if (!failures.length) setMessage(card, 'All CoachTools source data was deleted. You can now retry Clean Upload.', false);
        else setMessage(card, `Delete All Data finished with ${failures.length} error${failures.length === 1 ? '' : 's'}.`, true);
      });
      danger.append(deleteAll, hint);
      body.appendChild(danger);
      card.appendChild(body);

      if (recovery && recovery.issues.length) {
        root.setTimeout(() => {
          try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
        }, 60);
      }
    };

    await renderControls();
    if (typeof api.subscribe === 'function') {
      if (unsubscribe) try { unsubscribe(); } catch (_) {}
      unsubscribe = api.subscribe(() => renderControls && renderControls());
    }
  }

  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }
})(window);
