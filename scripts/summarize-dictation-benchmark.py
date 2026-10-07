"""Preserve local candidate output and score it with a shared reference."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "benchmark", Path(__file__).with_name("benchmark-dictation-candidate.py"))
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path, nargs="+")
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    reference = args.reference.read_text()
    args.output.mkdir(parents=True, exist_ok=True)
    summary = []
    for path in args.results:
        result = json.loads(path.read_text())
        model = Path(result["model"])
        result["model_files"] = {
            file.name: {"bytes": file.stat().st_size,
                        "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
            for file in sorted(model.iterdir()) if file.is_file()
        }
        result.update(benchmark.score(reference, result["text"]))
        result["unit_equivalent_score"] = benchmark.score(reference, result["text"], True)
        (args.output / path.name).write_text(json.dumps(result, indent=2) + "\n")
        (args.output / (path.stem + ".txt")).write_text(result["text"] + "\n")
        summary.append({"file": path.name, "model": result["model"],
                        "mode": result["mode"], "keyterms": result.get("keyterms"),
                        "word_errors": result["word_errors"],
                        "unit_equivalent_errors": result["unit_equivalent_score"]["word_errors"],
                        "reference_words": result["reference_words"],
                        "decode_seconds": result["decode_seconds"],
                        "live_updates": len(result.get("updates", []))})
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
