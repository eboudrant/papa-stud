# fix: bind dev server to 127.0.0.1

**Date:** 2026-06-15
**Type:** Fix

## Intent
`src/server.js` (the `npm start` dev entry point) bound the HTTP server to
`0.0.0.0`, exposing it on every network interface. Papa Stud is a single-user
local tool with no auth and no rate limiting; the threat model in
`.claude/rules/dev_workflow.md` assumes "no remote attacker," which is what
justifies dismissing the web-app CodeQL rules on routes like `/api/images`
(serves any PNG under a project root) and `/api/config/reset` (wipes
projects/templates). Binding `0.0.0.0` quietly broke that assumption — anyone
on the same LAN could reach those routes. Electron already binds `127.0.0.1`;
this aligns the dev server with it.

### Prompts summary
1. Code review surfaced the bind mismatch (issue #126).
2. "send a PR for the first issue, do not auto merge yet"

## Changes

### `src/server.js`
- Listen on `127.0.0.1` instead of `0.0.0.0`; added a comment explaining the
  threat-model rationale.

## Files modified

| File | Change |
|------|--------|
| `src/server.js` | Bind to loopback (`127.0.0.1`) instead of all interfaces |
