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


def _scan_path(scan_id):
    return _scans_dir() / f"{scan_id}.json"


def _index_path():
    return _scans_dir() / "index.json"


def _read_json(path):
    if not path.is_file():
        return None
    with open(path) as f:
        return json.load(f)


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    tmp.rename(path)


# --- Projects ---


def list_projects():
    with _lock:
        return _read_json(_projects_path()) or []


def add_project(name, path):
    with _lock:
        projects = _read_json(_projects_path()) or []
        project = {
            "id": uuid.uuid4().hex[:8],
            "name": name,
            "path": path,
            "added": datetime.now(timezone.utc).isoformat(),
        }
        projects.append(project)
        _write_json(_projects_path(), projects)
    return project


def get_project(project_id):
    projects = list_projects()
    for p in projects:
        if p["id"] == project_id:
            return p
    return None


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


def get_scan(scan_id, page=0, size=50, status=None, query=None, module=None):
    with _lock:
        scan = _read_json(_scan_path(scan_id))
    if not scan:
        return None

    failures = scan["failures"]

    if status and status != "all":
        failures = [f for f in failures if f["status"] == status]
    if module:
        failures = [f for f in failures if f["module"] == module]
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
    """Validate that a file path is under a registered project directory."""
    projects = list_projects()
    resolved = Path(file_path).resolve()
    for p in projects:
        if resolved.is_relative_to(Path(p["path"]).resolve()):
            return True
    return False


def _compute_stats(failures):
    stats = {"total": len(failures), "pending": 0, "accepted": 0, "rejected": 0}
    for f in failures:
        s = f.get("status", "pending")
        if s in stats:
            stats[s] += 1
    return stats
