# ci: stop Renovate from bumping the CI/release Node version

**Date:** 2026-06-04
**Type:** CI

## Intent
Renovate's `github-actions` manager opened #122 to bump the release workflow's
`node-version` from `22` back to `24`. Node 24 is exactly what breaks the release
(electron-forge 7.11.2 silently produces no installers under Node 24.x — see
`2026-06-04_ci-release-node-22.md`). Left unconfigured, Renovate would re-propose
this every cycle and a careless merge would re-break releases. Disable Renovate
node-version updates for GitHub Actions so the runner Node version stays a
deliberate manual choice.

### Prompts summary
1. "do we need to ignore node in renovate.json?" (re #122)

## Changes

### `renovate.json`
- Add a `packageRule` (`matchManagers: github-actions`, `matchDepNames: node`,
  `enabled: false`) with a `description` explaining the electron-forge / Node 24
  constraint.

## Files modified

| File | Change |
|------|--------|
| `renovate.json` | Disable Renovate node-version updates in GitHub Actions |
