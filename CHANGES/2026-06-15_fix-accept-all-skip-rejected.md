# fix: Accept All skips rejected failures

**Date:** 2026-06-15
**Type:** Fix

## Intent
`acceptAllBaselines` only skipped failures already marked `accepted`, so failures the user had explicitly rejected got their golden images overwritten by "Accept All" — a data-loss bug, and inconsistent with rescans preserving accept/reject decisions. Accept All now leaves rejected failures untouched and reports how many were skipped. Closes #129.

## Changes

### `src/projects.js`
- `acceptAllBaselines` now also skips failures with `status === 'rejected'`, counts them in a new `skippedRejected` counter, and includes `skippedRejected` in the returned object.

### `static/js/review.js`
- `_acceptAll` appends `(N rejected skipped)` to the success toast when `result.skippedRejected > 0`, and the local status update loop no longer flips rejected failures to accepted.
- The Accept-All button's `title` attribute now reads "Copy every actual image over its golden (rejected are skipped)".

## Files modified

| File | Change |
|------|--------|
| `src/projects.js` | `acceptAllBaselines` skips rejected failures and returns `skippedRejected` |
| `static/js/review.js` | Toast mentions skipped rejected count; local state keeps rejected status; button tooltip updated |
| `tests/node/projects.test.js` | New `acceptAllBaselines` test: pending accepted, rejected golden untouched, `skippedRejected === 1` |
