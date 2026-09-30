# Weekly Data Builder: Update Names

The Update mode menu now has **Add**, **Modify**, and **Update Names**.

## One-file workflow

1. Select **Update Names**.
2. Upload only the existing built stats file into the weekly-file card. A file already loaded there can be reused.
3. Choose the existing **Title Case — John Doe** or **lowercase — john doe** option.
4. Select **Preview name changes**, review the before/after cells, then **Export names-updated CSV**.

No Opportunity file, Wiper file, publication date, Add new option, or source-report settings are required. Selecting Preserve asks the user to choose a capitalization format before previewing. Existing capitalization preferences continue to be remembered by the existing formatter.

Every row after the selected header is visited, across all weeks. Only mapped Representative / Name, Coach / Sheet, and Manager name cells are eligible for formatting. Source columns can correct mappings. A name/date mapping collision is rejected rather than risking changes to dates.

`john doe`, `John Doe`, and `JOHN DOE` become `John Doe` with Title Case, or `john doe` with lowercase. The existing formatter handles accented letters, apostrophes, and hyphenated segments. Spelling, punctuation, spaces, and first/last-name order are not standardized by this action.

## Preservation contract

The transformation clones the original parsed rows rather than rebuilding a weekly result. It never calls either stats assembler, source-record deduplication, date matching, or saved name replacement / manager assignment logic. It does not append, delete, sort, merge, or pad rows. Headers, preamble, blank rows, duplicate rows, dates, metrics, and other non-name cells are retained. Formula-like names and non-string cells keep the existing formatter's protection.

The preview lists actual changed cells, with original file row numbers and dates, in pages of 50. The export always includes the complete selected worksheet, not just the preview page or changed rows. An already-normalized file can still be previewed and exported with zero changes.

Changing the file, worksheet, column mappings, or capitalization invalidates the preview and locks export. File-read failures and reset also prevent exporting an earlier result. Add and Modify keep their existing handlers, validation, and transformation engines.

## File format scope

The original upload is never overwritten. The output is a new CSV, named `<original>_names_title.csv` or `<original>_names_lower.csv`. Preservation refers to parsed cell values and row/column structure, not byte-for-byte CSV encoding or quoting. As in the existing builder, XLSX imports read the selected worksheet's saved values; CSV cannot retain workbook styling, live formulas, or other worksheets.

## Validation

Run `node --test tests/weekly-update-names.test.js` from `CoachTools` (also included in `npm run test:weekly-integrity`). The 26 tests cover the one-file contract, unchanged statistics/dates/headers, immutable input, duplicate/blank/ragged rows, managers, original capitalization rules, zero-change files, safe mappings, stale export protection, loader paths, and a 10,000-row history.

Optional browser contract harness: `python tests/weekly-update-names.browser.py` with Playwright and Chromium installed. Set `CHROMIUM_PATH` when needed. It runs the production formatter and Update Names module against the builder's DOM/API/event boundary, checking single-file controls, CSV Blob contents, asynchronous file replacement/error states, pagination, reset, and returning to Add/Modify. It does not replace full application/XLSX end-to-end tests.
