'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const ROOT = path.resolve(__dirname, '..');
const KEY = 'coachtools.performanceScorecard.ranking.v1';
const plain = value => JSON.parse(JSON.stringify(value));
const row = (id, consumer, qa, corrective) => ({
  rep: { personId: id, displayName: id },
  packs: {
    'consumer-rate': { value: consumer, coverage: { eligible: true } },
    'call-quality': { value: qa, coverage: { eligible: true } }
  },
  custom: { correctives: corrective }
});
const rows = [row('A', .8, .95, 2), row('B', .6, .7, 0), row('C', 0, 0, 5)];

function runtime(file, initial = new Map()) {
  const html = fs.readFileSync(path.join(ROOT, 'apps', file), 'utf8');
  const { window, document } = parseHTML(html);
  const proto = Object.getPrototypeOf(document.getElementById('departmentSel'));
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (!descriptor.set) Object.defineProperty(proto, 'value', {
    configurable: true, get: descriptor.get,
    set(value) {
      for (const option of this.querySelectorAll('option')) option.selected = option.value === String(value);
    }
  });
  const stored = new Map(initial);
  const localStorage = {
    getItem: key => stored.get(key) || null,
    setItem: (key, value) => stored.set(key, String(value))
  };
  const state = {
    config: { custom: [{ id: 'correctives', label: 'Correctives', visible: false }] },
    sort: { key: 'representative', dir: 1 }
  };
  const context = vm.createContext({
    window, document, localStorage, state, rows, console,
    $: id => document.getElementById(id),
    esc: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
    goalDefinition: id => ({ direction: id === 'days-since-coaching' ? 'lower' : 'higher' }),
    METRICS: { 'consumer-rate': {}, 'call-quality': {} },
    GoalService: () => null, trendTooltip: () => '',
    THEMES: {}, int: value => String(value), pct: value => String(value)
  });
  const builtins = html.slice(html.indexOf('const BUILTINS ='), html.indexOf('const state ='));
  const sortValue = html.split('\n').find(line => line.startsWith('function sortValue('));
  let ranking = html.slice(html.indexOf("const RANK_PREF_KEY='"), html.indexOf("window.addEventListener('error'"));
  assert.ok(ranking.includes('data-rank-include'), `${file} contains ranking checklist behavior`);
  // Keep the real checklist and delegated event handlers. Table rendering is
  // replaced with recomputation so fixture data can isolate ranking decisions.
  ranking = ranking.replace(/^function render\(\)\{[^\r\n]*\}/m,
    'function render(){prepareNormalRankContext(rows);renderRankingConfig();window.rankRenderCount=(window.rankRenderCount||0)+1}');
  vm.runInContext(`${builtins}\n${sortValue}\n${ranking}\nwindow.rankTest={rankingAvailableIds,rankingDirection,buildRanking,normalOverallRankCell,renderRankingConfig,rankingState,scorecardViewState};render();`, context);
  const api = window.rankTest;
  const change = (selector, value) => {
    const control = document.querySelector(selector);
    assert.ok(control, selector);
    if (control.type === 'checkbox') control.checked = value;
    else control.value = value;
    control.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const click = id => document.getElementById(id).dispatchEvent(new window.Event('click', { bubbles: true }));
  return { api, document, window, stored, context, change, click };
}

for (const file of ['performance-scorecard.html', 'performance-scorecard-enhanced.html']) {
  test(`${file}: checklist offers all built-in and custom columns independent of visibility or department`, () => {
    const r = runtime(file);
    const ids = plain(r.api.rankingAvailableIds());
    assert.equal(ids.length, 16, 'All fifteen numeric built-ins plus the custom column');
    assert.ok(!ids.includes('representative'));
    assert.ok(!ids.includes('rank-overall'));
    assert.ok(ids.includes('consumer-opps'));
    assert.ok(ids.includes('days-since-coaching'));
    assert.ok(ids.includes('correctives'), 'Hidden custom columns remain rank options');
    assert.equal(r.document.querySelectorAll('[data-rank-include]').length, 16);
    assert.equal(r.document.querySelectorAll('[data-rank-direction]').length, 16);
    r.document.getElementById('departmentSel').value = 'Referral';
    r.api.renderRankingConfig();
    assert.ok(r.document.querySelector('[data-rank-include="consumer-rate"]'), 'Choices remain available across department switches');
    r.document.getElementById('departmentSel').value = 'All';
    assert.ok(plain(r.api.buildRanking(rows).rules).some(rule => rule.id === 'consumer-rate'), 'All department scope includes Retail KPI data');
  });

  test(`${file}: selecting two columns and changing high/low changes the normal Overall Rank`, () => {
    const r = runtime(file);
    r.click('rankClearBtn');
    assert.equal(r.api.rankingState.rules.length, 0);
    assert.match(r.api.normalOverallRankCell(rows[0]), /No ranking columns selected/);
    assert.ok(r.api.buildRanking(rows).items.every(item => !Number.isFinite(item.overall)), 'Clearing does not restore defaults');
    r.change('[data-rank-include="consumer-rate"]', true);
    r.change('[data-rank-direction="correctives"]', 'low');
    r.change('[data-rank-include="correctives"]', true);
    assert.deepEqual(plain(r.api.rankingState.rules), [{ id: 'consumer-rate', higher: true }, { id: 'correctives', higher: false }]);
    let result = r.api.buildRanking(rows);
    assert.deepEqual(plain(result.items.map(item => [item.row.rep.personId, item.score, item.overall])), [['A', 3, 1], ['B', 3, 1], ['C', 6, 3]]);
    assert.match(r.api.normalOverallRankCell(rows[1]), /#1/);
    r.change('[data-rank-direction="correctives"]', 'high');
    result = r.api.buildRanking(rows);
    assert.deepEqual(plain(result.items.map(item => [item.row.rep.personId, item.score, item.overall])), [['A', 3, 1], ['B', 5, 3], ['C', 4, 2]]);
    assert.match(r.api.normalOverallRankCell(rows[1]), /#3/);
    assert.match(r.document.getElementById('rankingConfigBox').textContent, /2 ranking columns selected/);
  });

  test(`${file}: checked rules and unchecked directions persist across reopening`, () => {
    const saved = new Map([[KEY, JSON.stringify({ rules: [{ id: 'correctives', higher: false }] })]]);
    const r = runtime(file, saved);
    assert.deepEqual(plain(r.api.rankingState.rules), [{ id: 'correctives', higher: false }], 'Existing v1 ranking selection survives');
    r.change('[data-rank-include="correctives"]', false);
    r.change('[data-rank-direction="wiper-volume"]', 'low');
    const reopened = runtime(file, r.stored);
    assert.equal(reopened.api.rankingState.rules.length, 0);
    assert.equal(reopened.api.rankingDirection('correctives'), false);
    assert.equal(reopened.api.rankingDirection('wiper-volume'), false);
    reopened.change('[data-rank-include="correctives"]', true);
    assert.deepEqual(plain(reopened.api.rankingState.rules), [{ id: 'correctives', higher: false }]);
  });

  test(`${file}: zero is valid ranking data and missing checked values remain unranked`, () => {
    const r = runtime(file, new Map([[KEY, JSON.stringify({ rules: [{ id: 'correctives', higher: false }] })]]));
    const result = r.api.buildRanking([...rows, row('missing', .5, .8, NaN)]);
    assert.equal(result.items.find(item => item.row.rep.personId === 'B').overall, 1, 'A zero count is the lowest valid count');
    assert.ok(!Number.isFinite(result.items.find(item => item.row.rep.personId === 'missing').overall));
    r.click('rankClearBtn');
    r.change('[data-rank-include="consumer-rate"]', true);
    r.change('[data-rank-direction="consumer-rate"]', 'low');
    assert.equal(r.api.buildRanking(rows).items.find(item => item.row.rep.personId === 'C').overall, 1, 'A zero rate remains valid when low values rank best');
  });
}
