'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
require(path.join(root, 'shared', 'performance-scorecard-upload-mode.js'));

const detector = globalThis.CoachToolsPerformanceScorecardHeaderDetector;
assert(detector, 'Performance Scorecard workbook detector should be available.');

const deep = Array.from({ length: 180 }, (_, index) => [`Report preamble ${index + 1}`, '', '', '']);
deep.push(['Agent_surname', 'Agent_FirstName', 'CASH OPPS', 'cash Appts']);
deep.push(['Doe', 'Jane', 10, 5]);
assert.strictEqual(detector.findWorkbookHeaderRow(deep, 'SV2'), 180, 'workbook headers should be detected well beyond the old top-row limits');

const prepared = detector.prepareWorkbookMatrix(deep, 'SV2', { employee: new Map(), phone: new Map() }, '2026-08-23');
assert.strictEqual(prepared[0][0], 'Agent_surname', 'the detected header should be promoted to row zero before the legacy workbook parser sees it');
assert(prepared[0].includes('Cash Apps'), 'cash Appts should be canonicalized to Cash Apps regardless of capitalization');
assert(prepared[0].includes('Week Start'), 'an assigned Workbook Date should provide a usable week when the sheet has no date column');
assert.strictEqual(prepared[1][prepared[0].indexOf('Week Start')], '2026-08-23');

assert.deepStrictEqual(
  detector.monthWindowBounds('this', new Date(2026, 7, 27, 12)),
  { start: '2026-08-02', end: '2026-08-31', weekEnd: '2026-09-05', monthKey: '2026-08' },
  'This month should include Sunday-start business weeks assigned to August.'
);
assert.deepStrictEqual(
  detector.monthWindowBounds('last', new Date(2026, 7, 27, 12)),
  { start: '2026-07-05', end: '2026-07-31', weekEnd: '2026-08-01', monthKey: '2026-07' },
  'Last month should include Sunday-start business weeks assigned to July.'
);

const source = fs.readFileSync(path.join(root, 'shared', 'performance-scorecard-upload-mode.js'), 'utf8');
assert(source.includes("thisMonth.textContent = 'This month'"), 'main Scorecard Window should expose This month.');
assert(source.includes("lastMonth.textContent = 'Last month'"), 'main Scorecard Window should expose Last month.');
assert(source.includes('scorecardSystemColumnsBox'), 'Rank and Status should have persisted controls in the Columns drawer.');
assert(source.includes("systemColumnRow('rank', 'Overall Rank'"), 'Overall Rank should be toggleable from Columns.');
assert(source.includes("systemColumnRow('status', 'Status'"), 'Status should be toggleable from Columns.');
assert(source.includes('psUploadAsOfDate'), 'Workbook Mode should expose an assigned workbook date.');
assert(source.includes('psUploadCompareMode'), 'Workbook Mode should expose recent-scorecard comparison.');
assert(source.includes('pp vs recent'), 'Workbook Mode should render percentage-point trend comparisons.');

console.log('Performance Scorecard runtime control tests passed.');
