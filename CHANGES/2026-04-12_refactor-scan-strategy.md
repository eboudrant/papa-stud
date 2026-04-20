# refactor: scan strategy pattern + startup data migration

**Date:** 2026-04-12
**Type:** Chore

## Intent
Prepare for iOS support by extracting Gradle-specific scanning logic into a strategy module. Each project type (gradle, future swift) provides its own module discovery, watch directories, and JUnit support. Also add startup data migration so existing configs are upgraded cleanly.

### Prompts summary
1. Extract Gradle discovery/watch logic into src/strategies/gradle.js
2. Scanner delegates to strategy instead of hardcoding Gradle conventions
3. Startup migration adds project-level strategy, strips result_source
4. Strategy is a project-level property (not per-profile); strategy.usesJunit controls JUnit behavior
5. Pre-migration backups saved to data/backups/

## Changes

### `src/strategies/gradle.js` (new)
- discoverModules, getWatchDirs, resolveModulePath, usesJunit: true

### `src/strategies/index.js` (new)
- Strategy registry with getStrategy(name)
- Exports DEFAULT_STRATEGY constant
- Throws on unknown strategy (no silent fallback)

### `src/dataMigration.js` (new)
- Schema versioning via data/meta.json
- v1→v2 migration: sets project.strategy='gradle', strips result_source/strategy from profiles and templates
- Reuses templates.templateToProfile(paparazzi) instead of hardcoding profile shape
- Backs up data files to data/backups/v1/ before migrating

### `src/jsonStore.js` (new)
- Shared readJson/writeJson helpers (atomic tmp+rename)
- Used by projects.js, templates.js, dataMigration.js

### `src/scanner.js`
- Removed Gradle-specific discovery (moved to strategy)
- Accepts strategyName param, delegates to strategy
- Uses strategy.usesJunit to control JUnit parsing
- Fixed goldenCache basename collision (now keyed by full path)
- Consolidated redundant existsSync+statSync into try/statSync

### `src/watcher.js`
- Uses strategy.getWatchDirs and strategy.discoverModules
- Consolidated redundant existsSync+statSync

### `src/scanJobs.js`
- Passes strategy through scan and watch chains

### `src/templates.js`
- Removed result_source (unused after strategy refactor)
- Templates no longer carry strategy (it belongs on the project)
- Uses shared readJson/writeJson from jsonStore

### `src/projects.js`
- addProject accepts strategy param (defaults to 'gradle')
- Removed migrate-on-read (startup migration handles it)
- Uses shared readJson/writeJson from jsonStore

### `src/handler.js`
- POST /api/projects passes body.strategy to addProject
- POST /api/projects/:id/scan passes project.strategy

### `src/server.js` + `electron/main.js`
- Call migrateDataFiles on startup

### `static/js/home.js`
- Removed result_source dropdown from template/profile editors

## Files modified

| File | Change |
|------|--------|
| `src/strategies/gradle.js` | New: Gradle strategy |
| `src/strategies/index.js` | New: strategy registry |
| `src/dataMigration.js` | New: schema migration |
| `src/jsonStore.js` | New: shared JSON helpers |
| `src/scanner.js` | Delegate to strategy, fix goldenCache |
| `src/watcher.js` | Use strategy for dirs/discovery |
| `src/scanJobs.js` | Pass strategy through |
| `src/handler.js` | Pass strategy on project creation and scan |
| `src/templates.js` | Remove result_source, use shared jsonStore |
| `src/server.js` | Startup migration |
| `electron/main.js` | Startup migration |
| `src/projects.js` | strategy on project, shared jsonStore |
| `static/js/home.js` | Remove result_source UI |
| `tests/node/scanner.test.js` | Import from strategies/gradle |
