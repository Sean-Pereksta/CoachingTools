'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const XLSX = require('../vendor/xlsx.full.min.js');
const core = require('../shared/verification-all-star-core.js');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'apps/verification-all-star.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'shared/verification-all-star.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const reps = [], metrics = {}, lane3Values = {};
  for (let lane = 1; lane <= 5; lane++) {
    for (const role of ['Leader', 'Peer', 'No QA', 'No Wipers', 'No VAPH']) {
      const name = 'Lane ' + lane + ' ' + role, peer = role === 'Peer';
      reps.push({ name, lane, coach: 'Coach ' + lane, vaph: role === 'No VAPH' ? null : peer && lane !== 4 ? 8 : 10 });
      metrics[name] = {
        accepted: role === 'No Wipers' ? null : peer ? 20 : 30,
        offered: role === 'No Wipers' ? null : 100,
        quality: role === 'No QA' ? null : lane === 4 && role === 'Leader' || peer && lane !== 4 ? .85 : .95,
        qaCount: role === 'No QA' ? 0 : 4,
        attendance: peer && lane !== 4 ? 1 : 0,
        correctives: lane === 2 ? peer ? 2 : 1 : 0,
        weeklyWipers: [{ week: '2026-10-04', accepted: 15, offered: 50, rate: .3 }]
      };
      if (lane === 3) lane3Values[name] = role === 'No VAPH' ? null : peer ? 8.5 : 12.5;
    }
  }
  const conflict = { name: 'Lane 1 Source Conflict', lane: 1, coach: 'Coach 1', vaph: 100 };
  reps.push(conflict);
  metrics[conflict.name] = { accepted: 99, offered: 100, quality: 1, qaCount: 4, attendance: 0, correctives: 0,
    issues: [{ message: 'Conflicting Wiper totals for this representative.', blocking: true }] };
  return { reps, metrics, lane3Values };
}

function sourceBooks(data) {
  const monthly = XLSX.utils.book_new(), lane3 = XLSX.utils.book_new();
  for (let lane = 1; lane <= 5; lane++) {
    const members = data.reps.filter(rep => rep.lane === lane);
    const header = []; header[26] = 'Name';
    const activity = []; activity[26] = 'Name'; activity[37] = 'Verification Activity per Staffed Time';
    const rows = [[], [], [], [], header];
    for (const rep of members) { const row = []; row[26] = rep.name; rows.push(row); }
    const total = []; total[26] = 'Totals'; rows.push(total, activity);
    for (const rep of members) { const row = []; row[26] = rep.name; row[37] = lane === 3 ? 999 : rep.vaph; rows.push(row); }
    rows.push(total);
    XLSX.utils.book_append_sheet(monthly, XLSX.utils.aoa_to_sheet(rows), 'Lane ' + lane);
  }
  XLSX.utils.book_append_sheet(monthly, XLSX.utils.aoa_to_sheet([
    ['Name', '', 'Team_Name'], ...data.reps.map(rep => [rep.name, '', rep.coach])
  ]), 'Phone Data');
  XLSX.utils.book_append_sheet(lane3, XLSX.utils.aoa_to_sheet([
    ['Name', 'Avg Cases per hr Salesforce'], ...Object.entries(data.lane3Values)
  ]), 'October 2026');
  return { monthly, lane3 };
}

function createHarness(data = fixture(), options = {}) {
  const { window, document } = parseHTML(html), writes = [], charts = [], loads = [], books = sourceBooks(data), storage = options.storage || new Map();
  const get = id => document.getElementById(id);
  for (const detail of document.querySelectorAll('details')) Object.defineProperty(detail, 'open', {
    get: () => detail.hasAttribute('open'),
    set: value => value ? detail.setAttribute('open', '') : detail.removeAttribute('open')
  });
  for (const select of document.querySelectorAll('select')) Object.defineProperty(select, 'value', {
    get() { return [...this.options].find(option => option.selected)?.value ?? this.firstChild?.value ?? ''; },
    set(value) {
      [...this.options].forEach(option => option.removeAttribute('selected'));
      [...this.options].find(option => option.value === String(value))?.setAttribute('selected', '');
    }
  });
  function Option(text, value, defaultSelected, selected) {
    const option = document.createElement('option'); option.textContent = text; option.value = value;
    if (selected) option.setAttribute('selected', '');
    return option;
  }
  window.XLSX = { ...XLSX, read: book => book, writeFile: (book, filename) => writes.push({ book, filename }) };
  window.localStorage = options.blockStorage ? { getItem() { throw Error('Unavailable'); }, setItem() { throw Error('Unavailable'); } } : {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value))
  };
  window.VerificationAllStarCore = core;
  window.VerificationAllStarData = {
    loadMonth: async (month, reps, loadOptions) => { loads.push({ month, reps, options: loadOptions }); return { reps: data.reps, metrics: data.metrics, weeks: ['2026-10-04'], diagnostics: [], scopeLabel: 'All people' }; },
    filterWarningsForRoster: warnings => warnings
  };
  window.Chart = function Chart(canvas, config) { this.canvas = canvas; this.config = config; this.destroyed = false; this.destroy = () => { this.destroyed = true; }; charts.push(this); };
  window.setTimeout = callback => { queueMicrotask(callback); return 0; };
  const asyncUploadHandlers = new Map(), wiperInput = get('wiper-file'), addWiperListener = wiperInput.addEventListener.bind(wiperInput);
  wiperInput.addEventListener = (type, handler, ...args) => { if (type === 'change') asyncUploadHandlers.set(type, handler); addWiperListener(type, handler, ...args); };
  vm.runInNewContext(script, { window, document, Option });
  function change(id, value, type = 'change') { get(id).value = value; get(id).dispatchEvent(new window.Event(type)); }
  async function upload(id, book, name) {
    Object.defineProperty(get(id), 'files', { configurable: true, value: [{ name, arrayBuffer: async () => book }] });
    const input = get(id);
    // linkedom clears event.target after dispatch; await the registered async
    // upload handler with the stable target supplied by a browser event.
    if (id === 'wiper-file') await asyncUploadHandlers.get('change')({ target: input });
    else input.dispatchEvent(new window.Event('change'));
    await settle();
  }
  async function run({ skipLane3 = false } = {}) {
    change('report-month', '2026-10');
    await upload('monthly-file', books.monthly, 'Verification October.xlsx');
    if (!skipLane3) await upload('lane3-file', books.lane3, 'Lane 3 Monthly.xlsx');
    assert.equal(get('run-report').disabled, false, 'The roster and sources required by the selected measures enable the report.');
    get('run-report').click(); await settle();
    assert.equal(get('results').hidden, false, get('status').textContent);
  }
  function settings(value, { lane = get('policy-lane').value, all = false } = {}) {
    if (get('policy-lane').value !== String(lane)) change('policy-lane', String(lane));
    const required = value.requiredMeasures ?? value.measures, ranked = value.rankedMeasures ?? value.measures;
    if (required) core.MEASURES.forEach(measure => { get('require-' + measure.id).checked = required.includes(measure.id); });
    if (ranked) core.MEASURES.forEach(measure => { get('measure-' + measure.id).checked = ranked.includes(measure.id); });
    if (value.requireAllWiperWeeks !== undefined) get('require-all-wiper-weeks').checked = value.requireAllWiperWeeks;
    if (value.correctivePenalty !== undefined) get('corrective-penalty').value = String(value.correctivePenalty);
    get('measure-wipers').dispatchEvent(new window.Event('change'));
    if (all) get('apply-all-lanes').click();
  }
  async function rerun() { get('run-report').click(); await settle(); assert.equal(get('results').hidden, false, get('status').textContent); }
  return { window, document, get, writes, charts, loads, data, books, run, rerun, change, settings, upload, storage };
}

function sheetRows(book, name) { return XLSX.utils.sheet_to_json(book.Sheets[name], { defval: null, raw: true }); }
function standingNames(h) { return [...h.get('standings').querySelectorAll('.rep-name')].map(cell => cell.firstChild.textContent); }

function savedReport(h) { h.get('export-report').click(); return XLSX.read(XLSX.write(h.writes.at(-1).book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellNF: true }); }
function tableRow(h, name) { return [...h.get('standings').querySelectorAll('tr')].find(row => row.querySelector('.rep-name')?.firstChild.textContent === name); }
function smallFixture(lane = 1) {
  const reps = ['Eligible One', 'Eligible Two', 'Missing Gate'].map((name, i) => ({ name, lane, coach: 'Example Coach', vaph: 10 - i }));
  return { reps, metrics: Object.fromEntries(reps.map(rep => [rep.name, { accepted: 3, offered: 10, quality: .9, qaCount: 2, attendance: 0, correctives: 0 }])), lane3Values: Object.fromEntries(reps.map((rep, i) => [rep.name, 12 - i])) };
}

test('all-five preset applies only on request and exports complete per-lane standings and tied winners', async () => {
  const h = createHarness(); h.get('preset-all').click(); h.get('apply-all-lanes').click(); await h.run();
  assert.equal(h.get('report-setup').open, false);
  assert.equal(standingNames(h).length, 10);
  assert.equal(h.get('winners').children.length, 5);
  assert.equal(h.get('winners').querySelectorAll('.winner-person').length, 6);
  assert.equal(h.get('active-lane-rules').children.length, 5);
  const tiedPeer = [...h.get('winners').querySelectorAll('.winner-person')].find(person => person.querySelector('h3').textContent === 'Lane 4 Peer');
  assert.match(tiedPeer.textContent, /20 accepted \/ 100 offered/);
  assert.match(tiedPeer.textContent, /95\.0%/);
  h.change('lane-filter', '3'); assert.deepEqual(standingNames(h), ['Lane 3 Leader', 'Lane 3 Peer']);
  const book = savedReport(h), standings = sheetRows(book, 'Full Rankings'), winners = sheetRows(book, 'Lane Winners');
  assert.equal(standings.length, 10); assert.equal(winners.length, 6); assert.equal(sheetRows(book, 'Excluded').length, 16);
  for (const row of standings) assert.equal(row['Total Points'], ['Wiper Rank', 'VAPH Rank', 'Call Quality Rank', 'Attendance Rank', 'Corrective Rank'].reduce((sum, key) => sum + row[key], 0) + (row['Corrective Penalty'] || 0) + row['Missing Penalty Adjustment']);
  assert.equal(winners.find(row => row.Lane === 2)['Total Points'], 505);
  assert.equal(winners.find(row => row.Lane === 3)['VAPH / Lane 3 Cases per Hour'], 12.5);
  assert.ok(sheetRows(book, 'Excluded').every(row => row['Reasons Excluded'] && !Object.hasOwn(row, 'Lane Rank') && !Object.hasOwn(row, 'Total Points')));
  assert.equal(sheetRows(book, 'Settings').length, 5);
  assert.ok(sheetRows(book, 'Eligibility Review').filter(row => row['Review Type'] === 'Reason count').every(row => Number.isInteger(row.Lane)));
});

test('lane editing is isolated, preserves invalid drafts, and copies to other lanes only explicitly', async () => {
  const h = createHarness(); await h.run();
  h.settings({ requiredMeasures: ['quality'], rankedMeasures: ['wipers', 'quality'] }, { lane: 1 });
  h.settings({ requiredMeasures: [], rankedMeasures: ['quality'] }, { lane: 2 });
  assert.equal(h.get('settings-error').hidden, true, 'No required measures is a valid lane policy.');
  h.change('policy-lane', '1');
  assert.equal(h.get('require-quality').checked, true); assert.equal(h.get('require-wipers').checked, false);
  assert.equal(h.get('measure-wipers').checked, true);
  h.settings({ rankedMeasures: [] }, { lane: 2 });
  assert.match(h.get('settings-error').textContent, /Lane 2/); assert.equal(h.get('run-report').disabled, true);
  h.change('policy-lane', '1');
  assert.match(h.get('settings-error').textContent, /Lane 2/);
  assert.equal(h.get('measure-wipers').checked, true, 'Switching the editor does not replace another lane policy.');
  h.change('policy-lane', '2'); assert.equal(h.get('measure-quality').checked, false, 'The invalid empty ranked draft is retained.');
  h.get('preset-performance').click(); assert.equal(h.get('run-report').disabled, false);
  h.change('policy-lane', '1'); h.get('apply-all-lanes').click();
  for (let lane = 1; lane <= 5; lane++) {
    h.change('policy-lane', String(lane)); assert.equal(h.get('require-wipers').checked, false); assert.equal(h.get('require-quality').checked, true); assert.equal(h.get('measure-wipers').checked, true); assert.equal(h.get('measure-vaph').checked, false);
  }
  assert.equal(h.get('results').hidden, true); assert.equal(h.get('export-report').disabled, true);
  h.get('export-report').click(); assert.equal(h.writes.length, 0);
  const restored = createHarness(fixture(), { storage: h.storage }); restored.change('policy-lane', '5'); assert.equal(restored.get('require-wipers').checked, false);
});

test('required-only quality qualifies without scoring while optional missing Wipers earn last-place points', async () => {
  const data = smallFixture(); data.metrics['Eligible Two'].accepted = null; data.metrics['Eligible Two'].offered = null; data.metrics['Missing Gate'].quality = null;
  const h = createHarness(data); h.settings({ requiredMeasures: ['quality'], rankedMeasures: ['wipers'] }); await h.run({ skipLane3: true });
  assert.deepEqual(standingNames(h), ['Eligible One', 'Eligible Two']);
  assert.match(tableRow(h, 'Eligible Two').children[3].textContent, /—.*last place #2.*missing\/unusable/);
  assert.match(tableRow(h, 'Eligible One').children[5].textContent, /required · not ranked/);
  assert.equal(tableRow(h, 'Eligible Two').querySelector('.score').firstChild.textContent, '2');
  h.change('policy-lane', '2');
  assert.match(tableRow(h, 'Eligible One').children[5].textContent, /required · not ranked/, 'Existing row badges use the row lane, not the editor lane.');
  const book = savedReport(h), row = sheetRows(book, 'Full Rankings').find(row => row.Representative === 'Eligible Two');
  assert.equal(row['Wiper Rate'], null); assert.equal(row['Wiper Rank'], 2); assert.equal(row['Call Quality Rank'], null);
  assert.equal(row['Required Measure IDs'], 'quality'); assert.equal(row['Ranked Measure IDs'], 'wipers'); assert.equal(row['Missing/Unusable Ranked Measures'], 'wipers');
  assert.ok(sheetRows(book, 'Eligibility Review').some(row => row['Review Type'] === 'Reason count' && row.Lane === 1 && row.Code === 'missing-quality'));
});

test('missing optional Correctives keep raw blanks and export a separate conservative adjustment', async () => {
  const data = smallFixture(); data.metrics['Eligible One'].correctives = 0; data.metrics['Eligible Two'].correctives = 2; data.metrics['Missing Gate'].correctives = null;
  const h = createHarness(data); h.settings({ requiredMeasures: ['quality'], rankedMeasures: ['correctives'], correctivePenalty: 500 }); await h.run({ skipLane3: true });
  assert.equal(tableRow(h, 'Eligible One').querySelector('.score').firstChild.textContent, '1');
  assert.equal(tableRow(h, 'Eligible Two').querySelector('.score').firstChild.textContent, '1,002');
  const missing = tableRow(h, 'Missing Gate'); assert.equal(missing.querySelector('.score').firstChild.textContent, '1,003');
  assert.match(missing.children[7].textContent, /—.*last place #3/); assert.match(missing.children[8].textContent, /1,000 missing-data adjustment/);
  const book = savedReport(h), row = sheetRows(book, 'Full Rankings').find(row => row.Representative === 'Missing Gate');
  assert.equal(row['Corrective Count'], null); assert.equal(row['Corrective Penalty'], null); assert.equal(row['Corrective Rank'], 3); assert.equal(row['Missing Penalty Adjustment'], 1000); assert.equal(row['Total Points'], 1003);
  const policy = sheetRows(book, 'Settings').find(row => row.Lane === 1); assert.equal(policy['Ranked Measure IDs'], 'correctives'); assert.equal(policy['Missing Ranked Policy'], 'last');
});

test('Lane 3 file gates only required Lane 3 VAPH; ranked-only missing VAPH uses last place', async () => {
  const data = smallFixture(3), h = createHarness(data);
  h.settings({ requiredMeasures: ['quality'], rankedMeasures: ['quality', 'vaph'] }, { lane: 3 });
  await h.run({ skipLane3: true });
  assert.equal(standingNames(h).length, 3);
  const exported = sheetRows(savedReport(h), 'Full Rankings');
  assert.ok(exported.every(row => row['VAPH / Lane 3 Cases per Hour'] === null && row['VAPH Rank'] === 1));
  h.settings({ requiredMeasures: ['quality', 'vaph'] }, { lane: 3 }); assert.equal(h.get('run-report').disabled, true);
  await h.upload('lane3-file', h.books.lane3, 'Lane 3 Monthly.xlsx'); assert.equal(h.get('run-report').disabled, false);
  await h.rerun(); assert.match(tableRow(h, 'Eligible One').children[4].textContent, /12/);
  const lane1 = createHarness(smallFixture(1)); lane1.settings({ requiredMeasures: ['vaph'], rankedMeasures: ['quality'] }); await lane1.run({ skipLane3: true });
  assert.equal(lane1.get('results').hidden, false, 'Other lanes use monthly VAPH and never force a Lane 3 file.');
});

test('Wiper source readiness uses only lanes present in the monthly roster and both policy lists', async () => {
  const h = createHarness(smallFixture(1)); h.settings({ requiredMeasures: ['quality'], rankedMeasures: ['quality'] });
  h.window.VerificationAllStarData.parseWiperUpload = async () => { throw Error('Unreadable Wiper report.'); };
  await h.upload('wiper-file', {}, 'bad-wipers.csv'); await h.run({ skipLane3: true });
  assert.equal(h.loads.at(-1).options.uploads.length, 0, 'Absent lanes with default Wiper rules do not require a Wiper source.');
  h.settings({ rankedMeasures: ['quality', 'wipers'] }); assert.equal(h.get('run-report').disabled, true);
  h.get('clear-wipers').click(); assert.equal(h.get('run-report').disabled, false);
});

test('flat v1 preferences migrate into both lists for all lanes and inactive controls do not gate', async () => {
  const storage = new Map([['verificationAllStar.scoringOptions.v1', JSON.stringify({ measures: ['quality', 'correctives'], requireAllWiperWeeks: false, correctivePenalty: 25 })]]);
  const h = createHarness(fixture(), { storage });
  for (let lane = 1; lane <= 5; lane++) { h.change('policy-lane', String(lane)); assert.equal(h.get('require-quality').checked, true); assert.equal(h.get('require-correctives').checked, true); assert.equal(h.get('measure-quality').checked, true); assert.equal(h.get('measure-correctives').checked, true); assert.equal(h.get('require-wipers').checked, false); assert.equal(h.get('corrective-penalty').value, '25'); }
  assert.ok(storage.has('verificationAllStar.scoringOptions.v2'));
  h.settings({ requiredMeasures: ['quality'], rankedMeasures: ['correctives'], correctivePenalty: -1 }, { lane: 1 }); assert.equal(h.get('settings-error').hidden, false);
  h.settings({ rankedMeasures: ['quality'] }); assert.equal(h.get('settings-error').hidden, true); assert.equal(h.get('corrective-penalty').disabled, true); assert.equal(h.get('require-all-wiper-weeks').disabled, true);
  h.settings({ rankedMeasures: ['correctives'] }); assert.equal(h.get('settings-error').hidden, false, 'Reactivated invalid penalty must be corrected.');
  const invalid = createHarness(fixture(), { storage: new Map([['verificationAllStar.scoringOptions.v2', '{invalid']]) }); assert.equal(invalid.get('require-wipers').checked, true); assert.equal(invalid.get('measure-quality').checked, true);
  const blocked = createHarness(smallFixture(), { blockStorage: true }); blocked.settings({ requiredMeasures: ['quality'], rankedMeasures: ['quality'] }); await blocked.run({ skipLane3: true });
});

module.exports = { createHarness, fixture };
