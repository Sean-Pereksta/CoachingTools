(function attachCoachToolsShell(root) {
  'use strict';

  const shellScript = document.currentScript;
  const sharedBase = shellScript && shellScript.src ? new URL('.', shellScript.src) : null;
  const intelligenceApps = new Set(['people-profiles', 'coaching-gaps', 'kpi-impact', 'qa-scores', 'coach-timeline']);
  const heavyLoadApps = new Set(['kpi-impact', 'qa-scores']);
  const scriptLoads = new Map();

  function meta(name, fallback) {
    const value = document.querySelector(`meta[name="coachtools-${name}"]`)?.content;
    return value || fallback || '';
  }

  const app = Object.freeze({
    id: meta('id', location.pathname.split('/').pop().replace(/\.html?$/i, '')),
    name: meta('name', document.title),
    version: meta('version', '1.0'),
    file: location.pathname
  });

  function post(type, detail) {
    try {
      if (root.parent && root.parent !== root) root.parent.postMessage({ type, detail: { app, ...(detail || {}) } }, '*');
    } catch (_) {}
  }

  function notifyReady() { post('coachtools:app-ready', { title: document.title }); }
  function requestDesktop() { post('coachtools:show-desktop'); }
  function requestPopOut() { post('coachtools:pop-out', { file: location.href }); }

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

  function installChunkedStartupLoader() {
    if (!heavyLoadApps.has(app.id) || !root.CoachToolsAppData) return;

    const owner = root.CoachToolsAppData;
    const DATASET_LABELS = Object.freeze({
      weeklyRetail: 'Weekly Retail',
      weeklyReferral: 'Weekly Referral',
      qa: 'QA',
      documentedCoaching: 'Documented Coaching'
    });
    const APP_DEFINITIONS = Object.freeze({
      'kpi-impact': {
        title: 'KPI Impact',
        chunkSize: 450,
        order: ['weeklyRetail', 'weeklyReferral', 'documentedCoaching'],
        finalLabel: 'Building KPI Impact view',
        finalDetail: 'Preparing team metrics, KPI selectors, and coaching context…',
        datasets: Object.freeze({
          weeklyRetail: { fn: 'canonicalizeStatsRowsFromDock', label: 'Retail performance', args: ['Retail'] },
          weeklyReferral: { fn: 'canonicalizeStatsRowsFromDock', label: 'Referral performance', args: ['Referral'] },
          documentedCoaching: { fn: 'canonicalizeDocumentedCoachings', label: 'Documented coaching', args: [] }
        })
      },
      'qa-scores': {
        title: 'QA Scores',
        chunkSize: 500,
        order: ['qa', 'documentedCoaching'],
        finalLabel: 'Building QA Scores view',
        finalDetail: 'Preparing scorecards, reviewer filters, and coaching context…',
        datasets: Object.freeze({
          qa: { fn: 'canonicalizeQA', label: 'QA score records', args: [] },
          documentedCoaching: { fn: 'canonicalizeDocumentedCoachings', label: 'Call Quality coaching', args: [] }
        })
      }
    });
    const config = APP_DEFINITIONS[app.id];
    if (!config) return;

    const canonicalStates = new Map();
    let activeLoad = null;

    function datasetLabel(type) {
      return DATASET_LABELS[type] || String(type || 'Data').replace(/([a-z])([A-Z])/g, '$1 $2');
    }

    function normalizeTypes(requested) {
      const values = Array.isArray(requested)
        ? requested
        : Array.isArray(requested && requested.data) ? requested.data : [];
      return values
        .map(item => typeof item === 'string' ? item : item && (item.type || item.datasetType))
        .filter(Boolean);
    }

    function mountProgress(types) {
      const existing = document.getElementById('coachtools-heavy-startup-progress');
      if (existing) existing.remove();

      const panel = document.createElement('aside');
      panel.id = 'coachtools-heavy-startup-progress';
      panel.setAttribute('role', 'status');
      panel.setAttribute('aria-live', 'polite');
      Object.assign(panel.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: '2147483001',
        width: 'min(460px, calc(100vw - 32px))',
        padding: '18px 18px 16px',
        border: '1px solid rgba(114, 156, 190, .38)',
        borderRadius: '16px',
        background: 'rgba(9, 20, 34, .97)',
        boxShadow: '0 0 0 100vmax rgba(2, 6, 23, .34), 0 24px 70px rgba(0, 0, 0, .42)',
        color: '#eef8ff',
        font: '12px/1.4 Inter, ui-sans-serif, system-ui, sans-serif',
        backdropFilter: 'blur(12px)',
        transition: 'opacity .2s ease, transform .2s ease'
      });

      const heading = document.createElement('strong');
      heading.textContent = `Opening ${config.title}`;
      Object.assign(heading.style, { display: 'block', marginBottom: '4px', fontSize: '15px' });

      const stageText = document.createElement('div');
      stageText.textContent = 'Reading locally stored data…';
      Object.assign(stageText.style, { color: '#bdd0de', marginBottom: '9px', minHeight: '17px' });

      const progressMeta = document.createElement('div');
      Object.assign(progressMeta.style, {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '10px',
        marginBottom: '5px',
        color: '#dbeafe',
        fontWeight: '700'
      });
      const progressLabel = document.createElement('span');
      progressLabel.textContent = 'Loading data';
      const progressPct = document.createElement('span');
      progressPct.textContent = '0%';
      progressMeta.append(progressLabel, progressPct);

      const track = document.createElement('div');
      Object.assign(track.style, {
        height: '10px',
        borderRadius: '999px',
        overflow: 'hidden',
        background: 'rgba(148, 163, 184, .18)',
        marginBottom: '10px'
      });
      const fill = document.createElement('div');
      Object.assign(fill.style, {
        width: '0%',
        height: '100%',
        borderRadius: 'inherit',
        background: 'linear-gradient(90deg, #60a5fa, #22d3ee)',
        transition: 'width .16s ease'
      });
      track.appendChild(fill);

      const list = document.createElement('div');
      const rows = new Map();
      const complete = new Set();
      types.forEach(type => {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex',
          justifyContent: 'space-between',
          gap: '10px',
          padding: '3px 0',
          color: '#bdd0de'
        });
        const name = document.createElement('span');
        name.textContent = datasetLabel(type);
        const status = document.createElement('small');
        status.textContent = 'Waiting';
        status.style.color = '#8ea5b7';
        row.append(name, status);
        list.appendChild(row);
        rows.set(type, status);
      });

      panel.append(heading, stageText, progressMeta, track, list);
      document.body.appendChild(panel);

      let lastPct = 0;
      function stage(pct, label, detail) {
        const next = Math.max(lastPct, Math.min(100, Math.round(Number(pct) || 0)));
        lastPct = next;
        fill.style.width = `${next}%`;
        progressPct.textContent = `${next}%`;
        if (label) progressLabel.textContent = label;
        if (detail !== undefined) stageText.textContent = String(detail || '');
      }

      return {
        update(detail) {
          const status = rows.get(detail && detail.type);
          if (status) {
            const labels = {
              waiting: 'Waiting',
              loading: 'Loading',
              ready: 'Ready',
              cached: 'Ready',
              error: 'Unavailable',
              cancelled: 'Stopped'
            };
            status.textContent = labels[detail.status] || detail.status || 'Waiting';
            status.style.color = detail.status === 'error'
              ? '#ff9ba9'
              : detail.status === 'ready' || detail.status === 'cached' ? '#72e1b1' : '#9fdcff';
            if (['ready', 'cached', 'error', 'cancelled'].includes(detail.status)) complete.add(detail.type);
          }
          const fraction = types.length ? complete.size / types.length : 1;
          stage(fraction * 35, 'Reading stored data', detail && detail.label || '');
        },
        stage,
        finish() {
          stage(100, 'Ready', `${config.title} is ready.`);
          root.setTimeout(() => {
            panel.style.opacity = '0';
            panel.style.transform = 'translate(-50%, calc(-50% - 4px))';
            root.setTimeout(() => panel.remove(), 220);
          }, 360);
        }
      };
    }

    function getCanonicalState(fnName) {
      let state = canonicalStates.get(fnName);
      if (state) return state;

      const original = root[fnName];
      if (typeof original !== 'function') return null;

      state = { original, cache: new WeakMap() };
      canonicalStates.set(fnName, state);
      root[fnName] = function cachedCanonicalizer(dockObj) {
        if (dockObj && typeof dockObj === 'object' && state.cache.has(dockObj)) {
          return state.cache.get(dockObj);
        }
        const result = original.apply(this, arguments);
        if (dockObj && typeof dockObj === 'object') state.cache.set(dockObj, result);
        return result;
      };
      return state;
    }

    async function canonicalizeInChunks(dockObj, definition, ui, startPct, endPct, signal) {
      if (!dockObj || typeof dockObj !== 'object') return;
      if (typeof root.extractRowArrays !== 'function') return;

      const state = getCanonicalState(definition.fn);
      if (!state) return;
      if (state.cache.has(dockObj)) {
        ui.stage(endPct, `Preparing ${definition.label}`, 'Already prepared');
        return;
      }

      const packs = root.extractRowArrays(dockObj, '');
      const totalRows = packs.reduce((sum, pack) => sum + (Array.isArray(pack.rows) ? pack.rows.length : 0), 0);
      if (!totalRows) {
        state.cache.set(dockObj, []);
        ui.stage(endPct, `Preparing ${definition.label}`, 'No stored rows found');
        return;
      }

      const chunks = [];
      let processed = 0;
      for (const pack of packs) {
        const rows = Array.isArray(pack.rows) ? pack.rows : [];
        for (let start = 0; start < rows.length; start += config.chunkSize) {
          if (signal && signal.aborted) {
            const error = signal.reason instanceof Error ? signal.reason : new Error('Application data loading was cancelled.');
            error.name = 'AbortError';
            throw error;
          }

          const slice = rows.slice(start, start + config.chunkSize);
          const sheetName = String(pack.sheetName || dockObj?.meta?.sourceSheet || '__chunk__');
          const synthetic = {
            sheets: { [sheetName || '__chunk__']: { rows: slice } },
            meta: { ...(dockObj.meta || {}), sourceSheet: sheetName }
          };
          const partial = state.original(synthetic, ...(definition.args || []));
          if (Array.isArray(partial) && partial.length) chunks.push(partial);

          processed += slice.length;
          const fraction = Math.min(1, processed / totalRows);
          ui.stage(
            startPct + (endPct - startPct) * fraction,
            `Preparing ${definition.label}`,
            `${processed.toLocaleString()} of ${totalRows.toLocaleString()} rows`
          );
          await yieldToBrowser('low');
        }
      }
      state.cache.set(dockObj, chunks.flat());
    }

    async function prepare(types, ui, signal) {
      const requested = new Set(types);
      const order = config.order.filter(type => requested.has(type) && config.datasets[type]);
      for (let index = 0; index < order.length; index += 1) {
        const type = order[index];
        const definition = config.datasets[type];
        const startPct = 35 + (index / order.length) * 58;
        const endPct = 35 + ((index + 1) / order.length) * 58;
        ui.stage(startPct, `Preparing ${definition.label}`, 'Processing stored rows in small batches…');
        await yieldToBrowser();
        await canonicalizeInChunks(owner.peek(type), definition, ui, startPct, endPct, signal);
        await yieldToBrowser();
      }
      ui.stage(96, config.finalLabel, config.finalDetail);
      await yieldToBrowser();
    }

    async function progressive(method, requested, options) {
      const types = normalizeTypes(requested);
      if (!types.length) {
        const target = typeof owner[method] === 'function' ? owner[method] : owner.getMany;
        return target(requested, options);
      }

      if (activeLoad && typeof activeLoad.abort === 'function') {
        try { activeLoad.abort(); } catch (_) {}
      }

      const controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
      activeLoad = controller;
      const upstreamSignal = options && options.signal;
      if (controller && upstreamSignal) {
        if (upstreamSignal.aborted) controller.abort(upstreamSignal.reason);
        else if (typeof upstreamSignal.addEventListener === 'function') {
          upstreamSignal.addEventListener('abort', () => controller.abort(upstreamSignal.reason), { once: true });
        }
      }

      const signal = controller ? controller.signal : upstreamSignal;
      const ui = options && options.progressUi === false ? null : mountProgress(types);
      const userProgress = options && options.onProgress;
      const target = typeof owner[method] === 'function' ? owner[method] : owner.getMany;

      try {
        const result = await target(requested, {
          ...(options || {}),
          appId: app.id,
          signal,
          progressUi: false,
          onProgress(detail) {
            if (ui) ui.update(detail);
            if (typeof userProgress === 'function') userProgress(detail);
          }
        });
        if (ui) await prepare(types, ui, signal);
        else await prepare(types, { stage() {} }, signal);
        return result;
      } finally {
        if (activeLoad === controller) activeLoad = null;
        if (ui) ui.finish();
      }
    }

    root.addEventListener('pagehide', () => {
      if (activeLoad && typeof activeLoad.abort === 'function') {
        try { activeLoad.abort(); } catch (_) {}
      }
      activeLoad = null;
    }, { once: true });

    root.CoachToolsAppData = Object.freeze({
      VERSION: owner.VERSION,
      ready: (...args) => owner.ready(...args),
      get: (...args) => owner.get(...args),
      getMany: (types, options) => progressive('getMany', types, options),
      getManyProgressive: (types, options) => progressive('getManyProgressive', types, options),
      loadForApp: (appConfig, options) => progressive('loadForApp', appConfig, options),
      peek: (...args) => owner.peek(...args),
      getVersion: (...args) => owner.getVersion(...args),
      subscribe: (...args) => owner.subscribe(...args),
      getScope: (...args) => owner.getScope(...args),
      subscribeScope: (...args) => owner.subscribeScope(...args),
      invalidate: (...args) => owner.invalidate(...args)
    });
  }

  function installDockChunkLoaderScript() {
    if (!sharedBase || !['coach-timeline', 'audit-checklist'].includes(app.id)) return;
    const src = new URL('coachtools-dock-chunk-loader.js', sharedBase).href;
    if (document.readyState === 'loading') {
      const safeSrc = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      document.write(`<script src="${safeSrc}"><\/script>`);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    document.head.appendChild(script);
  }

  function loadSharedScript(name, readyCheck) {
    if (typeof readyCheck === 'function' && readyCheck()) return Promise.resolve(true);
    if (!sharedBase) return Promise.resolve(false);
    if (scriptLoads.has(name)) return scriptLoads.get(name);
    const promise = new Promise(resolve => {
      const script = document.createElement('script');
      script.src = new URL(name, sharedBase).href;
      script.async = true;
      script.onload = () => resolve(typeof readyCheck !== 'function' || readyCheck());
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
    scriptLoads.set(name, promise);
    return promise;
  }

  async function installIntelligenceSurface() {
    if (!intelligenceApps.has(app.id)) return;
    try {
      if (!root.CoachToolsIdentity) await loadSharedScript('coachtools-identity.js', () => Boolean(root.CoachToolsIdentity));
      if (!root.CoachToolsIntelligence) await loadSharedScript('coachtools-intelligence.js', () => Boolean(root.CoachToolsIntelligence));
      if (!root.CoachToolsIntelligence || root.CoachToolsIntelligence.VERSION !== '1.1.0') {
        await loadSharedScript('coachtools-intelligence-extensions.js', () => Boolean(root.CoachToolsIntelligence && root.CoachToolsIntelligence.VERSION === '1.1.0'));
      }
      if (!root.CoachToolsInsightUI) await loadSharedScript('coachtools-insight-ui.js', () => Boolean(root.CoachToolsInsightUI));
      if (root.CoachToolsInsightUI && root.CoachToolsIntelligence) root.CoachToolsInsightUI.mount(app.id);
    } catch (error) {
      try { console.warn('CoachTools intelligence surface unavailable:', error); } catch (_) {}
    }
  }

  function scheduleIntelligenceSurface() {
    const run = () => installIntelligenceSurface();
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(run, { timeout: 1800 });
    else root.setTimeout(run, 650);
  }

  installChunkedStartupLoader();
  installDockChunkLoaderScript();

  root.addEventListener('error', event => { post('coachtools:app-error', { message: event.message || 'Application error' }); });
  root.addEventListener('unhandledrejection', event => { post('coachtools:app-error', { message: String(event.reason && event.reason.message || event.reason || 'Unhandled application error') }); });
  root.addEventListener('message', event => {
    if (event.data?.type === 'coachtools:data-updated') {
      try { root.dispatchEvent(new CustomEvent('coachtools:data-updated', { detail: event.data.detail || {} })); } catch (_) {}
    }
  });

  root.CoachToolsShell = Object.freeze({ app, post, notifyReady, requestDesktop, requestPopOut });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { notifyReady(); scheduleIntelligenceSurface(); }, { once: true });
  else { notifyReady(); scheduleIntelligenceSurface(); }
})(window);
