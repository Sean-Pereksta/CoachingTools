# Horizon workspace and shared data views

The Horizon home page uses sunrise artwork, deep teal surfaces, dimensional champagne-gold objects, and amber accents. Its PNG family is genuine high-resolution image-generated raster artwork, packaged as **512 × 512 PNGs** for the UI. Home and Start share the new mountain/sunrise emblem; the top-left header uses the separately generated Horizon brand lockup. Windows launcher artwork uses the same new emblem. The former line-art vector assets and generators are retired.

**Update Data** and **Clean Upload** stay visible on the home page at desktop and phone widths, each with its own generated PNG artwork. Update Data refreshes remembered sources; Clean Upload starts a fresh file selection. The established import and storage workflows remain responsible for saving source data.

The middle of the home page has two compact panels: the current data view on the left and editable favorites on the right. Tools and folders open with one click, including remembered minimized apps. Search finds tools by name, description, and keywords. The full tools grid sits directly below the two panels.

Folder dialogs show the sunrise landscape through translucent surfaces and tool cards. The current-view panel uses the people PNG and its Change button uses the settings PNG; the former stray letter/glyph is removed. Taskbar app artwork has independent dimensions of 30 px on desktop and 27 px on phones, so it does not inherit the larger desktop-tile sizes.

The small Feedback action on the right of the taskbar opens a branded modal for Microsoft Forms. Until the real form link is configured, it shows a clear connection placeholder and does not submit responses.

Coaching Gaps, KPI Impact, and QA Scores use coordinated compact petrol-teal command ribbons, generated app artwork, ivory and amber accents, and teal/blue/gold filter and summary surfaces. Their existing report controls, charts, dates, exports, and calculations remain intact. KPI Impact's wrapper keeps its coaching enhancements without the former purple Galactic styling. QA's Horizon theme retains the existing stored theme value and restores earlier preferences; its Light/Horizon buttons and keyboard-accessible metric drilldowns remain available.

## Choose a coach once

Click the current data view or **Change**, search for a coach, and select them. Connected reports receive only that coach and their current representatives. The current view remains visible in an open report’s top bar; it can be changed there without returning home. Choose **All people** in the picker to restore the full view.

The shared application reader applies the selection before returning current datasets, retained histories, streamed chunks, and people directories. Scope participates in cache keys. Changing it invalidates previous views, clears stale results, and prevents a completed request for an old scope from rendering after a switch. A scope with no matches returns an empty view.

Current representative ownership and exact normalized full names/known identity aliases determine membership. QA and checklist records can match the selected coach’s representatives even when those sources do not contain a coach column. An unrelated supervisor value does not expand the roster. Other coaches sharing the same team are excluded from a single-coach view.

All-Star Report, Verification All Star, Performance Scorecard, People Profiles, Command Center, Coaching Gaps, QA Scores, and other shared-data consumers use these scoped views. Verification also limits its uploaded monthly roster and exports to the selected people. Saved source arrays, import history, and the identity registry remain intact, so changing coaches does not delete or replace another team’s data.

The Dynamics Contact Center Checklist opens a separate external system and clearly identifies that it uses its own filters. Data Manager and file-building tools retain their data-management purpose; the global view does not erase their underlying files.

## Developer contract

- Use `CoachToolsAppData.get`, `getMany`, `getHistory`, `streamRows`, and `filterPeople` for report reads. These intersect explicit narrower requests with the current global view.
- `CoachToolsData.getCurrent` and `getHistory` are raw management APIs. `CoachToolsAppData` accepts explicit `unscoped: true` only for intentional management workflows.
- `getScopeKey()` identifies the current view for derived caches; `subscribe()` also notifies consumers when scope changes.
- `CoachToolsData.resolveReadScope`, `rowMatchesScope`, `filterDataset`, and `filterPeople` support consumers with uploaded or separately cached data.

Run `npm run test:horizon` for data-isolation, cross-app, roster-switch, PNG, picker, favorites, deferred-window, and QA theme-compatibility tests.

The exact built-in image-generation prompts are stored in `icons/horizon/artwork-prompts.json`. To package approved replacement PNG originals, run `node build/install-horizon-artwork.js --source-directory <originals-directory>` in a development environment with `sharp`, or pass `--sharp-module` with its installed path. The shipped app needs no image-rendering dependency. The installer validates the complete set, optimizes real raster files, installs the logo lockup, and refreshes compatibility PNG/ICO copies; it does not render SVGs.
