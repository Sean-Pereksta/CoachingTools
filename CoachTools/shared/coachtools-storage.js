(function attachCoachToolsStorage(root) {
  'use strict';

  const VERSION = '1.0.0';
  const EVENT_NAME = 'coachtools:data-updated';
  const SCOPE_EVENT_NAME = 'coachtools:scope-updated';
  const CHANNEL_NAME = 'coachtools-data-v1';
  const SCOPE_KEY = 'coachtools.scope.v1';
  const DATA_META_KEY = 'coachtools.data.meta.v1';
  const DOCK_KEYS = Object.freeze({
    retail: 'myone2.dock.retail',
    referral: 'myone2.dock.referral',
    qa: 'myone2.dock.qa',
    coaching: 'myone2.dock.coaching',
    checklist: 'myone2.dock.checklist'
  });
  const LABELS = Object.freeze({
    retail: 'Retail',
    referral: 'Referral',
    qa: 'QA',
    coaching: 'Coaching',
    checklist: 'Checklist'
  });
  const LIGHTWEIGHT_KEYS = Object.freeze([
    'coachtools.desktop.favorites.v1',
    'coachtools.desktop.recent.v1',
    'coachtools.desktop.openApps.v1',
    'coachtools.desktop.storageScan.v1',
    'coachtools.desktop.preferences.v1',
    'myone2.gaps.prefs',
    'myone2.gaps.panelCollapsed',
    'myone2.coachSpeed.columnMap',
    'myone2.coachSpeed.sidebarCollapsed',
    'qaOnlyDash.settings.v6',
    'impactTool.activeTab',
    'myone.master.v2.setup',
    'allStarStandaloneModels.v1',
    'allStarResearchItems.v1',
    'allStarResearchMetrics.v1',
    'allStarOrgBuilder.v1',
    'allStarRepAliases.v1',
    'allStarRunSettings.v2',
    'allStarPdfOptions.v1',
    'allStarRunPresets.v1',
    'coachingEmailGeneratorHireDateSettings.v1',
    'coachingEmailGeneratorCoachAliasOverrides',
    'coachingEmailGeneratorReportAudience.v1',
    'coachingEmailGeneratorReportWeightOrder',
    'coachingEmailGeneratorOtherRuleIds',
    'coachingEmailGeneratorUrgencyCoverage.v1',
    'coachingEmailGeneratorOrganizationSummary.v1',
    'coachingImpactWorkspaceSettings.v1'
  ]);

  let channel = null;
  try {
    if ('BroadcastChannel' in root) channel = new BroadcastChannel(CHANNEL_NAME);
  } catch (_) {
    channel = null;
  }

  function storageAvailable() {
    try {
      const probe = '__coachtools_storage_probe__';
      root.localStorage.setItem(probe, '1');
      root.localStorage.removeItem(probe);
      return true;
    } catch (_) {
      return false;
    }
  }

  function safeGet(key) {
    try { return root.localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeJson(raw, fallback) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function sourceForKey(key) {
    return Object.keys(DOCK_KEYS).find(source => DOCK_KEYS[source] === key) || null;
  }

  function normalizedSource(source) {
    const value = String(source || '').toLowerCase();
    if (value === 'all') return 'all';
    return Object.prototype.hasOwnProperty.call(DOCK_KEYS, value) ? value : null;
  }

  function decodeDockValue(raw) {
    if (raw == null || raw === '') return null;
    const direct = safeJson(raw, undefined);
    if (direct !== undefined) return direct;
    const lz = root.LZString;
    if (!lz) return raw;
    const decoders = ['decompressFromUTF16', 'decompressFromBase64', 'decompress'];
    for (const name of decoders) {
      try {
        const decoded = typeof lz[name] === 'function' ? lz[name](raw) : null;
        if (!decoded) continue;
        const parsed = safeJson(decoded, undefined);
        if (parsed !== undefined) return parsed;
      } catch (_) {}
    }
    return raw;
  }

  function get(source, options) {
    const id = normalizedSource(source);
    if (!id || id === 'all') return null;
    const raw = safeGet(DOCK_KEYS[id]);
    return options && options.raw ? raw : decodeDockValue(raw);
  }

  function has(source) {
    const id = normalizedSource(source);
    return Boolean(id && id !== 'all' && safeGet(DOCK_KEYS[id]));
  }

  function getDataMetadata() {
    return safeJson(safeGet(DATA_META_KEY), {}) || {};
  }

  function markUpdated(source, details) {
    const id = normalizedSource(source);
    const existing = getDataMetadata();
    const now = new Date().toISOString();
    if (id === 'all') {
      for (const sourceId of Object.keys(DOCK_KEYS)) {
        if (has(sourceId)) existing[sourceId] = { ...(existing[sourceId] || {}), ...(details || {}), updatedAt: now };
      }
    } else if (id) {
      existing[id] = { ...(existing[id] || {}), ...(details || {}), updatedAt: now };
    }
    try { root.localStorage.setItem(DATA_META_KEY, JSON.stringify(existing)); } catch (_) {}
    return existing;
  }

  function emitLocal(name, detail) {
    try { root.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {}
  }

  function sendToParent(message) {
    try {
      if (root.parent && root.parent !== root) root.parent.postMessage(message, '*');
    } catch (_) {}
  }

  function notifyDataUpdated(source, details) {
    const id = normalizedSource(source) || 'all';
    const detail = { source: id, updatedAt: new Date().toISOString(), ...(details || {}) };
    emitLocal(EVENT_NAME, detail);
    sendToParent({ type: EVENT_NAME, detail });
    try { if (channel) channel.postMessage({ type: EVENT_NAME, detail }); } catch (_) {}
    return detail;
  }

  function set(source, value, options) {
    const id = normalizedSource(source);
    if (!id || id === 'all') throw new Error('Unknown CoachTools dataset: ' + source);
    const raw = options && options.raw ? String(value) : JSON.stringify(value);
    root.localStorage.setItem(DOCK_KEYS[id], raw);
    markUpdated(id, options && options.metadata);
    notifyDataUpdated(id, { reason: 'set' });
    return value;
  }

  function remove(source) {
    const id = normalizedSource(source);
    if (!id || id === 'all') return false;
    root.localStorage.removeItem(DOCK_KEYS[id]);
    const metadata = getDataMetadata();
    delete metadata[id];
    try { root.localStorage.setItem(DATA_META_KEY, JSON.stringify(metadata)); } catch (_) {}
    notifyDataUpdated(id, { reason: 'removed' });
    return true;
  }

  function getScope() {
    return safeJson(safeGet(SCOPE_KEY), null);
  }

  function setScope(scope) {
    const next = {
      mode: 'all',
      label: 'All available coaches',
      team: '',
      coordinator: '',
      coaches: [],
      ...(scope || {}),
      updatedAt: new Date().toISOString()
    };
    try { root.localStorage.setItem(SCOPE_KEY, JSON.stringify(next)); } catch (_) {}
    emitLocal(SCOPE_EVENT_NAME, next);
    sendToParent({ type: SCOPE_EVENT_NAME, detail: next });
    try { if (channel) channel.postMessage({ type: SCOPE_EVENT_NAME, detail: next }); } catch (_) {}
    return next;
  }

  function getDatasetStatus() {
    const metadata = getDataMetadata();
    return Object.keys(DOCK_KEYS).map(id => {
      const raw = safeGet(DOCK_KEYS[id]);
      return {
        id,
        label: LABELS[id],
        key: DOCK_KEYS[id],
        ready: Boolean(raw),
        bytes: raw ? raw.length * 2 : 0,
        updatedAt: metadata[id] && metadata[id].updatedAt || null,
        fileName: metadata[id] && metadata[id].fileName || ''
      };
    });
  }

  function getApproximateStorageSize() {
    let bytes = 0;
    let entries = 0;
    try {
      for (let index = 0; index < root.localStorage.length; index += 1) {
        const key = root.localStorage.key(index);
        const value = root.localStorage.getItem(key) || '';
        bytes += (String(key).length + value.length) * 2;
        entries += 1;
      }
    } catch (_) {}
    return { bytes, entries };
  }

  function createBackup(options) {
    const maxBytes = Number(options && options.maxBytes) || 60 * 1024 * 1024;
    const backup = {
      packageType: 'coachtools-backup',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sharedDocks: {},
      scope: getScope(),
      preferences: {},
      skipped: [],
      notes: ['IndexedDB caches and saved All-Star report snapshots are intentionally excluded.']
    };
    let includedBytes = 0;
    for (const [source, key] of Object.entries(DOCK_KEYS)) {
      const value = safeGet(key);
      if (value == null) continue;
      const bytes = value.length * 2;
      if (includedBytes + bytes > maxBytes) {
        backup.skipped.push({ key, reason: 'backup size limit', bytes });
        continue;
      }
      backup.sharedDocks[source] = value;
      includedBytes += bytes;
    }
    for (const key of LIGHTWEIGHT_KEYS) {
      const value = safeGet(key);
      if (value == null) continue;
      const bytes = value.length * 2;
      if (bytes > 2 * 1024 * 1024 || includedBytes + bytes > maxBytes) {
        backup.skipped.push({ key, reason: 'preference too large', bytes });
        continue;
      }
      backup.preferences[key] = value;
      includedBytes += bytes;
    }
    backup.approximateBytes = includedBytes;
    return backup;
  }

  function restoreBackup(backup) {
    if (!backup || backup.packageType !== 'coachtools-backup' || Number(backup.schemaVersion) !== 1) {
      throw new Error('This is not a supported CoachTools backup.');
    }
    const writes = [];
    for (const [source, value] of Object.entries(backup.sharedDocks || {})) {
      const id = normalizedSource(source);
      if (id && id !== 'all' && typeof value === 'string') writes.push([DOCK_KEYS[id], value]);
    }
    for (const [key, value] of Object.entries(backup.preferences || {})) {
      if (LIGHTWEIGHT_KEYS.includes(key) && typeof value === 'string') writes.push([key, value]);
    }
    if (backup.scope) writes.push([SCOPE_KEY, JSON.stringify(backup.scope)]);
    const previous = new Map(writes.map(([key]) => [key, safeGet(key)]));
    const completed = [];
    try {
      for (const [key, value] of writes) {
        root.localStorage.setItem(key, value);
        completed.push(key);
      }
    } catch (error) {
      for (const key of completed) {
        const value = previous.get(key);
        if (value == null) root.localStorage.removeItem(key);
        else root.localStorage.setItem(key, value);
      }
      throw new Error('The backup could not fit in browser storage. Existing data was restored. ' + (error && error.message || error));
    }
    markUpdated('all', { restoredAt: new Date().toISOString() });
    notifyDataUpdated('all', { reason: 'backup-restored' });
    if (backup.scope) setScope(backup.scope);
    return { restoredKeys: writes.map(([key]) => key) };
  }

  function relayExternalMessage(message) {
    if (!message || !message.type || !message.detail) return;
    if (message.type === EVENT_NAME) emitLocal(EVENT_NAME, { ...message.detail, relayed: true });
    if (message.type === SCOPE_EVENT_NAME) emitLocal(SCOPE_EVENT_NAME, { ...message.detail, relayed: true });
  }

  root.addEventListener('storage', event => {
    const source = sourceForKey(event.key);
    if (source) emitLocal(EVENT_NAME, { source, updatedAt: new Date().toISOString(), nativeStorageEvent: true });
    if (event.key === SCOPE_KEY) emitLocal(SCOPE_EVENT_NAME, safeJson(event.newValue, {}));
  });
  root.addEventListener('message', event => relayExternalMessage(event.data));
  if (channel) channel.onmessage = event => relayExternalMessage(event.data);

  root.CoachToolsStorage = Object.freeze({
    VERSION,
    EVENT_NAME,
    SCOPE_EVENT_NAME,
    SCOPE_KEY,
    DATA_META_KEY,
    DOCK_KEYS,
    LABELS,
    storageAvailable,
    decodeDockValue,
    get,
    getRaw: source => get(source, { raw: true }),
    getRetail: () => get('retail'),
    getReferral: () => get('referral'),
    getQA: () => get('qa'),
    getCoaching: () => get('coaching'),
    getChecklist: () => get('checklist'),
    has,
    hasRetail: () => has('retail'),
    hasReferral: () => has('referral'),
    hasQA: () => has('qa'),
    hasCoaching: () => has('coaching'),
    hasChecklist: () => has('checklist'),
    set,
    remove,
    markUpdated,
    notifyDataUpdated,
    getDataMetadata,
    getDatasetStatus,
    getApproximateStorageSize,
    getScope,
    setScope,
    createBackup,
    restoreBackup
  });
})(window);
