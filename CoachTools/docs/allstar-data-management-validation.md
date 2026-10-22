# All-Star data management overhaul

## Behavior

Update Data and Settings use saved metadata and array lengths. Opening them does
not scan statistical rows, build the roster index, categorize weekly data, or
compile historical monthly bundles. Detailed identity checks remain available
under explicit expandable controls, run in yielding batches, and paginate long
lists without discarding entries. Representative search remains available on
demand. Normal reporting calculations and manual categorization are retained.

Imports resolve mappings once, reuse coach normalization, and parse workbooks in
a worker. The worker delivers bounded worksheet chunks instead of copying a full
cell-object workbook to the UI. A generated source carrier supports offline
`file://` operation; portable builds reuse their embedded libraries. The combined
file chooser reuses its discovery parse. Cancel stops uncommitted work and keeps
the last committed data. Successful earlier files in a multi-file batch remain
committed if a later file fails or is cancelled.

JSON and legacy workbook packages stage their sources and settings together,
verify one storage transaction, and retain the previous dataset on failure.
A durable settings journal recovers preference writes after quota or reload
interruptions without losing committed package data.

Both **Clear All Data** buttons use the same confirmation and transaction. The
operation clears local All-Star reporting sources, workbook copies, derived
results, report snapshots, and Qualtrics reporting history while preserving
models, mappings, research definitions, rules, preferences, and other apps'
shared datasets. A persisted marker prevents cleared sources from being
automatically restored by shared synchronization. Separate result databases
have a durable cleanup marker so interrupted cleanup resumes after reload.
An explicit weekly upload refreshes only that dataset, leaving previously
cleared shared sources empty. Display errors after a verified import keep the
committed records consistent in memory and storage.

**Manage Coach Names** previews an exact identity change, including historical
sources and workbook copies, before confirmation. The change updates stored
records, roster connections, coach selections, and source versions. Renaming to
an existing coach requires explicit merge confirmation. Original contribution
identity is retained internally for monthly reconciliation, preserving row
counts and totals. Remembered corrections are optional and removable.
Corrected monthly reuploads deduplicate unambiguous equivalent contributions;
conflicting or ambiguous merged overlaps require review before application.

Merged Team Totals pool counts and use denominators for rates. An exported rate
with no available denominator is shown as unavailable rather than inventing an
average; the preview identifies affected fields. Saved report snapshots keep
their history. A simple rename corrects their identity fields without changing
scores. A merge marks affected snapshots for rerun before viewing, comparison,
or export because cached ranks, minimums, and averages cannot safely be added.
Pending snapshot updates are journaled and replayed after an interrupted rename.
Qualtrics history and an open generator update typed coach identities while
preserving representative names, concern counts, manual inputs, and rules.
Favorites and recent people keep their corrected names after reload without
requiring a roster scan when opening Home or Settings.

## Reproducible measurements

Measured on Windows with headless Chrome, using synthetic data and baseline
commit `59b8f0f02f9f611ccfb22fafc0969f09cf83f3f8`. These are local measurements,
not guarantees for every computer, workbook, or browser storage quota.

| Scenario | Baseline | Updated |
| --- | ---: | ---: |
| 50,000 QA rows, modular offline app, two consecutive imports | 8,295 / 8,791 ms | 1,862 / 1,829 ms |
| Longest UI heartbeat gap during those imports | 2,258 / 2,532 ms | 291 / 300 ms |
| 50,000 QA rows, portable app, two consecutive imports | 8,232 / 8,524 ms | 1,829 / 1,833 ms |
| Longest UI heartbeat gap, portable | 1,930 / 2,009 ms | 278 / 289 ms |
| Update Data, 10,000 source rows + 1,000 roster rows, median of three openings | 216.4 ms | 0.9 ms |
| Settings, same fixture | 4.9 ms | 0.4 ms |

The import measurements include parsing, normalization, persistence verification,
and completion rendering. Mean elapsed import time improved about 78%; longest
heartbeat pauses improved about 86–88%. The remaining largest pauses occur
during the browser's IndexedDB structured cloning. Detailed review work can still
take time, but ordinary data-management navigation does not start it.

`data-summary-performance.test.js` additionally opens Update Data ten times with
270,000 proxy-guarded source rows, 50,000 roster entries, and historical monthly
data. It asserts **zero row reads, roster builds, or monthly compiles**, avoiding
machine-specific timing assertions. Explicit weekly review verifies all 6,000
rows, 520 representatives, five coaches, yielding, and 100-entry pagination.

Run `data-navigation-benchmark.js` with `BASELINE_ALLSTAR_HTML` pointing to the
baseline HTML for the navigation comparison. Run
`browser-import-performance.test.js` with `ALLSTAR_BENCHMARK_ROOT` pointing to a
baseline All-Star folder, and omit that variable for the updated app. Browser
tests accept `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` for local installations.

## Validation

- `npm run test:allstar`: existing report, research, scoring, chart, monthly,
  weekly, import, export, portable-package, and compatibility gates, plus new
  data-management tests.
- Worker tests: XLSX, XLS, ODS, CSV, TSV, formatted dates/numbers, raw weekly
  precision, empty sheets, bounded chunks, parser errors, and cancellation.
- Import tests: small/large replacements, multi-file reuse, malformed files,
  normalization cancellation, transaction/read-back failure, committed-data
  retention, shared-source precedence, package rollback/settings recovery,
  obsolete custom-source removal, and reopen.
- Rename tests: 6,000 records, exact matching, preserved free text and partial
  names, merge confirmation, unchanged totals, weighted rates, cancellation,
  persistence failure rollback, historical monthly contributions, unloaded
  workbook sheets, remembered corrections, cached-index invalidation, snapshots,
  representative-only snapshots, Qualtrics history, and journal recovery.
- Clear tests: both entry points, Settings before opening Data, transaction
  failure, interrupted secondary cleanup, shared data preservation, suppression
  after reload, preserved settings, concurrent saves, and subsequent uploads.
- Real browser tests cover modular and portable files: navigation, research,
  charts, models, population filters, creation views, direct weekly stats, upload
  routes, rename/merge, corrected future uploads, both clear buttons, and reload.

Three broader-check failures were reproduced on the unchanged baseline:

1. `npm test` stops in `tests/performance-data-layer.test.js:105` at the Data
   Manager staged-state assertion.
2. `test:allstar:browser` stops in `browser-dated-stats.test.js:137` because the
   ordinary weekly source picker does not close the generic research editor.
3. Running `browser-direct-weekly-stats.test.js` separately reaches its first
   numerical result, then Chrome cancels the download at line 39 in both builds
   under this environment. The export-download portion is not verified here;
   the numerical/direct-weekly unit gates pass.

The affected All-Star suite and the remaining browser tests are run separately;
these baseline failures are not claimed as passing. No production reporting
data is included in these tests. No mandatory server or new backend is introduced.
