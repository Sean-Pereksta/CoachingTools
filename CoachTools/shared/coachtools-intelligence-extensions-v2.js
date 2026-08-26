(function extendCoachToolsIntelligence(root) {
  'use strict';

  const base = root.CoachToolsIntelligence;
  if (!base) return;
  const Alignment = root.CoachToolsCoachingAlignment;

  const DAY = 86400000;
  const COVERAGE_KEY = 'coachtools.minKpiCoverage.v1';
  const DEFAULT_COVERAGE = 0.5;
  const seriesCache = new WeakMap();
  const recentStatsCache = new WeakMap();
  const augmentedCache = new WeakMap();
  const clean = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  const normHeader = value => clean(value).toLowerCase().replace(/[^a-z0-9%]/g, '');
  const calculationNow = () => root.__CoachToolsIntelligenceAsOf instanceof Date && !Number.isNaN(root.__CoachToolsIntelligenceAsOf.getTime()) ? root.__CoachToolsIntelligenceAsOf.getTime() : Date.now();
  const daysSince = date => date instanceof Date ? Math.max(0, (calculationNow() - date.getTime()) / DAY) : NaN;
  const mean = values => {
    const valid = (values || []).filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
  };
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function coverageThreshold() {
    if (Alignment && Alignment.kpiCoverageThreshold) return Alignment.kpiCoverageThreshold();
    if (Number.isFinite(root.__CoachToolsMinKpiCoverage)) return clamp(root.__CoachToolsMinKpiCoverage, 0, 1);
    try {
      const raw = root.localStorage && root.localStorage.getItem(COVERAGE_KEY);
      const saved = raw == null || raw === '' ? NaN : Number(raw);
      if (Number.isFinite(saved) && saved >= 0 && saved <= 1) return saved;
    } catch (_) {}
    return DEFAULT_COVERAGE;
  }

  function setCoverageThreshold(value) {
    if (Alignment && Alignment.setKpiCoverageThreshold) return Alignment.setKpiCoverageThreshold(value);
    const next = clamp(Number(value) || 0, 0, 1);
    root.__CoachToolsMinKpiCoverage = next;
    try { if (root.localStorage) root.localStorage.setItem(COVERAGE_KEY, String(next)); } catch (_) {}
    return next;
  }

  function qualityCoverageThreshold() { return Alignment && Alignment.qualityCoverageThreshold ? Alignment.qualityCoverageThreshold() : 0.25; }
  function setQualityCoverageThreshold(value) { return Alignment && Alignment.setQualityCoverageThreshold ? Alignment.setQualityCoverageThreshold(value) : clamp(Number(value) || 0, 0, 1); }

  function quietCommandCenterIdentityStartup() {
    const appId = typeof document !== 'undefined' ? clean(document.querySelector('meta[name="coachtools-id"]')?.content) : '';
    const identity = root.CoachToolsIdentity;
    if (appId !== 'coaching-command-center' || !identity || typeof identity.subscribe !== 'function' || typeof identity.ready !== 'function') return;

    const originalSubscribe = identity.subscribe.bind(identity);
    root.CoachToolsIdentity = Object.freeze({
      ...identity,
      subscribe(listener) {
        let startupReady = false;
        Promise.resolve(identity.ready()).then(() => { startupReady = true; }).catch(() => { startupReady = true; });
        return originalSubscribe(detail => {
          const reason = clean(detail && detail.reason);
          if (!startupReady && (reason === 'dataset-ingested' || reason === 'team-setup-synced' || reason === 'person-updated')) return;
          listener(detail);
        });
      }
    });
  }
  quietCommandCenterIdentityStartup();

  function rowPick(row, candidates) {
    const keys = new Map(Object.keys(row || {}).map(key => [normHeader(key), key]));
    for (const candidate of candidates || []) {
      const key = keys.get(normHeader(candidate));
      if (key != null) return row[key];
    }
    return undefined;
  }
  function rowPickPattern(row, candidates, patterns) {
    const exact = rowPick(row, candidates || []);
    if (exact !== undefined) return exact;
    for (const key of Object.keys(row || {})) if ((patterns || []).some(pattern => pattern.test(key))) return row[key];
    return undefined;
  }
  function rowNumber(row, candidates, patterns) { return base._test.parseNumber(rowPickPattern(row, candidates, patterns)); }
  function recordDate(record) {
    const period = record && record.detectedPeriod || {};
    return base._test.parseDate(period.end || period.start || period.date || record && (record.periodSort || record.importedAt || record.updatedAt));
  }
  function metricById(id) { return (base.METRICS || []).find(metric => metric.id === id) || null; }

  function derivedKpiRows(record, resolve, type) {
    if (!record || !record.data) return [];
    const date = recordDate(record); if (!date) return [];
    const rows = [], sourceType = clean(type || record.datasetType).toLowerCase(), isReferral = /referral/.test(sourceType);
    const consumerMetric = metricById('consumer-appointment-rate'), wiperMetric = metricById('wiper-rate');
    for (const pack of base._test.extractRows(record.data)) {
      for (const row of pack.rows || []) {
        const repRaw = rowPick(row, ['Representative', 'Representative Name', 'Associate Name', 'Associate', 'Agent Name', 'AgentName', 'Agent', 'Employee', 'Rep', 'Rep Name', 'CSR', 'CSR Name', 'SSR', 'SSR Name', 'Name']);
        const coachRaw = rowPick(row, ['Job Coach', 'Coach Assigned', 'Coach', 'Sheet', 'Team']) || pack.sheet;
        const personId = repRaw ? resolve(repRaw) : resolve(coachRaw); if (!personId) continue;
        const role = repRaw ? 'representative' : 'coach';
        const consumerApps = rowNumber(row, ['Consumer Appointments', 'Consumer Appointment', 'Consumer Apps'], [/^Consumer[_\s-]*Appointments?$/i, /consumer.*appointments?/i]);
        const consumerOpps = rowNumber(row, ['Consumer Opportunities', 'Consumer Opportunity', 'Consumer Opps'], [/^Consumer[_\s-]*Opportunit/i, /consumer.*opportunit/i]);
        if (!isReferral && consumerMetric && Number.isFinite(consumerApps) && Number.isFinite(consumerOpps) && consumerOpps > 0) rows.push({ personId, role, metric: consumerMetric, value: consumerApps / consumerOpps, weight: consumerOpps, date, datasetType: type });
        const wiperCount = rowNumber(row, ['Wiper Count'], [/^Wiper[_\s-]*Count$/i, /wiper.*count/i, /^Wiper\s*Count$/i]);
        const wiperJobs = rowNumber(row, ['Wiper Jobs', 'Wiper Job'], [/^Wiper[_\s-]*Jobs?$/i, /wiper.*jobs?/i]);
        const wipersAccept = rowNumber(row, ['Wipers Accept', 'Wiper Accept', 'Wipers Accepted', 'Wiper Accepted'], [/wipers?[_\s-]*accept/i, /wipers? accept/i]);
        const wipersAsked = rowNumber(row, ['Wipers Asked', 'Wiper Asked'], [/wipers?[_\s-]*asked/i, /wipers? asked/i]);
        let wiperValue = NaN, wiperWeight = NaN;
        if (isReferral) {
          if (Number.isFinite(wipersAccept) && Number.isFinite(wipersAsked) && wipersAsked > 0) { wiperValue = wipersAccept / wipersAsked; wiperWeight = wipersAsked; }
          else if (Number.isFinite(wiperCount) && Number.isFinite(wiperJobs) && wiperJobs > 0) { wiperValue = wiperCount / wiperJobs; wiperWeight = wiperJobs; }
        } else {
          if (Number.isFinite(wiperCount) && Number.isFinite(wiperJobs) && wiperJobs > 0) { wiperValue = wiperCount / wiperJobs; wiperWeight = wiperJobs; }
          else if (Number.isFinite(wipersAccept) && Number.isFinite(wipersAsked) && wipersAsked > 0) { wiperValue = wipersAccept / wipersAsked; wiperWeight = wipersAsked; }
        }
        if (wiperMetric && Number.isFinite(wiperValue)) rows.push({ personId, role, metric: wiperMetric, value: wiperValue, weight: wiperWeight, date, datasetType: type });
      }
    }
    return rows;
  }

  function canonicalizePerformance(record, resolve, type) {
    const regular = base._test.canonicalizePerformance(record, resolve, type) || [], derived = derivedKpiRows(record, resolve, type);
    if (!derived.length) return regular;
    const derivedKeys = new Set(derived.map(row => `${row.personId}|${row.metric.id}`));
    return regular.filter(row => !derivedKeys.has(`${row.personId}|${row.metric.id}`)).concat(derived);
  }
  function topicMatchesMetric(topic, metric) { return Boolean(metric && metric.topic && metric.topic.test(clean(topic))); }

  function metricSeries(context) {
    if (!context || typeof context !== 'object') return new Map();
    if (seriesCache.has(context)) return seriesCache.get(context);
    const grouped = new Map();
    for (const row of context.performance || []) {
      if (row.role !== 'representative' || !row.metric) continue;
      const key = `${row.personId}|${row.metric.id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    for (const rows of grouped.values()) rows.sort((left, right) => left.date - right.date);
    seriesCache.set(context, grouped); return grouped;
  }

  function metricCoverage(context, personId, metricId) {
    const series = metricSeries(context), rows = series.get(`${personId}|${metricId}`) || [], available = new Set();
    for (const [key, points] of series) {
      if (!key.endsWith(`|${metricId}`)) continue;
      for (const point of points) if (point.date instanceof Date) available.add(point.date.toISOString().slice(0, 10));
    }
    const measured = new Set(rows.filter(row => row.date instanceof Date).map(row => row.date.toISOString().slice(0, 10))).size;
    const expected = available.size, rate = expected ? Math.min(1, measured / expected) : measured ? 1 : 0;
    const minimum = /^(qa-score|call-quality)$/.test(metricId) ? qualityCoverageThreshold() : coverageThreshold();
    return { measured, available: expected, rate, minimum, eligible: expected > 0 && rate + 1e-9 >= minimum };
  }

  function matchingCoaching(context, personId, metric, days) {
    const cutoff = (context.asOf instanceof Date ? context.asOf.getTime() : Date.now()) - (days || 90) * DAY;
    return (context.coaching || []).filter(event => event.representativeId === personId && event.date instanceof Date && event.date.getTime() >= cutoff && (event.topics || []).some(topic => topicMatchesMetric(topic, metric))).sort((left, right) => right.date - left.date);
  }

  function buildResolvedOpportunities(context) {
    const resolved = [];
    for (const [key, rows] of metricSeries(context)) {
      if (rows.length < 3) continue;
      const personId = key.split('|')[0], person = context.byId && context.byId.get(personId); if (!person) continue;
      const metric = rows[rows.length - 1].metric; if (!metricCoverage(context, personId, metric.id).eligible) continue;
      const coachings = matchingCoaching(context, personId, metric, 90), latestCoaching = coachings[0]; if (!latestCoaching) continue;
      const beforeRows = rows.filter(row => row.date < latestCoaching.date).slice(-3), afterRows = rows.filter(row => row.date > latestCoaching.date);
      if (!beforeRows.length || afterRows.length < 2) continue;
      const before = mean(beforeRows.map(row => row.value)), lastTwo = afterRows.slice(-2), after = mean(lastTwo.map(row => row.value)), outcome = base._test.classifyOutcome(before, after, metric);
      if (outcome.status !== 'improved') continue;
      const orientation = metric.higher === false ? -1 : 1, sustained = lastTwo.every(row => (row.value - before) * orientation >= outcome.threshold / 2); if (!sustained) continue;
      const coachId = person.currentCoachId || latestCoaching.coachId || '', coach = context.byId && context.byId.get(coachId);
      resolved.push({ id: `perf:${personId}:${metric.id}`, personId, coachId, personName: person.displayName || latestCoaching.representative || '', coachName: coach && coach.displayName || latestCoaching.coach || '', topic: metric.name, metric: metric.name, metricId: metric.id, openedAt: latestCoaching.date, ageDays: Math.round(daysSince(latestCoaching.date)), status: 'resolved', severity: 0, confidence: afterRows.length >= 3 ? 'strong' : 'moderate', recurrenceCount: Math.max(0, coachings.length - 1), lastCoachedAt: latestCoaching.date, evidence: { current: rows[rows.length - 1].value, recentAverage: after, previousAverage: before, points: rows.length, outcomeChange: outcome.delta }, attentionReasons: [`${metric.name} has remained improved across at least two measured periods after coaching.`] });
    }
    return resolved;
  }

  function scopedRepresentative(context, personId) {
    const person = context.byId && context.byId.get(personId);
    return Boolean(person && person.role === 'representative' && base._test.personInScope(person, context.scope, context.byId));
  }
  function statsCacheFor(context) { let cache = recentStatsCache.get(context); if (!cache) { cache = new Map(); recentStatsCache.set(context, cache); } return cache; }

  function recentMetricStats(context, metricId, limit) {
    const key = `${metricId}|${Math.max(1, limit || 4)}|${Math.round(coverageThreshold() * 1000)}|${Math.round(qualityCoverageThreshold() * 1000)}`, cache = statsCacheFor(context); if (cache.has(key)) return cache.get(key);
    const grouped = new Map();
    for (const row of context.performance || []) {
      if (row.role !== 'representative' || !row.metric || row.metric.id !== metricId || !Number.isFinite(row.value)) continue;
      if (!grouped.has(row.personId)) grouped.set(row.personId, []); grouped.get(row.personId).push(row);
    }
    const stats = new Map();
    for (const [personId, rows] of grouped) {
      const coverage = metricCoverage(context, personId, metricId); if (!coverage.eligible) continue;
      rows.sort((left, right) => left.date - right.date); const chosen = rows.slice(-Math.max(1, limit || 4)), weighted = chosen.filter(row => Number.isFinite(row.weight) && row.weight > 0);
      if (weighted.length) { const weight = weighted.reduce((sum, row) => sum + row.weight, 0); stats.set(personId, { value: weight ? weighted.reduce((sum, row) => sum + row.value * row.weight, 0) / weight : NaN, weight, rows: chosen, coverage }); }
      else { const values = chosen.map(row => row.value).filter(Number.isFinite); if (values.length) stats.set(personId, { value: mean(values), weight: values.length, rows: chosen, coverage }); }
    }
    cache.set(key, stats); return stats;
  }

  function globalRanking(context, metricId) {
    const stats = recentMetricStats(context, metricId, 4);
    const ordered = Array.from(stats.entries()).filter(([, row]) => Number.isFinite(row.value)).sort((left, right) => right[1].value - left[1].value || clean((context.byId.get(left[0]) || {}).displayName).localeCompare(clean((context.byId.get(right[0]) || {}).displayName)));
    return ordered.map(([personId, row], index) => ({ personId, personName: clean((context.byId.get(personId) || {}).displayName) || personId, value: row.value, weight: row.weight, coverage: row.coverage, rows: row.rows, rank: index + 1, total: ordered.length }));
  }

  function rateDrivers(context, metricId, label) {
    const stats = recentMetricStats(context, metricId, 4), scoped = Array.from(stats.entries()).filter(([personId, row]) => scopedRepresentative(context, personId) && Number.isFinite(row.value) && row.weight > 0), totalWeight = scoped.reduce((sum, [, row]) => sum + row.weight, 0); if (!totalWeight) return [];
    const teamValue = scoped.reduce((sum, [, row]) => sum + row.value * row.weight, 0) / totalWeight, ranks = new Map(globalRanking(context, metricId).map(row => [row.personId, row]));
    return scoped.map(([personId, row]) => {
      const drag = Math.max(0, teamValue - row.value) * row.weight / totalWeight; if (!(drag > 0)) return null;
      const person = context.byId.get(personId), rank = ranks.get(personId), difference = teamValue - row.value;
      return { id: `impact:${metricId}:${personId}`, kind: 'team-driver', personId, personName: person && person.displayName || personId, coachId: person && person.currentCoachId || '', topic: `${label}${rank ? ` · #${rank.rank}/${rank.total}` : ''}`, metric: label, metricId, openedAt: context.asOf instanceof Date ? new Date(context.asOf) : new Date(), status: 'open', severity: Math.round(Math.min(99, 62 + Math.min(24, difference / .05 * 18) + Math.min(13, row.weight / totalWeight * 100))), impactScore: drag, attentionReasons: [`Estimated team drag: ${(drag * 100).toFixed(2)} percentage points. Rep ${(row.value * 100).toFixed(1)}% vs team ${(teamValue * 100).toFixed(1)}%, weighted by ${Math.round(row.weight)} opportunities${rank ? ` · global rank #${rank.rank}/${rank.total}` : ''}.`], evidence: { current: row.value, teamValue, weight: row.weight, teamWeight: totalWeight, teamImpact: drag, globalRank: rank && rank.rank, globalTotal: rank && rank.total, coverage: row.coverage } };
    }).filter(Boolean).sort((left, right) => right.impactScore - left.impactScore);
  }

  function qaDrivers(context) {
    const grouped = new Map(), cutoff = (context.asOf instanceof Date ? context.asOf.getTime() : Date.now()) - 30 * DAY;
    for (const row of context.qa || []) { if (!row.representativeId || !Number.isFinite(row.score) || !(row.date instanceof Date) || row.date.getTime() < cutoff || !scopedRepresentative(context, row.representativeId)) continue; if (!grouped.has(row.representativeId)) grouped.set(row.representativeId, []); grouped.get(row.representativeId).push(row.score); }
    const stats = Array.from(grouped.entries()).map(([personId, scores]) => ({ personId, value: mean(scores), weight: scores.length })).filter(row => Number.isFinite(row.value)), totalWeight = stats.reduce((sum, row) => sum + row.weight, 0); if (!totalWeight) return [];
    const teamValue = stats.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
    return stats.map(row => { const drag = Math.max(0, teamValue - row.value) * row.weight / totalWeight; if (!(drag > 0)) return null; const person = context.byId.get(row.personId), difference = teamValue - row.value; return { id: `impact:qa-score:${row.personId}`, kind: 'team-driver', personId: row.personId, personName: person && person.displayName || row.personId, coachId: person && person.currentCoachId || '', topic: 'Call Quality / QA', metric: 'Call Quality / QA', metricId: 'qa-score', openedAt: context.asOf instanceof Date ? new Date(context.asOf) : new Date(calculationNow()), status: 'open', severity: Math.round(Math.min(99, 62 + Math.min(25, difference / .05 * 18) + Math.min(12, row.weight / totalWeight * 100))), impactScore: drag, attentionReasons: [`Estimated team QA drag: ${(drag * 100).toFixed(2)} percentage points. Rep ${(row.value * 100).toFixed(1)}% vs team ${(teamValue * 100).toFixed(1)}% across ${row.weight} recent QA evaluation${row.weight === 1 ? '' : 's'}.`], evidence: { current: row.value, teamValue, weight: row.weight, teamWeight: totalWeight, teamImpact: drag } }; }).filter(Boolean).sort((left, right) => right.impactScore - left.impactScore);
  }

  function serveTimeDrivers(context) {
    const grouped = new Map(), cutoff = (context.asOf instanceof Date ? context.asOf.getTime() : Date.now()) - 45 * DAY;
    for (const row of context.checklist || []) { if (!row.representativeId || !Number.isFinite(row.days) || !(row.created instanceof Date) || row.created.getTime() < cutoff || !scopedRepresentative(context, row.representativeId)) continue; if (!grouped.has(row.representativeId)) grouped.set(row.representativeId, []); grouped.get(row.representativeId).push(row.days); }
    const stats = Array.from(grouped.entries()).map(([personId, values]) => ({ personId, value: mean(values), weight: values.length })).filter(row => Number.isFinite(row.value)), totalWeight = stats.reduce((sum, row) => sum + row.weight, 0); if (!totalWeight) return [];
    const teamValue = stats.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
    return stats.map(row => { const drag = Math.max(0, row.value - teamValue) * row.weight / totalWeight; if (!(drag > 0)) return null; const person = context.byId.get(row.personId), difference = row.value - teamValue; return { id: `impact:checklist-support:${row.personId}`, kind: 'team-driver', personId: row.personId, personName: person && person.displayName || row.personId, coachId: person && person.currentCoachId || '', topic: 'Average Time to Serve', metric: 'Average Time to Serve', metricId: 'checklist-support', openedAt: context.asOf instanceof Date ? new Date(context.asOf) : new Date(calculationNow()), status: 'open', severity: Math.round(Math.min(99, 62 + Math.min(25, difference / 3 * 18) + Math.min(12, row.weight / totalWeight * 100))), impactScore: drag / 10, attentionReasons: [`Estimated contribution to team serve-time average: +${drag.toFixed(2)} days. Rep average ${row.value.toFixed(1)} days vs team ${teamValue.toFixed(1)} days across ${row.weight} recently served checklist item${row.weight === 1 ? '' : 's'}.`], evidence: { current: row.value, teamValue, weight: row.weight, teamWeight: totalWeight, teamImpactDays: drag } }; }).filter(Boolean).sort((left, right) => right.impactScore - left.impactScore);
  }

  function balancedPriorityDrivers(context) {
    const groups = [rateDrivers(context, 'consumer-appointment-rate', 'Consumer Appointment Rate'), rateDrivers(context, 'wiper-rate', 'Wiper Rate'), qaDrivers(context), serveTimeDrivers(context)], output = [];
    for (let depth = 0; depth < 3; depth += 1) for (const group of groups) if (group[depth]) output.push(group[depth]);
    return output.slice(0, 12);
  }

  function classifyCoachingBalance(event) {
    const text = clean([...(event.topics || []), event.description || ''].join(' '));
    if (/recognition|positive|praise|compliment|great job|good job|strength|success|celebrat|\bwin\b/i.test(text)) return 'recognition';
    if (/appointment|wiper|vaps|quality|afterpay|save.*sale|insurance|behavior|correct|performance|opportunit|improv|\baht\b|handle time|coaching/i.test(text)) return 'development';
    return 'uncategorized';
  }
  function coachingBalance(context) {
    const grouped = new Map();
    for (const event of context.coaching || []) {
      if (!(event.date instanceof Date) || daysSince(event.date) > 30) continue;
      const key = event.coachId || clean(event.coach).toLowerCase(); if (!key) continue;
      const coach = context.byId && context.byId.get(event.coachId);
      if (!grouped.has(key)) grouped.set(key, { coachId: event.coachId || '', coachName: coach && coach.displayName || event.coach || 'Coach', total: 0, development: 0, recognition: 0, uncategorized: 0 });
      const row = grouped.get(key), category = classifyCoachingBalance(event); row.total += 1; row[category] += 1;
    }
    return Array.from(grouped.values()).map(row => { const categorized = row.development + row.recognition; return { ...row, recognitionRate: categorized ? row.recognition / categorized : NaN }; }).sort((left, right) => right.total - left.total || left.coachName.localeCompare(right.coachName));
  }
  function coachingExperts(effectiveness) {
    const bestByTopic = new Map();
    for (const row of effectiveness || []) { if (row.total < 3 || !Number.isFinite(row.successRate) || row.successRate < 0.6) continue; const current = bestByTopic.get(row.topic); if (!current || row.successRate > current.successRate || (row.successRate === current.successRate && row.total > current.total)) bestByTopic.set(row.topic, row); }
    return Array.from(bestByTopic.values()).sort((left, right) => right.successRate - left.successRate || right.total - left.total);
  }
  function withAge(item) { return !item || !item.openedAt ? item : { ...item, ageDays: Math.round(daysSince(item.openedAt)) }; }
  function seriesPoints(context, personId, metricId) { return (metricSeries(context).get(`${personId}|${metricId}`) || []).slice(-8).map(row => ({ value: row.value, date: row.date })); }
  function topCoachingTypes(events) {
    const grouped = new Map();
    for (const event of events || []) for (const topic of event.topics || []) { const key = clean(topic); if (key) grouped.set(key, (grouped.get(key) || 0) + 1); }
    const rows = Array.from(grouped, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count), top = rows.slice(0, 5), other = rows.slice(5).reduce((sum, row) => sum + row.count, 0); if (other) top.push({ name: 'Other', count: other }); return top;
  }
  function coachingEventInScope(context, event) {
    const coach = event.coachId && context.byId && context.byId.get(event.coachId), rep = event.representativeId && context.byId && context.byId.get(event.representativeId);
    return Boolean((coach && base._test.personInScope(coach, context.scope, context.byId)) || (rep && base._test.personInScope(rep, context.scope, context.byId)));
  }
  function coachingOverview(context) { const recent = (context.coaching || []).filter(event => event.date instanceof Date && daysSince(event.date) <= 30 && coachingEventInScope(context, event)); return { total: recent.length, averagePerDay: recent.length / 30, topSix: topCoachingTypes(recent) }; }

  function augmentSummary(summary) {
    if (!summary || !summary.context) return summary;
    if (augmentedCache.has(summary)) return augmentedCache.get(summary);
    const originalOpportunities = (summary.opportunities || []).map(withAge), priorityDrivers = balancedPriorityDrivers(summary.context), driverKeys = new Set(priorityDrivers.map(item => `${item.personId}|${item.metricId}`));
    const extraOpportunities = originalOpportunities.filter(item => !driverKeys.has(`${item.personId}|${item.metricId}`)).sort((left, right) => (right.severity || 0) - (left.severity || 0)).slice(0, 4), opportunities = [...priorityDrivers, ...extraOpportunities];
    const activeIds = new Set(originalOpportunities.map(item => item.id)), resolved = buildResolvedOpportunities(summary.context).filter(item => !activeIds.has(item.id)), recognition = (summary.recognition || []).map(item => ({ kind: item.kind || 'momentum', ...item })), recognitionKeys = new Set(recognition.map(item => `${item.personId}|${item.metricId}`));
    for (const item of resolved) { const key = `${item.personId}|${item.metricId}`; if (recognitionKeys.has(key)) continue; recognition.push({ kind: 'resolved', personId: item.personId, personName: item.personName, coachId: item.coachId, coachName: item.coachName, topic: item.topic, metric: item.metric, metricId: item.metricId, change: item.evidence.outcomeChange, orientedChange: Math.abs(item.evidence.outcomeChange || 0), current: item.evidence.current, message: `${item.topic} has remained improved after coaching and appears resolved.` }); }
    const addSpark = item => ({ ...item, coverage: item.metricId && item.personId ? metricCoverage(summary.context, item.personId, item.metricId) : null, sparkline: item.metricId && item.personId ? seriesPoints(summary.context, item.personId, item.metricId) : [] });
    const effectiveness = summary.coachEffectiveness || [], globalRankings = { consumerAppointmentRate: globalRanking(summary.context, 'consumer-appointment-rate'), wiperRate: globalRanking(summary.context, 'wiper-rate') };
    const attention = Alignment && Alignment.attentionFromSummary ? Alignment.attentionFromSummary({ ...summary, opportunities: originalOpportunities }) : [];
    const scopedReps = (summary.context.people || []).filter(person => person && person.role === 'representative' && base._test.personInScope(person, summary.context.scope, summary.context.byId));
    const scopedIds = new Set(scopedReps.map(person => person.personId)), scopedCoachIds = new Set(scopedReps.map(person => person.currentCoachId).filter(Boolean));
    const scopedCoaching = (summary.context.coaching || []).filter(event => scopedIds.has(event.representativeId) || scopedCoachIds.has(event.coachId));
    const alignment = Alignment && Alignment.buildAlignment ? Alignment.buildAlignment({ attention, coaching: scopedCoaching, roster: scopedReps, asOf: summary.context.asOf }) : null;
    const coachingActivity = Alignment && Alignment.coachingActivity ? Alignment.coachingActivity({ coaching: scopedCoaching, roster: scopedReps, asOf: summary.context.asOf }) : null;
    const augmented = { ...summary, opportunities: opportunities.map(addSpark), allOpportunities: originalOpportunities.map(addSpark), priorityDrivers: priorityDrivers.map(addSpark), globalRankings, needCoaching: opportunities.filter(item => item.status === 'open' && item.metricId !== 'checklist-support').map(addSpark), followUp: originalOpportunities.filter(item => item.status === 'coached-watching' || item.status === 'recurred').map(addSpark), supportDelays: opportunities.filter(item => item.metricId === 'checklist-support').map(addSpark), resolved: resolved.map(addSpark), lifecycle: [...originalOpportunities, ...resolved].map(addSpark), recognition: recognition.map(addSpark).sort((left, right) => (right.orientedChange || 0) - (left.orientedChange || 0)).slice(0, 30), coachingBalance: coachingBalance(summary.context), coachingExperts: coachingExperts(effectiveness), coachingOverview: coachingOverview(summary.context), coverageThreshold: coverageThreshold(), qualityCoverageThreshold: qualityCoverageThreshold(), attention, alignment, coachingActivity };
    root.__CoachToolsCommandCenterPriority = { priorityDrivers: augmented.priorityDrivers, globalRankings }; root.__CoachToolsCommandCenterSummary = augmented; augmentedCache.set(summary, augmented); return augmented;
  }

  function sparklineSvg(points, good) {
    const values = (points || []).map(point => Number(point && point.value)).filter(Number.isFinite).slice(-8); if (values.length < 2) return '';
    const min = Math.min(...values), max = Math.max(...values), span = Math.max(1e-9, max - min), coords = values.map((value, index) => `${(index / Math.max(1, values.length - 1) * 78 + 1).toFixed(1)},${(19 - (value - min) / span * 16).toFixed(1)}`).join(' ');
    return `<svg class="ccSpark ${good ? 'good' : 'bad'}" viewBox="0 0 80 22" aria-hidden="true"><polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>`;
  }
  function donutMarkup(rows) {
    const items = (rows || []).filter(row => row.count > 0), total = items.reduce((sum, row) => sum + row.count, 0); if (!total) return '<div class="empty">No documented coaching topics in the last 30 days.</div>';
    let cursor = 0; const slices = items.map((row, index) => { const start = cursor / total * 100; cursor += row.count; const end = cursor / total * 100; return `var(--ccPie${index + 1}) ${start}% ${end}%`; }).join(',');
    return `<div class="ccPieWrap"><div class="ccDonut" style="background:conic-gradient(${slices})"><div>${total}<small>coachings</small></div></div><div class="ccPieLegend">${items.map((row, index) => `<div><i style="background:var(--ccPie${index + 1})"></i><span>${clean(row.name)}</span><b>${Math.round(row.count / total * 100)}%</b><small>${row.count}</small></div>`).join('')}</div></div>`;
  }

  function enhanceCommandCenterDom() {
    if (typeof document === 'undefined' || clean(document.querySelector('meta[name="coachtools-id"]')?.content) !== 'coaching-command-center') return;
    if (!document.getElementById('command-center-priority-style')) {
      const style = document.createElement('style'); style.id = 'command-center-priority-style';
      style.textContent = `:root{--ccPie1:#247bb5;--ccPie2:#50b6d9;--ccPie3:#13805b;--ccPie4:#a96500;--ccPie5:#7b65b5;--ccPie6:#aab7c2}.globalKpiRank{display:block;margin-top:2px;color:#247bb5;font-size:7px;font-weight:900;white-space:nowrap}.priorityImpactHint{color:#36566d;font-weight:850}.ccCoverageControl{display:flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:6px 7px;color:var(--muted);font-size:9px;font-weight:850;white-space:nowrap}.ccCoverageControl input{width:43px;border:0;outline:none;text-align:right;font-weight:900;color:var(--ink);background:transparent}.ccSpark{width:80px;height:22px;display:block;margin-top:4px}.ccSpark.good{color:var(--green)}.ccSpark.bad{color:var(--red)}.ccPieWrap{display:grid;grid-template-columns:150px minmax(0,1fr);gap:15px;align-items:center}.ccDonut{width:138px;height:138px;border-radius:50%;display:grid;place-items:center}.ccDonut>div{width:80px;height:80px;border-radius:50%;background:#fff;display:grid;place-items:center;text-align:center;font-size:19px;font-weight:950}.ccDonut small{display:block;color:var(--muted);font-size:7px;text-transform:uppercase}.ccPieLegend{display:grid;gap:5px}.ccPieLegend>div{display:grid;grid-template-columns:9px minmax(0,1fr) 34px 25px;gap:6px;align-items:center;font-size:9px}.ccPieLegend i{width:8px;height:8px;border-radius:2px}.ccPieLegend b,.ccPieLegend small{text-align:right}.ccPieLegend small{color:var(--muted)}.ccCoachMixPanel{margin-bottom:10px}.ccTrendTag{display:flex;align-items:center;gap:7px;margin-top:4px;color:var(--muted);font-size:8px}@media(max-width:820px){.ccCoverageControl{order:3}.ccPieWrap{grid-template-columns:1fr}.ccDonut{margin:auto}}`;
      document.head.appendChild(style);
    }
    const scopeBar = document.querySelector('.scopeBar');
    if (scopeBar && !document.getElementById('ccMinKpiCoverage')) {
      const label = document.createElement('label'); label.className = 'ccCoverageControl'; label.innerHTML = `Min KPI Coverage <input id="ccMinKpiCoverage" type="number" min="0" max="100" step="5" value="${Math.round(coverageThreshold() * 100)}"><span>%</span>`; scopeBar.insertBefore(label, document.getElementById('runBtn'));
      label.querySelector('input').addEventListener('change', event => { const threshold = setCoverageThreshold(Number(event.target.value) / 100); event.target.value = String(Math.round(threshold * 100)); recentStatsCache.delete(root.__CoachToolsCommandCenterSummary?.context); const run = document.getElementById('runBtn'); if (run && !run.disabled && document.getElementById('scopeSelect')?.value) run.click(); });
    }
    if (scopeBar && !document.getElementById('ccMinQualityCoverage')) {
      const label = document.createElement('label'); label.className = 'ccCoverageControl'; label.innerHTML = `Min Quality Coverage <input id="ccMinQualityCoverage" type="number" min="0" max="100" step="5" value="${Math.round(qualityCoverageThreshold() * 100)}"><span>%</span>`; scopeBar.insertBefore(label, document.getElementById('runBtn'));
      label.querySelector('input').addEventListener('change', event => { const threshold = setQualityCoverageThreshold(Number(event.target.value) / 100); event.target.value = String(Math.round(threshold * 100)); const run = document.getElementById('runBtn'); if (run && !run.disabled && document.getElementById('scopeSelect')?.value) run.click(); });
    }
    const content = document.getElementById('content'); if (!content) return;
    for (const heading of content.querySelectorAll('.panelHead h2')) if (clean(heading.textContent) === 'Highest-priority coaching work') { heading.textContent = 'Priority impact ranking'; const copy = heading.parentElement && heading.parentElement.querySelector('p'); if (copy) copy.textContent = `Balanced by estimated impact on Consumer Appointment Rate, Wiper Rate, Call Quality, and Average Time to Serve · ≥${Math.round(coverageThreshold() * 100)}% KPI coverage.`; }
    const summary = root.__CoachToolsCommandCenterSummary, priority = root.__CoachToolsCommandCenterPriority;
    if (priority && priority.globalRankings) {
      const cash = new Map((priority.globalRankings.consumerAppointmentRate || []).map(row => [clean(row.personName).toLowerCase(), row])), wipers = new Map((priority.globalRankings.wiperRate || []).map(row => [clean(row.personName).toLowerCase(), row]));
      const paintWeightedKpi = (cell, rank) => { if (!cell || !rank || !Number.isFinite(rank.value) || cell.querySelector('.globalKpiRank')) return; cell.innerHTML = `${(rank.value * 100).toFixed(1)}%<small class="globalKpiRank">Global #${rank.rank}/${rank.total} · ${rank.coverage ? `${rank.coverage.measured}/${rank.coverage.available} wks` : 'weighted'}</small>`; };
      for (const table of content.querySelectorAll('table.table')) { const headers = Array.from(table.querySelectorAll('thead th')).map(th => clean(th.textContent)), cashIndex = headers.indexOf('Cash AR'), wiperIndex = headers.indexOf('Wipers'); if (cashIndex < 0 && wiperIndex < 0) continue; for (const row of table.querySelectorAll('tbody tr')) { const cells = row.cells; if (!cells || !cells.length) continue; const key = clean(cells[0].textContent).toLowerCase(); if (cashIndex >= 0) paintWeightedKpi(cells[cashIndex], cash.get(key)); if (wiperIndex >= 0) paintWeightedKpi(cells[wiperIndex], wipers.get(key)); } }
    }
    if (!summary) return;
    const summaryGrid = content.querySelector('.summary');
    if (summaryGrid && !summaryGrid.querySelector('[data-cc-coachings-day]')) { const card = document.createElement('div'); card.className = 'metricCard'; card.dataset.ccCoachingsDay = '1'; card.innerHTML = `<small>Coachings / day</small><strong>${summary.coachingOverview.averagePerDay.toFixed(1)}</strong><span>${summary.coachingOverview.total} documented · last 30 days</span>`; summaryGrid.appendChild(card); }
    if (!content.querySelector('[data-cc-coaching-mix]') && summary.coachingOverview.topSix.length) { const panel = document.createElement('section'); panel.className = 'panel ccCoachMixPanel'; panel.dataset.ccCoachingMix = '1'; panel.innerHTML = `<div class="panelHead"><div><h2>Most common coaching types</h2><p>Top 5 documented topics plus everything else grouped as Other.</p></div><span class="meta">${summary.coachingOverview.total} coachings · ${summary.coachingOverview.averagePerDay.toFixed(1)}/day</span></div><div class="panelBody">${donutMarkup(summary.coachingOverview.topSix)}</div>`; const firstPanel = content.querySelector('.panel'); if (firstPanel) firstPanel.insertAdjacentElement('beforebegin', panel); else content.appendChild(panel); }
    const attachTrends = (selector, items, good) => { for (const node of content.querySelectorAll(selector)) { if (node.querySelector('.ccSpark')) continue; const text = clean(node.textContent).toLowerCase(), match = (items || []).find(item => text.includes(clean(item.personName).toLowerCase()) && (!item.topic || text.includes(clean(item.topic).toLowerCase()) || text.includes(clean(item.metric).toLowerCase()))); if (!match || !(match.sparkline || []).length) continue; const tag = document.createElement('div'); tag.className = 'ccTrendTag'; tag.innerHTML = `${sparklineSvg(match.sparkline, good)}<span>${match.coverage && match.coverage.available ? `${match.coverage.measured}/${match.coverage.available} KPI weeks` : good ? 'recent improvement' : 'recent trend'}</span>`; node.firstElementChild?.appendChild(tag); } };
    attachTrends('.recognition .item', summary.recognition, true); attachTrends('.list .item', summary.opportunities, false);
  }

  function installCommandCenterEnhancer() {
    if (typeof document === 'undefined' || clean(document.querySelector('meta[name="coachtools-id"]')?.content) !== 'coaching-command-center') return;
    let scheduled = false; const run = () => { if (scheduled) return; scheduled = true; root.requestAnimationFrame(() => { scheduled = false; try { enhanceCommandCenterDom(); } catch (_) {} }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
    const observer = new MutationObserver(run), start = () => { const content = document.getElementById('content'); if (content) observer.observe(content, { childList: true, subtree: true }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }

  const baseBuildSummary = base.buildSummary.bind(base), baseCommandCenter = base.commandCenter.bind(base);
  function buildSummary(context) { return augmentSummary(baseBuildSummary(context)); }
  async function commandCenter(options) { return augmentSummary(await baseCommandCenter(options)); }
  function personStory(context, personId, precomputed) { const summary = precomputed && precomputed.resolved ? precomputed : augmentSummary(precomputed || baseBuildSummary(context)), active = summary.opportunities.filter(item => item.personId === personId), resolved = summary.resolved.filter(item => item.personId === personId); if (!active.length && resolved.length) { const person = context.byId && context.byId.get(personId); return `${person && person.displayName || 'This representative'}'s recent ${resolved[0].topic} coaching loop appears resolved across multiple measured periods. ${resolved[0].attentionReasons[0]}`; } return base.personStory(context, personId, summary); }

  async function insightForApp(appId, options) {
    const summary = await commandCenter(), personId = options && options.personId;
    if (appId === 'people-profiles' && personId) { const relevant = summary.opportunities.filter(item => item.personId === personId), positive = summary.recognition.filter(item => item.personId === personId); if (!relevant.length && !positive.length) return null; const top = relevant[0]; return { tone: top ? 'attention' : 'positive', title: top ? `${top.topic} needs attention` : 'Positive momentum', summary: top ? top.attentionReasons[0] || 'A coaching follow-up is worth reviewing.' : positive[0].message, detailTitle: 'Coaching Intelligence', story: personStory(summary.context, personId, summary), items: top ? relevant.slice(0, 5) : summary.resolved.filter(item => item.personId === personId).slice(0, 5) }; }
    if (appId === 'coaching-gaps') { const active = summary.opportunities.filter(item => item.metricId !== 'checklist-support'), recentResolved = summary.resolved.slice(0, 5); if (!active.length && !recentResolved.length) return null; const recurred = active.filter(item => item.status === 'recurred').length; return { tone: recurred ? 'attention' : active.length ? 'watch' : 'positive', title: active.length ? `${active.length} active coaching opportunit${active.length === 1 ? 'y' : 'ies'}` : `${recentResolved.length} recently resolved`, summary: recurred ? `${recurred} appear to have recurred after prior coaching.` : recentResolved.length ? `${recentResolved.length} coaching loop${recentResolved.length === 1 ? '' : 's'} show sustained improvement.` : 'Open and follow-up coaching needs are available.', detailTitle: 'Opportunity Lifecycle', items: [...active.slice(0, 10), ...recentResolved] }; }
    if (appId === 'kpi-impact') { const out = summary.performanceOutcomes; if (out.total < 2) return null; return { tone: out.declined > out.improved ? 'watch' : 'info', title: `${out.total} measurable coaching outcomes`, summary: `${out.improved} improved · ${out.neutral} neutral · ${out.declined} declined`, detailTitle: 'Coaching Outcomes', outcomes: out.rows.slice().sort((left, right) => right.date - left.date).slice(0, 15), coachEffectiveness: summary.coachEffectiveness.filter(row => row.rows.some(item => item.kind === 'performance')).slice(0, 10), experts: summary.coachingExperts.filter(row => row.rows.some(item => item.kind === 'performance')).slice(0, 6) }; }
    if (appId === 'qa-scores') { const out = summary.qaOutcomes; if (out.total < 2) return null; return { tone: out.declined > out.improved ? 'watch' : 'info', title: `${out.total} measurable QA coaching outcomes`, summary: `${out.improved} improved · ${out.neutral} neutral · ${out.declined} declined`, detailTitle: 'QA Coaching Outcomes', outcomes: out.rows.slice().sort((left, right) => right.date - left.date).slice(0, 15), coachEffectiveness: summary.coachEffectiveness.filter(row => row.rows.some(item => item.kind === 'qa')).slice(0, 10), experts: summary.coachingExperts.filter(row => row.rows.some(item => item.kind === 'qa')).slice(0, 6) }; }
    if (appId === 'coach-timeline') { const support = summary.support || []; if (!support.length) return null; const total = support.reduce((sum, row) => sum + row.total, 0), average = mean(support.map(row => row.averageDays).filter(Number.isFinite)), overThree = support.reduce((sum, row) => sum + row.overThreeDays, 0); return { tone: summary.supportDelays.length ? 'attention' : 'info', title: `Checklist support · ${total} items`, summary: `Avg time to serve ${base.formatDays(average)} · ${overThree} waiting > 3 days`, detailTitle: 'Checklist Support Load', support: support.slice(0, 15) }; }
    return null;
  }

  root.CoachToolsIntelligence = Object.freeze({ ...base, VERSION: '1.4.0', commandCenter, insightForApp, personStory, buildSummary, buildResolvedOpportunities, coachingBalance, coachingExperts, coverageThreshold, setCoverageThreshold, qualityCoverageThreshold, setQualityCoverageThreshold, metricCoverage, _test: Object.freeze({ ...base._test, canonicalizePerformance, derivedKpiRows, classifyCoachingBalance, metricCoverage, topCoachingTypes, recentMetricStats }) });
  installCommandCenterEnhancer();
})(typeof window !== 'undefined' ? window : globalThis);
