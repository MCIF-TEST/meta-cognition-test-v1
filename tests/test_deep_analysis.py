import unittest
from backend.analysis_core.deep_scan import deep_analyze

class TestDeepAnalysis(unittest.TestCase):
    def test_deep_analyze_content(self):
        result = deep_analyze("This is a deep scan test.")
        self.assertIn("layers", result)
        self.assertIn("confidence", result)
        self.assertTrue(0 <= result["confidence"] <= 1)

    def test_deep_analyze_empty(self):
        result = deep_analyze("")
        self.assertEqual(result["layers"], [])
        self.assertEqual(result["confidence"], 0)

if __name__ == "__main__":
    unittest.main()
