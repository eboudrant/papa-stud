# feat: video export, diff percentages, sort, detail improvements

**Date:** 2026-04-06
**Type:** Feature

## Intent

Export failures as MP4 video with running stick figure progress bar. Parse diff percentages from JUnit XML for sorting and display. Add sort controls, copy path button, color-coded diff percentages, and various detail view improvements.

### Prompts summary

1. Export all delta images as MP4 video, 160ms per frame, with ffmpeg
2. Running stick figure on progress bar (30+ frames), trips twice randomly
3. Parse diff percentage from JUnit XML failure messages
4. Sort by name, module, profile, or % diff
5. Show diff percentage on thumbnails and detail view (color-coded)
6. Copy absolute path button on detail view
7. Reset zoom on next/prev navigation
8. Persist sort preference in localStorage

## Changes

### `server/video.py` (NEW)
- MP4 generation via parallel ffmpeg frame rendering
- Transparent PNG overlay with green progress bar + animated stick figure
- Stick figure runs on the bar, trips/falls twice randomly in first 50%
- Thread-safe: no global state, all passed as parameters
- `_escape_drawtext()` for safe ffmpeg text overlay

### `server/scanner.py` (MODIFIED)
- `_parse_diff_percentages()` extracts "Images differ (by X%)" from JUnit XML
- Each failure gets `diff_pct` field

### `server/projects.py` (MODIFIED)
- `sort` parameter on `get_scan()`: name, module, profile, diff

### `server/handler.py` (MODIFIED)
- `POST /api/scans/{id}/video` endpoint
- `/api/health` reports `ffmpeg` availability
- `sort` query parameter passed through

### `static/js/api.js` (MODIFIED)
- Shared `showToast()` function (consolidated from home.js and review.js)

### `static/js/review.js` (MODIFIED)
- Export Video button with ffmpeg check and toast notifications
- Sort dropdown (persisted in localStorage)
- Diff percentage badge on thumbnail cards

### `static/js/detail.js` (MODIFIED)
- Color-coded diff percentage in header (amber/orange/red/purple by severity)
- Copy path button (passes `this` instead of implicit `event`)
- Removed `_keepZoom` — always reset zoom on next/prev

### `static/js/home.js` (MODIFIED)
- Uses shared `showToast()` from api.js

## Files modified

| File | Change |
|------|--------|
| `server/video.py` | MP4 video with stick figure progress |
| `server/scanner.py` | Diff percentage parsing from JUnit XML |
| `server/projects.py` | Sort parameter |
| `server/handler.py` | Video endpoint, sort param, ffmpeg health |
| `static/js/api.js` | Shared showToast() |
| `static/js/review.js` | Video export, sort, diff badges |
| `static/js/detail.js` | Diff color, copy path, zoom reset |
| `static/js/home.js` | Use shared showToast() |
| `static/css/app.css` | Diff percentage and copy button styles |
