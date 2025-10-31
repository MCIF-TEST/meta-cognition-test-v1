import unittest
from backend.analysis_core.signal_integrator import process_signal

class TestSignalIntel(unittest.TestCase):
    def test_process_signal_text(self):
        result = process_signal("This is a test signal.")
        self.assertIn("analysis", result)
        self.assertIn("confidence", result)
        self.assertTrue(0 <= result["confidence"] <= 1)

    def test_process_signal_empty(self):
        result = process_signal("")
        self.assertEqual(result["analysis"], "No content provided.")
        self.assertEqual(result["confidence"], 0)

if __name__ == "__main__":
    unittest.main()
