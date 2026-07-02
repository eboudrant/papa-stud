# fix: validate failure status values on the PUT endpoints

**Date:** 2026-07-02
**Type:** Fix

## Intent
Closes #135. `PUT /api/scans/:scanId/failures/:filename/status` and `PUT /api/scans/:scanId/failures/batch` accepted any string as a status and passed it straight to `projects.updateFailureStatus` / `batchUpdateStatus`. Since `computeStats` only counts `pending | accepted | rejected`, junk statuses were stored silently and distorted scan stats. Both routes now reject unknown statuses with a 400, and the batch route additionally rejects a non-array `filenames`.

### Prompts summary
1. Implement GitHub issue #135: validate status values on the two failure-status PUT endpoints, add tests, commit, push.

## Changes

### `src/handler.js`
- Added `VALID_STATUSES` set (`pending`, `accepted`, `rejected`) near the two routes.
- Both PUT routes return `400 invalid status: <value>` when the body's status is not in the set.
- The batch route returns `400 filenames must be an array` when `filenames` is not an array.

### `tests/node/handler.test.js`
- Added a `putJson` helper and a `PUT failure status validation` suite: bogus status returns 400 on both routes (and leaves stats untouched), non-array `filenames` returns 400, and valid statuses return 200 with updated stats. Scans are seeded via `projects.createScanFromResults` against the tmp data dir.

## Files modified

| File | Change |
|------|--------|
| `src/handler.js` | Validate status against a whitelist on both PUT routes; reject non-array `filenames` on batch |
| `tests/node/handler.test.js` | New tests for status/filenames validation and stats updates |
