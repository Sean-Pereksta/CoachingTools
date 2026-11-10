'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'apps/qa-eval-builder.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'shared/qa-eval-builder.js'), 'utf8');
const headers = ['Conversationid', 'Genesys Evaluation ID', 'Agent Name', 'Hire Date', 'Team',
  'Calibration Status', 'Agent Has Read', 'Interaction Start Time', 'Interaction End Time',
  'Evaluation Status', 'Evaluator', 'Evaluation Form', 'Queue', 'VDN', 'Assigned Date',
  'Changed Date', 'Days Hired', 'Score %', 'Interaction Duration'];
const settle = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function result(sheetName, options = {}) {
  const rows = options.rows || [headers.map((header, index) => index === 2 ? 'Sample Agent' : 'value ' + index)];
  const sheet = {};
  rows.forEach((row, index) => row.forEach((value, column) => {
    sheet[columnName(column + 4) + (index + 2)] = { v: value };
  }));
  return {
    workbook: { SheetNames: ['QA Genesys Evaluation Score'], Sheets: { 'QA Genesys Evaluation Score': sheet } },
    headers: headers.slice(), rows, sourceSheet: sheetName, headerRow: options.headerRow || 1,
    stats: { rows: rows.length, durationsCalculated: options.durationsCalculated ?? rows.length },
    warnings: options.warnings || []
  };
}

function columnName(index) {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + (value - 1) % 26) + name;
  }
  return name;
}

function workbook(name = 'Evaluations', options = {}) {
  const sources = options.sources || [{ sheetName: name, headerRow: 1, valid: true }];
  return {
    name, sources, error: options.error,
    results: Object.fromEntries(sources.filter(source => source.valid).map(source => [
      source.sheetName, result(source.sheetName, { ...options, headerRow: source.headerRow })
    ]))
  };
}

function harness() {
  const { window, document } = parseHTML(html);
  const writes = [], reads = [], conversions = [], decodes = [], parsedInputs = new Map();
  let writeError = null;
  const get = id => document.getElementById(id);
  window.XLSX = {
    read(buffer, options) { reads.push({ buffer, options }); return parsedInputs.get(buffer) || buffer; },
    writeFile(book, filename, options) {
      if (writeError) throw writeError;
      writes.push({ book, filename, options });
    },
    utils: {
      encode_col: columnName,
      encode_cell: ({ r, c }) => columnName(c) + (r + 1),
      format_cell: entry => String(entry.v)
    }
  };
  window.QAEvalBuilder = {
    decodeText(buffer) { decodes.push(buffer); return new TextDecoder().decode(buffer); },
    discoverSources(book) { return book.sources; },
    convertWorkbook(book, xlsx, selection) {
      conversions.push({ book, selection });
      if (book.error) throw new Error(book.error);
      if (!selection) throw new Error('Missing required QA headers.');
      return book.results[selection.sheetName];
    }
  };
  // linkedom exposes select.value as a getter only; model the browser setter.
  const select = get('sourceSheet');
  Object.defineProperty(select, 'value', {
    get() { return [...this.options].find(option => option.selected)?.value ?? this.firstChild?.value ?? ''; },
    set(value) {
      [...this.options].forEach(option => option.removeAttribute('selected'));
      [...this.options].find(option => option.value === String(value))?.setAttribute('selected', '');
    }
  });
  vm.runInNewContext(script, { window, document });
  function input(file) {
    Object.defineProperty(get('sourceFile'), 'files', { configurable: true, value: [file] });
    get('sourceFile').dispatchEvent(new window.Event('change'));
  }
  function drop(files) {
    const event = new window.Event('drop', { bubbles: true, cancelable: true });
    event.dataTransfer = { files };
    document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, 'File drops do not navigate away from the tool.');
  }
  function choose(value) {
    select.value = value;
    select.dispatchEvent(new window.Event('change'));
  }
  return { window, document, get, input, drop, choose, writes, reads, conversions, decodes,
    parseAs(data, book) { parsedInputs.set(data, book); },
    failDownloads(error) { writeError = error; } };
}

function file(name, book) { return { name, arrayBuffer: async () => book }; }

test('file picker converts one table, previews it, and downloads automatically', async () => {
  const h = harness(), book = workbook();
  const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x80]).buffer;
  h.parseAs(bytes, book);
  let pickerOpens = 0;
  h.get('sourceFile').click = () => { pickerOpens++; };
  h.get('dropZone').click();
  assert.equal(pickerOpens, 1);
  h.input(file('new-evaluations.xlsx', bytes));
  await settle();

  assert.equal(h.get('result').hidden, false);
  assert.equal(h.get('warnings').hidden, true);
  assert.equal(h.get('sheetChoice').hidden, true);
  assert.equal(h.get('rowCount').textContent, '1');
  assert.equal(h.get('durationCount').textContent, '1');
  assert.match(h.get('sourceDetail').textContent, /new-evaluations\.xlsx/);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].book, book.results.Evaluations.workbook);
  assert.match(h.writes[0].filename, /\.xlsx$/);
  assert.equal(h.decodes.length, 0, 'Binary Excel workbooks are not passed through text decoding.');
  assert.equal(h.reads[0].buffer, bytes, 'The workbook parser receives the original binary bytes.');
  assert.equal(h.reads[0].options.type, 'array');
  assert.equal(h.get('sourceFile').value, '', 'The same report can be selected again.');
  assert.equal(h.get('dropZone').disabled, false);
  const previewHeaders = [...h.get('previewTable').querySelectorAll('thead tr:last-child th')].map(cell => cell.textContent);
  assert.deepEqual(previewHeaders, ['', '', '', '', ...headers]);
  assert.equal(h.get('previewTable').querySelectorAll('tbody tr').length, 1);
  assert.match(h.get('previewTable').textContent, /Sample Agent/);
  h.get('downloadBtn').click();
  assert.equal(h.writes.length, 2, 'The user can download the completed workbook again.');
});

test('a dropped report with row notes waits for manual download', async () => {
  const h = harness(), note = 'Row 2: End time is missing; duration is blank.';
  const book = workbook('QA Export', { warnings: [note], durationsCalculated: 0 });
  const csvText = 'Agent Name,Score\n"José 李",90';
  const bytes = new TextEncoder().encode(csvText).buffer;
  h.parseAs(csvText, book);
  h.drop([file('qa.csv', bytes)]);
  await settle();
  assert.equal(h.get('result').hidden, false);
  assert.equal(h.get('warnings').hidden, false);
  assert.equal(h.get('warningList').children.length, 1);
  assert.equal(h.get('warningList').firstChild.textContent, note);
  assert.equal(h.get('durationCount').textContent, '0');
  assert.equal(h.writes.length, 0, 'Row notes require review before downloading.');
  assert.equal(h.decodes.length, 1);
  assert.equal(h.decodes[0], bytes, 'Text decoding receives the uploaded report bytes.');
  assert.equal(h.reads[0].buffer, csvText, 'The workbook parser receives decoded Unicode text.');
  assert.equal(h.reads[0].options.type, 'string');
  assert.equal(h.reads[0].options.raw, true, 'Text reports keep their source values.');
  h.get('downloadBtn').click();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].book, book.results['QA Export'].workbook);
});

test('multiple valid tables require a choice before conversion or download', async () => {
  const h = harness();
  const book = workbook('multi', { sources: [
    { sheetName: 'Summary', headerRow: 1, valid: false },
    { sheetName: 'Current QA', headerRow: 3, valid: true },
    { sheetName: 'Previous QA', headerRow: 5, valid: true }
  ] });
  h.input(file('qa.xlsx', book));
  await settle();
  assert.equal(h.get('sheetChoice').hidden, false);
  assert.equal(h.get('result').hidden, true);
  assert.equal(h.conversions.length, 0);
  assert.equal(h.writes.length, 0);
  const choices = [...h.get('sourceSheet').options].slice(1);
  assert.equal(choices.length, 2);
  assert.match(choices[0].textContent, /Current QA/);
  assert.match(choices[1].textContent, /Previous QA/);

  h.choose(choices[1].value);
  assert.equal(h.conversions.length, 1);
  assert.equal(h.conversions[0].selection.sheetName, 'Previous QA');
  assert.equal(h.conversions[0].selection.headerRow, 5);
  assert.equal(h.writes[0].book, book.results['Previous QA'].workbook);
  assert.match(h.get('sourceDetail').textContent, /Previous QA/);
  h.choose('');
  assert.equal(h.get('result').hidden, true);
  h.get('downloadBtn').click();
  assert.equal(h.writes.length, 1, 'Clearing a choice also clears its downloadable result.');
});

test('invalid replacements clear the previous preview and downloadable workbook', async () => {
  const h = harness();
  h.input(file('valid.xlsx', workbook()));
  await settle();
  assert.equal(h.writes.length, 1);

  let invalidFileRead = false;
  h.input({ name: 'not-a-report.pdf', arrayBuffer: async () => { invalidFileRead = true; } });
  await settle();
  assert.equal(invalidFileRead, false);
  assert.equal(h.get('result').hidden, true);
  assert.equal(h.get('previewTable').children.length, 0);
  assert.equal(h.get('status').classList.contains('error'), true);
  h.get('downloadBtn').click();
  assert.equal(h.writes.length, 1);

  h.input(file('wrong-headers.xlsx', workbook('Missing headers', { sources: [], error: 'Missing Agent Name.' })));
  await settle();
  assert.equal(h.get('result').hidden, true);
  assert.equal(h.get('sheetChoice').hidden, true);
  assert.equal(h.get('status').textContent, 'Missing Agent Name.');
  h.get('downloadBtn').click();
  assert.equal(h.writes.length, 1);

  h.input(file('unusable.xlsx', workbook('QA', { error: 'Duplicate Score column.' })));
  await settle();
  assert.equal(h.get('result').hidden, true);
  assert.equal(h.get('status').textContent, 'Duplicate Score column.');
  assert.equal(h.get('dropZone').disabled, false);
});

test('dropping multiple reports clears the previous result without converting either file', async () => {
  const h = harness();
  h.drop([file('valid.xlsx', workbook())]);
  await settle();
  const reads = h.reads.length;
  h.drop([file('first.xlsx', workbook()), file('second.xlsx', workbook())]);
  await settle();
  assert.equal(h.reads.length, reads);
  assert.equal(h.get('result').hidden, true);
  assert.equal(h.get('sheetChoice').hidden, true);
  assert.equal(h.get('status').classList.contains('error'), true);
  h.get('downloadBtn').click();
  assert.equal(h.writes.length, 1);
});

test('a slow earlier upload cannot replace or download over the newer report', async () => {
  const h = harness(), pending = deferred();
  const oldBook = workbook('Old QA'), newBook = workbook('Latest QA');
  h.input({ name: 'old.xlsx', arrayBuffer: () => pending.promise });
  assert.equal(h.get('dropZone').disabled, true);
  h.drop([file('latest.xlsx', newBook)]);
  await settle();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].book, newBook.results['Latest QA'].workbook);
  const status = h.get('status').textContent;
  pending.resolve(oldBook);
  await settle();
  assert.equal(h.reads.length, 1, 'The stale file is discarded before workbook parsing.');
  assert.equal(h.conversions.length, 1);
  assert.equal(h.writes.length, 1);
  assert.equal(h.get('status').textContent, status);
  assert.match(h.get('sourceDetail').textContent, /latest\.xlsx.*Latest QA/);
  assert.equal(h.get('dropZone').disabled, false);
  h.get('downloadBtn').click();
  assert.equal(h.writes[1].book, newBook.results['Latest QA'].workbook);
});

test('rejecting a stale read does not erase the newer result or error state', async () => {
  const h = harness(), pending = deferred();
  h.input({ name: 'slow.xlsx', arrayBuffer: () => pending.promise });
  h.input(file('invalid.pdf', workbook()));
  await settle();
  const status = h.get('status').textContent;
  pending.reject(new Error('Old file read failed.'));
  await settle();
  assert.equal(h.get('status').textContent, status);
  assert.equal(h.get('status').classList.contains('error'), true);
  assert.equal(h.get('result').hidden, true);
  assert.equal(h.get('dropZone').disabled, false);
  assert.equal(h.writes.length, 0);
});

test('a failed browser download leaves the converted workbook available for retry', async () => {
  const h = harness(), book = workbook();
  h.failDownloads(new Error('Download blocked.'));
  h.input(file('qa.xlsx', book));
  await settle();
  assert.equal(h.get('result').hidden, false);
  assert.equal(h.get('status').classList.contains('error'), true);
  assert.equal(h.writes.length, 0);
  h.failDownloads(null);
  h.get('downloadBtn').click();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].book, book.results.Evaluations.workbook);
  assert.equal(h.get('status').classList.contains('success'), true);
});
