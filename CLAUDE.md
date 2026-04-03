# Papa Stud

## Project Overview

Self-hosted tool for processing and viewing Paparazzi screenshot test images.

- **Backend:** Python 3.13, stdlib `http.server` (no framework), threaded
- **Frontend:** Vanilla HTML/CSS/JS, light theme, system fonts — no build step
- **Docker:** `python:3.13-slim`, non-root `papastud` user, port **8770**
- **Data volume:** `/app/data` (persistent via `papastud-data` Docker volume)

### Running locally

```bash
docker compose up --build -d
# App at http://localhost:8770
```

## Git Workflow

Create a feature branch for every new piece of work. When ready to merge, create a changelog entry in `CHANGES/` before merging to main.

### Branch naming

`feat/short-description`, `fix/short-description`, `chore/short-description`

### CHANGES file

Before merging, create `CHANGES/YYYY-MM-DD_slug.md` with this structure:

```
# type: short description

**Date:** YYYY-MM-DD
**Type:** Feature | Fix | Chore | CI

## Intent
Why this change exists.

### Prompts summary
1. Numbered list of key prompts that drove the work

## Changes

### `path/to/file.py`
- What changed and why

## Files modified

| File | Change |
|------|--------|
| `path/to/file` | Brief description |
```

Slug format: `type-short-kebab-description` (e.g., `feat-image-upload`, `fix-routing-bug`).
