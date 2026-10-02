# Sentence Research with same-row modifiers

## Status and scope

This is an additive, review-stage implementation for All-Star Dated Stats Research. It adds a **Build a question +** entry point and does not replace the existing Models, Metrics, or advanced Research editors. The application remains local; no AI service, new server, or external UI package is required.

Implemented: clickable sentence phrases; short labels for coaching/event items; calculated coaching-to-corrective ratios with combined, equal-rep, and equal-coach methods; number cards, line graphs, date tables and movement tables; saved numerical metric selection and inline standard-stat creation; representative/coach/manager/organization selectors; fixed membership or qualification per reporting period; independent performance and qualifying dates; nested ALL/ANY/NOT conditions; numerical thresholds, qualifying-period counts and trend conditions; same-row event-field modifiers; saved questions and unsaved draft recovery; a preview below the builder with loaded-row evidence.

Not implemented in this iteration: sentence-based Model rule creation, non-dated sentence recipes, before/after event alignment in sentence questions, arbitrary chart types, or every existing advanced Research option. Those existing workflows remain available in their original editors. Before/after is rejected for sentence questions rather than silently discarding their modifiers. A full application compatibility run is required before merge.

## Example

Build a line graph of the selected Cash/Consumer Appointment Rate metric for representatives. Add a Documented Coaching requirement. On that requirement add:

```text
At least 1 distinct Documented Coaching session
where ALL of the following match the SAME loaded row:
  Description contains "cash"
  Type equals "Documented"
```

The actual field names come from the loaded source headers. The metric retains its saved numerical definition; no existing statistic is renamed or reinterpreted as "Cash".

The + next to an existing field adds another modifier inside that same-row group. A separate event requirement is a separate condition and may match another event for the same person. Same-row AND is evaluated before distinct event IDs are counted. A description match in row A and a type match in row B do not satisfy the example, even if the rows share an event ID.

## Calculation and compatibility

The versioned condition tree is stored under `datedStats.sentenceQuery`. Existing definitions without this property delegate unchanged to the original research function. Existing date resolution, numerical criteria, aggregation, source scope, and missing-value calculations remain in the Dated Stats engine. Temporary eligibility events connect the new predicates to that engine without joining coaching rows into numerical observations or persisting synthetic source data.

Exact or zero-session counts require reviewed event coverage. Missing fields, unresolved identities, invalid dates, and incomplete coverage can yield Unknown rather than false or zero. Existing observed sessions can still prove a lower bound. With no reliable event ID, the adapter collapses only exact duplicate loaded records; it does not infer that similar rows are the same session.

The preview's explanation counts are explicitly condition checks before existing scope restrictions and numerical-data exclusions. Up to 20 examples per outcome class show real loaded records. Table output displays up to 250 calculated points while the saved result retains all points. Changes mark prior previews out of date; auto-refresh is optional.

The bootstrap is appended to `metric-components.js`; its existing rate-calculation code is unchanged. It loads the optional sentence scripts after DOMContentLoaded, without scanning imported rows or recategorizing data on startup. Existing saved items are not automatically migrated.

## Validation

Run from the repository root:

```sh
node --check CoachTools/apps/allstar/js/sentence-query.js
node --check CoachTools/apps/allstar/js/sentence-workspace.js
node --check CoachTools/apps/allstar/js/metric-components.js
node --test CoachTools/apps/allstar/tests/sentence-query.test.js
python CoachTools/apps/allstar/tests/browser-sentence-workspace.py
```

The Node suite has 22 passing tests. The Chromium smoke fixture passed sentence editing, + on an existing value, same-row AND, explanation output, save/reopen, unchanged legacy fixture data, table/line selection, narrow-screen width, and Escape closure, with no page errors. The browser fixture requires Python Playwright and Chromium at `/usr/bin/chromium`; adjust that executable path for another test environment.

These are unit/adapter tests and an isolated browser fixture, not a completed full-repository regression or a test against production imports. Before merge, run the existing repository test suite and exercise real uploads, reporting calendars, identity aliases, multi-coach scopes, Research exports, storage failures, and existing Models/Research in the full application. Check saved-definition roundtrips through the old editor as well as the sentence editor.


## Calculated numbers and short item labels

In Research, choose **Add calculated number**, or open **Build a question +** and choose **Coachings per corrective**, **Rep ratios by coach**, or **Coachings per coach**. Number cards show one result per selected group over the entire date range. **Show → Calculated number** also builds a count divided by included reps, included coaches, or a second item count. Tables can use the whole range or reporting dates; graphs use reporting dates.

For a coaching-to-corrective comparison:

1. Define **Coachings**: choose the source, whether to count distinct sessions or distinct source rows, and the actual coaching type/subject filters. Choose **All items in this source** explicitly if every item should count.
2. Define **Correctives** using its actual source field and value. Both counts use the same rep identities and event-date window. A label such as “Correctives” does not infer a source column or filter.
3. Choose the method and **one result per coach / team**. Select the population, dates, and review event coverage.
4. Name the result, preview, then save. The saved definition and snapshot preserve the item labels, formula method, counts, exclusions, and evidence.

| Method | Example with rep A: 4 coachings / 1 corrective; rep B: 2 / 2 |
| --- | --- |
| Divide combined totals | `(4 + 2) / (1 + 2) = 2` |
| Average each rep’s own ratio | `(4 / 1 + 2 / 2) / 2 = 2.5` |
| Average each coach’s own ratio | Calculate each included coach’s total ratio first, then average valid coaches equally. |

A **rep** denominator counts each included rep once, including covered reps with zero coachings. A **coach** denominator counts each included assigned coach once. Item denominators can use Documented Coaching, Checklist, or Call monitors / QA, independently of the numerator. Filters must match the same physical source row. Comma/semicolon-separated text phrases match any phrase; a field filter and text filter must both match. Distinct source-row counts can count several different items within one event ID; identical duplicate rows are counted once. Session counts count an event ID once.

Zero item denominators produce no ratio. Equal-rep averages exclude those reps and report the exclusion. Combined totals include covered zero-denominator reps’ numerator counts when the group denominator is positive. Incomplete coverage, missing source columns, invalid event dates, and unresolved identities do not silently become zeros. The details show both counts and included/excluded reps; individual averages are not represented as a ratio of group totals.

The loaded weekly statistics define the population. Event-only populations are not inferred. Whole-range results assign each rep to their latest loaded coach during the selected window; this is team membership, not event-delivery attribution. Number cards count events across the entire range once, rather than averaging weekly ratios. Period graphs can use the seven days ending at each reporting date or reviewed source-period boundaries.

Coaching/event conditions also accept an optional **Short item label**, and calculated results have a separate **Result label**. These labels affect presentation only. Imported source headers and records are unchanged. The standard editor retains calculated definitions when editing shared filters or titles.

Regression coverage: `node apps/allstar/tests/calculated-research.test.js` exercises distinct aggregation methods, per-rep/coach/item denominators, duplicate imports, same-row filtering, date windows, coach reassignment, source mapping failures, real builder controls, immediate loading, saved snapshots, and reopened definitions.


## Smooth line displays and a compact Research workspace

- In a standard Research graph, open **Fullscreen → Analysis layers**, choose a moving-average window, and set **Line display → Rolling average only**. The original paths are hidden while every visible series keeps its own rolling curve, even when a line is focused. Choose **Original + rolling average** to restore the overlay. Chart Designer has the same display choice with a window measured in displayed points.
- Dated statistics, coaching activity, and calculated-ratio graphs expose **Line display and labels** below their legend. Dated averages use trailing calendar weeks; relative-period graphs use trailing points. Starting windows use available observations. Rolling-only displays retain gaps at missing original points.
- **Line labels** supports none, all (up to eight), top N, bottom N, or top and bottom N. Ranked labels show each line’s average before smoothing within the displayed dates, giving available points equal weight and excluding blanks. Hidden lines and all-missing series are omitted from the ranking; tied averages use name order. Top/bottom overlap is labeled once. This controls labels, not which lines remain plotted. Save chart defaults to retain these preferences.
- Research’s update status is a compact top-bar value. **Diagnostics** opens the existing live performance timings in a popup. **Inspect ambiguous joins** appears only in the affected card’s More menu when ambiguity exists.
- Use a card’s dotted drag handle to change its position. The handle also supports Space/Enter to pick up, arrow keys to move, Enter/Space to save, and Escape to cancel. Drops save the order and reuse the existing chart/table nodes; they do not query data or recalculate results. A failed save restores the previous order. One-item/fullscreen viewing disables reordering.

The presentation regression suite is `node apps/allstar/tests/research-presentation.test.js`. It checks mean-based ranking (including 23 lines), gaps, ties, visible windows, rolling-only captures/defaults, dated-chart evidence, compact controls, conditional ambiguity details, pointer/keyboard ordering, cancellation, and storage-failure rollback.
