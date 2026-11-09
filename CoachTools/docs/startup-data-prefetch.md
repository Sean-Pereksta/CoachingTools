# Automatic data preparation

After the desktop appears, MyOne prepares committed shared datasets during idle
time. The restored active tool, recent tools, and favorites determine priority.
No tool windows or workbook parsers are opened by this preparation.

Background preparation reads one source at a time. Each source must be at most
8 MiB of original file data and 25,000 rows; the combined plan, including already
cached sources, stays within 24 MiB and 60,000 rows. These are workload limits,
not exact memory estimates: decoded workbook rows can occupy more memory than
the original file. Sources with no recorded size or row count are skipped.
Larger sources load when a tool requests them.

Opening a tool starts its eligible declared shared-data reads alongside its document and
scripts. A matching background read is reused, and tools in the desktop share
the same cache. Closing a tool cancels its remaining preparation. The desktop
pauses its background queue while a visible tool shell or storage sync is
loading, then resumes afterward. One unreadable source cannot block the rest.

The selected scope also controls preparation. With one coach selected, only
saved sources proven to contain that coach's subset are speculatively prepared.
Broader, unrelated, or uncertain source populations are left to the tool's
normal scope-aware load. Changing scope cancels remaining optional reads and
rebuilds the preparation queue for the new selection. This never deletes data
or widens the saved import scope. A display-scope change alone does not split an
existing all-people workbook into a separately stored coach dataset; a physically
scoped Clean Upload provides that smaller persisted input.

Cache entries are checked against the committed dataset identity. Replacements
and removals invalidate old entries, including uploads that finish during a
background read. External-window updates refresh metadata before notifying
subscribers. Report cache entries also include the active data view; a read
started for an earlier selection cannot publish after a scope change. Existing
saved scopes and import validation still apply.

All-Star can reuse the desktop cache when refreshing its central shared sources.
This is an intentional unscoped management copy of the complete stored source,
cloned before All-Star edits it. Report rows and exports still apply the active
coach view, so opening first for one coach does not remove another coach's rows
from the backing source when the view changes.
Its separate saved source-cache restoration, calculations, and rendering still
run through its existing startup pipeline. Standalone tools retain their local
storage fallback; browsers with opaque file-frame origins cannot share the
parent memory cache.

Run `npm run test:prefetch` and `npm run test:myone` for the cache, scheduling,
upload-race, bridge, and import regressions. Timing improvements depend on the
datasets and browser. No production speed percentage has been measured.

The data-layer staged-upload contract check accepts Windows line endings.
