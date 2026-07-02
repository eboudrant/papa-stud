# fix: show an error state when the detail page fails to load

**Date:** 2026-07-02
**Type:** Fix

## Intent
Closes #132. `_loadDetail(scanId, filename)` in `static/js/detail.js` had no
try/catch: a 404 (stale link after the scan was deleted or replaced) or a 500
left the page stuck on "Loading..." forever with no feedback. The review page
already solved the same problem with `_renderReviewError` in
`static/js/review.js`; this change brings the detail page in line with it.

### Prompts summary
1. Implement GitHub issue #132: wrap `_loadDetail` in try/catch and render an
   error state consistent with review.js's, with Retry and Back-to-scan
   actions, reusing only existing CSS classes.

## Changes

### `static/js/detail.js`
- Wrapped the body of `_loadDetail` in try/catch.
- On error, renders into `#content` an `empty-state` block mirroring
  `_renderReviewError`: "Couldn't load this failure.", the error message in
  `error-detail`, a Retry button that re-invokes `_loadDetail`, and a
  "Back to scan" link to `#/scans/<scanId>`.
- Values interpolated into attributes go through `escAttr`; the filename is
  `encodeURIComponent`-encoded for embedding and `decodeURIComponent`-decoded
  in the retry call, since the router hands `showDetail` a decoded filename.
- Logs `console.error('[detail] load failed:', err)`.
- Reuses only existing CSS classes (`empty-state`, `error-detail`, `btn`) —
  no new CSS, so screenshot baselines are unaffected (the error state only
  renders on failure, which the baseline specs never trigger).

## Files modified

| File | Change |
|------|--------|
| `static/js/detail.js` | Wrap `_loadDetail` in try/catch; render Retry / Back-to-scan error state on failure |
| `CHANGES/2026-07-02_fix-detail-error-handling.md` | This changelog entry |
