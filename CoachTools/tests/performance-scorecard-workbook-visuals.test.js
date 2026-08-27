'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const visualsPath = path.join(ROOT, 'shared', 'performance-scorecard-workbook-visuals.js');
const loaderPath = path.join(ROOT, 'shared', 'coachtools-weekly-index.js');
const corePath = path.join(ROOT, 'shared', 'performance-scorecard-upload-mode-core.js');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('workbook visuals are loaded by Performance Scorecard only', () => {
  const loader = read(loaderPath);
  assert.match(loader, /performance-scorecard-workbook-visuals\.js/);
  assert.match(loader, /meta\.content !== 'performance-scorecard'/);
  assert.match(loader, /scorecardWorkbookVisuals/);
});

test('workbook mode exposes theme and Normal Basic Advanced display controls', () => {
  const source = read(visualsPath);
  assert.match(source, /id=\\?"psUploadThemeSel\\?"/);
  assert.match(source, /id=\\?"psUploadDisplayMode\\?"/);
  assert.match(source, /value=\\?"normal\\?"[^>]*>Normal/);
  assert.match(source, /value=\\?"basic\\?"[^>]*>Basic/);
  assert.match(source, /value=\\?"advanced\\?"[^>]*>Advanced/);
  assert.match(source, /mainThemeSelect\(\)/);
  assert.match(source, /displayModeSel/);
});

test('workbook columns live in a right rail and Coverage is forced off', () => {
  const source = read(visualsPath);
  assert.match(source, /psWorkbookResultsLayout/);
  assert.match(source, /grid-template-columns:minmax\(0,1fr\) 258px/);
  assert.match(source, /psUploadColumnRail/);
  assert.match(source, /psUploadColumns/);
  assert.match(source, /saved\.coverage = false/);
  assert.match(source, /data-ps-column=\\?"coverage\\?"/);
  assert.match(source, /removeWorkbookCoverageColumn/);
});

test('workbook rows are filled and the three views are vertically condensed', () => {
  const source = read(visualsPath);
  assert.match(source, /\.psUploadTable tbody td\{background:var\(--panel2\)/);
  assert.match(source, /tbody td:first-child>b\{display:block/);
  assert.match(source, /data-ps-view=\\?"basic\\?"/);
  assert.match(source, /height:27px/);
  assert.match(source, /psUploadMetricMain\+\.psUploadMetricSub\{display:inline-block!important/);
  assert.match(source, /data-ps-view=\\?"normal\\?"/);
  assert.match(source, /height:34px/);
  assert.match(source, /data-ps-view=\\?"advanced\\?"/);
  assert.match(source, /height:39px/);
  assert.match(source, /psUploadWeeks\{display:inline-flex/);
});

test('workbook Snip supports both PNG and paginated PDF export', () => {
  const source = read(visualsPath);
  assert.match(source, /data-ps-workbook-export=\\?"png\\?"/);
  assert.match(source, /data-ps-workbook-export=\\?"pdf\\?"/);
  assert.match(source, /html2canvas\.min\.js/);
  assert.match(source, /jspdf\.umd\.min\.js/);
  assert.match(source, /new jsPDF\(\{ orientation: 'landscape'/);
  assert.match(source, /pdf\.addPage\('letter', 'landscape'\)/);
  assert.match(source, /psWorkbookExportSafe/);
  assert.match(source, /psUploadExportSafe/);
});

test('visual upgrade stays isolated from the now-working workbook parser', () => {
  const core = read(corePath);
  const visuals = read(visualsPath);
  assert.match(core, /function aggregateWorkbook/);
  assert.match(core, /function findHeaderRow/);
  assert.doesNotMatch(visuals, /function aggregateWorkbook/);
  assert.doesNotMatch(visuals, /function findHeaderRow/);
});
