# All-Star scoped startup repair

All-Star could stop responding after the Horizon scope changes because every
filtered row re-read and normalized the complete scope preference. Startup also
scanned all source populations and rebuilt teams even when its caller requested
deferred indexes. A large representative selection amplified both costs.

The loader now captures one scope matcher per batch, reuses unchanged membership
inputs, and yields while discovering local roster membership. Unrestricted
startup retains its restored team index; restricted startup defers team building.
Source availability checks use the complete backing arrays. Shared management
reads remain unscoped, and report/Qualtrics reads use the current view scope.

Coach changes invalidate scope-dependent run/research indexes. An asynchronous
index build cannot publish rows from a previous scope. Notifications received
during startup or an import are coalesced and reconciled afterwards. A scope
change during shared reconciliation cancels that attempt safely.
Startup retries that reconciliation within the same hydration job. The portable
builder also includes the previously omitted shared scope adapter and rejects
remaining external shared/vendor script dependencies.

## Browser comparison

Measured in real headless Microsoft Edge on the same machine, using synthetic
50,000-row QA data and 200 selected representatives (10,000 visible rows). The
baseline served the original code from commit
`6184699e374ce478c1464a54eeadd79f5b43ba05`. These timings are observations, not
machine-independent assertions.

| Measurement | Original | Updated |
| --- | ---: | ---: |
| First load | 28.43 s | 7.08 s |
| Cached reopen | 21.33 s | 2.44 s |
| Longest heartbeat gap, first load | 14.91 s | 0.65 s |
| Longest heartbeat gap, cached reopen | 20.07 s | 0.23 s |

Both versions retained all 50,000 backing rows and showed the same 10,000 scoped
rows. The updated flow reported no browser runtime errors.

## Regression checks

- `npm run test:prefetch`: includes constant scope-read bounds, deferred startup
  work, yielding, unchanged-scope reuse, full backing persistence, names-only
  roster joins, scope-switch cache invalidation, an in-flight index race, and
  startup/import notification delivery.
- `npm run test:allstar`: portable generation, package validation, import and
  persistence, report/research, weekly/monthly, and data-management regressions.
- `npm run test:horizon`: shared scope and cross-application isolation.
- `npm run test:desktop`: shared import/storage and desktop contracts. The local
  storage-server check also passes when allowed to connect to its loopback server.
- `node apps/allstar/tests/browser-scope-startup.test.js`: real modular HTTP and
  portable `file://` startup, cached reopen, coach/representative/all scopes,
  unchanged central-source reuse, and full-population reload preservation.

Browser checks use the existing `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` options.
Only synthetic data is used; no existing user storage is cleared or migrated.
