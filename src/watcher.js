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

function createWatcher(modules, projectPath, onModuleChange, profiles, strategy) {
  return new ChokidarWatcher(modules, projectPath, onModuleChange, profiles, strategy);
}

class ChokidarWatcher {
  constructor(modules, projectPath, onModuleChange, profiles, strategy) {
    this._onChange = onModuleChange;
    this._timers = new Map();
    this._pathToModule = new Map();
    this._actualWatchDirs = new Set();
    this._root = projectPath;
    this._profiles = profiles;
    this._strategy = strategy;
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

    const modulePath = this._strategy.resolveModulePath(moduleName, this._root);
    const wantDirs = this._strategy.getWatchDirs(modulePath, this._profiles);

    let added = false;
    for (const d of wantDirs) {
      let target = d;
      while (true) {
        try { if (fs.statSync(target).isDirectory()) break; } catch {}
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
    try {
      for (const [, moduleName, modulePath] of this._strategy.discoverModules(this._root)) {
        if (!this._knownModules.has(moduleName)) {
          if (this._addModuleWatches(moduleName)) {
            for (const d of this._actualWatchDirs) {
              this._chokidarWatcher.add(d);
            }
          }
          this._onChange(moduleName, modulePath);
        }
      }
    } catch {}
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
