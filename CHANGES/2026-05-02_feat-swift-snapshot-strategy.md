# feat: swift-snapshot-testing strategy (iOS / Xcode)

**Date:** 2026-05-02
**Type:** Feature

## Intent
Add native support for Apple/Xcode projects that use `pointfreeco/swift-snapshot-testing`. The engine writes failure attachments inside an `.xcresult` bundle (not on disk), so we shell out to `xcrun xcresulttool` to extract them. Strategy is project-level via the existing strategy pattern (`gradle` ↔ `swift-snapshot`). Validated end-to-end against a sample SPM package and against iosui-argo's `HawkinsComponentsGallery` (85 failures from one test class).

### Prompts summary
1. Identify the iOS tool used in iosui-argo (`Snapshot` framework wrapping pointfreeco/swift-snapshot-testing).
2. Phase 2: parse `.xcresult` natively rather than going through a JUnit pipeline.
3. Discovery: newest `*.xcresult` under project root + per-project override field.
4. Cover `failure-N.png` (multiple failed assertions per test).
5. Test end-to-end with a sample app, then with `iosui-argo/Argo/HawkinsComponentsGallery`.
6. Render swift-snapshot's raw pixel-XOR delta as a 3-panel strip in the UI (Roborazzi/Paparazzi already composite their delta).

## Changes

### `src/xcresultParser.js` (new)
Wraps `xcrun xcresulttool`:
- `parseXcresult(path, cacheDir)` — runs `get test-results tests --compact` for stats + `export attachments` for the manifest, returns `{ stats, failures, mtime }`. Note: we deliberately omit `--only-failures` because Xcode tags swift-snapshot's reference / failure / difference PNGs as `isAssociatedWithFailure: false` (only the issue-description text is `true`); the flag would strip the actual triplet and leave us with nothing.
- `findNewestXcresult(root)` — deep walk pruning `.git / node_modules / .build / .swiftpm / Pods / .checkout`.
- `ensureExtension(path, humanName)` — renames bare-UUID exports to add the suggested extension so `/api/images` recognises them as PNGs.
- Pure helpers exposed for unit tests: `walkTestNodes`, `classifyAttachment`, `groupManifestByTest`, `pairAttachmentsForTest`. The classifier matches Xcode's flattened naming `<role>_<positional-index>_<activity-uuid>.png`; the UUID groups the triplet, so multiple failed assertions in one test method pair correctly.

### `src/strategies/swift-snapshot.js` (new)
- `discoverModules(root)` walks for `__Snapshots__/` directories — each parent dir is a "module" (test target).
- `getWatchDirs`, `resolveModulePath` for the existing strategy contract.
- `parseProjectFailures(root, project, cacheDir)` composes locate → `parseXcresult` → `discoverModules` → `bucketFailures`.
- `bucketFailures(failures, modules, mtime)` (pure) — buckets failures back to modules by which `__Snapshots__/<className>/` exists; pairs each failure with on-disk goldens (`<method>.<N>.png` or `<method>.<preset>.<N>.png`) by sorted enumeration order; tags rows with `delta_kind: 'pixel-diff'`. `readdirSync` is memoized per class dir (a single failed test method commonly fans out to dozens of preset failures).
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

### `static/js/detail.js` + `static/css/app.css`
Delta mode renders a 3-panel **Expected | Diff | Actual** strip when `delta_kind === 'pixel-diff'` (only swift-snapshot, today). swift-snapshot's "difference" is a raw pixel-XOR; the strip composes the three images client-side via flexbox, matching the at-a-glance comparison Roborazzi/Paparazzi get from their already-composited delta. No server-side image work.

### `tests/node/xcresultParser.test.js` (new)
13 tests covering the pure parser helpers including `ensureExtension` rename idempotency and Xcode flattened naming.

### `tests/node/swiftSnapshotStrategy.test.js` (new)
16 tests covering discovery (including pruning), watch dirs, module-path resolution, test-identifier parsing, newest-xcresult finder, `locateXcresult` override semantics, and the `bucketFailures` pairing logic (golden enumeration order, missing-golden fallback, unknown-class bucketing).

## Limitations / follow-ups

- **Watcher does not yet rescan on `.xcresult` changes** for swift-snapshot projects. The current per-module callback model needs a small rework to support a global "re-parse the bundle and rebucket all modules" path. Watch button still works from the UI but won't pick up new test runs until that follow-up lands.
- **macOS-only.** `xcrun xcresulttool` ships with Xcode. Earlier work removed prod Docker (`#84`), so this constraint is consistent with how Papa Stud now ships (Electron / `npm start`).
- **Real iOS projects with strict env asserts** (e.g. iosui-argo's `Snapshot` lib gating on simulator model + iOS version) need env vars to pass through to the test process. The trick is xcodebuild's `TEST_RUNNER_<KEY>` prefix — set it in the shell and Xcode strips the prefix when launching the test bundle. Worth a docs note in the swift-snapshot template setup.
- **Custom-named attachments via Swift Testing's `Attachment.record`** (e.g. `<userName>_0_<UUID>.png`) won't match our regex. iosui-argo's `HawkinsButtonSnapshotTests` happens to use the standard XCTAttachment path, so this didn't bite — but a follow-up to also accept `<any>_\d+_<UUID>.png` and treat it as the actual would unlock projects that route through `Testing+Snapshot.swift`.

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
| `static/js/detail.js` | Delta-mode strip render for `pixel-diff` rows |
| `static/css/app.css` | `.delta-strip*` classes |
| `tests/node/xcresultParser.test.js` | New tests |
| `tests/node/swiftSnapshotStrategy.test.js` | New tests |
| `CHANGES/2026-05-02_feat-swift-snapshot-strategy.md` | This entry |
