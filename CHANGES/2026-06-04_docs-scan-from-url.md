# docs: document Scan from URL

**Date:** 2026-06-04
**Type:** Docs

## Intent
Document the new Scan from URL feature (review a CI run's screenshot failures
against local goldens) for users, in both the README and the GitHub Pages site.

### Prompts summary
1. "can we add some doc about the new field? in the readme maybe?"
2. "and in the web site, like load result remotely from CI"

## Changes

### `README.md`
- Added a **Scan from URL** feature bullet and a short usage subsection (add
  project locally → click the cloud-download button → paste the tarball URL).

### `docs/index.html`
- Added a "Review CI results remotely" feature card to the features grid.

## Files modified

| File | Change |
|------|--------|
| `README.md` | Scan from URL feature bullet + usage subsection |
| `docs/index.html` | "Review CI results remotely" feature card |
