(function startCoachToolsDesktop(root) {
  'use strict';

  const manifest = root.COACHTOOLS_MANIFEST || { schemaVersion: 1, suite: { name: 'CoachTools', version: '2.0' }, apps: [] };
  const APP_ICON_PATHS = Object.freeze({
    allstar: 'icons/allstar.png',
    'weekly-data': 'icons/weekly-data.png',
    'coaching-gaps': 'icons/coaching-gaps.png',
    'coach-timeline': 'icons/coach-timeline.png',
    'kpi-impact': 'icons/kpi-impact.png',
    'qa-scores': 'icons/qa-scores.png',
    'audit-checklist': 'icons/audit-checklist.png'
  });
  const SYSTEM_ICON_PATHS = Object.freeze({
    'coachtools-home': 'icons/coachtools-home.png',
    start: 'icons/coachtools-home.png',
    'shared-data': 'icons/shared-data.png',
    'backup-restore': 'icons/backup-restore.png',
    settings: 'icons/settings.png',
    'all-apps': 'icons/all-apps.png',
    'default-app': 'icons/default-app.png',
    'weekly-data': 'icons/weekly-data.png'
  });
  const DEFAULT_APP_ICON = SYSTEM_ICON_PATHS['default-app'];
  const apps = (manifest.apps || [])
    .filter(app => app && app.enabled !== false)
    .map(app => ({ ...app, icon: APP_ICON_PATHS[app.id] || app.icon || DEFAULT_APP_ICON }));
  const byId = new Map(apps.map(app => [app.id, app]));
  const storage = root.CoachToolsStorage;
  const importer = root.CoachToolsImport;
  const FAVORITES_KEY = 'coachtools.desktop.favorites.v1';
  const RECENT_KEY = 'coachtools.desktop.recent.v1';
  const OPEN_APPS_KEY = 'coachtools.desktop.openApps.v1';
  const STORAGE_SCAN_KEY = 'coachtools.desktop.storageScan.v1';
  const MAX_RECENT = 8;
  const FILTERS = Object.freeze(['All', 'Favorites', 'Core', 'Data', 'Coaching', 'Performance', 'Quality', 'Needs Data']);
  const elements = {};
  const openWindows = new Map();
  const state = {
    query: '',
    filter: 'All',
    favorites: new Set(),
    recent: [],
    selectedAppId: null,
    activeAppId: null,
    contextApp: null,
    toastTimer: null,
    clockTimer: null,
    autoScanRunning: false,
    startupScanActive: false,
    startupStartedAt: 0,
    startupDismissTimer: null,
    progressSteps: [],
    pendingStageFiles: [],
    pendingStageSent: false,
    lastScan: null,
    iconFailures: new Set()
  };

  function $(id) { return document.getElementById(id); }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function initials(app) {
    if (app.initials) return String(app.initials).slice(0, 4).toUpperCase();
    const ignored = new Set(['and', 'the', 'tool', 'report']);
    const words = String(app.name || app.id || 'App').split(/[^a-z0-9]+/i).filter(Boolean).filter(word => !ignored.has(word.toLowerCase()));
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.slice(0, 3).map(word => word[0]).join('').toUpperCase();
  }

  function formatBytes(bytes) {
    const number = Number(bytes) || 0;
    if (number < 1024) return number + ' B';
    if (number < 1024 * 1024) return (number / 1024).toFixed(1) + ' KB';
    return (number / (1024 * 1024)).toFixed(number < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  }

  function formatDate(value) {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function showToast(message, duration) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, duration || 3800);
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function nextPaint() {
    return new Promise(resolve => root.requestAnimationFrame(() => resolve()));
  }

  function appendImageWithFallback(wrap, primaryPath, failureKey) {
    const paths = Array.from(new Set([primaryPath, DEFAULT_APP_ICON].filter(Boolean)));
    if (!paths.length) return;
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'eager';
    image.decoding = 'async';
    let pathIndex = 0;

    const loadNextPath = () => {
      const path = paths[pathIndex];
      pathIndex += 1;
      if (!path) {
        image.remove();
        return;
      }
      image.src = path;
    };

    image.addEventListener('load', () => wrap.classList.add('loaded'));
    image.addEventListener('error', () => {
      wrap.classList.remove('loaded');
      if (failureKey) state.iconFailures.add(failureKey);
      loadNextPath();
    });
    wrap.appendChild(image);
    loadNextPath();
  }

  function createIcon(app, compact) {
    const wrap = document.createElement('span');
    wrap.className = 'app-icon' + (compact ? ' compact' : '');
    const fallback = document.createElement('span');
    fallback.className = 'fallback-initials';
    fallback.textContent = initials(app);
    wrap.appendChild(fallback);
    appendImageWithFallback(wrap, app.icon, app.id);
    return wrap;
  }

  function createSystemIcon(name, fallbackText, className) {
    const wrap = document.createElement('span');
    wrap.className = ['system-icon', className || ''].filter(Boolean).join(' ');
    wrap.setAttribute('aria-hidden', 'true');
    const fallback = document.createElement('span');
    fallback.className = 'system-icon-fallback';
    fallback.textContent = fallbackText || '✦';
    wrap.appendChild(fallback);
    appendImageWithFallback(wrap, SYSTEM_ICON_PATHS[name] || DEFAULT_APP_ICON, `system:${name}`);
    return wrap;
  }

  function hydrateSystemIcons() {
    for (const placeholder of document.querySelectorAll('[data-system-icon]')) {
      const icon = createSystemIcon(
        placeholder.dataset.systemIcon,
        placeholder.dataset.iconFallback,
        Array.from(placeholder.classList).filter(name => name !== 'system-icon').join(' ')
      );
      placeholder.replaceWith(icon);
    }
  }

  function preloadIconAssets() {
    if (typeof root.Image !== 'function') return;
    const paths = new Set([
      ...Object.values(APP_ICON_PATHS),
      ...Object.values(SYSTEM_ICON_PATHS)
    ]);
    for (const path of paths) {
      const image = new root.Image();
      image.decoding = 'async';
      image.src = path;
    }
  }

  function setStartupProgress(percent, stage, summary, count) {
    if (!elements.startupSplash || elements.startupSplash.hidden) return;
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    elements.startupProgressFill.style.width = value + '%';
    elements.startupProgressFill.parentElement.setAttribute('aria-valuenow', String(Math.round(value)));
    if (stage != null) elements.startupStage.textContent = stage;
    if (summary != null) elements.startupSummary.textContent = summary;
    if (count != null) elements.startupCount.textContent = count;
  }

  function renderStartupDatasets(statuses) {
    if (!elements.startupDatasets) return;
    elements.startupDatasets.replaceChildren(...(statuses || []).map(status => {
      const item = document.createElement('span');
      item.className = 'startup-dataset' + (status.ready ? ' ready' : '');
      const label = document.createElement('strong');
      label.textContent = status.label;
      const value = document.createElement('small');
      value.textContent = status.ready ? 'Ready' : 'Missing';
      item.append(label, value);
      return item;
    }));
  }

  function currentDatasetStatuses() {
    return storage && storage.getDatasetStatus ? storage.getDatasetStatus() : [];
  }

  function dismissStartupSplash() {
    if (!elements.startupSplash || elements.startupSplash.hidden) return;
    elements.startupSplash.classList.add('is-leaving');
    clearTimeout(state.startupDismissTimer);
    state.startupDismissTimer = setTimeout(() => { elements.startupSplash.hidden = true; }, 240);
  }

  function missingRequirements(app) {
    const required = Array.isArray(app.data) ? app.data : [];
    return required.filter(source => !storage || !storage.has(source));
  }

  function appSearchText(app) {
    return [app.name, app.description, app.category, ...(app.keywords || [])].join(' ').toLowerCase();
  }

  function sortedApps(list) {
    return list.slice().sort((left, right) => {
      const orderDifference = (Number(left.order) || 9999) - (Number(right.order) || 9999);
      return orderDifference || String(left.name).localeCompare(String(right.name));
    });
  }

  function filteredApps() {
    const query = state.query.trim().toLowerCase();
    return sortedApps(apps.filter(app => {
      if (state.filter === 'Favorites' && !state.favorites.has(app.id)) return false;
      if (state.filter === 'Needs Data' && !missingRequirements(app).length) return false;
      if (!['All', 'Favorites', 'Needs Data'].includes(state.filter) && app.category !== state.filter) return false;
      return !query || appSearchText(app).includes(query);
    }));
  }

  function isTouchMode() {
    return Boolean(root.matchMedia && root.matchMedia('(hover: none), (pointer: coarse)').matches);
  }

  function toggleFavorite(app) {
    if (!app) return;
    if (state.favorites.has(app.id)) state.favorites.delete(app.id);
    else state.favorites.add(app.id);
    writeJson(FAVORITES_KEY, Array.from(state.favorites));
    renderApps();
  }

  function selectApp(app) {
    state.selectedAppId = app ? app.id : null;
    for (const tile of elements.appGrid.querySelectorAll('[data-app-id]')) {
      const selected = tile.dataset.appId === state.selectedAppId;
      tile.classList.toggle('selected', selected);
      tile.setAttribute('aria-selected', String(selected));
    }
  }

  function createAppCard(app) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'app-card' + (state.selectedAppId === app.id ? ' selected' : '');
    tile.dataset.appId = app.id;
    tile.setAttribute('role', 'option');
    tile.setAttribute('aria-selected', String(state.selectedAppId === app.id));
    tile.setAttribute('aria-label', `${app.name}. ${missingRequirements(app).length ? 'Needs data.' : 'Ready.'}`);

    const main = document.createElement('span');
    main.className = 'app-card-main';
    main.appendChild(createIcon(app));
    const name = document.createElement('span');
    name.className = 'app-name';
    name.textContent = app.name;
    main.appendChild(name);
    tile.appendChild(main);

    const status = document.createElement('span');
    status.className = 'app-status' + (missingRequirements(app).length ? '' : ' ready');
    status.title = missingRequirements(app).length ? 'Needs shared data' : 'Data requirements ready';
    tile.appendChild(status);
    if (state.favorites.has(app.id)) {
      const favorite = document.createElement('span');
      favorite.className = 'favorite-badge';
      favorite.textContent = '★';
      favorite.title = 'Favorite';
      tile.appendChild(favorite);
    }

    tile.addEventListener('click', () => {
      if (isTouchMode()) openApp(app);
      else selectApp(app);
    });
    tile.addEventListener('dblclick', event => {
      event.preventDefault();
      openApp(app);
    });
    tile.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        openApp(app);
      }
    });
    tile.addEventListener('contextmenu', event => {
      event.preventDefault();
      selectApp(app);
      showContextMenu(app, event.clientX, event.clientY);
    });
    return tile;
  }

  function renderApps() {
    const visible = filteredApps();
    elements.appGrid.replaceChildren(...visible.map(createAppCard));
    elements.emptyState.hidden = visible.length > 0;
    const labels = {
      All: 'All applications',
      Favorites: 'Favorite applications',
      'Needs Data': 'Applications needing data'
    };
    elements.desktopTitle.textContent = labels[state.filter] || state.filter;
  }

  function renderCategories() {
    elements.categoryFilters.replaceChildren(...FILTERS.map(filter => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'category-filter' + (state.filter === filter ? ' active' : '');
      if (filter === 'All') {
        button.classList.add('with-icon');
        button.appendChild(createSystemIcon('all-apps', '▦', 'inline'));
        const label = document.createElement('span');
        label.textContent = filter;
        button.appendChild(label);
      } else {
        button.textContent = filter;
      }
      button.addEventListener('click', () => {
        state.filter = filter;
        state.selectedAppId = null;
        renderCategories();
        renderApps();
      });
      return button;
    }));
  }

  function pushRecent(app) {
    state.recent = [app.id, ...state.recent.filter(id => id !== app.id && byId.has(id))].slice(0, MAX_RECENT);
    writeJson(RECENT_KEY, state.recent);
  }

  function scopeText(scope) {
    if (!scope) return 'All available coaches';
    if (scope.label) return scope.label;
    if (scope.mode === 'team' && scope.team) return scope.team;
    if (scope.mode === 'coordinator' && scope.coordinator) return scope.coordinator;
    if (Array.isArray(scope.coaches) && scope.coaches.length === 1) return scope.coaches[0];
    if (Array.isArray(scope.coaches) && scope.coaches.length > 1) return `${scope.coaches.length} selected coaches`;
    return 'All available coaches';
  }

  function renderDataStatus() {
    const statuses = storage && storage.getDatasetStatus ? storage.getDatasetStatus() : [];
    elements.datasetStatus.replaceChildren(...statuses.map(item => {
      const row = document.createElement('div');
      row.className = 'dataset-item' + (item.ready ? ' ready' : '');
      const copy = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = item.label;
      const meta = document.createElement('small');
      meta.textContent = item.ready
        ? [item.fileName, item.updatedAt ? formatDate(item.updatedAt) : ''].filter(Boolean).join(' · ') || formatBytes(item.bytes)
        : 'No shared dataset loaded';
      copy.append(label, meta);
      const value = document.createElement('strong');
      value.textContent = item.ready ? 'Ready' : 'Missing';
      row.append(copy, value);
      return row;
    }));
    const ready = statuses.filter(item => item.ready).length;
    const total = statuses.length || 5;
    elements.readyCount.textContent = `${ready}/${total} Data`;
    elements.taskbarReadyCount.textContent = `${ready}/${total}`;
    elements.readinessButton.classList.toggle('ready', ready === total && ready > 0);
    elements.taskbarData.classList.toggle('ready', ready === total && ready > 0);
    elements.scopeLabel.textContent = scopeText(storage && storage.getScope ? storage.getScope() : null);
    elements.storageAvailability.textContent = location.protocol === 'file:'
      ? 'Automatic storage-folder loading is available when CoachTools is started with START COACHTOOLS. Manual Weekly Data import remains available.'
      : 'Storage scanning is available from the local CoachTools launcher.';
    renderApps();
  }

  function requirementNotice(app) {
    const missing = missingRequirements(app);
    if (!missing.length) return '';
    const labels = missing.map(id => storage && storage.LABELS && storage.LABELS[id] || id).join(', ');
    return `Missing data: ${labels}. The app can still open.`;
  }

  function persistOpenWindows() {
    const payload = {
      version: 1,
      ids: Array.from(openWindows.keys()),
      activeId: state.activeAppId,
      minimized: Array.from(openWindows.values()).filter(item => item.minimized).map(item => item.app.id)
    };
    writeJson(OPEN_APPS_KEY, payload);
  }

  function showUnavailable(windowState) {
    if (!windowState) return;
    clearTimeout(windowState.loadTimer);
    windowState.loading.hidden = true;
    windowState.unavailable.hidden = false;
    windowState.unavailablePath.textContent = `Missing or unreadable: ${windowState.app.file}`;
  }

  function createWindow(app, options) {
    if (openWindows.has(app.id)) return openWindows.get(app.id);
    const pane = document.createElement('section');
    pane.className = 'window-pane';
    pane.dataset.appId = app.id;
    pane.hidden = true;

    const iframe = document.createElement('iframe');
    iframe.title = app.name;
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');

    const loading = document.createElement('div');
    loading.className = 'frame-message';
    const ring = document.createElement('span');
    ring.className = 'loader-ring';
    const loadingText = document.createElement('strong');
    loadingText.textContent = `Opening ${app.name}…`;
    loading.append(ring, loadingText);

    const unavailable = document.createElement('div');
    unavailable.className = 'frame-message error';
    unavailable.hidden = true;
    const errorMark = document.createElement('span');
    errorMark.textContent = '!';
    const errorTitle = document.createElement('strong');
    errorTitle.textContent = 'App unavailable';
    const unavailablePath = document.createElement('p');
    const desktopButton = document.createElement('button');
    desktopButton.type = 'button';
    desktopButton.className = 'command-button';
    desktopButton.textContent = 'Return to desktop';
    desktopButton.addEventListener('click', () => minimizeWindow(app.id));
    unavailable.append(errorMark, errorTitle, unavailablePath, desktopButton);

    pane.append(iframe, loading, unavailable);
    elements.windowLayer.appendChild(pane);
    const windowState = {
      app,
      pane,
      iframe,
      loading,
      unavailable,
      unavailablePath,
      minimized: Boolean(options && options.minimized),
      loaded: false,
      loadTimer: null,
      lastActivated: 0
    };
    openWindows.set(app.id, windowState);

    iframe.addEventListener('load', () => {
      clearTimeout(windowState.loadTimer);
      windowState.loaded = true;
      windowState.loading.hidden = true;
      windowState.unavailable.hidden = true;
      if (app.id === 'weekly-data') {
        state.pendingStageSent = false;
        deliverPendingStageFiles(windowState);
      }
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.URL === 'about:blank' && app.file !== 'about:blank') showUnavailable(windowState);
      } catch (_) {
        // Local file iframe isolation differs between browsers; a load event is sufficient.
      }
    });
    iframe.addEventListener('error', () => showUnavailable(windowState));
    windowState.loadTimer = setTimeout(() => { windowState.loading.hidden = true; }, 12000);
    iframe.src = app.file;
    renderTaskbar();
    persistOpenWindows();
    return windowState;
  }

  function renderTaskbar() {
    elements.taskbarOpen.replaceChildren(...Array.from(openWindows.values()).map(windowState => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'taskbar-app';
      if (state.activeAppId === windowState.app.id) button.classList.add('active');
      if (windowState.minimized) button.classList.add('minimized');
      button.title = `${windowState.app.name}${windowState.minimized ? ' · minimized' : ''}`;
      button.appendChild(createIcon(windowState.app, true));
      const name = document.createElement('span');
      name.className = 'taskbar-app-name';
      name.textContent = windowState.app.name;
      button.appendChild(name);
      button.addEventListener('click', () => {
        if (state.activeAppId === windowState.app.id) minimizeWindow(windowState.app.id);
        else activateWindow(windowState.app.id);
      });
      button.addEventListener('contextmenu', event => {
        event.preventDefault();
        showContextMenu(windowState.app, event.clientX, event.clientY);
      });
      return button;
    }));
  }

  function activateWindow(appId) {
    const windowState = openWindows.get(appId);
    if (!windowState) return;
    state.activeAppId = appId;
    windowState.minimized = false;
    windowState.lastActivated = Date.now();
    for (const [id, candidate] of openWindows) candidate.pane.hidden = id !== appId;
    elements.desktop.hidden = true;
    elements.workspace.hidden = false;
    elements.workspaceTitle.textContent = windowState.app.name;
    elements.workspaceNotice.textContent = requirementNotice(windowState.app);
    pushRecent(windowState.app);
    closeMenus();
    renderTaskbar();
    persistOpenWindows();
    deliverPendingStageFiles(windowState);
  }

  function openApp(app) {
    if (!app || !app.file) return;
    if (!openWindows.has(app.id)) createWindow(app);
    activateWindow(app.id);
  }

  function minimizeWindow(appId) {
    const id = appId || state.activeAppId;
    const windowState = id && openWindows.get(id);
    const wasActive = state.activeAppId === id;
    if (windowState) {
      windowState.minimized = true;
      windowState.pane.hidden = true;
    }
    if (wasActive) {
      state.activeAppId = null;
      elements.workspace.hidden = true;
      elements.desktop.hidden = false;
    }
    closeMenus();
    renderTaskbar();
    renderDataStatus();
    persistOpenWindows();
  }

  function showDesktop() {
    minimizeWindow(state.activeAppId);
  }

  function closeWindow(appId) {
    const id = appId || state.activeAppId;
    const windowState = id && openWindows.get(id);
    if (!windowState) return;
    clearTimeout(windowState.loadTimer);
    windowState.pane.remove();
    openWindows.delete(id);
    if (state.activeAppId === id) {
      state.activeAppId = null;
      elements.workspace.hidden = true;
      elements.desktop.hidden = false;
    }
    renderTaskbar();
    persistOpenWindows();
  }

  function popOut(app) {
    if (!app || !app.file) return;
    const opened = root.open(app.file, `coachtools_${app.id}`);
    if (!opened) showToast('Your browser blocked the new window. Allow pop-ups for CoachTools and try again.');
  }

  function reloadActive() {
    const windowState = state.activeAppId && openWindows.get(state.activeAppId);
    if (!windowState) return;
    windowState.unavailable.hidden = true;
    windowState.loading.hidden = false;
    windowState.loaded = false;
    state.pendingStageSent = false;
    clearTimeout(windowState.loadTimer);
    windowState.loadTimer = setTimeout(() => { windowState.loading.hidden = true; }, 12000);
    try { windowState.iframe.contentWindow.location.reload(); }
    catch (_) { windowState.iframe.src = windowState.app.file; }
  }

  function showContextMenu(app, x, y) {
    state.contextApp = app;
    const favoriteAction = elements.contextMenu.querySelector('[data-context-action="favorite"]');
    const closeAction = elements.contextMenu.querySelector('[data-context-action="close"]');
    favoriteAction.textContent = state.favorites.has(app.id) ? 'Unfavorite' : 'Favorite';
    closeAction.hidden = !openWindows.has(app.id);
    elements.contextMenu.hidden = false;
    const bounds = elements.contextMenu.getBoundingClientRect();
    elements.contextMenu.style.left = Math.max(7, Math.min(x, root.innerWidth - bounds.width - 7)) + 'px';
    elements.contextMenu.style.top = Math.max(7, Math.min(y, root.innerHeight - bounds.height - 7)) + 'px';
  }

  function closeMenus(options) {
    elements.startMenu.hidden = true;
    elements.startButton.setAttribute('aria-expanded', 'false');
    elements.contextMenu.hidden = true;
    if (!options || !options.keepDataPanel) {
      elements.dataPanel.hidden = true;
      elements.readinessButton.setAttribute('aria-expanded', 'false');
    }
  }

  function toggleDataPanel() {
    const opening = elements.dataPanel.hidden;
    closeMenus({ keepDataPanel: true });
    elements.dataPanel.hidden = !opening;
    elements.readinessButton.setAttribute('aria-expanded', String(opening));
    if (opening) renderDataStatus();
  }

  function showAppDetails(app) {
    if (!app) return;
    const container = document.createElement('div');
    const hero = document.createElement('div');
    hero.className = 'details-hero';
    hero.appendChild(createIcon(app));
    const copy = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = app.name;
    const description = document.createElement('p');
    description.textContent = app.description || 'No description supplied.';
    copy.append(heading, description);
    hero.appendChild(copy);
    container.appendChild(hero);

    const grid = document.createElement('div');
    grid.className = 'details-grid';
    const data = Array.isArray(app.data) && app.data.length ? app.data.map(id => storage && storage.LABELS && storage.LABELS[id] || id).join(', ') : 'No shared dataset required';
    const rows = [
      ['Category', app.category || 'Other'],
      ['Version', app.version || '1.0'],
      ['HTML file', app.file],
      ['Icon file', app.icon || 'Initials fallback'],
      ['Data sources', data],
      ['Session', openWindows.has(app.id) ? (openWindows.get(app.id).minimized ? 'Open · minimized' : 'Open') : 'Closed'],
      ['Data status', missingRequirements(app).length ? 'Opens with a data warning' : 'Ready']
    ];
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'detail-row';
      const labelElement = document.createElement('span');
      labelElement.textContent = label;
      const valueElement = document.createElement('strong');
      valueElement.textContent = value;
      row.append(labelElement, valueElement);
      grid.appendChild(row);
    }
    container.appendChild(grid);

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'command-button';
    open.textContent = 'Open';
    open.addEventListener('click', () => { elements.detailsDialog.close && elements.detailsDialog.close(); openApp(app); });
    const newWindow = document.createElement('button');
    newWindow.type = 'button';
    newWindow.className = 'command-button secondary';
    newWindow.textContent = 'Open in new window';
    newWindow.addEventListener('click', () => popOut(app));
    actions.append(open, newWindow);
    container.appendChild(actions);
    elements.detailsContent.replaceChildren(container);
    openDialog(elements.detailsDialog);
  }

  function diagnosticSection(title, rows) {
    const section = document.createElement('section');
    section.className = 'diagnostic-card';
    const heading = document.createElement('h3');
    heading.textContent = title;
    section.appendChild(heading);
    const list = document.createElement('ul');
    list.className = 'diagnostic-list';
    for (const [label, value] of rows) {
      const item = document.createElement('li');
      const labelElement = document.createElement('span');
      labelElement.textContent = label;
      const valueElement = document.createElement('strong');
      valueElement.textContent = value;
      item.append(labelElement, valueElement);
      list.appendChild(item);
    }
    section.appendChild(list);
    return section;
  }

  function showDiagnostics() {
    const statuses = storage && storage.getDatasetStatus ? storage.getDatasetStatus() : [];
    const size = storage && storage.getApproximateStorageSize ? storage.getApproximateStorageSize() : { bytes: 0, entries: 0 };
    const minimized = Array.from(openWindows.values()).filter(item => item.minimized).map(item => item.app.name);
    const scan = state.lastScan || readJson(STORAGE_SCAN_KEY, null) || {};
    const content = document.createElement('div');
    content.className = 'diagnostics-grid';
    content.appendChild(diagnosticSection('Desktop', [
      ['Open applications', String(openWindows.size)],
      ['Active application', state.activeAppId && byId.get(state.activeAppId) ? byId.get(state.activeAppId).name : 'Desktop'],
      ['Minimized', minimized.length ? minimized.join(', ') : 'None'],
      ['Remembered on refresh', 'Yes · app list only'],
      ['Icon fallbacks in use', String(state.iconFailures.size)]
    ]));
    content.appendChild(diagnosticSection('Storage folder', [
      ['Automatic scanning', location.protocol === 'file:' ? 'No · direct-file mode' : (scan.available === false ? 'Unavailable' : 'Yes')],
      ['Supported files found', String(scan.fileCount || 0)],
      ['Last scan', scan.scannedAt ? formatDate(scan.scannedAt) : 'Not scanned'],
      ['Ambiguous files', scan.ambiguous && scan.ambiguous.length ? scan.ambiguous.join(', ') : 'None'],
      ['Most recent result', scan.summary || 'No automatic import attempted']
    ]));
    content.appendChild(diagnosticSection('Shared datasets', statuses.map(item => [
      item.label,
      item.ready ? `Ready · ${formatBytes(item.bytes)}${item.fileName ? ` · ${item.fileName}` : ''}${item.updatedAt ? ` · ${formatDate(item.updatedAt)}` : ''}` : 'Missing'
    ])));
    content.appendChild(diagnosticSection('Suite', [
      ['Manifest schema', String(manifest.schemaVersion || 1)],
      ['Suite version', String(manifest.suite && manifest.suite.version || '2.0')],
      ['Applications', String(apps.length)],
      ['Storage entries', String(size.entries)],
      ['Approximate browser storage', formatBytes(size.bytes)]
    ]));
    elements.diagnosticsContent.replaceChildren(content);
    openDialog(elements.diagnosticsDialog);
  }

  function showAbout() {
    const version = manifest.suite && manifest.suite.version || '2.0';
    elements.aboutSummary.textContent = manifest.suite && manifest.suite.description || 'A portable desktop for your coaching analytics tools.';
    const ready = storage && storage.getDatasetStatus ? storage.getDatasetStatus().filter(item => item.ready).length : 0;
    const facts = [[version, 'Version'], [String(apps.length), 'Applications'], [`${ready}/5`, 'Data ready']];
    elements.aboutFacts.replaceChildren(...facts.map(([value, label]) => {
      const item = document.createElement('div');
      item.className = 'about-fact';
      const strong = document.createElement('strong');
      strong.textContent = value;
      const span = document.createElement('span');
      span.textContent = label;
      item.append(strong, span);
      return item;
    }));
    openDialog(elements.aboutDialog);
  }

  function downloadBackup() {
    try {
      const backup = storage.createBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `CoachTools_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 3000);
      const skipped = backup.skipped && backup.skipped.length || 0;
      showToast(`Backup created${skipped ? ` · ${skipped} oversized item${skipped === 1 ? '' : 's'} skipped` : ''}.`);
    } catch (error) {
      showToast('Backup failed: ' + (error && error.message || error), 6000);
    }
  }

  async function restoreBackup(file) {
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const approved = root.confirm('Restore this CoachTools backup? Shared weekly data and included settings will replace current values.');
      if (!approved) return;
      const result = storage.restoreBackup(backup);
      renderDataStatus();
      showToast(`Backup restored · ${result.restoredKeys.length} storage item${result.restoredKeys.length === 1 ? '' : 's'}.`);
    } catch (error) {
      showToast('Restore failed: ' + (error && error.message || error), 6500);
    } finally {
      elements.restoreInput.value = '';
    }
  }

  function weeklyDataApp() {
    return byId.get('weekly-data') || apps.find(item => /weekly|loader|data builder/i.test(item.name));
  }

  function openWeeklyData() {
    const app = weeklyDataApp();
    if (app) openApp(app);
    else showToast('Weekly Data is not present in the application manifest.');
  }

  function renderProgressSteps() {
    elements.importSteps.replaceChildren(...state.progressSteps.map(step => {
      const item = document.createElement('li');
      item.className = 'progress-step ' + step.status;
      item.textContent = step.label;
      return item;
    }));
  }

  function setProgressStep(label, status) {
    const existing = state.progressSteps.find(step => step.label === label);
    if (existing) existing.status = status;
    else state.progressSteps.push({ label, status });
    if (state.startupScanActive && status === 'active') {
      setStartupProgress(Number(elements.startupProgressFill.style.width.replace('%', '')) || 12, label, null, null);
    }
    renderProgressSteps();
  }

  function setImportProgress(percent, currentSource, currentFile, count, summary) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    if (state.startupScanActive) {
      setStartupProgress(value, currentSource, summary || currentFile, count);
      return;
    }
    elements.importProgressFill.style.width = value + '%';
    elements.importProgressFill.parentElement.setAttribute('aria-valuenow', String(Math.round(value)));
    if (currentSource != null) elements.importCurrentSource.textContent = currentSource;
    if (currentFile != null) elements.importCurrentFile.textContent = currentFile;
    if (count != null) elements.importCount.textContent = count;
    if (summary != null) elements.importSummary.textContent = summary;
  }

  function beginImportProgress(options) {
    state.startupScanActive = Boolean(options && options.startup);
    state.progressSteps = [];
    if (state.startupScanActive) {
      setStartupProgress(18, 'Scanning storage', 'Recognizable files were found. Checking only the missing shared datasets…', '0 of 5');
      renderProgressSteps();
      return;
    }
    elements.importProgress.hidden = false;
    elements.importClose.hidden = true;
    elements.importReview.hidden = true;
    setImportProgress(0, 'Scanning storage', '', '0 of 5', 'Looking for recognizable weekly files…');
    renderProgressSteps();
  }

  function finishImportProgress(summary, options) {
    if (state.startupScanActive) {
      renderStartupDatasets(currentDatasetStatuses());
      setStartupProgress(100, options && options.warning ? 'Data review available' : 'Shared data ready', summary, options && options.count || '5 of 5');
      return;
    }
    setImportProgress(100, options && options.warning ? 'Review needed' : 'Ready', '', options && options.count || '5 of 5', summary);
    elements.importClose.hidden = false;
    elements.importReview.hidden = !(options && options.review);
  }

  function saveScanRecord(record) {
    state.lastScan = { ...record, scannedAt: new Date().toISOString() };
    writeJson(STORAGE_SCAN_KEY, state.lastScan);
  }

  function safelyNamedFile(blob, metadata) {
    return new File([blob], metadata.filename, {
      type: blob.type || (metadata.extension === '.csv' ? 'text/csv' : 'application/octet-stream'),
      lastModified: Date.parse(metadata.modifiedTime) || Date.now()
    });
  }

  function hasReusableScope(scope) {
    return Boolean(scope && (scope.mode === 'all' || Array.isArray(scope.coaches) && scope.coaches.length > 0));
  }

  function deliverPendingStageFiles(windowState) {
    if (!windowState || windowState.app.id !== 'weekly-data' || !windowState.loaded || !state.pendingStageFiles.length || state.pendingStageSent) return;
    try {
      windowState.iframe.contentWindow.postMessage({ type: 'coachtools:stage-files', files: state.pendingStageFiles }, '*');
      state.pendingStageSent = true;
    } catch (_) {
      state.pendingStageSent = false;
    }
  }

  async function scanStorage(options) {
    const manual = Boolean(options && options.manual);
    const startup = Boolean(options && options.startup);
    if (state.autoScanRunning) {
      if (manual) showToast('A storage scan is already running.');
      return;
    }
    if (startup) {
      state.startupScanActive = true;
      setStartupProgress(14, 'Checking shared data', 'Looking for missing datasets without replacing anything already saved…', null);
    }
    const statuses = currentDatasetStatuses();
    const missing = statuses.filter(item => !item.ready).map(item => item.datasetType || item.id);
    if (!missing.length) {
      if (startup) setStartupProgress(100, 'Shared data ready', 'All five shared data sources are already available.', '5 of 5 ready');
      if (manual) showToast('All five shared data sources are already loaded. Nothing was replaced.');
      return;
    }
    if (location.protocol === 'file:') {
      saveScanRecord({ available: false, fileCount: 0, ambiguous: [], summary: 'Direct-file mode · manual import available' });
      if (startup) setStartupProgress(86, 'Desktop ready', `${statuses.filter(item => item.ready).length} of 5 data sources ready · use START COACHTOOLS for automatic storage loading.`, `${statuses.filter(item => item.ready).length} of 5 ready`);
      if (manual) showToast('Start CoachTools with START COACHTOOLS to scan storage. Manual Weekly Data import is still available.', 5800);
      return;
    }
    if (!importer) {
      if (startup) setStartupProgress(86, 'Desktop ready', 'Shared import utilities are unavailable. Manual Weekly Data import remains available.', `${statuses.filter(item => item.ready).length} of 5 ready`);
      if (manual) showToast('The shared import utility is unavailable. Use Weekly Data for manual import.', 5600);
      return;
    }

    state.autoScanRunning = true;
    if (startup) setStartupProgress(20, 'Checking storage folder', `Searching for ${missing.length} missing data source${missing.length === 1 ? '' : 's'}…`, `${statuses.filter(item => item.ready).length} of 5 ready`);
    let listing;
    try {
      const response = await fetch('/api/storage', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Storage scan returned ${response.status}`);
      listing = await response.json();
    } catch (error) {
      state.autoScanRunning = false;
      saveScanRecord({ available: false, fileCount: 0, ambiguous: [], summary: 'Storage API unavailable' });
      if (startup) setStartupProgress(88, 'Desktop ready', 'Storage scanning is unavailable. Existing data is unchanged and manual import remains available.', `${statuses.filter(item => item.ready).length} of 5 ready`);
      if (manual) showToast('Storage scanning is unavailable. Manual Weekly Data import remains available.', 5600);
      return;
    }

    const listedFiles = Array.isArray(listing && listing.files) ? listing.files : [];
    if (!listedFiles.length) {
      state.autoScanRunning = false;
      saveScanRecord({ available: true, fileCount: 0, ambiguous: [], summary: 'No supported storage files found' });
      if (startup) setStartupProgress(92, 'Desktop ready', 'No XLSX, XLS, or CSV files were found in CoachTools/storage. Existing data is unchanged.', `${statuses.filter(item => item.ready).length} of 5 ready`);
      if (manual) showToast('No XLSX, XLS, or CSV files were found in CoachTools/storage.');
      return;
    }

    beginImportProgress({ startup });
    setProgressStep('Scanning storage', 'success');
    setProgressStep('Reading files', 'active');
    setImportProgress(8, 'Reading files', '', `0 of ${listedFiles.length}`, `${listedFiles.length} supported file${listedFiles.length === 1 ? '' : 's'} found.`);
    await nextPaint();

    const missingSet = new Set(missing);
    const parsedEntries = [];
    const ambiguous = [];
    const skipped = [];
    for (let index = 0; index < listedFiles.length; index += 1) {
      const metadata = listedFiles[index];
      const preview = importer.classifyFile({ name: metadata.filename }, { workbook: { sheets: [], data: {} } });
      if (preview.id && !missingSet.has(preview.id)) {
        skipped.push(metadata.filename);
        setImportProgress(8 + ((index + 1) / listedFiles.length) * 37, 'Checking existing data', metadata.filename, `${index + 1} of ${listedFiles.length}`);
        continue;
      }
      try {
        setImportProgress(8 + (index / listedFiles.length) * 37, 'Reading files', metadata.filename, `${index + 1} of ${listedFiles.length}`);
        await nextPaint();
        const response = await fetch(metadata.url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`File returned ${response.status}`);
        const file = safelyNamedFile(await response.blob(), metadata);
        const parsed = await importer.parseFile(file, {
          onProgress(progress) {
            const fraction = progress.total ? progress.current / progress.total : 0;
            setImportProgress(8 + ((index + fraction) / listedFiles.length) * 37, 'Reading files', `${metadata.filename} · ${progress.sheetName || ''}`, `${index + 1} of ${listedFiles.length}`);
          }
        });
        const classification = importer.classifyFile(file, parsed);
        parsedEntries.push({ metadata, file, parsed, classification });
      } catch (error) {
        ambiguous.push(`${metadata.filename} (${error && error.message || error})`);
      }
    }

    setProgressStep('Reading files', 'success');
    setProgressStep('Identifying sources', 'active');
    setImportProgress(48, 'Identifying sources', '', `0 of ${missing.length}`, 'Matching files to missing CoachTools datasets…');
    await nextPaint();

    const candidatesBySource = new Map();
    for (const entry of parsedEntries) {
      const id = entry.classification.id;
      if (!id || !missingSet.has(id)) {
        if (!id) ambiguous.push(entry.metadata.filename);
        else skipped.push(entry.metadata.filename);
        continue;
      }
      if (!candidatesBySource.has(id)) candidatesBySource.set(id, []);
      candidatesBySource.get(id).push(entry);
    }

    const selected = [];
    for (const id of missing) {
      const candidates = candidatesBySource.get(id) || [];
      if (candidates.length === 1) selected.push({ id, ...candidates[0] });
      else if (candidates.length > 1) ambiguous.push(...candidates.map(entry => `${entry.metadata.filename} (${importer.SOURCES[id].label} duplicate)`));
    }
    setProgressStep('Identifying sources', selected.length ? 'success' : 'warning');

    if (!selected.length) {
      state.pendingStageFiles = parsedEntries.map(entry => entry.file);
      state.pendingStageSent = false;
      setProgressStep('Saving shared data', 'warning');
      const summary = `No missing source could be classified safely. ${ambiguous.length} file${ambiguous.length === 1 ? '' : 's'} need manual placement.`;
      saveScanRecord({ available: true, fileCount: listedFiles.length, ambiguous, skipped, loaded: [], summary });
      finishImportProgress(summary, { warning: true, review: state.pendingStageFiles.length > 0, count: `${statuses.filter(item => item.ready).length} of 5` });
      state.autoScanRunning = false;
      return;
    }

    setProgressStep('Building selected data', 'active');
    const scope = storage && storage.getScope ? storage.getScope() : null;
    const reusableScope = hasReusableScope(scope);
    const prepared = [];
    for (let index = 0; index < selected.length; index += 1) {
      const entry = selected[index];
      const label = importer.SOURCES[entry.id].label;
      setImportProgress(52 + ((index + 1) / selected.length) * 23, `Parsing ${label}`, entry.metadata.filename, `${index + 1} of ${selected.length}`);
      await nextPaint();
      const dataset = importer.prepareDataset(entry.parsed, entry.id, { scope: reusableScope ? scope : null });
      prepared.push({ ...entry, dataset });
    }
    setProgressStep('Building selected data', 'success');

    setProgressStep('Saving shared data', 'active');
    const written = [];
    let writeError = null;
    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index];
      if (storage.has(entry.id)) continue;
      try {
        setImportProgress(77 + ((index + 1) / prepared.length) * 20, `Saving ${importer.SOURCES[entry.id].label}`, entry.metadata.filename, `${index + 1} of ${prepared.length}`);
        await nextPaint();
        await root.CoachToolsData.importDataset(entry.id, entry.dataset, {
          originalFileName: entry.metadata.filename,
          fileSize: entry.metadata.size,
          fileModifiedDate: entry.metadata.modifiedTime,
          rowCount: entry.dataset.meta && entry.dataset.meta.totalRows || 0,
          detectedPeriod: entry.classification.detectedPeriod,
          classificationMethod: entry.classification.classificationMethod || entry.classification.reason,
          automaticImport: true,
          scopeLabel: reusableScope && scope && scope.label || 'All available coaches'
        });
        written.push(entry.id);
      } catch (error) {
        writeError = error;
        break;
      }
    }

    if (writeError) {
      for (const id of written) await root.CoachToolsData.removeDataset(id);
      state.pendingStageFiles = parsedEntries.map(entry => entry.file);
      state.pendingStageSent = false;
      setProgressStep('Saving shared data', 'error');
      const summary = 'Automatic storage could not fit safely. No existing dataset was replaced; choose a smaller scope in Weekly Data.';
      saveScanRecord({ available: true, fileCount: listedFiles.length, ambiguous, skipped, loaded: [], error: String(writeError && writeError.message || writeError), summary });
      finishImportProgress(summary, { warning: true, review: true, count: `${statuses.filter(item => item.ready).length} of 5` });
      state.autoScanRunning = false;
      renderDataStatus();
      return;
    }

    setProgressStep('Saving shared data', 'success');
    setProgressStep('Ready', ambiguous.length ? 'warning' : 'success');
    renderDataStatus();
    const after = storage.getDatasetStatus();
    const readyCount = after.filter(item => item.ready).length;
    const missingLabels = after.filter(item => !item.ready).map(item => item.label);
    const summary = `${readyCount} of 5 data sources ready${written.length ? ` · ${written.length} loaded automatically` : ''}${missingLabels.length ? ` · ${missingLabels.join(', ')} require manual selection` : ''}.`;
    state.pendingStageFiles = ambiguous.length ? parsedEntries.filter(entry => !written.includes(entry.classification.id)).map(entry => entry.file) : [];
    state.pendingStageSent = false;
    saveScanRecord({ available: true, fileCount: listedFiles.length, ambiguous, skipped, loaded: written, summary });
    finishImportProgress(summary, { warning: Boolean(missingLabels.length || ambiguous.length), review: state.pendingStageFiles.length > 0, count: `${readyCount} of 5` });
    state.autoScanRunning = false;
  }

  function reviewStagedFiles() {
    elements.importProgress.hidden = true;
    openWeeklyData();
    const windowState = openWindows.get('weekly-data');
    deliverPendingStageFiles(windowState);
  }

  function handleAction(action) {
    if (action === 'open-weekly-data') openWeeklyData();
    if (action === 'scan-storage') scanStorage({ manual: true });
    if (action === 'diagnostics') showDiagnostics();
    if (action === 'about') showAbout();
    if (action === 'backup') downloadBackup();
    if (action === 'restore') elements.restoreInput.click();
    if (action === 'show-desktop' || action === 'minimize-app') showDesktop();
    if (action === 'reload-app') reloadActive();
    if (action === 'popout-active') popOut(state.activeAppId && byId.get(state.activeAppId));
    if (action === 'close-active') closeWindow(state.activeAppId);
    if (action === 'toggle-data-panel') toggleDataPanel();
    if (action === 'close-data-panel') closeMenus();
    if (action === 'dismiss-import') elements.importProgress.hidden = true;
    if (action === 'review-staged-files') reviewStagedFiles();
    if (action === 'clear-search') {
      state.query = '';
      state.filter = 'All';
      state.selectedAppId = null;
      elements.appSearch.value = '';
      renderCategories();
      renderApps();
    }
  }

  function bind() {
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-action]') && event.target.closest('[data-action]').dataset.action;
      if (action) {
        event.preventDefault();
        handleAction(action);
        if (action !== 'toggle-data-panel') {
          elements.startMenu.hidden = true;
          elements.startButton.setAttribute('aria-expanded', 'false');
          elements.contextMenu.hidden = true;
        }
        return;
      }
      if (!event.target.closest('#startMenu') && !event.target.closest('#startButton') && !event.target.closest('#appContextMenu')) {
        elements.startMenu.hidden = true;
        elements.startButton.setAttribute('aria-expanded', 'false');
        elements.contextMenu.hidden = true;
      }
      if (!event.target.closest('#dataPanel') && !event.target.closest('[data-action="toggle-data-panel"]')) {
        elements.dataPanel.hidden = true;
        elements.readinessButton.setAttribute('aria-expanded', 'false');
      }
      if (!event.target.closest('[data-app-id]')) selectApp(null);
    });

    elements.startButton.addEventListener('click', event => {
      event.stopPropagation();
      const opening = elements.startMenu.hidden;
      closeMenus();
      elements.startMenu.hidden = !opening;
      elements.startButton.setAttribute('aria-expanded', String(opening));
    });

    elements.contextMenu.addEventListener('click', event => {
      const action = event.target.closest('[data-context-action]') && event.target.closest('[data-context-action]').dataset.contextAction;
      const app = state.contextApp;
      if (!action || !app) return;
      if (action === 'open') openApp(app);
      if (action === 'popout') popOut(app);
      if (action === 'favorite') toggleFavorite(app);
      if (action === 'details') showAppDetails(app);
      if (action === 'close') closeWindow(app.id);
      closeMenus();
    });

    elements.appSearch.addEventListener('input', event => {
      state.query = event.target.value;
      state.selectedAppId = null;
      renderApps();
    });

    document.addEventListener('keydown', event => {
      if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement && document.activeElement.tagName || '')) {
        event.preventDefault();
        elements.appSearch.focus();
      }
      if (event.key === 'Escape') closeMenus();
    });

    elements.restoreInput.addEventListener('change', event => restoreBackup(event.target.files && event.target.files[0]));

    root.addEventListener('message', event => {
      const type = event.data && event.data.type;
      const windowState = Array.from(openWindows.values()).find(item => item.iframe.contentWindow === event.source) || null;
      if (type === 'coachtools:app-ready' && windowState) {
        clearTimeout(windowState.loadTimer);
        windowState.loaded = true;
        windowState.loading.hidden = true;
        deliverPendingStageFiles(windowState);
      }
      if (type === 'coachtools:show-desktop' && windowState) minimizeWindow(windowState.app.id);
      if (type === 'coachtools:pop-out' && windowState) popOut(windowState.app);
      if (type === 'coachtools:app-error' && windowState && state.activeAppId === windowState.app.id) {
        elements.workspaceNotice.textContent = String(event.data.detail && event.data.detail.message || 'Application error');
      }
      if (type === 'coachtools:storage-stage-result' && windowState && windowState.app.id === 'weekly-data') {
        state.pendingStageFiles = [];
        state.pendingStageSent = false;
      }
      if (type === 'coachtools:data-updated' || type === 'coachtools:scope-updated') renderDataStatus();
    });
    root.addEventListener('coachtools:data-updated', renderDataStatus);
    root.addEventListener('coachtools:scope-updated', renderDataStatus);
  }

  function collectElements() {
    Object.assign(elements, {
      wallpaper: $('wallpaper'),
      startupSplash: $('startupSplash'),
      startupProgressFill: $('startupProgressFill'),
      startupSummary: $('startupSummary'),
      startupStage: $('startupStage'),
      startupCount: $('startupCount'),
      startupDatasets: $('startupDatasets'),
      desktop: $('desktop'),
      workspace: $('workspace'),
      windowLayer: $('windowLayer'),
      workspaceTitle: $('workspaceTitle'),
      workspaceNotice: $('workspaceNotice'),
      appGrid: $('appGrid'),
      emptyState: $('emptyState'),
      desktopTitle: $('desktopTitle'),
      appSearch: $('appSearch'),
      categoryFilters: $('categoryFilters'),
      taskbarOpen: $('taskbarOpen'),
      taskbarData: document.querySelector('.taskbar-data'),
      readyCount: $('readyCount'),
      taskbarReadyCount: $('taskbarReadyCount'),
      taskbarClock: $('taskbarClock'),
      readinessButton: $('readinessButton'),
      dataPanel: $('dataPanel'),
      datasetStatus: $('datasetStatus'),
      scopeLabel: $('scopeLabel'),
      storageAvailability: $('storageAvailability'),
      startButton: $('startButton'),
      startMenu: $('startMenu'),
      contextMenu: $('appContextMenu'),
      importProgress: $('importProgress'),
      importProgressFill: $('importProgressFill'),
      importSummary: $('importSummary'),
      importCurrentSource: $('importCurrentSource'),
      importCurrentFile: $('importCurrentFile'),
      importCount: $('importCount'),
      importSteps: $('importSteps'),
      importClose: $('importClose'),
      importReview: $('importReview'),
      detailsDialog: $('detailsDialog'),
      detailsContent: $('detailsContent'),
      diagnosticsDialog: $('diagnosticsDialog'),
      diagnosticsContent: $('diagnosticsContent'),
      aboutDialog: $('aboutDialog'),
      aboutSummary: $('aboutSummary'),
      aboutFacts: $('aboutFacts'),
      restoreInput: $('restoreInput'),
      toast: $('toast')
    });
  }

  function detectWallpaper() {
    const image = new Image();
    image.addEventListener('load', () => {
      elements.wallpaper.style.backgroundImage = 'url("graphics/background.png")';
      elements.wallpaper.classList.add('has-wallpaper');
    }, { once: true });
    image.addEventListener('error', () => {
      elements.wallpaper.classList.remove('has-wallpaper');
      elements.wallpaper.style.backgroundImage = '';
    }, { once: true });
    image.src = 'graphics/background.png';
  }

  function updateClock() {
    const now = new Date();
    elements.taskbarClock.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    elements.taskbarClock.dateTime = now.toISOString();
    elements.taskbarClock.title = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function restoreOpenWindows() {
    const saved = readJson(OPEN_APPS_KEY, null);
    if (!saved || Number(saved.version) !== 1 || !Array.isArray(saved.ids)) return;
    const minimized = new Set(Array.isArray(saved.minimized) ? saved.minimized : []);
    for (const id of saved.ids.filter(id => byId.has(id)).slice(0, apps.length)) {
      createWindow(byId.get(id), { minimized: minimized.has(id) || id !== saved.activeId });
    }
    if (saved.activeId && openWindows.has(saved.activeId) && !minimized.has(saved.activeId)) activateWindow(saved.activeId);
    else {
      elements.workspace.hidden = true;
      elements.desktop.hidden = false;
      renderTaskbar();
    }
  }

  async function runStartupSequence() {
    state.startupStartedAt = Date.now();
    state.startupScanActive = true;
    if (storage && storage.ready) await storage.ready();
    let statuses = currentDatasetStatuses();
    renderStartupDatasets(statuses);
    const initialReady = statuses.filter(item => item.ready).length;
    setStartupProgress(10, 'Checking shared data', `${initialReady} of 5 data sources already available.`, `${initialReady} of 5 ready`);
    await nextPaint();

    try {
      if (initialReady === 5) {
        setStartupProgress(100, 'Shared data ready', 'All five shared data sources are already available. No storage files were scanned or replaced.', '5 of 5 ready');
      } else {
        await scanStorage({ startup: true });
      }
    } catch (error) {
      saveScanRecord({ available: false, fileCount: 0, ambiguous: [], summary: 'Startup data check could not finish' });
      setStartupProgress(92, 'Desktop ready', 'The startup data check could not finish. Existing data is unchanged and manual Weekly Data import remains available.', `${initialReady} of 5 ready`);
    } finally {
      renderDataStatus();
      statuses = currentDatasetStatuses();
      renderStartupDatasets(statuses);
      const readyCount = statuses.filter(item => item.ready).length;
      const scanIsCurrent = Boolean(state.lastScan && Date.parse(state.lastScan.scannedAt) >= state.startupStartedAt);
      const loadedCount = scanIsCurrent && Array.isArray(state.lastScan.loaded) ? state.lastScan.loaded.length : 0;
      const fallbackSummary = scanIsCurrent && state.lastScan.summary || `${readyCount} of 5 shared data sources ready.`;
      const finalSummary = readyCount === 5
        ? `All five shared data sources are ready${loadedCount ? ` · ${loadedCount} loaded automatically` : ''}.`
        : `${readyCount} of 5 shared data sources ready · ${fallbackSummary}`;
      setStartupProgress(100, 'CoachTools ready', finalSummary, `${readyCount} of 5 ready`);

      const remainingDelay = Math.max(0, 520 - (Date.now() - state.startupStartedAt));
      if (remainingDelay) await new Promise(resolve => setTimeout(resolve, remainingDelay));
      state.startupScanActive = false;
      restoreOpenWindows();
      dismissStartupSplash();
      if (state.pendingStageFiles.length) {
        setTimeout(() => showToast('Some storage files need review. Open Weekly Data to place them safely.', 6500), 300);
      }
    }
  }

  function init() {
    collectElements();
    preloadIconAssets();
    hydrateSystemIcons();
    const savedFavorites = readJson(FAVORITES_KEY, null);
    if (Array.isArray(savedFavorites)) state.favorites = new Set(savedFavorites.filter(id => byId.has(id)));
    else {
      state.favorites = new Set(apps.filter(app => app.favorite).map(app => app.id));
      writeJson(FAVORITES_KEY, Array.from(state.favorites));
    }
    state.recent = readJson(RECENT_KEY, []).filter(id => byId.has(id)).slice(0, MAX_RECENT);
    state.lastScan = readJson(STORAGE_SCAN_KEY, null);
    $('startVersion').textContent = `Version ${manifest.suite && manifest.suite.version || '2.0'}`;
    bind();
    detectWallpaper();
    renderCategories();
    renderDataStatus();
    updateClock();
    state.clockTimer = setInterval(updateClock, 30000);
    if (!apps.length) showToast('No applications were found. Run the manifest generator and reload.', 8000);
    runStartupSequence();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
