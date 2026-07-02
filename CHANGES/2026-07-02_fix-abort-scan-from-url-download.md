# fix: abort scan-from-url downloads on cancel; cap download size

**Date:** 2026-07-02
**Type:** Fix

## Intent

Closes #136. Cancelling a scan-from-url job did not abort the in-flight
download: `runFetch` only checked `job._cancelFn()` *after*
`downloadToTemp(url)` resolved, so a cancelled job kept streaming the whole
tarball to disk. There was also no download size cap or backstop for
runaway/chunked responses.

### Prompts summary
1. Implement GitHub issue #136: wire an AbortController from `cancelJob`
   through to the fetch + stream pipeline, add a 2 GB download cap, clean up
   the partial temp file on abort/failure, and cover both with unit tests.

## Changes

### `src/remoteFetch.js`
- `downloadToTemp(url, opts = {})` now accepts `opts.signal` (AbortSignal)
  and passes it to both `fetch()` and the stream `pipeline()`, so an abort
  tears the download down immediately.
- Added exported `MAX_DOWNLOAD_BYTES` (2 GB). A `content-length` header over
  the cap rejects up front with `download too large (...)`; a byte-counting
  Transform enforces the same cap during streaming, covering chunked
  responses without a content-length.
- On any failure (abort, cap, HTTP error) the temp dir is removed via
  `cleanupTemp` before rethrowing, so the partial file never leaks. An abort
  surfaces as a normalized `download cancelled` error.

### `src/scanJobs.js`
- `makeJob` base shape gains `_abort: null`.
- `runFetch` creates an `AbortController`, stores it on `job._abort`, passes
  its signal to `downloadToTemp`, and clears it once the download settles.
  A cancel-triggered abort finishes the job as `cancelled`, not `failed`.
- `cancelJob` calls `job._abort.abort()` after setting the cancel flag, so an
  in-flight download stops immediately.

### `tests/node/remoteFetch.test.js`
- New `downloadToTemp abort and size cap` suite: (a) aborting an in-flight
  download rejects with `download cancelled` and leaves no
  `papastud-fetch-*` temp dir behind; (b) a response advertising a
  `content-length` over the cap rejects with `download too large` without
  downloading a body.

## Files modified

| File | Change |
|------|--------|
| `src/remoteFetch.js` | Abort signal support, 2 GB cap, temp-dir cleanup on failure |
| `src/scanJobs.js` | Wire AbortController through job lifecycle; cancel aborts download |
| `tests/node/remoteFetch.test.js` | Abort + size-cap unit tests |
