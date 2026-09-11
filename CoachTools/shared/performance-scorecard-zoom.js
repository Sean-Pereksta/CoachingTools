(function installScorecardZoom(root) {
  'use strict';
  const doc = root.document;
  if (!doc) return;
  const KEY = 'coachtools.performanceScorecard.zoom.v1';
  const MIN = 50, MAX = 150, STEP = 10;
  let percent = 100;
  try {
    const saved = Number(root.localStorage.getItem(KEY));
    if (Number.isFinite(saved) && saved >= MIN && saved <= MAX) percent = Math.round(saved / STEP) * STEP;
  } catch (_) { /* Zoom also works when preferences cannot be stored. */ }

  function refresh() {
    doc.documentElement.style.setProperty('--scorecard-zoom', String(percent / 100));
    doc.querySelectorAll('[data-scorecard-zoom]').forEach(button => {
      const action = button.dataset.scorecardZoom;
      button.disabled = action === 'out' ? percent <= MIN : action === 'in' ? percent >= MAX : false;
      if (action === 'reset') {
        button.textContent = `${percent}%`;
        button.setAttribute('aria-label', `Zoom ${percent} percent. Reset to 100 percent`);
      }
    });
  }
  function set(value) {
    if (!Number.isFinite(Number(value))) return;
    percent = Math.max(MIN, Math.min(MAX, Math.round(Number(value) / STEP) * STEP));
    try { root.localStorage.setItem(KEY, String(percent)); } catch (_) { /* Keep the active setting. */ }
    refresh();
  }
  doc.addEventListener('click', event => {
    const button = event.target.closest('[data-scorecard-zoom]');
    if (!button || button.disabled) return;
    event.preventDefault();
    const action = button.dataset.scorecardZoom;
    set(action === 'reset' ? 100 : percent + (action === 'in' ? STEP : -STEP));
  });
  root.CoachToolsScorecardZoom = { refresh, set, get: () => percent };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', refresh, { once: true });
  refresh();
})(window);
