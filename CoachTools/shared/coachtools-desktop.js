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
    'audit-checklist': 'icons/audit-checklist.png',
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
    .map(app => ({ ...app, icon: app.icon || APP_ICON_PATHS[app.id] || DEFAULT_APP_ICON }));
  const byId = new Map(apps.map(app => [app.id, app]));
  const storage = root.CoachToolsStorage;
  const importer = root.CoachToolsImport;
  const FAVORITES_KEY = 'coachtools.desktop.favorites.v1';
  const RECENT_KEY = 'coachtools.desktop.recent.v1';
  const OPEN_APPS_KEY = 'coachtools.desktop.openApps.v1';
  const STORAGE_SCAN_KEY = 'coachtools.desktop.storageScan.v1';
  const STORAGE_FILES_KEY = 'coachtools.storage.processed.v2';
  const MAX_RECENT = 8;
  const APP_LOAD_TIMEOUT_MS = 12000;
  const ICON_PRELOAD_CONCURRENCY = 4;
  const ICON_PRELOAD_TIMEOUT_MS = 5000;
  const FILTERS = Object.freeze(['All', 'Favorites', 'Core', 'People', 'Data', 'Coaching', 'Performance', 'Quality', 'Other', 'Needs Data']);
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
    iconFailures: new Set(),
    preloadedIcons: new Map(),
    scopeOptions: new Map(),
    wallpaperReady: Promise.resolve(false),
    pendingRestoreActiveId: '',
    firstAppOpened: false,
    firstAppOpenStarted: false,
    storageCheckLabel: ''
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

  function yieldLowPriority() {
    return new Promise(resolve => {
      if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(() => resolve(), { timeout: 900 });
      else root.setTimeout(resolve, 18);
    });
  }

  function desktopAssetPaths() {
    return Array.from(new Set([
      ...apps.map(app => app.icon),
      ...Object.values(SYSTEM_ICON_PATHS),
      DEFAULT_APP_ICON
    ].filter(Boolean)));
  }

  function preloadIconAsset(path) {
    if (state.preloadedIcons.has(path)) return state.preloadedIcons.get(path);
    const promise = new Promise(resolve => {
      const image = new Image();
      let settled = false;
      const finish = loaded => {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        if (loaded) state.iconFailures.delete(path);
        else state.iconFailures.add(path);
        resolve({ path, loaded });
      };
      const timer = root.setTimeout(() => finish(false), ICON_PRELOAD_TIMEOUT_MS);
      image.decoding = 'async';
      image.onload = async () => {
        if (typeof image.decode === 'function') {
          try { await image.decode(); } catch (_) {}
        }
        finish(true);
      };
      image.onerror = () => finish(false);
      image.src = path;
    });
    state.preloadedIcons.set(path, promise);
    return promise;
  }

  async function preloadDesktopAssets() {
    const paths = desktopAssetPaths();
    if (!paths.length) return { total: 0, loaded: 0, failed: [] };
    const diagnostics = root.CoachToolsDiagnostics;
    if (diagnostics) diagnostics.start('Icon preload', { total: paths.length });
    let cursor = 0;
    let completed = 0;
    let loaded = 0;
    const failed = [];
    const worker = async () => {
      while (cursor < paths.length) {
        const path = paths[cursor++];
        const result = await preloadIconAsset(path);
        completed += 1;
        if (result.loaded) loaded += 1;
        else failed.push(path);
        setStartupProgress(24 + (completed / paths.length) * 34, 'Loading icons', `Preparing desktop artwork · ${completed} of ${paths.length}`, `${completed} of ${paths.length}`);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(ICON_PRELOAD_CONCURRENCY, paths.length) }, worker));
      return { total: paths.length, loaded, failed };
    } finally {
      if (diagnostics) diagnostics.end('Icon preload', { total: paths.length, loaded, failed: failed.slice() });
    }
  }

  function appendImageWithFallback(wrap, primaryPath) {
    const paths = Array.from(new Set([primaryPath, DEFAULT_APP_ICON].filter(Boolean)));
    if (!paths.length) return;
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'eager';
    image.decoding = 'async';
    let pathIndex = 0;
    let currentPath = '';

    const loadNextPath = () => {
      const path = paths[pathIndex];
      pathIndex += 1;
      if (!path) {
        image.remove();
        return;
      }
      currentPath = path;
      image.src = path;
    };

    image.addEventListener('load', () => {
      if (currentPath) state.iconFailures.delete(currentPath);
      wrap.classList.add('loaded');
    });
    image.addEventListener('error', () => {
      wrap.classList.remove('loaded');
      if (currentPath) state.iconFailures.add(currentPath);
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
      const scan = state.lastScan && Array.isArray(state.lastScan.results) ? [...state.lastScan.results].reverse().find(result => result.id === (status.datasetType || status.id)) : null;
      const labels = { new: 'New imported', updated: 'Updated', current: 'Current', older: 'Older retained', 'needs-review': 'Needs review' };
      value.textContent = status.display || scan && labels[scan.status] || (status.ready ? 'Ready' : 'Missing');
      item.append(label, value);
      return item;
    }));
  }

  function currentDatasetStatuses() {
    return storage && storage.getDatasetStatus ? storage.getDatasetStatus() : [];
  }

  function datasetTotal(statuses) {
    const list = Array.isArray(statuses) ? statuses : currentDatasetStatuses();
    return list.length || importer && importer.DATASET_ORDER && importer.DATASET_ORDER.length || 8;
  }

  function dismissStartupSplash() {
    if (!elements.startupSplash || elements.startupSplash.hidden) return;
    elements.startupSplash.classList.add('is-leaving');
    clearTimeout(state.startupDismissTimer);
    state.startupDismissTimer = setTimeout(() => { elements.startupSplash.hidden = true; }, 620);
  }

  function missingRequirements(app) {
    const required = Array.isArray(app.data) ? app.data : [];
    return required.filter(source => !storage || !storage.has(source));
  }

  function datasetLabel(type) {
    const status = currentDatasetStatuses().find(item => (item.datasetType || item.id) === type);
    return status && status.label || String(type || 'Data').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase());
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
    if (!scope) return 'All people';
    if (scope.label) return scope.label;
    if (scope.mode === 'team' && scope.team) return scope.team;
    if (scope.mode === 'coordinator' && scope.coordinator) return scope.coordinator;
    if (Array.isArray(scope.coaches) && scope.coaches.length === 1) return scope.coaches[0];
    if (Array.isArray(scope.coaches) && scope.coaches.length > 1) return `${scope.coaches.length} selected coaches`;
    return 'All people';
  }

  function scopeValue(scope) {
    if (!scope || scope.mode === 'all') return 'all:';
    if ((scope.mode === 'coach' || scope.mode === 'representative') && scope.personId) return `${scope.mode}:${scope.personId}`;
    const value = scope[scope.mode] || '';
    return `${scope.mode}:${encodeURIComponent(value)}`;
  }

  async function refreshGlobalScope() {
    if (!elements.globalScopeSelect) return;
    const identity = root.CoachToolsIdentity;
    let people = [];
    try { if (identity) { await identity.ready(); people = await identity.getAllPeople(); } } catch (_) {}
    const options = [{ value: 'all:', label: 'All people', scope: { mode: 'all', label: 'All people' } }];
    const addNamed = (mode, values, prefix) => values.filter(Boolean).sort((a, b) => a.localeCompare(b)).forEach(value => options.push({ value: `${mode}:${encodeURIComponent(value)}`, label: `${prefix}: ${value}`, scope: { mode, [mode]: value, label: value } }));
    addNamed('department', Array.from(new Set(people.map(person => person.department))), 'Department');
    addNamed('team', Array.from(new Set(people.map(person => person.currentTeam || person.team))), 'Team');
    addNamed('coordinator', Array.from(new Set(people.map(person => person.coordinator))), 'Coordinator');
    for (const role of ['coach', 'representative']) for (const person of people.filter(candidate => candidate.role === role).sort((a, b) => a.displayName.localeCompare(b.displayName))) {
      options.push({ value: `${role}:${person.personId}`, label: `${role === 'coach' ? 'Coach' : 'Representative'}: ${person.displayName}`, scope: { mode: role, personId: person.personId, label: person.displayName, department: person.department || '', team: person.currentTeam || person.team || '', coaches: role === 'coach' ? [person.displayName] : [], representatives: role === 'representative' ? [person.displayName] : [] } });
    }
    state.scopeOptions = new Map(options.map(option => [option.value, option.scope]));
    elements.globalScopeSelect.replaceChildren(...options.map(option => { const element = document.createElement('option'); element.value = option.value; element.textContent = option.label; return element; }));
    const current = scopeValue(storage && storage.getScope ? storage.getScope() : null);
    elements.globalScopeSelect.value = state.scopeOptions.has(current) ? current : 'all:';
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
      const itemScope = item.scopeSnapshot ? scopeText(item.scopeSnapshot) : item.scopeMode === 'legacy-unscoped' ? 'Legacy all-data' : '';
      meta.textContent = item.ready
        ? [item.fileName, item.updatedAt ? formatDate(item.updatedAt) : '', itemScope ? `Scope: ${itemScope}` : '', item.scopeSnapshot ? `${Number(item.scopedRowCount || 0).toLocaleString()} scoped rows` : ''].filter(Boolean).join(' · ') || formatBytes(item.bytes)
        : 'No shared dataset loaded';
      copy.append(label, meta);
      const value = document.createElement('strong');
      value.textContent = item.ready ? 'Ready' : 'Missing';
      row.append(copy, value);
      return row;
    }));
    const ready = statuses.filter(item => item.ready).length;
    const total = datasetTotal(statuses);
    elements.readyCount.textContent = `${ready}/${total} Data`;
    elements.taskbarReadyCount.textContent = `${ready}/${total}`;
    elements.readinessButton.classList.toggle('ready', ready === total && ready > 0);
    elements.taskbarData.classList.toggle('ready', ready === total && ready > 0);
    elements.scopeLabel.textContent = scopeText(storage && storage.getScope ? storage.getScope() : null);
    if (elements.globalScopeSelect) {
      const value = scopeValue(storage && storage.getScope ? storage.getScope() : null);
      if (state.scopeOptions.has(value)) elements.globalScopeSelect.value = value;
    }
    elements.storageAvailability.textContent = state.storageCheckLabel || (location.protocol === 'file:'
      ? 'Automatic storage-folder loading is available when CoachTools is started with START COACHTOOLS. Manual Data Manager import remains available.'
      : 'Storage scanning is available from the local CoachTools launcher.');
    renderApps();
  }

  function requirementNotice(app) {
    const missing = missingRequirements(app);
    if (!missing.length) return '';
    const labels = missing.map(id => storage && storage.LABELS && storage.LABELS[id] || id).join(', ');
    return `Missing data: ${labels}. The app can still open.`;
  }

  function persistOpenWindows() {
    const userOpened = Array.from(openWindows.values()).filter(item => item.userOpened);
    const payload = {
      version: 1,
      ids: userOpened.map(item => item.app.id),
      activeId: state.activeAppId,
      minimized: userOpened.filter(item => item.minimized).map(item => item.app.id)
    };
    writeJson(OPEN_APPS_KEY, payload);
  }

  function settleWindowLoad(windowState, success) {
    if (!windowState || windowState.readySettled) return;
    windowState.readySettled = true;
    clearTimeout(windowState.loadTimer);
    windowState.loaded = Boolean(success);
    windowState.warmState = success ? 'ready' : 'failed';
    if (state.firstAppOpenStarted && !state.firstAppOpened) {
      state.firstAppOpened = true;
      if (root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.end('First app shell visible', { appId: windowState.app.id, success: Boolean(success) });
    }
    windowState.resolveReady(Boolean(success));
  }

  function showUnavailable(windowState) {
    if (!windowState) return;
    windowState.loading.hidden = true;
    windowState.unavailable.hidden = false;
    windowState.unavailablePath.textContent = `Missing or unreadable: ${windowState.app.file}`;
    settleWindowLoad(windowState, false);
  }

  function promoteWindowState(windowState, options) {
    if (!windowState) return null;
    windowState.userOpened = true;
    windowState.minimized = Boolean(options && options.minimized);
    windowState.warmState = windowState.loaded ? 'ready' : 'loading';
    windowState.pane.dataset.lifecycle = 'opened';
    return windowState;
  }

  function createDeferredWindow(app, options) {
    const existing = openWindows.get(app.id);
    if (existing) return existing;
    const windowState = {
      app,
      pane: null,
      iframe: null,
      loading: null,
      unavailable: null,
      unavailablePath: null,
      minimized: Boolean(options && options.minimized),
      userOpened: true,
      deferred: true,
      warmState: 'deferred',
      loaded: false,
      loadTimer: null,
      lastActivated: 0,
      readySettled: true,
      readyPromise: Promise.resolve(false),
      resolveReady: null,
      usefulRenderMeasured: false
    };
    openWindows.set(app.id, windowState);
    return windowState;
  }

  function createWindow(app, options) {
    if (openWindows.has(app.id)) {
      const existing = openWindows.get(app.id);
      if (!existing.deferred) return promoteWindowState(existing, options);
      openWindows.delete(app.id);
    }
    const pane = document.createElement('section');
    pane.className = 'window-pane';
    pane.dataset.appId = app.id;
    pane.dataset.lifecycle = 'opened';
    pane.hidden = true;

    const iframe = document.createElement('iframe');
    iframe.title = app.name;
    iframe.dataset.appId = app.id;
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');

    const loading = document.createElement('div');
    loading.className = 'frame-message';
    const ring = document.createElement('span');
    ring.className = 'loader-ring';
    const loadingText = document.createElement('strong');
    loadingText.textContent = `Opening ${app.name}`;
    const loadingSummary = document.createElement('p');
    loadingSummary.textContent = 'Preparing the application shell…';
    const loadingData = document.createElement('div');
    loadingData.className = 'frame-data-status';
    for (const type of Array.isArray(app.data) ? app.data : []) {
      const row = document.createElement('span');
      const label = document.createElement('b');
      label.textContent = datasetLabel(type);
      const value = document.createElement('small');
      value.textContent = 'Waiting';
      row.append(label, value);
      loadingData.appendChild(row);
    }
    loading.append(ring, loadingText, loadingSummary, loadingData);

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
      loadingData,
      unavailable,
      unavailablePath,
      minimized: Boolean(options && options.minimized),
      userOpened: true,
      deferred: false,
      warmState: 'loading',
      loaded: false,
      loadTimer: null,
      lastActivated: 0,
      readySettled: false,
      readyPromise: null,
      resolveReady: null,
      usefulRenderMeasured: false
    };
    windowState.readyPromise = new Promise(resolve => { windowState.resolveReady = resolve; });
    openWindows.set(app.id, windowState);

    iframe.addEventListener('load', () => {
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.URL === 'about:blank' && app.file !== 'about:blank') {
          showUnavailable(windowState);
          return;
        }
      } catch (_) {
        // Local file iframe isolation differs between browsers; a load event is sufficient.
      }
      windowState.loading.hidden = true;
      windowState.unavailable.hidden = true;
      settleWindowLoad(windowState, true);
      if (app.id === 'weekly-data') {
        state.pendingStageSent = false;
        deliverPendingStageFiles(windowState);
      }
    });
    iframe.addEventListener('error', () => showUnavailable(windowState));
    windowState.loadTimer = setTimeout(() => {
      windowState.loading.hidden = true;
      settleWindowLoad(windowState, false);
    }, APP_LOAD_TIMEOUT_MS);
    if (!state.firstAppOpened && !state.firstAppOpenStarted && root.CoachToolsDiagnostics) {
      state.firstAppOpenStarted = true;
      root.CoachToolsDiagnostics.start('First app shell visible', { appId: app.id });
    }
    if (root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.start(`First useful app render · ${app.id}`, { appId: app.id });
    iframe.src = app.file;
    renderTaskbar();
    persistOpenWindows();
    return windowState;
  }

  function renderTaskbar() {
    const userOpened = Array.from(openWindows.values()).filter(windowState => windowState.userOpened && !windowState.closeRequested);
    elements.taskbarOpen.replaceChildren(...userOpened.map(windowState => {
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
    let windowState = openWindows.get(appId);
    if (!windowState || windowState.closeRequested) return;
    if (windowState.deferred) {
      windowState = createWindow(windowState.app, { minimized: false });
    }
    promoteWindowState(windowState);
    state.activeAppId = appId;
    windowState.minimized = false;
    windowState.lastActivated = Date.now();
    for (const [id, candidate] of openWindows) {
      if (candidate.pane) candidate.pane.hidden = id !== appId;
      if (candidate.app.id === 'allstar' && candidate.iframe && !candidate.closeRequested) {
        try { candidate.iframe.contentWindow.postMessage({ type: id === appId ? 'coachtools:app-visible' : 'coachtools:app-hidden' }, '*'); } catch (_) {}
      }
    }
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
    const existing = openWindows.get(app.id);
    if (existing && !existing.closeRequested) promoteWindowState(existing);
    else if (existing) return;
    else createWindow(app);
    activateWindow(app.id);
  }

  function minimizeWindow(appId) {
    const id = appId || state.activeAppId;
    const windowState = id && openWindows.get(id);
    const wasActive = state.activeAppId === id;
    if (windowState) {
      windowState.minimized = true;
      if (windowState.pane) windowState.pane.hidden = true;
      if (windowState.app.id === 'allstar' && windowState.iframe && !windowState.closeRequested) {
        try { windowState.iframe.contentWindow.postMessage({ type: 'coachtools:app-hidden' }, '*'); } catch (_) {}
      }
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

  const APP_CLOSE_DEADLINE_MS = 800;

  function finalizeWindowClose(id, windowState) {
    if (!windowState || windowState.closeFinalized) return;
    windowState.closeFinalized = true;
    clearTimeout(windowState.closeDeadlineTimer);
    if (windowState.pane) windowState.pane.remove();
    if (openWindows.get(id) === windowState) openWindows.delete(id);
    if (state.activeAppId === id) {
      state.activeAppId = null;
      elements.workspace.hidden = true;
      elements.desktop.hidden = false;
    }
    renderTaskbar();
    persistOpenWindows();
  }

  function closeWindow(appId) {
    const id = appId || state.activeAppId;
    const windowState = id && openWindows.get(id);
    if (!windowState || windowState.closeRequested) return;
    clearTimeout(windowState.loadTimer);
    if (!windowState.deferred && !windowState.usefulRenderMeasured && root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.end(`First useful app render · ${windowState.app.id}`, { cancelled: true });
    if (!windowState.deferred && windowState.app.id === 'allstar' && windowState.iframe) {
      windowState.closeRequested = true;
      windowState.closeRequestId = `close-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      if (windowState.pane) windowState.pane.hidden = true;
      if (state.activeAppId === id) {
        state.activeAppId = null;
        elements.workspace.hidden = true;
        elements.desktop.hidden = false;
      }
      renderTaskbar();
      try { windowState.iframe.contentWindow.postMessage({ type: 'coachtools:prepare-close', requestId: windowState.closeRequestId }, '*'); }
      catch (_) { finalizeWindowClose(id, windowState); return; }
      windowState.closeDeadlineTimer = setTimeout(() => finalizeWindowClose(id, windowState), APP_CLOSE_DEADLINE_MS);
      return;
    }
    try { if (windowState.iframe) windowState.iframe.contentWindow.postMessage({ type: 'coachtools:cancel-data-loads' }, '*'); } catch (_) {}
    finalizeWindowClose(id, windowState);
  }

  function popOut(app) {
    if (!app || !app.file) return;
    const opened = root.open(app.file, `coachtools_${app.id}`);
    if (!opened) showToast('Your browser blocked the new window. Allow pop-ups for CoachTools and try again.');
  }

  function reloadActive() {
    const windowState = state.activeAppId && openWindows.get(state.activeAppId);
    if (!windowState || windowState.deferred || !windowState.iframe) return;
    windowState.unavailable.hidden = true;
    windowState.loading.hidden = false;
    windowState.loaded = false;
    windowState.warmState = 'loading';
    windowState.readySettled = false;
    windowState.readyPromise = new Promise(resolve => { windowState.resolveReady = resolve; });
    state.pendingStageSent = false;
    clearTimeout(windowState.loadTimer);
    windowState.loadTimer = setTimeout(() => {
      windowState.loading.hidden = true;
      settleWindowLoad(windowState, false);
    }, APP_LOAD_TIMEOUT_MS);
    try { windowState.iframe.contentWindow.location.reload(); }
    catch (_) { windowState.iframe.src = windowState.app.file; }
  }

  function showContextMenu(app, x, y) {
    state.contextApp = app;
    const favoriteAction = elements.contextMenu.querySelector('[data-context-action="favorite"]');
    const closeAction = elements.contextMenu.querySelector('[data-context-action="close"]');
    favoriteAction.textContent = state.favorites.has(app.id) ? 'Unfavorite' : 'Favorite';
    closeAction.hidden = !(openWindows.has(app.id) && openWindows.get(app.id).userOpened);
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
      ['Session', openWindows.has(app.id) && openWindows.get(app.id).userOpened ? (openWindows.get(app.id).minimized ? 'Open · minimized' : 'Open') : 'Closed'],
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
    const userOpened = Array.from(openWindows.values()).filter(item => item.userOpened);
    const minimized = userOpened.filter(item => item.minimized).map(item => item.app.name);
    const scan = state.lastScan || readJson(STORAGE_SCAN_KEY, null) || {};
    const content = document.createElement('div');
    content.className = 'diagnostics-grid';
    const timings = root.CoachToolsDiagnostics && root.CoachToolsDiagnostics.getEntries ? root.CoachToolsDiagnostics.getEntries() : [];
    content.appendChild(diagnosticSection('Desktop', [
      ['Open applications', String(userOpened.length)],
      ['Active application', state.activeAppId && byId.get(state.activeAppId) ? byId.get(state.activeAppId).name : 'Desktop'],
      ['Minimized', minimized.length ? minimized.join(', ') : 'None'],
      ['Remembered on refresh', 'Yes · app list only'],
      ['Icon fallbacks in use', String(state.iconFailures.size)]
    ]));
    content.appendChild(diagnosticSection('Icon diagnostics', state.iconFailures.size
      ? Array.from(state.iconFailures).sort().map(path => [path, 'Fallback in use'])
      : [['Icon preload', 'All requested paths loaded']]));
    content.appendChild(diagnosticSection('Storage folder', [
      ['Automatic scanning', location.protocol === 'file:' ? 'No · direct-file mode' : (scan.available === false ? 'Unavailable' : 'Yes')],
      ['Supported files found', String(scan.fileCount || 0)],
      ['Last scan', scan.scannedAt ? formatDate(scan.scannedAt) : 'Not scanned'],
      ['Ambiguous files', scan.ambiguous && scan.ambiguous.length ? scan.ambiguous.join(', ') : 'None'],
      ['Most recent result', scan.summary || 'No automatic import attempted']
    ]));
    content.appendChild(diagnosticSection('Performance', timings.length
      ? timings.slice(0, 14).map(entry => [entry.name, `${Math.round(entry.duration).toLocaleString()} ms`])
      : [['Timings', 'No measurements recorded yet']]));
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
    const facts = [[version, 'Version'], [String(apps.length), 'Applications'], [`${ready}/${datasetTotal()}`, 'Data ready']];
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

  async function downloadBackup() {
    try {
      const backup = await storage.createBackup();
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
      const result = await storage.restoreBackup(backup);
      renderDataStatus();
      const restoredCount = result.restoredKeys.length + (result.restoredDatasets && result.restoredDatasets.length || 0);
      showToast(`Backup restored · ${restoredCount} item${restoredCount === 1 ? '' : 's'}.`);
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
    else showToast('Data Manager is not present in the application manifest.');
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
      setStartupProgress(15 + value * .35, currentSource, summary || currentFile, count);
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
    const total = datasetTotal();
    state.startupScanActive = Boolean(options && options.startup);
    state.progressSteps = [];
    if (state.startupScanActive) {
      setStartupProgress(18, 'Scanning storage', 'Recognizable files were found. Checking all shared datasets…', `0 of ${total}`);
      renderProgressSteps();
      return;
    }
    elements.importProgress.hidden = false;
    elements.importClose.hidden = true;
    elements.importReview.hidden = true;
    setImportProgress(0, 'Preparing files', '', `0 of ${total}`, 'Looking for recognizable weekly, monthly, QA, coaching, and checklist files…');
    renderProgressSteps();
  }

  function finishImportProgress(summary, options) {
    const total = datasetTotal();
    if (state.startupScanActive) {
      renderStartupDatasets(currentDatasetStatuses());
      setStartupProgress(50, options && options.warning ? 'Data review available' : 'Shared data ready', summary, options && options.count || `${total} of ${total}`);
      return;
    }
    setImportProgress(100, options && options.warning ? 'Review needed' : 'Ready', '', options && options.count || `${total} of ${total}`, summary);
    elements.importClose.hidden = false;
    elements.importReview.hidden = !(options && options.review);
  }

  function saveScanRecord(record) {
    state.lastScan = { ...record, scannedAt: new Date().toISOString() };
    writeJson(STORAGE_SCAN_KEY, state.lastScan);
  }

  function storageFileKey(metadata) {
    return String(metadata && (metadata.path || metadata.filename) || '').replace(/\\/g, '/');
  }

  function storageFileSignature(metadata) {
    if (!metadata) return '';
    return metadata.fingerprint
      ? `fingerprint:${metadata.fingerprint}`
      : `metadata:${Number(metadata.size) || 0}:${metadata.modifiedTime || ''}`;
  }

  function processedStorageFiles() {
    const value = readJson(STORAGE_FILES_KEY, null);
    if (value && value.version === 2 && value.records && typeof value.records === 'object') return value;
    return { version: 2, records: {} };
  }

  function storageFileRecordKey(metadata, details) {
    return [details && details.scopeHash || 'legacy-unscoped', details && details.datasetType || 'unknown', storageFileKey(metadata)].join('|');
  }

  function isStorageFileUnchanged(metadata, processed, scopeHash) {
    const path = storageFileKey(metadata), signature = storageFileSignature(metadata);
    return Boolean(path && Object.values(processed && processed.records || {}).some(previous => previous && previous.path === path && previous.scopeHash === scopeHash && previous.fileSignature === signature));
  }

  function rememberStorageFile(processed, metadata, details) {
    const key = storageFileKey(metadata);
    if (!key) return;
    const recordKey = storageFileRecordKey(metadata, details);
    processed.records[recordKey] = {
      path: key,
      filename: metadata.filename || '',
      size: Number(metadata.size) || 0,
      modifiedTime: metadata.modifiedTime || '',
      fileSignature: storageFileSignature(metadata),
      datasetType: details && details.datasetType || '',
      scopeHash: details && details.scopeHash || '',
      scopedFingerprint: details && details.scopedFingerprint || '',
      scopedRowCount: Number(details && details.scopedRowCount) || 0,
      datasetId: details && details.datasetId || '',
      lastCheckedAt: new Date().toISOString()
    };
  }

  function safelyNamedFile(blob, metadata) {
    return new File([blob], metadata.filename, {
      type: blob.type || (metadata.extension === '.csv' ? 'text/csv' : 'application/octet-stream'),
      lastModified: Date.parse(metadata.modifiedTime) || Date.now()
    });
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

  async function importSelectedFiles(files) {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;
    if (!importer || !root.CoachToolsData) {
      showToast('The shared IndexedDB import service is unavailable. Open Data Manager and retry.', 6000);
      return;
    }
    if (state.autoScanRunning) {
      showToast('Another data import is already running.');
      return;
    }

    state.autoScanRunning = true;
    beginImportProgress({ startup: false });
    setProgressStep('Reading selected files', 'active');
    const totalFiles = selectedFiles.length;
    try {
      const analysis = await importer.analyzeFiles(selectedFiles, {
        onProgress(progress) {
          const sheetFraction = progress.total ? progress.current / progress.total : 0;
          const completed = Number(progress.fileIndex) + sheetFraction;
          setImportProgress(5 + (completed / Math.max(1, totalFiles)) * 55, 'Reading selected files', `${progress.fileName || ''}${progress.sheetName ? ` · ${progress.sheetName}` : ''}`, `${Math.min(totalFiles, Number(progress.fileIndex) + 1)} of ${totalFiles}`);
        }
      });

      setProgressStep('Reading selected files', analysis.errors.length ? 'warning' : 'success');
      setProgressStep('Saving to IndexedDB', 'active');
      const imported = [];
      const errors = analysis.errors.map(entry => `${entry.file && entry.file.name || 'File'}: ${entry.error && entry.error.message || entry.error}`);
      for (let index = 0; index < analysis.recognized.length; index += 1) {
        const entry = analysis.recognized[index];
        const type = entry.classification.id;
        try {
          setImportProgress(62 + ((index + 1) / Math.max(1, analysis.recognized.length)) * 34, `Saving ${importer.SOURCES[type].label}`, entry.file.name, `${index + 1} of ${analysis.recognized.length}`);
          const result = await importer.saveRecognizedEntry(entry, { scope: null });
          imported.push({ id: type, fileName: entry.file.name, status: result.status });
        } catch (error) {
          errors.push(`${entry.file.name}: ${error && error.message || error}`);
        }
      }

      state.pendingStageFiles = analysis.needsReview.map(entry => entry.file);
      state.pendingStageSent = false;
      setProgressStep('Saving to IndexedDB', errors.length ? 'warning' : 'success');
      if (analysis.needsReview.length) setProgressStep(`${analysis.needsReview.length} file${analysis.needsReview.length === 1 ? '' : 's'} need review`, 'warning');
      setProgressStep('Ready', analysis.needsReview.length || errors.length ? 'warning' : 'success');
      renderDataStatus();
      const statuses = currentDatasetStatuses();
      const ready = statuses.filter(item => item.ready).length;
      const total = datasetTotal(statuses);
      const duplicates = imported.filter(item => item.status === 'duplicate').length;
      const saved = imported.length - duplicates;
      const summaryParts = [
        `${ready} of ${total} data sources ready`,
        saved ? `${saved} file${saved === 1 ? '' : 's'} saved to IndexedDB` : '',
        duplicates ? `${duplicates} duplicate${duplicates === 1 ? '' : 's'} already stored` : '',
        analysis.needsReview.length ? `${analysis.needsReview.length} need manual placement` : '',
        errors.length ? `${errors.length} could not be saved` : ''
      ].filter(Boolean);
      finishImportProgress(summaryParts.join(' · ') + '.', {
        warning: Boolean(analysis.needsReview.length || errors.length),
        review: state.pendingStageFiles.length > 0,
        count: `${ready} of ${total}`
      });
    } catch (error) {
      setProgressStep('Saving to IndexedDB', 'warning');
      finishImportProgress(`Import failed: ${error && error.message || error}`, { warning: true, review: false });
    } finally {
      state.autoScanRunning = false;
      if (elements.quickDataInput) elements.quickDataInput.value = '';
    }
  }

  async function scanStorage(options) {
    const manual = Boolean(options && options.manual);
    const startup = Boolean(options && options.startup);
    const background = Boolean(options && options.background);
    if (state.autoScanRunning) {
      if (manual) showToast('A storage scan is already running.');
      return;
    }
    if (startup) {
      state.startupScanActive = true;
      setStartupProgress(14, 'Checking shared data', 'Comparing shared files with local IndexedDB history…', null);
    }
    const statuses = currentDatasetStatuses();
    const datasetTypes = statuses.map(item => item.datasetType || item.id);
    const totalSources = datasetTypes.length || datasetTotal(statuses);
    const readyBefore = statuses.filter(item => item.ready).length;
    if (location.protocol === 'file:') {
      saveScanRecord({ available: false, fileCount: 0, ambiguous: [], summary: 'Direct-file mode · manual import available' });
      if (startup) setStartupProgress(50, 'Shared data ready', `${readyBefore} of ${totalSources} data sources ready · use START COACHTOOLS for automatic storage loading.`, `${readyBefore} of ${totalSources} ready`);
      if (manual) showToast('Start CoachTools with START COACHTOOLS to scan storage. Manual Data Manager import is still available.', 5800);
      return;
    }
    if (!importer) {
      if (startup) setStartupProgress(50, 'Shared data ready', 'Shared import utilities are unavailable. Manual Data Manager import remains available.', `${readyBefore} of ${totalSources} ready`);
      if (manual) showToast('The shared import utility is unavailable. Use Data Manager for manual import.', 5600);
      return;
    }

    state.autoScanRunning = true;
    if (startup) setStartupProgress(20, 'Checking storage folder', 'Looking for new, updated, duplicate, and older shared files…', `${readyBefore} of ${totalSources} ready`);
    let listing;
    try {
      if (root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.start('Storage listing');
      const response = await fetch('/api/storage', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Storage scan returned ${response.status}`);
      listing = await response.json();
    } catch (error) {
      state.autoScanRunning = false;
      saveScanRecord({ available: false, fileCount: 0, ambiguous: [], summary: 'Storage API unavailable' });
      if (startup) setStartupProgress(50, 'Shared data ready', 'Storage scanning is unavailable. Existing data is unchanged and manual import remains available.', `${readyBefore} of ${totalSources} ready`);
      if (manual) showToast('Storage scanning is unavailable. Manual Data Manager import remains available.', 5600);
      return;
    } finally {
      if (root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.end('Storage listing');
    }

    const allListedFiles = Array.isArray(listing && listing.files) ? listing.files : [];
    const scopeResolution = root.CoachToolsData && typeof root.CoachToolsData.resolveUpdateScope === 'function'
      ? await root.CoachToolsData.resolveUpdateScope(datasetTypes)
      : { needsReview: false, scope: storage && storage.getScope ? storage.getScope() : { mode: 'all', label: 'All people' }, source: 'global-scope' };
    if (scopeResolution.needsReview) {
      state.autoScanRunning = false;
      const summary = scopeResolution.reason || 'Update needs scope review. Existing data was retained.';
      saveScanRecord({ available: true, fileCount: allListedFiles.length, ambiguous: [summary], loaded: [], summary });
      finishImportProgress(summary, { warning: true, review: false, count: `${readyBefore} of ${totalSources}` });
      if (manual) showToast(summary, 7000);
      return;
    }
    const scope = importer.resolveScopeSnapshot ? await importer.resolveScopeSnapshot(scopeResolution.scope || { mode: 'all', label: 'All people' }) : scopeResolution.scope;
    const scopeHash = scope && scope.scopeHash || 'legacy-unscoped';
    const scopeName = scopeText(scope);
    const processedFiles = processedStorageFiles();
    const unchangedFiles = manual ? [] : allListedFiles.filter(metadata => isStorageFileUnchanged(metadata, processedFiles, scopeHash));
    const listedFiles = manual ? allListedFiles : allListedFiles.filter(metadata => !isStorageFileUnchanged(metadata, processedFiles, scopeHash));
    if (!allListedFiles.length) {
      state.autoScanRunning = false;
      saveScanRecord({ available: true, fileCount: 0, ambiguous: [], summary: 'No supported storage files found' });
      if (startup) setStartupProgress(50, 'Shared data ready', 'No XLSX, XLS, or CSV files were found in CoachTools/storage. Existing data is unchanged.', `${readyBefore} of ${totalSources} ready`);
      if (manual) showToast('No XLSX, XLS, or CSV files were found in CoachTools/storage.');
      return;
    }
    if (!listedFiles.length) {
      state.autoScanRunning = false;
      const summary = `Scope preserved: ${scopeName} · ${unchangedFiles.length} file${unchangedFiles.length === 1 ? '' : 's'} checked · no scoped changes found and no spreadsheets downloaded.`;
      saveScanRecord({ available: true, fileCount: allListedFiles.length, unchanged: unchangedFiles.length, ambiguous: [], loaded: [], summary });
      if (manual) showToast(summary);
      return;
    }

    beginImportProgress({ startup });
    setProgressStep('Scanning storage', 'success');
    setProgressStep('Reading files', 'active');
    setImportProgress(8, 'Reading files', '', `0 of ${listedFiles.length}`, `${listedFiles.length} supported file${listedFiles.length === 1 ? '' : 's'} found.`);
    await nextPaint();

    const parsedEntries = [];
    const ambiguous = [];
    const skipped = [];
    const scanResults = [];
    if (root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.start('Changed file parsing', { files: listedFiles.length });
    for (let index = 0; index < listedFiles.length; index += 1) {
      const metadata = listedFiles[index];
      try {
        if (background) await yieldLowPriority();
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
    if (root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.end('Changed file parsing', { parsed: parsedEntries.length, files: listedFiles.length });

    setProgressStep('Reading files', 'success');
    setProgressStep('Identifying sources', 'active');
    setImportProgress(48, 'Identifying sources', '', `0 of ${listedFiles.length}`, 'Comparing reporting periods and source fingerprints…');
    await nextPaint();

    const candidatesBySource = new Map();
    for (let index = 0; index < parsedEntries.length; index += 1) {
      const entry = parsedEntries[index];
      const id = entry.classification.id;
      if (!id || !datasetTypes.includes(id)) {
        ambiguous.push(entry.metadata.filename);
        continue;
      }
      setImportProgress(48 + ((index + 1) / Math.max(1, parsedEntries.length)) * 23, `Comparing ${importer.SOURCES[id].label}`, entry.metadata.filename, `${index + 1} of ${parsedEntries.length}`);
      await nextPaint();
      const prepared = importer.prepareScopedDataset(entry.parsed, id, scope, { detectedPeriod: entry.classification.detectedPeriod });
      if (!prepared.valid) {
        ambiguous.push(`${entry.metadata.filename} (${prepared.reason})`);
        scanResults.push({ id, fileName: entry.metadata.filename, status: 'needs-review', reason: prepared.reason, period: entry.classification.detectedPeriod && entry.classification.detectedPeriod.periodKey || '', scopeHash, diagnostics: prepared.diagnostics });
        continue;
      }
      const dataset = prepared.dataset;
      const inspection = await root.CoachToolsData.inspectDataset(id, dataset, {
        originalFileName: entry.metadata.filename,
        fileSize: entry.metadata.size,
        fileModifiedDate: entry.metadata.modifiedTime,
        detectedPeriod: entry.classification.detectedPeriod,
        automaticImport: true,
        scopeSnapshot: prepared.scopeSnapshot,
        scopeHash: prepared.scopeHash,
        scopeMode: prepared.scopeSnapshot.mode,
        scopedRowCount: prepared.matchedRows,
        scopeMatchDiagnostics: prepared.diagnostics,
        scopedFingerprint: prepared.scopedFingerprint
      });
      const inspected = { id, ...entry, dataset, prepared, inspection };
      if (!candidatesBySource.has(id)) candidatesBySource.set(id, []);
      candidatesBySource.get(id).push(inspected);
      scanResults.push({ id, fileName: entry.metadata.filename, status: inspection.status, reason: inspection.reason, period: inspection.candidate && inspection.candidate.periodKey || '', scopeHash, scopedRowCount: prepared.matchedRows, outOfScopeRows: prepared.diagnostics && prepared.diagnostics.outOfScopeRows || 0 });
      if (!['new', 'updated', 'needs-review'].includes(inspection.status)) {
        rememberStorageFile(processedFiles, entry.metadata, { datasetType: id, scopeHash, scopedFingerprint: prepared.scopedFingerprint, scopedRowCount: prepared.matchedRows, datasetId: inspection.current && inspection.current.datasetId || '' });
      }
    }

    const selected = [];
    for (const id of datasetTypes) {
      const candidates = candidatesBySource.get(id) || [];
      const actionable = candidates.filter(entry => ['new', 'updated'].includes(entry.inspection.status)).sort((a, b) => String(b.inspection.candidate.periodSort).localeCompare(String(a.inspection.candidate.periodSort)) || String(b.metadata.modifiedTime).localeCompare(String(a.metadata.modifiedTime)));
      if (actionable[0]) selected.push(actionable[0]);
      for (const entry of candidates) {
        if (entry === actionable[0]) continue;
        if (entry.inspection.status === 'needs-review') ambiguous.push(`${entry.metadata.filename} (${entry.inspection.reason})`);
        else skipped.push(`${entry.metadata.filename} · ${entry.inspection.status}`);
      }
    }
    setProgressStep('Identifying sources', selected.length ? 'success' : 'warning');

    if (!selected.length) {
      state.pendingStageFiles = parsedEntries.filter(entry => ambiguous.some(label => label.startsWith(entry.metadata.filename))).map(entry => entry.file);
      state.pendingStageSent = false;
      setProgressStep('Saving shared data', ambiguous.length ? 'warning' : 'success');
      const summary = ambiguous.length ? `Scope preserved: ${scopeName} · shared data is unchanged · ${ambiguous.length} file${ambiguous.length === 1 ? '' : 's'} need review.` : `Scope preserved: ${scopeName} · shared data is current · no scoped changes were imported.`;
      writeJson(STORAGE_FILES_KEY, processedFiles);
      saveScanRecord({ available: true, fileCount: allListedFiles.length, unchanged: unchangedFiles.length, ambiguous, skipped, results: scanResults, loaded: [], summary });
      finishImportProgress(summary, { warning: Boolean(ambiguous.length), review: state.pendingStageFiles.length > 0, count: `${readyBefore} of ${totalSources}` });
      state.autoScanRunning = false;
      return;
    }

    setProgressStep('Building selected data', 'success');

    setProgressStep('Saving shared data', 'active');
    const written = [];
    const writeErrors = [];
    for (let index = 0; index < selected.length; index += 1) {
      const entry = selected[index];
      try {
        setImportProgress(77 + ((index + 1) / selected.length) * 20, `Saving ${importer.SOURCES[entry.id].label}`, entry.metadata.filename, `${index + 1} of ${selected.length}`);
        await nextPaint();
        const result = await root.CoachToolsData.importDataset(entry.id, entry.dataset, {
          originalFileName: entry.metadata.filename,
          fileSize: entry.metadata.size,
          fileModifiedDate: entry.metadata.modifiedTime,
          rowCount: entry.dataset.meta && entry.dataset.meta.totalRows || 0,
          detectedPeriod: entry.classification.detectedPeriod,
          classificationMethod: entry.classification.classificationMethod || entry.classification.reason,
          automaticImport: true,
          scopeLabel: scopeName,
          scopeSnapshot: entry.prepared.scopeSnapshot,
          scopeHash: entry.prepared.scopeHash,
          scopeMode: entry.prepared.scopeSnapshot.mode,
          scopedRowCount: entry.prepared.matchedRows,
          scopeMatchDiagnostics: entry.prepared.diagnostics,
          scopedFingerprint: entry.prepared.scopedFingerprint
        });
        written.push({ id: entry.id, fileName: entry.metadata.filename, status: entry.inspection.status, datasetId: result.dataset && result.dataset.id || '' });
        rememberStorageFile(processedFiles, entry.metadata, { datasetType: entry.id, scopeHash, scopedFingerprint: entry.prepared.scopedFingerprint, scopedRowCount: entry.prepared.matchedRows, datasetId: result.dataset && (result.dataset.datasetId || result.dataset.id) || '' });
      } catch (error) {
        writeErrors.push(`${entry.metadata.filename}: ${error && error.message || error}`);
      }
    }

    setProgressStep('Saving shared data', writeErrors.length ? 'warning' : 'success');
    setProgressStep('Ready', ambiguous.length || writeErrors.length ? 'warning' : 'success');
    renderDataStatus();
    const after = storage.getDatasetStatus();
    const readyCount = after.filter(item => item.ready).length;
    const missingLabels = after.filter(item => !item.ready).map(item => item.label);
    const newCount = written.filter(entry => entry.status === 'new').length, updatedCount = written.filter(entry => entry.status === 'updated').length;
    const actions = [newCount ? `${newCount} new` : '', updatedCount ? `${updatedCount} updated` : ''].filter(Boolean).join(' · ');
    const scopedUnchanged = scanResults.filter(entry => ['current', 'duplicate', 'older'].includes(entry.status)).length + unchangedFiles.length;
    const ignoredRows = selected.reduce((sum, entry) => sum + Number(entry.prepared && entry.prepared.diagnostics && entry.prepared.diagnostics.outOfScopeRows || 0), 0);
    const qaMatches = selected.filter(entry => entry.id === 'qa').reduce((sum, entry) => sum + Number(entry.prepared && entry.prepared.matchedRows || 0), 0);
    const summary = `Scope preserved: ${scopeName} · ${readyCount} of ${totalSources} data sources ready${actions ? ` · ${actions} imported` : ''}${scopedUnchanged ? ` · ${scopedUnchanged} source${scopedUnchanged === 1 ? '' : 's'} unchanged for this scope` : ''}${qaMatches ? ` · QA ${qaMatches.toLocaleString()} Team matches` : ''}${ignoredRows ? ` · ${ignoredRows.toLocaleString()} out-of-scope rows ignored` : ''}${missingLabels.length ? ` · ${missingLabels.join(', ')} require manual selection` : ''}${writeErrors.length ? ` · ${writeErrors.length} save error${writeErrors.length === 1 ? '' : 's'}` : ''}.`;
    state.pendingStageFiles = parsedEntries.filter(entry => ambiguous.some(label => label.startsWith(entry.metadata.filename)) || writeErrors.some(label => label.startsWith(entry.metadata.filename))).map(entry => entry.file);
    state.pendingStageSent = false;
    writeJson(STORAGE_FILES_KEY, processedFiles);
    saveScanRecord({ available: true, fileCount: allListedFiles.length, unchanged: unchangedFiles.length, ambiguous, skipped, results: scanResults, loaded: written, errors: writeErrors, summary });
    finishImportProgress(summary, { warning: Boolean(missingLabels.length || ambiguous.length || writeErrors.length), review: state.pendingStageFiles.length > 0, count: `${readyCount} of ${totalSources}` });
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
    if (action === 'quick-upload-data') elements.quickDataInput.click();
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

    elements.quickDataInput.addEventListener('change', event => importSelectedFiles(event.target.files));

    elements.appSearch.addEventListener('input', event => {
      state.query = event.target.value;
      state.selectedAppId = null;
      renderApps();
    });

    elements.globalScopeSelect.addEventListener('change', event => {
      const scope = state.scopeOptions.get(event.target.value);
      if (scope && storage && storage.setScope) storage.setScope(scope);
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
      const windowState = Array.from(openWindows.values()).find(item => item.iframe && item.iframe.contentWindow === event.source) || null;
      if (type === 'coachtools:app-ready' && windowState) {
        windowState.loading.hidden = true;
        windowState.unavailable.hidden = true;
        settleWindowLoad(windowState, true);
        deliverPendingStageFiles(windowState);
      }
      if (type === 'coachtools:close-ready' && windowState && windowState.closeRequested && event.data.requestId === windowState.closeRequestId) {
        finalizeWindowClose(windowState.app.id, windowState);
      }
      if (type === 'coachtools:show-desktop' && windowState) minimizeWindow(windowState.app.id);
      if (type === 'coachtools:pop-out' && windowState) popOut(windowState.app);
      if (type === 'coachtools:app-error' && windowState && state.activeAppId === windowState.app.id) {
        elements.workspaceNotice.textContent = String(event.data.detail && event.data.detail.message || 'Application error');
      }
      if (type === 'coachtools:app-data-progress' && windowState) {
        const detail = event.data.detail || {};
        windowState.dataProgress = windowState.dataProgress || new Map();
        if (detail.type) windowState.dataProgress.set(detail.type, detail.status || 'waiting');
        if (state.activeAppId === windowState.app.id) {
          const labels = { waiting: 'Waiting', loading: 'Loading', ready: 'Ready', cached: 'Ready', error: 'Unavailable', cancelled: 'Stopped' };
          const summary = (windowState.app.data || []).map(datasetType => `${datasetLabel(datasetType)} ${labels[windowState.dataProgress.get(datasetType)] || 'Waiting'}`).join(' · ');
          elements.workspaceNotice.textContent = summary || requirementNotice(windowState.app);
        }
      }
      if (type === 'coachtools:first-useful-render' && windowState && !windowState.usefulRenderMeasured) {
        windowState.usefulRenderMeasured = true;
        if (root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.end(`First useful app render · ${windowState.app.id}`, { appId: windowState.app.id });
      }
      if (type === 'coachtools:storage-stage-result' && windowState && windowState.app.id === 'weekly-data') {
        state.pendingStageFiles = [];
        state.pendingStageSent = false;
      }
      if (type === 'coachtools:data-updated' || type === 'coachtools:scope-updated') renderDataStatus();
    });
    root.addEventListener('coachtools:data-updated', event => {
      renderDataStatus();
      for (const windowState of openWindows.values()) try { windowState.iframe.contentWindow.postMessage({ type: 'coachtools:data-updated', detail: event.detail || {} }, '*'); } catch (_) {}
    });
    root.addEventListener('coachtools:scope-updated', event => {
      renderDataStatus();
      for (const windowState of openWindows.values()) try { windowState.iframe.contentWindow.postMessage({ type: 'coachtools:scope-updated', detail: event.detail || {} }, '*'); } catch (_) {}
    });
    root.addEventListener('coachtools:identity-updated', () => { refreshGlobalScope(); renderDataStatus(); });
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
      globalScopeSelect: $('globalScopeSelect'),
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
      quickDataInput: $('quickDataInput'),
      toast: $('toast')
    });
  }

  function detectWallpaper() {
    return new Promise(resolve => {
      const image = new Image();
      image.addEventListener('load', () => {
        elements.wallpaper.style.backgroundImage = 'url("graphics/background.png")';
        elements.wallpaper.classList.add('has-wallpaper');
        resolve(true);
      }, { once: true });
      image.addEventListener('error', () => {
        elements.wallpaper.classList.remove('has-wallpaper');
        elements.wallpaper.style.backgroundImage = '';
        resolve(false);
      }, { once: true });
      image.src = 'graphics/background.png';
    });
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
      createDeferredWindow(byId.get(id), { minimized: minimized.has(id) || id !== saved.activeId });
    }
    state.pendingRestoreActiveId = saved.activeId && openWindows.has(saved.activeId) && !minimized.has(saved.activeId) ? saved.activeId : '';
    elements.workspace.hidden = true;
    elements.desktop.hidden = false;
    renderTaskbar();
  }

  async function runStartupSequence() {
    state.startupStartedAt = Date.now();
    if (root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.start('Desktop boot');
    setStartupProgress(10, 'Starting CoachTools', 'Preparing the visual shell and application manifest…', 'Starting');
    await nextPaint();
    setStartupProgress(22, 'Loading interface', `${apps.length} applications found · applications remain deferred.`, `${apps.length} apps`);
    await preloadDesktopAssets();
    setStartupProgress(62, 'Opening shared storage', 'Opening IndexedDB metadata without reading complete datasets…', 'Metadata');
    try { if (storage && storage.ready) await storage.ready(); } catch (_) {}
    const statuses = currentDatasetStatuses();
    const totalSources = datasetTotal(statuses);
    renderStartupDatasets(statuses);
    const readyCount = statuses.filter(item => item.ready).length;
    setStartupProgress(78, 'Checking current data', `${readyCount} of ${totalSources} data sources available from IndexedDB metadata.`, `${readyCount} of ${totalSources} ready`);
    await nextPaint();
    hydrateSystemIcons();
    renderCategories();
    renderDataStatus();
    restoreOpenWindows();
    setStartupProgress(92, 'Preparing workspace', 'Restoring desktop and taskbar state without opening application frames…', 'Almost ready');
    await nextPaint();
    setStartupProgress(100, 'CoachTools ready', `${readyCount} of ${totalSources} shared data sources ready · applications load on demand.`, 'Ready');
    await nextPaint();
    dismissStartupSplash();
    if (root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.end('Desktop boot', { readyDatasets: readyCount });

    root.setTimeout(async () => {
      if (root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.start('People registry initialization');
      try { await refreshGlobalScope(); }
      finally { if (root.CoachToolsDiagnostics) root.CoachToolsDiagnostics.end('People registry initialization'); }
    }, 0);

    root.setTimeout(async () => {
      await yieldLowPriority();
      state.storageCheckLabel = location.protocol === 'file:' ? '' : 'Checking shared storage…';
      renderDataStatus();
      try { await scanStorage({ startup: true, background: true }); }
      catch (error) { saveScanRecord({ available: false, fileCount: 0, ambiguous: [], summary: 'Background storage check could not finish' }); }
      finally {
        state.startupScanActive = false;
        state.storageCheckLabel = state.lastScan && state.lastScan.summary || '';
        renderDataStatus();
      }
      if (state.pendingStageFiles.length) showToast('Some storage files need review. Open Data Manager to place them safely.', 6500);
    }, 220);

    if (state.pendingRestoreActiveId) root.setTimeout(() => activateWindow(state.pendingRestoreActiveId), 90);
  }

  function init() {
    collectElements();
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
    state.wallpaperReady = detectWallpaper();
    updateClock();
    state.clockTimer = setInterval(updateClock, 30000);
    if (!apps.length) showToast('No applications were found. Run the manifest generator and reload.', 8000);
    runStartupSequence();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
