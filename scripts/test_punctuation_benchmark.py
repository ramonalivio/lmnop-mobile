import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("punctuation", Path(__file__).with_name("benchmark-punctuation.py"))
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class PunctuationScoringTests(unittest.TestCase):
    def test_preprocessing_protects_medical_literals(self):
        text = "Temperature 38.1 Celsius. Amoxicillin-clavulanate 875/125 mg, 95%."
        self.assertEqual(benchmark.strip_sentence_punctuation(text),
                         "temperature 38.1 celsius amoxicillin-clavulanate 875/125 mg 95%")

    def test_words_preserve_numbers_negations_and_dose_separators(self):
        for source, changed in [("No pain", "Pain"), ("5 mg", "50 mg"),
                                ("38.1", "381"), ("875/125", "875125")]:
            self.assertNotEqual(benchmark.words(source), benchmark.words(changed))

    def test_identical_punctuation_scores_one(self):
        result = benchmark.score("No pain. Fever, cough.", "No pain. Fever, cough.")
        self.assertEqual(result["punctuation_f1"], 1)
        self.assertEqual(result["punctuation_tp"], 3)

    def test_duplicate_and_misplaced_punctuation_is_penalized(self):
        self.assertLess(benchmark.score("Type 2 diabetes.", "Type 2. diabetes.")["punctuation_f1"], 1)
        self.assertLess(benchmark.score("No pain.", "No pain.,")["punctuation_f1"], 1)

    def test_word_preservation_does_not_imply_semantic_safety(self):
        original = "No acute distress."
        unsafe = "NO. Acute distress."
        self.assertEqual(benchmark.words(original), benchmark.words(unsafe))
        self.assertLess(benchmark.score(original, unsafe)["punctuation_f1"], 1)


if __name__ == "__main__":
    unittest.main()
