# Horizon workspace and shared data views

The Horizon home page uses sunrise artwork, deep teal surfaces, champagne glyphs, and amber accents. Every app, folder, and desktop control has its own bundled **512 × 512 PNG**. Editable icon masters are retained alongside the PNGs in `icons/horizon/`; the UI loads the PNG files. Windows launcher artwork uses the same Horizon mark.

**Update Data** and **Clean Upload** stay visible on the home page at desktop and phone widths. Update Data refreshes remembered sources; Clean Upload starts a fresh file selection. The established import and storage workflows remain responsible for saving source data.

The middle of the home page has two compact panels: the current data view on the left and editable favorites on the right. Tools and folders open with one click, including remembered minimized apps. Search finds tools by name, description, and keywords. The full tools grid sits directly below the two panels.

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

Run `npm run test:horizon` for data-isolation, cross-app, roster-switch, PNG, picker, favorites, and deferred-window tests.

To regenerate icon masters, run `node build/generate-horizon-icons.js`. Render PNGs with `node build/rasterize-horizon-icons.js` in a development environment with `sharp`, or pass `--sharp-module` with its installed path. The shipped app needs no image-rendering dependency. `generate-horizon-icons.js --install` installs PNG metadata and refreshes the app manifest after the images exist.
