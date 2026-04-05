# feat: configurable scan profiles (Figma comparison support)

**Date:** 2026-04-05
**Type:** Feature

## Intent

Support custom Paparazzi comparison handlers (e.g., Figma vs baseline) where failures and reference images are in different directories. Each project can have multiple scan profiles with configurable failure dirs and golden pattern fallback chains.

### Prompts summary

1. Support custom test layouts where goldens and deltas are in different folders
2. Profile config per project: name, failures dir, golden patterns with {name} placeholder
3. Golden pattern fallback chain (try @4x -> @2x -> base, try all/ -> examples/)
4. Profile filter pills in review page, profile tags on failure cards
5. Toggle/slider fallback to delta when actual image is missing

## Changes

### `server/scanner.py` (MODIFIED)
- `process_single_module()` accepts profiles list, processes each profile's failure/golden dirs
- New `_process_profile()` extracted — handles one profile's failures with golden pattern resolution
- New `_build_golden_patterns()` — builds pattern list from profile config (supports golden_dir + golden_suffix or explicit golden_patterns)
- New `_resolve_golden()` — tries each pattern in order, returns first existing file
- Stale golden check uses pattern resolution

### `server/projects.py` (MODIFIED)
- `DEFAULT_PROFILES` constant with baseline profile including golden_patterns
- `add_project()` initializes with default profiles
- `update_project_profiles()` for profile CRUD
- `list_projects()` migration: adds default profiles to legacy projects and persists
- `get_scan()` supports `profile` filter parameter

### `server/scan_jobs.py` (MODIFIED)
- `start_scan()` passes profiles to incremental scanner
- `start_watching()` passes profiles to watcher and process_single_module

### `server/handler.py` (MODIFIED)
- `PUT /api/projects/{id}/profiles` endpoint
- Passes profiles when starting scans
- `profile` query parameter on scan GET endpoint

### `server/watcher.py` (MODIFIED)
- Watch directories expanded from profiles (all failure dirs + golden dirs)

### `static/js/home.js` (MODIFIED)
- Profile tags shown on project cards
- "Profiles" button opens config form with name, failures dir, golden patterns textarea
- Add/remove profiles, save via API

### `static/js/review.js` (MODIFIED)
- Profile filter pills (All | baseline | figma | etc.) — only shown when multiple profiles have failures
- Profile tag on thumbnail cards for non-baseline profiles
- Profile parameter passed in API calls

### `static/js/detail.js` (MODIFIED)
- Toggle shows golden filename in label
- Fallback: uses delta when actual image is missing (for handlers that only write deltas)
- Slider disabled with message when actual is missing

### `static/css/app.css` (MODIFIED)
- Profile tag, profile config form, filter pills styles

## Files modified

| File | Change |
|------|--------|
| `server/scanner.py` | Multi-profile processing, golden pattern resolution |
| `server/projects.py` | Profile CRUD, migration, profile filter |
| `server/scan_jobs.py` | Pass profiles through scan and watch |
| `server/handler.py` | Profiles API endpoint, profile query param |
| `server/watcher.py` | Multi-profile watch dirs |
| `static/js/home.js` | Profile config UI, profile tags |
| `static/js/review.js` | Profile filter pills, profile tags on cards |
| `static/js/detail.js` | Golden filename label, actual fallback |
| `static/css/app.css` | Profile styles |
| `tests/test_scanner.py` | Multi-profile, golden fallback, profile tag tests |
| `tests/screenshots/fixtures.js` | Profiles + profile_counts in mock data |
| `tests/screenshots/hello.spec.js` | Profile tags screenshot test |
| `tests/screenshots/review.spec.js` | Profile pills screenshot test |
