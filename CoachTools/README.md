# CoachTools

CoachTools is a portable desktop for the All-Star coaching and reporting suite. The complete runtime lives in this folder; no application depends on another location in the repository.

## Start CoachTools

Double-click `index.html`.

That direct-file route is intentionally supported. For the most consistent shared storage behavior across Chrome, Edge, Safari, and Firefox, use one of the optional launchers instead:

- Windows: `START COACHTOOLS.bat`
- macOS: `start-coachtools.command`
- Any platform with Node.js: `npm run serve`

The launcher serves only this folder on `http://127.0.0.1` and opens CoachTools. Node.js is not required for normal direct-file use.

## Update Weekly Data

1. Open **Weekly Data** from the desktop.
2. Import the weekly source files. Multi-file detection, manual replacement, coach-name corrections, Teams, Coordinators, Select All, search, and saved groups remain available.
3. Choose **Generate Master Loader**. A portable loader downloads and the same scope selector opens inside Weekly Data.
4. Select all coaches, a saved Team or Coordinator group, search results, or an individual coach.
5. Choose **Load Selected Data**. The five existing `myone2.dock.*` keys are updated for every compatible CoachTools app.

The desktop refreshes its readiness indicators automatically. It never creates duplicate copies of the weekly docks.

## Included applications

- All-Star Report
- Weekly Data
- Coaching Gaps
- Coach Timeline
- KPI Impact
- QA Scores
- Audit / Checklist

The supplied HTML tools remain separate, replaceable applications under `apps/`. All-Star keeps its modular JavaScript, CSS, Qualtrics, persistence, and regression assets together under `apps/allstar/`.

## Add an application

1. Place an HTML file in `apps/`, or use `apps/application-name/index.html`.
2. Add optional `coachtools-*` metadata to its `<head>`; see `docs/APP-MANIFEST.md`.
3. Place custom icon art at `icons/application-name.png`.
4. Run `npm run manifest`.
5. Run `npm run validate-suite`.

The generator preserves customized entries already present in `apps.json`. Use `node build/generate-app-manifest.js --refresh-metadata` when HTML metadata should replace existing manifest values.

## Replace an icon

Create a 512 × 512 PNG and save it at the path listed in `apps.json`, for example:

```text
icons/qa-scores.png
```

Missing images are expected while artwork is being created. CoachTools shows polished initials instead of a broken image.

## Shared data and persistence

The five shared docks keep their original names:

```text
myone2.dock.retail
myone2.dock.referral
myone2.dock.qa
myone2.dock.coaching
myone2.dock.checklist
```

Application preferences, All-Star definitions, and IndexedDB caches stay separate. See `docs/STORAGE-CONTRACT.md` before changing any key or database.

**Backup CoachTools** in the Start menu exports the shared docks, scope, dashboard preferences, and known lightweight settings. Large IndexedDB caches and saved report snapshots are deliberately excluded; continue using All-Star's own package/export tools for those records.

## Validate and create a ZIP

```text
npm run validate-suite
npm run package-suite
```

The package command rebuilds All-Star's portable fallback, then creates `dist/CoachTools.zip` with one top-level `CoachTools/` folder. It excludes `.git`, `node_modules`, temporary files, and prior top-level build output.

## Offline behavior

The active suite packages SheetJS, LZ-String, Chart.js, html2canvas, jsPDF, html2pdf.js, and JSZip under `vendor/`. The included applications therefore do not require a CDN for their normal imports, charts, PDF exports, or ZIP exports. License notices are kept under `vendor/licenses/`.
