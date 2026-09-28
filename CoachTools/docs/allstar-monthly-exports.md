# All-Star monthly export bundles

This adapter changes only Monthly Retail and Monthly Referral. Weekly sources,
QA, Checklist, Documented Coaching, Compliments, custom rules and legacy monthly
Control/team-sheet workbooks retain their existing paths.

## Import and review

Open All-Star → Import Data → Upload monthly exports. The shared Clean Upload and Update Data selectors recognize
the same exports and open the same preview. Select one Rep Opportunity
Performance export and any number of Rep Wiper Performance exports together in
one file picker, in any order. Wipers can also be staged before Opportunity or
added to a saved bundle. Representative data and full team totals are displayed
immediately, with all matched Wiper counts summed. Save monthly data is the only
submission step; there is no approval checkbox or separate Cash confirmation.
Team overrides, exclusions, and corrected-file replacements remain optional.

The Save button stays mounted while the preview changes, so a text-field blur does
not remove the button before its click fires. Direct All-Star saves remain in the
preview until the verified IndexedDB transaction succeeds. Busy or failed saves
show the error in that preview and retain the selected files for retry.

Opportunity's segment and metric headings determine the nine statistical columns.
Only the validated format uses leading columns A/B/C for coach/name/fiscal period.
Changed layouts open a column mapping preview. Fiscal period never becomes hire
date. UTF-16 LE/BE BOM tab-delimited CSV and UTF-8 quoted CSV are supported.

An explicitly selected monthly area owns its Opportunity roster. In Mixed, coaches
are automatically assigned using their team's summed raw opportunity counts:
Consumer (cash) opportunities / (Commercial + Consumer + Insurance opportunities).
More than 15% is Retail; 15% or below, including exactly 15%, is Referral. This is
weighted by call counts, not an average of representative percentages. Coach names
use the same Unicode/case/whitespace normalization as other monthly matching.
Missing/suppressed/invalid opportunity counts or no calls leave the coach for
manual assignment. Fully blank segments count as zero only after the reviewer
confirms the export's no-activity convention. Each automatic assignment remains
editable. Loading a different Opportunity export recalculates the assignments and
clears prior manual overrides; renamed duplicate content retains its decisions.

Consumer is Cash for both area assignment and scored Cash opportunities,
appointments, and appointment-rate fields in non-dated monthly imports. The original
Consumer fields remain available without a confirmation step. No conversion,
ITAC, revenue or hire-date metric is manufactured from these exports.

New and edited monthly bundles are **non-dated**. Opportunity fiscal labels and
Wiper report-date labels may be blank or unusable; Wiper exports may omit the report
date column altogether. No report date, activity range, label meaning, or assignment
note is required. Import review, saved settings, summaries and report notes show the
load timestamp. Source labels remain in the raw export for lineage, but never
become observation dates, filter dates or required reporting periods. Source rows
remain `_date: ''`. Each Wiper file contributes its included valid counts; absence
of a calendar span does not produce a coverage-gap warning or require partial-data
acknowledgment. Missing/invalid counts and unmatched names remain visible in the preview and
are excluded from affected totals without requiring approval. Structural errors
and ambiguous coach-area assignments are shown beside Save with the needed fix.

Existing saved dated bundles retain their historical calculations when reloaded or
viewed. Opening one for editing converts the working copy to non-dated; Cancel
leaves the saved bundle unchanged. Import timestamps are retained through reloads,
not regenerated as reporting dates. Research Readiness identifies these sources as
non-dated and does not ask for a reporting period for an unrestricted analysis.

## Identity, missing data and calculations

Names match automatically only after Unicode/case/whitespace normalization and
only when exactly one Opportunity record owns the name. Duplicate names remain
separate roster records. Allocate each ambiguous wiper row to one selected roster
record by selecting the recipient, or exclude it. The decision is recorded
automatically; there is no required explanation field. Unmatched names never create representatives. No fuzzy
or initial/surname match is used. Neither export supplies a verified employee ID.

Missing, suppressed (`*`), not-applicable, invalid and numeric zero are distinct.
Fully blank Opportunity segments default to missing; the reviewer can explicitly
confirm the export's no-activity convention. Partial segments do not inherit that
convention. Negative/fractional counts, appointments above opportunities, and
accepted above offered are excluded with raw values retained in diagnostics.
A zero denominator produces N/A. Isolated invalid records do not prevent preview;
non-dated imports can save available valid counts immediately and retain visible
completeness flags in settings, report headings and PDF footers. Historical dated
bundles retain their original acknowledgment behavior until edited.

Representative and team rates use summed raw numerators divided by summed raw
denominators. Exported appointment rates are reconciliation checks with 0.05
percentage-point rounding tolerance. Team summaries are separate sources and are
calculated from the full applicable roster before report display filters. Existing
subgroup definitions such as average of uncoached reps are unchanged. Representatives
with absent wiper records remain on the roster with missing status, not zeroes.

## Files, persistence and compatibility

Canonical decoded content identifies duplicate uploads independent of filename.
Each file retains its raw rows, load timestamp, exclusions and per-row allocation decisions.
A corrected file explicitly replaces an earlier file; removing it recalculates its
contributions. Identical decoded uploads cannot double-count under a different
filename, and repeated rows for the same representative/source group require
resolution. Distinct files add their counts; because these records are non-dated,
there is no calendar-overlap check. Use the replacement selector for corrected
files instead of adding both versions.

Loading a different Opportunity export starts a new snapshot with a fresh Wiper set
and coach assignments. Select its Wiper exports in the same batch or add them afterward. The prior committed
snapshot is archived by its load timestamp, with its historical coach assignments.
Wiper-only uploads remain additive to the existing snapshot. Data Settings includes
file lineage, matching exceptions, team totals and representative contributions.

`shared/coachtools-monthly.js` is the shared normalization/aggregation engine;
`shared/coachtools-monthly-review.js` supplies the bounded review dialog.
`apps/allstar/js/monthly-import.js` adapts its results into existing SV2, Wiper,
Control-roster-equivalent and Team Totals sources. Format-specific rows bypass
legacy header offsets and alias rewrites without changing saved source mappings.
Roster IDs persist through categorized rows, cached lookups and duplicate names.

All-Star commits use its staged, verified IndexedDB transaction. Failed commits
retain the previous monthly datasets; unrelated datasets are not cleared. Cache
restoration recompiles the retained bundle through the same engine. Shared monthly
imports carry the reviewed bundle and scoped roster selection into central sync.
A newer reviewed central monthly update can refresh All-Star; unrelated source
precedence is unchanged. For a mixed bundle with representatives in both areas, both central records must
contain the same master bundle before either All-Star area is replaced. A mixed
bundle that assigns every coach to one area clears the previously populated other
area. Non-dated shared imports use load time for recency, never a filename date.

## Validation

`npm test` includes synthetic monthly engine/adapter and shared-import tests plus
existing desktop and All-Star regressions. Monthly cases cover encoding, reordered
headers, changed-layout detection, weighted arithmetic, duplicate filenames,
replacements/removals, duplicate-name allocation, missing/suppressed values,
legacy coverage/boundaries, weighted coach cash shares and threshold boundaries,
manual overrides, multi-file selection, visible combined previews, saving partial
data without approvals, busy/save-failure retries, stable Save clicks, automatic
Cash aliases, date-free review/apply/reload, independent areas,
cached/categorized identities, timestamp history,
central intake, reload parity and verified-save rollback. Employee exports are
used locally for format checks only and are not committed.
