(function attachCoachToolsSourceScope(root) {
  'use strict';

  const base = root.CoachToolsImport;
  if (!base || typeof base.resolveScopeSnapshot !== 'function' || typeof base.prepareScopedDataset !== 'function') return;

  const BASELINE_KEY = 'coachtools.desktop.cleanUploadBaseline.v1';
  const ROUTING_VERSION = '1.0.1';
  let pendingChooserSelections = null;
  let pendingChooserScopeHash = '';
  let pendingChooserPersonIds = [];
  let pendingChooserExpiresAt = 0;

  function display(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function clone(value) {
    try { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  }

  function normalizeSelectionMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const result = {};
    for (const [source, names] of Object.entries(value)) {
      if (!Array.isArray(names)) continue;
      const seen = new Set();
      result[source] = [];
      for (const name of names) {
        const raw = display(name);
        const key = base.normalizeName ? base.normalizeName(raw) : raw.toLowerCase();
        if (!raw || !key || seen.has(key)) continue;
        seen.add(key);
        result[source].push(raw);
      }
    }
    return Object.keys(result).length ? result : null;
  }

  function normalizePersonIds(values) {
    return Array.from(new Set((values || []).map(display).filter(Boolean))).sort();
  }

  function samePersonIds(left, right) {
    const a = normalizePersonIds(left), b = normalizePersonIds(right);
    return Boolean(a.length && a.length === b.length && a.every((value, index) => value === b[index]));
  }

  function readBaseline() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(BASELINE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function baselineSelectionsFor(scope) {
    const baseline = readBaseline();
    const selections = normalizeSelectionMap(baseline && baseline.scope && baseline.scope.sourceSelections);
    if (!selections) return null;
    const requestedHash = display(scope && scope.scopeHash);
    const baselineHash = display(baseline && (baseline.scopeHash || baseline.scope && baseline.scope.scopeHash));
    if (requestedHash && baselineHash && requestedHash !== baselineHash) return null;
    return selections;
  }

  function sourceIdForLabel(label) {
    const wanted = display(label).toLowerCase();
    for (const [id, definition] of Object.entries(base.SOURCES || {})) {
      if (display(definition && definition.label).toLowerCase() === wanted) return id;
    }
    const aliases = {
      'documented coaching': 'documentedCoaching',
      'checklist': 'checklist',
      'retail weekly': 'weeklyRetail',
      'referral weekly': 'weeklyReferral',
      'qa': 'qa'
    };
    return aliases[wanted] || '';
  }

  function chooserSelections() {
    const doc = root.document;
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    const sections = Array.from(doc.querySelectorAll('#smartImportSources .smart-import-source'));
    if (!sections.length) return null;
    const grouped = {};
    for (const section of sections) {
      const label = section.querySelector && section.querySelector('.smart-import-source-heading strong');
      const source = sourceIdForLabel(label && label.textContent);
      if (!source) continue;
      grouped[source] = [];
      const checked = Array.from(section.querySelectorAll ? section.querySelectorAll('input[type="checkbox"]:checked') : []);
      for (const input of checked) {
        const row = input.closest && input.closest('label');
        const strong = row && row.querySelector && row.querySelector('span strong');
        const value = display(strong && strong.textContent);
        if (value) grouped[source].push(value);
      }
    }
    return normalizeSelectionMap(grouped);
  }

  function isSelectorSeed(scope) {
    const label = display(scope && scope.label).toLowerCase();
    return label === 'selected coaches' || label.includes('selected coach');
  }

  function attachSelections(scope, selections) {
    if (!scope || scope.mode === 'all' || !selections) return scope;
    return { ...scope, sourceSelections: clone(selections), sourceScopeRoutingVersion: ROUTING_VERSION };
  }

  async function resolveScopeSnapshot(scope) {
    const resolved = await base.resolveScopeSnapshot(scope);
    if (!resolved || resolved.mode === 'all') return resolved;

    let selections = normalizeSelectionMap(scope && scope.sourceSelections);
    if (!selections && isSelectorSeed(scope)) {
      selections = chooserSelections();
      if (selections) {
        pendingChooserSelections = clone(selections);
        pendingChooserScopeHash = display(resolved.scopeHash);
        pendingChooserPersonIds = normalizePersonIds(resolved.coachPersonIds);
        pendingChooserExpiresAt = Date.now() + 30000;
      }
    }
    if (!selections && pendingChooserSelections && Date.now() <= pendingChooserExpiresAt) {
      const sameHash = Boolean(pendingChooserScopeHash && resolved.scopeHash && pendingChooserScopeHash === resolved.scopeHash);
      const sameIdentity = samePersonIds(pendingChooserPersonIds, resolved.coachPersonIds);
      if (sameHash || sameIdentity) selections = clone(pendingChooserSelections);
    }
    if (!selections) selections = baselineSelectionsFor(resolved);
    return attachSelections(resolved, selections);
  }

  function routedSelection(scope, type) {
    if (!scope || scope.mode === 'all') return { explicit: false, names: [] };
    const selections = normalizeSelectionMap(scope.sourceSelections) || baselineSelectionsFor(scope);
    if (!selections || !Object.prototype.hasOwnProperty.call(selections, type)) return { explicit: false, names: [] };
    return { explicit: true, names: selections[type].slice(), selections };
  }

  function sourceFilterScope(authoritativeScope, type) {
    const route = routedSelection(authoritativeScope, type);
    if (!route.explicit) return { scope: authoritativeScope, route };
    if (!route.names.length) {
      if (['weeklyRetail','weeklyReferral'].includes(type)) return {scope:{mode:'all',label:'All people'},route};
      const label = base.SOURCES && base.SOURCES[type] && base.SOURCES[type].label || type;
      const error = new Error(`No coach value was selected for ${label}. Coach names selected in other files will not be substituted for this source.`);
      error.name = 'CoachToolsSourceScopeError';
      error.code = 'COACHTOOLS_SOURCE_SCOPE_EMPTY';
      error.datasetType = type;
      throw error;
    }
    const coachKeys = route.names.map(name => base.normalizeName ? base.normalizeName(name) : display(name).toLowerCase()).filter(Boolean);
    return {
      route,
      scope: {
        mode: route.names.length === 1 ? 'coach' : 'team',
        label: route.names.length === 1 ? route.names[0] : `${route.names.length} selected coaches`,
        coaches: route.names.slice(),
        coachKeys,
        coachPersonIds: [],
        personId: '',
        representatives: Array.isArray(authoritativeScope.representatives) ? authoritativeScope.representatives.slice() : [],
        team: '',
        department: '',
        coordinator: '',
        sourceSelections: clone(route.selections),
        sourceDataset: type
      }
    };
  }

  function scopeValidationError(reason, diagnostics) {
    const error = new Error(reason || 'The selected scope could not be applied safely.');
    error.name = 'CoachToolsScopeValidationError';
    error.code = 'COACHTOOLS_SCOPE_REVIEW';
    error.scopeMatchDiagnostics = diagnostics || null;
    return error;
  }

  function bindPreparedToAuthoritativeScope(prepared, authoritativeScope, type, route) {
    if (!prepared || !prepared.dataset || !authoritativeScope) return prepared;
    const diagnostics = {
      ...(prepared.diagnostics || {}),
      sourceScoped: Boolean(route && route.explicit),
      sourceDataset: type,
      selectedSourceValues: route && route.explicit ? route.names.slice() : []
    };
    prepared.diagnostics = diagnostics;
    prepared.scopeSnapshot = authoritativeScope;
    prepared.scopeHash = authoritativeScope.scopeHash;
    prepared.dataset.meta = {
      ...(prepared.dataset.meta || {}),
      scopeSnapshot: authoritativeScope,
      scopeHash: authoritativeScope.scopeHash,
      scopeMode: authoritativeScope.mode,
      scopeMatchDiagnostics: diagnostics,
      sourceScopeDataset: type,
      sourceScopeSelection: route && route.explicit ? route.names.slice() : [],
      sourceScopeRoutingVersion: ROUTING_VERSION
    };
    return prepared;
  }

  async function prepareRecognizedEntry(entry, options) {
    if (!entry || !entry.classification || !entry.classification.id) throw new Error('The file has not been safely classified.');
    const type = entry.classification.id;
    const requestedScope = options && Object.prototype.hasOwnProperty.call(options, 'scope') && options.scope
      ? options.scope
      : root.CoachToolsStorage && typeof root.CoachToolsStorage.getScope === 'function' ? root.CoachToolsStorage.getScope() : { mode: 'all', label: 'All people' };
    const authoritativeScope = await resolveScopeSnapshot(requestedScope || { mode: 'all', label: 'All people' });
    const routed = sourceFilterScope(authoritativeScope, type);
    const parsed = entry.rawWorkbook && typeof base.materializeDiscoveredEntry === 'function'
      ? await base.materializeDiscoveredEntry(entry, routed.scope, options)
      : entry.parsed;
    const validation = base.validateClassification(type, parsed);
    if (!validation.valid) throw new Error(validation.reason);

    if (['weeklyRetail', 'weeklyReferral', 'monthlyRetail', 'monthlyReferral', 'compCoaching'].includes(type)) {
      let period = entry.classification.detectedPeriod;
      if (!period || !period.sortKey || period.periodKey === 'current') {
        const periods = new Map();
        for (const sheetName of parsed.workbook.sheets || []) {
          const headings = [sheetName, ...(parsed.workbook.data[sheetName] && parsed.workbook.data[sheetName].aoa || []).slice(0, 10).map(row => row.join(' '))];
          for (const heading of headings) {
            const found = base.detectPeriod({ name: heading, lastModified: entry.file && entry.file.lastModified }, type);
            if (found.sortKey && found.periodKey !== 'current') periods.set(found.periodKey, found);
          }
        }
        if (periods.size === 1) period = [...periods.values()][0];
      }
      if (!period || !period.sortKey || period.periodKey === 'current') {
        if (['weeklyRetail', 'weeklyReferral'].includes(type)) period = { label: 'Current weekly upload', periodKey: 'current', sortKey: '' };
        else throw new Error('Could not determine a unique reporting period from the filename, worksheet names, or report headings.');
      }
      entry.classification.detectedPeriod = period;
    }

    entry.parsed = parsed;
    entry.rawWorkbook = null;
    const prepared = base.prepareScopedDataset(parsed, type, routed.scope, { ...(options || {}), detectedPeriod: entry.classification.detectedPeriod });
    if (!prepared.valid) throw scopeValidationError(prepared.reason, prepared.diagnostics);
    return bindPreparedToAuthoritativeScope(prepared, authoritativeScope, type, routed.route);
  }

  async function prepareOverrideEntry(entry, options, error) {
    const type = entry.classification.id;
    const weekly = ['weeklyRetail', 'weeklyReferral'].includes(type);
    if (!weekly && !(root.confirm && root.confirm(`Could not upload ${entry.file.name}: ${error.message || error}\n\nReplace the old ${base.SOURCES[type].label} data with this file? This deletes only that source's old stored data. Other sources are unchanged.`))) throw error;
    const parsed = await base.parseFile(entry.file);
    if (!parsed.meta.totalRows) throw new Error('The incoming file has no readable rows to store.');
    if (weekly) { const validation=base.validateClassification(type,parsed); if (!validation.valid) throw new Error(validation.reason); }
    const requestedScope = options && options.scope || root.CoachToolsStorage && root.CoachToolsStorage.getScope && root.CoachToolsStorage.getScope() || { mode: 'all', label: 'All people' };
    const authoritativeScope = await resolveScopeSnapshot(requestedScope);
    const routed = sourceFilterScope(authoritativeScope, type);
    const prepared = base.prepareScopedDataset(parsed, type, routed.scope, { detectedPeriod: entry.classification.detectedPeriod });
    if (!prepared.valid) throw new Error(prepared.reason);
    bindPreparedToAuthoritativeScope(prepared, authoritativeScope, type, routed.route);
    prepared.dataset.meta.overrideReason = String(error && error.message || error);
    prepared.dataset.meta.forceSourceReplacement = true;
    return prepared;
  }

  async function overrideEntry(entry, options, error) {
    const prepared = await prepareOverrideEntry(entry, options, error);
    return base.storePreparedEntry(entry, prepared, { ...(options || {}), forceSourceReplacement: true });
  }

  async function saveRecognizedEntry(entry, options) {
    if (!entry || !entry.classification || !entry.classification.id) throw new Error('The file has not been safely classified.');
    if (!root.CoachToolsData || typeof root.CoachToolsData.importDataset !== 'function') throw new Error('The central CoachTools data API is unavailable.');
    try {
      const prepared = await prepareRecognizedEntry(entry, options);
      return await base.storePreparedEntry(entry, prepared, options);
    } catch (error) {
      return overrideEntry(entry, options, error);
    }
  }

  async function saveRecognizedFiles(files, options) {
    const analysis = await base.analyzeFiles(files, options);
    const results = [];
    for (const entry of analysis.recognized) {
      try { results.push({ entry, result: await saveRecognizedEntry(entry, options) }); }
      catch (error) { analysis.errors.push({ file: entry.file, classification: entry.classification, error }); }
    }
    return { ...analysis, results };
  }

  root.CoachToolsImport = Object.freeze({
    ...base,
    SOURCE_SCOPE_ROUTING_VERSION: ROUTING_VERSION,
    resolveScopeSnapshot,
    prepareRecognizedEntry,
    prepareOverrideEntry,
    overrideEntry,
    saveRecognizedEntry,
    saveRecognizedFiles,
    _sourceScopeRouting: Object.freeze({ normalizeSelectionMap, normalizePersonIds, samePersonIds, routedSelection, sourceFilterScope })
  });
})(window);
