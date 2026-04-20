# feat: clickable project name in detail nav

**Date:** 2026-04-20
**Type:** Feature

## Intent

On the detail view, the project name in the breadcrumb was a plain label. Clicking it did nothing, so returning to the scan required the back arrow or the browser back button. Making the project name a link back to `/scans/:scanId` matches the standard breadcrumb pattern and gives users a second, more direct way to jump from a failure back to its scan grid.

### Prompts summary

1. When I'm on a detail, if I click the project in the nav bar it should go back to the scan

## Changes

### `static/js/router.js`
- In `_buildNavItems`, the `project` item for detail routes is now `{ tag: 'a', cls: 'nav-link', href: '#/scans/${scanId}' }` (previously `{ tag: 'span', cls: 'nav-label' }`). Uses the existing `.nav-link` style so hover highlight + cursor are already correct.
- `_createNavEl` applies `item.href` on the element when present.
- `_updateNav` same-structure fast path also refreshes `href` so navigating between two different scans' detail views doesn't leave a stale link target.

### `tests/screenshots/detail-*.png`
- Regenerated baselines. The project label's font-weight (bold → medium) and color (primary text → dim) changed as a side-effect of swapping `.nav-label` for `.nav-link`.

## Files modified

| File | Change |
|------|--------|
| `static/js/router.js` | Project breadcrumb becomes an anchor in detail view |
| `tests/screenshots/detail-*.png` | Regenerated baselines |
