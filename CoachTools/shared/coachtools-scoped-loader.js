(function attachScopedLoader(root) {
  'use strict';

  // Keep the completed scoped batch for synchronous report parsers. The shared
  // owner's transient cache can expire while identity learning is finishing.
  function create({data = root.CoachToolsAppData, types, apply, onError}) {
    let batch = Object.create(null), batchScope = null;
    let revision = 0, job = null, timer = null, ready = false, closed = false;
    const scopeKey = () => data.getScopeKey();
    const reportError = error => {
      if (!closed && typeof onError === 'function') onError(error);
    };

    function refresh() {
      if (closed) return Promise.resolve();
      revision++;
      if (job) return job;
      job = (async () => {
        let completed = 0;
        while (!closed && completed !== revision) {
          const requested = revision, scope = scopeKey();
          try {
            const loaded = await data.getMany(types, {progressUi: !ready});
            if (closed) return;
            if (requested !== revision || scope !== scopeKey()) continue;
            batch = loaded;
            batchScope = scope;
            completed = requested;
            if (ready) apply();
          } catch (error) {
            if (closed) return;
            if (requested !== revision || scope !== scopeKey()) continue;
            throw error;
          }
        }
      })().finally(() => { job = null; });
      return job;
    }

    function schedule(detail) {
      if (closed) return;
      root.clearTimeout(timer);
      timer = null;
      const run = () => {
        timer = null;
        refresh().catch(reportError);
      };
      if (detail?.reason === 'scope') {
        batch = Object.create(null);
        batchScope = null;
        if (ready) apply();
        run();
      } else {
        // Let identity/import notification bursts settle before requesting
        // their replacement, including when a read is already in progress.
        timer = root.setTimeout(run, 120);
      }
    }

    const unsubscribe = data.subscribe(types, schedule);
    function close() {
      closed = true;
      root.clearTimeout(timer);
      timer = null;
      unsubscribe();
    }
    root.addEventListener('pagehide', close, {once: true});
    return Object.freeze({
      refresh,
      activate() { ready = true; },
      peek(type) { return !closed && batchScope === scopeKey() ? batch[type] || null : null; },
      close
    });
  }

  root.CoachToolsScopedLoader = Object.freeze({create});
})(window);
