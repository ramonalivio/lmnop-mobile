/** Per-press PCM. Retain original samples; resampling uses whole windows, never chunks. */
export class SpeechAudio {
  private chunks: Array<{ start: number; samples: Float32Array }> = [];
  count = 0;
  rate = 0;

  append(samples: Float32Array, rate: number) {
    if (
      !Number.isFinite(rate) ||
      rate < 8000 ||
      rate > 192000 ||
      (this.rate && rate !== this.rate)
    )
      throw new Error('Audio sample rate changed or is unsupported.');
    if (this.count + samples.length > rate * 180)
      throw new Error(
        'Recording reached the three-minute limit. Please start another recording.',
      );
    this.rate = rate;
    this.chunks.push({ start: this.count, samples: new Float32Array(samples) });
    this.count += samples.length;
  }

  slice(start: number, end: number) {
    const result = new Float32Array(end - start);
    for (const chunk of this.chunks) {
      const left = Math.max(start, chunk.start);
      const right = Math.min(end, chunk.start + chunk.samples.length);
      if (right > left)
        result.set(
          chunk.samples.subarray(left - chunk.start, right - chunk.start),
          left - start,
        );
    }
    return result;
  }

  window(start: number) {
    let end = Math.min(this.count, start + Math.floor(this.rate * 25));
    const full = end - start >= this.rate * 25;
    let samples = this.slice(start, end);
    if (full) {
      const frame = Math.max(1, Math.round(this.rate * 0.02));
      let quiet = 0;
      let boundary = 0;
      for (let i = 0; i + frame <= samples.length; i += frame) {
        let energy = 0;
        for (let j = i; j < i + frame; j++) energy += samples[j] ** 2;
        quiet = energy / frame < 0.0001 ? quiet + frame : 0;
        if (quiet >= this.rate * 0.4 && i + frame >= this.rate * 5)
          boundary = i + frame - Math.floor(quiet / 2);
      }
      if (boundary) {
        end = start + boundary;
        samples = samples.slice(0, boundary);
      }
    }
    return { end, samples, full };
  }

  clear() {
    this.chunks = [];
    this.count = this.rate = 0;
  }
}

/** Gate quiet-only input before decoding, so an initial prompt cannot fill silence. */
export function hasSpeechEnergy(samples: Float32Array, rate: number) {
  const frame = Math.max(1, Math.round(rate * 0.02));
  let active = 0;
  for (let i = 0; i < samples.length; i += frame) {
    const end = Math.min(samples.length, i + frame);
    let energy = 0;
    for (let j = i; j < end; j++) energy += samples[j] ** 2;
    if (energy / (end - i) > 0.00001) active += end - i;
  }
  return active >= rate * 0.1;
}

/** Resample whole windows to mono 16 kHz PCM16 for native transcription. */
export function speechPcm16(samples: Float32Array, rate: number): ArrayBuffer {
  const ratio = rate / 16000;
  const output = new Int16Array(Math.floor(samples.length / ratio));
  // Integrate source samples over each output interval; preserves amplitude and
  // carries fractional positions across the complete window at 44.1/48kHz.
  for (let i = 0; i < output.length; i++) {
    const left = i * ratio;
    const right = (i + 1) * ratio;
    let value = 0;
    for (let j = Math.floor(left); j < Math.ceil(right); j++)
      value += (samples[j] ?? 0) * (Math.min(right, j + 1) - Math.max(left, j));
    output[i] = Math.round(Math.max(-1, Math.min(1, value / ratio)) * 32767);
  }
  return output.buffer;
}
