(function attachCoachToolsShell(root) {
  'use strict';

  const shellScript = document.currentScript;
  const sharedBase = shellScript && shellScript.src ? new URL('.', shellScript.src) : null;
  const intelligenceApps = new Set(['people-profiles', 'coaching-gaps', 'kpi-impact', 'qa-scores', 'coach-timeline']);
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
