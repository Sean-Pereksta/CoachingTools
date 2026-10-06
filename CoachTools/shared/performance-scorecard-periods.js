(function attachScorecardPeriods(root) {
  'use strict';
  const dayKey = value => root.CoachToolsWeeklyIndex.reportingDateKey(value);
  const pointKey = point => dayKey(point && (point.week || point.sort || point.date));
  const dates = values => [...new Set(Array.from(values || [], dayKey).filter(Boolean))].sort().reverse();
  function availableDates(bySource, department) {
    const types = department === 'Retail' ? ['weeklyRetail'] : department === 'Referral' ? ['weeklyReferral'] : ['weeklyRetail', 'weeklyReferral'];
    return dates(types.flatMap(type => Array.from(bySource.get(type) || [])));
  }
  function selection(available, previous) {
    const valid = dates(available);
    return previous == null ? valid.slice(0, 8) : valid.filter(key => previous.has(key));
  }
  function spec(available, selected, department) {
    const all = dates(available), current = selection(all, new Set(selected));
    const oldest = current[current.length - 1] || '';
    const prior = oldest ? all.filter(key => key < oldest).slice(0, current.length) : [];
    return { mode: 'selected', dates: current, priorDates: prior, weeks: current.length,
      start: oldest, end: current[0] || '', completePrior: current.length > 0 && prior.length === current.length,
      key: `${department}|${current.join(',')}|prior:${prior.join(',')}` };
  }
  function pointsFor(points, selected) {
    const keys = new Set(selected);
    return (points || []).filter(point => keys.has(pointKey(point)));
  }
  function aggregate(points) {
    const valid = (points || []).filter(point => Number.isFinite(point.value));
    const weighted = valid.filter(point => Number.isFinite(point.num) && Number.isFinite(point.den) && point.den > 0);
    const num = weighted.reduce((sum, point) => sum + point.num, 0), den = weighted.reduce((sum, point) => sum + point.den, 0);
    return { value: den ? num / den : valid.length ? valid.reduce((sum, point) => sum + point.value, 0) / valid.length : NaN, num, den, points: valid };
  }
  function trend(current, prior, period, higher = true) {
    const currentAgg = aggregate(current), priorAgg = aggregate(prior);
    const found = new Set(priorAgg.points.map(pointKey).filter(Boolean)).size;
    const result = { current: currentAgg.value, prior: priorAgg.value, currentAgg, priorAgg, delta: NaN, status: 'insufficient' };
    if (!period.weeks) return { ...result, reason: 'Select reporting weeks' };
    if (!period.completePrior) return { ...result, reason: `Trend unavailable · Need ${period.weeks} prior weeks, found ${period.priorDates.length}` };
    if (found < period.weeks) return { ...result, reason: `Insufficient prior data · Need ${period.weeks} prior weeks, found ${found}` };
    if (!Number.isFinite(result.current) || !Number.isFinite(result.prior)) return { ...result, reason: 'Insufficient metric data' };
    const delta = result.current - result.prior, threshold = Math.max(.005, Math.abs(result.prior) * .03);
    const status = Math.abs(delta) < threshold ? 'stable' : (higher ? delta > 0 : delta < 0) ? 'improving' : 'declining';
    return { ...result, delta, status };
  }
  function dateLabel(key, year = true) {
    const parts = String(key).split('-');
    return parts.length === 3 ? `${parts[1]}/${parts[2]}${year ? `/${parts[0]}` : ''}` : key;
  }
  function label(selected) {
    return !selected.length ? 'Choose weeks' : selected.length === 1 ? `1 week · ${dateLabel(selected[0])}`
      : selected.length <= 3 ? `${selected.length} weeks · ${selected.map(key => dateLabel(key, false)).join(', ')}` : `${selected.length} weeks selected`;
  }
  // QA is dated daily. Assign each observation to the selected reporting
  // period ending on its source date; never bridge deliberately skipped weeks.
  function qaPeriod(value, reportingDates) {
    const key = dayKey(value);
    if (!key) return '';
    const stamp = Date.parse(`${key}T00:00:00Z`);
    return [...reportingDates].sort().find(end => {
      const distance = Date.parse(`${end}T00:00:00Z`) - stamp;
      return distance >= 0 && distance < 7 * 86400000;
    }) || '';
  }
  root.CoachToolsScorecardPeriods = Object.freeze({ dayKey, pointKey, dates, availableDates, selection, spec, pointsFor, aggregate, trend, dateLabel, label, qaPeriod });
})(typeof window !== 'undefined' ? window : globalThis);
