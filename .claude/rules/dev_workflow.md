# Development workflow

## Branch and commit

- One feature branch per change. Never commit directly to `main`.
- Branch naming: `feat/short-description`, `fix/short-description`, `chore/short-description`, `docs/short-description`, `ci/short-description`.
- Always ask the user before running `git commit`.
- Never commit to a branch that has already been merged — verify before committing.
- **Always branch from a fresh `origin/main`, never from a still-checked-out merged branch.** GitHub squash-merge produces a *new* commit hash on `main`; the local pre-squash commit on the old branch is content-equivalent but a different SHA. Branching off the merged branch carries that orphan commit forward, and the next PR shows the previous PR's diff stacked on top. Always: `git checkout main && git pull --ff-only && git checkout -b <new>` (or rebase onto fresh `origin/main` if you forgot — the orphan will drop out).

## CHANGES entry

Before merging, add `CHANGES/YYYY-MM-DD_slug.md`. Slug format: `type-short-kebab-description` (e.g. `feat-image-upload`, `fix-routing-bug`).

```
# type: short description

**Date:** YYYY-MM-DD
**Type:** Feature | Fix | Chore | CI

## Intent
Why this change exists.

### Prompts summary
1. Numbered list of key prompts that drove the work

## Changes

### `path/to/file.js`
- What changed and why

## Files modified

| File | Change |
|------|--------|
| `path/to/file` | Brief description |
```

## PR flow

1. `git push -u origin <branch>`
2. `gh pr create --title "..." --body "$(cat <<'EOF' ... EOF)"` with **Summary** + **Test plan** sections.
3. Stop and report the PR URL. **Do not auto-merge.** The user reviews and merges themselves.
4. Only enable auto-merge if the user explicitly asks for that specific PR ("auto-merge it", "send it through").

## Reading PR status

- `gh pr view <n> --json state,mergeStateStatus,statusCheckRollup`.
- `mergeStateStatus: BLOCKED` with all checks green usually means a required check is still `IN_PROGRESS`. Don't call it failed unless a required check is `FAILURE | CANCELLED | TIMED_OUT`.
- Required checks live in **rulesets**, not classic branch protection. Use `gh api repos/<o>/<r>/rules/branches/main` then `gh api repos/<o>/<r>/rulesets/<id>`. Branch protection API may return 404.
- Watching a PR to completion: use `Monitor` to poll `gh pr view <n>` every 30s; exit on `MERGED | CLOSED | FAILURE | CANCELLED | TIMED_OUT | DIRTY | CONFLICTING`. Always include the failure alternation — silence on a crashed check looks identical to "still running".

## CodeQL alerts

- The required `Analyze (...)` check passes when the workflow runs successfully. Existing open alerts do **not** fail the check unless the repo also enables a code-scanning-must-be-resolved rule.
- **In-source `// codeql[<query-id>]:` comments do not suppress GitHub-managed alerts.** Use the dismissal API:
  ```
  gh api -X PATCH repos/<o>/<r>/code-scanning/alerts/<n> \
    -f state=dismissed \
    -f dismissed_reason="won't fix" \
    -f dismissed_comment="<= 280 chars"
  ```
  `dismissed_reason` ∈ `false positive | won't fix | used in tests`. Comment cap: 280 chars.

## Threat model (for dismissals)

Single-user local tool. Server binds `127.0.0.1` in Electron; there is no remote attacker. "Web app" CodeQL rules (path-injection, missing rate-limiting, etc.) typically don't apply — dismiss with reference to this section.

## Electron after code changes

After modifying any code that runs in Electron (`electron/`, `src/`, `static/`), restart the Electron app so the user can re-test in the UI:

```
pkill -f 'electron.*papa-stud' 2>/dev/null; sleep 0.8
npm run electron > /tmp/papastud-electron.log 2>&1 &
```
