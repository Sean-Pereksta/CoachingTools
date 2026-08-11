# CoachTools Storage Contract

This document defines storage names that must remain backward compatible. Filename and interface changes do not authorize renaming these records.

## 1. Shared weekly data

| Dataset | Required localStorage key |
| --- | --- |
| Retail | `myone2.dock.retail` |
| Referral | `myone2.dock.referral` |
| QA | `myone2.dock.qa` |
| Documented Coaching | `myone2.dock.coaching` |
| Checklist / Correctives | `myone2.dock.checklist` |

The Master Loader writes each value as LZ-String `compressToUTF16(JSON.stringify(dock))`. The decoded dock retains the established shape:

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

Do not duplicate these datasets under CoachTools-specific keys. `shared/coachtools-storage.js` is an abstraction around the same five values.

### Dataset notifications

CoachTools uses these same-origin signals after a dock changes:

- custom event: `coachtools:data-updated`
- custom event: `coachtools:scope-updated`
- native browser `storage` event
- BroadcastChannel: `coachtools-data-v1`, when available
- parent-frame `postMessage`, for the desktop shell

Consumers must still read the authoritative `myone2.dock.*` key after a signal. Events are invalidation notices, not another data store.

### Suite metadata

| Purpose | Key |
| --- | --- |
| Current selected scope | `coachtools.scope.v1` |
| Lightweight update timestamps | `coachtools.data.meta.v1` |
| Desktop favorites | `coachtools.desktop.favorites.v1` |
| Recently opened tools | `coachtools.desktop.recent.v1` |
| Future desktop preferences | `coachtools.desktop.preferences.v1` |

`coachtools.scope.v1` describes the current view without changing the meaning of the weekly docks. Its supported fields are `mode`, `label`, `team`, `coordinator`, `coaches`, and `updatedAt`.

## 2. Tool-specific preferences

These stay separate from shared weekly data:

- Coaching Gaps: `myone2.gaps.prefs`, `myone2.gaps.panelCollapsed`, and per-team keys under `myone2.teamAnalysisChecklist.*`
- Coach Timeline: `myone2.coachSpeed.columnMap`, `myone2.coachSpeed.sidebarCollapsed`
- QA Scores: `qaOnlyDash.settings.v6`
- KPI Impact: `impactTool.activeTab`
- Weekly Data setup: `myone.master.v2.setup`

Some supplied tools detect the active MyOne namespace by scanning existing `.dock.*` keys. Keep that behavior so older stored datasets remain discoverable.

## 3. All-Star localStorage

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

## 4. All-Star IndexedDB

### `allStarImportedDataCache.v1`, schema version 4

- `meta`, key path `id`
- `sourceData`, key path `id`
- `books`, key path `id`
- `misc`, key path `id`

### `allStarResearchRenderedResults.v1`, schema version 1

- `renderMeta`, key path `itemId`
- `renderChunks`, key path `id`

### `allStarResearchMetricsDb.v1`, schema version 1

- `researchMetrics`, key path `id`; current record ID is `current`

### `allStarSavedReports.v1`, schema version 1

- `reports`, key path `id`

Do not include these potentially large caches and snapshots in automatic localStorage backups.

## 5. All-Star Qualtrics generator

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

## 6. Origin and launch behavior

All suite apps live below the same `CoachTools/` directory and open by direct iframe URL. Under `http://127.0.0.1`, the desktop and apps have a conventional shared origin. Browser treatment of `file://` storage and local frames is implementation-dependent, so the optional local launcher is the cross-browser reliability path. Direct file opening remains available and is not built around `fetch()` or runtime directory enumeration.

Before changing persistence, validate this sequence:

1. Open CoachTools.
2. Open Weekly Data and load a scope.
3. Return to the desktop and confirm all five readiness values update.
4. Open Coaching Gaps, QA Scores, Coach Timeline, and KPI Impact.
5. Confirm each detects the same selected dock data.
6. Reopen All-Star and confirm models, research, organizations, aliases, run settings, PDF options, Qualtrics rules, and IndexedDB caches remain intact.
