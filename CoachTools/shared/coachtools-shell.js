(function attachCoachToolsShell(root) {
  'use strict';

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

  function notifyReady() {
    post('coachtools:app-ready', { title: document.title });
  }

  function requestDesktop() {
    post('coachtools:show-desktop');
  }

  function requestPopOut() {
    post('coachtools:pop-out', { file: location.href });
  }

  root.addEventListener('error', event => {
    post('coachtools:app-error', { message: event.message || 'Application error' });
  });

  root.addEventListener('unhandledrejection', event => {
    post('coachtools:app-error', { message: String(event.reason && event.reason.message || event.reason || 'Unhandled application error') });
  });

  root.addEventListener('message', event => {
    if (event.data?.type === 'coachtools:data-updated') {
      try { root.dispatchEvent(new CustomEvent('coachtools:data-updated', { detail: event.data.detail || {} })); } catch (_) {}
    }
  });

  root.CoachToolsShell = Object.freeze({ app, post, notifyReady, requestDesktop, requestPopOut });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', notifyReady, { once: true });
  else notifyReady();
})(window);
