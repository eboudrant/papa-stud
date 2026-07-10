# fix: match goldens when the delta name percent-encodes spaces

**Date:** 2026-07-10
**Type:** Fix

## Intent
A Roborazzi screenshot whose name contains a space showed "No golden image" even
though the golden existed. Roborazzi emitted the compare/delta file with the space
percent-encoded (`complete%20pause ad layout.….png`) but recorded the golden with a
literal space (`complete pause ad layout.….png`), so `resolveGolden` — which built the
golden lookup from the delta's base name — never found a match.

### Prompts summary
1. Bug report: a screenshot with a space in the name is detected as having no golden;
   example delta `…/build/outputs/roborazzi/complete%20pause ad layout.PinotHawkinsFlexLayout_pause_ads_complete_compare.png`.

## Changes

### `src/scanner.js`
- `resolveGolden` now tries a small set of name candidates instead of only the verbatim
  base name: the name as-is, `%20`↔space toggled both directions, and a safely
  percent-decoded form (guarded against malformed `%`). The first candidate that resolves
  to a real file wins, so exact matches are unchanged and the space/`%20` mismatch now
  pairs correctly in either direction.

### `tests/node/scanner.test.js`
- Regression tests for both directions: a `%20` delta name resolving a literal-space
  golden, and a literal-space delta name resolving a `%20` golden.

## Files modified

| File | Change |
|------|--------|
| `src/scanner.js` | `resolveGolden` tries space/`%20` and decoded name variants |
| `tests/node/scanner.test.js` | Two regression tests for space-encoded golden matching |
