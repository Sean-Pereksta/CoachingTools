# CoachTools Suite Storage Contract

## Canonical shared weekly docks

| Source | localStorage key |
|---|---|
| Retail Stats | `myone2.dock.retail` |
| Referral Stats | `myone2.dock.referral` |
| QA | `myone2.dock.qa` |
| Documented Coaching | `myone2.dock.coaching` |
| Checklist | `myone2.dock.checklist` |

These keys are intentionally preserved for compatibility with the existing standalone tools and generated MyOne Master Loaders.

## Shared-origin rule

The portable Command Center embeds each tool with `iframe.srcdoc`. The embedded document inherits the parent document's storage origin, so existing `localStorage.getItem(...)` / `setItem(...)` calls reach the same five dock keys.

This avoids a data migration and avoids maintaining duplicate storage adapters inside every analyzer.

## Tool preference keys

Preferences remain tool-specific and are not merged into the weekly data docks. Examples currently used by the packaged tools include:

- `myone.master.v2.setup`
- `myone2.gaps.prefs`
- `myone2.gaps.panelCollapsed`
- `myone2.coachSpeed.columnMap`
- `myone2.coachSpeed.sidebarCollapsed`
- `qaOnlyDash.settings.v6`
- `impactTool.activeTab`

The apps that auto-detect a namespace continue to prefer the namespace that contains the most `.dock.*` keys.

## All-Star persistence

All-Star's model/report/Qualtrics localStorage keys and its IndexedDB databases are deliberately left unchanged. They contain application configuration and normalized report caches, not the same shape as the five MyOne weekly docks.

Suite backup/export includes matching localStorage keys but does not copy All-Star IndexedDB. Use All-Star's existing Package Imported Data / local cache workflows for the IndexedDB-backed report data.
