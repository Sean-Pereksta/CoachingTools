(function attachCoachToolsData(root) {
  'use strict';

  const VERSION = '2.0.0';
  const EVENT_NAME = 'coachtools:data-updated';
  const SCOPE_EVENT_NAME = 'coachtools:scope-updated';
  const CHANNEL_NAME = 'coachtools-data-v2';
  const LEGACY_CHANNEL_NAME = 'coachtools-data-v1';
  const SCOPE_KEY = 'coachtools.scope.v1';
  const DATA_META_KEY = 'coachtools.data.meta.v2';
  const LEGACY_DATA_META_KEY = 'coachtools.data.meta.v1';
  const MIGRATION_KEY = 'coachtools.indexeddb.migration.v1';

  // CoachTools now extends All-Star's existing import database instead of creating
  // a second large-data database beside it. All-Star uses the first four stores;
  // the shared API owns the CoachTools data and identity stores added through schema version 6.
  const DB_NAME = 'allStarImportedDataCache.v1';
  const DB_VERSION = 6;
  const DATASET_STORE = 'coachtoolsDatasets';
  const CURRENT_STORE = 'coachtoolsCurrent';
  const IMPORT_STORE = 'coachtoolsImports';
  const PEOPLE_STORE = 'coachtoolsPeople';
  const IDENTITY_REVIEW_STORE = 'coachtoolsIdentityReviews';
  const ALLSTAR_STORES = Object.freeze(['meta', 'sourceData', 'books', 'misc']);

  const DATASET_TYPES = Object.freeze([
    'weeklyRetail',
    'weeklyReferral',
    'monthlyRetail',
    'monthlyReferral',
    'qa',
    'documentedCoaching',
    'checklist',
    'compCoaching'
  ]);
  const LABELS = Object.freeze({
    weeklyRetail: 'Retail Weekly',
    weeklyReferral: 'Referral Weekly',
    monthlyRetail: 'Retail Monthly',
    monthlyReferral: 'Referral Monthly',
    qa: 'QA / 90-Day Evaluations',
    documentedCoaching: 'Documented Coaching',
    checklist: 'Checklist / All Items',
    compCoaching: 'Comp Coaching',
    retail: 'Retail Weekly',
    referral: 'Referral Weekly',
    coaching: 'Documented Coaching'
  });
  const LEGACY_TO_DATASET = Object.freeze({
    retail: 'weeklyRetail',
    referral: 'weeklyReferral',
    qa: 'qa',
    coaching: 'documentedCoaching',
    checklist: 'checklist'
  });
  const DATASET_TO_LEGACY = Object.freeze({
    weeklyRetail: 'retail',
    weeklyReferral: 'referral',
    qa: 'qa',
    documentedCoaching: 'coaching',
    checklist: 'checklist'
  });
  const DOCK_KEYS = Object.freeze({
    retail: 'myone2.dock.retail',
    referral: 'myone2.dock.referral',
    qa: 'myone2.dock.qa',
    coaching: 'myone2.dock.coaching',
    checklist: 'myone2.dock.checklist'
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
    'allStarCoachToolsSync.v1',
    'coachingEmailGeneratorHireDateSettings.v1',
    'coachingEmailGeneratorCoachAliasOverrides',
    'coachingEmailGeneratorReportAudience.v1',
    'coachingEmailGeneratorReportWeightOrder',
    'coachingEmailGeneratorOtherRuleIds',
    'coachingEmailGeneratorUrgencyCoverage.v1',
    'coachingEmailGeneratorOrganizationSummary.v1',
    'coachingImpactWorkspaceSettings.v1'
  ]);

  const currentPointers = new Map();
  const currentData = new Map();
  const channels = [];
  let databaseUnavailable = false;
  try {
    if ('BroadcastChannel' in root) {
      channels.push(new BroadcastChannel(CHANNEL_NAME));
      channels.push(new BroadcastChannel(LEGACY_CHANNEL_NAME));
    }
  } catch (_) {}

  function storageAvailable() {
    try {
      const probe = '__coachtools_storage_probe__';
      root.localStorage.setItem(probe, '1');
      root.localStorage.removeItem(probe);
      return true;
    } catch (_) { return false; }
  }
  function safeGet(key) { try { return root.localStorage.getItem(key); } catch (_) { return null; } }
  function safeSet(key, value) { try { root.localStorage.setItem(key, value); return true; } catch (_) { return false; } }
  function safeRemove(key) { try { root.localStorage.removeItem(key); } catch (_) {} }
  function safeJson(raw, fallback) { if (!raw) return fallback; try { return JSON.parse(raw); } catch (_) { return fallback; } }
  function clone(value) {
    try { if (typeof structuredClone === 'function') return structuredClone(value); } catch (_) {}
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  function canonicalType(type) {
    const raw = String(type || '').trim();
    if (DATASET_TYPES.includes(raw)) return raw;
    const lower = raw.toLowerCase();
    const direct = DATASET_TYPES.find(id => id.toLowerCase() === lower);
    return direct || LEGACY_TO_DATASET[lower] || null;
  }
  function legacySource(source) {
    const lower = String(source || '').toLowerCase();
    if (lower === 'all') return 'all';
    if (Object.prototype.hasOwnProperty.call(DOCK_KEYS, lower)) return lower;
    const type = canonicalType(source);
    return type ? DATASET_TO_LEGACY[type] || null : null;
  }
  function decodeDockValue(raw) {
    if (raw == null || raw === '') return null;
    const direct = safeJson(raw, undefined);
    if (direct !== undefined) return direct;
    const lz = root.LZString;
    if (!lz) return raw;
    for (const name of ['decompressFromUTF16', 'decompressFromBase64', 'decompress']) {
      try {
        const decoded = typeof lz[name] === 'function' ? lz[name](raw) : null;
        if (!decoded) continue;
        const parsed = safeJson(decoded, undefined);
        if (parsed !== undefined) return parsed;
      } catch (_) {}
    }
    return raw;
  }
  function encodeDockValue(value) {
    const json = JSON.stringify(value);
    try {
      if (root.LZString && typeof root.LZString.compressToUTF16 === 'function') return root.LZString.compressToUTF16(json);
    } catch (_) {}
    return json;
  }
  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }
  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
    });
  }
  function openDatabase() {
    if (!('indexedDB' in root)) return Promise.reject(new Error('IndexedDB is unavailable.'));
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ALLSTAR_STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(DATASET_STORE)) {
          const store = db.createObjectStore(DATASET_STORE, { keyPath: 'id' });
          store.createIndex('datasetType', 'datasetType', { unique: false });
          store.createIndex('periodKey', ['datasetType', 'periodKey'], { unique: false });
          store.createIndex('fingerprint', ['datasetType', 'fingerprint'], { unique: false });
        }
        if (!db.objectStoreNames.contains(CURRENT_STORE)) db.createObjectStore(CURRENT_STORE, { keyPath: 'datasetType' });
        if (!db.objectStoreNames.contains(IMPORT_STORE)) {
          const store = db.createObjectStore(IMPORT_STORE, { keyPath: 'id' });
          store.createIndex('datasetType', 'datasetType', { unique: false });
          store.createIndex('importedAt', 'importedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(PEOPLE_STORE)) {
          const store = db.createObjectStore(PEOPLE_STORE, { keyPath: 'personId' });
          store.createIndex('normalizedName', 'normalizedName', { unique: false });
          store.createIndex('role', 'role', { unique: false });
          store.createIndex('department', 'department', { unique: false });
          store.createIndex('currentCoachId', 'currentCoachId', { unique: false });
        }
        if (!db.objectStoreNames.contains(IDENTITY_REVIEW_STORE)) {
          const store = db.createObjectStore(IDENTITY_REVIEW_STORE, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open CoachTools IndexedDB.'));
      request.onblocked = () => reject(new Error('CoachTools data upgrade is blocked by another open tab. Close other CoachTools tabs and retry.'));
    });
  }
  function emitLocal(name, detail) { try { root.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {} }
  function sendToParent(message) { try { if (root.parent && root.parent !== root) root.parent.postMessage(message, '*'); } catch (_) {} }
  function notifyDataUpdated(source, details) {
    const type = source === 'all' ? 'all' : canonicalType(source) || source || 'all';
    const detail = { source: type, updatedAt: new Date().toISOString(), ...(details || {}) };
    emitLocal(EVENT_NAME, detail);
    sendToParent({ type: EVENT_NAME, detail });
    for (const channel of channels) try { channel.postMessage({ type: EVENT_NAME, detail }); } catch (_) {}
    return detail;
  }
  function normalizedPeriod(period, metadata) {
    const value = period && typeof period === 'object' ? period : {};
    const importedAt = metadata && metadata.importedAt || new Date().toISOString();
    const fileModified = metadata && (metadata.fileModifiedDate || metadata.modifiedTime);
    const sortKey = value.sortKey || value.startDate || value.month || fileModified || importedAt;
    return {
      startDate: value.startDate || '',
      endDate: value.endDate || '',
      month: value.month || '',
      label: value.label || (value.startDate && value.endDate ? `${value.startDate} – ${value.endDate}` : value.startDate || value.month || 'Current'),
      periodKey: value.periodKey || value.startDate || value.month || 'current',
      sortKey: String(sortKey || importedAt)
    };
  }
  function fingerprintValue(data, metadata) {
    if (metadata && metadata.fingerprint) return String(metadata.fingerprint);
    let sample = '';
    try {
      const sheets = data && data.workbook && data.workbook.sheets || [];
      sample += `${metadata && metadata.fileSize || 0}|${sheets.join('|')}|`;
      for (const name of sheets) {
        const rows = data.workbook.data && data.workbook.data[name] && data.workbook.data[name].aoa || [];
        sample += `${name}:${rows.length}:`;
        for (const row of rows.slice(0, 4).concat(rows.slice(-3))) sample += JSON.stringify(row) + '|';
      }
      if (!sheets.length) sample += JSON.stringify(data).slice(0, 50000);
    } catch (_) { sample = String(metadata && metadata.originalFileName || '') + Date.now(); }
    let hash = 2166136261;
    for (let index = 0; index < sample.length; index += 1) {
      hash ^= sample.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
  function compactMetadata(record) {
    if (!record) return null;
    return {
      id: record.id,
      datasetType: record.datasetType,
      datasetId: record.datasetId || record.id,
      version: Number(record.version) || 1,
      originalFileName: record.originalFileName || '',
      detectedPeriod: record.detectedPeriod || null,
      periodKey: record.periodKey || '',
      periodSort: record.periodSort || '',
      fileSize: Number(record.fileSize) || 0,
      fileModifiedDate: record.fileModifiedDate || '',
      importedAt: record.importedAt || record.updatedAt || '',
      rowCount: Number(record.rowCount) || 0,
      fingerprint: record.fingerprint || '',
      schemaVersion: Number(record.schemaVersion) || 1,
      classificationMethod: record.classificationMethod || '',
      validationStatus: record.validationStatus || 'ready',
      replacedDatasetId: record.replacedDatasetId || '',
      supersededBy: record.supersededBy || ''
    };
  }
  function compareCurrent(candidate, current) {
    if (!current) return true;
    if (candidate.periodKey && candidate.periodKey === current.periodKey) return candidate.importedAt >= current.importedAt;
    if (candidate.periodSort !== current.periodSort) return candidate.periodSort > current.periodSort;
    return candidate.importedAt >= current.importedAt;
  }
  function hydrateCompatibility(type, data) {
    currentData.set(type, data);
    const legacy = DATASET_TO_LEGACY[type];
    if (!legacy || !DOCK_KEYS[legacy] || data == null) return;
    // Transitional adapter only: IndexedDB is authoritative; legacy apps receive
    // one current compressed view until their internal dock readers are retired.
    safeSet(DOCK_KEYS[legacy], encodeDockValue(data));
  }
  async function refreshPointers() {
    if (databaseUnavailable) return [];
    const db = await openDatabase();
    try {
      const pointers = await idbRequest(db.transaction(CURRENT_STORE, 'readonly').objectStore(CURRENT_STORE).getAll());
      currentPointers.clear();
      for (const pointer of pointers || []) currentPointers.set(pointer.datasetType, pointer);
      return pointers || [];
    } finally { db.close(); }
  }
  async function loadCurrentData() {
    if (databaseUnavailable) return;
    const db = await openDatabase();
    try {
      const transaction = db.transaction([CURRENT_STORE, DATASET_STORE], 'readonly');
      const pointers = await idbRequest(transaction.objectStore(CURRENT_STORE).getAll());
      currentPointers.clear();
      currentData.clear();
      for (const pointer of pointers || []) {
        currentPointers.set(pointer.datasetType, pointer);
        const record = await idbRequest(transaction.objectStore(DATASET_STORE).get(pointer.datasetId));
        if (record) hydrateCompatibility(pointer.datasetType, record.data);
      }
    } finally { db.close(); }
  }
  async function putDataset(type, data, metadata) {
    const datasetType = canonicalType(type);
    if (!datasetType) throw new Error('Unknown CoachTools dataset: ' + type);
    const meta = { ...(metadata || {}) };
    const importedAt = meta.importedAt || new Date().toISOString();
    const sourcePeriod = meta.detectedPeriod || data && data.meta && data.meta.detectedPeriod;
    const detectedPeriod = normalizedPeriod(sourcePeriod, { ...meta, importedAt });
    const fingerprint = fingerprintValue(data, meta);
    const periodKey = detectedPeriod.periodKey;
    const db = await openDatabase();
    try {
      const readTx = db.transaction([DATASET_STORE, CURRENT_STORE], 'readonly');
      const records = await idbRequest(readTx.objectStore(DATASET_STORE).index('datasetType').getAll(datasetType));
      const current = await idbRequest(readTx.objectStore(CURRENT_STORE).get(datasetType));
      const duplicate = (records || []).find(record => record.fingerprint === fingerprint);
      if (duplicate) {
        const importRecord = {
          id: `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          datasetType,
          datasetId: duplicate.id,
          action: 'duplicate',
          originalFileName: meta.originalFileName || meta.fileName || duplicate.originalFileName || '',
          importedAt,
          fingerprint,
          classificationMethod: meta.classificationMethod || 'filename+headers'
        };
        const tx = db.transaction(IMPORT_STORE, 'readwrite');
        tx.objectStore(IMPORT_STORE).put(importRecord);
        await transactionDone(tx);
        return { status: 'duplicate', dataset: compactMetadata(duplicate), current: compactMetadata(current) };
      }
      const samePeriod = (records || []).filter(record => record.periodKey === periodKey && !record.supersededBy).sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)))[0];
      const version = (records || []).reduce((max, record) => Math.max(max, Number(record.version) || 0), 0) + 1;
      const id = `${datasetType}:${periodKey}:${fingerprint}:${Date.now().toString(36)}`;
      const record = {
        id,
        datasetType,
        version,
        originalFileName: meta.originalFileName || meta.fileName || data && data.meta && data.meta.fileName || '',
        detectedPeriod,
        periodKey,
        periodSort: detectedPeriod.sortKey,
        fileSize: Number(meta.fileSize || data && data.meta && data.meta.fileSize) || 0,
        fileModifiedDate: meta.fileModifiedDate || meta.modifiedTime || '',
        importedAt,
        rowCount: Number(meta.rowCount || data && data.meta && data.meta.totalRows) || 0,
        fingerprint,
        schemaVersion: Number(meta.schemaVersion) || 1,
        classificationMethod: meta.classificationMethod || 'filename+headers',
        validationStatus: meta.validationStatus || 'ready',
        replacedDatasetId: samePeriod && samePeriod.id || '',
        supersededBy: '',
        data: clone(data)
      };
      const pointerCandidate = { ...compactMetadata(record), datasetId: id, updatedAt: importedAt };
      const shouldBecomeCurrent = compareCurrent(pointerCandidate, current);
      const tx = db.transaction([DATASET_STORE, CURRENT_STORE, IMPORT_STORE], 'readwrite');
      const datasetStore = tx.objectStore(DATASET_STORE);
      if (samePeriod) datasetStore.put({ ...samePeriod, supersededBy: id });
      datasetStore.put(record);
      if (shouldBecomeCurrent) tx.objectStore(CURRENT_STORE).put(pointerCandidate);
      tx.objectStore(IMPORT_STORE).put({
        ...compactMetadata(record),
        id: `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        datasetId: id,
        action: samePeriod ? 'replacement' : 'imported'
      });
      await transactionDone(tx);
      if (shouldBecomeCurrent) {
        currentPointers.set(datasetType, pointerCandidate);
        hydrateCompatibility(datasetType, data);
      }
      persistMetadataSnapshot();
      notifyDataUpdated(datasetType, { reason: samePeriod ? 'replacement' : 'imported', datasetId: id, version });
      return { status: samePeriod ? 'replacement' : 'imported', dataset: compactMetadata(record), current: shouldBecomeCurrent ? compactMetadata(pointerCandidate) : compactMetadata(current) };
    } finally { db.close(); }
  }
  async function inspectDataset(type, data, metadata) {
    await readyPromise;
    const datasetType = canonicalType(type);
    if (!datasetType) return { status: 'needs-review', reason: 'Unknown CoachTools dataset.', becomesCurrent: false };
    const meta = { ...(metadata || {}) };
    const importedAt = meta.importedAt || new Date().toISOString();
    const sourcePeriod = meta.detectedPeriod || data && data.meta && data.meta.detectedPeriod;
    const detectedPeriod = normalizedPeriod(sourcePeriod, { ...meta, importedAt });
    const candidate = {
      datasetType,
      fingerprint: fingerprintValue(data, meta),
      periodKey: detectedPeriod.periodKey,
      periodSort: detectedPeriod.sortKey,
      importedAt
    };
    if (['weeklyRetail', 'weeklyReferral', 'monthlyRetail', 'monthlyReferral', 'compCoaching'].includes(datasetType) && (!sourcePeriod || !sourcePeriod.sortKey || sourcePeriod.periodKey === 'current')) {
      return { status: 'needs-review', reason: 'The reporting period could not be detected safely.', becomesCurrent: false, candidate };
    }
    if (databaseUnavailable) return { status: currentData.has(datasetType) ? 'needs-review' : 'new', reason: databaseUnavailable ? 'IndexedDB comparison history is unavailable.' : '', becomesCurrent: !currentData.has(datasetType), candidate };
    const db = await openDatabase();
    try {
      const tx = db.transaction([DATASET_STORE, CURRENT_STORE], 'readonly');
      const records = await idbRequest(tx.objectStore(DATASET_STORE).index('datasetType').getAll(datasetType));
      const current = await idbRequest(tx.objectStore(CURRENT_STORE).get(datasetType));
      const result = root.CoachToolsSync && root.CoachToolsSync.compareCandidate
        ? root.CoachToolsSync.compareCandidate(candidate, current, records)
        : (!current ? { status: 'new', reason: 'No current dataset exists.', becomesCurrent: true }
          : records.some(record => record.fingerprint === candidate.fingerprint) ? { status: 'current', reason: 'Identical fingerprint already imported.', becomesCurrent: false }
          : candidate.periodKey === current.periodKey ? { status: 'updated', reason: 'The reporting period matches but contents changed.', becomesCurrent: true }
          : candidate.periodSort > current.periodSort ? { status: 'new', reason: 'A newer period was detected.', becomesCurrent: true }
          : candidate.periodSort < current.periodSort ? { status: 'older', reason: 'An older period was detected.', becomesCurrent: false }
          : { status: 'needs-review', reason: 'The reporting period could not be compared safely.', becomesCurrent: false });
      return { ...result, candidate, current: compactMetadata(current) };
    } finally { db.close(); }
  }
  async function migrateLegacyDocks() {
    const migrated = safeJson(safeGet(MIGRATION_KEY), {}) || {};
    for (const [legacy, type] of Object.entries(LEGACY_TO_DATASET)) {
      if (currentPointers.has(type)) continue;
      const raw = safeGet(DOCK_KEYS[legacy]);
      if (!raw) continue;
      const data = decodeDockValue(raw);
      if (!data || typeof data !== 'object') continue;
      const fileName = data.meta && data.meta.fileName || `${LABELS[type]} legacy dock`;
      try {
        await putDataset(type, data, {
          originalFileName: fileName,
          fileSize: raw.length * 2,
          rowCount: data.meta && data.meta.totalRows || 0,
          importedAt: data.meta && (data.meta.loadedAt || data.meta.masterLoaderGeneratedAt) || new Date().toISOString(),
          classificationMethod: 'legacy-dock-migration',
          detectedPeriod: data.meta && data.meta.detectedPeriod,
          fingerprint: `legacy-${type}-${fingerprintValue(data, {})}`
        });
        migrated[type] = new Date().toISOString();
      } catch (error) { console.warn('[CoachToolsData] Legacy migration failed for ' + type, error); }
    }
    safeSet(MIGRATION_KEY, JSON.stringify(migrated));
  }
  async function initialize() {
    try {
      if (!safeGet(DATA_META_KEY) && safeGet(LEGACY_DATA_META_KEY)) safeSet(DATA_META_KEY, safeGet(LEGACY_DATA_META_KEY));
      await refreshPointers();
      await migrateLegacyDocks();
      await loadCurrentData();
      persistMetadataSnapshot();
      notifyDataUpdated('all', { reason: 'indexeddb-ready' });
      return true;
    } catch (error) {
      databaseUnavailable = true;
      console.warn('[CoachToolsData] IndexedDB unavailable; legacy compatibility is active.', error);
      return false;
    }
  }
  const readyPromise = initialize();

  async function getCurrent(type, options) {
    await readyPromise;
    const datasetType = canonicalType(type);
    if (!datasetType || databaseUnavailable) return currentData.get(datasetType) || null;
    const pointer = currentPointers.get(datasetType);
    if (!pointer) return null;
    const db = await openDatabase();
    try {
      const record = await idbRequest(db.transaction(DATASET_STORE, 'readonly').objectStore(DATASET_STORE).get(pointer.datasetId));
      return options && options.includeRecord ? record || null : record && record.data || null;
    } finally { db.close(); }
  }
  async function getHistory(type, options) {
    await readyPromise;
    const datasetType = canonicalType(type);
    if (!datasetType || databaseUnavailable) return [];
    const db = await openDatabase();
    try {
      let records = await idbRequest(db.transaction(DATASET_STORE, 'readonly').objectStore(DATASET_STORE).index('datasetType').getAll(datasetType));
      records = (records || []).sort((a, b) => String(b.periodSort || b.importedAt).localeCompare(String(a.periodSort || a.importedAt)) || String(b.importedAt).localeCompare(String(a.importedAt)));
      if (options && options.activeOnly) records = records.filter(record => !record.supersededBy);
      return options && options.metadataOnly ? records.map(compactMetadata) : records;
    } finally { db.close(); }
  }
  async function getImportHistory(options) {
    await readyPromise;
    if (databaseUnavailable) return [];
    const type = options && options.datasetType ? canonicalType(options.datasetType) : null;
    const limit = Math.max(1, Number(options && options.limit) || 100);
    const db = await openDatabase();
    try {
      let records = await idbRequest(db.transaction(IMPORT_STORE, 'readonly').objectStore(IMPORT_STORE).getAll());
      if (type) records = (records || []).filter(record => record.datasetType === type);
      return (records || []).sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt))).slice(0, limit);
    } finally { db.close(); }
  }
  function getDatasetVersion(type) {
    const pointer = currentPointers.get(canonicalType(type));
    return pointer ? { datasetId: pointer.datasetId, version: pointer.version, fingerprint: pointer.fingerprint, importedAt: pointer.importedAt } : null;
  }
  async function removeDataset(type, datasetId) {
    await readyPromise;
    const datasetType = canonicalType(type);
    if (!datasetType || databaseUnavailable) return false;
    const history = await getHistory(datasetType, { includeSuperseded: true });
    const targets = datasetId ? history.filter(record => record.id === datasetId) : history;
    if (!targets.length) return false;
    const targetIds = new Set(targets.map(target => target.id));
    const survivors = history.filter(record => !targetIds.has(record.id)).map(record => ({ ...record })), restored = [];
    for (const target of targets) {
      const predecessor = survivors.find(record => record.id === target.replacedDatasetId && record.supersededBy === target.id);
      if (predecessor) { predecessor.supersededBy = ''; restored.push(predecessor); }
    }
    const remaining = survivors.filter(record => !record.supersededBy).sort((a, b) => String(b.periodSort || b.importedAt).localeCompare(String(a.periodSort || a.importedAt)));
    const db = await openDatabase();
    try {
      const tx = db.transaction([DATASET_STORE, CURRENT_STORE, IMPORT_STORE], 'readwrite');
      for (const target of targets) tx.objectStore(DATASET_STORE).delete(target.id);
      for (const survivor of restored) tx.objectStore(DATASET_STORE).put(survivor);
      if (remaining[0]) tx.objectStore(CURRENT_STORE).put({ ...compactMetadata(remaining[0]), datasetId: remaining[0].id, updatedAt: new Date().toISOString() });
      else tx.objectStore(CURRENT_STORE).delete(datasetType);
      tx.objectStore(IMPORT_STORE).put({ id: `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, datasetType, datasetId: datasetId || '*', action: 'removed', importedAt: new Date().toISOString() });
      await transactionDone(tx);
      await loadCurrentData();
      if (!remaining[0]) {
        currentPointers.delete(datasetType);
        currentData.delete(datasetType);
        const legacy = DATASET_TO_LEGACY[datasetType];
        if (legacy) safeRemove(DOCK_KEYS[legacy]);
      }
      persistMetadataSnapshot();
      notifyDataUpdated(datasetType, { reason: 'removed' });
      return true;
    } finally { db.close(); }
  }
  function centralStatus() {
    return DATASET_TYPES.map(id => {
      const pointer = currentPointers.get(id);
      return {
        id,
        label: LABELS[id],
        ready: Boolean(pointer),
        bytes: pointer && pointer.fileSize || 0,
        updatedAt: pointer && pointer.importedAt || null,
        fileName: pointer && pointer.originalFileName || '',
        period: pointer && pointer.detectedPeriod && pointer.detectedPeriod.label || '',
        version: pointer && pointer.version || 0,
        rowCount: pointer && pointer.rowCount || 0,
        datasetId: pointer && pointer.datasetId || ''
      };
    });
  }
  function persistMetadataSnapshot() {
    const metadata = {};
    for (const status of centralStatus()) if (status.ready) metadata[status.id] = status;
    safeSet(DATA_META_KEY, JSON.stringify(metadata));
    // v2 is canonical; the v1 snapshot remains during migration so older tools
    // continue receiving readiness metadata while they move to subscriptions.
    safeSet(LEGACY_DATA_META_KEY, JSON.stringify(metadata));
    return metadata;
  }

  // Backward-compatible synchronous facade. Large records are written to the
  // central database asynchronously and the old key is only a current-data view.
  function get(source, options) {
    const legacy = legacySource(source);
    if (!legacy || legacy === 'all') return null;
    const type = LEGACY_TO_DATASET[legacy];
    if (currentData.has(type) && !(options && options.raw)) return currentData.get(type);
    const raw = safeGet(DOCK_KEYS[legacy]);
    return options && options.raw ? raw : decodeDockValue(raw);
  }
  function getByCompatibilityKey(key, options) {
    const source = Object.keys(DOCK_KEYS).find(id => DOCK_KEYS[id] === key);
    return source ? get(source, options) : null;
  }
  function listCompatibilityKeys(source) {
    const legacy = legacySource(source);
    if (legacy && legacy !== 'all') return has(legacy) ? [DOCK_KEYS[legacy]] : [];
    return Object.keys(DOCK_KEYS).filter(id => has(id)).map(id => DOCK_KEYS[id]);
  }
  function has(source) {
    if (String(source || '').toLowerCase() === 'all') return centralStatus().every(status => status.ready);
    const type = canonicalType(source);
    if (type && currentPointers.has(type)) return true;
    const legacy = legacySource(source);
    return Boolean(legacy && legacy !== 'all' && safeGet(DOCK_KEYS[legacy]));
  }
  function markUpdated(source, details) {
    const type = canonicalType(source);
    const metadata = safeJson(safeGet(DATA_META_KEY), {}) || {};
    if (type) metadata[type] = { ...(metadata[type] || {}), ...(details || {}), updatedAt: new Date().toISOString() };
    safeSet(DATA_META_KEY, JSON.stringify(metadata));
    return metadata;
  }
  function set(source, value, options) {
    const legacy = legacySource(source);
    if (!legacy || legacy === 'all') throw new Error('Unknown CoachTools dataset: ' + source);
    const type = LEGACY_TO_DATASET[legacy];
    const data = options && options.raw ? decodeDockValue(String(value)) : value;
    safeSet(DOCK_KEYS[legacy], options && options.raw ? String(value) : encodeDockValue(value));
    currentData.set(type, data);
    const metadata = { ...(options && options.metadata || {}), originalFileName: options && options.metadata && (options.metadata.originalFileName || options.metadata.fileName) || data && data.meta && data.meta.fileName || '' };
    readyPromise.then(ok => ok && putDataset(type, data, metadata)).catch(error => console.warn('[CoachToolsData] Compatibility write could not reach IndexedDB.', error));
    markUpdated(type, metadata);
    notifyDataUpdated(type, { reason: 'compatibility-set' });
    return value;
  }
  function remove(source) {
    const legacy = legacySource(source);
    if (!legacy || legacy === 'all') return false;
    safeRemove(DOCK_KEYS[legacy]);
    removeDataset(LEGACY_TO_DATASET[legacy]).catch(error => console.warn('[CoachToolsData] Remove failed.', error));
    return true;
  }
  function getDatasetStatus() {
    return centralStatus().map(status => {
      const legacy = DATASET_TO_LEGACY[status.id] || '';
      const raw = legacy ? safeGet(DOCK_KEYS[legacy]) : null;
      return {
        ...status,
        datasetType: status.id,
        key: legacy ? DOCK_KEYS[legacy] : '',
        ready: Boolean(status.ready || raw),
        bytes: status.bytes || (raw ? raw.length * 2 : 0)
      };
    });
  }
  function getDataMetadata() { return safeJson(safeGet(DATA_META_KEY), {}) || {}; }
  function getApproximateStorageSize() {
    let bytes = 0, entries = 0;
    try {
      for (let index = 0; index < root.localStorage.length; index += 1) {
        const key = root.localStorage.key(index), value = root.localStorage.getItem(key) || '';
        bytes += (String(key).length + value.length) * 2; entries += 1;
      }
    } catch (_) {}
    return { bytes, entries, indexedDBAuthoritative: !databaseUnavailable };
  }
  function getScope() { return safeJson(safeGet(SCOPE_KEY), null); }
  function setScope(scope) {
    const next = { mode: 'all', label: 'All people', personId: '', department: '', team: '', coordinator: '', coaches: [], representatives: [], ...(scope || {}), updatedAt: new Date().toISOString() };
    safeSet(SCOPE_KEY, JSON.stringify(next));
    emitLocal(SCOPE_EVENT_NAME, next);
    sendToParent({ type: SCOPE_EVENT_NAME, detail: next });
    for (const channel of channels) try { channel.postMessage({ type: SCOPE_EVENT_NAME, detail: next }); } catch (_) {}
    return next;
  }
  function createBackup(options) {
    const maxBytes = Number(options && options.maxBytes) || 60 * 1024 * 1024;
    const backup = { packageType: 'coachtools-backup', schemaVersion: 2, exportedAt: new Date().toISOString(), compatibilityDocks: {}, scope: getScope(), preferences: {}, skipped: [], notes: ['IndexedDB is authoritative. Current compatibility views are included; full dated history remains in IndexedDB.'] };
    let includedBytes = 0;
    for (const [source, key] of Object.entries(DOCK_KEYS)) {
      const value = safeGet(key); if (value == null) continue;
      const bytes = value.length * 2;
      if (includedBytes + bytes > maxBytes) { backup.skipped.push({ key, reason: 'backup size limit', bytes }); continue; }
      backup.compatibilityDocks[source] = value; includedBytes += bytes;
    }
    for (const key of LIGHTWEIGHT_KEYS) {
      const value = safeGet(key); if (value == null) continue;
      const bytes = value.length * 2;
      if (bytes > 2 * 1024 * 1024 || includedBytes + bytes > maxBytes) { backup.skipped.push({ key, reason: 'preference too large', bytes }); continue; }
      backup.preferences[key] = value; includedBytes += bytes;
    }
    backup.approximateBytes = includedBytes;
    return backup;
  }
  function restoreBackup(backup) {
    if (!backup || backup.packageType !== 'coachtools-backup' || ![1, 2].includes(Number(backup.schemaVersion))) throw new Error('This is not a supported CoachTools backup.');
    const docks = backup.compatibilityDocks || backup.sharedDocks || {};
    const writes = [];
    for (const [source, value] of Object.entries(docks)) if (DOCK_KEYS[source] && typeof value === 'string') writes.push([DOCK_KEYS[source], value]);
    for (const [key, value] of Object.entries(backup.preferences || {})) if (LIGHTWEIGHT_KEYS.includes(key) && typeof value === 'string') writes.push([key, value]);
    if (backup.scope) writes.push([SCOPE_KEY, JSON.stringify(backup.scope)]);
    for (const [key, value] of writes) root.localStorage.setItem(key, value);
    safeRemove(MIGRATION_KEY);
    readyPromise.then(() => migrateLegacyDocks()).catch(() => {});
    notifyDataUpdated('all', { reason: 'backup-restored' });
    return { restoredKeys: writes.map(([key]) => key) };
  }
  function relayExternalMessage(message) {
    if (!message || !message.type || !message.detail) return;
    if (message.type === EVENT_NAME) emitLocal(EVENT_NAME, { ...message.detail, relayed: true });
    if (message.type === SCOPE_EVENT_NAME) emitLocal(SCOPE_EVENT_NAME, { ...message.detail, relayed: true });
  }
  root.addEventListener('storage', event => {
    const legacy = Object.keys(DOCK_KEYS).find(source => DOCK_KEYS[source] === event.key);
    if (legacy) emitLocal(EVENT_NAME, { source: LEGACY_TO_DATASET[legacy], updatedAt: new Date().toISOString(), nativeStorageEvent: true });
    if (event.key === SCOPE_KEY) emitLocal(SCOPE_EVENT_NAME, safeJson(event.newValue, {}));
  });
  root.addEventListener('message', event => relayExternalMessage(event.data));
  for (const channel of channels) channel.onmessage = event => relayExternalMessage(event.data);

  function subscribe(listener, options) {
    if (typeof listener !== 'function') return () => {};
    const eventName = options && options.scope ? SCOPE_EVENT_NAME : EVENT_NAME;
    const handler = event => listener(event.detail || {});
    root.addEventListener(eventName, handler);
    return () => root.removeEventListener(eventName, handler);
  }

  function mountStatus(element, options) {
    const target = typeof element === 'string' ? root.document && root.document.querySelector(element) : element;
    if (!target) return null;
    const requested = options && options.datasets ? options.datasets.map(canonicalType).filter(Boolean) : DATASET_TYPES;
    const render = () => {
      const rows = centralStatus().filter(status => requested.includes(status.id));
      target.innerHTML = '';
      const table = root.document.createElement('table');
      table.className = 'coachtools-data-status-table';
      const head = root.document.createElement('thead');
      head.innerHTML = '<tr><th>Dataset</th><th>Current source</th><th>Period</th><th>Status</th></tr>';
      const body = root.document.createElement('tbody');
      for (const status of rows) {
        const row = root.document.createElement('tr');
        for (const value of [status.label, status.fileName || '—', status.period || '—', status.ready ? 'Ready' : 'Missing']) {
          const cell = root.document.createElement('td'); cell.textContent = value; row.appendChild(cell);
        }
        row.dataset.ready = String(status.ready); body.appendChild(row);
      }
      table.append(head, body); target.appendChild(table);
    };
    readyPromise.then(render); root.addEventListener(EVENT_NAME, render); render();
    return { render, destroy() { root.removeEventListener(EVENT_NAME, render); } };
  }
  function installStatusStyles() {
    if (!root.document || root.document.getElementById('coachtools-data-status-styles')) return;
    const style = root.document.createElement('style');
    style.id = 'coachtools-data-status-styles';
    style.textContent = '.coachtools-data-status-table{width:100%;border-collapse:separate;border-spacing:0;font:12px/1.4 Inter,ui-sans-serif,system-ui,sans-serif;color:inherit}.coachtools-data-status-table th,.coachtools-data-status-table td{padding:9px 10px;text-align:left;border-bottom:1px solid rgba(100,116,139,.22)}.coachtools-data-status-table th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}.coachtools-data-status-table tr[data-ready="true"] td:last-child{color:#16834b;font-weight:800}.coachtools-data-status-table tr[data-ready="false"] td:last-child{color:#a86600;font-weight:800}.coachtools-data-status-table td:first-child{font-weight:750}';
    root.document.head.appendChild(style);
  }
  function autoMountStatus() {
    if (!root.document) return;
    installStatusStyles();
    for (const element of root.document.querySelectorAll('[data-coachtools-data-status]')) mountStatus(element);
  }
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', autoMountStatus, { once: true });
    else autoMountStatus();
  }

  const CoachToolsData = Object.freeze({
    VERSION, DB_NAME, DB_VERSION, DATASET_TYPES, LABELS, EVENT_NAME, ready: () => readyPromise,
    importDataset: async (type, data, metadata) => { await readyPromise; if (databaseUnavailable) throw new Error('IndexedDB is unavailable.'); const result = await putDataset(type, data, metadata); if (root.CoachToolsIdentity && result.status !== 'duplicate') await root.CoachToolsIdentity.ingestDataset(canonicalType(type), data, { ...(metadata || {}), fingerprint: result.dataset && result.dataset.fingerprint || metadata && metadata.fingerprint || '' }).catch(error => console.warn('[CoachToolsData] Identity learning could not finish.', error)); return result; },
    replaceDataset: async (type, data, metadata) => { await readyPromise; const result = await putDataset(type, data, { ...(metadata || {}), replace: true }); if (root.CoachToolsIdentity) await root.CoachToolsIdentity.ingestDataset(canonicalType(type), data, { ...(metadata || {}), fingerprint: result.dataset && result.dataset.fingerprint || metadata && metadata.fingerprint || '' }).catch(() => {}); return result; },
    getCurrent, getHistory, getDatasetVersion, getImportHistory, inspectDataset, removeDataset,
    getStatus: async () => { await readyPromise; return centralStatus(); },
    getStatusSync: centralStatus,
    mountStatus, subscribe: listener => subscribe(listener), subscribeScope: listener => subscribe(listener, { scope: true }),
    notifyDataUpdated
  });
  const CoachToolsStorage = Object.freeze({
    VERSION, EVENT_NAME, SCOPE_EVENT_NAME, SCOPE_KEY, DATA_META_KEY, LEGACY_DATA_META_KEY, DOCK_KEYS, LABELS,
    storageAvailable, decodeDockValue, ready: () => readyPromise,
    get, getRaw: source => get(source, { raw: true }), getByCompatibilityKey, listCompatibilityKeys,
    getRetail: () => get('retail'), getReferral: () => get('referral'), getQA: () => get('qa'), getCoaching: () => get('coaching'), getChecklist: () => get('checklist'),
    has, hasRetail: () => has('retail'), hasReferral: () => has('referral'), hasQA: () => has('qa'), hasCoaching: () => has('coaching'), hasChecklist: () => has('checklist'),
    set, remove, markUpdated, notifyDataUpdated, getDataMetadata, getDatasetStatus, getCentralDatasetStatus: centralStatus,
    getApproximateStorageSize, getScope, setScope, subscribe: listener => subscribe(listener), subscribeScope: listener => subscribe(listener, { scope: true }), createBackup, restoreBackup
  });
  root.CoachToolsData = CoachToolsData;
  root.CoachToolsStorage = CoachToolsStorage;
  root.CoachToolsDataStatus = Object.freeze({ mount: mountStatus, installStyles: installStatusStyles });
})(window);
