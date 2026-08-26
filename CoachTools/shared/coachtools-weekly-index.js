(function attachCoachToolsWeeklyIndex(root) {
  'use strict';

  const VERSION = '1.1.0';
  const DATE_FIELDS = Object.freeze([
    'Date', 'Business Date', 'Reporting Date', 'Report Date', 'Day',
    'Week', 'Week Start', 'Week Starting', 'Week Beginning',
    'Week End', 'Week Ending', 'Period Start', 'Period End'
  ]);
  const REPRESENTATIVE_FIELDS = Object.freeze([
    'Representative', 'Representative Name', 'Associate Name', 'Agent Name',
    'AgentName', 'Associate', 'Rep', 'Employee', 'CSR/SSR Name', 'CSR Name', 'SSR Name', 'Name'
  ]);

  function clean(value) { return String(value == null ? '' : value).trim().replace(/\s+/g, ' '); }
  function validUtcDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
  }
  function yearValue(value) {
    const year = Number(value);
    return year < 100 ? year + (year >= 70 ? 1900 : 2000) : year;
  }
  function dateFromMatch(match, order) {
    if (!match) return null;
    return order === 'ymd'
      ? validUtcDate(Number(match[1]), Number(match[2]), Number(match[3]))
      : validUtcDate(yearValue(match[3]), Number(match[1]), Number(match[2]));
  }
  function dateFromDateObject(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
    if (value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0) {
      return validUtcDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0) {
      return validUtcDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
    }
    return validUtcDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  function isoWeekDate(year, week) {
    if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;
    const januaryFourth = new Date(Date.UTC(year, 0, 4));
    const mondayOffset = (januaryFourth.getUTCDay() + 6) % 7;
    const monday = new Date(januaryFourth);
    monday.setUTCDate(januaryFourth.getUTCDate() - mondayOffset + (week - 1) * 7);
    return monday;
  }
  function parseBusinessDate(value, fallbackParser) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return dateFromDateObject(value);
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 0 && value < 100000) return dateFromDateObject(new Date(Date.UTC(1899, 11, 30) + value * 86400000));
      if (value > 1e11) return dateFromDateObject(new Date(value));
    }
    const raw = clean(value);
    if (!raw) return null;
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
      const numeric = Number(raw);
      if (numeric > 0 && numeric < 100000) return dateFromDateObject(new Date(Date.UTC(1899, 11, 30) + numeric * 86400000));
      if (numeric > 1e11) return dateFromDateObject(new Date(numeric));
    }
    const isoWeek = raw.match(/\b(\d{4})-?W(\d{1,2})\b/i);
    if (isoWeek) return isoWeekDate(Number(isoWeek[1]), Number(isoWeek[2]));
    const iso = raw.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (iso) return dateFromMatch(iso, 'ymd');
    const us = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
    if (us) return dateFromMatch(us, 'mdy');
    if (typeof fallbackParser === 'function') {
      try { return dateFromDateObject(fallbackParser(value)); } catch (_) {}
    }
    const parsed = new Date(raw);
    return dateFromDateObject(parsed);
  }
  function isoDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : '';
  }
  function weekStartKey(value, fallbackParser) {
    const date = parseBusinessDate(value, fallbackParser);
    if (!date) return '';
    const sunday = new Date(date);
    sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay());
    return isoDate(sunday);
  }
  function recordFallbackWeek(record, fallbackParser) {
    const period = record && record.detectedPeriod || {};
    for (const value of [period.start, period.end, period.periodKey, record && record.periodKey, record && record.periodSort]) {
      const week = weekStartKey(value, fallbackParser);
      if (week) return week;
    }
    return '';
  }
  function recordId(record, type) {
    return clean(record && (record.id || record.datasetId || record.fingerprint)) || [
      type,
      clean(record && record.scopeHash),
      clean(record && (record.periodKey || record.periodSort)),
      clean(record && record.importedAt)
    ].join(':');
  }
  function timestamp(value) {
    const stamp = new Date(value || 0).getTime();
    return Number.isFinite(stamp) ? stamp : 0;
  }
  function compareText(left, right) { const a = String(left || ''), b = String(right || ''); return a === b ? 0 : a > b ? 1 : -1; }
  function candidateWins(candidate, current) {
    if (!current) return true;
    if (candidate.recordId && candidate.recordId === current.supersededBy) return true;
    if (current.recordId && current.recordId === candidate.supersededBy) return false;
    if (candidate.replacedDatasetId && candidate.replacedDatasetId === current.recordId) return true;
    if (current.replacedDatasetId && current.replacedDatasetId === candidate.recordId) return false;
    const comparisons = [
      timestamp(candidate.importedAt) - timestamp(current.importedAt),
      Number(candidate.version || 0) - Number(current.version || 0),
      Number(Boolean(candidate.preferredScope)) - Number(Boolean(current.preferredScope)),
      Number(Boolean(candidate.preferredRecord)) - Number(Boolean(current.preferredRecord)),
      compareText(candidate.periodSort, current.periodSort),
      compareText(candidate.recordId, current.recordId)
    ];
    return comparisons.find(value => value !== 0) > 0;
  }
  function plainPoint(point) {
    const metrics = {};
    for (const key of ['consumer', 'insurance', 'commercial', 'wiper']) {
      const metric = point && point[key];
      if (metric) metrics[key] = { num: metric.num, den: metric.den, value: metric.value };
    }
    return { week: point.week, source: point.type, datasetId: point.recordId, scopeHash: point.scopeHash, metrics };
  }
  function createPersonDiagnostic(personId) {
    return {
      personId, rawRows: 0, fallbackRows: 0, deduplicatedCandidates: 0,
      recordIds: new Set(), legacyRecordPoints: new Set(), rowDates: new Set(), calculatedWeeks: new Set(), sources: new Set()
    };
  }
  function rejectedRow(diagnostics, reason, detail) {
    diagnostics.rejected[reason] = (diagnostics.rejected[reason] || 0) + 1;
    if (diagnostics.rejectedRows.length < 250) diagnostics.rejectedRows.push({ reason, ...detail });
  }
  function aggregateMetric(points, metricKey) {
    let num = 0, den = 0;
    const used = [];
    for (const point of points || []) {
      const metric = point && point[metricKey];
      if (!metric || !Number.isFinite(metric.num) || !Number.isFinite(metric.den) || metric.den <= 0) continue;
      num += metric.num;
      den += metric.den;
      used.push({ value: metric.value, label: point.label, sort: point.sort, week: point.week, date: point.date, num: metric.num, den: metric.den });
    }
    return { value: den > 0 ? num / den : NaN, num, den, volume: den, points: used };
  }
  function build(options) {
    const opts = options || {};
    if (typeof opts.extract !== 'function' || typeof opts.pick !== 'function' || typeof opts.resolvePerson !== 'function' || typeof opts.metricFromRows !== 'function') {
      throw new Error('CoachToolsWeeklyIndex requires extract, pick, resolvePerson, and metricFromRows callbacks.');
    }
    const dateFields = Array.isArray(opts.dateFields) && opts.dateFields.length ? opts.dateFields : DATE_FIELDS;
    const repFields = Array.isArray(opts.representativeFields) && opts.representativeFields.length ? opts.representativeFields : REPRESENTATIVE_FIELDS;
    const diagnostics = { sourceRecordsScanned: 0, rawRowsFound: 0, acceptedRows: 0, finalPoints: 0, rejected: {}, rejectedRows: [], datasetIds: new Set(), byPerson: new Map() };
    const candidates = new Map(), seenRecordKeys = new Set();
    for (const source of opts.sources || []) {
      const type = clean(source && source.type);
      if (!type) continue;
      const department = source.department || (type === 'weeklyReferral' ? 'Referral' : 'Retail');
      for (const record of source.records || []) {
        if (!record || typeof record !== 'object' || record.supersededBy) continue;
        const id = recordId(record, type), uniqueRecordKey = `${type}|${id}`;
        if (seenRecordKeys.has(uniqueRecordKey)) continue;
        seenRecordKeys.add(uniqueRecordKey);
        diagnostics.sourceRecordsScanned += 1;
        diagnostics.datasetIds.add(id);
        const fallbackWeek = recordFallbackWeek(record, opts.parseDate), groups = new Map();
        for (const pack of opts.extract(record) || []) for (const row of pack.rows || []) {
          diagnostics.rawRowsFound += 1;
          const rawName = opts.pick(row, repFields), name = clean(rawName);
          if (!name) { rejectedRow(diagnostics, 'identity-missing', { datasetId: id, source: type, rawName: '' }); continue; }
          const rawDate = opts.pick(row, dateFields), hasRowDate = clean(rawDate) !== '';
          const date = hasRowDate ? parseBusinessDate(rawDate, opts.parseDate) : null;
          if (hasRowDate && !date) { rejectedRow(diagnostics, 'date-invalid', { datasetId: id, source: type, rawName: name, rawDate: clean(rawDate) }); continue; }
          const week = date ? weekStartKey(date) : fallbackWeek;
          if (!week) { rejectedRow(diagnostics, 'date-missing', { datasetId: id, source: type, rawName: name, rawDate: clean(rawDate) }); continue; }
          const resolved = opts.resolvePerson({ rawName: name, row, pack, record, type, department, date, week });
          const personId = clean(resolved && typeof resolved === 'object' ? resolved.personId : resolved);
          if (!personId) { rejectedRow(diagnostics, 'identity-unresolved', { datasetId: id, source: type, rawName: name, rawDate: clean(rawDate), week }); continue; }
          const groupKey = `${personId}|${week}`;
          if (!groups.has(groupKey)) groups.set(groupKey, { personId, week, rows: [] });
          groups.get(groupKey).rows.push(row);
          if (!diagnostics.byPerson.has(personId)) diagnostics.byPerson.set(personId, createPersonDiagnostic(personId));
          const personDiagnostic = diagnostics.byPerson.get(personId);
          personDiagnostic.rawRows += 1;
          if (!date) personDiagnostic.fallbackRows += 1;
          if (date) personDiagnostic.rowDates.add(isoDate(date));
          personDiagnostic.calculatedWeeks.add(week);
          personDiagnostic.recordIds.add(id);
          personDiagnostic.legacyRecordPoints.add(`${type}|${id}`);
          personDiagnostic.sources.add(type);
          diagnostics.acceptedRows += 1;
        }
        for (const group of groups.values()) {
          const metrics = opts.metricFromRows(group.rows, type) || {};
          const date = new Date(`${group.week}T00:00:00.000Z`);
          const candidate = {
            type, department, week: group.week, label: group.week, sort: group.week, date,
            recordId: id, scopeHash: clean(record.scopeHash), importedAt: record.importedAt || '',
            version: Number(record.version) || 0, periodSort: record.periodSort || record.periodKey || '',
            replacedDatasetId: record.replacedDatasetId || '', supersededBy: record.supersededBy || '',
            preferredRecord: Boolean(source.preferredRecordId && id === source.preferredRecordId),
            preferredScope: Boolean(source.preferredScopeHash && clean(record.scopeHash) === clean(source.preferredScopeHash)),
            ...metrics
          };
          const key = `${group.personId}|${type}|${group.week}`, current = candidates.get(key);
          if (!current || candidateWins(candidate, current)) {
            if (current) diagnostics.byPerson.get(group.personId).deduplicatedCandidates += 1;
            candidates.set(key, candidate);
          } else diagnostics.byPerson.get(group.personId).deduplicatedCandidates += 1;
        }
      }
    }
    const byPerson = new Map();
    for (const [key, point] of candidates) {
      const personId = key.slice(0, key.indexOf('|'));
      if (!byPerson.has(personId)) byPerson.set(personId, []);
      byPerson.get(personId).push(point);
    }
    for (const points of byPerson.values()) points.sort((left, right) => left.sort.localeCompare(right.sort) || left.type.localeCompare(right.type));
    diagnostics.finalPoints = candidates.size;
    function inspect(personId) {
      const detail = diagnostics.byPerson.get(personId);
      const points = byPerson.get(personId) || [];
      if (!detail) return null;
      return {
        personId,
        sourceRecordsScanned: detail.recordIds.size,
        legacyDatasetLevelPoints: detail.legacyRecordPoints.size,
        rawKpiRows: detail.rawRows,
        rowsUsingRecordPeriodFallback: detail.fallbackRows,
        distinctRowDates: Array.from(detail.rowDates).sort(),
        distinctCalculatedWeeks: Array.from(detail.calculatedWeeks).sort(),
        finalWeeksAfterDeduplication: Array.from(new Set(points.map(point => point.week))).sort(),
        sourceDatasetIds: Array.from(detail.recordIds).sort(),
        sources: Array.from(detail.sources).sort(),
        deduplicatedCandidates: detail.deduplicatedCandidates,
        weeklyMetrics: points.map(plainPoint)
      };
    }
    return { byPerson, diagnostics, inspect };
  }

  root.CoachToolsWeeklyIndex = Object.freeze({
    VERSION, DATE_FIELDS, REPRESENTATIVE_FIELDS,
    parseBusinessDate, weekStartKey, recordFallbackWeek, aggregateMetric, build,
    _test: Object.freeze({ candidateWins, isoWeekDate })
  });
})(typeof window !== 'undefined' ? window : globalThis);
