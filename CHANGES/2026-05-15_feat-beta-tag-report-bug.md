# feat: BETA tag on iOS profile + Report a Bug entry point

**Date:** 2026-05-15
**Type:** Feature

## Intent
Surface that the iOS profile (swift-snapshot-testing) is still beta inside the app, and give users a clear one-click path to file a bug.

## Changes

### `src/templates.js`
- Built-in swift-snapshot template now carries `beta: true` so the UI can flag it without hardcoding the id.

### `static/js/home.js`
- Templates list and template selector cards render a `beta` badge next to the name when `t.beta` is set.

### `static/css/app.css`
- New `.template-badge-beta` style (amber pill, uppercase, theme-aware).

### `static/index.html`
- New header icon-link (between brand/nav and the settings gear) pointing at the bug-report URL with `target="_blank"`.

### `electron/main.js`
- Help menu gets a `Report a Bug` item.
- `setWindowOpenHandler` routes any `target="_blank"` link from the renderer to the user's default browser via `shell.openExternal`.

### `.github/ISSUE_TEMPLATE/bug_report.yml`
- Structured bug-report form so reports come in with reproducible context (steps, tool, version, OS, logs).
- Both the menu item and the header icon link to `/issues/new?template=bug_report.yml`.

## Files modified

| File | Change |
|------|--------|
| `src/templates.js` | `beta: true` on swift-snapshot |
| `static/js/home.js` | Render beta badge |
| `static/css/app.css` | `.template-badge-beta` style |
| `static/index.html` | Bug icon-link in header |
| `electron/main.js` | Help menu entry + external-link handler |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | New issue form |
