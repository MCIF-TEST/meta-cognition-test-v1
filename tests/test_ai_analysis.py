import unittest
from backend.services.ai_analysis import analyze_text

class TestAIAnalysis(unittest.TestCase):
    def test_basic_text(self):
        result = analyze_text("Hello AI world")
        self.assertIn("ai_probability", result)
        self.assertIn("confidence", result)
        self.assertTrue(0 <= result["confidence"] <= 1)

    def test_empty_text(self):
        result = analyze_text("")
        self.assertEqual(result["reasoning"], "No text provided")
        self.assertEqual(result["confidence"], 0)

if __name__ == "__main__":
    unittest.main()
