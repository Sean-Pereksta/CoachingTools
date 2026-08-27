'use strict';

const assert = require('assert');
const path = require('path');

require(path.join(__dirname, '..', 'shared', 'performance-scorecard-upload-mode.js'));

const headerDetector = globalThis.CoachToolsPerformanceScorecardHeaderDetector;
assert(headerDetector, 'workbook header and identity detector should be exposed');
assert.strictEqual(headerDetector.normalizeHeader('Agent_surname'), 'agentsurname');
assert.strictEqual(headerDetector.normalizeHeader('FIRST_NAME'), 'firstname');
assert.strictEqual(headerDetector.normalizePersonDisplay('Doe, Jane'), 'Jane Doe');

const deepHeaderMatrix = Array.from({ length: 45 }, (_, index) => [`Report preamble ${index + 1}`, '', '', '', '']);
deepHeaderMatrix.push(['Agent_surname', 'Agent_FirstName', 'cash Opps', 'cash Apps', 'Date']);
deepHeaderMatrix.push(['Doe', 'Jane', 10, 5, '8/23/2026']);
assert.strictEqual(headerDetector.findIdentityHeaderRow(deepHeaderMatrix), 45, 'identity row should be found beyond the old 40-row scan');
const trimmedDeepMatrix = headerDetector.trimMatrixToIdentityHeader(deepHeaderMatrix);
assert.deepStrictEqual(trimmedDeepMatrix[0], deepHeaderMatrix[45], 'identity row should become the first row when the compatibility helper is used');

const misleadingPreamble = [
  ['Consumer / Insurance / Commercial workbook summary', '', '', '', ''],
  ['Generated export', 'Cash', 'Insurance', 'Commercial', ''],
  ['FIRST_NAME', 'Surname', 'Cash Opps', 'Cash Apps', 'Date'],
  ['Jane', 'Doe', 10, 5, '8/23/2026']
];
assert.strictEqual(headerDetector.findIdentityHeaderRow(misleadingPreamble), 2, 'first-name + surname identity row should beat KPI-looking preamble rows');

const api = globalThis.CoachToolsPerformanceScorecardUploadMode;
assert(api, 'upload mode API should be exposed');
const t = api._test;

const identityMatrices = {
  'Phone Data': [
    ['Phone report', '', '', ''],
    ['Avaya_ID', 'FIRST_NAME', 'Surname', 'Team'],
    ['1001', 'Jane', 'Doe', 'Coach One']
  ],
  'Roster': [
    ['Roster export', '', ''],
    ['EMPL_ID', 'Agent_Name', 'Coach'],
    ['E124', 'Smith, John', 'Coach Two']
  ]
};
const workbookIdentity = headerDetector.buildIdentityFromMatrices(identityMatrices);
assert.strictEqual(workbookIdentity.phone.get('1001'), 'Jane Doe', 'Phone Data should provide a workbook-wide name lookup');
assert.strictEqual(workbookIdentity.employee.get('e124'), 'John Smith', 'EMPL_ID should provide a workbook-wide name lookup and normalize LAST, FIRST display');

const rawSv2RowFour = [
  ['Retail Sales View export', '', '', '', '', '', '', '', '', '', ''],
  ['Generated 8/27/2026', '', '', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', ''],
  ['Phone_ID', 'EMPL_ID', 'Team_Name', 'Total Opps', 'Total Apps', 'cash Opps', 'cash Appts', 'insurance Opps', 'insurance Appts', 'commercial Opps', 'commercial Appts'],
  ['1001', 'E123', 'Team A', 170, 110, 100, 48, 50, 45, 20, 17],
  ['', 'E124', 'Team B', 130, 84, 80, 40, 40, 36, 10, 8]
];
assert.strictEqual(headerDetector.findWorkbookHeaderRow(rawSv2RowFour, 'SV2'), 3, 'raw SV2 KPI header should be detected on workbook row 4 even without a name column');
const enrichedSv2 = headerDetector.enrichMatrixWithIdentity(rawSv2RowFour, 'SV2', workbookIdentity);
const originalSv2Headers = rawSv2RowFour[3];
assert.deepStrictEqual(enrichedSv2[3].slice(0, originalSv2Headers.length), originalSv2Headers, 'every original row-four SV2 column should remain intact and in the same order');
assert(enrichedSv2[3].includes('Cash Apps'), 'cash Appts should expose the canonical Cash Apps alias');
assert(enrichedSv2[3].includes('Insurance Apps'), 'insurance Appts should expose the canonical Insurance Apps alias');
assert(enrichedSv2[3].includes('Commercial Apps'), 'commercial Appts should expose the canonical Commercial Apps alias');
const joinedNameIndex = enrichedSv2[3].indexOf('Representative Name');
assert(joinedNameIndex >= 0, 'SV2 should receive a synthetic Representative Name column from workbook IDs');
assert.strictEqual(enrichedSv2[4][joinedNameIndex], 'Jane Doe', 'Phone_ID should join the raw SV2 KPI row to the representative name');
assert.strictEqual(enrichedSv2[5][joinedNameIndex], 'John Smith', 'EMPL_ID should join when Phone_ID is unavailable');

const enrichedHeaderIndex = t.findHeaderRow(enrichedSv2, 'sv2');
assert.strictEqual(enrichedHeaderIndex, 3, 'the existing parser should keep using the real row-four SV2 header');
const enrichedRows = t.rowsFromMatrix(enrichedSv2, enrichedHeaderIndex);
assert.strictEqual(t.nameFromRow(enrichedRows.rows[0]), 'Jane Doe');
const enrichedRetail = t.appointmentMetrics(enrichedRows.rows[0], 'Retail');
assert.strictEqual(enrichedRetail.consumer.value, 0.48, 'Consumer AR should calculate from cash Appts / cash Opps');
assert.strictEqual(enrichedRetail.insurance.value, 0.9, 'Insurance AR should calculate from insurance Appts / insurance Opps');
assert.strictEqual(enrichedRetail.commercial.value, 0.85, 'Commercial AR should calculate from commercial Appts / commercial Opps');

assert.strictEqual(t.normalizeHeader('Cash Opps'), 'cashopps');
assert.strictEqual(t.normalizeHeader('AGENT_SURNAME'), 'agentsurname');
assert.strictEqual(t.classifySheet('Phone Data'), 'phone');
assert.strictEqual(t.classifySheet('SV2'), 'sv2');
assert.strictEqual(t.classifySheet('SV2 Wiper'), 'wiper');
assert.strictEqual(t.classifySheet('Referral SV2 Wipers'), 'wiper');

assert.strictEqual(t.nameFromRow({ Agent_Name: 'Doe, Jane' }), 'Jane Doe');
assert.strictEqual(t.nameFromRow({ FIRST_NAME: 'Jane', LAST_NAME: 'Doe' }), 'Jane Doe');
assert.strictEqual(t.nameFromRow({ Agent_FirstName: 'Jane', Agent_surname: 'Doe' }), 'Jane Doe');
assert.strictEqual(t.nameFromRow({ 'agent firstname': 'Jane', 'AGENT_LASTNAME': 'Doe' }), 'Jane Doe');

const retail = t.appointmentMetrics({
  'CASH OPPS': 100,
  'cash apps': 48,
  'Insurance Opps': 50,
  'INSURANCE APPS': 45,
  'commercial opps': 20,
  'Commercial Apps': 17
}, 'Retail');
assert.strictEqual(retail.consumer.num, 48);
assert.strictEqual(retail.consumer.den, 100);
assert.strictEqual(retail.consumer.value, 0.48);
assert.strictEqual(retail.insurance.value, 0.9);
assert.strictEqual(retail.commercial.value, 0.85);

const referral = t.appointmentMetrics({ 'Referral Opps': 40, 'REFERRAL APPS': 30 }, 'Referral');
assert.strictEqual(referral.referral.value, 0.75);

const referralWipers = t.wiperMetric({ Accepted: 30, Declined: 10 }, 'Referral');
assert.strictEqual(referralWipers.num, 30);
assert.strictEqual(referralWipers.den, 40);
assert.strictEqual(referralWipers.value, 0.75);

const retailWipers = t.wiperMetric({ 'Wiper Count': 12, 'Wiper Jobs': 40, Accepted: 35, Declined: 5 }, 'Retail');
assert.strictEqual(retailWipers.num, 12);
assert.strictEqual(retailWipers.den, 40);
assert.strictEqual(retailWipers.value, 0.3);

const windowSpec = t.threeWeekWindow(new Date(2026, 7, 26));
assert.strictEqual(t.dayKey(windowSpec.start), '2026-08-09');
assert.strictEqual(t.dayKey(windowSpec.end), '2026-08-29');

const matrix = [
  ['Export generated', '', ''],
  ['Agent_surname', 'Agent_FirstName', 'Cash Opps', 'Cash Apps', 'Date'],
  ['Doe', 'Jane', 10, 5, '8/23/2026']
];
assert.strictEqual(t.findHeaderRow(matrix, 'sv2'), 1);
const converted = t.rowsFromMatrix(matrix, 1);
assert.strictEqual(converted.rows.length, 1);
assert.strictEqual(t.nameFromRow(converted.rows[0]), 'Jane Doe');

const sheets = [
  {
    name: 'SV2', kind: 'sv2', hasDates: true,
    rows: [
      { Agent_Name: 'Jane Doe', Coach: 'Coach One', Date: '8/9/2026', 'Cash Opps': 10, 'Cash Apps': 4 },
      { Agent_Name: 'Jane Doe', Coach: 'Coach One', Date: '8/16/2026', 'Cash Opps': 20, 'Cash Apps': 10 },
      { Agent_Name: 'Jane Doe', Coach: 'Coach One', Date: '8/23/2026', 'Cash Opps': 30, 'Cash Apps': 18 },
      { Agent_Name: 'Other Rep', Coach: 'Coach Two', Date: '8/23/2026', 'Cash Opps': 10, 'Cash Apps': 9 }
    ]
  },
  {
    name: 'SV2 Wiper', kind: 'wiper', hasDates: true,
    rows: [
      { FIRST_NAME: 'Jane', LAST_NAME: 'Doe', Date: '8/9/2026', Accepted: 6, Declined: 4 },
      { FIRST_NAME: 'Jane', LAST_NAME: 'Doe', Date: '8/16/2026', Accepted: 7, Declined: 3 },
      { FIRST_NAME: 'Jane', LAST_NAME: 'Doe', Date: '8/23/2026', Accepted: 8, Declined: 2 }
    ]
  }
];
for (const sheet of sheets) for (const row of sheet.rows) {
  row.__name = t.nameFromRow(row);
  row.__coach = t.coachFromRow(row);
  row.__date = t.dateFromRow(row);
}
const agg = t.aggregateWorkbook(sheets, 'Retail', 'Coach One', windowSpec, []);
assert.strictEqual(agg.rows.length, 1);
assert.strictEqual(agg.rows[0].name, 'Jane Doe');
assert.strictEqual(agg.rows[0].metrics.consumer.num, 32);
assert.strictEqual(agg.rows[0].metrics.consumer.den, 60);
assert(Math.abs(agg.rows[0].metrics.consumer.value - (32 / 60)) < 1e-12);
assert.strictEqual(agg.rows[0].metrics.wiper.num, 21);
assert.strictEqual(agg.rows[0].metrics.wiper.den, 30);
assert.strictEqual(agg.rows[0].weeks.size, 3);
assert.strictEqual(agg.diagnostics.rosterNames, 1);

console.log('performance-scorecard-upload-mode.test.js passed');
