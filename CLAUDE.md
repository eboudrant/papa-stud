# Papa Stud

## Project Overview

Self-hosted tool for processing and viewing Paparazzi screenshot test images.

- **Backend:** Node.js, Express 5, chokidar for filesystem watching
- **Frontend:** Vanilla HTML/CSS/JS, light theme, system fonts — no build step
- **Desktop:** Electron (electron-forge for packaging), hidden title bar with traffic lights
- **Docker:** `node:24-slim`, non-root `papastud` user, port **8770**
- **Data volume:** `/app/data` (persistent via `papastud-data` Docker volume)

### Running locally

```bash
# Docker (server only)
docker compose up --build -d
# App at http://localhost:8770

# Electron (desktop app — picks a random port)
npm run electron

# Node server only
npm start
# App at http://localhost:8770
```

### Project structure

```
electron/main.js   — Electron shell (logging, menu, window, embedded server)
src/server.js      — Express server entry point (port 8770)
src/handler.js     — Express app factory and route definitions
src/projects.js    — Project CRUD and data directory management
src/templates.js   — Template management
src/scanner.js     — Paparazzi report XML/image parsing
src/scanJobs.js    — Background scan job orchestration
src/watcher.js     — Filesystem watcher (chokidar)
src/video.js       — Video/animation support
src/filenameParser.js — Screenshot filename convention parser
static/            — Frontend (HTML, CSS, JS) served as static files
data/              — Runtime data (projects.json, templates.json, scans/)
```

### Electron specifics

- Data stored in `app.getPath('userData')/data/` (survives app updates)
- Server binds to `127.0.0.1:0` (random port) in Electron mode
- Logs written to `app.getPath('userData')/server.log`
- Help menu has "Open Log File" and "Open Data Directory"

## Testing

### Unit tests

```bash
npm test
```

Tests live in `tests/node/*.test.js`, run with Node's built-in test runner.

### Screenshot tests

Playwright in Docker for consistent rendering. Desktop only (1280x800), zero-tolerance pixel diff.

```bash
# Build test image
docker build -f Dockerfile.test -t papastud-test .

# Run tests
docker run --rm -e CI=true papastud-test npx playwright test

# Update baselines after intentional UI changes
docker run --rm -v ./tests/screenshots:/app/tests/screenshots papastud-test npx playwright test --update-snapshots
```

- Baselines live in `tests/screenshots/*.png` (flat, no subdirectories)
- Tests live in `tests/screenshots/*.spec.js`
- Config: `playwright.config.js` — starts `node src/server.js` on port 8770 automatically

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on push to main and PRs:

- **Node.js checks** — syntax validation for backend + frontend JS (Node 20, 22, 24)
- **Unit tests** — `npm test`
- **Screenshot tests** — Docker-based Playwright, uploads artifacts + posts PR comment on failure

## Git Workflow

Create a feature branch for every new piece of work. When ready to merge, create a changelog entry in `CHANGES/` before merging to main.

### Branch naming

`feat/short-description`, `fix/short-description`, `chore/short-description`

### CHANGES file

Before merging, create `CHANGES/YYYY-MM-DD_slug.md` with this structure:

```
# type: short description

**Date:** YYYY-MM-DD
**Type:** Feature | Fix | Chore | CI

## Intent
Why this change exists.

### Prompts summary
1. Numbered list of key prompts that drove the work

## Changes

### `path/to/file.py`
- What changed and why

## Files modified

| File | Change |
|------|--------|
| `path/to/file` | Brief description |
```

Slug format: `type-short-kebab-description` (e.g., `feat-image-upload`, `fix-routing-bug`).
