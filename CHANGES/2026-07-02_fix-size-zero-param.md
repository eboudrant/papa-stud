# fix: honor size=0 in GET /api/scans/:id

**Date:** 2026-07-02
**Type:** Fix

## Intent

Closes #131. `GET /api/scans/:id` parsed pagination params with `parseInt(size) || 50`; since `parseInt('0')` is falsy, `size=0` was silently coerced to 50. The frontend relies on `size=0` for its stats-only light check (watch poll every 2 s), so every poll was pulling 50 full failure records instead of none. `projects.getScan` already handles `size=0` correctly (`slice(0, 0)`) — only the route's parsing was wrong.

### Prompts summary
1. Implement GitHub issue #131: `size=0` on `GET /api/scans/:id` is coerced to 50 by `parseInt(size) || 50`; fix the parse so 0 passes through, add a handler test, commit and push.

## Changes

### `src/handler.js`
- Replaced `parseInt(page) || 0` / `parseInt(size) || 50` with `Number.parseInt(..., 10)` plus explicit `Number.isFinite(n) && n >= 0` guards, so `0` is passed through while missing, non-numeric, and negative values still fall back to the defaults (page 0, size 50).

### `tests/node/handler.test.js`
- Added `GET /api/scans/:id pagination params` suite: seeds a scan via `projects.createScanFromResults`, asserts `?page=0&size=0` returns 200 with an empty `failures` array while `stats` and `totalFiltered` stay correct, and asserts invalid params (`page=nope&size=-5`) fall back to the defaults.

## Files modified

| File | Change |
|------|--------|
| `src/handler.js` | Safe pagination parsing so `size=0` (and `page=0`) pass through |
| `tests/node/handler.test.js` | Tests for `size=0` stats-only request and invalid-param fallback |
