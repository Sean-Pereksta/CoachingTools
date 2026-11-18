# Common coaching workflows preview

This preview was measured against commit [23103f3](https://github.com/Sean-Pereksta/CoachingTools/commit/23103f3453ba3af5b05a1486b8f84994ea277bba). Use a copy of the suite to try it. The Windows launcher, local server, individual HTML entry points and generated Allstar portable file are included in the suite package.

## Opening the workflows

| Job | Entry point and behavior |
| --- | --- |
| Review Allstar data | Open **Update Data → Batch review layout**. Select or drop files, expand a file to examine its source, sheet, sample or missing fields, then import the ready files. An unsuccessful file can be replaced or retried independently. **Categorize Data** runs on request. The layout button restores the previous view. |
| Run a saved report | Open **Run → Focused report view** for the model, dates, scope and readiness. **Recent runs** opens saved results individually, including the settings to rerun them on current data. **Report options** contains the previous scoring and display controls. Clear the checkbox to restore those controls to the setup screen. |
| Understand a model rule | Open the model editor, enable **Rule library view**, select a criterion and choose **Test rule**. Inspect the resolved source field, counts, result and evidence. The sample and exact options use the report evaluator. |
| Make Qualtrics email files | Open **Messages / Qualtrics → Try guided workflow**. Add the four key files together, review or test the rules, then open **Review & Generate**. A completed review can be downloaded again. Recording its appearances in History is a separate action. **Use classic workflow** restores the numbered navigation. |
| Ask a Research question | Choose **New Research** or **Start Research** on Home. Select a question, source and measure, then review the suggested chart and its evidence. The **Saved library** view supports opening a frozen result, while existing items can still open in their earlier editors. |

The large-import storage option is independent of the Data layout. **Use background saving for large imports** starts off. Either writer stores the same source, worksheet and metadata records. Turning it off takes effect on the next eligible import. The staged on-disk format below is an isolated experiment.

## Test conditions

All inputs were synthetic. Both revisions ran on the same Windows machine with an AMD Ryzen 7 5825U, 16 logical processors, 13.84 GiB of visible RAM, a WD PC SN5000S NVMe drive and Windows build 26200. The browsers were Chrome 157.0.8103.52 and Edge 157.0.4341.60. The Node/DOM measurements used Node 24.19.0. Browser timing tables show observed p50 / p95 with nearest-rank percentiles. At three or five trials, p95 is the slowest observation. Timing ends and cache conditions differ by job and are specified below.

### Allstar import

Five fresh Chrome profiles per entry point each performed an initial import and a replacement of 50,000 QA rows, five columns and 44 coaches. The timer runs from import through verified save and a final 20 ms heartbeat window. **Gap** is the longest interval between 16 ms main-thread heartbeats in each trial. Both entry points in this table used offline file URLs.

| Entry and data state | Baseline wall, ms | Compatible writer wall, ms | Background writer wall, ms | Baseline gap, ms | Compatible gap, ms | Background gap, ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Modular, initial | 1,855 / 2,050 | 1,837 / 1,865 | 2,173 / 2,497 | 291 / 424 | 314 / 346 | 34 / 36 |
| Modular, replacement | 1,791 / 3,213 | 1,665 / 1,907 | 2,071 / 2,957 | 282 / 494 | 259 / 266 | 28 / 38 |
| Portable, initial | 1,775 / 1,846 | 1,782 / 1,981 | 2,224 / 2,773 | 309 / 326 | 322 / 362 | 33 / 42 |
| Portable, replacement | 1,678 / 1,873 | 1,685 / 2,197 | 2,046 / 2,250 | 268 / 294 | 245 / 315 | 28 / 30 |

The background writer meets the 100 ms pause target on these trials and misses the median wall-time target. Canceling during a replacement preserved the previous file and its rows after reopening. The worker recovery test also interrupts the write before commit and loses the acknowledgement after a successful commit, then checks which file actually survived.

Ten Update Data renders on the 270,000-row navigation fixture performed zero row reads, roster rebuilds or monthly bundle compilations. The 24,000-row browser fixture checked selected representatives, two different coaches, all people and reload in the served app and portable file. Initial shared-data synchronization still produced heartbeat gaps above 100 ms on both paths.

Five paired tests of an alternative on-disk format compared whole records with 305 acknowledged chunks capped at 256 KiB each. Both formats read back the full normalized QA source and its two worksheet arrays and verified a matching SHA-256 digest. Whole-record save p50 / p95 was 1,334 / 1,764 ms. Chunked save was 1,667 / 2,185 ms. The largest observed gap fell from 710 to 25 ms and sampled peak JavaScript heap p95 from 289 to 227 MiB. The test exercises interrupted and corrupt writes, real Chrome quota exhaustion and orphan cleanup. The production package keeps the compatible disk format.

### Reports and Research

| Fixture and timing boundary | Pinned p50 / p95 | Preview p50 / p95 |
| --- | ---: | ---: |
| Report, first run to painted result | 684 / 1,066 ms | 178 / 187 ms |
| Report, warm rerun to painted result | 498 / 779 ms | 40 / 44 ms |
| Cross-source Research, cold indexes | 18.288 / 28.392 s | 7.686 / 10.230 s |
| Cross-source Research, cold calculation after indexing | 25.599 / 28.733 s | 1.886 / 3.478 s |
| Dated Research, categorization | 83 / 107 ms | 86 / 89 ms |
| Dated Research, two weighted metrics after categorization | 162 / 189 ms | 77 / 103 ms |

The report used five fresh Chrome profiles, 10 teams, 250 representatives, 2,500 rows and four scoring criteria. Timing ended on the second animation frame after the results appeared. Scores matched. The model-rule fixture tests Description and Coaching Type with three system columns before the person column. Export tests exercise the saved full report independently of visible table pages.

Cross-source Research used three alternating pairs of fresh processes, two sources with 150,000 rows each and 500 representatives. Values, totals, population and join diagnostics produced the same hash in all six processes. Dated Research used seven measurements per revision, 561 representatives, 12 weeks, 23 coaches and two weighted measures. The point numerator and denominator hashes matched. These two Research timings exclude browser paint, storage and workbook parsing.

With 75 saved definitions and a five-group result over 1,000 rows, 12 Chrome trials measured saved-list open at 33.3 / 34.2 ms and frozen-result open at 50.0 / 51.1 ms, including two animation frames. Both operations made zero raw-source reads. A separate Chrome test exercised distinct coaching sessions against weekly performance with aligned representative and period keys, confirmed zeros, excluded ambiguous records and a full paired CSV. Legacy snapshots lacking matching scope or identity evidence open as independent summaries. Cold browser time to first paint for dated and dynamic calculations remains unmeasured.

### Qualtrics

The intake timer starts with prepared local files and ends after all four slots are ready and the browser paints. The small fixture has four single-sheet XLSX files of 500 rows each. The wide fixture has four XLSX files totaling 8 MiB, two sheets per file, 2,000 rows per file and 32 extra fields. Five warm runs followed the cold load. The ZIP timing used seven warm outputs for an existing review. Seeded history contains 50,000 appearances across 500 people.

| Chrome standalone file workflow | Pinned p50 / p95, ms | Preview p50 / p95, ms |
| --- | ---: | ---: |
| Small four-file intake, warm | 215 / 233 | 145 / 158 |
| Wide four-file intake, warm | 2,810 / 3,674 | 1,858 / 4,477 |
| Wide intake, largest heartbeat gap per run | 362 / 502 | 116 / 166 |
| Reopen history to first counts page | 762 / 778 | 124 / 145 |
| First page of dated appearances | — | 14 / 15 |

The small four-file cold load took 315 ms on the pinned build and 190 ms on the preview. Wide cold intake took 3,266 and 1,732 ms respectively. The wide warm p95 and maximum-pause targets remain open. A short isolated preview trace was faster but did not supply a paired baseline. Seven fixed HTML fixtures retained identical hashes. The browser tests cover zero and percentage values, Unicode and multiline text, conflicting slot assignments, scoped transfer revisions, repeat downloads and once-per-run recording.

After moving MIME and ZIP packaging to a worker, a separate three-trial comparison of a current review with 300 findings, ten coaches and optional Executive History measured 798 / 815 ms on baseline and 181 / 182 ms on this preview. One cold run including evaluation took 898 ms and 935 ms respectively. The worker and forced fallback produced byte-identical ZIPs at a fixed clock and MIME boundary, including embedded charts and Individual emails. Standalone Qualtrics and both embedded Allstar entry points exercised the worker offline.

In a fresh browser for each mode, the same four wide files were loaded and replaced twice. Worker times were 852, 801 and 804 ms with maximum heartbeat gaps of 92, 71 and 74 ms. Forced fallback times were 1,010, 1,048 and 1,014 ms with gaps of 151, 156 and 124 ms. Each slot retained its 2,000 rows. Sampled JavaScript heap peaked at 137.7 MiB for the main and worker isolates together and at 123.6 MiB for fallback. Samples taken approximately every 50 ms exclude native allocations and may miss short-lived peaks.

### Completing tasks from the interface

Five alternating Edge runs used the same small synthetic files and saved definitions in both builds. Each file chooser submission counts as one action. The timer includes browser interaction, actionability checks and two animation frames after completion. Native file browsing and human reading time are excluded. Enabling the guided Qualtrics mode once added one action and 71 / 74 ms.

| Task | Actions, pinned → preview | Pinned p50 / p95, ms | Preview p50 / p95, ms |
| --- | ---: | ---: | ---: |
| Four one-row key files to ready | 4 → 2 | 111 / 125 | 233 / 282 |
| Open Rules and test a saved rule | 2 → 2 | 384 / 440 | 384 / 419 |
| Open Review and evaluate | 2 → 2 | 382 / 399 | 367 / 383 |
| Download current ZIP | 1 → 1 | 268 / 376 | 242 / 320 |
| Open warm report setup | 1 → 1 | 125 / 175 | 69 / 187 |
| Open Recent runs | 1 → 1 | 101 / 151 | 142 / 150 |
| Restore settings and rerun a saved report from Home | 7 → 4 | 278 / 347 | 364 / 425 |
| Save an undated comparison | 9 → 7 | 563 / 644 | 653 / 659 |
| Save a dated comparison | 12 → 9 | 1,333 / 1,417 | 551 / 601 |

Canceling a staged Qualtrics batch took 84 ms p95 to a painted completion. A second five-pair run timed the first painted status after each control. Preview p95 was 21 ms for key-file submission, 29 ms for Test rule, 30 ms for Generate ZIP and 29 ms for Cancel. On the 24-representative, two-team report fixture, preparation, scoring, rendering and saving took 4, 5, 1 and 10 ms p95 respectively.

The small-file, report-rerun and undated-comparison paths used fewer actions and took longer end to end in these trials. The baseline report task re-entered the known settings. The Research task explicitly saved the definition, ran it and opened the result. Dated comparisons preserved both inclusive boundaries. The separate report calculation benchmark above measures the heavier workload after the user supplies the settings.

## Reproduction

Run the following from the CoachTools directory. Browser scripts accept `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` to select the local Playwright module and installed Chrome or Edge executable. Build both revisions before comparing portable files.

```text
npm run test:allstar
npm run test:prefetch
npm run test:allstar:browser
npm run test:executive-history:browser
npm run manifest:check
npm run validate-suite
npm run package-suite
node apps/allstar/tests/verify-package.js
```

The dedicated benchmarks live in `apps/allstar/tests`.

- `browser-import-performance.test.js` accepts `ALLSTAR_BENCHMARK_PAIRS=5`, an alternate app directory in `ALLSTAR_BENCHMARK_ROOT`, and `ALLSTAR_BACKGROUND_SAVE=1` for the optional writer.
- `browser-storage-prototype.test.js` runs the isolated on-disk experiment and fault tests. `browser-storage-recovery.test.js` tests the shipped background writer.
- `report-browser-benchmark.js` accepts the baseline Allstar HTML path. `qualtrics-release-benchmark.js` accepts the baseline CoachTools directory and optional `--wide`.
- `research-cross-source-benchmark.js` accepts the baseline and preview Allstar directories and repetition count. `research-dated-benchmark.js` accepts the same two directories.
- `browser-workflow-timing.js` accepts the baseline Allstar directory. It counts actual browser actions for file intake, rules, report reruns and Research comparisons. It records painted feedback and completion times without operator reading time.

## Release limits

The combined import speed and responsiveness gate and the wide Qualtrics intake gate remain open. The measurements cover synthetic files on one machine. End-to-end timings across every launch route, operator studies with representative workbooks, peak native process memory and visual equivalence of every legacy PDF still need validation. Edge exercised the Windows launcher, offline desktop shortcut, both Allstar entry points and standalone Qualtrics. Desktop checks covered keyboard navigation, narrow layouts, real report PDF downloads and persisted results after reopening.

On the pinned revision, the weekly Research picker and a weekly edit after reload failed in the browser tests. An intermittent portable startup error involving `selectiveResearchInvalidation` also appeared. One earlier preview run reproduced that error, followed by ten successful fresh Edge launches. Keep these observations separate from performance timings.
