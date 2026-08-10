ALL-STAR MODULAR PACKAGE
========================

RUN THE MODULAR APPLICATION
1. Keep this entire All-Star folder together.
2. Double-click allstar.html.
3. Use a current version of Microsoft Edge or Google Chrome.

MOVE THE APPLICATION
Copy the entire All-Star folder, including css, js, qualtrics, tests, build, and dist.

CREATE OR REFRESH THE PORTABLE BUILD
From this folder, run:

  node build/build-portable.js

Node is required only to build the portable file. It is not required to run allstar.html or the generated portable application. The build also refreshes qualtrics/generator-source.js from the canonical qualtrics/generator.html.

SINGLE-FILE VERSION
Take dist/All-Star-Portable.html when you want one file for another computer. It is generated output; do not edit it directly.

QUALTRICS SOURCE
qualtrics/generator.html is the only maintained Qualtrics source. generator-source.js is generated from it and is loaded only when the Qualtrics workspace opens. This carrier avoids fetch() restrictions and preserves the original srcdoc storage origin for existing saved rules/settings when running from file://. If the carrier is unavailable, the app falls back to opening generator.html directly.

MANUAL REGRESSION TESTS
Open allstar.html?debug=1, then run this in the browser console when the app is ready:

  await runAllStarRegressionTests()

Or, without ?debug=1, run:

  await loadAllStarRegressionTests()
  await runAllStarRegressionTests()

LOCAL-FILE / BROWSER LIMITATIONS
- The All-Star code runs without a server.
- Excel import/export and PDF/ZIP features still use the same external CDN libraries as the original file, so those features require network access unless your browser has already cached them.
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
- js/list-tester.js: List Tester and detailed exports
- js/reports.js: report runs, rankings, team tools, PDF/export
- js/qualtrics-bridge.js: parent/iframe messages and lazy generator loading
- js/app.js: event wiring and startup
- qualtrics/generator.html: final, permanently patched generator
- tests/regression-tests.js: manually loaded browser regression suites
- tests/verify-package.js: static package/build verification
- build/build-portable.js: dependency-free portable builder

The classic script order in allstar.html is intentional for file:// operation. Keep that order unless dependencies are revalidated; reports.js provides a shared startup helper used while research.js initializes.
