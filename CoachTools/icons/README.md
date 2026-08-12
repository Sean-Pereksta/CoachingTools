# CoachTools icons

Place square PNG artwork here using these exact filenames. CoachTools preloads them on startup and reuses the same cached artwork across desktop cards, the taskbar, menus, and dialogs.

```text
allstar.png
weekly-data.png
coaching-gaps.png
coach-timeline.png
kpi-impact.png
qa-scores.png
audit-checklist.png
coachtools-home.png
shared-data.png
backup-restore.png
settings.png
all-apps.png
default-app.png
```

The first seven filenames are normalized to their matching application IDs, so a stale manifest entry cannot point a built-in app at the wrong image. The remaining files provide desktop, shared-data, backup/restore, settings, All Apps, and future-app artwork. If a configured icon is unavailable, CoachTools tries `default-app.png` and then keeps the built-in initials or symbol fallback visible; a broken-image indicator is never shown.

`coachtools-home.png` is the branded graphic used by both the taskbar Start button and the top-left CoachTools button. The desktop wallpaper is separate and must be named `graphics/background.png`.
