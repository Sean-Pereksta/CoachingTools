(function attachCoachToolsIdentity(root) {
  'use strict';

  const VERSION = '1.1.0';
  const DB_NAME = 'allStarImportedDataCache.v1';
  const DB_VERSION = 8;
  const DATASET_CHUNK_STORE = 'coachtoolsDatasetChunks';
  const PEOPLE_STORE = 'coachtoolsPeople';
  const REVIEW_STORE = 'coachtoolsIdentityReviews';
  const EVENT_NAME = 'coachtools:identity-updated';
  const SETUP_KEY = 'myone.master.v2.setup';
  const IMPORT_META_KEY = 'coachtools.identity.ingested.v1';
  const memoryPeople = new Map();
  const memoryReviews = new Map();
  const peopleByNormalizedName = new Map();
  const peopleByAlias = new Map();
  const coachesByDepartment = new Map();
  const coachesByTeam = new Map();
  const repsByCoach = new Map();
  const peopleByTeam = new Map();
  let identityVersion = 0;
  let memoryHydrated = false;
  let memoryHydrationPromise = null;
  let sortedPeopleCache = [];
  let sortedPeopleDirty = true;
  const ingestionQueue = [];
  const queuedIngestionKeys = new Set();
  let ingestionRunning = false;
  let databaseUnavailable = !('indexedDB' in root);
  let channel = null;
  try { if ('BroadcastChannel' in root) channel = new BroadcastChannel('coachtools-identity-v1'); } catch (_) {}

  function cleanDisplay(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function normalizeName(value) {
    let display = cleanDisplay(value);
    if (!display) return '';
    if (display.includes(',')) {
      const [last, ...rest] = display.split(',');
      const given = rest.join(' ').trim();
      if (last.trim() && given) display = `${given} ${last.trim()}`;
    }
    return display
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[.’'`]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function displayName(value) {
    const raw = cleanDisplay(value);
    if (!raw) return '';
    const reordered = raw.includes(',') ? (() => {
      const [last, ...rest] = raw.split(',');
      return rest.join(' ').trim() && last.trim() ? `${rest.join(' ').trim()} ${last.trim()}` : raw;
    })() : raw;
    if (/[a-z]/.test(reordered) && /[A-Z]/.test(reordered)) return reordered;
    return reordered.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, gap, letter) => gap + letter.toUpperCase());
  }

  function clone(value) {
    if (value == null) return value;
    try { if (typeof structuredClone === 'function') return structuredClone(value); } catch (_) {}
    return JSON.parse(JSON.stringify(value));
  }

  function unique(values) {
    const seen = new Set(), result = [];
    for (const value of values || []) {
      const raw = cleanDisplay(value), key = normalizeName(raw);
      if (!raw || seen.has(key)) continue;
      seen.add(key); result.push(raw);
    }
    return result;
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }

  function personIdFor(normalized) { return `person_${stableHash(normalized)}_${normalized.replace(/[^a-z0-9]/g, '').slice(0, 12) || 'unknown'}`; }
  function nowIso() { return new Date().toISOString(); }
  function idbRequest(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error('Identity database request failed.')); }); }
  function transactionDone(tx) { return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('Identity database transaction failed.')); tx.onabort = () => reject(tx.error || new Error('Identity database transaction aborted.')); }); }
  function ensureIndex(store, name, keyPath, options) {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options || { unique: false });
  }
  function migratePeopleIndexFields(store) {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const person = cursor.value || {};
      const aliasKeys = Array.from(new Set((person.aliases || []).map(normalizeName).filter(Boolean)));
      const currentTeam = person.currentTeam || person.team || '';
      if (JSON.stringify(person.aliasKeys || []) !== JSON.stringify(aliasKeys) || person.currentTeam !== currentTeam) cursor.update({ ...person, aliasKeys, currentTeam });
      cursor.continue();
    };
  }

  function openDatabase() {
    if (databaseUnavailable) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const upgradeTx = request.transaction;
        for (const name of ['meta', 'sourceData', 'books', 'misc']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        const datasetStore = db.objectStoreNames.contains('coachtoolsDatasets')
          ? upgradeTx.objectStore('coachtoolsDatasets')
          : db.createObjectStore('coachtoolsDatasets', { keyPath: 'id' });
        ensureIndex(datasetStore, 'datasetType', 'datasetType', { unique: false });
        ensureIndex(datasetStore, 'periodKey', ['datasetType', 'periodKey'], { unique: false });
        ensureIndex(datasetStore, 'fingerprint', ['datasetType', 'fingerprint'], { unique: false });
        ensureIndex(datasetStore, 'datasetTypePeriodSort', ['datasetType', 'periodSort'], { unique: false });
        ensureIndex(datasetStore, 'datasetTypePeriodSortImportedAt', ['datasetType', 'periodSort', 'importedAt'], { unique: false });
        ensureIndex(datasetStore, 'datasetTypeImportedAt', ['datasetType', 'importedAt'], { unique: false });
        ensureIndex(datasetStore, 'datasetTypeVersion', ['datasetType', 'version'], { unique: true });
        ensureIndex(datasetStore, 'datasetScopePeriod', ['datasetType', 'scopeHash', 'periodKey'], { unique: false });
        ensureIndex(datasetStore, 'datasetScopePeriodImportedAt', ['datasetType', 'scopeHash', 'periodKey', 'importedAt'], { unique: false });
        ensureIndex(datasetStore, 'datasetScopePeriodFingerprint', ['datasetType', 'scopeHash', 'periodKey', 'fingerprint'], { unique: false });
        // Identity and storage share one database. Mirror the v8 chunk store here
        // so whichever shared module opens the database first creates the same schema.
        if (!db.objectStoreNames.contains(DATASET_CHUNK_STORE)) {
          const store = db.createObjectStore(DATASET_CHUNK_STORE, { keyPath: 'id' });
          store.createIndex('datasetId', 'datasetId', { unique: false });
          store.createIndex('datasetOrder', ['datasetId', 'index'], { unique: true });
        }
        if (!db.objectStoreNames.contains('coachtoolsCurrent')) db.createObjectStore('coachtoolsCurrent', { keyPath: 'datasetType' });
        const importStore = db.objectStoreNames.contains('coachtoolsImports')
          ? upgradeTx.objectStore('coachtoolsImports')
          : db.createObjectStore('coachtoolsImports', { keyPath: 'id' });
        ensureIndex(importStore, 'datasetType', 'datasetType', { unique: false });
        ensureIndex(importStore, 'importedAt', 'importedAt', { unique: false });
        ensureIndex(importStore, 'datasetTypeImportedAt', ['datasetType', 'importedAt'], { unique: false });
        const peopleStore = db.objectStoreNames.contains(PEOPLE_STORE)
          ? upgradeTx.objectStore(PEOPLE_STORE)
          : db.createObjectStore(PEOPLE_STORE, { keyPath: 'personId' });
        ensureIndex(peopleStore, 'normalizedName', 'normalizedName', { unique: false });
        ensureIndex(peopleStore, 'aliasKeys', 'aliasKeys', { unique: false, multiEntry: true });
        ensureIndex(peopleStore, 'role', 'role', { unique: false });
        ensureIndex(peopleStore, 'department', 'department', { unique: false });
        ensureIndex(peopleStore, 'currentTeam', 'currentTeam', { unique: false });
        ensureIndex(peopleStore, 'currentCoachId', 'currentCoachId', { unique: false });
        ensureIndex(peopleStore, 'coordinator', 'coordinator', { unique: false });
        ensureIndex(peopleStore, 'roleDepartment', ['role', 'department'], { unique: false });
        ensureIndex(peopleStore, 'roleTeam', ['role', 'currentTeam'], { unique: false });
        migratePeopleIndexFields(peopleStore);
        if (!db.objectStoreNames.contains(REVIEW_STORE)) {
          const store = db.createObjectStore(REVIEW_STORE, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the CoachTools identity registry.'));
      request.onblocked = () => reject(new Error('The identity registry upgrade is blocked by another open CoachTools tab.'));
    });
  }

  async function allFromStore(storeName) {
    if (storeName === PEOPLE_STORE && memoryHydrated) return clone(Array.from(memoryPeople.values()));
    if (databaseUnavailable) return clone(Array.from((storeName === PEOPLE_STORE ? memoryPeople : memoryReviews).values()));
    const db = await openDatabase();
    try { return await idbRequest(db.transaction(storeName, 'readonly').objectStore(storeName).getAll()); }
    finally { db.close(); }
  }

  async function getFromStore(storeName, id) {
    if (storeName === PEOPLE_STORE && memoryHydrated) return clone(memoryPeople.get(id) || null);
    if (databaseUnavailable) return clone((storeName === PEOPLE_STORE ? memoryPeople : memoryReviews).get(id) || null);
    const db = await openDatabase();
    try { return await idbRequest(db.transaction(storeName, 'readonly').objectStore(storeName).get(id)); }
    finally { db.close(); }
  }

  async function putInStore(storeName, value) {
    const stored = clone(value);
    if (databaseUnavailable) {
      if (storeName === PEOPLE_STORE) { indexPerson(stored); memoryHydrated = true; identityVersion += 1; }
      else memoryReviews.set(stored.id, stored);
      return value;
    }
    const db = await openDatabase();
    try { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(stored); await transactionDone(tx); }
    finally { db.close(); }
    if (storeName === PEOPLE_STORE) { indexPerson(stored); identityVersion += 1; }
    return value;
  }

  async function putMany(storeName, values) {
    if (!values.length) return;
    if (databaseUnavailable) {
      if (storeName === PEOPLE_STORE) {
        for (const value of values) indexPerson(value);
        memoryHydrated = true;
        identityVersion += 1;
      } else {
        for (const value of values) memoryReviews.set(value.id, clone(value));
      }
      return;
    }
    const db = await openDatabase();
    try {
      const tx = db.transaction(storeName, 'readwrite'), store = tx.objectStore(storeName);
      for (const value of values) store.put(clone(value));
      await transactionDone(tx);
    } finally { db.close(); }
    if (storeName === PEOPLE_STORE) {
      for (const value of values) indexPerson(value);
      identityVersion += 1;
    }
  }

  async function deleteFromStore(storeName, id) {
    if (databaseUnavailable) {
      if (storeName === PEOPLE_STORE) { removePersonFromIndexes(memoryPeople.get(id)); memoryPeople.delete(id); sortedPeopleDirty = true; identityVersion += 1; }
      else memoryReviews.delete(id);
      return;
    }
    const db = await openDatabase();
    try { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).delete(id); await transactionDone(tx); }
    finally { db.close(); }
    if (storeName === PEOPLE_STORE) { removePersonFromIndexes(memoryPeople.get(id)); memoryPeople.delete(id); sortedPeopleDirty = true; identityVersion += 1; }
  }

  function emit(detail) {
    const payload = { updatedAt: nowIso(), identityVersion, ...(detail || {}) };
    try { root.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload })); } catch (_) {}
    try { if (root.parent && root.parent !== root) root.parent.postMessage({ type: EVENT_NAME, detail: payload }, '*'); } catch (_) {}
    try { if (channel) channel.postMessage({ type: EVENT_NAME, detail: payload }); } catch (_) {}
    return payload;
  }

  function sourceNamesWith(person, source, rawName) {
    const sourceNames = { ...(person.sourceNames || {}) };
    sourceNames[source] = unique([...(sourceNames[source] || []), rawName]);
    return sourceNames;
  }

  function normalizedRole(role) {
    const value = String(role || '').toLowerCase();
    if (value === 'coach') return 'coach';
    if (value === 'representative' || value === 'rep') return 'representative';
    return 'unknown';
  }

  function today() { return nowIso().slice(0, 10); }

  function relationshipHistoryFor(person, nextCoachId) {
    const previous = cleanDisplay(person.currentCoachId), next = cleanDisplay(nextCoachId);
    const history = clone(person.relationshipHistory || []);
    if (next === previous) return history;
    for (const item of history) if (!item.to) item.to = today();
    if (next) history.push({ coachId: next, from: today(), to: null });
    return history;
  }

  function teamHistoryFor(person, nextTeam, department) {
    const previous = cleanDisplay(person.currentTeam || person.team), next = cleanDisplay(nextTeam);
    const history = clone(person.teamHistory || []);
    if (next === previous && history.some(item => !item.to && item.team === next)) return history;
    for (const item of history) if (!item.to && item.team !== next) item.to = today();
    if (next && !history.some(item => !item.to && item.team === next)) history.push({ team: next, department: cleanDisplay(department || person.department), from: today(), to: null });
    return history;
  }

  function sanitizePerson(person) {
    const normalizedName = normalizeName(person.normalizedName || person.displayName);
    const aliases = unique(person.aliases || []);
    return {
      personId: person.personId || personIdFor(normalizedName),
      displayName: displayName(person.displayName || normalizedName),
      normalizedName,
      role: normalizedRole(person.role),
      aliases,
      aliasKeys: Array.from(new Set(aliases.map(normalizeName).filter(Boolean))),
      department: cleanDisplay(person.department),
      team: cleanDisplay(person.team || person.currentTeam),
      currentTeam: cleanDisplay(person.currentTeam || person.team),
      coordinator: cleanDisplay(person.coordinator),
      currentCoachId: cleanDisplay(person.currentCoachId),
      sourceNames: clone(person.sourceNames || {}),
      teamHistory: Array.isArray(person.teamHistory) ? clone(person.teamHistory) : [],
      relationshipHistory: Array.isArray(person.relationshipHistory) ? clone(person.relationshipHistory) : [],
      createdAt: person.createdAt || nowIso(),
      updatedAt: person.updatedAt || nowIso()
    };
  }

  function addIndexValue(index, key, personId) {
    const normalized = cleanDisplay(key);
    if (!normalized) return;
    if (!index.has(normalized)) index.set(normalized, new Set());
    index.get(normalized).add(personId);
  }

  function removeIndexValue(index, key, personId) {
    const normalized = cleanDisplay(key);
    if (!normalized || !index.has(normalized)) return;
    const ids = index.get(normalized);
    ids.delete(personId);
    if (!ids.size) index.delete(normalized);
  }

  function removePersonFromIndexes(person) {
    if (!person) return;
    removeIndexValue(peopleByNormalizedName, person.normalizedName, person.personId);
    for (const key of person.aliasKeys || (person.aliases || []).map(normalizeName)) removeIndexValue(peopleByAlias, key, person.personId);
    removeIndexValue(coachesByDepartment, person.role === 'coach' ? normalizeName(person.department) : '', person.personId);
    removeIndexValue(coachesByTeam, person.role === 'coach' ? normalizeName(person.currentTeam || person.team) : '', person.personId);
    removeIndexValue(repsByCoach, person.role === 'representative' ? person.currentCoachId : '', person.personId);
    removeIndexValue(peopleByTeam, normalizeName(person.currentTeam || person.team), person.personId);
  }

  function indexPerson(person) {
    const canonical = sanitizePerson(person);
    removePersonFromIndexes(memoryPeople.get(canonical.personId));
    memoryPeople.set(canonical.personId, canonical);
    addIndexValue(peopleByNormalizedName, canonical.normalizedName, canonical.personId);
    for (const key of canonical.aliasKeys) addIndexValue(peopleByAlias, key, canonical.personId);
    if (canonical.role === 'coach') {
      addIndexValue(coachesByDepartment, normalizeName(canonical.department), canonical.personId);
      addIndexValue(coachesByTeam, normalizeName(canonical.currentTeam || canonical.team), canonical.personId);
    }
    if (canonical.role === 'representative') addIndexValue(repsByCoach, canonical.currentCoachId, canonical.personId);
    addIndexValue(peopleByTeam, normalizeName(canonical.currentTeam || canonical.team), canonical.personId);
    sortedPeopleDirty = true;
    return canonical;
  }

  function clearPeopleIndexes() {
    memoryPeople.clear();
    peopleByNormalizedName.clear();
    peopleByAlias.clear();
    coachesByDepartment.clear();
    coachesByTeam.clear();
    repsByCoach.clear();
    peopleByTeam.clear();
    sortedPeopleCache = [];
    sortedPeopleDirty = true;
  }

  function rebuildPeopleIndexes(people) {
    clearPeopleIndexes();
    for (const person of people || []) indexPerson(person);
    memoryHydrated = true;
    identityVersion += 1;
    return memoryPeople.size;
  }

  function invalidatePeopleIndexes() {
    clearPeopleIndexes();
    memoryHydrated = false;
    memoryHydrationPromise = null;
    identityVersion += 1;
  }

  async function ensurePeopleMemory() {
    if (memoryHydrated) return memoryPeople;
    if (memoryHydrationPromise) return memoryHydrationPromise;
    const diagnostics = root.CoachToolsDiagnostics;
    if (diagnostics) diagnostics.start('Identity registry read');
    memoryHydrationPromise = (async () => {
      const stored = await allFromStore(PEOPLE_STORE);
      rebuildPeopleIndexes(stored);
      return memoryPeople;
    })().finally(() => {
      memoryHydrationPromise = null;
      if (diagnostics) diagnostics.end('Identity registry read', { people: memoryPeople.size, identityVersion });
    });
    return memoryHydrationPromise;
  }

  function sortedPeople() {
    if (sortedPeopleDirty) {
      sortedPeopleCache = Array.from(memoryPeople.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
      sortedPeopleDirty = false;
    }
    return sortedPeopleCache;
  }

  function peopleForIds(ids) {
    return Array.from(ids || []).map(id => memoryPeople.get(id)).filter(Boolean);
  }

  async function getAllPeople() { await ensurePeopleMemory(); return sortedPeople().map(clone); }
  async function getPerson(personId) { await ensurePeopleMemory(); const person = memoryPeople.get(personId); return person ? clone(person) : null; }
  async function getPeopleByIds(personIds) { await ensurePeopleMemory(); return peopleForIds(new Set(personIds || [])).map(clone); }

  async function resolve(value, options) {
    await ensurePeopleMemory();
    const people = sortedPeople();
    const direct = memoryPeople.get(value);
    if (direct) { const safe = clone(direct); return { person: safe, confidence: 'id', candidates: [safe] }; }
    const query = normalizeName(value);
    const exactIds = new Set([...(peopleByNormalizedName.get(query) || []), ...(peopleByAlias.get(query) || [])]);
    const matches = peopleForIds(exactIds);
    if (matches.length === 1) { const safe = clone(matches[0]); return { person: safe, confidence: 'exact', candidates: [safe] }; }
    if (matches.length > 1) return { person: null, confidence: 'uncertain', candidates: matches.map(clone) };
    const tokens = query.split(' ').filter(Boolean);
    const candidates = people.filter(person => {
      const haystack = [person.normalizedName, ...(person.aliases || []).map(normalizeName)].join(' ');
      return query && (haystack.includes(query) || tokens.length === 1 && haystack.split(' ').includes(tokens[0]));
    }).slice(0, 12).map(clone);
    return { person: null, confidence: candidates.length ? 'uncertain' : 'none', candidates };
  }

  async function find(query, filters) {
    await ensurePeopleMemory();
    const term = normalizeName(query), all = sortedPeople(), byId = memoryPeople;
    return all.filter(person => {
      if (filters && filters.role && person.role !== filters.role) return false;
      if (filters && filters.department && person.department !== filters.department) return false;
      const coach = person.currentCoachId && byId.get(person.currentCoachId);
      const haystack = [person.displayName, ...(person.aliases || []), person.team, person.currentTeam, person.department, person.coordinator, coach && coach.displayName].filter(Boolean).map(normalizeName).join(' ');
      return !term || haystack.includes(term);
    }).map(clone);
  }

  async function addReview(review) {
    const value = { id: review.id || `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, status: 'open', createdAt: nowIso(), ...clone(review) };
    await putInStore(REVIEW_STORE, value); return value;
  }

  async function upsertObserved(rawName, options) {
    const original = cleanDisplay(rawName), normalized = normalizeName(original);
    if (!normalized) return null;
    const words = normalized.split(' ').filter(Boolean);
    await ensurePeopleMemory();
    const all = sortedPeople();
    const matchIds = new Set([...(peopleByNormalizedName.get(normalized) || []), ...(peopleByAlias.get(normalized) || [])]);
    const matches = peopleForIds(matchIds);
    const observedRole = normalizedRole(options && options.role);
    if (matches.length === 1 && observedRole !== 'unknown' && matches[0].role !== 'unknown' && matches[0].role !== observedRole) {
      await addReview({ type: 'role-conflict', rawName: original, normalizedName: normalized, source: options && options.source || '', observedRole, candidates: [matches[0].personId] });
      return null;
    }
    if (!matches.length && words.length < 2 && !(options && options.allowSingleToken)) {
      await addReview({ type: 'uncertain-name', rawName: original, normalizedName: normalized, source: options && options.source || '', candidates: all.filter(person => person.normalizedName.split(' ').includes(normalized)).map(person => person.personId).slice(0, 12) });
      return null;
    }
    if (matches.length > 1) {
      await addReview({ type: 'duplicate-exact-match', rawName: original, normalizedName: normalized, source: options && options.source || '', candidates: matches.map(person => person.personId) });
      return null;
    }
    let person = matches[0] || sanitizePerson({ displayName: original, normalizedName: normalized, role: options && options.role, department: options && options.department });
    const role = observedRole;
    const nextCoachId = cleanDisplay(options && options.currentCoachId) || person.currentCoachId;
    const nextTeam = cleanDisplay(options && options.team) || person.currentTeam;
    const relationshipHistory = relationshipHistoryFor(person, nextCoachId);
    const teamHistory = teamHistoryFor(person, nextTeam, cleanDisplay(options && options.department) || person.department);
    person = sanitizePerson({
      ...person,
      displayName: person.displayName || displayName(original),
      role: person.role === 'unknown' || role === 'coach' ? role : person.role,
      aliases: unique([...(person.aliases || []), original].filter(alias => normalizeName(alias) !== person.normalizedName || alias !== person.displayName)),
      department: cleanDisplay(options && options.department) || person.department,
      team: cleanDisplay(options && options.team) || person.team,
      currentTeam: nextTeam,
      coordinator: cleanDisplay(options && options.coordinator) || person.coordinator,
      currentCoachId: nextCoachId,
      relationshipHistory,
      teamHistory,
      sourceNames: sourceNamesWith(person, options && options.source || 'unknown', original),
      updatedAt: nowIso()
    });
    await putInStore(PEOPLE_STORE, person);
    return person;
  }

  function normalizedHeader(value) { return cleanDisplay(value).toLowerCase().replace(/[^a-z0-9%]/g, ''); }
  function pick(row, names) {
    const map = new Map(Object.keys(row || {}).map(key => [normalizedHeader(key), key]));
    for (const name of names) { const key = map.get(normalizedHeader(name)); if (key != null) return row[key]; }
    return undefined;
  }

  const KNOWN_HEADERS = new Set(['sheet', 'team', 'coach', 'jobcoach', 'coachassigned', 'representative', 'associatename', 'agentname', 'csr/ssrname', 'employee', 'score%', 'action', 'status', 'date']);
  function rowsFromAoa(aoa) {
    if (!Array.isArray(aoa)) return [];
    let best = { index: -1, score: 0, header: [] };
    for (let index = 0; index < Math.min(60, aoa.length); index += 1) {
      const header = Array.isArray(aoa[index]) ? aoa[index].map(cleanDisplay) : [];
      const score = header.reduce((sum, cell) => sum + (KNOWN_HEADERS.has(normalizedHeader(cell)) ? 1 : 0), 0);
      if (score > best.score) best = { index, score, header };
    }
    if (best.index < 0 || best.score < 1) return [];
    return aoa.slice(best.index + 1).map(values => Object.fromEntries(best.header.map((header, index) => [header, Array.isArray(values) ? values[index] : '']).filter(([header]) => header))).filter(row => Object.values(row).some(value => cleanDisplay(value)));
  }

  function extractRows(dataset) {
    const result = [], seen = new Set();
    function push(rows, sheet) {
      if (!Array.isArray(rows) || !rows.length) return;
      const values = Array.isArray(rows[0]) ? rowsFromAoa(rows) : rows;
      const key = `${sheet}|${values.length}|${Object.keys(values[0] || {}).join('|')}`;
      if (!values.length || seen.has(key)) return;
      seen.add(key); result.push(...values.map(row => ({ ...row, __sheet: sheet || '' })));
    }
    function walk(node, sheet) {
      if (node == null) return;
      if (Array.isArray(node)) { push(node, sheet); return; }
      if (typeof node !== 'object') return;
      if (Array.isArray(node.aoa)) push(node.aoa, sheet);
      if (Array.isArray(node.rows)) push(node.rows, sheet);
      if (node.workbook && node.workbook.data) for (const [name, value] of Object.entries(node.workbook.data)) walk(value, name);
      if (node.sheets && typeof node.sheets === 'object' && !Array.isArray(node.sheets)) for (const [name, value] of Object.entries(node.sheets)) walk(value, name);
    }
    walk(dataset, ''); return result;
  }

  function departmentFor(datasetType) {
    if (/retail/i.test(datasetType)) return 'Retail';
    if (/referral/i.test(datasetType)) return 'Referral';
    return '';
  }

  async function ingestRows(datasetType, rows, metadata) {
    const source = String(datasetType || 'unknown'), department = departmentFor(source);
    const coachFields = ['Job Coach', 'Coach Assigned', 'Coach', 'Supervisor', 'Manager'];
    const repFields = ['Associate Name', 'Representative', 'Agent Name', 'AgentName', 'CSR/SSR Name', 'Employee'];
    await ensurePeopleMemory();
    const people = Array.from(memoryPeople.values()), changed = new Map(), stagedIdsByKey = new Map(), reviews = [];
    const matchesFor = key => {
      const ids = new Set([...(peopleByNormalizedName.get(key) || []), ...(peopleByAlias.get(key) || []), ...(stagedIdsByKey.get(key) || [])]);
      return peopleForIds(ids).map(person => changed.get(person.personId) || person).concat(Array.from(ids).filter(id => !memoryPeople.has(id)).map(id => changed.get(id)).filter(Boolean));
    };
    const remember = person => {
      changed.set(person.personId, person);
      for (const key of [person.normalizedName, ...(person.aliases || []).map(normalizeName)]) {
        if (!key) continue;
        if (!stagedIdsByKey.has(key)) stagedIdsByKey.set(key, new Set());
        stagedIdsByKey.get(key).add(person.personId);
      }
      return person;
    };
    const observe = (rawName, options) => {
      const original = cleanDisplay(rawName), normalized = normalizeName(original);
      if (!normalized) return null;
      const matches = matchesFor(normalized), words = normalized.split(' ').filter(Boolean);
      const role = normalizedRole(options.role);
      if (matches.length === 1 && role !== 'unknown' && matches[0].role !== 'unknown' && matches[0].role !== role) {
        reviews.push({ id: `review_${stableHash(`${source}|${normalized}|${role}|role`)}`, type: 'role-conflict', status: 'open', createdAt: nowIso(), rawName: original, normalizedName: normalized, source, observedRole: role, candidates: [matches[0].personId] });
        return null;
      }
      if (matches.length > 1) {
        reviews.push({ id: `review_${stableHash(`${source}|${normalized}|duplicate`)}`, type: 'duplicate-exact-match', status: 'open', createdAt: nowIso(), rawName: original, normalizedName: normalized, source, candidates: matches.map(person => person.personId) });
        return null;
      }
      if (!matches.length && words.length < 2) {
        const candidates = people.filter(person => person.normalizedName.split(' ').includes(normalized)).map(person => person.personId).slice(0, 12);
        reviews.push({ id: `review_${stableHash(`${source}|${normalized}|partial`)}`, type: 'uncertain-name', status: 'open', createdAt: nowIso(), rawName: original, normalizedName: normalized, source, candidates });
        return null;
      }
      const current = matches[0] || sanitizePerson({ displayName: original, normalizedName: normalized, role: options.role, department: options.department });
      const nextCoachId = cleanDisplay(options.currentCoachId) || current.currentCoachId;
      const nextTeam = cleanDisplay(options.team) || current.currentTeam;
      const relationshipHistory = relationshipHistoryFor(current, nextCoachId);
      const teamHistory = teamHistoryFor(current, nextTeam, cleanDisplay(options.department) || current.department);
      const person = sanitizePerson({
        ...current,
        role: current.role === 'unknown' || role === 'coach' ? role : current.role,
        aliases: unique([...(current.aliases || []), original].filter(alias => normalizeName(alias) !== current.normalizedName || alias !== current.displayName)),
        department: cleanDisplay(options.department) || current.department,
        team: cleanDisplay(options.team) || current.team,
        currentTeam: nextTeam,
        currentCoachId: nextCoachId,
        relationshipHistory,
        teamHistory,
        sourceNames: sourceNamesWith(current, source, original),
        updatedAt: nowIso()
      });
      if (!matches.length) people.push(person);
      return remember(person);
    };
    let observed = 0;
    for (const row of rows) {
      let coachRaw = pick(row, coachFields), repRaw = pick(row, repFields);
      if (!coachRaw && ['weeklyRetail', 'weeklyReferral'].includes(source)) coachRaw = pick(row, ['Sheet']);
      if (!coachRaw && source === 'qa') coachRaw = pick(row, ['Team']);
      if (!repRaw && ['monthlyRetail', 'monthlyReferral'].includes(source)) repRaw = pick(row, ['Name']);
      const coach = coachRaw ? observe(coachRaw, { role: 'coach', department }) : null;
      const rep = repRaw ? observe(repRaw, { role: 'representative', department: department || coach && coach.department, currentCoachId: coach && coach.personId, team: coach && (coach.currentTeam || coach.team) }) : null;
      if (coach) observed += 1;
      if (rep) observed += 1;
    }
    await putMany(PEOPLE_STORE, Array.from(changed.values()));
    await putMany(REVIEW_STORE, reviews);
    if (!(metadata && metadata.deferCompletion)) {
      try {
        const ingested = JSON.parse(root.localStorage.getItem(IMPORT_META_KEY) || '{}') || {};
        ingested[source] = { fingerprint: metadata && metadata.fingerprint || '', ingestedAt: nowIso(), rows: rows.length };
        root.localStorage.setItem(IMPORT_META_KEY, JSON.stringify(ingested));
      } catch (_) {}
      emit({ reason: 'dataset-ingested', datasetType: source, observed, rows: rows.length });
    }
    return { datasetType: source, observed, rows: rows.length };
  }

  async function ingestDataset(datasetType, dataset, metadata) {
    return ingestRows(datasetType, extractRows(dataset), metadata);
  }

  function objectsFromStreamChunk(chunk) {
    const header = Array.isArray(chunk && chunk.header) ? chunk.header.map(cleanDisplay) : [];
    if (!header.some(Boolean)) return [];
    const rows = [];
    for (let offset = 0; offset < (chunk.rows || []).length; offset += 1) {
      const absoluteRow = Number(chunk.rowStart || 0) + offset;
      if (absoluteRow <= Number(chunk.headerRow)) continue;
      const values = Array.isArray(chunk.rows[offset]) ? chunk.rows[offset] : [];
      if (!values.some(value => cleanDisplay(value))) continue;
      rows.push({ ...Object.fromEntries(header.map((name, index) => [name, values[index]]).filter(([name]) => name)), __sheet: chunk.sheetName || '' });
    }
    return rows;
  }

  async function ingestStoredDataset(datasetType, descriptor) {
    const data = root.CoachToolsData;
    if (!data || typeof data.streamRows !== 'function') {
      const record = data && await data.getCurrent(datasetType, { includeRecord: true });
      return record ? ingestDataset(datasetType, record.data, descriptor) : { datasetType, observed: 0, rows: 0 };
    }
    let observed = 0, rows = 0;
    for await (const chunk of data.streamRows(datasetType, { datasetId: descriptor && descriptor.datasetId })) {
      const objects = objectsFromStreamChunk(chunk);
      if (!objects.length) continue;
      const result = await ingestRows(datasetType, objects, { ...(descriptor || {}), deferCompletion: true });
      observed += Number(result.observed) || 0;
      rows += Number(result.rows) || 0;
      await new Promise(resolve => root.setTimeout(resolve, 0));
    }
    try {
      const ingested = JSON.parse(root.localStorage.getItem(IMPORT_META_KEY) || '{}') || {};
      ingested[datasetType] = { fingerprint: descriptor && descriptor.fingerprint || '', ingestedAt: nowIso(), rows };
      root.localStorage.setItem(IMPORT_META_KEY, JSON.stringify(ingested));
    } catch (_) {}
    if (!(descriptor && descriptor.deferEvent)) emit({ reason: 'dataset-ingested', datasetType, observed, rows });
    return { datasetType, observed, rows };
  }

  function runIngestionQueue() {
    if (ingestionRunning || !ingestionQueue.length) return;
    const schedule = callback => {
      if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(callback, { timeout: 1500 });
      else root.setTimeout(callback, 250);
    };
    ingestionRunning = true;
    schedule(async () => {
      const completedTypes = new Set();
      let observed = 0, rows = 0, failed = 0;
      while (ingestionQueue.length) {
        const task = ingestionQueue.shift();
        const diagnostics = root.CoachToolsDiagnostics;
        if (diagnostics) diagnostics.start('Identity ingestion', { datasetType: task.datasetType });
        try {
          const result = await ingestStoredDataset(task.datasetType, { ...(task.descriptor || {}), deferEvent: true });
          completedTypes.add(task.datasetType);
          observed += Number(result && result.observed) || 0;
          rows += Number(result && result.rows) || 0;
        }
        catch (error) { failed += 1; console.warn('[CoachToolsIdentity] Background identity ingestion failed.', error); }
        finally {
          queuedIngestionKeys.delete(task.key);
          if (diagnostics) diagnostics.end('Identity ingestion', { datasetType: task.datasetType });
        }
      }
      ingestionRunning = false;
      emit({ reason: 'ingestion-batch-complete', datasetTypes: Array.from(completedTypes), observed, rows, failed });
    });
  }

  function queueDatasetIngestion(datasetType, descriptor) {
    const source = String(datasetType || 'unknown');
    const key = `${source}:${descriptor && (descriptor.datasetId || descriptor.fingerprint) || 'current'}`;
    if (queuedIngestionKeys.has(key)) return key;
    queuedIngestionKeys.add(key);
    ingestionQueue.push({ key, datasetType: source, descriptor: clone(descriptor || {}) });
    runIngestionQueue();
    return key;
  }

  async function updatePerson(personId, changes) {
    const current = await getPerson(personId);
    if (!current) throw new Error('Person was not found.');
    const updates = changes || {};
    const requestedDisplayName = Object.prototype.hasOwnProperty.call(updates, 'displayName') ? displayName(updates.displayName) : current.displayName;
    const requestedNormalizedName = normalizeName(requestedDisplayName) || current.normalizedName;
    const requestedTeam = Object.prototype.hasOwnProperty.call(updates, 'currentTeam') || Object.prototype.hasOwnProperty.call(updates, 'team') ? cleanDisplay(updates.currentTeam || updates.team) : current.currentTeam;
    const requestedCoachId = Object.prototype.hasOwnProperty.call(updates, 'currentCoachId') ? cleanDisplay(updates.currentCoachId) : current.currentCoachId;
    const aliases = requestedNormalizedName !== current.normalizedName ? unique([...(updates.aliases || current.aliases || []), current.displayName]) : updates.aliases || current.aliases;
    const next = sanitizePerson({
      ...current, ...updates,
      personId: current.personId,
      displayName: requestedDisplayName,
      normalizedName: requestedNormalizedName,
      aliases,
      team: requestedTeam,
      currentTeam: requestedTeam,
      currentCoachId: requestedCoachId,
      teamHistory: teamHistoryFor(current, requestedTeam, updates.department || current.department),
      relationshipHistory: relationshipHistoryFor(current, requestedCoachId),
      createdAt: current.createdAt,
      updatedAt: nowIso()
    });
    const conflict = (await getAllPeople()).find(person => person.personId !== personId && person.normalizedName === next.normalizedName);
    if (conflict) throw new Error(`That preferred name already belongs to ${conflict.displayName}. Merge the identities instead.`);
    await putInStore(PEOPLE_STORE, next); emit({ reason: 'person-updated', personId }); return next;
  }

  async function addAlias(personId, alias) {
    const person = await getPerson(personId), key = normalizeName(alias);
    if (!person || !key) throw new Error('Choose a person and enter an alias.');
    const owner = (await getAllPeople()).find(candidate => candidate.personId !== personId && [candidate.normalizedName, ...(candidate.aliases || []).map(normalizeName)].includes(key));
    if (owner) throw new Error(`That alias is already assigned to ${owner.displayName}.`);
    return updatePerson(personId, { aliases: unique([...(person.aliases || []), cleanDisplay(alias)]) });
  }

  async function removeAlias(personId, alias) {
    const person = await getPerson(personId);
    if (!person) throw new Error('Person was not found.');
    return updatePerson(personId, { aliases: (person.aliases || []).filter(value => normalizeName(value) !== normalizeName(alias)) });
  }

  async function mergePeople(primaryId, secondaryId) {
    if (!primaryId || !secondaryId || primaryId === secondaryId) throw new Error('Choose two different identities to merge.');
    const [primary, secondary, all] = await Promise.all([getPerson(primaryId), getPerson(secondaryId), getAllPeople()]);
    if (!primary || !secondary) throw new Error('One of the selected identities no longer exists.');
    const affected = all.filter(person => person.currentCoachId === secondaryId);
    const mergeId = `merge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await addReview({ id: mergeId, type: 'merge', status: 'applied', primaryBefore: primary, secondaryBefore: secondary, affectedBefore: affected });
    const sourceNames = clone(primary.sourceNames || {});
    for (const [source, names] of Object.entries(secondary.sourceNames || {})) sourceNames[source] = unique([...(sourceNames[source] || []), ...names]);
    const merged = sanitizePerson({
      ...primary,
      role: primary.role === 'unknown' ? secondary.role : primary.role,
      aliases: unique([...(primary.aliases || []), secondary.displayName, ...(secondary.aliases || [])]),
      department: primary.department || secondary.department,
      team: primary.team || secondary.team,
      currentTeam: primary.currentTeam || secondary.currentTeam,
      coordinator: primary.coordinator || secondary.coordinator,
      currentCoachId: primary.currentCoachId || secondary.currentCoachId,
      sourceNames,
      teamHistory: [...(primary.teamHistory || []), ...(secondary.teamHistory || [])],
      relationshipHistory: [...(primary.relationshipHistory || []), ...(secondary.relationshipHistory || [])],
      updatedAt: nowIso()
    });
    await putInStore(PEOPLE_STORE, merged);
    for (const person of affected) await putInStore(PEOPLE_STORE, sanitizePerson({ ...person, currentCoachId: primaryId, updatedAt: nowIso() }));
    await deleteFromStore(PEOPLE_STORE, secondaryId);
    emit({ reason: 'people-merged', personId: primaryId, mergedPersonId: secondaryId, mergeId });
    return { person: merged, mergeId };
  }

  async function undoMerge(mergeId) {
    const record = await getFromStore(REVIEW_STORE, mergeId);
    if (!record || record.type !== 'merge' || record.status !== 'applied') throw new Error('That merge cannot be undone.');
    await putInStore(PEOPLE_STORE, record.primaryBefore);
    await putInStore(PEOPLE_STORE, record.secondaryBefore);
    for (const person of record.affectedBefore || []) await putInStore(PEOPLE_STORE, person);
    await putInStore(REVIEW_STORE, { ...record, status: 'undone', undoneAt: nowIso() });
    emit({ reason: 'merge-undone', mergeId }); return true;
  }

  async function syncTeamSetup(setup) {
    const value = setup || (() => { try { return JSON.parse(root.localStorage.getItem(SETUP_KEY) || 'null'); } catch (_) { return null; } })();
    const groups = value && value.groups || {};
    let updated = 0;
    for (const group of groups.team || []) {
      for (const member of group.members || []) {
        const department = /^retail\b/i.test(group.name) ? 'Retail' : /^referral\b/i.test(group.name) ? 'Referral' : '';
        const person = await upsertObserved(member, { role: 'coach', team: group.name, department, source: 'teamSetup', allowSingleToken: true });
        if (person) {
          await updatePerson(person.personId, { team: group.name, currentTeam: group.name, department: department || person.department }); updated += 1;
        }
      }
    }
    for (const group of groups.coord || []) for (const member of group.members || []) {
      const resolved = await resolve(member), person = resolved.person || await upsertObserved(member, { role: 'coach', source: 'teamSetup', allowSingleToken: true });
      if (person) { await updatePerson(person.personId, { coordinator: group.name }); updated += 1; }
    }
    if (updated) emit({ reason: 'team-setup-synced', updated });
    return updated;
  }

  async function getRelationships(personId) {
    await ensurePeopleMemory();
    const person = memoryPeople.get(personId);
    if (!person) return null;
    return {
      person: clone(person),
      coach: person.currentCoachId && memoryPeople.has(person.currentCoachId) ? clone(memoryPeople.get(person.currentCoachId)) : null,
      representatives: peopleForIds(repsByCoach.get(personId) || []).map(clone),
      team: person.currentTeam || person.team || '',
      department: person.department || '',
      coordinator: person.coordinator || ''
    };
  }

  async function getReviews(options) {
    let reviews = await allFromStore(REVIEW_STORE);
    if (options && options.status) reviews = reviews.filter(review => review.status === options.status);
    return reviews.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function subscribe(listener) {
    const handler = event => listener(event.detail || {});
    root.addEventListener(EVENT_NAME, handler);
    return () => root.removeEventListener(EVENT_NAME, handler);
  }

  async function initialize() {
    try {
      const db = await openDatabase();
      if (db) db.close();
      await ensurePeopleMemory();
    }
    catch (error) { databaseUnavailable = true; console.warn('[CoachToolsIdentity] IndexedDB unavailable; this tab is using a temporary registry.', error); }
    return true;
  }
  const readyPromise = initialize();

  function scheduleBackgroundEnrichment() {
    const run = async () => {
      try { await readyPromise; await syncTeamSetup(); } catch (_) {}
      try {
        const data = root.CoachToolsData;
        if (!data) return;
        await data.ready();
        let ingested = {};
        try { ingested = JSON.parse(root.localStorage.getItem(IMPORT_META_KEY) || '{}') || {}; } catch (_) {}
        for (const type of data.DATASET_TYPES || []) {
          const version = data.getDatasetVersion(type);
          if (!version || ingested[type] && ingested[type].fingerprint && ingested[type].fingerprint === version.fingerprint) continue;
          queueDatasetIngestion(type, { datasetId: version.datasetId, fingerprint: version.fingerprint, source: 'identity-startup-sync' });
        }
      } catch (error) { console.warn('[CoachToolsIdentity] Existing dataset learning could not be queued.', error); }
    };
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(run, { timeout: 1800 });
    else root.setTimeout(run, 1800);
  }
  scheduleBackgroundEnrichment();

  if (channel) channel.onmessage = event => {
    if (event.data && event.data.type === EVENT_NAME) {
      invalidatePeopleIndexes();
      try { root.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { ...(event.data.detail || {}), relayed: true, identityVersion } })); } catch (_) {}
    }
  };

  async function getIndexedPeople(index, key) {
    await ensurePeopleMemory();
    return peopleForIds(index.get(cleanDisplay(key)) || []).map(clone).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async function getCoaches() {
    await ensurePeopleMemory();
    return sortedPeople().filter(person => person.role === 'coach').map(clone);
  }

  async function getRepresentatives() {
    await ensurePeopleMemory();
    return sortedPeople().filter(person => person.role === 'representative').map(clone);
  }

  root.CoachToolsIdentity = Object.freeze({
    VERSION, DB_NAME, DB_VERSION, PEOPLE_STORE, REVIEW_STORE, EVENT_NAME,
    normalizeName, displayName, ready: () => readyPromise,
    find, resolve, resolveName: resolve, getPerson, getPeopleByIds, getAllPeople,
    getCoach: async personId => { const person = await getPerson(personId); return person && person.role === 'coach' ? person : null; },
    getCoaches,
    getRepresentatives,
    getCoachesByDepartment: department => getIndexedPeople(coachesByDepartment, normalizeName(department)),
    getCoachesByTeam: team => getIndexedPeople(coachesByTeam, normalizeName(team)),
    getRepsForCoach: coachPersonId => getIndexedPeople(repsByCoach, cleanDisplay(coachPersonId)),
    getPeopleForTeam: team => getIndexedPeople(peopleByTeam, normalizeName(team)),
    getIdentityVersion: () => identityVersion,
    addAlias, removeAlias, mergePeople, undoMerge, updatePerson, getRelationships, getReviews,
    learn: upsertObserved, ingestDataset, ingestStoredDataset, queueDatasetIngestion, syncTeamSetup, subscribe,
    _test: Object.freeze({ extractRows, pick, sanitizePerson, upsertObserved, objectsFromStreamChunk })
  });
})(typeof window !== 'undefined' ? window : globalThis);
