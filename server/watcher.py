"""Realtime file watcher for Paparazzi scan updates.

Uses watchdog if available for instant OS-native notifications.
Falls back to polling (2s interval) if watchdog is not installed.
Debounces per-module to avoid re-processing during a test run.
"""

import os
import threading
from pathlib import Path

try:
    from watchdog.events import FileSystemEventHandler
    from watchdog.observers import Observer

    HAS_WATCHDOG = True
except ImportError:
    HAS_WATCHDOG = False


def create_watcher(modules, project_path, on_module_change, profiles=None):
    """Create the best available watcher. Returns a ScanWatcher."""
    if HAS_WATCHDOG:
        return _WatchdogWatcher(modules, project_path, on_module_change, profiles)
    return _PollingWatcher(modules, project_path, on_module_change, profiles)


class _BaseWatcher:
    """Shared logic: module path mapping and debounce."""

    DISCOVERY_INTERVAL = 5.0  # seconds between new module checks

    def __init__(self, modules, project_path, on_module_change, profiles=None):
        self._on_change = on_module_change
        self._timers = {}
        self._lock = threading.Lock()
        self._path_to_module = {}
        self._actual_watch_dirs = set()
        self._root = Path(project_path)
        self._profiles = profiles
        self._known_modules = set()
        self._stop_discovery = threading.Event()

        for mod in modules:
            self._add_module_watches(mod["name"])

    def _add_module_watches(self, module_name):
        """Add watch dirs for a module. Returns True if new dirs were added."""
        if module_name in self._known_modules:
            return False
        self._known_modules.add(module_name)

        parts = module_name.strip(":").split(":")
        module_path = (
            self._root / Path(*parts) if parts and parts != ["root"] else self._root
        )

        want_dirs = set()
        want_dirs.add(module_path / "build" / "paparazzi")
        want_dirs.add(module_path / "build" / "test-results")
        if self._profiles:
            for p in self._profiles:
                want_dirs.add(module_path / p["failures_dir"])
                gdir = p.get("golden_dir", "")
                if gdir:
                    want_dirs.add(module_path / gdir)
        else:
            want_dirs.add(module_path / "src" / "test" / "snapshots" / "images")

        added = False
        for d in want_dirs:
            target = d
            while not target.is_dir():
                target = target.parent
                if target == self._root or target == target.parent:
                    target = None
                    break
            if target:
                self._path_to_module[str(d)] = (module_name, module_path)
                if str(target) not in self._actual_watch_dirs:
                    self._actual_watch_dirs.add(str(target))
                    added = True
        return added

    def _discover_new_modules(self):
        """Periodically check for new modules with build/paparazzi/."""
        from server.scanner import _discover_paparazzi_modules

        while not self._stop_discovery.wait(self.DISCOVERY_INTERVAL):
            for _fdir, module_name, module_path in _discover_paparazzi_modules(
                self._root, self._profiles
            ):
                if module_name not in self._known_modules:
                    if self._add_module_watches(module_name):
                        self._on_new_module(module_name, module_path)
                    # Trigger a scan for the new module
                    self._on_change(module_name, module_path)

    def _on_new_module(self, module_name, module_path):
        """Called when a new module is discovered. Subclasses can add watches."""
        pass

    def start(self):
        raise NotImplementedError

    def _start_discovery(self):
        """Start the background thread that discovers new modules."""
        t = threading.Thread(target=self._discover_new_modules, daemon=True)
        t.start()

    def stop(self):
        self._stop_discovery.set()
        with self._lock:
            for timer in self._timers.values():
                timer.cancel()
            self._timers.clear()

    def _on_file_change(self, path):
        """Map a changed file path to its module and debounce."""
        module_info = None
        for watched_dir, info in self._path_to_module.items():
            if path.startswith(watched_dir):
                module_info = info
                break
        if not module_info:
            return

        module_name, module_path = module_info
        with self._lock:
            if module_name in self._timers:
                self._timers[module_name].cancel()
            t = threading.Timer(0.5, self._fire, args=(module_name, module_path))
            t.daemon = True
            t.start()
            self._timers[module_name] = t

    def _fire(self, module_name, module_path):
        with self._lock:
            self._timers.pop(module_name, None)
        self._on_change(module_name, module_path)


if HAS_WATCHDOG:

    class _WatchdogHandler(FileSystemEventHandler):
        def __init__(self, callback):
            self._callback = callback

        def on_any_event(self, event):
            if event.is_directory:
                return
            self._callback(event.src_path)

    class _WatchdogWatcher(_BaseWatcher):
        """Instant file watching via watchdog (FSEvents/inotify)."""

        def __init__(self, modules, project_path, on_module_change, profiles=None):
            super().__init__(modules, project_path, on_module_change, profiles)
            self._observer = Observer()
            for d in self._actual_watch_dirs:
                handler = _WatchdogHandler(self._on_file_change)
                self._observer.schedule(handler, d, recursive=True)

        def _on_new_module(self, module_name, module_path):
            """Add watchdog watches for newly discovered module dirs."""
            for d in self._actual_watch_dirs:
                try:
                    handler = _WatchdogHandler(self._on_file_change)
                    self._observer.schedule(handler, d, recursive=True)
                except OSError:
                    pass  # already watched or doesn't exist

        def start(self):
            self._observer.daemon = True
            self._observer.start()
            self._start_discovery()

        def stop(self):
            super().stop()
            self._observer.stop()
            self._observer.join(timeout=2)


class _PollingWatcher(_BaseWatcher):
    """Fallback: polls watched directories every 2 seconds."""

    POLL_INTERVAL = 2.0

    def __init__(self, modules, project_path, on_module_change, profiles=None):
        super().__init__(modules, project_path, on_module_change, profiles=profiles)
        self._stop_event = threading.Event()
        self._mtimes = {}
        for d in self._actual_watch_dirs:
            self._mtimes[d] = self._dir_mtime(d)

    def start(self):
        t = threading.Thread(target=self._poll, daemon=True)
        t.start()
        self._start_discovery()

    def stop(self):
        super().stop()
        self._stop_event.set()

    def _poll(self):
        while not self._stop_event.wait(self.POLL_INTERVAL):
            for d in self._actual_watch_dirs:
                new_mtime = self._dir_mtime(d)
                if new_mtime != self._mtimes.get(d):
                    self._mtimes[d] = new_mtime
                    self._on_file_change(d)

    @staticmethod
    def _dir_mtime(dir_path):
        """Get the max mtime of files in a directory (non-recursive, fast)."""
        max_mt = 0.0
        try:
            for entry in os.scandir(dir_path):
                if entry.is_file():
                    mt = entry.stat().st_mtime
                    if mt > max_mt:
                        max_mt = mt
        except OSError:
            pass
        return max_mt
