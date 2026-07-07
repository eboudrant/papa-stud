# feat: load test results from uploaded archive files (multi-file, conflict-aware)

**Date:** 2026-07-07
**Type:** Feature

## Intent
Until now the only way to overlay a CI run's screenshot-test `build/` outputs onto a
project was **Scan from URL** (download one `.tar`/`.tar.gz`). Users who have result
archives on disk, or who produce several sharded CI archives, had no path in. This adds a
**file picker** next to the URL input that accepts **multiple** `.zip`/`.tar`/`.tar.gz`
files, **merges** them into a single overlay + scan, and — when two archives contain the
same file with **different content** — **aborts** with an error dialog listing the
conflicts. Identical-content duplicates are merged silently.

### Prompts summary
1. "For the load test result from zip file, we currently propose a URL input, I also want a
   file picker that supports multiple files; if a duplicate file is found in multiple zip
   files it should show an error dialog if the duplicate file name's content is different."
2. Confirmed: accept zip + tar/tar.gz; merge into one scan; abort-all on any conflict.

## Changes

### `src/localArchive.js` (new)
- Sibling of `remoteFetch.js` for local uploads. `sniffFormat` (magic bytes), `extractArchive`
  (`unzip`/`tar`), `collectBuildMembers` (walk + `isUnsafeMember` guard + symlink skip),
  `hashFile` (sha256), `mergeStages` (cross-archive conflict detection), `overlayBuildDirs`
  (`fs.cpSync` of `<module>/build` subtrees only), and temp/stage cleanup. Reuses
  `remoteFetch`'s `isBuildMember`/`isUnsafeMember`/`moduleRootOf`/`checkCompat`/`MAX_DOWNLOAD_BYTES`.

### `src/remoteFetch.js`
- Export `byteCapTransform` so the raw-upload route can reuse the streaming byte cap.

### `src/scanJobs.js`
- Upload registry (`registerUpload`/`takeUploads`) with TTL reaping of unconsumed uploads.
- `startScanFromUploads` → `runUploads` pipeline: extract all → merge/conflict-detect →
  abort on conflict (project untouched) → `checkCompat` → park `needs_confirmation` or
  `doOverlayAndScan` → `runScan`.
- `finishJob` now frees stage dirs + raw uploads and carries a `conflicts` payload; `getJob`
  surfaces `conflicts`. `confirmScanFromUrl` generalized to kind-aware `confirmScanJob`.

### `src/handler.js`
- `POST /api/uploads` (raw stream → temp file, byte-capped, filename/extension validated) and
  `POST /api/projects/:id/scan-from-uploads` (`{uploadIds}` → job). Confirm route now calls
  `confirmScanJob`.

### `static/js/home.js`, `static/css/app.css`
- File picker added **inside the existing hidden Scan-from-URL form** (keeps project-card
  screenshot baselines unchanged). `_scanFromFiles` uploads each file then starts the merge
  scan; `_showConflictDialog` lists conflicting paths on a conflict abort.

### Tests & docs
- `tests/node/localArchive.test.js` (11 cases: pure helpers + e2e merge / identical-dup /
  conflict-abort-project-untouched / zip+tar / needs_confirmation / size-cap 413 / validation).
- `docs/index.html` and `.claude/rules/scanning.md` document the upload + conflict behavior.

## Files modified

| File | Change |
|------|--------|
| `src/localArchive.js` | New module: extract/merge/conflict-detect/overlay uploaded archives |
| `src/remoteFetch.js` | Export `byteCapTransform` |
| `src/scanJobs.js` | Upload registry, `startScanFromUploads`/`runUploads`/`doOverlayAndScan`, kind-aware `confirmScanJob`/`finishJob`, `getJob` conflicts |
| `src/handler.js` | `POST /api/uploads`, `POST /api/projects/:id/scan-from-uploads`, confirm route rename |
| `static/js/home.js` | File picker in the URL form, `_scanFromFiles`, conflict dialog |
| `static/css/app.css` | `.url-form-or` divider |
| `tests/node/localArchive.test.js` | New test suite |
| `docs/index.html` | Document uploaded-archive workflow |
| `.claude/rules/scanning.md` | Document URL-vs-uploads overlay + conflict rule |
