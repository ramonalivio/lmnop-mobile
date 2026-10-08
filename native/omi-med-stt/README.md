# Android Omi Med STT runtime

Build with `python3 scripts/build-omi-med-stt.py` from this repository root.
The script downloads source only, pins parakeet.cpp to
`b11fe5bca78ad8b342dd559a43d76df3984bb447` and GGML to
`e705c5fed490514458bdd2eaddc43bd098fcce9b`, and applies Omi's adapter v2 patch
from `Omi-Health/omi-med-stt-runtime` revision
`41689b213622b0bf87cdcd75047b272facec9393`.

The engine is compiled for ARM64 Android 9+, CPU only, four threads. A small
baseline JNI library reads Linux HWCAP flags before loading either the optimized
ARMv8.2 dot-product/FP16 engine or the portable ARMv8 baseline. Static GGML
symbols are hidden inside `liblmnop_omi_med.so` to avoid symbol collisions.
The Kotlin bridge serializes load/decode/free and owns a single model session.
Release destroys both model weights and the persistent GGML compute allocation.
No model weights are included in the APK. The verified downloader uses
`speech/omiMedManifest.json` and a separate Omi cache directory.

The existing local provider key `parakeet` remains stable, while UI and performance
metadata identify Omi. Moonshine remains the live model. Omi is English-only.

Source: https://github.com/Omi-Health/omi-med-stt-runtime
Model: https://huggingface.co/omi-health/omi-med-stt-v1-gguf
Licenses/attribution are shipped in `android/app/src/main/assets/licenses/`.

## iOS

Run `python3 scripts/build-omi-med-ios.py` from this repository root,
then `pod install` in `ios` before building the app. The script builds
private dynamic XCFrameworks for iPhone arm64 and Apple Silicon simulator arm64.
Only the five `lmnop_omi_*` API symbols are exported; GGML stays private. The
Objective-C++ bridge serializes inference, selects the optimized engine when
Apple's CPU feature flags permit it, and releases the model plus scratch buffers.
Both platforms share the same verified, separately downloaded GGUF model pack.
