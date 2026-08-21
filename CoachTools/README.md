# CoachTools

CoachTools is a portable coaching-intelligence desktop. Every application remains a separate tool under `apps/`, while the desktop keeps opened tools alive in retained iframe sessions so they can be minimized and restored without losing in-session work.

## Recommended automatic workflow

1. Put current or dated Retail Weekly, Referral Weekly, QA, Documented Coaching, and Checklist files in `storage/`.
2. On Windows, run `START COACHTOOLS.bat`. On macOS, run `start-coachtools.command`. You can also run `npm run serve` anywhere Node.js is available.
3. CoachTools checks the current pointers in the shared All-Star/CoachTools IndexedDB.
4. CoachTools compares dataset type, reporting period, and fingerprint. Newer periods import automatically; same-period changed files become retained replacements; duplicates and older files do not overwrite current data.
5. If a file is ambiguous or cannot be compared safely, CoachTools stages it for review in **Data Manager**.
6. Open several applications, minimize them, and switch between their live sessions from the bottom taskbar.

The local launcher serves only the CoachTools folder on `http://127.0.0.1`. Its `/api/storage` endpoint lists only direct `.xlsx`, `.xls`, and `.csv` files inside `storage/`; it does not browse other directories.

## Direct `index.html` workflow

Double-clicking `index.html` remains supported. Applications, the retained-window desktop, shared browser storage, and manual Weekly Data imports continue to work.

Browsers do not allow a local HTML file to enumerate a neighboring folder, so automatic `storage/` scanning is skipped in direct-file mode. Use **Weekly Data / Update Data** for manual imports, or start CoachTools with the included launcher when automatic scanning is wanted.

## Desktop behavior

- Single-click an application icon to select it; double-click to open it. Touch devices open with a normal tap.
- Each opened application receives its own iframe. Opening another tool does not reload or destroy the first tool.
- **Minimize** hides an application but preserves its live DOM, uploaded files, and UI state for the running desktop session.
- Clicking the active taskbar icon minimizes it. Clicking a minimized icon restores it. Clicking another open icon switches directly without reloading either application.
- **Close** destroys that application session. **Reload** intentionally reloads only the active application. **Pop Out** opens the application in its own browser window.
- The lightweight open-app list is remembered across a desktop refresh. Applications reopen, but arbitrary unsaved in-memory browser state is not claimed to survive a full refresh.

Place an optional wallpaper at `graphics/background.png`. It is centered and cover-scaled behind a subtle readability overlay. If it is absent or unreadable, the built-in gradient remains fully functional. Application and desktop-control icons stay under `icons/`; the built-in icon set is preloaded on startup and receives a small glow/scale treatment on mouse or keyboard focus.

The compact startup bar appears before the desktop or a remembered app session is revealed. It reports all eight shared datasets—Retail/Referral weekly and monthly, QA, Documented Coaching, Checklist, and Comp Coaching—plus the People Registry, then compares `storage/` with local IndexedDB history when the launcher is active. Direct `index.html` mode exits the startup check quickly and keeps manual Data Manager import available.

## Data Manager and shared storage

Manual and automatic imports use `shared/coachtools-import.js` for workbook reading, filename classification, header validation, period detection, and scoped dataset preparation. **Update Data**, the desktop readiness popup, Data Manager, and All-Star all accept multi-file batches and save recognized sources through the same IndexedDB API. Data Manager retains the prior Weekly Data grouping and scope workflow while adding loaders and current-data cards for every shared dataset.

A successful **Clean Upload** records the authoritative normalized scope only after every recognized source is saved. Later automatic updates restore that scope, filter before fingerprint comparison, and retain the existing data when ownership columns are missing or a scoped source unexpectedly falls to zero rows. QA follows the same rule through its `Team` column and canonical coach aliases; only **All people** keeps the full QA population.

Large shared data and canonical people are authoritative in `allStarImportedDataCache.v1`, schema version 7. The central API stores dated, scope-aware history once and keeps a pointer to the newest current record for each of these logical datasets:

```text
weeklyRetail, weeklyReferral
monthlyRetail, monthlyReferral
qa, documentedCoaching, checklist, compCoaching
```

The old `myone2.dock.*` keys remain a temporary current-data compatibility view for the existing embedded report readers; they are no longer authoritative and do not retain history. Ambiguous or structurally incompatible files are never guessed into a dataset. `CoachToolsIdentity` resolves exact names and aliases, records source spellings, keeps coach/representative relationships, and queues unsafe partial-name matches for review.

Use **Scan Storage Folder** from the Start menu, data-readiness panel, or top command bar to scan again without restarting. Use **Update Data** to open the full Weekly Data workflow at any time.

## Backup and restore

**Backup CoachTools** exports current compatibility views, saved scope, dashboard preferences, and lightweight desktop settings such as Favorites and the open-app list. It deliberately excludes full IndexedDB history, live iframe contents, and saved All-Star report snapshots. Continue using All-Star's own package/export tools for those records.

## Included applications

- All-Star Report
- Data Manager
- People Profiles
- Coaching Gaps
- Coach Timeline
- KPI Impact
- QA Scores
- Audit / Checklist
- Contact Center Checklist

## Add an application

1. Place an HTML file in `apps/`, or use `apps/application-name/index.html`.
2. Add optional `coachtools-*` metadata to its `<head>`; see `docs/APP-MANIFEST.md`.
3. Place custom icon art at `icons/application-name.png`.
4. Run `npm run manifest`.
5. Run `npm run validate-suite`.

The generator preserves customized entries already present in `apps.json`. Use `node build/generate-app-manifest.js --refresh-metadata` when HTML metadata should replace existing manifest values. Built-in app IDs are normalized to the standard icon filenames. A missing app icon tries `icons/default-app.png` before automatically using initials.

## Validate and create a ZIP

```text
npm test
npm run package-suite
```

The package command validates the suite, rebuilds All-Star's portable fallback, and creates `dist/CoachTools.zip` with one top-level `CoachTools/` folder. The ZIP explicitly includes `CoachTools/graphics/` and an empty `CoachTools/storage/` entry even when their `.gitkeep` placeholders are excluded.

## Offline behavior

The active suite packages SheetJS, LZ-String, Chart.js, html2canvas, jsPDF, html2pdf.js, and JSZip under `vendor/`. Normal imports, charts, PDF exports, and ZIP exports do not require a CDN. License notices are kept under `vendor/licenses/`.
