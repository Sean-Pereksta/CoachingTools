'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const storage = new Map();
const context = {
  console, Date, Math, JSON, setTimeout, clearTimeout,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  addEventListener() {}, removeEventListener() {}
};
context.window = context;
context.globalThis = context;
context.CoachToolsIdentity = {
  normalizeName(value) { return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
};
vm.createContext(context);
for (const file of ['shared/coachtools-profile-data.js', 'shared/coachtools-coaching-alignment.js', 'shared/coachtools-profile-fast-v2.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const Alignment = context.CoachToolsCoachingAlignment;
const Fast = context.CoachToolsProfileFast;

const tiedRank = Fast._test.deterministicRank('coach-a', [
  { coach: { personId: 'coach-z', displayName: 'Zulu' }, value: .5 },
  { coach: { personId: 'coach-a', displayName: 'Alpha' }, value: .5 }
], true);
assert.strictEqual(tiedRank.rank, 1, 'Ranking ties should use a stable coach-name/person-id order.');

assert.strictEqual(Alignment.kpiCoverageThreshold(), .5, 'KPI coverage should default to 50%.');
assert.strictEqual(Alignment.qualityCoverageThreshold(), .25, 'Quality coverage should default to 25%.');
Alignment.setQualityCoverageThreshold(.4);
assert.strictEqual(Alignment.qualityCoverageThreshold(), .4);
assert.strictEqual(Alignment.kpiCoverageThreshold(), .5, 'Changing Quality coverage must not change KPI coverage.');
Alignment.setKpiCoverageThreshold(.6);
assert.strictEqual(Alignment.kpiCoverageThreshold(), .6);
assert.strictEqual(Alignment.qualityCoverageThreshold(), .4, 'Changing KPI coverage must not change Quality coverage.');
Alignment.setKpiCoverageThreshold(.5);
Alignment.setQualityCoverageThreshold(.25);

const topicCases = [
  ['appointment transition', 'cash-appointment'], ['appointment', 'cash-appointment'], ['cash', 'cash-appointment'], ['Cash scheduling', 'cash-appointment'], ['QA review', 'call-quality'],
  ['VAPS offer', 'wipers'], ['Save the Sale', 'save-the-sale'], ['After Pay', 'afterpay'],
  ['Insurance Cash', 'insurance-cash'], ['Solution Rate', 'solution-rate'], ['Average Handle Time', 'aht']
];
for (const [topic, expected] of topicCases) assert.strictEqual(Alignment.categorizeTopic(topic).id, expected, `${topic} should normalize to ${expected}.`);

const asOf = new Date('2026-08-21T23:59:59Z');
const qaProfile = {
  person: { personId: 'rep-qa', displayName: 'John Doe', currentCoachId: 'coach-a' },
  metricDetails: [{ id: 'qa-score', name: 'QA Score', value: .81, percentile: 23, weight: 2, coverage: { measured: 1, available: 1, rate: 1 }, trend: { status: 'declining', earlier: .86, points: [{ value: .86, sort: '2026-07-10' }, { value: .81, sort: '2026-08-20' }] } }],
  qa: { rows: [{ date: new Date('2026-07-10'), score: .86 }, { date: new Date('2026-08-10'), score: .82 }, { date: new Date('2026-08-20'), score: .80 }] },
  coaching: { events: [{ representativeId: 'rep-qa', date: new Date('2026-08-18'), topics: ['Call Quality'], description: 'QA review' }] }
};
const attention = Alignment.attentionFromProfiles([qaProfile, qaProfile], { asOf });
assert.strictEqual(attention.length, 1, 'Repeated processing should retain one active QA concern per representative.');
assert.strictEqual(attention[0].id, 'rep-qa+qa-score');
assert.strictEqual(attention[0].current, .81);
assert.strictEqual(attention[0].prior, .86);
assert.ok(Math.abs(attention[0].delta + .05) < 1e-9);
assert.strictEqual(attention[0].sampleSize, 2);
const staleQa = Alignment.dedupeAttention([
  { personId: 'rep-qa', metricId: 'qa-score', current: .84, severity: 40, dataThrough: new Date('2026-08-20') },
  { personId: 'rep-qa', metricId: 'call-quality', current: .40, severity: 99, dataThrough: new Date('2026-07-01') }
]);
assert.strictEqual(staleQa.length, 1);
assert.strictEqual(staleQa[0].current, .84, 'A stale generated QA signal must not replace newer evidence merely because it was more severe.');

const alignmentInput = {
  asOf,
  roster: [{ personId: 'rep-qa' }, { personId: 'rep-cash' }, { personId: 'rep-wiper' }],
  attention: [
    ...attention,
    { personId: 'rep-cash', personName: 'Jane Doe', metricId: 'cash-appointment-rate', categoryId: 'cash-appointment', category: 'Cash Appointment', severity: 82, percentile: 18, current: .438, prior: .509, delta: -.071 },
    { personId: 'rep-wiper', personName: 'Will Doe', metricId: 'wiper-rate', categoryId: 'wipers', category: 'Wipers', severity: 62, percentile: 29, current: .31, prior: .36, delta: -.05 }
  ],
  coaching: [
    { representativeId: 'rep-qa', date: new Date('2026-08-18'), topics: ['QA review'] },
    { representativeId: 'rep-cash', date: new Date('2026-08-13'), topics: ['Cash appointment'] },
    { representativeId: 'rep-wiper', date: new Date('2026-08-19'), topics: ['VAPS offer'] }
  ]
};
const alignmentA = Alignment.buildAlignment(alignmentInput);
const alignmentB = Alignment.buildAlignment(alignmentInput);
assert.strictEqual(alignmentA.score, alignmentB.score, 'Alignment must be deterministic for the same snapshot.');
assert.strictEqual(alignmentA.recentCoaching.length, 2, 'The coaching window must exclude events older than the last 7 days.');
assert.strictEqual(alignmentA.rows.find(row => row.categoryId === 'call-quality').events.length, 1, 'Quality coaching should map to QA need.');
assert.strictEqual(alignmentA.rows.find(row => row.categoryId === 'wipers').events.length, 1, 'Wiper coaching should map to Wiper need.');
assert.strictEqual(alignmentA.rows.find(row => row.categoryId === 'cash-appointment').status, 'No recent coaching', 'Uncovered Cash need should be detected.');

function weeklyRecord(id, period, rows) {
  return {
    id, datasetType: 'weeklyRetail', fingerprint: id, periodSort: period,
    detectedPeriod: { periodKey: period, label: period },
    data: { workbook: { data: { Retail: { aoa: [
      ['Representative', 'Sheet', 'Consumer Appointments', 'Consumer Opportunities'], ...rows
    ] } } } }
  };
}

(async () => {
  const people = [
    { personId: 'coach-a', displayName: 'Coach Alpha', role: 'coach', department: 'Retail', currentTeam: 'Alpha' },
    { personId: 'coach-b', displayName: 'Coach Beta', role: 'coach', department: 'Retail', currentTeam: 'Beta' },
    { personId: 'coach-c', displayName: 'Coach Charlie', role: 'coach', department: 'Retail', currentTeam: 'Charlie' },
    { personId: 'coach-ghost', displayName: 'Historical Coach', role: 'coach', department: 'Retail', status: 'historical' },
    { personId: 'rep-a1', displayName: 'Alpha One', role: 'representative', department: 'Retail', currentCoachId: 'coach-a' },
    { personId: 'rep-a2', displayName: 'Alpha Two', role: 'representative', department: 'Retail', currentCoachId: 'coach-a' },
    { personId: 'rep-b', displayName: 'Beta One', role: 'representative', department: 'Retail', currentCoachId: 'coach-b' },
    { personId: 'rep-c', displayName: 'Charlie One', role: 'representative', department: 'Retail', currentCoachId: 'coach-c' },
    { personId: 'rep-ghost', displayName: 'Ghost One', role: 'representative', department: 'Retail', currentCoachId: 'coach-ghost' }
  ];
  const rows = [
    ['Alpha One', 'Coach Alpha', 60, 120], ['Alpha Two', 'Coach Alpha', 30, 30],
    ['Beta One', 'Coach Beta', 45, 90], ['Charlie One', 'Coach Charlie', 50, 100],
    ['Ghost One', 'Historical Coach', 120, 200]
  ];
  const history = ['2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17'].map((period, index) => weeklyRecord(`week-${index}`, period, rows));
  const prepared = await Fast.prepareWeeklyAsync(people, { weeklyRetail: history[3] }, { snapshotKey: 'cash-test', asOf });
  const index = Fast.createHistoryIndex(people);
  for (const record of history) Fast.addHistoryRecord(index, 'weeklyRetail', record);
  const result = Fast.buildWindowRankings('coach-a', prepared, index, 4);
  const cash = result.rankings.find(row => row.id === 'cash-appointment-rate');
  assert.ok(cash, 'Coach over 100 average weekly opportunities should receive a Cash rank.');
  assert.strictEqual(cash.total, 1, 'The denominator should equal the final eligible coach cohort.');
  assert.strictEqual(cash.diagnostics.excludedForLowVolume, 2, 'Coaches at 90 and exactly 100 opportunities/week should be excluded.');
  assert.strictEqual(cash.diagnostics.finalRankedCohort, 1);
  assert.strictEqual(cash.diagnostics.currentCoaches, 3, 'Historical coaches must be removed even when they still have linked rows and volume.');
  assert.ok(Math.abs(cash.value - .6) < 1e-9, 'Team Cash AR must be opportunity-weighted: 90 / 150.');
  assert.strictEqual(Math.round(cash.averageOpportunitiesPerWeek), 150);
  assert.strictEqual(result.rankings.some(row => row.id === 'cash-appointment-rate' && row.total > cash.diagnostics.finalRankedCohort), false);

  const lowVolume = Fast.buildWindowRankings('coach-b', prepared, index, 4);
  assert.strictEqual(lowVolume.rankings.some(row => row.id === 'cash-appointment-rate'), false, 'A coach under 100 average opportunities/week must be excluded.');

  const recordsA = { qa: { id: 'qa-1', fingerprint: 'abc' }, weeklyRetail: { id: 'retail-1', fingerprint: 'def' } };
  const recordsB = { weeklyRetail: recordsA.weeklyRetail, qa: recordsA.qa };
  assert.strictEqual(Alignment.snapshotFingerprint(recordsA, {}, 7), Alignment.snapshotFingerprint(recordsB, {}, 7), 'Snapshot fingerprints must not depend on object insertion order.');
  assert.strictEqual(Alignment.snapshotFingerprint({}, { weeklyRetail: [recordsA.weeklyRetail] }, 7), Alignment.snapshotFingerprint({}, { weeklyRetail: [recordsA.weeklyRetail, recordsA.weeklyRetail] }, 7), 'Duplicate history fingerprints must not change the snapshot.');

  console.log('Coaching alignment, coverage, attention, and eligible ranking tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
