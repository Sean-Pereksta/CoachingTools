(function attachCoachToolsProfileFast(root) {
  'use strict';

  const Profiles = root.CoachToolsProfiles;
  if (!Profiles || !Profiles._test) return;
  const test = Profiles._test;
  const METRICS = Profiles.METRICS || [];
  const WEEKLY_TYPES = ['weeklyRetail', 'weeklyReferral'];
  const QA_METRIC = METRICS.find(metric => metric.id === 'qa-score') || { id: 'qa-score', name: 'QA Score', category: 'Quality', higher: true, percent: true };
  const DAY = 86400000;

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

  function applyPeopleProfilesViewportFix() {
    if (!root.document) return;
    const meta = root.document.querySelector('meta[name="coachtools-id"]');
    if (!meta || meta.content !== 'people-profiles' || root.document.getElementById('people-profiles-scroll-fix')) return;
    const style = root.document.createElement('style');
    style.id = 'people-profiles-scroll-fix';
    style.textContent = '@media (min-width:721px){html,body{height:100%;overflow:hidden}.app{height:100vh;min-height:0;overflow:hidden}.layout{min-height:0;overflow:hidden}.sidebar,.content{min-height:0;overflow:auto}}';
    root.document.head.appendChild(style);
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
        const repRaw = rowPick(row, ['Representative', 'Associate Name', 'Agent Name', 'AgentName', 'Employee']);
        const coachRaw = rowPick(row, ['Job Coach', 'Coach Assigned', 'Coach', 'Sheet', 'Team']) || pack.sheet;
        if (!clean(repRaw) || !clean(coachRaw)) continue;
        const repId = prepared.resolvePerson(repRaw), coachId = resolveWeeklyCoach(prepared, coachRaw, type);
        const rep = repId && prepared.byId.get(repId), coach = coachId && prepared.byId.get(coachId);
        if (!rep || rep.role !== 'representative' || !coach || coach.role !== 'coach') continue;
        mapPushUnique(prepared.repsByCoach, coachId, rep);
      }
    }
  }

  function metricKey(personId, metricId) { return `${personId}|${metricId}`; }
  function aggregateInto(map, personId, metric, value, provenance) {
    if (!personId || !metric || !Number.isFinite(value)) return;
    const key = metricKey(personId, metric.id);
    if (!map.has(key)) map.set(key, { metric, sum: 0, count: 0, provenance });
    const row = map.get(key);
    row.sum += value; row.count += 1;
    if (!row.provenance && provenance) row.provenance = provenance;
  }
  function finishAggregates(map) {
    const out = new Map();
    for (const [key, row] of map) out.set(key, { metric: row.metric, value: row.count ? row.sum / row.count : NaN, provenance: row.provenance });
    return out;
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
    const rows = test.canonicalizePerformance(record, prepared.resolvePerson).filter(row => row.role === 'representative');
    prepared.performanceBySource[type] = rows;
    for (const row of rows) {
      aggregateInto(prepared.currentMetricAgg, row.personId, row.metric, row.value, row.provenance);
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

  function addHistoryPoint(index, personId, metric, value, label, sort) {
    if (!personId || !metric || !Number.isFinite(value)) return;
    const key = metricKey(personId, metric.id);
    mapPush(index.pointsByPersonMetric, key, { value, label: label || '', sort: sort || '' });
    aggregateInto(index.aggregate, personId, metric, value, null);
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
        if (!grouped.has(key)) grouped.set(key, { personId: row.representativeId, metric: QA_METRIC, values: [] });
        grouped.get(key).values.push(row.score);
      }
    } else {
      for (const row of test.canonicalizePerformance(record, index.resolvePerson)) {
        if (row.role !== 'representative' || !row.personId) continue;
        const key = metricKey(row.personId, row.metric.id);
        if (!grouped.has(key)) grouped.set(key, { personId: row.personId, metric: row.metric, values: [] });
        grouped.get(key).values.push(row.value);
      }
    }
    for (const group of grouped.values()) addHistoryPoint(index, group.personId, group.metric, mean(group.values), meta.label, meta.sort);
    index.recordCount += 1;
    index.sourceCounts[type] = (index.sourceCounts[type] || 0) + 1;
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
    return [...grouped.values()].map(row => ({ name: row.name, count: row.count, representatives: row.representatives.size, repeatRepresentatives: [...row.repeat.values()].filter(count => count > 1).length, trend: 'stable' })).sort((a, b) => b.count - a.count).slice(0, 8);
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
    const details = [];
    for (const metric of METRICS) {
      const own = prepared.currentMetricValues.get(metricKey(id, metric.id));
      if (!own) continue;
      const values = cohort.map(candidate => prepared.currentMetricValues.get(metricKey(candidate.personId, metric.id))?.value).filter(Number.isFinite);
      const relative = Profiles.percentileScore(own.value, values, metric.higher, Profiles.MIN_REP_COHORT);
      const points = historyIndex ? historyIndex.pointsByPersonMetric.get(metricKey(id, metric.id)) || [] : [];
      const trend = trendStatus(points, metric.higher);
      details.push({
        id: metric.id, name: metric.name, category: metric.category, value: own.value,
        displayValue: metric.percent ? fmtPct(own.value) : String(own.value),
        departmentAverage: mean(values), departmentAverageDisplay: metric.percent ? fmtPct(mean(values)) : String(mean(values)),
        higherBetter: metric.higher, trend, ...relative, provenance: own.provenance
      });
    }
    const categories = [...new Set(details.map(detail => detail.category))].map(category => {
      const rows = details.filter(detail => detail.category === category && Number.isFinite(detail.score));
      return { name: category, score: rows.length ? Math.round(mean(rows.map(row => row.score)) * 10) / 10 : null, metrics: rows };
    });
    const recent30 = coaching.filter(event => event.date >= cutoff(30));
    const sources = sourcePresence(prepared, id);
    return {
      mode: 'representative', person,
      relationships: { coach: person.currentCoachId ? prepared.byId.get(person.currentCoachId) || null : null, representatives: [] },
      sources, currentDataThrough: latestWeeklyLabel(prepared.records, sources), categories, metricDetails: details,
      qa: { evaluations: qa.length, average: mean(qa.map(row => row.score)), rows: qa.sort((a, b) => b.date - a.date) },
      coaching: { last30: recent30.length, last90: coaching.filter(event => event.date >= cutoff(90)).length, daysSinceLast: coaching.length ? Math.floor((Date.now() - Math.max(...coaching.map(event => event.date.getTime()))) / DAY) : null, topics: topicBreakdown(coaching.filter(event => event.date >= cutoff(90))), events: coaching.sort((a, b) => b.date - a.date) },
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
    return {
      mode: 'coach', person,
      relationships: { coach: null, representatives: reps }, sources, currentDataThrough: latestWeeklyLabel(prepared.records, sources),
      rankings: coachOperationalRankings(person, prepared),
      snapshot: {
        representatives: reps.length, coachingCount: recentCoaching.length,
        coachingPerRepresentative: reps.length ? recentCoaching.length / reps.length : NaN,
        checklistCount: recentChecklist.length, checklistCompleted: recentChecklist.filter(item => item.served).length, checklistOpen: recentChecklist.filter(item => !item.served).length,
        averageResponseDays: mean(completed.map(item => item.days)), medianResponseDays: median(completed.map(item => item.days)),
        withinTarget: completed.length ? completed.filter(item => item.days <= Profiles.TARGET_CHECKLIST_DAYS).length / completed.length : NaN,
        qaAverage: mean(recentQA.map(row => row.score)), activityTrend: trendStatus(timeline.map(row => ({ value: row.coaching, sort: row.week })), true).status
      },
      coaching: { events: coaching.sort((a, b) => b.date - a.date), topics: topicBreakdown(recentCoaching), last30: recentCoaching.length },
      checklist: { items: checklist.sort((a, b) => b.created - a.created), recent: recentChecklist, themes: frequency(recentChecklist, 'incident'), representatives: frequency(recentChecklist, 'representativeId', 'representative') },
      qa: { evaluations: recentQA.length, average: mean(recentQA.map(row => row.score)), rows: recentQA.sort((a, b) => b.date - a.date) },
      timeline
    };
  }

  function buildProfile(personId, prepared, historyIndex) {
    const person = prepared && prepared.byId.get(personId);
    if (!person) throw new Error('Person was not found in the weekly profile index.');
    return person.role === 'coach' ? coachProfile(person, prepared) : representativeProfile(person, prepared, historyIndex);
  }

  function buildWindowRankings(personId, prepared, historyIndex, weeks) {
    const person = prepared && prepared.byId.get(personId), values = historyValueMap(historyIndex), windowWeeks = Math.max(1, Number(weeks) || 8), rankings = [];
    if (!person) return { mode: '', weeks: windowWeeks, rankings };
    if (person.role === 'coach') {
      const coaches = prepared.departmentCoaches.get(person.department || '') || [];
      for (const metric of METRICS) {
        const valuesByCoach = new Map();
        for (const coach of coaches) {
          const reps = prepared.repsByCoach.get(coach.personId) || [];
          const teamValue = mean(reps.map(rep => values.get(metricKey(rep.personId, metric.id))?.value));
          if (Number.isFinite(teamValue)) valuesByCoach.set(coach.personId, teamValue);
        }
        if (!valuesByCoach.has(person.personId)) continue;
        const ranked = Profiles.rankMetric(person.personId, valuesByCoach, metric.higher, Profiles.MIN_COACH_COHORT);
        rankings.push({ id: metric.id, name: metric.name, category: metric.category, displayValue: metric.percent ? fmtPct(valuesByCoach.get(person.personId)) : String(valuesByCoach.get(person.personId)), source: `Last ${windowWeeks} weekly periods · current team roster`, ...ranked });
      }
      return { mode: 'coach', weeks: windowWeeks, rankings };
    }
    const cohort = prepared.departmentReps.get(person.department || '') || [];
    for (const metric of METRICS) {
      const valuesByPerson = new Map();
      for (const candidate of cohort) {
        const value = values.get(metricKey(candidate.personId, metric.id))?.value;
        if (Number.isFinite(value)) valuesByPerson.set(candidate.personId, value);
      }
      if (!valuesByPerson.has(person.personId)) continue;
      const ranked = Profiles.rankMetric(person.personId, valuesByPerson, metric.higher, Profiles.MIN_REP_COHORT);
      const relative = Profiles.percentileScore(valuesByPerson.get(person.personId), [...valuesByPerson.values()], metric.higher, Profiles.MIN_REP_COHORT);
      rankings.push({ id: metric.id, name: metric.name, category: metric.category, displayValue: metric.percent ? fmtPct(valuesByPerson.get(person.personId)) : String(valuesByPerson.get(person.personId)), source: `Last ${windowWeeks} weekly periods · ${person.department || 'department'} peers`, score: relative.score, performancePercentile: relative.percentile, ...ranked });
    }
    return { mode: 'representative', weeks: windowWeeks, rankings };
  }

  root.CoachToolsProfileFast = Object.freeze({
    VERSION: '1.0.1', WEEKLY_TYPES, prepareWeeklyAsync, createHistoryIndex, addHistoryRecord, buildProfile, buildWindowRankings,
    _test: Object.freeze({ trendStatus, historyValueMap, metricKey, resolveWeeklyCoach })
  });
})(typeof window !== 'undefined' ? window : globalThis);