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


class TestProfiles(unittest.TestCase):
    def test_multi_profile_scan(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            # Module with two failure dirs (baseline + figma)
            baseline_fail = root / "app" / "build" / "paparazzi" / "failures"
            figma_fail = root / "app" / "build" / "paparazzi" / "figma-failures"
            golden = root / "app" / "src" / "test" / "snapshots" / "images"
            baseline_fail.mkdir(parents=True)
            figma_fail.mkdir(parents=True)
            golden.mkdir(parents=True)

            # Golden older than deltas
            _make_png(golden / "test1.png")
            os.utime(golden / "test1.png", (1000000, 1000000))

            # Baseline failure
            _make_png(baseline_fail / "delta-test1.png")
            _make_png(baseline_fail / "test1.png")

            # Figma failure
            _make_png(figma_fail / "delta-figma1.png")
            _make_png(figma_fail / "figma1.png")

            profiles = [
                {
                    "name": "baseline",
                    "failures_dir": "build/paparazzi/failures",
                    "golden_dir": "src/test/snapshots/images",
                    "golden_patterns": ["src/test/snapshots/images/{name}.png"],
                },
                {
                    "name": "figma",
                    "failures_dir": "build/paparazzi/figma-failures",
                    "golden_dir": "src/test/snapshots/images",
                    "golden_patterns": ["src/test/snapshots/images/{name}.png"],
                },
            ]

            from server.scanner import process_single_module

            module_data, failures = process_single_module(
                baseline_fail, ":app", root / "app", profiles
            )

            self.assertEqual(module_data["failure_count"], 2)
            self.assertEqual(module_data["profile_counts"]["baseline"], 1)
            self.assertEqual(module_data["profile_counts"]["figma"], 1)
            self.assertEqual(failures[0]["profile"], "baseline")
            self.assertEqual(failures[1]["profile"], "figma")

    def test_golden_pattern_fallback(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            fail_dir = root / "mod" / "build" / "paparazzi" / "failures"
            fail_dir.mkdir(parents=True)
            # Golden in two locations: all/ has @4x, examples/ has base
            all_dir = root / "mod" / "assets" / "all"
            examples_dir = root / "mod" / "assets" / "examples"
            all_dir.mkdir(parents=True)
            examples_dir.mkdir(parents=True)

            # test-a has @4x in all/
            _make_png(all_dir / "test-a@4x.png")
            os.utime(all_dir / "test-a@4x.png", (1000000, 1000000))
            _make_png(fail_dir / "delta-test-a.png")
            _make_png(fail_dir / "test-a.png")

            # test-b only in examples/
            _make_png(examples_dir / "test-b.png")
            os.utime(examples_dir / "test-b.png", (1000000, 1000000))
            _make_png(fail_dir / "delta-test-b.png")
            _make_png(fail_dir / "test-b.png")

            profiles = [
                {
                    "name": "figma",
                    "failures_dir": "build/paparazzi/failures",
                    "golden_dir": "assets/all",
                    "golden_patterns": [
                        "assets/all/{name}@4x.png",
                        "assets/all/{name}.png",
                        "assets/examples/{name}.png",
                    ],
                }
            ]

            from server.scanner import process_single_module

            _, failures = process_single_module(
                fail_dir, ":mod", root / "mod", profiles
            )

            self.assertEqual(len(failures), 2)
            # test-a should resolve to @4x
            fa = next(f for f in failures if f["filename"] == "test-a.png")
            self.assertIn("@4x", fa["golden_path"])
            # test-b should fall back to examples/
            fb = next(f for f in failures if f["filename"] == "test-b.png")
            self.assertIn("examples", fb["golden_path"])

    def test_profile_failure_tagged(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            fail_dir = root / "build" / "paparazzi" / "failures"
            fail_dir.mkdir(parents=True)
            _make_png(fail_dir / "delta-test.png")
            _make_png(fail_dir / "test.png")

            profiles = [
                {
                    "name": "custom",
                    "failures_dir": "build/paparazzi/failures",
                    "golden_dir": "golden",
                    "golden_patterns": ["golden/{name}.png"],
                }
            ]

            from server.scanner import process_single_module

            _, failures = process_single_module(fail_dir, ":root", root, profiles)
            self.assertEqual(len(failures), 1)
            self.assertEqual(failures[0]["profile"], "custom")


if __name__ == "__main__":
    unittest.main()
