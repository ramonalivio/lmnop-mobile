import { createSTT } from 'react-native-sherpa-onnx/stt';

/** Retained only for the current press; no audio is written to disk. */
export class WhisperFinalPass {
  private chunks: Float32Array[] = [];
  private rate = 0;
  private count = 0;
  private failure = '';

  get hasAudio() {
    return this.count > 0 || Boolean(this.failure);
  }

  append(samples: Float32Array, rate: number) {
    if (this.failure) return;
    if (
      !Number.isFinite(rate) ||
      rate < 8000 ||
      rate > 192000 ||
      (this.rate && this.rate !== rate)
    ) {
      this.failure = 'Audio sample rate changed; live transcript retained.';
    } else if (this.count + samples.length > rate * 180) {
      this.failure =
        'Recording exceeds three minutes; live transcript retained.';
    }
    if (this.failure) {
      this.chunks = [];
      return;
    }
    this.rate = rate;
    this.count += samples.length;
    this.chunks.push(new Float32Array(samples));
  }

  clear() {
    this.chunks = [];
    this.rate = this.count = 0;
    this.failure = '';
  }

  async transcribe(): Promise<string> {
    if (this.failure) throw new Error(this.failure);
    if (!this.count) return '';
    const samples = new Float32Array(this.count);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    const engine = await createSTT({
      modelPath: { type: 'asset', path: 'models/whisper-small-en' },
      modelType: 'whisper',
      preferInt8: true,
      numThreads: 2,
      provider: 'cpu',
      debug: false,
      modelOptions: { whisper: { language: 'en', task: 'transcribe' } },
    });
    try {
      const parts: string[] = [];
      for (const [start, end] of whisperWindows(samples, this.rate)) {
        const result = await engine.transcribeSamples(
          Array.from(samples.subarray(start, end)),
          this.rate,
        );
        if (!result.text.trim())
          throw new Error('Whisper returned an empty segment.');
        parts.push(result.text.trim());
      }
      return parts.join(' ');
    } finally {
      await engine.destroy();
    }
  }
}

/** Prefer quiet gaps, but keep every sample exactly once and bound decoder input. */
export function whisperWindows(samples: Float32Array, rate: number) {
  const windows: Array<[number, number]> = [];
  const frame = Math.max(1, Math.round(rate * 0.02));
  let start = 0;
  while (start < samples.length) {
    let end = Math.min(samples.length, start + Math.floor(rate * 25));
    if (end < samples.length) {
      let quiet = 0;
      let boundary = 0;
      for (let i = start; i + frame <= end; i += frame) {
        let energy = 0;
        for (let j = i; j < i + frame; j++) energy += samples[j] ** 2;
        quiet = energy / frame < 0.0001 ? quiet + frame : 0;
        if (quiet >= rate * 0.4 && i + frame - start >= rate * 5) {
          boundary = i + frame - Math.floor(quiet / 2);
        }
      }
      if (boundary > start) end = boundary;
    }
    windows.push([start, end]);
    start = end;
  }
  return windows;
}
