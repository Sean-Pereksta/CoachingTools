'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

require('../shared/coachtools-weekly-index.js');
require('../shared/performance-scorecard-periods.js');

const ROOT = path.resolve(__dirname, '..');
const PREF_KEY = 'coachtools.performanceScorecard.profile.v1';
const plain = value => JSON.parse(JSON.stringify(value));
const weeks = Array.from({ length: 60 }, (_, index) => {
  const date = new Date('2026-10-03T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - index * 7);
  return date.toISOString().slice(0, 10);
});
const point = (week, index, type = 'weeklyRetail') => ({
  week, sort: week, label: week, date: new Date(`${week}T12:00:00Z`), type,
  consumer: { num: index < 6 ? 7 : 4, den: 10, value: index < 6 ? .7 : .4 },
  insurance: { num: 9, den: 10, value: .9 },
  commercial: { num: 8, den: 10, value: .8 },
  wiper: { num: 2, den: 10, value: .2 }
});

function runtime(file, initialPrefs = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'apps', file), 'utf8');
  const { window, document } = parseHTML(html);
  const selectPrototype = Object.getPrototypeOf(document.getElementById('departmentSel'));
  const selectValue = Object.getOwnPropertyDescriptor(selectPrototype, 'value');
  if (!selectValue.set) Object.defineProperty(selectPrototype, 'value', {
    configurable: true,
    get: selectValue.get,
    set(value) {
      const options = [...this.querySelectorAll('option')];
      for (const option of options) option.selected = false;
      const selected = options.find(option => option.value === String(value));
      if (selected) selected.selected = true;
    }
  });
  const stored = new Map(Object.entries(initialPrefs));
  const localStorage = {
    getItem: key => stored.has(key) ? stored.get(key) : null,
    setItem: (key, value) => stored.set(key, String(value))
  };
  const timers = [], charts = [];
  let dataReads = 0;
  const read = () => { dataReads++; throw new Error('Profile controls must use already loaded data.'); };
  class Chart {
    constructor(canvas, config) { this.canvas = canvas; this.config = config; this.destroyed = false; charts.push(this); }
    destroy() { this.destroyed = true; }
  }
  Object.assign(window, {
    localStorage, Chart,
    CoachToolsWeeklyIndex: globalThis.CoachToolsWeeklyIndex,
    CoachToolsScorecardPeriods: globalThis.CoachToolsScorecardPeriods,
    CoachToolsData: { getCurrent: read, getHistory: read, getRecord: read },
    CoachToolsIdentity: { ready: read, getAllPeople: read }
  });
  const sandbox = {
    window, document, localStorage, Chart, console, URL,
    CoachToolsWeeklyIndex: window.CoachToolsWeeklyIndex,
    CoachToolsData: window.CoachToolsData,
    CoachToolsIdentity: window.CoachToolsIdentity,
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    requestAnimationFrame: callback => { timers.push(callback); return timers.length; }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared', 'performance-scorecard-coaching-response.js'), 'utf8'), context);
  sandbox.CoachToolsPerformanceScorecardCoachingResponse = window.CoachToolsPerformanceScorecardCoachingResponse;
  const scripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi), match => match[1]);
  const original = scripts.find(source => source.includes('const state =') && source.includes('function openProfile('));
  assert.ok(original, `${file} has its actual profile runtime`);
  const apiNames = ['state', 'METRICS', 'profileView', 'weekSelections', 'loadProfilePrefs', 'saveProfilePrefs', 'profileHistoryDates', 'profileMetricPoints', 'profileHistoryLabel', 'syncProfileControls', 'applyProfileCoachingVisibility', 'installProfileControls', 'metricRelevantRows', 'openProfile', 'closeProfile', 'rowData', 'teamCohortFor', 'mainWindowSpec', 'resetCalcCache', 'render'];
  const source = original.replace(/^events\(\);loadData\(\)\.catch[^\r\n]*$/m,
    `loadPrefs();events();window.profileTestApi={${apiNames.join(',')}};`);
  assert.notEqual(source, original, 'The harness suppresses only initial datastore loading.');
  vm.runInContext(source, context);
  const api = window.profileTestApi;
  const rep = { personId: 'rep-jane', role: 'representative', displayName: 'Jane Doe', department: 'Retail', currentCoachId: 'coach-one' };
  const other = { personId: 'rep-other', role: 'representative', displayName: 'Other Person', department: 'Retail', currentCoachId: 'coach-one' };
  const coach = { personId: 'coach-one', role: 'coach', displayName: 'Coach One', department: 'Retail' };
  api.state.people = [rep, other, coach];
  api.state.byId = new Map(api.state.people.map(person => [person.personId, person]));
  api.state.scopeByRep = new Map([[rep.personId, { department: 'Retail', team: 'Team One', teamKey: 'team one', coachName: coach.displayName, coachKey: 'coach one' }]]);
  api.state.weeklyByRep = new Map([
    [rep.personId, [...weeks.map((week, index) => point(week, index)), point('2026-10-11', 0, 'weeklyReferral')]],
    [other.personId, [point('2026-10-10', 0)]]
  ]);
  api.state.reportingDates = new Map([
    ['weeklyRetail', new Set([...weeks, '2026-10-10'])],
    ['weeklyReferral', new Set(['2026-10-11'])]
  ]);
  api.state.qaByRep = new Map([[rep.personId, weeks.map((week, index) => ({ date: new Date(`${week}T12:00:00Z`), score: index < 6 ? .9 : .7 }))]]);
  api.state.coachingByRep = new Map([[rep.personId, [
    { date: new Date(`${weeks[6]}T12:00:00Z`), topics: ['Consumer appointments'], description: 'Use an appointment close.' },
    { date: new Date(`${weeks[6]}T12:00:00Z`), topics: ['Call quality'], description: 'Follow the call flow.' }
  ]]]);
  api.state.checklistByRep = new Map([[rep.personId, [{ created: new Date(`${weeks[1]}T12:00:00Z`), incident: 'Consumer appointment follow-up', action: 'Observe a call', served: false }]]]);
  document.querySelector('#departmentSel option[value="Retail"]').selected = true;
  const flush = () => { while (timers.length) timers.shift()(); };
  const selectMain = selected => { api.weekSelections.set('Retail', new Set(selected)); api.resetCalcCache(); };
  selectMain([weeks[0], weeks[2]]);
  const change = (id, value) => {
    const control = document.getElementById(id);
    if (control.type === 'checkbox') control.checked = value;
    else control.value = String(value);
    control.dispatchEvent(new window.Event('change', { bubbles: true }));
    flush();
  };
  const open = (id = rep.personId) => { api.openProfile(id); flush(); };
  const activeCharts = () => charts.filter(chart => !chart.destroyed);
  return { api, rep, other, document, window, stored, charts, flush, open, change, selectMain, activeCharts, dataReads: () => dataReads };
}

for (const file of ['performance-scorecard.html', 'performance-scorecard-enhanced.html']) {
  test(`${file}: profile defaults to selected weeks and related coaching is visible`, () => {
    const { api, rep, document, open, activeCharts, dataReads } = runtime(file);
    open();
    assert.deepEqual(plain(api.profileHistoryDates(rep)), [weeks[0], weeks[2]]);
    assert.equal(document.getElementById('profileShowCoaching').checked, true);
    assert.equal(document.getElementById('profileHistoryWindow').value, 'selected');
    const coaching = [...document.querySelectorAll('[data-profile-coaching]')];
    assert.ok(coaching.length >= 6, 'The coaching lists, response narratives and total coaching card are tagged.');
    assert.ok(coaching.every(node => !node.hidden));
    assert.match(document.getElementById('profileContent').textContent, /Related Coaching/);
    assert.match(document.getElementById('profileContent').textContent, /Documented Coaching/);
    assert.match(document.getElementById('profileHistorySummary').textContent, /2/);
    for (const chart of activeCharts()) assert.equal(chart.config.data.labels.length, 2);
    assert.equal(dataReads(), 0);
  });

  test(`${file}: real toggle hides all coaching detail while preserving checklist and charts`, () => {
    const { document, charts, open, change, activeCharts, stored, dataReads } = runtime(file);
    open();
    const originalCharts = activeCharts();
    const originalContent = document.getElementById('profileContent').innerHTML;
    change('profileShowCoaching', false);
    assert.ok([...document.querySelectorAll('[data-profile-coaching]')].every(node => node.hidden));
    const checklist = [...document.querySelectorAll('.contextBlock, .activityCard')].filter(node => /Related Checklist|Checklist Context/.test(node.textContent));
    assert.ok(checklist.length > 0);
    assert.ok(checklist.every(node => !node.hidden), 'Checklist context remains visible.');
    assert.deepEqual(activeCharts(), originalCharts, 'Visibility toggles retain the existing chart instances.');
    assert.equal(charts.length, originalCharts.length);
    assert.equal(JSON.parse(stored.get(PREF_KEY)).showCoaching, false);
    change('profileShowCoaching', true);
    assert.ok([...document.querySelectorAll('[data-profile-coaching]')].every(node => !node.hidden));
    assert.equal(document.getElementById('profileContent').innerHTML, originalContent);
    assert.equal(dataReads(), 0);
  });

  test(`${file}: extended history changes chart observations without changing selected performance`, () => {
    const { api, rep, document, open, change, activeCharts, dataReads } = runtime(file);
    api.render();
    const table = document.getElementById('tableBody').innerHTML;
    const selected = plain(api.mainWindowSpec());
    const row = plain(api.rowData(rep, api.teamCohortFor(rep)));
    open();
    const hero = document.querySelector('.heroBars').textContent;
    for (const [value, count] of [['13', 13], ['26', 26], ['52', 52], ['all', 60], ['selected', 2]]) {
      change('profileHistoryWindow', value);
      assert.equal(api.profileHistoryDates(rep).length, count);
      assert.equal(api.profileMetricPoints(rep, 'consumer-rate').length, count);
      assert.equal(api.profileMetricPoints(rep, 'call-quality').length, count);
      for (const chart of activeCharts()) assert.equal(chart.config.data.labels.length, count);
      assert.deepEqual(plain(api.mainWindowSpec()), selected);
      assert.deepEqual(plain(api.rowData(rep, api.teamCohortFor(rep))), row);
      assert.equal(document.getElementById('tableBody').innerHTML, table);
      assert.equal(document.querySelector('.heroBars').textContent, hero);
      if (value === '13') {
        const consumerStory = document.getElementById(`chart_${rep.personId.replace(/[^a-z0-9]/gi, '_')}_consumer-rate`).closest('.metricStory');
        assert.match(consumerStory.textContent, /improved.*40\.0%.*70\.0%/i, 'The metric story describes the observed response to related coaching.');
      }
      assert.ok(!api.profileHistoryDates(rep).includes('2026-10-10'), 'Other representatives do not add observed weeks.');
      assert.ok(!api.profileHistoryDates(rep).includes('2026-10-11'), 'Another department does not add observed weeks.');
    }
    assert.equal(dataReads(), 0);
  });

  test(`${file}: preferences survive close, reopen and a fresh page`, () => {
    const first = runtime(file);
    first.open();
    first.change('profileShowCoaching', false);
    first.change('profileHistoryWindow', '26');
    assert.ok([...first.document.querySelectorAll('[data-profile-coaching]')].every(node => node.hidden), 'History refresh retains the hidden coaching setting.');
    first.api.closeProfile();
    assert.equal(first.activeCharts().length, 0);
    assert.equal(first.document.getElementById('profileSheet').classList.contains('show'), false);
    first.open();
    assert.equal(first.document.getElementById('profileShowCoaching').checked, false);
    assert.equal(first.document.getElementById('profileHistoryWindow').value, '26');
    assert.equal(first.api.profileHistoryDates(first.rep).length, 26);
    const second = runtime(file, Object.fromEntries(first.stored));
    second.open();
    assert.equal(second.document.getElementById('profileShowCoaching').checked, false);
    assert.equal(second.document.getElementById('profileHistoryWindow').value, '26');
    assert.ok([...second.document.querySelectorAll('[data-profile-coaching]')].every(node => node.hidden));
    assert.equal(second.dataReads(), 0);
  });

  test(`${file}: consumer response stays in the selected coaching area`, () => {
    const { api, rep, document, open, change, dataReads } = runtime(file);
    const insurance = { date: new Date(`${weeks[1]}T12:00:00Z`), topics: ['Insurance appointments'], description: 'Improve the insurance appointment offer.' };
    const commercial = { date: new Date(`${weeks[2]}T12:00:00Z`), topics: ['Commercial appointments'], description: 'Ask for the commercial appointment.' };
    api.state.coachingByRep.get(rep.personId).push(insurance, commercial);
    api.state.checklistByRep.get(rep.personId).push({ created: new Date(`${weeks[1]}T12:00:00Z`), incident: 'Insurance appointment follow-up', action: 'Observe the insurance appointment offer', served: false });
    const consumerRows = api.metricRelevantRows(rep.personId, api.METRICS['consumer-rate']);
    assert.equal(consumerRows.coaching.length, 1, 'Generic appointment words do not bring another named area into the consumer story.');
    assert.equal(consumerRows.checklist.length, 1);
    assert.equal(consumerRows.coaching[0].topics[0], 'Consumer appointments');
    assert.ok(api.metricRelevantRows(rep.personId, api.METRICS['insurance-rate']).coaching.includes(insurance));
    open();
    change('profileHistoryWindow', '13');
    const story = document.getElementById('chart_rep_jane_consumer-rate').closest('.metricStory');
    assert.equal(story.querySelector('[data-response-status]').dataset.responseStatus, 'improved');
    assert.match(story.querySelector('.coachingResponse').textContent, /Most recent related coaching: 08\/22\/2026/);
    assert.doesNotMatch(story.textContent, /insurance appointment offer|commercial appointment/i);
    assert.equal(dataReads(), 0);
  });

  test(`${file}: missing observations and invalid saved preferences remain usable`, () => {
    const runtimeState = runtime(file, { [PREF_KEY]: JSON.stringify({ showCoaching: 'false', historyWindow: 'invalid' }) });
    const { api, rep, document, open, change, activeCharts, dataReads } = runtimeState;
    assert.equal(api.profileView.showCoaching, true);
    assert.equal(api.profileView.historyWindow, 'selected');
    api.state.weeklyByRep.set(rep.personId, []);
    api.state.qaByRep.set(rep.personId, []);
    api.state.coachingByRep.set(rep.personId, []);
    api.state.checklistByRep.set(rep.personId, []);
    api.resetCalcCache();
    open();
    assert.deepEqual(plain(api.profileHistoryDates(rep)), []);
    assert.equal(activeCharts().length, 0);
    assert.match(document.getElementById('profileHistorySummary').textContent, /0|no .*observed|no .*history/i);
    assert.match(document.getElementById('profileContent').textContent, /No documented coaching/);
    change('profileHistoryWindow', 'all');
    assert.deepEqual(plain(api.profileMetricPoints(rep, 'consumer-rate')), []);
    change('profileShowCoaching', false);
    assert.ok([...document.querySelectorAll('[data-profile-coaching]')].every(node => node.hidden));
    api.openProfile('unknown-person');
    assert.equal(api.state.selectedId, rep.personId);
    assert.equal(dataReads(), 0);
  });
}
