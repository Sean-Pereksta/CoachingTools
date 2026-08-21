# CoachTools Storage Contract

This document defines storage names that must remain backward compatible. Filename and interface changes do not authorize renaming these records.

## 1. Central CoachTools data

The authoritative home for large shared datasets is IndexedDB database
`allStarImportedDataCache.v1`, schema version 8. `window.CoachToolsData` is the
only supported abstraction for new application code.

Recognized dataset types are:

- `weeklyRetail`
- `weeklyReferral`
- `monthlyRetail`
- `monthlyReferral`
- `qa`
- `documentedCoaching`
- `checklist`
- `compCoaching`

Use `CoachToolsAppData.get(type)`, `getMany(types)`, `streamRows(type, options)`,
`getVersion(type)`, and `subscribe(types, listener)` in applications. The adapter delegates to
`CoachToolsData.getCurrent(type)`, `streamRows(type, options)`, `getHistory(type)`,
`getDatasetVersion(type)`, `getImportHistory()`, and `inspectDataset()` instead of reading the
database stores directly. Current pointers never duplicate the source data;
they reference one canonical record in `coachtoolsDatasets`.

`CoachToolsData.ready()` initializes current pointers and metadata only. Full
dataset records are read on demand and cached in memory by dataset ID/version.
Large consumers should prefer `streamRows()`; it reads one stored chunk at a
time and can filter by `scope`, `coachIds`, `personIds`, coach/person names, or a
row predicate before yielding. History and import-history limits are applied by
IndexedDB cursors rather than by materializing and slicing the full stores.

Clean Upload uses `CoachToolsImport.discoverFile()` for a bounded header preview
and a unique-value scan of the ownership column. The raw workbook is not expanded
into full row arrays until scope selection; `materializeDiscoveredEntry()` then
constructs only header and matching rows (or all rows for an explicit All-people
selection).

## 2. Temporary legacy compatibility

| Dataset | Compatibility localStorage key |
| --- | --- |
| Retail | `myone2.dock.retail` |
| Referral | `myone2.dock.referral` |
| QA | `myone2.dock.qa` |
| Documented Coaching | `myone2.dock.coaching` |
| Checklist / Correctives | `myone2.dock.checklist` |

These keys are migration inputs and an explicit standalone-compatibility
output only. Normal startup and imports do not recreate them. IndexedDB remains
authoritative and retains all history. New code must not treat these keys as a
database or create additional per-app copies. The decoded compatibility view
retains the established shape:

```json
{
  "meta": {
    "fileName": "weekly-source.xlsx",
    "totalRows": 1200,
    "masterLoaderSelection": ["Coach Name"],
    "masterLoaderGeneratedAt": "2026-08-11T00:00:00.000Z"
  },
  "workbook": {
    "sheets": ["Sheet1"],
    "data": {
      "Sheet1": { "aoa": [] }
    }
  }
}
```

`shared/coachtools-storage.js` migrates an existing dock into IndexedDB in the
background or on first request. `materializeLegacyCompatibility()` is the only
approved way to intentionally recreate a dock for an old standalone tool.
Lightweight UI settings remain in localStorage.

### Dataset notifications

CoachTools uses these same-origin signals after a dock changes:

- custom event: `coachtools:data-updated`
- custom event: `coachtools:scope-updated`
- native browser `storage` event
- BroadcastChannel: `coachtools-data-v2`, when available
- migration BroadcastChannel: `coachtools-data-v1`, retained for older tools
- parent-frame `postMessage`, for the desktop shell

New consumers should call `CoachToolsAppData.subscribe()` or
`CoachToolsAppData.subscribeScope()`. The adapter compares dataset versions,
invalidates only changed records, and then rereads current data. The shared module
owns event, BroadcastChannel, storage-event, and parent-frame compatibility.
Legacy consumers may reread the compatibility dock during the transition.

### Suite metadata

| Purpose | Key |
| --- | --- |
| Current selected scope | `coachtools.scope.v1` |
| Last successful Clean Upload scope | `coachtools.scope.clean.v1` |
| Lightweight update timestamps (canonical) | `coachtools.data.meta.v2` |
| Migration metadata mirror | `coachtools.data.meta.v1` |
| Desktop favorites | `coachtools.desktop.favorites.v1` |
| Recently opened tools | `coachtools.desktop.recent.v1` |
| Processed storage-file metadata | `coachtools.storage.processed.v2` |
| Remembered browser-folder file metadata | `coachtools.desktop.rememberedFolderFiles.v2` |
| Allstar central synchronization identities | `allStarCoachToolsSync.v2` |
| Future desktop preferences | `coachtools.desktop.preferences.v1` |

`coachtools.scope.v1` describes the current view without changing the meaning of the weekly docks. Its supported modes are All, Department, Team, Coordinator, Coach, and Representative. A normalized import snapshot includes `mode`, `label`, `personId`, `coachPersonIds`, `coachKeys`, `coaches`, `representatives`, `department`, `team`, `coordinator`, deterministic `scopeHash`, and diagnostic-only `capturedAt`. `capturedAt` is never part of the hash.

## 3. Tool-specific preferences

These stay separate from shared weekly data:

- Coaching Gaps: `myone2.gaps.prefs`, `myone2.gaps.panelCollapsed`, and per-team keys under `myone2.teamAnalysisChecklist.*`
- Coach Timeline: `myone2.coachSpeed.columnMap`, `myone2.coachSpeed.sidebarCollapsed`
- QA Scores: `qaOnlyDash.settings.v6`
- KPI Impact: `impactTool.activeTab`
- Weekly Data setup: `myone.master.v2.setup`

Shared application data must not be stored in tool-specific preference keys.

## 4. All-Star localStorage

The following names and stored structures are preserved:

- `allStarStandaloneModels.v1`
- `allStarResearchItems.v1`
- `allStarResearchMetrics.v1`
- `allStarResearchResultCache.v3`
- `allStarOrgBuilder.v1`
- `allStarRepAliases.v1`
- `allStarRunSettings.v2`
- `allStarPdfOptions.v1`
- `allStarRunPresets.v1`

The general CoachTools backup includes definitions and lightweight options where practical. It deliberately excludes `allStarResearchResultCache.v3`; All-Star remains the authority for its own full data package and exports.

## 5. All-Star / CoachTools IndexedDB

### `allStarImportedDataCache.v1`, schema version 8

- `meta`, key path `id`
- `sourceData`, key path `id`
- `books`, key path `id`
- `misc`, key path `id`
- `coachtoolsDatasets`, key path `id`; canonical dated dataset records
- `coachtoolsDatasetChunks`, key path `id`; large canonical datasets split into ordered chunks
- `coachtoolsCurrent`, key path `datasetType`; current record pointers only
- `coachtoolsImports`, key path `id`; import, duplicate, replacement, and removal audit history
- `coachtoolsPeople`, key path `personId`; canonical people, aliases, source spellings, roles, teams, departments, and relationships
- `coachtoolsIdentityReviews`, key path `id`; uncertain-match reviews and reversible merge snapshots

Schema 8 adds compound dataset indexes for type/period/import time and
type/scope/period/fingerprint lookups, plus persistent role, team, department,
coach-relationship, normalized-name, and alias indexes for `coachtoolsPeople`.

Canonical dataset records and current pointers retain `scopeSnapshot`, `scopeHash`,
`scopeMode`, `scopedRowCount`, `scopeMatchDiagnostics`, and `scopedFingerprint`.
Automatic comparison and replacement are therefore performed against the active
scope rather than the full physical workbook.

`CoachToolsIdentity` is the supported identity API. Exact normalized full-name
and known-alias matches can resolve automatically. Partial or last-name-only
matches are review candidates and must not be silently merged.

### Shared-folder synchronization

Files under `storage/` are synchronized source material. Each browser keeps its
own IndexedDB cache; IndexedDB is never treated as a OneDrive-shared database.
After the desktop is visible, startup requests only the `/api/storage` listing
and compares path, filename, size, modified timestamp, dataset type, and the
active `scopeHash` with `coachtools.storage.processed.v2`. Unchanged scoped subsets are not
downloaded or parsed. New or changed files are downloaded lazily, classified,
and saved through `CoachToolsData.importDataset()`. Newer periods import,
identical fingerprints remain current without duplication, same-period changed
files create retained replacements, and older files cannot replace newer current data.

### `allStarResearchRenderedResults.v1`, schema version 1

- `renderMeta`, key path `itemId`
- `renderChunks`, key path `id`

### `allStarResearchMetricsDb.v1`, schema version 1

- `researchMetrics`, key path `id`; current record ID is `current`

### `allStarSavedReports.v1`, schema version 1

- `reports`, key path `id`

Do not include these potentially large caches and snapshots in automatic localStorage backups.

## 6. All-Star Qualtrics generator

Preserved localStorage keys:

- `coachingEmailGeneratorHireDateSettings.v1`
- `coachingEmailGeneratorCoachAliasOverrides`
- `coachingEmailGeneratorReportAudience.v1`
- `coachingEmailGeneratorReportWeightOrder`
- `coachingEmailGeneratorOtherRuleIds`
- `coachingEmailGeneratorUrgencyCoverage.v1`
- `coachingEmailGeneratorOrganizationSummary.v1`
- `coachingImpactWorkspaceSettings.v1`
- `coachingEmailGeneratorEmailIntroHtml`
- `coachingEmailGeneratorSavedEmailIntroHtml`
- `coachingEmailGeneratorSavedEmailIntroAt`

Preserved IndexedDB database: `coachingEmailGeneratorDB`, schema version 1.

- `rules`, key path `id`
- `problemHistory`, key path `id`
- `settings`, key path `key`

All-Star's generated Qualtrics carrier continues to use `srcdoc`; this retains the parent application's storage origin and therefore keeps existing rules and settings visible.

## 7. Origin and launch behavior

All suite apps live below the same `CoachTools/` directory and open by direct iframe URL. Under `http://127.0.0.1`, the desktop and apps have a conventional shared origin. Browser treatment of `file://` storage and local frames is implementation-dependent, so the optional local launcher is the cross-browser reliability path. Direct file opening remains available and is not built around `fetch()` or runtime directory enumeration.

Before changing persistence, validate this sequence:

1. Open CoachTools.
2. Open Weekly Data and load a scope.
3. Return to the desktop and confirm all eight readiness values update.
4. Open Coaching Gaps, QA Scores, Coach Timeline, and KPI Impact.
5. Confirm each reports the same IndexedDB dataset IDs/versions and refreshes after an import.
6. Reopen All-Star and confirm models, research, organizations, aliases, run settings, PDF options, Qualtrics rules, and IndexedDB caches remain intact.
