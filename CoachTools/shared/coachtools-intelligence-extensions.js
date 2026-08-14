(function extendCoachToolsIntelligence(root) {
  'use strict';

  const base = root.CoachToolsIntelligence;
  if (!base) return;

  const DAY = 86400000;
  const clean = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  const normHeader = value => clean(value).toLowerCase().replace(/[^a-z0-9%]/g, '');
  const daysSince = date => date instanceof Date ? Math.max(0, (Date.now() - date.getTime()) / DAY) : NaN;
  const mean = values => {
    const valid = (values || []).filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
  };

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
    for (const key of Object.keys(row || {})) {
      if ((patterns || []).some(pattern => pattern.test(key))) return row[key];
    }
    return undefined;
  }

  function rowNumber(row, candidates, patterns) {
    return base._test.parseNumber(rowPickPattern(row, candidates, patterns));
  }

  function recordDate(record) {
    const period = record && record.detectedPeriod || {};
    return base._test.parseDate(period.end || period.start || period.date || record && (record.periodSort || record.importedAt || record.updatedAt));
  }

  function metricById(id) {
    return (base.METRICS || []).find(metric => metric.id === id) || null;
  }

  function derivedKpiRows(record, resolve, type) {
    if (!record || !record.data) return [];
    const date = recordDate(record);
    if (!date) return [];
    const rows = [], sourceType = clean(type || record.datasetType).toLowerCase();
    const isReferral = /referral/.test(sourceType);
    const consumerMetric = metricById('consumer-appointment-rate');
    const wiperMetric = metricById('wiper-rate');

    for (const pack of base._test.extractRows(record.data)) {
      for (const row of pack.rows || []) {
        const repRaw = rowPick(row, ['Representative', 'Representative Name', 'Associate Name', 'Associate', 'Agent Name', 'AgentName', 'Agent', 'Employee', 'Rep', 'Rep Name', 'CSR', 'CSR Name', 'SSR', 'SSR Name', 'Name']);
        const coachRaw = rowPick(row, ['Job Coach', 'Coach Assigned', 'Coach', 'Sheet', 'Team']) || pack.sheet;
        const personId = repRaw ? resolve(repRaw) : resolve(coachRaw);
        if (!personId) continue;
        const role = repRaw ? 'representative' : 'coach';

        const consumerApps = rowNumber(row,
          ['Consumer Appointments', 'Consumer Appointment', 'Consumer Apps'],
          [/^Consumer[_\s-]*Appointments?$/i, /consumer.*appointments?/i]);
        const consumerOpps = rowNumber(row,
          ['Consumer Opportunities', 'Consumer Opportunity', 'Consumer Opps'],
          [/^Consumer[_\s-]*Opportunit/i, /consumer.*opportunit/i]);
        if (!isReferral && consumerMetric && Number.isFinite(consumerApps) && Number.isFinite(consumerOpps) && consumerOpps > 0) {
          rows.push({ personId, role, metric: consumerMetric, value: consumerApps / consumerOpps, weight: consumerOpps, date, datasetType: type });
        }

        const wiperCount = rowNumber(row,
          ['Wiper Count'],
          [/^Wiper[_\s-]*Count$/i, /wiper.*count/i, /^Wiper\s*Count$/i]);
        const wiperJobs = rowNumber(row,
          ['Wiper Jobs', 'Wiper Job'],
          [/^Wiper[_\s-]*Jobs?$/i, /wiper.*jobs?/i]);
        const wipersAccept = rowNumber(row,
          ['Wipers Accept', 'Wiper Accept', 'Wipers Accepted', 'Wiper Accepted'],
          [/wipers?[_\s-]*accept/i, /wipers? accept/i]);
        const wipersAsked = rowNumber(row,
          ['Wipers Asked', 'Wiper Asked'],
          [/wipers?[_\s-]*asked/i, /wipers? asked/i]);

        let wiperValue = NaN, wiperWeight = NaN;
        if (isReferral) {
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
        if (wiperMetric && Number.isFinite(wiperValue)) rows.push({ personId, role, metric: wiperMetric, value: wiperValue, weight: wiperWeight, date, datasetType: type });
      }
    }
    return rows;
  }

  function canonicalizePerformance(record, resolve, type) {
    const regular = base._test.canonicalizePerformance(record, resolve, type) || [];
    const derived = derivedKpiRows(record, resolve, type);
    if (!derived.length) return regular;
    const derivedKeys = new Set(derived.map(row => `${row.personId}|${row.metric.id}`));
    return regular.filter(row => !derivedKeys.has(`${row.personId}|${row.metric.id}`)).concat(derived);
  }

  function topicMatchesMetric(topic, metric) {
    return Boolean(metric && metric.topic && metric.topic.test(clean(topic)));
  }

  function metricSeries(context) {
    const grouped = new Map();
    for (const row of context.performance || []) {
      if (row.role !== 'representative' || !row.metric) continue;
      const key = `${row.personId}|${row.metric.id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    for (const rows of grouped.values()) rows.sort((left, right) => left.date - right.date);
    return grouped;
  }

  function matchingCoaching(context, personId, metric, days) {
    const cutoff = Date.now() - (days || 90) * DAY;
    return (context.coaching || [])
      .filter(event => event.representativeId === personId && event.date instanceof Date && event.date.getTime() >= cutoff && (event.topics || []).some(topic => topicMatchesMetric(topic, metric)))
      .sort((left, right) => right.date - left.date);
  }

  function buildResolvedOpportunities(context) {
    const resolved = [];
    for (const [key, rows] of metricSeries(context)) {
      if (rows.length < 3) continue;
      const personId = key.split('|')[0];
      const person = context.byId && context.byId.get(personId);
      if (!person) continue;
      const metric = rows[rows.length - 1].metric;
      const coachings = matchingCoaching(context, personId, metric, 90);
      const latestCoaching = coachings[0];
      if (!latestCoaching) continue;
      const beforeRows = rows.filter(row => row.date < latestCoaching.date).slice(-3);
      const afterRows = rows.filter(row => row.date > latestCoaching.date);
      if (!beforeRows.length || afterRows.length < 2) continue;
      const before = mean(beforeRows.map(row => row.value));
      const lastTwo = afterRows.slice(-2);
      const after = mean(lastTwo.map(row => row.value));
      const outcome = base._test.classifyOutcome(before, after, metric);
      if (outcome.status !== 'improved') continue;
      const orientation = metric.higher === false ? -1 : 1;
      const sustained = lastTwo.every(row => (row.value - before) * orientation >= outcome.threshold / 2);
      if (!sustained) continue;
      const coachId = person.currentCoachId || latestCoaching.coachId || '';
      const coach = context.byId && context.byId.get(coachId);
      resolved.push({
        id: `perf:${personId}:${metric.id}`,
        personId,
        coachId,
        personName: person.displayName || latestCoaching.representative || '',
        coachName: coach && coach.displayName || latestCoaching.coach || '',
        topic: metric.name,
        metric: metric.name,
        metricId: metric.id,
        openedAt: latestCoaching.date,
        ageDays: Math.round(daysSince(latestCoaching.date)),
        status: 'resolved',
        severity: 0,
        confidence: afterRows.length >= 3 ? 'strong' : 'moderate',
        recurrenceCount: Math.max(0, coachings.length - 1),
        lastCoachedAt: latestCoaching.date,
        evidence: {
          current: rows[rows.length - 1].value,
          recentAverage: after,
          previousAverage: before,
          points: rows.length,
          outcomeChange: outcome.delta
        },
        attentionReasons: [`${metric.name} has remained improved across at least two measured periods after coaching.`]
      });
    }
    return resolved;
  }

  function scopedRepresentative(context, personId) {
    const person = context.byId && context.byId.get(personId);
    return Boolean(person && person.role === 'representative' && base._test.personInScope(person, context.scope, context.byId));
  }

  function recentMetricStats(context, metricId, limit) {
    const grouped = new Map();
    for (const row of context.performance || []) {
      if (row.role !== 'representative' || !row.metric || row.metric.id !== metricId || !Number.isFinite(row.value)) continue;
      if (!grouped.has(row.personId)) grouped.set(row.personId, []);
      grouped.get(row.personId).push(row);
    }
    const stats = new Map();
    for (const [personId, rows] of grouped) {
      rows.sort((left, right) => left.date - right.date);
      const chosen = rows.slice(-Math.max(1, limit || 4));
      const weighted = chosen.filter(row => Number.isFinite(row.weight) && row.weight > 0);
      if (weighted.length) {
        const weight = weighted.reduce((sum, row) => sum + row.weight, 0);
        stats.set(personId, { value: weight ? weighted.reduce((sum, row) => sum + row.value * row.weight, 0) / weight : NaN, weight, rows: chosen });
      } else {
        const values = chosen.map(row => row.value).filter(Number.isFinite);
        if (values.length) stats.set(personId, { value: mean(values), weight: values.length, rows: chosen });
      }
    }
    return stats;
  }

  function globalRanking(context, metricId) {
    const stats = recentMetricStats(context, metricId, 4);
    const ordered = Array.from(stats.entries())
      .filter(([, row]) => Number.isFinite(row.value))
      .sort((left, right) => right[1].value - left[1].value || clean((context.byId.get(left[0]) || {}).displayName).localeCompare(clean((context.byId.get(right[0]) || {}).displayName)));
    return ordered.map(([personId, row], index) => ({
      personId,
      personName: clean((context.byId.get(personId) || {}).displayName) || personId,
      value: row.value,
      weight: row.weight,
      rank: index + 1,
      total: ordered.length
    }));
  }

  function rateDrivers(context, metricId, label) {
    const stats = recentMetricStats(context, metricId, 4);
    const scoped = Array.from(stats.entries()).filter(([personId, row]) => scopedRepresentative(context, personId) && Number.isFinite(row.value) && row.weight > 0);
    const totalWeight = scoped.reduce((sum, [, row]) => sum + row.weight, 0);
    if (!totalWeight) return [];
    const teamValue = scoped.reduce((sum, [, row]) => sum + row.value * row.weight, 0) / totalWeight;
    const ranks = new Map(globalRanking(context, metricId).map(row => [row.personId, row]));
    return scoped.map(([personId, row]) => {
      const drag = Math.max(0, teamValue - row.value) * row.weight / totalWeight;
      if (!(drag > 0)) return null;
      const person = context.byId.get(personId), rank = ranks.get(personId);
      const difference = teamValue - row.value;
      const severity = Math.round(Math.min(99, 62 + Math.min(24, difference / .05 * 18) + Math.min(13, row.weight / totalWeight * 100)));
      return {
        id: `impact:${metricId}:${personId}`,
        kind: 'team-driver',
        personId,
        personName: person && person.displayName || personId,
        coachId: person && person.currentCoachId || '',
        topic: `${label}${rank ? ` · #${rank.rank}/${rank.total}` : ''}`,
        metric: label,
        metricId,
        openedAt: new Date(),
        status: 'open',
        severity,
        impactScore: drag,
        attentionReasons: [`Estimated team drag: ${(drag * 100).toFixed(2)} percentage points. Rep ${(row.value * 100).toFixed(1)}% vs team ${(teamValue * 100).toFixed(1)}%, weighted by ${Math.round(row.weight)} opportunities${rank ? ` · global rank #${rank.rank}/${rank.total}` : ''}.`],
        evidence: { current: row.value, teamValue, weight: row.weight, teamWeight: totalWeight, teamImpact: drag, globalRank: rank && rank.rank, globalTotal: rank && rank.total }
      };
    }).filter(Boolean).sort((left, right) => right.impactScore - left.impactScore);
  }

  function qaDrivers(context) {
    const grouped = new Map(), cutoff = Date.now() - 30 * DAY;
    for (const row of context.qa || []) {
      if (!row.representativeId || !Number.isFinite(row.score) || !(row.date instanceof Date) || row.date.getTime() < cutoff) continue;
      if (!scopedRepresentative(context, row.representativeId)) continue;
      if (!grouped.has(row.representativeId)) grouped.set(row.representativeId, []);
      grouped.get(row.representativeId).push(row.score);
    }
    const stats = Array.from(grouped.entries()).map(([personId, scores]) => ({ personId, value: mean(scores), weight: scores.length })).filter(row => Number.isFinite(row.value));
    const totalWeight = stats.reduce((sum, row) => sum + row.weight, 0);
    if (!totalWeight) return [];
    const teamValue = stats.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
    return stats.map(row => {
      const drag = Math.max(0, teamValue - row.value) * row.weight / totalWeight;
      if (!(drag > 0)) return null;
      const person = context.byId.get(row.personId), difference = teamValue - row.value;
      return {
        id: `impact:qa-score:${row.personId}`,
        kind: 'team-driver',
        personId: row.personId,
        personName: person && person.displayName || row.personId,
        coachId: person && person.currentCoachId || '',
        topic: 'Call Quality / QA',
        metric: 'Call Quality / QA',
        metricId: 'qa-score',
        openedAt: new Date(),
        status: 'open',
        severity: Math.round(Math.min(99, 62 + Math.min(25, difference / .05 * 18) + Math.min(12, row.weight / totalWeight * 100))),
        impactScore: drag,
        attentionReasons: [`Estimated team QA drag: ${(drag * 100).toFixed(2)} percentage points. Rep ${(row.value * 100).toFixed(1)}% vs team ${(teamValue * 100).toFixed(1)}% across ${row.weight} recent QA evaluation${row.weight === 1 ? '' : 's'}.`],
        evidence: { current: row.value, teamValue, weight: row.weight, teamWeight: totalWeight, teamImpact: drag }
      };
    }).filter(Boolean).sort((left, right) => right.impactScore - left.impactScore);
  }

  function serveTimeDrivers(context) {
    const grouped = new Map(), cutoff = Date.now() - 45 * DAY;
    for (const row of context.checklist || []) {
      if (!row.representativeId || !Number.isFinite(row.days) || !(row.created instanceof Date) || row.created.getTime() < cutoff) continue;
      if (!scopedRepresentative(context, row.representativeId)) continue;
      if (!grouped.has(row.representativeId)) grouped.set(row.representativeId, []);
      grouped.get(row.representativeId).push(row.days);
    }
    const stats = Array.from(grouped.entries()).map(([personId, values]) => ({ personId, value: mean(values), weight: values.length })).filter(row => Number.isFinite(row.value));
    const totalWeight = stats.reduce((sum, row) => sum + row.weight, 0);
    if (!totalWeight) return [];
    const teamValue = stats.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
    return stats.map(row => {
      const drag = Math.max(0, row.value - teamValue) * row.weight / totalWeight;
      if (!(drag > 0)) return null;
      const person = context.byId.get(row.personId), difference = row.value - teamValue;
      return {
        id: `impact:checklist-support:${row.personId}`,
        kind: 'team-driver',
        personId: row.personId,
        personName: person && person.displayName || row.personId,
        coachId: person && person.currentCoachId || '',
        topic: 'Average Time to Serve',
        metric: 'Average Time to Serve',
        metricId: 'checklist-support',
        openedAt: new Date(),
        status: 'open',
        severity: Math.round(Math.min(99, 62 + Math.min(25, difference / 3 * 18) + Math.min(12, row.weight / totalWeight * 100))),
        impactScore: drag / 10,
        attentionReasons: [`Estimated contribution to team serve-time average: +${drag.toFixed(2)} days. Rep average ${row.value.toFixed(1)} days vs team ${teamValue.toFixed(1)} days across ${row.weight} recently served checklist item${row.weight === 1 ? '' : 's'}.`],
        evidence: { current: row.value, teamValue, weight: row.weight, teamWeight: totalWeight, teamImpactDays: drag }
      };
    }).filter(Boolean).sort((left, right) => right.impactScore - left.impactScore);
  }

  function balancedPriorityDrivers(context) {
    const groups = [
      rateDrivers(context, 'consumer-appointment-rate', 'Consumer Appointment Rate'),
      rateDrivers(context, 'wiper-rate', 'Wiper Rate'),
      qaDrivers(context),
      serveTimeDrivers(context)
    ];
    const output = [];
    for (let depth = 0; depth < 3; depth += 1) {
      for (const group of groups) if (group[depth]) output.push(group[depth]);
    }
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
      const key = event.coachId || clean(event.coach).toLowerCase();
      if (!key) continue;
      const coach = context.byId && context.byId.get(event.coachId);
      if (!grouped.has(key)) grouped.set(key, {
        coachId: event.coachId || '',
        coachName: coach && coach.displayName || event.coach || 'Coach',
        total: 0,
        development: 0,
        recognition: 0,
        uncategorized: 0
      });
      const row = grouped.get(key);
      const category = classifyCoachingBalance(event);
      row.total += 1;
      row[category] += 1;
    }
    return Array.from(grouped.values()).map(row => {
      const categorized = row.development + row.recognition;
      return { ...row, recognitionRate: categorized ? row.recognition / categorized : NaN };
    }).sort((left, right) => right.total - left.total || left.coachName.localeCompare(right.coachName));
  }

  function coachingExperts(effectiveness) {
    const bestByTopic = new Map();
    for (const row of effectiveness || []) {
      if (row.total < 3 || !Number.isFinite(row.successRate) || row.successRate < 0.6) continue;
      const current = bestByTopic.get(row.topic);
      if (!current || row.successRate > current.successRate || (row.successRate === current.successRate && row.total > current.total)) bestByTopic.set(row.topic, row);
    }
    return Array.from(bestByTopic.values()).sort((left, right) => right.successRate - left.successRate || right.total - left.total);
  }

  function withAge(item) {
    if (!item || !item.openedAt) return item;
    return { ...item, ageDays: Math.round(daysSince(item.openedAt)) };
  }

  function augmentSummary(summary) {
    if (!summary || !summary.context) return summary;
    const originalOpportunities = (summary.opportunities || []).map(withAge);
    const priorityDrivers = balancedPriorityDrivers(summary.context);
    const driverKeys = new Set(priorityDrivers.map(item => `${item.personId}|${item.metricId}`));
    const extraOpportunities = originalOpportunities
      .filter(item => !driverKeys.has(`${item.personId}|${item.metricId}`))
      .sort((left, right) => (right.severity || 0) - (left.severity || 0))
      .slice(0, 4);
    const opportunities = [...priorityDrivers, ...extraOpportunities];
    const activeIds = new Set(originalOpportunities.map(item => item.id));
    const resolved = buildResolvedOpportunities(summary.context).filter(item => !activeIds.has(item.id));
    const recognition = (summary.recognition || []).map(item => ({ kind: item.kind || 'momentum', ...item }));
    const recognitionKeys = new Set(recognition.map(item => `${item.personId}|${item.metricId}`));
    for (const item of resolved) {
      const key = `${item.personId}|${item.metricId}`;
      if (recognitionKeys.has(key)) continue;
      recognition.push({
        kind: 'resolved', personId: item.personId, personName: item.personName, coachId: item.coachId, coachName: item.coachName,
        topic: item.topic, metric: item.metric, metricId: item.metricId, change: item.evidence.outcomeChange,
        orientedChange: Math.abs(item.evidence.outcomeChange || 0), current: item.evidence.current,
        message: `${item.topic} has remained improved after coaching and appears resolved.`
      });
    }
    const effectiveness = summary.coachEffectiveness || [];
    const globalRankings = {
      consumerAppointmentRate: globalRanking(summary.context, 'consumer-appointment-rate'),
      wiperRate: globalRanking(summary.context, 'wiper-rate')
    };
    root.__CoachToolsCommandCenterPriority = { priorityDrivers, globalRankings };
    return {
      ...summary,
      opportunities,
      allOpportunities: originalOpportunities,
      priorityDrivers,
      globalRankings,
      needCoaching: opportunities.filter(item => item.status === 'open' && item.metricId !== 'checklist-support'),
      followUp: originalOpportunities.filter(item => item.status === 'coached-watching' || item.status === 'recurred'),
      supportDelays: opportunities.filter(item => item.metricId === 'checklist-support'),
      resolved,
      lifecycle: [...originalOpportunities, ...resolved],
      recognition: recognition.sort((left, right) => (right.orientedChange || 0) - (left.orientedChange || 0)).slice(0, 30),
      coachingBalance: coachingBalance(summary.context),
      coachingExperts: coachingExperts(effectiveness)
    };
  }

  function enhanceCommandCenterDom() {
    if (typeof document === 'undefined') return;
    const appId = clean(document.querySelector('meta[name="coachtools-id"]')?.content);
    if (appId !== 'coaching-command-center') return;
    if (!document.getElementById('command-center-priority-style')) {
      const style = document.createElement('style');
      style.id = 'command-center-priority-style';
      style.textContent = '.globalKpiRank{display:block;margin-top:2px;color:#247bb5;font-size:7px;font-weight:900;white-space:nowrap}.priorityImpactHint{color:#36566d;font-weight:850}';
      document.head.appendChild(style);
    }
    const content = document.getElementById('content');
    if (!content) return;
    for (const heading of content.querySelectorAll('.panelHead h2')) {
      if (clean(heading.textContent) !== 'Highest-priority coaching work') continue;
      heading.textContent = 'Priority impact ranking';
      const copy = heading.parentElement && heading.parentElement.querySelector('p');
      if (copy) copy.textContent = 'Balanced by estimated impact on team Consumer Appointment Rate, Wiper Rate, Call Quality, and Average Time to Serve.';
    }
    const priority = root.__CoachToolsCommandCenterPriority;
    if (!priority || !priority.globalRankings) return;
    const cash = new Map((priority.globalRankings.consumerAppointmentRate || []).map(row => [clean(row.personName).toLowerCase(), row]));
    const wipers = new Map((priority.globalRankings.wiperRate || []).map(row => [clean(row.personName).toLowerCase(), row]));
    const paintWeightedKpi = (cell, rank) => {
      if (!cell || !rank || !Number.isFinite(rank.value) || cell.querySelector('.globalKpiRank')) return;
      cell.innerHTML = `${(rank.value * 100).toFixed(1)}%<small class="globalKpiRank">Global #${rank.rank}/${rank.total} · weighted</small>`;
    };
    for (const table of content.querySelectorAll('table.table')) {
      const headers = Array.from(table.querySelectorAll('thead th')).map(th => clean(th.textContent));
      const cashIndex = headers.indexOf('Cash AR'), wiperIndex = headers.indexOf('Wipers');
      if (cashIndex < 0 && wiperIndex < 0) continue;
      for (const row of table.querySelectorAll('tbody tr')) {
        const cells = row.cells;
        if (!cells || !cells.length) continue;
        const key = clean(cells[0].textContent).toLowerCase();
        if (cashIndex >= 0) paintWeightedKpi(cells[cashIndex], cash.get(key));
        if (wiperIndex >= 0) paintWeightedKpi(cells[wiperIndex], wipers.get(key));
      }
    }
  }

  function installCommandCenterEnhancer() {
    if (typeof document === 'undefined') return;
    const appId = clean(document.querySelector('meta[name="coachtools-id"]')?.content);
    if (appId !== 'coaching-command-center') return;
    const run = () => { try { enhanceCommandCenterDom(); } catch (_) {} };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
    const observer = new MutationObserver(() => root.setTimeout(run, 0));
    const start = () => { const content = document.getElementById('content'); if (content) observer.observe(content, { childList: true, subtree: true }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  const baseBuildSummary = base.buildSummary.bind(base);
  const baseCommandCenter = base.commandCenter.bind(base);

  function buildSummary(context) {
    return augmentSummary(baseBuildSummary(context));
  }

  async function commandCenter(options) {
    return augmentSummary(await baseCommandCenter(options));
  }

  function personStory(context, personId, precomputed) {
    const summary = precomputed && precomputed.resolved ? precomputed : augmentSummary(precomputed || baseBuildSummary(context));
    const active = summary.opportunities.filter(item => item.personId === personId);
    const resolved = summary.resolved.filter(item => item.personId === personId);
    if (!active.length && resolved.length) {
      const person = context.byId && context.byId.get(personId);
      return `${person && person.displayName || 'This representative'}'s recent ${resolved[0].topic} coaching loop appears resolved across multiple measured periods. ${resolved[0].attentionReasons[0]}`;
    }
    return base.personStory(context, personId, summary);
  }

  async function insightForApp(appId, options) {
    const summary = await commandCenter();
    const personId = options && options.personId;
    if (appId === 'people-profiles' && personId) {
      const relevant = summary.opportunities.filter(item => item.personId === personId);
      const positive = summary.recognition.filter(item => item.personId === personId);
      if (!relevant.length && !positive.length) return null;
      const top = relevant[0];
      return {
        tone: top ? 'attention' : 'positive',
        title: top ? `${top.topic} needs attention` : 'Positive momentum',
        summary: top ? top.attentionReasons[0] || 'A coaching follow-up is worth reviewing.' : positive[0].message,
        detailTitle: 'Coaching Intelligence',
        story: personStory(summary.context, personId, summary),
        items: top ? relevant.slice(0, 5) : summary.resolved.filter(item => item.personId === personId).slice(0, 5)
      };
    }
    if (appId === 'coaching-gaps') {
      const active = summary.opportunities.filter(item => item.metricId !== 'checklist-support');
      const recentResolved = summary.resolved.slice(0, 5);
      if (!active.length && !recentResolved.length) return null;
      const recurred = active.filter(item => item.status === 'recurred').length;
      return {
        tone: recurred ? 'attention' : active.length ? 'watch' : 'positive',
        title: active.length ? `${active.length} active coaching opportunit${active.length === 1 ? 'y' : 'ies'}` : `${recentResolved.length} recently resolved`,
        summary: recurred ? `${recurred} appear to have recurred after prior coaching.` : recentResolved.length ? `${recentResolved.length} coaching loop${recentResolved.length === 1 ? '' : 's'} show sustained improvement.` : 'Open and follow-up coaching needs are available.',
        detailTitle: 'Opportunity Lifecycle',
        items: [...active.slice(0, 10), ...recentResolved]
      };
    }
    if (appId === 'kpi-impact') {
      const out = summary.performanceOutcomes;
      if (out.total < 2) return null;
      return {
        tone: out.declined > out.improved ? 'watch' : 'info', title: `${out.total} measurable coaching outcomes`,
        summary: `${out.improved} improved · ${out.neutral} neutral · ${out.declined} declined`, detailTitle: 'Coaching Outcomes',
        outcomes: out.rows.slice().sort((left, right) => right.date - left.date).slice(0, 15),
        coachEffectiveness: summary.coachEffectiveness.filter(row => row.rows.some(item => item.kind === 'performance')).slice(0, 10),
        experts: summary.coachingExperts.filter(row => row.rows.some(item => item.kind === 'performance')).slice(0, 6)
      };
    }
    if (appId === 'qa-scores') {
      const out = summary.qaOutcomes;
      if (out.total < 2) return null;
      return {
        tone: out.declined > out.improved ? 'watch' : 'info', title: `${out.total} measurable QA coaching outcomes`,
        summary: `${out.improved} improved · ${out.neutral} neutral · ${out.declined} declined`, detailTitle: 'QA Coaching Outcomes',
        outcomes: out.rows.slice().sort((left, right) => right.date - left.date).slice(0, 15),
        coachEffectiveness: summary.coachEffectiveness.filter(row => row.rows.some(item => item.kind === 'qa')).slice(0, 10),
        experts: summary.coachingExperts.filter(row => row.rows.some(item => item.kind === 'qa')).slice(0, 6)
      };
    }
    if (appId === 'coach-timeline') {
      const support = summary.support || [];
      if (!support.length) return null;
      const total = support.reduce((sum, row) => sum + row.total, 0);
      const average = mean(support.map(row => row.averageDays).filter(Number.isFinite));
      const overThree = support.reduce((sum, row) => sum + row.overThreeDays, 0);
      return {
        tone: summary.supportDelays.length ? 'attention' : 'info', title: `Checklist support · ${total} items`,
        summary: `Avg time to serve ${base.formatDays(average)} · ${overThree} waiting > 3 days`, detailTitle: 'Checklist Support Load', support: support.slice(0, 15)
      };
    }
    return null;
  }

  root.CoachToolsIntelligence = Object.freeze({
    ...base,
    VERSION: '1.2.1',
    commandCenter,
    insightForApp,
    personStory,
    buildSummary,
    buildResolvedOpportunities,
    coachingBalance,
    coachingExperts,
    _test: Object.freeze({ ...base._test, canonicalizePerformance, derivedKpiRows, classifyCoachingBalance })
  });

  installCommandCenterEnhancer();
})(typeof window !== 'undefined' ? window : globalThis);
