(function attachCoachToolsDockChunkLoader(root) {
  'use strict';

  const meta = name => String(document.querySelector(`meta[name="coachtools-${name}"]`)?.content || '').trim();
  const appId = meta('id');
  const appName = meta('name') || document.title || 'CoachTools';
  const TARGET_APPS = new Set(['coach-timeline', 'audit-checklist']);
  const TARGET_TYPES = new Set(['checklist', 'documentedCoaching']);
  if (!TARGET_APPS.has(appId) || !root.CoachToolsAppData || root.__coachToolsDockChunkLoaderInstalled) return;
  root.__coachToolsDockChunkLoaderInstalled = true;

  const base = root.CoachToolsAppData;
  const DB_NAME = 'allStarImportedDataCache.v1';
  const DATASET_STORE = 'coachtoolsDatasets';
  const CHUNK_STORE = 'coachtoolsDatasetChunks';
  const ROW_BATCH = 250;
  const cache = new Map();
  const pending = new Map();
  const activeControllers = new Set();
  let panel = null;
  let fill = null;
  let pct = null;
  let heading = null;
  let detail = null;
  let rowList = null;
  let lastPct = 0;

  function labelFor(type) {
    if (type === 'checklist') return 'Checklist';
    if (type === 'documentedCoaching') return 'Documented Coaching';
    return String(type || 'Data').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase());
  }

  function normalizeTypes(requested) {
    const values = Array.isArray(requested)
      ? requested
      : Array.isArray(requested && requested.data) ? requested.data : [];
    const seen = new Set();
    return values
      .map(item => typeof item === 'string' ? item : item && (item.type || item.datasetType))
      .filter(type => type && !seen.has(type) && seen.add(type));
  }

  function yieldToBrowser(priority) {
    return new Promise(resolve => {
      if (priority === 'low' && typeof root.requestIdleCallback === 'function') {
        root.requestIdleCallback(() => resolve(), { timeout: 90 });
        return;
      }
      if (typeof root.requestAnimationFrame === 'function') {
        root.requestAnimationFrame(() => resolve());
        return;
      }
      root.setTimeout(resolve, 0);
    });
  }

  function abortError() {
    const error = new Error('Application data loading was cancelled.');
    error.name = 'AbortError';
    return error;
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
  }

  function clone(value) {
    try { if (typeof structuredClone === 'function') return structuredClone(value); } catch (_) {}
    try { return value == null ? value : JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  function mountProgress(types) {
    if (!document.body) return null;
    const existing = document.getElementById('coachtools-dock-chunk-progress');
    if (existing) existing.remove();

    panel = document.createElement('aside');
    panel.id = 'coachtools-dock-chunk-progress';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    Object.assign(panel.style, {
      position: 'fixed', inset: '0', zIndex: '2147483500', display: 'grid', placeItems: 'center', padding: '18px',
      background: 'rgba(2, 6, 23, .38)', backdropFilter: 'blur(4px)', transition: 'opacity .2s ease'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      width: 'min(500px, calc(100vw - 36px))', padding: '20px 20px 18px',
      border: '1px solid rgba(125, 211, 252, .28)', borderRadius: '18px',
      background: 'rgba(8, 20, 35, .97)', boxShadow: '0 28px 80px rgba(0, 0, 0, .5)',
      color: '#eef8ff', font: '12px/1.45 Inter, ui-sans-serif, system-ui, sans-serif'
    });

    heading = document.createElement('strong');
    heading.textContent = `Opening ${appName}`;
    Object.assign(heading.style, { display: 'block', fontSize: '16px', marginBottom: '5px' });

    detail = document.createElement('div');
    detail.textContent = 'Connecting to locally stored data…';
    Object.assign(detail.style, { color: '#b8ccda', minHeight: '19px', marginBottom: '12px' });

    const metaRow = document.createElement('div');
    Object.assign(metaRow.style, { display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '6px', fontWeight: '800', color: '#dbeafe' });
    const metaLabel = document.createElement('span');
    metaLabel.textContent = 'Loading stored data';
    pct = document.createElement('span');
    pct.textContent = '1%';
    metaRow.append(metaLabel, pct);

    const track = document.createElement('div');
    Object.assign(track.style, { height: '10px', overflow: 'hidden', borderRadius: '999px', background: 'rgba(148, 163, 184, .18)', marginBottom: '12px' });
    fill = document.createElement('div');
    Object.assign(fill.style, { width: '1%', height: '100%', borderRadius: 'inherit', background: 'linear-gradient(90deg, #38bdf8, #22d3ee)', transition: 'width .12s ease' });
    track.appendChild(fill);

    rowList = document.createElement('div');
    for (const type of types) {
      const row = document.createElement('div');
      row.dataset.type = type;
      Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', gap: '14px', padding: '4px 0', color: '#b8ccda' });
      const name = document.createElement('span');
      name.textContent = labelFor(type);
      const status = document.createElement('small');
      status.dataset.status = '1';
      status.textContent = 'Waiting';
      status.style.color = '#8ea5b7';
      row.append(name, status);
      rowList.appendChild(row);
    }

    const note = document.createElement('div');
    note.textContent = 'IndexedDB rows are read and prepared in small batches so the browser can keep repainting.';
    Object.assign(note.style, { marginTop: '11px', color: '#86a4b8', fontSize: '11px' });

    card.append(heading, detail, metaRow, track, rowList, note);
    panel.appendChild(card);
    document.body.appendChild(panel);
    lastPct = 1;
    return panel;
  }

  function resetProgress(types) {
    if (panel && panel.isConnected) panel.remove();
    panel = fill = pct = heading = detail = rowList = null;
    lastPct = 0;
    mountProgress(types);
  }

  function setProgress(percent, title, message) {
    if (!panel || !panel.isConnected) return;
    const next = Math.max(lastPct, Math.min(100, Math.round(Number(percent) || 0)));
    lastPct = next;
    fill.style.width = `${next}%`;
    pct.textContent = `${next}%`;
    if (title) heading.textContent = title;
    if (message !== undefined) detail.textContent = String(message || '');
  }

  function setTypeStatus(type, text, state) {
    if (!rowList) return;
    const row = Array.from(rowList.children).find(node => node.dataset && node.dataset.type === type);
    const status = row && row.querySelector('[data-status]');
    if (!status) return;
    status.textContent = text;
    status.style.color = state === 'ready' ? '#72e1b1' : state === 'error' ? '#ff9ba9' : '#9fdcff';
  }

  function finishAfterViewBuild() {
    setProgress(94, `Building ${appName}`, 'Stored rows are ready. Applying filters, summaries, and timeline views…');
    root.setTimeout(() => {
      const paint = () => {
        setProgress(100, `${appName} ready`, 'Startup data finished loading.');
        root.setTimeout(() => {
          if (!panel) return;
          panel.style.opacity = '0';
          root.setTimeout(() => {
            if (panel) panel.remove();
            panel = fill = pct = heading = detail = rowList = null;
            lastPct = 0;
          }, 220);
        }, 260);
      };
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(paint);
      else paint();
    }, 0);
  }

  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in root)) return reject(new Error('IndexedDB is unavailable.'));
      const request = root.indexedDB.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open CoachTools IndexedDB.'));
      request.onblocked = () => reject(new Error('CoachTools IndexedDB is blocked by another open tab.'));
    });
  }

  async function readStoreRecord(db, storeName, key) {
    const tx = db.transaction(storeName, 'readonly');
    return idbRequest(tx.objectStore(storeName).get(key));
  }

  function versionKey(version) {
    return version ? `${version.datasetId || ''}:${Number(version.version) || 0}:${version.fingerprint || ''}` : '';
  }

  function ensureSheetState(states, sheetName) {
    const key = String(sheetName || 'Sheet1');
    let state = states.get(key);
    if (!state) {
      state = { header: null, rows: [] };
      states.set(key, state);
    }
    return state;
  }

  async function appendChunkRows(states, chunk, onProgress, signal) {
    const state = ensureSheetState(states, chunk && chunk.sheetName);
    const sourceRows = Array.isArray(chunk && chunk.rows) ? chunk.rows : [];
    if (!sourceRows.length) {
      if (typeof onProgress === 'function') onProgress(1);
      return;
    }

    if (sourceRows[0] && typeof sourceRows[0] === 'object' && !Array.isArray(sourceRows[0])) {
      for (let start = 0; start < sourceRows.length; start += ROW_BATCH) {
        throwIfAborted(signal);
        const slice = sourceRows.slice(start, start + ROW_BATCH);
        state.rows.push(...slice);
        if (typeof onProgress === 'function') onProgress(Math.min(1, (start + slice.length) / sourceRows.length));
        await yieldToBrowser('low');
      }
      return;
    }

    let rowStart = 0;
    if (!state.header) {
      state.header = Array.isArray(sourceRows[0]) ? sourceRows[0].map(value => String(value ?? '').trim()) : [];
      rowStart = 1;
    }
    const header = state.header || [];
    const total = Math.max(1, sourceRows.length - rowStart);
    let processed = 0;

    for (let start = rowStart; start < sourceRows.length; start += ROW_BATCH) {
      throwIfAborted(signal);
      const stop = Math.min(sourceRows.length, start + ROW_BATCH);
      for (let index = start; index < stop; index += 1) {
        const source = sourceRows[index];
        if (!Array.isArray(source)) continue;
        const row = {};
        let any = false;
        for (let column = 0; column < header.length; column += 1) {
          const key = header[column];
          if (!key) continue;
          const value = source[column];
          if (value !== null && value !== undefined && String(value).trim() !== '') any = true;
          row[key] = value;
        }
        if (any) state.rows.push(row);
      }
      processed += stop - start;
      if (typeof onProgress === 'function') onProgress(Math.min(1, processed / total));
      await yieldToBrowser('low');
    }
  }

  function buildDock(record, states) {
    const dock = {
      meta: clone(record && record.dataShape && record.dataShape.meta || record && record.data && record.data.meta || {}),
      sheets: {}
    };
    for (const [sheetName, state] of states.entries()) dock.sheets[sheetName] = { rows: state.rows };
    return dock;
  }

  async function loadChunkedType(type, context, options) {
    await base.ready();
    throwIfAborted(options && options.signal);
    const version = base.getVersion(type);
    const key = versionKey(version);
    const cached = cache.get(type);
    if (cached && cached.key === key && !(options && options.force)) {
      if (context) context.report(1, 'Cached');
      return cached.value;
    }
    if (pending.has(type) && !(options && options.force)) return pending.get(type);

    const request = (async () => {
      if (!version || !version.datasetId) return null;
      const db = await openDatabase();
      try {
        const record = await readStoreRecord(db, DATASET_STORE, version.datasetId);
        throwIfAborted(options && options.signal);
        if (!record) return null;

        if (!record.chunked || !record.dataShape || Number(record.chunkCount) < 1) {
          const value = record.data || null;
          cache.set(type, { key, value });
          if (context) context.report(1, 'Loaded');
          return value;
        }

        const totalChunks = Number(record.chunkCount);
        const states = new Map();
        for (let index = 0; index < totalChunks; index += 1) {
          throwIfAborted(options && options.signal);
          const chunkId = `${record.id}:${String(index).padStart(6, '0')}`;
          const chunk = await readStoreRecord(db, CHUNK_STORE, chunkId);
          if (!chunk) throw new Error(`${labelFor(type)} is incomplete (${index} of ${totalChunks} chunks available).`);
          await appendChunkRows(states, chunk, rowFraction => {
            if (context) context.report((index + rowFraction) / totalChunks, `Chunk ${index + 1} of ${totalChunks}`);
          }, options && options.signal);
          await yieldToBrowser('low');
        }

        const value = buildDock(record, states);
        cache.set(type, { key, value });
        if (context) context.report(1, `${totalChunks} chunks ready`);
        return value;
      } finally {
        db.close();
      }
    })().finally(() => pending.delete(type));

    pending.set(type, request);
    return request;
  }

  async function loadMany(requested, options) {
    const types = normalizeTypes(requested);
    if (!types.some(type => TARGET_TYPES.has(type))) {
      const method = base.getManyProgressive || base.getMany;
      return method.call(base, requested, options);
    }

    const controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    const upstreamSignal = options && options.signal;
    if (controller) {
      activeControllers.add(controller);
      if (upstreamSignal && upstreamSignal.aborted) controller.abort(upstreamSignal.reason);
      else if (upstreamSignal && typeof upstreamSignal.addEventListener === 'function') {
        upstreamSignal.addEventListener('abort', () => controller.abort(upstreamSignal.reason), { once: true });
      }
    }
    const signal = controller ? controller.signal : upstreamSignal;
    const result = {};
    resetProgress(types);
    setProgress(2, `Opening ${appName}`, 'Starting chunked IndexedDB loading…');
    await yieldToBrowser();

    try {
      for (let index = 0; index < types.length; index += 1) {
        const type = types[index];
        throwIfAborted(signal);
        setTypeStatus(type, 'Loading', 'loading');
        const context = {
          report(fraction, statusText) {
            const bounded = Math.max(0, Math.min(1, Number(fraction) || 0));
            const overall = 3 + ((index + bounded) / Math.max(1, types.length)) * 88;
            setProgress(overall, `Opening ${appName}`, `${labelFor(type)} · ${statusText}`);
            setTypeStatus(type, bounded >= 1 ? 'Ready' : statusText, bounded >= 1 ? 'ready' : 'loading');
            const progress = { type, label: labelFor(type), index, total: types.length, status: bounded >= 1 ? 'ready' : 'loading', fraction: bounded };
            if (options && typeof options.onProgress === 'function') {
              try { options.onProgress(progress); } catch (_) {}
            }
            try { root.dispatchEvent(new CustomEvent('coachtools:app-data-progress', { detail: progress })); } catch (_) {}
          }
        };

        try {
          if (TARGET_TYPES.has(type)) result[type] = await loadChunkedType(type, context, { ...(options || {}), signal });
          else result[type] = await base.get(type, { ...(options || {}), signal });
          setTypeStatus(type, 'Ready', 'ready');
        } catch (error) {
          if (error && error.name === 'AbortError') throw error;
          setTypeStatus(type, 'Compatibility load', 'loading');
          try {
            result[type] = await base.get(type, { ...(options || {}), signal, progressUi: false });
            if (TARGET_TYPES.has(type)) cache.set(type, { key: versionKey(base.getVersion(type)), value: result[type] });
            setTypeStatus(type, 'Ready', 'ready');
          } catch (fallbackError) {
            setTypeStatus(type, 'Unavailable', 'error');
            if (!(options && options.continueOnError)) throw fallbackError;
            result[type] = null;
          }
        }
        await yieldToBrowser('low');
      }

      finishAfterViewBuild();
      return result;
    } finally {
      if (controller) activeControllers.delete(controller);
    }
  }

  function subscribe(types, callback) {
    return base.subscribe(types, event => {
      const changed = Array.isArray(event && event.changedTypes) ? event.changedTypes : normalizeTypes(types);
      for (const type of changed) if (TARGET_TYPES.has(type)) cache.delete(type);
      if (typeof callback === 'function') callback(event);
    });
  }

  root.addEventListener('pagehide', () => {
    for (const controller of activeControllers) try { controller.abort(); } catch (_) {}
    activeControllers.clear();
    pending.clear();
    cache.clear();
  }, { once: true });

  root.CoachToolsAppData = Object.freeze({
    VERSION: `${base.VERSION || '1.0'}+dock-chunks`,
    ready: (...args) => base.ready(...args),
    get: (type, options) => TARGET_TYPES.has(type) ? loadMany([type], options).then(result => result[type]) : base.get(type, options),
    getMany: (types, options) => loadMany(types, { ...(options || {}), continueOnError: false }),
    getManyProgressive: (types, options) => loadMany(types, options),
    loadForApp: (definition, options) => loadMany(definition, options),
    peek(type, options) {
      const cached = cache.get(type);
      if (TARGET_TYPES.has(type) && cached) return cached.value;
      return base.peek(type, options);
    },
    getVersion: (...args) => base.getVersion(...args),
    subscribe,
    getScope: (...args) => base.getScope(...args),
    subscribeScope: (...args) => base.subscribeScope(...args),
    invalidate(type) {
      if (type) cache.delete(type);
      else cache.clear();
      return base.invalidate(type);
    }
  });
})(window);
