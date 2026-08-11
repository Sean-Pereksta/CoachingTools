(function startCoachToolsDesktop(root) {
  'use strict';

  const manifest = root.COACHTOOLS_MANIFEST || { schemaVersion: 1, suite: { name: 'CoachTools', version: '1.0' }, apps: [] };
  const apps = (manifest.apps || []).filter(app => app && app.enabled !== false);
  const byId = new Map(apps.map(app => [app.id, app]));
  const storage = root.CoachToolsStorage;
  const FAVORITES_KEY = 'coachtools.desktop.favorites.v1';
  const RECENT_KEY = 'coachtools.desktop.recent.v1';
  const MAX_RECENT = 8;
  const elements = {};
  const state = {
    query: '',
    category: 'All Tools',
    favorites: new Set(),
    recent: [],
    activeApp: null,
    contextApp: null,
    loadTimer: null,
    toastTimer: null
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
    state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, duration || 3600);
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function createIcon(app, compact) {
    const wrap = document.createElement('span');
    wrap.className = 'app-icon' + (compact ? ' compact' : '');
    const fallback = document.createElement('span');
    fallback.className = 'fallback-initials';
    fallback.textContent = initials(app);
    wrap.appendChild(fallback);
    if (app.icon) {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('load', () => wrap.classList.add('loaded'));
      image.addEventListener('error', () => image.remove());
      image.src = app.icon;
      wrap.appendChild(image);
    }
    return wrap;
  }

  function missingRequirements(app) {
    const required = Array.isArray(app.data) ? app.data : [];
    return required.filter(source => !storage?.has(source));
  }

  function appSearchText(app) {
    return [app.name, app.description, app.category, ...(app.keywords || [])].join(' ').toLowerCase();
  }

  function sortedApps(list) {
    return list.slice().sort((a, b) => {
      const favoriteDifference = Number(state.favorites.has(b.id)) - Number(state.favorites.has(a.id));
      if (favoriteDifference) return favoriteDifference;
      const orderDifference = (Number(a.order) || 9999) - (Number(b.order) || 9999);
      return orderDifference || String(a.name).localeCompare(String(b.name));
    });
  }

  function filteredApps() {
    const query = state.query.trim().toLowerCase();
    return sortedApps(apps.filter(app => {
      if (state.category !== 'All Tools' && app.category !== state.category) return false;
      return !query || appSearchText(app).includes(query);
    }));
  }

  function toggleFavorite(app) {
    if (!app) return;
    if (state.favorites.has(app.id)) state.favorites.delete(app.id);
    else state.favorites.add(app.id);
    writeJson(FAVORITES_KEY, Array.from(state.favorites));
    renderApps();
    renderRecent();
  }

  function createAppCard(app) {
    const article = document.createElement('article');
    article.className = 'app-card' + (app.featured ? ' featured' : '');
    article.dataset.appId = app.id;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'app-card-main';
    main.setAttribute('aria-label', `Open ${app.name}`);
    main.appendChild(createIcon(app));

    const name = document.createElement('span');
    name.className = 'app-name';
    name.textContent = app.name;
    main.appendChild(name);

    const category = document.createElement('span');
    category.className = 'app-category';
    category.textContent = app.category || 'Other';
    main.appendChild(category);

    const missing = missingRequirements(app);
    if (missing.length) {
      const warning = document.createElement('span');
      warning.className = 'app-warning';
      warning.textContent = `△ ${missing.length} data source${missing.length === 1 ? '' : 's'} not loaded`;
      main.appendChild(warning);
    }
    main.addEventListener('click', () => openApp(app));
    article.appendChild(main);

    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'details-button';
    details.textContent = 'i';
    details.title = 'App details';
    details.setAttribute('aria-label', `Details for ${app.name}`);
    details.addEventListener('click', event => { event.stopPropagation(); showAppDetails(app); });
    article.appendChild(details);

    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'favorite-button' + (state.favorites.has(app.id) ? ' active' : '');
    favorite.textContent = state.favorites.has(app.id) ? '★' : '☆';
    favorite.title = state.favorites.has(app.id) ? 'Remove favorite' : 'Favorite';
    favorite.setAttribute('aria-label', favorite.title + ' ' + app.name);
    favorite.addEventListener('click', event => { event.stopPropagation(); toggleFavorite(app); });
    article.appendChild(favorite);

    article.addEventListener('contextmenu', event => {
      event.preventDefault();
      showContextMenu(app, event.clientX, event.clientY);
    });
    return article;
  }

  function renderApps() {
    const visible = filteredApps();
    elements.appGrid.replaceChildren(...visible.map(createAppCard));
    elements.emptyState.hidden = visible.length > 0;
  }

  function renderCategories() {
    const categories = ['All Tools', ...new Set(apps.map(app => app.category || 'Other'))];
    const buttons = categories.map(category => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'category-filter' + (state.category === category ? ' active' : '');
      button.textContent = category;
      button.addEventListener('click', () => {
        state.category = category;
        renderCategories();
        renderApps();
      });
      return button;
    });
    elements.categoryFilters.replaceChildren(...buttons);
  }

  function pushRecent(app) {
    state.recent = [app.id, ...state.recent.filter(id => id !== app.id && byId.has(id))].slice(0, MAX_RECENT);
    writeJson(RECENT_KEY, state.recent);
    renderRecent();
  }

  function renderRecent() {
    const recentApps = state.recent.map(id => byId.get(id)).filter(Boolean).slice(0, 5);
    elements.recentSection.hidden = recentApps.length === 0;
    elements.recentApps.replaceChildren(...recentApps.map(app => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recent-chip';
      button.textContent = app.name;
      button.addEventListener('click', () => openApp(app));
      return button;
    }));
    elements.taskbarRecent.replaceChildren(...recentApps.slice(0, 3).map(app => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'taskbar-app';
      button.textContent = app.name;
      button.title = app.name;
      button.addEventListener('click', () => openApp(app));
      return button;
    }));
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
    const statuses = storage?.getDatasetStatus?.() || [];
    elements.datasetStatus.replaceChildren(...statuses.map(item => {
      const box = document.createElement('div');
      box.className = 'dataset-item' + (item.ready ? ' ready' : '');
      box.title = item.ready ? `${item.label} data is available${item.updatedAt ? ` — updated ${formatDate(item.updatedAt)}` : ''}` : `${item.label} data is not loaded`;
      const label = document.createElement('span');
      label.textContent = item.label;
      const value = document.createElement('strong');
      value.textContent = item.ready ? 'Ready' : 'Needed';
      box.append(label, value);
      return box;
    }));
    const ready = statuses.filter(item => item.ready).length;
    elements.readyCount.textContent = `${ready}/${statuses.length || 5} data sources`;
    elements.readyCount.parentElement.classList.toggle('ready', ready === statuses.length && ready > 0);
    elements.scopeLabel.textContent = scopeText(storage?.getScope?.());
    renderApps();
  }

  function requirementNotice(app) {
    const missing = missingRequirements(app);
    if (!missing.length) return '';
    const labels = missing.map(id => storage?.LABELS?.[id] || id).join(', ');
    return `Missing data: ${labels}. The app can still open.`;
  }

  function showUnavailable(app) {
    elements.frameLoading.hidden = true;
    elements.frameUnavailable.hidden = false;
    elements.frameUnavailablePath.textContent = `Missing or unreadable: ${app.file}`;
  }

  function openApp(app) {
    if (!app || !app.file) return;
    state.activeApp = app;
    pushRecent(app);
    closeMenus();
    elements.workspaceTitle.textContent = app.name;
    elements.workspaceNotice.textContent = requirementNotice(app);
    elements.desktop.hidden = true;
    elements.workspace.hidden = false;
    elements.frameUnavailable.hidden = true;
    elements.frameLoading.hidden = false;
    clearTimeout(state.loadTimer);
    elements.appFrame.title = app.name;
    elements.appFrame.src = app.file;
    state.loadTimer = setTimeout(() => { elements.frameLoading.hidden = true; }, 10000);
  }

  function showDesktop() {
    clearTimeout(state.loadTimer);
    elements.workspace.hidden = true;
    elements.desktop.hidden = false;
    renderDataStatus();
  }

  function popOut(app) {
    if (!app || !app.file) return;
    const opened = root.open(app.file, `coachtools_${app.id}`);
    if (!opened) showToast('Your browser blocked the new window. Allow pop-ups for this file and try again.');
  }

  function reloadActive() {
    if (!state.activeApp) return;
    elements.frameUnavailable.hidden = true;
    elements.frameLoading.hidden = false;
    const current = state.activeApp.file;
    elements.appFrame.src = 'about:blank';
    setTimeout(() => { elements.appFrame.src = current; }, 0);
  }

  function showContextMenu(app, x, y) {
    state.contextApp = app;
    const favoriteAction = elements.contextMenu.querySelector('[data-context-action="favorite"]');
    favoriteAction.textContent = state.favorites.has(app.id) ? 'Remove favorite' : 'Favorite';
    elements.contextMenu.hidden = false;
    const width = 200;
    const height = 170;
    elements.contextMenu.style.left = Math.max(8, Math.min(x, root.innerWidth - width - 8)) + 'px';
    elements.contextMenu.style.top = Math.max(8, Math.min(y, root.innerHeight - height - 8)) + 'px';
  }

  function closeMenus() {
    elements.startMenu.hidden = true;
    elements.startButton.setAttribute('aria-expanded', 'false');
    elements.contextMenu.hidden = true;
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
    const data = Array.isArray(app.data) && app.data.length ? app.data.map(id => storage?.LABELS?.[id] || id).join(', ') : 'No shared dataset required';
    const rows = [
      ['Category', app.category || 'Other'],
      ['Version', app.version || '1.0'],
      ['HTML file', app.file],
      ['Icon file', app.icon || 'CSS initials fallback'],
      ['Data sources', data],
      ['Status', missingRequirements(app).length ? 'Opens with a data warning' : 'Ready to open']
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
    open.className = 'quiet-button';
    open.textContent = 'Open';
    open.addEventListener('click', () => { elements.detailsDialog.close?.(); openApp(app); });
    const newWindow = document.createElement('button');
    newWindow.type = 'button';
    newWindow.className = 'quiet-button';
    newWindow.textContent = 'Open in new window';
    newWindow.addEventListener('click', () => popOut(app));
    actions.append(open, newWindow);
    container.appendChild(actions);
    elements.detailsContent.replaceChildren(container);
    openDialog(elements.detailsDialog);
  }

  function showDiagnostics() {
    const status = storage?.getDatasetStatus?.() || [];
    const size = storage?.getApproximateStorageSize?.() || { bytes: 0, entries: 0 };
    const missingIcons = apps.filter(app => app.icon).length;
    const content = document.createElement('div');
    content.className = 'diagnostics-grid';

    const summary = document.createElement('section');
    summary.className = 'diagnostic-card';
    const summaryHeading = document.createElement('h3');
    summaryHeading.textContent = 'Suite';
    summary.appendChild(summaryHeading);
    const summaryList = document.createElement('ul');
    summaryList.className = 'diagnostic-list';
    const summaryRows = [
      ['Manifest schema', String(manifest.schemaVersion || 1)],
      ['Suite version', String(manifest.suite?.version || '1.0')],
      ['Applications', String(apps.length)],
      ['Icon fallbacks available', String(missingIcons)],
      ['Storage entries', String(size.entries)],
      ['Approximate storage', formatBytes(size.bytes)]
    ];
    for (const [label, value] of summaryRows) {
      const item = document.createElement('li');
      const labelElement = document.createElement('span');
      labelElement.textContent = label;
      const valueElement = document.createElement('strong');
      valueElement.textContent = value;
      item.append(labelElement, valueElement);
      summaryList.appendChild(item);
    }
    summary.appendChild(summaryList);
    content.appendChild(summary);

    const datasets = document.createElement('section');
    datasets.className = 'diagnostic-card';
    const datasetHeading = document.createElement('h3');
    datasetHeading.textContent = 'Shared weekly data';
    datasets.appendChild(datasetHeading);
    const datasetList = document.createElement('ul');
    datasetList.className = 'diagnostic-list';
    for (const item of status) {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = item.label;
      const value = document.createElement('strong');
      value.textContent = item.ready ? `Ready · ${formatBytes(item.bytes)}` : 'Not loaded';
      row.append(label, value);
      datasetList.appendChild(row);
    }
    datasets.appendChild(datasetList);
    content.appendChild(datasets);

    const files = document.createElement('section');
    files.className = 'diagnostic-card';
    files.style.gridColumn = '1 / -1';
    const filesHeading = document.createElement('h3');
    filesHeading.textContent = 'Installed applications';
    files.appendChild(filesHeading);
    const filesList = document.createElement('ul');
    filesList.className = 'diagnostic-list';
    for (const app of sortedApps(apps)) {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = app.name;
      const value = document.createElement('code');
      value.textContent = app.file;
      row.append(label, value);
      filesList.appendChild(row);
    }
    files.appendChild(filesList);
    const note = document.createElement('p');
    note.textContent = 'Application paths and manifest integrity are verified by build/validate-suite.js. Missing custom images automatically use initials.';
    files.appendChild(note);
    content.appendChild(files);

    elements.diagnosticsContent.replaceChildren(content);
    openDialog(elements.diagnosticsDialog);
  }

  function showAbout() {
    const version = manifest.suite?.version || '1.0';
    elements.aboutSummary.textContent = manifest.suite?.description || 'A portable desktop for your coaching analytics tools.';
    const ready = storage?.getDatasetStatus?.().filter(item => item.ready).length || 0;
    const facts = [
      [version, 'Version'],
      [String(apps.length), 'Applications'],
      [`${ready}/5`, 'Data ready']
    ];
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
      const skipped = backup.skipped?.length || 0;
      showToast(`Backup created${skipped ? ` · ${skipped} oversized item${skipped === 1 ? '' : 's'} skipped` : ''}.`);
    } catch (error) {
      showToast('Backup failed: ' + (error?.message || error), 6000);
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
      showToast('Restore failed: ' + (error?.message || error), 6500);
    } finally {
      elements.restoreInput.value = '';
    }
  }

  function openWeeklyData() {
    const app = byId.get('weekly-data') || apps.find(item => /weekly|loader|data builder/i.test(item.name));
    if (app) openApp(app);
    else showToast('Weekly Data is not present in the application manifest.');
  }

  function handleAction(action) {
    if (action === 'open-weekly-data') openWeeklyData();
    if (action === 'diagnostics') showDiagnostics();
    if (action === 'about') showAbout();
    if (action === 'backup') downloadBackup();
    if (action === 'restore') elements.restoreInput.click();
    if (action === 'show-desktop') showDesktop();
    if (action === 'reload-app') reloadActive();
    if (action === 'popout-active') popOut(state.activeApp);
    if (action === 'clear-recent') {
      state.recent = [];
      writeJson(RECENT_KEY, []);
      renderRecent();
    }
    if (action === 'clear-search') {
      state.query = '';
      state.category = 'All Tools';
      elements.appSearch.value = '';
      renderCategories();
      renderApps();
    }
    closeMenus();
  }

  function bind() {
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action) {
        event.preventDefault();
        handleAction(action);
        return;
      }
      if (!event.target.closest('#startMenu') && !event.target.closest('#startButton') && !event.target.closest('#appContextMenu')) closeMenus();
    });

    elements.startButton.addEventListener('click', event => {
      event.stopPropagation();
      const opening = elements.startMenu.hidden;
      closeMenus();
      elements.startMenu.hidden = !opening;
      elements.startButton.setAttribute('aria-expanded', String(opening));
    });

    elements.contextMenu.addEventListener('click', event => {
      const action = event.target.closest('[data-context-action]')?.dataset.contextAction;
      const app = state.contextApp;
      if (!action || !app) return;
      if (action === 'open') openApp(app);
      if (action === 'popout') popOut(app);
      if (action === 'favorite') toggleFavorite(app);
      if (action === 'details') showAppDetails(app);
      closeMenus();
    });

    elements.appSearch.addEventListener('input', event => {
      state.query = event.target.value;
      renderApps();
    });

    document.addEventListener('keydown', event => {
      if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
        event.preventDefault();
        elements.appSearch.focus();
      }
      if (event.key === 'Escape') closeMenus();
    });

    elements.appFrame.addEventListener('load', () => {
      clearTimeout(state.loadTimer);
      elements.frameLoading.hidden = true;
      if (!state.activeApp || elements.appFrame.src === 'about:blank') return;
      try {
        const doc = elements.appFrame.contentDocument;
        if (doc?.URL === 'about:blank' && state.activeApp.file !== 'about:blank') showUnavailable(state.activeApp);
      } catch (_) {
        // Some file:// browser policies isolate local frames even when they loaded correctly.
      }
    });
    elements.appFrame.addEventListener('error', () => state.activeApp && showUnavailable(state.activeApp));
    elements.restoreInput.addEventListener('change', event => restoreBackup(event.target.files?.[0]));

    root.addEventListener('message', event => {
      const type = event.data?.type;
      if (type === 'coachtools:app-ready') elements.frameLoading.hidden = true;
      if (type === 'coachtools:show-desktop') showDesktop();
      if (type === 'coachtools:pop-out') popOut(state.activeApp);
      if (type === 'coachtools:data-updated' || type === 'coachtools:scope-updated') renderDataStatus();
    });
    root.addEventListener('coachtools:data-updated', renderDataStatus);
    root.addEventListener('coachtools:scope-updated', renderDataStatus);
  }

  function collectElements() {
    Object.assign(elements, {
      desktop: $('desktop'),
      workspace: $('workspace'),
      appGrid: $('appGrid'),
      emptyState: $('emptyState'),
      appSearch: $('appSearch'),
      categoryFilters: $('categoryFilters'),
      recentSection: $('recentSection'),
      recentApps: $('recentApps'),
      taskbarRecent: $('taskbarRecent'),
      readyCount: $('readyCount'),
      datasetStatus: $('datasetStatus'),
      scopeLabel: $('scopeLabel'),
      startButton: $('startButton'),
      startMenu: $('startMenu'),
      contextMenu: $('appContextMenu'),
      workspaceTitle: $('workspaceTitle'),
      workspaceNotice: $('workspaceNotice'),
      appFrame: $('appFrame'),
      frameLoading: $('frameLoading'),
      frameUnavailable: $('frameUnavailable'),
      frameUnavailablePath: $('frameUnavailablePath'),
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

  function init() {
    collectElements();
    const savedFavorites = readJson(FAVORITES_KEY, null);
    if (Array.isArray(savedFavorites)) state.favorites = new Set(savedFavorites.filter(id => byId.has(id)));
    else {
      state.favorites = new Set(apps.filter(app => app.favorite).map(app => app.id));
      writeJson(FAVORITES_KEY, Array.from(state.favorites));
    }
    state.recent = readJson(RECENT_KEY, []).filter(id => byId.has(id)).slice(0, MAX_RECENT);
    $('startVersion').textContent = `Version ${manifest.suite?.version || '1.0'}`;
    bind();
    renderCategories();
    renderRecent();
    renderDataStatus();
    if (!apps.length) showToast('No applications were found. Run the manifest generator and reload.', 8000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
