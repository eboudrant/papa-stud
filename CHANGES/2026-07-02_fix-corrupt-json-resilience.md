# fix: survive corrupt JSON data files instead of 500ing every route

**Date:** 2026-07-02
**Type:** Fix

## Intent

Closes #134. `readJson` in `src/jsonStore.js` threw on unparseable JSON, and
`readIndex` / `listProjects` propagated the exception — every route returned
500 and the app was bricked until the user hand-edited the data directory.
Writes are atomic (tmp + rename), so corrupt files mainly come from crash /
power-loss partial writes; the store should quarantine the bad file and
recover, not die.

### Prompts summary

1. Implement GitHub issue #134: make `readJson` resilient to corrupt JSON —
   move the bad file aside, log, return `null` (callers already handle null),
   with unit tests.

## Changes

### `src/jsonStore.js`

- `readJson` wraps read + parse in try/catch. On parse failure it moves the
  bad file aside via `fs.renameSync(p, p + '.corrupt-' + Date.now())` (rename
  itself guarded — if it fails, only a log line), emits a one-line
  `console.error` naming the file and where it was moved, and returns `null`.
  Callers already handle null (`readJson(...) || []`; `readIndex` falls back
  to `rebuildIndex()`).

### `tests/node/jsonStore.test.js`

- New test file (tmpdir pattern): missing file returns null; write/read
  round-trip; corrupt file returns null, original path removed, sibling
  `*.corrupt-*` file preserves the bad content; writeJson to the same path
  recovers after corruption.

## Files modified

| File | Change |
|------|--------|
| `src/jsonStore.js` | Quarantine unparseable JSON files and return null instead of throwing |
| `tests/node/jsonStore.test.js` | New unit tests for readJson/writeJson incl. corruption recovery |
