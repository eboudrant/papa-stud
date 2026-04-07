"""Scan Gradle projects for Paparazzi screenshot failures.

Finds modules with build/paparazzi/failures/, detects current vs stale
failures using mtime clustering, matches golden images, and parses
JUnit XML for test statistics.
"""

import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from server.filename_parser import base_filename, parse_filename

MTIME_CLUSTER_TOLERANCE = 60.0

PRUNE_DIRS = {
    ".git",
    ".gradle",
    ".idea",
    "node_modules",
    ".cxx",
    ".transforms",
    "src",
    ".kotlin",
}


def scan_project(project_path):
    """Scan a Gradle project for Paparazzi failures. Blocking convenience wrapper."""
    result = {"modules": [], "failures": []}
    for phase, data in scan_project_incremental(project_path):
        if phase == "complete":
            result = data
    return result


def process_single_module(failures_dir, module_name, module_path, profiles=None):
    """Process a single Paparazzi module. Returns (module_data, failures_list).

    If profiles is provided, processes each profile's failure/golden dirs.
    Otherwise uses the legacy failures_dir with default golden dir.
    Reused by both the initial scan and the realtime watcher.
    """
    test_stats, xml_mtime = _parse_junit_xml(module_path)
    diff_pcts = _parse_diff_percentages(module_path)
    module_failures = []
    profile_counts = {}
    total_snapshots = 0

    if profiles:
        for profile in profiles:
            pname = profile["name"]
            f_dir = module_path / profile["failures_dir"]
            gp = _build_golden_patterns(profile)
            pf = _process_profile(
                f_dir,
                module_path,
                module_name,
                pname,
                test_stats,
                xml_mtime,
                golden_patterns=gp,
                diff_pcts=diff_pcts,
            )
            module_failures.extend(pf)
            profile_counts[pname] = len(pf)
            g_dir_str = profile.get("golden_dir", "")
            if g_dir_str:
                g_dir = module_path / g_dir_str
                total_snapshots += (
                    len(list(g_dir.glob("*.png"))) if g_dir.is_dir() else 0
                )
    else:
        default_gp = ["src/test/snapshots/images/{name}.png"]
        pf = _process_profile(
            Path(failures_dir) if failures_dir else None,
            module_path,
            module_name,
            "baseline",
            test_stats,
            xml_mtime,
            golden_patterns=default_gp,
            diff_pcts=diff_pcts,
        )
        module_failures.extend(pf)
        profile_counts["baseline"] = len(pf)
        golden_dir = module_path / "src" / "test" / "snapshots" / "images"
        total_snapshots = (
            len(list(golden_dir.glob("*.png"))) if golden_dir.is_dir() else 0
        )

    module_data = {
        "name": module_name,
        "failures_path": str(failures_dir) if failures_dir else None,
        "golden_path": str(module_path / "src" / "test" / "snapshots" / "images"),
        "failure_count": len(module_failures),
        "snapshot_count": total_snapshots,
        "profile_counts": profile_counts,
        "test_stats": test_stats,
    }
    return module_data, module_failures


def _build_golden_patterns(profile):
    """Build golden pattern list from a profile config.

    If profile has 'golden_patterns', use those directly.
    Otherwise build from 'golden_dir' + optional 'golden_suffix'.
    Patterns use {name} as placeholder for snapshot name (without .png).
    """
    if "golden_patterns" in profile:
        return profile["golden_patterns"]
    g_dir = profile.get("golden_dir", "")
    suffix = profile.get("golden_suffix", "")
    patterns = []
    if suffix:
        patterns.append(f"{g_dir}/{{name}}{suffix}.png")
    patterns.append(f"{g_dir}/{{name}}.png")
    return patterns


def _resolve_golden(module_path, golden_patterns, snapshot_name):
    """Try each golden pattern in order, return first existing path or None.

    Patterns use {name} as placeholder for the snapshot name (without .png).
    Example: "src/androidMain/assets/primitive/all/{name}@4x.png"
    """
    name = snapshot_name[:-4] if snapshot_name.endswith(".png") else snapshot_name
    for pattern in golden_patterns:
        candidate = module_path / pattern.replace("{name}", name)
        if candidate.is_file():
            return candidate
    return None


def _process_profile(
    failures_dir,
    module_path,
    module_name,
    profile_name,
    test_stats,
    xml_mtime,
    golden_patterns=None,
    diff_pcts=None,
):
    """Process one profile's failures for a module. Returns list of failure dicts."""
    if not golden_patterns:
        golden_patterns = []
    results = []
    if failures_dir and Path(failures_dir).is_dir():
        failures_dir = Path(failures_dir)
        current = _detect_current_failures(failures_dir)
        if xml_mtime > 0 and current and test_stats and test_stats["failed"] == 0:
            current = [f for f in current if f.stat().st_mtime > xml_mtime]

        # Stale golden check: skip if ANY matching golden is newer than delta
        if current and golden_patterns:
            filtered = []
            for f in current:
                golden = _resolve_golden(
                    module_path, golden_patterns, base_filename(f.name)
                )
                if golden and golden.stat().st_mtime > f.stat().st_mtime:
                    continue
                filtered.append(f)
            current = filtered

        for delta_path in current:
            fname = delta_path.name
            base = base_filename(fname)
            parsed = parse_filename(base)
            actual_path = failures_dir / base
            golden_path = _resolve_golden(module_path, golden_patterns, base)

            results.append(
                {
                    "module": module_name,
                    "profile": profile_name,
                    "filename": base,
                    "delta_path": str(delta_path),
                    "actual_path": str(actual_path) if actual_path.is_file() else None,
                    "golden_path": str(golden_path) if golden_path else None,
                    "package": parsed["package"],
                    "class_name": parsed["class_name"],
                    "method": parsed["method"],
                    "snapshot_name": parsed["snapshot_name"],
                    "status": "pending",
                    "diff_pct": (diff_pcts or {}).get(base),
                    "has_golden": golden_path is not None,
                    "has_actual": actual_path.is_file(),
                    "mtime": delta_path.stat().st_mtime,
                }
            )
    return results


def scan_project_incremental(project_path, cancel_event=None, profiles=None):
    """Yield (phase, data) tuples as the scan progresses.

    Phases:
        ("discovered", {"total": N})
        ("progress", {"scanned": i, "current_module": name, "failures_so_far": N})
        ("cancelled", {})
        ("complete", {"modules": [...], "failures": [...]})
    """
    root = Path(project_path)

    # Phase 1: Fast discovery with os.walk + pruning
    # Discover modules that have build/paparazzi/ OR any profile's failures dir
    discovered = []
    for module_info in _discover_paparazzi_modules(root, profiles):
        discovered.append(module_info)
        yield ("discovering", {"found": len(discovered), "current_dir": module_info[1]})
    yield ("discovered", {"total": len(discovered)})

    # Phase 2: Process each module
    modules = []
    failures = []
    for i, (failures_dir, module_name, module_path) in enumerate(discovered):
        if cancel_event and cancel_event.is_set():
            yield ("cancelled", {})
            return

        module_data, module_failures = process_single_module(
            failures_dir, module_name, module_path, profiles
        )
        modules.append(module_data)
        if module_failures:
            failures.extend(module_failures)

        yield (
            "progress",
            {
                "scanned": i + 1,
                "current_module": module_name,
                "failures_so_far": len(failures),
            },
        )

    yield ("complete", {"modules": modules, "failures": failures})


def _discover_paparazzi_modules(root, profiles=None):
    """Walk project tree with aggressive pruning, yielding modules as found.

    Discovers any module with build/paparazzi/ (including passing modules).
    Yields (failures_dir_or_None, module_name, module_path) tuples.
    """
    root_str = str(root)

    for dirpath, dirnames, _filenames in os.walk(root_str):
        dirnames[:] = [d for d in dirnames if d not in PRUNE_DIRS]

        rel = os.path.relpath(dirpath, root_str)
        parts = rel.split(os.sep)

        # Aggressive pruning inside build/ directories
        if "build" in parts:
            idx = parts.index("build")
            depth = len(parts) - idx
            if depth == 1:
                dirnames[:] = [
                    d for d in dirnames if d in ("paparazzi", "test-results")
                ]
            elif depth == 2 and parts[-1] == "paparazzi":
                # Found a paparazzi module
                module_parts = parts[:idx]
                if module_parts and module_parts != ["."]:
                    module_name = ":" + ":".join(module_parts)
                    module_path = root / Path(*module_parts)
                else:
                    module_name = ":root"
                    module_path = root
                failures_dir = Path(dirpath) / "failures"
                yield (
                    failures_dir if failures_dir.is_dir() else None,
                    module_name,
                    module_path,
                )
                dirnames.clear()
            elif depth == 2 and parts[-1] == "test-results":
                pass
            else:
                dirnames.clear()


def _detect_current_failures(failures_dir):
    """Return only delta files from the most recent verifyPaparazzi run."""
    delta_files = []
    for f in failures_dir.iterdir():
        if f.name.startswith("delta-") and f.name.endswith(".png") and f.is_file():
            delta_files.append((f, f.stat().st_mtime))

    if not delta_files:
        return []

    delta_files.sort(key=lambda x: x[1], reverse=True)
    latest_mtime = delta_files[0][1]
    current = []
    for f, mtime in delta_files:
        if latest_mtime - mtime <= MTIME_CLUSTER_TOLERANCE:
            current.append(f)
        else:
            break

    return current


def _parse_diff_percentages(module_path):
    """Extract diff percentages from JUnit XML failure messages.

    Returns dict mapping delta filename to percentage (e.g., {"test.png": 0.044794}).
    Parses 'Images differ (by X.XXX%)' from failure message attributes.
    """
    result = {}
    for variant in ("testDebugUnitTest", "testReleaseUnitTest"):
        results_dir = module_path / "build" / "test-results" / variant
        if not results_dir.is_dir():
            continue
        for xml_file in results_dir.glob("TEST-*.xml"):
            try:
                tree = ET.parse(xml_file)
                for tc in tree.getroot().iter("testcase"):
                    for fail in tc.iter("failure"):
                        msg = fail.get("message", "")
                        # Extract percentage
                        pct_match = re.search(r"differ \(by ([\d.]+)%\)", msg)
                        # Extract delta filename
                        delta_match = re.search(r"delta-([^\s]+\.png)", msg)
                        if pct_match and delta_match:
                            # Store without delta- prefix
                            fname = delta_match.group(1)
                            # Get just the base filename
                            fname = fname.split("/")[-1]
                            result[fname] = float(pct_match.group(1))
            except (ET.ParseError, OSError):
                pass
    return result


def _parse_junit_xml(module_path):
    """Parse JUnit XML test results for a module.

    Looks in build/test-results/testDebugUnitTest/ and testReleaseUnitTest/.
    Returns (stats_dict, newest_xml_mtime) or (None, 0) if no XML found.
    """
    stats = {
        "tests": 0,
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "errors": 0,
        "time": 0.0,
    }
    found = False
    newest_mtime = 0.0

    for variant in ("testDebugUnitTest", "testReleaseUnitTest"):
        results_dir = module_path / "build" / "test-results" / variant
        if not results_dir.is_dir():
            continue
        for xml_file in results_dir.glob("TEST-*.xml"):
            parsed = _parse_single_junit_xml(xml_file)
            if parsed:
                found = True
                stats["tests"] += parsed["tests"]
                stats["failed"] += parsed["failed"]
                stats["skipped"] += parsed["skipped"]
                stats["errors"] += parsed["errors"]
                stats["time"] += parsed["time"]
                xml_mtime = xml_file.stat().st_mtime
                if xml_mtime > newest_mtime:
                    newest_mtime = xml_mtime

    if not found:
        return None, 0.0

    stats["passed"] = (
        stats["tests"] - stats["failed"] - stats["skipped"] - stats["errors"]
    )
    stats["time"] = round(stats["time"], 2)
    return stats, newest_mtime


def _parse_single_junit_xml(xml_path):
    """Parse a single JUnit XML file. Returns stats dict or None."""
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
        return {
            "tests": int(root.get("tests", 0)),
            "failed": int(root.get("failures", 0)),
            "skipped": int(root.get("skipped", 0)),
            "errors": int(root.get("errors", 0)),
            "time": float(root.get("time", 0)),
        }
    except (ET.ParseError, ValueError, OSError):
        return None
