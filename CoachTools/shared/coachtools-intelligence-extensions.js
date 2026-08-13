(function extendCoachToolsIntelligence(root) {
  'use strict';

  const base = root.CoachToolsIntelligence;
  if (!base) return;

  const DAY = 86400000;
  const clean = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  const daysSince = date => date instanceof Date ? Math.max(0, (Date.now() - date.getTime()) / DAY) : NaN;
  const mean = values => {
    const valid = (values || []).filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
  };

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
    const opportunities = (summary.opportunities || []).map(withAge);
    const activeIds = new Set(opportunities.map(item => item.id));
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
    return {
      ...summary,
      opportunities,
      needCoaching: opportunities.filter(item => item.status === 'open' && item.metricId !== 'checklist-support'),
      followUp: opportunities.filter(item => item.status === 'coached-watching' || item.status === 'recurred'),
      supportDelays: opportunities.filter(item => item.metricId === 'checklist-support'),
      resolved,
      lifecycle: [...opportunities, ...resolved],
      recognition: recognition.sort((left, right) => (right.orientedChange || 0) - (left.orientedChange || 0)).slice(0, 30),
      coachingBalance: coachingBalance(summary.context),
      coachingExperts: coachingExperts(effectiveness)
    };
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
    VERSION: '1.1.0',
    commandCenter,
    insightForApp,
    personStory,
    buildSummary,
    buildResolvedOpportunities,
    coachingBalance,
    coachingExperts,
    _test: Object.freeze({ ...base._test, classifyCoachingBalance })
  });
})(typeof window !== 'undefined' ? window : globalThis);
