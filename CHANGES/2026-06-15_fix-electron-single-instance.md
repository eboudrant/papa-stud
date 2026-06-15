# fix: enforce a single Electron instance

**Date:** 2026-06-15
**Type:** Fix

## Intent
Nothing stopped a user from launching a second Papa Stud.io desktop instance.
The embedded server binds `127.0.0.1:0` (a random port), so instances never
conflict on the socket — but every instance shares the same
`userData/data/` directory (`projects.json`, `scans/`, `index.json`) with no
cross-process lock. Two instances running scans / accept-baseline against the
same data would clobber each other last-writer-wins (atomic tmp+rename prevents
half-written files, not lost updates), and each runs its own polling watchers
and scan-job map. For a single-user local tool, the right answer is one
instance.

### Prompts summary
1. "what if you start 2 papa stud instance, dup socket?" — discussion of the
   shared-data race vs the random-port socket behavior.
2. "yeah, I like the requestSingleInstanceLock"

## Changes

### `electron/main.js`
- Acquire `app.requestSingleInstanceLock()` early. The losing instance calls
  `app.quit()` and the `whenReady` boot is gated on the lock so it never starts
  a second server/window.
- On `second-instance`, restore + focus the existing window so a re-launch
  surfaces the running app instead of silently doing nothing.

## Files modified

| File | Change |
|------|--------|
| `electron/main.js` | Single-instance lock; focus existing window on re-launch |
