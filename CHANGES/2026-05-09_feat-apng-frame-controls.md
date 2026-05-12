# feat: detect APNGs and add play/pause + frame stepping

**Date:** 2026-05-09
**Type:** Feature

## Intent

Some snapshot tests record animated PNGs (APNG); the browser plays them inline but offers no way to pause, step, or scrub frames — so visual diffing of an animated golden against an animated actual was a guessing game. This adds detection plus per-panel canvas controls so the user can pause both sides on the same frame and compare.

APNG isn't distinguishable by file extension. The detection looks for the `acTL` chunk that, per spec, must appear after `IHDR` and before the first `IDAT`. We read at most 1 KB to find it; the cost is a single small file read per image, only on detail-page loads.

The control bar (prev / play-pause / next / scrub / counter) is per panel — Expected, Diff, and Actual each play independently — so the user can desync to compare the same content frame against different positions in time.

### Prompts summary
1. "We can now render some apng, they play fine, is there a way we can detect a apng and then add play/pause button and next/previous frame?"
2. Decoder choice: bundle UPNG.js (~25 KB) over hand-rolling a parser — battle-tested, MIT
3. Controls placement: per panel (independent), not a single shared bar

## Changes

### `src/apng.js` (new)
- `detectApng(filePath)` opens the file, reads up to 1 KB, walks PNG chunks for `acTL`. Returns `{ apng, frameCount?, plays? }`.
- `parseApngHeader(buffer)` is the pure helper used by both the file-based detector and the unit tests.

### `src/handler.js`
- Extracted the `/api/images` path-allowlist logic into a `resolveImagePath(filePath)` helper so `/api/images/meta` can share it without copy-paste.
- New `GET /api/images/meta?path=...` returns `{ apng, frameCount, plays }`.

### `static/vendor/`
- Vendored `UPNG.js` (47 KB, MIT — photopea/UPNG.js) and `pako_inflate.min.js` (21 KB, MIT/Zlib — nodeca/pako). Inflate-only build is enough for decoding; we never call `UPNG.encode`.

### `static/js/apng.js` (new)
- `papastudApng.enhanceAll(root)` walks `<img src="/api/images?...">` elements, fetches meta in parallel, and for any APNG with ≥2 frames replaces the `<img>` with a `<canvas>` plus a control bar. Decoded frames are cached on the canvas closure so scrubbing is instant.
- Decode failures fall back silently — the user still sees the auto-playing native `<img>`.

### `static/js/detail.js`
- Calls `papastudApng.enhanceAll(content)` once after each detail-view render. Idempotent via a `data-apng-enhanced` flag.

### `static/index.html`
- Loads the vendored `pako_inflate.min.js`, `UPNG.js`, and the new `apng.js` before the existing app scripts.

### `static/css/app.css`
- New `.apng-wrap`, `.apng-controls`, `.apng-btn`, `.apng-scrub`, `.apng-count` rules so the canvas + controls inherit the same flex layout the panel `<img>` had.

### Tests
- `tests/node/apng.test.js` covers `parseApngHeader` (real APNG, plain PNG, non-PNG, empty input) and `detectApng` (real file, plain file, missing file).

## Files modified

| File | Change |
|------|--------|
| `src/apng.js` | new — APNG header detection |
| `src/handler.js` | resolveImagePath helper + /api/images/meta route |
| `static/vendor/UPNG.js` | vendored (MIT) |
| `static/vendor/pako_inflate.min.js` | vendored (MIT/Zlib) |
| `static/js/apng.js` | new — client-side enhancer |
| `static/js/detail.js` | call enhanceAll after each render |
| `static/index.html` | load vendor + apng.js |
| `static/css/app.css` | controls styling |
| `tests/node/apng.test.js` | new — header detection tests |
