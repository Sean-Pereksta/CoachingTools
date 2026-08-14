#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = { console, Date, Math, JSON, setTimeout, clearTimeout };
context.window = context;
context.globalThis = context;
context.CoachToolsIdentity = {
  normalizeName(value) {
    return String(value == null ? '' : value)
      .trim()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[.’'`]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }
};
vm.createContext(context);
for (const file of ['shared/coachtools-profile-data.js', 'shared/coachtools-profile-fast-v2.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

function weeklyRecord(rows) {
  return {
    id: 'weeklyRetail-current',
    datasetType: 'weeklyRetail',
    originalFileName: 'weekly-retail.xlsx',
    importedAt: '2026-08-14T12:00:00Z',
    periodSort: '2026-08-10',
    detectedPeriod: { label: 'Aug 10–16', periodKey: '2026-08-10' },
    data: {
      workbook: {
        data: {
          Retail: {
            aoa: [
              ['Representative', 'Sheet', 'Cash Appointment Rate', 'Wiper Rate'],
              ...rows
            ]
          }
        }
      }
    }
  };
}

(async () => {
  const Fast = context.CoachToolsProfileFast;
  const people = [
    { personId: 'coach-lakin', displayName: 'Shamel Lakin', normalizedName: 'shamel lakin', role: 'coach', aliases: [], sourceNames: {}, department: 'Retail', currentCoachId: '' },
    { personId: 'rep-one', displayName: 'Alex One', normalizedName: 'alex one', role: 'representative', aliases: [], sourceNames: {}, department: 'Retail', currentCoachId: '' },
    { personId: 'rep-two', displayName: 'Taylor Two', normalizedName: 'taylor two', role: 'representative', aliases: [], sourceNames: {}, department: 'Retail', currentCoachId: '' }
  ];

  const prepared = await Fast.prepareWeeklyAsync(people, {
    weeklyRetail: weeklyRecord([
      ['Alex One', 'Lakin', 0.55, 0.31],
      ['Taylor Two', 'Lakin', 0.57, 0.34]
    ])
  });
  const profile = Fast.buildProfile('coach-lakin', prepared);
  assert.strictEqual(profile.relationships.representatives.length, 2, 'Weekly last-name Sheet values should rebuild the coach roster.');
  assert.deepStrictEqual(Array.from(profile.relationships.representatives, person => person.personId).sort(), ['rep-one', 'rep-two']);
  assert.strictEqual(profile.sources.weeklyRetail, true, 'Coach should show Weekly Retail coverage when matched reps have weekly KPI rows.');

  const collisionPeople = [
    ...people,
    { personId: 'coach-lakin-2', displayName: 'Dana Lakin', normalizedName: 'dana lakin', role: 'coach', aliases: [], sourceNames: {}, department: 'Retail', currentCoachId: '' }
  ];
  const collisionPrepared = await Fast.prepareWeeklyAsync(collisionPeople, {
    weeklyRetail: weeklyRecord([['Alex One', 'Lakin', 0.55, 0.31]])
  });
  assert.strictEqual(Fast.buildProfile('coach-lakin', collisionPrepared).relationships.representatives.length, 0, 'Ambiguous same-department last names must not be guessed.');
  assert.strictEqual(Fast.buildProfile('coach-lakin-2', collisionPrepared).relationships.representatives.length, 0, 'Ambiguous same-department last names must not be guessed.');

  console.log('People Profiles weekly coach last-name matching tests passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
