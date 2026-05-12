# fix: update banner silent because GitHub REST is rate-limited

**Date:** 2026-05-12
**Type:** Fix

## Intent

The "new version available" banner never appeared even when a newer release was published. Cause: the update check hit `api.github.com/repos/.../releases/latest`, which is rate-limited to **60 unauthenticated requests/hour per IP**. On a shared corp egress that ceiling is trivial to exhaust — once it is, every user behind that IP gets a silent `403`, the check falls into its catch branch, and the result is cached as `{available: false}` for 5 min on each app launch. The user sees no banner forever.

Switched to the GitHub releases atom feed at `github.com/<repo>/releases.atom`. Same data, no rate limit, no auth, served from `github.com` (not `api.github.com`). The newest release is the first `<entry>`, its tag is the `<title>`, and the release URL is the `<link href>` — one regex per field.

### Prompts summary

1. "Why don't I see the auto update?"
2. "Or the update banner suggesting to use brew"
3. Diagnosis: `curl … api.github.com/…/releases/latest` returned `403 API rate limit exceeded for <ip>`. Atom feed and `raw.githubusercontent.com` both returned 200 unauthenticated.

## Changes

### `src/updateCheck.js`
- `_fetchLatestRelease` now requests `https://github.com/<repo>/releases.atom` with `Accept: application/atom+xml`.
- New `_parseAtomLatest(xml)` returns `{ tag_name, html_url }` matching the shape the rest of the module expects from the old REST response — so caching, `_isNewer`, and the public `checkForUpdate` shape are all unchanged.
- Exported `_parseAtomLatest` for unit-testing.

### `tests/node/updateCheck.test.js` (new)
- Covers the happy path (multi-entry feed → newest wins), missing entries, missing titles, and entries without an explicit link.

## Notes

This only helps users who **upgrade** to a build that includes this fix — anyone still on v0.0.14 or earlier keeps the broken check. Suggest `brew upgrade --cask papastud` once v0.0.15 lands.

## Files modified

| File | Change |
|------|--------|
| `src/updateCheck.js` | atom-feed fetch + parser |
| `tests/node/updateCheck.test.js` | new — parser tests |
