/* 90 Day Eval Builder: explicit aliases and the legacy QA export contract. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QAEvalBuilder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FIELDS = [
    ['Conversationid', 'Conversation ID'], ['Genesys Evaluation ID'], ['Agent Name'],
    ['Hire Date', 'Date Hire'], ['Team'], ['Calibration Status'], ['Agent Has Read'],
    ['Interaction Start Time', 'Conversation Start EST'], ['Interaction End Time', 'Conversation End EST'],
    ['Evaluation Status'], ['Evaluator'], ['Evaluation Form'], ['Queue', 'Queue Name'], ['VDN'],
    ['Assigned Date', 'Assigned Date EST'], ['Changed Date', 'Changed Date EST'], ['Days Hired'],
    ['Score %', 'Score'], ['Interaction Duration']
  ];
  const headers = Object.freeze(FIELDS.map(field => field[0]));
  const required = headers.slice(0, -1);
  const dateFields = new Set(['Hire Date', 'Interaction Start Time', 'Interaction End Time', 'Assigned Date', 'Changed Date']);
  const identifierFields = new Set(['Conversationid', 'Genesys Evaluation ID', 'VDN']);
  const normalize = value => String(value == null ? '' : value).normalize('NFKC').replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9%]/g, '');
  const aliases = new Map();
  FIELDS.forEach(field => field.forEach(alias => aliases.set(normalize(alias), field[0])));
  const empty = cell => !cell || cell.t === 'z' || cell.v == null || (typeof cell.v === 'string' && !cell.v.trim());
  const pad = value => String(value).padStart(2, '0');

  function validCalendarDate(year, month, day) {
    if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }

  function reportDateFromFilename(name) {
    const text = typeof name === 'string' ? name : '', found = new Set();
    const add = (year, month, day) => {
      if (validCalendarDate(year, month, day)) found.add(String(year).padStart(4, '0') + '-' + pad(month) + '-' + pad(day));
    };
    // Lookaheads also examine overlapping date-shaped text rather than picking
    // whichever valid interpretation happens to appear first in the filename.
    for (const match of text.matchAll(/(?=(?:^|[^0-9])(\d{1,2})([.-])(\d{1,2})\2(\d{4}|\d{2})(?=$|[^0-9]))/g)) {
      add(match[4].length === 2 ? 2000 + +match[4] : +match[4], +match[1], +match[3]);
    }
    for (const match of text.matchAll(/(?=(?:^|[^0-9])(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[^0-9]))/g)) add(+match[1], +match[2], +match[3]);
    return found.size === 1 ? [...found][0] : '';
  }

  function exportFilename(isoDate) {
    const match = typeof isoDate === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (!match || !validCalendarDate(+match[1], +match[2], +match[3])) throw new Error('Choose a valid report date before downloading. Use YYYY-MM-DD.');
    return 'All Evaluations - Last 90 days - updated ' + match[2] + '-' + match[3] + '-' + match[1].slice(-2) + '.xlsx';
  }

  function decodeText(buffer) {
    const bytes = ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer);
    let encoding = 'utf-8', offset = 0;
    if (bytes[0] === 255 && bytes[1] === 254) { encoding = 'utf-16le'; offset = 2; }
    else if (bytes[0] === 254 && bytes[1] === 255) { encoding = 'utf-16be'; offset = 2; }
    else if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) offset = 3;
    else {
      // Excel's Unicode Text files can also arrive without a BOM.
      const count = Math.min(bytes.length, 4000);
      let evenZero = 0, oddZero = 0;
      for (let index = 0; index < count; index++) if (!bytes[index]) (index % 2 ? oddZero++ : evenZero++);
      if (oddZero > count / 5) encoding = 'utf-16le';
      else if (evenZero > count / 5) encoding = 'utf-16be';
    }
    let text;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset)); }
    catch (error) {
      if (encoding !== 'utf-8') throw new Error('The text report contains invalid ' + encoding.toUpperCase() + ' data. Save it as UTF-8 CSV and try again.');
      text = new TextDecoder('windows-1252').decode(bytes);
    }
    return text.replace(/^\uFEFF/, '');
  }

  function analyzeRow(sheet, rowIndex, XLSX) {
    const columns = {}, duplicates = [];
    for (const address of Object.keys(sheet)) {
      if (address[0] === '!' || empty(sheet[address])) continue;
      const cell = XLSX.utils.decode_cell(address);
      if (cell.r !== rowIndex) continue;
      const field = aliases.get(normalize(sheet[address].v));
      if (!field) continue;
      if (Object.prototype.hasOwnProperty.call(columns, field)) duplicates.push(field);
      else columns[field] = cell.c;
    }
    const missingHeaders = required.filter(field => columns[field] == null);
    const duplicateHeaders = [...new Set(duplicates)];
    return { columns, matchedHeaders: required.length - missingHeaders.length, missingHeaders, duplicateHeaders,
      valid: !missingHeaders.length && !duplicateHeaders.length };
  }

  function discoverSources(workbook, XLSX) {
    if (!workbook || !Array.isArray(workbook.SheetNames)) throw new Error('The file is not a readable workbook.');
    const sources = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const counts = new Map();
      for (const address of Object.keys(sheet)) {
        if (address[0] === '!' || empty(sheet[address]) || !aliases.has(normalize(sheet[address].v))) continue;
        const row = XLSX.utils.decode_cell(address).r;
        counts.set(row, (counts.get(row) || 0) + 1);
      }
      // A full report header beats title/notes containing an isolated field name.
      const candidates = [...counts].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      if (!candidates.length) continue;
      const rowIndex = candidates[0][0];
      sources.push({ sheetName, headerRow: rowIndex + 1, ...analyzeRow(sheet, rowIndex, XLSX) });
    }
    return sources;
  }

  function checkedUTC(year, month, day, hour, minute, second, millisecond) {
    if (year < 1900 || month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return NaN;
    const ms = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    const date = new Date(ms);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? ms : NaN;
  }

  // Naive exported timestamps are Eastern wall-clock values. Treat both as UTC
  // for subtraction so the computer's own timezone cannot move either value.
  function timestamp(value, XLSX, date1904) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) {
      const date = XLSX.SSF.parse_date_code(value, { date1904: !!date1904 });
      if (!date) return NaN;
      return checkedUTC(date.y, date.m, date.d, date.H, date.M, date.S, 0) + Math.round((date.u || 0) * 1000);
    }
    if (typeof value !== 'string' || !value.trim()) return NaN;
    const text = value.trim();
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(AM|PM)?\s*(Z|EST|EDT|[+-]\d{2}:?\d{2})?$/i.exec(text);
    let year, month, day;
    if (match) { year = +match[1]; month = +match[2]; day = +match[3]; }
    else {
      match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(AM|PM)?\s*(Z|EST|EDT|[+-]\d{2}:?\d{2})?$/i.exec(text);
      if (!match) return NaN;
      year = +match[3]; month = +match[1]; day = +match[2];
    }
    let hour = +(match[4] || 0);
    const ampm = (match[8] || '').toUpperCase();
    if (ampm) {
      if (hour < 1 || hour > 12) return NaN;
      hour = hour % 12 + (ampm === 'PM' ? 12 : 0);
    }
    let ms = checkedUTC(year, month, day, hour, +(match[5] || 0), +(match[6] || 0), +((match[7] || '').padEnd(3, '0').slice(0, 3)));
    const zone = (match[9] || '').toUpperCase();
    if (zone === 'EST') ms += 5 * 3600000;
    else if (zone === 'EDT') ms += 4 * 3600000;
    else if (zone && zone !== 'Z') {
      const digits = zone.slice(1).replace(':', ''), hours = +digits.slice(0, 2), minutes = +digits.slice(2);
      if (hours > 23 || minutes > 59) return NaN;
      ms -= (zone[0] === '+' ? 1 : -1) * (hours * 60 + minutes) * 60000;
    }
    return ms;
  }

  function dateText(value, field, XLSX, date1904) {
    const ms = timestamp(value, XLSX, date1904);
    if (!Number.isFinite(ms)) return null;
    const date = new Date(ms);
    const day = (date.getUTCMonth() + 1) + '/' + date.getUTCDate() + '/' + date.getUTCFullYear();
    if (field === 'Hire Date') return day;
    const hour = date.getUTCHours();
    const fraction = date.getUTCMilliseconds() ? '.' + String(date.getUTCMilliseconds()).padStart(3, '0') : '';
    return day + ' ' + (hour % 12 || 12) + ':' + pad(date.getUTCMinutes()) + ':' + pad(date.getUTCSeconds()) + fraction + (hour < 12 ? ' AM' : ' PM');
  }

  function sourceValue(cell, field, XLSX, date1904, warn) {
    if (empty(cell)) return { t: 's', v: '' };
    if (cell.t === 'e') { warn(field + ' contains an Excel error; the displayed error is retained.'); return { t: 's', v: cell.w || XLSX.utils.format_cell({ ...cell }) }; }
    if (dateFields.has(field) && (typeof cell.v === 'number' || cell.v instanceof Date)) {
      const value = dateText(cell.v, field, XLSX, date1904);
      if (value == null) { warn(field + ' is not a valid Excel date; its source value is retained.'); return { t: 's', v: String(cell.v) }; }
      return { t: 's', v: value };
    }
    if (identifierFields.has(field)) {
      if (typeof cell.v === 'number' && !Number.isSafeInteger(cell.v)) warn(field + ' is stored as a large numeric ID in the source and may already have lost digits.');
      const customFormat = cell.z && cell.z !== 'General' && cell.z !== '@';
      return { t: 's', v: typeof cell.v === 'number' && customFormat ? XLSX.utils.format_cell({ ...cell }) : String(cell.v) };
    }
    const result = { t: typeof cell.v === 'number' ? 'n' : typeof cell.v === 'boolean' ? 'b' : 's', v: cell.v };
    // Keep the original scale and display. In particular .95 with a 0% source
    // format remains .95 displayed as 95%, and a plain 95 remains plain 95.
    if (cell.z) result.z = cell.z;
    return result;
  }

  function convertWorkbook(input, XLSX, options) {
    options = typeof options === 'string' ? { sheetName: options } : options || {};
    const sources = discoverSources(input, XLSX);
    let source;
    if (options.sheetName) {
      const sheet = input.Sheets[options.sheetName];
      if (!sheet) throw new Error('The selected worksheet is missing.');
      source = options.headerRow ? { sheetName: options.sheetName, headerRow: options.headerRow, ...analyzeRow(sheet, options.headerRow - 1, XLSX) } : sources.find(item => item.sheetName === options.sheetName);
    } else {
      const valid = sources.filter(item => item.valid);
      if (valid.length > 1) throw new Error('More than one worksheet contains QA data. Choose the worksheet to convert.');
      source = valid[0] || sources.sort((a, b) => b.matchedHeaders - a.matchedHeaders)[0];
    }
    if (!source) throw new Error('No QA header row was found. Use the 90-day evaluation report with Conversation ID, Agent Name, and Score headers.');
    if (source.duplicateHeaders.length) throw new Error('Duplicate mapped headers: ' + source.duplicateHeaders.join(', ') + '. Keep one source column for each field.');
    if (source.missingHeaders.length) throw new Error('Missing required headers: ' + source.missingHeaders.join(', ') + '.');

    const sheet = input.Sheets[source.sheetName], output = {}, rows = [], warnings = [];
    const stats = { rows: 0, durationsCalculated: 0, durationWarnings: 0 };
    const date1904 = !!input.Workbook?.WBProps?.date1904;
    const populated = new Map();
    for (const address of Object.keys(sheet)) {
      if (address[0] === '!' || (empty(sheet[address]) && !sheet[address]?.f)) continue;
      const position = XLSX.utils.decode_cell(address);
      if (position.r >= source.headerRow) {
        if (!populated.has(position.r)) populated.set(position.r, []);
        populated.get(position.r).push(position.c);
      }
    }
    headers.forEach((header, column) => { output[XLSX.utils.encode_cell({ r: 0, c: column + 4 })] = { t: 's', v: header }; });
    for (const rowIndex of [...populated.keys()].sort((a, b) => a - b)) {
      const warn = message => warnings.push('Row ' + (rowIndex + 1) + ': ' + message);
      const cellFor = field => sheet[XLSX.utils.encode_cell({ r: rowIndex, c: source.columns[field] })];
      // Printed reports can repeat the complete header between pages.
      if (required.every(field => aliases.get(normalize(cellFor(field)?.v)) === field)) {
        warn('A repeated header row was skipped.');
        continue;
      }
      const row = [];
      required.forEach((field, column) => {
        const cell = cellFor(field);
        if (cell?.f && empty(cell)) warn(field + ' has a formula without a saved result; the output cell is blank.');
        const copied = sourceValue(cell, field, XLSX, date1904, warn);
        output[XLSX.utils.encode_cell({ r: rows.length + 1, c: column + 4 })] = copied;
        row.push(copied.v);
      });
      const startCell = cellFor('Interaction Start Time'), endCell = cellFor('Interaction End Time');
      const start = timestamp(startCell?.v, XLSX, date1904), end = timestamp(endCell?.v, XLSX, date1904);
      let duration = '';
      if (empty(startCell) || empty(endCell) || startCell?.t === 'e' || endCell?.t === 'e' || !Number.isFinite(start) || !Number.isFinite(end)) {
        warn('Interaction Duration is blank because the conversation start or end is missing or invalid.'); stats.durationWarnings++;
      } else if (end < start) {
        warn('Interaction Duration is blank because the conversation end is before its start.'); stats.durationWarnings++;
      } else {
        const seconds = Math.round((end - start) / 1000);
        duration = Math.floor(seconds / 3600) + ':' + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60);
        stats.durationsCalculated++;
      }
      output[XLSX.utils.encode_cell({ r: rows.length + 1, c: 22 })] = { t: 's', v: duration };
      row.push(duration); rows.push(row);
    }
    if (!rows.length) throw new Error('The selected worksheet has headers but no evaluation rows to export.');
    stats.rows = rows.length;
    output['!ref'] = 'E1:W' + (rows.length + 1);
    output['!autofilter'] = { ref: output['!ref'] };
    output['!cols'] = [...Array.from({ length: 4 }, () => ({ wch: 3 })), ...headers.map(header => ({ wch: Math.max(header.length + 2, /Time|Date/.test(header) ? 25 : header === 'Agent Name' ? 25 : 18) }))];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, output, '90 Day QA Evals');
    return { workbook, rows, headers: [...headers], sourceSheet: source.sheetName, headerRow: source.headerRow, warnings, stats };
  }

  return Object.freeze({ headers, normalize, reportDateFromFilename, exportFilename, decodeText, discoverSources, convertWorkbook });
});
