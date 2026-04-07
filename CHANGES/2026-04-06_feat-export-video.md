# feat: export scan failures as MP4 video

**Date:** 2026-04-06
**Type:** Feature

## Intent

Export all failures from a scan as an MP4 video for sharing in Slack, PRs, or presentations. Each frame shows the delta image fit-centered on a dark background with filename and module info. Requires ffmpeg on the system — shows install instructions if missing.

### Prompts summary

1. Export all delta images in a scan as a video file, 160ms per frame
2. Each frame contains delta image + filename + module info, fit-centered
3. Use ffmpeg for MP4 generation (no Python dependencies)
4. Show install prompt if ffmpeg not available

## Changes

### `server/video.py` (NEW)
- `generate_video(failures, output_path)` — renders frames via ffmpeg, stitches into MP4
- Each frame: delta image scaled to fit 1280x720, dark background, drawtext overlay
- ffmpeg concat demuxer for frame timing (160ms/frame)
- `_escape_drawtext()` handles special chars in filenames (`[],:;\`)
- `has_ffmpeg()` checks system availability

### `server/handler.py` (MODIFIED)
- `POST /api/scans/{id}/video` — generates and streams MP4 download
- `/api/health` reports `ffmpeg` availability

### `static/js/review.js` (MODIFIED)
- "Export Video" button on review toolbar
- Checks ffmpeg availability before export, shows install prompt if missing

## Files modified

| File | Change |
|------|--------|
| `server/video.py` | MP4 video generation via ffmpeg |
| `server/handler.py` | Video export endpoint, ffmpeg in health check |
| `static/js/review.js` | Export Video button with ffmpeg check |
