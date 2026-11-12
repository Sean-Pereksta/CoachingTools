# KPI Impact Wipers and coaching-tool scope loading

KPI Impact now discovers Wiper Rate automatically. Retail uses Wiper Count /
Wiper Jobs; Referral uses Wipers Accepted / Wipers Offered (including the legacy
Asked/Accept spellings). Both sources normalize into accepted/offered counts
before merging, so combined rates and removal impact use weighted counts rather
than averages of percentages. The source-wide fallback and 23% goal match
Coaching Gaps. Zero offers remain unavailable rather than a zero-percent result.
Source normalization runs after chunk preparation so the selected count pair
does not change at a 450-row boundary.

KPI Impact, QA Scores, Coach Timeline and Audit / Checklist now retain their
completed scoped batches, subscribe before the initial read, serialize refreshes,
discard obsolete scope results, and coalesce background notifications. Scope
switches clear the previous view immediately; background refreshes remain quiet.
Closing a frame releases subscriptions and pending refresh timers. Timeline and
Audit also clear computed summaries when the selected population has no rows.

The KPI presentation wrapper now reaches the desktop's shared data owner through
its accessible ancestor. Hosted intelligence tools reuse the desktop directory.
The heavy KPI/QA preparation uses returned data instead of re-reading an
independently invalidated cache. Timeline/Audit's direct chunk optimization is
limited to All people; restricted or additional scopes use the shared scoped
reader, including identity readiness, source versions and roster membership.

## Validation

All browser fixtures use fresh contexts and synthetic imports. They do not read,
clear or modify existing user imports.

- `npm test`: the complete automated suite, including the new Wiper and refresh
  regressions, existing scope/readiness checks, imports, desktop, All-Star,
  verification, Horizon and QA builder coverage.
- `npm run test:coaching-tools:browser`: real Edge, actual desktop services and
  the nested KPI wrapper; all five sources stored in chunk format; identity
  enrichment during opening; three coaches, a completed assignment change and
  restoration, one coach, All people, zero matches and rapid final-scope changes.
  It checks both report sources, source preservation, quiet background updates,
  settled unchanged setup, and Retail/Referral/blended Wiper rates.
- `tests/coaching-tools-refresh.test.cjs`: completed batch retention, serialized
  latest refreshes, notification bursts during active reads, scope cancellation,
  explicit abort behavior and page-close cleanup.
- `tests/dock-chunk-scope.test.cjs`: restricted reads, readiness, intersecting
  scopes, record/management reads, All people chunk caching, invalidated pointers,
  mid-read scope/source changes, complete API forwarding and progress cleanup.
- `tests/kpi-impact-wipers.test.cjs`: exact count headers, source preferences,
  fallback aliases, weighted source/representative totals, exclusions, zero
  denominators, percentage-only/incomplete pairs and chunk-boundary parity.
- `npm run package-suite`: portable build and suite validation.

Browser checks accept `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`; use the installed
Playwright package and the local Edge/Chromium executable when needed.
