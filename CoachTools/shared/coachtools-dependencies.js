(function attachCoachToolsDependencies(root) {
  'use strict';

  const VERSION = '1.0.0';
  const pending = new Map();
  const scriptUrl = (() => {
    try { return new URL(root.document.currentScript.src, root.location.href); }
    catch (_) { return null; }
  })();

  function localUrl(relativePath) {
    if (scriptUrl) return new URL(relativePath, scriptUrl).href;
    return relativePath.replace(/^\.\.\//, '');
  }

  function ensure(globalName, relativePath, label) {
    if (root[globalName]) return Promise.resolve(root[globalName]);
    if (pending.has(globalName)) return pending.get(globalName);
    if (!root.document) return Promise.reject(new Error(`${label} requires a browser document.`));

    const promise = new Promise((resolve, reject) => {
      const source = localUrl(relativePath);
      const existing = Array.from(root.document.scripts).find(script => script.src === source);
      const script = existing || root.document.createElement('script');
      const finish = () => root[globalName]
        ? resolve(root[globalName])
        : reject(new Error(`${label} loaded without exposing ${globalName}.`));
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', () => reject(new Error(`Could not load local ${label}.`)), { once: true });
      if (!existing) {
        script.src = source;
        script.async = true;
        script.dataset.coachtoolsDependency = globalName;
        root.document.head.appendChild(script);
      } else if (root[globalName]) finish();
    }).catch(error => {
      pending.delete(globalName);
      throw error;
    });
    pending.set(globalName, promise);
    return promise;
  }

  function loadDataManagerControls() {
    if (!root.document) return;
    const appId = root.document.querySelector('meta[name="coachtools-id"]')?.content || '';
    if (appId !== 'weekly-data') return;
    const source = localUrl('coachtools-data-manager-controls.js');
    if (Array.from(root.document.scripts).some(script => script.src === source)) return;
    const script = root.document.createElement('script');
    script.src = source;
    script.async = true;
    script.dataset.coachtoolsDependency = 'DataManagerControls';
    root.document.head.appendChild(script);
  }

  root.CoachToolsDependencies = Object.freeze({
    VERSION,
    ensureXlsx: () => ensure('XLSX', '../vendor/xlsx.full.min.js', 'SheetJS'),
    ensureLzString: () => ensure('LZString', '../vendor/lz-string.min.js', 'LZ-String'),
    ensureJsZip: () => ensure('JSZip', '../vendor/jszip.min.js', 'JSZip')
  });

  loadDataManagerControls();
})(window);