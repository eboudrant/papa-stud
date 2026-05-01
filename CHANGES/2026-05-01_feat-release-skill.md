# feat: release skill

**Date:** 2026-05-01
**Type:** Feature

## Intent
Encapsulate the release procedure as a `.claude/skills/release/SKILL.md` so future-you can run `/release` (or `/release minor`) instead of remembering the steps each time.

The procedure has real moving parts: look up the latest tag, semver-bump it (patch by default), verify clean working tree on `main`, confirm with the user, dispatch the `Release` workflow with the version input, and optionally watch.

### Prompts summary
1. Could we make a skill for release? There's this GitHub Action, manual input is the version number, using semantic versioning we need to increment it.

## Changes

### `.claude/skills/release/SKILL.md` (new)
- Resolves bump type from `$ARGUMENTS` (`patch` default).
- Reads latest version via `gh release list --limit 1` (current latest is `v0.0.10`); falls back to `git tag --sort=-v:refname`.
- Computes the new `MAJOR.MINOR.PATCH`.
- Pre-condition checks: clean working tree, on `main` and up to date, new tag doesn't already exist.
- Requires explicit user confirmation before dispatch.
- Dispatches via `gh workflow run "Release" --ref main -f version=<new>` (no `v` prefix — the workflow input is `0.0.11`, not `v0.0.11`).
- Notes: the workflow does the `npm version` bump and tag creation itself; don't commit a version bump or create the tag locally.

### `CLAUDE.md`
- Index entry for the new skill.

## Files modified

| File | Change |
|------|--------|
| `.claude/skills/release/SKILL.md` | New — release procedure as a skill |
| `CLAUDE.md` | Index entry pointing at the skill |
