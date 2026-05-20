# fix: scan failures under `failures/androidMain/` (AGP 9 / KMP)

**Date:** 2026-05-20
**Type:** Fix

## Intent
Paparazzi on AGP 9 / KMP writes delta + actual PNGs under `build/paparazzi/failures/<sourceSet>/` (typically `androidMain/`) instead of directly in `failures/`. The scanner only walked the top of `failures/`, so on modules that emit the new layout — or projects that mix legacy (stale, top-level) and AGP 9 (current, in subdir) — current failures were invisible and the user saw a clean scan despite thousands of deltas on disk.

#95 fixed the *golden* side of the same AGP 9 path migration. This is the sibling fix on the *failures* side.

## Changes

### `src/scanner.js`
- `detectCurrentFailures`: always recurse into subdirs of the failures dir (was gated to compare-mode tools that have no delta convention). Paparazzi/Roborazzi files keep their `delta-` prefix / `_compare` suffix inside the subdir, so the leaf candidacy check still selects only real deltas.
- `processProfile`: look for the actual PNG in the same directory as the delta (`path.dirname(candidatePath)`) instead of always at the top of `failuresDir`. In the legacy layout the two are identical; in the AGP 9 layout the actual lives next to the delta inside `androidMain/`.
- `detectCurrentFailures` now returns `[{path, mtime}, ...]` instead of paths, and `processProfile` reuses the cached `mtime` for the xmlMtime filter and the result record. Saves two `fs.statSync` calls per candidate (on a 938-failure scan, ~1876 stats avoided).

### `tests/node/scanner.test.js`
- Regression test in `detectCurrentFailures`: stale legacy deltas at the top of `failures/` are dropped when a fresh cluster exists under `androidMain/`.
- End-to-end test in `scanProject`: AGP 9 delta + actual + golden all resolve correctly via the recursion + `withAgp9Fallback` golden patterns.

## Files modified

| File | Change |
|------|--------|
| `src/scanner.js` | Recurse into AGP 9 / KMP source-set subdirs; resolve actual next to delta |
| `tests/node/scanner.test.js` | Regression coverage for AGP 9 failures layout |
