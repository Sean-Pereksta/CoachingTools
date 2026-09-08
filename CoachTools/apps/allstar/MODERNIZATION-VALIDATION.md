# All-Star / Qualtrics modernization validation

Base commit: `053f1670b925a4701bc2e861905d36ab9cb481c6`.

## Implemented

- Main Qualtrics navigation follows key files, report files, rules, Action Report, and Individual Messages. The four analytical tabs are removed from the main navigation; shared analysis and contextual evidence remain available.
- Rule browsing uses a taller bounded workspace, search across rule content, Individual enabled/disabled and outcome filters, active counts, retained scroll position, and 100-card incremental rendering. Existing complete editors remain in place.
- Ruleset status distinguishes no attachment, changed content, current snapshot, and import errors. JSON import/export provides the reference snapshot. Local IndexedDB auto-save does not claim to overwrite a disk file. The new settings record is metadata only.
- Recognized dashboard uploads select their matching rule and file. Known core-file uploads select explicitly associated rules. Multiple filename matches are flagged instead of selecting the first match silently. Manual selection and source preflight remain available.
- New message settings default to one concern and two strengths. Existing saved limits and legacy unlimited settings are preserved. Ranking, thresholds, matching, and qualification counts retain the existing engine.
- Individual review defaults to a searchable representative list and a four-section email preview. Detailed cards and diagnostics remain available. The preview and final workbook use the same rendered-content helper, including generic-message placement.
- Final Email Export produces one sheet with exactly `Name`, `Email`, `Header`, `Concern Areas`, `Strengths`, and `Footer`. Only current send-ready results are exported. Existing review/diagnostic and EML exports remain separate.
- Action Report gains section search and navigation without reevaluation. Report generation computes coaching impact before a single report render instead of rendering the report twice. Three hidden analytics views no longer render eagerly.
- Superseded All-Star bridge conversions stop at a batch boundary, and abandoned requests cannot clear a newer request's pending signature.
- Portable bundling includes the new workflow helper and refreshes the generated carrier. Existing storage keys and schemas are unchanged.

## Automated results

`npm --offline run test:allstar` passes, including portable generation, package/script validation, insights, concern history, Individual Messages, scoped review, and the new workflow tests.

The workflow tests exercise source auto-selection, ambiguity, manual deselection, preflight missing fields, default and saved limits, unchanged qualification counts, shared-message placement, actual XLSX serialization and readback, six-column/one-sheet export, blocked and stale export exclusion, ruleset transitions, edited-rule search invalidation, navigation removal, and bridge cancellation.

`git diff --check` passes.

Broader repository failures reproduce on an untouched worktree at the base commit:

- `npm test` stops at a duplicate `kpi-impact` application ID in `apps/kpi-impact-galactic.html` and `apps/kpi-impact.html`.
- `validate-suite` reports that duplicate plus five missing capability/adapter/classifier markers in the KPI Impact application; it also warns about the pre-existing missing `icons/all-apps.png`.
- `test:desktop` reaches an existing `identity-profile-sync.test.js:126` assertion failure (`NaN !== 1.5`). The isolated test reproduces at the base commit.

## Synthetic performance measurement

Run from the repository root:

```sh
node CoachTools/apps/allstar/tests/qualtrics-workflow-benchmark.js 053f1670b925a4701bc2e861905d36ab9cb481c6
```

Fixture: 1,000 saved rules; 12 searches matching all rules; actual generator functions executed with a minimal DOM stub. One measured run:

| Measurement | Base | Changed |
| --- | ---: | ---: |
| Median search and card-construction execution | 20.75 ms | 1.42 ms |
| Rule normalizations across 12 searches | 12,000 | 0 |
| Eager hidden analytical view renders | 3 | 0 |

The card limit and removal of repeated normalization reduce actual work. These are synthetic Node execution timings, not browser paint, full startup, or production workbook benchmarks. Repeated runs vary with warmup and host load.

## Remaining validation before merge

No operational workbooks or browser executable were available in this environment. The following requested end-to-end checks have not been measured or visually verified:

- Cold/restored All-Star startup and large source-file ingestion with representative operational data.
- Embedded and standalone browser layout, small-screen usability, and file:// interaction.
- Real-workbook timings for opening Qualtrics, switching to Rules, running the Action Report and Individual Review, selecting representatives, and final export.
- Side-by-side business-result comparison of a complete operational All-Star run before and after this change. Automated evaluation regressions pass; this is not a claim that a production dataset comparison has been performed.

Existing startup and report performance instrumentation remains available. Keep the PR in draft until these environment-dependent checks are completed. The checksum status observes the last imported/exported snapshot; browsers do not watch externally edited files automatically. Source preflight is advisory; per-person metrics, variable replacement, roster ambiguity and send readiness are still validated by the existing review engine.
