# feat: CI pipeline and screenshot tests

**Date:** 2026-04-03
**Type:** Feature

## Intent

Set up GitHub Actions CI and Playwright screenshot testing so every PR gets automated checks before merging. Also adds CLAUDE.md with project docs and git workflow conventions.

### Prompts summary

1. Add the same level of GH Actions as the reference project and add a first screenshot test
2. Add CLAUDE.md to the repo with project overview and CHANGES workflow

## Changes

### `.github/workflows/ci.yml`
- **Python checks**: Matrix across 3.11–3.13 — syntax compilation and import verification
- **Python lint**: ruff linting and format checking
- **JavaScript checks**: Node 24 syntax validation
- **Screenshot tests**: Docker-based Playwright tests with artifact upload and PR failure comments

### `Dockerfile.test`
- Playwright 1.59.1 noble base image with Python 3
- Cached npm install layer, copies app source, runs `npx playwright test` by default

### `playwright.config.js`
- Two projects: mobile (390x844) and desktop (1280x800)
- Zero-tolerance pixel diff, platform-independent snapshot paths
- Auto-starts Python server on port 8770

### `package.json`
- Scripts for building test image, running tests, and updating baselines

### `tests/screenshots/hello.spec.js`
- First screenshot test: verifies "Papa Stud" header and "Hello, World" card render correctly
- Baselines generated for both mobile and desktop viewports

### `CLAUDE.md`
- Project overview, stack, Docker run instructions
- Git workflow: feature branches + `CHANGES/YYYY-MM-DD_slug.md` before merging

### `.gitignore`
- Added `node_modules/`, `test-results/`, `playwright-report/`

## Files modified

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | CI pipeline with 4 jobs |
| `Dockerfile.test` | Playwright test container |
| `playwright.config.js` | Playwright config (mobile + desktop) |
| `package.json` | npm scripts and Playwright dependency |
| `tests/screenshots/hello.spec.js` | First screenshot test |
| `tests/screenshots/mobile/hello.png` | Mobile baseline |
| `tests/screenshots/desktop/hello.png` | Desktop baseline |
| `CLAUDE.md` | Project docs and workflow conventions |
| `.gitignore` | Added test/node artifacts |
