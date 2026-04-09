# fix: quit on close, hidden title bar, spacing tokens

**Date:** 2026-04-09
**Type:** Fix

## Intent

Polish the Electron desktop app: quit when window closes, use native macOS hidden title bar with traffic lights, and standardize spacing across the UI with design tokens.

### Prompts summary

1. App should quit when window is closed (not stay in dock)
2. Hide system title bar, keep traffic lights, use in-app header as title
3. Consistent spacing across the app using tokens

## Changes

### `electron/main.js` (MODIFIED)
- `titleBarStyle: 'hiddenInset'` with traffic lights at (12, 6)
- `window-all-closed` quits on all platforms (removed macOS exception)
- Smaller logo text (13px) in Electron mode

### `static/css/app.css` (MODIFIED)
- Spacing tokens: `--space-xs/sm/md/lg/xl` (4/8/16/24/32px)
- Applied tokens to all layout: header, sections, cards, forms, profiles, sidebar
- Electron-only: header draggable (`-webkit-app-region: drag`), 80px left padding for traffic lights, 28px header height

### `static/js/router.js` (MODIFIED)
- Adds `.electron` class to body when `?electron=1` param present

## Files modified

| File | Change |
|------|--------|
| `electron/main.js` | Quit on close, hidden title bar |
| `static/css/app.css` | Spacing tokens, Electron header styles |
| `static/js/router.js` | Electron body class |
