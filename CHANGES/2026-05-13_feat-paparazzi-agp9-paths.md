# feat: scanner resolves Paparazzi goldens for AGP 9 / KMP layouts

**Date:** 2026-05-13
**Type:** Feature

## Intent

AGP 9 + Kotlin Multiplatform moves Android host-side tests from `src/test/` to `src/androidHostTest/`. Paparazzi follows: goldens that used to live at `src/test/snapshots/images/<name>.png` now sit at `src/androidHostTest/snapshots/images/<name>.png`. The failure outputs (`build/paparazzi/failures/{,delta-}<name>.png`) and the JUnit XML location are roughly the same; only the source-set name shifted.

Papa-stud's Paparazzi profile hardcoded the legacy `src/test/...` path in three places (template, scanner, watcher). On a migrated module the scanner picked up the delta + JUnit fine but `resolveGolden` returned `null` for every row — Toggle and Slider then rendered "No golden image".

The scanner now treats both layouts as first-class for Paparazzi profiles, so a project can hold legacy modules and migrated modules side by side and either resolves.

### Prompts summary
1. "Add compatibility with paparazzi and AGP 9, new structure for files — see migrated project at /Users/eboudrant/hawkins-kotlin"
2. "Scanner needs to be compatible with both (pre and post AGP 9)"
3. "Right now it sees the delta + failures XML but missing the golden image in toggle / slider"

## Changes

### `src/templates.js`
- The built-in `paparazzi` template's `golden_patterns` now lists both `src/test/snapshots/images/{name}.png` and `src/androidHostTest/snapshots/images/{name}.png`. New projects pick up both immediately.

### `src/scanner.js`
- New `withAgp9Fallback(patterns)` extends every legacy `src/test/snapshots/` pattern with its AGP-9 sibling so an existing project whose persisted profile only knows the legacy path keeps resolving.
- `buildGoldenPatterns` runs the fallback over both the configured patterns and the `{golden_dir, golden_suffix}` derived defaults.
- New `effectiveGoldenDirs(modulePath, goldenDir)` returns whichever of `src/test/...` / `src/androidHostTest/...` actually exist on disk; module-level `golden_path` reporting and `snapshot_count` totals now use it (instead of the old hardcoded `src/test/snapshots/images`).
- The default-profile branch (no profiles configured) also runs through the fallback.

### `src/strategies/gradle.js`
- `getWatchDirs` adds the AGP-9 sibling of any legacy Paparazzi golden dir so a re-record under the new layout still triggers a rescan.

### Tests
- `tests/node/scanner.test.js` — new `AGP 9 fallback` describe block covering `withAgp9Fallback` (legacy → both, dedupe, non-Paparazzi untouched), `buildGoldenPatterns` rescuing a legacy-only profile, `resolveGolden` against a real AGP-9 directory tree, and `effectiveGoldenDirs` (AGP-9 only, both, neither).

## Verified end-to-end
- `hawkins-kotlin-project/hawkins-remote` (AGP 9, no profile migration): rescan resolved 10/10 goldens at `src/androidHostTest/snapshots/images/...`.
- 139/139 unit tests pass.
- 12/12 screenshot tests pass — no UI regression.

## Files modified

| File | Change |
|------|--------|
| `src/templates.js` | Paparazzi template lists both legacy + AGP-9 golden patterns |
| `src/scanner.js` | `withAgp9Fallback`, `effectiveGoldenDirs`, scanner uses both layouts |
| `src/strategies/gradle.js` | watcher polls AGP-9 sibling directory too |
| `tests/node/scanner.test.js` | new AGP-9 fallback describe block |
