# Verification All Star

Open **All Star Tools → Verification All Star** on the CoachTools desktop. The existing All-Star Report is in the same folder.

1. Upload the monthly verification workbook and the separate Lane 3 workbook.
2. Select the report month. The app defaults to the previous calendar month and selects the corresponding Lane 3 tab when it can match its month name or abbreviation. You can choose a different tab.
3. Run the report. Review any data coverage notes, then export the full Excel report.

## Workbook mapping

The monthly file is authoritative for membership in Lane 1–5. Each lane sheet supplies its first roster in column AA, beginning at row 6. A second Name/Totals section below the first supplies VAPH, matched by representative name. The reader first finds **Verification Activity per Staffed Time** in that second header and falls back to column AL.

Lane 3 always uses the selected tab in the separate workbook for VAPH. It finds **Avg Cases per hr Salesforce**, falling back to column D, and matches only the names in the monthly Lane 3 roster. It never substitutes monthly Lane 3 VAPH when an override is missing.

The **Phone Data** sheet supplies coach names using Team_Name (column C fallback) and the representative name in column A. Name matching supports case, spacing, and Last, First order; it does not guess from partial names.

## Monthly measures

- **Wipers:** all stored weekly Referral records with publication dates in the selected month, with Retail data filling missing representative/week records. Referral takes precedence where both exist. Monthly rate is total accepted divided by total offered. Retained versions and duplicate snapshots are not added twice.
- **Call Quality:** average scored evaluations from the stored 90-day evaluation data whose interaction dates are in the selected month. The reader falls back to evaluation/assigned dates when the interaction date column is absent. Scores of zero are included.
- **Attendance:** count of monthly checklist items containing Absence or Tardy in the incident/item or description. Each item counts once.
- **Correctives:** count of monthly checklist items whose corrective field contains Final, Written, or Verbal, including fields containing additional words. Each matching item counts once, and adds 500 penalty points.

Checklist incident dates take precedence, with Created On as a fallback when the incident date column is absent. Shared data is read across retained import history, independent of the current desktop people filter. A source previously imported with a restricted scope can only supply the people it contains.

## Rankings and completeness

All five measures receive a competition rank within each lane. Highest Wipers, VAPH, and Call Quality rank best; lowest attendance and corrective counts rank best. Ties share ranks (1, 1, 3).

**Total points = Wiper rank + VAPH rank + Call Quality rank + attendance rank + corrective rank + 500 × corrective count.** Lowest total wins the lane. Exact total ties share the win.

Missing metrics, invalid/conflicting data, duplicate membership across lanes, and missing known Wiper weeks keep a lane provisional. No winner is announced for an incomplete lane. Zero offered is an unavailable Wiper rate. An absent checklist source does not imply zero incidents; a recognized source with no matching records does.

The app can identify missing weeks already present elsewhere in the loaded roster; it cannot infer an entirely absent weekly source. Confirm the displayed weekly coverage against your monthly reporting calendar. Boundary weeks belong to the month of their publication date.

## Additional Wiper data

Expand **Wiper data settings** to add Excel, CSV, TSV, or TXT files. This uses the Weekly Data Builder parsing engine, including its encoding, header, and source-period rules. Supply a publication date for an undated file and select a sheet or period if necessary. Added rows replace the same representative/publication date in this report. Unmatched names and out-of-month rows are noted.

These additions remain in memory in the current tab. Use Weekly Data Builder to save weekly data for the rest of the suite. No uploaded workbook or large report dataset is copied into localStorage.

## Output

The Excel download includes Full Rankings, Lane Winners, Weekly Wipers, and Sources and Notes. It includes the report month, lane, representative, coach, raw counts and measures, every measure's rank, lane rank, corrective penalties, total points, winner status, and missing-data notes. The export always includes the full population even when the on-screen table is filtered.

Run `npm run test:verification-allstar` for parser, ranking, shared-storage, upload, and desktop-folder tests.
