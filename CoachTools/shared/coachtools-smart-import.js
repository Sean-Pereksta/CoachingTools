(function attachCoachToolsSmartImport(root) {
  'use strict';

  const FILTERABLE_SOURCES = Object.freeze(['documentedCoaching', 'checklist', 'weeklyRetail', 'weeklyReferral', 'qa']);
  const ORG_KEY = 'allStarOrgBuilder.v1';
  const SOURCE_SHORT_LABELS = Object.freeze({
    documentedCoaching: 'Documented Coaching',
    checklist: 'Checklist',
    weeklyRetail: 'Retail Weekly',
    weeklyReferral: 'Referral Weekly',
    qa: 'QA'
  });

  const state = {
    busy: false,
    chooser: null,
    options: [],
    optionById: new Map(),
    selected: new Set(),
    autoSelected: new Set(),
    blockedAuto: new Set(),
    aliasGroups: new Map(),
    resolver: null,
    reviewFiles: [],
    search: ''
  };

  function $(id) { return root.document.getElementById(id); }
  function display(value) { return String(value == null ? '' : value).trim().replace(/\s+/g, ' '); }
  function normalize(value) {
    const importer = root.CoachToolsImport;
    if (importer && typeof importer.normalizeName === 'function') return importer.normalizeName(value);
    return display(value).replace(/,/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  }
  function canonicalTokens(value) {
    let raw = display(value);
    if (raw.includes(',')) {
      const parts = raw.split(',');
      const last = display(parts.shift());
      const rest = display(parts.join(' '));
      if (last && rest) raw = `${rest} ${last}`;
    }
    return raw
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[.’'`]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }
  function canonicalKey(value) { return canonicalTokens(value).join(' '); }
  function lastName(value) { const parts = canonicalTokens(value); return parts.length ? parts[parts.length - 1] : ''; }
  function nextPaint() { return new Promise(resolve => root.requestAnimationFrame(() => resolve())); }
  function yieldMainThread() {
    return new Promise(resolve => {
      if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(() => resolve(), { timeout: 120 });
      else root.setTimeout(resolve, 0);
    });
  }

  function progressElements() {
    return {
      wrap: $('importProgress'),
      card: $('importProgress') && $('importProgress').querySelector('.import-card'),
      title: $('importTitle'),
      summary: $('importSummary'),
      fill: $('importProgressFill'),
      track: $('importProgressFill') && $('importProgressFill').parentElement,
      source: $('importCurrentSource'),
      file: $('importCurrentFile'),
      count: $('importCount'),
      steps: $('importSteps'),
      close: $('importClose'),
      review: $('importReview')
    };
  }

  function setProgress(percent, source, file, count, summary) {
    const el = progressElements();
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    if (el.fill) el.fill.style.width = `${value}%`;
    if (el.track) el.track.setAttribute('aria-valuenow', String(Math.round(value)));
    if (el.source && source != null) el.source.textContent = source;
    if (el.file && file != null) el.file.textContent = file;
    if (el.count && count != null) el.count.textContent = count;
    if (el.summary && summary != null) el.summary.textContent = summary;
  }

  function setStep(label, status) {
    const el = progressElements();
    if (!el.steps) return;
    let item = Array.from(el.steps.children).find(node => node.dataset.smartStep === label);
    if (!item) {
      item = root.document.createElement('li');
      item.dataset.smartStep = label;
      item.textContent = label;
      el.steps.appendChild(item);
    }
    item.className = `progress-step ${status || ''}`.trim();
  }

  function beginProgress(fileCount) {
    const el = progressElements();
    if (!el.wrap) return;
    if (el.card) el.card.classList.remove('smart-import-active');
    if (el.title) el.title.textContent = 'Preparing shared data';
    if (el.steps) el.steps.replaceChildren();
    if (el.close) el.close.hidden = true;
    if (el.review) el.review.hidden = true;
    el.wrap.hidden = false;
    setProgress(2, 'Reading selected files', '', `0 of ${fileCount}`, 'Reading workbook headers and identifying CoachTools data sources…');
    setStep('Reading selected files', 'active');
  }

  function finishProgress(summary, options) {
    const el = progressElements();
    hideChooser();
    setProgress(100, options && options.warning ? 'Review available' : 'Ready', '', options && options.count || '', summary);
    setStep('Ready', options && options.warning ? 'warning' : 'success');
    if (el.close) el.close.hidden = false;
    if (el.review) {
      el.review.hidden = !(options && options.review);
      if (!el.review.hidden) el.review.textContent = 'Review unrecognized files in Data Manager';
    }
  }

  function loadOrgs() {
    try {
      const raw = JSON.parse(root.localStorage.getItem(ORG_KEY) || '[]');
      const orgs = Array.isArray(raw) ? raw : Array.isArray(raw && raw.orgs) ? raw.orgs : [];
      return orgs
        .map(org => ({
          id: display(org && org.id) || display(org && org.name),
          name: display(org && org.name) || 'Unnamed Org',
          coachNames: Array.isArray(org && org.coachNames) ? org.coachNames.map(display).filter(Boolean) : []
        }))
        .filter(org => org.id && org.coachNames.length)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (_) { return []; }
  }

  async function buildAliasGroups() {
    const groups = new Map();
    const identity = root.CoachToolsIdentity;
    if (!identity || typeof identity.getCoaches !== 'function') return groups;
    let coaches = [];
    try { coaches = await identity.getCoaches(); } catch (_) { return groups; }
    for (const coach of coaches || []) {
      const names = [coach.displayName, ...(coach.aliases || [])];
      for (const sourceNames of Object.values(coach.sourceNames || {})) {
        if (Array.isArray(sourceNames)) names.push(...sourceNames);
      }
      const keys = Array.from(new Set(names.map(canonicalKey).filter(Boolean)));
      for (const key of keys) {
        if (!groups.has(key)) groups.set(key, new Set());
        const target = groups.get(key);
        for (const alias of keys) target.add(alias);
      }
    }
    return groups;
  }

  async function collectOptions(recognized) {
    const importer = root.CoachToolsImport;
    const records = [];
    const seen = new Set();
    for (const entry of recognized) {
      const source = entry.classification && entry.classification.id;
      if (!FILTERABLE_SOURCES.includes(source)) continue;
      const headerName = importer.SOURCES[source].header;
      for (const sheetName of entry.parsed && entry.parsed.workbook && entry.parsed.workbook.sheets || []) {
        const aoa = entry.parsed.workbook.data[sheetName] && entry.parsed.workbook.data[sheetName].aoa || [];
        const header = importer.findHeader(aoa, headerName);
        if (!header) continue;
        for (let rowIndex = header.headerRow + 1; rowIndex < aoa.length; rowIndex += 1) {
          const row = aoa[rowIndex];
          const value = display(Array.isArray(row) ? row[header.colIndex] : '');
          const key = normalize(value);
          if (value && key) {
            const uniqueKey = `${source}::${key}`;
            if (!seen.has(uniqueKey)) {
              seen.add(uniqueKey);
              records.push({
                id: uniqueKey,
                source,
                sourceLabel: SOURCE_SHORT_LABELS[source] || importer.SOURCES[source].label || source,
                value,
                normalized: key,
                canonical: canonicalKey(value),
                last: lastName(value),
                tokenCount: canonicalTokens(value).length,
                fileName: entry.file && entry.file.name || '',
                sheetName
              });
            }
          }
          if (rowIndex > header.headerRow && rowIndex % 4000 === 0) await yieldMainThread();
        }
      }
    }
    return records.sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel) || a.value.localeCompare(b.value));
  }

  function fullNameCountByLast() {
    const counts = new Map();
    for (const option of state.options) {
      if (option.tokenCount < 2 || !option.last) continue;
      if (!counts.has(option.last)) counts.set(option.last, new Set());
      counts.get(option.last).add(option.canonical);
    }
    return counts;
  }

  function relatedOptions(nameOrOption) {
    const seedValue = typeof nameOrOption === 'string' ? nameOrOption : nameOrOption && nameOrOption.value || '';
    const seedCanonical = canonicalKey(seedValue);
    const seedTokens = canonicalTokens(seedValue);
    const seedLast = seedTokens[seedTokens.length - 1] || '';
    if (!seedCanonical) return [];
    const identityAliases = state.aliasGroups.get(seedCanonical) || new Set([seedCanonical]);
    const fullCounts = fullNameCountByLast();
    return state.options.filter(option => {
      if (option.canonical === seedCanonical || identityAliases.has(option.canonical)) return true;
      if (!seedLast || option.last !== seedLast) return false;
      if (seedTokens.length >= 2 && option.tokenCount === 1) return true;
      if (seedTokens.length === 1 && option.tokenCount >= 2) {
        const namesForLast = fullCounts.get(seedLast);
        return Boolean(namesForLast && namesForLast.size === 1);
      }
      return false;
    });
  }

  function selectOption(option, options) {
    if (!option) return;
    const automatic = Boolean(options && options.automatic);
    if (automatic && state.blockedAuto.has(option.id)) return;
    state.selected.add(option.id);
    if (automatic) state.autoSelected.add(option.id);
    else {
      state.autoSelected.delete(option.id);
      state.blockedAuto.delete(option.id);
    }
  }

  function selectWithRelated(option) {
    selectOption(option, { automatic: false });
    for (const related of relatedOptions(option)) {
      if (related.id !== option.id) selectOption(related, { automatic: true });
    }
  }

  function deselectOption(option, blockAuto) {
    if (!option) return;
    state.selected.delete(option.id);
    state.autoSelected.delete(option.id);
    if (blockAuto) state.blockedAuto.add(option.id);
  }

  function ensureChooser() {
    if (state.chooser && state.chooser.isConnected) return state.chooser;
    const el = progressElements();
    if (!el.card) return null;
    const chooser = root.document.createElement('section');
    chooser.id = 'smartImportChooser';
    chooser.className = 'smart-import-chooser';
    chooser.hidden = true;
    chooser.innerHTML = `
      <div class="smart-import-heading">
        <div>
          <strong>Choose what to pull in</strong>
          <span>Filter Retail Weekly, Referral Weekly, QA, Documented Coaching, and Checklist through one shared coach scope.</span>
        </div>
        <button id="smartImportAll" class="command-button" type="button">Upload All Data</button>
      </div>
      <div class="smart-import-controls">
        <label class="smart-import-search"><span>Coach search</span><input id="smartImportSearch" type="search" placeholder="Type Aisha Villalobos, Villalobos, etc."></label>
        <label class="smart-import-org"><span>All-Star Org</span><select id="smartImportOrg"><option value="">Choose an org…</option></select></label>
        <button id="smartImportAddOrg" class="command-button secondary" type="button">Add Org Coaches</button>
      </div>
      <div id="smartImportSelected" class="smart-import-selected"></div>
      <div id="smartImportSources" class="smart-import-sources"></div>
      <div class="smart-import-actions">
        <button id="smartImportCancel" class="command-button secondary" type="button">Cancel</button>
        <span id="smartImportSelectionSummary">Nothing selected yet</span>
        <button id="smartImportSelectedBtn" class="command-button" type="button" disabled>Upload Selected Coaches</button>
      </div>`;
    el.card.appendChild(chooser);
    state.chooser = chooser;

    chooser.querySelector('#smartImportSearch').addEventListener('input', event => {
      state.search = normalize(event.target.value);
      renderOptionLists();
    });
    chooser.querySelector('#smartImportAll').addEventListener('click', () => resolveChooser({ mode: 'all' }));
    chooser.querySelector('#smartImportCancel').addEventListener('click', () => resolveChooser({ mode: 'cancel' }));
    chooser.querySelector('#smartImportSelectedBtn').addEventListener('click', () => {
      if (!state.selected.size) return;
      resolveChooser({ mode: 'filtered', selections: selectionBySource() });
    });
    chooser.querySelector('#smartImportAddOrg').addEventListener('click', () => addSelectedOrg());
    return chooser;
  }

  function renderOrgs() {
    const chooser = ensureChooser();
    if (!chooser) return;
    const select = chooser.querySelector('#smartImportOrg');
    const orgs = loadOrgs();
    select.replaceChildren();
    const placeholder = root.document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = orgs.length ? 'Choose an org…' : 'No saved All-Star orgs found';
    select.appendChild(placeholder);
    for (const org of orgs) {
      const option = root.document.createElement('option');
      option.value = org.id;
      option.textContent = `${org.name} · ${org.coachNames.length} coaches`;
      option.dataset.coaches = JSON.stringify(org.coachNames);
      select.appendChild(option);
    }
  }

  function addSelectedOrg() {
    const chooser = ensureChooser();
    const select = chooser && chooser.querySelector('#smartImportOrg');
    const selected = select && select.selectedOptions && select.selectedOptions[0];
    if (!selected || !selected.value) return;
    let names = [];
    try { names = JSON.parse(selected.dataset.coaches || '[]'); } catch (_) {}
    for (const name of names) {
      for (const option of relatedOptions(name)) selectOption(option, { automatic: true });
    }
    renderChooserSelection();
    renderOptionLists();
  }

  function selectionBySource() {
    const grouped = {};
    for (const source of FILTERABLE_SOURCES) grouped[source] = [];
    for (const id of state.selected) {
      const option = state.optionById.get(id);
      if (option && grouped[option.source]) grouped[option.source].push(option.value);
    }
    for (const source of FILTERABLE_SOURCES) grouped[source] = Array.from(new Set(grouped[source])).sort((a, b) => a.localeCompare(b));
    return grouped;
  }

  function renderChooserSelection() {
    const chooser = ensureChooser();
    if (!chooser) return;
    const wrap = chooser.querySelector('#smartImportSelected');
    const selected = Array.from(state.selected).map(id => state.optionById.get(id)).filter(Boolean).sort((a, b) => a.value.localeCompare(b.value) || a.sourceLabel.localeCompare(b.sourceLabel));
    wrap.replaceChildren();
    if (!selected.length) {
      const empty = root.document.createElement('span');
      empty.className = 'smart-import-empty';
      empty.textContent = 'Select one or more coach values below, or add a saved All-Star org.';
      wrap.appendChild(empty);
    } else {
      for (const option of selected) {
        const chip = root.document.createElement('button');
        chip.type = 'button';
        chip.className = 'smart-import-chip';
        if (state.autoSelected.has(option.id)) chip.classList.add('auto');
        chip.title = `Remove ${option.value} from ${option.sourceLabel}`;
        chip.innerHTML = `<strong>${escapeHtml(option.value)}</strong><small>${escapeHtml(option.sourceLabel)}${state.autoSelected.has(option.id) ? ' · auto-match' : ''}</small><span>×</span>`;
        chip.addEventListener('click', () => {
          deselectOption(option, true);
          renderChooserSelection();
          renderOptionLists();
        });
        wrap.appendChild(chip);
      }
    }
    const summary = chooser.querySelector('#smartImportSelectionSummary');
    const selectedBtn = chooser.querySelector('#smartImportSelectedBtn');
    const sources = new Set(selected.map(option => option.source));
    if (summary) summary.textContent = selected.length ? `${selected.length} source value${selected.length === 1 ? '' : 's'} selected across ${sources.size} dataset${sources.size === 1 ? '' : 's'}` : 'Nothing selected yet';
    if (selectedBtn) selectedBtn.disabled = selected.length === 0;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderOptionLists() {
    const chooser = ensureChooser();
    if (!chooser) return;
    const wrap = chooser.querySelector('#smartImportSources');
    wrap.replaceChildren();
    const query = state.search;
    for (const source of FILTERABLE_SOURCES) {
      const all = state.options.filter(option => option.source === source);
      if (!all.length) continue;
      const visible = all.filter(option => !query || normalize(option.value).includes(query));
      const section = root.document.createElement('section');
      section.className = 'smart-import-source';
      const header = root.document.createElement('div');
      header.className = 'smart-import-source-heading';
      header.innerHTML = `<strong>${escapeHtml(SOURCE_SHORT_LABELS[source] || source)}</strong><span>${all.length} unique ${root.CoachToolsImport.SOURCES[source].header} value${all.length === 1 ? '' : 's'}${query ? ` · ${visible.length} shown` : ''}</span>`;
      const list = root.document.createElement('div');
      list.className = 'smart-import-option-list';
      if (!visible.length) {
        const empty = root.document.createElement('span');
        empty.className = 'smart-import-empty';
        empty.textContent = 'No matches in this uploaded dataset.';
        list.appendChild(empty);
      } else {
        for (const option of visible) {
          const label = root.document.createElement('label');
          label.className = 'smart-import-option';
          const checkbox = root.document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = state.selected.has(option.id);
          const copy = root.document.createElement('span');
          copy.innerHTML = `<strong>${escapeHtml(option.value)}</strong><small>${escapeHtml(option.fileName)}${option.sheetName ? ` · ${escapeHtml(option.sheetName)}` : ''}${state.autoSelected.has(option.id) ? ' · auto-match' : ''}</small>`;
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) selectWithRelated(option);
            else deselectOption(option, true);
            renderChooserSelection();
            renderOptionLists();
          });
          label.append(checkbox, copy);
          list.appendChild(label);
        }
      }
      section.append(header, list);
      wrap.appendChild(section);
    }
    renderChooserSelection();
  }

  function showChooser() {
    const chooser = ensureChooser();
    const el = progressElements();
    if (!chooser) return;
    if (el.card) el.card.classList.add('smart-import-active');
    chooser.hidden = false;
    if (el.title) el.title.textContent = 'Choose data scope';
    setProgress(58, 'Choose coaches or upload everything', '', `${state.options.length} unique values`, 'The uploaded files are recognized. Choose specific coaches / an All-Star org, or use Upload All Data to keep every row.');
    renderOrgs();
    renderOptionLists();
  }

  function hideChooser() {
    const chooser = state.chooser;
    const el = progressElements();
    if (chooser) chooser.hidden = true;
    if (el.card) el.card.classList.remove('smart-import-active');
  }

  function resolveChooser(choice) {
    if (!state.resolver) return;
    const resolve = state.resolver;
    state.resolver = null;
    hideChooser();
    resolve(choice);
  }

  function chooseImportScope() {
    showChooser();
    return new Promise(resolve => { state.resolver = resolve; });
  }

  async function scopeForChoice(choice) {
    const importer = root.CoachToolsImport;
    if (choice.mode === 'all') return importer.resolveScopeSnapshot ? importer.resolveScopeSnapshot({ mode: 'all', label: 'All people' }) : { mode: 'all', label: 'All people' };
    if (choice.mode === 'current') {
      const current = root.CoachToolsStorage && root.CoachToolsStorage.getScope ? root.CoachToolsStorage.getScope() : null;
      return importer.resolveScopeSnapshot ? importer.resolveScopeSnapshot(current || { mode: 'all', label: 'All people' }) : current || { mode: 'all', label: 'All people' };
    }
    const selectedValues = Array.from(new Set(Object.values(choice.selections || {}).flat().map(display).filter(Boolean)));
    let scope = importer.resolveScopeSnapshot
      ? await importer.resolveScopeSnapshot({ mode: 'team', label: 'Selected coaches', coaches: selectedValues })
      : { mode: 'team', label: 'Selected coaches', coaches: selectedValues };
    if (scope && scope.coachPersonIds && scope.coachPersonIds.length === 1) {
      scope = importer.resolveScopeSnapshot
        ? await importer.resolveScopeSnapshot({ mode: 'coach', personId: scope.coachPersonIds[0], label: scope.coaches[0] || 'Selected coach', coaches: scope.coaches })
        : scope;
    } else if (scope) {
      scope.label = scope.coaches && scope.coaches.length ? `${scope.coaches.length} selected coaches` : 'Selected coaches';
    }
    return scope;
  }

  async function savePreparedEntry(entry, scope) {
    const importer = root.CoachToolsImport;
    if (!importer || typeof importer.saveRecognizedEntry !== 'function') throw new Error('The shared CoachTools importer is unavailable.');
    return importer.saveRecognizedEntry(entry, { scope });
  }

  async function openReviewInDataManager() {
    if (!state.reviewFiles.length) return;
    const trigger = root.document.querySelector('[data-action="open-weekly-data"]');
    if (trigger) trigger.click();
    const started = Date.now();
    while (Date.now() - started < 12000) {
      const iframe = root.document.querySelector('iframe[data-app-id="weekly-data"]');
      if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ type: 'coachtools:stage-files', files: state.reviewFiles }, '*');
          return;
        } catch (_) {}
      }
      await new Promise(resolve => root.setTimeout(resolve, 250));
    }
  }

  async function importFiles(files) {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length || state.busy) return;
    const importer = root.CoachToolsImport;
    if (!importer || !root.CoachToolsData) return;

    state.busy = true;
    state.reviewFiles = [];
    state.options = [];
    state.optionById.clear();
    state.selected.clear();
    state.autoSelected.clear();
    state.blockedAuto.clear();
    state.search = '';
    beginProgress(selectedFiles.length);

    try {
      const analysis = await importer.analyzeFiles(selectedFiles, {
        onProgress(progress) {
          const fraction = progress.total ? progress.current / progress.total : 0;
          const completed = Number(progress.fileIndex) + fraction;
          setProgress(
            4 + (completed / Math.max(1, selectedFiles.length)) * 46,
            'Reading selected files',
            `${progress.fileName || ''}${progress.sheetName ? ` · ${progress.sheetName}` : ''}`,
            `${Math.min(selectedFiles.length, Number(progress.fileIndex) + 1)} of ${selectedFiles.length}`
          );
        }
      });

      setStep('Reading selected files', analysis.errors.length ? 'warning' : 'success');
      if (analysis.updateScopeNeedsReview) throw new Error(analysis.updateScopeReason || 'Update needs scope review. Existing data was retained.');
      setStep('Finding coach / team values', 'active');
      if (!analysis.updateMode) {
        state.aliasGroups = await buildAliasGroups();
        state.options = await collectOptions(analysis.recognized);
        state.optionById = new Map(state.options.map(option => [option.id, option]));
      }
      setStep('Finding coach / team values', 'success');

      let choice = { mode: 'current' };
      if (!analysis.updateMode && state.options.length) choice = await chooseImportScope();
      if (choice.mode === 'cancel') {
        if (root.CoachToolsCleanUploadBaseline && typeof root.CoachToolsCleanUploadBaseline.cancelPending === 'function') root.CoachToolsCleanUploadBaseline.cancelPending();
        finishProgress('Import cancelled. No uploaded files were changed.', { warning: false, review: false, count: 'Cancelled' });
        return;
      }
      const scope = analysis.updateMode
        ? (importer.resolveScopeSnapshot ? await importer.resolveScopeSnapshot(analysis.authoritativeUpdateScope) : analysis.authoritativeUpdateScope)
        : await scopeForChoice(choice);

      setStep(scope && scope.mode !== 'all' ? `Filtering ${scope.label || 'selected scope'}` : 'Keeping all uploaded rows', 'success');
      setStep('Saving to IndexedDB', 'active');
      const imported = [];
      const errors = analysis.errors.map(item => `${item.file && item.file.name || 'File'}: ${item.error && item.error.message || item.error}`);
      const entries = analysis.recognized.slice().sort((a, b) => Number(b.parsed && b.parsed.meta && b.parsed.meta.totalRows || 0) - Number(a.parsed && a.parsed.meta && a.parsed.meta.totalRows || 0));

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const type = entry.classification.id;
        const sourceLabel = importer.SOURCES[type] && importer.SOURCES[type].label || type;
        const rows = Number(entry.parsed && entry.parsed.meta && entry.parsed.meta.totalRows) || 0;
        setProgress(
          62 + (index / Math.max(1, entries.length)) * 34,
          `Saving ${sourceLabel}`,
          `${entry.file.name}${rows ? ` · ${rows.toLocaleString()} rows · indexing people after save` : ''}`,
          `${index + 1} of ${entries.length}`,
          'Large datasets are processed largest-first. CoachTools yields between files so the progress display can keep repainting.'
        );
        await nextPaint();
        await yieldMainThread();
        try {
          const result = await savePreparedEntry(entry, scope);
          imported.push({ id: type, fileName: entry.file.name, status: result.status, filtered: scope && scope.mode !== 'all', matchedRows: Number(result && result.dataset && result.dataset.scopedRowCount) || 0 });
        } catch (error) {
          errors.push(`${entry.file.name}: ${error && error.message || error}`);
        }
        setProgress(62 + ((index + 1) / Math.max(1, entries.length)) * 34, `Saved ${sourceLabel}`, entry.file.name, `${index + 1} of ${entries.length}`);
        await nextPaint();
        await yieldMainThread();
      }

      state.reviewFiles = analysis.needsReview.map(entry => entry.file);
      setStep('Saving to IndexedDB', errors.length ? 'warning' : 'success');
      if (analysis.needsReview.length) setStep(`${analysis.needsReview.length} file${analysis.needsReview.length === 1 ? '' : 's'} need review`, 'warning');

      const statuses = root.CoachToolsStorage && root.CoachToolsStorage.getDatasetStatus ? root.CoachToolsStorage.getDatasetStatus() : [];
      const ready = statuses.filter(item => item.ready).length;
      const total = statuses.length || importer.DATASET_ORDER.length;
      const duplicates = imported.filter(item => item.status === 'duplicate').length;
      const saved = imported.length - duplicates;
      const filteredRows = imported.filter(item => item.filtered).reduce((sum, item) => sum + item.matchedRows, 0);
      const parts = [
        `${ready} of ${total} data sources ready`,
        saved ? `${saved} file${saved === 1 ? '' : 's'} saved` : '',
        duplicates ? `${duplicates} duplicate${duplicates === 1 ? '' : 's'} already stored` : '',
        scope && scope.mode !== 'all' ? `${filteredRows.toLocaleString()} matching scoped rows pulled in` : 'all uploaded rows kept',
        analysis.needsReview.length ? `${analysis.needsReview.length} need manual placement` : '',
        errors.length ? `${errors.length} could not be saved` : ''
      ].filter(Boolean);
      finishProgress(`${parts.join(' · ')}.`, {
        warning: Boolean(analysis.needsReview.length || errors.length),
        review: analysis.needsReview.length > 0,
        count: `${ready} of ${total}`
      });
    } catch (error) {
      if (root.CoachToolsCleanUploadBaseline && typeof root.CoachToolsCleanUploadBaseline.cancelPending === 'function') root.CoachToolsCleanUploadBaseline.cancelPending();
      setStep('Saving to IndexedDB', 'warning');
      finishProgress(`Import failed: ${error && error.message || error}`, { warning: true, review: false, count: 'Stopped' });
    } finally {
      state.busy = false;
      const input = $('quickDataInput');
      if (input) input.value = '';
    }
  }

  function handleQuickInputChange(event) {
    const input = event.target;
    if (!input || input.id !== 'quickDataInput' || !input.files || !input.files.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    importFiles(input.files);
  }

  function init() {
    root.document.addEventListener('change', handleQuickInputChange, true);
    const review = $('importReview');
    if (review) review.addEventListener('click', event => {
      if (!state.reviewFiles.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openReviewInDataManager();
    }, true);
  }

  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  root.CoachToolsSmartImport = Object.freeze({
    VERSION: '1.0.0',
    FILTERABLE_SOURCES,
    importFiles,
    _test: Object.freeze({ canonicalTokens, canonicalKey, lastName })
  });
})(window);
