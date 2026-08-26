'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = { console, Date, Map, Set };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'shared', 'coachtools-weekly-index.js'), 'utf8'), context, { filename: 'coachtools-weekly-index.js' });

const weekly = context.CoachToolsWeeklyIndex;
const header = value => String(value || '').toLowerCase().replace(/[^a-z0-9%]/g, '');
function pick(row, names) {
  const lookup = new Map(Object.keys(row || {}).map(key => [header(key), key]));
  for (const name of names || []) { const key = lookup.get(header(name)); if (key != null) return row[key]; }
  return undefined;
}
function metricFromRows(rows, type) {
  const sum = key => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const consumerAppointments = sum('Consumer Appointments'), consumerOpportunities = sum('Consumer Opportunities');
  const insuranceAppointments = sum('Insurance Appointments'), insuranceOpportunities = sum('Insurance Opportunities');
  const commercialAppointments = sum('Commercial Appointments'), commercialOpportunities = sum('Commercial Opportunities');
  const wiperNumerator = type === 'weeklyReferral' ? sum('Wipers Accepted') : sum('Wiper Count');
  const wiperDenominator = type === 'weeklyReferral' ? sum('Wipers Asked') : sum('Wiper Jobs');
  return {
    consumer: { num: consumerAppointments, den: consumerOpportunities, value: consumerOpportunities ? consumerAppointments / consumerOpportunities : NaN },
    insurance: { num: insuranceAppointments, den: insuranceOpportunities, value: insuranceOpportunities ? insuranceAppointments / insuranceOpportunities : NaN },
    commercial: { num: commercialAppointments, den: commercialOpportunities, value: commercialOpportunities ? commercialAppointments / commercialOpportunities : NaN },
    wiper: { num: wiperNumerator, den: wiperDenominator, value: wiperDenominator ? wiperNumerator / wiperDenominator : NaN }
  };
}
function record(id, rows, options) {
  const opts = options || {};
  return {
    id,
    rows,
    detectedPeriod: opts.detectedPeriod || { start: '2026-08-24', end: '2026-08-30', label: 'Aug 24–30' },
    periodKey: opts.periodKey || '2026-W35',
    periodSort: opts.periodSort || '2026-08-24',
    importedAt: opts.importedAt || '2026-08-31T12:00:00.000Z',
    scopeHash: opts.scopeHash || 'scope-all',
    version: opts.version || 1,
    replacedDatasetId: opts.replacedDatasetId || '',
    supersededBy: opts.supersededBy || ''
  };
}
function sunday(index) {
  const date = new Date(Date.UTC(2026, 4, 31 + index * 7));
  return date.toISOString().slice(0, 10);
}
function row(personId, name, week, appointments, opportunities, extra) {
  return { PersonId: personId, Representative: name, Date: week, 'Consumer Appointments': appointments, 'Consumer Opportunities': opportunities, ...(extra || {}) };
}
function build(retailRecords, referralRecords, resolver) {
  const sources = [];
  if (retailRecords) sources.push({ type: 'weeklyRetail', records: retailRecords, preferredRecordId: retailRecords.at(-1)?.id, preferredScopeHash: 'scope-all' });
  if (referralRecords) sources.push({ type: 'weeklyReferral', records: referralRecords, preferredRecordId: referralRecords.at(-1)?.id, preferredScopeHash: 'scope-all' });
  return weekly.build({
    sources,
    extract: sourceRecord => [{ sheet: sourceRecord.sheet || '', rows: sourceRecord.rows || [] }],
    pick,
    resolvePerson: resolver || (({ row: sourceRow }) => sourceRow.PersonId || ''),
    metricFromRows
  });
}

function run() {
  const eightRows = Array.from({ length: 8 }, (_, index) => row('rep-one', 'Representative One', sunday(index), index + 1, 20));
  const eightWeek = build([record('multi-week-current', eightRows)]);
  assert.strictEqual(eightWeek.byPerson.get('rep-one').length, 8, 'One stored workbook containing eight dated weeks must produce eight Scorecard points.');
  assert.strictEqual(eightWeek.inspect('rep-one').legacyDatasetLevelPoints, 1);
  assert.deepStrictEqual(Array.from(eightWeek.inspect('rep-one').finalWeeksAfterDeduplication), eightRows.map(item => item.Date));

  const twoRepRows = [];
  for (let index = 0; index < 5; index += 1) {
    twoRepRows.push(row('rep-a', 'Representative A', sunday(index), 5, 10));
    twoRepRows.push(row('rep-b', 'Representative B', sunday(index), 7, 10));
  }
  const twoReps = build([record('two-reps-five-weeks', twoRepRows)]);
  assert.strictEqual(twoReps.byPerson.get('rep-a').length, 5);
  assert.strictEqual(twoReps.byPerson.get('rep-b').length, 5);

  const weighted = build([record('weighted', [row('rep-weighted', 'Weighted Rep', sunday(0), 1, 2), row('rep-weighted', 'Weighted Rep', sunday(1), 9, 100)])]);
  const weightedResult = weekly.aggregateMetric(weighted.byPerson.get('rep-weighted'), 'consumer');
  assert.strictEqual(weightedResult.num, 10);
  assert.strictEqual(weightedResult.den, 102);
  assert(Math.abs(weightedResult.value - 10 / 102) < 1e-12, 'The window must sum numerator and denominator rather than average weekly percentages.');

  const retailRates = build([record('retail-rates', [
    row('rep-rates', 'Rate Rep', '2026-08-23', 20, 39, { 'Insurance Appointments': 11, 'Insurance Opportunities': 13, 'Commercial Appointments': 4, 'Commercial Opportunities': 7 }),
    row('rep-rates', 'Rate Rep', '2026-08-23', 5, 20, { 'Insurance Appointments': 15, 'Insurance Opportunities': 15, 'Commercial Appointments': 5, 'Commercial Opportunities': 6 })
  ])]);
  const ratePoints = retailRates.byPerson.get('rep-rates');
  assert.strictEqual(weekly.aggregateMetric(ratePoints, 'consumer').value, 25 / 59, 'Consumer AR should be total appointments divided by total opportunities.');
  assert.strictEqual(weekly.aggregateMetric(ratePoints, 'insurance').value, 26 / 28, 'Insurance AR should be total appointments divided by total opportunities.');
  assert.strictEqual(weekly.aggregateMetric(ratePoints, 'commercial').value, 9 / 13, 'Commercial AR should be total appointments divided by total opportunities.');

  const original = record('original-week', [row('rep-corrected', 'Corrected Rep', sunday(0), 2, 10)], { importedAt: '2026-06-08T00:00:00.000Z', supersededBy: 'corrected-week' });
  const corrected = record('corrected-week', [row('rep-corrected', 'Corrected Rep', sunday(0), 8, 10)], { importedAt: '2026-06-09T00:00:00.000Z', version: 2, replacedDatasetId: 'original-week' });
  const replacement = build([original, corrected]);
  assert.strictEqual(replacement.byPerson.get('rep-corrected').length, 1);
  assert.strictEqual(replacement.byPerson.get('rep-corrected')[0].consumer.num, 8, 'Only the corrected active week should survive.');

  const overlapRecord = record('current-and-history', [row('rep-overlap', 'Overlap Rep', sunday(0), 4, 10)]);
  const overlap = build([overlapRecord, { ...overlapRecord, rows: overlapRecord.rows.map(item => ({ ...item })) }]);
  assert.strictEqual(overlap.byPerson.get('rep-overlap').length, 1, 'A current record repeated in history must not count twice.');

  const older = record('older-history', [row('rep-combined', 'Combined Rep', sunday(0), 2, 10), row('rep-combined', 'Combined Rep', sunday(1), 3, 10)], { importedAt: '2026-06-15T00:00:00.000Z' });
  const current = record('multi-current', [row('rep-combined', 'Combined Rep', sunday(1), 7, 10), row('rep-combined', 'Combined Rep', sunday(2), 5, 10), row('rep-combined', 'Combined Rep', sunday(3), 6, 10)], { importedAt: '2026-07-01T00:00:00.000Z', version: 2 });
  const combined = build([older, current]);
  assert.strictEqual(combined.byPerson.get('rep-combined').length, 4);
  assert.strictEqual(combined.byPerson.get('rep-combined').find(point => point.week === sunday(1)).consumer.num, 7, 'The newer overlapping source should win deterministically.');

  const missing = build([record('missing-week', [0, 1, 3, 4].map(index => row('rep-missing', 'Missing Week Rep', sunday(index), 5, 10)))]);
  assert.deepStrictEqual(Array.from(missing.byPerson.get('rep-missing'), point => point.week), [0, 1, 3, 4].map(sunday), 'A missing business week must not be fabricated.');

  const transfer = build([record('coach-transfer', [
    row('rep-transfer', 'Transfer Rep', sunday(0), 4, 10, { Coach: 'Old Coach' }),
    row('rep-transfer', 'Transfer Rep', sunday(1), 6, 10, { Coach: 'New Coach' })
  ])], null, ({ row: sourceRow }) => sourceRow.PersonId);
  assert.strictEqual(transfer.byPerson.get('rep-transfer').length, 2, 'Coach metadata must not become the permanent historical identity key.');

  const duplicateNames = build([record('duplicate-names', [
    row('person-alpha', 'Same Display Name', sunday(0), 2, 10, { Email: 'alpha@example.test' }),
    row('person-beta', 'Same Display Name', sunday(0), 8, 10, { Email: 'beta@example.test' }),
    row('person-alpha', 'Same Display Name', sunday(1), 3, 10, { Email: 'alpha@example.test' }),
    row('person-beta', 'Same Display Name', sunday(1), 9, 10, { Email: 'beta@example.test' })
  ])], null, ({ row: sourceRow }) => sourceRow.Email.startsWith('alpha') ? 'person-alpha' : 'person-beta');
  assert.strictEqual(duplicateNames.byPerson.get('person-alpha').length, 2);
  assert.strictEqual(duplicateNames.byPerson.get('person-beta').length, 2);
  assert.notStrictEqual(duplicateNames.byPerson.get('person-alpha')[0].consumer.num, duplicateNames.byPerson.get('person-beta')[0].consumer.num);

  const retailReferral = build(
    [record('retail-source', [row('rep-both', 'Both Sources Rep', sunday(0), 4, 10, { 'Wiper Count': 5, 'Wiper Jobs': 10 })])],
    [record('referral-source', [row('rep-both', 'Both Sources Rep', sunday(0), 7, 10, { 'Wipers Accepted': 2, 'Wipers Asked': 10 })])]
  );
  const bothPoints = retailReferral.byPerson.get('rep-both');
  assert.strictEqual(bothPoints.length, 2, 'Retail and Referral must remain separate observations for the same person/week.');
  assert.strictEqual(bothPoints.find(point => point.type === 'weeklyRetail').wiper.value, 0.5);
  assert.strictEqual(bothPoints.find(point => point.type === 'weeklyReferral').wiper.value, 0.2);

  const invalid = build([record('invalid-date', [row('rep-invalid', 'Invalid Date Rep', 'not a date', 5, 10)])]);
  assert.strictEqual(invalid.byPerson.has('rep-invalid'), false);
  assert.strictEqual(invalid.diagnostics.rejected['date-invalid'], 1);
  assert.strictEqual(weekly.weekStartKey('06/01/2026 - 06/07/2026'), '2026-05-31');
  assert.strictEqual(weekly.weekStartKey('2026-W23'), '2026-05-31');
  assert.strictEqual(weekly.weekStartKey('8/23/2026'), '2026-08-23');
  assert.strictEqual(weekly.weekStartKey('8/29/2026'), '2026-08-23');

  console.log('Performance Scorecard weekly-index tests passed.');
}

run();
