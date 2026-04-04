import os
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from server.scanner import _detect_current_failures, scan_project


def _make_png(path, width=10, height=10, r=128, g=128, b=128):
    """Create a minimal valid PNG file."""
    raw = b""
    for _ in range(height):
        raw += b"\x00" + bytes([r, g, b]) * width

    def chunk(chunk_type, data):
        c = chunk_type + data
        return (
            struct.pack(">I", len(data))
            + c
            + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        )

    png_data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(png_data)


class TestDetectCurrentFailures(unittest.TestCase):
    def test_filters_stale_files(self):
        with tempfile.TemporaryDirectory() as d:
            failures = Path(d)

            # Current failures (recent mtime)
            _make_png(failures / "delta-current1.png")
            _make_png(failures / "delta-current2.png")

            # Stale failure (old mtime)
            stale = failures / "delta-stale.png"
            _make_png(stale)
            os.utime(stale, (1000000, 1000000))

            result = _detect_current_failures(failures)
            names = {f.name for f in result}
            self.assertEqual(names, {"delta-current1.png", "delta-current2.png"})

    def test_empty_directory(self):
        with tempfile.TemporaryDirectory() as d:
            result = _detect_current_failures(Path(d))
            self.assertEqual(result, [])

    def test_non_delta_files_ignored(self):
        with tempfile.TemporaryDirectory() as d:
            failures = Path(d)
            _make_png(failures / "not-a-delta.png")
            _make_png(failures / "delta-real.png")
            result = _detect_current_failures(failures)
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0].name, "delta-real.png")


class TestScanProject(unittest.TestCase):
    def test_scans_module_with_failures(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            failures = root / "app" / "build" / "paparazzi" / "failures"
            golden = root / "app" / "src" / "test" / "snapshots" / "images"
            failures.mkdir(parents=True)
            golden.mkdir(parents=True)

            # Golden created first, then delta (simulates verify after record)
            _make_png(golden / "com.example_MyTest_testFoo.png", b=255)
            os.utime(golden / "com.example_MyTest_testFoo.png", (1000000, 1000000))
            _make_png(failures / "delta-com.example_MyTest_testFoo.png")
            _make_png(failures / "com.example_MyTest_testFoo.png", r=255)

            result = scan_project(str(root))
            self.assertEqual(len(result["modules"]), 1)
            self.assertEqual(result["modules"][0]["name"], ":app")
            self.assertEqual(len(result["failures"]), 1)

            f = result["failures"][0]
            self.assertEqual(f["module"], ":app")
            self.assertEqual(f["package"], "com.example")
            self.assertEqual(f["class_name"], "MyTest")
            self.assertEqual(f["method"], "testFoo")
            self.assertTrue(f["has_golden"])
            self.assertTrue(f["has_actual"])
            self.assertEqual(f["status"], "pending")

    def test_no_failures_returns_empty(self):
        with tempfile.TemporaryDirectory() as d:
            result = scan_project(d)
            self.assertEqual(result["modules"], [])
            self.assertEqual(result["failures"], [])

    def test_missing_golden_detected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            failures = root / "build" / "paparazzi" / "failures"
            failures.mkdir(parents=True)
            _make_png(failures / "delta-com.example_Test_method.png")
            _make_png(failures / "com.example_Test_method.png")

            result = scan_project(str(root))
            self.assertEqual(len(result["failures"]), 1)
            self.assertFalse(result["failures"][0]["has_golden"])

    def test_stale_delta_filtered_when_golden_newer(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            failures = root / "app" / "build" / "paparazzi" / "failures"
            golden = root / "app" / "src" / "test" / "snapshots" / "images"
            failures.mkdir(parents=True)
            golden.mkdir(parents=True)

            # Delta created first (old)
            _make_png(failures / "delta-com.example_Test_method.png")
            _make_png(failures / "com.example_Test_method.png")
            os.utime(failures / "delta-com.example_Test_method.png", (1000000, 1000000))
            os.utime(failures / "com.example_Test_method.png", (1000000, 1000000))

            # Golden created after (newer = recordPaparazzi ran)
            _make_png(golden / "com.example_Test_method.png")

            result = scan_project(str(root))
            self.assertEqual(len(result["failures"]), 0)

    def test_snapshot_count_included(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            paparazzi = root / "app" / "build" / "paparazzi"
            paparazzi.mkdir(parents=True)
            golden = root / "app" / "src" / "test" / "snapshots" / "images"
            golden.mkdir(parents=True)
            _make_png(golden / "test1.png")
            _make_png(golden / "test2.png")
            _make_png(golden / "test3.png")

            result = scan_project(str(root))
            self.assertEqual(len(result["modules"]), 1)
            self.assertEqual(result["modules"][0]["snapshot_count"], 3)
            self.assertEqual(result["modules"][0]["failure_count"], 0)


if __name__ == "__main__":
    unittest.main()
