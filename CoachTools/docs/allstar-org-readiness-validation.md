# Organizations research readiness and workspace styling

Organizations now has a searchable sidebar, Members / Research Readiness tabs,
current unique-representative coverage, and six health cards that open affected
coaches and organizations. Overlap is informational. Membership actions keep the
existing persistence and apply only to the selected organization. On narrow
windows the selected organization and Save action remain in the modal header and
footer while the workspace stacks.

Check Research Setup is explicit. Opening Organizations or changing selection
never evaluates Research. Source declarations and comparison intent are stored
under `allStar.orgReadiness.v1`, separately from Research, models and mappings.
They do not change calculations. Saved definitions, exports, rendered results,
roster assignments and existing non-Org handlers are not rewritten.

The optional inspection callbacks in `buildQueryPlan`,
`prepareResearchPopulation`, `evaluateResearchItemWorkAsync`, and the existing
aggregate-reference parser expose the actual preparation and values. The Org
scope intersects the saved population with the current team-index membership.
Diagnostic runs bypass shared result/population writes; their cohort signatures
are isolated so scoped rows cannot contaminate normal Research caches.

The audit covers dated / missing / invalid records, known monthly periods,
user-declared static or period sources, source matching, ambiguous identities,
team fallback, repeated records, expression inputs and aggregation, percentage
units, literal condition grouping, population stages and representative examples.
Missing evidence is never automatically described as no activity. An optional
completeness declaration must cover all organization members and the full window
before absent dated evidence can receive that description.

Numeric zero is not sufficient for Ready. Missing/invalid inputs and denominator
failures block reliability. Supported zero-valued inputs and a valid population
with no qualifying representatives are retained as legitimate zeros. All groups
are checked for input problems; only eight group explanations and eight
representative examples (plus up to four missing roster matches) are displayed.

Model criteria expose their existing entry-level values and whether those values
are representative or team results. Their source matching counts do not certify
complete model input lineage; that limitation always receives Needs attention.
Conversation outputs use a separate raw-row display path and cannot receive a
clean certification from this aggregate preparation audit.

## Existing calculation behavior documented, not changed

1. **Cross-source Retail/Referral dates.** Primary Retail rows for Alice are in
   August 2–8. Referenced Referral rows for Alice have Extra=3 on August 3 and
   Extra=6 on August 31. With the Research window August 2–8,
   `sum(![referral_sv2].[Extra])` returns 9: `researchRowsForCohort` delegates to
   `filterRowsForSource`, whose Retail/Referral fallback retains both rows. The
   new test reproduces this and requires a blocking audit explanation.
2. **Cross-source date buckets.** Matching uses the item's global date range,
   not each group's date bucket. The same joined totals can therefore appear in
   multiple date groups. The readiness view blocks certification of that
   interpretation; it does not silently distribute or rewrite those totals.
3. **Negative conditions.** `guidedConditionMatchesRows` can match not_contains,
   not_equals, is_blank or an at-most count when related records are absent.
   The audit exposes the engine match and distinguishes unavailable evidence.
4. **Metric AND/OR.** `metricRows` always requires its AND rules. OR rules expand
   the field-selected population but do not implement general `(A AND B) OR C`.
   The explanation states that behavior instead of inventing conventional SQL
   precedence. Guided conditions, separately, fold left with explicit parentheses.
5. **Percentage units.** `toNum('40%')` is 40 and `toNum(0.40)` is 0.40. Display
   formatting has existing magnitude-dependent percentage behavior. The audit
   displays raw and formatted values and flags mixed fractional / percent-string
   inputs; it does not rewrite values or formulas.

## Appearance scope

`workspace-polish.css` is screen-only and scoped to existing modal IDs: Research,
Research editor, Metrics, metric editor, Model list/editor, Import, Troubleshoot,
Teams, Roster Reassignment, Run, PDF Options, List Tester and details. It changes
spacing, borders, field sizing, focus visibility, formulas, lists and tables.
Outside the Org markup and its new dependencies, `allstar.html` is unchanged.
Generated report / print selectors and existing workflow handlers are untouched.

## Verification

- `TZ=UTC npm run test:allstar`: passed, including portable build and package
  verification, import/lifecycle and all modernization compatibility tests.
- `organization-readiness.test.js`: passed using real classic-script functions
  and DOM. Covers same inputs before/after inspection; ratio inputs and display;
  valid zero / missing / denominator cases; monthly-versus-weekly / static /
  unknown coverage; missing and invalid dates; same-record versus cross-record
  conditions; AND/OR parentheses; unmatched/ambiguous joins; repeated records;
  the cross-source date defect; on-demand UI, cancellation, separate settings,
  invalidation, create/import, overlap, and health details.
- Syntax checks and `git diff --check`: passed.
- Browser layout and before/after screenshots: **not verified in this environment**.
  No Chromium executable is installed. Playwright's browser download returned a
  truncated/non-ZIP response. No substitute screenshots or HTML previews were made.
- Manual follow-up: inspect every styled dialog with long names/formulas, many
  conditions, large lists, and keyboard navigation at 1280, 750 and 480 pixels.
  Check focus clipping around sticky headers/footers and nested scrolling.
  Actual workbook import/export and native browser downloads were not exercised
  interactively in this change; their existing automated regression gates passed.

With Playwright / Chromium installed, build portable and run:

```sh
npm run test:allstar
node apps/allstar/tests/browser-organization-readiness.test.js
npm run test:allstar:browser
```

Optional environment variables: `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`,
`ORG_READINESS_SCREENSHOT_DIR`, and `BASELINE_ALLSTAR_ROOT` (a checkout of the base
commit's `CoachTools/apps/allstar` directory for before shots). The new browser
gate checks Org workflows, modular/portable loading, no automatic calculation,
responsive containment and captures PNGs. It is provided but remains unexecuted
until Chromium is available. Screenshots of the other dialogs require the manual
follow-up above; they are not claimed as completed.
