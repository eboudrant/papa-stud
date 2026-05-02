# chore: drop Docker for running the app (keep it for screenshot tests)

**Date:** 2026-05-02
**Type:** Chore

## Intent
Electron is the delivery mechanism. Running the server in Docker added friction (host file paths the user wants to scan must be mounted into the container) without solving a real distribution problem. Drop the prod `Dockerfile` and `docker-compose.yml` and document that we don't ship as Docker. Keep `Dockerfile.test` — it's load-bearing for pixel-consistent Playwright baselines.

### Prompts summary
1. Should we still ship a Docker image for running the app?
2. Inventory the Docker cruft and remove the prod-only pieces
3. Record the policy decision in `.claude/rules/` so it doesn't get reintroduced

## Changes

### `Dockerfile`, `docker-compose.yml` (deleted)
- Production-server container + compose stack. Replaced by Electron / `npm start`.

### `.claude/rules/architecture.md`
- Drop the **Docker** stack and **Data volume** lines, drop `docker compose up` from the Running block.
- Add a "No Docker for the app" section explaining the policy and singling out `Dockerfile.test` as the kept exception.

### `.claude/rules/dev_workflow.md`
- Threat-model section no longer mentions a Docker container — only the Electron 127.0.0.1 bind.

### `src/handler.js`
- Path-injection CodeQL suppression comment updated: drop the "or runs inside a Docker container" clause.

## Files modified

| File | Change |
|------|--------|
| `Dockerfile` | Deleted |
| `docker-compose.yml` | Deleted |
| `.claude/rules/architecture.md` | Drop prod-Docker, add policy section |
| `.claude/rules/dev_workflow.md` | Threat model: Electron-only |
| `src/handler.js` | Update CodeQL suppression comment |
| `CHANGES/2026-05-02_chore-drop-prod-docker.md` | This entry |
