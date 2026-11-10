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

function createHarness(data = fixture()) {
  const { window, document } = parseHTML(html), writes = [], charts = [], books = sourceBooks(data);
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
  window.VerificationAllStarCore = core;
  window.VerificationAllStarData = {
    loadMonth: async () => ({ reps: data.reps, metrics: data.metrics, weeks: ['2026-10-04'], diagnostics: [], scopeLabel: 'All people' }),
    filterWarningsForRoster: warnings => warnings
  };
  window.Chart = function Chart(canvas, config) { this.canvas = canvas; this.config = config; this.destroyed = false; this.destroy = () => { this.destroyed = true; }; charts.push(this); };
  window.setTimeout = callback => { queueMicrotask(callback); return 0; };
  vm.runInNewContext(script, { window, document, Option });
  function change(id, value, type = 'change') { get(id).value = value; get(id).dispatchEvent(new window.Event(type)); }
  async function upload(id, book, name) {
    Object.defineProperty(get(id), 'files', { configurable: true, value: [{ name, arrayBuffer: async () => book }] });
    get(id).dispatchEvent(new window.Event('change')); await settle();
  }
  async function run() {
    change('report-month', '2026-10');
    await upload('monthly-file', books.monthly, 'Verification October.xlsx');
    await upload('lane3-file', books.lane3, 'Lane 3 Monthly.xlsx');
    assert.equal(get('run-report').disabled, false, 'Both workbooks and the matched month tab enable the report.');
    get('run-report').click(); await settle();
    assert.equal(get('results').hidden, false, get('status').textContent);
  }
  return { window, document, get, writes, charts, data, run, change };
}

function sheetRows(book, name) { return XLSX.utils.sheet_to_json(book.Sheets[name], { defval: null, raw: true }); }
function standingNames(h) { return [...h.get('standings').querySelectorAll('.rep-name')].map(cell => cell.firstChild.textContent); }

test('the report foregrounds eligible standings and each lane winner with their own stats', async () => {
  const h = createHarness();
  assert.equal(h.get('report-setup').open, true);
  await h.run();
  assert.equal(h.get('report-setup').open, false, 'Completed report settings collapse so the results lead.');
  assert.equal(h.get('winners').children.length, 5);
  assert.equal(h.get('winners').querySelectorAll('.winner-person').length, 6, 'Both Lane 4 tied winners are retained.');
  assert.deepEqual(standingNames(h), [1, 2, 3, 4, 5].flatMap(lane => ['Lane ' + lane + ' Leader', 'Lane ' + lane + ' Peer']));
  assert.match(h.get('report-summary').textContent, /10 representatives ranked/);
  assert.match(h.get('report-summary').textContent, /5 of 5 lanes with winners/);
  assert.match(h.get('report-summary').textContent, /16 excluded/);
  assert.doesNotMatch(h.get('status').textContent, /incomplete|provisional/i);
  const sections = [...h.get('results').children];
  assert.ok(sections.indexOf(h.get('standings').closest('section')) < sections.indexOf(h.get('data-review')), 'Full standings precede coverage notes.');

  for (let lane = 1; lane <= 5; lane++) {
    const card = h.get('winners').querySelector('[data-lane="' + lane + '"]');
    assert.match(card.textContent, new RegExp('Lane ' + lane + ' Leader'));
    const leader = [...card.querySelectorAll('.winner-person')].find(person => person.querySelector('h3').textContent === 'Lane ' + lane + ' Leader');
    assert.match(leader.textContent, lane === 4 ? /85\.0%/ : /95\.0%/);
    assert.match(leader.textContent, /30\.0%/);
    assert.match(leader.textContent, /30 accepted \/ 100 offered/);
    assert.match(leader.textContent, /4 evaluations/);
    assert.match(leader.textContent, /Attendance: 0 \(#1\)/);
    assert.equal(leader.querySelector('.points').firstChild.textContent, lane === 2 ? '505' : lane === 4 ? '6' : '5');
    const stats = Object.fromEntries([...leader.querySelectorAll('dl>div')].map(stat => [stat.querySelector('dt').textContent, stat.querySelector('dd').firstChild.textContent]));
    assert.equal(stats[lane === 3 ? 'Cases / hr Salesforce' : 'VAPH'], lane === 3 ? '12.5' : '10');
  }
  const lane2 = h.get('winners').querySelector('[data-lane="2"]');
  assert.match(lane2.textContent, /Correctives: 1 \(#1\) · penalty 500/);
  const tiedPeer = [...h.get('winners').querySelectorAll('.winner-person')].find(person => person.querySelector('h3').textContent === 'Lane 4 Peer');
  assert.match(tiedPeer.textContent, /95\.0%/);
  assert.match(tiedPeer.textContent, /20\.0%/);
  assert.match(tiedPeer.textContent, /20 accepted \/ 100 offered/);
  assert.equal(tiedPeer.querySelector('.points').firstChild.textContent, '6', 'Tied winners each show their own metric values and total.');
  assert.equal(h.get('standings').querySelectorAll('.winner-tag').length, 6);
  assert.equal(h.get('standings').querySelectorAll('.score').length, 10);
  assert.equal(h.get('excluded-list').children.length, 16);
  for (const field of ['QA', 'Wipers', 'VAPH']) {
    const entry = [...h.get('excluded-list').children].find(row => row.querySelector('strong').textContent === 'Lane 1 No ' + field);
    assert.ok(entry.querySelectorAll('li').length, 'Each excluded representative has a specific reason.');
    assert.match(entry.textContent, field === 'QA' ? /Call Quality/ : new RegExp(field, 'i'));
  }
  assert.match(h.get('excluded-list').textContent, /Conflicting Wiper totals/);
});

test('filters keep excluded names out of standings while exports retain the full eligible cohort', async () => {
  const h = createHarness(); await h.run();
  h.change('lane-filter', '3');
  assert.deepEqual(standingNames(h), ['Lane 3 Leader', 'Lane 3 Peer']);
  assert.equal(h.charts.filter(chart => !chart.destroyed).length, 2);
  h.change('rep-search', 'No QA', 'input');
  assert.deepEqual(standingNames(h), []);
  assert.equal(h.charts.filter(chart => !chart.destroyed).length, 0);
  assert.match(h.get('standings').textContent, /No eligible representatives/);
  h.change('rep-search', 'Leader', 'input');
  assert.deepEqual(standingNames(h), ['Lane 3 Leader']);
  assert.equal(h.get('winners').querySelectorAll('.winner-person').length, 6, 'Table filters do not change the report winners.');
  h.get('export-report').click();
  assert.equal(h.writes.length, 1);
  const { book, filename } = h.writes[0];
  assert.equal(filename, 'Verification-All-Star-2026-10.xlsx');
  const saved = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellNF: true });
  const standings = sheetRows(saved, 'Full Rankings'), winners = sheetRows(saved, 'Lane Winners'), excluded = sheetRows(saved, 'Excluded');
  assert.equal(standings.length, 10, 'Export includes every eligible representative regardless of the visible filter.');
  assert.equal(winners.length, 6);
  assert.equal(excluded.length, 16);
  assert.ok(standings.every(row => !/No QA|No Wipers|No VAPH|Source Conflict/.test(row.Representative)));
  assert.ok(excluded.every(row => row['Reasons Excluded'] && !Object.hasOwn(row, 'Lane Rank') && !Object.hasOwn(row, 'Total Points')));
  for (const row of winners) {
    const tiedLeader = row.Representative === 'Lane 4 Leader', tiedPeer = row.Representative === 'Lane 4 Peer';
    assert.equal(row['Call Quality'], tiedLeader ? .85 : .95);
    assert.equal(row['Wipers Accepted'], tiedPeer ? 20 : 30);
    assert.equal(row['Wipers Offered'], 100);
    assert.equal(row['Wiper Rate'], tiedPeer ? .2 : .3);
    assert.equal(row['VAPH / Lane 3 Cases per Hour'], row.Lane === 3 ? 12.5 : 10);
    assert.equal(row['Lane Rank'], 1);
    assert.equal(row['Total Points'], ['Wiper Rank', 'VAPH Rank', 'Call Quality Rank', 'Attendance Rank', 'Corrective Rank'].reduce((sum, field) => sum + row[field], 0) + row['Corrective Penalty']);
    assert.equal(row.Winner, 'Yes');
  }
  assert.equal(winners.find(row => row.Lane === 2)['Total Points'], 505);
  assert.equal(saved.Sheets['Lane Winners'].H2.z, '0.0%');
  assert.equal(saved.Sheets['Lane Winners'].L2.z, '0.0%');
  h.change('lane-filter', 'all'); h.change('rep-search', '', 'input');
  assert.equal(standingNames(h).length, 10);
});

test('a lane without eligible representatives shows no winner while other lanes still rank', async () => {
  const data = fixture();
  for (const rep of data.reps.filter(rep => rep.lane === 5)) data.metrics[rep.name].quality = null;
  const h = createHarness(data); await h.run();
  const lane5 = h.get('winners').querySelector('[data-lane="5"]');
  assert.equal(lane5.querySelectorAll('.winner-person').length, 0);
  assert.match(lane5.textContent, /No eligible representatives/);
  assert.equal(standingNames(h).length, 8);
  assert.equal(h.get('winners').querySelectorAll('.winner-person').length, 5);
  assert.match(h.get('report-summary').textContent, /4 of 5 lanes with winners/);
  assert.doesNotMatch(h.get('status').textContent, /incomplete|provisional/i);
});

test('an entirely excluded roster exports no partial standings or false lane winners', async () => {
  const data = fixture(); Object.values(data.metrics).forEach(metric => { metric.quality = null; });
  const h = createHarness(data); await h.run();
  assert.deepEqual(standingNames(h), []);
  assert.equal(h.get('winners').querySelectorAll('.winner-person').length, 0);
  assert.equal(h.get('winners').children.length, 5);
  assert.equal(h.get('data-review').open, true);
  assert.match(h.get('status').textContent, /No eligible representatives/);
  h.get('export-report').click();
  assert.equal(sheetRows(h.writes[0].book, 'Full Rankings').length, 0);
  assert.equal(sheetRows(h.writes[0].book, 'Lane Winners').length, 0);
  assert.equal(sheetRows(h.writes[0].book, 'Excluded').length, 26);
});

module.exports = { createHarness, fixture };
