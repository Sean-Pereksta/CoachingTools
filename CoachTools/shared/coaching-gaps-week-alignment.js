(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.CoachToolsGapsWeeks = api;
    const doc = root.document;
    if (doc?.querySelector('meta[name="coachtools-id"]')?.content !== 'coaching-gaps') return;
    const start = () => {
      if (!api.install(root)) return;
      // Rebuild from raw dates, never shift already-computed week keys or stored reports.
      // This also covers the case where the initial async boot finished before this extension.
      Promise.resolve(root.CoachToolsAppData.getMany(['weeklyRetail', 'weeklyReferral', 'qa', 'documentedCoaching', 'checklist'])).then(() => {
        const button = doc.getElementById('loadDocksBtn');
        if (!button) throw new Error('The Coaching Gaps data reload control was not found.');
        button.click();
        doc.body.dataset.weekBasis = 'sunday-saturday';
      }).catch(error => {
        root.console.error('[Coaching Gaps] Sunday-week alignment reload failed.', error);
        const hint = doc.getElementById('dockHint');
        if (hint) hint.textContent = 'Week alignment is updated, but data could not be refreshed. Reload Coaching Gaps before using this report.';
      });
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const valid = date => date instanceof Date && Number.isFinite(date.getTime());
  function dayUTC(date) {
    return valid(date) ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) : null;
  }
  function weekStartUTC(date) {
    const day = dayUTC(date);
    if (!day) return null;
    day.setUTCDate(day.getUTCDate() - day.getUTCDay());
    return day;
  }
  function keyFromSundayUTC(sunday) {
    // Keep the existing YYYY-Wnn key shape. It encodes the ISO Monday immediately
    // AFTER this Sunday; all seven business-week dates therefore have one key.
    const thursday = new Date(sunday.getTime() + 4 * DAY);
    const year = thursday.getUTCFullYear();
    const week = Math.ceil(((thursday - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
    return year + '-W' + String(week).padStart(2, '0');
  }
  function weekKey(date) {
    const sunday = weekStartUTC(date);
    return sunday ? keyFromSundayUTC(sunday) : '—';
  }
  function weekStartFromKey(key) {
    const match = /^(\d{4})-W(\d{1,2})$/.exec(String(key || ''));
    if (!match || +match[1] < 100 || +match[2] < 1 || +match[2] > 53) return null;
    const year = +match[1], week = +match[2], jan4 = new Date(Date.UTC(year, 0, 4));
    const sunday = new Date(Date.UTC(year, 0, 4 - (jan4.getUTCDay() || 7) + (week - 1) * 7));
    return keyFromSundayUTC(sunday) === year + '-W' + String(week).padStart(2, '0') ? sunday : null;
  }
  function labelUTC(date) { return (date.getUTCMonth() + 1) + '/' + date.getUTCDate() + '/' + date.getUTCFullYear(); }
  function weekLabel(key) {
    const sunday = weekStartFromKey(key);
    return sunday ? labelUTC(sunday) : '—';
  }
  function weekRange(key) {
    const sunday = weekStartFromKey(key);
    return sunday ? labelUTC(sunday) + ' – ' + labelUTC(new Date(sunday.getTime() + 6 * DAY)) : '—';
  }
  function listWeeks(start, end) {
    const firstDay = dayUTC(start), lastDay = dayUTC(end);
    if (!firstDay || !lastDay || firstDay > lastDay) return [];
    const first = weekStartUTC(start), last = weekStartUTC(end), out = [];
    for (let date = first; date <= last; date = new Date(date.getTime() + 7 * DAY)) {
      // Never pass a UTC midnight iterator to a function using local date getters.
      out.push(keyFromSundayUTC(date));
    }
    return out;
  }
  function install(root) {
    if (root.isoWeekKey === weekKey) return false;
    if (typeof root.isoWeekKey !== 'function' || typeof root.loadStats !== 'function') throw new Error('Coaching Gaps must finish loading before installing its business-week calendar.');
    root.isoWeekKey = weekKey;
    root.isoWeekStartUTC = weekStartUTC;
    root.listIsoWeeksBetween = listWeeks;
    root.reportWeekStart = weekStartFromKey;
    root.reportWeekLabel = weekLabel;
    root.reportWeekRange = weekRange;
    return true;
  }
  return { weekKey, weekStartUTC, weekStartFromKey, weekLabel, weekRange, listWeeks, install };
});
