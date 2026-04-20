# feat: accept baseline UI for Paparazzi failures

**Date:** 2026-04-20
**Type:** Feature

## Intent

Let users accept a rendered actual image as the new baseline without shelling out to `cp`. A failure can now be accepted from the detail view (per-failure) or from the review page (all at once), and the file system side-effect is a single atomic `copyFileSync` from `actual_path` to `golden_path`. Status is persisted on the scan so accepted images stay marked as accepted across reloads without a rescan.

### Prompts summary

1. UI for accepting Paparazzi baselines by copying actual to golden
2. Checkmark icon button with tooltip + keyboard shortcut; auto-advance to next failure on accept
3. Toasts shouldn't accumulate, they should replace
4. No confirm dialog, no rescan, status can stay marked accepted
5. Add Accept All button from the scan
6. Unify both buttons visually; hide Accept All when nothing left to accept

## Changes

### `src/projects.js`
- New `acceptBaseline(scanId, filename)` and `acceptAllBaselines(scanId)`. Both go through shared helpers `_getScanAndRoot` (loads scan + realpath'd project root) and `_copyActualToGolden` (resolves actual via `realpathSync`, resolves golden parent via `mkdirSync` + `realpathSync`, then enforces both must live under the project root).

### `src/handler.js`
- `POST /api/scans/:scanId/failures/:filename/accept` and `POST /api/scans/:scanId/accept-all`.

### `static/js/detail.js`
- Checkmark "✓ Accept" button in the detail header (or "✓ Accepted" badge when already accepted). `Enter` key triggers accept. On success, mutates the failure in place and either auto-advances to the next failure or re-renders.

### `static/js/review.js`
- "✓ Accept All" button in the review toolbar, hidden when `stats.total === stats.accepted`. After accept-all, updates `_allFailures` and `_scanData.stats` in place instead of refetching all pages (keeps decoded thumbnail images).
- `thumb-accepted` opacity + checkmark badge on accepted thumbnails.

### `static/js/api.js`
- `showToast` now replaces any existing toast instead of stacking (container cleared + pending timer cancelled).

### `static/css/app.css`
- New `.btn-success` variant (green outline, solid green on hover) used by both Accept buttons.
- `.accept-badge`, `.thumb-accepted`, `.thumb-accepted-badge` for the accepted state.

### `tests/node/projects.test.js`
- 6 tests for `acceptBaseline`: happy path, first-time capture (no golden yet), missing actual, unknown scan, unknown filename, path outside project root.

### `tests/screenshots/*.png`
- Regenerated baselines for review grid (light + dark), review sidebar, and detail views (delta, toggle, slider, dark). Previous baselines were stale (pre-"Re-scan" rename, pre-Accept buttons).

## Files modified

| File | Change |
|------|--------|
| `src/projects.js` | Accept-baseline backend, shared path-resolution helpers |
| `src/handler.js` | Two POST routes |
| `static/js/detail.js` | Accept button + Enter shortcut + auto-advance |
| `static/js/review.js` | Accept All button + in-place grid update |
| `static/js/api.js` | Toast replaces instead of accumulating |
| `static/css/app.css` | `.btn-success` + accepted-state styles |
| `tests/node/projects.test.js` | acceptBaseline unit tests |
| `tests/screenshots/*.png` | Regenerated baselines |
