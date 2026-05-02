# Architecture

## Stack

- **Backend:** Node.js, Express 5, chokidar for filesystem watching.
- **Frontend:** Vanilla HTML/CSS/JS, light theme, system fonts — no build step.
- **Desktop:** Electron (electron-forge for packaging), hidden title bar with traffic lights.

## Running

```
npm run electron               # desktop app, random port
npm start                      # http://localhost:8770 (dev only)
```

## No Docker for the app

Papa Stud does **not** ship as a Docker image. Electron is the delivery mechanism; `npm start` is for local dev. Don't reintroduce a `Dockerfile` / `docker-compose.yml` for running the server — file paths the user wants to scan live on the host, mounting them into a container is friction without value, and Electron already handles single-user-local distribution.

`Dockerfile.test` is the **one** Docker file we keep — it's load-bearing for pixel-consistent Playwright screenshot baselines (rendering drifts across host environments otherwise). See `.claude/rules/testing.md`.

## Source layout

```
electron/main.js        Electron shell (logging, menu, window, embedded server)
src/server.js           Express server entry point (port 8770)
src/handler.js          Express app factory and route definitions
src/projects.js         Project CRUD and data directory management
src/templates.js        Template management
src/scanner.js          Paparazzi report XML/image parsing
src/scanJobs.js         Background scan job orchestration
src/watcher.js          Filesystem watcher (chokidar)
src/video.js            Video / animation support
src/filenameParser.js   Screenshot filename convention parser
static/                 Frontend (HTML, CSS, JS) served as static files
data/                   Runtime data (projects.json, templates.json, scans/)
```

## Electron specifics

- Data stored in `app.getPath('userData')/data/` (survives app updates).
- Server binds to `127.0.0.1:0` (random port) in Electron mode.
- Logs written to `app.getPath('userData')/server.log`.
- Help menu exposes "Open Log File" and "Open Data Directory".
- **User preferences (theme, etc.) persist via IPC to JSON files in `userData/`, not via `localStorage`.** `localStorage` is keyed by origin including port; the random port means a fresh "origin" every launch and the value is lost. See `electron/main.js` `themeFilePath()` / `readTheme()` / `writeTheme()` and the `get-theme` / `set-theme` IPC handlers.
