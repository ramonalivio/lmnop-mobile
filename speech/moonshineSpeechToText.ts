import { OmiMedFinalPass } from './omiMedFinalPass';
import { createDictationPcmStream } from './dictationPcm';
import type { RefinementOptions } from './refinementOptions';
import { NativeModules } from 'react-native';
import { requestDictationMicrophonePermission } from './microphonePermission';
import { type PcmLiveStreamHandle } from 'react-native-sherpa-onnx/audio';
import clinicalKeyterms from '../test-fixtures/dictation/clinical-keyterms.json';
import { normalizeClinicalText } from './normalizeClinicalText';
import { finishDictationSentence } from './finishDictationSentence';
import { SpeechProfiler, speechProfileNow } from './speechProfiler';
import type {
  SpeechTranscript,
  SpeechToTextCallbacks,
} from './speechTypes';

type MoonshineBridge = {
  prepare: (keyterms: string[]) => Promise<void>;
  start: () => Promise<void>;
  process: (
    samples: number[],
    sampleRate: number,
  ) => Promise<SpeechTranscript | null>;
  finish: () => Promise<SpeechTranscript>;
  dispose: () => Promise<void>;
};

export class MoonshineSpeechToTextSession {
  private bridge = NativeModules.MoonshineSpeech as MoonshineBridge | undefined;
  private ready: Promise<void> | null = null;
  private starting: Promise<void> | null = null;
  private stopping: Promise<SpeechTranscript> | null = null;
  private disposing: Promise<SpeechTranscript> | null = null;
  private disposed = false;
  private nativeStarted = false;
  private pcm: PcmLiveStreamHandle | null = null;
  private subscriptions: Array<() => void> = [];
  private processing = Promise.resolve();
  private captureError: Error | null = null;
  private callbacks: SpeechToTextCallbacks | null = null;
  private prefix = '';
  private protectedPrefix = '';
  private profiler = new SpeechProfiler();
  private lastLevelAt = -Infinity;
  private firstText = false;
  private recordingStartedAt = 0;
  private audioSeconds = 0;
  private finalPass: OmiMedFinalPass;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private limitReached = false;
  private cancelled = false;
  private transcript: SpeechTranscript;

  constructor(
    confirmed = '',
    private refineOnStop = false,
    private profileTogether = false,
    private accumulatedReview = false,
    private normalizeFinal = false,
    private refinement?: RefinementOptions,
  ) {
    this.finalPass = new OmiMedFinalPass();
    this.transcript = { confirmed, provisional: '' };
    this.protectedPrefix = confirmed;
  }

  setRefinementProvider(provider: 'parakeet') {
    if (this.disposed || this.starting || this.nativeStarted) return;
    if (this.refinement?.provider === provider) return;
    this.refinement = { ...this.refinement, provider };
    const next = new OmiMedFinalPass();
    const previous = this.finalPass;
    this.finalPass = next;
    previous.cancel().catch(() => undefined);
    previous.clear();
  }

  private profileDetails() {
    return {
      model:
        this.refineOnStop
          ? 'Moonshine Medium Streaming + Omi Med STT v1 Q8_0 GGUF CPU'
          : 'Moonshine Medium Streaming',
      runtime:
        this.refineOnStop
          ? 'moonshine-native + parakeet.cpp + Omi adapter / GGML CPU'
          : 'moonshine-native',
    };
  }

  prepare() {
    if (this.disposed) {
      return Promise.reject(new Error('Speech session has been disposed.'));
    }
    if (!this.bridge) {
      return Promise.reject(
        new Error('Moonshine native module is missing. Rebuild the app.'),
      );
    }
    this.ready ??= this.profiler
      .begin()
      .then(async () => {
        this.profiler.mark('model-load', this.profileDetails());
        const started = speechProfileNow();
        await this.bridge!.prepare(clinicalKeyterms);
        this.profiler.mark('model-ready', {
          elapsedMs: speechProfileNow() - started,
        });
      })
      .catch((error) => {
        this.ready = null;
        throw error;
      });
    return this.ready;
  }

  start(callbacks: SpeechToTextCallbacks) {
    if (this.disposed) {
      return Promise.reject(new Error('Speech session has been disposed.'));
    }
    if (!this.starting) {
      this.stopping = null;
      this.captureError = null;
      this.cancelled = false;
      this.firstText = false;
      this.lastLevelAt = -Infinity;
      this.audioSeconds = 0;
      this.limitReached = false;
      this.processing = Promise.resolve();
      if (!this.accumulatedReview || this.finalPass.failed) {
        this.finalPass.clear();
        this.protectedPrefix = this.transcript.confirmed;
      }
      this.finalPass.resume();
      this.prefix = this.transcript.confirmed;
      this.callbacks = callbacks;
      this.starting = this.startCapture().then(() => {
        if (!this.nativeStarted) this.starting = null;
      });
    }
    return this.starting;
  }

  private async startCapture() {
    this.profiler.configure({ ...this.profileDetails(), omiLoadMs: undefined });
    this.callbacks?.onStatus('initializing');
    try {
      const granted = await requestDictationMicrophonePermission();
      if (!granted) {
        this.callbacks?.onStatus('permission-denied');
        return;
      }
      if (this.disposed) return;
      await this.prepare();
      if (this.disposed) return;
      if (this.refineOnStop) {
        this.callbacks?.onActivity?.('Loading Omi Med STT…');
        await this.finalPass.prepare(this.profiler);
        if (this.disposed || this.cancelled) return;
      }
      await this.bridge!.start();
      this.nativeStarted = true;
      this.recordingStartedAt = speechProfileNow();
      this.profiler.recordingPrefix(this.prefix);
      this.profiler.mark('recording');
      if (this.refineOnStop && this.profileTogether)
        this.profiler.mark('both-models-recording');
      this.pcm = createDictationPcmStream();
      this.subscriptions = [
        this.pcm.onData((samples, sampleRate) => {
          if (this.disposed || this.captureError) return;
          const remaining = Math.max(
            0,
            Math.round((60 - this.audioSeconds) * sampleRate),
          );
          samples = samples.subarray(0, remaining);
          if (!samples.length) {
            this.reachLimit();
            return;
          }
          this.audioSeconds += samples.length / sampleRate;
          this.profiler.capture(samples, sampleRate);
          if (this.refineOnStop) this.finalPass.append(samples, sampleRate);
          const now = speechProfileNow();
          if (now - this.lastLevelAt >= 100) {
            this.lastLevelAt = now;
            let sum = 0;
            for (const sample of samples) sum += sample * sample;
            const rms = Math.sqrt(sum / Math.max(1, samples.length));
            this.callbacks?.onAudioLevel?.(
              Math.min(
                1,
                Math.max(
                  0,
                  (20 * Math.log10(Math.max(rms, 0.000001)) + 60) / 60,
                ),
              ),
            );
          }
          this.processing = this.processing
            .then(async () => {
              if (this.captureError) return;
              const result = await this.bridge!.process(
                Array.from(samples),
                sampleRate,
              );
              if (result) this.publish(result);
            })
            .catch((error) => this.fail(error));
          if (this.audioSeconds >= 60) this.reachLimit();
        }),
        this.pcm.onError((message) => this.fail(new Error(message))),
      ];
      await this.pcm.start();
      if (!this.captureError) {
        this.callbacks?.onStatus('listening');
        if (!this.stopping)
          this.limitTimer = setTimeout(() => this.reachLimit(), 60000);
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private reachLimit() {
    if (this.limitReached) return;
    this.limitReached = true;
    if (this.callbacks?.onRecordingLimit) this.callbacks.onRecordingLimit();
    else this.stop().catch(() => undefined);
  }

  private fail(error: unknown) {
    if (this.captureError) return;
    this.captureError =
      error instanceof Error ? error : new Error(String(error));
    this.callbacks?.onStatus(
      this.captureError.message.toLowerCase().includes('missing')
        ? 'model-missing'
        : 'error',
    );
    this.callbacks?.onError(this.captureError.message);
    // Stop capture on failures as well as on button release.
    this.stop().catch(() => undefined);
  }

  private publish(snapshot: SpeechTranscript, final = false) {
    if (this.disposed) return;
    if (
      !final &&
      !this.firstText &&
      (snapshot.confirmed || snapshot.provisional)
    ) {
      this.firstText = true;
      this.profiler.mark('first-live-text', {
        elapsedMs: speechProfileNow() - this.recordingStartedAt,
        audioSeconds: this.audioSeconds,
      });
    }
    const confirmed = final
      ? finishDictationSentence(
          normalizeClinicalText(
            [snapshot.confirmed, snapshot.provisional]
              .filter(Boolean)
              .join(' '),
          ),
        )
      : snapshot.confirmed;
    const next = {
      confirmed: [this.prefix, confirmed].filter(Boolean).join(' '),
      provisional: final ? '' : snapshot.provisional,
      ...((this.accumulatedReview || this.normalizeFinal) && this.refineOnStop
        ? {
            pendingFrom: this.transcript.pendingFrom ?? this.prefix.length,
          }
        : {}),
    };
    if (
      next.confirmed !== this.transcript.confirmed ||
      next.provisional !== this.transcript.provisional
    ) {
      this.transcript = next;
      this.callbacks?.onTranscript({ ...next });
    }
  }

  async cancel() {
    this.cancelled = true;
    this.callbacks?.onActivity?.('Cancelling final transcription…');
    const stopped = this.stop();
    await this.finalPass.cancel().catch(() => undefined);
    return stopped;
  }

  stop() {
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    if (!this.starting) return Promise.resolve({ ...this.transcript });
    if (!this.stopping) this.profiler.mark('stop-requested');
    this.stopping ??= this.finish();
    return this.stopping;
  }

  private async finish() {
    const started = speechProfileNow();
    await this.starting;
    try {
      if (this.nativeStarted && !this.captureError)
        this.callbacks?.onStatus('finalizing');
      try {
        await this.pcm?.stop();
      } finally {
        this.unsubscribe();
      }
      await this.processing;
      if (this.nativeStarted) {
        const final = await this.bridge!.finish();
        this.publish(final, true);
        this.profiler.result(
          this.transcript.confirmed.slice(this.prefix.length).trim(),
        );
        if (
          this.refineOnStop &&
          !this.disposed &&
          !this.cancelled &&
          !this.captureError &&
          this.finalPass.hasAudio
        ) {
          try {
            this.callbacks?.onStatus('refining');
            if (this.profileTogether) {
              this.profiler.mark('both-models-finalizing');
            } else {
              this.ready = null;
              this.profiler.mark('moonshine-model-release');
              await this.bridge!.dispose();
              this.profiler.mark('moonshine-model-released');
            }
            const refined = await this.finalPass.transcribe(
              this.profiler,
              (message) => {
                if (!this.disposed && !this.cancelled)
                  this.callbacks?.onActivity?.(message);
              },
              this.accumulatedReview ? this.protectedPrefix : this.prefix,
              this.profileTogether,
              this.normalizeFinal,
            );
            if (!this.disposed && !this.cancelled && refined.trim()) {
              if (this.accumulatedReview || this.normalizeFinal) {
                this.transcript = {
                  confirmed: [
                    this.accumulatedReview ? this.protectedPrefix : this.prefix,
                    finishDictationSentence(refined),
                  ]
                    .filter(Boolean)
                    .join(' '),
                  provisional: '',
                };
                this.callbacks?.onTranscript({ ...this.transcript });
              } else {
                this.publish({ confirmed: refined, provisional: '' }, true);
              }
            }
          } catch (error) {
            this.profiler.failure(String(error));
            if (!this.disposed && !this.cancelled)
              this.callbacks?.onError(
                `Refinement failed; live transcript retained. ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
          }
        }
      }
      if (this.captureError) throw this.captureError;
      return { ...this.transcript };
    } catch (error) {
      this.captureError =
        error instanceof Error ? error : new Error(String(error));
      this.callbacks?.onStatus('error');
      this.callbacks?.onError(this.captureError.message);
      throw this.captureError;
    } finally {
      if (!this.profileTogether) await this.finalPass.release(this.profiler);
      this.profiler.mark(
        this.cancelled || this.disposed
          ? 'recording-cancelled'
          : 'recording-ended',
        {
          elapsedMs: speechProfileNow() - started,
          audioSeconds: this.audioSeconds,
          success: !this.captureError,
        },
      );
      await this.profiler
        .finishRecording(
          this.transcript.confirmed,
          !this.captureError && !this.cancelled && !this.disposed,
        )
        .catch(() =>
          this.callbacks?.onError(
            'Could not save the recording for the performance report.',
          ),
        );
      this.profiler.checkpoint();
      this.callbacks?.onActivity?.('');
      this.callbacks?.onAudioLevel?.(0);
      if (!this.accumulatedReview) this.finalPass.clear();
      this.unsubscribe();
      // A native finish error must not leave a stream alive for the next press.
      try {
        if (this.captureError) {
          this.ready = null;
          await this.bridge?.dispose();
        }
      } finally {
        this.nativeStarted = false;
        this.pcm = null;
        this.starting = null;
      }
    }
  }

  private unsubscribe() {
    this.subscriptions.forEach((remove) => remove());
    this.subscriptions = [];
  }

  clear() {
    if (this.starting) return;
    this.finalPass.clear();
    this.protectedPrefix = '';
    this.transcript = { confirmed: '', provisional: '' };
  }

  setText(confirmed: string) {
    if (!this.starting && confirmed !== this.transcript.confirmed) {
      this.transcript = { confirmed, provisional: '' };
      this.protectedPrefix = confirmed;
      this.finalPass.clear();
    }
  }

  dispose() {
    this.disposed = true;
    this.disposing ??= (async () => {
      try {
        await this.finalPass.cancel().catch(() => undefined);
        return await this.stop();
      } finally {
        await this.ready?.catch(() => undefined);
        this.profiler.mark('model-release');
        try {
          await this.finalPass.release(this.profiler);
          this.finalPass.clear();
          await this.bridge?.dispose();
        } finally {
          this.ready = null;
          this.profiler.mark('model-released');
          await this.profiler.end();
        }
      }
    })();
    return this.disposing;
  }
}
