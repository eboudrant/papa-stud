# fix: theme persistence and white blink in Electron

**Date:** 2026-04-12
**Type:** Fix

## Intent
Theme preference was lost on every Electron restart because localStorage is tied to the random port. Also, dark mode users saw a white flash on launch.

### Prompts summary
1. Persist theme via IPC to userData/theme.json (survives port changes)
2. Set backgroundColor from saved theme before window shows
3. Sync Electron-persisted theme to localStorage on startup

## Changes

### `electron/main.js`
- Add theme read/write to userData/theme.json
- IPC handlers: get-theme (invoke), set-theme (send)
- Set backgroundColor dynamically from saved theme (respects system preference)

### `electron/preload.js`
- Expose getTheme/setTheme IPC to renderer

### `static/index.html`
- On Electron startup, sync theme from IPC to localStorage
- setTheme writes to both localStorage and Electron IPC

## Files modified

| File | Change |
|------|--------|
| `electron/main.js` | Theme persistence + dynamic backgroundColor |
| `electron/preload.js` | getTheme/setTheme IPC bridge |
| `static/index.html` | Electron theme sync |
