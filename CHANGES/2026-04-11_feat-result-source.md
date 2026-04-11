# feat: per-profile result_source mode (JUnit XML vs files)

**Date:** 2026-04-11
**Type:** Feature

## Intent
Prepare for iOS support where JUnit XML isn't available. Each profile/template can now specify how stale failures are detected.

### Prompts summary
1. Add result_source field to templates and profiles: "junit" (default) or "files"
2. Scanner conditionally uses JUnit XML based on profile mode
3. UI dropdown in template and profile editors

## Changes

### `src/templates.js`
- Add `result_source: 'junit'` to all 3 built-in templates
- Add `result_source` to createTemplate and templateToProfile

### `src/scanner.js`
- Only parse JUnit XML if any profile uses junit mode
- Pass null testStats/xmlMtime for files-mode profiles (mtime clustering only)

### `static/js/home.js`
- Add result source dropdown to template create/edit forms
- Add result source dropdown to profile editor
- Include result_source when creating profiles from templates or custom

## Files modified

| File | Change |
|------|--------|
| `src/templates.js` | result_source field on templates and profiles |
| `src/scanner.js` | Conditional JUnit parsing per profile |
| `static/js/home.js` | Result source UI in template and profile editors |
