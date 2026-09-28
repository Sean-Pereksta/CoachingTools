# All-Star monthly export bundles

This adapter changes only Monthly Retail and Monthly Referral. Weekly sources,
QA, Checklist, Documented Coaching, Compliments, custom rules and legacy monthly
Control/team-sheet workbooks retain their existing paths.

## Import and review

Open All-Star → Import Data → Monthly Retail, Monthly Referral, or One master
file · both areas. The shared Clean Upload and Update Data selectors recognize
the same exports and open the same review dialog. Select one Rep Opportunity
Performance export and any number of Rep Wiper Performance exports. Wipers can
be selected together, staged before Opportunity, or added to a saved bundle.

Opportunity's segment and metric headings determine the nine statistical columns.
Only the validated format uses leading columns A/B/C for coach/name/fiscal period.
Changed layouts open a column mapping preview. Fiscal period never becomes hire
date. UTF-16 LE/BE BOM tab-delimited CSV and UTF-8 quoted CSV are supported.

An explicitly selected monthly area owns its Opportunity roster. A master file
for both areas requires a coach-to-area mapping; unambiguous existing All-Star
roster assignments are offered as defaults. Consumer and Insurance never select
an area. Consumer-to-Cash aliases require explicit confirmation that the business
definitions match. The original Consumer fields remain available. No conversion,
ITAC, revenue or hire-date metric is manufactured from these exports.

Every wiper report label requires activity start/end dates, an explicit meaning
(activity date, week label or export date), and a documented basis for that choice.
The supplied labels alone cannot establish covered weeks. Out-of-fiscal report
labels are permitted with verified in-fiscal coverage. Activity crossing a fiscal
boundary must be excluded or replaced with correctly bounded source data; aggregate
counts are never prorated. Gaps are partial; overlapping reporting buckets are
blocking. There is no four/five-file count requirement.

## Identity, missing data and calculations

Names match automatically only after Unicode/case/whitespace normalization and
only when exactly one Opportunity record owns the name. Duplicate names remain
separate roster records. Allocate each ambiguous wiper row to one selected roster
record with a reason (different people, transfer, or verified alias), or explicitly
exclude it with a reason. Unmatched names never create representatives. No fuzzy
or initial/surname match is used. Neither export supplies a verified employee ID.

Missing, suppressed (`*`), not-applicable, invalid and numeric zero are distinct.
Fully blank Opportunity segments default to missing; the reviewer can explicitly
confirm the export's no-activity convention. Partial segments do not inherit that
convention. Negative/fractional counts, appointments above opportunities, and
accepted above offered are excluded with raw values retained in diagnostics.
A zero denominator produces N/A. Isolated invalid records do not prevent preview;
applying partial results requires acknowledgment and retains visible completeness
flags in settings, report headings and PDF footers.

Representative and team rates use summed raw numerators divided by summed raw
denominators. Exported appointment rates are reconciliation checks with 0.05
percentage-point rounding tolerance. Team summaries are separate sources and are
calculated from the full applicable roster before report display filters. Existing
subgroup definitions such as average of uncoached reps are unchanged. Representatives
with absent wiper records remain on the roster with missing status, not zeroes.

## Files, persistence and compatibility

Canonical decoded content identifies duplicate uploads independent of filename.
Each file retains its raw rows, per-label coverage and per-row allocation decisions.
A corrected file explicitly replaces an earlier file; removing it recalculates its
contributions. Duplicate/overlapping representative contributions cannot be applied.
New fiscal months start with a fresh wiper set and archive the earlier bundle and
its historical coach assignments. Data Settings includes file lineage, coverage,
matching exceptions, team totals and representative contribution drill-down.

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
precedence is unchanged. For mixed-area sync, both central records must contain
the same master bundle before either All-Star area is replaced, preventing a
half-saved shared upload from moving allocations into both teams.

## Validation

`npm test` includes synthetic monthly engine/adapter and shared-import tests plus
existing desktop and All-Star regressions. Monthly cases cover encoding, reordered
headers, changed-layout detection, weighted arithmetic, duplicate filenames,
replacements/removals, duplicate-name allocation, missing/suppressed values,
coverage/boundaries, independent areas, cached/categorized identities, history,
central intake, reload parity and verified-save rollback. Employee exports are
used locally for format checks only and are not committed.
