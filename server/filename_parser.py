"""Parse Paparazzi snapshot filenames into structured components.

Filename format: {packageName}_{className}_{methodName}[_{snapshotName}].png
Example: app.cash.paparazzi.sample_HelloComposeTest_compose.png
"""


def parse_filename(filename):
    """Parse a Paparazzi snapshot filename into its components.

    Returns a dict with keys: package, class_name, method, snapshot_name, raw.
    Falls back to raw filename if parsing fails.
    """
    raw = filename
    name = filename
    if name.endswith(".png"):
        name = name[:-4]

    parts = name.split("_")
    if len(parts) < 2:
        return _fallback(raw)

    # Walk parts left-to-right: segments with dots are package parts
    # First segment that starts uppercase with no dots is the class
    package_parts = []
    class_idx = None

    for i, part in enumerate(parts):
        if "." in part:
            package_parts.append(part)
        elif part and part[0].isupper():
            class_idx = i
            break
        else:
            # Lowercase without dots — could be part of a dotless package or ambiguous
            # If we haven't found any dotted parts yet, treat as package
            if not package_parts:
                package_parts.append(part)
            else:
                class_idx = i
                break

    if class_idx is None or class_idx >= len(parts) - 1:
        return _fallback(raw)

    package = ".".join(package_parts) if package_parts else ""
    class_name = parts[class_idx]
    method = parts[class_idx + 1]

    snapshot_name = None
    if class_idx + 2 < len(parts):
        snapshot_name = "_".join(parts[class_idx + 2 :])

    return {
        "package": package,
        "class_name": class_name,
        "method": method,
        "snapshot_name": snapshot_name,
        "raw": raw,
    }


def _fallback(raw):
    return {
        "package": "",
        "class_name": "",
        "method": "",
        "snapshot_name": None,
        "raw": raw,
    }
