# fix: watch mode discovers new modules appearing after scan

**Date:** 2026-04-07
**Type:** Fix

## Intent

When watch mode is enabled on a scan with 0 failures, new modules that appear later (e.g., when running verifyPaparazzi for the first time) were not detected. The watcher now periodically re-discovers modules.

### Prompts summary

1. Watch mode should detect new failures even in modules that had no build/paparazzi/ at scan time

## Changes

### `server/watcher.py` (MODIFIED)
- Added periodic module discovery thread (every 5s) that re-runs `_discover_paparazzi_modules`
- New modules get watches added dynamically and trigger an initial scan
- Refactored `_add_module_watches` to support adding watches after init
- `_known_modules` set tracks already-watched modules to avoid duplicates
- Watchdog watcher: `_on_new_module` schedules new watches on the observer
- Both watchdog and polling watchers start discovery thread on `start()`

## Files modified

| File | Change |
|------|--------|
| `server/watcher.py` | Periodic module discovery, dynamic watch addition |
