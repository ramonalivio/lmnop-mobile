import { NativeModules } from 'react-native';
import { getOmiMedModelPath } from './omiMedModel';
import { SpeechAudio, hasSpeechEnergy, speechPcm16 } from './speechAudio';
import { normalizeClinicalText } from './normalizeClinicalText';
import { SpeechProfiler, speechProfileNow } from './speechProfiler';

let nextSession = 0;
function pcmBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const value =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    parts.push(
      alphabet[(value >>> 18) & 63] +
        alphabet[(value >>> 12) & 63] +
        (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=') +
        (i + 2 < bytes.length ? alphabet[value & 63] : '='),
    );
  }
  return parts.join('');
}
export class OmiMedFinalPass {
  private id = `omi-med-${Date.now()}-${++nextSession}`;
  private audio = new SpeechAudio();
  private failure: unknown = null;
  private cancelled = false;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private backend = 'unknown';
  get failed() {
    return !!this.failure;
  }
  get hasAudio() {
    return this.audio.count > 0 || !!this.failure;
  }
  resume() {
    this.cancelled = false;
  }
  clear() {
    this.audio.clear();
    this.failure = null;
    this.cancelled = false;
  }
  append(samples: Float32Array, rate: number) {
    try {
      this.audio.append(samples, rate);
    } catch (error) {
      this.failure = error;
    }
  }
  async cancel() {
    this.cancelled = true;
  }
  async prepare(profiler: SpeechProfiler) {
    if (this.loaded) return;
    const module = NativeModules.OmiMedSpeech;
    if (!module)
      throw new Error('Omi refinement requires a current native app build.');
    this.loading ??= (async () => {
      const started = speechProfileNow();
      profiler.mark('omi-med-model-load', {
        model: 'Omi Med STT v1 Q8_0 GGUF',
        backend: 'CPU',
      });
      const result = await module.prepare(this.id, await getOmiMedModelPath());
      this.backend = result.backend;
      if (result.backend !== 'CPU' || result.gpu) {
        await module.release(this.id);
        throw new Error(
          `Omi did not initialize on CPU (backend: ${result.backend}).`,
        );
      }
      this.loaded = true;
      const elapsedMs = speechProfileNow() - started;
      profiler.mark('omi-model-ready', {
        elapsedMs,
        backend: result.backend,
        nativeLoadMs: result.nativeLoadMs,
      });
      profiler.mark('omi-med-model-ready', {
        model: result.model,
        backend: result.backend,
        nativeLoadMs: result.nativeLoadMs,
        gpu: result.gpu,
        threads: result.threads,
        runtime: result.runtime,
        elapsedMs,
      });
    })();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }
  async release(profiler: SpeechProfiler) {
    await this.loading?.catch(() => undefined);
    if (this.loaded) {
      this.loaded = false;
      await NativeModules.OmiMedSpeech.release(this.id);
      profiler.mark('omi-med-model-released', { backend: this.backend });
    }
  }
  async transcribe(
    profiler: SpeechProfiler,
    onActivity: (text: string) => void,
    _precedingText = '',
    keepLoaded = false,
    normalizeFinal = false,
  ) {
    if (this.failure) throw this.failure;
    if (this.cancelled || !this.audio.count) return '';
    onActivity('Refining with Omi…');
    const parts: string[] = [];
    let start = 0;
    let decodeIndex = 0;
    try {
      while (start < this.audio.count && !this.cancelled) {
        const { samples, end } = this.audio.window(start);
        start = end;
        if (!hasSpeechEnergy(samples, this.audio.rate)) continue;
        await this.prepare(profiler);
        if (this.cancelled) break;
        const audioSeconds = samples.length / this.audio.rate;
        const started = speechProfileNow();
        let success = false;
        let timings: { nativeMs?: number } = {};
        decodeIndex++;
        profiler.mark('final-decode-start', {
          audioSeconds,
          decodeIndex,
          final: true,
          backend: this.backend,
          model: 'Omi Med STT v1 Q8_0 GGUF',
        });
        try {
          const pcm = pcmBase64(speechPcm16(samples, this.audio.rate));
          const result = await NativeModules.OmiMedSpeech.transcribe(
            this.id,
            pcm,
          );
          const text: string = result.text;
          timings = { nativeMs: result.nativeMs };
          if (this.cancelled) break;
          parts.push(text);
          success = true;
        } finally {
          const elapsedMs = speechProfileNow() - started;
          profiler.mark('final-decode-end', {
            audioSeconds,
            decodeIndex,
            final: true,
            elapsedMs,
            realTimeFactor: elapsedMs / (audioSeconds * 1000),
            success,
            backend: this.backend,
            ...timings,
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
