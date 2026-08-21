(function attachCoachToolsData(root) {
  'use strict';

  const VERSION = '2.4.0';
  const EVENT_NAME = 'coachtools:data-updated';
  const SCOPE_EVENT_NAME = 'coachtools:scope-updated';
  const CHANNEL_NAME = 'coachtools-data-v2';
  const LEGACY_CHANNEL_NAME = 'coachtools-data-v1';
  const SCOPE_KEY = 'coachtools.scope.v1';
  const CLEAN_SCOPE_KEY = 'coachtools.scope.clean.v1';
  const DATA_META_KEY = 'coachtools.data.meta.v2';
  const LEGACY_DATA_META_KEY = 'coachtools.data.meta.v1';
  const MIGRATION_KEY = 'coachtools.indexeddb.migration.v1';

  // CoachTools now extends All-Star's existing import database instead of creating
  // a second large-data database beside it. All-Star uses the first four stores;
  // the shared API owns the CoachTools data and identity stores added through schema version 8.
  const DB_NAME = 'allStarImportedDataCache.v1';
  const DB_VERSION = 8;
  const DATASET_STORE = 'coachtoolsDatasets';
  const DATASET_CHUNK_STORE = 'coachtoolsDatasetChunks';
  const CURRENT_STORE = 'coachtoolsCurrent';
  const IMPORT_STORE = 'coachtoolsImports';
  const PEOPLE_STORE = 'coachtoolsPeople';
  const IDENTITY_REVIEW_STORE = 'coachtoolsIdentityReviews';
  const CHUNK_ROWS = 2000;
  const CHUNK_THRESHOLD_BYTES = 4 * 1024 * 1024;
  const CHUNK_THRESHOLD_ROWS = 12000;
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
    'allStarCoachToolsSync.v2',
    CLEAN_SCOPE_KEY,
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
  // Full records are loaded only when requested. Entries are keyed by the
  // current dataset pointer so a replacement invalidates just one dataset.
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
  function workbookRowCount(data) {
    const sheets = data && data.workbook && data.workbook.data;
    if (!sheets) return 0;
    return Object.values(sheets).reduce((sum, sheet) => sum + (Array.isArray(sheet && sheet.aoa) ? sheet.aoa.length : 0), 0);
  }
  function estimatedWorkbookBytes(data, stopAt) {
    const sheets = data && data.workbook && data.workbook.data;
    if (!sheets) return 0;
    const ceiling = Math.max(1, Number(stopAt) || CHUNK_THRESHOLD_BYTES);
    let bytes = 0;
    for (const sheet of Object.values(sheets)) {
      for (const row of Array.isArray(sheet && sheet.aoa) ? sheet.aoa : []) {
        bytes += 16 + (Array.isArray(row) ? row.length * 8 : 0);
        for (const cell of Array.isArray(row) ? row : []) {
          if (typeof cell === 'string') bytes += cell.length * 2;
          else if (cell != null) bytes += 16;
        }
        if (bytes >= ceiling) return bytes;
      }
    }
    return bytes;
  }
  function shouldChunkDataset(data, metadata) {
    const fileSize = Number(metadata && metadata.fileSize || data && data.meta && data.meta.fileSize) || 0;
    const rowCount = Number(metadata && metadata.rowCount || data && data.meta && data.meta.totalRows) || workbookRowCount(data);
    if (fileSize >= CHUNK_THRESHOLD_BYTES || rowCount >= CHUNK_THRESHOLD_ROWS) return true;
    return estimatedWorkbookBytes(data, CHUNK_THRESHOLD_BYTES) >= CHUNK_THRESHOLD_BYTES;
  }
  function createDataSkeleton(data) {
    if (!data || typeof data !== 'object') return clone(data);
    const workbook = data.workbook && typeof data.workbook === 'object' ? data.workbook : null;
    if (!workbook || !workbook.data) return clone(data);
    const skeleton = { ...data, meta: clone(data.meta || {}), workbook: { ...workbook, sheets: Array.isArray(workbook.sheets) ? workbook.sheets.slice() : [], data: {} } };
    for (const [sheetName, sourceSheet] of Object.entries(workbook.data)) {
      if (!sourceSheet || typeof sourceSheet !== 'object') {
        skeleton.workbook.data[sheetName] = sourceSheet;
        continue;
      }
      const { aoa, ...sheetMetadata } = sourceSheet;
      skeleton.workbook.data[sheetName] = { ...clone(sheetMetadata), aoa: [] };
    }
    return skeleton;
  }
  function splitDataIntoChunks(data, datasetId) {
    const skeleton = createDataSkeleton(data);
    const sourceSheets = data && data.workbook && data.workbook.data;
    const targetSheets = skeleton && skeleton.workbook && skeleton.workbook.data;
    const chunks = [];
    let index = 0;
    if (!sourceSheets || !targetSheets) return { skeleton, chunks };
    for (const [sheetName, sourceSheet] of Object.entries(sourceSheets)) {
      if (!sourceSheet || !Array.isArray(sourceSheet.aoa) || !targetSheets[sheetName]) continue;
      targetSheets[sheetName].aoa = [];
      for (let rowStart = 0; rowStart < sourceSheet.aoa.length; rowStart += CHUNK_ROWS) {
        chunks.push({
          id: `${datasetId}:${String(index).padStart(6, '0')}`,
          datasetId,
          index,
          sheetName,
          rowStart,
          // Keep row objects shared until IndexedDB performs its structured clone.
          // Deep-copying every chunk here temporarily doubled large workbooks.
          rows: sourceSheet.aoa.slice(rowStart, rowStart + CHUNK_ROWS)
        });
        index += 1;
      }
    }
    return { skeleton, chunks };
  }
  function assembleDataFromChunks(skeleton, chunks) {
    const data = clone(skeleton);
    const sheets = data && data.workbook && data.workbook.data;
    if (!sheets) return data;
    for (const chunk of (chunks || []).slice().sort((left, right) => Number(left.index) - Number(right.index))) {
      if (!chunk || !sheets[chunk.sheetName]) continue;
      if (!Array.isArray(sheets[chunk.sheetName].aoa)) sheets[chunk.sheetName].aoa = [];
      sheets[chunk.sheetName].aoa.push(...clone(chunk.rows || []));
    }
    return data;
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
  async function ensureLegacyDecoder(raw) {
    if (!raw || safeJson(raw, undefined) !== undefined || root.LZString) return;
    if (root.CoachToolsDependencies && root.CoachToolsDependencies.ensureLzString) {
      try { await root.CoachToolsDependencies.ensureLzString(); } catch (_) {}
    }
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
  function ensureIndex(store, name, keyPath, options) {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options || { unique: false });
  }
  function identityIndexKey(value) {
    let text = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
    if (text.includes(',')) {
      const parts = text.split(','), last = parts.shift().trim(), given = parts.join(' ').trim();
      if (last && given) text = `${given} ${last}`;
    }
    return text.normalize ? text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[.’'`]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase() : text.toLowerCase();
  }
  function migratePeopleIndexFields(store) {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const person = cursor.value || {};
      const aliasKeys = Array.from(new Set((person.aliases || []).map(identityIndexKey).filter(Boolean)));
      const currentTeam = person.currentTeam || person.team || '';
      if (JSON.stringify(person.aliasKeys || []) !== JSON.stringify(aliasKeys) || person.currentTeam !== currentTeam) cursor.update({ ...person, aliasKeys, currentTeam });
      cursor.continue();
    };
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
        const upgradeTx = request.transaction;
        const datasetStore = db.objectStoreNames.contains(DATASET_STORE)
          ? upgradeTx.objectStore(DATASET_STORE)
          : db.createObjectStore(DATASET_STORE, { keyPath: 'id' });
        ensureIndex(datasetStore, 'datasetType', 'datasetType', { unique: false });
        ensureIndex(datasetStore, 'periodKey', ['datasetType', 'periodKey'], { unique: false });
        ensureIndex(datasetStore, 'fingerprint', ['datasetType', 'fingerprint'], { unique: false });
        ensureIndex(datasetStore, 'datasetTypePeriodSort', ['datasetType', 'periodSort'], { unique: false });
        ensureIndex(datasetStore, 'datasetTypePeriodSortImportedAt', ['datasetType', 'periodSort', 'importedAt'], { unique: false });
        ensureIndex(datasetStore, 'datasetTypeImportedAt', ['datasetType', 'importedAt'], { unique: false });
        ensureIndex(datasetStore, 'datasetTypeVersion', ['datasetType', 'version'], { unique: true });
        ensureIndex(datasetStore, 'datasetScopePeriod', ['datasetType', 'scopeHash', 'periodKey'], { unique: false });
        ensureIndex(datasetStore, 'datasetScopePeriodImportedAt', ['datasetType', 'scopeHash', 'periodKey', 'importedAt'], { unique: false });
        ensureIndex(datasetStore, 'datasetScopePeriodFingerprint', ['datasetType', 'scopeHash', 'periodKey', 'fingerprint'], { unique: false });
        if (!db.objectStoreNames.contains(DATASET_CHUNK_STORE)) {
          const store = db.createObjectStore(DATASET_CHUNK_STORE, { keyPath: 'id' });
          store.createIndex('datasetId', 'datasetId', { unique: false });
          store.createIndex('datasetOrder', ['datasetId', 'index'], { unique: true });
        }
        if (!db.objectStoreNames.contains(CURRENT_STORE)) db.createObjectStore(CURRENT_STORE, { keyPath: 'datasetType' });
        const importStore = db.objectStoreNames.contains(IMPORT_STORE)
          ? upgradeTx.objectStore(IMPORT_STORE)
          : db.createObjectStore(IMPORT_STORE, { keyPath: 'id' });
        ensureIndex(importStore, 'datasetType', 'datasetType', { unique: false });
        ensureIndex(importStore, 'importedAt', 'importedAt', { unique: false });
        ensureIndex(importStore, 'datasetTypeImportedAt', ['datasetType', 'importedAt'], { unique: false });
        const peopleStore = db.objectStoreNames.contains(PEOPLE_STORE)
          ? upgradeTx.objectStore(PEOPLE_STORE)
          : db.createObjectStore(PEOPLE_STORE, { keyPath: 'personId' });
        ensureIndex(peopleStore, 'normalizedName', 'normalizedName', { unique: false });
        ensureIndex(peopleStore, 'aliasKeys', 'aliasKeys', { unique: false, multiEntry: true });
        ensureIndex(peopleStore, 'role', 'role', { unique: false });
        ensureIndex(peopleStore, 'department', 'department', { unique: false });
        ensureIndex(peopleStore, 'currentTeam', 'currentTeam', { unique: false });
        ensureIndex(peopleStore, 'currentCoachId', 'currentCoachId', { unique: false });
        ensureIndex(peopleStore, 'coordinator', 'coordinator', { unique: false });
        ensureIndex(peopleStore, 'roleDepartment', ['role', 'department'], { unique: false });
        ensureIndex(peopleStore, 'roleTeam', ['role', 'currentTeam'], { unique: false });
        migratePeopleIndexFields(peopleStore);
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
    if (metadata && metadata.scopedFingerprint) return String(metadata.scopedFingerprint);
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
      scopedFingerprint: record.scopedFingerprint || record.fingerprint || '',
      scopeSnapshot: record.scopeSnapshot ? clone(record.scopeSnapshot) : null,
      scopeHash: record.scopeHash || '',
      scopeMode: record.scopeMode || (record.scopeSnapshot && record.scopeSnapshot.mode) || 'legacy-unscoped',
      scopedRowCount: Number(record.scopedRowCount) || 0,
      scopeMatchDiagnostics: record.scopeMatchDiagnostics ? clone(record.scopeMatchDiagnostics) : null,
      schemaVersion: Number(record.schemaVersion) || 1,
      classificationMethod: record.classificationMethod || '',
      validationStatus: record.validationStatus || 'ready',
      replacedDatasetId: record.replacedDatasetId || '',
      supersededBy: record.supersededBy || '',
      chunked: Boolean(record.chunked),
      chunkCount: Number(record.chunkCount) || 0,
      storageFormat: record.storageFormat || (record.chunked ? 'rows-v1' : 'record-v1')
    };
  }
  function compareCurrent(candidate, current) {
    if (!current) return true;
    if (candidate.scopeHash && candidate.scopeHash !== current.scopeHash) return true;
    if (candidate.periodKey && candidate.periodKey === current.periodKey) return candidate.importedAt >= current.importedAt;
    if (candidate.periodSort !== current.periodSort) return candidate.periodSort > current.periodSort;
    return candidate.importedAt >= current.importedAt;
  }
  function cacheCurrentRecord(type, record) {
    if (!record) { currentData.delete(type); return; }
    const pointer = currentPointers.get(type) || record;
    const key = `${pointer.datasetId || record.id || ''}:${Number(pointer.version || record.version) || 0}`;
    currentData.set(type, { key, record });
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
  function prepareStoredData(data, datasetId, metadata) {
    if (!shouldChunkDataset(data, metadata)) return { chunked: false, data: clone(data), dataShape: null, chunks: [] };
    const prepared = splitDataIntoChunks(data, datasetId);
    if (!prepared.chunks.length) return { chunked: false, data: clone(data), dataShape: null, chunks: [] };
    return { chunked: true, data: null, dataShape: prepared.skeleton, chunks: prepared.chunks };
  }
  function readDatasetChunks(db, datasetId) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const transaction = db.transaction(DATASET_CHUNK_STORE, 'readonly');
      const request = transaction.objectStore(DATASET_CHUNK_STORE).index('datasetId').openCursor(datasetId);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        chunks.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error(`Could not read chunks for ${datasetId}.`));
      transaction.oncomplete = () => resolve(chunks.sort((left, right) => Number(left.index) - Number(right.index)));
      transaction.onerror = () => reject(transaction.error || new Error(`Chunk transaction failed for ${datasetId}.`));
      transaction.onabort = () => reject(transaction.error || new Error(`Chunk transaction was interrupted for ${datasetId}.`));
    });
  }
  function idbKeyRange() {
    return root.IDBKeyRange || (typeof IDBKeyRange !== 'undefined' ? IDBKeyRange : null);
  }
  function prefixRange(prefix, trailingParts) {
    const ranges = idbKeyRange();
    if (!ranges) return null;
    const count = Math.max(1, Number(trailingParts) || 1);
    return ranges.bound([...prefix, ...Array(count).fill('')], [...prefix, ...Array(count).fill('\uffff')]);
  }
  function readCursor(transaction, source, options) {
    const values = [];
    const limit = Number.isFinite(Number(options && options.limit)) ? Math.max(0, Number(options.limit)) : Infinity;
    const predicate = options && typeof options.predicate === 'function' ? options.predicate : null;
    return new Promise((resolve, reject) => {
      let stopped = limit === 0;
      const request = stopped ? null : source.openCursor(options && options.range || null, options && options.direction || 'next');
      if (request) {
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || stopped) return;
          if (!predicate || predicate(cursor.value)) values.push(cursor.value);
          if (values.length >= limit) { stopped = true; return; }
          cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB cursor read failed.'));
      }
      transaction.oncomplete = () => resolve(values);
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB cursor transaction failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB cursor transaction was interrupted.'));
    });
  }
  async function materializeDatasetRecord(db, record) {
    if (!record || !record.chunked) return record;
    if (!record.dataShape || Number(record.chunkCount) < 1) throw new Error(`Dataset ${record.datasetType || record.id} has invalid chunk metadata.`);
    const chunks = await readDatasetChunks(db, record.id);
    if (chunks.length !== Number(record.chunkCount)) throw new Error(`Dataset ${record.datasetType || record.id} is incomplete (${chunks.length} of ${record.chunkCount} chunks).`);
    return { ...record, data: assembleDataFromChunks(record.dataShape, chunks) };
  }
  async function putDataset(type, data, metadata) {
    const datasetType = canonicalType(type);
    if (!datasetType) throw new Error('Unknown CoachTools dataset: ' + type);
    const meta = { ...(metadata || {}) };
    const importedAt = meta.importedAt || new Date().toISOString();
    const sourcePeriod = meta.detectedPeriod || data && data.meta && data.meta.detectedPeriod;
    const detectedPeriod = normalizedPeriod(sourcePeriod, { ...meta, importedAt });
    const fingerprint = fingerprintValue(data, meta);
    const scopeSnapshot = clone(meta.scopeSnapshot || data && data.meta && data.meta.scopeSnapshot || null);
    const scopeHash = String(meta.scopeHash || data && data.meta && data.meta.scopeHash || scopeSnapshot && scopeSnapshot.scopeHash || '');
    const scopeMode = String(meta.scopeMode || data && data.meta && data.meta.scopeMode || scopeSnapshot && scopeSnapshot.mode || 'legacy-unscoped');
    const scopedRowCount = Number(meta.scopedRowCount != null ? meta.scopedRowCount : data && data.meta && data.meta.scopedRowCount != null ? data.meta.scopedRowCount : meta.rowCount || data && data.meta && data.meta.totalRows) || 0;
    const scopeMatchDiagnostics = clone(meta.scopeMatchDiagnostics || data && data.meta && data.meta.scopeMatchDiagnostics || null);
    const scopedFingerprint = String(meta.scopedFingerprint || data && data.meta && data.meta.scopedFingerprint || fingerprint);
    const periodKey = detectedPeriod.periodKey;
    const diagnostics = root.CoachToolsDiagnostics;
    if (diagnostics) diagnostics.start('IndexedDB write', { datasetType, periodKey });
    const db = await openDatabase();
    try {
      const readTx = db.transaction([DATASET_STORE, CURRENT_STORE], 'readonly');
      const datasetStore = readTx.objectStore(DATASET_STORE);
      const duplicateRequest = datasetStore.index('datasetScopePeriodFingerprint').get([datasetType, scopeHash, periodKey, fingerprint]);
      const samePeriodRequest = datasetStore.index('datasetScopePeriod').getAll([datasetType, scopeHash, periodKey]);
      const currentRequest = readTx.objectStore(CURRENT_STORE).get(datasetType);
      const latestVersionTx = db.transaction(DATASET_STORE, 'readonly');
      const latestVersionPromise = readCursor(latestVersionTx, latestVersionTx.objectStore(DATASET_STORE).index('datasetTypeVersion'), {
        range: idbKeyRange() ? idbKeyRange().bound([datasetType, 0], [datasetType, Number.MAX_SAFE_INTEGER]) : null,
        direction: 'prev', limit: 1,
        predicate: record => record.datasetType === datasetType
      });
      const [duplicate, samePeriodRecords, current, latestVersions] = await Promise.all([
        idbRequest(duplicateRequest), idbRequest(samePeriodRequest), idbRequest(currentRequest), latestVersionPromise
      ]);
      if (duplicate) {
        const pointerCandidate = { ...compactMetadata(duplicate), datasetId: duplicate.id, updatedAt: importedAt };
        const shouldBecomeCurrent = compareCurrent(pointerCandidate, current);
        const importRecord = {
          id: `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          datasetType,
          datasetId: duplicate.id,
          action: shouldBecomeCurrent ? 'duplicate-reactivated' : 'duplicate',
          originalFileName: meta.originalFileName || meta.fileName || duplicate.originalFileName || '',
          importedAt,
          fingerprint,
          scopedFingerprint,
          scopeSnapshot,
          scopeHash,
          scopeMode,
          scopedRowCount,
          scopeMatchDiagnostics,
          classificationMethod: meta.classificationMethod || 'filename+headers'
        };
        const tx = db.transaction([CURRENT_STORE, IMPORT_STORE], 'readwrite');
        if (shouldBecomeCurrent) tx.objectStore(CURRENT_STORE).put(pointerCandidate);
        tx.objectStore(IMPORT_STORE).put(importRecord);
        await transactionDone(tx);
        if (shouldBecomeCurrent) {
          currentPointers.set(datasetType, pointerCandidate);
          currentData.delete(datasetType);
          persistMetadataSnapshot();
          notifyDataUpdated(datasetType, { reason: 'duplicate-reactivated', datasetId: duplicate.id, version: duplicate.version });
        }
        return { status: 'duplicate', dataset: compactMetadata(duplicate), current: shouldBecomeCurrent ? compactMetadata(pointerCandidate) : compactMetadata(current) };
      }
      const samePeriod = (samePeriodRecords || []).filter(record => !record.supersededBy).sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)))[0];
      const version = (Number(latestVersions && latestVersions[0] && latestVersions[0].version) || 0) + 1;
      const id = `${datasetType}:${periodKey}:${fingerprint}:${Date.now().toString(36)}`;
      const storedData = prepareStoredData(data, id, { ...meta, rowCount: meta.rowCount || data && data.meta && data.meta.totalRows });
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
        scopedFingerprint,
        scopeSnapshot,
        scopeHash,
        scopeMode,
        scopedRowCount,
        scopeMatchDiagnostics,
        schemaVersion: Math.max(Number(meta.schemaVersion) || 1, storedData.chunked ? 2 : 1),
        classificationMethod: meta.classificationMethod || 'filename+headers',
        validationStatus: meta.validationStatus || 'ready',
        replacedDatasetId: samePeriod && samePeriod.id || '',
        supersededBy: '',
        chunked: storedData.chunked,
        chunkCount: storedData.chunks.length,
        storageFormat: storedData.chunked ? 'rows-v1' : 'record-v1',
        dataShape: storedData.dataShape,
        data: storedData.data
      };
      const pointerCandidate = { ...compactMetadata(record), datasetId: id, updatedAt: importedAt };
      const shouldBecomeCurrent = compareCurrent(pointerCandidate, current);
      const tx = db.transaction([DATASET_STORE, DATASET_CHUNK_STORE, CURRENT_STORE, IMPORT_STORE], 'readwrite');
      const writeDatasetStore = tx.objectStore(DATASET_STORE);
      if (samePeriod) writeDatasetStore.put({ ...samePeriod, supersededBy: id });
      writeDatasetStore.put(record);
      for (const chunk of storedData.chunks) tx.objectStore(DATASET_CHUNK_STORE).put(chunk);
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
        // IndexedDB already performs the durable structured clone. Retain the
        // caller-owned object for chunked workbooks instead of doubling a large
        // in-memory tree on the save path.
        cacheCurrentRecord(datasetType, { ...record, data: storedData.chunked ? data : clone(data) });
      }
      persistMetadataSnapshot();
      notifyDataUpdated(datasetType, { reason: samePeriod ? 'replacement' : 'imported', datasetId: id, version });
      return { status: samePeriod ? 'replacement' : 'imported', dataset: compactMetadata(record), current: shouldBecomeCurrent ? compactMetadata(pointerCandidate) : compactMetadata(current) };
    } finally {
      db.close();
      if (diagnostics) diagnostics.end('IndexedDB write', { datasetType, periodKey });
    }
  }
  async function inspectDataset(type, data, metadata) {
    await readyPromise;
    const datasetType = canonicalType(type);
    if (!datasetType) return { status: 'needs-review', reason: 'Unknown CoachTools dataset.', becomesCurrent: false };
    const meta = { ...(metadata || {}) };
    const importedAt = meta.importedAt || new Date().toISOString();
    const sourcePeriod = meta.detectedPeriod || data && data.meta && data.meta.detectedPeriod;
    const detectedPeriod = normalizedPeriod(sourcePeriod, { ...meta, importedAt });
    const scopeSnapshot = clone(meta.scopeSnapshot || data && data.meta && data.meta.scopeSnapshot || null);
    const scopeHash = String(meta.scopeHash || data && data.meta && data.meta.scopeHash || scopeSnapshot && scopeSnapshot.scopeHash || '');
    const scopeMode = String(meta.scopeMode || data && data.meta && data.meta.scopeMode || scopeSnapshot && scopeSnapshot.mode || 'legacy-unscoped');
    const scopedRowCount = Number(meta.scopedRowCount != null ? meta.scopedRowCount : data && data.meta && data.meta.scopedRowCount != null ? data.meta.scopedRowCount : meta.rowCount || data && data.meta && data.meta.totalRows) || 0;
    const candidate = {
      datasetType,
      fingerprint: fingerprintValue(data, meta),
      scopedFingerprint: String(meta.scopedFingerprint || data && data.meta && data.meta.scopedFingerprint || fingerprintValue(data, meta)),
      scopeSnapshot,
      scopeHash,
      scopeMode,
      scopedRowCount,
      periodKey: detectedPeriod.periodKey,
      periodSort: detectedPeriod.sortKey,
      importedAt
    };
    if (['weeklyRetail', 'weeklyReferral', 'monthlyRetail', 'monthlyReferral', 'compCoaching'].includes(datasetType) && (!sourcePeriod || !sourcePeriod.sortKey || sourcePeriod.periodKey === 'current')) {
      return { status: 'needs-review', reason: 'The reporting period could not be detected safely.', becomesCurrent: false, candidate };
    }
    if (databaseUnavailable) return { status: currentData.has(datasetType) ? 'needs-review' : 'new', reason: 'IndexedDB comparison history is unavailable.', becomesCurrent: !currentData.has(datasetType), candidate };
    const db = await openDatabase();
    try {
      const tx = db.transaction([DATASET_STORE, CURRENT_STORE], 'readonly');
      const datasetStore = tx.objectStore(DATASET_STORE);
      const duplicateRequest = datasetStore.index('datasetScopePeriodFingerprint').get([datasetType, scopeHash, candidate.periodKey, candidate.fingerprint]);
      const currentRequest = tx.objectStore(CURRENT_STORE).get(datasetType);
      const [duplicate, current] = await Promise.all([idbRequest(duplicateRequest), idbRequest(currentRequest)]);
      if (meta.automaticImport && current && current.scopeHash && scopeHash && current.scopeHash !== scopeHash) {
        return { status: 'needs-review', reason: 'The automatic update scope does not match the currently active dataset scope.', becomesCurrent: false, candidate, current: compactMetadata(current) };
      }
      if (meta.automaticImport && current && String(current.scopeHash || '') === scopeHash && Number(current.scopedRowCount) > 0 && scopedRowCount === 0) {
        return { status: 'needs-review', reason: `Scoped rows collapsed from ${Number(current.scopedRowCount)} to 0. The existing dataset was retained.`, becomesCurrent: false, candidate, current: compactMetadata(current) };
      }
      const result = root.CoachToolsSync && root.CoachToolsSync.compareCandidate
        ? root.CoachToolsSync.compareCandidate(candidate, current, duplicate ? [duplicate] : [])
        : (!current ? { status: 'new', reason: 'No current dataset exists.', becomesCurrent: true }
          : duplicate ? { status: 'current', reason: 'Identical scoped fingerprint already imported for this reporting period.', becomesCurrent: false }
          : scopeHash && scopeHash !== String(current.scopeHash || '') ? { status: 'new', reason: 'This source has not been evaluated for the selected scope.', becomesCurrent: true }
          : candidate.periodKey === current.periodKey ? { status: 'updated', reason: 'The reporting period matches but contents changed.', becomesCurrent: true }
          : candidate.periodSort > current.periodSort ? { status: 'new', reason: 'A newer period was detected.', becomesCurrent: true }
          : candidate.periodSort < current.periodSort ? { status: 'older', reason: 'An older period was detected.', becomesCurrent: false }
          : { status: 'needs-review', reason: 'The reporting period could not be compared safely.', becomesCurrent: false });
      return { ...result, candidate, current: compactMetadata(current) };
    } finally { db.close(); }
  }
  async function migrateLegacyDocks(onlyTypes) {
    const migrated = safeJson(safeGet(MIGRATION_KEY), {}) || {};
    for (const [legacy, type] of Object.entries(LEGACY_TO_DATASET)) {
      if (onlyTypes && !onlyTypes.includes(type)) continue;
      const raw = safeGet(DOCK_KEYS[legacy]);
      if (!raw) continue;
      if (currentPointers.has(type)) {
        safeRemove(DOCK_KEYS[legacy]);
        migrated[type] = migrated[type] || new Date().toISOString();
        continue;
      }
      await ensureLegacyDecoder(raw);
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
        // The one-time source has served its purpose. Reclaim localStorage so
        // IndexedDB remains the only persisted large-data copy.
        safeRemove(DOCK_KEYS[legacy]);
      } catch (error) { console.warn('[CoachToolsData] Legacy migration failed for ' + type, error); }
    }
    safeSet(MIGRATION_KEY, JSON.stringify(migrated));
  }
  async function initialize() {
    const diagnostics = root.CoachToolsDiagnostics;
    if (diagnostics) diagnostics.start('IndexedDB metadata initialization');
    try {
      if (!safeGet(DATA_META_KEY) && safeGet(LEGACY_DATA_META_KEY)) safeSet(DATA_META_KEY, safeGet(LEGACY_DATA_META_KEY));
      await refreshPointers();
      persistMetadataSnapshot();
      notifyDataUpdated('all', { reason: 'indexeddb-ready' });
      const migrate = () => migrateLegacyDocks().catch(error => console.warn('[CoachToolsData] Background legacy migration failed.', error));
      if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(migrate, { timeout: 1800 });
      else root.setTimeout(migrate, 0);
      return true;
    } catch (error) {
      databaseUnavailable = true;
      console.warn('[CoachToolsData] IndexedDB unavailable; legacy compatibility is active.', error);
      return false;
    } finally { if (diagnostics) diagnostics.end('IndexedDB metadata initialization'); }
  }
  const readyPromise = initialize();

  async function getCurrent(type, options) {
    await readyPromise;
    const datasetType = canonicalType(type);
    if (!datasetType) return null;
    if (databaseUnavailable) {
      const cached = currentData.get(datasetType);
      if (cached && cached.record) return options && options.includeRecord ? cached.record : cached.record.data;
      const legacy = DATASET_TO_LEGACY[datasetType];
      const raw = legacy && safeGet(DOCK_KEYS[legacy]);
      if (!raw) return null;
      await ensureLegacyDecoder(raw);
      const legacyData = decodeDockValue(raw);
      return options && options.includeRecord ? { id: `legacy:${datasetType}`, datasetType, version: 0, data: legacyData } : legacyData;
    }
    let pointer = currentPointers.get(datasetType);
    if (!pointer) {
      await migrateLegacyDocks([datasetType]);
      pointer = currentPointers.get(datasetType);
    }
    if (!pointer) return null;
    if (options && options.metadataOnly) return compactMetadata(pointer);
    const cacheKey = `${pointer.datasetId || ''}:${Number(pointer.version) || 0}`;
    const cached = currentData.get(datasetType);
    if (cached && cached.key === cacheKey) return options && options.includeRecord ? cached.record : cached.record.data || null;
    const diagnostics = root.CoachToolsDiagnostics;
    if (diagnostics) diagnostics.start(`${datasetType} IndexedDB read`);
    const db = await openDatabase();
    try {
      const storedRecord = await idbRequest(db.transaction(DATASET_STORE, 'readonly').objectStore(DATASET_STORE).get(pointer.datasetId));
      const record = await materializeDatasetRecord(db, storedRecord);
      if (record) cacheCurrentRecord(datasetType, record);
      return options && options.includeRecord ? record || null : record && record.data || null;
    } finally {
      db.close();
      if (diagnostics) diagnostics.end(`${datasetType} IndexedDB read`);
    }
  }
  const STREAM_PERSON_HEADERS = Object.freeze([
    'Representative', 'Representative Name', 'Associate Name', 'Agent Name', 'AgentName',
    'CSR/SSR Name', 'Employee', 'Name'
  ]);
  const STREAM_OWNERSHIP_HEADERS = Object.freeze({
    documentedCoaching: ['Job Coach', 'Coach Assigned', 'Coach', 'Team'],
    weeklyRetail: ['Sheet', 'Team', 'Coach', 'Job Coach'],
    weeklyReferral: ['Sheet', 'Team', 'Coach', 'Job Coach'],
    qa: ['Team'],
    checklist: ['Coach Assigned', 'Coach', 'Job Coach', 'Team'],
    monthlyRetail: ['Sheet', 'Team', 'Coach', 'Job Coach'],
    monthlyReferral: ['Sheet', 'Team', 'Coach', 'Job Coach'],
    compCoaching: ['CSR Team/Coach', 'Coach Assigned', 'Coach', 'Team']
  });
  function streamNormalize(value) {
    if (root.CoachToolsIdentity && typeof root.CoachToolsIdentity.normalizeName === 'function') return root.CoachToolsIdentity.normalizeName(value);
    return String(value == null ? '' : value).trim().replace(/,/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  }
  function personLookupNames(person) {
    if (!person) return [];
    const sourceNames = person.sourceNames && typeof person.sourceNames === 'object'
      ? Object.values(person.sourceNames).flatMap(names => Array.isArray(names) ? names : names ? [names] : [])
      : [];
    return [person.displayName, person.normalizedName, ...(person.aliases || []), ...sourceNames].map(streamNormalize).filter(Boolean);
  }
  async function streamFilterContext(datasetType, options) {
    const scope = options && options.scope && typeof options.scope === 'object' ? options.scope : null;
    const coachIds = Array.from(new Set([...(options && options.coachIds || []), ...(scope && scope.coachPersonIds || []), ...(scope && scope.mode === 'coach' && scope.personId ? [scope.personId] : [])].filter(Boolean)));
    const personIds = Array.from(new Set([...(options && options.personIds || []), ...(scope && scope.mode === 'representative' && scope.personId ? [scope.personId] : [])].filter(Boolean)));
    const coachKeys = new Set([...(options && options.coachNames || []), ...(scope && scope.coachKeys || []), ...(scope && scope.coaches || [])].map(streamNormalize).filter(Boolean));
    const personKeys = new Set([...(options && options.personNames || []), ...(scope && scope.representatives || [])].map(streamNormalize).filter(Boolean));
    if (scope && scope.mode === 'team') coachKeys.add(streamNormalize(scope.team || scope.label));
    if (scope && scope.mode === 'department') coachKeys.add(streamNormalize(scope.department || scope.label));
    if (scope && scope.mode === 'coordinator') coachKeys.add(streamNormalize(scope.coordinator || scope.label));
    const identity = root.CoachToolsIdentity;
    if (scope && identity) {
      try {
        let scopedCoaches = [];
        if (scope.mode === 'team' && scope.team && typeof identity.getCoachesByTeam === 'function') scopedCoaches = await identity.getCoachesByTeam(scope.team);
        else if (scope.mode === 'department' && scope.department && typeof identity.getCoachesByDepartment === 'function') scopedCoaches = await identity.getCoachesByDepartment(scope.department);
        else if (scope.mode === 'coordinator' && scope.coordinator && typeof identity.getCoaches === 'function') scopedCoaches = (await identity.getCoaches()).filter(person => streamNormalize(person.coordinator) === streamNormalize(scope.coordinator));
        for (const person of scopedCoaches) {
          if (!coachIds.includes(person.personId)) coachIds.push(person.personId);
          for (const key of personLookupNames(person)) coachKeys.add(key);
        }
      } catch (_) {}
    }
    const ids = Array.from(new Set([...coachIds, ...personIds]));
    let people = [];
    if (ids.length && identity) {
      try {
        people = typeof identity.getPeopleByIds === 'function'
          ? await identity.getPeopleByIds(ids)
          : (await Promise.all(ids.map(id => identity.getPerson && identity.getPerson(id)))).filter(Boolean);
      } catch (_) { people = []; }
    }
    const coachIdSet = new Set(coachIds);
    const personIdSet = new Set(personIds);
    for (const person of people) {
      const target = coachIdSet.has(person.personId) ? coachKeys : personIdSet.has(person.personId) ? personKeys : null;
      if (target) for (const key of personLookupNames(person)) target.add(key);
    }
    const narrowScope = Boolean(scope && scope.mode && scope.mode !== 'all');
    return {
      datasetType,
      coachKeys,
      personKeys,
      active: narrowScope || coachIds.length > 0 || personIds.length > 0 || coachKeys.size > 0 || personKeys.size > 0 || typeof (options && options.rowFilter) === 'function',
      requireCoach: coachIds.length > 0 || coachKeys.size > 0 || Boolean(narrowScope && scope.mode !== 'representative'),
      requirePerson: personIds.length > 0 || personKeys.size > 0 || Boolean(narrowScope && scope.mode === 'representative'),
      rowFilter: options && typeof options.rowFilter === 'function' ? options.rowFilter : null
    };
  }
  function streamHeaderContext(rows, rowStart, datasetType) {
    const ownership = new Set((STREAM_OWNERSHIP_HEADERS[datasetType] || []).map(streamNormalize));
    const people = new Set(STREAM_PERSON_HEADERS.map(streamNormalize));
    let best = null;
    for (let offset = 0; offset < Math.min(60, rows.length); offset += 1) {
      const row = Array.isArray(rows[offset]) ? rows[offset] : [];
      const normalized = row.map(streamNormalize);
      const coachColumns = [], personColumns = [];
      normalized.forEach((header, index) => {
        if (ownership.has(header)) coachColumns.push(index);
        if (people.has(header)) personColumns.push(index);
      });
      const score = coachColumns.length * 2 + personColumns.length;
      if (!best || score > best.score) best = { score, headerRow: rowStart + offset, header: row, coachColumns, personColumns };
    }
    return best && best.score ? best : { score: 0, headerRow: rowStart - 1, header: [], coachColumns: [], personColumns: [] };
  }
  function filterStreamChunk(chunk, context, sheetContexts, options) {
    const rows = Array.isArray(chunk && chunk.rows) ? chunk.rows : [];
    let header = sheetContexts.get(chunk.sheetName);
    if (!header || Number(chunk.rowStart) === 0) {
      header = streamHeaderContext(rows, Number(chunk.rowStart) || 0, context.datasetType);
      sheetContexts.set(chunk.sheetName, header);
    }
    if (!context.active) return { ...chunk, rows, header: header.header, headerRow: header.headerRow, sourceRowCount: rows.length, matchedRowCount: rows.length };
    const selected = [];
    let sourceRowCount = 0, matchedRowCount = 0;
    const sheetMatchesCoach = context.coachKeys.has(streamNormalize(chunk.sheetName));
    for (let offset = 0; offset < rows.length; offset += 1) {
      const row = rows[offset];
      const absoluteRow = (Number(chunk.rowStart) || 0) + offset;
      if (absoluteRow <= header.headerRow) {
        if (!options || options.includeHeaders !== false) selected.push(row);
        continue;
      }
      if (!Array.isArray(row) || !row.some(value => String(value == null ? '' : value).trim())) continue;
      sourceRowCount += 1;
      const coachMatch = !context.requireCoach || sheetMatchesCoach || header.coachColumns.some(index => context.coachKeys.has(streamNormalize(row[index])));
      const personMatch = !context.requirePerson || header.personColumns.some(index => context.personKeys.has(streamNormalize(row[index])));
      const customMatch = !context.rowFilter || context.rowFilter(row, { datasetType: context.datasetType, sheetName: chunk.sheetName, header: header.header, headerRow: header.headerRow, absoluteRow });
      if (coachMatch && personMatch && customMatch) { selected.push(row); matchedRowCount += 1; }
    }
    return { ...chunk, rows: selected, header: header.header, headerRow: header.headerRow, sourceRowCount, matchedRowCount };
  }
  async function* streamRows(type, options) {
    await readyPromise;
    const datasetType = canonicalType(type);
    if (!datasetType) throw new Error('Unknown CoachTools dataset: ' + type);
    const signal = options && options.signal;
    const throwIfAborted = () => {
      if (!signal || !signal.aborted) return;
      const error = signal.reason instanceof Error ? signal.reason : new Error('Dataset streaming was cancelled.');
      error.name = error.name || 'AbortError';
      throw error;
    };
    const diagnostics = root.CoachToolsDiagnostics;
    if (diagnostics) diagnostics.start(`${datasetType} IndexedDB stream`);
    let db = null;
    try {
      throwIfAborted();
      let record = null;
      if (databaseUnavailable) {
        record = await getCurrent(datasetType, { includeRecord: true });
      } else {
        const pointer = options && options.datasetId
          ? { datasetId: options.datasetId }
          : currentPointers.get(datasetType);
        if (!pointer || !pointer.datasetId) return;
        db = await openDatabase();
        record = await idbRequest(db.transaction(DATASET_STORE, 'readonly').objectStore(DATASET_STORE).get(pointer.datasetId));
      }
      if (!record) return;
      const context = await streamFilterContext(datasetType, options || {});
      const sheetContexts = new Map();
      const metadata = compactMetadata(record);
      const emitChunk = chunk => filterStreamChunk({ ...chunk, datasetType, datasetId: record.id, metadata }, context, sheetContexts, options);
      if (record.chunked) {
        for (let index = 0; index < Number(record.chunkCount || 0); index += 1) {
          throwIfAborted();
          const chunkId = `${record.id}:${String(index).padStart(6, '0')}`;
          const chunk = await idbRequest(db.transaction(DATASET_CHUNK_STORE, 'readonly').objectStore(DATASET_CHUNK_STORE).get(chunkId));
          if (!chunk) throw new Error(`Dataset ${datasetType} is incomplete (missing chunk ${index + 1} of ${record.chunkCount}).`);
          const filtered = emitChunk(chunk);
          if (filtered.rows.length || options && options.includeEmpty) yield filtered;
        }
      } else {
        const sheets = record.data && record.data.workbook && record.data.workbook.data || {};
        const order = record.data && record.data.workbook && record.data.workbook.sheets || Object.keys(sheets);
        let index = 0;
        for (const sheetName of order) {
          const rows = Array.isArray(sheets[sheetName] && sheets[sheetName].aoa) ? sheets[sheetName].aoa : [];
          for (let rowStart = 0; rowStart < rows.length; rowStart += CHUNK_ROWS) {
            throwIfAborted();
            const filtered = emitChunk({ id: `${record.id}:memory:${index++}`, index: index - 1, sheetName, rowStart, rows: rows.slice(rowStart, rowStart + CHUNK_ROWS) });
            if (filtered.rows.length || options && options.includeEmpty) yield filtered;
          }
        }
      }
    } finally {
      if (db) db.close();
      if (diagnostics) diagnostics.end(`${datasetType} IndexedDB stream`);
    }
  }
  async function getHistory(type, options) {
    await readyPromise;
    const datasetType = canonicalType(type);
    if (!datasetType || databaseUnavailable) return [];
    const limit = options && options.limit != null ? Math.max(0, Number(options.limit) || 0) : Infinity;
    const db = await openDatabase();
    try {
      const tx = db.transaction(DATASET_STORE, 'readonly');
      const records = await readCursor(tx, tx.objectStore(DATASET_STORE).index('datasetTypePeriodSortImportedAt'), {
        range: prefixRange([datasetType], 2),
        direction: 'prev',
        limit,
        predicate: record => record.datasetType === datasetType && (!(options && options.activeOnly) || !record.supersededBy)
      });
      if (options && options.storageRecords) return records;
      if (options && options.metadataOnly) return records.map(compactMetadata);
      const materialized = [];
      for (const record of records) {
        materialized.push(await materializeDatasetRecord(db, record));
        if (record.chunked) await new Promise(resolve => root.setTimeout(resolve, 0));
      }
      return materialized;
    } finally { db.close(); }
  }
  async function getImportHistory(options) {
    await readyPromise;
    if (databaseUnavailable) return [];
    const type = options && options.datasetType ? canonicalType(options.datasetType) : null;
    const limit = Math.max(1, Number(options && options.limit) || 100);
    const db = await openDatabase();
    try {
      const tx = db.transaction(IMPORT_STORE, 'readonly');
      const store = tx.objectStore(IMPORT_STORE);
      return readCursor(tx, type ? store.index('datasetTypeImportedAt') : store.index('importedAt'), {
        range: type ? prefixRange([type], 1) : null,
        direction: 'prev',
        limit,
        predicate: record => !type || record.datasetType === type
      });
    } finally { db.close(); }
  }
  function getDatasetVersion(type) {
    const pointer = currentPointers.get(canonicalType(type));
    return pointer ? { datasetId: pointer.datasetId, version: pointer.version, fingerprint: pointer.fingerprint, scopedFingerprint: pointer.scopedFingerprint || pointer.fingerprint, scopeHash: pointer.scopeHash || '', scopeMode: pointer.scopeMode || 'legacy-unscoped', scopedRowCount: Number(pointer.scopedRowCount) || 0, importedAt: pointer.importedAt } : null;
  }
  async function removeDataset(type, datasetId) {
    await readyPromise;
    const datasetType = canonicalType(type);
    if (!datasetType || databaseUnavailable) return false;
    const history = await getHistory(datasetType, { includeSuperseded: true, storageRecords: true });
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
      const tx = db.transaction([DATASET_STORE, DATASET_CHUNK_STORE, CURRENT_STORE, IMPORT_STORE], 'readwrite');
      for (const target of targets) {
        tx.objectStore(DATASET_STORE).delete(target.id);
        for (let index = 0; index < Number(target.chunkCount || 0); index += 1) tx.objectStore(DATASET_CHUNK_STORE).delete(`${target.id}:${String(index).padStart(6, '0')}`);
      }
      for (const survivor of restored) tx.objectStore(DATASET_STORE).put(survivor);
      if (remaining[0]) tx.objectStore(CURRENT_STORE).put({ ...compactMetadata(remaining[0]), datasetId: remaining[0].id, updatedAt: new Date().toISOString() });
      else tx.objectStore(CURRENT_STORE).delete(datasetType);
      tx.objectStore(IMPORT_STORE).put({ id: `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, datasetType, datasetId: datasetId || '*', action: 'removed', importedAt: new Date().toISOString() });
      await transactionDone(tx);
      currentData.delete(datasetType);
      if (remaining[0]) currentPointers.set(datasetType, { ...compactMetadata(remaining[0]), datasetId: remaining[0].id, updatedAt: new Date().toISOString() });
      else {
        currentPointers.delete(datasetType);
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
        datasetId: pointer && pointer.datasetId || '',
        scopeSnapshot: pointer && pointer.scopeSnapshot ? clone(pointer.scopeSnapshot) : null,
        scopeHash: pointer && pointer.scopeHash || '',
        scopeMode: pointer && pointer.scopeMode || 'legacy-unscoped',
        scopedRowCount: pointer && Number(pointer.scopedRowCount) || 0,
        scopeMatchDiagnostics: pointer && pointer.scopeMatchDiagnostics ? clone(pointer.scopeMatchDiagnostics) : null
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
    if (currentData.has(type) && !(options && options.raw)) return currentData.get(type).record.data;
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
  async function materializeLegacyCompatibility(types) {
    const requested = Array.isArray(types) && types.length ? types.map(canonicalType).filter(Boolean) : Object.keys(DATASET_TO_LEGACY);
    const written = [];
    for (const type of requested) {
      const legacy = DATASET_TO_LEGACY[type];
      if (!legacy) continue;
      const value = await getCurrent(type);
      if (value == null) continue;
      if (safeSet(DOCK_KEYS[legacy], encodeDockValue(value))) written.push(DOCK_KEYS[legacy]);
    }
    return written;
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
    const compatibilityValue = options && options.raw ? String(value) : encodeDockValue(value);
    currentData.set(type, {
      key: `pending:${Date.now()}`,
      record: { id: `pending:${type}`, datasetType: type, version: 0, data: clone(data) }
    });
    const metadata = { ...(options && options.metadata || {}), originalFileName: options && options.metadata && (options.metadata.originalFileName || options.metadata.fileName) || data && data.meta && data.meta.fileName || '' };
    readyPromise.then(ok => {
      if (!ok) {
        safeSet(DOCK_KEYS[legacy], compatibilityValue);
        return null;
      }
      return putDataset(type, data, metadata);
    }).catch(error => {
      safeSet(DOCK_KEYS[legacy], compatibilityValue);
      console.warn('[CoachToolsData] Compatibility write could not reach IndexedDB.', error);
    });
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
    return centralStatus().map(status => ({ ...status, datasetType: status.id, key: '' }));
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
  function getLastCleanScope() { return safeJson(safeGet(CLEAN_SCOPE_KEY), null); }
  function setLastCleanScope(scope) {
    const snapshot = scope && typeof scope === 'object' ? clone(scope) : null;
    if (!snapshot) return null;
    safeSet(CLEAN_SCOPE_KEY, JSON.stringify(snapshot));
    return snapshot;
  }
  async function resolveUpdateScope(datasetTypes) {
    await readyPromise;
    const requested = (Array.isArray(datasetTypes) && datasetTypes.length ? datasetTypes : DATASET_TYPES).map(canonicalType).filter(Boolean);
    const pointers = requested.map(type => currentPointers.get(type)).filter(Boolean);
    const unrecoverable = pointers.filter(pointer => pointer.scopeMode && !['all', 'legacy-unscoped'].includes(pointer.scopeMode) && (!pointer.scopeSnapshot || !pointer.scopeHash));
    if (unrecoverable.length) {
      return { needsReview: true, scope: null, source: 'active-dataset', reason: 'Update needs review — the current dataset is scoped, but its original scope could not be safely restored.' };
    }
    const attached = pointers.filter(pointer => pointer.scopeSnapshot && pointer.scopeHash);
    const hashes = Array.from(new Set(attached.map(pointer => pointer.scopeHash)));
    if (hashes.length > 1) {
      return { needsReview: true, scope: null, source: 'active-dataset', reason: 'Update needs review — active datasets were created from different scopes. Run a Clean Upload to establish one authoritative scope.' };
    }
    if (attached.length && hashes.length === 1) return { needsReview: false, scope: clone(attached[0].scopeSnapshot), scopeHash: hashes[0], source: 'active-dataset' };
    const clean = getLastCleanScope();
    if (clean && clean.scopeHash) return { needsReview: false, scope: clone(clean), scopeHash: clean.scopeHash, source: 'last-clean-update' };
    const globalScope = getScope();
    if (globalScope) return { needsReview: false, scope: clone(globalScope), scopeHash: globalScope.scopeHash || '', source: 'global-scope' };
    // Legacy installations began with full, unscoped data. Preserve that safe and
    // documented default only when there is no evidence of a narrower scope.
    const legacyAll = { mode: 'all', label: 'All people' };
    return { needsReview: false, scope: legacyAll, scopeHash: '', source: 'legacy-default-all' };
  }
  async function createBackup(options) {
    const maxBytes = Number(options && options.maxBytes) || 60 * 1024 * 1024;
    const backup = { packageType: 'coachtools-backup', schemaVersion: 3, exportedAt: new Date().toISOString(), datasets: {}, scope: getScope(), preferences: {}, skipped: [], notes: ['IndexedDB is authoritative. Current shared datasets are exported directly without creating localStorage docks; dated history remains in IndexedDB.'] };
    let includedBytes = 0;
    for (const type of DATASET_TYPES) {
      const record = await getCurrent(type, { includeRecord: true });
      if (!record) continue;
      const value = { metadata: compactMetadata(record), data: record.data };
      const bytes = JSON.stringify(value).length * 2;
      if (includedBytes + bytes > maxBytes) { backup.skipped.push({ datasetType: type, reason: 'backup size limit', bytes }); continue; }
      backup.datasets[type] = value; includedBytes += bytes;
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
  async function restoreBackup(backup) {
    if (!backup || backup.packageType !== 'coachtools-backup' || ![1, 2, 3].includes(Number(backup.schemaVersion))) throw new Error('This is not a supported CoachTools backup.');
    const docks = backup.compatibilityDocks || backup.sharedDocks || {};
    const writes = [];
    for (const [key, value] of Object.entries(backup.preferences || {})) if (LIGHTWEIGHT_KEYS.includes(key) && typeof value === 'string') writes.push([key, value]);
    if (backup.scope) writes.push([SCOPE_KEY, JSON.stringify(backup.scope)]);
    for (const [key, value] of writes) root.localStorage.setItem(key, value);
    for (const [type, entry] of Object.entries(backup.datasets || {})) {
      if (!DATASET_TYPES.includes(type) || !entry || !entry.data) continue;
      const metadata = entry.metadata || {};
      await putDataset(type, entry.data, { ...metadata, importedAt: new Date().toISOString(), classificationMethod: 'coachtools-backup-restore' });
    }
    for (const [source, value] of Object.entries(docks)) {
      const type = LEGACY_TO_DATASET[source];
      if (!type || typeof value !== 'string') continue;
      await ensureLegacyDecoder(value);
      const decoded = decodeDockValue(value);
      if (decoded && typeof decoded === 'object') await putDataset(type, decoded, { importedAt: new Date().toISOString(), classificationMethod: 'legacy-backup-restore', originalFileName: decoded.meta && decoded.meta.fileName || `${LABELS[type]} backup` });
    }
    notifyDataUpdated('all', { reason: 'backup-restored' });
    return { restoredKeys: writes.map(([key]) => key), restoredDatasets: Array.from(new Set([...Object.keys(backup.datasets || {}), ...Object.keys(docks).map(source => LEGACY_TO_DATASET[source]).filter(Boolean)])) };
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

  function queueIdentityIngestion(datasetType, result, data, metadata) {
    if (!result || result.status === 'duplicate') return;
    const run = () => {
      const identity = root.CoachToolsIdentity;
      if (!identity) return;
      const descriptor = {
        datasetId: result.dataset && (result.dataset.datasetId || result.dataset.id) || '',
        fingerprint: result.dataset && result.dataset.fingerprint || metadata && metadata.fingerprint || ''
      };
      if (typeof identity.queueDatasetIngestion === 'function') {
        identity.queueDatasetIngestion(datasetType, descriptor);
        return;
      }
      if (typeof identity.ingestDataset === 'function') {
        identity.ingestDataset(datasetType, data, { ...(metadata || {}), ...descriptor }).catch(error => console.warn('[CoachToolsData] Background identity learning could not finish.', error));
      }
    };
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(run, { timeout: 1200 });
    else root.setTimeout(run, 0);
  }

  const CoachToolsData = Object.freeze({
    VERSION, DB_NAME, DB_VERSION, DATASET_TYPES, LABELS, EVENT_NAME,
    storageContract: Object.freeze({ dbName: DB_NAME, dbVersion: DB_VERSION, stores: Object.freeze([...ALLSTAR_STORES, DATASET_STORE, DATASET_CHUNK_STORE, CURRENT_STORE, IMPORT_STORE, PEOPLE_STORE, IDENTITY_REVIEW_STORE]) }),
    storageFormat: Object.freeze({ CHUNK_ROWS, CHUNK_THRESHOLD_BYTES, CHUNK_THRESHOLD_ROWS, createDataSkeleton, splitDataIntoChunks, assembleDataFromChunks }),
    ready: () => readyPromise,
    importDataset: async (type, data, metadata) => { await readyPromise; if (databaseUnavailable) throw new Error('IndexedDB is unavailable.'); const datasetType = canonicalType(type); const result = await putDataset(datasetType, data, metadata); queueIdentityIngestion(datasetType, result, data, metadata); return result; },
    replaceDataset: async (type, data, metadata) => { await readyPromise; const datasetType = canonicalType(type); const result = await putDataset(datasetType, data, { ...(metadata || {}), replace: true }); queueIdentityIngestion(datasetType, result, data, metadata); return result; },
    getCurrent, streamRows, getHistory, getDatasetVersion, getImportHistory, inspectDataset, removeDataset, resolveUpdateScope,
    getStatus: async () => { await readyPromise; return centralStatus(); },
    getStatusSync: centralStatus,
    mountStatus, subscribe: listener => subscribe(listener), subscribeScope: listener => subscribe(listener, { scope: true }),
    notifyDataUpdated
  });
  const CoachToolsStorage = Object.freeze({
    VERSION, EVENT_NAME, SCOPE_EVENT_NAME, SCOPE_KEY, CLEAN_SCOPE_KEY, DATA_META_KEY, LEGACY_DATA_META_KEY, DOCK_KEYS, LABELS,
    storageAvailable, decodeDockValue, ready: () => readyPromise,
    get, getRaw: source => get(source, { raw: true }), getByCompatibilityKey, listCompatibilityKeys, materializeLegacyCompatibility,
    getRetail: () => get('retail'), getReferral: () => get('referral'), getQA: () => get('qa'), getCoaching: () => get('coaching'), getChecklist: () => get('checklist'),
    has, hasRetail: () => has('retail'), hasReferral: () => has('referral'), hasQA: () => has('qa'), hasCoaching: () => has('coaching'), hasChecklist: () => has('checklist'),
    set, remove, markUpdated, notifyDataUpdated, getDataMetadata, getDatasetStatus, getCentralDatasetStatus: centralStatus,
    getApproximateStorageSize, getScope, setScope, getLastCleanScope, setLastCleanScope, resolveUpdateScope, subscribe: listener => subscribe(listener), subscribeScope: listener => subscribe(listener, { scope: true }), createBackup, restoreBackup
  });
  root.CoachToolsData = CoachToolsData;
  root.CoachToolsStorage = CoachToolsStorage;
  root.CoachToolsDataStatus = Object.freeze({ mount: mountStatus, installStyles: installStatusStyles });
})(window);
