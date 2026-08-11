ALL-STAR MODULAR PACKAGE
========================

RUN THE MODULAR APPLICATION
1. Keep this All-Star folder inside the CoachTools package so ../../vendor and ../../shared remain available.
2. Open All-Star Report from CoachTools/index.html, or double-click allstar.html.
3. Use a current version of Microsoft Edge or Google Chrome.

MOVE THE APPLICATION
Move the complete CoachTools folder. The modular All-Star application intentionally shares CoachTools' vendored browser libraries and storage helper.

CREATE OR REFRESH THE PORTABLE BUILD
From this folder, run:

  node build/build-portable.js

Node is required only to build the portable file. It is not required to run allstar.html or the generated portable application. Run the build while this folder remains under CoachTools/apps so the builder can inline CoachTools' vendor and shared assets. The build also refreshes qualtrics/generator-source.js from the canonical qualtrics/generator.html and bundles qualtrics/insights.js into the generated carrier and portable file.

SINGLE-FILE VERSION
Take dist/All-Star-Portable.html when you want one file for another computer. It is generated output; do not edit it directly.

QUALTRICS SOURCE
qualtrics/generator.html is the only maintained Qualtrics source. generator-source.js is generated from it and is loaded only when the Qualtrics workspace opens. This carrier avoids fetch() restrictions and preserves the original srcdoc storage origin for existing saved rules/settings when running from file://. If the carrier is unavailable, the app falls back to opening generator.html directly.

WORKFLOW MODERNIZATION
- Import now includes cached Source Health metadata.
- Workbook imports inspect only a small worksheet prefix while detecting headers, materialize only the selected/required tabs, and build normalized row objects once.
- Package Imported Data now writes All_Star_Data_Package.json. Loading that JSON validates the versioned package and hydrates normalized rows directly; legacy .xlsx/.xls packages remain supported.
- Run uses shared Preflight diagnostics; only blocking errors stop execution.
- Model Health reuses the same validation logic used by Run Preflight.
- Display fields can target Representatives, Teams, or Coaches; match an explicit entity column in any source; select among duplicate records; derive count or date-tenure values; and apply ordered text/badge color rules without affecting points or rank.
- Coach display values are rendered on the coach's Team row. The Model Builder labels the explicit coach match column as "Coach Name Expected In".
- Research filter and metric caches are keyed by dataset/model/mapping/roster versions and reuse indexed row positions, with cache/scanning diagnostics in the performance panel.
- Named presets support fixed and dynamic date behavior.
- The 15 most recent report snapshots are stored in IndexedDB with schema version 1, optional notes, reopen, re-export, delete, and two-run comparison.
- Existing report calculation traces remain the source for Explain This Number auditing.

MANUAL REGRESSION TESTS
Open allstar.html?debug=1, then run this in the browser console when the app is ready:

  await runAllStarRegressionTests()

Or, without ?debug=1, run:

  await loadAllStarRegressionTests()
  await runAllStarRegressionTests()

LOCAL-FILE / BROWSER LIMITATIONS
- The All-Star code runs without a server.
- Excel import/export and PDF/ZIP features use the libraries packaged under CoachTools/vendor; normal modular and generated portable use does not require a CDN.
- Browser storage belongs to the browser profile and local-file origin. Keep the folder path stable when possible, and use the application's exports/backups before moving between browsers or managed profiles.
- Very restrictive enterprise browser policies may block file:// scripts or iframes. In that case, use dist/All-Star-Portable.html, which contains all first-party All-Star and Qualtrics code in one file.

SOURCE LAYOUT
- allstar.html: application markup and ordered script references
- css/allstar.css: preserved final stylesheet cascade
- js/core.js: constants, shared state, source contracts, Team Totals foundation
- js/persistence.js: import cache and persistence lifecycle
- js/models.js: model/alias/index logic and Model Builder
- js/imports.js: imports, roster intake, categorization, troubleshooting
- js/calculations.js: scoring, filters, QA calculations, Display Column
- js/research.js: complete Research and Metrics workspaces
- js/organizations.js: organizations and run coverage
- js/workflow.js: source health, shared diagnostics, Run Preflight, Model Health, presets, saved reports, notes, and comparison
- js/list-tester.js: List Tester and detailed exports
- js/reports.js: report runs, rankings, team tools, PDF/export
- js/qualtrics-bridge.js: parent/iframe messages and lazy generator loading
- js/app.js: event wiring and startup
- qualtrics/generator.html: final, permanently patched generator
- qualtrics/insights.js: reusable display formatting, corrective classification, severity/breadth, concentration, evidence, and trend logic
- tests/regression-tests.js: manually loaded browser regression suites
- tests/verify-package.js: static package/build verification
- build/build-portable.js: dependency-free portable builder

The classic script order in allstar.html is intentional for file:// operation. Keep that order unless dependencies are revalidated; reports.js provides a shared startup helper used while research.js initializes.
