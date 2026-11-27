(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KpiWeeklyCore = api;
})(globalThis, function () {
  'use strict';

  const day = 86400000;
  const week = 7 * day;
  const topics = Object.freeze({
    consumer: { label: 'Consumer Appointment Rate', coachingLabel: 'Appt Rate', term: 'appt rate' },
    callQuality: { label: 'Call Quality', coachingLabel: 'Call Quality', term: 'call quality' },
    wiper: { label: 'Wiper Rate', coachingLabel: 'Wiper', term: 'wiper' }
  });

  // UTC arithmetic over local calendar dates keeps Sunday–Saturday intact at DST changes.
  function weekStart(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return NaN;
    const start = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return start - new Date(start).getUTCDay() * day;
  }

  const empty = () => ({ results: 0, volume: 0 });
  function add(target, row) {
    target.results += row.results;
    target.volume += row.volume;
    return target;
  }
  function rate(point) { return point?.volume > 0 ? point.results / point.volume : NaN; }

  function index(rows, currentWeek) {
    const byWeek = new Map();
    for (const row of rows) {
      const start = weekStart(row.date);
      if (!Number.isFinite(start) || start >= currentWeek || !row.key || !Number.isFinite(row.results) || row.results < 0 || !(row.volume > 0) || !Number.isFinite(row.volume)) continue;
      let group = byWeek.get(start);
      if (!group) byWeek.set(start, group = { reps: new Map(), total: empty() });
      let rep = group.reps.get(row.key);
      if (!rep) group.reps.set(row.key, rep = { key: row.key, name: row.name, ...empty() });
      add(rep, row);
      add(group.total, row);
    }
    return byWeek;
  }

  function recent(byWeek, count) {
    return [...byWeek.keys()].sort((a,b) => b-a).slice(0,count);
  }

  function distance(point, targetRate) {
    if (!point?.volume || !Number.isFinite(targetRate)) return null;
    const target = Math.ceil(targetRate * point.volume - 1e-9);
    return { target, count: point.results - target };
  }

  function compare(byWeek, start, baselineWeeks, goal) {
    const current = byWeek.get(start);
    if (!current) return null;
    const prior = byWeek.get(start - week);
    const before = rate(prior?.total);
    const after = rate(current.total);
    const delta = after - before;
    const teamMidpoint = (before + after) / 2;
    const keys = new Set([...(prior?.reps.keys() || []), ...current.reps.keys()]);
    const rows = [];
    for (const key of keys) {
      const a = prior?.reps.get(key);
      const b = current.reps.get(key);
      const beforeRate = rate(a), afterRate = rate(b);
      const baseline = empty();
      let normWeeks = 0;
      for (let i = 1; i <= baselineWeeks; i++) {
        const measurement = byWeek.get(start - i * week)?.reps.get(key);
        if (measurement) { add(baseline, measurement); normWeeks++; }
      }
      const norm = rate(baseline);
      const vsNorm = afterRate - norm;
      const classification = !Number.isFinite(vsNorm) ? 'No baseline'
        : vsNorm >= .10 - 1e-12 ? 'Overperformed' : vsNorm <= -.10 + 1e-12 ? 'Underperformed' : 'In-line performance';
      // Midpoint attribution accounts for conversion and opportunity mix, including reps entering or leaving.
      const aShare = (a?.volume || 0) / (prior?.total.volume || 1);
      const bShare = (b?.volume || 0) / current.total.volume;
      const performance = a && b ? (afterRate - beforeRate) * (aShare + bShare) / 2 : 0;
      const mix = (((a ? beforeRate : afterRate) + (b ? afterRate : beforeRate)) / 2 - teamMidpoint) * (bShare - aShare);
      rows.push({ key, name: (b || a).name, current: b, prior: a, beforeRate, afterRate, norm, normWeeks, vsNorm,
        classification, contribution: performance + mix, performance: prior ? performance : NaN, mix,
        goalGap: distance(b, goal), priorGap: distance(b, beforeRate) });
    }
    const sign = delta < 0 ? -1 : 1;
    const drivers = rows.filter(row => row.contribution * sign > 1e-9)
      .sort((a,b) => (b.contribution - a.contribution) * sign || a.name.localeCompare(b.name));
    const deviations = rows.filter(row => row.vsNorm * sign > 1e-9)
      .sort((a,b) => (b.vsNorm - a.vsNorm) * sign || a.name.localeCompare(b.name));
    return { current: current.total, prior: prior?.total, currentReps:current.reps.size, priorReps:prior?.reps.size, before, after, delta, rows, drivers, deviations,
      goalGap: distance(current.total, goal), priorGap: distance(current.total, before),
      performance: rows.reduce((sum,row) => sum + row.performance,0), mix: rows.reduce((sum,row) => sum + row.mix,0) };
  }

  function matchesTopic(record, topic) {
    const term = topics[topic]?.term;
    return !!term && [record.desc, ...(record.types || [])].some(value => String(value || '').toLowerCase().includes(term));
  }

  function coachingCounts(events, topic, start) {
    let current = 0, previous = 0;
    for (const event of events) {
      if (!matchesTopic(event,topic)) continue;
      const eventWeek = weekStart(event.date);
      if (eventWeek === start) current++;
      if (eventWeek === start - week) previous++;
    }
    return {current, previous};
  }

  function coachingOutcome(byWeek, events, topic, end, windowWeeks) {
    const earliest = end - (windowWeeks - 1) * week;
    const lastMeasured = recent(byWeek,1)[0];
    const groups = new Map();
    let pending = 0, insufficient = 0;
    for (const event of events) {
      const start = weekStart(event.date);
      if (!Number.isFinite(start) || start < earliest || start > end || !matchesTopic(event,topic)) continue;
      const key = JSON.stringify([event.key,start]);
      const group = groups.get(key) || { name: event.rep, key: event.key, start, events: [] };
      group.events.push(event);
      groups.set(key, group);
    }
    const cases = [];
    const reps = new Map();
    for (const group of groups.values()) {
      const rep = reps.get(group.key) || { name: group.name, cases: [], records: [] };
      reps.set(group.key,rep);
      if (group.start + 3 * week > end || (lastMeasured !== undefined && group.start + 3 * week > lastMeasured)) {
        pending += group.events.length;
        rep.records.push({...group, status:'Awaiting follow-up'});
        continue;
      }
      const before = empty(), after = empty();
      for (let i=1; i<=3; i++) {
        const a = byWeek.get(group.start - i * week)?.reps.get(group.key);
        const b = byWeek.get(group.start + i * week)?.reps.get(group.key);
        if (a) add(before,a);
        if (b) add(after,b);
      }
      if (!before.volume || !after.volume) {
        insufficient += group.events.length;
        rep.records.push({...group, status:'Missing measured before or after weeks'});
        continue;
      }
      // The smaller measured side limits how much a before/after pair can influence the average.
      const sample = { ...group, before, after, weight: Math.min(before.volume,after.volume) };
      cases.push(sample);
      rep.cases.push(sample);
      rep.records.push(sample);
    }
    return { ...summarize(cases), pending, insufficient,
      reps: [...reps.values()].map(rep => ({name:rep.name, ...summarize(rep.cases), records:rep.records.sort((a,b)=>b.start-a.start)}))
        .sort((a,b) => Number.isFinite(b.delta) - Number.isFinite(a.delta) || b.delta - a.delta || a.name.localeCompare(b.name)) };
  }

  function summarize(cases) {
    let before = 0, after = 0, weight = 0, coachingCount = 0;
    for (const sample of cases) {
      before += rate(sample.before) * sample.weight;
      after += rate(sample.after) * sample.weight;
      weight += sample.weight;
      coachingCount += sample.events.length;
    }
    return { cases, coachingCount, before:before/weight, after:after/weight, delta:(after-before)/weight };
  }

  return Object.freeze({ topics, weekStart, week, day, index, recent, rate, compare, coachingCounts, coachingOutcome });
});
