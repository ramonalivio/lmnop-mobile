import { OmiMedFinalPass } from './omiMedFinalPass';
import type { RefinementOptions } from './refinementOptions';
import { WhisperLargeFinalPass } from './whisperLargeFinalPass';
import { SpeechProfiler } from './speechProfiler';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { normalizeClinicalText } from './normalizeClinicalText';
import { assetModelPath } from 'react-native-sherpa-onnx';
import {
  createPcmLiveStream,
  type PcmLiveStreamHandle,
} from 'react-native-sherpa-onnx/audio';
import {
  createStreamingSTT,
  type StreamingSttEngine,
  type SttStream,
} from 'react-native-sherpa-onnx/stt';
import {
  applyMedicalTerminologyCorrection,
  medicalHotwords,
} from './medicalTerminology';

const sampleRate = 16000;
const zipformerModelAssetPath =
  'models/sherpa-onnx-streaming-zipformer-en-2023-06-26';

type SpeechStatus =
  | 'idle'
  | 'initializing'
  | 'listening'
  | 'finalizing'
  | 'refining'
  | 'permission-denied'
  | 'model-missing'
  | 'error';

export type SpeechTranscript = {
  pendingFrom?: number;
  confirmed: string;
  provisional: string;
};

export type ZipformerSpeechToTextCallbacks = {
  onRecordingLimit?: () => void;
  onActivity?: (message: string) => void;
  onAudioLevel?: (level: number) => void;
  onError: (message: string) => void;
  onStatus: (status: SpeechStatus) => void;
  onTranscript: (transcript: SpeechTranscript) => void;
};

type IosMicrophonePermissionModule = {
  request: () => Promise<boolean>;
};

const IosMicrophonePermission = NativeModules.IosMicrophonePermission as
  | IosMicrophonePermissionModule
  | undefined;

export class ZipformerSpeechToTextSession {
  private engine: StreamingSttEngine | null = null;
  private enginePromise: Promise<StreamingSttEngine> | null = null;
  private disposed = false;
  private disposePromise: Promise<SpeechTranscript> | null = null;
  private decodedAudioSeconds = 0;
  private decodingMs = 0;
  private captureSampleRate = sampleRate;
  private stream: SttStream | null = null;
  private pcm: PcmLiveStreamHandle | null = null;
  private transcript: SpeechTranscript;
  private recordingPrefix = '';
  private callbacks: ZipformerSpeechToTextCallbacks | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<SpeechTranscript> | null = null;
  private unsubscribeData: (() => void) | null = null;
  private unsubscribeError: (() => void) | null = null;
  private processingQueue = Promise.resolve();

  private finalPass:
    | WhisperLargeFinalPass
    | OmiMedFinalPass
    | null;
  private profiler = new SpeechProfiler();
  private capturedSeconds = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private limitReached = false;
  private captureFailed = false;

  constructor(confirmed = '', private options?: RefinementOptions) {
    this.finalPass = options
      ? options.provider === 'parakeet' || Platform.OS === 'android'
        ? new OmiMedFinalPass()
        : new WhisperLargeFinalPass()
      : null;
    this.transcript = { confirmed, provisional: '' };
  }

  start(callbacks: ZipformerSpeechToTextCallbacks) {
    if (this.disposed) {
      return Promise.reject(new Error('Speech session has been disposed.'));
    }
    if (!this.startPromise) {
      this.recordingPrefix = this.transcript.confirmed;
      this.stopPromise = null;
      this.processingQueue = Promise.resolve();
      this.decodedAudioSeconds = 0;
      this.decodingMs = 0;
      this.captureSampleRate = sampleRate;
      this.capturedSeconds = 0;
      this.limitReached = false;
      this.captureFailed = false;
      this.finalPass?.clear();
    }
    this.startPromise ??= this.startCapture(callbacks);
    return this.startPromise;
  }

  prepare() {
    if (this.disposed) {
      return Promise.reject(new Error('Speech session has been disposed.'));
    }
    if (!this.enginePromise) {
      this.profiler.begin();
      this.profiler.mark('model-load', {
        model:
          'Zipformer' +
          (this.options
            ? Platform.OS === 'android'
              ? ' + Omi Med STT v1 Q8_0 GGUF CPU'
              : ' + Whisper Small Q5_1'
            : ''),
        runtime:
          'sherpa-onnx' +
          (this.options
            ? Platform.OS === 'android'
              ? ' + parakeet.cpp + Omi adapter / GGML CPU'
              : ' + whisper.rn@0.7.4'
            : ''),
      });
    }
    this.enginePromise ??= createStreamingSTT({
      modelPath: assetModelPath(zipformerModelAssetPath),
      modelType: 'transducer',
      enableEndpoint: true,
      endpointConfig: {
        rule1: {
          mustContainNonSilence: false,
          minTrailingSilence: 1.2,
          minUtteranceLength: 0,
        },
        rule2: {
          mustContainNonSilence: true,
          minTrailingSilence: 0.5,
          minUtteranceLength: 0,
        },
        rule3: {
          mustContainNonSilence: false,
          minTrailingSilence: 0,
          minUtteranceLength: 30,
        },
      },
      decodingMethod: 'modified_beam_search',
      enableInputNormalization: false,
      hotwordsScore: 1.8,
      numThreads: 2,
    })
      .then(async (engine) => {
        this.engine = engine;
        if (!this.disposed) await this.finalPass?.prepare(this.profiler);
        return engine;
      })
      .catch((error) => {
        this.enginePromise = null;
        throw error;
      });
    return this.enginePromise;
  }

  clear() {
    this.setText('');
  }

  setText(confirmed: string) {
    if (!this.startPromise) {
      this.transcript = { confirmed, provisional: '' };
    }
  }

  async cancel() {
    await this.finalPass?.cancel().catch(() => undefined);
    return this.stop();
  }

  dispose() {
    this.disposePromise ??= this.destroy();
    return this.disposePromise;
  }

  private async destroy() {
    this.disposed = true;
    await this.finalPass?.cancel().catch(() => undefined);
    try {
      return await this.stop();
    } finally {
      await this.enginePromise?.catch(() => undefined);
      await this.finalPass?.release(this.profiler);
      this.finalPass?.clear();
      await this.engine?.destroy();
      this.engine = null;
      this.enginePromise = null;
      await this.profiler.end();
    }
  }

  private async startCapture(callbacks: ZipformerSpeechToTextCallbacks) {
    const startedAt = Date.now();
    const warmModel = this.engine !== null;
    this.callbacks = callbacks;
    callbacks.onStatus('initializing');

    try {
      const hasPermission = await requestMicrophonePermission();
      if (!hasPermission) {
        callbacks.onStatus('permission-denied');
        return;
      }
      const engine = await this.prepare();
      if (this.disposed) {
        return;
      }

      this.stream = await engine.createStream(
        medicalHotwords.join('\n').toUpperCase(),
      );
      this.profiler.recordingPrefix(this.recordingPrefix);
      this.profiler.mark('recording');
      this.pcm = createPcmLiveStream({ sampleRate, channelCount: 1 });
      this.unsubscribeData = this.pcm.onData((samples, incomingSampleRate) => {
        if (this.disposed || this.captureFailed) return;
        const remaining = Math.max(
          0,
          Math.round((60 - this.capturedSeconds) * incomingSampleRate),
        );
        samples = samples.subarray(0, remaining);
        if (!samples.length) {
          this.reachLimit();
          return;
        }
        this.capturedSeconds += samples.length / incomingSampleRate;
        this.profiler.capture(samples, incomingSampleRate);
        this.finalPass?.append(samples, incomingSampleRate);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const rms = Math.sqrt(energy / samples.length);
        callbacks.onAudioLevel?.(
          Math.min(
            1,
            Math.max(0, (20 * Math.log10(Math.max(rms, 0.000001)) + 60) / 60),
          ),
        );

        this.processingQueue = this.processingQueue
          .then(() => this.processAudioChunk(samples, incomingSampleRate))
          .catch((error) => {
            this.captureFailed = true;
            callbacks.onStatus('error');
            callbacks.onError(describeSpeechError(error));
          });
        if (this.capturedSeconds >= 60) this.reachLimit();
      });
      this.unsubscribeError = this.pcm.onError((message) => {
        this.captureFailed = true;
        callbacks.onStatus('error');
        callbacks.onError(message);
      });

      await this.pcm.start();
      if (__DEV__) {
        console.info('LMNOP_SPEECH capture-ready', {
          elapsedMs: Date.now() - startedAt,
          warmModel,
        });
      }
      callbacks.onStatus('listening');
      if (!this.stopPromise)
        this.limitTimer = setTimeout(() => this.reachLimit(), 60000);
    } catch (error) {
      await this.release();
      const message = describeSpeechError(error);
      callbacks.onStatus(
        message.toLowerCase().includes('missing') ? 'model-missing' : 'error',
      );
      callbacks.onError(message);
    }
  }

  private reachLimit() {
    if (this.limitReached) return;
    this.limitReached = true;
    if (this.callbacks?.onRecordingLimit) this.callbacks.onRecordingLimit();
    else this.stop().catch(() => undefined);
  }

  stop() {
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    if (!this.startPromise) {
      return Promise.resolve({ ...this.transcript });
    }
    if (!this.stopPromise) this.profiler.mark('stop-requested');
    this.stopPromise ??= this.finish();
    return this.stopPromise;
  }

  private async finish() {
    await this.startPromise;
    try {
      if (this.stream) {
        this.callbacks?.onStatus('finalizing');
      }
      await this.pcm?.stop();
      await this.processingQueue;

      if (this.stream) {
        // Supply the model's right context without recording after button release.
        await this.stream.acceptWaveform(
          new Array<number>(Math.round(this.captureSampleRate * 0.66)).fill(0),
          this.captureSampleRate,
        );
        await this.stream.inputFinished();

        while (await this.stream.isReady()) {
          await this.stream.decode();
        }

        const result = await this.stream.getResult();

        this.updateTranscript(result.text, true);
        const normalized =
          this.recordingPrefix +
          normalizeClinicalText(
            this.transcript.confirmed.slice(this.recordingPrefix.length),
          );
        if (normalized !== this.transcript.confirmed) {
          this.transcript = {
            ...this.transcript,
            confirmed: normalized,
            provisional: '',
          };
          this.callbacks?.onTranscript({ ...this.transcript });
        }
      }
      this.profiler.result(
        this.transcript.confirmed.slice(this.recordingPrefix.length).trim(),
      );
      if (this.finalPass?.hasAudio && !this.disposed && !this.captureFailed) {
        try {
          const refined = await this.finalPass.transcribe(
            this.profiler,
            (message) => {
              if (!this.disposed) this.callbacks?.onActivity?.(message);
            },
            this.recordingPrefix,
            true,
            true,
          );
          if (!this.disposed && refined.trim()) {
            this.transcript = {
              confirmed: [this.recordingPrefix, refined]
                .filter(Boolean)
                .join(' '),
              provisional: '',
            };
            this.callbacks?.onTranscript({ ...this.transcript });
          }
        } catch (error) {
          this.profiler.failure(describeSpeechError(error));
          if (!this.disposed)
            this.callbacks?.onError(
              'Refinement failed; live transcript retained. ' +
                describeSpeechError(error),
            );
        }
      }
      return { ...this.transcript };
    } catch (error) {
      this.captureFailed = true;
      this.profiler.failure(describeSpeechError(error));
      throw error;
    } finally {
      await this.profiler
        .finishRecording(
          this.transcript.confirmed,
          !this.captureFailed && !this.disposed,
        )
        .catch(() =>
          this.callbacks?.onError(
            'Could not save the recording for the performance report.',
          ),
        );
      this.finalPass?.clear();
      this.callbacks?.onActivity?.('');
      this.callbacks?.onAudioLevel?.(0);
      await this.release();
      this.startPromise = null;
      if (__DEV__ && this.decodedAudioSeconds > 0) {
        console.info('LMNOP_SPEECH decode-timing', {
          threads: 2,
          audioSeconds: this.decodedAudioSeconds,
          decodingMs: this.decodingMs,
        });
      }
    }
  }

  private async processAudioChunk(
    samples: Float32Array,
    incomingSampleRate: number,
  ) {
    if (!this.stream) {
      return;
    }

    const startedAt = Date.now();
    this.captureSampleRate = incomingSampleRate;
    const { result, isEndpoint } = await this.stream.processAudioChunk(
      samples,
      incomingSampleRate,
    );
    this.decodingMs += Date.now() - startedAt;
    this.decodedAudioSeconds += samples.length / incomingSampleRate;

    this.updateTranscript(result.text, isEndpoint);

    if (isEndpoint) {
      await this.stream.reset();
    }
  }

  private updateTranscript(text: string, final: boolean) {
    const corrected = applyMedicalTerminologyCorrection(text).trim();
    const previous = this.transcript;
    this.transcript = final
      ? {
          confirmed: [this.transcript.confirmed, corrected]
            .filter(Boolean)
            .join(' '),
          provisional: '',
        }
      : { ...this.transcript, provisional: corrected };
    if (this.finalPass)
      this.transcript.pendingFrom =
        previous.pendingFrom ?? this.recordingPrefix.length;
    if (
      previous.confirmed !== this.transcript.confirmed ||
      previous.provisional !== this.transcript.provisional
    ) {
      this.callbacks?.onTranscript({ ...this.transcript });
    }
  }

  private async release() {
    this.unsubscribeData?.();
    this.unsubscribeError?.();
    this.unsubscribeData = null;
    this.unsubscribeError = null;
    await this.stream?.release();
    this.stream = null;
    this.pcm = null;
  }
}

export function createZipformerSpeechToTextSession(confirmed = '') {
  return new ZipformerSpeechToTextSession(confirmed);
}

export type { SpeechStatus };

async function requestMicrophonePermission() {
  if (Platform.OS === 'ios') {
    return IosMicrophonePermission?.request() ?? false;
  }

  if (Platform.OS !== 'android') {
    return true;
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      buttonNegative: 'Not now',
      buttonPositive: 'Allow',
      message: 'LMNOP needs microphone access for speech-to-text dictation.',
      title: 'Microphone access',
    },
  );

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function describeSpeechError(error: unknown) {
  return error instanceof Error ? error.message : 'Speech recognition failed.';
}
