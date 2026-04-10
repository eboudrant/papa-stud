# feat: independent scrolling, dynamic port, nav improvements

**Date:** 2026-04-09
**Type:** Feature

## Intent

Make the scan review view more usable: sidebar and failure grid scroll independently. Fix Electron port conflicts. Improve breadcrumb navigation for long filenames.

### Prompts summary

1. Sidebar (modules) and failure grid should scroll independently
2. Port conflict when multiple instances run
3. Breadcrumb filename too aggressive with truncation

## Changes

### `static/css/app.css` (MODIFIED)
- Body uses `height: 100vh` to constrain flex children
- `#content` has `overflow: hidden` + `min-height: 0` for flex shrinking
- `.review-main` scrolls independently with `overflow-y: overlay`
- `.review-toolbar` is sticky within the scroll area
- Overlay scrollbars (show on scroll, auto-hide)

### `electron/main.js` (MODIFIED)
- Uses port 0 (OS picks free port) instead of hardcoded 8770
- No more EADDRINUSE errors with multiple instances

### `static/js/router.js` (MODIFIED)
- Breadcrumb strips `.png`, `_compare`, `_actual`, `delta-` but shows full name
- CSS text-overflow ellipsis uses all available header space

## Files modified

| File | Change |
|------|--------|
| `static/css/app.css` | Independent scrolling, overlay scrollbars, spacing |
| `electron/main.js` | Dynamic port |
| `static/js/router.js` | Better breadcrumb filenames |
