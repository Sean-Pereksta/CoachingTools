(function attachEvalBuilder(root) {
  'use strict';
  const $ = id => document.getElementById(id);
  let generation = 0, inputBook = null, output = null, sourceName = '', sources = [];
  const filename = 'QA 90 Day Evals - Legacy.xlsx';
  function status(message, kind) {
    $('status').textContent = message;
    $('status').className = 'status' + (kind ? ' ' + kind : '');
  }
  function clearResult() {
    output = null;
    $('result').hidden = true;
    $('warnings').hidden = true;
    $('previewTable').replaceChildren();
  }
  function cell(tag, value, className) {
    const element = document.createElement(tag);
    element.textContent = value == null ? '' : String(value);
    if (className) element.className = className;
    return element;
  }
  function renderPreview(result) {
    const table = $('previewTable'), head = document.createElement('thead'), letters = document.createElement('tr'), labels = document.createElement('tr'), body = document.createElement('tbody');
    for (let i = 0; i < 23; i++) letters.append(cell('th', root.XLSX.utils.encode_col(i)));
    for (let i = 0; i < 4; i++) labels.append(cell('th', '', 'blank'));
    result.headers.forEach(header => labels.append(cell('th', header)));
    head.append(letters, labels);
    const sheet = result.workbook.Sheets[result.workbook.SheetNames[0]];
    result.rows.slice(0, 8).forEach((row, index) => {
      const tr = document.createElement('tr');
      for (let i = 0; i < 4; i++) tr.append(cell('td', '', 'blank'));
      row.forEach((value, column) => {
        const exported = sheet[root.XLSX.utils.encode_cell({r:index + 1,c:column + 4})];
        tr.append(cell('td', exported ? root.XLSX.utils.format_cell(exported) : value));
      });
      body.append(tr);
    });
    table.replaceChildren(head, body);
    $('previewCount').textContent = 'First ' + Math.min(8, result.rows.length) + ' evaluations';
  }
  function download() {
    if (!output) return;
    try {
      root.XLSX.writeFile(output.workbook, filename, {bookType:'xlsx',compression:true});
      status('Export prepared: ' + filename + '. Check your browser downloads.', 'success');
    } catch (error) {
      status('Your file is formatted, but the download could not start. Try Download Excel again. ' + error.message, 'error');
    }
  }
  function convert(source, autoDownload) {
    clearResult();
    try {
      output = root.QAEvalBuilder.convertWorkbook(inputBook, root.XLSX, {sheetName:source.sheetName,headerRow:source.headerRow});
      $('rowCount').textContent = output.stats.rows.toLocaleString();
      $('durationCount').textContent = output.stats.durationsCalculated.toLocaleString();
      $('sourceDetail').textContent = sourceName + ' · ' + output.sourceSheet + ' · Source header row ' + output.headerRow;
      $('resultTitle').textContent = output.warnings.length ? 'Your file is ready with row notes' : 'Your file is ready';
      $('warnings').hidden = output.warnings.length === 0;
      $('warningList').replaceChildren(...output.warnings.slice(0, 50).map(warning => cell('li', warning)));
      $('warningMore').hidden = output.warnings.length <= 50;
      $('warningMore').textContent = output.warnings.length > 50 ? (output.warnings.length - 50) + ' more row notes. Review the source times for these evaluations.' : '';
      renderPreview(output);
      $('result').hidden = false;
      status('Formatted ' + output.stats.rows.toLocaleString() + ' evaluations in the original layout.', 'success');
      // Row problems need review before a file is downloaded; all rows are retained.
      $('downloadBtn').textContent = output.warnings.length ? 'Download Excel' : 'Download Excel again';
      if (autoDownload && !output.warnings.length) download();
    } catch (error) { clearResult(); status(error.message, 'error'); }
  }
  async function loadFile(file) {
    if (!file) return;
    const current = ++generation;
    inputBook = null; sources = []; clearResult();
    $('sheetChoice').hidden = true;
    $('sourceSheet').replaceChildren(cell('option', 'Choose a table'));
    $('sourceSheet').firstChild.value = '';
    status('Reading ' + file.name + '…');
    $('dropZone').disabled = true;
    try {
      if (!/\.(xlsx|xls|csv|tsv|txt)$/i.test(file.name)) throw new Error('Choose an Excel, CSV, or TSV evaluation report.');
      if (!root.XLSX || !root.QAEvalBuilder) throw new Error('The local file tools could not load. Open this tool from the complete CoachTools folder.');
      const buffer = await file.arrayBuffer();
      if (current !== generation) return;
      const textInput = /\.(csv|tsv|txt)$/i.test(file.name);
      const data = textInput ? root.QAEvalBuilder.decodeText(buffer) : buffer;
      inputBook = root.XLSX.read(data, {type:textInput ? 'string' : 'array',raw:textInput,cellDates:false,cellNF:true,cellText:true,sheetStubs:true});
      sources = root.QAEvalBuilder.discoverSources(inputBook, root.XLSX);
      sourceName = file.name;
      const valid = sources.filter(source => source.valid);
      if (!valid.length) {
        // The core supplies specific missing / duplicate header feedback.
        root.QAEvalBuilder.convertWorkbook(inputBook, root.XLSX);
        throw new Error('No evaluation table was found in this report.');
      }
      if (valid.length === 1) convert(valid[0], true);
      else {
        sources = valid;
        sources.forEach((source, index) => { const option = cell('option', source.sheetName + ' · header row ' + source.headerRow); option.value = String(index); $('sourceSheet').append(option); });
        $('sheetChoice').hidden = false;
        status('Choose the evaluation table to format and download.');
      }
    } catch (error) { if (current === generation) { clearResult(); status(error.message, 'error'); } }
    finally { if (current === generation) $('dropZone').disabled = false; }
  }
  $('dropZone').addEventListener('click', () => $('sourceFile').click());
  $('sourceFile').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; loadFile(file); });
  $('sourceSheet').addEventListener('change', event => { if (event.target.value === '') { clearResult(); return; } convert(sources[Number(event.target.value)], true); });
  $('downloadBtn').addEventListener('click', download);
  document.addEventListener('dragover', event => { event.preventDefault(); $('dropZone').classList.add('drag'); });
  document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('dropZone').classList.remove('drag'); });
  document.addEventListener('drop', event => {
    event.preventDefault(); $('dropZone').classList.remove('drag');
    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || !files.length) return;
    if (files.length !== 1) { ++generation; $('dropZone').disabled = false; clearResult(); $('sheetChoice').hidden = true; status('Drop one evaluation report at a time.', 'error'); return; }
    loadFile(files[0]);
  });
})(window);
