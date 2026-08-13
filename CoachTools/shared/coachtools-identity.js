(function attachCoachToolsIdentity(root) {
  'use strict';

  const VERSION = '1.0.1';
  const DB_NAME = 'allStarImportedDataCache.v1';
  const DB_VERSION = 7;
  const DATASET_CHUNK_STORE = 'coachtoolsDatasetChunks';
  const PEOPLE_STORE = 'coachtoolsPeople';
  const REVIEW_STORE = 'coachtoolsIdentityReviews';
  const EVENT_NAME = 'coachtools:identity-updated';
  const SETUP_KEY = 'myone.master.v2.setup';
  const IMPORT_META_KEY = 'coachtools.identity.ingested.v1';
  const memoryPeople = new Map();
  const memoryReviews = new Map();
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

  function openDatabase() {
    if (databaseUnavailable) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ['meta', 'sourceData', 'books', 'misc']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('coachtoolsDatasets')) {
          const store = db.createObjectStore('coachtoolsDatasets', { keyPath: 'id' });
          store.createIndex('datasetType', 'datasetType', { unique: false });
          store.createIndex('periodKey', ['datasetType', 'periodKey'], { unique: false });
          store.createIndex('fingerprint', ['datasetType', 'fingerprint'], { unique: false });
        }
        // Identity and storage share one database. Mirror the v7 chunk store here
        // so whichever shared module opens the database first creates the same schema.
        if (!db.objectStoreNames.contains(DATASET_CHUNK_STORE)) {
          const store = db.createObjectStore(DATASET_CHUNK_STORE, { keyPath: 'id' });
          store.createIndex('datasetId', 'datasetId', { unique: false });
          store.createIndex('datasetOrder', ['datasetId', 'index'], { unique: true });
        }
        if (!db.objectStoreNames.contains('coachtoolsCurrent')) db.createObjectStore('coachtoolsCurrent', { keyPath: 'datasetType' });
        if (!db.objectStoreNames.contains('coachtoolsImports')) {
          const store = db.createObjectStore('coachtoolsImports', { keyPath: 'id' });
          store.createIndex('datasetType', 'datasetType', { unique: false });
          store.createIndex('importedAt', 'importedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(PEOPLE_STORE)) {
          const store = db.createObjectStore(PEOPLE_STORE, { keyPath: 'personId' });
          store.createIndex('normalizedName', 'normalizedName', { unique: false });
          store.createIndex('role', 'role', { unique: false });
          store.createIndex('department', 'department', { unique: false });
          store.createIndex('currentCoachId', 'currentCoachId', { unique: false });
        }
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
    if (databaseUnavailable) return clone(Array.from((storeName === PEOPLE_STORE ? memoryPeople : memoryReviews).values()));
    const db = await openDatabase();
    try { return await idbRequest(db.transaction(storeName, 'readonly').objectStore(storeName).getAll()); }
    finally { db.close(); }
  }

  async function getFromStore(storeName, id) {
    if (databaseUnavailable) return clone((storeName === PEOPLE_STORE ? memoryPeople : memoryReviews).get(id) || null);
    const db = await openDatabase();
    try { return await idbRequest(db.transaction(storeName, 'readonly').objectStore(storeName).get(id)); }
    finally { db.close(); }
  }

  async function putInStore(storeName, value) {
    if (databaseUnavailable) { (storeName === PEOPLE_STORE ? memoryPeople : memoryReviews).set(value.personId || value.id, clone(value)); return value; }
    const db = await openDatabase();
    try { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(clone(value)); await transactionDone(tx); return value; }
    finally { db.close(); }
  }

  async function putMany(storeName, values) {
    if (!values.length) return;
    if (databaseUnavailable) {
      const target = storeName === PEOPLE_STORE ? memoryPeople : memoryReviews;
      for (const value of values) target.set(value.personId || value.id, clone(value));
      return;
    }
    const db = await openDatabase();
    try {
      const tx = db.transaction(storeName, 'readwrite'), store = tx.objectStore(storeName);
      for (const value of values) store.put(clone(value));
      await transactionDone(tx);
    } finally { db.close(); }
  }

  async function deleteFromStore(storeName, id) {
    if (databaseUnavailable) { (storeName === PEOPLE_STORE ? memoryPeople : memoryReviews).delete(id); return; }
    const db = await openDatabase();
    try { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).delete(id); await transactionDone(tx); }
    finally { db.close(); }
  }

  function emit(detail) {
    const payload = { updatedAt: nowIso(), ...(detail || {}) };
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
    return {
      personId: person.personId || personIdFor(normalizedName),
      displayName: displayName(person.displayName || normalizedName),
      normalizedName,
      role: normalizedRole(person.role),
      aliases: unique(person.aliases || []),
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

  async function getAllPeople() { return (await allFromStore(PEOPLE_STORE)).map(sanitizePerson).sort((a, b) => a.displayName.localeCompare(b.displayName)); }
  async function getPerson(personId) { const person = await getFromStore(PEOPLE_STORE, personId); return person ? sanitizePerson(person) : null; }

  function localResolver(people) {
    const exact = new Map();
    for (const person of people) {
      for (const key of [person.normalizedName, ...(person.aliases || []).map(normalizeName)]) {
        if (!key) continue;
        if (!exact.has(key)) exact.set(key, []);
        if (!exact.get(key).some(candidate => candidate.personId === person.personId)) exact.get(key).push(person);
      }
    }
    return exact;
  }

  async function resolve(value, options) {
    const people = await getAllPeople();
    const direct = people.find(person => person.personId === value);
    if (direct) return { person: direct, confidence: 'id', candidates: [direct] };
    const query = normalizeName(value), matches = localResolver(people).get(query) || [];
    if (matches.length === 1) return { person: matches[0], confidence: 'exact', candidates: matches };
    if (matches.length > 1) return { person: null, confidence: 'uncertain', candidates: matches };
    const tokens = query.split(' ').filter(Boolean);
    const candidates = people.filter(person => {
      const haystack = [person.normalizedName, ...(person.aliases || []).map(normalizeName)].join(' ');
      return query && (haystack.includes(query) || tokens.length === 1 && haystack.split(' ').includes(tokens[0]));
    }).slice(0, 12);
    return { person: null, confidence: candidates.length ? 'uncertain' : 'none', candidates };
  }

  async function find(query, filters) {
    const term = normalizeName(query), all = await getAllPeople();
    const byId = new Map(all.map(person => [person.personId, person]));
    return all.filter(person => {
      if (filters && filters.role && person.role !== filters.role) return false;
      if (filters && filters.department && person.department !== filters.department) return false;
      const coach = person.currentCoachId && byId.get(person.currentCoachId);
      const haystack = [person.displayName, ...(person.aliases || []), person.team, person.currentTeam, person.department, person.coordinator, coach && coach.displayName].filter(Boolean).map(normalizeName).join(' ');
      return !term || haystack.includes(term);
    });
  }

  async function addReview(review) {
    const value = { id: review.id || `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, status: 'open', createdAt: nowIso(), ...clone(review) };
    await putInStore(REVIEW_STORE, value); return value;
  }

  async function upsertObserved(rawName, options) {
    const original = cleanDisplay(rawName), normalized = normalizeName(original);
    if (!normalized) return null;
    const words = normalized.split(' ').filter(Boolean);
    const all = await getAllPeople(), matches = localResolver(all).get(normalized) || [];
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

  async function ingestDataset(datasetType, dataset, metadata) {
    const rows = extractRows(dataset), source = String(datasetType || 'unknown'), department = departmentFor(source);
    const coachFields = ['Job Coach', 'Coach Assigned', 'Coach', 'Supervisor', 'Manager'];
    const repFields = ['Associate Name', 'Representative', 'Agent Name', 'AgentName', 'CSR/SSR Name', 'Employee'];
    const people = await getAllPeople(), changed = new Map(), reviews = [];
    const exact = localResolver(people);
    const remember = person => {
      changed.set(person.personId, person);
      for (const key of [person.normalizedName, ...(person.aliases || []).map(normalizeName)]) {
        if (!key) continue;
        const existing = exact.get(key) || [];
        const index = existing.findIndex(candidate => candidate.personId === person.personId);
        if (index >= 0) existing[index] = person;
        else existing.push(person);
        exact.set(key, existing);
      }
      return person;
    };
    const observe = (rawName, options) => {
      const original = cleanDisplay(rawName), normalized = normalizeName(original);
      if (!normalized) return null;
      const matches = exact.get(normalized) || [], words = normalized.split(' ').filter(Boolean);
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
    try {
      const ingested = JSON.parse(root.localStorage.getItem(IMPORT_META_KEY) || '{}') || {};
      ingested[source] = { fingerprint: metadata && metadata.fingerprint || '', ingestedAt: nowIso(), rows: rows.length };
      root.localStorage.setItem(IMPORT_META_KEY, JSON.stringify(ingested));
    } catch (_) {}
    emit({ reason: 'dataset-ingested', datasetType: source, observed, rows: rows.length });
    return { datasetType: source, observed, rows: rows.length };
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
    const [person, all] = await Promise.all([getPerson(personId), getAllPeople()]);
    if (!person) return null;
    const byId = new Map(all.map(value => [value.personId, value]));
    return { person, coach: person.currentCoachId ? byId.get(person.currentCoachId) || null : null, representatives: all.filter(value => value.currentCoachId === personId), team: person.currentTeam || person.team || '', department: person.department || '', coordinator: person.coordinator || '' };
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
    try { const db = await openDatabase(); if (db) db.close(); }
    catch (error) { databaseUnavailable = true; console.warn('[CoachToolsIdentity] IndexedDB unavailable; this tab is using a temporary registry.', error); }
    try { await syncTeamSetup(); } catch (_) {}
    try {
      if (root.CoachToolsData) {
        await root.CoachToolsData.ready();
        let ingested = {};
        try { ingested = JSON.parse(root.localStorage.getItem(IMPORT_META_KEY) || '{}') || {}; } catch (_) {}
        for (const type of root.CoachToolsData.DATASET_TYPES || []) {
          const record = await root.CoachToolsData.getCurrent(type, { includeRecord: true });
          if (!record || ingested[type] && ingested[type].fingerprint && ingested[type].fingerprint === record.fingerprint) continue;
          await ingestDataset(type, record.data, { fingerprint: record.fingerprint, source: 'identity-startup-sync' });
        }
      }
    } catch (error) { console.warn('[CoachToolsIdentity] Existing dataset learning could not finish.', error); }
    return true;
  }
  const readyPromise = initialize();

  if (channel) channel.onmessage = event => { if (event.data && event.data.type === EVENT_NAME) { try { root.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { ...(event.data.detail || {}), relayed: true } })); } catch (_) {} } };

  root.CoachToolsIdentity = Object.freeze({
    VERSION, DB_NAME, DB_VERSION, PEOPLE_STORE, REVIEW_STORE, EVENT_NAME,
    normalizeName, displayName, ready: () => readyPromise,
    find, resolve, getPerson, getAllPeople,
    getCoaches: async () => (await getAllPeople()).filter(person => person.role === 'coach'),
    getRepresentatives: async () => (await getAllPeople()).filter(person => person.role === 'representative'),
    addAlias, removeAlias, mergePeople, undoMerge, updatePerson, getRelationships, getReviews,
    learn: upsertObserved, ingestDataset, syncTeamSetup, subscribe,
    _test: Object.freeze({ extractRows, pick, sanitizePerson, upsertObserved })
  });
})(typeof window !== 'undefined' ? window : globalThis);