# Recent coaching in Qualtrics reports

In **Load Key Files → Report Session**, set **Count matching coaching from the past X weeks**. The default is **2**; the setting accepts whole weeks from 1 to 52 and is remembered on this device.

Every rule's recent-coaching status uses this setting in rule previews, email reports, urgency coverage, and both coaching-needs downloads. Older saved rule-specific recency values remain readable but no longer override the visible setting. Performance-statistic, corrective-count, and history windows retain their separate purposes.

A qualifying coaching must belong to the representative and satisfy the rule's configured description keywords or coaching topic. A changed coach assignment does not invalidate it. Corrective rules use their selected coaching topic for coverage; their count and Build Up filters decide who qualifies for the rule, not whether a recent matching coaching counts.

The date window starts at midnight X × 7 calendar days before the selected report date and includes the entire report date, through 23:59:59.999. Later calendar dates and older coaching are excluded. Source timestamps are retained; Excel date numbers are interpreted as local calendar dates rather than UTC instants.

Previously, the report date was midnight while coaching entries retained their time of day. Entries later on the report date were excluded until the following day. A synthetic fixture with 5 earlier/midnight coachings and 46 later same-day coachings reproduces the 5% to 51% jump; the corrected calculation returns 51% on both days from the same rows. This demonstrates the bug without claiming to validate any particular uploaded dataset.

After changing the weeks setting or loading updated data, refresh the preview or generate the report again. A coaching must be present in the imported data to count.

## Hide reps without recent Weekly Stats

The **Weekly Stats filter** card is the first item in **Load Key Files**, above the upload instructions. Select **Hide reps with no weekly stats in the past X weeks** and enter the number of weeks. It starts unchecked, with **2** weeks filled in, and remembers both settings on this device.

When enabled, a representative must have at least one dated row in the loaded **Weekly Stats** within that window, through the full selected report day. Zero values count. Future dates, older dates, missing dates, and QA or coaching rows do not qualify. If Weekly Stats are absent, all reps are hidden and the card explains how to restore them.

The filter applies to every rule preview, generated report, report population denominator, corrective follow-up watchlist, individual review, and both coaching-needs downloads. Saved individual selections remain available when the filter is turned off. Reports show the selected filter and the number of reps hidden. Changing the filter, its date window, or the Weekly Stats source requires generating the report again before downloading existing email/PDF output.

## Validation

- `npm run test:allstar` builds and checks the portable app and runs the All-Star regression suite.
- `node apps/allstar/tests/qualtrics-coaching-window.test.js` checks UTC and America/New_York, same-day timestamps, inclusive boundaries, future/older exclusions, DST, Excel dates, keyword scope, corrective topics, shared weeks, persistence, previews, urgency, and exports.
- `node apps/allstar/tests/qualtrics-weekly-stats-filter.test.js` checks optional defaults, date boundaries, zero values, any matching weekly row, import replacement, persistence, individual scope, population denominators, and export snapshots in UTC and America/New_York.
- `node apps/allstar/tests/browser-qualtrics-coaching-needs.test.js` exercises real coaching imports and both download actions in a browser.
