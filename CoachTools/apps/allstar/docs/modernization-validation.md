# All-Star modernization — implementation and validation

This change extends the existing classic-script application. Existing
storage keys, database stores, calculation modes, source upload/categorization
contracts, Qualtrics workflows, and report/export entry points remain in place.

## What is implemented

| Area | Implementation |
| --- | --- |
| Calculation reuse | Shared bounded derived cache; dependency-specific source/model/criterion keys; reusable model plans, numeric values, filter predicates and criterion results; single-pass numerical aggregates; unchanged legacy scoring. |
| Research reuse | Source, population, filter, join and result-stage reuse; referenced model/metric dependencies; separate visual settings; bounded row budgets; cancellation and stale-job protection; worker failure falls back to sliced processing. |
| Research workspace | Guided/Advanced modes, grouped searchable fields, formula construction, new optional metric aggregates, metadata, extra filter operators, reusable filter sets, undo/redo, recoverable draft, save status, duplicate, health and diagnostics. |
| Charts | Independent definitions; line, multiline, bar, grouped bar, stacked bar, area, scatter, bubble, histogram, combo; appearance controls; targets, averages, trends, moving averages, cumulative and previous-point transforms; legends, isolation, date range, underlying groups, exports. |
| Analysis board | Saved charts plus pinned chart/table/KPI cards, reordering, retained layouts, source snapshot resolution without triggering Research. |
| Comparison | A/B selection of calculated result groups, sample counts, mean, median, dispersion, difference, percent difference, overlap warning and common-bin distributions. Existing metric cohorts and cross-source Research remain available. |
| Models | Overview/source/criteria/scoring/display/filter/preview/health navigation; searchable and reorderable criteria; plain-language explanations; explicit isolated sample preview; saved model criterion handoff to Research. |
| Navigation | Home, Data, Models, Research, Reports, Organizations, Messages, History, Settings; preserved All tools toolbar; Ctrl/Cmd+K palette; contextual search, recents, favorites and performance diagnostics. |
| Offline packaging | Classic script order preserved; all new scripts/styles bundled; no required server/CDN; vendor insertion uses literal replacement callbacks to prevent dollar-sequence corruption. |

Two calculation defects discovered during integration were corrected: indexed
Research date boundaries now match local date-only filtering, and model references
use the Model Runner's canonical representative keys. These fixes prevent missing
first-day rows and missing model values; regression fixtures make the differences
explicit rather than silently accepting changed output.

## Automated gates

Run from `CoachTools`:

```sh
TZ=UTC npm run test:allstar
TZ=UTC npm run benchmark:allstar
npm run test:allstar:browser
```

The browser gate optionally accepts `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` for a
local installation. No browser screenshots or HTML previews are generated.

The All-Star gate includes the portable builder, bundle verification (including
actual bundled vendor JavaScript parsing), import replacement/rollback at 51,248
rows, parser routing, Qualtrics/Individual Review regression suites, and new
analysis/Research/chart/navigation/model-workspace tests. Compatibility fixtures
exercise literal points/ranks/ties/zeros/display outputs, source-selective
invalidation, model edits and indirect source dependencies, inclusive dates,
strict/fallback/ambiguous joins, legacy definitions and IDs, and actual IndexedDB
source/result reopening. Existing manual regression suites are also executed.

Chromium 153 checks both modular and portable `file://` launches, completed startup,
keyboard command navigation, model search, a real Research calculation, appearance
changes with no new calculation/projection, chart save/pin/board, editor undo, and a
600-pixel window. The final run must contain no uncaught page errors.

## Interpretation and remaining validation boundaries

- A/B statistics use **calculated Research groups**, explicitly labeled in the UI.
  They must not be interpreted as raw-call statistics unless the Research grain
  produces one row per call. Cohorts use the existing Research population/metric
  controls to define the underlying population.
- Moving/previous-period transforms operate on the displayed ordered points.
  A missing calendar period is not silently fabricated. Histogram/compare exports
  retain their calculation context. Relative changes with zero denominator are
  missing, not infinity.
- Sample model preview ranks refer to at most 30 sampled representatives/teams;
  the preview does not claim to be the full population or replace a report.
- Saved charts and board cards use saved Research snapshots until an explicit
  refresh. They do not launch heavy calculations when opened. Unsupported storage
  versions and unavailable group/column references are shown without wiping data.
- Synthetic benchmarks isolate numerical, indexing, model, Research and cache
  work in Node with a DOM harness. They are not measurements of real workbook
  parsing, physical browser paint, PDF generation, or a user's production hardware.
  Real operational workbooks and managed Edge policies still need acceptance testing.
- The suite-wide `npm test` gate has pre-existing failures outside All-Star:
  duplicate `kpi-impact` application IDs and missing KPI Impact capability markers;
  profile/coaching fixtures with August dates fail under the September wall clock.
  These files are unchanged by this PR. `TZ=UTC` avoids the separate existing
  Qualtrics local-midnight-to-ISO fixture sensitivity.

## Performance measurements

See `modernization-benchmark.jsonl` for the measured 10,000 / 50,000 / 150,000 row
fixtures (two sources each), before/after isolated numerical aggregation parity,
cold/warm calculations, cache sizes, and observed event-loop delay. Cold operations
remain workload-dependent; cache-hit timings are not presented as cold throughput.

Final measured run (Node 24, two sources, 500 representatives):

| Rows per source | Legacy numeric loop | New numeric loop | Model cold / warm | Research cold / warm | Appearance cache | Cross-source Research |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 1.92 s | 138 ms | 518 / 298 ms | 105 / 3.18 ms | 2.78 ms | 0.60 s |
| 50,000 | 8.77 s | 233 ms | 694 / 273 ms | 375 / 2.53 ms | 2.49 ms | 2.73 s |
| 150,000 | 26.32 s | 429 ms | 1040 / 273 ms | 1068 / 2.76 ms | 2.56 ms | 8.04 s |

The numeric comparison executes the prior pair-allocation/date-parsing loop and
new single-pass reader against identical indexed inputs and asserts exact output
parity. It isolates numerical aggregation; it is not an overall application speedup.
The final 150k run recorded 18.8 MB in the bounded shared derived cache. Node heap
measurements include sources, other existing indexes, temporary objects and GC
behavior, so they are recorded separately rather than equated to cache size.

Cold work remains measurable: the 150k two-source index build took 13.6 seconds in
responsive slices, and cross-source Research took 8.0 seconds. Maximum observed
modern event-loop delay was 344 ms (indexing); basic Research was 27 ms and the
cross-source stage 86 ms. Filtering still had a 328 ms longest task in this harness.
The frozen legacy numerical baseline is excluded from these delay measurements.
This substantially reduces the prior multi-second cold tasks, but is not a claim
that every advanced expression or browser/workbook combination is free of long tasks.
