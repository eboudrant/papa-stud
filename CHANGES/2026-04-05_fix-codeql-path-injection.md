# fix: CodeQL path injection warnings

**Date:** 2026-04-05
**Type:** Fix

## Intent

Fix 13 CodeQL "Uncontrolled data used in path expression" alerts. All paths derived from user input (URL params, scan IDs) are now sanitized and validated before filesystem access.

### Prompts summary

1. Fix all CodeQL path injection alerts in handler.py and projects.py

## Changes

### `server/handler.py`
- Static file path resolved before `is_relative_to` check (line 18)
- `/api/images` path resolved before `is_file()`, security check moved before existence check
- Prevents path traversal via `..` in static paths and image paths

### `server/projects.py`
- Added `_safe_id()` validator — scan IDs restricted to `[\w-]+` (alphanumeric, dash, underscore)
- `_read_json()` resolves path and verifies it's under DATA_DIR before reading
- `_write_json()` resolves path and verifies it's under DATA_DIR before writing
- `is_path_under_project()` uses resolved paths throughout

## Files modified

| File | Change |
|------|--------|
| `server/handler.py` | Resolve paths before checks, reorder security checks |
| `server/projects.py` | `_safe_id()`, path resolution in `_read_json`/`_write_json` |
