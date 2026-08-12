(function attachCoachToolsAppData(root) {
  'use strict';

  try {
    if (root.parent && root.parent !== root && root.parent.CoachToolsAppData) {
      const owner = root.parent.CoachToolsAppData;
      const subscriptions = new Set();
      const track = unsubscribe => {
        if (typeof unsubscribe !== 'function') return () => {};
        subscriptions.add(unsubscribe);
        return () => { subscriptions.delete(unsubscribe); unsubscribe(); };
      };
      root.addEventListener('pagehide', () => {
        for (const unsubscribe of subscriptions) try { unsubscribe(); } catch (_) {}
        subscriptions.clear();
      }, { once: true });
      root.CoachToolsAppData = Object.freeze({
        VERSION: owner.VERSION,
        ready: (...args) => owner.ready(...args),
        get: (...args) => owner.get(...args),
        getMany: (...args) => owner.getMany(...args),
        peek: (...args) => owner.peek(...args),
        getVersion: (...args) => owner.getVersion(...args),
        subscribe: (...args) => track(owner.subscribe(...args)),
        getScope: (...args) => owner.getScope(...args),
        subscribeScope: (...args) => track(owner.subscribeScope(...args)),
        invalidate: (...args) => owner.invalidate(...args)
      });
      return;
    }
  } catch (_) {}

  const VERSION = '1.0.0';
  const cache = new Map();
  const pendingReads = new Map();
  const trackedVersions = new Map();
  const data = root.CoachToolsData;
  const storage = root.CoachToolsStorage;

  function canonical(type) {
    const raw = String(type || '').trim();
    if (!data) return raw;
    const direct = (data.DATASET_TYPES || []).find(id => id.toLowerCase() === raw.toLowerCase());
    return direct || ({ retail: 'weeklyRetail', referral: 'weeklyReferral', coaching: 'documentedCoaching' })[raw.toLowerCase()] || raw;
  }

  function versionKey(version) {
    return version ? `${version.datasetId || ''}:${Number(version.version) || 0}:${version.fingerprint || ''}` : '';
  }

  async function readRecord(datasetType) {
    if (pendingReads.has(datasetType)) return pendingReads.get(datasetType);
    const request = data.getCurrent(datasetType, { includeRecord: true })
      .finally(() => pendingReads.delete(datasetType));
    pendingReads.set(datasetType, request);
    return request;
  }

  async function ready() {
    if (!data) throw new Error('CoachToolsData is unavailable.');
    await data.ready();
    return true;
  }

  async function get(type, options) {
    await ready();
    const datasetType = canonical(type);
    let version = data.getDatasetVersion(datasetType);
    let key = versionKey(version);
    const cached = cache.get(datasetType);
    if (cached && cached.key === key && !(options && options.force)) {
      return options && options.includeRecord ? cached.record : cached.record && cached.record.data || null;
    }
    if (!version) {
      const migrated = await readRecord(datasetType);
      version = data.getDatasetVersion(datasetType);
      key = versionKey(version);
      if (!migrated) {
        cache.delete(datasetType);
        trackedVersions.delete(datasetType);
        return null;
      }
      if (!version) version = { datasetId: migrated.id || `legacy:${datasetType}`, version: migrated.version || 0, fingerprint: migrated.fingerprint || '' };
      key = versionKey(version);
      cache.set(datasetType, { key, record: migrated });
      trackedVersions.set(datasetType, key);
      return options && options.includeRecord ? migrated : migrated.data || null;
    }
    const record = await readRecord(datasetType);
    const currentVersion = data.getDatasetVersion(datasetType);
    const currentKey = versionKey(currentVersion);
    if (!record) {
      cache.delete(datasetType);
      trackedVersions.delete(datasetType);
      return null;
    }
    cache.set(datasetType, { key: currentKey, record });
    trackedVersions.set(datasetType, currentKey);
    return options && options.includeRecord ? record : record.data || null;
  }

  async function getMany(types, options) {
    const requested = Array.from(new Set((types || []).map(canonical).filter(Boolean)));
    const values = await Promise.all(requested.map(type => get(type, options)));
    return Object.fromEntries(requested.map((type, index) => [type, values[index]]));
  }

  function peek(type, options) {
    const cached = cache.get(canonical(type));
    if (!cached) return null;
    return options && options.includeRecord ? cached.record : cached.record && cached.record.data || null;
  }

  function getVersion(type) {
    return data && data.getDatasetVersion ? data.getDatasetVersion(canonical(type)) : null;
  }

  function subscribe(types, callback) {
    if (!data || typeof callback !== 'function') return () => {};
    const requested = new Set((Array.isArray(types) ? types : [types]).map(canonical).filter(Boolean));
    return data.subscribe(detail => {
      const source = canonical(detail && detail.source || 'all');
      const candidates = source === 'all' ? Array.from(requested) : requested.has(source) ? [source] : [];
      const changed = [];
      for (const type of candidates) {
        const next = versionKey(getVersion(type));
        const previous = trackedVersions.get(type) || cache.get(type) && cache.get(type).key || '';
        if (next === previous && detail && detail.reason !== 'removed') continue;
        cache.delete(type);
        trackedVersions.set(type, next);
        changed.push(type);
      }
      if (changed.length) callback({ ...(detail || {}), changedTypes: changed });
    });
  }

  root.CoachToolsAppData = Object.freeze({
    VERSION, ready, get, getMany, peek, getVersion, subscribe,
    getScope: () => storage && storage.getScope ? storage.getScope() : null,
    subscribeScope: callback => data && data.subscribeScope ? data.subscribeScope(callback) : () => {},
    invalidate(type) { if (type) cache.delete(canonical(type)); else cache.clear(); }
  });
})(window);
