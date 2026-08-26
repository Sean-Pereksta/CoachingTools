'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'apps', 'performance-scorecard.html'), 'utf8');

assert(html.includes('id="customRangeMode"'), 'Custom columns should offer a date-selection mode.');
assert(html.includes('<option value="range">Custom date range</option>'), 'Custom columns should offer explicit date ranges.');
assert(html.includes('id="customStart" type="date"'), 'Custom date ranges should provide a start date.');
assert(html.includes('id="customEnd" type="date"'), 'Custom date ranges should provide an end date.');
assert(html.includes("$('customRangeMode').onchange=syncCustomRangeUi"), 'Changing date mode should update the custom-column form.');
assert(html.includes("start>end"), 'Reversed custom date ranges should be rejected.');
assert(html.includes("rangeMode:c.rangeMode==='range'?'range':'rolling'"), 'Saved legacy columns should normalize to rolling windows.');
assert(html.includes('<option value="last">Last week</option>'), 'The main Scorecard window should offer the previous Sunday-Saturday week.');
assert(html.includes('<option value="custom">Custom range</option>'), 'The main Scorecard window should offer a custom date range.');
assert(html.includes('id="windowStart" type="date"'), 'The main custom window should provide a start date.');
assert(html.includes('id="windowEnd" type="date"'), 'The main custom window should provide an end date.');
assert(html.includes("department=personDepartment(rep)"), 'Retail KPI visibility must use the representative department observed in current weekly data.');
assert(!html.includes("m.dept==='Retail'&&rep.department!=='Retail'"), 'Retail KPI visibility must not use a stale identity-registry department.');
assert(html.includes('pointInSelectedWindow(p,spec)'), 'KPI points should be filtered by the selected dated window.');
assert(html.includes('for(const q of qaRows(personId))'), 'QA charts should use the same selected dated window.');

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

const weeklyContext = { console, Date, Map, Set };
weeklyContext.window = weeklyContext;
weeklyContext.globalThis = weeklyContext;
vm.createContext(weeklyContext);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'shared', 'coachtools-weekly-index.js'), 'utf8'), weeklyContext);
const controls = {
  departmentSel: { value: 'Retail' },
  windowSel: { value: 'custom' },
  windowStart: { value: '2026-08-24' },
  windowEnd: { value: '2026-08-29' }
};
const state = { weeklyByRep: new Map([['rep', [{ type: 'weeklyRetail', week: '2026-08-23' }]]]) };
const mainWindowHelpers = ['clean', 'weekKey', 'shiftDayKey', 'latestBusinessWeekKey', 'mainWindowSpec', 'pointInSelectedWindow']
  .map(line)
  .join('\n');
const windowApi = new Function('window', 'CoachToolsWeeklyIndex', 'state', '$', 'DAY', `${mainWindowHelpers}\nreturn {mainWindowSpec,pointInSelectedWindow};`)(
  weeklyContext,
  weeklyContext.CoachToolsWeeklyIndex,
  state,
  id => controls[id],
  86400000
);
assert.deepStrictEqual(
  windowApi.mainWindowSpec(),
  { mode: 'custom', start: '2026-08-23', end: '2026-08-29', weeks: 1, key: 'custom:2026-08-23:2026-08-23' },
  'A date inside 8/23-8/29 should resolve to that complete Sunday-Saturday business week.'
);
assert.strictEqual(windowApi.pointInSelectedWindow({ week: '2026-08-23' }), true);
assert.strictEqual(windowApi.pointInSelectedWindow({ week: '2026-08-30' }), false);
controls.windowSel.value = '4';
assert.deepStrictEqual(
  windowApi.mainWindowSpec(),
  { mode: 'rolling', start: '2026-08-02', end: '2026-08-29', weeks: 4, key: 'rolling:4:2026-08-23' },
  'Rolling windows should anchor to the latest dated Retail week and keep Sunday-Saturday boundaries.'
);

const inlineScripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi), match => match[1]).filter(source => source.trim());
for (const source of inlineScripts) new Function(source);

console.log('Performance Scorecard custom date-range tests passed.');
