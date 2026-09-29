# All-Star Dated Stats

Dated Stats adds numerical measurements by representative and reporting period.
It is separate from the existing Non-Date database and Dated Items calculations.
Documented Coaching, Checklist, Comp Calls and QA keep their existing meanings,
including numerical QA scores. Existing definitions are not migrated.

## Workflow

1. In Import, use the Weekly Retail or Weekly Referral file picker. The shared
   Clean Upload route also supplies these sources. Both use the existing
   `weeklyRetail` and `weeklyReferral` dataset identifiers.
2. Open **Review calendar & field types**. Map the identity, assigned coach, date,
   optional manager and scope fields. Confirm whether the label begins a period,
   ends it, or is a publication date with an explicit offset to the period start.
   An unreviewed calendar cannot produce numerical results.
3. Review numerical types and units. Counts, percentages, durations, currency and
   other numbers are parsed separately. Numerical percentages require a declared
   fraction or percentage-point scale. For exports whose scale changes by date,
   choose **per-date** and declare the affected dates. Unknown dates are excluded;
   values are never converted by guessing their scale cell by cell.
4. Press **Categorize Data**. Review diagnostics for excluded summaries, ambiguous
   identities, invalid dates, invalid measurements and conflicting observations.
5. In Metrics, choose **Create Dated Stats Metric**. Save its measurement,
   aggregation, complete-period range, eligibility rules and output type.
6. In a Model, select **Dated Stats / Trend** and the saved metric. Choose an
   aggregate, qualifying-period count, trend summary or baseline/comparison
   change. New numerical criteria start as display-only. Scoring and the
   numerical value versus a meets-condition 1/0 result are explicit choices.
7. In Research, choose **Dated Stats Trends**. Select a reusable metric, population,
   membership mode and line grouping. Calculate, inspect point evidence, then save
   the definition and frozen result. Recalculation is an explicit action.

The same source configuration supports daily and monthly observations. Monthly
totals are never divided into invented weekly values. Before/after weekly
alignment requires an actual weekly source.

## Numerical definitions

| Measurement | Numerator | Denominator |
| --- | --- | --- |
| Cash / Consumer Opportunity Share | Consumer Opportunities | Consumer + Insurance + Commercial Opportunities |
| Cash / Consumer Appointment Rate | Consumer Appointments | Consumer Opportunities |
| Total Appointment Rate | Total Appointments | Total Opportunities |
| Insurance Appointment Rate | Insurance Appointments | Insurance Opportunities |
| Retail Wiper Rate | Wiper Count | Wiper Jobs |
| Referral Wiper Rate | Wipers Accept | Wipers Asked |

An equal-representative average first averages each representative's eligible
periods, then averages representatives equally. A combined rate divides the sum
of eligible numerators by the sum of their corresponding denominators. Thus 1/1
and 50/100 yield 75% and approximately 50.50%, respectively.

Totals are allowed for separate activity counts, not ordinary percentages,
snapshots or cumulative-to-date balances. Zero successes with a positive
denominator remain a valid zero. Missing, unavailable, suppressed, invalid and
conflicting values remain distinguishable from zero. Missing or zero denominators
cannot produce rates. Partial observations can support one metric while lacking
the components for another.

Raw spreadsheet values are retained independently of display formatting. The
recognized ACD duration uses Excel day fractions, normalized to seconds. Total
Opportunity Rate is an activity-to-call ratio and can exceed 100%; bounded
performance percentages retain percentage validation.

Expressions use `[Field]` references and arithmetic within one representative,
source, period and scope. Cross-source or undated inputs are not silently joined
into those expressions. A series cannot be used as a scalar comparison: select a
summary or a per-period rule. Trend rate differences use percentage points;
slopes use actual elapsed weeks; relative change from zero is undefined.

**Last reporting periods** includes calendar gaps. **Last valid periods per
representative** explicitly skips missing measurements. Minimum valid periods
are applied before numerical contributions; evidence explains exclusions.

## Import history and attribution

Direct weekly uploads merge history by source, representative, date and scope.
Repeated observations do not add activity. A correction replaces supplied fields
only, preserving other periods and unsupplied measurements, and records prior
values in the correction audit. Conflicting records inside one upload are
excluded until corrected. An unrelated later import does not resolve an older
conflict. Overlapping reporting intervals or scopes are excluded rather than
added together.

A refreshed shared weekly dataset is authoritative for its active selected
population; All-Star does not resurrect people excluded by Clean Upload. Source
data and categorized numerical snapshots use the existing IndexedDB storage.
All-Star JSON packages include the raw history, calendar, types and audit.

Assigned coaches come from each numerical observation. Saved aliases and the
Stats Directory resolve known labels; ambiguous roster identities are excluded
for review. Historical surname resolution is accepted only when unambiguous.
The person delivering coaching remains a separate event field. Where historical
manager membership is unavailable, Research labels its use of current saved
manager/organization membership.

## Research populations and evidence

- **Fixed group:** qualify representatives once in the anchor window. Keep that
  membership over time and show valid and missing counts at every point.
- **Changing group:** qualify membership again for each reporting period.
- **Before/after:** align to each representative's first qualifying session in the
  anchor range. The coaching week has mixed timing; Week +1 is the first complete
  subsequent week.

Populations can combine dated-item conditions, numerical conditions, a saved
model criterion as static context, representative selections, coaches, managers
and organizations. Event and numerical conditions keep independent date windows.
Overlapping organizations do not duplicate representatives. With selected
organizations and one line per coach, transfers cannot introduce coaches outside
that scope; those weeks remain excluded for fixed cohort members.

Coaching-frequency lines count sessions received, not distinct coaches. Choose
anchor, fixed, plotted-period or rolling coverage and increasing buckets such as
0, 1, 2, 3, 4+. A source event ID is preferred for deduplication; otherwise the
fallback uses source, representative, date, delivering coach and event text.
Separate tagged records should carry the same explicit session ID.

An observed session can establish an at-least threshold. Exact counts, upper
bounds and the zero-session bucket require reviewed complete coverage. Otherwise
frequency grouping is **Unknown coaching coverage**. Events are summarized before
joining performance: three matching sessions do not multiply appointments by
three.

Charts include searchable, isolatable lines, gaps for missing weeks, point counts,
components and clickable representative evidence. JSON export includes the
resolved calendar, metric, population rules, date windows, grouping, observations
and exclusions. Saved output remains frozen after source or definition changes.
Descriptions identify loaded eligible representatives; they do not imply a
company-wide population or a causal coaching effect.

## Compatibility and validation

The independent numerical engine is `apps/allstar/js/dated-stats.js`; adapters and
editors are in `dated-stats-workspace.js`. Existing rate-only metric-components
callers remain unchanged. Categorization stages complete results and retains the
previous result on failure. Source-specific invalidation reuses unaffected
fragments. Long operations yield and reject cancelled or superseded work.

Run `npm run test:allstar` for the numerical and existing All-Star regression
gates. The optional `npm run test:allstar:browser` also exercises real CSV upload,
calendar review, manual categorization, Metrics, Model trends, Research evidence,
export and frozen-result reopen in both modular and portable builds. It accepts
the existing `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` environment settings.

Tests use synthetic people and measurements. The supplied full Retail and
Referral files were additionally exercised through the actual importer, typed
categorization and numerical Research path. Calendar assumptions used for that
validation are test settings, not confirmation of the exports' reporting meaning.
Mixed percentage scales and repeated Referral header rows were detected; raw
wiper components reconciled with the combined rate. Source files are not checked
into this repository.
