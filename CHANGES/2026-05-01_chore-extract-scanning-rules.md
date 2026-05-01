# chore: extract scanning + Electron-prefs rules from CHANGES archive

**Date:** 2026-05-01
**Type:** Chore

## Intent
Mine the `CHANGES/` archive for durable, non-obvious rules and lift them into `.claude/rules/`. Each rule was verified against current code (file:line) before writing — these reflect today, not history.

### Prompts summary
1. If you look at all the changes files, any rules or skills or anything we could extract to this new structure?
2. Yes — send the PR.

## Changes

### `.claude/rules/scanning.md` (new)
Four rules covering `src/scanner.js` + `src/watcher.js`:
- **Polling, not chokidar.** `POLL_INTERVAL=5000`, `DISCOVERY_EVERY_N_TICKS=6`. Verified at `src/watcher.js:17-18`. Reason: `EMFILE` on Gradle monorepos with 700+ modules.
- **Trust JUnit-zero, never golden mtime.** When JUnit reports zero failures, drop all deltas; without JUnit, mtime-cluster the deltas. Verified at `src/scanner.js:153-161`. Reason: Roborazzi / `recordPaparazzi` write goldens in the same Gradle run as deltas, so golden-mtime filtering produces false negatives.
- **Rescans preserve user decisions.** `priorStatus` Map keeps `accepted` / `rejected` across rescans, matched by filename. Verified at `src/projects.js:276-285`.
- **Result-source per profile.** `result_source: 'junit' | 'files'` — pick correctly when adding a new tool.

### `.claude/rules/architecture.md`
Added one-line Electron specifics bullet: user preferences persist via IPC to JSON files in `userData/`, not `localStorage`. Verified at `electron/main.js:181-201` (`themeFilePath()`, `readTheme()`, `writeTheme()`, `get-theme` / `set-theme` IPC handlers). Reason: `localStorage` is keyed by origin including port; random Electron port means a fresh origin every launch.

### `CLAUDE.md`
Added the fourth `@`-import for `scanning.md`.

### `.claude/rules/dev_workflow.md`
Added a session-learned rule: always branch from a fresh `origin/main`, never from a still-checked-out merged branch. GitHub squash-merge produces a new commit hash on `main`; the local pre-squash commit is content-equivalent but a different SHA. Branching off the merged branch carries that orphan forward, and the next PR shows the previous PR's diff stacked on top. The first version of this PR fell into exactly that trap — fixed by rebasing onto fresh `origin/main`.

## Skipped on purpose

- **Toast replacement pattern** — obvious from one read of `static/js/api.js`.
- **Skill candidates** (refresh-baselines, add-template, add-profile) — we haven't walked any of those procedures together this session, so writing them would be guessing. Defer until we actually do one.

## Files modified

| File | Change |
|------|--------|
| `.claude/rules/scanning.md` | New — watcher polling, stale-delta, rescan-preserves-status, result_source |
| `.claude/rules/architecture.md` | One bullet added: prefs via IPC, not localStorage |
| `CLAUDE.md` | Fourth `@`-import |
