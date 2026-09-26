# CoachTools shared storage contract

## Canonical weekly docks

These keys are the contract between the weekly loader and the packaged analyzers. Keep them stable unless every producer and consumer is migrated together.

| Dataset | localStorage key |
| --- | --- |
| Retail | `myone2.dock.retail` |
| Referral | `myone2.dock.referral` |
| QA | `myone2.dock.qa` |
| Documented Coaching | `myone2.dock.coaching` |
| Checklist | `myone2.dock.checklist` |

## Tool consumers

- Weekly Data Builder: reads/writes all five docks.
- Coaching Gaps: reads all five docks.
- Coach Timeline: reads coaching + checklist.
- KPI Impact: reads retail + referral + coaching.
- QA Scores: reads QA + coaching.
- Audit & Documentation: reads checklist + coaching.

## Preference/state keys

Tool-specific preferences remain independent from weekly data. Current known prefixes/keys include:

- `myone.master.v2.setup`
- `myone2.gaps.prefs`
- `myone2.gaps.panelCollapsed`
- `myone2.coachSpeed.columnMap`
- `myone2.coachSpeed.sidebarCollapsed`
- `qaOnlyDash.settings.v6`
- `impactTool.activeTab`

## Why same-origin srcdoc

Each legacy analyzer can keep its current `localStorage.getItem(...)` / `setItem(...)` implementation. Launching its HTML through an `iframe.srcdoc` owned by the command center makes those calls resolve against the command center origin. That turns the five existing dock keys into a shared suite-level data bus without inventing a parallel storage schema.

## Separation from All-Star persistence

The All-Star report has its own app/model/report persistence and larger IndexedDB-backed data caches. The suite does not overwrite, alias or clear those stores. The five MyOne weekly docks are shared among the six analyzers; All-Star persistence remains independent unless a later migration explicitly bridges it.
