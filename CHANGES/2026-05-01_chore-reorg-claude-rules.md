# chore: split CLAUDE.md into .claude/rules/

**Date:** 2026-05-01
**Type:** Chore

## Intent
`CLAUDE.md` had grown to ~125 lines mixing architecture, testing, CI, and git workflow in one file. Split into three focused rule files under `.claude/rules/` and reduce `CLAUDE.md` to a thin index that `@`-imports them. The `@`-import is a native Claude Code feature, so no custom loader is needed.

The split also gives us a place to record durable rules learned in working sessions (PR/CodeQL flow, threat model, Electron restart procedure) without bloating the top-level file.

### Prompts summary
1. Re-org memory/context: keep CLAUDE.md, put required rules in `.claude/rules/`, skills in `.claude/skills/`, MCP at root.
2. Let's try that.
3. Send the PR.

## Changes

### `CLAUDE.md`
- Reduced from 126 lines to 12.
- Now a thin index that `@`-imports the three rule files.
- Notes the `docs/` → GitHub Pages relationship and reserves `.claude/skills/`, `.claude/agents/`, `.mcp.json` for future use.

### `.claude/rules/architecture.md` (new)
- Stack, run commands, source layout, Electron specifics.

### `.claude/rules/dev_workflow.md` (new)
- Branch / commit conventions and the rule against committing to merged branches.
- CHANGES file template.
- PR flow: `git push` → `gh pr create` with summary + test plan → **stop**, do not auto-merge unless the user explicitly asks.
- Reading PR status (`mergeStateStatus` vs check conclusions, ruleset API, `Monitor` polling pattern with full failure alternation).
- CodeQL dismissal flow: in-source `// codeql[...]` comments are not honored by GitHub-managed scanning; use the dismissal API with the 280-char comment cap.
- Threat-model paragraph for justifying dismissals.
- Electron restart command.

### `.claude/rules/testing.md` (new)
- Unit-test conventions (`node:test`, tmpdir per test, HTTP tests via `createApp().listen(0, ...)`).
- Screenshot-test commands and baseline locations.
- CI gates list.

## Files modified

| File | Change |
|------|--------|
| `CLAUDE.md` | Slim down to a 12-line index that `@`-imports the rules |
| `.claude/rules/architecture.md` | New — stack + source layout + Electron specifics |
| `.claude/rules/dev_workflow.md` | New — branches, CHANGES, PR flow, CodeQL dismissal, threat model |
| `.claude/rules/testing.md` | New — unit + screenshot tests, CI gates |
