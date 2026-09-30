# Weekly names and Coaching Gaps reporting weeks

## Weekly Data Builder

The **Name capitalization — entire weekly file** panel offers **Preserve original capitalization** (default), **Title Case — John Doe**, and **lowercase — john doe**. The selection is remembered in this browser; it remains usable for the session if browser storage is unavailable. This preference is separate from the manager/name-replacement JSON backup.

Load reports as usual, choose the capitalization option, and build the preview. The full CSV export formats the mapped representative and coach/Sheet columns in **every output data row**, including older dates. The preview shows counts and up to 100 before/after examples; the example limit does not limit the transformation. A “new rows only” export intentionally still contains only new rows; use the full export to retain the cleaned history.

Formatting runs after the existing matching, aliases, and Add/Modify calculations. It does not merge identities, infer spelling, change name order, change dates or numerical values, modify the original uploads, or rewrite the saved manager directory. Punctuation, whitespace, accents, blanks, and spreadsheet-formula escaping are retained. Title Case is mechanical word capitalization (including hyphen/apostrophe segments), not a surname-specific spelling engine; for example, it does not infer special internal capitalization such as McDonald.

In **Modify** mode, statistics remain scoped to the selected date. The explicitly selected capitalization option has whole-file scope: name-only changes on other dates appear in the impact preview, with their actual dates and row numbers. The existing **Finalize modify** step is retained. Changing capitalization invalidates the previous preview and export authorization, requiring a new preview. Combined source/case changes are shown once as original-to-final values.

Implementation: `weekly-data-builder-settings.js` loads `weekly-data-builder-names.js`. The module decorates the existing public `WeeklyCore` build methods; the import, match, aliases, source-selection, and statistics engines are unchanged.

## Coaching Gaps

Coaching Gaps now consistently uses **Sunday through Saturday** for statistics, documented coaching, checklist incidents, and QA events. Statistics dated **9/27/2026** belong to **9/27/2026 – 10/3/2026**, not the prior week.

The defect combined Monday-based ISO grouping with Sunday date labels. In addition, the old range iterator passed UTC midnight dates into a helper using local getters, which could move dates backward in time zones west of UTC. The new calendar converts local business dates to UTC date-only arithmetic, groups at Sunday, and iterates without converting those UTC dates back through local getters.

For compatibility, internal keys retain the `YYYY-Wnn` shape, encoding the ISO Monday immediately after the Sunday start. These are internal business-week keys; they must not be interpreted as the ISO week of the raw Sunday. Labels, date ranges, event keys, and week lists share the same conversion, including year boundaries.

`coachtools-shell.js` loads `coaching-gaps-week-alignment.js` on the normal Coaching Gaps path, independent of optional intelligence loading. After installation it reloads all five data docks through the existing reload action to rebuild indexes from raw dates. Stored reports are never shifted or rewritten. Reopening Coaching Gaps applies the correction to already uploaded data; do not subtract or add seven days to the source file. A failed data refresh is reported visibly rather than presenting the old indexes as corrected.

## Verification

Run `npm run test:weekly-integrity` from `CoachTools/`. It is also included in `npm test`.

The focused suite covers 41 tests: Title Case/lowercase/Preserve, punctuation and accents, preserved formulas and non-name data, whole-history formatting, Add/Modify exports and impact records, insertion offsets, no row merging, source-edit reconciliation, option persistence and preview invalidation, startup wiring, raw-date reloads, September 27, year boundaries, invalid inputs, leap-year dates, and daylight-saving transitions across UTC, New York, Los Angeles, Auckland, and Kolkata.

These are Node unit and simulated-browser lifecycle tests, not a full visual browser or complete desktop-suite run. Before release, smoke-test with representative local reports: switch both capitalization modes, inspect Full file and Modify impact previews, export/reimport, then verify September 20, September 27, and October 4 columns and same-week coaching/QA markers in Coaching Gaps.
