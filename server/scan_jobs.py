"""Background scan job manager.

Runs scans in daemon threads with progress tracking and cancellation.
Completed jobs are cleaned up after JOB_TTL seconds.
"""

import threading
import time
import uuid

from server import projects
from server.scanner import scan_project_incremental

_jobs = {}
_lock = threading.Lock()

JOB_TTL = 300  # 5 minutes


def start_scan(project_id, name, path):
    """Start a background scan. Returns job ID immediately."""
    _cleanup_old_jobs()
    job_id = uuid.uuid4().hex[:8]
    cancel = threading.Event()
    job = {
        "id": job_id,
        "projectId": project_id,
        "projectName": name,
        "status": "discovering",
        "total_modules": 0,
        "scanned_modules": 0,
        "modules_found": 0,
        "current_module": "",
        "failures_found": 0,
        "scan_id": None,
        "error": None,
        "_cancel": cancel,
        "_finished_at": None,
    }
    with _lock:
        _jobs[job_id] = job

    t = threading.Thread(
        target=_run_scan, args=(job_id, project_id, name, path, cancel), daemon=True
    )
    t.start()
    return job_id


def get_job(job_id):
    """Return job progress as a JSON-safe dict."""
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        return None
    return {
        "id": job["id"],
        "projectId": job["projectId"],
        "projectName": job["projectName"],
        "status": job["status"],
        "totalModules": job["total_modules"],
        "scannedModules": job["scanned_modules"],
        "modulesFound": job["modules_found"],
        "currentModule": job["current_module"],
        "failuresFound": job["failures_found"],
        "scanId": job["scan_id"],
        "error": job["error"],
    }


def cancel_job(job_id):
    """Cancel a running scan."""
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        return False
    job["_cancel"].set()
    return True


def _cleanup_old_jobs():
    """Remove completed/failed/cancelled jobs older than JOB_TTL."""
    now = time.monotonic()
    with _lock:
        to_remove = [
            jid
            for jid, job in _jobs.items()
            if job["_finished_at"] and now - job["_finished_at"] > JOB_TTL
        ]
        for jid in to_remove:
            del _jobs[jid]


def _run_scan(job_id, project_id, name, path, cancel):
    """Thread target: run the incremental scan."""
    job = _jobs[job_id]
    try:
        for phase, data in scan_project_incremental(path, cancel):
            if phase == "discovering":
                job["modules_found"] = data["found"]
                job["current_module"] = data["current_dir"]
            elif phase == "discovered":
                job["status"] = "scanning"
                job["total_modules"] = data["total"]
            elif phase == "progress":
                job["scanned_modules"] = data["scanned"]
                job["current_module"] = data["current_module"]
                job["failures_found"] = data["failures_so_far"]
            elif phase == "cancelled":
                job["status"] = "cancelled"
                job["_finished_at"] = time.monotonic()
                return
            elif phase == "complete":
                scan = projects.create_scan_from_results(
                    project_id, name, path, data["modules"], data["failures"]
                )
                job["scan_id"] = scan["id"]
                job["status"] = "completed"
                job["failures_found"] = scan["stats"]["total"]
                job["_finished_at"] = time.monotonic()
                return
        job["status"] = "completed"
        job["_finished_at"] = time.monotonic()
    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        job["_finished_at"] = time.monotonic()
