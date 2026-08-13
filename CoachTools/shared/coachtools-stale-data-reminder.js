(function (root) {
  'use strict';

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const REMINDER_CLASS = 'data-reminder-needed';

  function addStyles() {
    if (document.getElementById('coachtools-stale-data-reminder-styles')) return;
    const style = document.createElement('style');
    style.id = 'coachtools-stale-data-reminder-styles';
    style.textContent = `
      .readiness-button.${REMINDER_CLASS} {
        position: relative;
        z-index: 8;
        border-color: rgba(255,64,93,.9);
        background: rgba(125,20,39,.36);
        color: #fff5f6;
        box-shadow: 0 0 20px rgba(255,55,82,.78), 0 0 38px rgba(255,55,82,.28);
        animation: coachtoolsReminderGlow 1.8s ease-in-out infinite;
      }
      .readiness-button.${REMINDER_CLASS}::before {
        content: '▼';
        position: absolute;
        left: 50%;
        top: -17px;
        transform: translateX(-50%);
        color: #ff405d;
        font-size: 15px;
        line-height: 1;
        pointer-events: none;
        text-shadow: 0 0 8px rgba(255,35,67,.95), 0 2px 3px rgba(0,0,0,.8);
        animation: coachtoolsReminderArrow 1.15s ease-in-out infinite;
      }
      .readiness-button.${REMINDER_CLASS} .system-icon,
      .taskbar-data.${REMINDER_CLASS} .system-icon {
        filter: brightness(1.15) drop-shadow(0 0 7px rgba(255,55,82,.9));
      }
      .readiness-button.${REMINDER_CLASS} .status-dot,
      .taskbar-data.${REMINDER_CLASS} .status-dot {
        background: #ff405d !important;
        box-shadow: 0 0 0 4px rgba(255,64,93,.14), 0 0 13px rgba(255,64,93,.9) !important;
      }
      .taskbar-data.${REMINDER_CLASS} {
        border-color: rgba(255,74,98,.7);
        box-shadow: 0 0 15px rgba(255,55,82,.45);
      }
      @keyframes coachtoolsReminderGlow {
        0%,100% { box-shadow: 0 0 14px rgba(255,55,82,.52), 0 0 28px rgba(255,55,82,.18); }
        50% { box-shadow: 0 0 24px rgba(255,55,82,.9), 0 0 44px rgba(255,55,82,.32); }
      }
      @keyframes coachtoolsReminderArrow {
        0%,100% { transform: translate(-50%,-1px); opacity:.82; }
        50% { transform: translate(-50%,3px); opacity:1; }
      }
      @media (prefers-reduced-motion: reduce) {
        .readiness-button.${REMINDER_CLASS},
        .readiness-button.${REMINDER_CLASS}::before { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function latestTime(values) {
    return (values || []).reduce((latest, value) => {
      const time = value ? new Date(value).getTime() : NaN;
      return Number.isFinite(time) && time > latest ? time : latest;
    }, 0);
  }

  async function getLastUploadTime(statuses) {
    const data = root.CoachToolsData;
    if (data && typeof data.getImportHistory === 'function') {
      try {
        const history = await data.getImportHistory({ limit: 100 });
        const allowed = new Set(['imported', 'replacement', 'duplicate']);
        const time = latestTime((history || []).filter(item => allowed.has(item.action)).map(item => item.importedAt));
        if (time) return time;
      } catch (_) {}
    }
    return latestTime((statuses || []).filter(item => item.ready).map(item => item.updatedAt));
  }

  async function refresh() {
    const storage = root.CoachToolsStorage;
    if (!storage || typeof storage.getDatasetStatus !== 'function') return;
    if (typeof storage.ready === 'function') {
      try { await storage.ready(); } catch (_) {}
    }

    const statuses = storage.getDatasetStatus() || [];
    const ready = statuses.filter(item => item.ready);
    const lastUploadTime = ready.length ? await getLastUploadTime(statuses) : 0;
    const stale = !ready.length || !lastUploadTime || Date.now() - lastUploadTime >= WEEK_MS;
    const readinessButton = document.getElementById('readinessButton');
    const taskbarData = document.querySelector('.taskbar-data');
    if (!readinessButton) return;

    readinessButton.classList.toggle(REMINDER_CLASS, stale);
    if (taskbarData) taskbarData.classList.toggle(REMINDER_CLASS, stale);

    if (stale) {
      const days = lastUploadTime ? Math.floor((Date.now() - lastUploadTime) / 86400000) : null;
      const message = days == null ? 'No CoachTools data has been uploaded yet.' : `Last data upload was ${days} day${days === 1 ? '' : 's'} ago.`;
      readinessButton.title = `${message} Click to review data status.`;
      readinessButton.setAttribute('aria-label', `${message} Open data readiness.`);
      readinessButton.dataset.dataReminder = lastUploadTime ? 'stale' : 'missing';
      if (taskbarData) taskbarData.title = `${message} Click to review data status.`;
    } else {
      readinessButton.removeAttribute('title');
      readinessButton.removeAttribute('aria-label');
      delete readinessButton.dataset.dataReminder;
      if (taskbarData) taskbarData.title = 'Data readiness';
    }
  }

  function start() {
    addStyles();
    refresh().catch(() => {});
    const storage = root.CoachToolsStorage;
    if (storage && typeof storage.subscribe === 'function') storage.subscribe(() => setTimeout(() => refresh().catch(() => {}), 40));
    root.addEventListener('focus', () => refresh().catch(() => {}));
    setInterval(() => refresh().catch(() => {}), 60 * 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
