'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('../shared/coachtools-weekly-index.js');
require('../shared/performance-scorecard-coaching-response.js');
const response = globalThis.CoachToolsPerformanceScorecardCoachingResponse;
const point = (week, num, den = 10) => ({ week, date: new Date(`${week}T00:00:00Z`), value: num / den, num, den });
const coaching = { date: new Date('2026-09-12T00:00:00Z'), topics: ['Consumer Appointment Rate'], description: 'Practice asking for the appointment.' };
const beforeDates = ['2026-08-15', '2026-08-22', '2026-08-29', '2026-09-05'];
const afterDates = ['2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10'];
const full = (before = 4, after = 6) => [...beforeDates.map(date => point(date, before)), ...afterDates.map(date => point(date, after))];
const analyze = (points, options = {}) => response.analyze({ points, coachings: [coaching], ...options });

test('coaching response uses weighted counts instead of means of weekly percentages', () => {
  const result = analyze([point('2026-08-29', 1, 2), point('2026-09-05', 9, 100), point('2026-09-19', 4, 10), point('2026-09-26', 8, 10)]);
  assert.equal(result.before.value, 10 / 102); assert.equal(result.after.value, .6);
  assert.equal(result.before.num, 10); assert.equal(result.before.den, 102);
  assert.equal(result.delta, .6 - 10 / 102); assert.equal(result.status, 'improved');
  assert.equal(result.matchedWeeks, 2); assert.match(result.summary, /Observed performance improved/);
  assert.match(result.summary, /2 observed periods on each side/); assert.match(result.summary, /not proof/);
});

test('comparison balances the nearest observed periods, caps at four and preserves chronological evidence', () => {
  const points = full(); points.unshift(point('2026-08-08', 0)); points.push(point('2026-10-17', 10));
  const result = analyze(points);
  assert.equal(result.matchedWeeks, 4); assert.deepEqual(result.before.points.map(row => row.week), beforeDates);
  assert.deepEqual(result.after.points.map(row => row.week), afterDates);
  const short = analyze(points, { maxWeeks: 2 });
  assert.deepEqual(short.before.points.map(row => row.week), beforeDates.slice(-2));
  assert.deepEqual(short.after.points.map(row => row.week), afterDates.slice(0, 2));
  assert.equal(analyze(points, { maxWeeks: 40 }).matchedWeeks, 4);
});

test('periods within six calendar days on either side of the actual coaching date are excluded', () => {
  const points = full();
  for (const date of ['2026-09-06', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-18']) points.push(point(date, 10));
  const result = analyze(points);
  assert.deepEqual(result.excludedWeeks.map(row => row.week), ['2026-09-06', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-18']);
  assert.equal(result.before.value, .4); assert.equal(result.after.value, .6);
  const shifted = analyze(full(), { coachings: [{ ...coaching, date: '2026-09-13' }] });
  assert.ok(shifted.excludedWeeks.some(row => row.week === '2026-09-19'));
  assert.equal(shifted.before.end, '2026-09-05'); assert.equal(shifted.after.start, '2026-09-26');
});

test('zero scores remain observations and metric direction orients improvement', () => {
  const zeros = analyze(full(2, 0));
  assert.equal(zeros.after.value, 0); assert.equal(zeros.after.volume, 40); assert.equal(zeros.status, 'declined');
  const lower = analyze(full(2, 0), { direction: 'lower' });
  assert.equal(lower.status, 'improved'); assert.equal(lower.delta, -.2); assert.equal(lower.orientedDelta, .2);
  assert.equal(analyze(full(0, 0)).status, 'stable');
});

test('same reporting date from multiple sources contributes volume but only one period', () => {
  const result = analyze([point('2026-08-29', 4), point('2026-09-05', 4), point('2026-09-05', 80, 100), point('2026-09-19', 6), point('2026-09-26', 6)]);
  assert.equal(result.before.weeks, 2); assert.equal(result.before.num, 88); assert.equal(result.before.den, 120);
  assert.equal(result.before.value, 88 / 120); assert.equal(result.status, 'declined');
});

test('QA monitor sums and counts preserve monitor weighting across periods', () => {
  const result = analyze([point('2026-08-29', .9, 1), point('2026-09-05', 1.8, 3), point('2026-09-19', 1.8, 2), point('2026-09-26', 2.1, 3)]);
  assert.equal(result.before.value, 2.7 / 4); assert.equal(result.after.value, 3.9 / 5);
  assert.equal(result.after.volume, 5); assert.equal(result.status, 'improved');
});

test('rate-only legacy observations use a disclosed average when all compared periods lack counts', () => {
  const rates = full().map(({ week, value }) => ({ week, value }));
  const result = analyze(rates);
  assert.equal(result.status, 'improved'); assert.equal(result.method, 'average');
  assert.equal(result.before.value, .4); assert.equal(result.after.value, .6);
  assert.ok(Number.isNaN(result.before.den)); assert.equal(result.before.weeks, 4);
  assert.equal(result.calculationLabel, 'Average of observed weekly rates');
  assert.match(result.summary, /Average of observed weekly rates/);
  assert.equal(analyze(rates.map(row => ({ ...row, value: 0, num: NaN, den: NaN }))).status, 'stable');
});

test('mixed counts and rate-only evidence remains insufficient instead of silently dropping rates', () => {
  const points = full(), row = points.pop(); points.push({ week: row.week, value: row.value });
  const result = analyze(points); assert.equal(result.status, 'insufficient');
  assert.match(result.reason, /mix weighted counts with rate-only/); assert.equal(result.after.weeks, 4);
  const split = full().map(row => beforeDates.includes(row.week) ? row : { week: row.week, value: row.value });
  assert.equal(analyze(split).status, 'insufficient');
  const sameDate = [...full(), { week: '2026-09-05', value: .4 }];
  assert.equal(analyze(sameDate).status, 'insufficient');
});

test('one period each side and missing baseline produce insufficient instead of no improvement', () => {
  const one = analyze([point('2026-09-05', 4), point('2026-09-19', 6)]);
  assert.equal(one.status, 'insufficient'); assert.match(one.reason, /at least 2/);
  assert.ok(Number.isNaN(one.delta));
  const missing = analyze(afterDates.map(date => point(date, 6)));
  assert.equal(missing.status, 'insufficient'); assert.match(missing.reason, /0 before/);
  assert.equal(analyze(full(), { minWeeks: 5 }).status, 'insufficient');
});

test('invalid and zero denominator periods are dropped; sparse observed windows stay insufficient', () => {
  const invalid = point('2026-09-05', 0, 0), result = analyze([...full(), { ...invalid, week: 'not-a-date' }, invalid, { ...point('2026-09-19', 4), value: NaN }]);
  assert.equal(result.invalidPeriods.length, 3); assert.equal(result.status, 'improved');
  const gap = analyze(full().filter(row => row.week !== '2026-08-29'));
  assert.equal(gap.status, 'insufficient'); assert.match(gap.reason, /gaps longer than eight days/);
  const remote = analyze([point('2026-08-01', 4), point('2026-08-08', 4), point('2026-09-19', 6), point('2026-09-26', 6)]);
  assert.equal(remote.status, 'insufficient'); assert.match(remote.reason, /more than two weeks/);
});

test('latest dated related coaching is used even if the earlier event has a measurable response', () => {
  const latest = { date: '2026-10-09', topics: ['Appointments'] };
  const result = analyze(full(), { coachings: [coaching, latest, { date: 'bad-date' }] });
  assert.equal(result.coaching, latest); assert.equal(result.status, 'insufficient'); assert.equal(result.availableAfterWeeks, 0);
  const future = { date: '2026-11-01' };
  const futureOnly = analyze(full(), { coachings: [future] });
  assert.equal(futureOnly.status, 'insufficient'); assert.equal(futureOnly.coaching, future); assert.match(futureOnly.reason, /follow.*yet/);
  const newestAwaiting = analyze(full(), { coachings: [coaching, future] });
  assert.equal(newestAwaiting.coaching, future); assert.equal(newestAwaiting.status, 'insufficient');
  assert.match(newestAwaiting.reason, /No performance observations follow/);
});

test('no dated coaching and no metric observations have distinct honest states', () => {
  assert.equal(analyze(full(), { coachings: [] }).status, 'no-coaching');
  assert.equal(analyze(full(), { coachings: [{ date: 'bad-date' }] }).status, 'no-coaching');
  const empty = analyze([]); assert.equal(empty.status, 'insufficient'); assert.match(empty.reason, /No valid performance/);
});

test('classification uses the scorecard absolute and relative thresholds', () => {
  assert.equal(analyze(full(4, 4.04)).status, 'stable');
  assert.equal(analyze(full(9, 9.2)).status, 'stable');
  assert.equal(analyze(full(9, 9.3)).status, 'improved');
});

test('calendar coaching days and exclusion remain stable across timezone and date representations', () => {
  const indexPath = path.resolve(__dirname, '../shared/coachtools-weekly-index.js'), helperPath = path.resolve(__dirname, '../shared/performance-scorecard-coaching-response.js');
  const source = `require(${JSON.stringify(indexPath)});require(${JSON.stringify(helperPath)});const points=${JSON.stringify(full())};console.log(JSON.stringify(['2026-09-12','09/12/2026','2026-09-12T00:00:00Z',new Date('2026-09-12T00:00:00Z'),new Date(2026,8,12)].map(date=>{const r=globalThis.CoachToolsPerformanceScorecardCoachingResponse.analyze({points,coachings:[{date}]});return [r.status,r.before.end,r.after.start,r.matchedWeeks]})));`;
  for (const TZ of ['UTC', 'America/New_York', 'America/Los_Angeles', 'Pacific/Auckland']) {
    const output = execFileSync(process.execPath, ['-e', source], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), Array.from({ length: 5 }, () => ['improved', '2026-09-05', '2026-09-19', 4]), TZ);
  }
});
