#!/usr/bin/env python3
"""Build private iOS CPU frameworks. Source-only downloads; no model weights."""
from pathlib import Path
import plistlib
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'ios/build/omi-med-stt'
SOURCE = WORK / 'source'
NATIVE = ROOT / 'native/omi-med-stt'
COMMIT = 'b11fe5bca78ad8b342dd559a43d76df3984bb447'
GGML_COMMIT = 'e705c5fed490514458bdd2eaddc43bd098fcce9b'
def run(*args, cwd=None):
    subprocess.run([str(x) for x in args], cwd=cwd, check=True)
WORK.mkdir(parents=True, exist_ok=True)
if not SOURCE.exists():
    android_source = ROOT / 'android/app/build/omi-med-stt/source'
    if android_source.exists():
        shutil.copytree(android_source, SOURCE)
    else:
        run('git', 'clone', 'https://github.com/mudler/parakeet.cpp.git', SOURCE)
        run('git', 'checkout', COMMIT, cwd=SOURCE)
        run('git', 'submodule', 'update', '--init', '--recursive', cwd=SOURCE)
for repo, revision in [(SOURCE, COMMIT), (SOURCE / 'third_party/ggml', GGML_COMMIT)]:
    if subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip() != revision:
        raise RuntimeError(f'Unexpected source revision in {repo}')
patch = NATIVE / 'omi-adapter.patch'
if subprocess.run(['git', 'apply', '--reverse', '--check', str(patch)], cwd=SOURCE, capture_output=True).returncode:
    run('git', 'apply', '--check', patch, cwd=SOURCE)
    run('git', 'apply', patch, cwd=SOURCE)
output = NATIVE / 'Frameworks'
output.mkdir(exist_ok=True)
for name, arch in [('OmiMedEngine', 'armv8-a'), ('OmiMedEngineFast', 'armv8.2-a+dotprod+fp16')]:
    frameworks = []
    for sdk in ['iphoneos', 'iphonesimulator']:
        build = WORK / f'{name}-{sdk}'
        run('cmake', '-S', NATIVE / 'ios', '-B', build,
            '-DCMAKE_SYSTEM_NAME=iOS', f'-DCMAKE_OSX_SYSROOT={sdk}',
            '-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=15.1',
            '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO',
            f'-DOMI_ENGINE_SOURCE={SOURCE}', f'-DOMI_FRAMEWORK_NAME={name}',
            f'-DGGML_CPU_ARM_ARCH={arch}')
        run('cmake', '--build', build, '--target', name, '-j', '6')
        frameworks += ['-framework', build / f'{name}.framework']
    destination = output / f'{name}.xcframework'
    if destination.exists(): shutil.rmtree(destination)
    run('xcodebuild', '-create-xcframework', *frameworks, '-output', destination)

    with (destination / 'Info.plist').open('rb') as stream:
        xcframework_info = plistlib.load(stream)
    for library in xcframework_info['AvailableLibraries']:
        framework_info_path = destination / library['LibraryIdentifier'] / library['LibraryPath'] / 'Info.plist'
        with framework_info_path.open('rb') as stream:
            framework_info = plistlib.load(stream)
        framework_info['MinimumOSVersion'] = '15.1'
        with framework_info_path.open('wb') as stream:
            plistlib.dump(framework_info, stream)
