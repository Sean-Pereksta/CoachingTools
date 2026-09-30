'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const names = require('../shared/weekly-data-builder-names.js');
const update = require('../shared/weekly-data-builder-update-names.js');
const clone = value => structuredClone(value);
function fixture() {
  return { fileName: 'Retail Weekly.csv', version: 1, loading: false, error: '',
    rows: [['DO NOT EDIT REPORT TITLE'], ['Date', 'Sheet', 'Name', 'Manager', 'Cash AR', 'Count', 'Notes'],
      ['9/13/2026', 'john doe', 'jane smith', 'MARY JONES', '0.50', '001', 'KEEP ALL TEXT'],
      ['9/20/2026', 'John Doe', 'JANE SMITH', 'mary jones', '50%', '0', '=SUM(A1:A2)'],
      [], ['', '', '', '', '', '', ''],
      ['9/27/2026', 'JOHN DOE', 'Jane Smith', 'Mary Jones', '', '12', 'Other text'],
      ['9/27/2026', 'SECOND COACH', 'Jane Smith', 'Mary Jones', '0', '', 'Same name, different coach'],
      []],
    analysis: { headerRow: 1, dims: { date: 0, coach: 1, name: 2, manager: 3 } } };
}
function normalize(source, mode = 'title') { return update.normalizeWeekly(source, mode, names.formatName); }
function assertNamesOnly(input, result) {
  assert.equal(result.allRows.length, input.rows.length);
  input.rows.forEach((row, i) => {
    assert.equal(result.allRows[i].length, row.length);
    row.forEach((value, j) => {
      if (i <= input.analysis.headerRow || !result.columns.includes(j)) assert.equal(result.allRows[i][j], value);
    });
  });
  assert.equal(result.stats.addedRows, 0);
  assert.equal(result.stats.removedRows, 0);
  assert.equal(result.stats.statisticChanges, 0);
}

test('requires only the built file, not stats sources, dates or saved replacements', () => {
  const source = fixture();
  for (const key of ['appointments', 'wipers', 'date', 'aliases', 'options']) Object.defineProperty(source, key, {
    get() { throw new Error('Update Names must never inspect ' + key); }
  });
  const result = normalize(source);
  assert.equal(result.mode, 'update-names');
  assert.equal(result.allRows[2][1], 'John Doe');
  assertNamesOnly(source, result);
});
test('Title Case covers every week and mapped representative/coach/manager with original rules', () => {
  const source = fixture(), result = normalize(source);
  for (const i of [2, 3, 6]) assert.deepEqual(result.allRows[i].slice(1, 4), ['John Doe', 'Jane Smith', 'Mary Jones']);
  assert.deepEqual(result.columns, [2, 1, 3]);
  assert.equal(result.stats.changedRows, 4);
  assert.equal(result.stats.changedCells, 7);
  assertNamesOnly(source, result);
});
test('lowercase uses the shared formatter for the entire file', () => {
  const source = fixture(), result = normalize(source, 'lower');
  for (const row of result.allRows.slice(2)) for (const col of result.columns) if (row[col]) assert.equal(row[col], row[col].toLowerCase());
  assertNamesOnly(source, result);
});
test('input file rows are never mutated, even if deeply frozen', () => {
  const source = fixture(), before = clone(source);
  source.rows.forEach(Object.freeze); Object.freeze(source.rows); Object.freeze(source);
  const result = normalize(source);
  assert.deepEqual(source, before);
  assert.notEqual(result.allRows, source.rows);
  result.allRows.forEach((row, i) => assert.notEqual(row, source.rows[i]));
});
test('headers, preamble, dates, metrics, text, zeros and numeric formatting are untouched', () => {
  const source = fixture(), result = normalize(source);
  assert.deepEqual(result.allRows.slice(0, 2), source.rows.slice(0, 2));
  assertNamesOnly(source, result);
});
test('blank rows, trailing blanks, duplicate rows and same-name people are not merged or removed', () => {
  const source = fixture(); source.rows.push(source.rows[2].slice(), []);
  const result = normalize(source);
  assert.deepEqual(result.allRows[4], []);
  assert.deepEqual(result.allRows[5], ['', '', '', '', '', '', '']);
  assert.deepEqual(result.allRows[2], result.allRows[9]);
  assert.equal(result.allRows[7][1], 'Second Coach');
  assertNamesOnly(source, result);
});
test('ragged and sparse rows are never padded or extended', () => {
  const source = fixture();
  source.rows.push(['9/27/2026'], ['9/27/2026', 'JOHN DOE']);
  const sparse = []; sparse.length = 8; sparse[0] = '9/27/2026'; sparse[2] = 'JANE SMITH'; source.rows.push(sparse);
  const result = normalize(source);
  assert.equal(1 in result.allRows.at(-1), false);
  assert.equal(result.allRows.at(-1)[2], 'Jane Smith');
  assertNamesOnly(source, result);
});
test('punctuation, apostrophes, repeated spaces, accents and name order follow the existing formatter', () => {
  const source = fixture();
  source.rows.push(['9/27/2026', "  O’NEILL,  ANNE-MARIE  ", 'ÉLODIE MÜLLER', 'J.P. SMITH', '0.5000']);
  const result = normalize(source);
  assert.deepEqual(result.allRows.at(-1).slice(1, 4), ['  O’Neill,  Anne-Marie  ', 'Élodie Müller', 'J.P. Smith']);
  assertNamesOnly(source, result);
});
test('formula-like names, escaped formulas, numeric cells and blanks are not rewritten', () => {
  const source = fixture();
  for (const value of ['=HYPERLINK("x")', "'=CMD", '+SUM(A1)', '-1+2', '@USER', '   ', null, 42, undefined]) {
    source.rows.push(['9/27/2026', value, value, value]);
  }
  const result = normalize(source);
  assert.deepEqual(result.allRows.slice(9), source.rows.slice(9));
});
test('unmapped fields stay intact and duplicate role mappings touch a cell only once', () => {
  const source = fixture(); source.analysis.dims = { date: 0, coach: -1, name: 2, manager: 2 };
  const result = normalize(source);
  assert.deepEqual(result.columns, [2]);
  assert.equal(result.allRows[2][1], 'john doe');
  assert.equal(result.allRows[2][3], 'MARY JONES');
  assert.equal(result.changes.length, 2);
});
test('zero-change files remain exportable and normalization is idempotent', () => {
  const source = fixture(); source.rows = normalize(source).allRows;
  const session = update.createSession(() => source, () => 'title', names.formatName);
  const result = session.preview();
  assert.equal(result.changes.length, 0);
  assert.equal(session.isStale(), false);
  assert.deepEqual(session.exportRows(), source.rows);
});
test('invalid modes, missing files, reader errors and unsafe mappings fail closed', () => {
  assert.throws(() => normalize(fixture(), 'preserve'), /Choose/);
  assert.throws(() => normalize(fixture(), 'uppercase'), /Choose/);
  assert.throws(() => normalize(null), /Load/);
  assert.throws(() => normalize({ ...fixture(), loading: true }), /Load/);
  assert.throws(() => normalize({ ...fixture(), error: 'Bad file' }), /Bad file/);
  const source = fixture(); source.analysis.headerRow = 99;
  assert.throws(() => normalize(source), /header/);
  source.analysis.headerRow = 1; source.analysis.dims = { date: 0, name: -1, coach: -1 };
  assert.throws(() => normalize(source), /name columns/);
  source.analysis.dims.name = 0;
  assert.throws(() => normalize(source), /Date column/);
});
test('before/after preview records retain the exact file row and original date', () => {
  const result = normalize(fixture());
  const change = result.changes.find(c => c.rowNumber === 7);
  assert.deepEqual(change, { rowNumber: 7, index: 1, column: 'Sheet', date: '9/27/2026', oldValue: 'JOHN DOE', newValue: 'John Doe' });
  assert.equal(result.changes.length, result.stats.changedCells);
});
test('export is locked before preview and whenever capitalization changes', () => {
  let mode = 'title'; const source = fixture();
  const session = update.createSession(() => source, () => mode, names.formatName);
  assert.throws(session.exportRows, /Preview|preview/);
  session.preview(); assert.equal(session.isStale(), false);
  mode = 'lower'; assert.equal(session.isStale(), true); assert.throws(session.exportRows, /preview/i);
  session.preview(); assert.equal(session.exportRows()[2][2], 'jane smith');
});
for (const change of ['file', 'rows', 'analysis', 'loading', 'error', 'version', 'sheet', 'fileName']) {
  test('export locks after source change: ' + change, () => {
    let source = fixture(); const session = update.createSession(() => source, () => 'title', names.formatName);
    session.preview();
    if (change === 'file') source = fixture();
    else if (change === 'rows') source.rows = clone(source.rows);
    else if (change === 'analysis') source.analysis = clone(source.analysis);
    else source[change] = { loading: true, error: 'Invalid', version: 2, sheet: 'Other sheet', fileName: 'Other.csv' }[change];
    assert.ok(session.isStale()); assert.throws(session.exportRows, /preview/i);
  });
}
test('explicit invalidation, a failed preview and reset cannot export older results', () => {
  let mode = 'title'; const source = fixture(), session = update.createSession(() => source, () => mode, names.formatName);
  session.preview(); session.invalidate(); assert.throws(session.exportRows, /preview/i);
  session.preview(); mode = 'preserve'; assert.throws(session.preview, /Choose/); assert.throws(session.exportRows, /preview/i);
  mode = 'title'; session.preview(); session.reset(); assert.equal(session.getResult(), null); assert.throws(session.exportRows, /preview/i);
});
test('large history is processed completely, without a preview-sized transform limit', () => {
  const source = fixture(); source.rows = [source.rows[1], ...Array.from({ length: 10000 }, () => source.rows[2].slice())]; source.analysis.headerRow = 0;
  const result = normalize(source);
  assert.equal(result.stats.changedCells, 30000);
  assert.equal(result.allRows.at(-1)[2], 'Jane Smith');
  assertNamesOnly(source, result);
});
for (const state of ['loading', 'complete']) test('standalone mode loads through the existing formatter: ' + state, () => {
  const written = [], appended = [];
  const host = { URL, document: { readyState: state, currentScript: { src: 'file:///suite/shared/weekly-data-builder-names.js' },
    getElementById: () => null, createElement: () => ({}), write: value => written.push(value), head: { appendChild: value => appended.push(value) } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/weekly-data-builder-names.js'), 'utf8'), host);
  if (state === 'loading') assert.match(written[0], /weekly-data-builder-update-names\.js/);
  else assert.equal(appended[0].src, 'file:///suite/shared/weekly-data-builder-update-names.js');
});
