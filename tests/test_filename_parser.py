import unittest

from server.filename_parser import parse_filename


class TestParseFilename(unittest.TestCase):
    def test_standard_filename(self):
        result = parse_filename("com.example_LoginTest_testLoginButton.png")
        self.assertEqual(result["package"], "com.example")
        self.assertEqual(result["class_name"], "LoginTest")
        self.assertEqual(result["method"], "testLoginButton")
        self.assertIsNone(result["snapshot_name"])

    def test_nested_package(self):
        result = parse_filename(
            "app.cash.paparazzi.sample_HelloComposeTest_compose.png"
        )
        self.assertEqual(result["package"], "app.cash.paparazzi.sample")
        self.assertEqual(result["class_name"], "HelloComposeTest")
        self.assertEqual(result["method"], "compose")

    def test_with_snapshot_name(self):
        result = parse_filename("com.example_KeypadViewTest_testViews_bolt.png")
        self.assertEqual(result["package"], "com.example")
        self.assertEqual(result["class_name"], "KeypadViewTest")
        self.assertEqual(result["method"], "testViews")
        self.assertEqual(result["snapshot_name"], "bolt")

    def test_snapshot_name_with_underscores(self):
        result = parse_filename("com.example_MyTest_testMethod_long_snapshot_name.png")
        self.assertEqual(result["snapshot_name"], "long_snapshot_name")

    def test_no_delta_prefix_expected(self):
        # Callers strip delta- via _delta_to_base before calling parse_filename
        result = parse_filename("com.example_LoginTest_testLogin.png")
        self.assertEqual(result["package"], "com.example")
        self.assertEqual(result["class_name"], "LoginTest")
        self.assertEqual(result["method"], "testLogin")

    def test_multi_dot_package(self):
        result = parse_filename("com.example.ui_DashboardTest_testHeader.png")
        self.assertEqual(result["package"], "com.example.ui")
        self.assertEqual(result["class_name"], "DashboardTest")
        self.assertEqual(result["method"], "testHeader")

    def test_single_segment_fallback(self):
        result = parse_filename("broken.png")
        self.assertEqual(result["package"], "")
        self.assertEqual(result["class_name"], "")
        self.assertEqual(result["raw"], "broken.png")

    def test_raw_always_present(self):
        result = parse_filename("com.example_Foo_bar.png")
        self.assertEqual(result["raw"], "com.example_Foo_bar.png")


if __name__ == "__main__":
    unittest.main()
