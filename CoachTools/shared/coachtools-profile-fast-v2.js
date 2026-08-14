(function attachCoachToolsProfileFast(root) {
  'use strict';

  const Profiles = root.CoachToolsProfiles;
  if (!Profiles || !Profiles._test) return;
  const test = Profiles._test;
  const METRICS = Profiles.METRICS || [];
  const WEEKLY_TYPES = ['weeklyRetail', 'weeklyReferral'];
  const QA_METRIC = METRICS.find(metric => metric.id === 'qa-score') || { id: 'qa-score', name: 'QA Score', category: 'Quality', higher: true, percent: true };
  const CASH_APPOINTMENT_METRIC = METRICS.find(metric => metric.id === 'cash-appointment-rate') || null;
  const WIPER_METRIC = METRICS.find(metric => metric.id === 'wiper-rate') || null;
  const DAY = 86400000;
  const COVERAGE_KEY = 'coachtools.minKpiCoverage.v1';
  const DEFAULT_COVERAGE = 0.5;
  const profileCacheByHistory = new WeakMap();
  const rankingCacheByHistory = new WeakMap();
  const uiProfiles = new Map();

  const clean = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  const normalizeName = value => root.CoachToolsIdentity ? root.CoachToolsIdentity.normalizeName(value) : clean(value).toLowerCase();
  const mean = values => {
    const valid = (values || []).filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
  };
  const median = values => {
    const valid = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return NaN;
    const middle = (valid.length - 1) / 2;
    return (valid[Math.floor(middle)] + valid[Math.ceil(middle)]) / 2;
  };
  const fmtPct = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
  const fmtDays = value => Number.isFinite(value) ? `${value.toFixed(1)} days` : '—';
  const cutoff = days => new Date(Date.now() - days * DAY);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function coverageThreshold() {
    if (Number.isFinite(root.__CoachToolsMinKpiCoverage)) return clamp(root.__CoachToolsMinKpiCoverage, 0, 1);
    try {
      const saved = Number(root.localStorage && root.localStorage.getItem(COVERAGE_KEY));
      if (Number.isFinite(saved) && saved >= 0 && saved <= 1) return saved;
    } catch (_) {}
    return DEFAULT_COVERAGE;
  }

  function setCoverageThreshold(value) {
    const next = clamp(Number(value) || 0, 0, 1);
    root.__CoachToolsMinKpiCoverage = next;
    try { if (root.localStorage) root.localStorage.setItem(COVERAGE_KEY, String(next)); } catch (_) {}
    return next;
  }

  function applyPeopleProfilesViewportFix() {
    if (!root.document) return;
    const meta = root.document.querySelector('meta[name="coachtools-id"]');
    if (!meta || meta.content !== 'people-profiles' || root.document.getElementById('people-profiles-scroll-fix')) return;
    const style = root.document.createElement('style');
    style.id = 'people-profiles-scroll-fix';
    style.textContent = '.finder{position:relative;z-index:55}.finder input{pointer-events:auto;cursor:text}.finder span{pointer-events:none}@media (min-width:721px){html,body{height:100%;overflow:hidden}.app{height:100vh;min-height:0;overflow:hidden}.layout{min-height:0;overflow:hidden}.sidebar,.content{min-height:0;overflow:auto}}';
    root.document.head.appendChild(style);
    const enableSearch = () => {
      const input = root.document.getElementById('personSearch');
      if (!input) return;
      input.disabled = false;
      input.removeAttribute('disabled');
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', enableSearch, { once: true });
    else enableSearch();
  }
  applyPeopleProfilesViewportFix();

  function resolverFor(people) {
    const exact = new Map();
    for (const person of people || []) {
      for (const value of [person.displayName, person.normalizedName, ...(person.aliases || []), ...Object.values(person.sourceNames || {}).flat()]) {
        const key = normalizeName(value);
        if (key && !exact.has(key)) exact.set(key, person.personId);
      }
    }
    return value => exact.get(normalizeName(value)) || '';
  }

  function mapPush(map, key, value) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }

  function mapPushUnique(map, key, value) {
    if (!key || !value) return;
    const rows = map.get(key) || [];
    if (!rows.some(row => row && row.personId === value.personId)) rows.push(value);
    map.set(key, rows);
  }

  function normalizedHeader(value) { return clean(value).toLowerCase().replace(/[^a-z0-9%]/g, ''); }
  function rowPick(row, candidates) {
    const keys = new Map(Object.keys(row || {}).map(key => [normalizedHeader(key), key]));
    for (const candidate of candidates) {
      const key = keys.get(normalizedHeader(candidate));
      if (key != null) return row[key];
    }
    return undefined;
  }

  function rowPickPattern(row, candidates, patterns) {
    const exact = rowPick(row, candidates || []);
    if (exact !== undefined) return exact;
    for (const key of Object.keys(row || {})) {
      if ((patterns || []).some(pattern => pattern.test(key))) return row[key];
    }
    return undefined;
  }

  function rowNumber(row, candidates, patterns) {
    const raw = rowPickPattern(row, candidates, patterns);
    return test.parseNumber ? test.parseNumber(raw) : Number(raw);
  }

  function performanceProvenance(record, type) {
    return {
      source: record && (record.originalFileName || record.datasetType) || type || 'Performance',
      period: record && record.detectedPeriod && record.detectedPeriod.label || '',
      importedAt: record && record.importedAt || ''
    };
  }

  function derivedPerformanceRows(record, resolvePerson, type) {
    if (!record || !record.data || !test.extractRows) return [];
    const rows = [], sourceType = type || record.datasetType || '', provenance = performanceProvenance(record, type);
    for (const pack of test.extractRows(record.data)) {
      for (const row of pack.rows || []) {
        const repRaw = rowPick(row, ['Representative', 'Associate Name', 'Agent Name', 'AgentName', 'Employee', 'Name']);
        const coachRaw = rowPick(row, ['Job Coach', 'Coach Assigned', 'Coach', 'Sheet', 'Team']) || pack.sheet;
        const personId = repRaw ? resolvePerson(repRaw) : resolvePerson(coachRaw);
        if (!personId) continue;
        const role = repRaw ? 'representative' : 'coach';

        const consumerApps = rowNumber(row,
          ['Consumer Appointments', 'Consumer Appointment', 'Consumer Apps'],
          [/^Consumer[_\s-]*Appointments?$/i, /consumer.*appointments?/i]);
        const consumerOpps = rowNumber(row,
          ['Consumer Opportunities', 'Consumer Opportunity', 'Consumer Opps'],
          [/^Consumer[_\s-]*Opportunit/i, /consumer.*opportunit/i]);
        if (CASH_APPOINTMENT_METRIC && sourceType !== 'weeklyReferral' && Number.isFinite(consumerApps) && Number.isFinite(consumerOpps) && consumerOpps > 0) {
          rows.push({ personId, role, metric: CASH_APPOINTMENT_METRIC, value: consumerApps / consumerOpps, weight: consumerOpps, provenance });
        }

        const wiperCount = rowNumber(row, ['Wiper Count'], [/^Wiper[_\s-]*Count$/i, /wiper.*count/i]);
        const wiperJobs = rowNumber(row, ['Wiper Jobs', 'Wiper Job'], [/^Wiper[_\s-]*Jobs?$/i, /wiper.*jobs?/i]);
        const wipersAccept = rowNumber(row, ['Wipers Accept', 'Wiper Accept', 'Wipers Accepted', 'Wiper Accepted'], [/wipers?[_\s-]*accept/i, /wipers? accept/i]);
        const wipersAsked = rowNumber(row, ['Wipers Asked', 'Wiper Asked'], [/wipers?[_\s-]*asked/i, /wipers? asked/i]);

        let wiperValue = NaN, wiperWeight = NaN;
        if (sourceType === 'weeklyReferral') {
          if (Number.isFinite(wipersAccept) && Number.isFinite(wipersAsked) && wipersAsked > 0) {
            wiperValue = wipersAccept / wipersAsked;
            wiperWeight = wipersAsked;
          } else if (Number.isFinite(wiperCount) && Number.isFinite(wiperJobs) && wiperJobs > 0) {
            wiperValue = wiperCount / wiperJobs;
            wiperWeight = wiperJobs;
          }
        } else {
          if (Number.isFinite(wiperCount) && Number.isFinite(wiperJobs) && wiperJobs > 0) {
            wiperValue = wiperCount / wiperJobs;
            wiperWeight = wiperJobs;
          } else if (Number.isFinite(wipersAccept) && Number.isFinite(wipersAsked) && wipersAsked > 0) {
            wiperValue = wipersAccept / wipersAsked;
            wiperWeight = wipersAsked;
          }
        }
        if (WIPER_METRIC && Number.isFinite(wiperValue)) rows.push({ personId, role, metric: WIPER_METRIC, value: wiperValue, weight: wiperWeight, provenance });
      }
    }
    return rows;
  }

  function metricKey(personId, metricId) { return `${personId}|${metricId}`; }

  function profilePerformanceRows(record, resolvePerson, type) {
    const baseRows = test.canonicalizePerformance(record, resolvePerson) || [];
    const derived = derivedPerformanceRows(record, resolvePerson, type);
    if (!derived.length) return baseRows;
    const derivedKeys = new Set(derived.map(row => metricKey(row.personId, row.metric.id)));
    return baseRows.filter(row => !derivedKeys.has(metricKey(row.personId, row.metric.id))).concat(derived);
  }

  function weeklyDepartment(type) {
    if (type === 'weeklyRetail') return 'Retail';
    if (type === 'weeklyReferral') return 'Referral';
    return '';
  }

  function resolveWeeklyCoach(prepared, rawName, type) {
    const raw = clean(rawName), directId = prepared.resolvePerson(raw);
    if (directId) {
      const direct = prepared.byId.get(directId);
      if (direct && direct.role === 'coach') return directId;
    }
    const key = normalizeName(raw);
    if (!key || key.includes(' ')) return '';
    const department = weeklyDepartment(type);
    const pool = department ? prepared.departmentCoaches.get(department) || [] : prepared.people.filter(person => person.role === 'coach');
    const candidates = pool.filter(person => {
      const full = normalizeName(person.displayName || person.normalizedName);
      const parts = full.split(' ').filter(Boolean);
      return parts.length && parts[parts.length - 1] === key;
    });
    return candidates.length === 1 ? candidates[0].personId : '';
  }

  function linkWeeklyRoster(prepared, type, record) {
    if (!record || !record.data || !test.extractRows) return;
    for (const pack of test.extractRows(record.data)) {
      for (const row of pack.rows || []) {
        const repRaw = rowPick(row, ['Representative', 'Associate Name', 'Agent Name', 'AgentName', 'Employee', 'Name']);
        const coachRaw = rowPick(row, ['Job Coach', 'Coach Assigned', 'Coach', 'Sheet', 'Team']) || pack.sheet;
        if (!clean(repRaw) || !clean(coachRaw)) continue;
        const repId = prepared.resolvePerson(repRaw), coachId = resolveWeeklyCoach(prepared, coachRaw, type);
        const rep = repId && prepared.byId.get(repId), coach = coachId && prepared.byId.get(coachId);
        if (!rep || rep.role !== 'representative' || !coach || coach.role !== 'coach') continue;
        mapPushUnique(prepared.repsByCoach, coachId, rep);
      }
    }
  }

  function aggregateInto(map, personId, metric, value, provenance, weight) {
    if (!personId || !metric || !Number.isFinite(value)) return;
    const key = metricKey(personId, metric.id);
    if (!map.has(key)) map.set(key, { metric, sum: 0, count: 0, weightedSum: 0, weightSum: 0, provenance });
    const row = map.get(key);
    if (Number.isFinite(weight) && weight > 0) {
      row.weightedSum += value * weight;
      row.weightSum += weight;
    } else {
      row.sum += value;
      row.count += 1;
    }
    if (!row.provenance && provenance) row.provenance = provenance;
  }

  function finishAggregates(map) {
    const out = new Map();
    for (const [key, row] of map) {
      const value = row.weightSum > 0 ? row.weightedSum / row.weightSum : row.count ? row.sum / row.count : NaN;
      out.set(key, { metric: row.metric, value, weight: row.weightSum || 0, provenance: row.provenance });
    }
    return out;
  }

  function summarizeMetricRows(rows) {
    const weighted = (rows || []).filter(row => Number.isFinite(row.value) && Number.isFinite(row.weight) && row.weight > 0);
    if (weighted.length) {
      const weight = weighted.reduce((sum, row) => sum + row.weight, 0);
      return { value: weight > 0 ? weighted.reduce((sum, row) => sum + row.value * row.weight, 0) / weight : NaN, weight };
    }
    return { value: mean((rows || []).map(row => row.value)), weight: 0 };
  }

  function weightedEntryValue(entries) {
    const weighted = (entries || []).filter(entry => entry && Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0);
    if (weighted.length) {
      const weight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
      if (weight > 0) return weighted.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weight;
    }
    return mean((entries || []).map(entry => entry && entry.value));
  }

  function createPreparedSkeleton(people, records) {
    const list = people || [];
    const prepared = {
      people: list,
      records: records || {},
      byId: new Map(list.map(person => [person.personId, person])),
      resolvePerson: resolverFor(list),
      repsByCoach: new Map(), departmentReps: new Map(), departmentCoaches: new Map(),
      coaching: [], coachingByRep: new Map(), coachingByCoach: new Map(),
      checklist: [], checklistByRep: new Map(), checklistByCoach: new Map(),
      qa: [], qaByRep: new Map(), qaByCoach: new Map(),
      performanceBySource: { weeklyRetail: [], weeklyReferral: [] },
      currentMetricAgg: new Map(), currentMetricValues: new Map(),
      sourcePresenceByPerson: new Map()
    };
    for (const person of list) {
      const deptMap = person.role === 'coach' ? prepared.departmentCoaches : prepared.departmentReps;
      mapPush(deptMap, person.department || '', person);
      if (person.role === 'representative' && person.currentCoachId) mapPushUnique(prepared.repsByCoach, person.currentCoachId, person);
    }
    return prepared;
  }

  function noteSource(prepared, personId, source) {
    if (!personId || !source) return;
    if (!prepared.sourcePresenceByPerson.has(personId)) prepared.sourcePresenceByPerson.set(personId, new Set());
    prepared.sourcePresenceByPerson.get(personId).add(source);
  }

  function indexPerformance(prepared, type, record) {
    linkWeeklyRoster(prepared, type, record);
    const rows = profilePerformanceRows(record, prepared.resolvePerson, type).filter(row => row.role === 'representative');
    prepared.performanceBySource[type] = rows;
    for (const row of rows) {
      aggregateInto(prepared.currentMetricAgg, row.personId, row.metric, row.value, row.provenance, row.weight);
      noteSource(prepared, row.personId, type);
    }
  }

  function indexQA(prepared, record) {
    prepared.qa = test.canonicalizeQA(record, prepared.resolvePerson);
    for (const row of prepared.qa) {
      mapPush(prepared.qaByRep, row.representativeId, row);
      mapPush(prepared.qaByCoach, row.coachId, row);
      aggregateInto(prepared.currentMetricAgg, row.representativeId, QA_METRIC, row.score, row.provenance);
      noteSource(prepared, row.representativeId, 'qa');
    }
  }

  function indexCoaching(prepared, record) {
    prepared.coaching = test.canonicalizeCoaching(record, prepared.resolvePerson);
    for (const row of prepared.coaching) {
      mapPush(prepared.coachingByRep, row.representativeId, row);
      mapPush(prepared.coachingByCoach, row.coachId, row);
      noteSource(prepared, row.representativeId, 'documentedCoaching');
      noteSource(prepared, row.coachId, 'documentedCoaching');
    }
  }

  function indexChecklist(prepared, record) {
    prepared.checklist = test.canonicalizeChecklist(record, prepared.resolvePerson);
    for (const row of prepared.checklist) {
      mapPush(prepared.checklistByRep, row.representativeId, row);
      mapPush(prepared.checklistByCoach, row.coachId, row);
      noteSource(prepared, row.representativeId, 'checklist');
      noteSource(prepared, row.coachId, 'checklist');
    }
  }

  async function prepareWeeklyAsync(people, records, options) {
    const prepared = createPreparedSkeleton(people, records), opts = options || {};
    const steps = [
      ['weeklyRetail', 'Indexing current Weekly Retail KPIs', () => indexPerformance(prepared, 'weeklyRetail', records && records.weeklyRetail)],
      ['weeklyReferral', 'Indexing current Weekly Referral KPIs', () => indexPerformance(prepared, 'weeklyReferral', records && records.weeklyReferral)],
      ['qa', 'Indexing QA evaluations', () => indexQA(prepared, records && records.qa)],
      ['documentedCoaching', 'Indexing documented coaching', () => indexCoaching(prepared, records && records.documentedCoaching)],
      ['checklist', 'Indexing checklist history', () => indexChecklist(prepared, records && records.checklist)]
    ];
    for (let index = 0; index < steps.length; index += 1) {
      const [id, label, run] = steps[index];
      if (opts.onProgress) opts.onProgress(index / steps.length, label, id);
      if (opts.yieldFn) await opts.yieldFn();
      run();
    }
    prepared.currentMetricValues = finishAggregates(prepared.currentMetricAgg);
    if (opts.onProgress) opts.onProgress(1, 'Weekly profile index ready', 'done');
    if (opts.yieldFn) await opts.yieldFn();
    return prepared;
  }

  function createHistoryIndex(people) {
    return {
      people: people || [], resolvePerson: resolverFor(people || []),
      pointsByPersonMetric: new Map(), aggregate: new Map(), recordCount: 0,
      sourceCounts: { weeklyRetail: 0, weeklyReferral: 0, qa: 0 }
    };
  }

  function addHistoryPoint(index, personId, metric, value, label, sort, weight) {
    if (!personId || !metric || !Number.isFinite(value)) return;
    const key = metricKey(personId, metric.id);
    mapPush(index.pointsByPersonMetric, key, { value, weight: Number.isFinite(weight) ? weight : 0, label: label || '', sort: sort || '' });
    aggregateInto(index.aggregate, personId, metric, value, null, weight);
  }

  function recordMeta(record) {
    return {
      label: record && record.detectedPeriod && (record.detectedPeriod.label || record.detectedPeriod.periodKey) || record && record.periodKey || '',
      sort: record && (record.periodSort || record.detectedPeriod && record.detectedPeriod.periodKey || record.importedAt) || ''
    };
  }

  function addHistoryRecord(index, type, record) {
    if (!index || !record || !['weeklyRetail', 'weeklyReferral', 'qa'].includes(type)) return;
    const meta = recordMeta(record), grouped = new Map();
    if (type === 'qa') {
      for (const row of test.canonicalizeQA(record, index.resolvePerson)) {
        if (!row.representativeId) continue;
        const key = metricKey(row.representativeId, 'qa-score');
        if (!grouped.has(key)) grouped.set(key, { personId: row.representativeId, metric: QA_METRIC, rows: [] });
        grouped.get(key).rows.push({ value: row.score, weight: 0 });
      }
    } else {
      for (const row of profilePerformanceRows(record, index.resolvePerson, type)) {
        if (row.role !== 'representative' || !row.personId) continue;
        const key = metricKey(row.personId, row.metric.id);
        if (!grouped.has(key)) grouped.set(key, { personId: row.personId, metric: row.metric, rows: [] });
        grouped.get(key).rows.push(row);
      }
    }
    for (const group of grouped.values()) {
      const summary = summarizeMetricRows(group.rows);
      addHistoryPoint(index, group.personId, group.metric, summary.value, meta.label, meta.sort, summary.weight);
    }
    index.recordCount += 1;
    index.sourceCounts[type] = (index.sourceCounts[type] || 0) + 1;
    index._finishedAggregate = null;
  }

  function trendStatus(points, higherBetter) {
    if (!Array.isArray(points) || points.length < 3) return { status: 'insufficient', reason: 'At least 3 weekly periods are required.', points: points || [] };
    const ordered = points.slice().sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
    const split = Math.max(1, Math.floor(ordered.length / 2));
    const earlier = mean(ordered.slice(0, split).map(point => point.value));
    const recent = mean(ordered.slice(-split).map(point => point.value));
    const change = recent - earlier, threshold = Math.max(Math.abs(earlier) * 0.03, 0.005);
    const raw = Math.abs(change) < threshold ? 'stable' : change > 0 ? 'up' : 'down';
    const favorable = higherBetter === false ? raw === 'down' : raw === 'up';
    return { status: raw === 'stable' ? 'stable' : favorable ? 'improving' : 'declining', change, earlier, recent, points: ordered.slice(-12), reason: '' };
  }

  function historyValueMap(index) {
    if (!index) return new Map();
    if (!index._finishedAggregate) index._finishedAggregate = finishAggregates(index.aggregate);
    return index._finishedAggregate;
  }

  function expectedHistoryPeriods(index, person, metricId) {
    if (!index) return 0;
    if (metricId === 'qa-score') return index.sourceCounts.qa || 0;
    const dept = clean(person && person.department).toLowerCase();
    if (dept.includes('referral')) return index.sourceCounts.weeklyReferral || 0;
    if (dept.includes('retail')) return index.sourceCounts.weeklyRetail || 0;
    return Math.max(index.sourceCounts.weeklyRetail || 0, index.sourceCounts.weeklyReferral || 0);
  }

  function metricCoverage(index, person, metricId, threshold) {
    const points = index ? index.pointsByPersonMetric.get(metricKey(person.personId, metricId)) || [] : [];
    const periods = new Set(points.map(point => clean(point.sort || point.label)).filter(Boolean));
    const available = expectedHistoryPeriods(index, person, metricId);
    const measured = periods.size || points.length;
    const rate = available > 0 ? Math.min(1, measured / available) : measured ? 1 : 0;
    const minimum = Number.isFinite(threshold) ? threshold : coverageThreshold();
    return { measured, available, rate, minimum, eligible: available > 0 && rate + 1e-9 >= minimum };
  }

  function sourcePresence(prepared, personId) {
    const set = prepared.sourcePresenceByPerson.get(personId) || new Set();
    return {
      weeklyRetail: set.has('weeklyRetail'), weeklyReferral: set.has('weeklyReferral'),
      monthlyRetail: false, monthlyReferral: false,
      qa: set.has('qa'), documentedCoaching: set.has('documentedCoaching'), checklist: set.has('checklist')
    };
  }

  function latestWeeklyLabel(records, sources) {
    const candidates = WEEKLY_TYPES.filter(type => sources[type] && records && records[type]).map(type => {
      const record = records[type];
      return { label: record && record.detectedPeriod && (record.detectedPeriod.label || record.detectedPeriod.periodKey) || '', sort: record && (record.periodSort || record.importedAt) || '' };
    }).filter(row => row.label);
    return candidates.sort((a, b) => String(b.sort).localeCompare(String(a.sort)))[0]?.label || '';
  }

  function topicBreakdown(events) {
    const grouped = new Map();
    for (const event of events || []) for (const topic of event.topics || []) {
      if (!grouped.has(topic)) grouped.set(topic, { name: topic, count: 0, representatives: new Set(), repeat: new Map() });
      const row = grouped.get(topic); row.count += 1;
      const rep = event.representativeId || normalizeName(event.representative);
      if (rep) { row.representatives.add(rep); row.repeat.set(rep, (row.repeat.get(rep) || 0) + 1); }
    }
    return [...grouped.values()].map(row => ({ name: row.name, count: row.count, representatives: row.representatives.size, repeatRepresentatives: [...row.repeat.values()].filter(count => count > 1).length, trend: 'stable' })).sort((a, b) => b.count - a.count);
  }

  function coachingTopSix(topics) {
    const rows = (topics || []).filter(row => row && row.count > 0);
    const top = rows.slice(0, 5).map(row => ({ name: row.name, count: row.count }));
    const other = rows.slice(5).reduce((sum, row) => sum + row.count, 0);
    if (other > 0) top.push({ name: 'Other', count: other });
    return top;
  }

  function frequency(items, key, labelKey) {
    const grouped = new Map();
    for (const item of items || []) {
      const id = clean(item[key]) || '(blank)';
      if (!grouped.has(id)) grouped.set(id, { name: clean(item[labelKey || key]) || id, count: 0, open: 0 });
      const row = grouped.get(id); row.count += 1; if (!item.served) row.open += 1;
    }
    return [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  }

  function representativeProfile(person, prepared, historyIndex) {
    const id = person.personId, coaching = [...(prepared.coachingByRep.get(id) || [])], checklist = [...(prepared.checklistByRep.get(id) || [])], qa = [...(prepared.qaByRep.get(id) || [])];
    const cohort = prepared.departmentReps.get(person.department || '') || [];
    const details = [], threshold = coverageThreshold();
    for (const metric of METRICS) {
      const own = prepared.currentMetricValues.get(metricKey(id, metric.id));
      if (!own) continue;
      const coverage = metricCoverage(historyIndex, person, metric.id, threshold);
      if (historyIndex && !coverage.eligible) continue;
      const values = cohort.filter(candidate => !historyIndex || metricCoverage(historyIndex, candidate, metric.id, threshold).eligible)
        .map(candidate => prepared.currentMetricValues.get(metricKey(candidate.personId, metric.id))?.value).filter(Number.isFinite);
      const relative = Profiles.percentileScore(own.value, values, metric.higher, Profiles.MIN_REP_COHORT);
      const points = historyIndex ? historyIndex.pointsByPersonMetric.get(metricKey(id, metric.id)) || [] : [];
      const trend = trendStatus(points, metric.higher);
      details.push({
        id: metric.id, name: metric.name, category: metric.category, value: own.value, weight: own.weight || 0,
        displayValue: metric.percent ? fmtPct(own.value) : String(own.value),
        departmentAverage: mean(values), departmentAverageDisplay: metric.percent ? fmtPct(mean(values)) : String(mean(values)),
        higherBetter: metric.higher, trend, coverage, ...relative, provenance: own.provenance
      });
    }
    const categories = [...new Set(details.map(detail => detail.category))].map(category => {
      const rows = details.filter(detail => detail.category === category && Number.isFinite(detail.score));
      return { name: category, score: rows.length ? Math.round(mean(rows.map(row => row.score)) * 10) / 10 : null, metrics: rows };
    });
    const recent30 = coaching.filter(event => event.date >= cutoff(30));
    const topics = topicBreakdown(coaching.filter(event => event.date >= cutoff(90)));
    const sources = sourcePresence(prepared, id);
    return {
      mode: 'representative', person,
      relationships: { coach: person.currentCoachId ? prepared.byId.get(person.currentCoachId) || null : null, representatives: [] },
      sources, currentDataThrough: latestWeeklyLabel(prepared.records, sources), categories, metricDetails: details,
      qa: { evaluations: qa.length, average: mean(qa.map(row => row.score)), rows: qa.sort((a, b) => b.date - a.date) },
      coaching: { last30: recent30.length, last90: coaching.filter(event => event.date >= cutoff(90)).length, averagePerDay: recent30.length / 30, daysSinceLast: coaching.length ? Math.floor((Date.now() - Math.max(...coaching.map(event => event.date.getTime()))) / DAY) : null, topics, topSix: coachingTopSix(topics), events: coaching.sort((a, b) => b.date - a.date) },
      checklist: { total: checklist.length, open: checklist.filter(item => !item.served).length, completed: checklist.filter(item => item.served).length, themes: frequency(checklist, 'incident'), items: checklist.sort((a, b) => b.created - a.created) }
    };
  }

  function coachOperationalRankings(person, prepared) {
    const coaches = prepared.departmentCoaches.get(person.department || '') || [];
    const recent = cutoff(30), coachingValues = new Map(), checklistValues = new Map(), qaValues = new Map();
    for (const coach of coaches) {
      const coaching = (prepared.coachingByCoach.get(coach.personId) || []).filter(row => row.date >= recent);
      coachingValues.set(coach.personId, coaching.length);
      const checklist = (prepared.checklistByCoach.get(coach.personId) || []).filter(row => row.created >= recent && Number.isFinite(row.days) && /addressed/i.test(row.action));
      checklistValues.set(coach.personId, mean(checklist.map(row => row.days)));
      const team = prepared.repsByCoach.get(coach.personId) || [];
      const qaRows = team.flatMap(rep => prepared.qaByRep.get(rep.personId) || []).filter(row => row.date >= recent);
      qaValues.set(coach.personId, mean(qaRows.map(row => row.score)));
    }
    const defs = [
      { id: 'coaching-activity', name: 'Documented Coachings', values: coachingValues, higher: true, display: value => Number.isFinite(value) ? Math.round(value).toLocaleString() : '—', source: 'Documented Coaching · last 30 days' },
      { id: 'checklist-speed', name: 'Checklist Response Speed', values: checklistValues, higher: false, display: fmtDays, source: 'Checklist · last 30 days' },
      { id: 'qa-quality', name: 'Team QA Performance', values: qaValues, higher: true, display: fmtPct, source: 'QA · current team · last 30 days' }
    ];
    return defs.map(def => ({ ...def, ...Profiles.rankMetric(person.personId, def.values, def.higher, Profiles.MIN_COACH_COHORT), displayValue: def.display(def.values.get(person.personId)) })).map(({ values, display, ...row }) => row);
  }

  function weekKey(date) {
    const value = new Date(date), day = value.getDay(); value.setHours(0, 0, 0, 0); value.setDate(value.getDate() - ((day + 6) % 7));
    return value.toISOString().slice(0, 10);
  }

  function coachProfile(person, prepared) {
    const id = person.personId, reps = prepared.repsByCoach.get(id) || [], recent = cutoff(30);
    const coaching = [...(prepared.coachingByCoach.get(id) || [])], checklist = [...(prepared.checklistByCoach.get(id) || [])];
    const teamQa = reps.flatMap(rep => prepared.qaByRep.get(rep.personId) || []);
    const recentCoaching = coaching.filter(row => row.date >= recent), recentChecklist = checklist.filter(row => row.created >= recent), recentQA = teamQa.filter(row => row.date >= recent);
    const completed = recentChecklist.filter(item => Number.isFinite(item.days) && /addressed/i.test(item.action));
    const weekly = new Map();
    for (let index = 7; index >= 0; index -= 1) { const date = new Date(Date.now() - index * 7 * DAY); weekly.set(weekKey(date), { week: weekKey(date), coaching: 0, checklistTotal: 0, checklistCompleted: 0 }); }
    for (const event of coaching) { const row = weekly.get(weekKey(event.date)); if (row) row.coaching += 1; }
    for (const item of checklist) { const row = weekly.get(weekKey(item.created)); if (row) { row.checklistTotal += 1; if (item.served) row.checklistCompleted += 1; } }
    const timeline = [...weekly.values()].map(row => ({ ...row, checklistResponse: row.checklistTotal ? row.checklistCompleted / row.checklistTotal : NaN }));
    const sources = sourcePresence(prepared, id);
    if (reps.some(rep => sourcePresence(prepared, rep.personId).weeklyRetail)) sources.weeklyRetail = true;
    if (reps.some(rep => sourcePresence(prepared, rep.personId).weeklyReferral)) sources.weeklyReferral = true;
    if (recentQA.length) sources.qa = true;
    const topics = topicBreakdown(recentCoaching);
    return {
      mode: 'coach', person,
      relationships: { coach: null, representatives: reps }, sources, currentDataThrough: latestWeeklyLabel(prepared.records, sources),
      rankings: coachOperationalRankings(person, prepared),
      snapshot: {
        representatives: reps.length, coachingCount: recentCoaching.length,
        coachingPerRepresentative: reps.length ? recentCoaching.length / reps.length : NaN,
        coachingPerDay: recentCoaching.length / 30,
        checklistCount: recentChecklist.length, checklistCompleted: recentChecklist.filter(item => item.served).length, checklistOpen: recentChecklist.filter(item => !item.served).length,
        averageResponseDays: mean(completed.map(item => item.days)), medianResponseDays: median(completed.map(item => item.days)),
        withinTarget: completed.length ? completed.filter(item => item.days <= Profiles.TARGET_CHECKLIST_DAYS).length / completed.length : NaN,
        qaAverage: mean(recentQA.map(row => row.score)), activityTrend: trendStatus(timeline.map(row => ({ value: row.coaching, sort: row.week })), true).status
      },
      coaching: { events: coaching.sort((a, b) => b.date - a.date), topics, topSix: coachingTopSix(topics), last30: recentCoaching.length, averagePerDay: recentCoaching.length / 30 },
      checklist: { items: checklist.sort((a, b) => b.created - a.created), recent: recentChecklist, themes: frequency(recentChecklist, 'incident'), representatives: frequency(recentChecklist, 'representativeId', 'representative') },
      qa: { evaluations: recentQA.length, average: mean(recentQA.map(row => row.score)), rows: recentQA.sort((a, b) => b.date - a.date) },
      timeline
    };
  }

  function cacheFor(weakMap, historyIndex) {
    if (!historyIndex || typeof historyIndex !== 'object') return null;
    let cache = weakMap.get(historyIndex);
    if (!cache) { cache = new Map(); weakMap.set(historyIndex, cache); }
    return cache;
  }

  function buildProfile(personId, prepared, historyIndex) {
    const person = prepared && prepared.byId.get(personId);
    if (!person) throw new Error('Person was not found in the weekly profile index.');
    const threshold = coverageThreshold();
    const cache = cacheFor(profileCacheByHistory, historyIndex);
    const key = `${personId}|${Math.round(threshold * 1000)}`;
    if (cache && cache.has(key)) return cache.get(key);
    const profile = person.role === 'coach' ? coachProfile(person, prepared) : representativeProfile(person, prepared, historyIndex);
    if (cache) cache.set(key, profile);
    uiProfiles.set(personId, profile);
    uiProfiles.set(`name:${normalizeName(person.displayName)}`, profile);
    return profile;
  }

  function buildWindowRankings(personId, prepared, historyIndex, weeks) {
    const person = prepared && prepared.byId.get(personId), values = historyValueMap(historyIndex), windowWeeks = Math.max(1, Number(weeks) || 8), rankings = [];
    if (!person) return { mode: '', weeks: windowWeeks, rankings };
    const threshold = coverageThreshold();
    const cache = cacheFor(rankingCacheByHistory, historyIndex);
    const cacheKey = `${personId}|${windowWeeks}|${Math.round(threshold * 1000)}`;
    if (cache && cache.has(cacheKey)) return cache.get(cacheKey);
    let result;
    if (person.role === 'coach') {
      const coaches = prepared.departmentCoaches.get(person.department || '') || [];
      for (const metric of METRICS) {
        const valuesByCoach = new Map();
        for (const coach of coaches) {
          const reps = prepared.repsByCoach.get(coach.personId) || [];
          const eligibleEntries = reps.filter(rep => metricCoverage(historyIndex, rep, metric.id, threshold).eligible)
            .map(rep => values.get(metricKey(rep.personId, metric.id))).filter(Boolean);
          const teamValue = weightedEntryValue(eligibleEntries);
          if (Number.isFinite(teamValue)) valuesByCoach.set(coach.personId, teamValue);
        }
        if (!valuesByCoach.has(person.personId)) continue;
        const ranked = Profiles.rankMetric(person.personId, valuesByCoach, metric.higher, Profiles.MIN_COACH_COHORT);
        rankings.push({ id: metric.id, name: metric.name, category: metric.category, displayValue: metric.percent ? fmtPct(valuesByCoach.get(person.personId)) : String(valuesByCoach.get(person.personId)), source: `Last ${windowWeeks} weekly periods · ≥${Math.round(threshold * 100)}% KPI coverage`, ...ranked });
      }
      result = { mode: 'coach', weeks: windowWeeks, coverageThreshold: threshold, rankings };
    } else {
      const cohort = prepared.departmentReps.get(person.department || '') || [];
      for (const metric of METRICS) {
        const ownCoverage = metricCoverage(historyIndex, person, metric.id, threshold);
        if (!ownCoverage.eligible) continue;
        const valuesByPerson = new Map();
        for (const candidate of cohort) {
          if (!metricCoverage(historyIndex, candidate, metric.id, threshold).eligible) continue;
          const value = values.get(metricKey(candidate.personId, metric.id))?.value;
          if (Number.isFinite(value)) valuesByPerson.set(candidate.personId, value);
        }
        if (!valuesByPerson.has(person.personId)) continue;
        const ranked = Profiles.rankMetric(person.personId, valuesByPerson, metric.higher, Profiles.MIN_REP_COHORT);
        const relative = Profiles.percentileScore(valuesByPerson.get(person.personId), [...valuesByPerson.values()], metric.higher, Profiles.MIN_REP_COHORT);
        rankings.push({ id: metric.id, name: metric.name, category: metric.category, coverage: ownCoverage, displayValue: metric.percent ? fmtPct(valuesByPerson.get(person.personId)) : String(valuesByPerson.get(person.personId)), source: `Last ${windowWeeks} weekly periods · ≥${Math.round(threshold * 100)}% KPI coverage`, score: relative.score, performancePercentile: relative.percentile, ...ranked });
      }
      result = { mode: 'representative', weeks: windowWeeks, coverageThreshold: threshold, rankings };
    }
    if (cache) cache.set(cacheKey, result);
    return result;
  }

  function sparkline(points) {
    const vals = (points || []).map(point => Number(point && point.value)).filter(Number.isFinite).slice(-8);
    if (vals.length < 2) return '';
    const min = Math.min(...vals), max = Math.max(...vals), span = Math.max(1e-9, max - min);
    const coords = vals.map((value, index) => `${(index / Math.max(1, vals.length - 1) * 78 + 1).toFixed(1)},${(19 - (value - min) / span * 16).toFixed(1)}`).join(' ');
    return `<svg class="ctSpark" viewBox="0 0 80 22" aria-hidden="true"><polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>`;
  }

  function donutSvg(rows) {
    const items = (rows || []).filter(row => row.count > 0), total = items.reduce((sum, row) => sum + row.count, 0);
    if (!total) return '<div class="emptyData">No coaching topics in this period.</div>';
    let cursor = 0;
    const slices = items.map((row, index) => {
      const start = cursor / total * 100; cursor += row.count; const end = cursor / total * 100;
      return `var(--ctPie${index + 1}) ${start}% ${end}%`;
    }).join(',');
    const legend = items.map((row, index) => `<div class="ctPieLegendRow"><i style="background:var(--ctPie${index + 1})"></i><span>${clean(row.name)}</span><b>${Math.round(row.count / total * 100)}%</b><small>${row.count}</small></div>`).join('');
    return `<div class="ctPieWrap"><div class="ctDonut" style="background:conic-gradient(${slices})"><div>${total}<small>coachings</small></div></div><div class="ctPieLegend">${legend}</div></div>`;
  }

  function installPeopleProfilesEnhancer() {
    if (!root.document) return;
    const appId = clean(root.document.querySelector('meta[name="coachtools-id"]')?.content);
    if (appId !== 'people-profiles') return;
    if (!root.document.getElementById('people-profiles-insight-style')) {
      const style = root.document.createElement('style');
      style.id = 'people-profiles-insight-style';
      style.textContent = `
        :root{--ctPie1:#247bb5;--ctPie2:#50b6d9;--ctPie3:#13805b;--ctPie4:#a96500;--ctPie5:#7b65b5;--ctPie6:#aab7c2}
        .ctCoverageControl{display:flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:5px 7px;color:var(--muted);font-size:10px;font-weight:850;white-space:nowrap}.ctCoverageControl input{width:48px;border:0;background:transparent;text-align:right;color:var(--ink);font-weight:900;outline:none}.ctSpark{width:82px;height:23px;color:var(--blue);display:block;margin-top:5px}.ctSpark.good{color:var(--green)}.ctSpark.bad{color:var(--red)}.ctMomentum{display:flex;gap:8px;align-items:center;justify-content:space-between}.ctMomentumCopy{min-width:0;flex:1}.ctMomentumCopy b,.ctMomentumCopy small{display:block}.ctMomentumCopy small{margin-top:2px;color:var(--muted);font-size:9px}.ctPieWrap{display:grid;grid-template-columns:170px minmax(0,1fr);gap:16px;align-items:center}.ctDonut{width:155px;height:155px;border-radius:50%;display:grid;place-items:center}.ctDonut>div{width:90px;height:90px;border-radius:50%;background:#fff;display:grid;place-items:center;text-align:center;font-size:21px;font-weight:950}.ctDonut small{display:block;color:var(--muted);font-size:8px;text-transform:uppercase}.ctPieLegend{display:grid;gap:6px}.ctPieLegendRow{display:grid;grid-template-columns:10px minmax(0,1fr) 38px 28px;gap:7px;align-items:center;font-size:10px}.ctPieLegendRow i{width:9px;height:9px;border-radius:3px}.ctPieLegendRow b{text-align:right}.ctPieLegendRow small{color:var(--muted);text-align:right}.ctCoverageBadge{font-size:8px;color:var(--muted);margin-left:5px}@media(max-width:700px){.ctPieWrap{grid-template-columns:1fr}.ctDonut{margin:auto}}
      `;
      root.document.head.appendChild(style);
    }

    let painting = false;
    const paint = () => {
      if (painting) return; painting = true;
      root.requestAnimationFrame(() => {
        try {
          const headerActions = root.document.querySelector('.profileHeader .headerActions');
          if (headerActions && !root.document.getElementById('ctMinKpiCoverage')) {
            const label = root.document.createElement('label');
            label.className = 'ctCoverageControl';
            label.innerHTML = `Min KPI Coverage <input id="ctMinKpiCoverage" type="number" min="0" max="100" step="5" value="${Math.round(coverageThreshold() * 100)}"><span>%</span>`;
            headerActions.insertBefore(label, headerActions.firstChild);
            const input = label.querySelector('input');
            input.addEventListener('change', () => {
              const threshold = setCoverageThreshold(Number(input.value) / 100);
              input.value = String(Math.round(threshold * 100));
              const windowSelect = root.document.getElementById('weekWindow');
              if (windowSelect) windowSelect.dispatchEvent(new Event('change', { bubbles: true }));
            });
          }

          const title = root.document.querySelector('.profileIdentity h1');
          const profile = title ? uiProfiles.get(`name:${normalizeName(title.textContent)}`) : null;
          if (!profile) return;

          for (const card of root.document.querySelectorAll('.tabPanel .card')) {
            const heading = clean(card.querySelector('h3')?.textContent);
            if ((heading === 'Documented coaching' || heading === 'Recent coaching') && !card.dataset.ctPerDay) {
              const sub = card.querySelector('.sub');
              if (sub) sub.textContent = `${sub.textContent} · ${(profile.coaching.averagePerDay || 0).toFixed(1)}/day`;
              card.dataset.ctPerDay = '1';
            }
          }

          const coachingTitle = Array.from(root.document.querySelectorAll('.sectionTitle h2')).find(node => clean(node.textContent) === 'Documented coaching');
          const coachingGrid = coachingTitle?.closest('.tabPanel')?.querySelector('.grid');
          if (coachingGrid && !coachingGrid.querySelector('[data-ct-coaching-mix]')) {
            const chart = root.document.createElement('div');
            chart.className = 'card wide'; chart.dataset.ctCoachingMix = '1';
            chart.innerHTML = `<div class="cardHead"><h3>Most common coaching types</h3><span class="pill">Top 5 + Other</span></div>${donutSvg(profile.coaching.topSix)}`;
            coachingGrid.appendChild(chart);
          }

          for (const row of root.document.querySelectorAll('.tabPanel .listRow')) {
            if (row.querySelector('.ctSpark')) continue;
            const metricName = clean(row.querySelector('b')?.textContent);
            const metric = (profile.metricDetails || []).find(item => clean(item.name) === metricName);
            if (!metric || !metric.trend?.points?.length) continue;
            const holder = row.firstElementChild || row;
            holder.insertAdjacentHTML('beforeend', sparkline(metric.trend.points));
            const svg = holder.querySelector('.ctSpark');
            if (svg) svg.classList.add(metric.trend.status === 'improving' ? 'good' : metric.trend.status === 'declining' ? 'bad' : '');
          }

          for (const priority of root.document.querySelectorAll('.priorityPerson')) {
            if (priority.querySelector('.ctSpark')) continue;
            const repName = clean(priority.querySelector('.priorityTop b')?.textContent);
            const repProfile = uiProfiles.get(`name:${normalizeName(repName)}`);
            if (!repProfile) continue;
            const metric = (repProfile.metricDetails || []).filter(item => item.trend?.points?.length).sort((a, b) => (a.percentile ?? 100) - (b.percentile ?? 100))[0];
            if (!metric) continue;
            priority.insertAdjacentHTML('beforeend', `<div class="ctMomentum"><div class="ctMomentumCopy"><small>${clean(metric.name)} · ${metric.coverage ? `${metric.coverage.measured}/${metric.coverage.available} weeks` : ''}</small></div>${sparkline(metric.trend.points)}</div>`);
            priority.querySelector('.ctSpark')?.classList.add('bad');
          }

          if (profile.mode === 'coach') {
            const grid = root.document.querySelector('.tabPanel .grid');
            if (grid && !grid.querySelector('[data-ct-recognition]')) {
              const repIds = new Set((profile.relationships.representatives || []).map(rep => rep.personId));
              const recognition = [];
              for (const [key, repProfile] of uiProfiles) {
                if (!String(key).startsWith('name:') || !repProfile?.person || !repIds.has(repProfile.person.personId)) continue;
                const metric = (repProfile.metricDetails || []).filter(item => item.trend?.status === 'improving' && item.trend.points?.length).sort((a, b) => (b.percentile ?? 0) - (a.percentile ?? 0))[0];
                if (metric) recognition.push({ repProfile, metric });
              }
              recognition.sort((a, b) => Math.abs(b.metric.trend.change || 0) - Math.abs(a.metric.trend.change || 0));
              if (recognition.length) {
                const card = root.document.createElement('div'); card.className = 'card half'; card.dataset.ctRecognition = '1';
                card.innerHTML = `<h3>Recognition momentum</h3>${recognition.slice(0, 5).map(item => `<div class="listRow"><div class="ctMomentumCopy"><b>${clean(item.repProfile.person.displayName)}</b><small>${clean(item.metric.name)} · ${clean(item.metric.displayValue)} · improving</small>${sparkline(item.metric.trend.points)}</div><span class="pill">Recognize</span></div>`).join('')}`;
                for (const svg of card.querySelectorAll('.ctSpark')) svg.classList.add('good');
                grid.appendChild(card);
              }
            }
          }
        } finally { painting = false; }
      });
    };
    const start = () => {
      paint();
      const content = root.document.getElementById('content');
      if (content) new MutationObserver(paint).observe(content, { childList: true, subtree: true });
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  function coverageGlobalRankings(result, personId, prepared, historyIndex) {
    if (!result || !prepared || !historyIndex) return result;
    const targetIds = new Set(['cash-appointment-rate', 'wiper-rate']), values = historyValueMap(historyIndex), threshold = coverageThreshold();
    const rankings = Array.isArray(result.rankings) ? result.rankings.map(row => ({ ...row })) : [];
    for (const metricId of targetIds) {
      const metric = METRICS.find(item => item.id === metricId);
      if (!metric) continue;
      const scores = new Map();
      if (result.mode === 'coach') {
        for (const coach of prepared.people || []) {
          if (!coach || coach.role !== 'coach') continue;
          const entries = (prepared.repsByCoach.get(coach.personId) || [])
            .filter(rep => metricCoverage(historyIndex, rep, metricId, threshold).eligible)
            .map(rep => values.get(metricKey(rep.personId, metricId))).filter(Boolean);
          const value = weightedEntryValue(entries);
          if (Number.isFinite(value)) scores.set(coach.personId, value);
        }
      } else {
        for (const rep of prepared.people || []) {
          if (!rep || rep.role !== 'representative' || !metricCoverage(historyIndex, rep, metricId, threshold).eligible) continue;
          const value = values.get(metricKey(rep.personId, metricId))?.value;
          if (Number.isFinite(value)) scores.set(rep.personId, value);
        }
      }
      if (!scores.has(personId)) {
        const index = rankings.findIndex(row => row.id === metricId);
        if (index >= 0) rankings.splice(index, 1);
        continue;
      }
      const ordered = [...scores.entries()].sort((a, b) => metric.higher === false ? a[1] - b[1] : b[1] - a[1]);
      const rankIndex = ordered.findIndex(([id]) => id === personId), rank = rankIndex >= 0 ? rankIndex + 1 : null, total = ordered.length;
      const percentile = rank && total > 1 ? Math.round((total - rank) / (total - 1) * 100) : rank ? 100 : null;
      let row = rankings.find(item => item.id === metricId);
      if (!row) { row = { id: metricId, name: metric.name, category: metric.category }; rankings.push(row); }
      Object.assign(row, {
        value: scores.get(personId), displayValue: metric.percent ? fmtPct(scores.get(personId)) : String(scores.get(personId)),
        rank, total, percentile, performancePercentile: percentile, score: percentile == null ? null : Math.round((1 + 9 * percentile / 100) * 10) / 10,
        source: `Last ${result.weeks || 8} weekly periods · global · ≥${Math.round(threshold * 100)}% KPI coverage`
      });
    }
    return { ...result, coverageThreshold: threshold, rankings };
  }

  const nativeApi = Object.freeze({
    VERSION: '1.1.0', WEEKLY_TYPES, prepareWeeklyAsync, createHistoryIndex, addHistoryRecord, buildProfile, buildWindowRankings,
    coverageThreshold, setCoverageThreshold, metricCoverage,
    _test: Object.freeze({ trendStatus, historyValueMap, metricKey, resolveWeeklyCoach, profilePerformanceRows, derivedPerformanceRows, summarizeMetricRows, metricCoverage, coachingTopSix })
  });
  root.CoachToolsProfileFast = nativeApi;

  const installedApi = root.CoachToolsProfileFast;
  if (installedApi && installedApi !== nativeApi && installedApi.__coachtoolsGlobalKpiPatch) {
    const wrappedBuildWindowRankings = installedApi.buildWindowRankings.bind(installedApi);
    root.CoachToolsProfileFast = Object.freeze({
      ...installedApi,
      VERSION: `${nativeApi.VERSION}+global-kpi-coverage.1`,
      buildWindowRankings(personId, prepared, historyIndex, weeks) {
        return coverageGlobalRankings(wrappedBuildWindowRankings(personId, prepared, historyIndex, weeks), personId, prepared, historyIndex);
      }
    });
  }

  installPeopleProfilesEnhancer();
})(typeof window !== 'undefined' ? window : globalThis);
