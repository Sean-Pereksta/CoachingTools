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

  function documentAppId() {
    try {
      const meta = root.document && root.document.querySelector('meta[name="coachtools-id"]');
      return String(meta && meta.content || '').trim();
    } catch (_) { return ''; }
  }

  function mountFrameProgress(types, options) {
    if (!root.document || !root.document.body) return null;
    const appId = String(options && options.appId || documentAppId() || frameAppId() || '').trim();
    const prominent = appId === 'coaching-gaps';
    const existing = root.document.getElementById('coachtools-progressive-data-status');
    if (existing) existing.remove();
    const panel = root.document.createElement('aside');
    panel.id = 'coachtools-progressive-data-status';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    Object.assign(panel.style, prominent ? {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: '2147483000',
      width: 'min(460px, calc(100vw - 32px))', padding: '18px 18px 16px',
      border: '1px solid rgba(114, 156, 190, .38)', borderRadius: '16px',
      background: 'rgba(9, 20, 34, .97)', boxShadow: '0 0 0 100vmax rgba(2, 6, 23, .34), 0 24px 70px rgba(0, 0, 0, .42)',
      color: '#eef8ff', font: '12px/1.4 Inter, ui-sans-serif, system-ui, sans-serif', backdropFilter: 'blur(12px)',
      transition: 'opacity .2s ease, transform .2s ease'
    } : {
      position: 'fixed', top: '12px', right: '12px', zIndex: '2147483000', width: 'min(290px, calc(100vw - 24px))',
      padding: '10px 11px', border: '1px solid rgba(114, 156, 190, .32)', borderRadius: '11px',
      background: 'rgba(9, 20, 34, .94)', boxShadow: '0 14px 40px rgba(0, 0, 0, .3)', color: '#eef8ff',
      font: '11px/1.35 Inter, ui-sans-serif, system-ui, sans-serif', backdropFilter: 'blur(10px)',
      transition: 'opacity .2s ease, transform .2s ease'
    });

    const heading = root.document.createElement('strong');
    heading.textContent = prominent ? 'Opening Coaching Gaps' : 'Loading application data';
    Object.assign(heading.style, { display: 'block', marginBottom: prominent ? '4px' : '7px', fontSize: prominent ? '15px' : 'inherit' });

    const stageText = root.document.createElement('div');
    stageText.textContent = prominent ? 'Reading locally stored data…' : '';
    Object.assign(stageText.style, { color: '#bdd0de', marginBottom: '9px', minHeight: prominent ? '17px' : '0' });

    const progressMeta = root.document.createElement('div');
    Object.assign(progressMeta.style, { display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '5px', color: '#dbeafe', fontWeight: '700' });
    const progressLabel = root.document.createElement('span');
    progressLabel.textContent = prominent ? 'Loading data' : 'Progress';
    const progressPct = root.document.createElement('span');
    progressPct.textContent = '0%';
    progressMeta.append(progressLabel, progressPct);

    const track = root.document.createElement('div');
    Object.assign(track.style, { height: prominent ? '10px' : '7px', borderRadius: '999px', overflow: 'hidden', background: 'rgba(148, 163, 184, .18)', marginBottom: '10px' });
    const fill = root.document.createElement('div');
    Object.assign(fill.style, { width: '0%', height: '100%', borderRadius: 'inherit', background: 'linear-gradient(90deg, #60a5fa, #22d3ee)', transition: 'width .16s ease' });
    track.appendChild(fill);

    const list = root.document.createElement('div');
    const rows = new Map();
    const complete = new Set();
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
    panel.append(heading, stageText, progressMeta, track, list);
    root.document.body.appendChild(panel);

    let lastPct = 0;
    const setOverall = (pct, label, detail) => {
      const next = Math.max(lastPct, Math.min(100, Math.round(Number(pct) || 0)));
      lastPct = next;
      fill.style.width = `${next}%`;
      progressPct.textContent = `${next}%`;
      if (label) progressLabel.textContent = label;
      if (detail !== undefined) stageText.textContent = String(detail || '');
    };

    return {
      update(detail) {
        const status = rows.get(detail && detail.type);
        if (status) {
          const labels = { waiting: 'Waiting', loading: 'Loading', ready: 'Ready', cached: 'Ready', error: 'Unavailable', cancelled: 'Stopped' };
          status.textContent = labels[detail.status] || detail.status || 'Waiting';
          status.style.color = detail.status === 'error' ? '#ff9ba9' : detail.status === 'ready' || detail.status === 'cached' ? '#72e1b1' : '#9fdcff';
          if (['ready', 'cached', 'error', 'cancelled'].includes(detail.status)) complete.add(detail.type);
        }
        const rawPct = types.length ? complete.size / types.length : 1;
        setOverall(rawPct * (prominent ? 35 : 100), prominent ? 'Reading stored data' : 'Loading data', detail && detail.label || '');
      },
      stage(pct, label, detail) { setOverall(pct, label, detail); },
      finish(delay) {
        setOverall(100, 'Ready', prominent ? 'Coaching Gaps is ready.' : '');
        root.setTimeout(() => {
          panel.style.opacity = '0';
          panel.style.transform = prominent ? 'translate(-50%, calc(-50% - 4px))' : 'translateY(-4px)';
          root.setTimeout(() => panel.remove(), 220);
        }, delay == null ? (prominent ? 420 : 180) : delay);
      }
    };
  }

  const COACHING_GAPS_CANON = Object.freeze({
    weeklyRetail: { fn: 'canonicalizeStatRows', label: 'Retail performance', sortKey: '' },
    weeklyReferral: { fn: 'canonicalizeStatRows', label: 'Referral performance', sortKey: '' },
    documentedCoaching: { fn: 'canonicalizeDocumentedCoachings', label: 'Documented coaching', sortKey: 'date' },
    checklist: { fn: 'canonicalizeChecklistRows', label: 'Checklist records', sortKey: 'date' },
    qa: { fn: 'canonicalizeQA', label: 'QA records', sortKey: 'startDate' }
  });
  const chunkCanonicalStates = new Map();

  function getChunkCanonicalState(fnName) {
    let state = chunkCanonicalStates.get(fnName);
    if (state) return state;
    const original = root[fnName];
    if (typeof original !== 'function') return null;
    state = { original, cache: new WeakMap() };
    chunkCanonicalStates.set(fnName, state);
    root[fnName] = function chunkCachedCanonicalizer(dockObj) {
      if (dockObj && typeof dockObj === 'object' && state.cache.has(dockObj)) return state.cache.get(dockObj);
      const value = original.apply(this, arguments);
      if (dockObj && typeof dockObj === 'object') state.cache.set(dockObj, value);
      return value;
    };
    return state;
  }

  async function mergeSortedPair(left, right, sortKey, signal) {
    const merged = new Array(left.length + right.length);
    let li = 0;
    let ri = 0;
    let out = 0;
    while (li < left.length || ri < right.length) {
      if ((out & 2047) === 0) {
        throwIfAborted(signal);
        await yieldToBrowser('low');
      }
      if (li >= left.length) merged[out++] = right[ri++];
      else if (ri >= right.length) merged[out++] = left[li++];
      else {
        const lv = left[li] && left[li][sortKey] instanceof Date ? left[li][sortKey].getTime() : -Infinity;
        const rv = right[ri] && right[ri][sortKey] instanceof Date ? right[ri][sortKey].getTime() : -Infinity;
        merged[out++] = lv >= rv ? left[li++] : right[ri++];
      }
    }
    return merged;
  }

  async function mergeSortedChunks(chunks, sortKey, signal) {
    let level = chunks.filter(chunk => chunk && chunk.length);
    if (!level.length) return [];
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        throwIfAborted(signal);
        if (!level[i + 1]) next.push(level[i]);
        else next.push(await mergeSortedPair(level[i], level[i + 1], sortKey, signal));
      }
      level = next;
      await yieldToBrowser('low');
    }
    return level[0];
  }

  async function canonicalizeDockInChunks(dockObj, definition, options) {
    if (!dockObj || typeof dockObj !== 'object') return [];
    const state = getChunkCanonicalState(definition.fn);
    if (!state || typeof root.extractRowArrays !== 'function') return null;
    if (state.cache.has(dockObj)) return state.cache.get(dockObj);

    const packs = root.extractRowArrays(dockObj, '');
    const totalRows = packs.reduce((sum, pack) => sum + (Array.isArray(pack.rows) ? pack.rows.length : 0), 0);
    const chunkSize = Math.max(200, Number(options && options.chunkSize) || 600);
    const chunks = [];
    let processed = 0;

    if (!totalRows) {
      state.cache.set(dockObj, []);
      if (options && typeof options.onProgress === 'function') options.onProgress(1, 0, 0);
      return [];
    }

    for (const pack of packs) {
      const rows = Array.isArray(pack.rows) ? pack.rows : [];
      for (let start = 0; start < rows.length; start += chunkSize) {
        throwIfAborted(options && options.signal);
        const slice = rows.slice(start, start + chunkSize);
        const sheetName = String(pack.sheetName || dockObj && dockObj.meta && dockObj.meta.sourceSheet || '__chunk__');
        const synthetic = {
          sheets: { [sheetName || '__chunk__']: { rows: slice } },
          meta: { ...(dockObj.meta || {}), sourceSheet: sheetName }
        };
        const partial = state.original(synthetic);
        if (partial && partial.length) chunks.push(partial);
        processed += slice.length;
        if (options && typeof options.onProgress === 'function') options.onProgress(Math.min(1, processed / totalRows), processed, totalRows);
        await yieldToBrowser('low');
      }
    }

    let result;
    if (definition.sortKey) result = await mergeSortedChunks(chunks, definition.sortKey, options && options.signal);
    else result = chunks.flat();
    state.cache.set(dockObj, result);
    return result;
  }

  async function prepareCoachingGapsCanonicalData(getDataset, types, options) {
    const appId = String(options && options.appId || documentAppId() || frameAppId() || '').trim();
    if (appId !== 'coaching-gaps') return;
    const requested = new Set((types || []).map(type => typeof type === 'string' ? type : type && (type.type || type.datasetType)).filter(Boolean));
    const mode = String(root.document && root.document.getElementById('modeSel') && root.document.getElementById('modeSel').value || 'retail').toLowerCase();
    const preferredWeekly = mode === 'referral' ? 'weeklyReferral' : 'weeklyRetail';
    const otherWeekly = preferredWeekly === 'weeklyRetail' ? 'weeklyReferral' : 'weeklyRetail';
    const orderedTypes = ['documentedCoaching', preferredWeekly, 'checklist', 'qa', otherWeekly]
      .filter((type, index, arr) => requested.has(type) && arr.indexOf(type) === index && COACHING_GAPS_CANON[type]);
    if (!orderedTypes.length) return;

    const ui = options && options.ui;
    const signal = options && options.signal;
    for (let index = 0; index < orderedTypes.length; index += 1) {
      const type = orderedTypes[index];
      const definition = COACHING_GAPS_CANON[type];
      const dockObj = getDataset(type);
      const startPct = 35 + (index / orderedTypes.length) * 58;
      const endPct = 35 + ((index + 1) / orderedTypes.length) * 58;
      if (ui) ui.stage(startPct, `Preparing ${definition.label}`, 'Processing stored rows in small batches…');
      await yieldToBrowser();
      if (dockObj && typeof dockObj === 'object') {
        await canonicalizeDockInChunks(dockObj, definition, {
          signal,
          chunkSize: 600,
          onProgress(fraction, processed, total) {
            const pct = startPct + (endPct - startPct) * fraction;
            if (ui) ui.stage(pct, `Preparing ${definition.label}`, total ? `${processed.toLocaleString()} of ${total.toLocaleString()} rows` : 'No rows to process');
          }
        });
      } else if (ui) {
        ui.stage(endPct, `Preparing ${definition.label}`, 'No stored rows found');
      }
      await yieldToBrowser();
    }
    if (ui) ui.stage(96, 'Building Coaching Gaps view', 'Applying your saved filters and report settings…');
    await yieldToBrowser();
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
        const appId = options && options.appId || frameAppId() || documentAppId();
        const ui = options && options.progressUi === false ? null : mountFrameProgress(types, { appId });
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
          await prepareCoachingGapsCanonicalData(type => owner.peek(type), types, {
            appId,
            ui,
            signal: controller ? controller.signal : upstreamSignal
          });
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

  const VERSION = '1.2.0';
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
    const appId = options && options.appId || documentAppId() || 'application';
    const localCoachingGaps = documentAppId() === 'coaching-gaps';
    const localUi = localCoachingGaps && (!options || options.progressUi !== false)
      ? mountFrameProgress(requested.map(item => item.type), { appId: 'coaching-gaps' })
      : null;
    const allTiming = `All requested app data ready · ${appId}`;
    const firstTiming = `First required dataset ready · ${appId}`;
    let firstReady = false;
    if (diagnostics) { diagnostics.start(allTiming, { datasets: requested.map(item => item.type) }); diagnostics.start(firstTiming); }
    for (let index = 0; index < requested.length; index += 1) {
      const item = requested[index];
      emitProgress(options, { type: item.type, label: item.label, index, total: requested.length, status: 'waiting' });
      if (localUi) localUi.update({ type: item.type, label: item.label, status: 'waiting' });
    }
    try {
      for (let index = 0; index < requested.length; index += 1) {
        const item = requested[index];
        throwIfAborted(options && options.signal);
        const cached = peek(item.type, options);
        const loadingDetail = { type: item.type, label: item.label, index, total: requested.length, status: cached != null ? 'cached' : 'loading' };
        emitProgress(options, loadingDetail);
        if (localUi) localUi.update(loadingDetail);
        try {
          result[item.type] = cached != null && !(options && options.force) ? cached : await get(item.type, options);
          const readyDetail = { type: item.type, label: item.label, index, total: requested.length, status: cached != null ? 'cached' : 'ready', elapsed: Date.now() - startedAt };
          emitProgress(options, readyDetail);
          if (localUi) localUi.update(readyDetail);
          if (!firstReady) {
            firstReady = true;
            if (diagnostics) diagnostics.end(firstTiming, { datasetType: item.type, cached: cached != null });
          }
        } catch (error) {
          if (error && error.name === 'AbortError') {
            emitProgress(options, { type: item.type, label: item.label, index, total: requested.length, status: 'cancelled' });
            if (localUi) localUi.update({ type: item.type, label: item.label, status: 'cancelled' });
            throw error;
          }
          result[item.type] = null;
          emitProgress(options, { type: item.type, label: item.label, index, total: requested.length, status: 'error', error });
          if (localUi) localUi.update({ type: item.type, label: item.label, status: 'error' });
          if (!(options && options.continueOnError)) throw error;
        }
        if (index < requested.length - 1) await yieldToBrowser(options && options.priority);
      }
      if (localCoachingGaps) {
        await prepareCoachingGapsCanonicalData(type => result[type] !== undefined ? result[type] : peek(type), requested.map(item => item.type), {
          appId: 'coaching-gaps',
          ui: localUi,
          signal: options && options.signal
        });
      }
      return result;
    } finally {
      if (!firstReady && diagnostics) diagnostics.end(firstTiming, { cancelled: Boolean(options && options.signal && options.signal.aborted) });
      if (diagnostics) diagnostics.end(allTiming, { datasets: requested.length, elapsed: Date.now() - startedAt });
      if (localUi) localUi.finish();
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
