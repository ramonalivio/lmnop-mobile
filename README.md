# LMNOP mobile app — public source snapshot

This repository shows the React Native iOS and Android app I built for LMNOP, a personal health-document workspace. It includes the mobile screens, dictation and offline speech workflows, transcript editing, native bridge source, and focused tests.

The production backend, credentials, signing files, local recordings, downloaded speech models, compiled libraries, and generated build artifacts are **not** included. Service URLs in this snapshot use `example.invalid`, so this copy will not connect to the live service. Some native speech features require separately obtained model/runtime artifacts; this is a code-review sample rather than a turnkey release build.

## Code map

- `App.tsx`, `home/`, `prescription/` — application flows and screens.
- `speech/` — recording, live partial transcription, offline final refinement, transcript editing, and speech profiling.
- `src/` — update and integration helpers.
- `native/`, `ios/`, `android/` — first-party native integration source and project configuration, without compiled models or libraries.
- `__tests__/` — focused React Native and speech workflow tests.

## Validation

With dependencies installed, `npx tsc --noEmit` passes, and `npm test -- --runInBand --forceExit` passes 17 suites and 121 tests in this snapshot. Historical tests for retired online speech behavior, older model-download assumptions, and private release tooling are omitted. The original private project remains untouched.

This snapshot contains no patient records or voice recordings.
