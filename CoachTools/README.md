# CoachTools

CoachTools is a portable coaching-intelligence desktop. Every application remains a separate tool under `apps/`, while the desktop keeps opened tools alive in retained iframe sessions so they can be minimized and restored without losing in-session work.

## Recommended automatic workflow

1. Put the current weekly Retail, Referral, QA, Documented Coaching, and Checklist files in `storage/`.
2. On Windows, run `START COACHTOOLS.bat`. On macOS, run `start-coachtools.command`. You can also run `npm run serve` anywhere Node.js is available.
3. CoachTools checks which of the five shared datasets are already loaded.
4. Only missing datasets are matched and imported from `storage/`. Existing datasets are never automatically replaced.
5. If a file is ambiguous or an unscoped import may exceed safe browser storage, CoachTools stages the files and asks you to review them in **Weekly Data**.
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

Place an optional wallpaper at `graphics/background.png`. It is centered and cover-scaled behind a subtle readability overlay. If it is absent or unreadable, the built-in gradient remains fully functional. Application icons stay under `icons/`.

## Weekly Data and shared storage

Manual and automatic imports use `shared/coachtools-import.js` for workbook reading, source classification, header inspection, and scoped dataset preparation. Weekly Data retains multi-file detection, manual placement, coach-name corrections, Teams, Coordinators, saved groups, Select All, search, and individual-coach selection.

The five authoritative shared keys are unchanged:

```text
myone2.dock.retail
myone2.dock.referral
myone2.dock.qa
myone2.dock.coaching
myone2.dock.checklist
```

Automatic loading checks those keys first and writes only missing datasets. Retail/Referral files still require filename hints when their compatible headers are indistinguishable. Ambiguous files are never guessed into a dataset.

Use **Scan Storage Folder** from the Start menu, data-readiness panel, or top command bar to scan again without restarting. Use **Update Data** to open the full Weekly Data workflow at any time.

## Backup and restore

**Backup CoachTools** exports the shared docks, saved scope, dashboard preferences, and lightweight desktop settings such as Favorites and the open-app list. It deliberately excludes live iframe contents, large IndexedDB caches, and saved All-Star report snapshots. Continue using All-Star's own package/export tools for those records.

## Included applications

- All-Star Report
- Weekly Data
- Coaching Gaps
- Coach Timeline
- KPI Impact
- QA Scores
- Audit / Checklist

## Add an application

1. Place an HTML file in `apps/`, or use `apps/application-name/index.html`.
2. Add optional `coachtools-*` metadata to its `<head>`; see `docs/APP-MANIFEST.md`.
3. Place custom icon art at `icons/application-name.png`.
4. Run `npm run manifest`.
5. Run `npm run validate-suite`.

The generator preserves customized entries already present in `apps.json`. Use `node build/generate-app-manifest.js --refresh-metadata` when HTML metadata should replace existing manifest values. A missing icon automatically uses initials.

## Validate and create a ZIP

```text
npm test
npm run package-suite
```

The package command validates the suite, rebuilds All-Star's portable fallback, and creates `dist/CoachTools.zip` with one top-level `CoachTools/` folder. The ZIP explicitly includes `CoachTools/graphics/` and an empty `CoachTools/storage/` entry even when their `.gitkeep` placeholders are excluded.

## Offline behavior

The active suite packages SheetJS, LZ-String, Chart.js, html2canvas, jsPDF, html2pdf.js, and JSZip under `vendor/`. Normal imports, charts, PDF exports, and ZIP exports do not require a CDN. License notices are kept under `vendor/licenses/`.
