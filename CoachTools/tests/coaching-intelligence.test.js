'use strict';

const assert = require('assert');
require('../shared/coachtools-intelligence.js');

const intelligence = globalThis.CoachToolsIntelligence;
assert.ok(intelligence, 'CoachToolsIntelligence should attach to globalThis');
assert.strictEqual(intelligence.VERSION, '1.0.0');

const higher = intelligence._test.classifyOutcome(0.40, 0.46, { higher: true, percent: true });
assert.strictEqual(higher.status, 'improved');
assert.ok(higher.orientedDelta > 0);

const lower = intelligence._test.classifyOutcome(720, 680, { higher: false, percent: false });
assert.strictEqual(lower.status, 'improved');
assert.ok(lower.orientedDelta > 0);

const neutral = intelligence._test.classifyOutcome(0.82, 0.83, { higher: true, percent: true });
assert.strictEqual(neutral.status, 'neutral');

const checklist = intelligence._test.canonicalizeChecklist({
  data: {
    workbook: {
      data: {
        Sheet1: {
          aoa: [
            ['Coach Assigned', 'Associate Name', 'Created On', 'Date Served', 'Incident'],
            ['Aisha Villalobos', 'Example Rep', '2026-08-01', '2026-08-03', 'Appointment Behavior'],
            ['Aisha Villalobos', 'Waiting Rep', '2026-08-01', '', 'Call Quality']
          ]
        }
      }
    }
  }
}, value => ({ 'Aisha Villalobos': 'coach-1', 'Example Rep': 'rep-1', 'Waiting Rep': 'rep-2' })[value] || '');
assert.strictEqual(checklist.length, 2);
assert.strictEqual(checklist[0].coachId, 'coach-1');
assert.strictEqual(checklist[0].representativeId, 'rep-1');
assert.strictEqual(Math.round(checklist[0].days), 2);
assert.strictEqual(checklist[1].served, null);

const support = intelligence.supportSummary({
  checklist,
  scope: { mode: 'all' },
  byId: new Map([
    ['coach-1', { personId: 'coach-1', displayName: 'Aisha Villalobos', role: 'coach' }]
  ])
});
assert.strictEqual(support.length, 1);
assert.strictEqual(support[0].coachName, 'Aisha Villalobos');
assert.strictEqual(support[0].total, 2);
assert.strictEqual(support[0].open, 1);

const byId = new Map([
  ['coach-1', { personId: 'coach-1', displayName: 'Aisha Villalobos', role: 'coach', department: 'Retail' }],
  ['rep-1', { personId: 'rep-1', displayName: 'Example Rep', role: 'representative', currentCoachId: 'coach-1', department: 'Retail' }]
]);
assert.strictEqual(intelligence._test.personInScope(byId.get('rep-1'), { mode: 'coach', personId: 'coach-1' }, byId), true);
assert.strictEqual(intelligence._test.personInScope(byId.get('rep-1'), { mode: 'department', department: 'Referral' }, byId), false);

const appointmentMetric = intelligence.METRICS.find(metric => metric.id === 'appointment-rate');
const recurringContext = {
  byId,
  scope: { mode: 'all' },
  qa: [],
  checklist: [],
  coaching: [
    { representativeId: 'rep-1', coachId: 'coach-1', coach: 'Aisha Villalobos', date: new Date('2026-07-10'), topics: ['Appointment Behavior'] },
    { representativeId: 'rep-1', coachId: 'coach-1', coach: 'Aisha Villalobos', date: new Date('2026-07-30'), topics: ['Appointment Behavior'] }
  ],
  performance: [
    ['2026-06-30', .55],
    ['2026-07-07', .54],
    ['2026-07-14', .52],
    ['2026-07-21', .49],
    ['2026-07-28', .45],
    ['2026-08-04', .42]
  ].map(([date, value]) => ({ personId: 'rep-1', role: 'representative', metric: appointmentMetric, value, date: new Date(date), datasetType: 'weeklyRetail' }))
};
const recurringOpportunity = intelligence.buildOpportunities(recurringContext).find(item => item.personId === 'rep-1' && item.metricId === 'appointment-rate');
assert.ok(recurringOpportunity, 'declining appointment performance should create an opportunity');
assert.strictEqual(recurringOpportunity.status, 'recurred');
assert.strictEqual(recurringOpportunity.recurrenceCount, 1);
assert.ok(recurringOpportunity.attentionReasons.some(reason => /wrong direction/i.test(reason)));

console.log('Coaching intelligence tests passed.');
