# feat: scan a project from a CI result tarball URL

**Date:** 2026-06-04
**Type:** Feature

## Intent
Paparazzi / Roborazzi / Compose Screenshot tests run on CI (Jenkins), which publishes the
build outputs as a downloadable tarball (e.g. a Jenkins stage `?tarball=1` link). Previously you
could only review failures already on disk in a locally-scanned project. This adds a way to pull
a CI run's failure artifacts straight into your existing local project and review them with the
normal pipeline.

The tarball is treated as **a way to copy CI's results into the current project dir**: its
`build/` artifacts (failure deltas + JUnit) are overlaid onto the project directory, then a normal
scan runs. Goldens come from the **local** working copy, so the detail view pairs CI's failure
deltas with your local baselines and accept-baseline writes back to the real repo.

### Prompts summary
1. "I want a way to download the result from an URL … paparazzi/roborazzi run on CI and we can review the result in papa stud … like remote result"
2. Clarified: load results onto an existing project; dialog if the tarball's directory structure isn't compatible; add a small "scan from url" button on each project; use the local goldens (the tarball copies the result to the current dir).

## Changes

### `src/remoteFetch.js` (new)
- `downloadToTemp(url)` — validates http(s), streams the tarball to a temp file (no buffering).
- `listBuildMembers(tarFile)` — lists archive entries via the system `tar`, keeps only those
  under a `build/` segment, and rejects absolute / `..` traversal paths.
- `checkCompat(members, projectRoot)` — reports which module roots from the tarball exist locally;
  `compatible` is false only when nothing lines up.
- `extractBuildMembers(...)` — extracts whole `<module>/build` directories into the project dir
  (`tar -T` with directory entries), never touching `src/` or goldens. Extracting directories
  rather than per-file is deliberate: bsdtar glob-interprets `-T` member entries, so Paparazzi
  parameterized snapshot names containing `[...]` brackets silently match nothing; directory paths
  have no glob metacharacters and match literally.

### `src/scanJobs.js`
- `startScanFromUrl(project, url)` / `confirmScanFromUrl(jobId)` — a download → extract → scan job
  that reuses the existing `runScan` flow. Parks at `needs_confirmation` (with `compat` details)
  when the layout doesn't match. Temp tarballs are cleaned on success/failure/cancel and via the
  job TTL sweep. `getJob` now surfaces `compat` and the new statuses.

### `src/handler.js`
- `POST /api/projects/:id/scan-from-url` `{ url }` → `202 { jobId }`.
- `POST /api/scan-jobs/:id/confirm` → resumes a parked job.

### `static/js/home.js`, `static/css/app.css`
- A "Scan from URL" icon button on each project card opens a URL input. The existing scan-progress
  poller is extended for `downloading` / `extracting` / `needs_confirmation` (confirm dialog
  listing unmatched modules), then navigates to the review on completion.

### `tests/node/remoteFetch.test.js` (new)
- Unit tests for the path/compat helpers and handler tests covering download→overlay→scan,
  compat-mismatch → confirm, and input validation, serving a fixture tar over loopback HTTP.

## Files modified

| File | Change |
|------|--------|
| `src/remoteFetch.js` | New — download + compat-check + safe `build/`-only extract |
| `src/scanJobs.js` | `startScanFromUrl` / `confirmScanFromUrl`, temp cleanup, `compat` in `getJob` |
| `src/handler.js` | `scan-from-url` + `confirm` routes |
| `static/js/home.js` | Scan-from-URL button, URL form, extended poller + compat dialog |
| `static/css/app.css` | `.url-form` styles; keep card-action icon button grouped |
| `tests/node/remoteFetch.test.js` | New — unit + handler coverage |
