# fix: Electron app polish — ffmpeg, video export, downloads

**Date:** 2026-04-09
**Type:** Fix

## Intent

Fix multiple issues discovered while using the Electron desktop app: ffmpeg not found, video blocking UI, missing downloads, missing clipboard shortcuts, and filtered video export.

### Prompts summary

1. ffmpeg not found in Electron (PATH not inherited from shell)
2. Video generation blocked the UI (sync ffmpeg calls)
3. Video export didn't trigger download in Electron
4. Homebrew ffmpeg missing drawtext/libfreetype — render text in overlay PNG instead
5. Video export ignores active filters (profile/module/search)
6. Include filter name in exported video filename

## Changes

### `src/video.js` (REWRITTEN)
- Fully async using `spawn` + Promises (no more spawnSync/execFileSync)
- `findFfmpeg()` searches PATH then Homebrew paths (/opt/homebrew/bin, /usr/local/bin)
- Text rendered directly into overlay PNG using built-in 5x7 bitmap font — no drawtext/libfreetype dependency
- Overlay includes: info line (gray), filename (white), progress bar (green)

### `src/handler.js` (MODIFIED)
- Video endpoint accepts `module`, `profile`, `q` query params — exports filtered failures only
- Filter tag included in download filename (e.g. `papa-stud-scanid-Roborazzi.mp4`)
- Error logging for video generation failures

### `static/js/review.js` (MODIFIED)
- Export video passes current filter state to the API
- Toast shows filter name and frame count

### `electron/main.js` (MODIFIED)
- `will-download` handler saves to ~/Downloads and reveals in Finder

## Files modified

| File | Change |
|------|--------|
| `src/video.js` | Async ffmpeg, bitmap font text, Homebrew path search |
| `src/handler.js` | Filtered video export, error logging |
| `static/js/review.js` | Pass filters to video endpoint |
| `electron/main.js` | Download handler |
