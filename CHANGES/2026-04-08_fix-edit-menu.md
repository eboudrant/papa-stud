# fix: add Edit menu for copy/paste in Electron app

**Date:** 2026-04-08
**Type:** Fix

## Intent

Copy/paste (Cmd+C/V) didn't work in the Electron app. macOS requires Edit menu roles to be registered for keyboard shortcuts to function.

### Prompts summary

1. Cmd+C/V/X/Z not working in the desktop app

## Changes

### `electron/main.js` (MODIFIED)
- Added Edit menu with undo, redo, cut, copy, paste, selectAll roles
- Registers Cmd+C/V/X/Z/A shortcuts via macOS menu system

## Files modified

| File | Change |
|------|--------|
| `electron/main.js` | Add Edit menu with standard clipboard roles |
