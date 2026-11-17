# Coaching email generation performance

The Generate Email Files path now runs count rules, weekly-stat rules, corrective rules, period KPI preparation, and coaching-impact analysis in work slices. It checks elapsed time between rows or representatives and yields after approximately 12 ms. Synchronous previews consume the same calculation steps, so rule matching, record ordering, evidence, and scoring retain one implementation.

Team population and six-week metric calculations are reused within a synchronous rendering/work slice. The cache is discarded before control returns to the browser; changed inputs are recalculated in the next slice. Returned population Sets are copied because urgency calculations can add representatives to them.

Source bridging yields after approximately 8 ms (checked every 50 rows), with a 1,500-row maximum. Manual key-file normalization now yields every 250 rows. Duplicate readiness and alias-review rendering during connected imports was removed.

Email export paints progress before the executive email, between coach emails, and during ZIP packaging. Each pause checks the report snapshot and Weekly Stats/date settings. Clearing/replacing a report or changing those inputs prevents a stale download. Generation rechecks inputs after cooperative work and marks an interrupted published report stale.

## Verification

- `node apps/allstar/tests/qualtrics-generation-performance.test.js`: seven baseline email HTML hashes, four synchronous/cooperative rule builders, period/peer KPI context, coaching-impact analysis, cache isolation, Set copying, and export/analysis interrupted by a cleared report.
- `node apps/allstar/tests/qualtrics-bridge-performance.test.js`: row order/content, time and row budgets, and cancellation.
- `npm run test:allstar`: includes both new regression tests and regenerates the local-file carrier and portable build.
- Existing Chrome browser tests for coaching needs and executive history cover filters, date boundaries, saved settings, history, and exports.

The synthetic fixture has 96 people, 12 dated weeks, three rules, 204 findings, six coaches, and an executive email. It includes missing and zero values and eligible people without findings. The seven email HTML files are byte-identical to baseline commit `e317d2162dfe3a0a67a05a107c37928a524e2075` (261,713 bytes total).

On this development machine, seven warmed runs of preview markup plus all seven email HTML files had a median of 579 ms before and 244 ms after (about 58% less time). These synthetic measurements exclude browser layout/painting, workbook parsing, and ZIP compression, and do not predict a specific speedup for every workbook. Use `node apps/allstar/tests/qualtrics-generation-performance.test.js --benchmark` to measure the current fixture. The optional `--capture-baseline` mode reads the generator from Git HEAD; check out the baseline commit when collecting a before measurement.

Workbook parsing, identity/index preparation, the final DOM insertion, and each individual HTML render still contain synchronous work. Very large workbooks may therefore still have pauses. Open the generator with `?debug=1` to inspect the existing Generate Report stage timings when investigating real data.
