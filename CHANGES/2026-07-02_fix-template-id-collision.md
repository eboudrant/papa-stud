# fix: reject custom template ids that collide with built-ins

**Date:** 2026-07-02
**Type:** Fix

## Intent

Closes #133. `createTemplate` derives the id from the template name (`name.toLowerCase().replace(/ /g, '-')`), so a custom template named "Paparazzi" got the id `paparazzi` — the same id as a built-in. `getTemplate` resolves built-ins first, the list shows duplicate entries, and DELETE refuses because of the built-in check, leaving an undeletable ghost template. `importTemplates` already skips built-in ids; `createTemplate` now rejects them too.

### Prompts summary

1. Implement GitHub issue #133: reject (not suffix) custom template ids that collide with built-in template ids; surface the error in the API and UI; add unit tests.

## Changes

### `src/templates.js`
- `createTemplate` now throws `template id "<id>" conflicts with a built-in template` when the computed id matches a `BUILTIN_TEMPLATES` id, instead of silently writing a shadowed, undeletable custom template.

### `src/handler.js`
- `POST /api/templates` wraps `templates.createTemplate(body)` in try/catch and returns `400 { error }` on rejection instead of crashing the request with a 500.

### `static/js/home.js`
- `_createTemplate` and `_updateTemplate` wrap their `apiPost` calls in try/catch and surface failures via `showToast(..., 'error')` instead of an unhandled promise rejection that silently left the form open. Logic-only; no markup or CSS changes.

### `tests/node/templates.test.js`
- New unit tests: built-in id collision throws (by name and by explicit id), non-colliding create + getTemplate round-trip, deleteTemplate on a custom id, and create-twice-with-same-id replaces rather than duplicates.

## Files modified

| File | Change |
|------|--------|
| `src/templates.js` | Reject built-in id collisions in `createTemplate` |
| `src/handler.js` | Return 400 with the error message from `POST /api/templates` |
| `static/js/home.js` | Toast API errors in `_createTemplate` / `_updateTemplate` |
| `tests/node/templates.test.js` | New unit tests for template CRUD and collision rejection |
