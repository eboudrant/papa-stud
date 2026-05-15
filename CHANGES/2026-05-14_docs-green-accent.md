# docs: green accent + red/green "side-by-side"

**Date:** 2026-05-14
**Type:** Docs

## Intent
Swap the docs/ landing page accent from blue to green and split the hero "side-by-side." into a red half and a green half, echoing the FAIL→PASS comparison the product performs. Also fix the "Get started" primary button contrast in the new palette.

## Changes

### `docs/index.html`
- Repalette `--accent`, `--accent-hover`, `--accent-soft`, `--accent-glow` to green (`#22c55e`).
- Update hero glow blob rgba pair to match the green palette.
- Split hero h1 accent span into `.accent-red` ("side") + `.accent-green` ("side.") using `background-image:` (the `background:` shorthand resets `background-clip`, breaking the text clip — use the longhand).
- `.btn-primary`: dark green text (`#062e1a`) on bright green bg instead of white-on-green to meet WCAG AA contrast; bump weight to 600 and the inner highlight slightly.

## Files modified

| File | Change |
|------|--------|
| `docs/index.html` | Green accent palette, red/green hero split, button contrast fix |
