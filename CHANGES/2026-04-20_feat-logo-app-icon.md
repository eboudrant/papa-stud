# feat: app icon, favicon, custom About panel

**Date:** 2026-04-20
**Type:** Feature

## Intent

Papa Stud had no proper app icon, no favicon, and the macOS About panel showed Electron's default atom logo. Ship a stick-figure-with-a-camera-on-tripod icon and wire it through every visible surface: the Electron dock, macOS packaging (.icns), browser tab favicon for the web UI, the GitHub Pages landing page, and a custom About dialog that works in dev mode.

### Prompts summary

1. Propose a logo — stick figure with a camera on tripod
2. Side-view / profile, figure taking the picture; make it stylish for an app icon / web logo
3. Use for Electron icon, GitHub page favicon — wire it up
4. Icon larger than OSX standard; corners not rounding (background actually white)
5. Add slight border for relief/shadow
6. About window shows Electron's default icon; version is set at release time, not hardcoded

## Changes

### `static/icon.svg` (new)
Source SVG at 180×180 viewBox. Stick figure in profile leaning into the viewfinder of a tripod-mounted camera, lens pointing left, red accent on the lens. Wrapped in `translate(18,18) scale(0.8)` so the squircle sits in the central 80% of the canvas (matches Apple's 824/1024 icon template). Cream gradient background (`#fffaec → #eee6cc`), subtle dark outer stroke (15% opacity) + white inner stroke (80% opacity) for a raised-surface bevel.

### `static/icon.png` (new, 1024×1024) + `static/icon.icns` (new)
Rendered via `@resvg/resvg-js-cli` (not `qlmanage`, which silently flattens onto white). `.icns` built with `iconutil` from a 10-size iconset. `forge.config.js` already references `./static/icon` so the packager picks these up automatically for Mac/Windows/Linux.

### `docs/favicon.svg` (new)
Same SVG, referenced from the GitHub Pages site.

### `electron/main.js`
- `BrowserWindow.icon` points at `static/icon.png` (Windows/Linux window icon)
- `app.dock.setIcon()` called on macOS — the only way to override Electron's default dock icon in dev mode (packaged builds use forge's icon automatically)
- Replaced `{ role: 'about' }` with a custom `showAbout` using `dialog.showMessageBox` + `nativeImage.createFromPath(...).resize({ 96, 96 })`. The native macOS About panel's `iconPath` option is Linux/Windows only — in dev it always shows Electron's atom. The custom dialog works in dev AND packaged.
- Version line only shown when `app.isPackaged` — CI sets `package.json`'s version at release time; dev mode (`1.0.0`) is meaningless.

### `static/index.html`
`<link rel="icon" href="/static/icon.svg" type="image/svg+xml">` for browser-tab favicon.

### `docs/index.html`
Favicon link + 22px logo beside the "Papa Stud.io" wordmark in the landing-page header.

## Files modified

| File | Change |
|------|--------|
| `static/icon.svg` | New logo |
| `static/icon.png` | 1024×1024 render via resvg |
| `static/icon.icns` | macOS iconset built from icon.png |
| `docs/favicon.svg` | Same as icon.svg |
| `electron/main.js` | Dock icon + custom About dialog |
| `static/index.html` | Favicon link |
| `docs/index.html` | Favicon link + header logo |
