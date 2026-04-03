"""Project and scan management.

Handles project CRUD, scan creation, failure status updates.
All data persisted as JSON files under DATA_DIR.
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


# --- Scans ---


def create_scan(project_id):
    project = get_project(project_id)
    if not project:
        return None

    result = scan_project(project["path"])

    scan_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    scan = {
        "id": scan_id,
        "projectId": project_id,
        "projectName": project["name"],
        "projectPath": project["path"],
        "created": datetime.now(timezone.utc).isoformat(),
        "modules": result["modules"],
        "failures": result["failures"],
        "stats": _compute_stats(result["failures"]),
    }

    with _lock:
        _write_json(_scan_path(scan_id), scan)

    return scan


def list_scans():
    scans = []
    scans_dir = _scans_dir()
    for f in sorted(scans_dir.glob("*.json"), reverse=True):
        data = _read_json(f)
        if data:
            scans.append(
                {
                    "id": data["id"],
                    "projectId": data["projectId"],
                    "projectName": data.get("projectName", ""),
                    "created": data["created"],
                    "modules": data["modules"],
                    "stats": data["stats"],
                }
            )
    return scans


def get_scan(scan_id, page=0, size=50, status=None, query=None, module=None):
    with _lock:
        scan = _read_json(_scan_path(scan_id))
    if not scan:
        return None

    failures = scan["failures"]

    # Filter
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

    # Paginate
    start = page * size
    end = start + size
    page_failures = failures[start:end]

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
    path = _scan_path(scan_id)
    with _lock:
        if path.is_file():
            path.unlink()


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
