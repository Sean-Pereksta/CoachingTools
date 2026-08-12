# CoachTools Application Manifest

`build/generate-app-manifest.js` discovers installed applications and generates both:

- `apps.json` for readable/editable metadata
- `apps-manifest.js` for reliable direct `file://` startup

The desktop loads the JavaScript manifest and does not depend on `fetch("apps.json")`.

## Discovery rules

The generator installs:

1. HTML files directly under `apps/`
2. `apps/application-name/index.html`
3. Any deeper HTML file containing CoachTools metadata (including `<meta name="coachtools-app" content="true">`)

Support pages nested inside an application are ignored unless explicitly marked. This keeps `apps/allstar/qualtrics/generator.html` from appearing as a separate desktop app.

## Optional HTML metadata

```html
<meta name="coachtools-app" content="true">
<meta name="coachtools-id" content="coaching-gaps">
<meta name="coachtools-name" content="Coaching Gaps">
<meta name="coachtools-description" content="Compare coaching activity with performance gaps.">
<meta name="coachtools-category" content="Coaching">
<meta name="coachtools-icon" content="icons/coaching-gaps.png">
<meta name="coachtools-initials" content="CG">
<meta name="coachtools-keywords" content="coach, performance, opportunities">
<meta name="coachtools-data" content="retail, referral, qa, coaching, checklist">
<meta name="coachtools-favorite" content="false">
<meta name="coachtools-featured" content="false">
<meta name="coachtools-order" content="30">
<meta name="coachtools-version" content="1.0">
<meta name="coachtools-enabled" content="true">
```

Metadata is optional for top-level HTML files and `apps/name/index.html`. Defaults come from the filename/folder and `<title>`, use `icons/default-app.png`, category `Other`, and enable the app. Validation rejects duplicate IDs/paths and manifest entries whose files no longer exist.

## Manifest entry

```json
{
  "id": "coaching-gaps",
  "name": "Coaching Gaps",
  "description": "Compare coaching activity with performance gaps.",
  "file": "apps/coaching-gaps.html",
  "icon": "icons/coaching-gaps.png",
  "initials": "CG",
  "category": "Coaching",
  "keywords": ["coach", "performance", "opportunities"],
  "data": ["retail", "referral", "qa", "coaching", "checklist"],
  "favorite": false,
  "featured": false,
  "order": 30,
  "version": "1.0",
  "enabled": true
}
```

Valid shared data IDs include `weeklyRetail`, `weeklyReferral`, `monthlyRetail`, `monthlyReferral`, `qa`, `documentedCoaching`, `checklist`, and `compCoaching`; legacy `retail`, `referral`, and `coaching` aliases remain supported. Missing requirements produce a warning, not an app-opening block.

## Preserve or refresh metadata

Normal generation preserves customized fields already present in `apps.json`:

```text
node build/generate-app-manifest.js
```

To intentionally make the HTML metadata authoritative again:

```text
node build/generate-app-manifest.js --refresh-metadata
```

Check that generated files are current without changing them:

```text
node build/generate-app-manifest.js --check
```

## Icon behavior

Icon paths are relative to the CoachTools root. Missing files are allowed so custom artwork can be added later. The dashboard's image error handler removes failed images and keeps the initials fallback visible; a browser broken-image indicator is never shown.
