# Selected-coach scope and Coaching Gaps

## Cause and repair

Restricted application cache keys include the identity registry revision and
weekly/monthly source revisions. A cold registry could hydrate while a dataset
was filtering, advancing its revision after the read captured its cache key.
Background identity learning could also advance it between datasets or during
Coaching Gaps' chunked preparation. The completed data was then immediately
discarded by `peek()`. Coaching Gaps used `peek()` to populate every source,
leaving its Coach/Team choices empty. All people omitted the registry revision
from its cache key, which explains why clearing scope restored the data.

Restricted reads now await initial identity readiness and retry if membership
changes during filtering or across a progressive batch. Completed identity
updates notify subscribed scoped tools. Explicit unscoped management reads and
All people do not wait for identity work.

Coaching Gaps retains the returned data batch for synchronous parsers instead
of re-reading a cache that background learning may invalidate. Its frame's
chunked preparation uses the same returned batch. It subscribes before opening,
serializes refreshes, discards obsolete results, and retries the final selection
when a scope or source update supersedes an in-flight load. Closing/cancelling
a load does not start another load. No imported source is modified by scoping.

Large shared roster discovery yields in bounded slices and reuses its completed
membership cache. Existing All-Star deferred indexes, one matcher per batch,
complete management sources, source reuse, and portable wiring remain intact.

## Behavioral validation

All fixtures are synthetic; no production imports or existing user storage were
used or cleared.

- `test:horizon`: cold real-registry hydration, changing membership during
  filtering/between datasets, identity notifications, unscoped current/history
  reads, exact roster membership, yielding and cache reuse, serialized Gaps
  refreshes, cancellation, and existing global/cross-application scope checks.
- `test:coaching-gaps:browser`: real Edge with the actual Coaching Gaps iframe
  and shared parent services. Three selected coaches, identity learning during
  opening, a completed assignment edit and restoration, individual coach,
  All people, group restoration, and rapid scope changes all pass. All four
  backing rows remain intact, with no page runtime errors. Serving the original
  shared loader reproduces the empty Coach/Team choices during enrichment.
- Complete `test:allstar` and `test:prefetch` suites pass. Desktop/import/storage
  checks pass, with the local storage-server test run with loopback access.
- Manifest checks, suite validation, and portable/package builds pass.

## Performance observations

Real headless Edge, same machine, baseline `ea1051a`. These are observations,
not fixed performance thresholds. Both All-Star versions retained 50,000 QA
backing rows and showed the same 10,000 selected rows. Unchanged central-source
reopens reused their sources; coach/all scope changes and complete reloads pass.

| All-Star measurement | Baseline | Updated |
| --- | ---: | ---: |
| Modular initial / cached load | 3.381 s / 2.238 s | 4.121 s / 1.739 s |
| Portable initial / cached load | 2.671 s / 2.973 s | 2.911 s / 1.525 s |
| Modular longest pause, initial / cached | 421 ms / 192 ms | 389 ms / 164 ms |
| Portable longest pause, initial / cached | 406 ms / 260 ms | 317 ms / 137 ms |

First-load timings varied, so these results do not establish an overall startup
speedup. Cached paths remained fast and the existing PR #195 protections passed.

A sequential 100,000-row shared-roster benchmark returned the same 684 members.
The longest browser pause fell from 64.4 ms to 18.2 ms. Initial discovery changed
from 63.9 ms to 99.4 ms due to yielding overhead; cached resolution remained
0.1-0.2 ms. The change improves responsiveness during that first lookup.

Browser tests accept `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`. The All-Star browser
test also accepts `ALLSTAR_STARTUP_ROWS=50000`.
