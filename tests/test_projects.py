import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import projects


class TestOneScanPerProject(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self._orig_data_dir = projects.DATA_DIR
        projects.DATA_DIR = Path(self.tmpdir)

    def tearDown(self):
        projects.DATA_DIR = self._orig_data_dir
        import shutil

        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_second_scan_replaces_first(self):
        scan1 = projects.create_scan_from_results(
            "proj1", "MyProject", "/tmp/proj", [], []
        )
        scans = projects.list_scans()
        self.assertEqual(len(scans), 1)
        self.assertEqual(scans[0]["id"], scan1["id"])

        scan2 = projects.create_scan_from_results(
            "proj1", "MyProject", "/tmp/proj", [], []
        )
        scans = projects.list_scans()
        self.assertEqual(len(scans), 1)
        self.assertEqual(scans[0]["id"], scan2["id"])
        # Old scan file should be deleted
        self.assertFalse(projects._scan_path(scan1["id"]).is_file())

    def test_different_projects_kept(self):
        scan_a = projects.create_scan_from_results(
            "proj_a", "ProjectA", "/tmp/a", [], []
        )
        scan_b = projects.create_scan_from_results(
            "proj_b", "ProjectB", "/tmp/b", [], []
        )
        scans = projects.list_scans()
        self.assertEqual(len(scans), 2)
        ids = {s["id"] for s in scans}
        self.assertIn(scan_a["id"], ids)
        self.assertIn(scan_b["id"], ids)

    def test_third_scan_still_one_per_project(self):
        scan1 = projects.create_scan_from_results(
            "proj1", "P", "/tmp/p", [], []
        )
        scan2 = projects.create_scan_from_results(
            "proj1", "P", "/tmp/p", [], []
        )
        scan3 = projects.create_scan_from_results(
            "proj1", "P", "/tmp/p", [], []
        )
        scans = projects.list_scans()
        self.assertEqual(len(scans), 1)
        self.assertEqual(scans[0]["id"], scan3["id"])
        self.assertFalse(projects._scan_path(scan1["id"]).is_file())
        self.assertFalse(projects._scan_path(scan2["id"]).is_file())


if __name__ == "__main__":
    unittest.main()
