"""Local-only candidate evaluation; references are read only after recognition."""
import argparse
import hashlib
import json
import re
import subprocess
import time
import wave
from pathlib import Path

import numpy as np
from whisper_normalizer.english import EnglishTextNormalizer


def score(reference, hypothesis, expand_units=False):
    normalize = EnglishTextNormalizer()
    if expand_units:
        # Scoring equivalence only; preserve the unmodified recognizer output.
        def units(text):
            return re.sub(r"\bmg\b", "milligrams", re.sub(r"(?<=\d)(?=mg\b)", " ", text), flags=re.I)
        reference, hypothesis = units(reference), units(hypothesis)
    # Keep a spoken slash visible instead of merging a combination dose.
    expected = normalize(reference.replace("/", " slash ")).split()
    actual = normalize(hypothesis.replace("/", " slash ")).split()
    matrix = [[0] * (len(actual) + 1) for _ in range(len(expected) + 1)]
    for i in range(len(expected) + 1):
        matrix[i][0] = i
    for j in range(len(actual) + 1):
        matrix[0][j] = j
    for i, word in enumerate(expected, 1):
        for j, other in enumerate(actual, 1):
            matrix[i][j] = min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1,
                               matrix[i - 1][j - 1] + (word != other))
    errors = []
    i, j = len(expected), len(actual)
    while i or j:
        if i and j and matrix[i][j] == matrix[i - 1][j - 1] + (expected[i - 1] != actual[j - 1]):
            if expected[i - 1] != actual[j - 1]:
                errors.append({"expected": expected[i - 1], "actual": actual[j - 1]})
            i, j = i - 1, j - 1
        elif i and matrix[i][j] == matrix[i - 1][j] + 1:
            errors.append({"expected": expected[i - 1], "actual": ""})
            i -= 1
        else:
            errors.append({"expected": "", "actual": actual[j - 1]})
            j -= 1
    return {"normalizer": "whisper-normalizer==0.1.12; slash preserved" +
                         ("; mg=milligrams" if expand_units else ""),
            "reference_words": len(expected), "word_errors": len(errors),
            "wer": len(errors) / max(1, len(expected)),
            "normalized_reference": " ".join(expected),
            "normalized_hypothesis": " ".join(actual), "errors": errors[::-1]}


def moonshine(model, architecture, samples, rate, keyterms=None):
    from moonshine_voice import ModelArch, Transcriber
    from moonshine_voice.transcriber import Error, LineTextChanged
    arch = getattr(ModelArch, architecture.upper() + "_STREAMING")
    events, lines, durations, errors = [], {}, [], []
    audio_time = 0.0

    def listener(event):
        if isinstance(event, Error):
            errors.append(str(event.error))
            return
        lines[event.line.line_id] = event.line
        if isinstance(event, LineTextChanged):
            events.append({"audio_seconds": audio_time, "line_id": event.line.line_id,
                           "text": event.line.text, "complete": event.line.is_complete})

    with Transcriber(str(model), arch, update_interval=0.5) as transcriber:
        if keyterms:
            transcriber.set_keyterms(keyterms)
        with transcriber.create_stream(update_interval=0.5) as stream:
            stream.add_listener(listener)
            stream.start()
            started = time.perf_counter()
            chunk_size = int(rate * 0.1)
            for offset in range(0, len(samples), chunk_size):
                chunk = samples[offset:offset + chunk_size]
                audio_time = (offset + len(chunk)) / rate
                before = time.perf_counter()
                stream.add_audio(chunk.tolist(), rate)
                durations.append(time.perf_counter() - before)
            before = time.perf_counter()
            final = stream.stop()
            final_seconds = time.perf_counter() - before
            elapsed = time.perf_counter() - started
            if final is None:
                raise RuntimeError("Streaming recognizer returned no final transcript")
            if errors:
                raise RuntimeError("; ".join(errors))
            for line in final.lines:
                lines[line.line_id] = line
    ordered = sorted(lines.values(), key=lambda line: (line.start_time, line.line_id))
    return {"text": " ".join(line.text for line in ordered), "decode_seconds": elapsed,
            "finalize_seconds": final_seconds, "updates": events,
            "max_chunk_compute_seconds": max(durations, default=0),
            "mode": "native-streaming", "update_interval_seconds": 0.5}


def whisper(model, samples, rate, wav):
    import sherpa_onnx
    recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=str(next(model.glob("*-encoder.int8.onnx"))),
        decoder=str(next(model.glob("*-decoder.int8.onnx"))),
        tokens=str(next(model.glob("*-tokens.txt"))), num_threads=2,
    )
    # Audio-only boundaries, never reference-aligned sentence cuts.
    detected = subprocess.run(["ffmpeg", "-nostdin", "-i", str(wav), "-af",
                               "silencedetect=noise=-40dB:d=0.4", "-f", "null", "-"],
                              capture_output=True, text=True, check=True)
    silences = re.findall(r"silence_end: ([\d.]+) \| silence_duration: ([\d.]+)", detected.stderr)
    candidates = [float(end) - float(duration) / 2 for end, duration in silences]
    total = len(samples) / rate
    boundaries = [0.0]
    while total - boundaries[-1] > 25:
        available = [t for t in candidates if boundaries[-1] + 5 < t <= boundaries[-1] + 25]
        boundaries.append(max(available) if available else boundaries[-1] + 25)
    boundaries.append(total)
    segments = []
    started = time.perf_counter()
    for start, end in zip(boundaries, boundaries[1:]):
        stream = recognizer.create_stream()
        stream.accept_waveform(rate, samples[round(start * rate):round(end * rate)])
        recognizer.decode_stream(stream)
        segments.append({"start": start, "end": end, "text": stream.result.text})
    return {"text": " ".join(s["text"] for s in segments),
            "decode_seconds": time.perf_counter() - started, "segments": segments,
            "mode": "offline-segmented-accuracy-only"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--backend", choices=["moonshine", "whisper"], required=True)
    parser.add_argument("--architecture", choices=["tiny", "small", "medium"], default="small")
    parser.add_argument("--reference-file", type=Path, required=True)
    parser.add_argument("--keyterms", type=Path)
    args = parser.parse_args()
    with wave.open(str(args.wav)) as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000:
            raise ValueError("Use mono 16 kHz PCM16 WAV")
        rate = audio.getframerate()
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768
    if args.backend == "moonshine":
        keyterms = json.loads(args.keyterms.read_text()) if args.keyterms else None
        if keyterms is not None and (not isinstance(keyterms, list) or
                                    not all(isinstance(term, str) for term in keyterms)):
            parser.error("keyterms must be a JSON array of strings")
        result = moonshine(args.model, args.architecture, samples, rate, keyterms)
    else:
        if args.keyterms:
            parser.error("keyterms are supported only for the Moonshine experiment")
        result = whisper(args.model, samples, rate, args.wav)
    reference = args.reference_file.read_text()
    result.update({"backend": args.backend, "model": str(args.model),
                   "keyterms": str(args.keyterms) if args.keyterms else None,
                   "wav_sha256": hashlib.sha256(args.wav.read_bytes()).hexdigest(),
                   "audio_seconds": len(samples) / rate,
                   "real_time_factor": result["decode_seconds"] / (len(samples) / rate),
                   "unit_equivalent_score": score(reference, result["text"], expand_units=True),
                   **score(reference, result["text"])})
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
