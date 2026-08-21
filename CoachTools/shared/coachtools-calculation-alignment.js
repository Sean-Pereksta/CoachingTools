(function installCoachToolsCalculationAlignment(root) {
  'use strict';
  if (root.CoachToolsCanonicalMetrics && root.CoachToolsCanonicalMetrics.VERSION === '1.0.0') return;

  const DAY = 86400000;
  const CURRENT_PERIODS = 4;
  const QA_WINDOW_DAYS = 30;
  const clean = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9%]/g, '');
  const mean = values => {
    const valid = (values || []).filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
  };
  const parseNumber = value => {
    if (value == null || value === '') return NaN;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const raw = clean(value), numeric = Number(raw.replace(/[$,%]/g, '').replace(/,/g, ''));
    if (!Number.isFinite(numeric)) return NaN;
    return raw.includes('%') ? numeric / 100 : numeric;
  };
  const parseDate = value => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && value > 0 && value < 100000) return new Date(Date.UTC(1899, 11, 30) + value * DAY);
    if (typeof value === 'number' && value > 1e11) return new Date(value);
    const raw = clean(value); if (!raw) return null;
    const date = new Date(raw); return Number.isNaN(date.getTime()) ? null : date;
  };
  const normalizedMap = row => new Map(Object.keys(row || {}).map(key => [norm(key), key]));
  const pick = (row, candidates) => {
    const map = normalizedMap(row);
    for (const candidate of candidates || []) {
      const key = map.get(norm(candidate));
      if (key != null) return row[key];
    }
    return undefined;
  };
  const pickPattern = (row, candidates, patterns) => {
    const exact = pick(row, candidates);
    if (exact !== undefined) return exact;
    for (const key of Object.keys(row || {})) if ((patterns || []).some(pattern => pattern.test(key))) return row[key];
    return undefined;
  };
  const rowNumber = (row, candidates, patterns) => parseNumber(pickPattern(row, candidates, patterns));
  const sourceIsReferral = (type, record) => /referral/i.test(clean(type || record && record.datasetType));
  const recordDate = record => {
    const period = record && record.detectedPeriod || {};
    return parseDate(period.end || period.start || period.date || record && (record.periodSort || record.importedAt || record.updatedAt));
  };

  const CANONICAL_IDS = Object.freeze({
    cash: 'cash-appointment-rate',
    consumer: 'consumer-appointment-rate',
    referral: 'referral-appointment-rate',
    wiper: 'wiper-rate',
    qa: 'qa-score'
  });

  function canonicalMetricId(metricId) {
    if (metricId === 'consumer-appointment-rate' || metricId === 'appointment-rate') return CANONICAL_IDS.cash;
    return metricId || '';
  }

  function goalForMetric(metricId) {
    const id = canonicalMetricId(metricId);
    if (id === CANONICAL_IDS.qa || id === 'call-quality') return 0.85;
    try {
      const candidates = [
        `coachtools.goal.${id}`,
        `coachtools.kpiGoal.${id}`,
        id === CANONICAL_IDS.cash ? 'coachtools.goal.cash' : '',
        id === CANONICAL_IDS.wiper ? 'coachtools.goal.wipers' : ''
      ].filter(Boolean);
      for (const key of candidates) {
        const raw = root.localStorage && root.localStorage.getItem(key);
        if (raw == null || raw === '') continue;
        let value = Number(String(raw).replace('%', ''));
        if (!Number.isFinite(value)) continue;
        if (value > 1.5) value /= 100;
        if (value >= 0 && value <= 1.5) return value;
      }
    } catch (_) {}
    return NaN;
  }

  function metricTopicPattern(metric) {
    const id = canonicalMetricId(metric && metric.id || metric);
    if (id === CANONICAL_IDS.cash) return /appointment|appt|cash|consumer|\bcar\b/i;
    if (id === CANONICAL_IDS.referral) return /referral.*(appointment|appt)|(appointment|appt).*referral/i;
    if (id === CANONICAL_IDS.wiper) return /wiper|vaps/i;
    if (id === CANONICAL_IDS.qa || id === 'call-quality') return /call.*quality|quality|\bqa\b/i;
    if (id === 'afterpay') return /afterpay/i;
    if (id === 'save-the-sale') return /save.*sale/i;
    if (id === 'insurance-cash') return /insurance.*cash/i;
    if (id === 'solution-rate') return /solution/i;
    if (id === 'aht') return /handle.*time|\baht\b/i;
    return metric && metric.topic instanceof RegExp ? metric.topic : new RegExp(clean(metric && metric.name || id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  function topicMatchesMetric(topic, metric) {
    const pattern = metricTopicPattern(metric);
    return Boolean(pattern && pattern.test(clean(topic)));
  }

  function summarizeWeighted(points, limit) {
    const ordered = (points || []).slice().sort((a, b) => clean(a.sort || a.label).localeCompare(clean(b.sort || b.label)));
    const chosen = ordered.slice(-Math.max(1, Number(limit) || CURRENT_PERIODS));
    const weighted = chosen.filter(point => Number.isFinite(point.value) && Number.isFinite(point.weight) && point.weight > 0);
    if (weighted.length) {
      const weight = weighted.reduce((sum, point) => sum + point.weight, 0);
      return { value: weight ? weighted.reduce((sum, point) => sum + point.value * point.weight, 0) / weight : NaN, weight, points: chosen };
    }
    const values = chosen.map(point => point.value).filter(Number.isFinite);
    return { value: mean(values), weight: values.length, points: chosen };
  }

  function performanceMetricObjects(metrics, mode) {
    const list = metrics || [];
    const byId = id => list.find(metric => metric.id === id) || null;
    return {
      cash: byId(mode === 'intelligence' ? CANONICAL_IDS.consumer : CANONICAL_IDS.cash) || byId('appointment-rate'),
      referral: byId(CANONICAL_IDS.referral),
      wiper: byId(CANONICAL_IDS.wiper)
    };
  }

  function canonicalPerformanceRows(record, resolve, type, extractRows, metrics, mode) {
    if (!record || !record.data || typeof extractRows !== 'function') return [];
    const out = [], metric = performanceMetricObjects(metrics, mode), isReferral = sourceIsReferral(type, record), date = recordDate(record);
    for (const pack of extractRows(record.data)) {
      for (const row of pack.rows || []) {
        const repRaw = pick(row, ['Representative', 'Representative Name', 'Associate Name', 'Associate', 'Agent Name', 'AgentName', 'Agent', 'Employee', 'Rep', 'Rep Name', 'CSR', 'CSR Name', 'SSR', 'SSR Name', 'Name']);
        const coachRaw = pick(row, ['Job Coach', 'Coach Assigned', 'Coach', 'Sheet', 'Team']) || pack.sheet;
        const personId = repRaw ? resolve(repRaw) : resolve(coachRaw);
        if (!personId) continue;
        const role = repRaw ? 'representative' : 'coach';
        const common = { personId, role, datasetType: type || record.datasetType };
        if (date) common.date = date;

        const consumerApps = rowNumber(row, ['Consumer Appointments', 'Consumer Appointment', 'Consumer Apps'], [/^Consumer[_\s-]*Appointments?$/i, /consumer.*appointments?/i]);
        const consumerOpps = rowNumber(row, ['Consumer Opportunities', 'Consumer Opportunity', 'Consumer Opps'], [/^Consumer[_\s-]*Opportunit/i, /consumer.*opportunit/i]);
        const referralApps = rowNumber(row, ['Referral Appointments', 'Referral Appointment', 'Referral Apps'], [/^Referral[_\s-]*Appointments?$/i, /referral.*appointments?/i]);
        const referralOpps = rowNumber(row, ['Referral Opportunities', 'Referral Opportunity', 'Referral Opps'], [/^Referral[_\s-]*Opportunit/i, /referral.*opportunit/i]);

        if (!isReferral && metric.cash && Number.isFinite(consumerApps) && Number.isFinite(consumerOpps) && consumerOpps > 0) {
          out.push({ ...common, metric: metric.cash, value: consumerApps / consumerOpps, weight: consumerOpps, canonicalSource: 'Consumer Appointments / Consumer Opportunities' });
        }
        if (isReferral && metric.referral && Number.isFinite(referralApps) && Number.isFinite(referralOpps) && referralOpps > 0) {
          out.push({ ...common, metric: metric.referral, value: referralApps / referralOpps, weight: referralOpps, canonicalSource: 'Referral Appointments / Referral Opportunities' });
        }

        if ((!isReferral && !(Number.isFinite(consumerApps) && Number.isFinite(consumerOpps) && consumerOpps > 0)) ||
            (isReferral && !(Number.isFinite(referralApps) && Number.isFinite(referralOpps) && referralOpps > 0))) {
          const rate = rowNumber(row,
            isReferral ? ['Referral Appointment Rate', 'Referral Appt Rate'] : ['Consumer Appointment Rate', 'Cash Appointment Rate', 'Cash AR', 'CAR', 'Appointment Rate'],
            isReferral ? [/referral.*(?:appointment|appt).*rate/i] : [/(?:consumer|cash).*(?:appointment|appt).*rate/i, /(?:^|\s)car(?:\s|$)/i]);
          const target = isReferral ? metric.referral : metric.cash;
          if (target && Number.isFinite(rate)) out.push({ ...common, metric: target, value: Math.abs(rate) > 1.5 ? rate / 100 : rate, weight: 0, canonicalSource: 'Explicit rate column' });
        }

        const wiperCount = rowNumber(row, ['Wiper Count'], [/^Wiper[_\s-]*Count$/i, /wiper.*count/i]);
        const wiperJobs = rowNumber(row, ['Wiper Jobs', 'Wiper Job'], [/^Wiper[_\s-]*Jobs?$/i, /wiper.*jobs?/i]);
        const wipersAccept = rowNumber(row, ['Wipers Accept', 'Wiper Accept', 'Wipers Accepted', 'Wiper Accepted'], [/wipers?[_\s-]*accept/i]);
        const wipersAsked = rowNumber(row, ['Wipers Asked', 'Wiper Asked'], [/wipers?[_\s-]*asked/i]);
        let wiperValue = NaN, wiperWeight = NaN, wiperSource = '';
        if (isReferral) {
          if (Number.isFinite(wipersAccept) && Number.isFinite(wipersAsked) && wipersAsked > 0) { wiperValue = wipersAccept / wipersAsked; wiperWeight = wipersAsked; wiperSource = 'Wipers Accepted / Wipers Asked'; }
          else if (Number.isFinite(wiperCount) && Number.isFinite(wiperJobs) && wiperJobs > 0) { wiperValue = wiperCount / wiperJobs; wiperWeight = wiperJobs; wiperSource = 'Wiper Count / Wiper Jobs'; }
        } else {
          if (Number.isFinite(wiperCount) && Number.isFinite(wiperJobs) && wiperJobs > 0) { wiperValue = wiperCount / wiperJobs; wiperWeight = wiperJobs; wiperSource = 'Wiper Count / Wiper Jobs'; }
          else if (Number.isFinite(wipersAccept) && Number.isFinite(wipersAsked) && wipersAsked > 0) { wiperValue = wipersAccept / wipersAsked; wiperWeight = wipersAsked; wiperSource = 'Wipers Accepted / Wipers Asked'; }
        }
        if (metric.wiper && Number.isFinite(wiperValue)) out.push({ ...common, metric: metric.wiper, value: wiperValue, weight: wiperWeight, canonicalSource: wiperSource });
      }
    }
    return out;
  }

  function mergeCanonicalPerformance(baseRows, canonicalRows, type) {
    const replacement = new Set(canonicalRows.map(row => `${row.personId}|${canonicalMetricId(row.metric && row.metric.id)}`));
    const referral = sourceIsReferral(type, null);
    const kept = (baseRows || []).filter(row => {
      const id = canonicalMetricId(row.metric && row.metric.id);
      if (replacement.has(`${row.personId}|${id}`)) return false;
      if (referral && id === CANONICAL_IDS.cash && canonicalRows.some(item => item.personId === row.personId && canonicalMetricId(item.metric && item.metric.id) === CANONICAL_IDS.referral)) return false;
      return true;
    });
    return kept.concat(canonicalRows);
  }

  function canonicalChecklist(record, resolve, extractRows, fallbackParseDate) {
    if (!record || !record.data || typeof extractRows !== 'function') return [];
    const dateParser = fallbackParseDate || parseDate, items = [];
    for (const pack of extractRows(record.data)) for (const row of pack.rows || []) {
      const coach = clean(pick(row, ['Coach Assigned', 'Job Coach', 'Coach', 'Sheet', 'Team']));
      const rep = clean(pick(row, ['Associate Name', 'Associate', 'Representative', 'Agent Name', 'Name', 'CSR Name', 'SSR Name']));
      const created = dateParser(pick(row, ['Created On', 'Created', 'Created At', 'Created Date', 'Created Date Time', 'Incident Date', 'Date']));
      const served = dateParser(pick(row, ['Date Served', 'Served Date', 'Date Completed', 'Completed On', 'Date Serviced', 'Addressed Date', 'Resolved Date']));
      if (!created || !coach || !rep) continue;
      const days = served ? (served.getTime() - created.getTime()) / DAY : NaN;
      items.push({
        coachId: resolve(coach), coach, representativeId: resolve(rep), representative: rep, created, served, days,
        action: clean(pick(row, ['Action Taken', 'Action', 'Status'])) || (served ? 'Served' : 'Open'),
        incident: clean(pick(row, ['Incident', 'Incident Type', 'Incident Category', 'Type', 'Checklist Item'])) || '(unspecified)',
        corrective: clean(pick(row, ['Corrective', 'Corrective Type', 'Corrective Action', 'Corrective Level', 'Discipline'])),
        description: clean(pick(row, ['Description', 'Details', 'Notes', 'Summary']))
      });
    }
    return items;
  }

  function wrapProfiles() {
    const base = root.CoachToolsProfiles;
    if (!base || base.__canonicalCalculationAlignment) return;
    const oldTest = base._test || {}, oldCanonical = oldTest.canonicalizePerformance && oldTest.canonicalizePerformance.bind(oldTest);
    const metrics = (base.METRICS || []).map(metric => {
      if (metric.id === CANONICAL_IDS.cash) return { ...metric, pattern: /(?:cash|consumer).*(?:appointment|appt).*rate|(?:^|[^a-z])car(?:[^a-z]|$)/i };
      if (metric.id === CANONICAL_IDS.referral) return { ...metric, pattern: /referral.*(?:appointment|appt).*rate/i };
      return metric;
    }).sort((a, b) => (a.id === CANONICAL_IDS.referral ? -1 : b.id === CANONICAL_IDS.referral ? 1 : 0));
    const canonicalizePerformance = (record, resolve, type) => {
      const regular = oldCanonical ? oldCanonical(record, resolve) || [] : [];
      const derived = canonicalPerformanceRows(record, resolve, type || record && record.datasetType, oldTest.extractRows, metrics, 'profiles');
      return mergeCanonicalPerformance(regular, derived, type || record && record.datasetType);
    };
    const canonicalizeChecklist = (record, resolve) => canonicalChecklist(record, resolve, oldTest.extractRows, oldTest.parseDate || parseDate);
    root.CoachToolsProfiles = Object.freeze({
      ...base, METRICS: Object.freeze(metrics), __canonicalCalculationAlignment: true,
      _test: Object.freeze({ ...oldTest, canonicalizePerformance, canonicalizeChecklist })
    });
  }

  function wrapIntelligence() {
    const base = root.CoachToolsIntelligence;
    if (!base || base.__canonicalCalculationAlignment) return;
    const oldTest = base._test || {}, oldCanonical = oldTest.canonicalizePerformance && oldTest.canonicalizePerformance.bind(oldTest);
    const canonicalizePerformance = (record, resolve, type) => {
      const regular = oldCanonical ? oldCanonical(record, resolve, type) || [] : [];
      const derived = canonicalPerformanceRows(record, resolve, type || record && record.datasetType, oldTest.extractRows, base.METRICS, 'intelligence');
      return mergeCanonicalPerformance(regular, derived, type || record && record.datasetType);
    };
    const canonicalizeChecklist = (record, resolve) => canonicalChecklist(record, resolve, oldTest.extractRows, oldTest.parseDate || parseDate);
    root.CoachToolsIntelligence = Object.freeze({
      ...base, __canonicalCalculationAlignment: true,
      _test: Object.freeze({ ...oldTest, canonicalizePerformance, canonicalizeChecklist })
    });
  }

  const api = Object.freeze({
    VERSION: '1.0.0', CURRENT_PERIODS, QA_WINDOW_DAYS, CANONICAL_IDS,
    canonicalMetricId, goalForMetric, topicMatchesMetric, summarizeWeighted,
    parseDate, parseNumber, clean, mean, canonicalPerformanceRows, canonicalChecklist,
    wrapProfiles, wrapIntelligence
  });
  root.CoachToolsCanonicalMetrics = api;
  wrapProfiles();
  wrapIntelligence();
})(typeof window !== 'undefined' ? window : globalThis);
