'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const names = require('../shared/weekly-data-builder-names.js');
const weeks = require('../shared/coaching-gaps-week-alignment.js');
const date = (year, month, day) => new Date(year, month - 1, day);
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(modify = false) {
  const header = ['Date', 'Sheet', 'Name', 'Consumer Opportunities', 'Consumer Appointments', 'Notes'];
  const previousRows = [header,
    ['9/13/2026', 'JANE SMITH', 'JOHN DOE', '100', '0', 'Keep ALL text'],
    ['9/20/2026', 'jane smith', 'john doe', '100', '40', '=unchanged'],
    ['9/27/2026', 'SECOND COACH', 'John Doe', '100', '', 'Other person'],
    ['', '', '', '', '', '']];
  const values = ['9/20/2026', 'JANE SMITH', 'ANNE-MARIE O’NEILL', '22', '0', 'New NOTE'];
  const firstNewRow = modify ? 4 : previousRows.length + 1;
  const newRecord = { values, name: values[2], coach: values[1], kind: modify ? 'modify-new' : 'matched', appointmentId: 'preserved-id', rowNumber: firstNewRow, changes: [] };
  const allRows = previousRows.map(r => r.slice());
  const impactRecords = [];
  if (modify) {
    allRows[2][4] = '50';
    impactRecords.push({ values: allRows[2], name: 'john doe', coach: 'jane smith', kind: 'modified', rowNumber: 3,
      changes: [{ index: 4, column: header[4], oldValue: '40', newValue: '50', source: 'appointments' }] });
    allRows.splice(3, 0, values);
    impactRecords.push(newRecord);
  } else allRows.push(values);
  return { mode: modify ? 'modify' : 'add', header, headerRow: 0, previousRows, allRows,
    newRows: [values], newRecords: [newRecord], impactRecords,
    stats: { firstNewRow, newRows: 1, modifiedRows: modify ? 1 : 0, modifiedCells: modify ? 1 : 0, totalRecords: 4 },
    analyses: { weekly: { dims: { name: 2, coach: 1, date: 0 } } },
    mapping: header.map((target, index) => ({ index, target, description: 'Original mapping' })),
    warnings: [], review: [], publication: { iso: '2026-09-20', us: '9/20/2026' } };
}

for (const [input, expected] of [
  ['john doe', 'John Doe'], ['JOHN DOE', 'John Doe'], ['jOhN dOe', 'John Doe'],
  ['anne-marie o’neill', 'Anne-Marie O’Neill'], ["D’ANGELO O'BRIEN", "D’Angelo O'Brien"],
  ['élodie müller', 'Élodie Müller'], ['J.P. SMITH', 'J.P. Smith'],
  ['  JOHN  DOE  ', '  John  Doe  '], ['DOE, JOHN', 'Doe, John'], ['', ''], ['   ', '   '],
  [null, null], [undefined, undefined], ['=HYPERLINK("x")', '=HYPERLINK("x")'], ["'=CMD", "'=CMD"]
]) test('Title Case safely formats ' + JSON.stringify(input), () => assert.equal(names.formatName(input, 'title'), expected));

test('lowercase and Preserve options are deterministic and invalid options are rejected', () => {
  assert.equal(names.formatName('JOHN Doe', 'lower'), 'john doe');
  assert.equal(names.formatName('McDONALD', 'preserve'), 'McDONALD');
  assert.throws(() => names.formatName('John', 'uppercase'), /Choose/);
  assert.equal(names.formatName(names.formatName('JOHN DOE', 'title'), 'title'), 'John Doe');
});

test('Add normalizes every historical and new name without mutating inputs or any metric/date/notes', () => {
  const input = fixture(), before = clone(input), output = names.normalizeResult(input, 'title');
  assert.deepEqual(input, before);
  assert.deepEqual(output.allRows.map(r => [r[0], ...r.slice(3)]), input.allRows.map(r => [r[0], ...r.slice(3)]));
  assert.deepEqual(output.allRows[0], input.header);
  assert.equal(output.allRows[1][2], 'John Doe');
  assert.equal(output.allRows[2][2], 'John Doe');
  assert.equal(output.allRows[1][1], 'Jane Smith');
  assert.equal(output.allRows[3][1], 'Second Coach');
  assert.equal(output.newRecords[0].name, 'Anne-Marie O’Neill');
  assert.equal(output.newRecords[0].coach, 'Jane Smith');
  assert.equal(output.newRecords[0].appointmentId, 'preserved-id');
  assert.equal(output.newRows[0], output.newRecords[0].values);
  assert.equal(output.newRows[0], output.allRows[input.stats.firstNewRow - 1]);
  assert.equal(output.allRows.length, input.allRows.length, 'case changes never merge people or weeks');
  assert.equal(output.nameNormalization.historyRows, 3);
  assert.deepEqual(output.previousRows, input.previousRows);
});

test('lowercase covers all dates and Preserve leaves the complete original result untouched', () => {
  const input = fixture();
  assert.equal(names.normalizeResult(input, 'preserve'), input);
  const output = names.normalizeResult(input, 'lower');
  for (const row of output.allRows.slice(1)) for (const index of [1, 2]) assert.equal(row[index], row[index].toLowerCase());
});

test('Modify includes name-only history changes in its locked impact preview and keeps insertion row numbers aligned', () => {
  const input = fixture(true), before = clone(input), output = names.normalizeResult(input, 'title');
  assert.deepEqual(input, before);
  assert.deepEqual(output.impactRecords.map(r => r.rowNumber), [2, 3, 4, 5]);
  assert.equal(output.impactRecords.find(r => r.rowNumber === 5).values[0], '9/27/2026');
  assert.equal(output.impactRecords.find(r => r.rowNumber === 4).kind, 'modify-new');
  assert.equal(output.stats.modifiedRows, 3);
  assert.equal(output.stats.modifiedCells, 6);
  for (const r of output.impactRecords) {
    assert.equal(r.values, output.allRows[r.rowNumber - 1]);
    for (const c of r.changes) assert.equal(c.newValue, r.values[c.index]);
  }
  assert.equal(output.allRows[2][4], '50', 'the requested source update is still applied');
  assert.deepEqual(output.allRows.map(r => [r[0], ...r.slice(3)]), input.allRows.map(r => [r[0], ...r.slice(3)]));
});

test('Modify merges source coach edits and case edits into one original-to-final change', () => {
  const input = fixture(true);
  input.allRows[2][1] = 'NEW COACH';
  input.impactRecords[0].changes.push({ index: 1, column: 'Sheet', oldValue: 'jane smith', newValue: 'NEW COACH', source: 'appointments' });
  const output = names.normalizeResult(input, 'title');
  const changes = output.impactRecords.find(r => r.rowNumber === 3).changes.filter(c => c.index === 1);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].oldValue, 'jane smith');
  assert.equal(changes[0].newValue, 'New Coach');
});

test('Modify removes an apparent source case edit that becomes identical to the original', () => {
  const input = fixture(true);
  input.allRows[2][1] = 'JANE SMITH';
  input.impactRecords[0].changes.push({ index: 1, column: 'Sheet', oldValue: 'Jane Smith', newValue: 'JANE SMITH', source: 'appointments' });
  const output = names.normalizeResult(input, 'title');
  assert.equal(output.impactRecords.find(r => r.rowNumber === 3).changes.some(c => c.index === 1), false);
});

test('Modify without inserted rows still normalizes historical names', () => {
  const input = fixture(true);
  input.allRows.splice(3, 1);
  input.newRecords = []; input.newRows = []; input.impactRecords.pop(); input.stats.firstNewRow = 0; input.stats.newRows = 0;
  const output = names.normalizeResult(input, 'title');
  assert.deepEqual(output.impactRecords.map(r => r.rowNumber), [2, 3, 4]);
  assert.equal(output.newRows.length, 0);
  assert.equal(output.allRows[3][1], 'Second Coach');
});

test('normalization uses mapped name columns and ignores manager, notes, and unmapped fields', () => {
  const input = fixture();
  input.analyses.weekly.dims.coach = -1;
  const output = names.normalizeResult(input, 'title');
  assert.equal(output.allRows[1][1], 'JANE SMITH');
  assert.equal(output.allRows[1][2], 'John Doe');
});

test('formatting review is capped, but the whole file is transformed', () => {
  const input = fixture();
  input.allRows = [input.header, ...Array.from({ length: 500 }, () => ['9/27/2026', 'JANE SMITH', 'JOHN DOE', '0', '', 'Notes'])];
  input.newRows = []; input.newRecords = []; input.stats.firstNewRow = 0;
  const output = names.normalizeResult(input, 'title');
  assert.equal(output.nameNormalization.cells, 1000);
  assert.equal(output.nameNormalization.examples.length, 100);
  assert.equal(output.allRows[500][2], 'John Doe');
});

test('wrapping both public build methods is idempotent and respects explicit options', () => {
  let mode = 'lower', calls = 0;
  const core = { assemble: () => fixture(), assembleModify: () => fixture(true) };
  names.wrapCore(core, () => mode, () => calls++);
  names.wrapCore(core, () => 'title', () => calls++);
  assert.equal(core.assemble({}).allRows[1][2], 'john doe');
  assert.equal(core.assemble({ options: { nameCapitalization: 'title' } }).allRows[1][2], 'John Doe');
  mode = 'preserve';
  assert.equal(core.assembleModify({}).allRows[1][2], 'JOHN DOE');
  assert.equal(calls, 3);
});

test('9/27 is the 9/27 Sunday week, never 9/20', () => {
  const key = weeks.weekKey(date(2026, 9, 27));
  assert.equal(key, '2026-W40');
  assert.equal(weeks.weekLabel(key), '9/27/2026');
  assert.equal(weeks.weekRange(key), '9/27/2026 – 10/3/2026');
  assert.equal(weeks.weekLabel(weeks.weekKey(date(2026, 9, 26))), '9/20/2026');
  for (const d of [date(2026, 9, 28), date(2026, 9, 30), date(2026, 10, 3)]) assert.equal(weeks.weekKey(d), key);
  assert.equal(weeks.weekLabel(weeks.weekKey(date(2026, 10, 4))), '10/4/2026');
});

test('week lists, year boundaries, invalid values, and key validation agree', () => {
  assert.deepEqual(weeks.listWeeks(date(2026, 9, 20), date(2026, 10, 4)).map(weeks.weekLabel), ['9/20/2026', '9/27/2026', '10/4/2026']);
  assert.deepEqual(weeks.listWeeks(date(2026, 9, 28), date(2026, 9, 27)), []);
  assert.equal(weeks.weekKey(new Date('invalid')), '—');
  assert.equal(weeks.weekLabel('2021-W53'), '—');
  assert.equal(weeks.weekLabel('2020-W53'), '12/27/2020');
  assert.equal(weeks.weekLabel(weeks.weekKey(date(2021, 1, 3))), '1/3/2021');
  assert.deepEqual(weeks.listWeeks(date(2020, 12, 27), date(2021, 1, 3)).map(weeks.weekLabel), ['12/27/2020', '1/3/2021']);
  assert.deepEqual(weeks.listWeeks(null, new Date()), []);
});

for (const timezone of ['UTC', 'America/New_York', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata']) {
  test('Sunday mapping and iteration survive timezone / DST: ' + timezone, () => {
    const modulePath = path.resolve(__dirname, '../shared/coaching-gaps-week-alignment.js');
    const script = `const a=require('node:assert/strict'),w=require(${JSON.stringify(modulePath)});const d=(y,m,n)=>new Date(y,m-1,n);a.equal(w.weekLabel(w.weekKey(d(2026,9,27))),'9/27/2026');for(const [y,m,start,end] of [[2026,3,1,15],[2026,11,1,15],[2026,9,20,27]]){const dates=w.listWeeks(d(y,m,start),d(y,m,end));a.equal(dates.length,(end-start)/7+1);dates.forEach((key,i)=>a.equal(w.weekLabel(key),m+'/'+(start+i*7)+'/'+y));}for(let n=1;n<=366;n++){const day=new Date(2024,0,n),key=w.weekKey(day),s=w.weekStartFromKey(key);a.equal(s.getUTCDay(),0);a.equal(w.weekLabel(key),w.weekLabel(w.listWeeks(day,day)[0]));}`;
    execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: timezone } });
  });
}

test('calendar installation updates the shared grouping, iteration and label functions together', () => {
  const host = { isoWeekKey() {}, loadStats() {} };
  assert.equal(weeks.install(host), true);
  assert.equal(weeks.install(host), false);
  assert.equal(host.reportWeekLabel(host.isoWeekKey(date(2026, 9, 27))), '9/27/2026');
  assert.equal(host.listIsoWeeksBetween(date(2026, 9, 27), date(2026, 10, 3)).length, 1);
  assert.equal(host.isoWeekStartUTC(date(2026, 9, 27)).getUTCDay(), 0);
});

const fs = require('node:fs');
const vm = require('node:vm');
function executeScript(file, host) {
  host.window = host;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared', file), 'utf8'), host, { filename: file });
}
function loaderHost(appId, readyState) {
  const written = [], appended = [], events = {};
  const host = { URL, console, location: { pathname: '/apps/' + appId + '.html', href: 'file:///suite/apps/' + appId + '.html' },
    addEventListener() {}, setTimeout() {}, document: {
      currentScript: { src: 'file:///suite/shared/coachtools-shell.js' }, readyState, title: 'Test',
      querySelector: selector => selector.includes('coachtools-id') ? { content: appId } : null,
      getElementById() { return null; }, createElement: () => ({}),
      write: value => written.push(value), head: { appendChild: script => appended.push(script) },
      addEventListener: (type, callback) => { events[type] = callback; }
    } };
  return { host, written, appended, events };
}
for (const readyState of ['loading', 'complete']) {
  test('Gaps calendar loads through the mandatory shell, independent of intelligence: ' + readyState, () => {
    const h = loaderHost('coaching-gaps', readyState);
    h.host.CoachToolsIntelligence = { VERSION: '1.1.0' };
    executeScript('coachtools-shell.js', h.host);
    assert.match(h.written.join('') + h.appended.map(s => s.src).join(''), /coaching-gaps-week-alignment\.js/);
    const other = loaderHost('weekly-data-builder', readyState);
    executeScript('coachtools-shell.js', other.host);
    assert.doesNotMatch(other.written.join('') + other.appended.map(s => s.src).join(''), /coaching-gaps-week-alignment/);
  });
  test('Weekly settings load the name module from the same shared folder: ' + readyState, () => {
    const h = loaderHost('weekly-data-builder', readyState);
    h.host.document.currentScript.src = 'file:///suite/shared/weekly-data-builder-settings.js';
    executeScript('weekly-data-builder-settings.js', h.host);
    assert.match(h.written.join('') + h.appended.map(s => s.src).join(''), /file:\/\/\/suite\/shared\/weekly-data-builder-names\.js/);
  });
}

test('browser calendar startup rebuilds all cached event types from raw dates exactly once', async () => {
  const raw = { statistics: date(2026, 9, 27), coaching: date(2026, 9, 27), checklist: date(2026, 9, 28), qa: date(2026, 10, 3) };
  const original = Object.fromEntries(Object.entries(raw).map(([k, d]) => [k, d.getTime()]));
  let reloads = 0, types, start;
  const indexed = {};
  const host = { Date, console, isoWeekKey() {}, loadStats() {},
    CoachToolsAppData: { getMany: async requested => { types = requested; } },
    document: { readyState: 'loading', body: { dataset: {} },
      querySelector: () => ({ content: 'coaching-gaps' }), addEventListener: (type, callback) => { start = callback; },
      getElementById: id => id === 'loadDocksBtn' ? { click() { reloads++; for (const [kind, value] of Object.entries(raw)) indexed[kind] = host.reportWeekLabel(host.isoWeekKey(value)); } } : null
    } };
  executeScript('coaching-gaps-week-alignment.js', host);
  assert.equal(reloads, 0);
  start(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Array.from(types), ['weeklyRetail', 'weeklyReferral', 'qa', 'documentedCoaching', 'checklist']);
  assert.equal(reloads, 1);
  assert.deepEqual(Object.values(indexed), Array(4).fill('9/27/2026'));
  assert.deepEqual(Object.fromEntries(Object.entries(raw).map(([k, d]) => [k, d.getTime()])), original);
  start(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 1);
  assert.equal(host.document.body.dataset.weekBasis, 'sunday-saturday');
});

test('reload failures are reported rather than implying stale weekly indexes are corrected', async () => {
  const hint = { textContent: '' }, errors = [];
  const host = { Date, console: { error: (...args) => errors.push(args) }, isoWeekKey() {}, loadStats() {},
    CoachToolsAppData: { getMany: async () => { throw new Error('Unavailable store'); } },
    document: { readyState: 'complete', querySelector: () => ({ content: 'coaching-gaps' }), getElementById: () => hint } };
  executeScript('coaching-gaps-week-alignment.js', host);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.match(hint.textContent, /could not be refreshed/);
});

function nameUiHost(saved, failStorage = false) {
  const nodes = new Map(), queued = [], savedValues = new Map([[names.STORAGE_KEY, saved]]);
  let result = null, stale = false, finalized = true, invalidations = 0;
  class Element {
    constructor() { this.style = {}; this.listeners = {}; this.value = ''; this.textContent = ''; }
    set innerHTML(value) {
      this.html = value;
      for (const match of value.matchAll(/id="([^"]+)"/g)) if (!nodes.has(match[1])) nodes.set(match[1], new Element());
    }
    get innerHTML() { return this.html; }
    setAttribute() {} after() {}
    addEventListener(type, callback) { this.listeners[type] = callback; }
    dispatchEvent(event) { this.listeners[event.type]?.(event); }
  }
  const publication = new Element(); publication.value = '2026-09-27';
  publication.addEventListener('input', () => { stale = true; finalized = false; invalidations++; });
  nodes.set('publicationDate', publication);
  const host = { Event, queueMicrotask: callback => queued.push(callback),
    document: { getElementById: id => nodes.get(id) || null, createElement: () => new Element(), querySelector: () => new Element(), querySelectorAll: () => [] },
    WeeklyCore: { assemble: () => fixture(), assembleModify: () => fixture(true) },
    WeeklyBuilder: { getResult: () => result, isStale: () => stale },
    localStorage: { getItem: key => { if (failStorage) throw new Error('denied'); return savedValues.get(key); },
      setItem: (key, value) => { if (failStorage) throw new Error('denied'); savedValues.set(key, value); } }
  };
  return { host, nodes, savedValues, publication,
    build() { result = host.WeeklyCore.assemble({}); stale = false; while (queued.length) queued.shift()(); return result; },
    state: () => ({ stale, finalized, invalidations }) };
}

test('name option restores preferences, updates preview and invalidates finalized exports without changing dates', () => {
  const h = nameUiHost('title'); names.mount(h.host);
  const select = h.nodes.get('nameCapitalization');
  assert.equal(select.value, 'title');
  assert.equal(h.build().allRows[1][2], 'John Doe');
  assert.match(h.nodes.get('nameCapitalizationStatus').textContent, /historical rows included/);
  select.value = 'lower'; select.dispatchEvent(new Event('change'));
  assert.deepEqual(h.state(), { stale: true, finalized: false, invalidations: 1 });
  assert.equal(h.publication.value, '2026-09-27');
  assert.equal(h.savedValues.get(names.STORAGE_KEY), 'lower');
  assert.equal(h.nodes.get('nameCapitalizationReview').hidden, true);
  assert.equal(h.build().allRows[1][2], 'john doe');
});

test('unavailable preference storage does not block session-only capitalization', () => {
  const h = nameUiHost(null, true); names.mount(h.host);
  const select = h.nodes.get('nameCapitalization');
  assert.equal(select.value, 'preserve');
  select.value = 'title'; select.dispatchEvent(new Event('change'));
  assert.equal(h.build().allRows[1][2], 'John Doe');
  assert.match(h.nodes.get('nameCapitalizationStatus').textContent, /session-only/);
});
