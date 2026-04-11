# fix: filter all stale deltas when JUnit XML reports zero failures

**Date:** 2026-04-11
**Type:** Fix

## Intent
Delta files were shown as failures even when all JUnit tests passed. The mtime-based filter wasn't enough because fresh deltas could be within the 60-second tolerance of the XML timestamp.

### Prompts summary
1. If XML says 0 failures, all deltas are stale — clear them all
2. Add debug logging behind PAPASTUD_DEBUG=1 env var
3. Reload review immediately when Watch is enabled (rescan happens server-side)

## Changes

### `src/scanner.js`
- When `testStats.failed === 0` and XML exists, filter all deltas (not just old ones)
- Add debug logging for stale delta filtering (behind PAPASTUD_DEBUG=1)

### `src/scanJobs.js`
- Add debug logging for scan start, watch rescan, and module results
- All debug logs gated behind PAPASTUD_DEBUG=1

### `static/js/review.js`
- Reload review immediately after enabling Watch (rescan happens server-side in startWatching)

## Files modified

| File | Change |
|------|--------|
| `src/scanner.js` | Zero-failure stale filter + debug logging |
| `src/scanJobs.js` | Debug logging for scan/watch |
| `static/js/review.js` | Reload on Watch enable |
