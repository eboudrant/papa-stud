# Papa Stud

Self-hosted screenshot-failure reviewer for Paparazzi / Roborazzi / Compose Screenshot Testing.

## Rules

Durable repo rules for agents and humans. Read these first.

- @.claude/rules/architecture.md — stack, source layout, Electron specifics
- @.claude/rules/dev_workflow.md — branches, CHANGES files, PR + auto-merge policy, CodeQL dismissal flow, threat model
- @.claude/rules/testing.md — unit + screenshot tests, CI gates

## User docs

The `docs/` folder is the GitHub Pages site (https://eboudrant.github.io/papa-stud/) — published automatically on push to `main` via `.github/workflows/pages.yml`. Treat it as user-facing; keep agent-only context in `.claude/rules/`.

## Skills, agents, MCP

- `.claude/skills/` — multi-step procedures (only when worth encapsulating).
- `.claude/agents/` — custom subagents (none yet).
- `.mcp.json` — per-repo MCP servers (none yet).
