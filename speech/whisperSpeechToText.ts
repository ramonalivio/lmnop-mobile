import { getOfflineModelPath } from './offlineModel';
import { NativeModules } from 'react-native';
import { initWhisper, type WhisperContext } from 'whisper.rn/index';
import {
  createPcmLiveStream,
  type PcmLiveStreamHandle,
} from 'react-native-sherpa-onnx/audio';
import clinicalKeyterms from '../test-fixtures/dictation/clinical-keyterms.json';
import { SpeechProfiler, speechProfileNow } from './speechProfiler';
import { normalizeClinicalText } from './normalizeClinicalText';
import { WhisperAudio, hasSpeechEnergy, whisperPcm16 } from './whisperAudio';
import type {
  SpeechTranscript,
  ZipformerSpeechToTextCallbacks,
} from './zipformerSpeechToText';

export class WhisperSpeechToTextSession {
  private ready: Promise<WhisperContext> | null = null;
  private starting: Promise<void> | null = null;
  private stopping: Promise<SpeechTranscript> | null = null;
  private disposing: Promise<SpeechTranscript> | null = null;
  private disposed = false;
  private ending = false;
  private cancelled = false;
  private accepting = false;
  private pcm: PcmLiveStreamHandle | null = null;
  private subscriptions: Array<() => void> = [];
  private audio = new WhisperAudio();
  private profiler = new SpeechProfiler();
  private recordingIndex = 0;
  private lastLevelAt = -Infinity;
  private decodeIndex = 0;
  private processing: Promise<void> | null = null;
  private activeDecode: ReturnType<WhisperContext['transcribeData']> | null =
    null;
  private activeDecodeEnd = 0;
  private activeDecodeFinal = false;
  private supersededDecode: ReturnType<
    WhisperContext['transcribeData']
  > | null = null;
  private error: Error | null = null;
  private callbacks: ZipformerSpeechToTextCallbacks | null = null;
  private prefix = '';
  private completed: string[] = [];
  private windowStart = 0;
  private decodedUntil = 0;
  private transcript: SpeechTranscript;

  constructor(confirmed = '') {
    this.transcript = { confirmed, provisional: '' };
  }

  prepare() {
    if (this.disposed)
      return Promise.reject(new Error('Speech session has been disposed.'));
    this.ready ??= this.loadModel().catch(error => {
      this.profiler.mark('model-load-error', { success: false });
      this.profiler.checkpoint();
      this.ready = null;
      throw error;
    });
    return this.ready!;
  }

  private async loadModel() {
    await this.profiler.begin();
    this.profiler.mark('model-load', {
      model: 'Whisper Large V3 Q5_0',
      runtime: 'whisper.rn@0.7.4',
    });
    const started = speechProfileNow();
    const context = await initWhisper({
      filePath: await getOfflineModelPath(),
      isBundleAsset: false,
      useGpu: true,
      useFlashAttn: true,
      useCoreMLIos: false,
    });
    this.profiler.mark('model-ready', {
      elapsedMs: speechProfileNow() - started,
      gpu: context.gpu,
      reasonNoGPU: context.reasonNoGPU,
    });
    return context;
  }

  start(callbacks: ZipformerSpeechToTextCallbacks) {
    if (this.disposed)
      return Promise.reject(new Error('Speech session has been disposed.'));
    if (!this.starting) {
      this.callbacks = callbacks;
      this.stopping = null;
      this.ending = false;
      this.cancelled = false;
      this.error = null;
      this.prefix = this.transcript.confirmed;
      this.completed = [];
      this.windowStart = this.decodedUntil = 0;
      this.audio.clear();
      this.recordingIndex++;
      this.lastLevelAt = -Infinity;
      this.starting = this.startCapture();
    }
    return this.starting;
  }

  private async startCapture() {
    this.callbacks?.onStatus('initializing');
    try {
      const granted = await NativeModules.IosMicrophonePermission?.request();
      if (this.disposed) return;
      if (!granted) {
        this.callbacks?.onStatus('permission-denied');
        return;
      }
      await this.prepare();
      if (this.disposed || this.ending) return;
      this.pcm = createPcmLiveStream({ sampleRate: 16000, channelCount: 1 });
      this.accepting = true;
      this.profiler.recordingPrefix(this.prefix);
      this.profiler.mark('recording', { recordingIndex: this.recordingIndex });
      this.subscriptions = [
        this.pcm.onData((samples, rate) => {
          if (!this.accepting || this.disposed || this.error) return;
          try {
            this.audio.append(samples, rate);
            this.profiler.capture(samples, rate);
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
            this.schedule();
          } catch (error) {
            this.fail(error);
          }
        }),
        this.pcm.onError(message => this.fail(new Error(message))),
      ];
      await this.pcm.start();
      if (!this.disposed && !this.ending && !this.error)
        this.callbacks?.onStatus('listening');
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(reason: unknown) {
    if (this.error || this.disposed) return;
    this.error = reason instanceof Error ? reason : new Error(String(reason));
    this.callbacks?.onStatus('error');
    this.callbacks?.onError(this.error.message);
    // Defer until start() has stored its promise, including synchronous failures.
    Promise.resolve()
      .then(() => this.stop())
      .catch(() => undefined);
  }

  private schedule() {
    if (
      this.processing ||
      this.ending ||
      this.disposed ||
      this.error ||
      this.audio.count - this.decodedUntil <
        this.audio.rate * (this.decodedUntil === 0 ? 1 : 2)
    )
      return;
    this.processing = this.decode(false)
      .catch(error => this.fail(error))
      .finally(() => {
        this.processing = null;
        this.schedule();
      });
  }

  private publish(current: string, final = false) {
    if (this.disposed) return;
    const text = [...this.completed, current].filter(Boolean).join(' ');
    const next = final
      ? {
          confirmed: [this.prefix, normalizeClinicalText(text)]
            .filter(Boolean)
            .join(' '),
          provisional: '',
        }
      : { confirmed: this.prefix, provisional: text };
    this.transcript = next;
    this.callbacks?.onTranscript({ ...next });
  }

  private async decode(final: boolean) {
    const context = await this.ready!;
    while (
      !this.disposed &&
      !this.error &&
      !this.cancelled &&
      (final || !this.ending) &&
      this.windowStart < this.audio.count
    ) {
      const { samples, end, full } = this.audio.window(this.windowStart);
      let text = '';
      if (hasSpeechEnergy(samples, this.audio.rate)) {
        const started = speechProfileNow();
        const audioSeconds = samples.length / this.audio.rate;
        const decodeIndex = ++this.decodeIndex;
        let success = false;
        this.profiler.mark(final ? 'final-decode-start' : 'live-decode-start', {
          audioSeconds,
          decodeIndex,
          final,
          recordingIndex: this.recordingIndex,
        });
        const report = () => {
          if (!this.disposed && !this.cancelled)
            this.callbacks?.onActivity?.(
              `Transcribing ${audioSeconds.toFixed(1)}s of audio · ${Math.floor(
                (speechProfileNow() - started) / 1000,
              )}s elapsed${context.gpu ? '' : ' · CPU'}`,
            );
        };
        report();
        const timer = setInterval(report, 1000);
        try {
          this.activeDecodeEnd = end;
          this.activeDecodeFinal = final;
          const task = context.transcribeData(
            whisperPcm16(samples, this.audio.rate),
            {
              language: 'en',
              translate: false,
              maxThreads: 2,
              temperature: 0,
              temperatureInc: 0,
              prompt: clinicalKeyterms.join(', '),
            },
          );
          this.activeDecode = task;
          const result = await task.promise;
          if (this.supersededDecode === task) return;
          if (this.disposed || this.error || this.cancelled) return;
          if (result.isAborted)
            throw new Error('Whisper transcription was interrupted.');
          text = result.result.trim();
          if (final && !text)
            throw new Error(
              'Whisper returned no text; the live transcript was retained.',
            );
          success = true;
        } finally {
          clearInterval(timer);
          if (!this.disposed && !this.cancelled)
            this.callbacks?.onActivity?.('');
          this.callbacks?.onAudioLevel?.(0);
          const elapsedMs = speechProfileNow() - started;
          this.profiler.mark(final ? 'final-decode-end' : 'live-decode-end', {
            audioSeconds,
            decodeIndex,
            final,
            elapsedMs,
            realTimeFactor: elapsedMs / (audioSeconds * 1000),
            success,
          });
          this.activeDecode = null;
          this.supersededDecode = null;
        }
      }
      if (this.disposed || this.error) return;
      this.decodedUntil = end;
      if (full) {
        this.completed.push(text);
        this.windowStart = end;
        this.publish('', final && end === this.audio.count);
        // Complete bounded windows serially; incoming capture keeps accumulating.
        continue;
      }
      this.publish(text, final);
      break;
    }
  }

  async cancel() {
    this.cancelled = true;
    this.callbacks?.onActivity?.('Cancelling transcription…');
    const stopped = this.stop();
    await Promise.resolve(this.activeDecode?.stop()).catch(() => undefined);
    return stopped;
  }

  stop() {
    if (!this.starting) return Promise.resolve({ ...this.transcript });
    if (!this.ending) this.profiler.mark('stop-requested');
    this.ending = true;
    this.stopping ??= this.finish();
    return this.stopping;
  }

  private async finish() {
    await this.starting;
    try {
      if (!this.disposed && !this.error && this.pcm)
        this.callbacks?.onStatus('finalizing');
      try {
        await this.pcm?.stop();
      } finally {
        this.accepting = false;
        this.subscriptions.forEach(remove => remove());
        this.subscriptions = [];
      }
      const stale = this.activeDecode;
      if (
        stale &&
        !this.activeDecodeFinal &&
        this.activeDecodeEnd < this.audio.count &&
        !this.cancelled &&
        !this.disposed &&
        !this.error
      ) {
        this.supersededDecode = stale;
        this.profiler.mark('live-decode-superseded', {
          audioSeconds: this.audio.count / this.audio.rate,
        });
        try {
          await stale.stop();
        } catch {
          // If abort is unavailable, let the existing job finish normally.
          if (this.supersededDecode === stale) this.supersededDecode = null;
        }
      }
      await this.processing;
      if (
        !this.disposed &&
        !this.error &&
        !this.cancelled &&
        this.pcm &&
        !this.audio.count
      )
        throw new Error(
          'No microphone audio was received. Check the simulator audio input and microphone access.',
        );
      if (
        !this.disposed &&
        !this.error &&
        !this.cancelled &&
        this.audio.count
      ) {
        if (this.decodedUntil < this.audio.count) await this.decode(true);
        if (this.windowStart === this.audio.count) this.publish('', true);
      }
      // Keep the latest result on failure or cancellation, without late callbacks.
      if (this.transcript.provisional) {
        this.transcript = {
          confirmed: [
            this.transcript.confirmed,
            normalizeClinicalText(this.transcript.provisional),
          ]
            .filter(Boolean)
            .join(' '),
          provisional: '',
        };
      }
      if (this.error) throw this.error;
      return { ...this.transcript };
    } catch (reason) {
      this.fail(reason);
      throw reason;
    } finally {
      // A microphone-stop failure must also wait for its in-flight decoder.
      await this.processing;
      if (this.transcript.provisional) {
        this.transcript = {
          confirmed: [
            this.transcript.confirmed,
            normalizeClinicalText(this.transcript.provisional),
          ]
            .filter(Boolean)
            .join(' '),
          provisional: '',
        };
        if (!this.disposed)
          this.callbacks?.onTranscript({ ...this.transcript });
      }
      this.profiler.mark(
        this.disposed || this.cancelled
          ? 'recording-cancelled'
          : this.error
          ? 'recording-error'
          : 'recording-ended',
        {
          audioSeconds: this.audio.rate
            ? this.audio.count / this.audio.rate
            : 0,
          recordingIndex: this.recordingIndex,
          success: !this.error && !this.disposed,
        },
      );
      await this.profiler
        .finishRecording(
          this.transcript.confirmed,
          !this.error && !this.cancelled && !this.disposed,
        )
        .catch(() =>
          this.callbacks?.onError(
            'Could not save the recording for the performance report.',
          ),
        );
      this.profiler.checkpoint();
      this.callbacks?.onActivity?.('');
      this.callbacks?.onAudioLevel?.(0);
      this.audio.clear();
      this.pcm = null;
      this.starting = null;
    }
  }

  clear() {
    this.setText('');
  }
  setText(confirmed: string) {
    if (!this.starting) this.transcript = { confirmed, provisional: '' };
  }

  dispose() {
    this.disposed = true;
    this.disposing ??= (async () => {
      try {
        await Promise.resolve(this.activeDecode?.stop()).catch(() => undefined);
        await this.stop().catch(() => undefined);
        return { ...this.transcript };
      } finally {
        await this.processing;
        const context = await this.ready?.catch(() => undefined);
        this.profiler.mark('model-release');
        let released = false;
        try {
          await context?.release();
          released = true;
        } finally {
          this.ready = null;
          this.profiler.mark(
            released ? 'model-released' : 'model-release-error',
            { success: released },
          );
          await this.profiler.end();
        }
      }
    })();
    return this.disposing;
  }
}
