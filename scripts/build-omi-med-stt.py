#!/usr/bin/env python3
"""Build Omi's pinned CPU runtime for Android arm64. Never downloads weights."""
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'android/app/build/omi-med-stt'
SOURCE = WORK / 'source'
COMMIT = 'b11fe5bca78ad8b342dd559a43d76df3984bb447'
GGML_COMMIT = 'e705c5fed490514458bdd2eaddc43bd098fcce9b'
NATIVE = ROOT / 'native/omi-med-stt'

def run(*args, cwd=None):
    subprocess.run([str(arg) for arg in args], cwd=cwd, check=True)

WORK.mkdir(parents=True, exist_ok=True)
if not SOURCE.exists():
    run('git', 'clone', 'https://github.com/mudler/parakeet.cpp.git', SOURCE)
    run('git', 'checkout', COMMIT, cwd=SOURCE)
    run('git', 'submodule', 'update', '--init', '--recursive', cwd=SOURCE)
for repo, revision in [(SOURCE, COMMIT), (SOURCE / 'third_party/ggml', GGML_COMMIT)]:
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    if actual != revision:
        raise RuntimeError(f'Unexpected source revision in {repo}: {actual}')
patch = NATIVE / 'omi-adapter.patch'
applied = subprocess.run(['git', 'apply', '--reverse', '--check', str(patch)], cwd=SOURCE, capture_output=True)
if applied.returncode:
    run('git', 'apply', '--check', patch, cwd=SOURCE)
    run('git', 'apply', patch, cwd=SOURCE)

sdk = Path(os.environ.get('ANDROID_HOME', Path.home() / 'Library/Android/sdk'))
ndk = Path(os.environ.get('ANDROID_NDK_ROOT', sdk / 'ndk/27.1.12297006'))
cmake = sdk / 'cmake/3.22.1/bin/cmake'
out = ROOT / 'android/app/src/main/jniLibs/arm64-v8a'
out.mkdir(parents=True, exist_ok=True)
for variant, arch, name in [('build', 'armv8-a', 'lmnop_omi_med'),
                            ('build-fast', 'armv8.2-a+dotprod+fp16', 'lmnop_omi_med_fast')]:
    build = WORK / variant
    run(cmake, '-S', NATIVE, '-B', build, '-G', 'Ninja',
        f'-DCMAKE_MAKE_PROGRAM={sdk}/cmake/3.22.1/bin/ninja',
        f'-DCMAKE_TOOLCHAIN_FILE={ndk}/build/cmake/android.toolchain.cmake',
        '-DANDROID_ABI=arm64-v8a', '-DANDROID_PLATFORM=android-28',
        '-DANDROID_STL=c++_shared', '-DCMAKE_BUILD_TYPE=Release',
        f'-DGGML_CPU_ARM_ARCH={arch}', f'-DOMI_LIBRARY_NAME={name}',
        f'-DOMI_ENGINE_SOURCE={SOURCE}')
    run(cmake, '--build', build, '--target', 'lmnop_omi_med', 'lmnop_omi_med_cpu', '-j', '6')
    shutil.copy2(build / f'lib{name}.so', out / f'lib{name}.so')
    shutil.copy2(build / 'liblmnop_omi_med_cpu.so', out / 'liblmnop_omi_med_cpu.so')
