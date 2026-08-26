(function attachCoachToolsCoachingAlignment(root) {
  'use strict';

  const VERSION = '1.0.0';
  const DAY = 86400000;
  const DEFAULT_KPI_COVERAGE = 0.50;
  const DEFAULT_QUALITY_COVERAGE = 0.25;
  const KPI_COVERAGE_KEY = 'coachtools.minKpiCoverage.v1';
  const QUALITY_COVERAGE_KEY = 'coachtools.minQualityCoverage.v1';

  const CATEGORIES = Object.freeze([
    { id: 'cash-appointment', label: 'Cash Appointment', metricIds: ['cash-appointment-rate', 'consumer-appointment-rate', 'appointment-rate'], pattern: /consumer\s*appointment|cash\s*(?:appointment|appt|ar)|appointment\s*(?:rate|transition)|assumptive\s*ask|\bappointments?\b|\bappt\b|\bcash\b|scheduling/i },
    { id: 'call-quality', label: 'Call Quality', metricIds: ['qa-score', 'call-quality'], pattern: /call\s*quality|quality\s*(?:score|review|evaluation|eval)?|\bqa\b/i },
    { id: 'wipers', label: 'Wipers', metricIds: ['wiper-rate'], pattern: /\bwipers?\b|\bvaps?\b/i },
    { id: 'save-the-sale', label: 'Save the Sale', metricIds: ['save-the-sale'], pattern: /save\s*(?:the\s*)?sale/i },
    { id: 'afterpay', label: 'Afterpay', metricIds: ['afterpay'], pattern: /after\s*pay/i },
    { id: 'insurance-cash', label: 'Insurance Cash', metricIds: ['insurance-cash'], pattern: /insurance\s*cash/i },
    { id: 'solution-rate', label: 'Solution Rate', metricIds: ['solution-rate'], pattern: /solution\s*(?:rate|resolution)?/i },
    { id: 'aht', label: 'AHT / Handle Time', metricIds: ['aht'], pattern: /\baht\b|average\s*handle\s*time|handle\s*time/i }
  ]);

  const clean = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));
  const mean = values => {
    const valid = (values || []).filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
  };
  const asDate = value => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const stableCompare = (left, right) => clean(left).localeCompare(clean(right), 'en', { sensitivity: 'base' });

  function readThreshold(key, fallback, globalName) {
    if (Number.isFinite(root[globalName])) return clamp(root[globalName], 0, 1);
    try {
      const raw = root.localStorage && root.localStorage.getItem(key);
      const saved = raw == null || raw === '' ? NaN : Number(raw);
      if (Number.isFinite(saved) && saved >= 0 && saved <= 1) return saved;
    } catch (_) {}
    return fallback;
  }

  function writeThreshold(key, value, globalName) {
    const next = clamp(value, 0, 1);
    root[globalName] = next;
    try { if (root.localStorage) root.localStorage.setItem(key, String(next)); } catch (_) {}
    return next;
  }

  function kpiCoverageThreshold() { return readThreshold(KPI_COVERAGE_KEY, DEFAULT_KPI_COVERAGE, '__CoachToolsMinKpiCoverage'); }
  function qualityCoverageThreshold() { return readThreshold(QUALITY_COVERAGE_KEY, DEFAULT_QUALITY_COVERAGE, '__CoachToolsMinQualityCoverage'); }
  function setKpiCoverageThreshold(value) { return writeThreshold(KPI_COVERAGE_KEY, value, '__CoachToolsMinKpiCoverage'); }
  function setQualityCoverageThreshold(value) { return writeThreshold(QUALITY_COVERAGE_KEY, value, '__CoachToolsMinQualityCoverage'); }
  function coverageThresholdForMetric(metricId) { return /^(qa-score|call-quality)$/.test(clean(metricId)) ? qualityCoverageThreshold() : kpiCoverageThreshold(); }

  function categoryForMetric(metricId) {
    const id = clean(metricId);
    return CATEGORIES.find(category => category.metricIds.includes(id)) || null;
  }

  function categorizeTopic(value) {
    const originalText = clean(value);
    if (!originalText) return { id: 'other', label: 'Other', originalText };
    if (/insurance\s*cash/i.test(originalText)) return { id: 'insurance-cash', label: 'Insurance Cash', originalText };
    const category = CATEGORIES.find(item => item.pattern.test(originalText));
    return category ? { id: category.id, label: category.label, originalText } : { id: 'other', label: 'Other', originalText };
  }

  function categorizeEvent(event) {
    const originals = Array.from(new Set([...(event && event.topics || []), clean(event && event.description)].map(clean).filter(Boolean)));
    const categories = [];
    const seen = new Set();
    for (const original of originals) {
      const category = categorizeTopic(original);
      if (category.id === 'other' || seen.has(category.id)) continue;
      seen.add(category.id);
      categories.push(category);
    }
    return { ...(event || {}), originalTopics: originals, categories, categoryIds: categories.map(category => category.id) };
  }

  function topicMatchesCategory(value, categoryId) {
    const category = CATEGORIES.find(item => item.id === categoryId);
    return Boolean(category && category.pattern.test(clean(value)));
  }

  function maxDate(values, fallback) {
    let latest = asDate(fallback);
    for (const value of values || []) {
      const date = asDate(value);
      if (date && (!latest || date > latest)) latest = date;
    }
    return latest || new Date(0);
  }

  function reportingCutoff(source, fallback) {
    const dates = [];
    const add = value => { const date = asDate(value); if (date) dates.push(date); };
    if (source && source.asOf) add(source.asOf);
    for (const event of source && source.coaching || []) add(event.date);
    for (const row of source && source.qa || []) add(row.date);
    for (const row of source && source.performance || []) add(row.date);
    for (const profile of source && source.profiles || []) {
      for (const row of profile && profile.qa && profile.qa.rows || []) add(row.date);
      for (const event of profile && profile.coaching && profile.coaching.events || []) add(event.date);
      for (const detail of profile && profile.metricDetails || []) for (const point of detail.trend && detail.trend.points || []) add(point.sort || point.date || point.label);
    }
    return maxDate(dates, fallback);
  }

  function stableHash(value) {
    const input = clean(value);
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function recordIdentity(record) {
    if (!record) return '';
    const period = record.detectedPeriod || {};
    return [record.datasetType, record.datasetId || record.id, record.version, record.fingerprint, record.scopedFingerprint, record.periodSort, period.periodKey, period.start, period.end].map(clean).join(':');
  }

  function snapshotFingerprint(records, histories, identityVersion, extra) {
    const parts = [`identity:${Number(identityVersion) || 0}`];
    for (const type of Object.keys(records || {}).sort(stableCompare)) parts.push(`${type}:${recordIdentity(records[type])}`);
    for (const type of Object.keys(histories || {}).sort(stableCompare)) {
      const rows = Array.from(new Set((histories[type] || []).map(recordIdentity).filter(Boolean))).sort(stableCompare);
      parts.push(`${type}-history:${rows.join(',')}`);
    }
    if (extra) parts.push(`extra:${clean(extra)}`);
    return stableHash(parts.join('|'));
  }

  function currentVersionFingerprint(appData, identity, types) {
    const parts = [];
    for (const type of (types || []).slice().sort(stableCompare)) {
      let version = null;
      try { version = appData && appData.getVersion ? appData.getVersion(type) : null; } catch (_) {}
      parts.push(`${type}:${recordIdentity(version)}`);
    }
    let identityVersion = 0;
    try { identityVersion = identity && identity.getIdentityVersion ? identity.getIdentityVersion() : 0; } catch (_) {}
    parts.push(`identity:${Number(identityVersion) || 0}`);
    return { key: stableHash(parts.join('|')), identityVersion, parts };
  }

  function usableCurrentIdentity(person) {
    if (!person || !person.personId || !clean(person.displayName)) return false;
    if (person.active === false || person.current === false) return false;
    return !/inactive|historical|former|terminated/i.test(clean(person.status));
  }

  function currentRoster(people, coachId) {
    return (people || []).filter(person => person && person.role === 'representative' && person.currentCoachId === coachId && usableCurrentIdentity(person));
  }

  function eligibleCoachCohort(options) {
    const opts = options || {}, people = opts.people || [], wantedDepartment = clean(opts.department), wantedIds = opts.coachIds && new Set(opts.coachIds);
    const identities = people.filter(person => person && person.role === 'coach' && (!wantedDepartment || clean(person.department) === wantedDepartment) && (!wantedIds || wantedIds.has(person.personId)));
    const current = identities.filter(usableCurrentIdentity);
    const rosterFor = typeof opts.rosterForCoach === 'function' ? opts.rosterForCoach : coach => currentRoster(people, coach.personId);
    const withTeams = current.map(coach => ({ coach, roster: rosterFor(coach) || [] })).filter(row => row.roster.length > 0);
    const metricRows = withTeams.map(row => typeof opts.buildMetric === 'function' ? { ...row, ...opts.buildMetric(row.coach, row.roster) } : row).filter(row => typeof opts.hasMetric === 'function' ? opts.hasMetric(row) : true);
    const meetingCoverage = metricRows.filter(row => typeof opts.meetsCoverage === 'function' ? opts.meetsCoverage(row) : true);
    const meetingVolume = meetingCoverage.filter(row => typeof opts.meetsVolume === 'function' ? opts.meetsVolume(row) : true);
    return {
      rows: meetingVolume,
      diagnostics: {
        totalCoachIdentities: identities.length, currentCoaches: current.length, coachesWithCurrentTeams: withTeams.length,
        coachesMeetingCoverage: meetingCoverage.length, coachesMeetingVolume: meetingVolume.length, finalRankedCohort: meetingVolume.length,
        excludedForLowVolume: Math.max(0, meetingCoverage.length - meetingVolume.length),
        excludedForInsufficientCoverage: Math.max(0, metricRows.length - meetingCoverage.length)
      }
    };
  }

  function confidenceFor(metricId, sampleSize, volume) {
    const id = clean(metricId), samples = Math.max(0, Number(sampleSize) || 0), weight = Math.max(0, Number(volume) || 0);
    if (/^(qa-score|call-quality)$/.test(id)) return samples >= 6 ? 'High sample' : samples >= 3 ? 'Moderate sample' : 'Low sample';
    if (id === 'cash-appointment-rate' || id === 'consumer-appointment-rate' || id === 'appointment-rate') return weight >= 175 ? 'High sample' : weight > 100 ? 'Moderate sample' : 'Low sample';
    return samples >= 6 || weight >= 100 ? 'High sample' : samples >= 3 || weight >= 40 ? 'Moderate sample' : 'Low sample';
  }

  function priorForDetail(detail) {
    const trend = detail && detail.trend || {};
    if (Number.isFinite(trend.earlier)) return trend.earlier;
    const points = (trend.points || []).filter(point => Number.isFinite(point.value));
    if (points.length < 2) return NaN;
    const split = Math.max(1, Math.floor(points.length / 2));
    return mean(points.slice(0, split).map(point => point.value));
  }

  function latestRelatedCoaching(profile, categoryId, asOf) {
    const cutoff = asOf.getTime() - 365 * DAY;
    return (profile && profile.coaching && profile.coaching.events || [])
      .map(categorizeEvent)
      .filter(event => asDate(event.date) && asDate(event.date).getTime() <= asOf.getTime() && asDate(event.date).getTime() >= cutoff && event.categoryIds.includes(categoryId))
      .sort((left, right) => asDate(right.date) - asDate(left.date))[0] || null;
  }

  function qaEvidence(profile, asOf) {
    const rows = (profile && profile.qa && profile.qa.rows || []).filter(row => asDate(row.date) && Number.isFinite(row.score) && asDate(row.date) <= asOf).sort((left, right) => asDate(left.date) - asDate(right.date));
    const currentCutoff = asOf.getTime() - 30 * DAY, priorCutoff = asOf.getTime() - 60 * DAY;
    const currentRows = rows.filter(row => asDate(row.date).getTime() >= currentCutoff);
    const priorRows = rows.filter(row => asDate(row.date).getTime() >= priorCutoff && asDate(row.date).getTime() < currentCutoff);
    return { current: mean(currentRows.map(row => row.score)), prior: mean(priorRows.map(row => row.score)), evaluations: currentRows.length, rows: currentRows, priorRows, dataThrough: rows.length ? asDate(rows[rows.length - 1].date) : null };
  }

  function severityLabel(score) { return score >= 75 ? 'High Attention' : score >= 48 ? 'Moderate Attention' : 'Watch'; }

  function dedupeAttention(items) {
    const map = new Map();
    for (const item of items || []) {
      if (!item || !item.personId || !item.metricId) continue;
      const canonicalMetric = /^(call-quality|qa-score)$/.test(item.metricId) ? 'qa-score' : item.metricId;
      const key = `${item.personId}+${canonicalMetric}`;
      const next = { ...item, id: key, metricId: canonicalMetric };
      const prior = map.get(key);
      const nextDate = asDate(next.dataThrough), priorDate = prior && asDate(prior.dataThrough);
      if (!prior || (nextDate && (!priorDate || nextDate > priorDate)) || ((!nextDate && !priorDate || nextDate && priorDate && nextDate.getTime() === priorDate.getTime()) && (next.severity || 0) > (prior.severity || 0))) map.set(key, next);
    }
    return Array.from(map.values()).sort((left, right) => (right.severity || 0) - (left.severity || 0) || stableCompare(left.personName, right.personName) || stableCompare(left.metricId, right.metricId));
  }

  function attentionFromProfiles(profiles, options) {
    const list = profiles || [], asOf = reportingCutoff({ profiles: list, asOf: options && options.asOf }), rows = [];
    for (const profile of list) {
      if (!profile || !profile.person) continue;
      for (const detail of profile.metricDetails || []) {
        const category = categoryForMetric(detail.id);
        if (!category || !Number.isFinite(detail.value)) continue;
        const qa = detail.id === 'qa-score' ? qaEvidence(profile, asOf) : null;
        const current = qa && Number.isFinite(qa.current) ? qa.current : detail.value;
        const prior = qa ? qa.prior : priorForDetail(detail);
        const delta = Number.isFinite(prior) ? current - prior : NaN;
        const weak = Number.isFinite(detail.percentile) && detail.percentile < 40;
        const declining = detail.trend && detail.trend.status === 'declining';
        const belowQa = detail.id === 'qa-score' && Number.isFinite(current) && current < 0.85;
        if (!weak && !declining && !belowQa) continue;
        const last = latestRelatedCoaching(profile, category.id, asOf);
        const sampleSize = qa ? qa.evaluations : detail.coverage && detail.coverage.measured || detail.trend && detail.trend.points && detail.trend.points.length || 0;
        const coverage = detail.coverage || null;
        const severity = Math.round(clamp(35 + (weak ? (40 - detail.percentile) * 1.15 : 0) + (declining ? 18 : 0) + (belowQa ? Math.min(22, (0.85 - current) * 200) : 0), 1, 100));
        const reasons = [];
        if (belowQa) reasons.push(`QA is ${(current * 100).toFixed(1)}%, below the 85% target.`);
        if (weak) reasons.push(`${detail.name} is at the ${detail.percentile}th percentile.`);
        if (declining) reasons.push(`${detail.name} is declining across the selected window.`);
        rows.push({
          personId: profile.person.personId, personName: profile.person.displayName, coachId: profile.person.currentCoachId || '',
          metricId: detail.id, metricName: detail.name, categoryId: category.id, category: category.label,
          current, prior, delta, percentile: detail.percentile, rank: detail.rank || null, sampleSize,
          volume: Number(detail.weight) || 0, coverage, lastCoachedAt: last && asDate(last.date),
          severity, severityLabel: severityLabel(severity), reason: reasons.join(' '), reasons,
          confidence: confidenceFor(detail.id, sampleSize, Number(detail.weight) || 0), dataThrough: qa && qa.dataThrough || asOf
        });
      }
    }
    return dedupeAttention(rows);
  }

  function attentionFromSummary(summary, options) {
    const context = summary && summary.context || {}, asOf = reportingCutoff({ ...context, asOf: options && options.asOf }), rows = [];
    for (const item of summary && (summary.allOpportunities || summary.opportunities) || []) {
      if (!item || !item.personId || item.metricId === 'checklist-support') continue;
      const category = categoryForMetric(item.metricId) || categorizeTopic(item.topic || item.metric);
      if (!category || category.id === 'other') continue;
      const evidence = item.evidence || {};
      const current = Number.isFinite(evidence.current) ? evidence.current : evidence.recentAverage;
      const prior = evidence.previousAverage;
      const sampleSize = Number(evidence.evaluations || evidence.points) || 0;
      rows.push({
        personId: item.personId, personName: item.personName, coachId: item.coachId || '', metricId: item.metricId,
        metricName: item.metric || item.topic, categoryId: category.id, category: category.label,
        current, prior, delta: Number.isFinite(current) && Number.isFinite(prior) ? current - prior : NaN,
        percentile: evidence.percentile, sampleSize, volume: Number(evidence.weight || evidence.averageOpportunitiesPerWeek) || 0,
        coverage: evidence.coverage || null, lastCoachedAt: asDate(item.lastCoachedAt), severity: Number(item.severity) || 50,
        severityLabel: severityLabel(Number(item.severity) || 50), reason: (item.attentionReasons || []).join(' '), reasons: item.attentionReasons || [],
        confidence: item.confidence || confidenceFor(item.metricId, sampleSize, Number(evidence.weight) || 0), dataThrough: asOf
      });
    }
    return dedupeAttention(rows);
  }

  function categorizedRecentEvents(events, asOf, days) {
    const end = asOf.getTime(), start = end - Math.max(1, Number(days) || 7) * DAY;
    return (events || []).map(categorizeEvent).filter(event => {
      const date = asDate(event.date);
      return date && date.getTime() <= end && date.getTime() >= start;
    }).sort((left, right) => asDate(right.date) - asDate(left.date) || stableCompare(left.representativeId || left.representative, right.representativeId || right.representative));
  }

  function categoryNeeds(attention, rosterSize) {
    const size = Math.max(1, Number(rosterSize) || 0), output = [];
    for (const category of CATEGORIES) {
      const affected = (attention || []).filter(item => item.categoryId === category.id);
      if (!affected.length) continue;
      const weak = affected.filter(item => Number.isFinite(item.percentile) && item.percentile < 40).length;
      const declining = affected.filter(item => Number.isFinite(item.delta) && item.delta < 0).length;
      const averageSeverity = mean(affected.map(item => item.severity));
      const affectedShare = Math.min(1, affected.length / size);
      const severityShare = Number.isFinite(averageSeverity) ? averageSeverity / 100 : 0;
      const decliningShare = affected.length ? declining / affected.length : 0;
      const coverage = mean(affected.map(item => item.coverage && item.coverage.rate).filter(Number.isFinite));
      const sampleConfidence = mean(affected.map(item => /^High/.test(item.confidence) ? 1 : /^Moderate/.test(item.confidence) ? .8 : .55));
      const confidenceFactor = .5 + .25 * (Number.isFinite(coverage) ? coverage : .75) + .25 * (Number.isFinite(sampleConfidence) ? sampleConfidence : .75);
      const score = Math.round(clamp((affectedShare * 45 + severityShare * 35 + decliningShare * 20) * confidenceFactor, 0, 100));
      const reasons = [`${affected.length} of ${rosterSize || 0} reps affected`, `${weak} below the 40th percentile`, `${declining} declining`, `${Number.isFinite(coverage) ? Math.round(coverage * 100) + '% data coverage' : 'coverage unavailable'}`, `${Math.round((sampleConfidence || 0) * 100)}% sample confidence`];
      output.push({ categoryId: category.id, category: category.label, score, level: score >= 60 ? 'High' : score >= 30 ? 'Moderate' : 'Low', affected, affectedCount: affected.length, weakCount: weak, decliningCount: declining, dataCoverage: coverage, sampleConfidence, reasons });
    }
    return output.sort((left, right) => right.score - left.score || stableCompare(left.category, right.category));
  }

  function buildAlignment(input) {
    const attention = dedupeAttention(input && input.attention || []), roster = input && input.roster || [];
    const asOf = reportingCutoff({ coaching: input && input.coaching || [], asOf: input && input.asOf });
    const recent = categorizedRecentEvents(input && input.coaching || [], asOf, 7);
    const needs = categoryNeeds(attention, roster.length), categorized = recent.filter(event => event.categoryIds.length);
    const totalFocus = categorized.reduce((sum, event) => sum + event.categoryIds.length, 0);
    const rows = [];
    for (const category of CATEGORIES) {
      const need = needs.find(item => item.categoryId === category.id) || { categoryId: category.id, category: category.label, score: 0, level: 'Low', affected: [], affectedCount: 0, reasons: ['No measurable current need'] };
      const events = categorized.filter(event => event.categoryIds.includes(category.id));
      const focus = totalFocus ? Math.round(events.length / totalFocus * 100) : 0;
      const affectedIds = new Set(need.affected.map(item => item.personId));
      const coachedIds = new Set(events.map(event => event.representativeId).filter(id => affectedIds.has(id)));
      const coverage = affectedIds.size ? Math.round(coachedIds.size / affectedIds.size * 100) : null;
      let status = 'Aligned';
      if (!need.affectedCount && !events.length) status = 'Insufficient data';
      else if (need.score >= 25 && !events.length) status = 'No recent coaching';
      else if (need.score >= 30 && (focus + 18 < need.score || Number.isFinite(coverage) && coverage < 45)) status = 'Under-coached';
      else if (focus > need.score + 25) status = 'Over-indexed';
      rows.push({ ...need, focus, coverage, events, coachedNeedCount: coachedIds.size, status });
    }

    const activeNeeds = rows.filter(row => row.score >= 20), needTotal = activeNeeds.reduce((sum, row) => sum + row.score, 0) || 1;
    const focusTotal = rows.reduce((sum, row) => sum + row.focus, 0) || 1;
    const distributionDistance = rows.reduce((sum, row) => sum + Math.abs((row.score / needTotal) - (row.focus / focusTotal)), 0) / 2;
    const priorityAttention = attention.filter(item => item.severity >= 60), priorityIds = new Set(priorityAttention.map(item => item.personId));
    const coachedPriority = new Set(categorized.map(event => event.representativeId).filter(id => priorityIds.has(id)));
    const priorityCoverage = priorityIds.size ? coachedPriority.size / priorityIds.size : NaN;
    const priorityCoverageScore = Number.isFinite(priorityCoverage) ? priorityCoverage : 1;
    const score = activeNeeds.length ? Math.round(clamp((1 - distributionDistance) * 70 + priorityCoverageScore * 30, 0, 100)) : null;
    const majorNeeds = activeNeeds.filter(row => row.score >= 30);
    const coveredMajor = majorNeeds.filter(row => row.events.length && (row.coverage == null || row.coverage > 0));
    const biggestUncovered = majorNeeds.filter(row => row.status === 'Under-coached' || row.status === 'No recent coaching').sort((left, right) => right.score - left.score || stableCompare(left.category, right.category))[0] || null;
    const mostCoached = rows.slice().sort((left, right) => right.events.length - left.events.length || stableCompare(left.category, right.category))[0] || null;
    const strongest = rows.filter(row => row.status === 'Aligned').sort((left, right) => right.score - left.score || stableCompare(left.category, right.category))[0] || null;
    return { asOf, windowDays: 7, score, rows, attention, recentCoaching: recent, majorNeeds: majorNeeds.length, coveredMajorNeeds: coveredMajor.length, priorityCoverage, biggestUncovered, mostCoached, strongest };
  }

  function coachingActivity(input) {
    const roster = input && input.roster || [], asOf = reportingCutoff({ coaching: input && input.coaching || [], asOf: input && input.asOf });
    const last7 = categorizedRecentEvents(input && input.coaching || [], asOf, 7), last30 = categorizedRecentEvents(input && input.coaching || [], asOf, 30);
    const unique7 = new Set(last7.map(event => event.representativeId || clean(event.representative)).filter(Boolean));
    const categoryRows = [];
    for (const category of CATEGORIES) {
      const events = last7.filter(event => event.categoryIds.includes(category.id));
      if (!events.length) continue;
      const topics = new Map();
      for (const event of events) for (const topic of event.originalTopics || []) if (topicMatchesCategory(topic, category.id)) topics.set(topic, (topics.get(topic) || 0) + 1);
      categoryRows.push({ categoryId: category.id, category: category.label, count: events.length, events, topics: Array.from(topics, ([topic, count]) => ({ topic, count })).sort((left, right) => right.count - left.count || stableCompare(left.topic, right.topic)) });
    }
    categoryRows.sort((left, right) => right.count - left.count || stableCompare(left.category, right.category));
    const repeats = new Map();
    for (const event of last30) for (const categoryId of event.categoryIds) {
      const key = `${event.representativeId || clean(event.representative)}|${categoryId}`;
      if (!repeats.has(key)) repeats.set(key, { representativeId: event.representativeId || '', representative: event.representative || '', categoryId, category: (CATEGORIES.find(item => item.id === categoryId) || {}).label || categoryId, count: 0, events: [] });
      repeats.get(key).count += 1; repeats.get(key).events.push(event);
    }
    return {
      asOf, last7: { total: last7.length, uniqueRepresentatives: unique7.size, rosterCoverage: roster.length ? unique7.size / roster.length : NaN, eventsPerRepresentative: unique7.size ? last7.length / unique7.size : 0, events: last7 },
      last30: { total: last30.length, uniqueRepresentatives: new Set(last30.map(event => event.representativeId || clean(event.representative)).filter(Boolean)).size, events: last30 },
      categories: categoryRows,
      repeats: Array.from(repeats.values()).filter(row => row.count > 1).map(row => ({ ...row, specificTopics: Array.from(new Set(row.events.flatMap(event => event.originalTopics || []).filter(topic => topicMatchesCategory(topic, row.categoryId)))).sort(stableCompare) })).sort((left, right) => right.count - left.count || stableCompare(left.representative, right.representative) || stableCompare(left.category, right.category))
    };
  }

  function qualityFromProfiles(profiles, coaching, options) {
    const list = profiles || [], asOf = reportingCutoff({ profiles: list, coaching, asOf: options && options.asOf });
    const rows = list.map(profile => ({ profile, evidence: qaEvidence(profile, asOf) }));
    const evaluated = rows.filter(row => row.evidence.evaluations > 0), allCurrent = evaluated.flatMap(row => row.evidence.rows.map(item => item.score)), allPrevious = rows.flatMap(row => row.evidence.priorRows.map(item => item.score));
    const attention = dedupeAttention(options && options.attention || attentionFromProfiles(list, { asOf })).filter(item => item.metricId === 'qa-score');
    const recentCoaching = categorizedRecentEvents(coaching, asOf, 7).filter(event => event.categoryIds.includes('call-quality'));
    const coachedIds = new Set(recentCoaching.map(event => event.representativeId));
    const concerns = attention.map(item => ({ ...item, uncoached: !coachedIds.has(item.personId) }));
    const current = mean(allCurrent), previous = mean(allPrevious), allRows = rows.flatMap(row => [...row.evidence.rows, ...row.evidence.priorRows]);
    const periodTrend = days => {
      const midpoint = asOf.getTime() - days * DAY / 2, start = asOf.getTime() - days * DAY;
      const earlier = mean(allRows.filter(row => asDate(row.date).getTime() >= start && asDate(row.date).getTime() < midpoint).map(row => row.score));
      const later = mean(allRows.filter(row => asDate(row.date).getTime() >= midpoint && asDate(row.date).getTime() <= asOf.getTime()).map(row => row.score));
      return { earlier, later, delta: Number.isFinite(earlier) && Number.isFinite(later) ? later - earlier : NaN, direction: !Number.isFinite(earlier) || !Number.isFinite(later) ? 'Insufficient data' : Math.abs(later - earlier) < .005 ? 'Stable' : later > earlier ? 'Improving' : 'Declining' };
    };
    return {
      asOf, current, previous, delta: Number.isFinite(current) && Number.isFinite(previous) ? current - previous : NaN,
      evaluationCount: allCurrent.length, dataThrough: maxDate(rows.map(row => row.evidence.dataThrough)),
      trend4: periodTrend(28), trend8: periodTrend(56),
      repsEvaluated: evaluated.length, repsWithoutEvaluations: Math.max(0, list.length - evaluated.length), rosterCoverage: list.length ? evaluated.length / list.length : NaN,
      evaluationDistribution: rows.map(row => ({ personId: row.profile.person.personId, personName: row.profile.person.displayName, count: row.evidence.evaluations })).sort((left, right) => left.count - right.count || stableCompare(left.personName, right.personName)),
      concerns, uncoachedNeed: concerns.filter(item => item.uncoached), coachingOutcomes: []
    };
  }

  root.CoachToolsCoachingAlignment = Object.freeze({
    VERSION, DAY, CATEGORIES, DEFAULT_KPI_COVERAGE, DEFAULT_QUALITY_COVERAGE,
    kpiCoverageThreshold, qualityCoverageThreshold, setKpiCoverageThreshold, setQualityCoverageThreshold, coverageThresholdForMetric,
    categoryForMetric, categorizeTopic, categorizeEvent, topicMatchesCategory, reportingCutoff, snapshotFingerprint, currentVersionFingerprint,
    usableCurrentIdentity, currentRoster, eligibleCoachCohort,
    confidenceFor, dedupeAttention, attentionFromProfiles, attentionFromSummary, categorizedRecentEvents, buildAlignment, coachingActivity, qualityFromProfiles,
    _test: Object.freeze({ clean, clamp, mean, asDate, stableHash, recordIdentity, qaEvidence, categoryNeeds, severityLabel })
  });
})(typeof window !== 'undefined' ? window : globalThis);
