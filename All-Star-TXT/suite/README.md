# CoachTools Celestial Suite

This package adds a unified launcher for the standalone coaching analyzers that already use the MyOne local data docks.

## What changed

- One celestial Command Center launches all six tools inside one parent document.
- Tools run through `iframe.srcdoc`, so their existing `localStorage` calls share the Command Center's storage origin instead of behaving like unrelated local HTML files.
- The five canonical shared docks remain unchanged:
  - `myone2.dock.retail`
  - `myone2.dock.referral`
  - `myone2.dock.qa`
  - `myone2.dock.coaching`
  - `myone2.dock.checklist`
- The Weekly Data Builder keeps its existing compressed, per-coach packaging strategy.
- A new **Open Loader in Suite** action opens the generated All / Team / Search / Coach selector inside the Command Center. When the selection is loaded, every analyzer sees the same docks immediately.
- A Storage Galaxy panel shows which shared sources are currently loaded and the approximate localStorage footprint.
- Suite backup/export preserves shared dock keys and the small per-tool preference keys. All-Star IndexedDB remains owned by All-Star's existing cache/package workflow.

## Tools

1. Weekly Data Builder
2. Coaching Gaps
3. Coach Timeline
4. KPI Impact
5. QA Scores
6. Audit & Documentation

## Local entrypoint

Open `suite/coachtools-suite.html`. The complete portable dashboard is stored as compact gzip/base64 payload chunks in `suite/payload/`. The entrypoint reconstructs the full 1.09 MB suite in-place, keeping all embedded tools on one storage origin.

A separate single-file `CoachTools-Suite-Portable.html` is also produced by the source package supplied with this change.

## Storage design

The suite intentionally does **not** rename the existing `myone2.dock.*` keys. Changing those keys would break the current analyzers and previously generated Master Loaders. The Command Center solves the actual isolation problem by keeping the tools in one parent storage origin.

Tool-specific UI preferences continue under their existing keys (for example `qaOnlyDash.settings.v6`, `impactTool.activeTab`, and `myone.master.v2.setup`).

All-Star's own persistence contract remains separate because it contains models, report settings, Qualtrics settings, and IndexedDB caches that are not equivalent to the five weekly data docks.

## Recommended weekly flow

1. Open `coachtools-suite.html`.
2. Choose **Update Weekly Data**.
3. Import the weekly Coaching, Retail, Referral, QA and Checklist files.
4. Review name corrections and saved Team / Coordinator groups.
5. Choose **Open Loader in Suite**.
6. Select All, a saved Team, search results, or one coach.
7. Load the selection.
8. Return to the Command Center and open any analysis tool. No second data import is required.
