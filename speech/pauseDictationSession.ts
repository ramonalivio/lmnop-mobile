import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { getParakeetModelPath } from './parakeetModel';
export { clearPauseRecoveryRecordings } from './pauseRecovery';
import { requestDictationMicrophonePermission } from './microphonePermission';
import { PauseDictationCore, type PhraseTiming } from './pauseDictationCore';
import { encodePcm, decodePcm } from './pcmCodec';
import { SpeechProfiler, speechProfileNow } from './speechProfiler';
import { hasSpeechEnergy, WhisperAudio } from './whisperAudio';
import { savePerformanceRecording } from './performanceReports';
import type {
  SpeechTranscript,
  ZipformerSpeechToTextCallbacks,
} from './zipformerSpeechToText';

let serial = 0;
export class PauseDictationSession {
  private id = `pause-${Date.now()}-${++serial}`;
  private ready: Promise<void> | null = null;
  private starting: Promise<void> | null = null;
  private stopping: Promise<SpeechTranscript> | null = null;
  private cancelling: Promise<SpeechTranscript> | null = null;
  private disposed = false;
  private generation = 0;
  private recording = false;
  private captureFailure: Error | null = null;
  private core: PauseDictationCore | null = null;
  private confirmed: string;
  private callbacks: ZipformerSpeechToTextCallbacks | null = null;
  private subscriptions: Array<{ remove(): void }> = [];
  private captureEnd: Promise<void> = Promise.resolve();
  private captureEnded: (() => void) | null = null;
  private directory = '';
  private recordingPrefix = '';
  private report: {
    samples: Float32Array;
    result: string;
    timing?: PhraseTiming;
  } | null = null;
  private profiler = new SpeechProfiler();
  private readonly pauseMs = 160;
  constructor(confirmed = '') {
    this.confirmed = confirmed;
  }
  private snapshot(): SpeechTranscript {
    return { confirmed: this.confirmed, provisional: '' };
  }
  prepare() {
    if (this.disposed)
      return Promise.reject(new Error('Speech session has been disposed.'));
    this.ready ??= (async () => {
      if (
        Platform.OS !== 'android' ||
        Number(Platform.Version) < 28 ||
        !NativeModules.ParakeetSpeech?.prepareVad
      )
        throw new Error(
          'Pause dictation requires the current arm64 Android 9+ app. iOS is not supported yet.',
        );
      await this.profiler.begin();
      this.profiler.mark('model-load', {
        model: 'Parakeet TDT v3 ONNX INT8 + Silero VAD',
        runtime: 'parakeet-rs + ONNX Runtime CPU',
        threads: 4,
        backend: 'CPU',
      });
      const startedAt = speechProfileNow();
      await NativeModules.ParakeetSpeech.prepare(
        this.id,
        await getParakeetModelPath(),
      );
      const elapsedMs = speechProfileNow() - startedAt;
      this.profiler.mark('tdt-model-ready', { elapsedMs, backend: 'CPU' });
    })().catch(error => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }
  start(callbacks: ZipformerSpeechToTextCallbacks) {
    if (this.disposed)
      return Promise.reject(new Error('Speech session has been disposed.'));
    if (this.starting) return this.starting;
    if (this.recording || this.stopping || this.cancelling)
      return Promise.resolve();
    this.callbacks = callbacks;
    this.captureFailure = null;
    this.recordingPrefix = this.confirmed;
    const generation = ++this.generation;
    callbacks.onStatus('initializing');
    this.starting = (async () => {
      if (!(await requestDictationMicrophonePermission())) {
        callbacks.onStatus('permission-denied');
        return;
      }
      await this.prepare();
      if (this.disposed || generation !== this.generation) return;
      const path = await getParakeetModelPath();
      await NativeModules.ParakeetSpeech.prepareVad(
        this.id,
        `${path}/silero_vad.onnx`,
      );
      if (this.disposed || generation !== this.generation) return;
      const fs = await RNFS.getFSInfo();
      if (fs.freeSpace < 32 * 1024 * 1024)
        throw new Error('Free 32 MB before recording.');
      this.directory = `${RNFS.DocumentDirectoryPath}/PauseDictation/${this.id}-${generation}`;
      await RNFS.mkdir(this.directory, { NSURLIsExcludedFromBackupKey: true });
      await RNFS.writeFile(`${this.directory}/recording.pcm`, '', 'base64');
      let bytesSinceCheck = 0;
      this.profiler.mark('recording');
      this.core = new PauseDictationCore(
        {
          now: Date.now,
          vad: frame =>
            NativeModules.ParakeetSpeech.vad(this.id, Array.from(frame)),
          journal: async samples => {
            await RNFS.appendFile(
              `${this.directory}/recording.pcm`,
              encodePcm(samples),
              'base64',
            );
            bytesSinceCheck += samples.length * 2;
            if (bytesSinceCheck >= 320000) {
              bytesSinceCheck = 0;
              if ((await RNFS.getFSInfo()).freeSpace < 16 * 1024 * 1024)
                throw new Error(
                  'Storage is nearly full. Recording stopped; audio was retained.',
                );
            }
          },
          store: async (phrase, index) => {
            const reference = `${this.directory}/phrase-${index}.pcm`;
            await RNFS.writeFile(
              reference,
              encodePcm(phrase.samples),
              'base64',
            );
            return reference;
          },
          transcribe: async reference => {
            const pcm = await RNFS.readFile(reference, 'base64');
            const result = await NativeModules.ParakeetSpeech.transcribe(
              this.id,
              pcm,
            );
            this.report = { samples: decodePcm(pcm), result: result.text };
            return result;
          },
          remove: async reference => {
            const report = this.report;
            this.report = null;
            if (report?.timing && generation === this.generation) {
              const audio = new WhisperAudio();
              audio.append(report.samples, 16000);
              await savePerformanceRecording(audio, {
                model: 'Parakeet TDT v3 ONNX INT8 + Silero VAD',
                mode: 'offline',
                runtime: 'parakeet-rs + ONNX Runtime CPU',
                backend: 'CPU',
                threads: 4,
                result: report.result,
                fullResult: this.confirmed,
                success: true,
                pauseMs: this.pauseMs,
                phraseTiming: report.timing,
              }).catch(() => undefined);
            }
            if (await RNFS.exists(reference)) await RNFS.unlink(reference);
          },
          onText: text => {
            if (generation !== this.generation) return;
            this.confirmed = text;
            callbacks.onTranscript(this.snapshot());
          },
          onTiming: timing => {
            if (this.report) this.report.timing = timing;
            this.profiler.mark('phrase-complete', {
              ...timing,
              decodeIndex: timing.index,
            });
          },
          onActivity: message => {
            if (generation === this.generation) callbacks.onActivity?.(message);
          },
          onError: error => {
            if (generation !== this.generation) return;
            callbacks.onError(
              `${error.message} Recovery audio: ${this.directory}/recording.pcm`,
            );
            // Do not await from the VAD/ASR queue: Stop must drain both queues.
            void this.stop().catch(() => undefined);
          },
        },
        this.confirmed,
        this.pauseMs,
      );
      if (this.disposed || generation !== this.generation) return;
      const events = new NativeEventEmitter(NativeModules.DictationAudio);
      this.captureEnd = new Promise(resolve => {
        this.captureEnded = resolve;
      });
      this.subscriptions = [
        events.addListener('DictationFrame', value => {
          const event = value as {
            id: string;
            samples: number[];
            capturedAt: number;
          };
          if (event.id !== this.id || generation !== this.generation) return;
          const samples = Float32Array.from(event.samples as number[]);
          this.core?.accept(samples, event.capturedAt);
          let energy = 0;
          for (const sample of samples) energy += sample * sample;
          callbacks.onAudioLevel?.(
            Math.min(1, Math.sqrt(energy / samples.length) * 8),
          );
        }),
        events.addListener('DictationEnd', id => {
          if (id === this.id) this.captureEnded?.();
        }),
        events.addListener('DictationAudioError', message => {
          if (generation !== this.generation) return;
          this.captureFailure = new Error(String(message));
          callbacks.onError(String(message));
          void this.stop().catch(() => undefined);
        }),
      ];
      await NativeModules.DictationAudio.startSession(this.id);
      this.recording = true;
      if (generation === this.generation) {
        callbacks.onStatus('listening');
        callbacks.onActivity?.('Listening for speech…');
      }
    })()
      .catch(async error => {
        await this.closeCapture().catch(() => undefined);
        await NativeModules.ParakeetSpeech?.releaseVad(this.id).catch(
          () => undefined,
        );
        if (generation === this.generation) {
          callbacks.onError(String(error));
          callbacks.onStatus('error');
        }
        throw error;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }
  private async closeCapture() {
    if (this.recording) {
      try {
        await NativeModules.DictationAudio.stop();
      } catch (error) {
        this.captureFailure =
          error instanceof Error ? error : new Error(String(error));
        this.callbacks?.onError(this.captureFailure.message);
      } finally {
        // Native close emits this even if AudioRecord.stop throws: the reader is
        // joined and released in finally. Drain its last event before flushing VAD.
        await this.captureEnd;
        this.recording = false;
      }
    }
    this.subscriptions.forEach(subscription => subscription.remove());
    this.subscriptions = [];
    this.captureEnded = null;
  }
  stop() {
    this.stopping ??= (async () => {
      await this.starting?.catch(() => undefined);
      this.callbacks?.onStatus('finalizing');
      this.profiler.mark('stop-requested');
      await this.closeCapture();
      await this.core?.finish();
      await NativeModules.ParakeetSpeech.releaseVad(this.id);
      let refinementFailure: unknown = null;
      if (!this.disposed && this.directory) {
        try {
          await this.transcribeWholeRecording();
        } catch (error) {
          refinementFailure = error;
          this.callbacks?.onError(
            `Final transcription failed; live transcript retained. ${String(error)}`,
          );
        }
      }
      if (this.core?.error || this.captureFailure || refinementFailure) {
        this.callbacks?.onStatus('error');
      } else {
        if (this.directory && (await RNFS.exists(this.directory)))
          await RNFS.unlink(this.directory);
        this.callbacks?.onStatus('idle');
      }
      this.callbacks?.onActivity?.('');
      this.profiler.checkpoint();
      return this.snapshot();
    })().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }
  private async transcribeWholeRecording() {
    const recordingPath = `${this.directory}/recording.pcm`;
    const base64 = await RNFS.readFile(recordingPath, 'base64');
    const pcm = decodePcm(base64);
    if (!pcm.length) return;
    this.profiler.mark('whole-recording-refinement-start', {
      audioSeconds: pcm.length / 16000,
    });
    // Only replace text produced in this recording; retain text that preceded it.
    const original = this.recordingPrefix;
    this.callbacks?.onStatus('refining');
    this.callbacks?.onActivity?.('Refining the complete recording…');
    const refined: string[] = [];
    let start = 0;
    let decodeIndex = 0;
    const windowSize = 25 * 16000;
    while (start < pcm.length) {
      let end = Math.min(pcm.length, start + windowSize);
      if (end < pcm.length) {
        const slice = pcm.subarray(start, end);
        const frame = 320;
        let quiet = 0;
        let boundary = 0;
        for (let i = 0; i + frame <= slice.length; i += frame) {
          let energy = 0;
          for (let j = i; j < i + frame; j++) energy += slice[j] ** 2;
          quiet = energy / frame < 0.0001 ? quiet + frame : 0;
          if (quiet >= 6400 && i + frame >= 80000)
            boundary = i + frame - Math.floor(quiet / 2);
        }
        if (boundary) end = start + boundary;
      }
      const samples = pcm.subarray(start, end);
      start = end;
      if (!hasSpeechEnergy(samples, 16000)) continue;
      const seconds = samples.length / 16000;
      const started = speechProfileNow();
      let success = false;
      decodeIndex++;
      this.profiler.mark('final-decode-start', {
        audioSeconds: seconds,
        decodeIndex,
        final: true,
        backend: 'CPU',
        model: 'Parakeet TDT 0.6B v3 ONNX INT8',
      });
      try {
        const encoded = encodePcm(samples);
        const result = await NativeModules.ParakeetSpeech.transcribe(
          this.id,
          encoded,
        );
        if (this.disposed) return;
        const text = typeof result === 'string' ? result : result.text;
        if (text?.trim()) refined.push(text.trim());
        success = true;
      } finally {
        const elapsedMs = speechProfileNow() - started;
        this.profiler.mark('final-decode-end', {
          audioSeconds: seconds,
          decodeIndex,
          final: true,
          elapsedMs,
          realTimeFactor: elapsedMs / (seconds * 1000),
          success,
          backend: 'CPU',
        });
      }
    }
    const text = refined.join(' ').trim();
    if (text) {
      this.confirmed = [original, text].filter(Boolean).join(' ');
      this.core?.setText(this.confirmed);
      this.callbacks?.onTranscript(this.snapshot());
    }
  }
  cancel(preserveRecovery = false) {
    if (this.cancelling) return this.cancelling;
    ++this.generation; // Invalidate immediately, including a native inference in flight.
    const cancelled = this.core?.cancel();
    this.cancelling = (async () => {
      await this.starting?.catch(() => undefined);
      await this.closeCapture();
      await cancelled;
      await this.stopping;
      await NativeModules.ParakeetSpeech?.releaseVad(this.id);
      if (
        !preserveRecovery &&
        this.directory &&
        (await RNFS.exists(this.directory))
      )
        await RNFS.unlink(this.directory);
      this.report = null;
      this.callbacks?.onStatus('idle');
      this.callbacks?.onActivity?.('');
      return this.snapshot();
    })().finally(() => {
      this.cancelling = null;
    });
    return this.cancelling;
  }
  setText(text: string) {
    this.confirmed = text;
    this.core?.setText(text);
  }
  clear() {
    this.setText('');
  }
  async dispose() {
    this.disposed = true;
    const result = await this.cancel(
      !!this.core?.error || !!this.captureFailure,
    );
    await this.ready?.catch(() => undefined);
    await NativeModules.ParakeetSpeech?.release(this.id);
    await this.profiler.end();
    return result;
  }
}
