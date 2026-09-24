# Research, Organizations and Coaching Gaps modernization

The canonical modular files remain authoritative. The normal All-Star portable
builder includes these changes without introducing a new storage schema.

## Changes

- One delegated autocomplete controller handles Research, Metrics, formula-builder,
  population and Model expression inputs. Native header datalists and the extra
  workspace/model-reference menus no longer compete. The `;` shortcut uses the
  same popup. Suggestions use header/definition metadata, not source row scans.
- Insertion replaces the token or selection around the caret, including its closing
  bracket, while retaining surrounding operators and formula text. Arrow keys,
  Enter, Tab, Escape, outside focus and scrolling share the same menu ownership.
- Organization cards separate names from counts. Search and selection controls
  stay above the scrollable lists; selected teams, coverage and all six health
  diagnostics remain visible. Existing IDs, membership rules and storage remain.
- Coaching Gaps shows active filter chips, filter counts and reset actions. Reset
  clears coaching/checklist conditions, representative search and opportunity gate,
  restores the default coverage threshold, and preserves dates, team/KPI scope,
  criteria IDs/names/colors and unrelated settings.
- Timeline date labels are rendered directly, retaining the established Sunday
  presentation of ISO week keys. Raw ISO keys still drive grouping and events.
  Fixed minimum week widths scroll horizontally beneath stationary rep headings;
  representative rows share their scroll position. QA read states and event details
  retain their original handlers.
- Manifest discovery registers KPI Impact's launcher once while retaining its
  embedded application's data identity. Performance Scorecard's canonical source
  stays discoverable and continues launching the enhanced build. All 13 launcher
  entries retain their existing metadata. Suite validation follows local iframe
  applications to inspect their scripts, dependencies and shared-data contracts.
- Identity/profile and coaching-intelligence regression tests use a fixed clock
  or reporting cutoff matching their August fixtures, so rolling-window assertions
  remain repeatable after that month.

## Validation

- `TZ=UTC npm test`: passed, including manifest consistency, suite validation,
  all desktop regressions and the full All-Star suite. All 13 apps remain
  registered. The missing All Apps icon produces one nonblocking fallback warning.
- `TZ=UTC npm run test:allstar`: passed, including portable generation, package
  verification, existing import/calculation/persistence regressions and the new
  `expression-autocomplete.test.js`.
- Real Chromium file URL checks cover modular and generated portable applications:
  expression mode switching; multiple-variable calculations; token insertion;
  exactly one popup; model shortcut and Model input keyboard handling; save/run,
  reopen, duplicate and storage reload; organization selection and non-overlapping
  metadata at 1280, 750 and 480 pixels.
- Coaching Gaps browser checks cover actual week headers, year rollover, a timezone
  west of UTC, representative heading position during scrolling, active filter
  disclosure, drawer access, and reset preserving unrelated state.

Browser tests use the optional Playwright/Chromium installation documented in
`apps/allstar/README.txt`; run `npm run test:allstar:browser` after building portable.
No HTML preview is generated or published by the test workflow.
