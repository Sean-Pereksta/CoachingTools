# CoachTools Celestial Suite

The CoachTools Command Center lives at `All-Star-TXT/suite/index.html`.

## Goal

Give All-Star / CoachTools one launchpad for the six local coaching analyzers while preserving the local-storage contract they already use.

The command center deliberately does **not** rename or migrate the five weekly data docks. Instead, tools are opened as same-origin `iframe.srcdoc` documents so their existing `localStorage` calls resolve against the same origin and therefore see the same selected weekly dataset.

## Shared weekly data docks

- `myone2.dock.retail`
- `myone2.dock.referral`
- `myone2.dock.qa`
- `myone2.dock.coaching`
- `myone2.dock.checklist`

## Tools

The command center recognizes these canonical packaged filenames:

- `tools/master-loader-generator.html`
- `tools/coaching-gaps.html`
- `tools/coach-timeline.html`
- `tools/kpi-impact.html`
- `tools/qa-scores.html`
- `tools/audit-checklist-documentation.html`

It also recognizes the original uploaded names (`myone_master_generator(2).html`, `Coachinggaps14.html`, `CoachTimeline3.html`, `kpi_impactUpdated.html`, `qa_scores.html`, and `audit_checklist_documentation.html`) when using **Install / Refresh Tool Pack**.

## How tool loading works

1. On startup, the command center tries to fetch all six files from `./tools/`.
2. If all files are present, they are immediately available.
3. If they are not present, the user can select the six HTML files once with **Install / Refresh Tool Pack**.
4. Installed HTML is cached in IndexedDB (`coachtools-suite` / `tools`).
5. Every tool launches in `iframe.srcdoc`, preserving one shared browser origin and one weekly-data store.

## Data Galaxy

The top dashboard shows live loaded / empty state and approximate storage size for each of the five weekly docks. A weekly data selection therefore becomes visible immediately across every analyzer.

## Backups

**Export Suite Backup** writes the five shared docks plus known tool preference keys to JSON. **Import Backup** restores those keys. All-Star's own model/report persistence and IndexedDB caches are intentionally left separate.

## Weekly Data Builder integration

The packaged Weekly Data Builder can post a generated coach/team loader back to the parent Command Center with `coachtools:openLoader`. The parent opens that generated loader same-origin, so its selected coach/team data writes directly into the same five docks used by all six analyzers.

## Design

The UI uses a dark celestial command-center treatment: star field, constellation cards, glowing data status points, violet/cyan lighting, responsive cards, full-screen tool workspace, search, backup/restore, and direct navigation back to the All-Star report.
