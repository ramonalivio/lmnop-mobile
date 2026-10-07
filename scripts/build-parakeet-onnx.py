#!/usr/bin/env python3
"""Build ARM64 Rust bridge and privately named ORT; requires Rust Android target."""
import hashlib, os, pathlib, shutil, struct, subprocess, urllib.request, zipfile
root = pathlib.Path(__file__).resolve().parents[1]
work = root / 'android/app/build/parakeet-onnx'
work.mkdir(parents=True, exist_ok=True)
ort = work / 'ort'
ort.mkdir(exist_ok=True)
lib = ort / 'libonnxruntime.so'
expected = 'f826d8efb03adf0a84f10e7ba408f9d4cd11b0a2ccd8d08aeb0f7451fb50cacc'
# Keep upstream bytes separately; never modify another recognizer's runtime.
original = ort / 'upstream.so'
if not original.exists() or hashlib.sha256(original.read_bytes()).hexdigest() != expected:
    aar = work / 'onnxruntime-android-1.28.0.aar'
    urllib.request.urlretrieve('https://repo.maven.apache.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/1.28.0/onnxruntime-android-1.28.0.aar', aar)
    with zipfile.ZipFile(aar) as z:
        original.write_bytes(z.read('jni/arm64-v8a/libonnxruntime.so'))
    if hashlib.sha256(original.read_bytes()).hexdigest() != expected:
        raise RuntimeError('ONNX Runtime checksum mismatch')
data = bytearray(original.read_bytes())
assert data[:6] == b'\x7fELF\x02\x01'
# Locate DT_SONAME through the ELF64 section table and its linked string table.
shoff = struct.unpack_from('<Q', data, 40)[0]
entsize, count = struct.unpack_from('<HH', data, 58)
sections = [struct.unpack_from('<IIQQQQIIQQ', data, shoff+i*entsize) for i in range(count)]
patched = False
for s in sections:
    if s[1] != 6: continue
    strings = sections[s[6]]
    for offset in range(s[4], s[4]+s[5], 16):
        tag, value = struct.unpack_from('<qQ', data, offset)
        if tag != 14: continue
        start = strings[4]+value
        end = data.index(0, start)
        assert data[start:end] == b'libonnxruntime.so'
        name = b'liblmnop_ort.so'
        assert len(name) <= end-start
        data[start:end] = name + b'\0'*(end-start-len(name))
        patched = True
assert patched
lib.write_bytes(data)
env = os.environ.copy()
ndk = pathlib.Path(env.get('ANDROID_NDK_ROOT', pathlib.Path.home()/'Library/Android/sdk/ndk/27.1.12297006'))
bin_dir = ndk/'toolchains/llvm/prebuilt/darwin-x86_64/bin'
env.update(CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=str(bin_dir/'aarch64-linux-android28-clang'),
           CC_aarch64_linux_android=str(bin_dir/'aarch64-linux-android28-clang'),
           AR_aarch64_linux_android=str(bin_dir/'llvm-ar'),
           ORT_LIB_LOCATION=str(ort), ORT_PREFER_DYNAMIC_LINK='1',
           CARGO_TARGET_DIR=str(work/'target'))
manifest = root/'native/parakeet-onnx/Cargo.toml'
subprocess.run(['cargo','build','--locked','--release','--target','aarch64-linux-android','--manifest-path',str(manifest)],env=env,check=True)
out = root/'android/app/src/main/jniLibs/arm64-v8a'
out.mkdir(parents=True, exist_ok=True)
shutil.copy2(lib,out/'liblmnop_ort.so')
shutil.copy2(work/'target/aarch64-linux-android/release/liblmnop_parakeet_onnx.so',out)
