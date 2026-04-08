# feat: profile templates, Roborazzi support, dark mode

**Date:** 2026-04-07
**Type:** Feature

## Intent

Add reusable profile templates for common screenshot testing tools (Paparazzi, Roborazzi). Support Roborazzi's naming conventions (_compare/_actual suffixes). Add dark/light theme toggle. Rename to "Papa Stud.io".

### Prompts summary

1. Predefined profile templates for Paparazzi and Roborazzi
2. Template management UI (create, edit, delete custom templates)
3. Template selector when adding projects
4. Roborazzi support: _compare suffix for deltas, _actual for actuals, ** glob for nested goldens
5. Roborazzi module discovery (build/outputs/roborazzi)
6. Remove golden stale check (wrong for Roborazzi where goldens are updated in same run)
7. Dark/light theme toggle with Cmd+Shift+L shortcut
8. Rename header to "Papa Stud.io"

## Changes

### `server/templates.py` (NEW)
- Built-in templates: Paparazzi, Roborazzi
- Custom template CRUD with data/templates.json persistence
- `template_to_profile()` converts template to project profile

### `server/scanner.py` (MODIFIED)
- `_process_profile` accepts delta_prefix/delta_suffix/actual_suffix per profile
- `_delta_to_base()` converts delta filename to base name (supports both prefix and suffix)
- `_detect_current_failures` parameterized for delta naming conventions
- `_resolve_golden` supports ** glob patterns for recursive directory search
- Golden cache: resolve once per failure, reuse for stale check
- Roborazzi module discovery in `_discover_paparazzi_modules`
- Removed golden mtime stale check (incorrect for Roborazzi)

### `server/projects.py` (MODIFIED)
- `DEFAULT_PROFILES` derived from templates
- `add_project()` accepts template_ids

### `server/handler.py` (MODIFIED)
- Template API endpoints (GET list, POST create, DELETE)
- Template IDs passed when creating projects

### `static/index.html` (MODIFIED)
- "Papa Stud.io" header (.io in light gray)
- Theme toggle button + Cmd+Shift+L shortcut
- Theme persisted in localStorage

### `static/css/app.css` (MODIFIED)
- Dark theme CSS variables
- All hardcoded colors converted to rgba() for theme compatibility
- Template selector, template list, profile editor styles
- Inputs/buttons/pills use theme-aware colors

### `static/js/home.js` (MODIFIED)
- Template selector when adding projects (checkboxes)
- Templates section on home page (list, create, edit, delete)
- Profile management UI: card-based with inline editor, add from template

## Files modified

| File | Change |
|------|--------|
| `server/templates.py` | Profile template system |
| `server/scanner.py` | Roborazzi support, configurable naming, golden cache |
| `server/projects.py` | Template-based project creation |
| `server/handler.py` | Template API endpoints |
| `static/index.html` | Rebranding, theme toggle |
| `static/css/app.css` | Dark mode, template/profile styles |
| `static/js/home.js` | Template UI, profile management |
| `static/js/review.js` | Profile pills show all configured profiles |
| `tests/test_scanner.py` | Roborazzi, template, glob tests |
