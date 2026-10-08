# LMNOP mobile — unreleased sample project

LMNOP is a personal sample project I built to explore a health-document workspace. This repository is a public code sample from its React Native iOS and Android app. The app has not been released to users.

The sample includes mobile screens, dictation and offline speech workflows, transcript editing, native bridge source, and focused tests.

Backend components, credentials, signing files, local recordings, downloaded speech models, compiled libraries, and generated build artifacts are **not** included. Service URLs in this snapshot use `example.invalid`, so this copy will not connect to a service. Some native speech features require separately obtained model/runtime artifacts. This is a code-review sample, not a ready-to-install app.

## Code map

- `App.tsx`, `home/`, `prescription/` — application flows and screens.
- `speech/` — recording, live partial transcription, offline final refinement, transcript editing, and speech profiling.
- `src/` — update and integration helpers.
- `native/`, `ios/`, `android/` — first-party native integration source and project configuration, without compiled models or libraries.
- `__tests__/` — focused React Native and speech workflow tests.

## Validation

With dependencies installed, `npx tsc --noEmit` passes, and `npm test -- --runInBand --forceExit` passes 17 suites and 121 tests in this snapshot. Historical tests for retired online speech behavior, older model-download assumptions, and private build tooling are omitted. The original private project remains untouched.

This snapshot contains no patient records or voice recordings.
