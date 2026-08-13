(function attachCoachToolsSync(root) {
  'use strict';

  const ALLSTAR_SYNC_KEY = 'allStarCoachToolsSync.v1';
  const ALLSTAR_SYNC_GUARD_KEY = 'allStarCoachToolsSyncGuard.v1';
  const ALLSTAR_SYNC_GUARD_VERSION = '2';
  const ALLSTAR_CENTRAL_DATASETS = Object.freeze([
    'monthlyRetail',
    'monthlyReferral',
    'qa',
    'documentedCoaching',
    'checklist',
    'compCoaching'
  ]);
  const ALLSTAR_CENTRAL_DATASET_SET = new Set(ALLSTAR_CENTRAL_DATASETS);

  function text(value) { return String(value == null ? '' : value); }

  function periodSort(value) {
    const raw = text(value).trim();
    if (!raw) return '';
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
  }

  function compareCandidate(candidate, current, history) {
    const next = candidate || {};
    const existing = Array.isArray(history) ? history : [];
    const fingerprint = text(next.fingerprint);
    const periodKey = text(next.periodKey);
    const nextSort = periodSort(next.periodSort || next.sortKey || periodKey || next.importedAt);

    if (!next.datasetType || !fingerprint) {
      return { status: 'needs-review', reason: 'Dataset type or fingerprint is missing.', becomesCurrent: false };
    }

    const duplicate = existing.find(record => text(record.fingerprint) === fingerprint);
    if (duplicate) {
      return { status: 'current', reason: 'Identical fingerprint already imported.', becomesCurrent: false, matchingDatasetId: duplicate.id || duplicate.datasetId || '' };
    }

    if (!current) return { status: 'new', reason: 'No current dataset exists.', becomesCurrent: true };

    const currentKey = text(current.periodKey);
    const currentSort = periodSort(current.periodSort || current.sortKey || currentKey || current.importedAt);
    if (periodKey && currentKey && periodKey === currentKey) {
      return { status: 'updated', reason: 'The reporting period matches but the contents changed.', becomesCurrent: true, replacesDatasetId: current.datasetId || current.id || '' };
    }
    if (nextSort && currentSort && nextSort > currentSort) {
      return { status: 'new', reason: 'A newer reporting period was detected.', becomesCurrent: true };
    }
    if (nextSort && currentSort && nextSort < currentSort) {
      return { status: 'older', reason: 'An older reporting period was detected.', becomesCurrent: false };
    }
    return { status: 'needs-review', reason: 'The reporting period could not be compared safely.', becomesCurrent: false };
  }

  function isAllStarPage() {
    try {
      const meta = root.document && root.document.querySelector('meta[name="coachtools-id"]');
      if (text(meta && meta.content).toLowerCase() === 'allstar') return true;
      return /\/apps\/allstar\/(?:allstar\.html)?$/i.test(text(root.location && root.location.pathname));
    } catch (_) { return false; }
  }

  function readAllStarSyncMarkers() {
    try {
      const parsed = JSON.parse(root.localStorage.getItem(ALLSTAR_SYNC_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }

  function writeAllStarSyncMarkers(markers) {
    try {
      const keys = Object.keys(markers || {});
      if (keys.length) root.localStorage.setItem(ALLSTAR_SYNC_KEY, JSON.stringify(markers));
      else root.localStorage.removeItem(ALLSTAR_SYNC_KEY);
      return true;
    } catch (_) { return false; }
  }

  function invalidateAllStarSyncMarker(source) {
    if (!isAllStarPage()) return false;
    const datasetType = text(source || 'all').trim() || 'all';
    if (datasetType !== 'all' && !ALLSTAR_CENTRAL_DATASET_SET.has(datasetType)) return false;
    if (datasetType === 'all') {
      try { root.localStorage.removeItem(ALLSTAR_SYNC_KEY); return true; } catch (_) { return false; }
    }
    const markers = readAllStarSyncMarkers();
    if (!Object.prototype.hasOwnProperty.call(markers, datasetType)) return false;
    delete markers[datasetType];
    return writeAllStarSyncMarkers(markers);
  }

  function allStarSlotHasData(datasetType, appState) {
    const data = appState && appState.data || {};
    const books = appState && appState.books || {};
    const hasRows = value => Array.isArray(value) && value.length > 0;
    const hasBook = key => Array.isArray(books[key] && books[key].sheetNames) && books[key].sheetNames.length > 0;
    if (datasetType === 'monthlyRetail') return hasBook('retail') || hasRows(data.retail && data.retail.sv2Aoa) || hasRows(data.retail && data.retail.wiperAoa) || hasRows(data.retail && data.retail.sv2) || hasRows(data.retail && data.retail.wiper);
    if (datasetType === 'monthlyReferral') return hasBook('referral') || hasRows(data.referral && data.referral.sv2Aoa) || hasRows(data.referral && data.referral.wiperAoa) || hasRows(data.referral && data.referral.itacAoa) || hasRows(data.referral && data.referral.sv2) || hasRows(data.referral && data.referral.wiper) || hasRows(data.referral && data.referral.itac);
    if (datasetType === 'qa') return hasBook('qa') || hasRows(data.qa && data.qa.aoa) || hasRows(data.qa && data.qa.rows);
    if (datasetType === 'documentedCoaching') return hasBook('documented_coaching') || hasRows(data.documented_coaching && data.documented_coaching.aoa) || hasRows(data.documented_coaching && data.documented_coaching.rows);
    if (datasetType === 'checklist') return hasBook('checklist') || hasRows(data.checklist && data.checklist.aoa) || hasRows(data.checklist && data.checklist.rows);
    if (datasetType === 'compCoaching') return hasBook('comp_calls') || hasRows(data.comp_calls && data.comp_calls.aoa) || hasRows(data.comp_calls && data.comp_calls.rows);
    return false;
  }

  function repairAllStarSyncMarkers(appState) {
    if (!isAllStarPage() || !appState) return [];
    const markers = readAllStarSyncMarkers();
    const missing = [];
    for (const datasetType of ALLSTAR_CENTRAL_DATASETS) {
      if (!markers[datasetType] || allStarSlotHasData(datasetType, appState)) continue;
      delete markers[datasetType];
      missing.push(datasetType);
    }
    if (missing.length) writeAllStarSyncMarkers(markers);
    return missing;
  }

  function resetAllStarSyncGuardIfNeeded() {
    if (!isAllStarPage()) return false;
    try {
      if (root.localStorage.getItem(ALLSTAR_SYNC_GUARD_KEY) === ALLSTAR_SYNC_GUARD_VERSION) return false;
      root.localStorage.removeItem(ALLSTAR_SYNC_KEY);
      root.localStorage.setItem(ALLSTAR_SYNC_GUARD_KEY, ALLSTAR_SYNC_GUARD_VERSION);
      return true;
    } catch (_) { return false; }
  }

  function dispatchAllStarRepair(datasetTypes) {
    for (const datasetType of datasetTypes || []) {
      try {
        root.dispatchEvent(new CustomEvent('coachtools:data-updated', { detail: { source: datasetType, reason: 'allstar-empty-slot-repair', localRepair: true } }));
      } catch (_) {}
    }
  }

  function scheduleAllStarSlotRepair() {
    if (!isAllStarPage() || !root.addEventListener) return;
    root.addEventListener('load', () => {
      root.setTimeout(async () => {
        try {
          if (typeof state === 'undefined') return;
          if (state.importCacheStartupPromise && typeof state.importCacheStartupPromise.then === 'function') await state.importCacheStartupPromise.catch(() => false);
          dispatchAllStarRepair(repairAllStarSyncMarkers(state));
        } catch (error) {
          try { console.warn('[CoachToolsSync] All-Star central slot repair skipped.', error); } catch (_) {}
        }
      }, 0);
    }, { once: true });
  }

  resetAllStarSyncGuardIfNeeded();
  if (root.addEventListener) {
    root.addEventListener('coachtools:data-updated', event => {
      const detail = event && event.detail || {};
      invalidateAllStarSyncMarker(detail.source || 'all');
    });
  }
  scheduleAllStarSlotRepair();

  root.CoachToolsSync = Object.freeze({
    VERSION: '1.1.0',
    compareCandidate,
    periodSort,
    allStarCentralDatasets: ALLSTAR_CENTRAL_DATASETS,
    allStarSlotHasData,
    repairAllStarSyncMarkers,
    invalidateAllStarSyncMarker
  });
})(typeof window !== 'undefined' ? window : globalThis);