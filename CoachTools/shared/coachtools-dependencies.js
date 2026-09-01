(function attachCoachToolsDependencies(root) {
  'use strict';

  const VERSION = '1.1.0';
  const pending = new Map();
  const scriptUrl = (() => {
    try { return new URL(root.document.currentScript.src, root.location.href); }
    catch (_) { return null; }
  })();
  const STORAGE_GUIDE_ACTIONS = new Set(['clean-upload-data', 'quick-upload-data']);
  let storageGuideTarget = null;
  let storageGuideAction = '';
  let storageGuideReplay = false;
  let coachChooserObserver = null;

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

  function storageGuideNeeded(action) {
    if (STORAGE_GUIDE_ACTIONS.has(action)) return true;
    return action === 'update-data' && root.location && root.location.protocol === 'file:';
  }

  function ensureGuidanceStyles() {
    const doc = root.document;
    if (!doc || doc.getElementById('coachtoolsUploadGuidanceStyles')) return;
    const style = doc.createElement('style');
    style.id = 'coachtoolsUploadGuidanceStyles';
    style.textContent = `
      #coachtoolsStorageGuide[hidden] { display: none !important; }
      #coachtoolsStorageGuide {
        position: fixed;
        inset: 0;
        z-index: 2147482000;
        display: grid;
        place-items: center;
        padding: 22px;
        background: rgba(2, 8, 23, .78);
        backdrop-filter: blur(7px);
      }
      #coachtoolsStorageGuide .coachtools-storage-guide-card {
        width: min(680px, 100%);
        max-height: min(760px, calc(100vh - 44px));
        overflow: auto;
        border: 1px solid rgba(105, 219, 255, .42);
        border-radius: 20px;
        padding: 22px;
        background: #0f172a;
        color: #f8fafc;
        box-shadow: 0 28px 80px rgba(0, 0, 0, .48), 0 0 0 1px rgba(255, 255, 255, .025) inset;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #coachtoolsStorageGuide .coachtools-storage-guide-kicker {
        margin: 0 0 6px;
        color: #69dbff;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .13em;
        text-transform: uppercase;
      }
      #coachtoolsStorageGuide h2 {
        margin: 0;
        color: #fff;
        font-size: 24px;
        line-height: 1.15;
      }
      #coachtoolsStorageGuide .coachtools-storage-guide-intro {
        margin: 10px 0 16px;
        color: #cbd5e1;
        font-size: 14px;
        line-height: 1.55;
      }
      #coachtoolsStorageGuide .coachtools-storage-folder {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 14px;
        border: 1px solid rgba(105, 219, 255, .24);
        border-radius: 12px;
        padding: 11px 12px;
        background: rgba(105, 219, 255, .08);
        color: #e0f7ff;
        font-size: 13px;
        font-weight: 750;
      }
      #coachtoolsStorageGuide .coachtools-storage-file-list {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      #coachtoolsStorageGuide .coachtools-storage-file-list li {
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        border: 1px solid rgba(148, 163, 184, .2);
        border-radius: 12px;
        padding: 10px 11px;
        background: rgba(255, 255, 255, .035);
      }
      #coachtoolsStorageGuide .coachtools-storage-file-number {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 9px;
        background: rgba(105, 219, 255, .14);
        color: #8be5ff;
        font-size: 12px;
        font-weight: 900;
      }
      #coachtoolsStorageGuide .coachtools-storage-file-list strong {
        display: block;
        color: #fff;
        font-size: 13px;
      }
      #coachtoolsStorageGuide .coachtools-storage-file-list span {
        display: block;
        margin-top: 2px;
        color: #94a3b8;
        font-size: 11px;
        line-height: 1.4;
      }
      #coachtoolsStorageGuide .coachtools-storage-guide-note {
        margin: 14px 0 0;
        color: #e2e8f0;
        font-size: 12px;
        line-height: 1.5;
      }
      #coachtoolsStorageGuide .coachtools-storage-guide-actions {
        display: flex;
        justify-content: flex-end;
        gap: 9px;
        margin-top: 18px;
      }
      #coachtoolsStorageGuide button {
        min-height: 40px;
        border-radius: 10px;
        padding: 0 15px;
        font: 800 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
        cursor: pointer;
      }
      #coachtoolsStorageGuide .coachtools-storage-guide-cancel {
        border: 1px solid rgba(148, 163, 184, .28);
        background: rgba(255, 255, 255, .04);
        color: #cbd5e1;
      }
      #coachtoolsStorageGuide .coachtools-storage-guide-run {
        border: 1px solid rgba(105, 219, 255, .66);
        background: #dff8ff;
        color: #082f49;
        box-shadow: 0 0 0 3px rgba(105, 219, 255, .1);
      }
      .coachtools-specific-coach-callout {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        margin-top: 13px;
        border: 1px solid rgba(105, 219, 255, .55);
        border-radius: 12px;
        padding: 10px 12px;
        background: linear-gradient(135deg, rgba(105, 219, 255, .14), rgba(125, 164, 255, .08));
        box-shadow: 0 0 0 3px rgba(105, 219, 255, .055), 0 10px 26px rgba(0, 0, 0, .12);
        animation: coachtoolsCoachCue 1.05s ease-out 2;
      }
      .coachtools-specific-coach-callout .coachtools-specific-coach-step {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 10px;
        background: #dff8ff;
        color: #082f49;
        font-size: 14px;
        font-weight: 950;
      }
      .coachtools-specific-coach-callout strong {
        display: block;
        color: var(--text, #fff);
        font-size: 11px;
        letter-spacing: .08em;
      }
      .coachtools-specific-coach-callout span {
        display: block;
        margin-top: 2px;
        color: var(--muted, #94a3b8);
        font-size: 8px;
        line-height: 1.45;
      }
      .smart-import-search.coachtools-specific-coach-focus {
        position: relative;
        border: 1px solid rgba(105, 219, 255, .62);
        border-radius: 12px;
        padding: 9px 10px 10px;
        background: rgba(105, 219, 255, .07);
        box-shadow: 0 0 0 3px rgba(105, 219, 255, .06);
      }
      .smart-import-search.coachtools-specific-coach-focus > span:first-child {
        color: #69dbff;
        font-size: 9px;
        letter-spacing: .1em;
      }
      #smartImportSelectedBtn:not(:disabled) {
        box-shadow: 0 0 0 3px rgba(105, 219, 255, .09), 0 8px 18px rgba(0, 0, 0, .14);
      }
      @keyframes coachtoolsCoachCue {
        0% { transform: translateY(0); box-shadow: 0 0 0 0 rgba(105, 219, 255, .2); }
        45% { transform: translateY(-1px); box-shadow: 0 0 0 5px rgba(105, 219, 255, .08); }
        100% { transform: translateY(0); box-shadow: 0 0 0 3px rgba(105, 219, 255, .055), 0 10px 26px rgba(0, 0, 0, .12); }
      }
      @media (prefers-reduced-motion: reduce) {
        .coachtools-specific-coach-callout { animation: none; }
      }
      @media (max-width: 620px) {
        #coachtoolsStorageGuide { padding: 12px; }
        #coachtoolsStorageGuide .coachtools-storage-guide-card { padding: 17px; border-radius: 16px; }
        #coachtoolsStorageGuide h2 { font-size: 20px; }
        #coachtoolsStorageGuide .coachtools-storage-guide-actions { flex-direction: column-reverse; }
        #coachtoolsStorageGuide button { width: 100%; }
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function closeStorageGuide(options) {
    const doc = root.document;
    const guide = doc && doc.getElementById('coachtoolsStorageGuide');
    if (guide) guide.hidden = true;
    if (options && options.restoreFocus && storageGuideTarget && typeof storageGuideTarget.focus === 'function') {
      try { storageGuideTarget.focus(); } catch (_) {}
    }
    if (!(options && options.keepTarget)) {
      storageGuideTarget = null;
      storageGuideAction = '';
    }
  }

  function replayStorageAction() {
    const doc = root.document;
    const action = storageGuideAction;
    const target = storageGuideTarget && storageGuideTarget.isConnected
      ? storageGuideTarget
      : doc && action ? doc.querySelector(`[data-action="${action}"]`) : null;
    closeStorageGuide({ keepTarget: true });
    if (!target) {
      storageGuideTarget = null;
      storageGuideAction = '';
      return;
    }
    storageGuideReplay = true;
    try { target.click(); }
    finally {
      storageGuideReplay = false;
      storageGuideTarget = null;
      storageGuideAction = '';
    }
  }

  function ensureStorageGuide() {
    const doc = root.document;
    if (!doc) return null;
    ensureGuidanceStyles();
    let guide = doc.getElementById('coachtoolsStorageGuide');
    if (guide) return guide;

    guide = doc.createElement('section');
    guide.id = 'coachtoolsStorageGuide';
    guide.hidden = true;
    guide.setAttribute('role', 'dialog');
    guide.setAttribute('aria-modal', 'true');
    guide.setAttribute('aria-labelledby', 'coachtoolsStorageGuideTitle');
    guide.innerHTML = `
      <div class="coachtools-storage-guide-card">
        <p class="coachtools-storage-guide-kicker">Before you choose files</p>
        <h2 id="coachtoolsStorageGuideTitle">Pick the four current source files</h2>
        <p class="coachtools-storage-guide-intro">Go to the <strong>Storage</strong> folder in the same folder as <strong>Index.html</strong>. Select these four current files together.</p>
        <div class="coachtools-storage-folder">Storage folder → select all 4 files in one batch</div>
        <ol class="coachtools-storage-file-list">
          <li><b class="coachtools-storage-file-number">1</b><div><strong>MyOne2view</strong><span>Documented Coaching</span></div></li>
          <li><b class="coachtools-storage-file-number">2</b><div><strong>All_Items</strong><span>Checklist</span></div></li>
          <li><b class="coachtools-storage-file-number">3</b><div><strong>90 day Evaluations</strong><span>QA Scores</span></div></li>
          <li><b class="coachtools-storage-file-number">4</b><div><strong>Retail Weekly or Referral Weekly</strong><span>Weekly stats — choose the one for your department</span></div></li>
        </ol>
        <p class="coachtools-storage-guide-note"><strong>Pick these 4 and run.</strong> CoachTools will identify each source and then take you to the coach-selection step.</p>
        <div class="coachtools-storage-guide-actions">
          <button class="coachtools-storage-guide-cancel" type="button">Cancel</button>
          <button class="coachtools-storage-guide-run" type="button">Pick these 4 and run</button>
        </div>
      </div>`;

    guide.addEventListener('click', event => {
      if (event.target === guide || event.target.closest('.coachtools-storage-guide-cancel')) {
        closeStorageGuide({ restoreFocus: true });
      } else if (event.target.closest('.coachtools-storage-guide-run')) {
        replayStorageAction();
      }
    });
    (doc.body || doc.documentElement).appendChild(guide);
    return guide;
  }

  function openStorageGuide(target, action) {
    const guide = ensureStorageGuide();
    if (!guide) return;
    storageGuideTarget = target;
    storageGuideAction = action;
    const title = guide.querySelector('#coachtoolsStorageGuideTitle');
    if (title) title.textContent = action === 'update-data'
      ? 'Quick Update: pick the four current source files'
      : 'Clean Upload: pick the four current source files';
    guide.hidden = false;
    const run = guide.querySelector('.coachtools-storage-guide-run');
    if (run) root.setTimeout(() => run.focus(), 0);
  }

  function bindStorageGuide() {
    const doc = root.document;
    if (!doc || doc.documentElement?.dataset.coachtoolsStorageGuideBound === 'true') return;
    if (doc.documentElement) doc.documentElement.dataset.coachtoolsStorageGuideBound = 'true';

    doc.addEventListener('click', event => {
      if (storageGuideReplay) return;
      const target = event.target && event.target.closest && event.target.closest('[data-action]');
      const action = target && target.dataset && target.dataset.action || '';
      if (!storageGuideNeeded(action)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openStorageGuide(target, action);
    }, true);

    doc.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const guide = doc.getElementById('coachtoolsStorageGuide');
      if (!guide || guide.hidden) return;
      event.preventDefault();
      closeStorageGuide({ restoreFocus: true });
    });
  }

  function enhanceSpecificCoachChooser() {
    const doc = root.document;
    const chooser = doc && doc.getElementById('smartImportChooser');
    if (!chooser) return;
    ensureGuidanceStyles();

    const controls = chooser.querySelector('.smart-import-controls');
    const search = chooser.querySelector('.smart-import-search');
    if (controls && !chooser.querySelector('.coachtools-specific-coach-callout')) {
      const callout = doc.createElement('div');
      callout.className = 'coachtools-specific-coach-callout';
      callout.innerHTML = `
        <b class="coachtools-specific-coach-step">1</b>
        <div><strong>SELECT A SPECIFIC COACH</strong><span>Start here: search the coach's name, then check the matching coach result below.</span></div>`;
      controls.before(callout);
    }
    if (search) {
      search.classList.add('coachtools-specific-coach-focus');
      const label = search.querySelector('span');
      if (label) label.textContent = 'Specific coach — search here';
      const input = search.querySelector('input');
      if (input) input.placeholder = 'Search the coach you want to load…';
    }
  }

  function watchSpecificCoachChooser() {
    const doc = root.document;
    if (!doc || coachChooserObserver || typeof root.MutationObserver !== 'function') return;
    enhanceSpecificCoachChooser();
    coachChooserObserver = new root.MutationObserver(mutations => {
      const addedChooser = mutations.some(mutation => Array.from(mutation.addedNodes || []).some(node =>
        node && node.nodeType === 1 && (node.id === 'smartImportChooser' || (node.querySelector && node.querySelector('#smartImportChooser')))
      ));
      if (addedChooser) enhanceSpecificCoachChooser();
    });
    coachChooserObserver.observe(doc.documentElement || doc, { childList: true, subtree: true });
  }

  function installUploadGuidance() {
    if (!root.document) return;
    bindStorageGuide();
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', () => {
        ensureGuidanceStyles();
        watchSpecificCoachChooser();
      }, { once: true });
    } else {
      ensureGuidanceStyles();
      watchSpecificCoachChooser();
    }
  }

  root.CoachToolsDependencies = Object.freeze({
    VERSION,
    ensureXlsx: () => ensure('XLSX', '../vendor/xlsx.full.min.js', 'SheetJS'),
    ensureLzString: () => ensure('LZString', '../vendor/lz-string.min.js', 'LZ-String'),
    ensureJsZip: () => ensure('JSZip', '../vendor/jszip.min.js', 'JSZip')
  });

  installUploadGuidance();
  loadDataManagerControls();
})(window);