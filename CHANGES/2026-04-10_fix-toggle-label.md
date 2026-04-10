# fix: toggle label cleanup

**Date:** 2026-04-10
**Type:** Fix

## Intent
The toggle mode label showed the filename which made it too wide, and the white background didn't work in dark mode.

### Prompts summary
1. Remove filename from toggle label, keep just "Expected (Golden)" / "Actual"
2. Use theme-neutral dark semi-transparent background that works on any screenshot

## Changes

### `static/js/detail.js`
- Removed filename from toggle label (goldenFile, actualFile, file, label variables)
- Label now shows just the title ("Expected (Golden)" / "Actual")

### `static/css/app.css`
- Toggle label uses dark semi-transparent background with white text and backdrop blur
- Works on both light and dark screenshots
- Removed unused `.toggle-file` class

## Files modified

| File | Change |
|------|--------|
| `static/js/detail.js` | Remove filename from toggle label |
| `static/css/app.css` | Theme-neutral toggle label styling |
