import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("benchmark", ROOT / "benchmark-dictation-candidate.py")
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class ScoringTests(unittest.TestCase):
    def test_equivalent_numbers(self):
        for expected, actual in [
            ("500 milligrams", "five hundred milligrams"),
            ("38.1 Celsius", "thirty eight point one Celsius"),
            ("875/125", "eight hundred seventy five slash one hundred twenty five"),
        ]:
            self.assertEqual(benchmark.score(expected, actual)["word_errors"], 0)

    def test_unit_equivalence_is_separate(self):
        self.assertEqual(benchmark.score("5 milligrams", "5mg")["word_errors"], 1)
        self.assertEqual(benchmark.score("5 milligrams", "5mg", True)["word_errors"], 0)

    def test_clinically_significant_changes_stay_errors(self):
        for expected, actual in [
            ("no chest pain", "chest pain"),
            ("5 milligrams", "50mg"),
            ("5 milligrams", "5 grams"),
            ("38.1", "38.2"),
            ("amlodipine", "amlaudipine"),
            ("875/125", "875125"),
            ("will obtain", "we'll obtain"),
        ]:
            self.assertGreater(benchmark.score(expected, actual, True)["word_errors"], 0)

    def test_original_audio_integrity(self):
        folder = ROOT.parent / "test-fixtures/dictation/001"
        manifest = json.loads((folder / "manifest.json").read_text())
        self.assertEqual(hashlib.sha256((folder / manifest["audio"]).read_bytes()).hexdigest(),
                         manifest["sha256"])


if __name__ == "__main__":
    unittest.main()
