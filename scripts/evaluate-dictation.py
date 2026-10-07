"""Local model/pipeline comparison. Requires sherpa-onnx and numpy in a venv."""
import argparse
import json
import math
import re
import time
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx


def word_errors(reference, hypothesis):
    expected = re.findall(r"[a-z0-9]+", reference.lower())
    actual = re.findall(r"[a-z0-9]+", hypothesis.lower())
    row = list(range(len(actual) + 1))
    for i, word in enumerate(expected, 1):
        next_row = [i]
        for j, other in enumerate(actual, 1):
            next_row.append(min(next_row[-1] + 1, row[j] + 1,
                                row[j - 1] + (word != other)))
        row = next_row
    return {"word_errors": row[-1], "reference_words": len(expected),
            "wer": row[-1] / max(1, len(expected))}


def evaluate(model, samples, rate, baseline, threads, hotwords="", paths=4, score=1.8, padding=0.66):
    def model_file(prefix):
        candidates = sorted(model.glob(f"{prefix}*.onnx"))
        quantized = [p for p in candidates if ".int8." in p.name]
        if not candidates:
            raise ValueError(f"Missing {prefix} ONNX file in {model}")
        return str((quantized or candidates)[0])

    recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=str(model / "tokens.txt"),
        encoder=model_file("encoder"),
        decoder=model_file("decoder"),
        joiner=model_file("joiner"),
        model_type="zipformer2", num_threads=threads,
        decoding_method="modified_beam_search", max_active_paths=paths,
        enable_endpoint_detection=True, rule1_min_trailing_silence=1.2,
        rule2_min_trailing_silence=0.5, rule3_min_utterance_length=30,
        modeling_unit="bpe", bpe_vocab=str(model / "bpe.vocab") if hotwords else "",
        hotwords_score=score,
    )
    stream = recognizer.create_stream(hotwords)
    segments = []
    start = time.perf_counter()
    for offset in range(0, len(samples), 1024):
        chunk = samples[offset:offset + 1024]
        incoming_rate = rate
        if baseline:
            # Reproduce the previous iOS adapter's chunk-local resampling and AGC.
            ratio = rate / 16000
            positions = np.arange(int(len(chunk) / ratio)) * ratio
            chunk = np.interp(positions, np.arange(len(chunk)), chunk).astype(np.float32)
            incoming_rate = 16000
            if len(chunk):
                peak = max(1e-10, float(np.max(np.abs(chunk))))
                gain = 80 if peak < 0.01 else min(80, 0.8 / peak)
                chunk = np.clip(chunk * gain, -1, 1)
        stream.accept_waveform(incoming_rate, chunk)
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        if recognizer.is_endpoint(stream):
            segments.append(recognizer.get_result(stream))
            recognizer.reset(stream)
    if not baseline:
        stream.accept_waveform(rate, np.zeros(int(rate * padding), dtype=np.float32))
    stream.input_finished()
    while recognizer.is_ready(stream):
        recognizer.decode_stream(stream)
    segments.append(recognizer.get_result(stream))
    return " ".join(s.strip() for s in segments if s.strip()), time.perf_counter() - start


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav", type=Path)
    reference = parser.add_mutually_exclusive_group(required=True)
    reference.add_argument("--reference")
    reference.add_argument("--reference-file", type=Path)
    parser.add_argument("--paths", type=int, default=4)
    parser.add_argument("--score", type=float, default=1.8)
    parser.add_argument("--padding", type=float, default=0.66)
    parser.add_argument("--model", type=Path, default=Path(__file__).resolve().parents[1] /
                        "ios/LmnopMobile/models/sherpa-onnx-streaming-zipformer-en-2023-06-26")
    args = parser.parse_args()
    if args.paths < 1 or not math.isfinite(args.score) or args.score < 0:
        parser.error("paths must be positive and score must be finite and nonnegative")
    if not math.isfinite(args.padding) or not 0 <= args.padding <= 5:
        parser.error("padding must be between zero and five seconds")
    reference_text = args.reference_file.read_text() if args.reference_file else args.reference
    with wave.open(str(args.wav)) as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise ValueError("Use mono PCM16 WAV input")
        rate = audio.getframerate()
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype(np.float32) / 32768
    terminology = Path(__file__).resolve().parents[1] / "speech/medicalTerminology.ts"
    hotword_section = terminology.read_text().split("export const medicalHotwords = [", 1)[1].split("]", 1)[0]
    hotwords = "\n".join(re.findall(r"'([^']+)'", hotword_section)).upper()
    for baseline, threads, bias in [(True, 2, False), (False, 2, False), (False, 2, True)]:
        if bias and not (args.model / "bpe.vocab").exists():
            continue
        text, elapsed = evaluate(args.model, samples, rate, baseline, threads,
                                 hotwords if bias else "", args.paths, args.score, args.padding)
        print(json.dumps({"pipeline": "previous" if baseline else "corrected",
                          "medical_bias": bias,
                          "paths": args.paths, "hotwords_score": args.score,
                          "model": args.model.name, "padding_seconds": 0 if baseline else args.padding,
                          "audio_seconds": len(samples) / rate,
                          "threads": threads, "text": text, "decode_seconds": elapsed,
                          **word_errors(reference_text, text)}), flush=True)


if __name__ == "__main__":
    main()
