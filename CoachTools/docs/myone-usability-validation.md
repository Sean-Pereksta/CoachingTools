# MyOne All-Star, upload reliability, and condensed scorecards

Implementation stays in app and shared modules. Root and desktop `index.html` files are unchanged.

- Coaching columns and their cells are reordered without changing metric functions. Both overview renderers include the clarifier, count colors, and labeled 0–4 / 5–9 / 10–14 / 15–19 / 20+ key.
- Numeric-name exclusion is off by default. Enabling it filters the displayed representative list and resolved Individual Review scope, cancels an active run, and invalidates cached/exportable results. Imported data and saved rules remain untouched.
- Clean and Update use shared preparation and header validation. Failed filename guesses retry source headers; unusual headers get full-sheet discovery. Period-dependent sources try report headings and worksheet names when filename dates are missing, and retain existing data if the period remains ambiguous.
- Remembered updates check renamed exports while preserving the saved source set and coach scope. File failures remain visible individually and valid batch members continue.
- Duplicate detection verifies payload readability. An incomplete duplicate can be replaced transactionally with validated incoming data. Existing history is retained; aborting a replacement retains the prior committed version. Legacy pointers without import timestamps no longer block a same-period update.
- Condensed scorecards remove forced wide minimums, wrap metric details and long names, expand the visible report vertically, and use readable text. Source and enhanced scorecards share the density changes. Representative search leads the Scorecard controls and Individual scope columns.

## Validation

Run `npm ci` in `CoachTools`, then `npm run test:myone` for behavioral report/import tests and IndexedDB replacement/abort tests using `fake-indexeddb`.

Passed: All-Star suite; direct-file update planning; scope synchronization; data recovery controls; chunk storage; Scorecard runtime controls, ranking/display/export contracts, and themes.

Two broader-suite failures were reproduced in a separate checkout of unchanged main at `7db286f`: duplicate `kpi-impact` application IDs stop manifest validation; `identity-profile-sync.test.js:126` expects 1.5 but receives NaN.

Browser layout verification was unavailable: Chromium is absent and the Playwright download timed out. Density rules and generated files were checked in code; live screenshot QA remains advisable with real team data, especially unusually large metric selections. No HTML previews were generated for delivery.

## Follow-up: manual source recovery

Unidentified readable files now offer a per-file source selector across all eight existing sources. Clean Upload, direct-file updates, launcher scans, and All-Star's shared import use this review. Each selection is validated before it joins the upload population; users can correct a confirmed selection or skip unresolved files. Manual selection occurs before scope discovery/update planning, and an explicitly chosen source is not silently excluded by an older source baseline.

Format diagnostics now enumerate missing field groups and their accepted column names. Scope failures identify accepted ownership headers. Recovery messages ask users to snip the report headers, example rows, and error and send them to Sean. Unreadable workbooks and files still missing required information remain blocked from replacing good data.

Launcher scans now use the same incoming preparation/validation as Clean and Update. Validation, comparison, and write failures are isolated per file and surfaced in progress details.

Additional passing coverage: DOM-based source selection, invalid-source rejection, retry/change/skip, filename text safety, actual XLSX discovery and manual scope preparation, and explicit manual destinations outside the old update source baseline. Run `npm run test:myone`; its new `linkedom` dependency is test-only. No live-browser validation or HTML preview was performed for this follow-up.

## Correction: file selection and weekly override

This supersedes the earlier broad renamed-file scanning and weekly period/history behavior described above. Clean Upload and quick upload open the native multiple-file picker directly, with no folder restriction or Storage guidance interception. Update and launcher scans match only the source filenames/templates established by Clean Upload. Four selected sources produce a four-source update; unrelated concern-history exports and unselected sources are ignored.

Retail and Referral weekly uploads accept an undated report as the current weekly upload. Each incoming weekly source overrides all prior records/chunks for that source and becomes current, even when previous dates or duplicate metadata would have blocked it. Deletion, replacement, and pointer update share one IndexedDB transaction: an aborted write retains the prior committed copy. Other sources are unaffected. Weekly replacement is automatic under the user's explicit authorization; other recognized-source failures offer an in-app confirmation before replacing that source's history. The incoming file must still be readable, and selected coach scope is preserved. An unreadable file or unavailable database cannot be made writable by deleting good data.

Passing regression coverage includes the unrestricted native picker, selected-source-only matching, undated weekly preparation, consent/decline for nonweekly replacement, weekly chunk cleanup/current-pointer replacement, preservation of unrelated data, and transaction rollback. `test:myone` includes these checks. Root and desktop index files remain unchanged.
