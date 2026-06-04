# Papa Stud.io

Screenshot failure reviewer for Android testing tools (Paparazzi, Roborazzi, Compose Screenshot Testing).

Scans your Gradle project for screenshot test failures, shows delta/golden/actual images side-by-side with diff percentages, and lets you review them in a clean UI.

https://github.com/user-attachments/assets/c8d35b14-fd80-4e6e-989f-63c041bea9a7

<p>
  <img src="docs/assets/screenshots/home-dark.png" width="32%">
  <img src="docs/assets/screenshots/review-grid-dark.png" width="32%">
  <img src="docs/assets/screenshots/detail-dark.png" width="32%">
</p>

## Install

```
brew tap eboudrant/tap
brew install --cask papastudio
```

## Update

```
brew update && brew upgrade --cask papastudio
```

## Run from source

```bash
git clone https://github.com/eboudrant/papa-stud.git
cd papa-stud
npm install
npm start        # http://localhost:8770
npm run electron # desktop app
```

## Features

- Supports **Paparazzi**, **Roborazzi**, and **Compose Screenshot Testing** out of the box
- Custom profile templates for any screenshot testing tool
- Delta / Toggle / Slider comparison modes with zoom and pan
- **Accept baseline** — copy the rendered image over the golden with one click (or bulk accept a whole scan)
- **Scan from URL** — pull a CI run's results from a tarball link and review them against your local goldens
- Multi-module Gradle project scanning
- Video export of failures (requires ffmpeg)
- Config import / export
- Dark / light / system theme
- Desktop app (Electron) or run from source

## Scan from URL

Your screenshot tests run on CI (e.g. Jenkins), and CI publishes the build outputs as a downloadable tarball. Instead of re-running the tests locally, point Papa Stud.io at that tarball to review the failures against your local goldens:

1. Add your project locally (the working copy that holds the committed goldens).
2. On the project card, click the **Scan from URL** (cloud-download) button next to **Scan**.
3. Paste the tarball URL (e.g. a Jenkins `…/?tarball=1` link) and hit **Download & Scan**.

Papa Stud.io downloads the tarball and overlays only its `build/` outputs (failure deltas + JUnit) onto your project directory — it never touches your `src/` or goldens — then runs a normal scan. If the tarball's module layout doesn't match the project, it asks for confirmation before writing anything.

## Testing

```bash
# Unit tests
npm test

# Screenshot tests (Docker)
docker build -f Dockerfile.test -t papastudio-test .
docker run --rm -e CI=true papastudio-test npx playwright test

# Update baselines
docker run --rm -v ./tests/screenshots:/app/tests/screenshots papastudio-test npx playwright test --update-snapshots
```

## Project structure

```
electron/          Electron shell (main process, preload, menu)
src/               Express server (routes, scanner, templates, watcher)
static/            Frontend (HTML, CSS, JS — no build step)
data/              Runtime data (projects, templates, scans)
tests/             Unit tests + Playwright screenshot tests
```

## License

MIT

## Credits

Demo soundtrack: [Homage to Daylight](https://projindigo.bandcamp.com/track/homage-to-daylight) by Proj Indigo.
