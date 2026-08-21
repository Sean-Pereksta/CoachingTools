(function attachCoachToolsProfiles(root) {
  'use strict';

  const VERSION = '1.1.0';
  const MIN_REP_COHORT = 5;
  const MIN_COACH_COHORT = 3;
  const TARGET_CHECKLIST_DAYS = 3;
  const PERFORMANCE_TYPES = ['weeklyRetail', 'weeklyReferral', 'monthlyRetail', 'monthlyReferral'];

  function clean(value) { return String(value == null ? '' : value).trim().replace(/\s+/g, ' '); }
  function normHeader(value) { return clean(value).toLowerCase().replace(/[^a-z0-9%]/g, ''); }
  function normalizeName(value) { return root.CoachToolsIdentity ? root.CoachToolsIdentity.normalizeName(value) : clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function mean(values) { const valid = values.filter(Number.isFinite); return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN; }
  function median(values) { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); if (!sorted.length) return NaN; const middle = (sorted.length - 1) / 2, low = Math.floor(middle), high = Math.ceil(middle); return (sorted[low] + sorted[high]) / 2; }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

  function parseNumber(value) {
    if (value == null || value === '') return NaN;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const raw = clean(value), numeric = Number(raw.replace(/[$,%]/g, '').replace(/,/g, ''));
    if (!Number.isFinite(numeric)) return NaN;
    return raw.includes('%') ? numeric / 100 : numeric;
  }

  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && value > 0 && value < 100000) return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    if (typeof value === 'number' && value > 1e11) return new Date(value);
    const raw = clean(value);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function pick(row, candidates) {
    const map = new Map(Object.keys(row || {}).map(key => [normHeader(key), key]));
    for (const candidate of candidates) { const key = map.get(normHeader(candidate)); if (key != null) return row[key]; }
    return undefined;
  }

  function rowsFromAoa(aoa) {
    if (!Array.isArray(aoa)) return [];
    const signals = ['sheet', 'team', 'jobcoach', 'coachassigned', 'associatename', 'representative', 'agentname', 'score%', 'action', 'date'];
    let best = { index: -1, score: 0, header: [] };
    for (let index = 0; index < Math.min(60, aoa.length); index += 1) {
      const header = Array.isArray(aoa[index]) ? aoa[index].map(clean) : [];
      const keys = header.map(normHeader), score = signals.filter(signal => keys.includes(normHeader(signal))).length;
      if (score > best.score) best = { index, score, header };
    }
    if (best.index < 0 || !best.score) return [];
    return aoa.slice(best.index + 1).map(values => Object.fromEntries(best.header.map((header, index) => [header, Array.isArray(values) ? values[index] : '']).filter(([header]) => header))).filter(row => Object.values(row).some(value => clean(value)));
  }

  function extractRows(dataset) {
    const packs = [], seen = new Set();
    function push(rows, sheet) {
      if (!Array.isArray(rows) || !rows.length) return;
      const values = Array.isArray(rows[0]) ? rowsFromAoa(rows) : rows;
      if (!values.length) return;
      const key = `${sheet}|${values.length}|${Object.keys(values[0]).join('|')}`;
      if (seen.has(key)) return;
      seen.add(key); packs.push({ sheet: sheet || '', rows: values });
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
    walk(dataset, ''); return packs;
  }

  function resolverFor(people) {
    const exact = new Map();
    for (const person of people || []) {
      for (const value of [person.displayName, person.normalizedName, ...(person.aliases || []), ...Object.values(person.sourceNames || {}).flat()]) {
        const key = normalizeName(value); if (key && !exact.has(key)) exact.set(key, person.personId);
      }
    }
    return value => exact.get(normalizeName(value)) || '';
  }

  function splitTopics(value) { return clean(value).split(/[,;|]+/).map(clean).filter(Boolean); }
  function recordSource(record, fallback) {
    return { source: record && (record.originalFileName || record.datasetType) || fallback, period: record && record.detectedPeriod && record.detectedPeriod.label || '', importedAt: record && record.importedAt || '' };
  }

  function canonicalizeCoaching(record, resolvePerson) {
    const events = [];
    for (const pack of extractRows(record && record.data)) for (const row of pack.rows) {
      const coach = pick(row, ['Job Coach', 'Coach Assigned', 'Coach', 'Sheet', 'Team']);
      const rep = pick(row, ['Associate Name', 'Associate', 'Representative', 'Agent Name', 'Name', 'Employee']);
      const date = parseDate(pick(row, ['Date', 'Coaching Date', 'Day']));
      const topics = [...splitTopics(pick(row, ['Coaching Type Multi'])), ...splitTopics(pick(row, ['Coaching Type', 'Type']))];
      if (!date || !topics.length || !clean(coach)) continue;
      events.push({ coachId: resolvePerson(coach), coach: clean(coach), representativeId: resolvePerson(rep), representative: clean(rep), date, topics: Array.from(new Set(topics)), description: clean(pick(row, ['Description', 'Notes', 'Details', 'Summary', 'Coaching Notes'])), provenance: recordSource(record, 'Documented Coaching') });
    }
    return events;
  }

  function canonicalizeChecklist(record, resolvePerson) {
    const items = [];
    for (const pack of extractRows(record && record.data)) for (const row of pack.rows) {
      const coach = pick(row, ['Coach Assigned', 'Job Coach', 'Coach', 'Sheet', 'Team']);
      const rep = pick(row, ['Associate Name', 'Associate', 'Representative', 'Agent Name', 'Name', 'CSR Name', 'SSR Name']);
      const action = clean(pick(row, ['Action Taken', 'Action', 'Status']));
      const created = parseDate(pick(row, ['Created On', 'Created', 'Created At', 'Created Date', 'Created Date Time']));
      const served = parseDate(pick(row, ['Date Served', 'Served Date', 'Date Completed', 'Completed On', 'Date Serviced']));
      if (!created || !clean(coach) || !clean(rep) || !action) continue;
      const days = served ? (served.getTime() - created.getTime()) / 86400000 : NaN;
      items.push({ coachId: resolvePerson(coach), coach: clean(coach), representativeId: resolvePerson(rep), representative: clean(rep), action, created, served, days, incident: clean(pick(row, ['Incident', 'Incident Type', 'Incident Category', 'Type'])) || '(blank)', corrective: clean(pick(row, ['Corrective', 'Corrective Type', 'Corrective Action', 'Corrective Level'])), description: clean(pick(row, ['Description', 'Details', 'Notes', 'Summary'])), provenance: recordSource(record, 'Checklist') });
    }
    return items;
  }

  function canonicalizeQA(record, resolvePerson) {
    const rows = [];
    for (const pack of extractRows(record && record.data)) for (const row of pack.rows) {
      const rep = pick(row, ['Agent Name', 'Agent', 'CSR', 'Associate', 'Representative', 'Rep', 'Name']);
      const score = parseNumber(pick(row, ['Score %', 'Score Pct', 'Score', 'QA Score', 'QA %']));
      const start = parseDate(pick(row, ['Interaction Start Time', 'Interaction Start', 'Start Time', 'Interaction Time']));
      const team = pick(row, ['Team', 'Sheet', 'Department', 'Group', 'Supervisor', 'Manager']);
      if (!clean(rep) || !Number.isFinite(score) || !start) continue;
      rows.push({ representativeId: resolvePerson(rep), representative: clean(rep), coachId: resolvePerson(team), team: clean(team), score: Math.abs(score) > 1.5 ? score / 100 : score, date: start, evaluator: clean(pick(row, ['Evaluator', 'Evaluator Name', 'Reviewer', 'QA Evaluator', 'Coach'])), provenance: recordSource(record, 'QA') });
    }
    return rows;
  }

  const METRICS = [
    { id: 'cash-appointment-rate', name: 'Cash Appointment Rate', category: 'Appointments', pattern: /cash.*appointment.*rate|cash.*appt|appointment.*rate|schedule.*rate/i, higher: true, percent: true },
    { id: 'referral-appointment-rate', name: 'Referral Appointment Rate', category: 'Appointments', pattern: /referral.*appointment.*rate|referral.*appt/i, higher: true, percent: true },
    { id: 'call-quality', name: 'Call Quality', category: 'Quality', pattern: /call.*quality|quality.*score/i, higher: true, percent: true },
    { id: 'wiper-rate', name: 'Wiper Rate', category: 'Sales Behaviors', pattern: /wiper(?:s)?(?:.*rate)?|vaps/i, higher: true, percent: true },
    { id: 'qa-score', name: 'QA Score', category: 'Quality', pattern: /^qa.*score|score\s*%/i, higher: true, percent: true },
    { id: 'afterpay', name: 'Afterpay', category: 'Sales Behaviors', pattern: /afterpay/i, higher: true, percent: true },
    { id: 'save-the-sale', name: 'Save the Sale', category: 'Sales Behaviors', pattern: /save.*sale/i, higher: true, percent: true },
    { id: 'rapport', name: 'Rapport', category: 'Sales Behaviors', pattern: /rapport/i, higher: true, percent: true },
    { id: 'insurance-cash', name: 'Insurance Cash', category: 'Solutions', pattern: /insurance.*cash/i, higher: true, percent: true },
    { id: 'solution-rate', name: 'Solution Rate', category: 'Solutions', pattern: /solution.*rate/i, higher: true, percent: true },
    { id: 'worst-practice', name: 'Worst Practice', category: 'Sales Behaviors', pattern: /worst.*practice/i, higher: false, percent: true }
  ];

  const IDENTITY_HEADERS = new Set(['sheet', 'team', 'coach', 'jobcoach', 'coachassigned', 'representative', 'associatename', 'agentname', 'agent', 'name', 'employee', 'date', 'day', 'month', 'week']);
  function metricDefinition(header) { return METRICS.find(metric => metric.pattern.test(clean(header))) || null; }

  function canonicalizePerformance(record, resolvePerson) {
    const observations = [];
    for (const pack of extractRows(record && record.data)) for (const row of pack.rows) {
      const rep = pick(row, ['Representative', 'Associate Name', 'Agent Name', 'AgentName', 'Employee']);
      const coach = pick(row, ['Job Coach', 'Coach Assigned', 'Coach', 'Sheet', 'Team']);
      const personId = rep ? resolvePerson(rep) : resolvePerson(coach);
      if (!personId) continue;
      for (const [header, raw] of Object.entries(row)) {
        if (IDENTITY_HEADERS.has(normHeader(header))) continue;
        const definition = metricDefinition(header), numeric = parseNumber(raw);
        if (!definition || !Number.isFinite(numeric)) continue;
        const value = definition.percent && Math.abs(numeric) > 1.5 ? numeric / 100 : numeric;
        observations.push({ personId, role: rep ? 'representative' : 'coach', metric: definition, value, provenance: recordSource(record, record && record.datasetType || 'Performance') });
      }
    }
    return observations;
  }

  function percentileScore(value, cohort, higherBetter, minimum) {
    const valid = cohort.filter(Number.isFinite);
    if (!Number.isFinite(value) || valid.length < (minimum || MIN_REP_COHORT)) return { score: null, percentile: null, sampleSize: valid.length, reason: 'Insufficient comparison data' };
    const less = valid.filter(item => item < value).length, equal = valid.filter(item => item === value).length;
    let percentile = (less + equal * 0.5) / valid.length;
    if (higherBetter === false) percentile = 1 - percentile;
    return { score: Math.round(clamp(percentile * 10, 1, 10) * 10) / 10, percentile: Math.round(percentile * 100), sampleSize: valid.length, reason: '' };
  }

  function rankMetric(personId, valuesByPerson, higherBetter, minimum) {
    const rows = Array.from(valuesByPerson.entries()).filter(([, value]) => Number.isFinite(value));
    if (!valuesByPerson.has(personId) || rows.length < (minimum || MIN_COACH_COHORT)) return { rank: null, total: rows.length, percentile: null, reason: 'Insufficient comparison data' };
    rows.sort((a, b) => higherBetter === false ? a[1] - b[1] : b[1] - a[1]);
    const value = valuesByPerson.get(personId), rank = rows.findIndex(([, candidate]) => candidate === value) + 1;
    return { rank, total: rows.length, percentile: Math.max(1, Math.round(rank / rows.length * 100)), value, reason: '' };
  }

  function departmentPeople(person, people, role) {
    if (!person.department) return [];
    return people.filter(candidate => candidate.role === role && candidate.department === person.department);
  }

  function latestByMetric(observations) {
    const grouped = new Map();
    for (const observation of observations) {
      const key = `${observation.personId}|${observation.metric.id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(observation);
    }
    const result = new Map();
    for (const [key, values] of grouped) result.set(key, { ...values[values.length - 1], value: mean(values.map(item => item.value)) });
    return result;
  }

  function topicBreakdown(events) {
    const grouped = new Map();
    for (const event of events) for (const topic of event.topics || []) {
      if (!grouped.has(topic)) grouped.set(topic, []);
      grouped.get(topic).push(event);
    }
    return Array.from(grouped, ([name, rows]) => {
      const byRep = new Map();
      for (const row of rows) if (row.representativeId || row.representative) byRep.set(row.representativeId || normalizeName(row.representative), (byRep.get(row.representativeId || normalizeName(row.representative)) || 0) + 1);
      const current = rows.filter(row => row.date >= dateCutoff(15)).length;
      const prior = rows.filter(row => row.date < dateCutoff(15) && row.date >= dateCutoff(30)).length;
      return { name, count: rows.length, representatives: byRep.size, repeatRepresentatives: Array.from(byRep.values()).filter(count => count > 1).length, trend: current > prior ? 'up' : current < prior ? 'down' : 'stable' };
    }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function frequencyBreakdown(items, key, label) {
    const grouped = new Map();
    for (const item of items) {
      const id = clean(item[key]) || '(blank)';
      if (!grouped.has(id)) grouped.set(id, { name: clean(item[label || key]) || id, count: 0, open: 0 });
      const row = grouped.get(id); row.count += 1; if (!item.served) row.open += 1;
    }
    return Array.from(grouped.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
  }

  function trendStatus(points, higherBetter) {
    if (!Array.isArray(points) || points.length < 3) return { status: 'insufficient', reason: 'At least 3 reporting periods are required.', points: points || [] };
    const ordered = points.slice().sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
    const split = Math.max(1, Math.floor(ordered.length / 2));
    const earlier = mean(ordered.slice(0, split).map(point => point.value)), recent = mean(ordered.slice(-split).map(point => point.value));
    const change = recent - earlier, threshold = Math.max(Math.abs(earlier) * 0.03, 0.005);
    const raw = Math.abs(change) < threshold ? 'stable' : change > 0 ? 'up' : 'down';
    const favorable = higherBetter === false ? raw === 'down' : raw === 'up';
    return { status: raw === 'stable' ? 'stable' : favorable ? 'improving' : 'declining', change, earlier, recent, points: ordered.slice(-12), reason: '' };
  }

  function recordLabel(record) { return record && record.detectedPeriod && (record.detectedPeriod.label || record.detectedPeriod.periodKey) || record && record.periodKey || ''; }
  function recordSort(record) { return record && (record.periodSort || record.detectedPeriod && record.detectedPeriod.periodKey || record.importedAt) || ''; }

  function createHistoryIndex(people) {
    return { people: people || [], resolvePerson: resolverFor(people || []), byType: Object.create(null), recordCount: 0 };
  }

  function addHistoryRecord(index, type, record) {
    if (!index || !type || !record) return null;
    if (!index.byType[type]) index.byType[type] = [];
    const entry = { record, label: recordLabel(record), sort: recordSort(record), performance: [], qa: [] };
    if (type === 'qa') entry.qa = canonicalizeQA(record, index.resolvePerson);
    else entry.performance = canonicalizePerformance(record, index.resolvePerson);
    index.byType[type].push(entry);
    index.byType[type].sort((a, b) => String(b.sort).localeCompare(String(a.sort)));
    index.recordCount += 1;
    return entry;
  }

  function representativeTrendsFromIndex(personId, historyIndex) {
    const grouped = new Map();
    if (!historyIndex) return new Map();
    for (const [type, entries] of Object.entries(historyIndex.byType || {})) for (const entry of entries || []) {
      let observations = [];
      if (type === 'qa') {
        const values = (entry.qa || []).filter(row => row.representativeId === personId).map(row => row.score);
        if (values.length) observations = [{ metric: METRICS.find(metric => metric.id === 'qa-score'), value: mean(values) }];
      } else {
        observations = (entry.performance || []).filter(row => row.personId === personId);
      }
      const perMetric = new Map();
      for (const observation of observations) {
        if (!perMetric.has(observation.metric.id)) perMetric.set(observation.metric.id, []);
        perMetric.get(observation.metric.id).push(observation.value);
      }
      for (const [metricId, values] of perMetric) {
        if (!grouped.has(metricId)) grouped.set(metricId, []);
        grouped.get(metricId).push({ value: mean(values), label: entry.label, sort: entry.sort });
      }
    }
    const result = new Map();
    for (const metric of METRICS) if (grouped.has(metric.id)) result.set(metric.id, trendStatus(grouped.get(metric.id), metric.higher));
    return result;
  }

  function representativeTrends(personId, historyRecords, resolvePerson, historyIndex) {
    if (historyIndex) return representativeTrendsFromIndex(personId, historyIndex);
    const grouped = new Map();
    for (const [type, records] of Object.entries(historyRecords || {})) for (const record of records || []) {
      let observations = [];
      if (type === 'qa') {
        const values = canonicalizeQA(record, resolvePerson).filter(row => row.representativeId === personId).map(row => row.score);
        if (values.length) observations = [{ metric: METRICS.find(metric => metric.id === 'qa-score'), value: mean(values) }];
      } else {
        observations = canonicalizePerformance(record, resolvePerson).filter(row => row.personId === personId);
      }
      const perMetric = new Map();
      for (const observation of observations) {
        if (!perMetric.has(observation.metric.id)) perMetric.set(observation.metric.id, []);
        perMetric.get(observation.metric.id).push(observation.value);
      }
      for (const [metricId, values] of perMetric) {
        if (!grouped.has(metricId)) grouped.set(metricId, []);
        grouped.get(metricId).push({ value: mean(values), label: recordLabel(record), sort: recordSort(record) });
      }
    }
    const result = new Map();
    for (const metric of METRICS) if (grouped.has(metric.id)) result.set(metric.id, trendStatus(grouped.get(metric.id), metric.higher));
    return result;
  }

  function dateCutoff(days) { return new Date(Date.now() - days * 86400000); }
  function weekKey(date) { const value = new Date(date); const day = value.getDay(); value.setHours(0, 0, 0, 0); value.setDate(value.getDate() - ((day + 6) % 7)); return value.toISOString().slice(0, 10); }
  function formatPercent(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'; }
  function formatDays(value) { return Number.isFinite(value) ? `${value.toFixed(1)} days` : '—'; }

  function createPreparedSkeleton(people, records) {
    const list = people || [];
    return {
      people: list,
      records: records || {},
      resolvePerson: resolverFor(list),
      byId: new Map(list.map(person => [person.personId, person])),
      coaching: [], checklist: [], qa: [], performanceBySource: Object.fromEntries(PERFORMANCE_TYPES.map(type => [type, []])), performance: []
    };
  }

  function prepareCurrent(people, records) {
    const prepared = createPreparedSkeleton(people, records);
    prepared.coaching = canonicalizeCoaching(records && records.documentedCoaching, prepared.resolvePerson);
    prepared.checklist = canonicalizeChecklist(records && records.checklist, prepared.resolvePerson);
    prepared.qa = canonicalizeQA(records && records.qa, prepared.resolvePerson);
    for (const type of PERFORMANCE_TYPES) prepared.performanceBySource[type] = canonicalizePerformance(records && records[type], prepared.resolvePerson);
    prepared.performance = Object.values(prepared.performanceBySource).flat();
    return prepared;
  }

  async function prepareCurrentAsync(people, records, options) {
    const prepared = createPreparedSkeleton(people, records), opts = options || {};
    const steps = [
      ['documentedCoaching', 'Indexing documented coaching', () => { prepared.coaching = canonicalizeCoaching(records && records.documentedCoaching, prepared.resolvePerson); }],
      ['checklist', 'Indexing checklist history', () => { prepared.checklist = canonicalizeChecklist(records && records.checklist, prepared.resolvePerson); }],
      ['qa', 'Indexing QA evaluations', () => { prepared.qa = canonicalizeQA(records && records.qa, prepared.resolvePerson); }],
      ...PERFORMANCE_TYPES.map(type => [type, `Indexing ${type.replace(/([A-Z])/g, ' $1').toLowerCase()}`, () => { prepared.performanceBySource[type] = canonicalizePerformance(records && records[type], prepared.resolvePerson); }])
    ];
    for (let index = 0; index < steps.length; index += 1) {
      const [, label, run] = steps[index];
      if (opts.onProgress) opts.onProgress(index / steps.length, label);
      if (opts.yieldFn) await opts.yieldFn();
      run();
    }
    prepared.performance = Object.values(prepared.performanceBySource).flat();
    if (opts.onProgress) opts.onProgress(1, 'Profile analytics indexed');
    if (opts.yieldFn) await opts.yieldFn();
    return prepared;
  }

  function representativeProfile(person, people, records, historyRecords, resolvePerson, prepared, historyIndex) {
    const coaching = (prepared ? prepared.coaching : canonicalizeCoaching(records.documentedCoaching, resolvePerson)).filter(event => event.representativeId === person.personId);
    const checklist = (prepared ? prepared.checklist : canonicalizeChecklist(records.checklist, resolvePerson)).filter(item => item.representativeId === person.personId);
    const qaAll = prepared ? prepared.qa : canonicalizeQA(records.qa, resolvePerson);
    const qa = qaAll.filter(row => row.representativeId === person.personId);
    const performanceBySource = prepared ? prepared.performanceBySource : Object.fromEntries(PERFORMANCE_TYPES.map(type => [type, canonicalizePerformance(records[type], resolvePerson)]));
    const observations = (prepared ? prepared.performance : Object.values(performanceBySource).flat()).slice();
    if (qa.length) observations.push({ personId: person.personId, role: 'representative', metric: METRICS.find(metric => metric.id === 'qa-score'), value: mean(qa.map(row => row.score)), provenance: qa[0].provenance });
    for (const candidate of departmentPeople(person, people, 'representative')) {
      const candidateQa = qaAll.filter(row => row.representativeId === candidate.personId);
      if (candidateQa.length) observations.push({ personId: candidate.personId, role: 'representative', metric: METRICS.find(metric => metric.id === 'qa-score'), value: mean(candidateQa.map(row => row.score)), provenance: candidateQa[0].provenance });
    }
    const latest = latestByMetric(observations), cohort = departmentPeople(person, people, 'representative'), trends = representativeTrends(person.personId, historyRecords, resolvePerson, historyIndex), details = [];
    for (const metric of METRICS) {
      const own = latest.get(`${person.personId}|${metric.id}`);
      if (!own) continue;
      const values = cohort.map(candidate => latest.get(`${candidate.personId}|${metric.id}`)?.value).filter(Number.isFinite);
      const relative = percentileScore(own.value, values, metric.higher, MIN_REP_COHORT);
      details.push({ id: metric.id, name: metric.name, category: metric.category, value: own.value, displayValue: metric.percent ? formatPercent(own.value) : String(own.value), departmentAverage: mean(values), departmentAverageDisplay: metric.percent ? formatPercent(mean(values)) : String(mean(values)), higherBetter: metric.higher, trend: trends.get(metric.id) || { status: 'insufficient', reason: 'At least 3 reporting periods are required.', points: [] }, ...relative, provenance: own.provenance });
    }
    const categories = Array.from(new Set(details.map(detail => detail.category))).map(category => {
      const metrics = details.filter(detail => detail.category === category && Number.isFinite(detail.score));
      return { name: category, score: metrics.length ? Math.round(mean(metrics.map(metric => metric.score)) * 10) / 10 : null, metrics };
    });
    const strongest = details.filter(item => Number.isFinite(item.percentile)).sort((a, b) => b.percentile - a.percentile).slice(0, 2);
    const watch = details.filter(item => Number.isFinite(item.percentile) && item.percentile < 40).sort((a, b) => a.percentile - b.percentile).slice(0, 2);
    const declining = details.find(item => item.trend.status === 'declining');
    const recent30 = coaching.filter(event => event.date >= dateCutoff(30));
    const topics = topicBreakdown(coaching.filter(event => event.date >= dateCutoff(90)));
    const checklistThemes = frequencyBreakdown(checklist, 'incident');
    const sourcePresence = {
      weeklyRetail: performanceBySource.weeklyRetail.some(row => row.personId === person.personId),
      weeklyReferral: performanceBySource.weeklyReferral.some(row => row.personId === person.personId),
      monthlyRetail: performanceBySource.monthlyRetail.some(row => row.personId === person.personId),
      monthlyReferral: performanceBySource.monthlyReferral.some(row => row.personId === person.personId),
      qa: qa.length > 0,
      documentedCoaching: coaching.length > 0,
      checklist: checklist.length > 0
    };
    return {
      mode: 'representative', categories, metricDetails: details, sourcePresence,
      qa: { evaluations: qa.length, average: mean(qa.map(row => row.score)), rows: qa.sort((a, b) => b.date - a.date) },
      coaching: { last30: recent30.length, last90: coaching.filter(event => event.date >= dateCutoff(90)).length, daysSinceLast: coaching.length ? Math.floor((Date.now() - Math.max(...coaching.map(event => event.date.getTime()))) / 86400000) : null, topics, events: coaching.sort((a, b) => b.date - a.date) },
      checklist: { total: checklist.length, open: checklist.filter(item => !item.served).length, completed: checklist.filter(item => item.served).length, themes: checklistThemes, items: checklist.sort((a, b) => b.created - a.created) },
      attention: { strongest: strongest.map(item => `${item.name} — ${item.percentile}th percentile`), watch: [...watch.map(item => `${item.name} — ${item.percentile}th percentile`), ...(declining && !watch.includes(declining) ? [`${declining.name} is declining across ${declining.trend.points.length} recent periods`] : [])].slice(0, 3), recent: recent30.length ? `${recent30.length} coaching${recent30.length === 1 ? '' : 's'} in the last 30 days` : 'No documented coaching in the last 30 days' }
    };
  }

  function coachProfile(person, people, records, resolvePerson, prepared) {
    const coaches = departmentPeople(person, people, 'coach'), cutoff = dateCutoff(30);
    const allCoaching = prepared ? prepared.coaching : canonicalizeCoaching(records.documentedCoaching, resolvePerson), allChecklist = prepared ? prepared.checklist : canonicalizeChecklist(records.checklist, resolvePerson), allQA = prepared ? prepared.qa : canonicalizeQA(records.qa, resolvePerson);
    const rawPerformanceBySource = prepared ? prepared.performanceBySource : Object.fromEntries(PERFORMANCE_TYPES.map(type => [type, canonicalizePerformance(records[type], resolvePerson)]));
    const performanceBySource = Object.fromEntries(PERFORMANCE_TYPES.map(type => [type, (rawPerformanceBySource[type] || []).filter(row => row.role === 'coach')]));
    const performance = Object.values(performanceBySource).flat();
    const coaching = allCoaching.filter(event => event.coachId === person.personId), checklist = allChecklist.filter(item => item.coachId === person.personId), qa = allQA.filter(row => row.coachId === person.personId);
    const recentCoaching = coaching.filter(event => event.date >= cutoff), recentChecklist = checklist.filter(item => item.created >= cutoff), recentQA = qa.filter(row => row.date >= cutoff);
    const coachingCounts = new Map(), checklistSpeed = new Map(), qaScores = new Map(), appointment = new Map();
    for (const coach of coaches) {
      coachingCounts.set(coach.personId, allCoaching.filter(event => event.coachId === coach.personId && event.date >= cutoff).length);
      checklistSpeed.set(coach.personId, mean(allChecklist.filter(item => item.coachId === coach.personId && item.created >= cutoff && Number.isFinite(item.days) && /addressed/i.test(item.action)).map(item => item.days)));
      qaScores.set(coach.personId, mean(allQA.filter(row => row.coachId === coach.personId && row.date >= cutoff).map(row => row.score)));
      const rows = performance.filter(row => row.personId === coach.personId && row.metric.category === 'Appointments');
      appointment.set(coach.personId, mean(rows.map(row => row.value)));
    }
    const rankingDefinitions = [
      { id: 'coaching-activity', name: 'Documented Coachings', values: coachingCounts, higher: true, display: value => Math.round(value).toLocaleString(), source: 'Documented Coaching' },
      { id: 'checklist-speed', name: 'Checklist Response Speed', values: checklistSpeed, higher: false, display: formatDays, source: 'Checklist · Coach Timeline calendar-day definition' },
      { id: 'qa-quality', name: 'QA Performance', values: qaScores, higher: true, display: formatPercent, source: 'QA' },
      { id: 'appointment-rate', name: 'Appointment Rate', values: appointment, higher: true, display: formatPercent, source: 'Current performance data' }
    ];
    const rankings = rankingDefinitions.map(definition => ({ ...definition, ...rankMetric(person.personId, definition.values, definition.higher, MIN_COACH_COHORT), displayValue: definition.display(definition.values.get(person.personId)) })).map(({ values, display, ...ranking }) => ranking);
    const topics = topicBreakdown(recentCoaching);
    const weekly = new Map();
    for (let index = 7; index >= 0; index -= 1) { const date = new Date(Date.now() - index * 7 * 86400000); weekly.set(weekKey(date), { week: weekKey(date), coaching: 0, checklistTotal: 0, checklistCompleted: 0 }); }
    for (const event of coaching) { const row = weekly.get(weekKey(event.date)); if (row) row.coaching += 1; }
    for (const item of checklist) { const row = weekly.get(weekKey(item.created)); if (row) { row.checklistTotal += 1; if (item.served) row.checklistCompleted += 1; } }
    const completed = recentChecklist.filter(item => Number.isFinite(item.days) && /addressed/i.test(item.action));
    const timeline = Array.from(weekly.values()).map(row => ({ ...row, checklistResponse: row.checklistTotal ? row.checklistCompleted / row.checklistTotal : NaN }));
    const activityTrend = trendStatus(timeline.map(row => ({ value: row.coaching, label: row.week, sort: row.week })), true);
    const currentRepresentatives = people.filter(candidate => candidate.currentCoachId === person.personId);
    const strongest = rankings.filter(item => item.rank).sort((a, b) => a.rank - b.rank).slice(0, 2).map(item => `#${item.rank} of ${item.total} ${person.department} coaches in ${item.name}`);
    const watch = rankings.filter(item => item.rank && item.rank / item.total > 0.6).sort((a, b) => b.rank / b.total - a.rank / a.total).slice(0, 2).map(item => `${item.name} ranks #${item.rank} of ${item.total}`);
    if (activityTrend.status === 'declining') watch.push('Documented coaching activity is declining across the last 8 weeks');
    const sourcePresence = {
      weeklyRetail: performanceBySource.weeklyRetail.some(row => row.personId === person.personId),
      weeklyReferral: performanceBySource.weeklyReferral.some(row => row.personId === person.personId),
      monthlyRetail: performanceBySource.monthlyRetail.some(row => row.personId === person.personId),
      monthlyReferral: performanceBySource.monthlyReferral.some(row => row.personId === person.personId),
      qa: qa.length > 0,
      documentedCoaching: coaching.length > 0,
      checklist: checklist.length > 0
    };
    return {
      mode: 'coach', rankings, sourcePresence,
      snapshot: { representatives: currentRepresentatives.length, coachingCount: recentCoaching.length, coachingPerRepresentative: currentRepresentatives.length ? recentCoaching.length / currentRepresentatives.length : NaN, checklistCount: recentChecklist.length, checklistCompleted: recentChecklist.filter(item => item.served).length, checklistOpen: recentChecklist.filter(item => !item.served).length, averageResponseDays: mean(completed.map(item => item.days)), medianResponseDays: median(completed.map(item => item.days)), withinTarget: completed.length ? completed.filter(item => item.days <= TARGET_CHECKLIST_DAYS).length / completed.length : NaN, qaAverage: mean(recentQA.map(row => row.score)), activityTrend: activityTrend.status },
      coaching: { events: coaching.sort((a, b) => b.date - a.date), topics, last30: recentCoaching.length },
      checklist: { items: checklist.sort((a, b) => b.created - a.created), recent: recentChecklist, fastestCategories: categorySpeed(completed, false), slowestCategories: categorySpeed(completed, true), themes: frequencyBreakdown(recentChecklist, 'incident'), representatives: frequencyBreakdown(recentChecklist, 'representativeId', 'representative') },
      qa: { evaluations: recentQA.length, average: mean(recentQA.map(row => row.score)), rows: recentQA },
      timeline,
      attention: { strongest, watch: watch.slice(0, 3), recent: `${recentCoaching.length} documented coaching${recentCoaching.length === 1 ? '' : 's'} in the last 30 days · activity ${activityTrend.status}` }
    };
  }

  function categorySpeed(items, descending) {
    const grouped = new Map();
    for (const item of items) { if (!grouped.has(item.incident)) grouped.set(item.incident, []); grouped.get(item.incident).push(item.days); }
    return Array.from(grouped, ([name, values]) => ({ name, averageDays: mean(values), count: values.length })).sort((a, b) => descending ? b.averageDays - a.averageDays : a.averageDays - b.averageDays).slice(0, 5);
  }

  function buildProfile(personId, people, records, historyRecords, prepared, historyIndex) {
    const person = (people || []).find(candidate => candidate.personId === personId);
    if (!person) throw new Error('Person was not found in the identity registry.');
    const resolvePerson = prepared && prepared.resolvePerson || resolverFor(people), byId = prepared && prepared.byId || new Map(people.map(candidate => [candidate.personId, candidate]));
    const relationships = { coach: person.currentCoachId ? byId.get(person.currentCoachId) || null : null, representatives: people.filter(candidate => candidate.currentCoachId === person.personId) };
    const analytics = person.role === 'coach' ? coachProfile(person, people, records || {}, resolvePerson, prepared) : representativeProfile(person, people, records || {}, historyRecords || {}, resolvePerson, prepared, historyIndex);
    const { sourcePresence: sources, ...profile } = analytics;
    return { person, relationships, sources, currentDataThrough: latestPeriod(records, sources), ...profile };
  }

  function buildPreparedProfile(personId, prepared, historyIndex) {
    if (!prepared) throw new Error('Prepared profile data is required.');
    return buildProfile(personId, prepared.people, prepared.records, {}, prepared, historyIndex);
  }

  function latestPeriod(records, sources) {
    const values = Object.entries(records || {}).filter(([type, record]) => record && (!sources || sources[type])).map(([, record]) => ({ label: record.detectedPeriod && record.detectedPeriod.label || '', sort: record.periodSort || record.importedAt || '' })).filter(value => value.label);
    return values.sort((a, b) => String(b.sort).localeCompare(String(a.sort)))[0]?.label || '';
  }

  function aggregateWindowValues(prepared, historyIndex) {
    const groups = new Map();
    const weeklyEntries = [...(historyIndex && historyIndex.byType.weeklyRetail || []), ...(historyIndex && historyIndex.byType.weeklyReferral || [])];
    const monthlyEntries = [...(historyIndex && historyIndex.byType.monthlyRetail || []), ...(historyIndex && historyIndex.byType.monthlyReferral || [])];
    const performanceEntries = weeklyEntries.length ? weeklyEntries : monthlyEntries;
    const performanceRows = performanceEntries.length ? performanceEntries.flatMap(entry => entry.performance || []) : (prepared && prepared.performance || []);
    for (const row of performanceRows) {
      if (row.role !== 'representative') continue;
      const key = `${row.personId}|${row.metric.id}`;
      if (!groups.has(key)) groups.set(key, { metric: row.metric, values: [] });
      groups.get(key).values.push(row.value);
    }
    const qaEntries = historyIndex && historyIndex.byType.qa || [];
    const qaRows = qaEntries.length ? qaEntries.flatMap(entry => entry.qa || []) : (prepared && prepared.qa || []);
    const qaMetric = METRICS.find(metric => metric.id === 'qa-score');
    for (const row of qaRows) {
      if (!row.representativeId) continue;
      const key = `${row.representativeId}|qa-score`;
      if (!groups.has(key)) groups.set(key, { metric: qaMetric, values: [] });
      groups.get(key).values.push(row.score);
    }
    const result = new Map();
    for (const [key, group] of groups) result.set(key, { metric: group.metric, value: mean(group.values) });
    return result;
  }

  function buildWindowRankings(personId, prepared, historyIndex, weeks) {
    if (!prepared) return { mode: '', weeks: Number(weeks) || 0, rankings: [] };
    const person = prepared.byId.get(personId);
    if (!person) return { mode: '', weeks: Number(weeks) || 0, rankings: [] };
    const values = aggregateWindowValues(prepared, historyIndex), windowWeeks = Math.max(1, Number(weeks) || 8), rankings = [];
    if (person.role === 'coach') {
      const coaches = departmentPeople(person, prepared.people, 'coach');
      for (const metric of METRICS) {
        const valuesByCoach = new Map();
        for (const coach of coaches) {
          const repIds = prepared.people.filter(candidate => candidate.role === 'representative' && candidate.currentCoachId === coach.personId).map(candidate => candidate.personId);
          const teamValue = mean(repIds.map(id => values.get(`${id}|${metric.id}`)?.value));
          if (Number.isFinite(teamValue)) valuesByCoach.set(coach.personId, teamValue);
        }
        if (!valuesByCoach.has(person.personId)) continue;
        const ranked = rankMetric(person.personId, valuesByCoach, metric.higher, MIN_COACH_COHORT);
        rankings.push({ id: metric.id, name: metric.name, category: metric.category, higherBetter: metric.higher, displayValue: metric.percent ? formatPercent(valuesByCoach.get(person.personId)) : String(valuesByCoach.get(person.personId)), source: `Last ${windowWeeks} weeks · current team roster`, ...ranked });
      }
      return { mode: 'coach', weeks: windowWeeks, rankings };
    }
    const cohort = departmentPeople(person, prepared.people, 'representative');
    for (const metric of METRICS) {
      const valuesByPerson = new Map();
      for (const candidate of cohort) {
        const value = values.get(`${candidate.personId}|${metric.id}`)?.value;
        if (Number.isFinite(value)) valuesByPerson.set(candidate.personId, value);
      }
      if (!valuesByPerson.has(person.personId)) continue;
      const ranked = rankMetric(person.personId, valuesByPerson, metric.higher, MIN_REP_COHORT);
      const relative = percentileScore(valuesByPerson.get(person.personId), Array.from(valuesByPerson.values()), metric.higher, MIN_REP_COHORT);
      rankings.push({ id: metric.id, name: metric.name, category: metric.category, higherBetter: metric.higher, displayValue: metric.percent ? formatPercent(valuesByPerson.get(person.personId)) : String(valuesByPerson.get(person.personId)), source: `Last ${windowWeeks} weeks · ${person.department || 'department'} peers`, score: relative.score, performancePercentile: relative.percentile, ...ranked });
    }
    return { mode: 'representative', weeks: windowWeeks, rankings };
  }

  async function loadProfile(personId) {
    if (!root.CoachToolsData || !root.CoachToolsAppData || !root.CoachToolsIdentity) throw new Error('CoachTools shared data is unavailable.');
    await Promise.all([root.CoachToolsAppData.ready(), root.CoachToolsIdentity.ready()]);
    const people = await root.CoachToolsIdentity.getAllPeople(), historyRecords = {};
    const records = await root.CoachToolsAppData.getMany(['weeklyRetail', 'weeklyReferral', 'monthlyRetail', 'monthlyReferral', 'qa', 'documentedCoaching', 'checklist'], { includeRecord: true });
    for (const type of ['weeklyRetail', 'weeklyReferral', 'monthlyRetail', 'monthlyReferral', 'qa']) historyRecords[type] = await root.CoachToolsData.getHistory(type, { activeOnly: true, limit: 13 });
    const prepared = prepareCurrent(people, records), historyIndex = createHistoryIndex(people);
    for (const [type, rows] of Object.entries(historyRecords)) for (const record of rows || []) addHistoryRecord(historyIndex, type, record);
    return buildProfile(personId, people, records, historyRecords, prepared, historyIndex);
  }

  root.CoachToolsProfiles = Object.freeze({
    VERSION, MIN_REP_COHORT, MIN_COACH_COHORT, TARGET_CHECKLIST_DAYS, METRICS,
    loadProfile, buildProfile, buildPreparedProfile, prepareCurrent, prepareCurrentAsync, createHistoryIndex, addHistoryRecord, buildWindowRankings, percentileScore, rankMetric,
    _test: Object.freeze({ extractRows, canonicalizeCoaching, canonicalizeChecklist, canonicalizeQA, canonicalizePerformance, parseDate, parseNumber, mean, median, representativeTrendsFromIndex, aggregateWindowValues })
  });
})(typeof window !== 'undefined' ? window : globalThis);
