/**
 * Realtime watcher for scan updates.
 *
 * Polls directory mtimes every POLL_INTERVAL ms. Chokidar/fs.watch are avoided
 * because each watched directory consumes a file descriptor, and Gradle monorepos
 * (hundreds of modules × several watch dirs per module) blow past the default
 * macOS FD limit with EMFILE. A dir's mtime bumps when a file inside it is
 * created, deleted, or renamed — but not when a file is modified in place, and
 * it doesn't propagate up from grandchildren. JUnit XML lives one level deeper
 * (build/test-results/testDebugUnitTest/TEST-*.xml), so we also stat each
 * watched dir's first-level subdirs to catch those updates.
 */

const fs = require('fs');
const path = require('path');

const POLL_INTERVAL = 5000;
const DISCOVERY_EVERY_N_TICKS = 6; // ~30s at POLL_INTERVAL=5000

function createWatcher(modules, projectPath, onModuleChange, profiles, strategy) {
  return new PollingWatcher(modules, projectPath, onModuleChange, profiles, strategy);
}

class PollingWatcher {
  constructor(modules, projectPath, onModuleChange, profiles, strategy) {
    this._onChange = onModuleChange;
    this._root = projectPath;
    this._profiles = profiles;
    this._strategy = strategy;
    this._modules = new Map();
    this._tickCount = 0;
    this._timer = null;

    for (const mod of modules) {
      this._addModule(mod.name);
    }
  }

  _addModule(name) {
    if (this._modules.has(name)) return false;
    const modulePath = this._strategy.resolveModulePath(name, this._root);
    const dirs = [...this._strategy.getWatchDirs(modulePath, this._profiles)];
    const lastMtime = _maxMtime(dirs);
    this._modules.set(name, { path: modulePath, dirs, lastMtime });
    return true;
  }

  _tick() {
    for (const [name, info] of this._modules) {
      const mtime = _maxMtime(info.dirs);
      if (mtime !== info.lastMtime) {
        info.lastMtime = mtime;
        this._onChange(name, info.path);
      }
    }
    if (++this._tickCount >= DISCOVERY_EVERY_N_TICKS) {
      this._tickCount = 0;
      this._discoverNewModules();
    }
  }

  _discoverNewModules() {
    try {
      for (const [, name, modPath] of this._strategy.discoverModules(this._root)) {
        if (!this._modules.has(name)) {
          this._addModule(name);
          this._onChange(name, modPath);
        }
      }
    } catch {}
  }

  start() {
    this._timer = setInterval(() => this._tick(), POLL_INTERVAL);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._modules.clear();
  }
}

// Max mtime across the given dirs and each of their first-level subdirs.
// Catches both "new file in dir" (dir mtime bumps) and "file replaced in
// subdir" like JUnit XML under testDebugUnitTest/ (subdir mtime bumps).
function _maxMtime(dirs) {
  let max = 0;
  for (const d of dirs) {
    let entries;
    try {
      const st = fs.statSync(d);
      if (st.mtimeMs > max) max = st.mtimeMs;
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const sub = fs.statSync(path.join(d, e.name));
        if (sub.mtimeMs > max) max = sub.mtimeMs;
      } catch {}
    }
  }
  return max;
}

module.exports = { createWatcher };
