# Papa Stud.io

Screenshot failure reviewer for Android testing tools (Paparazzi, Roborazzi).

Scans your Gradle project for screenshot test failures, shows delta/golden/actual images side-by-side with diff percentages, and lets you review them in a clean UI.

## Install

```
brew tap eboudrant/tap
brew install --cask papastud
```

Then open **PapaStud** from Applications or Spotlight.

## Run without installing

```
git clone https://github.com/eboudrant/papa-stud.git
cd papa-stud
npm install
npm start
```

Open http://localhost:8770

## Features

- Supports **Paparazzi** and **Roborazzi** out of the box
- Custom profile templates for other screenshot tools
- Delta / Toggle / Slider comparison modes with zoom and pan
- Real-time file watching (re-scans on test re-run)
- Dark / light theme
- Video export of failures
- Desktop app (Electron) or headless server mode
