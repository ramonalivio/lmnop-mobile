# Android Parakeet ONNX bridge

Pinned parakeet-rs TDT 0.3.8 (commit in Cargo.toml), ONNX Runtime 1.28.0,
CPU with four intra-op threads and one inter-op thread. Kotlin serializes all
session operations. Rust catches panics at the C ABI; JNI transfers JSON as
UTF-8. Report nativeMs covers feature extraction and transcription, not model
loading or React Native bridge overhead. TDT's API has no language hint.

Build prerequisites: Rust with aarch64-linux-android target, Python 3, NDK
27.1.12297006 (or ANDROID_NDK_ROOT). Gradle runs
`scripts/build-parakeet-onnx.py`, which downloads the official ORT Android AAR,
checks the extracted library's SHA-256, changes its ELF SONAME to
liblmnop_ort.so, and builds the release Rust cdylib. The distinct SONAME keeps
it separate from the live recognizer's libonnxruntime.so. No upstream inference
code is patched. Cargo.lock pins the dependency resolution.

Direct native dependency linking replaces the benchmark's dlopen loading.
Two sessions were opened, transcribed and released on the Android phone; the
process exited zero after normal C++/Rust cleanup. The earlier dynamically
loaded benchmark aborted after model release at process exit. Evidence:
`experiments/parakeet-android-performance/onnx-linked-cleanup.txt`.

Model downloads are pinned and hash-verified by speech/parakeetOnnxManifest.json
and speech/parakeetModel.ts. Keep the three TDT files and standalone silero_vad.onnx together; the model path passed
to Rust is the directory. The old GGUF files are not automatically deleted.

Upstream provenance/licenses: parakeet-rs MIT OR Apache-2.0; ONNX Runtime MIT;
model export istupakov/parakeet-tdt-0.6b-v3-onnx CC-BY-4.0, derived from
NVIDIA Parakeet TDT 0.6B v3. See each upstream repository for license text.

## Standalone VAD

`src/vad.rs` uses the same privately named ORT, in its own one-thread ONNX
session and separate Kotlin executor. Silero's recurrent state and 64-sample
context are reset at each new recording, then carried over 512-sample (32 ms)
frames. Voice thresholds are 0.5 to start and 0.35 while active. The 400 ms
endpoint is owned by the audio-clock JS segmenter, not by TDT. Silero is MIT;
its pinned source and SHA-256 are in the model manifest.

`DictationAudio.startSession` emits tagged 32 ms PCM frames and an end marker
after joining the reader. `PauseDictationSession` waits for that marker before
flushing VAD. TDT remains resident through phrases and subsequent recordings
until screen disposal. No Moonshine, Zipformer, or text model is invoked by
this offline route. Other existing transcription modes remain separate.
