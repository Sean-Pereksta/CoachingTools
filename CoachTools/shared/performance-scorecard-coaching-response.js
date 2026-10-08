(function attachScorecardCoachingResponse(root) {
  'use strict';
  const DAY = 86400000;
  function dayKey(value) {
    if (root.CoachToolsWeeklyIndex) return root.CoachToolsWeeklyIndex.reportingDateKey(value);
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      const midnightUtc = !value.getUTCHours() && !value.getUTCMinutes() && !value.getUTCSeconds();
      return midnightUtc ? value.toISOString().slice(0, 10) : `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    const raw = String(value || ''), match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
    if (!match) return '';
    const key = `${match[1]}-${match[2]}-${match[3]}`, date = new Date(`${key}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : '';
  }
  const stamp = key => Date.parse(`${key}T00:00:00Z`);
  const label = key => key ? `${key.slice(5, 7)}/${key.slice(8, 10)}/${key.slice(0, 4)}` : '';
  const percent = value => `${(value * 100).toFixed(1)}%`;
  function aggregate(points) {
    const methods = new Set(points.map(point => point.method)), method = !points.length ? 'none' : methods.size === 1 ? [...methods][0] : 'mixed';
    const weighted = method === 'weighted', num = weighted ? points.reduce((sum, point) => sum + point.num, 0) : NaN, den = weighted ? points.reduce((sum, point) => sum + point.den, 0) : NaN;
    const value = weighted ? num / den : method === 'average' ? points.reduce((sum, point) => sum + point.value, 0) / points.length : NaN;
    return { value, num, den, volume: den, method, weeks: points.length,
      start: points[0]?.week || '', end: points[points.length - 1]?.week || '', points };
  }
  function analyze(options = {}) {
    const groups = new Map(), invalidPeriods = [];
    for (const point of options.points || []) {
      const week = dayKey(point && (point.week || point.sort || point.date));
      const weighted = point && Number.isFinite(point.num) && point.num >= 0 && Number.isFinite(point.den) && point.den > 0;
      const rateOnly = point && !Number.isFinite(point.num) && !Number.isFinite(point.den);
      if (!week || !Number.isFinite(point?.value) || (!weighted && !rateOnly)) {
        invalidPeriods.push({ week, point });
        continue;
      }
      // Multiple sources on the same reporting day are one observed period.
      let group = groups.get(week);
      if (!group) { group = { week, sort: week, date: new Date(`${week}T00:00:00Z`), num: 0, den: 0, rates: [], sourcePoints: [] }; groups.set(week, group); }
      if (weighted) { group.num += point.num; group.den += point.den; } else group.rates.push(point.value);
      group.sourcePoints.push(point);
    }
    const points = [...groups.values()].map(point => ({ ...point,
      method: point.den > 0 ? point.rates.length ? 'mixed' : 'weighted' : 'average',
      value: point.den > 0 ? point.num / point.den : point.rates.reduce((sum, value) => sum + value, 0) / point.rates.length,
      num: point.den > 0 ? point.num : NaN, den: point.den > 0 ? point.den : NaN })).sort((a, b) => a.week.localeCompare(b.week));
    const events = (options.coachings || []).map(coaching => ({ coaching, day: dayKey(coaching?.date) })).filter(event => event.day).sort((a, b) => b.day.localeCompare(a.day));
    const empty = aggregate([]), base = { status: 'insufficient', reason: '', coaching: null, anchor: null, before: empty, after: empty,
      delta: NaN, orientedDelta: NaN, threshold: NaN, matchedWeeks: 0, periods: 0, excludedWeeks: [], excludedPeriods: [], invalidPeriods, summary: '' };
    function finish(result, reason, summary) { return { ...base, ...result, reason, summary: summary || reason }; }
    if (!events.length) return finish({ status: 'no-coaching' }, 'No related dated coaching is available in this history.');
    if (!points.length) return finish({ coaching: events[0].coaching, anchor: events[0].coaching }, 'No valid performance observations are available for a before-and-after comparison.');
    // The caller scopes related coaching to the displayed history calendar.
    // Always anchor its latest event, including one awaiting new observations.
    const lastDay = points[points.length - 1].week, event = events[0];
    if (event.day > lastDay) return finish({ coaching: event.coaching, anchor: event.coaching }, 'No performance observations follow the related coaching yet.');
    const anchorDay = stamp(event.day), excludedWeeks = points.filter(point => Math.abs(stamp(point.week) - anchorDay) < 7 * DAY);
    const beforeCandidates = points.filter(point => stamp(point.week) < anchorDay - 6 * DAY), afterCandidates = points.filter(point => stamp(point.week) > anchorDay + 6 * DAY);
    const requestedMax = Number.isFinite(options.maxWeeks) ? Math.floor(options.maxWeeks) : 4, maxWeeks = Math.max(1, Math.min(4, requestedMax));
    const requestedMin = Number.isFinite(options.minWeeks) ? Math.floor(options.minWeeks) : 2, minWeeks = Math.max(2, requestedMin);
    const matchedWeeks = Math.min(maxWeeks, beforeCandidates.length, afterCandidates.length);
    const beforePoints = matchedWeeks ? beforeCandidates.slice(-matchedWeeks) : [], afterPoints = afterCandidates.slice(0, matchedWeeks);
    const before = aggregate(beforePoints), after = aggregate(afterPoints), result = { coaching: event.coaching, anchor: event.coaching, before, after,
      matchedWeeks, periods: matchedWeeks, excludedWeeks, excludedPeriods: excludedWeeks,
      availableBeforeWeeks: beforeCandidates.length, availableAfterWeeks: afterCandidates.length };
    if (matchedWeeks < minWeeks) return finish(result, `Need at least ${minWeeks} comparable observed periods before and after coaching; found ${beforeCandidates.length} before and ${afterCandidates.length} after.`, `Not enough comparable performance history around coaching on ${label(event.day)}. ${beforeCandidates.length} periods before and ${afterCandidates.length} after; periods touching the coaching date are excluded.`);
    if (before.method === 'mixed' || after.method === 'mixed' || before.method !== after.method) return finish(result, 'The compared periods mix weighted counts with rate-only observations; a consistent before-and-after calculation is unavailable.');
    const hasGap = values => values.some((point, index) => index > 0 && stamp(point.week) - stamp(values[index - 1].week) > 8 * DAY);
    if (hasGap(beforePoints) || hasGap(afterPoints)) return finish(result, 'Performance history has gaps longer than eight days within the compared periods.');
    if (anchorDay - stamp(before.end) > 14 * DAY || stamp(after.start) - anchorDay > 14 * DAY) return finish(result, 'The nearest comparable performance periods are more than two weeks from coaching.');
    const delta = after.value - before.value, orientedDelta = delta * (options.direction === 'lower' ? -1 : 1), threshold = Math.max(.005, Math.abs(before.value) * .03);
    const status = Math.abs(delta) < threshold ? 'stable' : orientedDelta > 0 ? 'improved' : 'declined';
    const change = `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} percentage points`, wording = status === 'stable' ? 'was broadly unchanged' : status;
    const calculationLabel = before.method === 'average' ? 'Average of observed weekly rates' : 'Weighted by observed volume';
    return finish({ ...result, status, delta, orientedDelta, threshold, method: before.method, calculationLabel }, '', `Observed performance ${wording} after coaching on ${label(event.day)}: ${percent(before.value)} before versus ${percent(after.value)} after (${change}), across ${matchedWeeks} observed periods on each side. ${calculationLabel}. This describes an observed change, not proof that coaching caused it.`);
  }
  root.CoachToolsPerformanceScorecardCoachingResponse = Object.freeze({ analyze });
})(typeof window !== 'undefined' ? window : globalThis);
