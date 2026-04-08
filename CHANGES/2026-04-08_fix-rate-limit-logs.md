# fix: rate limit removal, Electron logging + Edit menu

**Date:** 2026-04-08
**Type:** Fix

## Intent

Remove rate limiting that blocked normal desktop app usage. Add server logging, DevTools access, and Edit menu (copy/paste) for the Electron app.

### Prompts summary

1. Rate limiter (120 req/min) caused "Too many requests" when scrolling fast through scan results
2. Electron app had no way to access server logs or DevTools
3. Add native macOS menu bar with standard shortcuts
4. Copy/paste (Cmd+C/V) didn't work without Edit menu roles registered

## Changes

### `src/handler.js` (MODIFIED)
- Removed `express-rate-limit` dependency and all rate limiting middleware
- Rate limiting is counterproductive for a local-only desktop app

### `electron/main.js` (MODIFIED)
- Server logs written to `~/Library/Application Support/PapaStud/server.log`
- Native macOS menu bar: Edit (undo/redo/cut/copy/paste/selectAll), View (DevTools, zoom, reload), Window, Help
- Help → Open Log File / Open Data Directory shortcuts
- `console.log`/`console.error` intercepted and written to log file with timestamps
- Edit menu registers Cmd+C/V/X/Z/A shortcuts (required by macOS)

## Files modified

| File | Change |
|------|--------|
| `src/handler.js` | Remove rate limiting |
| `electron/main.js` | Logging, DevTools, Edit menu, menu bar |
| `package.json` | Remove express-rate-limit dependency |
