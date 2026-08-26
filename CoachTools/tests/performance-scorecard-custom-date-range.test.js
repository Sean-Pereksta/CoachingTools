'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'apps', 'performance-scorecard.html'), 'utf8');

assert(html.includes('id="customRangeMode"'), 'Custom columns should offer a date-selection mode.');
assert(html.includes('<option value="range">Custom date range</option>'), 'Custom columns should offer explicit date ranges.');
assert(html.includes('id="customStart" type="date"'), 'Custom date ranges should provide a start date.');
assert(html.includes('id="customEnd" type="date"'), 'Custom date ranges should provide an end date.');
assert(html.includes("$('customRangeMode').onchange=syncCustomRangeUi"), 'Changing date mode should update the custom-column form.');
assert(html.includes("start>end"), 'Reversed custom date ranges should be rejected.');
assert(html.includes("rangeMode:c.rangeMode==='range'?'range':'rolling'"), 'Saved legacy columns should normalize to rolling windows.');

const line = name => html.split('\n').find(value => value.startsWith(`function ${name}(`));
const helperSource = [line('clean'), line('activityRows'), line('localDayKey'), line('activityRowsForCustom')].join('\n');
const { activityRowsForCustom } = new Function('DAY', `${helperSource}\nreturn {activityRowsForCustom};`)(86400000);
const rows = new Map([['rep', [
  { date: new Date(2026, 4, 31, 12) },
  { date: new Date(2026, 5, 1, 12) },
  { created: new Date(2026, 5, 15, 12) },
  { date: new Date(2026, 5, 30, 23, 59) },
  { date: new Date(2026, 6, 1, 0, 1) }
]]]);
const selected = activityRowsForCustom(rows, 'rep', { rangeMode: 'range', start: '2026-06-01', end: '2026-06-30' });

assert.strictEqual(selected.length, 3, 'Custom date ranges should include both boundary dates and exclude outside activity.');
assert.deepStrictEqual(activityRowsForCustom(rows, 'rep', { rangeMode: 'range', start: '2026-07-01', end: '2026-06-01' }), [], 'Invalid ranges should not silently count rolling activity.');

const inlineScripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi), match => match[1]).filter(source => source.trim());
for (const source of inlineScripts) new Function(source);

console.log('Performance Scorecard custom date-range tests passed.');
