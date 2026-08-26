(function enhanceCoachToolsDesktop(root) {
  'use strict';

  function syncScopeAppearance() {
    const select = document.getElementById('globalScopeSelect');
    const label = select && select.closest('.global-scope');
    if (!select || !label) return;
    label.classList.toggle('has-specific-scope', Boolean(select.value && select.value !== 'all:'));
  }

  function findMinimizedTaskbarApp(appName) {
    return Array.from(document.querySelectorAll('#taskbarOpen .taskbar-app.minimized')).find(button => {
      const name = button.querySelector('.taskbar-app-name');
      return name && name.textContent.trim() === appName;
    }) || null;
  }

  function restoreMinimizedAppFallback(event) {
    const target = event.target && event.target.closest
      ? event.target.closest('.app-card[data-app-id]')
      : null;
    if (!target) return;

    const nameNode = target.querySelector('.app-name');
    const appName = nameNode ? nameNode.textContent.trim() : '';
    if (!appName) return;

    root.setTimeout(() => {
      const minimizedButton = findMinimizedTaskbarApp(appName);
      if (!minimizedButton) return;

      // The desktop's normal double-click path should restore an existing window.
      // If the app is still minimized after that handler completes, use the
      // taskbar's known-good activation path rather than leaving the click inert.
      minimizedButton.click();
    }, 0);
  }

  function start() {
    const select = document.getElementById('globalScopeSelect');
    if (select) {
      select.addEventListener('change', syncScopeAppearance);
      const observer = new MutationObserver(syncScopeAppearance);
      observer.observe(select, { childList: true, subtree: true });
      syncScopeAppearance();
    }

    document.addEventListener('dblclick', restoreMinimizedAppFallback);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(window);
