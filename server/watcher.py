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

    def __init__(self, modules, project_path, on_module_change, profiles=None):
        self._on_change = on_module_change
        self._timers = {}
        self._lock = threading.Lock()
        self._path_to_module = {}

        root = Path(project_path)
        for mod in modules:
            module_name = mod["name"]
            parts = module_name.strip(":").split(":")
            module_path = root / Path(*parts) if parts and parts != ["root"] else root

            watch_dirs = set()
            watch_dirs.add(module_path / "build" / "test-results")
            if profiles:
                for p in profiles:
                    watch_dirs.add(module_path / p["failures_dir"])
                    watch_dirs.add(module_path / p["golden_dir"])
            else:
                watch_dirs.add(module_path / "build" / "paparazzi" / "failures")
                watch_dirs.add(module_path / "src" / "test" / "snapshots" / "images")

            for d in watch_dirs:
                if d.is_dir():
                    self._path_to_module[str(d)] = (module_name, module_path)

    def start(self):
        raise NotImplementedError

    def stop(self):
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
            for d in self._path_to_module:
                handler = _WatchdogHandler(self._on_file_change)
                self._observer.schedule(handler, d, recursive=True)

        def start(self):
            self._observer.daemon = True
            self._observer.start()

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
        # Snapshot initial mtimes
        for d in self._path_to_module:
            self._mtimes[d] = self._dir_mtime(d)

    def start(self):
        t = threading.Thread(target=self._poll, daemon=True)
        t.start()

    def stop(self):
        super().stop()
        self._stop_event.set()

    def _poll(self):
        while not self._stop_event.wait(self.POLL_INTERVAL):
            for d in self._path_to_module:
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
