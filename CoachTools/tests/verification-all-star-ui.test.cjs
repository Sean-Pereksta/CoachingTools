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
  function settings(value) {
    if (value.measures) core.MEASURES.forEach(measure => { get('measure-' + measure.id).checked = value.measures.includes(measure.id); });
    if (value.requireAllWiperWeeks !== undefined) get('require-all-wiper-weeks').checked = value.requireAllWiperWeeks;
    if (value.correctivePenalty !== undefined) get('corrective-penalty').value = String(value.correctivePenalty);
    get('measure-wipers').dispatchEvent(new window.Event('change'));
  }
  async function rerun() { get('run-report').click(); await settle(); assert.equal(get('results').hidden, false, get('status').textContent); }
  return { window, document, get, writes, charts, loads, data, books, run, rerun, change, settings, upload, storage };
}

function sheetRows(book, name) { return XLSX.utils.sheet_to_json(book.Sheets[name], { defval: null, raw: true }); }
function standingNames(h) { return [...h.get('standings').querySelectorAll('.rep-name')].map(cell => cell.firstChild.textContent); }

test('the report foregrounds eligible standings and each lane winner with their own stats', async () => {
  const h = createHarness();
  h.get('preset-all').click();
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
  const h = createHarness(); h.get('preset-all').click(); await h.run();
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

test('performance defaults retain valid performance despite unknown checklist counts and Wiper week gaps', async () => {
  const data = fixture(), metric = data.metrics['Lane 1 Leader'];
  metric.attendance = null; metric.correctives = null;
  metric.issues = [{ code: 'missing-wiper-weeks', metric: 'wipers', message: 'Missing Wiper data for 2 of 4 available weeks.', blocking: true }];
  const h = createHarness(data);
  for (const measure of core.MEASURES) assert.equal(h.get('measure-' + measure.id).checked, ['wipers', 'vaph', 'quality'].includes(measure.id));
  assert.equal(h.get('require-all-wiper-weeks').checked, false);
  assert.equal(h.get('corrective-penalty').disabled, true);
  await h.run();
  assert.ok(standingNames(h).includes('Lane 1 Leader'));
  const leader = [...h.get('standings').querySelectorAll('tr')].find(row => row.querySelector('.rep-name')?.firstChild.textContent === 'Lane 1 Leader');
  assert.equal(leader.querySelector('.score').textContent, '3');
  assert.match(leader.children[6].textContent, /—not scored/);
  assert.match(leader.children[7].textContent, /—not scored/);
  assert.doesNotMatch(h.get('active-formula').textContent, /Attendance|Correctives|500/);
  assert.match(h.get('active-measures').textContent, /Wipers, VAPH, Call Quality/);
  assert.match(h.get('active-coverage').textContent, /missing weeks do not exclude/);
  assert.match(h.get('review-list').textContent, /Missing Wiper data for 2 of 4 available weeks.*informational/);
  assert.match(h.get('eligibility-period').textContent, /October 2026/);
  assert.match(h.get('eligibility-comparison').textContent, /Performance only includes 1 more/);
  const reasons = [...h.get('reason-counts').querySelectorAll('tr')];
  assert.equal(reasons.find(row => /Call Quality/.test(row.textContent)).lastChild.textContent, '5');
  assert.ok(!reasons.some(row => /Missing Wiper weeks/.test(row.textContent)), 'Optional week gaps are not counted as exclusion reasons.');
  h.get('export-report').click();
  const saved = XLSX.read(XLSX.write(h.writes[0].book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const exported = sheetRows(saved, 'Full Rankings').find(row => row.Representative === 'Lane 1 Leader');
  assert.equal(exported['Total Points'], 3);
  assert.equal(exported['Attendance Count'], null);
  assert.equal(exported['Corrective Count'], null);
  assert.equal(exported['Attendance Rank'], null);
  assert.equal(exported['Corrective Rank'], null);
  assert.equal(exported['Corrective Penalty'], 0);
  const settings = new Map(sheetRows(saved, 'Settings').map(row => [row.Setting, row.Value]));
  assert.equal(settings.get('Scored measure IDs'), 'wipers, vaph, quality');
  assert.equal(settings.get('Every available Wiper week required'), false);
  assert.equal(settings.get('Corrective penalty applied'), false);
  assert.ok(sheetRows(saved, 'Eligibility Review').some(row => row['Review Type'] === 'Informational' && row.Representative === 'Lane 1 Leader'));

  h.get('preset-all').click();
  assert.equal(h.get('results').hidden, true, 'Changed eligibility options invalidate the displayed report.');
  assert.equal(h.get('export-report').disabled, true);
  h.get('export-report').click(); assert.equal(h.writes.length, 1, 'An old report cannot be exported after changing its options.');
  h.settings({ requireAllWiperWeeks: true }); await h.rerun();
  assert.ok(!standingNames(h).includes('Lane 1 Leader'));
  assert.match(h.get('excluded-list').textContent, /Missing or invalid attendance/i);
  assert.match(h.get('reason-counts').textContent, /Missing Wiper weeks/);
  assert.match(h.get('eligibility-overview').textContent, /counts (?:can )?overlap/i);
  const reasonTotal = [...h.get('reason-counts').querySelectorAll('tr')].reduce((sum, row) => sum + Number(row.lastChild.textContent), 0);
  assert.ok(reasonTotal > 17, 'Overlapping reasons are reported individually rather than presented as mutually exclusive counts.');
  h.get('export-report').click();
  const review = sheetRows(h.writes[1].book, 'Eligibility Review');
  assert.equal(review.find(row => row['Review Type'] === 'Reason count' && row.Code === 'missing-wiper-weeks').People, 1);
  assert.ok(review.some(row => row['Review Type'] === 'Excluded person' && row.Representative === 'Lane 1 Leader' && row.Code === 'missing-attendance'));
  h.get('preset-performance').click(); await h.rerun();
  assert.equal(h.get('require-all-wiper-weeks').checked, false);
  assert.ok(standingNames(h).includes('Lane 1 Leader'));
});

test('custom selected measures and corrective points persist and reproduce the exported calculation', async () => {
  const storage = new Map(), h = createHarness(fixture(), { storage });
  h.settings({ measures: ['quality', 'correctives'], correctivePenalty: 25 });
  assert.equal(h.get('corrective-penalty').disabled, false);
  assert.equal(h.get('require-all-wiper-weeks').disabled, true);
  await h.run();
  assert.ok(standingNames(h).includes('Lane 2 No Wipers'), 'Missing an unselected measure does not exclude the representative.');
  assert.ok(standingNames(h).includes('Lane 2 No VAPH'));
  assert.match(h.get('active-formula').textContent, /Call Quality rank \+ Correctives rank \+ 25 × corrective count/);
  h.get('export-report').click();
  const saved = XLSX.read(XLSX.write(h.writes[0].book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  for (const row of sheetRows(saved, 'Full Rankings')) {
    assert.equal(row['Wiper Rank'], null);
    assert.equal(row['VAPH Rank'], null);
    assert.equal(row['Attendance Rank'], null);
    assert.equal(row['Corrective Penalty'], row['Corrective Count'] * 25);
    assert.equal(row['Total Points'], row['Call Quality Rank'] + row['Corrective Rank'] + row['Corrective Penalty']);
  }
  const exportedSettings = new Map(sheetRows(saved, 'Settings').map(row => [row.Setting, row.Value]));
  assert.deepEqual(JSON.parse(exportedSettings.get('Settings JSON')), { measures: ['quality', 'correctives'], requireAllWiperWeeks: false, correctivePenalty: 25 });
  const restored = createHarness(fixture(), { storage });
  assert.equal(restored.get('measure-quality').checked, true);
  assert.equal(restored.get('measure-correctives').checked, true);
  assert.equal(restored.get('measure-wipers').checked, false);
  assert.equal(restored.get('corrective-penalty').value, '25');
  h.settings({ measures: [] });
  assert.equal(h.get('run-report').disabled, true);
  assert.equal(h.get('settings-error').hidden, false);
  assert.match(h.get('settings-error').textContent, /at least one/i);
  const stillValid = createHarness(fixture(), { storage });
  assert.equal(stillValid.get('measure-quality').checked, true, 'An empty selection does not replace the last valid saved settings.');
});

test('older preferences and unavailable browser storage keep the tolerant performance defaults', async () => {
  const storage = new Map([['verificationAllStar.settings.v1', JSON.stringify({ measures: core.MEASURES.map(measure => measure.id), requireAllWiperWeeks: true })]]);
  const h = createHarness(fixture(), { storage });
  assert.equal(h.get('measure-attendance').checked, false);
  assert.equal(h.get('measure-correctives').checked, false);
  assert.equal(h.get('require-all-wiper-weeks').checked, false);
  const blocked = createHarness(fixture(), { blockStorage: true });
  blocked.settings({ measures: ['wipers', 'quality'] });
  await blocked.run();
  assert.match(blocked.get('active-measures').textContent, /Wipers, Call Quality/);
  assert.equal(blocked.get('results').hidden, false);
});

test('an invalid corrective penalty blocks only when Correctives is selected', async () => {
  const h = createHarness(); h.get('preset-all').click(); await h.run();
  h.settings({ correctivePenalty: -1 });
  assert.equal(h.get('run-report').disabled, true);
  assert.equal(h.get('settings-error').hidden, false);
  h.settings({ measures: ['wipers', 'vaph', 'quality'] });
  assert.equal(h.get('corrective-penalty').disabled, true);
  assert.equal(h.get('run-report').disabled, false, 'An inactive negative penalty does not block performance scoring.');
  await h.rerun();
  assert.doesNotMatch(h.get('active-formula').textContent, /corrective|500|-1/i);
  h.get('export-report').click();
  assert.ok(sheetRows(h.writes[0].book, 'Full Rankings').every(row => row['Corrective Penalty'] === 0));
  h.settings({ measures: ['wipers', 'vaph', 'quality', 'correctives'] });
  assert.equal(h.get('corrective-penalty').value, '-1');
  assert.equal(h.get('run-report').disabled, true, 'Reactivating Correctives requires correcting its invalid penalty.');
  h.settings({ correctivePenalty: 0 });
  assert.equal(h.get('run-report').disabled, false);
});

test('quality-only scoring needs neither Lane 3 nor a valid optional Wiper addition', async () => {
  const h = createHarness(); h.settings({ measures: ['quality'] });
  h.window.VerificationAllStarData.parseWiperUpload = async () => { throw Error('Unreadable Wiper report.'); };
  await h.upload('wiper-file', {}, 'bad-wipers.csv');
  await h.run({ skipLane3: true });
  assert.equal(h.get('lane3-sheet').disabled, true);
  assert.ok(standingNames(h).includes('Lane 3 Leader'), 'The monthly roster is enough when VAPH is not scored.');
  assert.equal(h.loads.at(-1).options.uploads.length, 0, 'Inactive failed Wiper additions are not sent to the data reader.');
  assert.match(h.get('active-measures').textContent, /Call Quality/);
  h.settings({ measures: ['quality', 'vaph'] });
  assert.equal(h.get('run-report').disabled, true, 'Selecting VAPH requires the Lane 3 workbook and month tab.');
  await h.upload('lane3-file', h.books.lane3, 'Lane 3 Monthly.xlsx');
  assert.equal(h.get('run-report').disabled, false);
  await h.rerun();
  h.settings({ measures: ['quality', 'vaph', 'wipers'] });
  assert.equal(h.get('run-report').disabled, true, 'Selecting Wipers requires resolving its retained failed addition.');
});

module.exports = { createHarness, fixture };
