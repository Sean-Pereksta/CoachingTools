# Sentence Research with same-row modifiers

## Status and scope

This is an additive, review-stage implementation for All-Star Dated Stats Research. It adds a **Build a question +** entry point and does not replace the existing Models, Metrics, or advanced Research editors. The application remains local; no AI service, new server, or external UI package is required.

Implemented: clickable sentence phrases; line or date-table output; saved numerical metric selection and inline standard-stat creation; representative/coach/manager/organization selectors; fixed membership or qualification per reporting period; independent performance and qualifying dates; nested ALL/ANY/NOT conditions; numerical thresholds, qualifying-period counts and trend conditions; same-row event-field modifiers; saved questions and unsaved draft recovery; a preview below the builder with loaded-row evidence.

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
