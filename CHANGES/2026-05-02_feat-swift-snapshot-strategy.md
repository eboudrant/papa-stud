# feat: swift-snapshot-testing strategy (iOS / Xcode)

**Date:** 2026-05-02
**Type:** Feature

## Intent
Add native support for Apple/Xcode projects that use `pointfreeco/swift-snapshot-testing`. The engine writes failure attachments inside an `.xcresult` bundle (not on disk), so we shell out to `xcrun xcresulttool` to extract them. Strategy is project-level via the existing strategy pattern (`gradle` ↔ `swift-snapshot`).

### Prompts summary
1. Identify the iOS tool used in iosui-argo (`Snapshot` framework wrapping pointfreeco/swift-snapshot-testing).
2. Phase 2: parse `.xcresult` natively rather than going through a JUnit pipeline.
3. Discovery: newest `*.xcresult` under project root + per-project override field.
4. Cover `failure-N.png` (multiple failed assertions per test).

## Changes

### `src/xcresultParser.js` (new)
Wraps `xcrun xcresulttool`:
- `parseXcresult(path, cacheDir)` — runs `get test-results tests --compact` for stats + `export attachments --only-failures` for the manifest, returns `{ stats, failures, mtime }`.
- `findNewestXcresult(root)` — deep walk pruning `.git / node_modules / .build / .swiftpm / Pods / .checkout`.
- Pure helpers exposed for unit tests: `walkTestNodes`, `classifyAttachment`, `groupManifestByTest`, `pairAttachmentsForTest`. The classifier recognises `failure / reference / difference` (with optional `-N` suffix), so multiple failed assertions in one test produce paired rows.

### `src/strategies/swift-snapshot.js` (new)
- `discoverModules(root)` walks for `__Snapshots__/` directories — each parent dir is a "module" (test target).
- `getWatchDirs`, `resolveModulePath` for the existing strategy contract.
- `parseProjectFailures(root, project, cacheDir)` — single global parse, buckets failures back to modules by which `__Snapshots__/<className>/` exists.
- `locateXcresult(root, project)` — honours `project.xcresult_path` (absolute or relative to project root); otherwise newest `*.xcresult` under root.
- `usesJunit: false` — tells the scanner not to look for JUnit XML.

### `src/strategies/index.js`
Registers the new `swift-snapshot` strategy.

### `src/scanner.js`
- `scanProjectIncrementalSync` accepts `opts = { project, cacheDir }`. When the strategy defines `parseProjectFailures` and `cacheDir` is provided, the scanner calls it once at the start of the run, yields a `parsing` phase, and uses `processModuleFromPrecomputed` instead of the JUnit + mtime pipeline.
- `processModuleFromPrecomputed` — new helper that pulls failures out of the pre-parsed map and counts goldens under the configured `golden_dir`.
- The Gradle path is untouched.

### `src/scanJobs.js`
- `startScan(project)` now takes the full project object (was: positional args). Strategies that expose `parseProjectFailures` get a per-project cache dir under `data/cache/xcresult/<projectId>/`, wiped + recreated each scan.
- New `parsing` phase relayed to the job status.

### `src/handler.js`
- `POST /api/projects` plumbs `body.xcresult_path` through to `addProject`.
- `POST /api/projects/:id/scan` simplified to `scanJobs.startScan(project)`.
- `GET /api/images` now also allows files under `<DATA_DIR>/cache/` (where extracted xcresult attachments live), in addition to project roots.

### `src/projects.js`
- `addProject` accepts an `opts.xcresult_path` (only persisted when set).
- `defaultProfiles(strategy)` — strategy-aware default template selection (`gradle → paparazzi`, `swift-snapshot → swift-snapshot`).

### `src/templates.js`
- New built-in `swift-snapshot` template: `golden_dir: '__Snapshots__'`, compare-mode (no `delta_prefix`/`delta_suffix`).

### `static/js/home.js`
Add Project form:
- Strategy dropdown: Gradle (default) | swift-snapshot-testing.
- Optional `xcresult_path` input shown only for the swift-snapshot strategy.
- Template list filters to swift-snapshot-only when that strategy is selected; auto-checks the matching default template.

### `tests/node/xcresultParser.test.js` (new)
9 tests covering the pure parser helpers.

### `tests/node/swiftSnapshotStrategy.test.js` (new)
12 tests covering discovery (including pruning), watch dirs, module-path resolution, test-identifier parsing, newest-xcresult finder, and `locateXcresult` override semantics.

## Limitations / follow-ups

- **Watcher does not yet rescan on `.xcresult` changes** for swift-snapshot projects. The current per-module callback model needs a small rework to support a global "re-parse the bundle and rebucket all modules" path. Watch button still works from the UI but won't pick up new test runs until that follow-up lands.
- **macOS-only.** `xcrun xcresulttool` ships with Xcode. Earlier work removed prod Docker (`#84`), so this constraint is consistent with how Papa Stud now ships (Electron / `npm start`).

## Files modified

| File | Change |
|------|--------|
| `src/xcresultParser.js` | New: xcrun wrapper + pure parsing helpers |
| `src/strategies/swift-snapshot.js` | New: iOS strategy |
| `src/strategies/index.js` | Register new strategy |
| `src/scanner.js` | opts support, processModuleFromPrecomputed |
| `src/scanJobs.js` | startScan(project), per-project cache dir, parsing phase |
| `src/handler.js` | xcresult_path plumbing, allow images under data/cache |
| `src/projects.js` | xcresult_path on project, strategy-aware defaultProfiles |
| `src/templates.js` | Built-in swift-snapshot template |
| `static/js/home.js` | Strategy dropdown + xcresult_path input |
| `tests/node/xcresultParser.test.js` | New tests |
| `tests/node/swiftSnapshotStrategy.test.js` | New tests |
| `CHANGES/2026-05-02_feat-swift-snapshot-strategy.md` | This entry |
