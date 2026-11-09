# Horizon icons

The active icon family lives in `horizon/`: 29 individual **512 × 512 PNGs** for all applications, folders, and desktop controls, including Update Data, Clean Upload, and Feedback. These are optimized copies of high-resolution, individually image-generated raster artwork. Home and Start intentionally share the Horizon emblem. The suite loads the PNGs from the app manifest, folder configuration, and desktop control map.

The design uses sculpted petrol-teal glass tiles, dimensional brushed champagne-gold objects, refined graphite bevels, and amber sunrise lighting. Every icon is self-contained and available offline. Icons are preloaded during startup and reused by desktop cards, favorites, the taskbar, menus, and dialogs. The original generated brand lockup is installed separately at `graphics/horizon-logo.png` for the top-left header.

The PNGs at the root of this directory are compatibility copies using established filenames. `coachtools-galaxy.ico` and `coachtools-galaxy.png` retain their filenames for Windows launcher compatibility and now contain the Horizon mark. Wallpaper and loading artwork remain in `graphics/`.

Exact generation prompts and provenance are in `horizon/artwork-prompts.json`. `build/install-horizon-artwork.js` packages approved PNG originals; it does not render vectors or synthesize graphics in code. The previous vector generators have been retired.
