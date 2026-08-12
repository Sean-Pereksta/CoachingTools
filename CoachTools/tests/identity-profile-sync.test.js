#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = { console, setTimeout, clearTimeout, Date, Math, JSON };
context.window = context;
context.globalThis = context;
vm.createContext(context);
for (const file of ['shared/coachtools-sync.js', 'shared/coachtools-identity.js', 'shared/coachtools-profile-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

(async () => {
  const identity = context.CoachToolsIdentity;
  await identity.ready();

  assert.strictEqual(identity.normalizeName('  BALLO, Blyssey  '), 'blyssey ballo');
  assert.strictEqual(identity.normalizeName("Blyssey O’Ballo"), 'blyssey oballo');

  const coach = await identity.learn('BLYSSEY BALLO', { role: 'coach', department: 'Retail', source: 'weeklyRetail' });
  const sameCoach = await identity.learn('Blyssey Ballo', { role: 'coach', source: 'qa' });
  assert.strictEqual(sameCoach.personId, coach.personId, 'Exact normalized names should not create duplicates.');
  assert.strictEqual(await identity.learn('Blyssey Ballo', { role: 'representative', source: 'monthlyRetail' }), null, 'Conflicting roles should require review instead of silently merging identities.');
  assert((await identity.getReviews({ status: 'open' })).some(review => review.type === 'role-conflict'), 'Role conflicts should appear in the review queue.');
  await identity.addAlias(coach.personId, 'BALLO');
  assert.strictEqual((await identity.resolve('ballo')).person.personId, coach.personId, 'Known aliases should resolve to the canonical person.');

  const rep = await identity.learn('John Doe', { role: 'representative', department: 'Retail', source: 'documentedCoaching', currentCoachId: coach.personId });
  assert.strictEqual((await identity.getRelationships(rep.personId)).coach.personId, coach.personId);
  await identity.updatePerson(rep.personId, { currentCoachId: '' });
  assert((await identity.getPerson(rep.personId)).relationshipHistory.some(item => item.coachId === coach.personId && item.to), 'Removing a coach should close the historical relationship.');
  await identity.updatePerson(rep.personId, { currentCoachId: coach.personId });

  await identity.syncTeamSetup({ groups: { team: [{ name: 'Retail East', members: ['Blyssey Ballo'] }], coord: [{ name: 'Jane Smith', members: ['Blyssey Ballo'] }] } });
  const assignedCoach = await identity.getPerson(coach.personId);
  assert.strictEqual(assignedCoach.currentTeam, 'Retail East');
  assert.strictEqual(assignedCoach.coordinator, 'Jane Smith');
  assert(assignedCoach.teamHistory.some(item => item.team === 'Retail East' && item.to === null), 'Team history should retain a current dated entry.');
  await identity.updatePerson(coach.personId, { currentTeam: 'Retail West' });
  const movedCoach = await identity.getPerson(coach.personId);
  assert(movedCoach.teamHistory.some(item => item.team === 'Retail East' && item.to), 'Moving teams should close the prior team history entry.');
  assert(movedCoach.teamHistory.some(item => item.team === 'Retail West' && item.to === null), 'Moving teams should open a current team history entry.');
  await identity.updatePerson(coach.personId, { displayName: 'Blyssey A Ballo' });
  assert.strictEqual((await identity.resolve('Blyssey Ballo')).person.personId, coach.personId, 'Changing a preferred name should retain the prior name as an alias.');

  const duplicate = await identity.learn('Blyssey B Ballo', { role: 'coach', department: 'Retail', source: 'manual' });
  const merged = await identity.mergePeople(coach.personId, duplicate.personId);
  assert.strictEqual((await identity.resolve('Blyssey B Ballo')).person.personId, coach.personId);
  await identity.undoMerge(merged.mergeId);
  assert((await identity.getPerson(duplicate.personId)), 'Undo should restore the merged identity.');

  const sync = context.CoachToolsSync;
  const current = { id: 'old', datasetId: 'old', periodKey: '2026-08-02', periodSort: '2026-08-02', fingerprint: 'a' };
  const history = [current];
  assert.strictEqual(sync.compareCandidate({ datasetType: 'weeklyRetail', periodKey: '2026-08-09', periodSort: '2026-08-09', fingerprint: 'b' }, current, history).status, 'new');
  assert.strictEqual(sync.compareCandidate({ datasetType: 'weeklyRetail', periodKey: '2026-08-02', periodSort: '2026-08-02', fingerprint: 'b' }, current, history).status, 'updated');
  assert.strictEqual(sync.compareCandidate({ datasetType: 'weeklyRetail', periodKey: '2026-08-02', periodSort: '2026-08-02', fingerprint: 'a' }, current, history).status, 'current');
  assert.strictEqual(sync.compareCandidate({ datasetType: 'weeklyRetail', periodKey: '2026-07-26', periodSort: '2026-07-26', fingerprint: 'c' }, current, history).status, 'older');
  assert.strictEqual(sync.compareCandidate({ datasetType: 'weeklyRetail', periodKey: '', periodSort: '', fingerprint: 'd' }, current, history).status, 'needs-review');

  const coaches = [
    { personId: 'c1', displayName: 'Coach One', normalizedName: 'coach one', role: 'coach', aliases: [], department: 'Retail', currentTeam: 'Retail East' },
    { personId: 'c2', displayName: 'Coach Two', normalizedName: 'coach two', role: 'coach', aliases: [], department: 'Retail', currentTeam: 'Retail West' },
    { personId: 'c3', displayName: 'Coach Three', normalizedName: 'coach three', role: 'coach', aliases: [], department: 'Retail', currentTeam: 'Retail North' }
  ];
  const reps = Array.from({ length: 6 }, (_, index) => ({ personId: `r${index + 1}`, displayName: `Rep ${index + 1}`, normalizedName: `rep ${index + 1}`, role: 'representative', aliases: [], department: 'Retail', currentCoachId: coaches[index % 3].personId }));
  const referral = { personId: 'outside', displayName: 'Referral Outlier', normalizedName: 'referral outlier', role: 'representative', aliases: [], department: 'Referral', currentCoachId: '' };
  const people = [...coaches, ...reps, referral];
  const thisWeek = '2026-08-10';
  const record = (datasetType, rows) => ({ id: datasetType, datasetType, originalFileName: `${datasetType}.xlsx`, importedAt: '2026-08-12T00:00:00Z', periodSort: '2026-08-10', detectedPeriod: { label: 'Aug 10–16', periodKey: '2026-08-10' }, data: { workbook: { sheets: ['Data'], data: { Data: { aoa: rows } } } } });
  const records = {
    monthlyRetail: record('monthlyRetail', [
      ['Representative', 'Cash Appointment Rate', 'Afterpay'],
      ...reps.map((person, index) => [person.displayName, 0.40 + index * 0.02, 0.10 + index * 0.02]),
      [referral.displayName, 0.99, 0.99]
    ]),
    qa: record('qa', [
      ['Agent Name', 'Score %', 'Interaction Start Time', 'Team'],
      ...reps.map((person, index) => [person.displayName, 0.80 + index * 0.02, thisWeek, coaches[index % 3].displayName])
    ]),
    documentedCoaching: record('documentedCoaching', [
      ['Job Coach', 'Associate Name', 'Date', 'Coaching Type Multi'],
      ['Coach One', 'Rep 1', thisWeek, 'Afterpay'],
      ['Coach One', 'Rep 2', thisWeek, 'Call Quality'],
      ['Coach Two', 'Rep 3', thisWeek, 'Insurance Cash'],
      ['Coach Three', 'Rep 4', thisWeek, 'Rapport']
    ]),
    checklist: record('checklist', [
      ['Coach Assigned', 'Associate Name', 'Action', 'Created On', 'Date Served', 'Incident'],
      ['Coach One', 'Rep 1', 'Addressed', '2026-08-08', '2026-08-10', 'Afterpay'],
      ['Coach One', 'Rep 2', 'Addressed', '2026-08-08', '2026-08-09', 'Call Quality'],
      ['Coach Two', 'Rep 3', 'Addressed', '2026-08-08', '2026-08-12', 'Insurance Cash'],
      ['Coach Three', 'Rep 4', 'Addressed', '2026-08-08', '2026-08-11', 'Rapport']
    ])
  };

  const trendHistory = {
    monthlyRetail: [0.58, 0.54, 0.50].map((value, index) => ({
      ...record('monthlyRetail', [['Representative', 'Cash Appointment Rate'], ['Rep 6', value]]),
      id: `monthlyRetail-${index}`,
      periodSort: `2026-0${6 + index}-01`,
      detectedPeriod: { label: `2026-0${6 + index}`, periodKey: `2026-0${6 + index}` }
    }))
  };

  const profiles = context.CoachToolsProfiles;
  const repProfile = profiles.buildProfile('r6', people, records, trendHistory);
  const appointment = repProfile.metricDetails.find(metric => metric.id === 'cash-appointment-rate');
  assert(appointment.score >= 9, 'Top same-department representative should receive a high relative score.');
  assert.strictEqual(appointment.sampleSize, 6, 'Referral representatives must not enter the Retail comparison cohort.');
  assert.strictEqual(appointment.trend.status, 'declining', 'Three historical periods should produce a deterministic direction-aware trend.');
  assert.strictEqual(repProfile.coaching.last30, 0);
  assert.strictEqual(repProfile.sources.monthlyRetail, true, 'Dataset status should reflect records for this person, not suite-wide availability.');
  assert.strictEqual(repProfile.sources.weeklyRetail, false, 'A loaded source with no matching person record must not appear as present.');

  const coachProfile = profiles.buildProfile('c1', people, records);
  const coachingRank = coachProfile.rankings.find(metric => metric.id === 'coaching-activity');
  assert.strictEqual(coachingRank.rank, 1);
  assert.strictEqual(coachingRank.total, 3);
  assert.strictEqual(coachProfile.snapshot.representatives, 2);
  assert.strictEqual(coachProfile.snapshot.averageResponseDays, 1.5);
  assert.strictEqual(coachProfile.coaching.topics[0].count, 1);

  const insufficient = profiles.percentileScore(0.5, [0.4, 0.5, 0.6], true, 5);
  assert.strictEqual(insufficient.score, null);
  assert.strictEqual(insufficient.reason, 'Insufficient comparison data');

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps.json'), 'utf8'));
  assert(manifest.apps.some(app => app.id === 'contact-center-checklist' && app.category === 'Quality'));
  assert(manifest.apps.some(app => app.id === 'people-profiles' && app.category === 'People'));

  console.log('CoachTools identity, profile, scope cohort, and smart-sync tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
