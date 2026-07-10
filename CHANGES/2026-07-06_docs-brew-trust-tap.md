# docs: document `brew trust` for Homebrew 6.0+ tap trust

**Date:** 2026-07-06
**Type:** Docs

## Intent
Homebrew 6.0 (June 2026) added a security requirement: third-party (non-official)
taps must be explicitly trusted before Homebrew will load their casks. Users hit
`Error: Refusing to load cask eboudrant/tap/papastudio from untrusted tap` on
install and upgrade. Document the one-time `brew trust eboudrant/tap` step across
the README, the docs site, and the in-app update banner.

### Prompts summary
1. User reported `brew upgrade --cask papastudio` failing with the untrusted-tap error.
2. User asked to update the README and/or the in-product instructions.

## Changes

### `README.md`
- Added `brew trust eboudrant/tap` to the Install block with a note that it's
  Homebrew 6.0+ only and can be skipped on older versions.
- Added an Update note pointing at `brew trust` when the upgrade hits the
  untrusted-tap error.

### `docs/index.html`
- Added the `brew trust` line to the install `<pre>` block and a caption
  explaining the 6.0+ requirement.

### `static/js/home.js`
- Chained `brew trust eboudrant/tap && ` into the in-app update banner's
  `UPDATE_CMD` so the copy button yields a command that works on 6.0+.
  `brew trust` is idempotent, so this stays a no-op once the tap is trusted.

## Files modified

| File | Change |
|------|--------|
| `README.md` | Install/Update instructions include `brew trust` step |
| `docs/index.html` | Install block + caption document tap trust |
| `static/js/home.js` | Update banner command chains `brew trust` |
