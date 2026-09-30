/* Worksheet source exports use the Weekly Data Builder engine, including its review holds. */
(function (root) {
  'use strict';
  const C = root.WeeklyCore || (typeof require === 'function' ? require('./weekly-data-builder-core.js') : null);
  const segments = ['Consumer', 'Insurance', 'Commercial', 'Total'];
  const header = ['Date', 'Sheet', 'Name', 'Manager', ...segments.flatMap(s => [s+' Opportunities', s+' Appointments', s+' Appointment Rate']), 'Wipers Accepted', 'Wipers Offered', 'Wiper Rate'];
  const emptyAppointments = [['Coach','Name','Consumer Opportunities','Consumer Appointments']];
  const emptyWipers = [['Coach','Name','Wipers Accepted','Wipers Offered']];
  function metric(stats, segment) {
    const num = stats[segment+'.appointments'], den = stats[segment+'.opportunities'];
    const direct = stats[segment+'.appointment_rate'];
    return {num, den, value: Number.isFinite(num) && Number.isFinite(den) ? (den > 0 ? num / den : NaN) : direct};
  }
  function importSources(sources, options = {}) {
    if (!C) throw new Error('The Weekly Data Builder reader is unavailable. Reopen the app.');
    const result = C.assemble({
      appointmentRows: sources.appointments?.rows || emptyAppointments,
      wiperRows: sources.wipers?.rows || emptyWipers,
      weeklyRows: [header], date: '2000-01-02',
      options: { appointmentPeriod: sources.appointments?.period || '', wiperPeriod: sources.wipers?.period || '', includeWiperOnly: true, allowEmptyAppointments: true }
    });
    const rows = result.newRecords.map(record => {
      const stats = {};
      result.mapping.forEach(m => { if(m.key) stats[m.key] = record.values[m.index] === '' ? NaN : Number(record.values[m.index]); });
      const metrics = {};
      for (const s of ['consumer','insurance','commercial']) metrics[s] = metric(stats, s);
      const num = stats['wiper.accepted'], den = stats['wiper.offered'];
      metrics.wiper = {num, den, value: Number.isFinite(num) && Number.isFinite(den) ? (den > 0 ? num / den : NaN) : stats['wiper.rate']};
      for (const [id, data] of Object.entries(metrics)) {
        if (![data.num, data.den, data.value].some(Number.isFinite)) { delete metrics[id]; continue; }
        data.points = [{week:'undated', ...data}]; data.trend = NaN; data.coverage = 1;
      }
      return { key: C.nameKey(record.name)+'\u001f'+C.nameKey(record.coach), name:record.name, coach:record.coach, manager:record.values[3], metrics, stats, weeks:new Set(), kind:record.kind };
    });
    const selected = options.coach && options.coach !== '__ALL__' ? rows.filter(r => C.nameKey(r.coach) === C.nameKey(options.coach)) : rows;
    return { rows:selected, allRows:rows, result, diagnostics: {
      allNames:rows.length, rosterNames:selected.length, matchedNames:selected.filter(r=>Object.keys(r.metrics).length).length,
      namesWithoutMetrics:selected.filter(r=>!Object.keys(r.metrics).length).length,
      coachFieldsObserved:rows.filter(r=>r.coach).length, rosterSource:'selected source exports', coachMatchCount:selected.length,
      rowsInWindow:rows.length, sourceImport:true, review:result.review, stats:result.stats
    }};
  }
  const api = {importSources, header};
  root.CoachToolsScorecardSourceImport = api;
  if(typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
