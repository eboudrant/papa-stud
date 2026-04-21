# docs: mention accept baseline + refresh screenshots

**Date:** 2026-04-20
**Type:** Chore

## Intent

The Accept Baseline feature shipped in #66 isn't reflected anywhere user-facing. Update README features list and the Papa Stud.io landing page features list to call it out, and refresh the screenshot assets that power both so they show the new "Accept All" toolbar button, the "Accept" button in the detail header, and the renamed "Re-scan" (was "Watch"). Also drop the "Real-time file watching" bullet since Watch is currently replaced by manual Re-scan (chokidar hits EMFILE on large projects).

### Prompts summary

1. Update the README and the website to mention accept baseline

## Changes

### `README.md`
- New feature bullet for Accept baseline.
- Removed "Real-time file watching (re-scans on test re-run)" — the Watch button was replaced by a manual Re-scan button.

### `docs/index.html`
- Same changes to the landing page Features list.

### `docs/assets/screenshots/{home,review-grid,detail}-dark.png`
- Synced from the up-to-date Playwright baselines in `tests/screenshots/` so the landing page and the README header collage both show the current UI (Re-scan, Accept All, Accept).

## Files modified

| File | Change |
|------|--------|
| `README.md` | Accept baseline bullet, drop Watch bullet |
| `docs/index.html` | Same |
| `docs/assets/screenshots/*-dark.png` | Refreshed from tests/screenshots baselines |
