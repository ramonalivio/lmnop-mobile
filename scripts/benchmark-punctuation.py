"""Local-only punctuation benchmark; reference text is used for scoring, never hints."""
import argparse
import difflib
import hashlib
import json
import platform
import re
import statistics
import time
from pathlib import Path

TOKEN = re.compile(r"\w+(?:[./'%-]\w+)*|%", re.UNICODE)


def words(text):
    return [match.group().lower() for match in TOKEN.finditer(text)]


def strip_sentence_punctuation(text):
    # Preserve decimals, dose slashes, hyphens and apostrophes.
    text = re.sub(r"(?<!\d)\.|\.(?!\d)|[,!?;:]", "", text)
    return " ".join(text.lower().split())


def boundaries(text):
    matches = list(TOKEN.finditer(text))
    result = {}
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        marks = "".join(re.findall(r"[.,!?;:]", text[match.end():end]))
        if marks:
            result[i] = marks
    return result


def score(expected, actual):
    reference_words, actual_words = words(expected), words(actual)
    mapping = {}
    for block in difflib.SequenceMatcher(None, reference_words, actual_words, autojunk=False).get_matching_blocks():
        for offset in range(block.size):
            mapping[block.b + offset] = block.a + offset
    gold = set(boundaries(expected).items())
    predicted = {(mapping.get(i, -i - 1), p) for i, p in boundaries(actual).items()}
    tp = len(gold & predicted)
    precision = tp / len(predicted) if predicted else 0
    recall = tp / len(gold) if gold else 0
    return {
        "matched_words": len(mapping), "reference_words": len(reference_words),
        "punctuation_tp": tp, "punctuation_fp": len(predicted - gold),
        "punctuation_fn": len(gold - predicted),
        "punctuation_f1": 2 * precision * recall / (precision + recall) if precision + recall else 0,
    }


def main():
    import sherpa_onnx
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runs", type=int, default=10)
    args = parser.parse_args()
    fixture = Path(__file__).resolve().parents[1] / "test-fixtures/dictation/001"
    reference = (fixture / "reference.txt").read_text().strip()
    recognition = json.loads((fixture / "results/lmnop-case001-moonshine-medium-medical.json").read_text())["text"]
    screenshot = (
        "Will obtain chest x-ray Start amoxicillin clavulanate 875 over 125 milligrams twice "
        "daily For five days if imaging supports pneumonia Encourage fluids and rest. "
        "Patient advised to seek urgent care for worsening shortness of breath Chest pain "
        "Confusion Or persistent high fever"
    )
    # Hand-annotated punctuation target; deliberately leaves the phone's words/numbers unchanged.
    screenshot_expected = (
        "Will obtain chest x-ray. Start amoxicillin clavulanate 875 over 125 milligrams twice "
        "daily for five days if imaging supports pneumonia. Encourage fluids and rest. "
        "Patient advised to seek urgent care for worsening shortness of breath, chest pain, "
        "confusion, or persistent high fever."
    )
    cases = [
        ("case001_reference_unpunctuated", strip_sentence_punctuation(reference), reference),
        ("case001_moonshine_output", recognition, reference),
        ("phone_screenshot", screenshot, screenshot_expected),
        ("clinical_safety_probe", "no chest pain no hemoptysis temperature 38.1 celsius amoxicillin-clavulanate 875/125 mg oxygen saturation 95%", "No chest pain. No hemoptysis. Temperature 38.1 Celsius. Amoxicillin-clavulanate 875/125 mg. Oxygen saturation 95%."),
    ]
    results = {"runtime": sherpa_onnx.__version__, "host": platform.platform(),
               "processor": platform.machine(), "threads": 1, "runs": args.runs,
               "note": "Host text-only inference, not phone latency or a new audio recognition run. Case001 is development data, not held-out validation.",
               "model_files": {}, "results": []}
    for name in ["model.int8.onnx", "model.onnx", "bpe.vocab"]:
        data = (args.model_dir / name).read_bytes()
        results["model_files"][name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    for model in ["model.int8.onnx", "model.onnx"]:
        started = time.perf_counter()
        config = sherpa_onnx.OnlinePunctuationConfig(sherpa_onnx.OnlinePunctuationModelConfig(
            cnn_bilstm=str(args.model_dir / model), bpe_vocab=str(args.model_dir / "bpe.vocab"), num_threads=1))
        punct = sherpa_onnx.OnlinePunctuation(config)
        load_ms = (time.perf_counter() - started) * 1000
        for case, source, expected in cases:
            for mode in ["as_is", "sentence_punctuation_removed"]:
                text = source if mode == "as_is" else strip_sentence_punctuation(source)
                started = time.perf_counter()
                output = punct.add_punctuation_with_case(text)
                first_ms = (time.perf_counter() - started) * 1000
                timings = []
                for _ in range(args.runs):
                    started = time.perf_counter()
                    punct.add_punctuation_with_case(text)
                    timings.append((time.perf_counter() - started) * 1000)
                row = {"case": case, "model": model, "mode": mode, "input": text,
                       "expected": expected, "output": output, "load_ms": load_ms,
                       "first_inference_ms": first_ms, "warm_median_ms": statistics.median(timings),
                       "warm_max_ms": max(timings), "words_preserved": words(source) == words(output),
                       "number_literals_preserved": re.findall(r"\d+(?:[./]\d+)*%?", source) == re.findall(r"\d+(?:[./]\d+)*%?", output),
                       "baseline": score(expected, source), "restored": score(expected, output)}
                results["results"].append(row)
                print(model, case, mode, "preserved", row["words_preserved"], "F1", round(row["baseline"]["punctuation_f1"], 3), "->", round(row["restored"]["punctuation_f1"], 3), "ms", round(row["warm_median_ms"], 1), flush=True)
                print(output, flush=True)
    args.output.write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    main()
