# feat: in-app update check banner

**Date:** 2026-04-20
**Type:** Feature

## Intent

Users installing Papa Stud via `brew install --cask papastud` had no way to know a new version was available unless they ran `brew upgrade` blindly. This adds a subtle banner on the home page when a newer release is published on GitHub, with a one-click copy of the upgrade command, a link to release notes, and a per-version dismiss.

### Prompts summary

1. In-app auto update — check and notify, not a dialog but a mention on the home page
2. We need a button to dismiss the update nudge, also a copy command button
3. Copy button should be next to the command, not next to release notes link; use an icon
4. Command text color in blue with good contrast; use color tokens
5. /simplify

## Changes

### `src/updateCheck.js` (new)

GitHub Releases fetch with in-flight dedup and separate TTLs for success (30 min) and failure (5 min). Semver compare on strict `vX.Y.Z` tags. Uses `PAPASTUD_VERSION` env var as the current version (only set by the packaged Electron build), so the check is a no-op in dev / Docker.

### `src/handler.js`

New route `GET /api/update-check` returning `{ available, current, latest, url }`.

### `electron/main.js`

Sets `process.env.PAPASTUD_VERSION = app.getVersion()` in `startServer` when `app.isPackaged`.

### `static/js/home.js`

Added `<div id="update-banner">` at the top of the home layout. Fetches `/api/update-check` once per session (guarded by a module flag) outside the main `Promise.all` so GitHub latency never blocks the home render. Dismissal writes the latest version to `localStorage` under `UPDATE_DISMISSED_KEY` so the banner stays hidden until a newer version appears.

### `static/js/api.js`

Added `copyToClipboard(text, successMsg)` helper — used by the banner's copy button, can be reused elsewhere.

### `static/css/app.css`

New tokens `--accent-deep` and `--accent-bright` for the inline command pill (dark navy + light blue in dark mode; accent blue + white in light mode). Banner styles use `var(--accent)` / `var(--accent-light)` tokens end-to-end.

## Files modified

| File | Change |
|------|--------|
| `src/updateCheck.js` | New module — GitHub Releases check with TTL cache |
| `src/handler.js` | Register `/api/update-check` route |
| `electron/main.js` | Set `PAPASTUD_VERSION` env var when packaged |
| `static/js/home.js` | Banner render + dismiss + once-per-session fetch |
| `static/js/api.js` | `copyToClipboard` helper |
| `static/css/app.css` | Banner styles + `--accent-deep` / `--accent-bright` tokens |
