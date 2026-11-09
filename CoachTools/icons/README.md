# Horizon icons

The active icon family lives in `horizon/`: 26 distinct, individual **512 × 512 PNGs** for all applications, folders, and desktop controls. Each has an editable SVG master with the same filename. The suite loads the PNGs from the app manifest, folder configuration, and desktop control map.

The design uses deep teal tiles, warm champagne line work, and amber sunrise accents. Every icon is self-contained and available offline. Icons are preloaded during startup and reused by desktop cards, favorites, the taskbar, menus, and dialogs.

The PNGs at the root of this directory are compatibility copies using established filenames. `coachtools-galaxy.ico` and `coachtools-galaxy.png` retain their filenames for Windows launcher compatibility and now contain the Horizon mark. Wallpaper and loading artwork remain in `graphics/`.

For regeneration, see `docs/horizon-workspace.md` and the two icon scripts under `build/`.
