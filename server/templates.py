"""Profile templates for common screenshot testing tools.

Built-in templates for Paparazzi and Roborazzi, plus user-defined custom templates.
"""

import json
from pathlib import Path

DATA_DIR = Path("data")

BUILTIN_TEMPLATES = [
    {
        "id": "paparazzi",
        "name": "Paparazzi",
        "tool": "paparazzi",
        "builtin": True,
        "description": "Paparazzi",
        "failures_dir": "build/paparazzi/failures",
        "golden_dir": "src/test/snapshots/images",
        "golden_patterns": ["src/test/snapshots/images/{name}.png"],
        "delta_prefix": "delta-",
        "delta_suffix": "",
        "actual_suffix": "",
    },
    {
        "id": "roborazzi",
        "name": "Roborazzi",
        "tool": "roborazzi",
        "builtin": True,
        "description": "Roborazzi",
        "failures_dir": "build/outputs/roborazzi",
        "golden_dir": "src/test/goldens/roborazzi",
        "golden_patterns": ["src/test/goldens/roborazzi/**/{name}.png"],
        "delta_prefix": "",
        "delta_suffix": "_compare",
        "actual_suffix": "_actual",
    },
]


def _custom_path():
    return DATA_DIR / "templates.json"


def _read_custom():
    p = _custom_path()
    if p.is_file():
        with open(p) as f:
            return json.load(f)
    return []


def _write_custom(templates):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _custom_path().with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(templates, f, indent=2)
    tmp.rename(_custom_path())


def list_templates():
    """Return all templates: built-in first, then custom."""
    return BUILTIN_TEMPLATES + _read_custom()


def get_template(template_id):
    for t in list_templates():
        if t["id"] == template_id:
            return t
    return None


def create_template(data):
    """Create a custom template. Returns the template."""
    custom = _read_custom()
    tid = data.get("id", data.get("name", "custom").lower().replace(" ", "-"))
    # Remove existing with same ID to allow update-by-create
    custom = [t for t in custom if t["id"] != tid]
    template = {
        "id": tid,
        "name": data.get("name", "Custom"),
        "tool": data.get("tool", "custom"),
        "builtin": False,
        "description": data.get("description", ""),
        "failures_dir": data.get("failures_dir", ""),
        "golden_dir": data.get("golden_dir", ""),
        "golden_patterns": data.get("golden_patterns", []),
        "delta_prefix": data.get("delta_prefix", "delta-"),
        "delta_suffix": data.get("delta_suffix", ""),
        "actual_suffix": data.get("actual_suffix", ""),
    }
    custom.append(template)
    _write_custom(custom)
    return template


def delete_template(template_id):
    """Delete a custom template. Cannot delete built-in."""
    if any(t["id"] == template_id for t in BUILTIN_TEMPLATES):
        return False
    custom = _read_custom()
    filtered = [t for t in custom if t["id"] != template_id]
    if len(filtered) == len(custom):
        return False
    _write_custom(filtered)
    return True


def template_to_profile(template):
    """Convert a template to a project profile dict."""
    return {
        "name": template.get("name", ""),
        "failures_dir": template.get("failures_dir", ""),
        "golden_dir": template.get("golden_dir", ""),
        "golden_patterns": template.get("golden_patterns", []),
        "delta_prefix": template.get("delta_prefix", "delta-"),
        "delta_suffix": template.get("delta_suffix", ""),
        "actual_suffix": template.get("actual_suffix", ""),
        "template_id": template.get("id", ""),
    }
