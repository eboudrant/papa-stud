# fix: rate limit removal, Electron logging

**Date:** 2026-04-08
**Type:** Fix

## Intent

Remove rate limiting that blocked normal desktop app usage. Add server logging and DevTools access for the Electron app.

### Prompts summary

1. Rate limiter (120 req/min) caused "Too many requests" when scrolling fast through scan results
2. Electron app had no way to access server logs or DevTools
3. Add native macOS menu bar with standard shortcuts

## Changes

### `src/handler.js` (MODIFIED)
- Removed `express-rate-limit` dependency and all rate limiting middleware
- Rate limiting is counterproductive for a local-only desktop app

### `electron/main.js` (MODIFIED)
- Server logs written to `~/Library/Application Support/PapaStud/server.log`
- Native macOS menu bar with View (DevTools, zoom, reload), Window, Help menus
- Help → Open Log File / Open Data Directory shortcuts
- `console.log`/`console.error` intercepted and written to log file with timestamps

## Files modified

| File | Change |
|------|--------|
| `src/handler.js` | Remove rate limiting |
| `electron/main.js` | Logging, DevTools, menu bar |
| `package.json` | Remove express-rate-limit dependency |
