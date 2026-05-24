# Testing

## Unit tests

```
npm test
```

Tests live in `tests/node/*.test.js`, run with Node's built-in test runner (`node:test`). Pattern: spin up tmpdirs in `beforeEach`, clean up in `afterEach`. HTTP-level handler tests boot `createApp()` on a random port (`createApp().listen(0, '127.0.0.1', ...)`).

## Screenshot tests

Playwright in Docker for consistent rendering. Desktop only (1280x800), zero-tolerance pixel diff.

```
docker build -f Dockerfile.test -t papastudio-test .
docker run --rm -e CI=true papastudio-test npx playwright test
docker run --rm -v ./tests/screenshots:/app/tests/screenshots papastudio-test npx playwright test --update-snapshots
```

- Baselines: `tests/screenshots/*.png` (flat, no subdirectories).
- Specs: `tests/screenshots/*.spec.js`.
- Config: `playwright.config.js` — auto-starts `node src/server.js` on port 8770.

## CI

`.github/workflows/ci.yml` runs on push to main and PRs:

- **Node.js (20/22/24)** — syntax validation + unit tests.
- **Screenshot Tests** — Docker-based Playwright; uploads artifacts and posts a PR comment on failure.
- **Analyze (actions)** / **Analyze (javascript-typescript)** — CodeQL.

All six are required to merge per the repo ruleset.
