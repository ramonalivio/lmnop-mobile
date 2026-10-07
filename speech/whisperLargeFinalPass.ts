import { getOfflineModelPath } from './offlineModel';
import { initWhisper, type WhisperContext } from 'whisper.rn/index';
import { normalizeClinicalText } from './normalizeClinicalText';
import clinicalKeyterms from '../test-fixtures/dictation/clinical-keyterms.json';
import { WhisperAudio, hasSpeechEnergy, whisperPcm16 } from './whisperAudio';
import { SpeechProfiler, speechProfileNow } from './speechProfiler';

/** One press of audio with optional preloading for residency profiling. */
export class WhisperLargeFinalPass {
  private audio = new WhisperAudio();
  private failure: unknown = null;
  private cancelled = false;
  private active: ReturnType<WhisperContext['transcribeData']> | null = null;

  private context: WhisperContext | null = null;
  private loading: Promise<WhisperContext> | null = null;

  async prepare(profiler: SpeechProfiler) {
    if (this.context) return this.context;
    this.loading ??= (async () => {
      profiler.mark('whisper-model-load');
      const started = speechProfileNow();
      const context = await initWhisper({
        filePath: await getOfflineModelPath(),
        isBundleAsset: false,
        // Let whisper.rn select Android acceleration when the device/backend
        // supports it; it reports the selected backend in context.gpu and
        // falls back to CPU when no supported backend is available.
        useGpu: true,
        useFlashAttn: true,
        useCoreMLIos: false,
      });
      this.context = context;
      profiler.mark('whisper-model-ready', {
        elapsedMs: speechProfileNow() - started,
        gpu: context.gpu,
        reasonNoGPU: context.reasonNoGPU,
      });
      return context;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  get backend() {
    return this.context
      ? { gpu: this.context.gpu, reasonNoGPU: this.context.reasonNoGPU }
      : null;
  }

  async release(profiler: SpeechProfiler) {
    await this.loading?.catch(() => undefined);
    const context = this.context;
    this.context = null;
    if (context) {
      profiler.mark('whisper-model-release');
      await context.release();
      profiler.mark('whisper-model-released');
    }
  }

  get failed() {
    return !!this.failure;
  }

  resume() {
    this.cancelled = false;
  }

  get hasAudio() {
    return this.audio.count > 0 || !!this.failure;
  }

  append(samples: Float32Array, rate: number) {
    if (this.failure) return;
    try {
      this.audio.append(samples, rate);
    } catch (error) {
      this.failure = error;
      this.audio.clear();
    }
  }

  clear() {
    this.audio.clear();
    this.failure = null;
    this.cancelled = false;
  }

  async cancel() {
    this.cancelled = true;
    await this.active?.stop();
  }

  async transcribe(
    profiler: SpeechProfiler,
    onActivity: (text: string) => void,
    precedingText = '',
    keepLoaded = false,
    normalizeFinal = false,
  ) {
    if (this.failure) throw this.failure;
    if (this.cancelled || !this.audio.count) return '';
    let context: WhisperContext | null = null;
    onActivity('Finalizing transcript…');
    try {
      const parts: string[] = [];
      let start = 0;
      let decodeIndex = 0;
      while (start < this.audio.count && !this.cancelled) {
        const { samples, end } = this.audio.window(start);
        start = end;
        if (!hasSpeechEnergy(samples, this.audio.rate)) continue;
        if (!context) {
          context = await this.prepare(profiler);
          if (this.cancelled) break;
        }
        const audioSeconds = samples.length / this.audio.rate;
        const decodeStarted = speechProfileNow();
        decodeIndex++;
        profiler.mark('final-decode-start', {
          audioSeconds,
          decodeIndex,
          final: true,
        });
        let success = false;
        try {
          this.active = context.transcribeData(
            whisperPcm16(samples, this.audio.rate),
            {
              language: 'en',
              translate: false,
              maxThreads: 2,
              temperature: 0,
              temperatureInc: 0,
              prompt: [
                clinicalKeyterms.join(', '),
                [precedingText, ...parts].filter(Boolean).join(' ').slice(-800),
              ]
                .filter(Boolean)
                .join('\n'),
            },
          );
          const result = await this.active.promise;
          if (this.cancelled) break;
          if (result.isAborted)
            throw new Error('Final transcription was interrupted.');
          const text = result.result.trim();
          if (!text) throw new Error('Whisper returned an empty segment.');
          parts.push(text);
          success = true;
        } finally {
          this.active = null;
          const elapsedMs = speechProfileNow() - decodeStarted;
          profiler.mark('final-decode-end', {
            audioSeconds,
            decodeIndex,
            final: true,
            elapsedMs,
            realTimeFactor: elapsedMs / (audioSeconds * 1000),
            success,
          });
        }
      }
      if (this.cancelled) return '';
      const text = parts.join(' ');
      return normalizeFinal ? normalizeClinicalText(text) : text;
    } finally {
      if (!keepLoaded) await this.release(profiler);
    }
  }
}
