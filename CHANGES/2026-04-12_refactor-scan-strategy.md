# refactor: scan strategy pattern + startup data migration

**Date:** 2026-04-12
**Type:** Chore

## Intent
Prepare for iOS support by extracting Gradle-specific scanning logic into a strategy module. Each project type (gradle, future swift) provides its own module discovery, watch directories, and JUnit support. Also add startup data migration so existing configs are upgraded cleanly.

### Prompts summary
1. Extract Gradle discovery/watch logic into src/strategies/gradle.js
2. Scanner delegates to strategy instead of hardcoding Gradle conventions
3. Startup migration adds strategy field to existing profiles/templates
4. Remove result_source — strategy.usesJunit controls JUnit behavior
5. Pre-migration backups saved to data/backups/

## Changes

### `src/strategies/gradle.js` (new)
- discoverModules, getWatchDirs, resolveModulePath, usesJunit: true

### `src/strategies/index.js` (new)
- Strategy registry with getStrategy(name)

### `src/dataMigration.js` (new)
- Schema versioning via data/meta.json
- v1→v2 migration adds strategy: 'gradle' to profiles/templates
- Backs up data files before migrating

### `src/scanner.js`
- Removed Gradle-specific discovery (moved to strategy)
- Accepts strategyName param, delegates to strategy
- Uses strategy.usesJunit to control JUnit parsing

### `src/watcher.js`
- Uses strategy.getWatchDirs and strategy.discoverModules

### `src/scanJobs.js`
- Passes strategy through scan and watch chains

### `src/templates.js`
- Added strategy: 'gradle' to built-in templates and createTemplate/templateToProfile
- Removed result_source (folded into strategy)

### `src/server.js` + `electron/main.js`
- Call migrateDataFiles on startup

### `src/projects.js`
- Removed migrate-on-read (startup migration handles it)

### `static/js/home.js`
- Removed result_source dropdown from template/profile editors

## Files modified

| File | Change |
|------|--------|
| `src/strategies/gradle.js` | New: Gradle strategy |
| `src/strategies/index.js` | New: strategy registry |
| `src/dataMigration.js` | New: schema migration |
| `src/scanner.js` | Delegate to strategy |
| `src/watcher.js` | Use strategy for dirs/discovery |
| `src/scanJobs.js` | Pass strategy through |
| `src/handler.js` | Pass project.strategy to startScan |
| `src/templates.js` | Add strategy field, remove result_source |
| `src/server.js` | Startup migration |
| `electron/main.js` | Startup migration |
| `src/projects.js` | Remove migrate-on-read |
| `static/js/home.js` | Remove result_source UI |
| `tests/node/scanner.test.js` | Import from strategies/gradle |
