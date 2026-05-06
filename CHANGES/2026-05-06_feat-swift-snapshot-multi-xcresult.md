# feat: discover failures across multiple xcresult bundles in one project

**Date:** 2026-05-06
**Type:** Feature

## Intent

Real iOS monorepos (e.g. iosui-argo) split their snapshot suites across many product workspaces — Argo, NGP, PlayerUI, HawkinsComponentsGallery, and so on — each producing its own `.xcresult` bundle. The previous swift-snapshot strategy only ingested one bundle per project (newest under the project root, or a pinned `xcresult_path`), so a project pointed at the repo root only ever saw one workspace's worth of failures.

This change discovers all `.xcresult` bundles modified within the last 24 h under the project root (deep walk) plus any common drop-points like `/tmp` (shallow walk — headless test scripts often dump there). Each bundle is parsed into its own per-bundle cache subdir; the resulting failures are merged and bucketed across all `__Snapshots__` directories the strategy already discovers. Same-test rows from overlapping bundles are deduped by `(module, filename)` keeping the row with the highest mtime — so a stale `/tmp` run sitting next to a fresh one collapses cleanly.

### Prompts summary

1. "Make sure all failures are discovered when scanning /Users/eboudrant/iosui-argo … no hard coding paths, nothing specific to argo"
2. Discovery scope: recent xcresults under root + `/tmp` (shallow), with the 24 h cutoff
3. Snapshot-module discovery already correct (12/12 dirs) — keep it; bucket failures across all of them
4. Dedupe overlapping rows by `(module, filename)` keeping newest

## Changes

### `src/xcresultParser.js`
- New `findRecentXcresults({ projectRoots, shallowRoots, maxAgeMs })` walks deep roots and shallow roots (depth 1) for `.xcresult` directories, applies an mtime cutoff, and returns paths sorted newest first.
- Removed the now-unused `findNewestXcresult` (superseded by `findRecentXcresults`).

### `src/strategies/swift-snapshot.js`
- `locateXcresult` → `locateXcresults` returns an array. With `xcresult_path` pinned, returns just that bundle; otherwise returns recent bundles under `[projectRoot]` plus shallow roots `['/tmp']`.
- `parseProjectFailures` iterates each bundle, exporting attachments into a per-bundle cache subdir (hash of absolute path) so manifests don't collide. Failures are concatenated, then bucketed across all `__Snapshots__` modules.
- New dedupe pass collapses rows with identical `(module, filename)` to the one with the highest `mtime`.

### Tests
- New `findRecentXcresults` tests (sort order, age cutoff, shallow depth, dedup across overlapping roots).
- `locateXcresult` test renamed to `locateXcresults`; the override-path tests assert array shape; the fallback test asserts subset (the host's `/tmp` may carry unrelated bundles).

## Files modified

| File | Change |
|------|--------|
| `src/xcresultParser.js` | findRecentXcresults; drop findNewestXcresult |
| `src/strategies/swift-snapshot.js` | multi-bundle aggregation + dedupe |
| `tests/node/swiftSnapshotStrategy.test.js` | new findRecentXcresults / locateXcresults tests |
