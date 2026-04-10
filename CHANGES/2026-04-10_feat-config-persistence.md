# feat: config persistence, settings page, and navigation overhaul

**Date:** 2026-04-10
**Type:** Feature

## Intent
Add configuration import/export so users can back up and restore their projects and templates. Improve navigation consistency across all pages. Move theme settings to a dedicated settings page.

### Prompts summary
1. Config import/export with versioning and migration support
2. New settings page with appearance, data location, export/import, danger zone
3. Consistent navigation bar with back button, breadcrumbs, and animations
4. Theme picker (System/Light/Dark) in settings, removed from header
5. Various UX improvements: scrollbars, toasts, detail page nav

## Changes

### `src/config.js` (new)
- Config versioning and migration framework (CURRENT_VERSION = 1)
- `migrate()` runs sequential migrations on imported bundles
- `createExportBundle()` helper for consistent export format

### `src/handler.js`
- Added config API routes: info, export (full/individual), import (full/individual), reset
- Export endpoints return pretty-printed JSON
- Import endpoint uses `config.migrate()` for version handling

### `src/projects.js`
- Added `getDataDir()`, `importProjects()`, `resetProjects()`

### `src/templates.js`
- Added `importTemplates()`, `resetTemplates()`

### `static/js/settings.js` (new)
- Settings page with appearance (theme picker), data location, export/import, danger zone
- Individual project and template export buttons

### `static/js/router.js`
- Universal navigation bar (removed Electron-only guard)
- Back button uses real browser history (`history.back()`)
- `navigateReplace()` for detail prev/next (no back stack pollution)
- Nav item diffing with fade in/out animations
- Breadcrumbs: `< projectName / ClassName.methodName`

### `static/js/detail.js`
- Removed hardcoded Back button (nav bar handles it)
- Subtitle shows method name only (no package prefix), with ellipsis
- Prev/next use `navigateReplace` instead of `navigate`
- Passes className/methodName to nav context

### `static/index.html`
- Gear icon links to settings page
- Theme system: System/Light/Dark with OS preference detection
- Double-click header to maximize/unmaximize (Electron)
- Removed theme toggle button from header

### `static/css/app.css`
- Custom themed scrollbars
- Nav bar styles: back button, labels, animations, ellipsis
- Settings page styles
- Toasts moved to bottom center
- Detail subtitle ellipsis

### `electron/main.js`
- Added preload script for IPC
- `backgroundColor` to reduce white flash
- Double-click maximize via IPC

### `electron/preload.js` (new)
- Exposes `toggleMaximize` IPC to renderer

### `tests/node/config.test.js` (new)
- 9 tests: export bundle, migration, roundtrip, merge, builtin skip

## Files modified

| File | Change |
|------|--------|
| `src/config.js` | New: versioned config export/import with migration |
| `src/handler.js` | Config API routes |
| `src/projects.js` | Import/reset/getDataDir helpers |
| `src/templates.js` | Import/reset helpers |
| `static/js/settings.js` | New: settings page UI |
| `static/js/router.js` | Universal nav bar with history and animations |
| `static/js/detail.js` | Nav integration, navigateReplace |
| `static/js/app.js` | Settings route |
| `static/index.html` | Settings icon, theme system, maximize |
| `static/css/app.css` | Scrollbars, nav, settings, toast styles |
| `electron/main.js` | Preload, backgroundColor, maximize IPC |
| `electron/preload.js` | New: IPC bridge |
| `tests/node/config.test.js` | New: config unit tests |
| `CLAUDE.md` | Updated architecture docs |
