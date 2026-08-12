(function attachCoachToolsAppData(root) {
  'use strict';

  const DATASET_LABELS = Object.freeze({
    weeklyRetail: 'Weekly Retail',
    weeklyReferral: 'Weekly Referral',
    monthlyRetail: 'Monthly Retail',
    monthlyReferral: 'Monthly Referral',
    qa: 'QA',
    documentedCoaching: 'Documented Coaching',
    checklist: 'Checklist',
    compCoaching: 'Comp Coaching'
  });

  function labelFor(type) {
    return DATASET_LABELS[type] || String(type || 'Data').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase());
  }

  function frameAppId() {
    try { return root.frameElement && root.frameElement.dataset && root.frameElement.dataset.appId || ''; }
    catch (_) { return ''; }
  }

  function mountFrameProgress(types) {
    if (!root.document || !root.document.body || root.parent === root) return null;
    const existing = root.document.getElementById('coachtools-progressive-data-status');
    if (existing) existing.remove();
    const panel = root.document.createElement('aside');
    panel.id = 'coachtools-progressive-data-status';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    Object.assign(panel.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '2147483000', width: 'min(290px, calc(100vw - 24px))',
      padding: '10px 11px', border: '1px solid rgba(114, 156, 190, .32)', borderRadius: '11px',
      background: 'rgba(9, 20, 34, .94)', boxShadow: '0 14px 40px rgba(0, 0, 0, .3)', color: '#eef8ff',
      font: '11px/1.35 Inter, ui-sans-serif, system-ui, sans-serif', backdropFilter: 'blur(10px)',
      transition: 'opacity .2s ease, transform .2s ease'
    });
    const heading = root.document.createElement('strong');
    heading.textContent = 'Loading application data';
    heading.style.display = 'block';
    heading.style.marginBottom = '7px';
    const list = root.document.createElement('div');
    const rows = new Map();
    for (const type of types) {
      const row = root.document.createElement('div');
      Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '3px 0', color: '#bdd0de' });
      const name = root.document.createElement('span');
      name.textContent = labelFor(type);
      const status = root.document.createElement('small');
      status.textContent = 'Waiting';
      status.style.color = '#8ea5b7';
      row.append(name, status);
      list.appendChild(row);
      rows.set(type, status);
    }
    panel.append(heading, list);
    root.document.body.appendChild(panel);
    return {
      update(detail) {
        const status = rows.get(detail && detail.type);
        if (!status) return;
        const labels = { waiting: 'Waiting', loading: 'Loading', ready: 'Ready', cached: 'Ready', error: 'Unavailable', cancelled: 'Stopped' };
        status.textContent = labels[detail.status] || detail.status || 'Waiting';
        status.style.color = detail.status === 'error' ? '#ff9ba9' : detail.status === 'ready' || detail.status === 'cached' ? '#72e1b1' : '#9fdcff';
      },
      finish(delay) {
        root.setTimeout(() => {
          panel.style.opacity = '0';
          panel.style.transform = 'translateY(-4px)';
          root.setTimeout(() => panel.remove(), 220);
        }, delay == null ? 180 : delay);
      }
    };
  }

  try {
    if (root.parent && root.parent !== root && root.parent.CoachToolsAppData) {
      const owner = root.parent.CoachToolsAppData;
      const subscriptions = new Set();
      const activeLoads = new Set();
      const track = unsubscribe => {
        if (typeof unsubscribe !== 'function') return () => {};
        subscriptions.add(unsubscribe);
        return () => { subscriptions.delete(unsubscribe); unsubscribe(); };
      };
      const progressive = async (method, requested, options) => {
        const types = Array.isArray(requested)
          ? requested.map(item => typeof item === 'string' ? item : item && (item.type || item.datasetType)).filter(Boolean)
          : Array.isArray(requested && requested.data) ? requested.data.slice() : [];
        const ui = options && options.progressUi === false ? null : mountFrameProgress(types);
        const appId = options && options.appId || frameAppId();
        const userProgress = options && options.onProgress;
        const controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
        const upstreamSignal = options && options.signal;
        if (controller) {
          activeLoads.add(controller);
          if (upstreamSignal && upstreamSignal.aborted) controller.abort(upstreamSignal.reason);
          else if (upstreamSignal && typeof upstreamSignal.addEventListener === 'function') upstreamSignal.addEventListener('abort', () => controller.abort(upstreamSignal.reason), { once: true });
        }
        const bridgedOptions = {
          ...(options || {}), appId, signal: controller ? controller.signal : upstreamSignal,
          onProgress(detail) {
            const safeDetail = { ...detail, error: detail && detail.error ? String(detail.error.message || detail.error) : '' };
            if (ui) ui.update(safeDetail);
            if (typeof userProgress === 'function') userProgress(detail);
            try { root.dispatchEvent(new CustomEvent('coachtools:app-data-progress', { detail: safeDetail })); } catch (_) {}
            try { root.parent.postMessage({ type: 'coachtools:app-data-progress', appId, detail: safeDetail }, '*'); } catch (_) {}
          }
        };
        try {
          const target = typeof owner[method] === 'function' ? owner[method] : owner.getMany;
          const result = await target(requested, bridgedOptions);
          if (typeof root.requestAnimationFrame === 'function') {
            root.requestAnimationFrame(() => root.requestAnimationFrame(() => {
              try { root.parent.postMessage({ type: 'coachtools:first-useful-render', appId }, '*'); } catch (_) {}
            }));
          }
          return result;
        } finally {
          if (controller) activeLoads.delete(controller);
          if (ui) ui.finish();
        }
      };
      root.addEventListener('pagehide', () => {
        for (const controller of activeLoads) try { controller.abort(); } catch (_) {}
        activeLoads.clear();
        for (const unsubscribe of subscriptions) try { unsubscribe(); } catch (_) {}
        subscriptions.clear();
      }, { once: true });
      root.addEventListener('message', event => {
        if (!event.data || event.data.type !== 'coachtools:cancel-data-loads') return;
        for (const controller of activeLoads) try { controller.abort(); } catch (_) {}
        activeLoads.clear();
      });
      root.CoachToolsAppData = Object.freeze({
        VERSION: owner.VERSION,
        ready: (...args) => owner.ready(...args),
        get: (...args) => owner.get(...args),
        getMany: (types, options) => progressive('getMany', types, options),
        getManyProgressive: (types, options) => progressive('getManyProgressive', types, options),
        loadForApp: (app, options) => progressive('loadForApp', app, options),
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

  const VERSION = '1.1.0';
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

  function abortError() {
    const error = new Error('Application data loading was cancelled.');
    error.name = 'AbortError';
    return error;
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
  }

  function emitProgress(options, detail) {
    if (options && typeof options.onProgress === 'function') {
      try { options.onProgress(detail); } catch (_) {}
    }
  }

  function yieldToBrowser(priority) {
    return new Promise(resolve => {
      if (priority === 'low' && typeof root.requestIdleCallback === 'function') {
        root.requestIdleCallback(() => resolve(), { timeout: 120 });
        return;
      }
      if (typeof root.requestAnimationFrame === 'function') {
        root.requestAnimationFrame(() => resolve());
        return;
      }
      root.setTimeout(resolve, 0);
    });
  }

  function normalizeRequested(types) {
    const seen = new Set();
    return (types || []).map((item, index) => {
      const rawType = typeof item === 'string' ? item : item && (item.type || item.datasetType);
      const type = canonical(rawType);
      return { type, index, priority: Number(item && typeof item === 'object' && item.priority) || index + 1, label: item && typeof item === 'object' && item.label || labelFor(type) };
    }).filter(item => item.type && !seen.has(item.type) && seen.add(item.type)).sort((left, right) => left.priority - right.priority || left.index - right.index);
  }

  async function readRecord(datasetType) {
    const pendingKey = `${datasetType}:${versionKey(data.getDatasetVersion(datasetType)) || 'legacy'}`;
    if (pendingReads.has(pendingKey)) return pendingReads.get(pendingKey);
    const request = data.getCurrent(datasetType, { includeRecord: true })
      .finally(() => pendingReads.delete(pendingKey));
    pendingReads.set(pendingKey, request);
    return request;
  }

  async function ready() {
    if (!data) throw new Error('CoachToolsData is unavailable.');
    await data.ready();
    return true;
  }

  async function get(type, options) {
    await ready();
    throwIfAborted(options && options.signal);
    const datasetType = canonical(type);
    let version = data.getDatasetVersion(datasetType);
    let key = versionKey(version);
    const cached = cache.get(datasetType);
    if (cached && cached.key === key && !(options && options.force)) {
      return options && options.includeRecord ? cached.record : cached.record && cached.record.data || null;
    }
    if (!version) {
      const migrated = await readRecord(datasetType);
      throwIfAborted(options && options.signal);
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
    throwIfAborted(options && options.signal);
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

  async function getManyProgressive(types, options) {
    const requested = normalizeRequested(types);
    const result = {};
    const startedAt = Date.now();
    const diagnostics = root.CoachToolsDiagnostics;
    const appId = options && options.appId || 'application';
    const allTiming = `All requested app data ready · ${appId}`;
    const firstTiming = `First required dataset ready · ${appId}`;
    let firstReady = false;
    if (diagnostics) { diagnostics.start(allTiming, { datasets: requested.map(item => item.type) }); diagnostics.start(firstTiming); }
    for (let index = 0; index < requested.length; index += 1) {
      const item = requested[index];
      emitProgress(options, { type: item.type, label: item.label, index, total: requested.length, status: 'waiting' });
    }
    try {
      for (let index = 0; index < requested.length; index += 1) {
        const item = requested[index];
        throwIfAborted(options && options.signal);
        const cached = peek(item.type, options);
        emitProgress(options, { type: item.type, label: item.label, index, total: requested.length, status: cached != null ? 'cached' : 'loading' });
        try {
          result[item.type] = cached != null && !(options && options.force) ? cached : await get(item.type, options);
          emitProgress(options, { type: item.type, label: item.label, index, total: requested.length, status: cached != null ? 'cached' : 'ready', elapsed: Date.now() - startedAt });
          if (!firstReady) {
            firstReady = true;
            if (diagnostics) diagnostics.end(firstTiming, { datasetType: item.type, cached: cached != null });
          }
        } catch (error) {
          if (error && error.name === 'AbortError') {
            emitProgress(options, { type: item.type, label: item.label, index, total: requested.length, status: 'cancelled' });
            throw error;
          }
          result[item.type] = null;
          emitProgress(options, { type: item.type, label: item.label, index, total: requested.length, status: 'error', error });
          if (!(options && options.continueOnError)) throw error;
        }
        if (index < requested.length - 1) await yieldToBrowser(options && options.priority);
      }
      return result;
    } finally {
      if (!firstReady && diagnostics) diagnostics.end(firstTiming, { cancelled: Boolean(options && options.signal && options.signal.aborted) });
      if (diagnostics) diagnostics.end(allTiming, { datasets: requested.length, elapsed: Date.now() - startedAt });
    }
  }

  async function getMany(types, options) {
    return getManyProgressive(types, { ...(options || {}), continueOnError: false });
  }

  async function loadForApp(app, options) {
    const requested = Array.isArray(app) ? app : app && Array.isArray(app.data) ? app.data : [];
    return getManyProgressive(requested, {
      ...(options || {}),
      appId: options && options.appId || app && app.id || 'application',
      continueOnError: !options || options.continueOnError !== false
    });
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
    VERSION, ready, get, getMany, getManyProgressive, loadForApp, peek, getVersion, subscribe,
    getScope: () => storage && storage.getScope ? storage.getScope() : null,
    subscribeScope: callback => data && data.subscribeScope ? data.subscribeScope(callback) : () => {},
    invalidate(type) { if (type) cache.delete(canonical(type)); else cache.clear(); }
  });
})(window);
