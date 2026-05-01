# chore: release skill — verify CI green on main before dispatching

**Date:** 2026-05-01
**Type:** Chore

## Intent
The first time `/release` ran, the skill caught that we were on a feature branch and not in sync with `origin/main` (good), but didn't actively verify that `main`'s required CI checks were currently green. Releasing on a red `main` would ship a broken Homebrew cask. Add the green-CI check as a hard pre-condition.

### Prompts summary
1. Yes always release from main, after all the current gh actions are green (at least from main), something to add to the skill?

## Changes

### `.claude/skills/release/SKILL.md`
- Step 4 (Verify pre-conditions) now requires the latest required CI on `origin/main` to be entirely `success`. Uses `gh api repos/<o>/<r>/commits/main/check-runs`. Fails on `failure`, `cancelled`, `timed_out`, or still `in_progress`.
- Reinforced "always release from main, never from a feature branch" inline.
- Added a one-line rationale on why we don't auto-fix pre-condition failures (user may want to wait for an in-flight PR or revert a regression first).

## Files modified

| File | Change |
|------|--------|
| `.claude/skills/release/SKILL.md` | Add green-CI-on-main pre-condition; reinforce release-from-main |
