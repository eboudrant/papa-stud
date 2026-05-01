# fix: harden POST /api/projects against path-injection (CodeQL)

**Date:** 2026-05-01
**Type:** Fix

## Intent
CodeQL flagged `js/path-injection` on `fs.statSync(resolved)` in `POST /api/projects` — the path is derived from user input. The app legitimately needs to let the user point at any directory on their machine, so the user-supplied path can't be eliminated as a sink, but the input handling can still be tightened and the threat model documented.

### Prompts summary
1. sec issue: "This path depends on a user-provided value." src/handler.js L185

## Changes

### `src/handler.js`
- After `expandHome`, require the result to be absolute. A relative input like `../etc` was previously resolved against the server's cwd silently — it now returns `400 absolute path required: ...`.
- Apply `path.resolve()` to canonicalize (collapses `..`, `.`, `//`).
- CodeQL suppression comment with the explicit threat-model note: server binds to `127.0.0.1` in Electron and runs inside Docker with no auth; the user picking their own dirs is the feature.

### `tests/node/handler.test.js`
- Two new cases: rejects `../etc`, rejects `some/dir`.

## Files modified

| File | Change |
|------|--------|
| `src/handler.js` | Require absolute path post-expand; canonicalize; CodeQL suppression with rationale |
| `tests/node/handler.test.js` | Tests for relative-path rejection |
