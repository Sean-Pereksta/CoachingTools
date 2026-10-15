# All-Star monthly Opportunity, Wiper and Metrics workflow

Use Upload Retail monthly exports or Upload Referral monthly exports, then select
one Opportunity export and one or more Wiper exports for Retail. Referral can
save Wiper exports alone: representative names and coaches in those files build
its roster, with no Opportunity or Manager data required. Appointments and
opportunities remain unavailable (N/A), while Wiper counts and rates work in
representative, coach and manager-group reports. Valid Wiper-only Referral data
does not become partial just because optional Opportunity data is absent. The
Category selector beside Add Opportunity / Wiper files keeps separate file lists
and unsaved drafts for Retail and Referral. Save applies only the selected category.
The same representative, coach or report label can appear in both categories;
duplicate detection and conflicting-overlap checks run within each category.
Explicit categories retain all imported teams in the chosen category, including
Wiper-only activity, regardless of Consumer opportunity share.

Clean Upload and Update Data also expose the Category selector. Combined exports
with automatic team assignments remain available from the combined upload option.
An earlier combined bundle stays available in that mode and in Data Settings;
starting a separate category uses a fresh file list unless it already has its own
saved category bundle. Existing committed data is kept until the new save succeeds.
All routes use the shared parser,
review and compiler. Review representatives, coaches, manager mappings, totals,
coverage labels and exceptions, then save once. Cancel or a failed verified save
leaves the previous committed data intact. Legacy monthly workbooks and older
monthly bundles retain their supported paths.

## Source hierarchy and totals

The Opportunity importer recognizes the three-row segment header and leading
Manager → Coach → Representative → Fiscal Period hierarchy, as well as the old
Coach → Representative → Fiscal Period layout. Column names qualify segment
measures, including additional numeric fields such as SMS, Email and ITAC.
UTF-16 LE/BE tab-delimited exports and UTF-8 CSV are supported directly.

Grand, manager and coach total rows are separated from representative detail.
Full coach and manager views use exported Opportunity counts. Detail sums remain
available for reconciliation. Reporting appointment rates use available numerator
and denominator counts; exported rates remain in source records for comparison.
Differences beyond the export's one-decimal display rounding are flagged.

Filtered representative totals are recalculated from included detail. Manager
Retail/Referral views sum the selected coaches' count totals. Missing exported
subtotals use calculated counts. Reviews and reports distinguish Exported total,
Calculated total and Filtered total. Summary rows never become representatives.

For combined uploads with automatic team assignments, coach area uses Consumer opportunities divided by Commercial + Consumer +
Insurance opportunities. Exactly 15% and higher is Retail. Below 15% is Referral.
Classification uses the unrounded aggregate ratio. Every team that does not meet
the Retail rule is Referral, including missing or zero denominators and Wiper-only
teams without Opportunity data. Missing counts remain unavailable in calculations;
the Referral fallback does not turn them into zeros. A manager may oversee coaches in both areas.
Cash Opportunity Share and Cash Appointment Rate are separate measures.

## Wiper assignment and reconciliation

The new Wiper headers include REPORT DATE, EMPLOYEE_IMMEDIATE_SUPERVISOR_NAME,
EMPLOYEE_FULL_NAME, COUNT_WIPERS_ACCEPTED and COUNT_WIPERS_OFFERED. Earlier accepted
and offered header names remain supported.

Wiper activity belongs to the coach on its own source row. Transfers retain
separate coach contributions. Wiper-only representatives remain included;
missing Opportunity fields remain unavailable. Blank representative names with
valid counts remain Unattributed Representative activity and are excluded from
representative rankings. An Opportunity representative with no activity displays
No Wiper Data, not 0%.

All included report groups are summed by default. Original Opportunity period
labels and Wiper report labels remain separately visible; neither implies that
the two sources cover the same dates. Optional source-group exclusions remain in
the review. Wiper subtotal and grand-total records reconcile detail; they are
never added to it.

Coach → Manager mapping comes from Opportunity. Missing or conflicting mappings
place Wiper counts in Unassigned Manager. Manager assignment is optional: a coach
is sufficient to assign activity, save monthly data and run coach/representative
reports. Missing managers never block save or report runs. Mapped manager counts plus unassigned
counts equal overall included Wiper counts. Missing representative coverage is
shown at manager level. All Wiper rates use summed accepted / offered counts.
Repeated Opportunity detail with identical counts is counted once even when only
its optional manager differs. Conflicting managers remain a warning; conflicting
performance counts still require correction.

Identical file content is ignored even after renaming. Identical overlapping
named contributions are counted once. Conflicting overlaps block save until the
reviewer chooses a source replacement or excludes a row with a recorded reason.
Unattributed overlaps across different files also require explicit resolution.
Corrected Opportunity snapshots replace the selected Opportunity source; a new
reporting scope resets associated Wipers. Corrected Wiper full exports can replace
a selected prior file using the existing file-correction control.

## Manager reports and field discovery

Import review provides manager, area and coach filters. The Manager report button
opens a saved-snapshot report with manager → coach → representative drill-down,
all imported Opportunity measures, Wiper counts and rates, total provenance and
coverage. Separate snapshots remain selectable rather than silently combined.

Metrics and Research expose Monthly Opportunity — All Areas and Monthly Wipers —
All Areas, including unresolved records. Imported Manager and Area fields support
filtering/grouping. Mixed bundles stored in both monthly areas are deduplicated;
independent Retail and Referral records remain separate even with identical sources.
Wiper-only Referral records appear in Monthly Wipers — All Areas; they do not
create Opportunity records in Monthly Opportunity — All Areas. Later Wiper files
remain additive, and adding an optional Opportunity file keeps existing Wipers.
Additional segment-qualified fields become available automatically. Previously
loaded independent ITAC data remains stored separately, with a visible warning
that its coverage has not been confirmed for the new Opportunity snapshot; it is
not copied into new representative performance.

## Combined SMS and other rate metrics

Choose Average selected fields in Metrics, or use the Average of Segment SMS
Rates preset. Select the Insurance, Commercial and Consumer SMS rate fields.
Exclude zero values and Exclude blank or missing values are separate controls.
Exclusions apply to components. Missing values count as zero only when that
explicit option is selected. If missing exclusion is off and missing-as-zero is
off, a missing component makes the representative result unavailable. Invalid,
suppressed and conflicting values retain their reasons and are never converted
to valid zero performance.

Each representative's eligible component average is calculated first. Coach and
manager results average eligible representative results, rather than coach
averages. Duplicate source rows do not add weight. Conflicting repeated component
values remain unavailable until their reporting scope is resolved. Name-only
identities appearing under multiple coaches are flagged as ambiguous; filter to
one coach or supply a reliable employee identity rather than merging by name.

The preview shows results, grouping, coverage, included/excluded components and
reasons. Imported metadata normalizes percentages to percentage points once.
For fields without metadata, the editor explicitly selects fractions or
percentage points. Settings survive edit, duplicate, export/import and reload;
source, mapping, filter and definition changes invalidate result caches.

Pooled rate — explicit success / eligible counts is a separate calculation. Its
numerator and denominator are explicitly selected fields or expressions. General
Opportunity counts are never substituted for SMS eligibility. A missing/zero
pooled denominator produces N/A.

## Validation

`npm run test:allstar` includes `monthly-hierarchy.test.js`, using synthetic
fixtures only. It covers subtotal separation, exported-total discrepancies,
exact 15%, multi-date and transferred Wipers, unmatched/unattributed counts,
manager reconciliation, corrected snapshots, overlap blocking, filtered totals,
Metrics component exclusions/units/representative weighting, editor behavior,
persistence and failed-save rollback. Existing monthly and shared-import tests
protect earlier layouts and Clean Upload / Update Data behavior, independent
category drafts and incoming file selection, same-label cross-category uploads,
category-only saves/history, central synchronization and reload isolation, Referral
fallback for missing/zero counts, and coach-only saves and report runs without a
manager. Wiper-only Referral tests cover file intake, names/coach roster creation,
missing Opportunity fields, representative/team report runs, duplicate/correction
checks, verified save, reload, shared intake and scope selection, central updates,
and optional Opportunity history. Uploaded
employee exports must never be committed as fixtures.
