(function attachCoachToolsDiagnostics(root) {
  'use strict';

  try {
    if (root.parent && root.parent !== root && root.parent.CoachToolsDiagnostics) {
      root.CoachToolsDiagnostics = root.parent.CoachToolsDiagnostics;
      return;
    }
  } catch (_) {}

  const VERSION = '1.2.0';
  const starts = new Map();
  const entries = [];
  const PROFILE_APP_ID = 'people-profiles';
  const HEAVY_CLOSE_APP_IDS = new Set(['allstar']);
  const OPEN_APPS_KEY = 'coachtools.desktop.openApps.v1';
  const parkedApps = new Set();
  const patchedProfileFrames = new WeakSet();
  const now = () => root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now();

  function start(name, detail) {
    const key = String(name || 'operation');
    starts.set(key, { at: now(), detail: detail || null });
    try { root.performance.mark(`coachtools:${key}:start`); } catch (_) {}
    return key;
  }

  function end(name, detail) {
    const key = String(name || 'operation');
    const started = starts.get(key);
    const duration = Math.max(0, now() - (started ? started.at : now()));
    starts.delete(key);
    const entry = { name: key, duration, at: new Date().toISOString(), detail: detail || started && started.detail || null };
    entries.push(entry);
    if (entries.length > 80) entries.splice(0, entries.length - 80);
    try {
      root.performance.mark(`coachtools:${key}:end`);
      root.performance.measure(`coachtools:${key}`, `coachtools:${key}:start`, `coachtools:${key}:end`);
    } catch (_) {}
    return entry;
  }

  async function measure(name, operation, detail) {
    start(name, detail);
    try { return await operation(); }
    finally { end(name); }
  }

  function activePane() {
    return root.document && root.document.querySelector('.window-pane:not([hidden])');
  }

  function stripParkedFromOpenApps() {
    try {
      const raw = root.localStorage.getItem(OPEN_APPS_KEY);
      if (!raw) return;
      const payload = JSON.parse(raw);
      if (!payload || !Array.isArray(payload.ids)) return;
      payload.ids = payload.ids.filter(id => !parkedApps.has(id));
      if (parkedApps.has(payload.activeId)) payload.activeId = '';
      if (Array.isArray(payload.minimized)) payload.minimized = payload.minimized.filter(id => !parkedApps.has(id));
      root.localStorage.setItem(OPEN_APPS_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  function hideParkedTaskbarEntries() {
    if (!root.document || !parkedApps.size) return;
    for (const button of root.document.querySelectorAll('.taskbar-app')) {
      const label = String(button.querySelector('.taskbar-app-name')?.textContent || button.title || '').toLowerCase();
      const pane = Array.from(root.document.querySelectorAll('.window-pane[data-app-id]')).find(candidate => {
        if (!parkedApps.has(candidate.dataset.appId)) return false;
        const iframeTitle = String(candidate.querySelector('iframe')?.title || '').toLowerCase();
        return iframeTitle && label.includes(iframeTitle);
      });
      if (pane) button.hidden = true;
    }
  }

  function warmCloseActiveApp(event) {
    const control = event.target && event.target.closest && event.target.closest('[data-action="close-active"]');
    if (!control) return false;
    const pane = activePane();
    const appId = pane && pane.dataset && pane.dataset.appId;
    if (!appId || !HEAVY_CLOSE_APP_IDS.has(appId)) return false;

    event.preventDefault();
    event.stopImmediatePropagation();
    parkedApps.add(appId);
    pane.dataset.coachtoolsParked = 'true';
    const iframe = pane.querySelector('iframe');
    try { iframe?.contentWindow?.postMessage({ type: 'coachtools:cancel-data-loads' }, '*'); } catch (_) {}

    start(`Warm close · ${appId}`, { strategy: 'park-heavy-iframe' });
    const minimize = root.document.querySelector('[data-action="minimize-app"]');
    if (minimize) minimize.click();
    root.requestAnimationFrame(() => {
      stripParkedFromOpenApps();
      hideParkedTaskbarEntries();
      end(`Warm close · ${appId}`, { parked: true });
    });
    return true;
  }

  function restoreParkedAppIfActivated() {
    if (!parkedApps.size || !root.document) return;
    for (const appId of Array.from(parkedApps)) {
      const pane = root.document.querySelector(`.window-pane[data-app-id="${appId}"]`);
      if (!pane || pane.hidden) continue;
      parkedApps.delete(appId);
      delete pane.dataset.coachtoolsParked;
      for (const button of root.document.querySelectorAll('.taskbar-app[hidden]')) button.hidden = false;
    }
    hideParkedTaskbarEntries();
  }

  function ensureProfileProgress(doc) {
    let overlay = doc.getElementById('coachtoolsProfileProgress');
    if (overlay) return overlay;

    const style = doc.createElement('style');
    style.dataset.coachtoolsProfileProgress = 'true';
    style.textContent = `
      #coachtoolsProfileProgress{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(243,246,249,.78);backdrop-filter:blur(5px);padding:22px}
      #coachtoolsProfileProgress[hidden]{display:none}
      #coachtoolsProfileProgress .ctpp-card{width:min(520px,calc(100vw - 44px));border:1px solid #dbe5ec;border-radius:18px;background:rgba(255,255,255,.98);box-shadow:0 22px 70px rgba(31,55,74,.18);padding:20px}
      #coachtoolsProfileProgress .ctpp-title{font-size:15px;font-weight:900;color:#14212d}
      #coachtoolsProfileProgress .ctpp-stage{margin-top:5px;color:#667786;font-size:11px;line-height:1.4}
      #coachtoolsProfileProgress .ctpp-track{height:10px;margin-top:15px;border-radius:999px;background:#e6edf2;overflow:hidden;position:relative}
      #coachtoolsProfileProgress .ctpp-fill{height:100%;width:16%;border-radius:999px;background:linear-gradient(90deg,#247bb5,#50b6d9);transition:width .22s ease;position:relative;overflow:hidden}
      #coachtoolsProfileProgress .ctpp-fill:after{content:'';position:absolute;inset:0;width:45%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.65),transparent);transform:translateX(-120%);animation:ctppSweep 1.15s linear infinite}
      #coachtoolsProfileProgress .ctpp-meta{display:flex;justify-content:space-between;gap:12px;margin-top:8px;color:#667786;font-size:10px;font-weight:800}
      @keyframes ctppSweep{to{transform:translateX(320%)}}
    `;
    doc.head.appendChild(style);

    overlay = doc.createElement('section');
    overlay.id = 'coachtoolsProfileProgress';
    overlay.hidden = true;
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = '<div class="ctpp-card"><div class="ctpp-title">Loading profile</div><div class="ctpp-stage">Connecting current CoachTools data…</div><div class="ctpp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="16"><div class="ctpp-fill"></div></div><div class="ctpp-meta"><span>Shared data</span><span class="ctpp-person"></span></div></div>';
    doc.body.appendChild(overlay);
    return overlay;
  }

  function setProfileProgress(overlay, percent, stage, person) {
    if (!overlay) return;
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    overlay.hidden = false;
    overlay.querySelector('.ctpp-fill').style.width = `${value}%`;
    overlay.querySelector('.ctpp-track').setAttribute('aria-valuenow', String(Math.round(value)));
    if (stage) overlay.querySelector('.ctpp-stage').textContent = stage;
    if (person != null) overlay.querySelector('.ctpp-person').textContent = person;
  }

  function hideProfileProgress(overlay) {
    if (!overlay) return;
    setProfileProgress(overlay, 100, 'Profile ready');
    root.setTimeout(() => { overlay.hidden = true; }, 180);
  }

  function patchProfileBuildCache(frameRoot, overlay) {
    const profiles = frameRoot.CoachToolsProfiles;
    if (!profiles || typeof profiles.buildProfile !== 'function' || profiles.__coachtoolsCachedBuildProfile) return;
    const originalBuildProfile = profiles.buildProfile.bind(profiles);
    const cacheByRecords = new WeakMap();

    function cachedBuildProfile(personId, people, records, historyRecords) {
      const cacheable = records && typeof records === 'object' && people && typeof people === 'object';
      let context = cacheable ? cacheByRecords.get(records) : null;
      if (!context || context.people !== people || context.historyRecords !== historyRecords) {
        context = { people, historyRecords, profiles: new Map() };
        if (cacheable) cacheByRecords.set(records, context);
      }
      if (context.profiles.has(personId)) {
        frameRoot.__CoachToolsProfileCacheLastHit = true;
        return context.profiles.get(personId);
      }
      frameRoot.__CoachToolsProfileCacheLastHit = false;
      setProfileProgress(overlay, 34, 'Analyzing coaching, checklist, QA, and performance data…');
      start('People Profile build', { personId });
      try {
        const profile = originalBuildProfile(personId, people, records, historyRecords);
        context.profiles.set(personId, profile);
        return profile;
      } finally {
        end('People Profile build', { personId, cached: false });
        setProfileProgress(overlay, 82, 'Building profile insights and visual sections…');
      }
    }

    try {
      frameRoot.CoachToolsProfiles = Object.freeze({ ...profiles, buildProfile: cachedBuildProfile, __coachtoolsCachedBuildProfile: true });
    } catch (_) {}
  }

  function patchPeopleProfilesFrame(iframe) {
    if (!iframe || patchedProfileFrames.has(iframe)) return;
    let frameRoot, doc;
    try { frameRoot = iframe.contentWindow; doc = iframe.contentDocument; } catch (_) { return; }
    if (!frameRoot || !doc || !doc.body) return;
    patchedProfileFrames.add(iframe);
    const overlay = ensureProfileProgress(doc);
    patchProfileBuildCache(frameRoot, overlay);

    doc.addEventListener('click', event => {
      if (event.__coachtoolsProfileReplay || event.button && event.button !== 0) return;
      const personTarget = event.target && event.target.closest && event.target.closest('[data-person-id]');
      if (!personTarget || personTarget.closest('#identityModal')) return;
      const personName = personTarget.querySelector('b')?.textContent || personTarget.textContent?.trim().split('\n')[0] || 'Selected person';

      event.preventDefault();
      event.stopImmediatePropagation();
      setProfileProgress(overlay, 16, 'Preparing the selected person…', personName);
      frameRoot.requestAnimationFrame(() => {
        setProfileProgress(overlay, 26, 'Connecting current CoachTools data…', personName);
        frameRoot.requestAnimationFrame(() => {
          const replay = new frameRoot.MouseEvent('click', { bubbles: true, cancelable: true, view: frameRoot, button: 0 });
          try { Object.defineProperty(replay, '__coachtoolsProfileReplay', { value: true }); } catch (_) { replay.__coachtoolsProfileReplay = true; }
          personTarget.dispatchEvent(replay);
        });
      });
    }, true);

    const content = doc.getElementById('content');
    if (content) {
      const observer = new frameRoot.MutationObserver(() => {
        if (overlay.hidden) return;
        if (content.querySelector('.error')) {
          setProfileProgress(overlay, 100, 'Profile load finished with an error');
          root.setTimeout(() => { overlay.hidden = true; }, 350);
        } else if (content.querySelector('.profile')) {
          hideProfileProgress(overlay);
        }
      });
      observer.observe(content, { childList: true, subtree: true });
    }
  }

  function inspectFrames() {
    if (!root.document) return;
    for (const iframe of root.document.querySelectorAll('.window-pane iframe[data-app-id]')) {
      if (iframe.dataset.appId !== PROFILE_APP_ID) continue;
      const patch = () => patchPeopleProfilesFrame(iframe);
      try {
        if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') patch();
      } catch (_) {}
      if (!iframe.dataset.coachtoolsProfilePatchListener) {
        iframe.dataset.coachtoolsProfilePatchListener = 'true';
        iframe.addEventListener('load', patch);
      }
    }
  }

  function installSuitePerformancePatches() {
    if (!root.document || root.parent !== root) return;
    root.document.addEventListener('click', warmCloseActiveApp, true);
    const observer = new MutationObserver(() => {
      inspectFrames();
      restoreParkedAppIfActivated();
      hideParkedTaskbarEntries();
    });
    const startObserver = () => {
      observer.observe(root.document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
      inspectFrames();
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    else startObserver();
  }

  root.CoachToolsDiagnostics = Object.freeze({
    VERSION, start, end, measure,
    getEntries: () => entries.slice().sort((left, right) => Date.parse(right.at) - Date.parse(left.at)),
    clear: () => { entries.length = 0; starts.clear(); }
  });

  installSuitePerformancePatches();
})(window);
