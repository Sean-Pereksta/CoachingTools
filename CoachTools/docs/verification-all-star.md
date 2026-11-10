# Verification All Star

Open **All Star Tools → Verification All Star** on the CoachTools desktop. The existing All-Star Report is in the same folder.

1. Upload the monthly verification workbook. Add the separate Lane 3 workbook when VAPH is selected for scoring; it is optional for settings that do not score VAPH.
2. Select the report month. The app defaults to the previous calendar month and selects the corresponding Lane 3 tab when it can match its month name or abbreviation. You can choose a different tab.
3. Run the report. The file controls collapse so lane winners and full rankings appear on the front page. Each winner shows their points and performance measures. Expand the file controls to change inputs, or review excluded representatives separately before exporting.

## Workbook mapping

The monthly file is authoritative for membership in Lane 1–5. Each lane sheet supplies its first roster in column AA, beginning at row 6. The reader stops at the end of that roster; later report headings such as ACW % and ACW time are not representatives. A second Name/Totals section below the first supplies VAPH, matched by representative name. The reader first finds **Verification Activity per Staffed Time** in that second header and falls back to column AL. A genuine roster member without VAPH remains available for individual review.

Lane 3 always uses the selected tab in the separate workbook for VAPH. It finds **Avg Cases per hr Salesforce**, falling back to column D, and matches only the names in the monthly Lane 3 roster. It never substitutes monthly Lane 3 VAPH when an override is missing.

The **Phone Data** sheet supplies coach names using Team_Name (column C fallback) and the representative name in column A. Name matching supports case, spacing, and Last, First order; it does not guess from partial names.

## Monthly measures

- **Wipers:** all stored weekly Referral records with publication dates in the selected month, with Retail data filling missing representative/week records. Referral takes precedence where both exist. Monthly rate is total accepted divided by total offered. Retained versions and duplicate snapshots are not added twice.
- **Call Quality:** average scored evaluations from the stored 90-day evaluation data whose interaction dates are in the selected month. The reader falls back to evaluation/assigned dates when the interaction date column is absent. Scores of zero are included.
- **Attendance:** count of monthly checklist items containing Absence or Tardy in the incident/item or description. Each item counts once.
- **Correctives:** count of monthly checklist items whose corrective field contains Final, Written, or Verbal, including fields containing additional words. Each matching item counts once, and adds 500 penalty points.

Checklist incident dates take precedence, with Created On as a fallback when the incident date column is absent. Shared data is read across retained import history within the current Horizon data view. The monthly roster, warnings, and export also follow that view. A source previously imported with a restricted scope can only supply the people it contains.

## Rankings and eligibility

The default **Performance only** preset ranks people using **Call Quality, Wipers, and VAPH**. All three must be present and valid. Missing attendance or corrective records do not exclude anyone under this preset. Missing some weekly Wiper rows is a coverage note by default when a valid monthly Wiper rate can be calculated.

Use the ranking settings to select any nonempty combination of the five measures. Every selected measure is required, and only selected measures contribute ranks to the total. **All five measures** adds attendance and correctives, making their source data necessary. The option to require every available Wiper week adds that stricter coverage requirement. The corrective penalty is editable and applies only when Correctives is selected. Changing a setting requires a refreshed report; preferences are remembered on this device.

Highest Wipers, VAPH, and Call Quality rank best; lowest attendance and corrective counts rank best. Ties share ranks (1, 1, 3). Excluded representatives never change other people's ranks.

**Total points = sum of the selected measure ranks + the configured corrective penalty when Correctives is selected.** The default total is Wiper rank + VAPH rank + Call Quality rank. The All five measures preset can reproduce the five-rank formula with 500 points per corrective. Lowest total wins the lane. Exact total ties share the win.

An excluded person does not mark the whole file or lane incomplete. Each lane with at least one eligible representative declares its lowest-total winner; exact ties retain all joint winners. A lane with no eligible representative says so instead of awarding a win using missing statistics. Measured zero values remain valid. Zero offered is an unavailable Wiper rate. An absent checklist source does not imply zero incidents; a recognized source with no matching records does.

The exclusion breakdown shows the number of people affected by each reason and the selected report month. A person with several reasons appears in several counts, so those counts can overlap. The comparison shows eligibility under the current settings, the three performance measures, and the previous strict rule of all five measures plus every available Wiper week. It uses the loaded roster and source data rather than guessing from a reported exclusion total.

Source issues only block the measure they affect when it is selected. Duplicate roster identities and unclassified blocking conflicts still require review. Unavailable source values remain unknown and are not replaced by zero. The app can identify missing weeks already present elsewhere in the loaded roster; it cannot infer an entirely absent weekly source. Boundary weeks belong to the month of their publication date.

## Additional Wiper data

Expand **Wiper data settings** to add Excel, CSV, TSV, or TXT files. This uses the Weekly Data Builder parsing engine, including its encoding, header, and source-period rules. Supply a publication date for an undated file and select a sheet or period if necessary. Added rows replace the same representative/publication date in this report. Unmatched names and out-of-month rows are noted.

These additions remain in memory in the current tab. Use Weekly Data Builder to save weekly data for the rest of the suite. No uploaded workbook or large report dataset is copied into localStorage.

## Output

The Excel download separates ranked representatives from excluded people and their reasons. Full Rankings and Lane Winners include the report month, lane, representative, coach, actual counts and measures, selected measure ranks, lane rank, applicable corrective penalties, total points, and winner status. The eligibility review and saved settings explain why people were excluded and how scores were calculated. Weekly Wipers and Sources and Notes retain supporting detail. The export includes every lane and eligible representative even when the on-screen table is filtered.

Run `npm run test:verification-allstar` for parser, ranking, shared-storage, upload, and desktop-folder tests.
