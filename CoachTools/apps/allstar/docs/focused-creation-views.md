# Focused Models, Metrics and Research views

Models keep their existing definitions, storage keys, criterion order, scoring, eligibility, weights, filters and evaluator. Presentation groups the original controls; it does not translate a model into another definition.

## Review stages

1. **Models:** searchable overview with source summaries and secondary actions; compact criterion summaries; one selected criterion editor; Definition, Filters, Scoring and Display sections; all-settings access; source settings collapsed until needed. Readiness checks run when requested and link to existing controls. Sample preview sits below the editor, identifies draft/all-date/sample context, and shows engine-produced values, ranks, contributions and eligibility reasons.
2. **Metrics:** saved-definition summaries and source categories; calculation-specific controls; counting-unit guidance; clearly marked retained inputs; collapsible conditions and display settings; actual results and matching-row evidence below the editor. Dated metric summaries spell out the real formula, aggregation, date window and output instead of internal codes. Their editor shows a live definition summary, plain-language calculation examples, and separate reporting-period, eligibility and result sections. Field, expression or ratio inputs follow the selected measurement; All metric settings retains access to every input. Preview tables show period values, usable contributions and exclusion reasons, with unavailable reporting gaps labeled explicitly. Scalar, series and trend-summary outputs have distinct result labels.
3. **Research:** Show, For, When and Additional existing settings; advanced editing remains available; chart and table appearance are separated. The draft preview calls the existing Research evaluator. Clicking a value uses the existing focused drilldown with the draft supplied explicitly and displays evidence below the editor. Sentence questions use shorter collapsible sections and explicit population/same-row scope labels. Both sentence modules are bundled in the portable entry point.

## Draft and view boundaries

- Focused and expanded presentations use the same original draft and controls. Hidden/collapsed fields are retained. Dated criterion controls keep their existing bindings.
- View preferences use `allstar.model.view.v1`, `allstar.creation.views.v1`, `allstar.datedMetric.view.v1`, and `allstar.sentence.view.v1`, outside saved definitions.
- Model search, focus, section changes and no-op rerenders preserve the sample preview. Definition changes mark it stale. Readiness checks and calculations are not triggered by searching the overview.
- Metric reopening retains optional metadata and inactive calculation inputs. An unchanged save retains the saved definition without re-normalizing it. Explicit edits use the established save path. Save failures retain the draft and restore the prior in-memory saved items.
- Dated Metric reopening and unchanged saving retain the exact existing definition, including multi-field rate components and inactive expressions. Switching source retains typed controls; incompatible calculation selections are explained and retained until the user chooses an available option. Name-only edits keep the preview current, while changes to measurements, dates, eligibility or output mark it stale.
- Research appearance edits reuse raw calculated values and the existing renderers. Population, source, measurement and condition changes mark the answer stale. The preview does not save the definition or result.
- Evidence limits are labeled: Model samples include at most 30 entries, Metric evidence at most 50 rows, Research preview tables at most 50 calculated groups/records, focused Research drilldown at most 250 current evidence rows, and dated metric contribution/exclusion samples at most 30 each. These display limits do not change the calculation's selected scope.

## Validation

Run from `CoachTools/`:

```sh
TZ=America/New_York npm run test:allstar
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chromium npm run test:allstar:browser
CHROMIUM_PATH=/path/to/chromium python apps/allstar/tests/browser-sentence-workspace.py
```

The complete All-Star gate covers package/portable validation, monthly imports, parser/import lifecycle, Qualtrics and individual messaging, Research/Model golden calculations, caches, expressions, organizations, dated statistics, sentence-query cases and creation-view regressions. Chromium covers modular and portable `file://` applications, inline draft evidence, unchanged complete drafts, retained hidden controls, actual results, keyboard interactions and narrow layouts. Fixtures use representative loaded data; production workbooks were not provided for this request.

The repository-wide `npm test` currently stops in the unchanged desktop `tests/monthly-shared-import.test.js`: its VM fixture lacks `URL`, required by the shared import bootstrap (`ReferenceError: URL is not defined`, then the fixture's error-count assertion). The same failure was reproduced in a detached checkout of base `5cfcb04dd1a2e591b3c44850a225d57aa5ff55fc`. It is outside this presentation update. Manifest and suite validation passed; All-Star was tested separately.

No calculation fixes, source-calendar changes, categorization, identity migrations or import redesign are included. Existing advanced workflows that the sentence editor cannot safely represent continue using their existing editor.
