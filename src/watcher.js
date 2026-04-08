/**
 * Realtime file watcher for scan updates.
 * Uses chokidar for instant OS-native notifications.
 * Debounces per-module to avoid re-processing during a test run.
 */

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const DISCOVERY_INTERVAL = 5000; // ms
const DEBOUNCE_DELAY = 500; // ms

function createWatcher(modules, projectPath, onModuleChange, profiles) {
  return new ChokidarWatcher(modules, projectPath, onModuleChange, profiles);
}

class ChokidarWatcher {
  constructor(modules, projectPath, onModuleChange, profiles) {
    this._onChange = onModuleChange;
    this._timers = new Map();
    this._pathToModule = new Map();
    this._actualWatchDirs = new Set();
    this._root = projectPath;
    this._profiles = profiles;
    this._knownModules = new Set();
    this._discoveryTimer = null;
    this._chokidarWatcher = null;

    for (const mod of modules) {
      this._addModuleWatches(mod.name);
    }
  }

  _addModuleWatches(moduleName) {
    if (this._knownModules.has(moduleName)) return false;
    this._knownModules.add(moduleName);

    const parts = moduleName.replace(/^:/, '').split(':');
    const modulePath = parts[0] !== 'root' ? path.join(this._root, ...parts) : this._root;

    const wantDirs = new Set();
    wantDirs.add(path.join(modulePath, 'build', 'paparazzi'));
    wantDirs.add(path.join(modulePath, 'build', 'test-results'));
    if (this._profiles) {
      for (const p of this._profiles) {
        wantDirs.add(path.join(modulePath, p.failures_dir));
        if (p.golden_dir) wantDirs.add(path.join(modulePath, p.golden_dir));
      }
    } else {
      wantDirs.add(path.join(modulePath, 'src', 'test', 'snapshots', 'images'));
    }

    let added = false;
    for (const d of wantDirs) {
      let target = d;
      while (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        const parent = path.dirname(target);
        if (parent === this._root || parent === target) { target = null; break; }
        target = parent;
      }
      if (target) {
        this._pathToModule.set(d, { name: moduleName, path: modulePath });
        if (!this._actualWatchDirs.has(target)) {
          this._actualWatchDirs.add(target);
          added = true;
        }
      }
    }
    return added;
  }

  _onFileChange(filePath) {
    let moduleInfo = null;
    for (const [watchedDir, info] of this._pathToModule) {
      if (filePath.startsWith(watchedDir)) {
        moduleInfo = info;
        break;
      }
    }
    if (!moduleInfo) return;

    const { name: moduleName, path: modulePath } = moduleInfo;
    if (this._timers.has(moduleName)) {
      clearTimeout(this._timers.get(moduleName));
    }
    this._timers.set(moduleName, setTimeout(() => {
      this._timers.delete(moduleName);
      this._onChange(moduleName, modulePath);
    }, DEBOUNCE_DELAY));
  }

  _discoverNewModules() {
    // Lazy import to avoid circular dependency
    const { discoverPaparazziModules } = require('./scanner');
    try {
      for (const [, moduleName, modulePath] of discoverPaparazziModules(this._root, this._profiles)) {
        if (!this._knownModules.has(moduleName)) {
          if (this._addModuleWatches(moduleName)) {
            // Add new dirs to existing chokidar watcher
            for (const d of this._actualWatchDirs) {
              this._chokidarWatcher.add(d);
            }
          }
          this._onChange(moduleName, modulePath);
        }
      }
    } catch {
      // Discovery may fail if project structure changes during scan
    }
  }

  start() {
    const dirs = [...this._actualWatchDirs];
    if (dirs.length) {
      this._chokidarWatcher = chokidar.watch(dirs, {
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 200 },
      });
      this._chokidarWatcher.on('all', (_event, filePath) => {
        this._onFileChange(filePath);
      });
    }

    this._discoveryTimer = setInterval(() => this._discoverNewModules(), DISCOVERY_INTERVAL);
  }

  stop() {
    if (this._discoveryTimer) {
      clearInterval(this._discoveryTimer);
      this._discoveryTimer = null;
    }
    for (const timer of this._timers.values()) {
      clearTimeout(timer);
    }
    this._timers.clear();
    if (this._chokidarWatcher) {
      this._chokidarWatcher.close();
      this._chokidarWatcher = null;
    }
  }
}

module.exports = { createWatcher };
