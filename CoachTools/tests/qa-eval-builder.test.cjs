'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx.full.min.js');
const Builder = require('../shared/qa-eval-builder-core.js');

const NEW = ['Conversation ID', 'Genesys Evaluation ID', 'Agent Name', 'Employee ID', 'Date Hire', 'Team', 'Calibration Status', 'Agent Has Read', 'Conversation Start EST', 'Conversation End EST', 'Evaluation Status', 'Evaluator', 'Evaluation Form', 'Queue Name', 'VDN', 'Assigned Date EST', 'Changed Date EST', 'Queue ID', 'Days Hired', 'Score', 'Adj Score', 'Non-Performance'];
const OLD = ['Conversationid', 'Genesys Evaluation ID', 'Agent Name', 'Hire Date', 'Team', 'Calibration Status', 'Agent Has Read', 'Interaction Start Time', 'Interaction End Time', 'Evaluation Status', 'Evaluator', 'Evaluation Form', 'Queue', 'VDN', 'Assigned Date', 'Changed Date', 'Days Hired', 'Score %', 'Interaction Duration'];
const record = changes => {
  const row = { 'Conversation ID': '000012345678901234567890', 'Genesys Evaluation ID': '0000042', 'Agent Name': 'Last, First', 'Employee ID': 'extra-employee', 'Date Hire': '8/12/2026', Team: 'Retail', 'Calibration Status': 'No', 'Agent Has Read': false, 'Conversation Start EST': '11/9/2026 11:59:30 PM', 'Conversation End EST': '11/10/2026 12:01:00 AM', 'Evaluation Status': 'Released', Evaluator: 'QA Reviewer', 'Evaluation Form': '90 Day Form', 'Queue Name': 'Retail Queue', VDN: '00100', 'Assigned Date EST': '11/10/2026 9:00:00 AM', 'Changed Date EST': '11/10/2026 10:00:00 AM', 'Queue ID': 'extra-queue', 'Days Hired': 90, Score: 95, 'Adj Score': 100, 'Non-Performance': 'extra-non-performance', ...changes };
  return NEW.map(header => row[header]);
};
function book(rows, origin = 'A1', name = 'Report') {
  const workbook = XLSX.utils.book_new(), sheet = {};
  XLSX.utils.sheet_add_aoa(sheet, rows, { origin });
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return workbook;
}
const saved = workbook => XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellNF: true, cellDates: false });
const value = (result, row, header) => result.rows[row][OLD.indexOf(header)];

test('all new headers map to exactly the legacy E:W export, with four extra fields omitted', () => {
  const input = book([NEW, record()]), before = JSON.stringify(input);
  const result = Builder.convertWorkbook(input, XLSX), output = saved(result.workbook).Sheets['90 Day QA Evals'];
  assert.equal(JSON.stringify(input), before, 'source workbook is unchanged');
  assert.deepEqual(result.headers, OLD);
  assert.equal(output['!ref'], 'E1:W2');
  assert.equal(output.A1, undefined); assert.equal(output.D2, undefined);
  assert.deepEqual(Array.from({ length: 19 }, (_, c) => output[XLSX.utils.encode_cell({ r: 0, c: c + 4 })].v), OLD);
  assert.equal(output.E2.v, '000012345678901234567890'); assert.equal(output.E2.t, 's');
  assert.equal(output.F2.v, '0000042'); assert.equal(output.R2.v, '00100');
  assert.equal(output.G2.v, 'Last, First');
  assert.equal(output.Q2.v, 'Retail Queue');
  assert.equal(output.V2.v, 95, 'Score is used, not Adj Score');
  assert.equal(output.W2.v, '0:01:30');
  assert.equal(result.stats.rows, 1); assert.equal(result.stats.durationsCalculated, 1);
  const content = JSON.stringify(output);
  for (const extra of ['extra-employee', 'extra-queue', 'extra-non-performance', 'Adj Score']) assert.ok(!content.includes(extra));
});

test('discovers shifted headers and skips unrelated worksheets without relying on A1', () => {
  const input = book([['Summary', 'Count'], ['Evaluations', 1]], 'A1', 'Summary');
  const sheet = {};
  XLSX.utils.sheet_add_aoa(sheet, [['90-day report']], { origin: 'A1' });
  XLSX.utils.sheet_add_aoa(sheet, [NEW, record()], { origin: 'H7' });
  XLSX.utils.book_append_sheet(input, sheet, 'Shifted Report');
  const sources = Builder.discoverSources(input, XLSX);
  assert.equal(sources.length, 1); assert.equal(sources[0].headerRow, 7); assert.equal(sources[0].valid, true);
  const result = Builder.convertWorkbook(input, XLSX);
  assert.equal(result.sourceSheet, 'Shifted Report'); assert.equal(result.headerRow, 7); assert.equal(result.stats.rows, 1);
});

test('multiple QA worksheets require explicit selection so no sheet is silently discarded', () => {
  const input = book([NEW, record()], 'A1', 'First');
  XLSX.utils.book_append_sheet(input, XLSX.utils.aoa_to_sheet([NEW, record({ 'Agent Name': 'Second Person' })]), 'Second');
  assert.throws(() => Builder.convertWorkbook(input, XLSX), /Choose the worksheet/);
  const result = Builder.convertWorkbook(input, XLSX, { sheetName: 'Second' });
  assert.equal(value(result, 0, 'Agent Name'), 'Second Person');
});

test('header normalization handles spacing/case but never substitutes adjusted score', () => {
  const headers = NEW.map(name => '  ' + name.toUpperCase().replace(/ /g, '\u00a0') + '  ');
  const result = Builder.convertWorkbook(book([headers, record({ Score: 0, 'Days Hired': 0 })]), XLSX);
  assert.equal(value(result, 0, 'Score %'), 0); assert.equal(value(result, 0, 'Days Hired'), 0);
  assert.equal(value(result, 0, 'Agent Has Read'), false);
  const missing = NEW.filter(name => name !== 'Score');
  assert.throws(() => Builder.convertWorkbook(book([missing, record().filter((_, index) => NEW[index] !== 'Score')]), XLSX), /Missing required headers: Score %/);
  assert.throws(() => Builder.convertWorkbook(book([[...NEW, 'Score %'], [...record(), 88]]), XLSX), /Duplicate mapped headers: Score %/);
});

test('duration calculation handles midnight, zero duration, long calls, and explicit offsets', () => {
  const input = book([NEW,
    record(),
    record({ 'Conversation Start EST': '2026-11-10T12:00:00', 'Conversation End EST': '2026-11-10T12:00:00' }),
    record({ 'Conversation Start EST': '11/10/2026 12:00:00 AM', 'Conversation End EST': '11/12/2026 7:02:03 PM' }),
    record({ 'Conversation Start EST': '2026-11-01T01:00:00-04:00', 'Conversation End EST': '2026-11-01T01:30:00-05:00' })
  ]);
  const result = Builder.convertWorkbook(input, XLSX);
  assert.deepEqual(result.rows.map(row => row[18]), ['0:01:30', '0:00:00', '67:02:03', '1:30:00']);
  assert.equal(result.stats.durationsCalculated, 4); assert.equal(result.warnings.length, 0);
});

test('bad or absent timestamps retain every row with explicit duration warnings', () => {
  const input = book([NEW,
    record({ 'Conversation End EST': '' }),
    record({ 'Conversation Start EST': '2026-02-30T10:00:00', 'Conversation End EST': '2026-03-01T10:00:00' }),
    record({ 'Conversation Start EST': '2026-11-10T12:00:00', 'Conversation End EST': '2026-11-10T11:00:00' })
  ]);
  const result = Builder.convertWorkbook(input, XLSX);
  assert.equal(result.stats.rows, 3); assert.equal(result.stats.durationWarnings, 3);
  assert.deepEqual(result.rows.map(row => row[18]), ['', '', '']);
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings[0], /^Row 2:.*missing or invalid/);
  assert.match(result.warnings[2], /^Row 4:.*before its start/);
  assert.equal(value(result, 1, 'Interaction Start Time'), '2026-02-30T10:00:00');
});

test('numeric Excel dates are timezone-neutral and formatted percentage scores keep their source scale', () => {
  const input = book([NEW, record()]), sheet = input.Sheets.Report;
  const set = (header, cell) => { sheet[XLSX.utils.encode_cell({ r: 1, c: NEW.indexOf(header) })] = cell; };
  const serial = Date.UTC(2026, 10, 10, 12, 34, 56) / 86400000 + 25569;
  set('Conversation Start EST', { t: 'n', v: serial, z: 'm/d/yyyy h:mm:ss AM/PM' });
  set('Conversation End EST', { t: 'n', v: serial + 90 / 86400, z: 'm/d/yyyy h:mm:ss AM/PM' });
  set('Date Hire', { t: 'n', v: Math.floor(serial), z: 'm/d/yyyy' });
  set('Score', { t: 'n', v: .95, z: '0%' });
  set('VDN', { t: 'n', v: 0, z: '00000' });
  const result = Builder.convertWorkbook(saved(input), XLSX), output = saved(result.workbook).Sheets['90 Day QA Evals'];
  assert.equal(output.L2.v, '11/10/2026 12:34:56 PM'); assert.equal(output.M2.v, '11/10/2026 12:36:26 PM');
  assert.equal(output.H2.v, '11/10/2026'); assert.equal(output.W2.v, '0:01:30');
  assert.equal(output.V2.v, .95); assert.equal(output.V2.w, '95%');
  assert.equal(output.R2.v, '00000');
});

test('1904 date-system workbooks produce the same legacy dates and duration', () => {
  const input = book([NEW, record()]);
  input.Workbook = { WBProps: { date1904: true } };
  const serial = Date.UTC(2026, 10, 10, 10) / 86400000 + 25569 - 1462;
  input.Sheets.Report.I2 = { t: 'n', v: serial };
  input.Sheets.Report.J2 = { t: 'n', v: serial + 60 / 86400 };
  const result = Builder.convertWorkbook(input, XLSX);
  assert.equal(value(result, 0, 'Interaction Start Time'), '11/10/2026 10:00:00 AM');
  assert.equal(value(result, 0, 'Interaction Duration'), '0:01:00');
});

test('CSV and TSV inputs preserve quoted names and identifier digits', () => {
  for (const delimiter of [',', '\t']) {
    const escaped = value => '"' + String(value).replace(/"/g, '""') + '"';
    const text = [NEW, record()].map(row => row.map(escaped).join(delimiter)).join('\r\n');
    const input = XLSX.read(text, { type: 'string', raw: true });
    const result = Builder.convertWorkbook(input, XLSX);
    assert.equal(value(result, 0, 'Conversationid'), '000012345678901234567890');
    assert.equal(value(result, 0, 'Agent Name'), 'Last, First');
    assert.equal(value(result, 0, 'Interaction Duration'), '0:01:30');
  }
});

test('actual text bytes preserve Unicode names and IDs across UTF-8, UTF-16, and ANSI encodings', () => {
  const name = 'José García – Zoë', text = [NEW, record({ 'Agent Name': name })].map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const utf16le = Buffer.from(text, 'utf16le'), utf16be = Buffer.from(utf16le).swap16();
  const ansi = Buffer.from(text.replace(/–/g, '\u0096'), 'latin1');
  const encodings = [
    ['UTF-8 without BOM', Buffer.from(text, 'utf8')],
    ['UTF-8 with BOM', Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(text, 'utf8')])],
    ['UTF-16LE with BOM', Buffer.concat([Buffer.from([255, 254]), utf16le])],
    ['UTF-16BE with BOM', Buffer.concat([Buffer.from([254, 255]), utf16be])],
    ['UTF-16LE without BOM', utf16le], ['UTF-16BE without BOM', utf16be], ['Windows-1252', ansi]
  ];
  for (const [encoding, bytes] of encodings) {
    // Use an ArrayBuffer matching the browser File.arrayBuffer() read path.
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const input = XLSX.read(Builder.decodeText(buffer), { type: 'string', raw: true, cellDates: false, cellNF: true, cellText: true });
    const result = Builder.convertWorkbook(input, XLSX), output = saved(result.workbook).Sheets['90 Day QA Evals'];
    assert.equal(output.G2.v, name, encoding);
    assert.equal(output.E2.v, '000012345678901234567890', encoding);
    assert.equal(output.W2.v, '0:01:30', encoding);
  }
  assert.equal(Builder.decodeText(new Uint8Array([0, 239, 187, 191, 65, 0]).subarray(1, 5)), 'A', 'typed-array byte offsets are respected');
});

test('legacy output can be converted again without changing values or appending blank columns', () => {
  const first = Builder.convertWorkbook(book([NEW, record()]), XLSX);
  const second = Builder.convertWorkbook(saved(first.workbook), XLSX);
  assert.deepEqual(second.headers, first.headers); assert.deepEqual(second.rows, first.rows);
  assert.equal(second.workbook.Sheets['90 Day QA Evals']['!ref'], 'E1:W2');
});

test('empty reports fail and repeated print headers are explicitly skipped', () => {
  assert.throws(() => Builder.convertWorkbook(book([NEW]), XLSX), /no evaluation rows/);
  const result = Builder.convertWorkbook(book([NEW, record(), [], NEW, record({ 'Agent Name': 'Second Person' })]), XLSX);
  assert.equal(result.stats.rows, 2); assert.match(result.warnings[0], /^Row 4: A repeated header row was skipped/);
});

test('saved formula values become data, and formula-like source text stays literal', () => {
  const input = book([NEW, record({ 'Agent Name': '=HYPERLINK("https://example.com")' })]);
  input.Sheets.Report.T2 = { t: 'n', v: 90, f: '45+45' };
  const output = saved(Builder.convertWorkbook(input, XLSX).workbook).Sheets['90 Day QA Evals'];
  assert.equal(output.G2.t, 's'); assert.equal(output.G2.f, undefined);
  assert.equal(output.V2.v, 90); assert.equal(output.V2.f, undefined);
});

test('general numeric IDs retain every available digit instead of Excel display rounding', () => {
  const input = book([NEW, record()]);
  input.Sheets.Report.A2 = { t: 'n', v: 1234567890123, z: 'General', w: '1.23457E+12' };
  const output = saved(Builder.convertWorkbook(input, XLSX).workbook).Sheets['90 Day QA Evals'];
  assert.equal(output.E2.v, '1234567890123');
});

test('rows containing only formulas without saved values are retained with warnings', () => {
  const input = book([NEW]);
  input.Sheets.Report.C2 = { t: 's', f: 'OtherSheet!A1' };
  input.Sheets.Report['!ref'] = 'A1:V2';
  const result = Builder.convertWorkbook(input, XLSX);
  assert.equal(result.stats.rows, 1); assert.equal(result.rows[0][2], '');
  assert.ok(result.warnings.some(warning => /Agent Name has a formula without a saved result/.test(warning)));
  assert.equal(result.stats.durationWarnings, 1);
});

test('custom numeric ID formatting does not mutate even the source display cache', () => {
  const input = book([NEW, record()]);
  input.Sheets.Report.N2 = { t: 'n', v: 123, z: '00000' };
  const before = JSON.stringify(input);
  const result = Builder.convertWorkbook(input, XLSX);
  assert.equal(value(result, 0, 'Queue'), 123);
  assert.equal(JSON.stringify(input), before);
  input.Sheets.Report.O2 = { t: 'n', v: 123, z: '00000' };
  const withId = JSON.stringify(input);
  const idResult = Builder.convertWorkbook(input, XLSX);
  assert.equal(value(idResult, 0, 'VDN'), '00123');
  assert.equal(JSON.stringify(input), withId);
});

test('actual formula workbooks use saved date/score results and report an absent cached result', async () => {
  const JSZip = require('../vendor/jszip.min.js'), input = book([NEW, record()]);
  const serial = Date.UTC(2026, 10, 10, 10) / 86400000 + 25569;
  input.Sheets.Report.I2 = { t: 'n', v: serial, f: '46000+0', z: 'm/d/yyyy h:mm:ss AM/PM' };
  input.Sheets.Report.J2 = { t: 'n', v: serial + 60 / 86400, f: 'I2+1/1440', z: 'm/d/yyyy h:mm:ss AM/PM' };
  input.Sheets.Report.T2 = { t: 'n', v: 90, f: '45+45' };
  const binary = XLSX.write(input, { type: 'buffer', bookType: 'xlsx' });
  const parsed = XLSX.read(binary, { type: 'buffer', cellDates: false, cellNF: true, cellText: true });
  const result = Builder.convertWorkbook(parsed, XLSX);
  assert.equal(value(result, 0, 'Interaction Start Time'), '11/10/2026 10:00:00 AM');
  assert.equal(value(result, 0, 'Interaction Duration'), '0:01:00');
  assert.equal(value(result, 0, 'Score %'), 90);
  assert.equal(result.workbook.Sheets['90 Day QA Evals'].V2.f, undefined);

  const zip = await JSZip.loadAsync(binary), xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const withoutCache = xml.replace(/(<c\b[^>]*\br="T2"[^>]*>[\s\S]*?)<v>[^<]*<\/v>/, '$1');
  assert.notEqual(withoutCache, xml, 'fixture removes the cached score result');
  zip.file('xl/worksheets/sheet1.xml', withoutCache);
  const edited = await zip.generateAsync({ type: 'nodebuffer' });
  const missing = Builder.convertWorkbook(XLSX.read(edited, { type: 'buffer', cellDates: false, cellNF: true, cellText: true, sheetStubs: true }), XLSX);
  assert.equal(missing.stats.rows, 1); assert.equal(value(missing, 0, 'Score %'), '');
  assert.ok(missing.warnings.some(warning => /Score % has a formula without a saved result/.test(warning)));
});

test('report dates are read from dotted and dashed filenames with two- or four-digit years', () => {
  const cases = [
    ['All Evaluations 11.10.26.xlsx', '2026-11-10'],
    ['All Evaluations - Last 90 days - updated 11-10-26.xlsx', '2026-11-10'],
    ['Report 1.2.26.csv', '2026-01-02'], ['Report_01-02-2026.xls', '2026-01-02'],
    ['Report_12.31.2026.csv', '2026-12-31'], ['Report 01-01-00.xlsx', '2000-01-01'],
    ['Report 11-10-99.xlsx', '2099-11-10'], ['Report 2026-11-10.xlsx', '2026-11-10']
  ];
  for (const [name, expected] of cases) assert.equal(Builder.reportDateFromFilename(name), expected, name);
});

test('filename report dates reject impossible days, invalid leap dates, and digit substrings', () => {
  for (const name of ['Report.xlsx', '', '11.31.26.xlsx', '04-31-2026.xlsx', '02.29.26.xlsx', '02-29-1900.xlsx', '00-10-26.xlsx', '13-01-26.xlsx', '11-00-26.xlsx', '111-10-26.xlsx', '11-100-26.xlsx', '11-10-261.xlsx', '11-10-20260.xlsx', '2026-02-30.xlsx', '11.10-26.xlsx']) {
    assert.equal(Builder.reportDateFromFilename(name), '', name);
  }
  assert.equal(Builder.reportDateFromFilename(null), '');
  assert.equal(Builder.reportDateFromFilename('Leap 02.29.24.xlsx'), '2024-02-29');
  assert.equal(Builder.reportDateFromFilename('Leap 02-29-2000.xlsx'), '2000-02-29');
});

test('multiple distinct filename dates require a manual date, while repeated same dates agree', () => {
  assert.equal(Builder.reportDateFromFilename('11.10.26 - 11-11-26.xlsx'), '');
  assert.equal(Builder.reportDateFromFilename('12.31.26 - 01.01.27.xlsx'), '');
  assert.equal(Builder.reportDateFromFilename('11.10.26 - 11-10-2026.xlsx'), '2026-11-10');
  assert.equal(Builder.reportDateFromFilename('2026-01-02-27.xlsx'), '', 'overlapping valid date interpretations are ambiguous');
});

test('export names use the exact agreed name and validate the selected calendar date', () => {
  assert.equal(Builder.exportFilename('2026-11-10'), 'All Evaluations - Last 90 days - updated 11-10-26.xlsx');
  assert.equal(Builder.exportFilename('2027-01-02'), 'All Evaluations - Last 90 days - updated 01-02-27.xlsx');
  assert.equal(Builder.exportFilename('2024-02-29'), 'All Evaluations - Last 90 days - updated 02-29-24.xlsx');
  for (const date of ['', null, '2026-2-03', '2026-02-29', '1900-02-29', '2026-04-31', '0000-01-01', '2026-00-01', '11-10-26']) assert.throws(() => Builder.exportFilename(date), /Choose a valid report date/, String(date));
});
