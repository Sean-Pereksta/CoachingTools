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

  function installPeopleProfilesKpiPatch() {
    const appId = (() => {
      try { return text(root.document && root.document.querySelector('meta[name="coachtools-id"]') && root.document.querySelector('meta[name="coachtools-id"]').content).trim().toLowerCase(); }
      catch (_) { return ''; }
    })();
    if (appId !== 'people-profiles') return;

    const patchedRecords = typeof WeakSet === 'function' ? new WeakSet() : null;
    const normHeader = value => text(value).trim().toLowerCase().replace(/[^a-z0-9%]/g, '');
    const repHeaders = new Set(['representative','representativename','associatename','agentname','agent','employee','csr','csrname','ssr','ssrname','rep','repname']);
    const repFallbackHeaders = new Set(['name','associate']);
    const teamHeaders = new Set(['sheet','team','coach','jobcoach','coachassigned']);
    const dateHeaders = new Set(['date','week','day']);
    const kpiSignals = ['consumerappointments','consumeropportunities','wipercount','wiperjobs','wipersaccept','wipersaccepted','wipersasked'];

    function hasAny(keys, set) { return keys.some(key => set.has(key)); }
    function looksLikeWeeklyObject(row) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
      const keys = Object.keys(row).map(normHeader);
      return (hasAny(keys, teamHeaders) && (hasAny(keys, dateHeaders) || kpiSignals.some(signal => keys.includes(signal)))) || kpiSignals.some(signal => keys.includes(signal));
    }
    function aliasWeeklyObject(row) {
      if (!looksLikeWeeklyObject(row)) return;
      const entries = Object.keys(row).map(key => ({ key, norm: normHeader(key) }));
      if (entries.some(entry => repHeaders.has(entry.norm))) return;
      const fallback = entries.find(entry => repFallbackHeaders.has(entry.norm));
      if (fallback && text(row[fallback.key]).trim()) row.Representative = row[fallback.key];
    }
    function normalizeAoa(aoa) {
      if (!Array.isArray(aoa) || !aoa.length || !Array.isArray(aoa[0])) return;
      for (let index = 0; index < Math.min(60, aoa.length); index += 1) {
        const header = Array.isArray(aoa[index]) ? aoa[index] : [];
        const keys = header.map(normHeader);
        if (hasAny(keys, repHeaders)) return;
        const fallbackIndex = keys.findIndex(key => repFallbackHeaders.has(key));
        if (fallbackIndex < 0) continue;
        const weeklySignals = hasAny(keys, teamHeaders) && (hasAny(keys, dateHeaders) || kpiSignals.some(signal => keys.includes(signal)));
        if (!weeklySignals) continue;
        header[fallbackIndex] = 'Representative';
        return;
      }
    }
    function walkWeekly(node) {
      if (!node) return;
      if (Array.isArray(node)) {
        if (node.length && Array.isArray(node[0])) normalizeAoa(node);
        else for (const item of node) { if (item && typeof item === 'object') aliasWeeklyObject(item); }
        for (const item of node) if (item && typeof item === 'object') walkWeekly(item);
        return;
      }
      if (typeof node !== 'object') return;
      aliasWeeklyObject(node);
      for (const value of Object.values(node)) if (value && typeof value === 'object') walkWeekly(value);
    }
    function normalizeWeeklyRecord(record) {
      if (!record || typeof record !== 'object') return record;
      if (patchedRecords && patchedRecords.has(record)) return record;
      walkWeekly(record.data);
      if (patchedRecords) patchedRecords.add(record);
      return record;
    }
    function normalizeRecords(records) {
      if (!records || typeof records !== 'object') return records;
      normalizeWeeklyRecord(records.weeklyRetail);
      normalizeWeeklyRecord(records.weeklyReferral);
      return records;
    }
    function aggregateEntryValue(entry) {
      if (!entry) return NaN;
      if (Number.isFinite(entry.weightSum) && entry.weightSum > 0) return entry.weightedSum / entry.weightSum;
      if (Number.isFinite(entry.count) && entry.count > 0) return entry.sum / entry.count;
      return NaN;
    }
    function aggregateEntryWeight(entry) {
      if (!entry) return 0;
      if (Number.isFinite(entry.weightSum) && entry.weightSum > 0) return entry.weightSum;
      if (Number.isFinite(entry.count) && entry.count > 0) return entry.count;
      return 0;
    }
    function globalRepresentativeValues(prepared, historyIndex, metricId) {
      const values = new Map();
      for (const person of prepared && prepared.people || []) {
        if (!person || person.role !== 'representative') continue;
        const value = aggregateEntryValue(historyIndex && historyIndex.aggregate && historyIndex.aggregate.get(`${person.personId}|${metricId}`));
        if (Number.isFinite(value)) values.set(person.personId, value);
      }
      return values;
    }
    function globalCoachValues(prepared, historyIndex, metricId) {
      const values = new Map();
      for (const coach of prepared && prepared.people || []) {
        if (!coach || coach.role !== 'coach') continue;
        let weightedSum = 0, weightSum = 0, plainSum = 0, plainCount = 0;
        for (const rep of prepared.repsByCoach && prepared.repsByCoach.get(coach.personId) || []) {
          const entry = historyIndex && historyIndex.aggregate && historyIndex.aggregate.get(`${rep.personId}|${metricId}`);
          const value = aggregateEntryValue(entry), weight = aggregateEntryWeight(entry);
          if (!Number.isFinite(value)) continue;
          if (weight > 0) { weightedSum += value * weight; weightSum += weight; }
          else { plainSum += value; plainCount += 1; }
        }
        const value = weightSum > 0 ? weightedSum / weightSum : plainCount ? plainSum / plainCount : NaN;
        if (Number.isFinite(value)) values.set(coach.personId, value);
      }
      return values;
    }
    function globalRank(values, personId) {
      const ordered = Array.from(values.entries()).sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])));
      const index = ordered.findIndex(([id]) => id === personId);
      if (index < 0) return { rank: null, total: ordered.length, percentile: null, score: null };
      const rank = index + 1, percentile = ordered.length <= 1 ? 100 : Math.round((ordered.length - rank) / (ordered.length - 1) * 100);
      return { rank, total: ordered.length, percentile, score: Math.round((1 + 9 * percentile / 100) * 10) / 10 };
    }
    function globalizeRankings(result, personId, prepared, historyIndex) {
      if (!result || !prepared || !historyIndex) return result;
      const targetIds = new Set(['cash-appointment-rate','wiper-rate']);
      const rankings = Array.isArray(result.rankings) ? result.rankings.map(row => ({ ...row })) : [];
      for (const metricId of targetIds) {
        const values = result.mode === 'coach' ? globalCoachValues(prepared, historyIndex, metricId) : globalRepresentativeValues(prepared, historyIndex, metricId);
        const own = values.get(personId);
        if (!Number.isFinite(own)) continue;
        const rank = globalRank(values, personId);
        let row = rankings.find(item => item.id === metricId);
        if (!row) {
          row = { id: metricId, name: metricId === 'cash-appointment-rate' ? 'Cash Appointment Rate' : 'Wiper Rate', category: metricId === 'cash-appointment-rate' ? 'Appointments' : 'Sales Behaviors', displayValue: `${(own * 100).toFixed(1)}%` };
          rankings.push(row);
        }
        Object.assign(row, rank, {
          value: own,
          displayValue: `${(own * 100).toFixed(1)}%`,
          performancePercentile: rank.percentile,
          source: metricId === 'wiper-rate'
            ? `Last ${result.weeks || 8} weekly periods · all CoachTools peers · Retail Count/Jobs, Referral Accepted/Asked`
            : `Last ${result.weeks || 8} weekly periods · all CoachTools peers`
        });
      }
      return { ...result, rankings };
    }
    function wrapProfileFast(api) {
      if (!api || api.__coachtoolsGlobalKpiPatch) return api;
      const wrapped = {
        ...api,
        VERSION: `${api.VERSION || '1.0'}+global-kpi.1`,
        __coachtoolsGlobalKpiPatch: true,
        prepareWeeklyAsync(people, records, options) {
          return api.prepareWeeklyAsync(people, normalizeRecords(records), options);
        },
        addHistoryRecord(index, type, record) {
          return api.addHistoryRecord(index, type, /^weekly(?:Retail|Referral)$/.test(type) ? normalizeWeeklyRecord(record) : record);
        },
        buildWindowRankings(personId, prepared, historyIndex, weeks) {
          return globalizeRankings(api.buildWindowRankings(personId, prepared, historyIndex, weeks), personId, prepared, historyIndex);
        }
      };
      return Object.freeze(wrapped);
    }

    const existing = root.CoachToolsProfileFast;
    if (existing) {
      root.CoachToolsProfileFast = wrapProfileFast(existing);
      return;
    }
    try {
      Object.defineProperty(root, 'CoachToolsProfileFast', {
        configurable: true,
        enumerable: true,
        get() { return undefined; },
        set(value) {
          const wrapped = wrapProfileFast(value);
          Object.defineProperty(root, 'CoachToolsProfileFast', { configurable: true, enumerable: true, writable: true, value: wrapped });
        }
      });
    } catch (_) {}
  }

  resetAllStarSyncGuardIfNeeded();
  if (root.addEventListener) {
    root.addEventListener('coachtools:data-updated', event => {
      const detail = event && event.detail || {};
      invalidateAllStarSyncMarker(detail.source || 'all');
    });
  }
  scheduleAllStarSlotRepair();
  installPeopleProfilesKpiPatch();

  root.CoachToolsSync = Object.freeze({
    VERSION: '1.2.0',
    compareCandidate,
    periodSort,
    allStarCentralDatasets: ALLSTAR_CENTRAL_DATASETS,
    allStarSlotHasData,
    repairAllStarSyncMarkers,
    invalidateAllStarSyncMarker
  });
})(typeof window !== 'undefined' ? window : globalThis);