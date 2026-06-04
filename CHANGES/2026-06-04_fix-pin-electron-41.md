# fix: pin electron to 41.x so the release build produces installers

**Date:** 2026-06-04
**Type:** Fix

## Intent
The v0.0.20 release workflow failed: the macOS build jobs succeeded but produced
no `.dmg`/`.zip`, so "Create Release" errored downloading missing artifacts. The
only change since the last good release (v0.0.19, on electron 41) was the
electron 42.x bump (#115, then #116 → 42.3.3). `ci.yml` never runs
`electron-forge make`, so the regression only surfaced at release time. Pinning
electron back to 41.x restores the known-good packaging path.

### Prompts summary
1. After the v0.0.20 release failed, chose to pin electron back to 41.x.

## Changes

### `package.json` / `package-lock.json`
- `electron` devDependency `^42.0.0` → `^41.7.1` (keeps the other #116 dep updates).

## Verification
- `npx electron-forge make --arch=arm64` locally (electron 41.7.1) produces both
  `out/make/PapaStudio.dmg` and the arm64 zip. (The "Making for the following
  targets: ," line is a cosmetic electron-forge display quirk; the makers run.)

## Files modified

| File | Change |
|------|--------|
| `package.json` | Pin `electron` to `^41.7.1` |
| `package-lock.json` | Regenerated for electron 41.7.1 |
