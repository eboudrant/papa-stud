# ci: pin release build to Node 22 (real fix for empty release artifacts)

**Date:** 2026-06-04
**Type:** CI

## Intent
The v0.0.20 release produced no installers: the macOS build jobs succeeded but
emitted no `.dmg`/`.zip`, so "Create Release" failed downloading missing
artifacts. Root cause (reproduced locally both ways): **electron-forge 7.11.2
(latest stable) silently fails under Node 24.x** — `electron-forge make` runs the
package phase, stops at "Finalizing package", never runs the makers, and exits 0
with an empty `out/make`. Under **Node 22** the same code + deps produce the
dmg/zip. The earlier electron 42→41 pin (#119) was a misdiagnosis: electron was
never the cause (v0.0.19 shipped on electron 42.2.0); both 41 and 42 build fine
on Node 22 and both fail on Node 24.

`ci.yml` never runs `electron-forge make`, so this only surfaced at release time.
No stable electron-forge supports Node 24 yet (only 8.0.0-alpha targets it), so
pinning the release build to Node 22 is the robust fix.

### Prompts summary
1. After two failed release attempts, investigated the Node 24 packaging break and chose to pin the release build to Node 22 and restore electron to ^42.

## Changes

### `.github/workflows/release.yml`
- Build job `setup-node` `node-version` `'24'` → `'22'` (with a comment explaining why).

### `package.json` / `package-lock.json`
- Restore `electron` `^41.7.1` → `^42.0.0` (reverts the #119 pin; resolves 42.3.3).

## Verification
- Locally, `npm ci` + `npx electron-forge make --arch=arm64` on **Node 22 +
  electron 42.3.3** runs both makers and produces `out/make/PapaStudio.dmg` and
  the arm64 zip. On Node 24 the same setup produces nothing.

## Files modified

| File | Change |
|------|--------|
| `.github/workflows/release.yml` | Pin release build to Node 22 |
| `package.json` | Restore `electron` to `^42.0.0` |
| `package-lock.json` | Regenerated for electron 42.3.3 |
