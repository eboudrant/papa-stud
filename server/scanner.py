"""Scan Gradle projects for Paparazzi screenshot failures.

Finds modules with build/paparazzi/failures/, detects current vs stale
failures using mtime clustering, and matches golden images.
"""

from pathlib import Path

from server.filename_parser import base_filename, parse_filename

# Files within this window (seconds) are considered part of the same test run
MTIME_CLUSTER_TOLERANCE = 60.0


def scan_project(project_path):
    """Scan a Gradle project for Paparazzi failures across all modules.

    Returns a dict with 'modules' and 'failures' lists.
    """
    root = Path(project_path)
    modules = []
    failures = []

    # Find all build/paparazzi/failures directories
    for failures_dir in sorted(root.rglob("build/paparazzi/failures")):
        if not failures_dir.is_dir():
            continue

        # Derive module name from path relative to project root
        module_rel = failures_dir.relative_to(root)
        # e.g. app/build/paparazzi/failures -> module is :app
        module_parts = module_rel.parts[: module_rel.parts.index("build")]
        module_name = ":" + ":".join(module_parts) if module_parts else ":root"

        # Find golden images directory
        if module_parts:
            golden_dir = (
                root / Path(*module_parts) / "src" / "test" / "snapshots" / "images"
            )
        else:
            golden_dir = root / "src" / "test" / "snapshots" / "images"

        # Get current failures (filter stale)
        current = _detect_current_failures(failures_dir)
        if not current:
            continue

        module_failures = []
        for delta_path in current:
            fname = delta_path.name
            base = base_filename(fname)
            parsed = parse_filename(base)

            actual_path = failures_dir / base
            golden_path = golden_dir / base

            module_failures.append(
                {
                    "module": module_name,
                    "filename": base,
                    "delta_path": str(delta_path),
                    "actual_path": str(actual_path) if actual_path.is_file() else None,
                    "golden_path": str(golden_path) if golden_path.is_file() else None,
                    "package": parsed["package"],
                    "class_name": parsed["class_name"],
                    "method": parsed["method"],
                    "snapshot_name": parsed["snapshot_name"],
                    "status": "pending",
                    "has_golden": golden_path.is_file(),
                    "has_actual": actual_path.is_file(),
                    "mtime": delta_path.stat().st_mtime,
                }
            )

        modules.append(
            {
                "name": module_name,
                "failures_path": str(failures_dir),
                "golden_path": str(golden_dir),
                "failure_count": len(module_failures),
            }
        )
        failures.extend(module_failures)

    return {"modules": modules, "failures": failures}


def _detect_current_failures(failures_dir):
    """Return only delta files from the most recent verifyPaparazzi run.

    Groups delta-*.png files by mtime. Files within MTIME_CLUSTER_TOLERANCE
    seconds of each other are in the same cluster. Returns the latest cluster.
    """
    delta_files = []
    for f in failures_dir.iterdir():
        if f.name.startswith("delta-") and f.name.endswith(".png") and f.is_file():
            delta_files.append((f, f.stat().st_mtime))

    if not delta_files:
        return []

    # Sort by mtime descending
    delta_files.sort(key=lambda x: x[1], reverse=True)

    # Build the latest cluster: start from newest, include all within tolerance
    latest_mtime = delta_files[0][1]
    current = []
    for f, mtime in delta_files:
        if latest_mtime - mtime <= MTIME_CLUSTER_TOLERANCE:
            current.append(f)
        else:
            break

    return current
