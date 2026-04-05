"""Project and scan management.

Handles project CRUD, scan creation, failure status updates.
All data persisted as JSON files under DATA_DIR.
Uses an index file for fast scan listing.
"""

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from server.scanner import scan_project

DATA_DIR = Path("data")

_lock = threading.Lock()


def _projects_path():
    return DATA_DIR / "projects.json"


def _scans_dir():
    d = DATA_DIR / "scans"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_id(value):
    """Sanitize an ID to prevent path traversal. Only allows alphanumeric, dash, underscore."""
    import re

    if not re.match(r"^[\w-]+$", value):
        raise ValueError(f"Invalid ID: {value}")
    return value


def _scan_path(scan_id):
    return _scans_dir() / f"{_safe_id(scan_id)}.json"


def _index_path():
    return _scans_dir() / "index.json"


def _read_json(path):
    path = Path(path).resolve()
    if not path.is_relative_to(DATA_DIR.resolve()):
        return None
    if not path.is_file():
        return None
    with open(path) as f:
        return json.load(f)


def _write_json(path, data):
    path = Path(path).resolve()
    if not path.is_relative_to(DATA_DIR.resolve()):
        raise ValueError(f"Path outside data dir: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    tmp.rename(path)


# --- Projects ---


def list_projects():
    with _lock:
        projects = _read_json(_projects_path()) or []
        migrated = False
        for p in projects:
            if "profiles" not in p:
                p["profiles"] = list(DEFAULT_PROFILES)
                migrated = True
        if migrated:
            _write_json(_projects_path(), projects)
        return projects


DEFAULT_PROFILES = [
    {
        "name": "baseline",
        "failures_dir": "build/paparazzi/failures",
        "golden_dir": "src/test/snapshots/images",
        "golden_patterns": ["src/test/snapshots/images/{name}.png"],
    }
]


def add_project(name, path):
    with _lock:
        projects = _read_json(_projects_path()) or []
        project = {
            "id": uuid.uuid4().hex[:8],
            "name": name,
            "path": path,
            "added": datetime.now(timezone.utc).isoformat(),
            "profiles": list(DEFAULT_PROFILES),
        }
        projects.append(project)
        _write_json(_projects_path(), projects)
    return project


def get_project(project_id):
    for p in list_projects():
        if p["id"] == project_id:
            return p
    return None


def update_project_profiles(project_id, profiles):
    with _lock:
        projects = _read_json(_projects_path()) or []
        for p in projects:
            if p["id"] == project_id:
                p["profiles"] = profiles
                break
        _write_json(_projects_path(), projects)
    return get_project(project_id)


def delete_project(project_id):
    with _lock:
        projects = _read_json(_projects_path()) or []
        projects = [p for p in projects if p["id"] != project_id]
        _write_json(_projects_path(), projects)


# --- Scan Index ---


def _scan_summary(scan):
    """Extract lightweight summary from a full scan for the index."""
    return {
        "id": scan["id"],
        "projectId": scan["projectId"],
        "projectName": scan.get("projectName", ""),
        "created": scan["created"],
        "modules": scan["modules"],
        "stats": scan["stats"],
    }


def _read_index():
    """Read the scan index, rebuilding from scan files if missing."""
    idx = _read_json(_index_path())
    if idx is not None:
        return idx
    return _rebuild_index()


def _rebuild_index():
    """Rebuild index from existing scan files. Called once on migration."""
    index = []
    scans_dir = _scans_dir()
    for f in sorted(scans_dir.glob("*.json"), reverse=True):
        if f.name == "index.json":
            continue
        data = _read_json(f)
        if data:
            index.append(_scan_summary(data))
    _write_json(_index_path(), index)
    return index


def _update_index(summary):
    """Add a scan summary to the index."""
    index = _read_index()
    index.insert(0, summary)
    _write_json(_index_path(), index)


def _remove_from_index(scan_id):
    """Remove a scan from the index."""
    index = _read_index()
    index = [s for s in index if s["id"] != scan_id]
    _write_json(_index_path(), index)


# --- Scans ---


def create_scan(project_id):
    """Blocking scan — used by tests and backward compat."""
    project = get_project(project_id)
    if not project:
        return None

    result = scan_project(project["path"])
    return create_scan_from_results(
        project_id,
        project["name"],
        project["path"],
        result["modules"],
        result["failures"],
    )


def create_scan_from_results(project_id, project_name, project_path, modules, failures):
    """Create and persist a scan from pre-computed results. Called by scan_jobs."""
    scan_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
    scan = {
        "id": scan_id,
        "projectId": project_id,
        "projectName": project_name,
        "projectPath": project_path,
        "created": datetime.now(timezone.utc).isoformat(),
        "modules": modules,
        "failures": failures,
        "stats": _compute_stats(failures),
    }

    with _lock:
        _write_json(_scan_path(scan_id), scan)
        _update_index(_scan_summary(scan))

    return scan


def list_scans():
    with _lock:
        return _read_index()


def get_scan(
    scan_id, page=0, size=50, status=None, query=None, module=None, profile=None
):
    with _lock:
        scan = _read_json(_scan_path(scan_id))
    if not scan:
        return None

    failures = scan["failures"]

    if status and status != "all":
        failures = [f for f in failures if f["status"] == status]
    if module:
        failures = [f for f in failures if f["module"] == module]
    if profile:
        failures = [f for f in failures if f.get("profile") == profile]
    if query:
        q = query.lower()
        failures = [
            f
            for f in failures
            if q in f["filename"].lower()
            or q in f["package"].lower()
            or q in f["class_name"].lower()
            or q in f["method"].lower()
        ]

    total_filtered = len(failures)
    start = page * size
    page_failures = failures[start : start + size]

    return {
        "id": scan["id"],
        "projectId": scan["projectId"],
        "projectName": scan.get("projectName", ""),
        "projectPath": scan.get("projectPath", ""),
        "created": scan["created"],
        "modules": scan["modules"],
        "stats": scan["stats"],
        "failures": page_failures,
        "totalFiltered": total_filtered,
        "page": page,
        "pageSize": size,
    }


def delete_scan(scan_id):
    with _lock:
        path = _scan_path(scan_id)
        if path.is_file():
            path.unlink()
        _remove_from_index(scan_id)


def update_scan_module(scan_id, module_name, module_data, module_failures):
    """Update a single module's data in an existing scan (in-place)."""
    with _lock:
        scan = _read_json(_scan_path(scan_id))
        if not scan:
            return None

        # Replace or add module entry
        found = False
        for i, m in enumerate(scan["modules"]):
            if m["name"] == module_name:
                scan["modules"][i] = module_data
                found = True
                break
        if not found:
            scan["modules"].append(module_data)

        # Replace failures for this module
        scan["failures"] = [
            f for f in scan["failures"] if f["module"] != module_name
        ] + module_failures

        scan["stats"] = _compute_stats(scan["failures"])
        _write_json(_scan_path(scan_id), scan)

        # Update index
        idx = _read_index()
        for i, s in enumerate(idx):
            if s["id"] == scan_id:
                idx[i] = _scan_summary(scan)
                break
        _write_json(_index_path(), idx)

    return scan["stats"]


def update_failure_status(scan_id, filename, status):
    with _lock:
        scan = _read_json(_scan_path(scan_id))
        if not scan:
            return None
        for f in scan["failures"]:
            if f["filename"] == filename:
                f["status"] = status
                break
        scan["stats"] = _compute_stats(scan["failures"])
        _write_json(_scan_path(scan_id), scan)
    return scan["stats"]


def batch_update_status(scan_id, filenames, status):
    with _lock:
        scan = _read_json(_scan_path(scan_id))
        if not scan:
            return None
        target = set(filenames)
        for f in scan["failures"]:
            if f["filename"] in target:
                f["status"] = status
        scan["stats"] = _compute_stats(scan["failures"])
        _write_json(_scan_path(scan_id), scan)
    return scan["stats"]


def is_path_under_project(file_path):
    """Validate that a resolved file path is under a registered project directory."""
    resolved = Path(file_path).resolve()
    for p in list_projects():
        project_root = Path(p["path"]).resolve()
        if resolved.is_relative_to(project_root):
            return True
    return False


def _compute_stats(failures):
    stats = {"total": len(failures), "pending": 0, "accepted": 0, "rejected": 0}
    for f in failures:
        s = f.get("status", "pending")
        if s in stats:
            stats[s] += 1
    return stats
