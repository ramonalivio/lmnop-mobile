import { NativeModules } from 'react-native';
import { getParakeetModelPath } from './parakeetModel';
import { WhisperAudio, hasSpeechEnergy, whisperPcm16 } from './whisperAudio';
import { normalizeClinicalText } from './normalizeClinicalText';
import { SpeechProfiler, speechProfileNow } from './speechProfiler';

let nextSession = 0;
function pcmBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    parts.push(alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63] +
      (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=') +
      (i + 2 < bytes.length ? alphabet[value & 63] : '='));
  }
  return parts.join('');
}
export class ParakeetFinalPass {
  private id = `parakeet-${Date.now()}-${++nextSession}`;
  private audio = new WhisperAudio();
  private failure: unknown = null;
  private cancelled = false;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private backend = 'unknown';
  get failed() { return !!this.failure; }
  get hasAudio() { return this.audio.count > 0 || !!this.failure; }
  resume() { this.cancelled = false; }
  clear() { this.audio.clear(); this.failure = null; this.cancelled = false; }
  append(samples: Float32Array, rate: number) {
    try { this.audio.append(samples, rate); } catch (error) { this.failure = error; }
  }
  async cancel() { this.cancelled = true; }
  async prepare(profiler: SpeechProfiler) {
    if (this.loaded) return;
    const module = NativeModules.ParakeetSpeech;
    if (!module) throw new Error('Parakeet refinement requires a current Android build.');
    this.loading ??= (async () => {
      const started = speechProfileNow();
      profiler.mark('parakeet-model-load', { model: 'Parakeet TDT 0.6B v3 ONNX INT8', backend: 'CPU' });
      const result = await module.prepare(this.id, await getParakeetModelPath());
      this.backend = result.backend;
      if (result.backend !== 'CPU' || result.gpu) {
        await module.release(this.id);
        throw new Error(`Parakeet did not initialize on CPU (backend: ${result.backend}).`);
      }
      this.loaded = true;
      const elapsedMs = speechProfileNow() - started;
      profiler.mark('tdt-model-ready', { elapsedMs, backend: result.backend });
      profiler.mark('parakeet-model-ready', { model: result.model, backend: result.backend, gpu: result.gpu, threads: result.threads, runtime: result.runtime, elapsedMs });
    })();
    try { await this.loading; } finally { this.loading = null; }
  }
  async release(profiler: SpeechProfiler) {
    await this.loading?.catch(() => undefined);
    if (this.loaded) {
      this.loaded = false;
      await NativeModules.ParakeetSpeech.release(this.id);
      profiler.mark('parakeet-model-released', { backend: this.backend });
    }
  }
  async transcribe(profiler: SpeechProfiler, onActivity: (text: string) => void,
    _precedingText = '', keepLoaded = false, normalizeFinal = false) {
    if (this.failure) throw this.failure;
    if (this.cancelled || !this.audio.count) return '';
    onActivity('Refining with Parakeet…');
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
        profiler.mark('final-decode-start', { audioSeconds, decodeIndex, final: true, backend: this.backend, model: 'Parakeet TDT 0.6B v3 ONNX INT8' });
        try {
          const pcm = pcmBase64(whisperPcm16(samples, this.audio.rate));
          const result = await NativeModules.ParakeetSpeech.transcribe(this.id, pcm);
          // Older installed bridges returned just text.
          const text: string = typeof result === 'string' ? result : result.text;
          if (typeof result !== 'string') timings = { nativeMs: result.nativeMs };
          if (this.cancelled) break;
          parts.push(text);
          success = true;
        } finally {
          const elapsedMs = speechProfileNow() - started;
          profiler.mark('final-decode-end', { audioSeconds, decodeIndex, final: true, elapsedMs, realTimeFactor: elapsedMs / (audioSeconds * 1000), success, backend: this.backend, ...timings });
        }
      }
      if (this.cancelled) return '';
      const text = parts.join(' ');
      return normalizeFinal ? normalizeClinicalText(text) : text;
    } finally { if (!keepLoaded) await this.release(profiler); }
  }
}
